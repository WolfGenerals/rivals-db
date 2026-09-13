/**
 * **武器状态机（小类）自检** —— 循环类 / 弹夹类 / 分段类。
 *
 * 跑法：`node --experimental-strip-types core/test/weapon-machine-check.ts`
 */

import { ManualClock } from "../src/model/clock.ts";
import { CyclicWeapon } from "../src/model/weapons/cyclic-weapon.ts";
import { MagazineWeapon } from "../src/model/weapons/magazine-weapon.ts";
import { StagedWeapon } from "../src/model/weapons/staged-weapon.ts";
import { weaponMachineFor } from "../src/model/weapons/weapon-factory.ts";
import type { WeaponMachine } from "../src/model/weapons/weapon-machine.ts";
import type { Timing, WeaponDef } from "../src/model/weapon-def.ts";

let failed = 0;
let passed = 0;
const check = (label: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 期望 ${JSON.stringify(want)}，得到 ${JSON.stringify(got)}`);
};

/** 一个代表"有目标"的占位对象 —— 武器机不关心它是谁，只看是不是 `null` */
const TARGET = { name: "enemy" };

/** 从"现在"驱动到 `untilMs`（1ms 一步）；`target()` 每帧决定喂谁 */
function run(m: WeaponMachine, clock: ManualClock, untilMs: number, target: () => unknown | null = () => TARGET): void {
  while (clock.nowMs <= untilMs) {
    m.update(target());
    clock.tick(1);
  }
}

/** 状态序列的可读形式：`state@start` */
const statesOf = (m: WeaponMachine): string[] => m.states.map((s) => `${s.state}@${s.start}`);
/** 事件序列的可读形式：`event@at` */
const eventsOf = (m: WeaponMachine): string[] => m.events.map((e) => `${e.event}@${e.at}`);

console.log("【1】循环类：周期 = cooldown，前摇在周期之内");
{
  // 步枪兵真数：burstTiming = {cooldown: 1.72, chargeUpDuration: 0}
  const clock = new ManualClock();
  const rifle = new CyclicWeapon(clock, { kind: "cyclic", cooldownMs: 1720, chargeUpMs: 0, initialChargeUpMs: 0, hits: 1, intervalMs: 0 });
  run(rifle, clock, 6000);
  check("每 1720 一发（`shots` 从**事件**里筛）", rifle.shots, [0, 1720, 3440, 5160]);
  // ⚠️ 每次开火都**打断状态段** ⇒ 每个周期各是一段 cooling（同名也记）
  check("状态：每轮各一段 cooling（同名也记）", statesOf(rifle), ["cooling@0", "cooling@1720", "cooling@3440", "cooling@5160"]);
  check("开火是**事件**、不是状态", eventsOf(rifle).slice(0, 3), ["firing@0", "firing@1720", "firing@3440"]);

  // 连发族真数（弹弓式）：首轮蓄力 500 + 前摇 300 + 周期 1000
  const clock2 = new ManualClock();
  const sling = new CyclicWeapon(clock2, { kind: "cyclic", cooldownMs: 1000, chargeUpMs: 300, initialChargeUpMs: 500, hits: 1, intervalMs: 0 });
  run(sling, clock2, 2800);
  check("首发 800（500+300），之后每 1000", sling.shots.slice(0, 3), [800, 1800, 2800]);
  check("**首轮蓄力与每轮前摇是两段**＋每轮前摇 300", statesOf(sling), [
    "init_charging@0", // 0 → 500：首轮蓄力（一辈子一次）
    "charging@500", // 500 → 800：首轮的前摇
    "cooling@800",
    "charging@1500", // 下一发 1800 − 前摇 300
    "cooling@1800",
    "charging@2500",
    "cooling@2800", // 第三发打完
  ]);
  check("事件序列：三次开火", eventsOf(sling), ["firing@800", "firing@1800", "firing@2800"]);
}

console.log("\n【2】循环类：起手错位由调用方决定（武器机不用知道自己是第几个）");
{
  // 第 3 个成员：前 688ms 不喂它 ⇒ 首轮蓄力从"开喂"那一刻起算
  const clock = new ManualClock();
  const late = new CyclicWeapon(clock, { kind: "cyclic", cooldownMs: 1000, chargeUpMs: 300, initialChargeUpMs: 500, hits: 1, intervalMs: 0 });
  for (let now = 0; now < 688; now++) clock.tick(1);
  run(late, clock, 3500, () => TARGET);
  check("错位 688 ⇒ 首发 688+800=1488", late.shots[0], 1488);
  check("之后每 1000", late.shots.slice(0, 3), [1488, 2488, 3488]);
}

console.log("\n【3】循环类：没目标就不打，回来就能打");
{
  const clock = new ManualClock();
  const m = new CyclicWeapon(clock, { kind: "cyclic", cooldownMs: 1000, chargeUpMs: 0, initialChargeUpMs: 0, hits: 1, intervalMs: 0 });
  run(m, clock, 3000, () => null);
  check("一直没目标 ⇒ 一发都没打（状态是 idle）", [m.shots, m.state], [[], "idle"]);

  // 断档 3 秒再回来：不该把断档期间的 3 个周期补打出来
  const clock2 = new ManualClock();
  const m2 = new CyclicWeapon(clock2, { kind: "cyclic", cooldownMs: 1000, chargeUpMs: 0, initialChargeUpMs: 0, hits: 1, intervalMs: 0 });
  run(m2, clock2, 500, () => TARGET); // 0ms 打一发 → 下一发 1000
  run(m2, clock2, 3500, () => null); // 断档
  run(m2, clock2, 3600, () => TARGET); // 回来
  check("断档期间不补打：只在 0 与 3501 各一发", m2.shots, [0, 3501]);
}

console.log("\n【4】前摇：首次付、周期内不叠加、**断档回来要重付**");
{
  // 首次：500 蓄力 + 300 前摇 ⇒ 首发 800（不是 500）
  const clock = new ManualClock();
  const first = new CyclicWeapon(clock, { kind: "cyclic", cooldownMs: 1000, chargeUpMs: 300, initialChargeUpMs: 500, hits: 1, intervalMs: 0 });
  run(first, clock, 900);
  check("首发把前摇算进去了", first.shots, [800]);

  // 断档回来：目标 201ms 才出现 ⇒ 前摇从"回来那一刻"起算 ⇒ 501ms 开火（不是 201）
  const clock2 = new ManualClock();
  const resumed = new CyclicWeapon(clock2, { kind: "cyclic", cooldownMs: 1000, chargeUpMs: 300, initialChargeUpMs: 0, hits: 1, intervalMs: 0 });
  run(resumed, clock2, 200, () => null);
  run(resumed, clock2, 900);
  check("目标 201 回来 ⇒ 前摇付到 501 才开火", resumed.shots, [501]);

  // 断档但还在冷却里 ⇒ 不额外补前摇（按原冷却走）
  const clock3 = new ManualClock();
  const blink = new CyclicWeapon(clock3, { kind: "cyclic", cooldownMs: 1000, chargeUpMs: 300, initialChargeUpMs: 0, hits: 1, intervalMs: 0 });
  run(blink, clock3, 300);
  run(blink, clock3, 700, () => null); // 断一下
  run(blink, clock3, 1600);
  check("断一下仍在冷却 ⇒ 按原节奏 1300 开火", blink.shots, [300, 1300]);
}

console.log("\n【5】弹夹类：补满时刻 = 首发 + (打出的/弹夹) × 装填时间");
{
  // MLRS 真数：clipSize 3 / reloadTimeMs 5000 / gap 250 / 前摇 250
  const clock = new ManualClock();
  const mlrs = new MagazineWeapon(clock, { kind: "magazine", clipSize: 3, reloadTimeMs: 5000, gapMs: 250, chargeUpMs: 250 });
  run(mlrs, clock, 12000);
  check("首发在 250（先付前摇），之后每 250（弹夹内间隔）", mlrs.shots.slice(0, 3), [250, 500, 750]);
  check("打光后补满在 5250 = 首发 250 + 3/3 × 5000", mlrs.shots[3], 5250);
  check("第二轮 5250 / 5500 / 5750", mlrs.shots.slice(3, 6), [5250, 5500, 5750]);
  check("周期 = reloadTimeMs（5250 − 250）", mlrs.shots[3]! - mlrs.shots[0]!, 5000);

  check("状态：init_charging → cooling → wait_reload → charging", statesOf(mlrs).slice(0, 5), [
    "init_charging@0", // 出生 → 首发 250（出生那次前摇）
    "cooling@250", // 弹夹内两发之间
    "cooling@500", // 再打一发 ⇒ **又是一段 cooling**（同名也记）
    "wait_reload@750", // 打空（750）→ 等补满
    "charging@5000", // 补满 5250 之前的 250ms 前摇
  ]);
  check("事件：开火与装填两种", eventsOf(mlrs).slice(0, 6), [
    "firing@250",
    "firing@500",
    "firing@750",
    "reload@5250", // 补满那一刻
    "firing@5250",
    "firing@5500",
  ]);
}

console.log("\n【6】弹夹类：打一半就按比例少等（3 发只打了 1 发）");
{
  const clock = new ManualClock();
  const m = new MagazineWeapon(clock, { kind: "magazine", clipSize: 3, reloadTimeMs: 5000, gapMs: 250, chargeUpMs: 0 });
  m.update(TARGET); // 打 1 发
  check("打完 1 发后余弹 2", m.ammo, 2);
  check("补满时刻 = 0 + 1/3 × 5000", m.refillAtMs, (1 / 3) * 5000);

  // 目标消失，但补满计时照走
  run(m, clock, 1666, () => null);
  check("补满时刻前还是 2 发", m.ammo, 2);
  check("还有弹 ⇒ 没目标是 idle（不是 wait_reload）", m.state, "idle");
  run(m, clock, 1667, () => null); // 这一步只负责"到点回满"
  check("到点一次性回满（不看有没有目标）", m.ammo, 3);
  check("回满之后本轮连射清零", m.burstShots, 0);
  check("补满那一刻记了 `reload` 事件", m.events.filter((e) => e.event === "reload").map((e) => e.at), [1667]);

  // 打两发再停 ⇒ 补满更晚
  const clock2 = new ManualClock();
  const m2 = new MagazineWeapon(clock2, { kind: "magazine", clipSize: 3, reloadTimeMs: 5000, gapMs: 250, chargeUpMs: 0 });
  m2.update(TARGET);
  clock2.tick(250);
  m2.update(TARGET);
  check("打 2 发的补满时刻 = 0 + 2/3 × 5000", m2.refillAtMs, (2 / 3) * 5000);
}

console.log("\n【7】弹夹类：没弹就只能等");
{
  const clock = new ManualClock();
  // 火焰轰炸机式：弹夹 1 / 间隔 3200 / 装填 13000（无前摇）
  const m = new MagazineWeapon(clock, { kind: "magazine", clipSize: 1, reloadTimeMs: 13000, gapMs: 3200, chargeUpMs: 0 });
  run(m, clock, 14000);
  check("弹夹 1 发：0 与 13000", m.shots, [0, 13000]);
  // 弹夹只有 1 发 ⇒ 打完立刻是空夹，所以**整段时间都是 wait_reload**（没有 cooling）；
  // 第二轮的 wait_reload 是新的一段（开过火 ⇒ 状态段被事件打断）
  check("空夹那段是 wait_reload，每轮各一段", statesOf(m), ["wait_reload@0", "wait_reload@13000"]);
  check("事件：开火 → 补满 → 开火", eventsOf(m).slice(0, 3), ["firing@0", "reload@13000", "firing@13000"]);
}

console.log("\n【8】多发循环（巨无霸：周期 2500 / 3 发 / 间隔 250）");
{
  const clock = new ManualClock();
  const jug = new CyclicWeapon(clock, { kind: "cyclic", cooldownMs: 2500, chargeUpMs: 0, initialChargeUpMs: 0, hits: 3, intervalMs: 250 });
  run(jug, clock, 6000);
  check("一轮 3 发（0/250/500），下一轮在 2500", jug.shots, [0, 250, 500, 2500, 2750, 3000, 5000, 5250, 5500]);
  // ⚠️ **同状态到同状态也要记**：每两发之间都是独立的一段 cooling
  check("每发之后各是一段 cooling（同名也记）", statesOf(jug), [
    "cooling@0",
    "cooling@250",
    "cooling@500",
    "cooling@2500",
    "cooling@2750",
    "cooling@3000",
    "cooling@5000",
    "cooling@5250",
    "cooling@5500",
  ]);
}

console.log("\n【9】分段类（光束炮：首轮蓄力 500 / 段1 12 跳 / 段2 24 跳 / 段3 无限，均 250ms）");
{
  const clock = new ManualClock();
  const beam = new StagedWeapon(clock, {
    kind: "staged",
    initialChargeUpMs: 500,
    storeChargeTimeMs: 700,
    stages: [
      { attackCount: 12, tickPeriodMs: 250 },
      { attackCount: 24, tickPeriodMs: 250 },
      { attackCount: undefined, tickPeriodMs: 250 },
    ],
  });
  run(beam, clock, 12000);
  check("首轮蓄力 500 ⇒ 第一跳在 500，之后每 250", beam.shots.slice(0, 3), [500, 750, 1000]);
  check("段 1 恰好 12 跳（到 3250）", beam.shots.filter((t) => t <= 3250).length, 12);
  check("段事件在 12 跳之后那刻、之后 24 跳后再一次", eventsOf(beam).filter((e) => e.startsWith("stage")).slice(0, 2), ["stage@3250", "stage@9250"]);
  check("状态：init_charging（首轮蓄力）之后一直是 cooling", statesOf(beam).slice(0, 2), ["init_charging@0", "cooling@500"]);
  check("打到段 3", beam.stage, 3);
}

console.log("\n【10】工厂：按 `timing.kind` 分派（**只有三种**）");
{
  const clock = new ManualClock();
  const defOf = (timing: Timing): WeaponDef =>
    ({ timing, usage: { muzzleCount: 1, muzzleStrategy: null }, other: { modifiers: {} } }) as unknown as WeaponDef;
  check("cyclic → CyclicWeapon", weaponMachineFor(defOf({ kind: "cyclic", cooldownMs: 1000, chargeUpMs: 0, initialChargeUpMs: 0, hits: 1, intervalMs: 0 }), clock) instanceof CyclicWeapon, true);
  check("magazine → MagazineWeapon", weaponMachineFor(defOf({ kind: "magazine", clipSize: 3, reloadTimeMs: 5000, gapMs: 250, chargeUpMs: 0 }), clock) instanceof MagazineWeapon, true);
  check(
    "staged → StagedWeapon",
    weaponMachineFor(defOf({ kind: "staged", initialChargeUpMs: 500, storeChargeTimeMs: 700, stages: [{ attackCount: 12, tickPeriodMs: 250 }, { tickPeriodMs: 250 }] }), clock) instanceof
      StagedWeapon,
    true,
  );
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;
