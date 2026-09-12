// 按地址反编译若干函数：-postScript DumpAt.java <outfile> <hexaddr> [hexaddr...]
// @category Rivals

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

import java.io.PrintWriter;
import java.io.FileWriter;

public class DumpAt extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String outPath = args.length > 0 ? args[0] : "ghidra_at.txt";
        PrintWriter out = new PrintWriter(new FileWriter(outPath));
        DecompInterface dec = new DecompInterface();
        dec.openProgram(currentProgram);
        for (int i = 1; i < args.length; i++) {
            Address a = toAddr(Long.parseLong(args[i].replace("0x", ""), 16));
            Function f = getFunctionAt(a);
            if (f == null) f = getFunctionContaining(a);
            out.println("\n=========== " + args[i] + " -> " + (f == null ? "无函数" : f.getName() + " size=" + f.getBody().getNumAddresses()) + " ===========");
            if (f == null) continue;
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
        println("输出写入: " + outPath);
    }
}
