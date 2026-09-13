/**
 * 验证**武器时序图的轴策略**（`web/src/def-timeline.ts`）—— 用户定的两条规矩：
 *
 * 1. **首发前摇要看得见**（`initialChargeUpMs` 只画一次，不在每个周期里重复）；
 * 2. **横轴 = max(2 个周期, 5 秒)** —— 间隔极短的（几十毫秒一跳）要铺满 5 秒才看得清节拍。
 *
 * 跑法：`node --experimental-strip-types core/test/def-timeline-check.ts`
 * （需要先 `rivals convert-defs` + `emit-defs`）
 */

import { readFileSync } from "node:fs";
import { decodeDef } from "../src/model/def-json.ts";
import type { UnitDefJson } from "../src/model/def-json.ts";
import { defTimeline, layoutSegs, unitStateTimeline } from "../../web/src/def-timeline.ts";
import type { UnitDef } from "../src/model/unit-def.ts";
import type { WeaponDef } from "../src/model/weapon-def.ts";

let failed = 0;
let passed = 0;
const check = (label: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 期望 ${JSON.stringify(want)}，得到 ${JSON.stringify(got)}`);
};

const file = JSON.parse(readFileSync("data/units.def.gen.json", "utf8")) as { units: Record<string, UnitDefJson> };
const defOf = (id: string): UnitDef => decodeDef(file.units[id]!);
const weapon = (id: string, weaponId?: string): WeaponDef => {
  const def = defOf(id);
  const w = weaponId === undefined ? def.combatant.weapons[0]! : def.combatant.weapons.find((x: WeaponDef) => x.id === weaponId)!;
  return w;
};

console.log("【1】默认**只画一轮**，但横轴有 **5 秒下限**（短节拍的武器要铺够才看得清）");
{
  const tl = defTimeline(weapon("unit_gdi_riflemen"), { waveSize: 1, separationMs: 0 });
  check("步枪兵：横轴 = 5s 下限（周期 1720 < 5000）", tl.spanMs, 5000);
  check("轴说明写了「1 轮」+「5s 下限」", tl.axisNote.includes("1 轮") && tl.axisNote.includes("5s 下限"), true);
  check("没有首发充能段", tl.initialMs, 0);

  // 弹弓：周期只有 **180ms** ⇒ 没有下限的话整条图就是一根刻度（用户报的）
  const sling = defTimeline(weapon("unit_gdi_slingshot"), { waveSize: 1, separationMs: 0 });
  check("弹弓：横轴也是 5s", sling.spanMs, 5000);
  check("5 秒里画得下 20+ 根刻度", Math.floor(5000 / 180) >= 20, true);
}

console.log("\n【2】催化剂炮艇的毒气武器：**只有这一把需要第二轮**（首发充能 4500ms ≠ 每轮前摇 0）");
{
  const tl = defTimeline(weapon("unit_nod_catalystgunship", "gasWeapon"), { waveSize: 1, separationMs: 0 });
  check("首发充能 = 4500", tl.initialMs, 4500);
  const initial = tl.segs.filter((s) => s.once === true);
  check("有且只有一条一次性段（首发充能）", initial.length, 1);
  check("它标着「首发充能」（**去掉末尾的 0**：4.5s 而不是 4.50s）", initial[0]?.label, "首发充能 4.5s");
  check("横轴 = 充能 4500 + 2 × 6000", tl.spanMs, 4500 + 12000);
  check("轴说明点明「首发那一轮不一样」", tl.axisNote.includes("首发那一轮不一样"), true);
  check("周期仍是 6000（充能没被算进周期）", tl.cycleMs, 6000);
}

console.log("\n【3】间隔极短的（音波坦克 40ms 一跳）：一轮就够，蓄力是**每轮**付的");
{
  const tl = defTimeline(weapon("unit_gdi_disruptor"), { waveSize: 1, separationMs: 0 });
  check("横轴 = 5s 下限（整轮 3800 < 5000）", tl.spanMs, 5000);
  check("蓄力段**没有** `once`（每轮都要重新蓄）", tl.segs.some((s) => s.kind === "charge" && s.once !== true), true);
  check("没有一次性前缀（蓄力在整轮里）", tl.initialMs, 0);
  const ticks = tl.segs.flatMap((s) => s.ticks ?? []);
  check("第一段有 20 跳（40ms 一跳）", ticks.length >= 20, true);
}

console.log("\n【3b】首发前摇只在**与每轮前摇不同**时才单独画（用户定的判据）");
{
  // 毒气武器：首发充能 4500ms / 每轮前摇 0 ⇒ 不一样 ⇒ 要画
  const gas = defTimeline(weapon("unit_nod_catalystgunship", "gasWeapon"), { waveSize: 1, separationMs: 0 });
  check("毒气武器：有首发充能段", gas.segs.some((s) => s.once === true && s.label?.includes("首发充能")), true);
  check("毒气武器：`initialMs` 传到组件了", gas.initialMs, 4500);

  // 造一个"首发前摇 == 每轮前摇"的武器 ⇒ 不该单独画（那条每轮前摇已经表达了第一次）
  const fake: WeaponDef = {
    ...weapon("unit_gdi_riflemen"),
    timing: { kind: "cyclic", cooldownMs: 2000, chargeUpMs: 400, initialChargeUpMs: 400, hits: 1, intervalMs: 0 },
  };
  const same = defTimeline(fake, { waveSize: 1, separationMs: 0 });
  check("一样时不画首发充能段", same.segs.some((s) => s.once === true), false);
  check("一样时 `initialMs` = 0（第一轮不前移）", same.initialMs, 0);
  const samePlaced = layoutSegs(same.segs, { cycleMs: same.cycleMs, initialMs: same.initialMs, spanMs: same.spanMs, memberIndex: 0, separationMs: 0 });
  check("第一发落在 400ms（就是每轮前摇那个位置）", Math.round((Number(samePlaced.find((s) => s.kind === "fire")!.tickPct[0]!.replace("%", "")) / 100) * same.spanMs), 400);
}

console.log("\n【4】弹夹武器（MLRS 5s）：也是一轮；装填条**改名叫「剩余装填」**（量的是剩余那段）");
{
  const tl = defTimeline(weapon("unit_gdi_mlrs"), { waveSize: 1, separationMs: 0 });
  check("横轴 = 1 × 5000", tl.spanMs, 5000);
  check("轴说明写了 1 轮", tl.axisNote.includes("1 轮"), true);
  // 用户：「'装填单位不应该显示装填条, 比如 MLRS 应该写剩余装填 4.25s' —— 我让你显示的那个条改名剩余装填」
  const reload = tl.segs.filter((s) => s.kind === "reload");
  check("有且只有一条装填条", reload.length, 1);
  check("它就是「剩余装填 4.25s」（5000 − 前摇 250 − 两发间隔 500）", reload[0]?.label, "剩余装填 4.25s");
  check("宽度 = 剩余那段 4250ms（不是整段 5000）", reload[0]?.ms, 4250);
  check("它落在最后一发之后（250 + 500 = 750ms）", reload[0]?.at, 750);
  check("三发落在 250 / 500 / 750", tl.segs.find((s) => s.kind === "fire")?.ticks, [250, 500, 750]);
  check("前摇 + 连打 + 剩余装填 = 一整轮", 250 + 500 + 4250, 5000);

  /*
   * ⚠️ **拿"前摇 ≠ 夹内间隔"的武器再钉一遍**（虎鲸轰炸机：弹夹 6 / 间隔 500 / 前摇 1750 / 装填 12000）。
   *
   * MLRS 那两个数**恰好都等于 250**，所以 `(容量−1)×间隔` 与 `容量×间隔` 在那里算出同一个数
   * —— 只有换一把才分得出对错（用户曾经照着一个写成 `容量×间隔` 的注释质疑过这条）。
   * 正确值 = 12000 − 1750 − 5×500 = **7750**；错法分别给 9000（用容量）与 9500（漏前摇）。
   */
  const orca = defTimeline(weapon("unit_gdi_orcabomber", "bomb"), { waveSize: 1, separationMs: 0 });
  const orcaReload = orca.segs.find((s) => s.kind === "reload");
  check("虎鲸轰炸机：剩余装填 = 12000 − 1750 − 5×500 = 7.75s", orcaReload?.label, "剩余装填 7.75s");
  check("宽度 7750（用「容量×间隔」会给 9000、漏前摇会给 9500）", orcaReload?.ms, 7750);
  check("它落在最后一发之后（1750 + 2500 = 4250ms）", orcaReload?.at, 4250);
  check("前摇 + 连打（5 个间隔）+ 剩余装填 = 一整轮", 1750 + 2500 + 7750, 12_000);
}

console.log("\n【5】武器条**不再画部署**（部署是单位级动作，搬到单位状态条上；J81 + 用户提的「自身条 + 每武器一条」）");
{
  const tl = defTimeline(weapon("unit_gdi_mlrs"), { waveSize: 3, separationMs: 1000 });
  check("武器条里没有部署段", tl.segs.some((s) => s.kind === "deploy"), false);
  check("横轴 = 一轮 5000 + 错开 2000（不含部署）", tl.spanMs, 7000);
  check("轴说明仍写人数", tl.axisNote.includes("3 人"), true);
  // 部署在**单位状态条**上（一条，全队同时）
  const unit = unitStateTimeline(defOf("unit_gdi_mlrs"));
  check("单位条：一条部署段", unit.segs.filter((s) => s.kind === "deploy").map((s) => s.label), ["部署 2s", "撤收 0.5s"]);
  check("部署段是 `scope: squad`（全队同时）", unit.segs[0]?.scope, "squad");
  check("单位条横轴 = 部署 + 撤收", unit.spanMs, 2500);
}

console.log("\n【6】**位置**：两个条各自的图都不该「把开火画进部署」（用户报过这个 bug）");
{
  // 部署在**单位状态条**上
  const unit = unitStateTimeline(defOf("unit_gdi_mlrs"));
  const unitPlaced = layoutSegs(unit.segs, {
    cycleMs: unit.spanMs,
    initialMs: 0,
    spanMs: unit.spanMs,
    memberIndex: 0,
    separationMs: 0,
  });
  const msOfUnit = (p: string): number => Math.round((Number(p.replace("%", "")) / 100) * unit.spanMs);
  const deploy = unitPlaced.find((s) => s.kind === "deploy");
  check("单位条：部署在 [0, 2000)", [msOfUnit(deploy!.left), msOfUnit(deploy!.left) + 2000], [0, 2000]);
  check("单位条上**没有开火刻度**（它只管部署）", unitPlaced.some((s) => s.kind === "fire"), false);

  // 武器条：横轴从武器自己的相位开始（部署不在这里，所以不再有"开火落进部署条"的问题）
  const tl = defTimeline(weapon("unit_gdi_mlrs"), { waveSize: 1, separationMs: 0 });
  const placed = layoutSegs(tl.segs, {
    cycleMs: tl.cycleMs,
    initialMs: tl.initialMs,
    spanMs: tl.spanMs,
    memberIndex: 0,
    separationMs: 0,
  });
  const msOf = (p: string): number => (Number(p.replace("%", "")) / 100) * tl.spanMs;
  const firstFire = placed.find((s) => s.kind === "fire");
  check("武器条：第一发在 250ms（一夹第一发之前的前摇）", Math.round(msOf(firstFire!.tickPct[0]!)), 250);
  check("武器条：没有部署段", placed.some((s) => s.kind === "deploy"), false);
  check("武器条：默认只画一轮 ⇒ 一个开火段", placed.filter((s) => s.kind === "fire").length, 1);
}

console.log("\n【7】自杀式武器：**不画冷却、不画第二轮**（圣甲虫：打完这一发就自爆）");
{
  const tl = defTimeline(weapon("unit_nod_scarab"), { waveSize: 1, separationMs: 0 });
  check("轴说明写明自杀式（打完就自爆）", tl.axisNote.includes("打完这一发就自爆"), true);
  const placed = layoutSegs(tl.segs, { cycleMs: tl.cycleMs, initialMs: tl.initialMs, spanMs: tl.spanMs, memberIndex: 0, separationMs: 0 });
  check("只有 1 个开火段（没有第二轮）", placed.filter((s) => s.kind === "fire").length, 1);
  // 用户：「圣甲虫死了还要开火」—— 武器级那个 `cooldown = 5s` 在它身上没意义，不许画冷却
  check("**没有冷却段**", placed.filter((s) => s.kind === "gap").length, 0);
  check("有一条「自爆」标注（`death`）", placed.filter((s) => s.kind === "death").map((s) => s.label), ["自爆"]);
  // 横轴 = 前摇 100ms + 给标注留的尾巴（远小于 5s，不再是一整轮）
  check("横轴很短（≈ 前摇 + 尾巴，不是 5s 一轮）", tl.spanMs < 1000, true);
  check("自爆时刻 = 前摇结束时（100ms）", tl.segs.find((s) => s.kind === "death")?.at, 100);
}

console.log("\n【8】部署搬到**单位状态条**：全队同时（受错开影响）而武器条里**一根部署条都不许有**");
{
  // 圣甲虫：waveSize 2 + `attackSeparationDurationMS = 2000` ⇒ 两个队员的武器相位差 2s，
  // 但**部署是全队同时**（用户：「部署不是同期（游戏里是同期）」「部署条依旧没有上下对齐」）
  const u = unitStateTimeline(defOf("unit_nod_scarab"));
  const deploy = u.segs.find((s) => s.kind === "deploy");
  check("单位条上部署从 0 开始、长 2000（圣甲虫 unpack）", [deploy?.at, deploy?.ms], [0, 2000]);
  check("部署段标了 `scope: squad`（全队一条，不按队员错开）", deploy?.scope, "squad");
  check("部署条只有这一条（撤收瞬时是 0 宽）", u.segs.length, 2);
  check("单位条横轴 = 部署 + 撤收（2000 + 0）", u.spanMs, 2000);

  // 武器条：错开量仍然各打各的（队员 1 比队员 0 晚 2000ms 开火），而且**不再画部署**
  const tl = defTimeline(weapon("unit_nod_scarab"), { waveSize: 2, separationMs: 2000 });
  const msOf = (left: string): number => Math.round((Number(left.replace("%", "")) / 100) * tl.spanMs);
  const row = (i: number) =>
    layoutSegs(tl.segs, { cycleMs: tl.cycleMs, initialMs: tl.initialMs, spanMs: tl.spanMs, memberIndex: i, separationMs: 2000 });
  check("武器条里没有部署段", tl.segs.some((s) => s.kind === "deploy"), false);
  check(
    "开火相位仍相差一个错开量（2000ms）",
    msOf(row(1).find((s) => s.kind === "fire")!.tickPct[0]!) - msOf(row(0).find((s) => s.kind === "fire")!.tickPct[0]!),
    2000,
  );
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;
