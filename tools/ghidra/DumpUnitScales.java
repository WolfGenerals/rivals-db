// 反解「距离/速度类字段」的量纲：格(world tile) 与 引擎世界单位 的换算。
//
// 目标：
//   A 导出所有与 HexMap / TileSize / Avoidance / Angular / Speed 相关的导出符号名（未 strip 的 dynsym）
//   B 目标字符串字面量的地址 + 引用它的函数
//   C 反编译这些函数（寻找 * 8 / * 0.125 / mTileSize 之类的换算）
//
// 两步用法：
//   analyzeHeadless <projDir> <projName> -process libapp.so -noanalysis \
//     -scriptPath tools/ghidra -postScript DumpUnitScales.java <outfile>
// @category Rivals

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;

import java.io.PrintWriter;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class DumpUnitScales extends GhidraScript {

    private static final String[] NEEDLES = {
        "mTileSize", "GetTilesInArea", "nHexTile", "nHexMap", "HexTile",
        "avoidanceRadius", "hexReservationRadius", "crusherRadius",
        "aggroRadiusInTiles", "helpRadiusInTiles",
        "maxRangeInTiles", "minRangeInTiles",
        "maxAttackRangeInTiles", "visionRangeInTiles",
        "angularSpeed", "flyingHeight", "damageRadius", "fireRadius",
        "speed", "accelerationDistance", "decelerationDistance",
    };

    // 导出符号里值得一看的关键词
    private static final String[] SYMBOL_KEYS = {
        "TileSize", "HexMap", "HexTile", "Avoidance", "avoidance",
        "AngularSpeed", "TurnRate", "MoveSpeed", "GetSpeed",
        "WorldToTile", "TileToWorld", "GetTilesInArea", "GetDistance",
    };

    private static final int MAX_DECOMPILE = 45;
    private static final int DECOMPILE_SECONDS = 120;

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String outPath = args.length > 0 ? args[0] : "ghidra_unitscales.txt";
        PrintWriter out = new PrintWriter(new FileWriter(outPath));

        Listing listing = currentProgram.getListing();
        out.println("程序 : " + currentProgram.getName() + "  基址 " + currentProgram.getImageBase());
        out.println();

        // ---------- A: 相关导出符号 ----------
        out.println("================ A. 相关导出符号（dynsym）================");
        SymbolIterator syms = currentProgram.getSymbolTable().getAllSymbols(true);
        int symCount = 0;
        while (syms.hasNext()) {
            Symbol s = syms.next();
            String n = s.getName();
            if (n == null) continue;
            symCount++;
            for (String k : SYMBOL_KEYS) {
                if (n.contains(k)) {
                    out.printf("  %-12s %s%n", s.getAddress(), n);
                    break;
                }
            }
        }
        out.println("  (符号总数 " + symCount + ")");

        // A2: 常量扫描 —— 直接找立即数 0x1F0000/0x200000 之类（Fixed16 的 8.0 = 524288 = 0x80000）
        out.println();
        out.println("================ A2. Fixed16(8.0)=0x80000 / Fixed16(0.125)=0x2000 立即数扫描 ================");
        long[] wants = { 0x80000L, 0x2000L, 0x8000L, 0x10000L, 0x40000L };
        String[] wantNames = { "8.0", "0.125", "0.5", "1.0", "4.0" };
        for (int wi = 0; wi < wants.length; wi++) {
            final long want = wants[wi];
            final String wn = wantNames[wi];
            final int[] cnt = { 0 };
            final List<String> lines = new ArrayList<>();
            listing.getInstructions(true).forEachRemaining(ins -> {
                if (cnt[0] > 200) return;
                for (int op = 0; op < ins.getNumOperands(); op++) {
                    for (Object o : ins.getOpObjects(op)) {
                        if (o instanceof Scalar && ((Scalar) o).getUnsignedValue() == want) {
                            Function f = getFunctionContaining(ins.getAddress());
                            lines.add("    " + ins.getAddress() + "  " + ins.toString()
                                    + "   in " + (f == null ? "?" : f.getName() + "@" + f.getEntryPoint()));
                            cnt[0]++;
                            return;
                        }
                    }
                }
            });
            out.println("  -- Fixed16 " + wn + " (0x" + Long.toHexString(want) + ") : " + cnt[0] + " 处");
            int shown = 0;
            for (String l : lines) {
                if (shown++ >= 60) { out.println("    ..."); break; }
                out.println(l);
            }
        }

        // ---------- B: 字符串字面量 ----------
        out.println();
        out.println("================ B. 目标字符串 ================");
        Map<String, List<Address>> hits = new LinkedHashMap<>();
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
            if (v == null || v.isEmpty()) continue;
            for (String n : NEEDLES) {
                if (v.equals(n)) {
                    hits.get(n).add(d.getAddress());
                    break;
                }
            }
        }
        for (String n : NEEDLES) {
            List<Address> addrs = hits.get(n);
            if (addrs.isEmpty()) {
                out.printf("  %-26s 未找到%n", n);
            } else {
                StringBuilder sb = new StringBuilder();
                for (Address a : addrs) sb.append(a).append(' ');
                out.printf("  %-26s %d 处: %s%n", n, addrs.size(), sb.toString().trim());
            }
        }

        // ---------- C: 引用它们的函数 ----------
        out.println();
        out.println("================ C. 引用这些字符串的函数 ================");
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
        for (Function f : targets) out.println("  " + f.getName() + " @ " + f.getEntryPoint());

        // ---------- D: 反编译 ----------
        out.println();
        out.println("================ D. 反编译（最多 " + MAX_DECOMPILE + " 个）================");
        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);
        int n = 0;
        for (Function f : targets) {
            if (n >= MAX_DECOMPILE) { out.println("（截断，剩 " + (targets.size() - n) + "）"); break; }
            n++;
            out.println();
            out.println("--------------------------------------------------------------");
            out.println("函数 " + f.getName() + " @ " + f.getEntryPoint()
                    + "  size=" + f.getBody().getNumAddresses());
            out.println("--------------------------------------------------------------");
            try {
                DecompileResults dr = decomp.decompileFunction(f, DECOMPILE_SECONDS, monitor);
                if (dr != null && dr.decompileCompleted()) {
                    out.println(dr.getDecompiledFunction().getC());
                } else {
                    out.println("（失败: " + (dr == null ? "null" : dr.getErrorMessage()) + "）");
                }
            } catch (Exception ex) {
                out.println("（异常: " + ex.getMessage() + "）");
            }
        }
        decomp.dispose();

        out.flush();
        out.close();
        println("输出写入: " + outPath);
        println("引用函数 " + targets.size());
    }
}
