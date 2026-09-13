/**
 * 验证**武器卡的文案**（`web/src/weapon-view.ts`）—— 重点是用户提的两条：
 *
 * 1. **内部名不许直接出现在界面上**（「`modifier_chem_warrior_gas_cloud` 这样的名字别直接出现，汉化掉」）；
 * 2. 三种时序的口径要说清楚（前摇含在周期里 / 装填从首发算 / 分段蓄力在连打之前）。
 *
 * 跑法：`node --experimental-strip-types core/test/weapon-view-check.ts`
 * （需要先 `rivals convert-defs`）
 */

import { readFileSync } from "node:fs";
import { decodeDef } from "../src/model/def-json.ts";
import type { UnitDefJson } from "../src/model/def-json.ts";
import { level } from "../src/levels.ts";
import { timingView, warheadLines, damageRows, tileDamageView, explosionDamageView } from "../../web/src/weapon-view.ts";
import { displayName } from "../../web/src/display-names.ts";

/** 取某把武器上第一条"铺格子效果"（火 / 毒气） */
function placeOf(unitId: string): Extract<NonNullable<ReturnType<typeof weaponOf>["warhead"]>[number], { kind: "place_modifier" }> {
  const w = weaponOf(unitId);
  const e = (w.warhead ?? []).find((x) => x.kind === "place_modifier");
  if (e === undefined) throw new Error(`${unitId} 没有铺格子效果的弹头`);
  return e as Extract<NonNullable<typeof w.warhead>[number], { kind: "place_modifier" }>;
}

let failed = 0;
let passed = 0;
const check = (label: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 期望 ${JSON.stringify(want)}，得到 ${JSON.stringify(got)}`);
};

const file = JSON.parse(readFileSync("data/units.def.gen.json", "utf8")) as { units: Record<string, UnitDefJson> };
const lv = level(1, 0);
const defOf = (id: string) => decodeDef(file.units[id]!);
const weaponOf = (id: string, wid?: string) => {
  const def = defOf(id);
  return wid === undefined ? def.combatant.weapons[0]! : def.combatant.weapons.find((w) => w.id === wid)!;
};

console.log("【1】显示名映射：内部 id → 中文（不认识的**原样返回**，不瞎起名）");
{
  check("modifier_chem_warrior_gas_cloud → 毒气云", displayName("modifier_chem_warrior_gas_cloud"), "毒气云");
  check("modifier_fire_bomber_fire → 火焰", displayName("modifier_fire_bomber_fire"), "火焰");
  check("ability_catalyst_explosion → 催化爆炸", displayName("ability_catalyst_explosion"), "催化爆炸");
  check("序列脚本 → 专属武器序列脚本", displayName("ability_beamcannon_weapon_sequence"), "专属武器序列脚本");
  check("**不认识的**原样返回（不假装它叫别的）", displayName("modifier_some_unseen_thing"), "modifier_some_unseen_thing");
}

console.log("\n【2】弹头文案里**不许出现内部名**（`modifier_*` / `ability_*`）");
{
  const cases: Array<[string, string | undefined]> = [
    ["unit_nod_chemicalwarrior", undefined], // 铺毒气
    ["unit_nod_firebomber", "missile"], // 铺火
    ["unit_nod_catalystgunship", "catalystWeapon"], // 催化引爆
    ["unit_nod_scarab", undefined], // 铺火 + 续时 + 自杀式
  ];
  for (const [id, wid] of cases) {
    const w = weaponOf(id, wid);
    const text = warheadLines(w).join("\n");
    const raw = /(^|[^A-Za-z0-9_])(modifier|ability)_[a-z0-9_]+/i.exec(text);
    check(`${id} · ${w.id}：没有裸内部名${raw === null ? "" : `（漏了 ${raw[0]}）`}`, raw === null, true);
  }
  const chem = warheadLines(weaponOf("unit_nod_chemicalwarrior")).join("\n");
  check("生化战士写的是「毒气云」", chem.includes("毒气云"), true);
  check("生化战士：连续开打门槛也说了", chem.includes("连续开打"), true);
  const catalyst = warheadLines(weaponOf("unit_nod_catalystgunship", "catalystWeapon")).join("\n");
  check("催化剂写的是「催化爆炸」+ 条件是「毒气云」", catalyst.includes("催化爆炸") && catalyst.includes("毒气云"), true);
}

console.log("\n【3】时序文案里**不许出现内部脚本名**，且口径写清");
{
  const beam = timingView(weaponOf("unit_nod_beamcannon"), { unitName: "万钧巨炮" });
  const text = beam.lines.join("\n");
  check("不出现 `ability_*_weapon_sequence`", /ability_[a-z0-9_]+/.test(text), false);
  // 用户第 ③ 条：**"节奏由哪个脚本驱动"是开发者信息，页面上不写**
  check("也不再提「脚本 / 序列」", /脚本|序列/.test(text), false);

  const mlrs = timingView(weaponOf("unit_gdi_mlrs"), { unitName: "多管火箭" });
  check("弹夹：只说一夹的周期", mlrs.lines.join("\n").includes("一夹的周期是 5.00s"), true);
  check("弹夹：说清图上那条是「最后一发之后剩下的」", mlrs.lines.join("\n").includes("打完最后一发之后剩下的"), true);

  const rifle = timingView(weaponOf("unit_gdi_riflemen"), { unitName: "步枪兵" });
  check("循环：只说「每 1.72s 造成 38 伤害」", rifle.lines[0], "每 1.72s 造成 38 伤害");
}

console.log("\n【4】伤害行（分段武器逐段）");
{
  const rows = damageRows(weaponOf("unit_nod_beamcannon"));
  check("万钧巨炮 3 段", rows.length, 3);
  check("段标签写了次数与间隔", /次 · 每 \d/.test(rows[0]?.stageLabel ?? ""), true);
  check("末段标成「末段（无上限）」", rows[2]?.stageLabel?.includes("末段（无上限）"), true);
  check("单发伤害按等级缩放（1-0 = 原值）", rows[0]?.tier?.main.base, 45);
  check("打步兵走覆写（45 → 5）", rows[0]?.tier?.main.against("Infantry"), 5);
  void lv;
}

console.log("\n【5】火 / 毒气 / 催化爆炸也用**标准伤害矩阵**（用户要求），并按等级缩放");
{
  const gas = placeOf("unit_nod_chemicalwarrior");
  const lv1 = level(1, 0);
  const v1 = tileDamageView(gas, lv1);
  const cell = (v: ReturnType<typeof tileDamageView>, t: string) => v.cells.find((c) => c.target === t)!;
  check("毒气：每跳 6（1-0）", cell(v1, "Infantry").perHit, 6);
  check("毒气：载具 0（覆写照写 0 有效）", cell(v1, "Vehicle").perHit, 0);
  check("**只对地 ⇒ 空军打不到**（不是 0）", cell(v1, "Aircraft").reachable, false);
  check("毒气：每秒 = 6 ÷ 200ms × 1000 = 30", Math.round(cell(v1, "Infantry").perSec ?? 0), 30);
  check("毒气：补正 100%（基准就是它自己）", Math.round(cell(v1, "Infantry").ratio * 100), 100);
  check("补正基准（未缩放）与缩放后的基准都给出", [v1.base, v1.scaledBase], [6, 6]);
  check("持续（秒）", v1.persistMs, 10000);

  // **按等级缩放**（用户：「毒气什么的伤害跟随单位等级你也忘了」）——J50 的四步含等级指数缩放
  const lv5 = level(5, 0);
  const v5 = tileDamageView(gas, lv5);
  const scaledPerHit = cell(v5, "Infantry").perHit;
  check("高等级下每跳伤害变大", scaledPerHit > 6, true);
  check("缩放后的基准一起给出来", v5.scaledBase, scaledPerHit);
  check("补正百分比**不随等级变**（比值与等级无关）", Math.round(cell(v5, "Infantry").ratio * 100), 100);
}

console.log("\n【6】催化爆炸的伤害（在单位顶层 `tiberiumExplosionTuning` 里）");
{
  const w = weaponOf("unit_nod_catalystgunship", "catalystWeapon");
  const boom = (w.warhead ?? []).find((e) => e.kind === "catalyst_explosion");
  check("弹头里有催化爆炸", boom?.kind, "catalyst_explosion");
  check("它带上了伤害表（800 / 建筑 800 / 步兵 300）", boom?.kind === "catalyst_explosion" ? boom.damage?.base : null, 800);
  check("扣血时刻 300ms", boom?.kind === "catalyst_explosion" ? boom.timing?.damageMs : null, 300);
  check("只作用于地面", boom?.kind === "catalyst_explosion" ? boom.groundOnly : null, true);
  const view = explosionDamageView(boom!.kind === "catalyst_explosion" ? boom!.damage! : undefined!, level(1, 0), { groundOnly: true });
  const cell = (t: string) => view.cells.find((c) => c.target === t)!;
  check("步兵 300 / 建筑 800 / 空军**打不到**", [cell("Infantry").perHit, cell("Structure").perHit, cell("Aircraft").reachable], [300, 800, false]);
  check("一次性：没有「每秒」这一项", cell("Infantry").perSec, undefined);
}

console.log("\n【7】「写了弹头但没写交付方式」时，默认那条照样出现（用户提的毒车问题）");
{
  // 生化越野车：弹头里只有铺毒气 + 续时，**没有**伤害对象 ⇒ 直接伤害走默认（攻击单个成员）
  const chem = weaponOf("unit_nod_chemquad").warhead ?? [];
  check("毒车的弹头只写了铺毒气 + 续时", chem.map((e) => e.kind), ["place_modifier", "refresh_modifier"]);
  const lines = warheadLines(weaponOf("unit_nod_chemquad"));
  check("**默认那条出现了**，词是「伤害对象：攻击单个成员」", lines.some((l) => l === "伤害对象：攻击单个成员"), true);
  check("铺毒气那条也还在", lines.some((l) => l.includes("毒气云")), true);
  // 用户第 ③ 条：**"源码没写 ⇒ 走默认"这类口径不再出现在界面上**
  check("不再提「源码 / 走默认」", /源码|走默认/.test(lines.join("\n")), false);
  // 用户第 ④ 条：**逐目标伤害与免疫名单交给旁边的矩阵**，文字里不重复
  check("毒气那条不重复逐目标与免疫名单", /对载具|免疫/.test(lines.join("\n")), false);

  // 显式写了伤害对象的不该再插默认（巨无霸 = 整队每人各一份）
  const jug = warheadLines(weaponOf("unit_gdi_juggernaut")).join("\n");
  check("巨无霸（整队每人各一份）没有多出默认那条", jug.includes("攻击单个成员"), false);

  // 完全没写弹头 ⇒ 默认那条，且不再解释它从哪来
  const rifle = warheadLines(weaponOf("unit_gdi_riflemen"));
  check("步枪兵：没写弹头 ⇒ 同样是「伤害对象：攻击单个成员」", rifle[0], "伤害对象：攻击单个成员");
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;
