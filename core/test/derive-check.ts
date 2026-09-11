/** 迁移自检：跑全部单位，对比「时序隐含 DPS」与「已验证的 UnitAttack.dps()」 */
import { readFileSync, globSync } from "node:fs";
import { deriveAttack, trackDps } from "../src/derive.ts";
import { UnitAttack } from "../src/attack.ts";
import { levelFactor } from "../src/levels.ts";
import type { EntityRecord } from "../src/types.ts";

const files = [...globSync("data/unit/*.lua.json"), ...globSync("data/commander/*.lua.json")].sort();
const bad: string[] = [];
const comp: Record<string, number> = {};
const kinds: Record<string, number> = {};
let n = 0;
for (const f of files) {
  const rec = JSON.parse(readFileSync(f, "utf8")) as EntityRecord;
  const d = deriveAttack(rec);
  const old = UnitAttack.of(rec).dps();
  n++;
  comp[d.attack.composition] = (comp[d.attack.composition] ?? 0) + 1;
  for (const t of d.attack.tracks) kinds[t.timing.kind] = (kinds[t.timing.kind] ?? 0) + 1;
  if (old > 0 && Math.abs(d.dps - old) / old > 0.005) {
    bad.push(`${rec.id.replace(/^unit_|^cmdr_/, "").padEnd(24)} 迁移 ${d.dps.toFixed(1).padStart(8)} vs 原 ${old.toFixed(1).padStart(8)}  comp=${d.attack.composition}  ${JSON.stringify(d.attack.tracks).slice(0, 90)}`);
  }
}
console.log(`共 ${n} 个条目`);
console.log("composition 分布:", comp);
console.log("timing.kind 分布:", kinds);
console.log(`\n=== DPS 不一致: ${bad.length} ===`);
for (const b of bad.slice(0, 24)) console.log("   " + b);

// ── 用游戏内面板观测点验（真正的裁判）──────────────────────
const OBS: Array<[string, number, number, number]> = [
  ["unit_gdi_slingshot", 8, 0, 508.5], ["unit_gdi_wolverine", 4, 0, 274.2],
  ["unit_nod_confessor", 3, 0, 330.8], ["unit_nod_chemicalwarrior", 5, 0, 152.8],
  ["unit_nod_flametank", 5, 0, 967.8], ["unit_nod_scarab", 5, 0, 1018.7],
  ["unit_nod_beamcannon", 9, 0, 1118.6], ["unit_nod_basilisk", 3, 0, 771.8],
  ["unit_nod_widowmaker", 1, 0, 280], ["unit_gdi_sandstorm", 5, 0, 573],
  ["unit_nod_catalystgunship", 3, 0, 186], ["unit_gdi_kodiak", 3, 0, 551.3],
  ["unit_gdi_juggernaut", 5, 0, 611.2], ["unit_gdi_orcabomber", 5, 0, 2037.4],
  ["unit_nod_avatar", 5, 0, 815],
];
console.log("\n=== 迁移结果 vs 游戏内面板观测点 ===");
let ok = 0;
for (const [id, ma, mi, panel] of OBS) {
  const rec = JSON.parse(readFileSync(`data/unit/${id}.lua.json`, "utf8")) as EntityRecord;
  const d = deriveAttack(rec);
  const expect = panel / levelFactor(ma, mi);
  const good = Math.abs(d.dps - expect) / expect < 0.005;
  if (good) ok++;
  console.log(`   ${(rec.name_zh ?? id).slice(0, 9).padEnd(11)} 迁移 ${d.dps.toFixed(1).padStart(8)}  面板 ${expect.toFixed(1).padStart(8)}  ${good ? "✅" : "❌"}  ${d.attack.composition}`);
}
console.log(`\n迁移结果命中面板观测点 ${ok}/${OBS.length}`);