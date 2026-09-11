/**
 * 用游戏内面板观测点验证 `AttackType` 的 DPS 公式。
 *
 * 观测值来自用户，记录在 `docs/attack-mechanics.md` 第 3 节。
 * 「史诗未解锁」= 起始 5-0，「稀有未解锁」= 3-0。
 *
 * 跑法：`node --experimental-strip-types core/test/attack-verify.ts`
 */

import { readFileSync } from "node:fs";

import { UnitAttack } from "../src/attack.ts";
import { levelFactor } from "../src/levels.ts";
import type { EntityRecord } from "../src/types.ts";

interface Obs {
  id: string;
  major: number;
  minor: number;
  panel: number;
  note?: string;
}

const OBS: Obs[] = [
  { id: "unit_gdi_slingshot", major: 8, minor: 0, panel: 508.5 },
  { id: "unit_gdi_wolverine", major: 4, minor: 0, panel: 274.2 },
  { id: "unit_nod_confessor", major: 3, minor: 0, panel: 330.8 },
  { id: "unit_nod_chemicalwarrior", major: 5, minor: 0, panel: 152.8 },
  { id: "unit_nod_flametank", major: 5, minor: 0, panel: 967.8 },
  { id: "unit_nod_scarab", major: 5, minor: 0, panel: 1018.7 },
  { id: "unit_nod_beamcannon", major: 9, minor: 0, panel: 1118.6 },
  { id: "unit_nod_basilisk", major: 3, minor: 0, panel: 771.8 },
  { id: "unit_nod_widowmaker", major: 1, minor: 0, panel: 280 },
  { id: "unit_gdi_sandstorm", major: 5, minor: 0, panel: 573 },
  { id: "unit_nod_catalystgunship", major: 3, minor: 0, panel: 186 },
  { id: "unit_gdi_kodiak", major: 3, minor: 0, panel: 551.3 },
  { id: "unit_gdi_juggernaut", major: 5, minor: 0, panel: 611.2 },
  { id: "unit_gdi_orcabomber", major: 5, minor: 0, panel: 2037.4 },
  { id: "unit_nod_avatar", major: 5, minor: 0, panel: 815.0 },
];

function load(id: string): EntityRecord {
  return JSON.parse(readFileSync(`data/unit/${id}.lua.json`, "utf8")) as EntityRecord;
}

let pass = 0;
const fails: string[] = [];

/*
 * 判定标准：**严格相等** —— `UnitAttack.dps()` 必须等于面板值 ÷ F(major,minor)。
 *
 * 早先这里是宽松的「面板值命中任意一把武器的 DPS 即可」，结果掩盖了一个真 bug：
 * 寡妇制造者面板是 280（喷火器），而当时的 `dps()` 取 max 得 320。
 * 改成严格相等后立刻暴露（见 findings I103）。
 */
console.log(
  "单位".padEnd(22) + "等级".padEnd(7) + "面板".padStart(9) + "反推基准".padStart(11) + "  各武器 DPS（基准）",
);
for (const o of OBS) {
  const rec = load(o.id);
  const atk = UnitAttack.of(rec);
  const expected = o.panel / levelFactor(o.major, o.minor);
  const all = atk.weapons.map((w) => ({ label: w.label, dps: w.dps() }));
  // 严格：单位级 DPS 必须**等于**面板值（不再容忍「命中任意一把武器」）
  const got = atk.dps();
  const hit = Math.abs(got - expected) / expected < 0.005 ? { dps: got } : undefined;
  const ok = hit !== undefined;
  if (ok) pass++;
  else fails.push(o.id);
  const name = (rec.name_zh ?? o.id).slice(0, 10);
  const detail = `单位 ${got.toFixed(1)} ← ` + all.map((w) => `${w.label} ${w.dps.toFixed(0)}`).join(" / ");
  console.log(
    name.padEnd(22) +
      `${o.major}-${o.minor}`.padEnd(7) +
      o.panel.toFixed(1).padStart(9) +
      expected.toFixed(2).padStart(11) +
      (ok ? "  ✅  " : "  ❌  ") +
      detail,
  );
}

console.log(`\n通过 ${pass}/${OBS.length}（断言 UnitAttack.dps() ≈ 面板值 ÷ F(major,minor)，严格相等）`);
if (fails.length) console.log("未通过：" + fails.join(", "));
