<script setup lang="ts">
/**
 * 敌人应对 —— 左右两栏一行：**左「克制」右「索敌偏好」**。
 *
 * 两栏语义完全不同，不能混（`docs/data-semantics.md`）：
 *   · 克制     = 逐类型算实际伤害，**打谁最疼**（真实数值）
 *   · 索敌偏好 = `goodAgainstTags`，**AI 优先打谁**，不产生伤害加成
 * 80 把武器里两者一致数为 **0**。
 *
 * **不打文字说明，一律用颜色分档**（档位定义与逐目标伤害共用 `damageTiers.ts`）：
 * 打不到 / 极低 / 中等 / 偏低 / 正常 / 偏高。悬停显示具体伤害与倍率。
 */
import { computed } from "vue";

import type { DatasetEntry, WeaponTuning } from "@rivals/core/types";

import { TARGET_LABELS, TARGET_TYPES, TIERS, targetDamage, type TargetDamage } from "../damageTiers.ts";
import TypeIcon from "./TypeIcon.vue";

const props = defineProps<{ unit: DatasetEntry }>();

const weapons = computed<WeaponTuning[]>(() => props.unit.config.combatantTuning?.weaponTunings ?? []);

const intent = computed(() => new Set<string>(props.unit.derived.stats.preferred_targets ?? []));

const cells = computed<TargetDamage[]>(() => TARGET_TYPES.map((t) => targetDamage(weapons.value, t)));

const hasAny = computed(() => intent.value.size > 0 || cells.value.some((c) => c.reachable));
</script>

<template>
  <div v-if="hasAny" class="affinity">
    <!-- 左：克制（真实伤害，颜色分档） -->
    <div class="col">
      <span class="head">克制</span>
      <span class="icons">
        <span
          v-for="c in cells"
          :key="c.type"
          class="slot"
          :class="c.tier"
          :style="{ '--c': c.color }"
          :title="
            c.reachable
              ? `${TARGET_LABELS[c.type]}：${c.damage}（该武器正常的 ${(c.ratio * 100).toFixed(0)}%）${c.from ? ` ← ${c.from}` : ''}`
              : `${TARGET_LABELS[c.type]}：打不到`
          "
        >
          <TypeIcon :type="c.type.toLowerCase()" />
          <i v-if="!c.reachable" class="slash" aria-hidden="true" />
        </span>
      </span>
    </div>

    <span class="sep" />

    <!-- 右：索敌偏好（AI 意图，只有亮/灭） -->
    <div class="col">
      <span class="head">索敌偏好</span>
      <span class="icons">
        <span
          v-for="t in TARGET_TYPES"
          :key="t"
          class="slot intent"
          :class="{ on: intent.has(t) }"
          :title="`${TARGET_LABELS[t]}${intent.has(t) ? '：AI 优先攻击' : ''}`"
        >
          <TypeIcon :type="t.toLowerCase()" />
        </span>
      </span>
    </div>

    <!-- 极简图例：只有色块与档位名 -->
    <span class="legend">
      <i v-for="t in TIERS" :key="t.key" :style="{ '--c': t.color }" :title="t.label">{{ t.label }}</i>
      <i style="--c: #2a2f3a" title="打不到">打不到</i>
    </span>
  </div>
</template>

<style scoped>
.affinity {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.col {
  display: flex;
  align-items: center;
  gap: 8px;
}
.head {
  font-size: 11px;
  color: #9aa6c2;
  white-space: nowrap;
}
.sep {
  width: 1px;
  align-self: stretch;
  min-height: 26px;
  background: var(--line, #2a3550);
}
.icons {
  display: flex;
  gap: 7px;
}
.slot {
  position: relative;
  width: 34px;
  display: block;
  --icon-bg: var(--c);
  opacity: 0.95;
}
.slot.dead {
  opacity: 0.3;
}
.slash {
  position: absolute;
  inset: 8% 46% 8% 46%;
  background: #f87171;
  transform: rotate(-45deg);
  border-radius: 1px;
  box-shadow: 0 0 0 1px #0b1020;
}
/* 索敌偏好是二值，只有亮/灭 */
.slot.intent {
  --icon-bg: #33518f;
  opacity: 0.16;
  filter: grayscale(1);
}
.slot.intent.on {
  opacity: 1;
  filter: none;
}
.legend {
  margin-left: auto;
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: #6b7a99;
  white-space: nowrap;
}
.legend i {
  font-style: normal;
  display: flex;
  align-items: center;
  gap: 4px;
}
.legend i::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--c);
}
</style>
