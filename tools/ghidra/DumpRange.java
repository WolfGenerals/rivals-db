// 打印某地址区间的指令（带操作数），用于看调用点的参数是怎么算出来的
// 用法：-postScript DumpRange.java <outfile> <fromHex> <toHex>
// @category Rivals

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.Instruction;

import java.io.PrintWriter;
import java.io.FileWriter;

public class DumpRange extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] a = getScriptArgs();
        String outPath = a.length > 0 ? a[0] : "ghidra_range.txt";
        long from = Long.parseLong(a.length > 1 ? a[1].replace("0x", "") : "0", 16);
        long to = Long.parseLong(a.length > 2 ? a[2].replace("0x", "") : "0", 16);
        PrintWriter out = new PrintWriter(new FileWriter(outPath));
        out.println("区间 " + Long.toHexString(from) + " .. " + Long.toHexString(to));
        AddressSet set = new AddressSet(toAddr(from), toAddr(to));
        for (Instruction ins : currentProgram.getListing().getInstructions(set, true)) {
            out.println(ins.getAddress() + "  " + ins);
        }
        out.flush();
        out.close();
        println("输出写入: " + outPath);
    }
}
