// 反解 nRankedStatsUtil.GetRankedStatExponentialForRankLevel 的实现
// 目标：找出等级缩放函数里的常量、Fixed32 位宽、以及取整方式
// @category Rivals

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.DataUtilities;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.*;
import java.io.PrintWriter;
import java.util.*;

public class DumpRankedStatImpl extends GhidraScript {

    PrintWriter out;
    DecompInterface dec;

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String outPath = args.length > 0 ? args[0]
                : "C:\\Projects\\DSH\\Rivals\\tmp\\ghidra\\out\\rankedstat.txt";
        out = new PrintWriter(outPath, "UTF-8");
        dec = new DecompInterface();
        dec.openProgram(currentProgram);

        try {
            out.println("=== nRankedStatsUtil 反解 ===");
            out.println("program: " + currentProgram.getName());

            // ---- 1. 找所有含 RankedStat 的字符串 ----
            List<Data> hits = new ArrayList<>();
            DataIterator di = currentProgram.getListing().getDefinedData(true);
            while (di.hasNext()) {
                Data d = di.next();
                if (d == null || !d.hasStringValue()) continue;
                Object v = d.getValue();
                if (v == null) continue;
                String s = v.toString();
                if (s.contains("RankedStat") || s.contains("RankedStats")
                        || s.contains("Exponential") || s.contains("rankedStat")) {
                    hits.add(d);
                }
            }
            out.println("[1] 字符串命中: " + hits.size());

            // ---- 2. 每个字符串的引用函数 ----
            Set<Function> fns = new LinkedHashSet<>();
            for (Data d : hits) {
                Address a = d.getAddress();
                out.println("\n--- STR @ " + a + " = " + shorten(d.getValue().toString()));
                ReferenceIterator ri = currentProgram.getReferenceManager().getReferencesTo(a);
                while (ri.hasNext()) {
                    Reference r = ri.next();
                    Function f = getFunctionContaining(r.getFromAddress());
                    out.println("      ref from " + r.getFromAddress()
                            + "  fn=" + (f == null ? "?" : f.getName() + "@" + f.getEntryPoint()));
                    if (f != null) fns.add(f);
                }
            }

            // ---- 3. 反编译这些函数（含 1 层调用者）----
            Set<Function> expanded = new LinkedHashSet<>(fns);
            for (Function f : fns) {
                ReferenceIterator ri = currentProgram.getReferenceManager()
                        .getReferencesTo(f.getEntryPoint());
                int n = 0;
                while (ri.hasNext() && n < 12) {
                    Reference r = ri.next();
                    Function c = getFunctionContaining(r.getFromAddress());
                    if (c != null) { expanded.add(c); n++; }
                }
            }
            out.println("\n[3] 待反编译函数: " + expanded.size());

            for (Function f : expanded) {
                out.println("\n" + "=".repeat(100));
                out.println("FUNCTION " + f.getName() + " @ " + f.getEntryPoint()
                        + "   size=" + f.getBody().getNumAddresses());
                out.println("=".repeat(100));
                try {
                    DecompileResults res = dec.decompileFunction(f, 90, monitor);
                    if (res != null && res.decompileCompleted()) {
                        out.println(res.getDecompiledFunction().getC());
                    } else {
                        out.println("  (decompile failed: "
                                + (res == null ? "null" : res.getErrorMessage()) + ")");
                    }
                } catch (Exception e) {
                    out.println("  (exception " + e.getMessage() + ")");
                }

                // 常量扫描
                out.println("--- 常量 (疑似定点缩放) ---");
                List<String> consts = new ArrayList<>();
                InstructionIterator ii = currentProgram.getListing()
                        .getInstructions(f.getBody(), true);
                while (ii.hasNext()) {
                    Instruction ins = ii.next();
                    for (int i = 0; i < ins.getNumOperands(); i++) {
                        for (Object o : ins.getOpObjects(i)) {
                            if (o instanceof Scalar) {
                                long v = ((Scalar) o).getUnsignedValue();
                                // 关注 65536 附近、以及 1.01/1.05/1.1 的定点表示
                                if (v > 256 && v < 0x2000000L) {
                                    consts.add(String.format("0x%X / %d (%.6f @Q16.16)",
                                            v, v, v / 65536.0));
                                }
                            }
                        }
                    }
                }
                Set<String> uniq = new LinkedHashSet<>(consts);
                int shown = 0;
                for (String c : uniq) {
                    if (shown++ >= 60) { out.println("  ..."); break; }
                    out.println("  " + c);
                }
            }

            out.println("\n=== done ===");
        } finally {
            out.flush();
            out.close();
            dec.dispose();
        }
    }

    String shorten(String s) {
        s = s.replace("\n", " ");
        return s.length() > 90 ? s.substring(0, 90) + "..." : s;
    }
}
