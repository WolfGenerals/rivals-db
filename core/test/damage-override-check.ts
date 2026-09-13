/**
 * 验证 `Damage.against()` 是否**准确复刻** `nTuningUtil.GetDamageOverrideWS`
 * （`gameplay/tuning/TuningUtil.lua:46-67`）。
 *
 * 两层验证：
 *   ① 8 张真实伤害表 × 5 种目标，逐条核对期望值（数字取自源码原文）
 *   ② **穷举**：5 个覆写键的全部 32 种子集 × 若干组值 × 5 种目标，
 *      与一个"照 Lua 原文逐行写成"的参照实现对比 —— 必须完全一致
 *
 * 规则依据（见 docs/findings.md 的 M1/M14/M16/M17/M18）：
 *   · 遍历**伤害表的覆写列表**，取 `>` 最大；`actualDamage` 初值 `nil`
 *     ⇒ 覆写值 `0` 是合法结果（毒气/泰矿的 `Vehicle: 0` 靠这个）
 *   · 覆写键就是目标标签（`override_vehicle` 这种）；Harvester 同时带 `override_vehicle`
 *
 * 跑法：`node --experimental-strip-types core/test/damage-override-check.ts`
 */

import { Damage, TARGET_TAGS } from "../src/model/unit-def.ts";
import type { Override, Target } from "../src/model/unit-def.ts";

const TARGETS: Target[] = ["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"];

let failed = 0;
let passed = 0;
const check = (label: string, got: number, want: number): void => {
  const ok = got === want;
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 期望 ${want}，得到 ${got}`);
};

/** 覆写表的字面量（用 `Override`，键名拼错会被类型检查拦住） */
const t = (key: Override, value: number): [Override, number] => [key, value];

/** 显示 5 种目标的结果 */
const row = (d: Damage): string => TARGETS.map((x) => `${x}=${d.against(x)}`).join("  ");

console.log("【1】引擎里真实存在的伤害表，逐条核对");

// unit_nod_obelisk.lua:15 —— 用户实测「打矿车低效」⇒ 采集车吃 Harvester:500
const obelisk = new Damage(3000, [t("override_harvester", 500)]);
console.log(`  方尖碑 3000/[harvester:500]        ${row(obelisk)}`);
check("  → 采集车（harvester 命中）", obelisk.against("Harvester"), 500);
check("  → 载具（无 vehicle 覆写）", obelisk.against("Vehicle"), 3000);
check("  → 步兵", obelisk.against("Infantry"), 3000);
check("  → 建筑", obelisk.against("Structure"), 3000);

// unit_gdi_riflemen.lua:14 —— 只写 Vehicle，采集车因带 override_vehicle 也吃到
const riflemen = new Damage(38, [t("override_vehicle", 15)]);
console.log(`  步枪兵 38/[vehicle:15]             ${row(riflemen)}`);
check("  → 采集车", riflemen.against("Harvester"), 15);
check("  → 载具", riflemen.against("Vehicle"), 15);
check("  → 步兵", riflemen.against("Infantry"), 38);

// unit_nod_attackbike.lua:14-17 —— 采集车命中两条，取最大 = 210
const attackbike = new Damage(244, [
  t("override_infantry", 40),
  t("override_harvester", 200),
  t("override_vehicle", 210),
  t("override_aircraft", 223),
]);
console.log(`  攻击摩托 244/四条                  ${row(attackbike)}`);
check("  → 采集车（harvester 200 / vehicle 210，取最大）", attackbike.against("Harvester"), 210);
check("  → 载具", attackbike.against("Vehicle"), 210);
check("  → 飞机", attackbike.against("Aircraft"), 223);
check("  → 步兵", attackbike.against("Infantry"), 40);
check("  → 建筑（无匹配）", attackbike.against("Structure"), 244);

// unit_gdi_rangers.lua:15-16
const rangers = new Damage(152, [t("override_vehicle", 20), t("override_structure", 20)]);
console.log(`  游骑兵 152/[vehicle:20,struct:20]  ${row(rangers)}`);
check("  → 采集车", rangers.against("Harvester"), 20);
check("  → 建筑", rangers.against("Structure"), 20);
check("  → 步兵", rangers.against("Infantry"), 152);

// unit_nod_artillery.lua:49-50（建筑吃 structure 覆写）
const artillery = new Damage(1000, [t("override_structure", 3000), t("override_infantry", 285)]);
console.log(`  自行火炮 1000/[struct:3000]        ${row(artillery)}`);
check("  → 建筑", artillery.against("Structure"), 3000);
check("  → 采集车（无匹配）", artillery.against("Harvester"), 1000);

// unit_gdi_disruptor.lua:45-53（用户实测：打基地极高伤害）
const disruptor = new Damage(26, [t("override_structure", 300), t("override_vehicle", 13)]);
console.log(`  音波坦克 26/[struct:300,veh:13]    ${row(disruptor)}`);
check("  → 建筑（极高伤害）", disruptor.against("Structure"), 300);
check("  → 载具", disruptor.against("Vehicle"), 13);
check("  → 采集车（vehicle 13 命中）", disruptor.against("Harvester"), 13);
check("  → 步兵（无匹配）", disruptor.against("Infantry"), 26);

// unit_gdi_razorback.lua:16-18
const razorback = new Damage(70, [t("override_vehicle", 17), t("override_structure", 28), t("override_harvester", 17)]);
console.log(`  剃刀背 70/三条                     ${row(razorback)}`);
check("  → 采集车（两条都命中，同值 17）", razorback.against("Harvester"), 17);
check("  → 建筑", razorback.against("Structure"), 28);
check("  → 步兵", razorback.against("Infantry"), 70);

// aura_gas_cloud.lua:20 —— 覆写值为 0（载具免疫）
const gas = new Damage(6, [t("override_vehicle", 0)]);
console.log(`  毒气 6/[vehicle:0]                 ${row(gas)}`);
check("  → 载具（0 是合法结果）", gas.against("Vehicle"), 0);
check("  → 采集车（vehicle:0 命中，取 0）", gas.against("Harvester"), 0);
check("  → 步兵（不命中）", gas.against("Infantry"), 6);

// aura_tiberium_field.lua:22 —— 同形状，地形伤害也是伤害对象
const tiberium = new Damage(1, [t("override_vehicle", 0)]);
console.log(`  泰矿 1/[vehicle:0]                 ${row(tiberium)}`);
check("  → 载具（免疫）", tiberium.against("Vehicle"), 0);
check("  → 采集车（vehicle:0 命中）", tiberium.against("Harvester"), 0);
check("  → 步兵（每 200ms 掉 1）", tiberium.against("Infantry"), 1);

// aura_fire.lua:17 —— default 25，又显式写 Vehicle:25
const fire = new Damage(25, [t("override_vehicle", 25)]);
console.log(`  火 25/[vehicle:25]                 ${row(fire)}`);
check("  → 载具（显式重复，仍是 25）", fire.against("Vehicle"), 25);
check("  → 步兵", fire.against("Infantry"), 25);
check("  → 采集车（两条命中，同值）", fire.against("Harvester"), 25);

console.log("\n【2】边界");
check("无覆写表 → 任何目标都是 base", new Damage(90).against("Harvester"), 90);
check("空覆写表 → base", new Damage(90, []).against("Vehicle"), 90);

console.log("\n【3】穷举对照：与「照 Lua 原文逐行写成」的参照实现比");

/**
 * 参照实现 —— 直接照 `TuningUtil.lua:46-67` 的结构写，不引用被测代码。
 * `present` = 目标身上有哪些覆写键（`Override` 形式）。
 */
function luaReference(
  base: number,
  overrides: ReadonlyArray<readonly [Override, number]> | null,
  present: ReadonlySet<Override>,
): number {
  if (overrides === null) return base; // damageTable.override == nil -> default
  let actualDamage: number | null = null;
  for (let index = 0; index < overrides.length; index++) {
    const entry = overrides[index]!;
    if (!present.has(entry[0])) continue; // combatant:HasTag(tag)
    const overrideDamage = entry[1];
    if (actualDamage === null || overrideDamage > actualDamage) actualDamage = overrideDamage;
  }
  return actualDamage !== null ? actualDamage : base;
}

/** 目标身上有哪些覆写键 = 该目标的标签去掉 `override_` 前缀 */
const presentOf = (target: Target): Set<Override> => {
  const out = new Set<Override>();
  for (const raw of TARGET_TAGS[target]) out.add(raw);
  return out;
};

console.log("  各目标会命中的覆写键：");
for (const x of TARGETS) {
  console.log(`    ${x.padEnd(10)} ${[...presentOf(x)].join(", ") || "(无)"}`);
}

const ALL: Override[] = ["override_infantry", "override_vehicle", "override_aircraft", "override_structure", "override_harvester"];
const ALL_VALUES = [0, 13, 26, 200, 210, 500, 3000];
let combos = 0;
let mismatch = 0;
const samples: string[] = [];

for (let mask = 0; mask < 32; mask++) {
  const keys: Override[] = ALL.filter((_, i) => (mask & (1 << i)) !== 0);
  for (let vi = 0; vi < ALL_VALUES.length; vi++) {
    const overrides = keys.map((k, i) => [k, ALL_VALUES[(vi + i) % ALL_VALUES.length]!] as [Override, number]);
    const base = ALL_VALUES[(vi + 3) % ALL_VALUES.length]!;
    const d = new Damage(base, overrides);
    for (const x of TARGETS) {
      combos++;
      const want = luaReference(base, overrides, presentOf(x));
      const got = d.against(x);
      if (got !== want) {
        mismatch++;
        if (samples.length < 8) {
          samples.push(
            `      base=${base} ov=[${overrides.map(([k, v]) => `${k}:${v}`).join(",")}] → ${x}: 参照=${want} 实现=${got}`,
          );
        }
      }
    }
  }
}
console.log(`  穷举 ${combos} 组，不一致 ${mismatch}`);
for (const s of samples) console.log(s);
check("  穷举结果与参照实现完全一致", mismatch, 0);

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;
