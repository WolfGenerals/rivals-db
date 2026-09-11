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
 * 判定标准：面板值应当等于**某一把武器**的 DPS，而不是"取最大"。
 *
 * 依据：寡妇制造者面板 280 = 喷火器（火箭是 320），圣灵面板 640 = laser（fire 是 280），
 * 两个方向都有 —— 说明游戏面板**只显示某一把武器**，我们没必要求出是哪一把，
 * 只要**每把武器各自显示自己的 DPS** 即可（见 findings I82）。
 */
console.log(
  "单位".padEnd(22) + "等级".padEnd(7) + "面板".padStart(9) + "反推基准".padStart(11) + "  各武器 DPS（基准）",
);
for (const o of OBS) {
  const rec = load(o.id);
  const atk = UnitAttack.of(rec);
  const expected = o.panel / levelFactor(o.major, o.minor);
  const all = atk.weapons.map((w) => ({ label: w.label, dps: w.dps() }));
  const hit = all.find((w) => w.dps > 0 && Math.abs(w.dps - expected) / expected < 0.005);
  const ok = hit !== undefined;
  if (ok) pass++;
  else fails.push(o.id);
  const name = (rec.name_zh ?? o.id).slice(0, 10);
  const detail = all
    .map((w) => `${w.label} ${w.dps.toFixed(0)}${w === hit ? "←" : ""}`)
    .join(" / ");
  console.log(
    name.padEnd(22) +
      `${o.major}-${o.minor}`.padEnd(7) +
      o.panel.toFixed(1).padStart(9) +
      expected.toFixed(2).padStart(11) +
      (ok ? "  ✅  " : "  ❌  ") +
      detail,
  );
}

console.log(`\n通过 ${pass}/${OBS.length}（面板值命中某一把武器的 DPS 即算通过）`);
if (fails.length) console.log("未通过：" + fails.join(", "));
