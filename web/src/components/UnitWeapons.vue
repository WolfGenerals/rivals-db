<script setup lang="ts">
/**
 * 武器区 —— 数量不定，有几件画几块。没有武器时整块不出现
 * （采集车 / 建筑 / 支持单位就是这种情况）。
 *
 * 这里**建一次 `UnitAttack`**，把每把武器的攻击类型分给对应的 `WeaponCard`。
 * 这样「主武器是谁」「单位面板 DPS 是多少」都由 core 决定，UI 不自己判断。
 */
import { computed } from "vue";

import { UnitAttack } from "@rivals/core/attack";
import type { DatasetEntry } from "@rivals/core/derive";
import type { Level } from "@rivals/core/levels";

import WeaponCard from "./WeaponCard.vue";

const props = defineProps<{
  unit: DatasetEntry;
  level: Level;
}>();

const weapons = computed(() => props.unit.config.combatantTuning?.weaponTunings ?? []);
const attack = computed(() => UnitAttack.of(props.unit));
</script>

<template>
  <section v-if="weapons.length" class="panel">
    <h3>
      武器 <span class="at-level">{{ weapons.length }} 件</span>
      <span v-if="weapons.length > 1" class="at-level">
        · 面板 DPS 取<strong>主武器</strong>（不求和）
      </span>
    </h3>
    <WeaponCard
      v-for="(w, i) in weapons"
      :key="i"
      :weapon="w"
      :attack="attack.weapons[i]"
      :index="i"
      :primary="i === attack.primaryIndex"
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
