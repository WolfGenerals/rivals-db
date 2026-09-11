// 反解武器开火时序：找 "chargeUpDuration" 等字段名的引用，并反编译使用它们的函数
// @category Rivals

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.DataUtilities;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.*;
import java.io.PrintWriter;
import java.util.*;

public class DumpWeaponTiming extends GhidraScript {

    PrintWriter out;
    DecompInterface dec;

    static final String[] NEEDLES = {
        "chargeUpDuration", "burstChargeUpDuration", "burstCooldown",
        "muzzleStrategy", "initialChargeUpMs", "OnBeginFireLuaWeapon"
    };

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String outPath = args.length > 0 ? args[0]
                : "C:\\Projects\\DSH\\Rivals\\tmp\\ghidra\\out\\weapontiming.txt";
        out = new PrintWriter(outPath, "UTF-8");
        dec = new DecompInterface();
        dec.openProgram(currentProgram);

        try {
            out.println("=== 武器开火时序反解 ===");
            Memory mem = currentProgram.getMemory();

            // 1) 在已定义数据里找这些字符串
            Map<String, List<Address>> found = new LinkedHashMap<>();
            for (String n : NEEDLES) found.put(n, new ArrayList<>());
            DataIterator di = currentProgram.getListing().getDefinedData(true);
            while (di.hasNext()) {
                Data d = di.next();
                if (d == null || !d.hasStringValue()) continue;
                Object v = d.getValue();
                if (v == null) continue;
                String s = v.toString();
                for (String n : NEEDLES) {
                    if (s.equals(n) || s.contains(n)) {
                        // 精确认字段名优先
                        if (s.equals(n)) found.get(n).add(0, d.getAddress());
                        else found.get(n).add(d.getAddress());
                    }
                }
            }
            for (Map.Entry<String, List<Address>> e : found.entrySet()) {
                out.println(String.format("  %-24s 命中 %d 处 %s", e.getKey(), e.getValue().size(),
                        e.getValue().isEmpty() ? "" : e.getValue().subList(0, Math.min(4, e.getValue().size()))));
            }

            // 2) 对每个命中的字符串，找引用它的函数并反编译
            Set<Function> fns = new LinkedHashSet<>();
            for (Map.Entry<String, List<Address>> e : found.entrySet()) {
                for (Address a : e.getValue()) {
                    out.println("\n--- STR " + e.getKey() + " @ " + a);
                    ReferenceIterator ri = currentProgram.getReferenceManager().getReferencesTo(a);
                    int n = 0;
                    while (ri.hasNext() && n < 10) {
                        Reference r = ri.next();
                        Function f = getFunctionContaining(r.getFromAddress());
                        out.println("      ref from " + r.getFromAddress() + "  fn="
                                + (f == null ? "?" : f.getName() + "@" + f.getEntryPoint()));
                        if (f != null) { fns.add(f); n++; }
                    }
                }
            }

            out.println("\n[2] 待反编译函数: " + fns.size());
            int done = 0;
            for (Function f : fns) {
                if (done++ >= 12) { out.println("  ...（截断）"); break; }
                out.println("\n" + "=".repeat(100));
                out.println("FUNCTION " + f.getName() + " @ " + f.getEntryPoint()
                        + "  size=" + f.getBody().getNumAddresses());
                out.println("=".repeat(100));
                try {
                    DecompileResults res = dec.decompileFunction(f, 120, monitor);
                    if (res != null && res.decompileCompleted()) {
                        out.println(res.getDecompiledFunction().getC());
                    } else {
                        out.println("  (decompile failed)");
                    }
                } catch (Exception ex) {
                    out.println("  (exception " + ex.getMessage() + ")");
                }
            }

            // 3) 扫常量：找 0.035 / 0.1 / 3.44 之类
            out.println("\n=== 常量扫描（前 12 个函数的定点/浮点常量）===");
            done = 0;
            for (Function f : fns) {
                if (done++ >= 12) break;
                out.println("\n  -- " + f.getName() + " --");
                Set<String> cs = new LinkedHashSet<>();
                InstructionIterator ii = currentProgram.getListing().getInstructions(f.getBody(), true);
                while (ii.hasNext()) {
                    Instruction ins = ii.next();
                    for (int i = 0; i < ins.getNumOperands(); i++) {
                        for (Object o : ins.getOpObjects(i)) {
                            if (o instanceof Scalar) {
                                long v = ((Scalar) o).getUnsignedValue();
                                if (v > 1 && v < 0x4000000L) cs.add(String.format("0x%X(%d)", v, v));
                            }
                        }
                    }
                }
                int shown = 0;
                for (String c : cs) { if (shown++ >= 18) break; out.print(c + " "); }
                out.println();
            }

            out.println("\n=== done ===");
        } finally {
            out.flush();
            out.close();
            dec.dispose();
        }
    }
}
