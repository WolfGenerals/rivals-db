/**
 * 验证**部署机**（架设 / 撤收）—— 状态与事件、打断-续做的进度换算、架设减伤闩锁。
 *
 * 真数来自源码（J52：没有锚点的数不可信）：
 *
 * | 单位 | 架 | 收 | 边跑边打 | 减伤 |
 * | --- | --- | --- | --- | --- |
 * | MLRS | 2000ms | 500ms | 否 | 无 |
 * | 壁虱坦克 | 2000ms | 500ms | **是**（`canShootWhileMoving`） | 70%，架 1750 后开、收 250 后撤 |
 * | 岩石巨虫 | 有 intro/outro | | 否 | **`canInterruptIntro = false`** |
 *
 * 出处：`unit_gdi_mlrs.lua:58-76` · `unit_nod_ticktank.lua:72-94` · `unit_nod_rockwyrm.lua:50`；
 * 机制：`common/modifier_simple_intro.lua:15-16,31-33` · `common/modifier_simple_outro.lua:15-16` ·
 * `common/modifier_damagereduction_intro.lua:33-40` · `common/modifier_damagereduction_outro.lua:33-41`。
 *
 * 跑法：`node --experimental-strip-types core/test/deploy-machine-check.ts`
 */

import { ManualClock } from "../src/model/clock.ts";
import { DeployMachine } from "../src/model/behaviors/deploy-machine.ts";
import type { DeployParams } from "../src/model/behaviors/deploy-machine.ts";

let failed = 0;
let passed = 0;
const check = (label: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 期望 ${JSON.stringify(want)}，得到 ${JSON.stringify(got)}`);
};

const statesOf = (m: DeployMachine): string[] => m.states.map((s) => `${s.state}@${s.start}`);
const eventsOf = (m: DeployMachine): string[] => m.events.map((e) => `${e.event}@${e.at}`);

/** MLRS：`unit_gdi_mlrs.lua:58-75` */
const MLRS: DeployParams = { unpackMs: 2000, packMs: 500, canInterruptIntro: true };

/** 壁虱坦克：`unit_nod_ticktank.lua:72-92`（`canShootWhileMoving = true` ⇒ 收着也能打） */
const TICKTANK: DeployParams = {
  unpackMs: 2000,
  packMs: 500,
  canInterruptIntro: true,
  mustDeployToFire: false,
  shield: { percent: 0.7, unpackAfterMs: 1750, packAfterMs: 250 },
};

/** 岩石巨虫：`unit_nod_rockwyrm.lua:50` 起（`canInterruptIntro = false`） */
const ROCKWYRM: DeployParams = { unpackMs: 2000, packMs: 500, canInterruptIntro: false };

/**
 * 驱动：**在 `0..untilMs` 每一毫秒各驱动一次**（含两端），每帧"想不想架着"由 `want(now)` 给。
 * 于是 `run(…, 2000, …)` 结束时，第 2000ms 那一帧已经跑过了。
 */
function run(m: DeployMachine, clock: ManualClock, untilMs: number, want: (nowMs: number) => boolean | null): void {
  while (clock.nowMs <= untilMs) {
    m.update(want(clock.nowMs));
    clock.tick(1);
  }
}

console.log("【1】直通：想架就架满 `unpackMs`（MLRS 2000ms）");
{
  const clock = new ManualClock();
  const m = new DeployMachine(clock, MLRS);
  check("出生是 `packed`", statesOf(m)[0], "packed@0");
  run(m, clock, 1999, () => true);
  check("1999ms 还没架好", statesOf(m).some((s) => s.startsWith("unpacked")), false);
  run(m, clock, 2000, () => true);
  check("状态：packed → unpacking → unpacked", statesOf(m), ["packed@0", "unpacking@0", "unpacked@2000"]);
  check("事件：架好那一刻", eventsOf(m), ["unpack_done@2000"]);
  check("架好了才能开火", m.readyToFire, true);
  check("进度 1", m.progress, 1);
}

console.log("\n【2】打断-续做：架到 60% 改主意 ⇒ 还要收 `packMs × (1−60%)` = 200ms");
{
  const clock = new ManualClock();
  const m = new DeployMachine(clock, MLRS);
  run(m, clock, 1200, () => true); // 架了 1200/2000 = 60%
  check("架了 60%", m.progress, 0.6);
  m.update(false); // 同一时刻改主意
  check("进 `packing`", m.phase, "packing");
  check("还要收 200ms（不是整段 500ms）", m.remainingMs, 200);
  run(m, clock, 1400, () => false);
  check("收好：1200 + 200", statesOf(m).at(-1), "packed@1400");
  check("事件：收好那一刻", eventsOf(m), ["pack_done@1400"]);
  check("收着就不能开火", m.readyToFire, false);
}

console.log("\n【3】架了一半反悔 ⇒ 已架的时间不丢；重架是一段**新的** `unpacking`");
{
  const clock = new ManualClock();
  const m = new DeployMachine(clock, MLRS);
  run(m, clock, 500, () => true); // 架 500 = 25%
  run(m, clock, 900, () => false); // 501 起收：500 × 25% = 125ms ⇒ 626 收好
  check("收好：501 + 125", statesOf(m).at(-1), "packed@626");
  run(m, clock, 3000, () => true); // 再架（901 起，满 2000ms）
  check("两段 `unpacking`（中间夹着收）", statesOf(m).filter((s) => s.startsWith("unpacking")), [
    "unpacking@0",
    "unpacking@901",
  ]);
  check("架好：901 + 2000", statesOf(m).at(-1), "unpacked@2901");
}

console.log("\n【4】`canInterruptIntro = false`（岩石巨虫）⇒ 架设中改主意**不理会**，架完为止");
{
  const clock = new ManualClock();
  const m = new DeployMachine(clock, ROCKWYRM);
  run(m, clock, 1000, () => true);
  run(m, clock, 3000, () => false); // 从 1001 起一直要求"收"
  check("2000ms 之前从没进过 `packing`", statesOf(m).filter((s) => s.startsWith("packing@")), ["packing@2001"]);
  check("照样在 2000 架好", statesOf(m).includes("unpacked@2000"), true);
  check("架好之后才肯收（2001 起收 500ms）", statesOf(m).at(-1), "packed@2501");
}

console.log("\n【5】壁虱坦克的架设减伤：架 1750 后**开**、收 250 后**撤**（既不是全程，也不是「架好就有」）");
{
  const clock = new ManualClock();
  const m = new DeployMachine(clock, TICKTANK);
  check("出生收着 ⇒ 没盾", m.shieldActive, false);
  check("但收着也能开火（`canShootWhileMoving`）", m.readyToFire, true);
  run(m, clock, 1700, () => true);
  check("架到 1700ms 还没盾", m.shieldActive, false);
  run(m, clock, 1800, () => true);
  check("架到 1800ms（≥1750）有盾", m.shieldActive, true);
  check("减伤幅度 70%", m.shieldPercent, 0.7);
  run(m, clock, 2050, () => false); // 2000 架好，2001 起收
  check("架好了、刚开始收 ⇒ 盾还在", m.shieldActive, true);
  run(m, clock, 2300, () => false);
  check("收过 250ms（≥2251）⇒ 盾没了", m.shieldActive, false);
  check("收好：2001 + 500", statesOf(m).at(-1), "packed@2501");
  check("`packed` 状态没盾", m.shieldActive, false);
}

console.log("\n【6】没配盾的单位恒 `false`（MLRS 那种）");
{
  const clock = new ManualClock();
  const m = new DeployMachine(clock, MLRS);
  run(m, clock, 2100, () => true);
  check("架好了也没盾", m.shieldActive, false);
  check("幅度 0", m.shieldPercent, 0);
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;
