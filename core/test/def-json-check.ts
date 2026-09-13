/**
 * 验证**单位 def 的产物形态**（`core/src/model/def-json.ts`）：
 * 编码 → JSON 文本 → 解码，逐项等价，**且解码后伤害还能算**。
 *
 * 这条测试守的是"**单位数据全走新格式**"这件事的地基：产物里存的是纯数据，
 * `Damage` 是 class（`against()` 是方法）—— 忘了补实例，页面就只会在**运行到伤害**时炸。
 *
 * 跑法：`node --experimental-strip-types core/test/def-json-check.ts`
 * （需要先生成产物：`pnpm --filter @rivals/cli start emit-defs`）
 */

import { readFileSync } from "node:fs";
import { unit_gdi_riflemen } from "../src/units/unit_gdi_riflemen.ts";
import { ALL_UNIT_DEFS } from "../src/units/index.ts";
import { Damage } from "../src/model/unit-def.ts";
import { decodeDef, decodeRecordMap, encodeDef, DEF_SCHEMA } from "../src/model/def-json.ts";
import type { DefFileJson } from "../src/model/def-json.ts";
import type { Target } from "../src/model/unit-def.ts";

let failed = 0;
let passed = 0;
const check = (label: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 期望 ${JSON.stringify(want)}，得到 ${JSON.stringify(got)}`);
};

/** 键序无关的稳定串（产物里键序是刻意排的，比较时不该被它影响） */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x !== null && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

/** 编码 → JSON 文本 → 解析 → 解码（走一遍真实产物的全部环节） */
const roundTrip = (def: typeof unit_gdi_riflemen) => decodeDef(JSON.parse(JSON.stringify(encodeDef(def))));

console.log("【1】往返：`Damage` 是 class，存成 JSON 后必须能被补回实例");
{
  const json = encodeDef(unit_gdi_riflemen);
  check("产物里是纯数据（没有方法）", json.combatant.weapons[0]!.damage[0]!.main, {
    base: 38,
    overrides: [["override_vehicle", 15]],
  });
  const back = roundTrip(unit_gdi_riflemen);
  const dmg = back.combatant.weapons[0]!.damage[0]!.main;
  check("解码后是 `Damage` 实例", dmg instanceof Damage, true);
  check("打步兵 38", dmg.against("Infantry" as Target), 38);
  check("打载具 15（覆写生效）", dmg.against("Vehicle" as Target), 15);
  check("打建筑走基础值 38", dmg.against("Structure" as Target), 38);
}

console.log("\n【2】除 `damage` 外的块逐项不变（节奏 / 用法 / 出处 / 队伍 / 商店）");
{
  const back = roundTrip(unit_gdi_riflemen);
  const w = back.combatant.weapons[0]!;
  check("节奏", w.timing, unit_gdi_riflemen.combatant.weapons[0]!.timing);
  check("用法", w.usage, unit_gdi_riflemen.combatant.weapons[0]!.usage);
  check("出处锚点（6 条，跟着产物走）", w.source, unit_gdi_riflemen.combatant.weapons[0]!.source);
  check("小队", back.squad, unit_gdi_riflemen.squad);
  check("商店", back.store, unit_gdi_riflemen.store);
  check("战斗员（除武器）", { ...back.combatant, weapons: [] }, { ...unit_gdi_riflemen.combatant, weapons: [] });
}

console.log("\n【3】「缺的字段」不会因为过一遍 JSON 变成别的东西（J54 的规矩）");
{
  const back = roundTrip(unit_gdi_riflemen);
  const w = back.combatant.weapons[0]!;
  check("`name` 仍不出现", "name" in w, false);
  check("`warhead` 仍不出现", "warhead" in w, false);
  check("`flightMs` 仍不出现", "flightMs" in w, false);
  check("`side` 仍不出现", "side" in w.damage[0]!, false);
  check("空 `overrides` 不写成 `[]`", encodeDef(unit_gdi_riflemen).combatant.weapons[0]!.damage[0]!.side, undefined);
  const bare = new Damage(7);
  check("没覆写的 `Damage` 编码后只有 `base`", encodeDef({ ...unit_gdi_riflemen, combatant: { ...unit_gdi_riflemen.combatant, weapons: [{ ...w, damage: [{ main: bare }] }] } }).combatant.weapons[0]!.damage[0]!.main, { base: 7 });
}

console.log("\n【4】产物文件本身：`data/units.def.json` —— 机械 def 与 `core/src/units` 一致");
{
  const file = JSON.parse(readFileSync("data/units.def.json", "utf8")) as DefFileJson;
  check("形状版本", file._schema, DEF_SCHEMA);
  const byId = decodeRecordMap(file.units);
  for (const def of ALL_UNIT_DEFS) {
    const rec = byId.get(def.id);
    check(`${def.id} 在产物里`, rec !== undefined, true);
    if (rec?.def === undefined) {
      check(`${def.id} 带机械 def`, false, true);
      continue;
    }
    // ⚠️ 比"键序也一致"没意义（产物是人读的，顺序刻意排过）⇒ 用排序后的稳定串比
    /*
     * ⚠️ **两个方向都要比，而且要比"解码回来的对象"** —— 只比 `encode(back)` 与 `encode(def)`
     * 是**对称**的，看不见"编码器漏抄字段"这种错（`encodeDef` 里武器字段是显式白名单：
     * 加了模型字段却忘了加进编码器 ⇒ 字段被静默丢掉，两边一样地丢，断言照样过）。
     * 真踩过：`WeaponDef.selfDestruct` 就是这样丢的。
     */
    check(`${def.id} 往返等价（编码）`, stable(encodeDef(rec.def)), stable(encodeDef(def)));
    check(`${def.id} 往返等价（**解码后的对象**，能抓到编码器漏字段）`, stable(rec.def), stable(def));
    const dmg = rec.def.combatant.weapons[0]?.damage[0]?.main;
    check(`${def.id} 伤害能算（载具）`, dmg?.against("Vehicle" as Target), 15);
  }
}

console.log("\n【5】新格式**自己带着**展示三件套（本地化 / 图标 / 稀有度）—— 这是「全切新格式」的前提");
{
  const file = JSON.parse(readFileSync("data/units.def.json", "utf8")) as DefFileJson;
  const units = file.units;
  const all = Object.values(units);
  check("整站单位都在（86 条，不是只有 1 条）", all.length > 80, true);
  check("绝大多数有本地化", all.filter((r) => r.locale?.name_zh !== undefined).length > 80, true);
  check("绝大多数有卡面", all.filter((r) => r.art?.card !== undefined).length > 80, true);
  check("过半有稀有度", all.filter((r) => r.pb?.rarity !== undefined).length > 60, true);

  const mlrs = units["unit_gdi_mlrs"]!;
  check("MLRS 中文名（新格式里）", mlrs.locale?.name_zh, "多管火箭");
  check("MLRS 稀有度（新格式里）", mlrs.pb?.rarity, "Epic");
  check("MLRS 卡面路径", mlrs.art?.card, "img/unit_gdi_mlrs.webp");
  check("MLRS 有机械 def（机器转换的）", mlrs.def !== undefined, true);
  check("MLRS 的 def 带 `defGaps`（还没转出来的东西）", (mlrs.defGaps ?? []).length > 0, true);
  const mlrsW = mlrs.def?.combatant.weapons[0];
  check("MLRS 节奏（弹夹 3 / 5000ms）", mlrsW?.timing.kind === "magazine" ? [mlrsW.timing.clipSize, mlrsW.timing.reloadTimeMs] : null, [3, 5000]);
  check("MLRS 部署（架 2000 / 收 500）", [mlrs.def?.deploy?.unpackMs, mlrs.def?.deploy?.packMs], [2000, 500]);

  const rifle = units["unit_gdi_riflemen"]!;
  check("步枪兵：展示三件套与 def 同时在", [
    rifle.locale?.name_zh !== undefined,
    rifle.art?.card !== undefined,
    rifle.def !== undefined,
  ], [true, true, true]);
  check("步枪兵用的是**手写** def（锚点带 `:32-37`），不是机器那份", (rifle.def?.combatant.weapons[0]?.source.anchors ?? []).some((a) => a.includes(":32-37")), true);
  check("手写 def 没有 `defGaps`（人核对过）", rifle.defGaps, undefined);
  const allUnits = Object.values(units).filter((r) => r.id.startsWith("unit_") || r.id.startsWith("bldg_"));
  check("**所有单位都有机械 def**", allUnits.every((r) => r.def !== undefined), true);
  check("指挥官也进了同一份产物", Object.keys(file.commanders ?? {}).length > 10, true);
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;
