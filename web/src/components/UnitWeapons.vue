<script setup lang="ts">
/**
 * **武器区** —— 数量不定，有几件画几块；没有武器时整块不出现
 * （采集车 / 建筑 / 指挥官就是这种情况）。
 *
 * ⚠️ 数据来自**新格式 def**（`data/units.def.json` → `LoadedData.defs`），
 * 不再读旧产物 `derived.weapons` / `derived.attack`。
 * 单位还没 def 时（理论上现在不会有）整块给一句提示，不静默消失。
 */
import { computed } from "vue";

import type { DatasetEntry } from "@rivals/core/derive";
import type { Level } from "@rivals/core/levels";

import { unitStateTimeline } from "../def-timeline.ts";
import { useData } from "../useData.ts";
import UnitTimeline from "./UnitTimeline.vue";
import WeaponCard from "./WeaponCard.vue";

const props = defineProps<{
  unit: DatasetEntry;
  level: Level;
}>();

const data = useData();
const record = computed(() => data.value?.defs.byId.get(props.unit.id));
const def = computed(() => record.value?.def);
const allWeapons = computed(() => def.value?.combatant.weapons ?? []);
/**
 * **空武器槽要藏起来** —— 全库只有 1 个：壁虱坦克的 `hidden`
 * （`descriptors = {}` ⇒ 打不到任何目标、没有伤害，只用来挂部署 modifier 与动画）。
 * 把"打不到任何目标 + 没有任何伤害 + 没写弹头"的槽当容器处理，不作为武器展示。
 */
const isContainer = (w: { usage: { canAttack: unknown[] }; damage: unknown[]; warhead?: unknown }): boolean =>
  w.usage.canAttack.length === 0 && w.damage.length === 0 && w.warhead === undefined;
const weapons = computed(() => allWeapons.value.filter((w) => !isContainer(w)));
/** 单位状态条有没有内容（有部署/撤收才显示） */
const unitState = computed(() => def.value !== undefined && unitStateTimeline(def.value).segs.length > 0);
</script>

<template>
  <section v-if="weapons.length || unitState" class="panel">
    <h3>
      武器 <span class="at-level">{{ weapons.length }} 件</span>
      <span v-if="def?.deploy" class="at-level">
        · 可部署 {{ def.deploy.mustDeployToFire ? '（部署后开火）' : '（开火无需部署）' }}
      </span>
    </h3>
    <!-- **单位状态条**（单位级：部署/撤收；以后加移动/停止也在这条上） -->
    <UnitTimeline v-if="def" :def="def" :unit-name="record?.locale?.name_zh" />
    <WeaponCard
      v-for="(w, i) in weapons"
      :key="w.id"
      :weapon="w"
      :index="i"
      :primary="i === 0"
      :level="level"
      :wave-size="def?.squad.waveSize ?? 1"
      :separation-ms="def?.squad.attackSeparationDurationMS ?? 0"
      :unit-name="record?.locale?.name_zh"
    />
  </section>
  <section v-else-if="record && !def" class="panel">
    <h3>武器</h3>
    <p class="dim">这个单位的武器数据还在整理。</p>
  </section>
</template>

<style scoped>
/* 区块标题：与武器卡 `WeaponCard.vue` 的 `.block h4` 同一套（更大 / 加粗 / 上色 + 左侧色条） */
h3 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 4px 0 8px;
  padding-left: 9px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #a8c8f0;
  border-left: 3px solid #4a9eff;
}
.at-level {
  font-size: 12px;
  font-weight: 400;
  color: #7f8aa6;
}
.dim {
  font-size: 12px;
  color: #7f8aa6;
}
</style>
