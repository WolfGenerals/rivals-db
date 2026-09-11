/**
 * 产物自检 —— **校验实际出货的 `data/units.json`**，不是内存里的中间结果。
 *
 * 跑法：`node --experimental-strip-types core/test/data-check.ts`
 *
 * 两项：
 *  ① 用游戏内面板观测点验 `derived.dps`（15 个点，来自 docs/attack-mechanics.md §3）
 *  ② 体检：列出可疑项（DPS 缺失、认不出的组合、索敌未知…）
 */

import { readFileSync } from "node:fs";

import type { Dataset, DatasetEntry } from "../src/derive.ts";
import { levelFactor } from "../src/levels.ts";

const ds = JSON.parse(readFileSync("data/units.json", "utf8")) as Dataset;
const entries: DatasetEntry[] = [...ds.units, ...ds.commanders];
const byId = new Map(entries.map((e) => [e.id, e]));

console.log(`产物: ${ds.units.length} 单位 + ${ds.commanders.length} 指挥官`);

// ── ① 面板观测点 ────────────────────────────────────────────────
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

console.log("\n=== 产物 derived.dps vs 游戏内面板观测点 ===");
let ok = 0;
const miss: string[] = [];
for (const [id, ma, mi, panel] of OBS) {
  const e = byId.get(id);
  const got = e?.derived.dps ?? null;
  const want = panel / levelFactor(ma, mi);
  const good = got !== null && Math.abs(got - want) / want < 0.005;
  if (good) ok++;
  else miss.push(id.replace(/^unit_/, ""));
  console.log(
    `   ${(e?.name_zh ?? id).slice(0, 9).padEnd(11)} ${String(got?.toFixed(1) ?? "—").padStart(8)}` +
      `  面板 ${want.toFixed(1).padStart(8)}  ${good ? "✅" : "❌"}  ${e?.derived.attack.composition ?? "-"}`,
  );
}
console.log(`\n命中 ${ok}/${OBS.length}${miss.length ? `　未中：${miss.join(", ")}` : ""}`);

// ── ② 体检 ──────────────────────────────────────────────────────
const comp: Record<string, number> = {};
const kind: Record<string, number> = {};
const noDps: string[] = [];
const unknownTargeting: string[] = [];
const noWeapons: string[] = [];
for (const e of entries) {
  comp[e.derived.attack.composition] = (comp[e.derived.attack.composition] ?? 0) + 1;
  for (const t of e.derived.attack.tracks) kind[t.timing.kind] = (kind[t.timing.kind] ?? 0) + 1;
  if (e.derived.weapons.length === 0) {
    noWeapons.push(e.id.replace(/^unit_|^cmdr_/, ""));
  } else if (!e.derived.dps) {
    noDps.push(e.id.replace(/^unit_|^cmdr_/, ""));
  }
  if (e.derived.weapons.some((w) => w.targeting_unknown)) {
    unknownTargeting.push(e.id.replace(/^unit_|^cmdr_/, ""));
  }
}
console.log("\n=== 体检 ===");
console.log("  composition:", comp);
console.log("  timing.kind:", kind);
console.log(`  无武器（正常：采集车/建筑/支持）: ${noWeapons.length}　${noWeapons.join(", ")}`);
console.log(`  有武器但 DPS 为 0/缺失: ${noDps.length}　${noDps.join(", ")}`);
console.log(`  含索敌未知的武器: ${unknownTargeting.length}　${unknownTargeting.join(", ")}`);
