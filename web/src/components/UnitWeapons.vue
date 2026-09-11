<script setup lang="ts">
/**
 * 武器区 —— 数量不定，有几件画几块。没有武器时整块不出现
 * （采集车 / 建筑 / 支持单位就是这种情况）。
 *
 * 数据直接来自 `derived`（已解析好的武器 + 时序），**不再建 `UnitAttack` 现算**。
 */
import { computed } from "vue";

import type { DatasetEntry } from "@rivals/core/derive";
import type { Level } from "@rivals/core/levels";

import WeaponCard from "./WeaponCard.vue";

const props = defineProps<{
  unit: DatasetEntry;
  level: Level;
}>();

const weapons = computed(() => props.unit.derived.weapons);
const primaryIndex = computed(() => weapons.value.findIndex((w) => w.id === props.unit.derived.primary));
/** 该武器自己的时序轨道（`sequence` 下每把武器各一条） */
const tracksOf = (id: string) => props.unit.derived.attack.tracks.filter((t) => t.weapon === id);
const comp = computed(() => props.unit.derived.attack.composition);
const COMP_LABEL: Record<string, string> = {
  single: "",
  sequence: "· 按时间换武器",
  conditional: "· 按目标类型择一",
  parallel: "· 多武器并行",
};
</script>

<template>
  <section v-if="weapons.length" class="panel">
    <h3>
      武器 <span class="at-level">{{ weapons.length }} 件</span>
      <span v-if="comp !== 'single'" class="at-level">{{ COMP_LABEL[comp] }}</span>
      <!-- DPS 口径选择器在**顶栏**（它是全局设置，不属于某个武器区） -->
    </h3>
    <WeaponCard
      v-for="(w, i) in weapons"
      :key="w.id"
      :weapon="w"
      :tracks="tracksOf(w.id)"
      :index="i"
      :primary="i === primaryIndex"
      :level="level"
      :wave-size="unit.derived.squad?.wave_size ?? 1"
      :separation-ms="unit.derived.squad?.member_offset_ms ?? 0"
      :primary-dps="i === primaryIndex ? unit.derived.dps : null"
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
