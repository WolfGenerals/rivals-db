/**
 * 验证一个假设：**所有开火方式都是同一个公式**
 *
 *     dps = damage × hits × waveSize / interval_s
 *
 * 只是 (damage, hits, interval) 的来源不同。
 *
 * 跑法：`node --experimental-strip-types core/test/one-formula.ts`
 */

import { readFileSync } from "node:fs";

import { UnitAttack } from "../src/attack.ts";
import { effectiveDamage, type EntityRecord } from "../src/types.ts";
import { levelFactor } from "../src/levels.ts";

/** (damage, hits, interval_ms) 三元组 —— 刻意不调 `dps()`，独立算一遍 */
function triple(rec: EntityRecord, i: number): { damage: number; hits: number; interval: number; from: string } {
  const cfg = rec.config;
  const ws = (cfg.combatantTuning?.weaponTunings ?? []) as never[];
  const w = (ws[i] ?? {}) as unknown as {
    modifier_sequence?: { tuning?: Record<string, unknown> };
    burstTiming?: { cooldown?: number; numToBurst?: number };
    muzzleCount?: number;
    muzzleStrategy?: string;
    modifier_spawn?: { tuning?: { burstTuning?: { shotCooldownMs?: number } } };
  };
  const t = (w.modifier_sequence?.tuning ?? {}) as Record<string, never>;
  const damage = effectiveDamage(w as never)?.default ?? 0;
  const bt = w.burstTiming ?? {};
  const seq = Boolean(w.modifier_sequence);
  const ms = rec.visual ?? {};
  const seqName = (w.modifier_sequence as { name?: string } | undefined)?.name;
  const muzzles = seqName ? (ms[seqName]?.muzzleInfo?.length ?? 1) : 1;

  // ① 常规武器（无序列）：burntTiming 驱动；All 时每口一发
  if (!seq) {
    const spawn = w.modifier_spawn?.tuning?.burstTuning?.shotCooldownMs;
    if (spawn) return { damage, hits: 1, interval: spawn, from: "modifier_spawn.shotCooldownMs" };
    return {
      damage,
      hits: (bt.numToBurst ?? 1) * (w.muzzleStrategy === "All" ? (w.muzzleCount ?? 1) : 1),
      interval: (bt.cooldown ?? 0) * 1000,
      from: "burstTiming.cooldown",
    };
  }

  // ② 序列武器：末段量（stage3 → stage1）优先，其次扁平 damageMain/damage
  const last = (["stage3", "stage2", "stage1"] as const).find((s) => t[s]);
  const dm = last ? (t[last] as unknown as { damageMain?: { default?: number }; tickPeriodMs?: number }) : undefined;
  const dmg = dm?.damageMain?.default ?? (t["damageMain"] as { default?: number } | undefined)?.default ?? damage;

  if (dm?.tickPeriodMs) return { damage: dmg, hits: 1, interval: dm.tickPeriodMs, from: `${last}.tickPeriodMs` };
  if (t["tickPeriodMs"]) return { damage: dmg, hits: 1, interval: t["tickPeriodMs"] as unknown as number, from: "tickPeriodMs" };
  if (t["perTargetCount"]) {
    // ⚠️ wasmoon 把 {[1],[2],[3]} 这种纯整数键的表转成 **JS 数组**，
    // 用 ["1"] 取会拿到第 2 个元素（沙暴曾因此算成 hits=24）
    const raw = t["perTargetCount"] as unknown;
    const first = Array.isArray(raw)
      ? (raw[0] as { missileCount?: number })
      : (raw as Record<string, { missileCount?: number }>)["1"];
    return {
      damage: dmg,
      hits: first?.missileCount ?? 1,
      interval: t["burstCooldown"] as unknown as number,
      from: "perTargetCount[1].missileCount",
    };
  }
  if (t["durationBetweenVolley"]) {
    return { damage: dmg, hits: muzzles, interval: t["durationBetweenVolley"] as unknown as number, from: "durationBetweenVolley" };
  }
  if (t["catalystBurst"]) {
    const cd = (t["catalystBurst"] as { cooldown?: number }).cooldown ?? 0;
    return { damage: dmg, hits: 1, interval: cd, from: "catalystBurst.cooldown" };
  }
  if (t["burstCooldown"]) {
    return { damage: dmg, hits: 1, interval: t["burstCooldown"] as unknown as number, from: "burstCooldown" };
  }
  return { damage: dmg, hits: 1, interval: (bt.cooldown ?? 0) * 1000, from: "burstTiming.cooldown(兜底)" };
}

/** 与 attack-verify 同一批观测点 */
const OBS: Array<[string, number, number, number]> = [
  ["unit_gdi_slingshot", 8, 0, 508.5],
  ["unit_gdi_wolverine", 4, 0, 274.2],
  ["unit_nod_confessor", 3, 0, 330.8],
  ["unit_nod_chemicalwarrior", 5, 0, 152.8],
  ["unit_nod_flametank", 5, 0, 967.8],
  ["unit_nod_scarab", 5, 0, 1018.7],
  ["unit_nod_beamcannon", 9, 0, 1118.6],
  ["unit_nod_basilisk", 3, 0, 771.8],
  ["unit_nod_widowmaker", 1, 0, 280],
  ["unit_gdi_sandstorm", 5, 0, 573],
  ["unit_nod_catalystgunship", 3, 0, 186],
  ["unit_gdi_kodiak", 3, 0, 551.3],
  ["unit_gdi_juggernaut", 5, 0, 611.2],
  ["unit_gdi_orcabomber", 5, 0, 2037.4],
  ["unit_nod_avatar", 5, 0, 815],
];

console.log(
  "单位".padEnd(22) + "武器".padEnd(16) + "伤害".padStart(6) + "击打".padStart(5) + "间隔ms".padStart(8) +
  "wave".padStart(5) + "算式DPS".padStart(10) + "面板DPS".padStart(10) + "  来源",
);
let pass = 0;
for (const [id, major, minor, panel] of OBS) {
  const rec = JSON.parse(readFileSync(`data/unit/${id}.lua.json`, "utf8")) as EntityRecord;
  const atk = UnitAttack.of(rec);
  const i = atk.primaryIndex;
  const wave = rec.config.squadTuning?.waveSize ?? 1;
  const { damage, hits, interval, from } = triple(rec, i);
  const dps1 = (damage * hits * wave) / (interval / 1000);
  const expect = panel / levelFactor(major, minor);
  const ok = Math.abs(dps1 - expect) / expect < 0.005;
  if (ok) pass++;
  const wname = ((rec.config.combatantTuning?.weaponTunings ?? []) as Array<{ name?: string }>)[i]?.name ?? "?";
  console.log(
    (rec.name_zh ?? id).slice(0, 10).padEnd(22) + wname.padEnd(16) +
    String(damage).padStart(6) + String(hits).padStart(5) + String(interval).padStart(8) +
    String(wave).padStart(5) + dps1.toFixed(1).padStart(10) + expect.toFixed(1).padStart(10) +
    (ok ? "  ✅ " : "  ❌ ") + from,
  );
}
console.log(`\n同一公式命中 ${pass}/${OBS.length}`);
