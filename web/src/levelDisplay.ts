/**
 * @deprecated 逻辑已合并进 `state.ts`（`displayLevel` / `upgradeSteps`）。
 *
 * 保留此文件仅作转发，避免两处重复实现随时间漂移。
 * 新代码请直接 `import { displayLevel, upgradeSteps } from "./state.ts"`。
 */

export { displayLevel, upgradeSteps, type LevelDisplay } from "./state.ts";
