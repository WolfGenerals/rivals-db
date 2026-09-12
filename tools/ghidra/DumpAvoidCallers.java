// 找 FUN_01b6dbc0（把 ArmyAvoidanceTuning 拷成 float 数组）的调用者，并反编译，看数组落到哪
// 用法：-postScript DumpAvoidCallers.java <outfile>
// @category Rivals

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

import java.io.PrintWriter;
import java.io.FileWriter;
import java.util.LinkedHashSet;
import java.util.Set;

public class DumpAvoidCallers extends GhidraScript {
    private static final long TARGET = 0x01b6dbc0L;
    private static final int MAX_DECOMPILE = 8;

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        PrintWriter out = new PrintWriter(new FileWriter(args.length > 0 ? args[0] : "ghidra_avoidcallers.txt"));
        DecompInterface dec = new DecompInterface();
        dec.openProgram(currentProgram);

        Address t = toAddr(TARGET);
        out.println("目标 " + t + " 的引用：");
        Set<Function> callers = new LinkedHashSet<>();
        ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(t);
        while (it.hasNext()) {
            Reference r = it.next();
            Function f = getFunctionContaining(r.getFromAddress());
            out.println("  " + r.getFromAddress() + "  type=" + r.getReferenceType() + "  fn="
                    + (f == null ? "?" : f.getName() + "@" + f.getEntryPoint()));
            if (f != null) callers.add(f);
        }
        out.println("调用者 " + callers.size() + " 个");

        int n = 0;
        for (Function f : callers) {
            if (n++ >= MAX_DECOMPILE) { out.println("（截断）"); break; }
            out.println("\n============================================================");
            out.println("函数 " + f.getName() + " @ " + f.getEntryPoint() + " size=" + f.getBody().getNumAddresses());
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
        println("输出写入完成，调用者 " + callers.size());
    }
}
