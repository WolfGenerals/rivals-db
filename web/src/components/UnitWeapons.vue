<script setup lang="ts">
/**
 * 武器区 —— 数量不定，有几件画几块。没有武器时整块不出现
 * （采集车 / 建筑 / 支持单位就是这种情况）。
 *
 * 单独成文件是因为它是**列表型**区块（数量不定），和详情页里那些单例卡片
 * 组织方式不同；对比页将来也要按武器逐项对齐。
 */
import { computed } from "vue";

import type { EntityRecord } from "@rivals/core/types";
import type { Level } from "@rivals/core/levels";

import WeaponCard from "./WeaponCard.vue";

const props = defineProps<{
  unit: EntityRecord;
  level: Level;
}>();

const weapons = computed(() => props.unit.config.combatantTuning?.weaponTunings ?? []);
const waveSize = computed(() => props.unit.config.squadTuning?.waveSize ?? 1);
/** 小队成员开火错开（毫秒），单人单位是 0 */
const separationMs = computed(() => props.unit.config.squadTuning?.attackSeparationDurationMS ?? 0);
</script>

<template>
  <section v-if="weapons.length" class="panel">
    <h3>武器 <span class="at-level">{{ weapons.length }} 件</span></h3>
    <WeaponCard
      v-for="(w, i) in weapons"
      :key="i"
      :weapon="w"
      :index="i"
      :wave-size="waveSize"
      :separation-ms="separationMs"
      :level="level"
    />
  </section>
</template>

<style scoped>
.at-level {
  font-size: 12px;
  font-weight: 400;
  color: #7f8aa6;
}
</style>
