/**
 * **1v1 站桩决斗** —— 伤害结算层（`damage.ts`）+ 决斗驱动（`duel.ts`）的验收。
 *
 * 用户定的起点：「我认为可以从 1v1 站桩互打开始做」。
 *
 * 四场：
 * 1. **步枪兵镜像** —— 同归于尽（用户给的游戏内事实：两边最后一发都先出了手）；
 * 2. **强弱分明** —— 强的一侧赢，且弱的一侧先掉人；
 * 3. **弹头副作用** —— 生化越野车的毒气真的铺上去、每跳按"整队每人各一份"扣血、到点过期；
 * 4. **EMP** —— 榴弹兵打上去会记一条带时长的属性修改（攻速/移速…），并且**到点失效**。
 *
 * 跑法：`node --experimental-strip-types core/test/duel-check.ts`
 */

import { readFileSync } from "node:fs";
import { level } from "../src/levels.ts";
import { decodeDef } from "../src/model/def-json.ts";
import type { UnitDefJson } from "../src/model/def-json.ts";
import { Duel, DEFAULT_FLIGHT_MS } from "../src/model/duel.ts";
import { deliveryOf, reachesType, targetTypeOf } from "../src/model/damage.ts";
import type { UnitDef } from "../src/model/unit-def.ts";

let failed = 0;
let passed = 0;
const check = (label: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 期望 ${JSON.stringify(want)}，得到 ${JSON.stringify(got)}`);
};

const file = JSON.parse(readFileSync("data/units.def.gen.json", "utf8")) as { units: Record<string, UnitDefJson> };
const def = (id: string): UnitDef => decodeDef(file.units[id]!);

/** 跑到某一侧全灭（或超时） */
function runToEnd(duel: Duel, limitMs = 60_000, stepMs = 1): void {
  while (duel.elapsedMs < limitMs && duel.alive("A") && duel.alive("B")) duel.tick(stepMs);
}

console.log("【1】交付方式从弹头读（没写就是默认「只打最后一员」，J55/J80）");
{
  check("步枪兵：没写弹头 ⇒ one_member", deliveryOf(def("unit_gdi_riflemen").combatant.weapons[0]!), "one_member");
  check("巨无霸：写了 `squad_each`", deliveryOf(def("unit_gdi_juggernaut").combatant.weapons[0]!), "squad_each");
  check("生化越野车：只有铺毒气 ⇒ 仍回落到 one_member", deliveryOf(def("unit_nod_chemquad").combatant.weapons[0]!), "one_member");
  check("虎鲸轰炸机：per_combatant", deliveryOf(def("unit_gdi_orcabomber").combatant.weapons.find((w) => w.id === "bomb")!), "per_combatant");
  check("目标类型从 `tags` 推：步枪兵 = Infantry", targetTypeOf(def("unit_gdi_riflemen")), "Infantry");
  check("建筑（只有 override_structure）= Structure", targetTypeOf(def("bldg_gdi_conyard")), "Structure");
}

console.log("\n【2】步枪兵镜像：**同归于尽**（伤害不在开火那一帧落地）");
{
  const duel = new Duel(def("unit_gdi_riflemen"), def("unit_gdi_riflemen"), { level: level(1, 0) });
  runToEnd(duel, 60_000);
  const fired = duel.events.filter((e) => e.kind === "fired").length;
  const hits = duel.events.filter((e) => e.kind === "hit");
  const damage = hits.reduce((n, e) => (e.kind === "hit" ? n + e.damage : n), 0);
  console.log(`     时长 ${duel.elapsedMs}ms · 开火 ${fired} 发 · 命中 ${hits.length} 发 · 伤害 ${damage}`);
  check("两边都全灭（同归于尽）", [duel.alive("A"), duel.alive("B")], [false, false]);
  check("开火数 = 命中数（每一发都落地了）", fired, hits.length);
  check("伤害每发 38（打步兵走基础值）", [...new Set(hits.map((e) => (e.kind === "hit" ? e.damage : 0)))], [38]);
  check("飞行延迟用的占位值", DEFAULT_FLIGHT_MS, 1);
  check("阵亡 10 人（5 + 5）", duel.events.filter((e) => e.kind === "unit_dead").length, 10);
  check("两侧各记一条整队阵亡", duel.events.filter((e) => e.kind === "squad_dead").length, 2);
}

console.log("\n【3】强弱分明：手长的打下手的短（射程没建模，但伤害/血量是真的）");
{
  // 万钧巨炮（分段、每跳 45，1-0）对步枪兵（38/1.72s）—— 只比"谁先死"，不比位置
  const duel = new Duel(def("unit_nod_beamcannon"), def("unit_gdi_riflemen"), { level: level(1, 0) });
  runToEnd(duel, 60_000);
  check("万钧巨炮赢", [duel.alive("A"), duel.alive("B")], [true, false]);
  const firstDeath = duel.events.find((e) => e.kind === "unit_dead");
  check("先死的在对面", firstDeath?.kind === "unit_dead" ? firstDeath.side : null, "B");
}

console.log("\n【4】弹头副作用：毒气真的铺上去、每跳整队每人各一份、到点过期");
{
  // 生化越野车：`spawnGasTimeMs = 2100` —— 要连续开打 2.1s 才铺得出
  const duel = new Duel(def("unit_nod_chemquad"), def("unit_gdi_riflemen"), { level: level(1, 0) });
  // 只推到 3s，看"铺"这件事本身（别让它打完）
  while (duel.elapsedMs < 3000 && duel.alive("A") && duel.alive("B")) duel.tick(1);
  const placed = duel.events.filter((e) => e.kind === "tile_placed");
  check("铺上了毒气云", placed.length >= 1, true);
  check("铺的时刻 ≥ 2100ms（连续开打门槛）", placed[0]?.atMs !== undefined && placed[0].atMs >= 2100, true);
  const ticks = duel.events.filter((e) => e.kind === "tile_tick");
  check("开始跳了", ticks.length >= 1, true);
  // ⚠️ 每跳伤害 = **当时活着的成员数 × 6**（不是固定 5 人：对面这会儿已经被打死几个了）
  const first = ticks[0];
  check(
    "每跳 = 当时活着的成员数 × 6（整队每人各一份）",
    first?.kind === "tile_tick" && first.hits > 0 ? first.damage / first.hits : null,
    6,
  );
  check("跳的是对面那一侧", first?.kind === "tile_tick" ? first.side : null, "A");
  check("场上挂着这个效果", duel.tileEffects.some((t) => t.name === "modifier_chem_warrior_gas_cloud"), true);
}

console.log("\n【4b】**0 伤害不记事件**：毒气打在载具上（`Vehicle: 0`）什么都不该留下");
{
  // 生化越野车打捕食者坦克：毒气照样铺得上（`place_modifier` 是真的发生了），但每一跳都是 0 伤害
  const duel = new Duel(def("unit_nod_chemquad"), def("unit_gdi_predatortank"), { level: level(1, 0) });
  while (duel.elapsedMs < 6000 && duel.alive("A") && duel.alive("B")) duel.tick(1);
  check("毒气铺上了", duel.events.some((e) => e.kind === "tile_placed"), true);
  check("**一条每跳事件都没有**（0 伤害不记）", duel.events.filter((e) => e.kind === "tile_tick").length, 0);
  check("直击照样记（打载具走覆写 30）", duel.events.some((e) => e.kind === "hit" && e.damage === 30), true);
}

console.log("\n【4c】**打不到对面的武器：拒绝目标，武器机自己停在 idle**（MLRS vs 催化剂直升机）");
{
  const duel = new Duel(def("unit_gdi_mlrs"), def("unit_nod_catalystgunship"), { level: level(1, 0) });
  runToEnd(duel, 60_000);
  check("MLRS 的 rockets 被记为「打不到」", duel.blockedWeapons.map((b) => [b.side, b.weaponId, b.targetType]), [
    ["A", "rockets", "Aircraft"],
  ]);
  check("MLRS 一发都没开", duel.weaponRecords().filter((r) => r.side === "A").flatMap((r) => r.firedAtMs).length, 0);
  const rockets = duel.weaponRecords().find((r) => r.side === "A" && r.weaponId === "rockets")!;
  check("武器机**自己**记了状态（全是 idle）", [...new Set(rockets.states.map((s) => s.state))], ["idle"]);
  // ⚠️ 从 2000ms 起：MLRS 要先架好（部署是**单位级**门禁，武器机在那之前根本没被驱动）
  check("状态段从**架好那一刻**起（MLRS 部署 2000ms）", rockets.states[0]?.start, 2000);
  check("直升机赢", [duel.alive("A"), duel.alive("B")], [false, true]);
  check("说明里写清了「全程停在 idle」", duel.notes.some((n) => n.includes("全程停在 idle")), true);
}

console.log("\n【4d】格子效果的两条目标门禁：只打地面（空军不吃）/ 免疫名单");
{
  check("MLRS 打不到 Aircraft", reachesType(def("unit_gdi_mlrs").combatant.weapons[0]!, "Aircraft"), "no");
  check("步枪兵打得到 Infantry", reachesType(def("unit_gdi_riflemen").combatant.weapons[0]!, "Infantry"), "yes");

  /*
   * **只打地面**：圣甲虫的 `canAttack` **有 Aircraft**（能直接打直升机），
   * 它铺的火也是 `groundOnly` ⇒ 火照铺在那格上，但**空军站在上面不吃每跳**。
   *
   * ⚠️ 对手要挑一个**打不到圣甲虫**的飞机：锤头鲨的 `rocketLauncher` 只会打
   * `Aircraft + Structure`（**不能打载具**）⇒ 圣甲虫能活到 2100ms 开出那一发
   * （催化剂炮艇现在 1.6s 一发，会在 81ms 就把它打死）。顺带也就验了"打不到"双向成立。
   *
   * ⚠️ 圣甲虫**打完就自爆**（`selfDestruct`），对局 0.1s 就"打完"了 ——
   * 所以这里**不管谁死都继续空推**到 12s：格子效果挂在格子上，只要对面还站着就该跳，
   * 这正是"推到 12s"才验得出来的东西。
   */
  const vsAir = new Duel(def("unit_nod_scarab"), def("unit_gdi_hammerhead"), { level: level(1, 0) });
  while (vsAir.elapsedMs < 12_000) vsAir.tick(1);
  check("火铺在了直升机那格上", vsAir.events.some((e) => e.kind === "tile_placed"), true);
  check("空军站在火上：一条每跳都没有", vsAir.events.filter((e) => e.kind === "tile_tick").length, 0);
  check("但直击是算的（圣甲虫打得到 Aircraft）", vsAir.events.some((e) => e.kind === "hit" && e.damage > 0), true);
  check(
    "反向也成立：锤头鲨打不到载具（那一侧没有 fired 事件）",
    vsAir.events.some((e) => e.kind === "fired" && e.side === "B"),
    false,
  );

  // 对照组：同样的火打在步兵上，每跳是真的（火焰轰炸机 —— 不自爆，能站到火跳完）
  const vsInf = new Duel(def("unit_nod_firebomber"), def("unit_gdi_riflemen"), { level: level(1, 0) });
  while (vsInf.elapsedMs < 12_000) vsInf.tick(1);
  check("对照组（打步兵）：火每跳 > 0", vsInf.events.some((e) => e.kind === "tile_tick" && e.damage > 0), true);

  /*
   * **免疫名单**：化武兵（`Unit_Nod_ChemicalWarrior`）不吃自己的毒气。
   * ⚠️ 名单里是 Lua 类型名，靠"小写 = 我们的 id"对上（见 `Duel.#tickTiles`）。
   */
  const imm = new Duel(def("unit_nod_chemquad"), def("unit_nod_chemicalwarrior"), { level: level(1, 0) });
  while (imm.elapsedMs < 12_000 && imm.alive("A") && imm.alive("B")) imm.tick(1);
  check("毒气铺在了化武兵那格上", imm.events.some((e) => e.kind === "tile_placed"), true);
  check("免疫名单里的兵种不吃每跳", imm.events.filter((e) => e.kind === "tile_tick").length, 0);
  check("直击照样算", imm.events.some((e) => e.kind === "hit" && e.damage > 0), true);
}

console.log("\n【4e】自杀式武器：**打完那一发自己就销毁**（同刻，`cause: self_destruct`）");
{
  // 圣甲虫：`selfDestruct`（`ability_scarab_weapon_sequence.lua:50-51` 的 `TakeHiddenDestroyDamage`）
  const duel = new Duel(def("unit_nod_scarab"), def("unit_gdi_riflemen"), { level: level(1, 0) });
  while (duel.elapsedMs < 20_000 && duel.alive("A") && duel.alive("B")) duel.tick(1);
  const selfDead = duel.events.filter((e) => e.kind === "unit_dead" && e.cause === "self_destruct");
  const aFired = duel.events.filter((e) => e.kind === "fired" && e.side === "A");
  check("有一次自杀式销毁", selfDead.length >= 1, true);
  // ⚠️ 比的是**圣甲虫自己**那一发：步枪兵没有部署，0ms 就开火了
  check("它发生在**自己开火同一毫秒**", selfDead[0]?.atMs === aFired[0]?.atMs, true);
  check("那一发照常落地结算（人没了、弹还在飞）", duel.events.some((e) => e.kind === "hit"), true);
  check("被对面打死的那种标的是 `killed`", duel.events.some((e) => e.kind === "unit_dead" && e.cause === "killed"), true);
  check("`weaponRecords` 把自杀式标出来（界面据此换图标）", duel.weaponRecords().some((r) => r.selfDestruct), true);
}

console.log("\n【5】EMP：打上去会记一条带时长的属性修改，**到点失效**");
{
  // 榴弹兵：EMP 700ms（攻速 −25% / 移速 −30% / 转向 −30% / 装填 −25%）
  const duel = new Duel(def("unit_gdi_grenadier"), def("unit_gdi_riflemen"), { level: level(1, 0) });
  while (duel.elapsedMs < 3000 && duel.alive("A") && duel.alive("B")) duel.tick(1);
  const mods = duel.events.filter((e) => e.kind === "modify");
  check("记了 4 条属性修改", mods.length >= 4, true);
  const first = mods[0];
  check("时长 700ms", first?.kind === "modify" ? first.untilMs - first.atMs : null, 700);
  check("打的是对面", first?.kind === "modify" ? first.targetSide : null, "B");
  const atTime = duel.elapsedMs;
  check("此刻还生效", duel.statsOn("B").length > 0, true);
  /*
   * **到点要失效**：不能边打边查（榴弹兵还在开火、新的 EMP 一直在叠）。
   * 先把这场打完（对面全灭 ⇒ 不再有新的一发），再空推 800ms。
   */
  runToEnd(duel, 60_000);
  const afterFight = duel.elapsedMs;
  while (duel.elapsedMs < afterFight + 800) duel.tick(1);
  check("战斗结束后空推 800ms ⇒ 全部失效", duel.statsOn("B").length, 0);
  check("（记录还在，只是不再生效）", duel.modifiers.length >= 4, true);
  void atTime;
  check("明说节奏还没接 debuff", duel.notes.some((n) => n.includes("节奏未变")), true);
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;
