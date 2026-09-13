/**
 * **模拟循环（时钟 + 战场登记）** —— 驱动时间往前走。
 *
 * ⚠️ **它只推时钟、只登记，不塞任何规则。**
 *
 * ## 各机器的驱动是**调用方**的事（这一层不再有 `behaviors[]`）
 *
 * 之前这里挂过 `SquadRuntime { deploy, behaviors[] }`，还特地把部署排在行为前面 ——
 * 那一层已经删掉（用户：状态机各自管自己，别塞一个生成器/容器大杂烩）。现在的分工：
 *
 * | 谁 | 干什么 |
 * | --- | --- |
 * | `Battle` | 推时钟（`elapsedMs`）· 登记小队与地块 |
 * | **调用方**（剧本 / 驱动脚本 / 将来的 AI） | 每帧按顺序驱动：**部署机 → 武器机**，然后 `battle.tick(dt)` |
 * | 单位 / 小队类 | 只有状态与数值，不持有机器（机器由调用方建、调用方驱动） |
 *
 * ## ⚠️ 帧内顺序：部署**先于**开火，时钟**最后**推
 *
 * 1. **部署机先跑** ⇒ "这一帧刚架好的炮**能**在这一帧开火"（`DeployMachine.update` 是
 *    "先推进时间、再听指令"，所以结清那一刻状态已经是 `unpacked`）。反过来会让所有
 *    部署动作平白晚一帧。
 * 2. **武器机跟着跑**，它按 `deploy.readyToFire` 决定这一帧要不要打。
 * 3. **时钟最后推**：帧内所有读者看到的是"这一帧的开始"（记录出来的时间线才不偏移）。
 *
 * 地块（火 / 毒气 / 泰矿）也在这里登记：结算**不在**本类做 —— `TileEffect` 只管
 * "每跳多少伤害"，"谁站在上面、吃不吃"是战场逻辑，由调用方读 `tile.fire/.gas/.tiberium`
 * 自己处理。
 */

import type { Clock } from "./clock.ts";
import type { Tile } from "./unit-def.ts";
import type { Squad } from "./unit-instance.ts";

export class Battle implements Clock {
  /** 已过去的毫秒数 —— 它**就是**全局时钟（机器构造时注入它） */
  elapsedMs = 0;
  /** 场上所有小队（含已全灭的；判活用 `squad.alive`） */
  readonly squads: Squad[] = [];
  /** 场上所有地块 */
  readonly tiles: Tile[] = [];

  /** 全局时钟视图 —— 交给各机器读 */
  get nowMs(): number {
    return this.elapsedMs;
  }

  addSquad(squad: Squad): void {
    this.squads.push(squad);
  }

  addTile(tile: Tile): void {
    this.tiles.push(tile);
  }

  /** 还在场的（未全灭） */
  get liveSquads(): Squad[] {
    return this.squads.filter((s) => s.alive);
  }

  /**
   * 推进一步。
   *
   * ⚠️ **时钟在最后推**：帧内所有读者看到的是"这一帧的开始"。
   * 机器的时间零点就取创建那一刻的时钟 ⇒ 首帧创建的机器零点正好是第一帧的开头；
   * 若时钟先推，零点会整体偏一帧（记录出来的时间线也跟着偏）。
   */
  tick(deltaMs: number): void {
    this.elapsedMs += deltaMs;
  }

  /** 跑到指定时刻 */
  runUntil(endMs: number, stepMs = 1): void {
    while (this.elapsedMs < endMs) {
      const remain = endMs - this.elapsedMs;
      this.tick(Math.min(stepMs, remain));
    }
  }
}
