<script setup lang="ts">
/**
 * ⚠️ **本组件已作废（GONE）** —— 时序图改用 `WeaponTimeline.vue` 了。
 *
 * 这里原本是"一条细色带"的简化画法，用户判定**可读性比旧版差太多**
 * （"时序可读性比以前差太多"）—— 旧画法有三件东西是必需的：
 *
 * 1. **每个队员一条**（按 `squad.attackSeparationDurationMs` 错开、并按周期重复）
 *    —— 小队的脉冲/相位交叠只有画出来才看得见；
 * 2. **段语义**：`charge` 前摇 / `fire` 开火（宽度 = 发数 × 间隔）/ `gap` 冷却 /
 *    `reload` 装填 / `deploy` 部署 / `stage` 分段，各有各的斜纹与配色；
 * 3. **金刻度**标每一发（一击/齐射那种零宽度开火只出刻度、不出条）+ **图例 + 横轴说明**。
 *
 * 段**算法**现在在 `web/src/def-timeline.ts`（新格式 def → 段），
 * 渲染在 `WeaponTimeline.vue`（与战斗时间线共用 `squad-timeline.ts` 的 `Seg` 语义）。
 *
 * ⚠️ 这个空壳还在只是因为**删除需要一次命令批准**（`Remove-Item` 被沙箱拦下）；
 * 它**不导出任何东西**，留着不影响编译。
 */
export {};
</script>

<template>
  <p />
</template>
