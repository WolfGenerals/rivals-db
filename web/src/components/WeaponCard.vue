<script setup lang="ts">
/**
 * 单件武器。
 *
 * 排版按「读者想知道什么」分层，而不是把所有字段平铺成一张 kv 表：
 *   ① 结论行     单发伤害 · DPS · 开火周期 · 射程 —— 一眼看完
 *   ② 开火时序   每名队员一条轴，伤害落点打标签（`WeaponTimeline`）
 *   ③ 逐目标伤害 五类目标各打多少（`DamageMatrix`）
 *   ④ 次要参数   每轮发数 / 弹夹 / 弹道 / 枪口数，收成一行小字
 *      （部署/解除时间归单位基本信息，这里不重复）
 *
 * 节奏字段只做**原样展示**，不预设语义：`cooldown` 是开火周期，
 * `chargeUpDuration` 是周期末尾的前摇（见 docs/data-semantics.md 第 5 节），
 * **两者不相加**。
 */
import { computed } from "vue";

import { baseDps, type WeaponTuning } from "@rivals/core/types";
import type { Level } from "@rivals/core/levels";

import DamageMatrix from "./DamageMatrix.vue";
import StatIcon from "./StatIcon.vue";
import WeaponTimeline from "./WeaponTimeline.vue";

const props = defineProps<{
  weapon: WeaponTuning;
  index: number;
  waveSize: number;
  /** 小队成员开火错开（毫秒），单人单位传 0 */
  separationMs?: number;
  level: Level;
}>();

const base = computed(() => baseDps(props.weapon, props.waveSize));
const levelDps = computed(() => (base.value > 0 ? props.level.dps(base.value) : undefined));

const bt = computed(() => props.weapon.burstTiming);
const reload = computed(() => props.weapon.reloadTuning);

const cycle = computed(() => bt.value?.cooldown);
const chargeUp = computed(() => bt.value?.chargeUpDuration);
const numToBurst = computed(() => bt.value?.numToBurst);

const homingText = computed(() => {
  const h = props.weapon.projectile?.homing;
  if (h === undefined) return null;
  return h ? "追踪（难躲）" : "不追踪（可走位躲）";
});

/** ④ 次要参数，只收有值的 */
const minor = computed(() => {
  const out: Array<[string, string]> = [];
  if (numToBurst.value !== undefined) out.push(["每轮发数", String(numToBurst.value)]);
  if (reload.value) {
    out.push([
      "弹夹",
      `${reload.value.clipSize ?? "?"} 发 / ${((reload.value.reloadTimeMs ?? 0) / 1000).toFixed(1)}s`,
    ]);
  }
  if (homingText.value) out.push(["弹道", homingText.value]);
  if (props.weapon.muzzleCount !== undefined) out.push(["枪口数", String(props.weapon.muzzleCount)]);
  return out;
});
</script>

<template>
  <div class="weapon">
    <div class="head">
      <b>{{ weapon.name ?? "?" }}</b>
      <span v-if="weapon.displayName" class="dim">{{ weapon.displayName }}</span>
      <span class="dim">{{ weapon.weaponType ?? "" }}</span>
      <span class="idx">武器 {{ index + 1 }}</span>
    </div>

    <!-- ① 结论行 -->
    <div class="key">
      <div class="key-item">
        <StatIcon name="dps" />
        <span>单发伤害</span>
        <b>{{ weapon.damageTuning?.default ?? "—" }}</b>
      </div>
      <div class="key-item">
        <StatIcon name="dps" />
        <span>DPS @{{ level.format() }}</span>
        <b>{{ levelDps?.toFixed(1) ?? "—" }}</b>
      </div>
      <div class="key-item">
        <StatIcon name="cooldown" />
        <span>开火周期</span>
        <b>{{ cycle === undefined ? "—" : `${cycle}s` }}</b>
      </div>
      <div class="key-item">
        <StatIcon name="range" />
        <span>射程</span>
        <b>{{ weapon.maxRangeInTiles === undefined ? "—" : `${weapon.maxRangeInTiles} 格` }}</b>
      </div>
    </div>

    <!-- ② 开火时序 -->
    <WeaponTimeline
      v-if="cycle && cycle > 0"
      :cycle="cycle"
      :separation-ms="separationMs ?? 0"
      :wave-size="waveSize"
      :charge-up="chargeUp ?? 0"
    />

    <!-- ③ 逐目标伤害 -->
    <DamageMatrix :weapon="weapon" :level="level" />

    <!-- ④ 次要参数 -->
    <p v-if="minor.length" class="minor">
      <span v-for="[k, v] in minor" :key="k"><i>{{ k }}</i>{{ v }}</span>
    </p>
  </div>
</template>

<style scoped>
.weapon {
  border: 1px solid var(--line, #2a3550);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.head b {
  font-size: 14px;
}
.dim {
  color: #7f8aa6;
  font-size: 12px;
}
.idx {
  margin-left: auto;
  font-size: 11px;
  color: #6b7a99;
}

.key {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.key-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.key-item span {
  color: #9aa6c2;
  font-size: 12px;
}
.key-item b {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.minor {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 8px 0 0;
  font-size: 11px;
  color: #b9c4dc;
}
.minor i {
  font-style: normal;
  color: #6b7a99;
  margin-right: 4px;
}
</style>
