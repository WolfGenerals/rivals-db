/**
 * 批量体检：把网页会显示的值全算一遍，列出可疑项。
 *
 * **用 core 的真实代码算**（`UnitAttack` / `effectiveDamage` / `canAttackTarget`），
 * 不另写一套逻辑 —— 否则查的不是网页上的东西。
 *
 * 跑法：`node --experimental-strip-types core/test/anomaly-scan.ts`
 */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

import { UnitAttack } from "../src/attack.ts";
import {
  canAttackTarget,
  damageAgainstTarget,
  effectiveDamage,
  targetingUnknown,
  type EntityRecord,
} from "../src/types.ts";

const TYPES = ["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"] as const;
const LABEL: Record<string, string> = {
  Infantry: "步",
  Vehicle: "载",
  Aircraft: "空",
  Structure: "建",
  Harvester: "矿",
};

const files = [
  ...globSync("data/unit/*.lua.json"),
  ...globSync("data/commander/*.lua.json"),
].sort();

interface Row {
  id: string;
  name: string;
  weapons: Array<{
    wname: string;
    label: string;
    dps: number;
    base: number | undefined;
    unknown: boolean;
    dmg: string;
    reach: string;
  }>;
  unitDps: number;
}

const rows: Row[] = [];
for (const f of files) {
  const rec = JSON.parse(readFileSync(f, "utf8")) as EntityRecord;
  const atk = UnitAttack.of(rec);
  const ws = (rec.config.combatantTuning?.weaponTunings ?? []) as never[];
  rows.push({
    id: rec.id,
    name: rec.name_zh ?? rec.id,
    unitDps: atk.dps(),
    weapons: atk.weapons.map((w, i) => {
      const ww = (ws[i] ?? {}) as { name?: string };
      // ⚠️ 必须传 `w.weapon`（`WeaponTuning`），不是 `w`（`WeaponAttack`）——
      // 早先传错了，导致 C 类误报全部 83 把
      const ed = effectiveDamage(w.weapon);
      const reach = TYPES.filter((t) => canAttackTarget(w.weapon, t));
      return {
        wname: ww?.name ?? "?",
        label: w.label,
        dps: w.dps(),
        base: ed?.default,
        unknown: targetingUnknown(w.weapon),
        dmg: TYPES.map((t) => (reach.includes(t) ? `${LABEL[t]}${damageAgainstTarget(w.weapon, t)}` : "")).filter(Boolean).join(" "),
        reach: reach.map((t) => LABEL[t]).join(""),
      };
    }),
  });
}

const A: string[] = []; // 有武器但 DPS 为 0
const B: string[] = []; // 认不出的行为
const C: string[] = []; // 基准为 0
const D: string[] = []; // 能打的目标伤害全为 0
const E: string[] = []; // 索敌未知（空 descriptors）
const F: string[] = []; // 只能打建筑
const G: string[] = []; // 增伤（补正值 > default）
const H: string[] = []; // 序列覆盖了武器级伤害且值不同

for (const r of rows) {
  for (const w of r.weapons) {
    const tag = `${r.name}(${r.id.replace(/^unit_|^cmdr_/, "")}).${w.wname}`;
    if (w.dps === 0) A.push(`${tag}  label=${w.label}`);
    if (w.label === "未知") B.push(`${tag}  基准=${w.base ?? "—"}  可打=${w.reach}`);
    if (w.base === 0 || w.base === undefined) C.push(`${tag}  能打=${w.reach}`);
    if (w.reach && w.dmg.replace(/[步载空建矿]\d+ ?/g, "").length === 0 && /[步载空建矿]0\b/.test(w.dmg + " ")) {
      if (w.reach.split("").length > 0 && w.dmg.split(" ").every((x) => x.endsWith("0"))) D.push(`${tag}  ${w.dmg}`);
    }
    if (w.unknown) E.push(`${tag}  DPS=${w.dps.toFixed(1)}`);
    if (w.reach === "建") F.push(`${tag}  ${w.dmg}`);
  }
}

function block(title: string, items: string[]) {
  console.log(`\n=== ${title}: ${items.length} ===`);
  for (const x of items.slice(0, 30)) console.log("   " + x);
  if (items.length > 30) console.log(`   …还有 ${items.length - 30} 条`);
}

console.log(`共扫描 ${rows.length} 个条目、${rows.reduce((n, r) => n + r.weapons.length, 0)} 把武器`);
block("A. 有武器但 DPS 算成 0", A);
block("B. 认不出的开火行为（UnknownAttack）", B);
block("C. 伤害基准为 0/缺失（百分比会失真）", C);
block("D. 能打的目标伤害全为 0", D);
block("E. 索敌方式未知（descriptors 空表）", E);
block("F. 只能打建筑（其余类型都打不到）", F);
void G;
void H;
