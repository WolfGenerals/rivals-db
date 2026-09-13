/**
 * **两个步枪兵小队站桩对打** —— 端到端跑一遍，并**导出全行为系列**。
 *
 * ⚠️ 这份脚本**不再自己写循环**：驱动是 `core/src/model/duel.ts` 的 {@link Duel}
 * （部署 → 武器 → 落地结算 → 格子效果 → 死亡 → 时钟），伤害走 `damage.ts`
 * （四步流水线 + 三条交付路径）。这里只负责：拿 def、跑、导出。
 *
 * 数据**不是手写常量**：从 `data/units.def.gen.json` 取机器转出来的 `unit_gdi_riflemen`
 * （伤害 38 / 覆写 `Vehicle 15` / 周期 1.72s / 队员错位 344ms / 每员 130 血 / 5 人一队）。
 *
 * 跑法：`node --experimental-strip-types core/test/battle-riflemen.ts`
 * 产出：`data/battle-riflemen.json`（全行为系列）
 *
 * ## 关键规则：**开火 → 命中 有延迟**
 *
 * 伤害不在开火那一帧落地（占位 1 tick，见 `Duel` 的 `DEFAULT_FLIGHT_MS`）。
 * 于是"我已经被打死了"**拦不住**"我那一发已经打出去了" ⇒ 两队**同归于尽**
 * （用户给的游戏内事实；也是镜像对局不该分出胜负的判据）。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { level } from "../src/levels.ts";
import { decodeDef } from "../src/model/def-json.ts";
import type { UnitDefJson } from "../src/model/def-json.ts";
import { DEFAULT_FLIGHT_MS, Duel } from "../src/model/duel.ts";
import type { DuelEvent } from "../src/model/duel.ts";
import { deliveryOf } from "../src/model/damage.ts";
import type { UnitDef } from "../src/model/unit-def.ts";

const UNIT_ID = "unit_gdi_riflemen";
const STEP_MS = 1;
const LIMIT_MS = 60_000;

const file = JSON.parse(readFileSync("data/units.def.gen.json", "utf8")) as { units: Record<string, UnitDefJson> };
const json = file.units[UNIT_ID];
if (json === undefined) throw new Error(`产物里没有 ${UNIT_ID}（先跑 rivals convert-defs）`);
const def: UnitDef = decodeDef(json);
const weapon = def.combatant.weapons[0]!;
// 本地化名在**最终产物**的记录里（`data/units.def.json` 的 `locale`）
const records = JSON.parse(readFileSync("data/units.def.json", "utf8")) as {
  units: Record<string, { locale?: { name_zh?: string } }>;
};
const nameZh = records.units[UNIT_ID]?.locale?.name_zh ?? def.name;

const lv = level(1, 0);
const t0 = Date.now();
const duel = new Duel(def, def, { level: lv });
while (duel.elapsedMs < LIMIT_MS && duel.alive("A") && duel.alive("B")) duel.tick(STEP_MS);

const hits = duel.events.filter((e): e is Extract<DuelEvent, { kind: "hit" }> => e.kind === "hit");
const fired = duel.events.filter((e) => e.kind === "fired");
const deaths = duel.events.filter((e) => e.kind === "unit_dead");
const totalDamage = hits.reduce((n, e) => n + e.damage, 0);
const outcome = duel.alive("A") && duel.alive("B") ? "超时未分胜负" : duel.alive("A") ? "A 胜" : duel.alive("B") ? "B 胜" : "同归于尽";

const sideOut = (name: string) => {
  const side = duel.sides.find((s) => s.name === name)!;
  const sq = side.squad;
  return {
    side: name,
    unitId: sq.def.id,
    name_zh: nameZh,
    level: "1-0",
    waveSize: sq.def.squad.waveSize,
    perMemberHp: sq.def.combatant.health,
    maxHp: sq.maxHp,
    hp: sq.hp,
    alive: sq.alive,
    aliveUnits: sq.aliveUnits.length,
  };
};

const out = {
  meta: {
    generatedBy: "core/test/battle-riflemen.ts（驱动：core/src/model/duel.ts）",
    dataset: "data/units.def.gen.json",
    unitId: UNIT_ID,
    unitName: nameZh,
    stepMs: STEP_MS,
    weapon: { id: weapon.id, timing: weapon.timing, damage: weapon.damage, delivery: deliveryOf(weapon), muzzleCount: weapon.usage.muzzleCount },
    squad: { waveSize: def.squad.waveSize, attackSeparationDurationMS: def.squad.attackSeparationDurationMS },
    flight: { ms: DEFAULT_FLIGHT_MS, note: "占位值：只保证伤害不在开火那一帧落地（J45 还没按武器算）" },
    notModelled: duel.notes,
  },
  squads: [sideOut("A"), sideOut("B")],
  /** **全行为系列** —— 事件流 + 每个成员每把武器的状态段/事件/发射时机 */
  behaviorSeries: {
    durationMs: duel.elapsedMs,
    timeline: duel.events,
    units: duel.weaponRecords(),
    tileEffects: duel.tileEffects,
    modifiers: duel.modifiers,
  },
  summary: {
    totalFired: fired.length,
    totalHits: hits.length,
    totalDamage,
    deaths: deaths.length,
    battleEndMs: duel.elapsedMs,
    outcome,
    wallClockMs: Date.now() - t0,
  },
};

writeFileSync("data/battle-riflemen.json", JSON.stringify(out, null, 2), "utf8");

console.log(`${nameZh}（${def.id}）${def.squad.waveSize} 人 ×2 —— 每员 ${def.combatant.health} 血、错位 ${def.squad.attackSeparationDurationMS}ms`);
console.log(`武器 ${weapon.id}：伤害 ${weapon.damage[0]!.main.base}（覆写 ${JSON.stringify(weapon.damage[0]!.main.overrides ?? [])}）、周期 ${weapon.timing.kind === "cyclic" ? weapon.timing.cooldownMs : "?"}ms、交付 ${deliveryOf(weapon)}\n`);

const show = 14;
for (const e of hits.slice(0, show)) {
  console.log(
    `  ${String(e.atMs).padStart(6)}ms 命中  ${e.side}#${e.unitIndex} → ${e.targetSide}#${e.targetIndex}  ${e.damage} 伤害  剩 ${e.hpAfter}${e.killed ? "  ☠ 阵亡" : ""}`,
  );
}
if (hits.length > show) console.log(`  … 还有 ${hits.length - show} 个命中事件，全在 data/battle-riflemen.json`);
console.log(`\n结果：${outcome} @ ${duel.elapsedMs}ms · 开火 ${out.summary.totalFired} 发 / 命中 ${hits.length} 发 / ${totalDamage} 伤害 / ${deaths.length} 次阵亡`);
console.log(`导出：data/battle-riflemen.json（${duel.events.length} 个事件 + ${duel.weaponRecords().length} 条武器序列，耗时 ${out.summary.wallClockMs}ms）`);
