// 用「GameConfig 里 armyAvoidanceTuning 的字段偏移」当锚点找避让计算的消费者。
//   A. 反编译 GameConfig::_Internal::armyavoidancetuning → 取出字段偏移（大数，唯一）
//   B. 扫全部指令：谁读这个偏移 → 候选消费者（按命中次数排序）
//   C. 反编译候选
// 用法：-postScript DumpAvoidConsumers.java <outfile>
// @category Rivals

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;

import java.io.PrintWriter;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class DumpAvoidConsumers extends GhidraScript {

    private static final String ANCHOR_SYM = "_ZN2ws3app5proto10GameConfig9_Internal19armyavoidancetuningEPKS2_";
    private static final int MAX_DECOMPILE = 6;

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String outPath = args.length > 0 ? args[0] : "ghidra_avoidconsumers.txt";
        PrintWriter out = new PrintWriter(new FileWriter(outPath));
        Listing listing = currentProgram.getListing();
        DecompInterface dec = new DecompInterface();
        dec.openProgram(currentProgram);

        // ---------- A. 锚点偏移 ----------
        out.println("================ A. GameConfig.armyAvoidanceTuning 的字段偏移 ================");
        Function anchor = null;
        SymbolIterator syms = currentProgram.getSymbolTable().getAllSymbols(true);
        while (syms.hasNext()) {
            Symbol s = syms.next();
            if (ANCHOR_SYM.equals(s.getName())) { anchor = getFunctionAt(s.getAddress()); break; }
        }
        if (anchor == null) { out.println("  锚点符号未找到"); out.close(); return; }
        out.println("  访问器 " + anchor.getName() + " @ " + anchor.getEntryPoint());
        long fieldOff = -1;
        Instruction ins = listing.getInstructionAt(anchor.getEntryPoint());
        for (int k = 0; k < 8 && ins != null; k++) {
            out.println("      " + ins.getAddress() + "  " + ins);
            for (int op = 0; op < ins.getNumOperands(); op++) {
                for (Object o : ins.getOpObjects(op)) {
                    if (o instanceof Scalar) {
                        long v = ((Scalar) o).getUnsignedValue();
                        if (v > fieldOff) fieldOff = v;
                    }
                }
            }
            ins = ins.getNext();
        }
        out.println("  ⇒ 字段偏移 = 0x" + Long.toHexString(fieldOff) + " (" + fieldOff + ")");
        if (fieldOff <= 0x100) { out.println("  （偏移太小，无法当锚点）"); out.close(); dec.dispose(); return; }

        // ---------- B. 谁读它 ----------
        out.println("\n================ B. 读取该偏移的函数 ================");
        Map<Function, Integer> hits = new LinkedHashMap<>();
        long scanned = 0;
        for (Instruction i : listing.getInstructions(true)) {
            scanned++;
            for (int op = 0; op < i.getNumOperands(); op++) {
                for (Object o : i.getOpObjects(op)) {
                    if (o instanceof Scalar && ((Scalar) o).getUnsignedValue() == fieldOff) {
                        Function f = getFunctionContaining(i.getAddress());
                        if (f != null) hits.merge(f, 1, Integer::sum);
                    }
                }
            }
        }
        out.println("  扫描指令数 " + scanned + "，命中函数 " + hits.size());
        List<Map.Entry<Function, Integer>> ranked = new ArrayList<>(hits.entrySet());
        ranked.sort((a, b) -> b.getValue() - a.getValue());
        for (int i = 0; i < Math.min(30, ranked.size()); i++) {
            out.printf("  [%2d] %s @ %s  x%d%n", i, ranked.get(i).getKey().getName(),
                    ranked.get(i).getKey().getEntryPoint(), ranked.get(i).getValue());
        }

        // ---------- C. 反编译 ----------
        out.println("\n================ C. 反编译 ================");
        int n = 0;
        for (Map.Entry<Function, Integer> e : ranked) {
            if (n++ >= MAX_DECOMPILE) break;
            Function f = e.getKey();
            out.println("\n============================================================");
            out.println("函数 " + f.getName() + " @ " + f.getEntryPoint()
                    + "  size=" + f.getBody().getNumAddresses() + "  命中 x" + e.getValue());
            out.println("============================================================");
            try {
                DecompileResults dr = dec.decompileFunction(f, 180, monitor);
                if (dr != null && dr.decompileCompleted()) out.println(dr.getDecompiledFunction().getC());
                else out.println("（失败）");
            } catch (Exception ex) {
                out.println("（异常 " + ex.getMessage() + "）");
            }
        }

        dec.dispose();
        out.flush();
        out.close();
        println("输出写入: " + outPath + " 锚点偏移 0x" + Long.toHexString(fieldOff));
    }
}
