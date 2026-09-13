/**
 * 验证 `Unit` / `Squad` 的血量语义与三种伤害方式。
 *
 * 用**合成定义**（不拉真实产物）—— 这里测的是血量/等级的算术与三种打击方式，
 * 与哪个单位无关。数字取自源码：步枪兵 `health = 130`、`waveSize = 5`、`tieriumCost = 10`。
 *
 * 三种方式对应 `DamageUtil.lua`：
 *   `squad:TakeAOEDamage`                              → 整队**每人各一份**
 *   `combatant:GetSquad():TakeDirectDamage(combatant)`  → 只打**某一员**
 *   `squad:GetLastCombatant():TakeRedirectDamage`       → 只掉**最后一员**
 *
 * 跑法：`node --experimental-strip-types core/test/unit-instance-check.ts`
 */

import { level } from "../src/levels.ts";
import { Damage, Tile, TileEffect } from "../src/model/unit-def.ts";
import type { UnitDef } from "../src/model/unit-def.ts";
import { spawn } from "../src/model/unit-instance.ts";

/** 合成一个"步枪兵"：130 血 × 5 人 */
const RIFLEMEN = {
  id: "test_riflemen",
  name: "test_riflemen",
  combatant: { health: 130, waveSize: undefined },
  squad: { waveSize: 5 },
} as unknown as UnitDef;

let failed = 0;
let passed = 0;
const check = (label: string, got: unknown, want: unknown): void => {
  const ok = got === want;
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 期望 ${want}，得到 ${got}`);
};

console.log("【1】按等级拉起小队（1-0 级，倍率 = 1）");
{
  const sq = spawn(RIFLEMEN, level(1, 0));
  check("成员数 = waveSize", sq.size, 5);
  check("每员满血 = 130", sq.units[0]!.maxHp, 130);
  check("小队满血 = 130 × 5 = 650", sq.maxHp, 650);
  check("初始总血 = 满血", sq.hp, 650);
  check("活着", sq.alive, true);
}

console.log("\n【2】整队每人各吃一份（`TakeAOEDamage`）");
{
  const sq = spawn(RIFLEMEN, level(1, 0));
  sq.hurtEach(50); // 每人吃 50，不是总共 50
  check("每员掉 50 → 80", sq.units[0]!.hp, 80);
  check("5 人共掉 250 → 总血 400", sq.hp, 400);
}

console.log("\n【3】只掉一员（`TakeRedirectDamage`）");
{
  const sq = spawn(RIFLEMEN, level(1, 0));
  sq.hurtLast(500); // 只打最后活着的那一员，超杀不回血
  check("最后一员被秒", sq.units[4]!.hp, 0);
  check("其余四员满血", sq.units[0]!.hp, 130);
  check("总血 = 520", sq.hp, 520);
  sq.hurtLast(200);
  check("再打一次 → 打的是倒数第二个活着的人", sq.units[3]!.hp, 0);
}

console.log("\n【4】只打某一员（`TakeDirectDamage`）");
{
  const sq = spawn(RIFLEMEN, level(1, 0));
  sq.hurtOne(sq.units[2]!, 70);
  check("指定那一员掉 70 → 60", sq.units[2]!.hp, 60);
  check("其余四员满血", sq.units[0]!.hp, 130);
  check("总血 = 650 − 70 = 580", sq.hp, 580);
}

console.log("\n【5】等级倍率（HP 走 `floor`）");
{
  // F(5,0) = 1.05^3 × 1.10^1 = 1.157625 × 1.1 = 1.2733875 ；130 × = 165.54… → floor 165
  const sq5 = spawn(RIFLEMEN, level(5, 0));
  check("5-0 级每员血 = floor(130 × 1.2733875) = 165", sq5.units[0]!.maxHp, 165);
  // ⚠️ 小队满血是**先乘 waveSize 再套倍率**（`level.hp(130 × 5)`），
  // 所以它不等于「每员血 × 5」：floor(650 × 1.2733875) = 827，而 165 × 5 = 825。
  // 两者差 2，是**先乘后取整 vs 先取整后乘**，源码走的也是先乘后取整那条。
  check("5-0 级小队满血 = floor(650 × 1.2733875) = 827", sq5.maxHp, 827);
  check("  与「每员 × 5」不同(825)", sq5.maxHp === sq5.units[0]!.maxHp * 5, false);
  // 11-0：F(11,0) = 1.05^3 × 1.10^7
  const sq11 = spawn(RIFLEMEN, level(11, 0));
  const want11 = Math.floor(130 * 1.05 ** 3 * 1.1 ** 7);
  check(`11-0 级每员血 = ${want11}`, sq11.units[0]!.maxHp, want11);
}

console.log("\n【6】全部阵亡");
{
  const sq = spawn(RIFLEMEN, level(1, 0));
  sq.hurtEach(999);
  check("全员 0 血", sq.hp, 0);
  check("不再活着", sq.alive, false);
  check("存活成员 0", sq.aliveUnits.length, 0);
  // 死人不再吃伤害
  sq.hurtLast(100);
  check("死后 hurtLast 不产生负数", sq.hp, 0);
}

console.log("\n【7】小队持有地块 —— 格子效果按 `damage.against(类型)` 作用到队里");
{
  // 毒气：default 6、Vehicle: 0（载具免疫），每 200ms 跳一次，铺上去持续 10s
  const gas = new TileEffect(new Damage(6, [["override_vehicle", 0]]), 200, 10000, 10000);
  const tile = new Tile(undefined, undefined, gas);

  const inf = spawn(RIFLEMEN, level(1, 0), tile);
  check("小队拿到那块地", inf.tile === tile, true);
  check("毒气对步兵每跳 = 6", tile.gas!.damage.against("Infantry"), 6);
  // 一个 tick 的实际结算：每员吃 6（TakeAOEDamage 语义）
  inf.hurtEach(tile.gas!.damage.against("Infantry"));
  check("整队每人各吃 6 → 总血 650 − 30 = 620", inf.hp, 620);

  // 换成"载具"型目标（带 override_vehicle）→ 免疫
  const vehicleDef = {
    ...RIFLEMEN,
    combatant: { ...RIFLEMEN.combatant, tags: ["Vehicle", "override_vehicle"] },
  } as unknown as UnitDef;
  const veh = spawn(vehicleDef, level(1, 0), tile);
  check("毒气对载具 = 0（免疫）", tile.gas!.damage.against("Vehicle"), 0);
  veh.hurtEach(tile.gas!.damage.against("Vehicle"));
  check("免疫 ⇒ 一点不掉", veh.hp, 650);

  // 泰矿：永久（时长不填），每 200ms 跳 1
  const tib = new TileEffect(new Damage(1, [["override_vehicle", 0]]), 200);
  const tile2 = new Tile(undefined, tib);
  check("泰矿无时长", tile2.tiberium!.durationMs, undefined);
  check("泰矿每跳 1", tib.damage.against("Infantry"), 1);

  // 移动后换格
  const moved = spawn(RIFLEMEN, level(1, 0), tile);
  moved.tile = tile2;
  check("移动后持有新格", moved.tile === tile2, true);
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;
