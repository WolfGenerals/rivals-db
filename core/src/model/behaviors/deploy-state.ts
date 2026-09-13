/**
 * ⚠️ **本文件已作废（GONE）** —— 部署层换成 `behaviors/deploy-machine.ts` 了。
 *
 * 搬走时改掉的**语义**（旧的那版是错的或不完整的）：
 *
 * 1. **归属**：部署状态是**单位**的状态（引擎 `CombatantDeployState`），
 *    不是"挂在武器槽上"的 —— 壁虱坦克的部署 modifier 就挂在一个
 *    `name = "hidden"`、`descriptors = { }` 的**空武器槽**上（`unit_nod_ticktank.lua:52-97`）。
 * 2. **打断不是无条件允许的**：源码有 `canInterruptIntro`（岩石巨虫 `false`）。
 * 3. **进度只是一个标量**（旧版按"当前过程已花时长"存，换算等价，保留）。
 * 4. **多了架设减伤窗口**：`modifier_damagereduction_intro/outro` 的
 *    `damageReductionPercent` + `DAMAGE_REDUCTION_TIME_MS`（壁虱 70% / 1750 与 250）。
 *
 * ⚠️ 这个空壳文件还在只是因为**删除需要一次命令批准**（`Remove-Item` 被沙箱拦下），
 * 批准到手就删；它**不导出任何东西**，留着不会影响编译。
 */
export {};
