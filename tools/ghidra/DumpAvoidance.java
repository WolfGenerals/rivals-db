// 反解「避让半径」在引擎里怎么被用掉。
//
// 两路：
//   ① 字符串引用：AvoidanceCalculationsManager / applyAvoidance / armyAvoidanceTuning /
//      avoidanceSmoothingFrames / avoidanceRadius 的引用函数 → 反编译
//   ② RTTI + vtable：N2ws3app16AvoidanceMovableE（类 AvoidanceMovable）的 vtable
//      逐槽反编译 —— 避让系统真正调用的虚函数就在这里
//
// 用法：-postScript DumpAvoidance.java <outfile>
// @category Rivals

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

import java.io.PrintWriter;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class DumpAvoidance extends GhidraScript {

    private static final String[] NEEDLES = {
        "AvoidanceCalculationsManager", "AvoidanceMovable", "applyAvoidance", "ApplyAvoidance",
        "armyAvoidanceTuning", "avoidanceSmoothingFrames", "avoidanceRadius",
        "squadPadding", "separationScale", "squadRepulsionMultiplier", "squadRepulsionPow",
        "idealSquadSizeBaseValue", "squadIdealAttackRadiusPerRow",
    };

    /** 想走 vtable 的 RTTI 类名 */
    private static final String[] RTTI = {
        "N2ws3app16AvoidanceMovableE",
    };

    private static final int MAX_DECOMPILE = 40;
    private static final int DECOMPILE_SECONDS = 150;

    private PrintWriter out;
    private DecompInterface dec;
    private final Set<Function> todo = new LinkedHashSet<>();

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String outPath = args.length > 0 ? args[0] : "ghidra_avoidance.txt";
        out = new PrintWriter(new FileWriter(outPath));
        dec = new DecompInterface();
        dec.openProgram(currentProgram);

        out.println("程序 " + currentProgram.getName() + " 基址 " + currentProgram.getImageBase());

        // ---------- ① 字符串引用 ----------
        out.println("\n================ ① 字符串引用 ================");
        Map<String, List<Address>> hits = new LinkedHashMap<>();
        Listing listing = currentProgram.getListing();
        for (String n : NEEDLES) hits.put(n, new ArrayList<>());
        for (Data d : listing.getDefinedData(true)) {
            if (d == null) continue;
            StringDataInstance sdi;
            try {
                sdi = StringDataInstance.getStringDataInstance(d);
            } catch (Exception e) {
                continue;
            }
            if (sdi == null) continue;
            String v = sdi.getStringValue();
            if (v == null) continue;
            for (String n : NEEDLES) {
                if (v.equals(n)) hits.get(n).add(d.getAddress());
            }
        }
        for (Map.Entry<String, List<Address>> e : hits.entrySet()) {
            if (e.getValue().isEmpty()) {
                out.printf("  %-32s 未找到%n", e.getKey());
                continue;
            }
            for (Address a : e.getValue()) {
                out.printf("  %-32s @ %s%n", e.getKey(), a);
                ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(a);
                int n = 0;
                while (it.hasNext() && n < 12) {
                    Reference r = it.next();
                    n++;
                    Function f = getFunctionContaining(r.getFromAddress());
                    out.printf("      ref %s  fn=%s%n", r.getFromAddress(), fn(f));
                    if (f != null) todo.add(f);
                }
                if (n == 0) out.println("      （无引用）");
            }
        }

        // ---------- ② RTTI → vtable → 虚函数 ----------
        out.println("\n================ ② RTTI → vtable（AvoidanceMovable） ================");
        Memory mem = currentProgram.getMemory();
        for (String cls : RTTI) {
            Address nameAddr = findString(cls);
            if (nameAddr == null) {
                out.println("  RTTI 名 " + cls + " 未找到");
                continue;
            }
            out.println("  RTTI 名 @ " + nameAddr);
            ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(nameAddr);
            while (it.hasNext()) {
                Address from = it.next().getFromAddress();
                Address typeInfo = from.subtract(8); // type_info { vptr, name }
                out.println("    type_info 推测 @ " + typeInfo + "（名字指针来自 " + from + "）");
                ReferenceIterator vit = currentProgram.getReferenceManager().getReferencesTo(typeInfo);
                while (vit.hasNext()) {
                    Address vref = vit.next().getFromAddress();
                    Address vtable = vref.subtract(8); // [0]=offset-to-top, [1]=&type_info
                    out.println("    vtable 推测 @ " + vtable + "（&type_info 存在 " + vref + "）");
                    for (int i = 0; i < 24; i++) {
                        Address slot = vtable.add(16 + 8L * i);
                        long v;
                        try {
                            v = mem.getLong(slot);
                        } catch (Exception ex) {
                            break;
                        }
                        if (v == 0) { out.printf("      [%2d] %s = 0（空槽）%n", i, slot); continue; }
                        Address target = toAddr(v);
                        Function f = getFunctionAt(target);
                        if (f == null) f = getFunctionContaining(target);
                        out.printf("      [%2d] %s -> %s %s%n", i, slot, target, fn(f));
                        if (f != null) todo.add(f);
                    }
                }
            }
        }

        // ---------- ③ 反编译 ----------
        out.println("\n================ ③ 反编译（最多 " + MAX_DECOMPILE + "，共 " + todo.size() + " 个候选）=================");
        int done = 0;
        for (Function f : todo) {
            if (done++ >= MAX_DECOMPILE) { out.println("（截断）"); break; }
            out.println("\n============================================================");
            out.println("函数 " + f.getName() + " @ " + f.getEntryPoint()
                    + "  size=" + f.getBody().getNumAddresses());
            out.println("============================================================");
            try {
                DecompileResults dr = dec.decompileFunction(f, DECOMPILE_SECONDS, monitor);
                if (dr != null && dr.decompileCompleted()) out.println(dr.getDecompiledFunction().getC());
                else out.println("（失败: " + (dr == null ? "null" : dr.getErrorMessage()) + "）");
            } catch (Exception ex) {
                out.println("（异常: " + ex.getMessage() + "）");
            }
        }

        dec.dispose();
        out.flush();
        out.close();
        println("输出写入: " + outPath + "  候选函数 " + todo.size());
    }

    private String fn(Function f) {
        return f == null ? "(无函数)" : f.getName() + "@" + f.getEntryPoint();
    }

    private Address findString(String value) {
        for (Data d : currentProgram.getListing().getDefinedData(true)) {
            if (d == null) continue;
            StringDataInstance sdi;
            try {
                sdi = StringDataInstance.getStringDataInstance(d);
            } catch (Exception e) {
                continue;
            }
            if (sdi != null && value.equals(sdi.getStringValue())) return d.getAddress();
        }
        return null;
    }
}
