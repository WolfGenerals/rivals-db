// 尽量完整地导出 libapp.so 里与枚举 / 等级缩放相关的信息。
//
// 输出（分节）：
//   A 目标字符串字面量的地址与引用它的函数
//   B 引用这些字符串的函数（逐个反编译）
//   C 疑似"枚举注册表"：成簇出现的 名字指针 + 小整数 常量
//   D GetRankedStatExponential* 的引用与调用点
//   E 程序概览（块、函数数、字符串数）
//
// 两步用法（不要加 -deleteProject）：
//   1) analyzeHeadless <projDir> <projName> -import <libapp.so> \
//        -scriptPath tools/ghidra -postScript DumpEnumAndRankInfo.java <outfile>
//   2) 改脚本后复用：analyzeHeadless <projDir> <projName> \
//        -process libapp.so -noanalysis -scriptPath tools/ghidra \
//        -postScript DumpEnumAndRankInfo.java <outfile>

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;

import java.io.PrintWriter;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

public class DumpEnumAndRankInfo extends GhidraScript {

    private static final String[] NEEDLES = {
        // 枚举名（Lua 侧可见的全局）
        "CombatantDescriptor", "UnitTag", "TargetMode", "MuzzleStrategy",
        "DamageOverride", "DamageType", "DamageFlags", "QueryArmyFilter",
        "UnitStatPane", "StatID", "StyleID", "ActivationType",
        // 枚举成员名（用几个代表性前缀覆盖各类）
        "override_infantry", "override_vehicle", "override_aircraft",
        "override_structure", "override_harvester",
        "kImpactShape_", "DamageType_", "kQueryArmyFilter_",
        "UnitStatPane_", "StatID_", "MuzzleStrategy_",
        // 等级缩放（升级公式）
        "GetRankedStatExponential", "GetRankedStatExponentialForRankLevel",
        "nRankedStatsUtil", "majorLevel", "minorLevel",
        "GetMaxLevelForRank", "GetMaxRank", "GetMinRank",
        // Lua API 注册的名字（找注册点）
        "lua_setfield", "lua_pushstring", "lua_pushinteger",
    };

    private static final int MAX_DECOMPILE = 60;
    private static final int DECOMPILE_SECONDS = 120;

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String outPath = args.length > 0 ? args[0] : "ghidra_out.txt";
        PrintWriter out = new PrintWriter(new FileWriter(outPath));

        Listing listing = currentProgram.getListing();
        out.println("程序      : " + currentProgram.getName());
        out.println("语言      : " + currentProgram.getLanguageID());
        out.println("镜像基址  : " + currentProgram.getImageBase());
        out.println("内存块数  : " + currentProgram.getMemory().getBlocks().length);
        out.println();

        // ---------- A: 字符串字面量 ----------
        out.println("================ A. 目标字符串 ================");
        Map<String, List<Address>> hits = new LinkedHashMap<>();
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
            if (v == null || v.isEmpty()) continue;
            for (String n : NEEDLES) {
                if (v.equals(n)) {
                    hits.computeIfAbsent(n, k -> new ArrayList<>()).add(d.getAddress());
                    break;
                }
            }
        }
        for (String n : NEEDLES) {
            List<Address> addrs = hits.get(n);
            if (addrs == null) {
                out.printf("  %-38s 未找到%n", n);
            } else {
                StringBuilder sb = new StringBuilder();
                for (Address a : addrs) sb.append(a).append(' ');
                out.printf("  %-38s %d 处: %s%n", n, addrs.size(), sb.toString().trim());
            }
        }

        // ---------- B: 引用它们的函数 ----------
        out.println();
        out.println("================ B. 引用这些字符串的函数 ================");
        Set<Function> targets = new LinkedHashSet<>();
        for (Map.Entry<String, List<Address>> e : hits.entrySet()) {
            for (Address a : e.getValue()) {
                ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(a);
                while (it.hasNext()) {
                    Reference r = it.next();
                    Function f = getFunctionContaining(r.getFromAddress());
                    if (f != null) targets.add(f);
                }
            }
        }
        out.println("共 " + targets.size() + " 个函数");
        for (Function f : targets) {
            out.println("  " + f.getName() + " @ " + f.getEntryPoint());
        }

        // ---------- C: 疑似枚举注册表 ----------
        out.println();
        out.println("================ C. 疑似枚举注册（名字指针 + 小整数 成簇）================");
        // 收集所有指向"合法标识符字符串"的引用点，及其后 64 字节内出现的小整数常量
        TreeMap<Long, String> clusters = new TreeMap<>();
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
            if (v == null || v.length() < 3 || v.length() > 48) continue;
            if (!v.matches("[A-Za-z_][A-Za-z0-9_]{2,47}")) continue;

            ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(d.getAddress());
            while (it.hasNext()) {
                Reference r = it.next();
                Address from = r.getFromAddress();
                Instruction ins = listing.getInstructionAt(from);
                if (ins == null) continue;
                // 往后看 6 条指令，找小整数常量（枚举值通常是 0..64 或 2 的幂）
                Instruction cur = ins;
                Long foundConst = null;
                for (int i = 0; i < 6 && cur != null; i++) {
                    for (int op = 0; op < cur.getNumOperands(); op++) {
                        Object[] objs = cur.getOpObjects(op);
                        for (Object o : objs) {
                            if (o instanceof Scalar) {
                                long val = ((Scalar) o).getUnsignedValue();
                                if (val > 0 && val <= 4096) {
                                    foundConst = val;
                                    break;
                                }
                            }
                        }
                        if (foundConst != null) break;
                    }
                    if (foundConst != null) break;
                    cur = cur.getNext();
                }
                if (foundConst != null) {
                    clusters.put(from.getOffset(),
                        String.format("%-46s -> constant %d", v, foundConst));
                }
            }
        }
        out.println("成簇候选 " + clusters.size() + " 条（按地址排序，同族的会相邻）");
        int shown = 0;
        for (Map.Entry<Long, String> e : clusters.entrySet()) {
            out.printf("  0x%08x  %s%n", e.getKey(), e.getValue());
            if (++shown >= 800) {
                out.println("  ...（截断，共 " + clusters.size() + " 条）");
                break;
            }
        }

        // ---------- D: 反编译 ----------
        out.println();
        out.println("================ D. 反编译（最多 " + MAX_DECOMPILE + " 个）================");
        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);
        int n = 0;
        for (Function f : targets) {
            if (n >= MAX_DECOMPILE) {
                out.println("（已达上限，剩余 " + (targets.size() - n) + " 个未反编译）");
                break;
            }
            n++;
            out.println();
            out.println("--------------------------------------------------------------");
            out.println("函数 " + f.getName() + " @ " + f.getEntryPoint());
            out.println("--------------------------------------------------------------");
            try {
                DecompileResults dr = decomp.decompileFunction(f, DECOMPILE_SECONDS, monitor);
                if (dr != null && dr.decompileCompleted()) {
                    out.println(dr.getDecompiledFunction().getC());
                } else {
                    out.println("（反编译失败: " + (dr == null ? "null" : dr.getErrorMessage()) + "）");
                }
            } catch (Exception e) {
                out.println("（反编译异常: " + e.getMessage() + "）");
            }
        }
        decomp.dispose();

        out.flush();
        out.close();
        println("输出写入: " + outPath);
        println("字符串命中: " + hits.size() + " / " + NEEDLES.length
                 + "，引用函数 " + targets.size() + "，枚举候选 " + clusters.size());
    }
}
