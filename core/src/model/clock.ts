/**
 * **全局时钟** —— 等价源码的 `nTime.GetFixedElapsedMs(gWorld)`。
 *
 * ## 为什么必须有一个共用基准
 *
 * 武器冷却存在**武器黑板**上、**跨序列（跨交战）有效**
 * （`nWeaponSequenceUtil.SetCooldown` 写的是 `GetFixedElapsedMs(gWorld) + 时长`，
 * 新序列 `WaitForCooldown` 读它算出"还剩多久"）。
 *
 * ⇒ 那个时刻必须落在**所有序列共用**的基准里。若拿"序列自己的年龄"当基准，
 * 换个目标重新交战就从 0 重来，冷却会被误判为"早就过完了"，白嫖一次冷却。
 *
 * ⚠️ 一个模型里**只该有一个时钟**。相位机、黑板、开火刻度全部读它，
 * 谁都不许自己 `+= deltaMs`（那会立刻长出第二个基准）。
 */

/** 只读时钟 —— 消费者看到的就是这么多 */
export interface Clock {
  readonly nowMs: number;
}

/**
 * **手动时钟** —— 离线回放一条武器时间线用（不需要整场战斗）。
 *
 * wiki 上的武器时间轴就是这么画出来的：造一个 `ManualClock`，
 * 一步一步 `tick`，读 `WeaponSequence.spans` / `.shots`。
 */
export class ManualClock implements Clock {
  nowMs = 0;
  tick(deltaMs: number): void {
    this.nowMs += deltaMs;
  }
}
