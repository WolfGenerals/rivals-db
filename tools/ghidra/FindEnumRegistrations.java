// 在 libapp.so 里定位枚举注册相关的字符串引用，并反编译引用它们的函数。
// 用 Ghidra headless 运行：
//   analyzeHeadless <proj> <name> -import libapp.so -postScript FindEnumRegistrations.java <outfile>

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;

import java.io.PrintWriter;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public class FindEnumRegistrations extends GhidraScript {

    private static final String[] NEEDLES = {
        "override_infantry", "override_vehicle", "override_aircraft",
        "override_structure", "override_harvester",
        "CombatantDescriptor", "UnitTag", "TargetMode", "MuzzleStrategy",
        "DamageOverride", "QueryArmyFilter", "UnitStatPane",
        "GetRankedStatExponential", "majorLevel", "minorLevel",
    };

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String outPath = args.length > 0 ? args[0] : "/tmp/ghidra_out.txt";
        PrintWriter out = new PrintWriter(new FileWriter(outPath));

        out.println("== 程序: " + currentProgram.getName() + " ==");
        out.println("语言: " + currentProgram.getLanguageID());
        out.println("镜像基址: " + currentProgram.getImageBase());
        out.println();

        List<Data> stringDatas = new ArrayList<>();
        for (Data d : currentProgram.getListing().getDefinedData(true)) {
            if (d == null) continue;
            StringDataInstance sdi = StringDataInstance.getStringDataInstance(d);
            if (sdi == null || !sdi.isString()) continue;
            String v = sdi.getStringValue();
            if (v == null) continue;
            for (String n : NEEDLES) {
                if (v.equals(n)) {
                    stringDatas.add(d);
                    break;
                }
            }
        }
        out.println("匹配到的字符串字面量: " + stringDatas.size());
        out.println();

        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);

        Set<Function> targets = new LinkedHashSet<>();

        for (Data d : stringDatas) {
            Address strAddr = d.getAddress();
            StringDataInstance sdi = StringDataInstance.getStringDataInstance(d);
            out.printf("字符串 %-28s @ %s%n", sdi.getStringValue(), strAddr);

            ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(strAddr);
            int refCount = 0;
            while (it.hasNext()) {
                Reference r = it.next();
                Address from = r.getFromAddress();
                refCount++;
                Function f = getFunctionContaining(from);
                out.printf("    被引用自 %s  (%s)%n", from, f == null ? "无函数" : f.getName());
                if (f != null) targets.add(f);
            }
            if (refCount == 0) {
                out.println("    （无直接引用）");
            }
        }

        out.println();
        out.println("=== 引用这些字符串的函数: " + targets.size() + " 个 ===");
        out.println();

        for (Function f : targets) {
            out.println("--------------------------------------------------------------");
            out.println("函数 " + f.getName() + " @ " + f.getEntryPoint());
            out.println("--------------------------------------------------------------");
            try {
                DecompileResults dr = decomp.decompileFunction(f, 60, monitor);
                if (dr != null && dr.decompileCompleted()) {
                    out.println(dr.getDecompiledFunction().getC());
                } else {
                    out.println("（反编译失败: " + (dr == null ? "null" : dr.getErrorMessage()) + "）");
                }
            } catch (Exception e) {
                out.println("（反编译异常: " + e.getMessage() + "）");
            }
            out.println();
        }

        out.flush();
        out.close();
        decomp.dispose();
        println("输出写入: " + outPath);
    }
}
