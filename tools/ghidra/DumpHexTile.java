// 找 HexMap 的 mTileSize（世界单位/格）以及 nHexMap 的坐标换算实现。
//
// 用法：-postScript DumpHexTile.java <outfile>
// @category Rivals

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Data;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

import java.io.PrintWriter;
import java.io.FileWriter;
import java.util.LinkedHashSet;
import java.util.Set;

public class DumpHexTile extends GhidraScript {

    // 从 unitscales.txt 的 A 段抄来的指针表地址（PTR_s_* / PTR_FUN_* 对）
    private static final long[] PTR_TABLE = {
        0x03c5f8b0L, 0x03c5f8b8L, // GetTileAtPos  name / impl
        0x03c5f8c0L, 0x03c5f8c8L, // GetWorldPosFromHexGridPos
        0x03c5f8d0L, 0x03c5f8d8L, // GetTilesInArea
        0x03c5f8e0L, 0x03c5f8e8L, // GetTilesInRing
        0x03c5f8f0L, 0x03c5f8f8L, // ChangeVisibilityInArea
        0x03c5f910L, 0x03c5f918L, // GetTileRelative
        0x03c5f940L, 0x03c5f948L, // GetOffsetFromCenterDoubled
    };

    // 要在属性表里定位的字符串（虚拟地址 = 字符串地址）
    private static final long[] NAME_STRS = {
        0x00d53dc1L, // mTileSize
        0x00c7e98cL, // GetDistance
    };

    private static final int MAX_DECOMPILE = 24;
    private static final int DECOMPILE_SECONDS = 120;

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String outPath = args.length > 0 ? args[0] : "ghidra_hextile.txt";
        PrintWriter out = new PrintWriter(new FileWriter(outPath));
        Memory mem = currentProgram.getMemory();
        DecompInterface dec = new DecompInterface();
        dec.openProgram(currentProgram);
        Set<Function> todo = new LinkedHashSet<>();

        out.println("程序 " + currentProgram.getName() + " 基址 " + currentProgram.getImageBase());

        out.println("\n================ 1. 指针表 ================");
        for (long a : PTR_TABLE) {
            Address addr = toAddr(a);
            try {
                long v = mem.getLong(addr);
                Address target = toAddr(v & 0xffffffffffffL);
                Function f = getFunctionAt(target) != null ? getFunctionAt(target) : getFunctionContaining(target);
                out.printf("  0x%08x -> 0x%08x  %s%n", a, v, f == null ? "(无函数)" : f.getName());
                if (f != null) todo.add(f);
            } catch (Exception e) {
                out.printf("  0x%08x -> 读取失败 %s%n", a, e.getMessage());
            }
        }

        out.println("\n================ 2. 名字字符串的数据引用（属性表） ================");
        for (long s : NAME_STRS) {
            Address saddr = toAddr(s);
            out.printf("%n--- 字符串 @ 0x%08x ---%n", s);
            ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(saddr);
            int n = 0;
            while (it.hasNext() && n < 12) {
                Reference r = it.next();
                n++;
                Address from = r.getFromAddress();
                Function f = getFunctionContaining(from);
                out.printf("  ref from %s  fn=%s%n", from, f == null ? "?" : f.getName() + "@" + f.getEntryPoint());
                // 打印周围 0x60 字节里的 8 字节指针 + 解析
                Address base = from.subtract(0x20);
                for (int off = 0; off < 0x60; off += 8) {
                    try {
                        long v = mem.getLong(base.add(off));
                        if (v > 0x100000L && v < 0x40000000L) {
                            Address t = toAddr(v);
                            Function tf = getFunctionAt(t);
                            String nm = "";
                            Data d = getDataAt(t);
                            if (tf != null) nm = "FUNC " + tf.getName();
                            else if (d != null && d.hasStringValue()) nm = "STR " + d.getValue();
                            else if (d != null) nm = "DATA " + d.getDataType().getName();
                            out.printf("      +0x%02x = 0x%08x  %s%n", off, v, nm);
                            if (tf != null) todo.add(tf);
                        }
                    } catch (Exception ignored) {
                    }
                }
            }
            if (n == 0) out.println("  （无引用）");
        }

        out.println("\n================ 3. 反编译（最多 " + MAX_DECOMPILE + "）=================");
        int done = 0;
        for (Function f : todo) {
            if (done++ >= MAX_DECOMPILE) { out.println("（截断）"); break; }
            out.println("\n--- " + f.getName() + " @ " + f.getEntryPoint() + " size=" + f.getBody().getNumAddresses() + " ---");
            try {
                DecompileResults dr = dec.decompileFunction(f, DECOMPILE_SECONDS, monitor);
                if (dr != null && dr.decompileCompleted()) out.println(dr.getDecompiledFunction().getC());
                else out.println("（失败 " + (dr == null ? "null" : dr.getErrorMessage()) + "）");
            } catch (Exception ex) {
                out.println("（异常 " + ex.getMessage() + "）");
            }
        }
        dec.dispose();
        out.flush();
        out.close();
        println("输出写入: " + outPath + "  函数 " + todo.size());
    }
}
