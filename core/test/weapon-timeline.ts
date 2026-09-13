/**
 * **只看武器机能不能"展示"开火** —— 不需要单位、不需要战斗、不需要伤害。
 *
 * 跑法：`node --experimental-strip-types core/test/weapon-timeline.ts`
 * 产出：终端一张 ASCII 时间轴 + `data/weapon-timelines.json`
 *
 * ## 它证明了什么
 *
 * 一台武器机 = **时钟 + 参数**，`update(target)` 只要不是 `null` 就行。跑完之后
 * `states`（有持续）与 `events`（瞬时）就是一张完整的时间轴 —— **wiki 的武器页要的正是这个**，
 * 不需要单位、不需要目标实体、不需要结算伤害。
 *
 * ⚠️ 参数是**从数据里抄的真数**（下面每台都注了出处）。要直接吃 `data/units.json`
 * 得先抽出那个"产物 → 模型"映射器 —— findings J18 定过：那是**提取端**的活。
 */

import { writeFileSync } from "node:fs";
import { ManualClock } from "../src/model/clock.ts";
import { CyclicWeapon } from "../src/model/weapons/cyclic-weapon.ts";
import { MagazineWeapon } from "../src/model/weapons/magazine-weapon.ts";
import { StagedWeapon } from "../src/model/weapons/staged-weapon.ts";
import type { WeaponMachine } from "../src/model/weapons/weapon-machine.ts";

/** 时间轴上的一个桶（给渲染用） */

/** 每台武器：名字 + 出处 + 参数 + 要跑多久 */
interface Case {
  label: string;
  source: string;
  durationMs: number;
  make: (clock: ManualClock) => WeaponMachine;
}

const cases: Case[] = [
  {
    // 步枪兵：`burstTiming = {cooldown = 1.72, chargeUpDuration = 0}`（unit_gdi_riflemen.lua:32-36）
    label: "步枪兵 rifle（循环类）",
    source: "unit_gdi_riflemen.lua:32-36",
    durationMs: 4000,
    make: (clock) => new CyclicWeapon(clock, { kind: "cyclic", cooldownMs: 1720, chargeUpMs: 0, initialChargeUpMs: 0, hits: 1, intervalMs: 0 }),
  },
  {
    // 弹弓（简单序列族）：burstCooldown 1000 / chargeUpDuration 300 / initialChargeUpMs 500
    label: "弹弓（连发族，有前摇与首轮蓄力）",
    source: "unit_gdi_slingshot.lua 的 modifier_sequence.tuning",
    durationMs: 4000,
    make: (clock) => new CyclicWeapon(clock, { kind: "cyclic", cooldownMs: 1000, chargeUpMs: 300, initialChargeUpMs: 500, hits: 1, intervalMs: 0 }),
  },
  {
    // MLRS：reloadTuning {clipSize = 3, reloadTimeMs = 5000} + burstTiming {cooldown = 0.25, chargeUpDuration = 0.25}
    label: "MLRS（弹夹类，打 3 发装填 5s）",
    source: "unit_gdi_mlrs.lua:40-49",
    durationMs: 12000,
    make: (clock) => new MagazineWeapon(clock, { kind: "magazine", clipSize: 3, reloadTimeMs: 5000, gapMs: 250, chargeUpMs: 250 }),
  },
  {
    // 巨无霸：一轮 3 发、间隔 250、周期 2500（产物 derive：hits 3 / interval 250 / cycle 2500）
    label: "巨无霸（多发：一轮 3 发，周期 2500）",
    source: "unit_gdi_juggernaut.lua 的 modifier_sequence.tuning",
    durationMs: 6000,
    make: (clock) => new CyclicWeapon(clock, { kind: "cyclic", cooldownMs: 2500, chargeUpMs: 0, initialChargeUpMs: 0, hits: 3, intervalMs: 250 }),
  },
  {
    // 光束炮：首轮蓄力 500；段1 12 跳、段2 24 跳、段3 无限，均 250ms（J33 逐行核过）
    label: "光束炮（分段：3 段递增，每段 250ms 一跳）",
    source: "unit_nod_beamcannon.lua:50-92",
    durationMs: 12000,
    make: (clock) =>
      new StagedWeapon(clock, {
        kind: "staged",
        initialChargeUpMs: 500,
        storeChargeTimeMs: 700,
        stages: [
          { attackCount: 12, tickPeriodMs: 250 },
          { attackCount: 24, tickPeriodMs: 250 },
          { tickPeriodMs: 250 }, // 末段：`attackCount` 不填 = 无限
        ],
      }),
  },
];

/** 状态 → 一个字符（画时间轴用） */
const STATE_CHAR: Record<string, string> = { init_charging: "I", charging: "+", cooling: "-", idle: ".", wait_reload: "R" };
const EVENT_CHAR: Record<string, string> = { firing: "^", reload: "*", stage: "S" };
const LEGEND = "图例  状态：`I` init_charging · `+` charging · `-` cooling · `.` idle · `R` wait_reload   事件：`^` 开火 · `*` 补满 · `S` 换段";

/** 把一台武器机跑到 `durationMs`（每帧 1ms 喂一个"有目标"） */
function simulate(c: Case): { m: WeaponMachine; clock: ManualClock } {
  const clock = new ManualClock();
  const m = c.make(clock);
  const target = { name: "enemy" }; // 武器机不关心它是谁
  while (clock.nowMs <= c.durationMs) {
    m.update(target);
    clock.tick(1);
  }
  return { m, clock };
}

/** 画一张 ASCII 时间轴 */
function render(m: WeaponMachine, durationMs: number): string[] {
  const bucketMs = Math.max(1, Math.ceil(durationMs / 100)); // 宽度压到 ~100 格
  const buckets = Math.ceil(durationMs / bucketMs);
  const stateRow = new Array<string>(buckets).fill(" ");
  const eventRow = new Array<string>(buckets).fill(" ");

  // 状态：一段覆盖它跨过的所有桶
  const states = m.states;
  for (let i = 0; i < states.length; i++) {
    const from = states[i]!.start;
    const to = i + 1 < states.length ? states[i + 1]!.start : durationMs + bucketMs;
    for (let b = Math.floor(from / bucketMs); b < Math.ceil(to / bucketMs) && b < buckets; b++) {
      stateRow[b] = STATE_CHAR[states[i]!.state] ?? "?";
    }
  }
  for (const e of m.events) {
    const b = Math.floor(e.at / bucketMs);
    if (b < buckets) eventRow[b] = EVENT_CHAR[e.event] ?? "?";
  }

  // 刻度（前缀 8 列由下面每行自己加，这里不能再补）
  const ruler: string[] = [];
  for (let b = 0; b < buckets; b++) {
    const t = b * bucketMs;
    ruler.push(t % (bucketMs * 10) === 0 ? "|" : " ");
  }
  const labels: string[] = [];
  for (let b = 0; b < buckets; b += 10) {
    const t = b * bucketMs;
    const mark = `${t}ms`;
    while (labels.length < b) labels.push(" ");
    // 只写标记的每个字符，后面用空格补
    for (let k = 0; k < mark.length && b + k < buckets; k++) labels[b + k] = mark[k]!;
  }
  return [
    `        ${labels.join("")}`,
    `        ${ruler.join("")}`,
    `状态    ${stateRow.join("")}`,
    `事件    ${eventRow.join("")}`,
  ];
}

const out: unknown[] = [];
for (const c of cases) {
  const { m } = simulate(c);
  const shots = m.shots;
  const reloads = m.events.filter((e) => e.event === "reload").map((e) => e.at);
  console.log(`\n════ ${c.label}`);
  console.log(`       参数出处 ${c.source}`);
  console.log(LEGEND);
  for (const line of render(m, c.durationMs)) console.log(line);
  console.log(`       首发 ${shots[0] ?? "—"}ms · ${c.durationMs}ms 内 ${shots.length} 发${reloads.length > 0 ? ` · 补满于 ${reloads.join(" / ")}ms` : ""}`);

  out.push({
    case: c.label,
    source: c.source,
    durationMs: c.durationMs,
    /** 状态序列（有持续） */
    states: m.states,
    /** 事件序列（瞬时） */
    events: m.events,
    /** 发射时机（从事件里筛） */
    shots,
  });
}

writeFileSync("data/weapon-timelines.json", JSON.stringify(out, null, 2), "utf8");
console.log(`\n导出：data/weapon-timelines.json（${cases.length} 台武器的时间轴，只有武器机参与）`);
