// 找避让系统的实现：① 用 RTTI 名字指针扫出 type_info→vtable→虚函数
//                  ② 扫描 "AvoidanceCalculationsManager" 字符串所在的那张数据表（类注册表）
// 用法：-postScript DumpAvoidTable.java <outfile>
// @category Rivals

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;

import java.io.PrintWriter;
import java.io.FileWriter;
import java.util.LinkedHashSet;
import java.util.Set;

public class DumpAvoidTable extends GhidraScript {

    private static final long RTTI_NAME = 0x00e1dd49L;      // N2ws3app16AvoidanceMovableE
    private static final long MGR_NAME = 0x00d4b3fbL;       // "AvoidanceCalculationsManager"
    private static final long MGR_REF_SLOT = 0x03e538c0L;   // 引用它的数据槽

    private static final int MAX_DECOMPILE = 25;
    private final Set<Function> todo = new LinkedHashSet<>();

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String outPath = args.length > 0 ? args[0] : "ghidra_avoidtable.txt";
        PrintWriter out = new PrintWriter(new FileWriter(outPath));
        Memory mem = currentProgram.getMemory();
        DecompInterface dec = new DecompInterface();
        dec.openProgram(currentProgram);

        out.println("================ ① RTTI → type_info → vtable ================");
        for (Address p : findAllPointersTo(mem, RTTI_NAME)) {
            Address typeInfo = p.subtract(8);
            out.println("  指向 RTTI 名的指针 @ " + p + " ⇒ type_info 推测 " + typeInfo);
            for (Address q : findAllPointersTo(mem, typeInfo.getOffset())) {
                Address vtable = q.subtract(8);
                out.println("    指向 type_info 的指针 @ " + q + " ⇒ vtable 推测 " + vtable);
                dumpVtable(out, mem, vtable, 24);
            }
        }

        out.println("\n================ ② 类注册表附近（字符串引用槽） ================");
        out.println("  AvoidanceCalculationsManager 字符串 @ " + toAddr(MGR_NAME));
        out.println("  引用槽 @ " + toAddr(MGR_REF_SLOT) + "（±0x100 的 8 字节指针）");
        for (long off = -0x100; off <= 0x100; off += 8) {
            Address a = toAddr(MGR_REF_SLOT + off);
            long v;
            try {
                v = mem.getLong(a);
            } catch (Exception e) {
                continue;
            }
            String mark = off == 0 ? "  <== 本条" : "";
            out.printf("      %s +0x%04x = 0x%08x  %s%s%n", a, off & 0xffff, v, describe(v), mark);
        }

        out.println("\n================ ③ 反编译（最多 " + MAX_DECOMPILE + "，候选 " + todo.size() + "）=================");
        int n = 0;
        for (Function f : todo) {
            if (n++ >= MAX_DECOMPILE) { out.println("（截断）"); break; }
            out.println("\n--- " + f.getName() + " @ " + f.getEntryPoint() + " size=" + f.getBody().getNumAddresses() + " ---");
            try {
                DecompileResults dr = dec.decompileFunction(f, 150, monitor);
                if (dr != null && dr.decompileCompleted()) out.println(dr.getDecompiledFunction().getC());
                else out.println("（失败）");
            } catch (Exception ex) {
                out.println("（异常 " + ex.getMessage() + "）");
            }
        }

        dec.dispose();
        out.flush();
        out.close();
        println("输出写入: " + outPath + " 候选函数 " + todo.size());
    }

    /** 扫全内存找「值等于 target 的 8 字节指针」 */
    private java.util.List<Address> findAllPointersTo(Memory mem, long target) {
        java.util.List<Address> hits = new java.util.ArrayList<>();
        byte[] pat = new byte[8];
        for (int i = 0; i < 8; i++) pat[i] = (byte) ((target >>> (8 * i)) & 0xff);
        for (MemoryBlock blk : mem.getBlocks()) {
            if (!blk.isInitialized() || blk.isExecute()) continue;
            Address a = blk.getStart();
            while (a != null && a.compareTo(blk.getEnd()) < 0) {
                Address hit = mem.findBytes(a, pat, null, true, monitor);
                if (hit == null) break;
                hits.add(hit);
                if (hits.size() > 12) return hits;
                a = hit.add(1);
            }
        }
        return hits;
    }

    private void dumpVtable(PrintWriter out, Memory mem, Address vtable, int slots) {
        for (int i = 0; i < slots; i++) {
            Address slot = vtable.add(8L * i);
            long v;
            try {
                v = mem.getLong(slot);
            } catch (Exception e) {
                break;
            }
            if (v == 0) { out.printf("        [%2d] %s = 0%n", i, slot); continue; }
            Address t = toAddr(v);
            Function f = getFunctionAt(t);
            if (f == null) f = getFunctionContaining(t);
            out.printf("        [%2d] %s -> 0x%08x %s%n", i, slot, v, f == null ? "" : f.getName() + "@" + f.getEntryPoint());
            if (f != null && i >= 2) todo.add(f);
        }
    }

    private String describe(long v) {
        if (v < 0x100000L || v > 0x40000000L) return "";
        Address a = toAddr(v);
        Function f = getFunctionAt(a);
        if (f != null) return "FUNC " + f.getName();
        Data d = getDataAt(a);
        if (d != null) {
            StringDataInstance sdi = StringDataInstance.getStringDataInstance(d);
            if (sdi != null && sdi.getStringValue() != null) return "STR " + sdi.getStringValue();
            return "DATA " + d.getDataType().getName();
        }
        return "";
    }
}
