/**
 * 验证**持续效果机** —— 状态/事件、补跳、前端倒计时、外部叫停。
 *
 * 两个实证（`modifier_self_heal.lua` / `modifier_unstackable_damage_over_time.lua`）的真数都进测试。
 *
 * 跑法：`node --experimental-strip-types core/test/effect-machine-check.ts`
 */

import { ManualClock } from "../src/model/clock.ts";
import { EffectMachine } from "../src/model/behaviors/effect-machine.ts";

let failed = 0;
let passed = 0;
const check = (label: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 期望 ${JSON.stringify(want)}，得到 ${JSON.stringify(got)}`);
};

const statesOf = (m: EffectMachine): string[] => m.states.map((s) => `${s.state}@${s.start}`);
const eventsOf = (m: EffectMachine): string[] => m.events.map((e) => `${e.event}@${e.at}`);

/** 驱动到 `untilMs`（1ms 一步），`cond()` 每帧决定条件 */
function run(m: EffectMachine, clock: ManualClock, untilMs: number, cond: () => boolean = () => true): void {
  while (clock.nowMs <= untilMs) {
    m.update(cond());
    clock.tick(1);
  }
}

console.log("【1】DoT 口径：首次在 `delayMs`（= 一个 tickPeriod），之后每 tickPeriod 一跳");
{
  // 源码 `lastDamageTime = 0` + `while lastDamageTime + tickPeriodMs < age` ⇒ 第一跳在一个周期之后
  const clock = new ManualClock();
  const dot = new EffectMachine(clock, { tickMs: 500, delayMs: 500 });
  run(dot, clock, 2600);
  check("跳在 500 / 1000 / 1500 / 2000 / 2500", dot.ticks, [500, 1000, 1500, 2000, 2500]);
  check("状态：waiting（等首次）→ active", statesOf(dot).slice(0, 2), ["waiting@0", "active@500"]);
  check("没有 idle（条件一直满足）", statesOf(dot).includes("idle@0"), false);
}

console.log("\n【2】补跳：一帧跨过三个周期 ⇒ 三跳都补上（源码是 `while`，不是 `if`；三跳都在这一帧结算）");
{
  const clock = new ManualClock();
  const dot = new EffectMachine(clock, { tickMs: 500, delayMs: 500 });
  // 只在 0 与 1600 各驱动一次（模拟长帧）
  dot.update(true);
  clock.tick(1600);
  dot.update(true);
  // 源码 `while` 循环体里直接 `AoeDamageSquadOverride` ⇒ 三跳都在 1600 这一帧结算
  check("1600ms 那一帧补出 3 跳", dot.ticks, [1600, 1600, 1600]);
  check("三跳的 at 都是发现它们的那一帧", new Set(dot.ticks).size, 1);
  check("补跳只丢时刻、不丢次数", dot.ticks.length, 3);
}

console.log("\n【3】回血口径：`healingDelayMs` 等完**立刻**生效，之后每 tickPeriod 再试");
{
  // 源码 `modifier_self_heal`：healingDelayMs = 3000、tickPeriodMs = 1000（示例值）
  const clock = new ManualClock();
  const heal = new EffectMachine(clock, { tickMs: 1000, delayMs: 3000 });
  run(heal, clock, 4400);
  check("首次在 3000，之后每 1000", heal.ticks, [3000, 4000]);
  check("前 3000ms 是 waiting", statesOf(heal).slice(0, 2), ["waiting@0", "active@3000"]);
}

console.log("\n【4】条件掉了 ⇒ 回 idle，且倒计时**重新起算**（源码 `if idle and not wasIdle`）");
{
  const clock = new ManualClock();
  const heal = new EffectMachine(clock, { tickMs: 1000, delayMs: 3000 });
  run(heal, clock, 2000, () => true); // 等到 2000 还没到 3000
  run(heal, clock, 2500, () => false); // 被打断
  run(heal, clock, 6000, () => true); // 从 2501 重新满足 ⇒ 新的倒计时到 5501
  check("只有 5501 一跳（前面那次倒计时被清掉）", heal.ticks, [5501]);
  check("中间有一段 idle", statesOf(heal).includes("idle@2001"), true);
}

console.log("\n【5】外部叫停：记 `end` 事件，之后不再跳（源码 `MarkForDelete`）");
{
  const clock = new ManualClock();
  const dot = new EffectMachine(clock, { tickMs: 500, delayMs: 0 });
  run(dot, clock, 1200);
  const before = dot.ticks.length;
  dot.stop();
  run(dot, clock, 3000);
  check("叫停前跳了 3 次（0 / 500 / 1000）", before, 3);
  check("叫停后不再跳", dot.ticks.length, before);
  check("记了 end 事件", eventsOf(dot).slice(-1), ["end@1201"]);
  check("alive = false", dot.alive, false);
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;
