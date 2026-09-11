<script setup lang="ts">
/**
 * 单件武器。
 *
 * 排版按「读者想知道什么」分层：
 *   ① 结论行     攻击方式 · 单发伤害 · DPS · 射程 —— 一眼看完
 *   ② 阶段明细   `WeaponAttack.phases()` 的表格（**图看形状、表看数字**）
 *   ③ 逐目标伤害 五类目标各打多少（`DamageMatrix`）
 *   ④ 次要参数   每轮发数 / 弹夹 / 弹道 / 枪口数，收成一行小字
 *
 * **DPS 与阶段都来自 `WeaponAttack`**（`@rivals/core/attack`），不在这里重算 ——
 * 那边按 `modifier_sequence.behaviourName` 精确派发到 15 个行为类，
 * 有 15 个游戏内面板观测点验证（`core/test/attack-verify.ts`）。
 *
 * ⚠️ 不再用 `baseDps()`：它只覆盖 62 把常规武器，对特殊武器一律返回 0。
 */
import { computed } from "vue";

import type { WeaponAttack } from "@rivals/core/attack";
import type { Level } from "@rivals/core/levels";
import type { WeaponTuning } from "@rivals/core/types";

import DamageMatrix from "./DamageMatrix.vue";
import StatIcon from "./StatIcon.vue";

const props = defineProps<{
  weapon: WeaponTuning;
  /** 该武器的攻击类型（来自 `UnitAttack.of(unit).weapons[i]`） */
  attack?: WeaponAttack;
  index: number;
  /** 是否是单位的主武器 —— 面板显示的是它 */
  primary?: boolean;
  level: Level;
}>();

/** 1-0 级基准 DPS → 当前等级 */
const baseDps1 = computed(() => props.attack?.dps() ?? 0);
const levelDps = computed(() => (baseDps1.value > 0 ? props.level.dps(baseDps1.value) : undefined));

const phases = computed(() => props.attack?.phases() ?? []);

const bt = computed(() => props.weapon.burstTiming);
const reload = computed(() => props.weapon.reloadTuning);

const homingText = computed(() => {
  const h = props.weapon.projectile?.homing;
  if (h === undefined) return null;
  return h ? "追踪（难躲）" : "不追踪（可走位躲）";
});

/** 段的中文类型名 */
const KIND_LABEL: Record<string, string> = {
  charge: "前摇",
  fire: "开火",
  pause: "停顿",
  reload: "装填",
};

const fmtMs = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? "持续" : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;

/** ④ 次要参数，只收有值的 */
const minor = computed(() => {
  const out: Array<[string, string]> = [];
  if (bt.value?.numToBurst !== undefined) out.push(["每轮发数", String(bt.value.numToBurst)]);
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
  <div class="weapon" :class="{ primary }">
    <div class="head">
      <b>{{ weapon.name ?? "?" }}</b>
      <span v-if="weapon.displayName" class="dim">{{ weapon.displayName }}</span>
      <span class="dim">{{ weapon.weaponType ?? "" }}</span>
      <span v-if="primary" class="tag primary" title="面板 DPS 显示的是这把武器">主武器</span>
      <span v-if="attack" class="tag kind">{{ attack.label }}</span>
      <span class="idx">武器 {{ index + 1 }}</span>
    </div>

    <!-- ① 结论行 -->
    <div class="key">
      <div class="key-item">
        <StatIcon name="dps" />
        <span>单发伤害</span>
        <b>{{ attack?.damage() ?? "—" }}</b>
      </div>
      <div class="key-item">
        <StatIcon name="dps" />
        <span>DPS @{{ level.format() }}</span>
        <b>{{ levelDps?.toFixed(1) ?? "—" }}</b>
      </div>
      <div class="key-item">
        <StatIcon name="range" />
        <span>射程</span>
        <b>{{ weapon.maxRangeInTiles === undefined ? "—" : `${weapon.maxRangeInTiles} 格` }}</b>
      </div>
    </div>

    <!-- ② 阶段明细 -->
    <table v-if="phases.length" class="phases">
      <thead>
        <tr>
          <th>阶段</th>
          <th>类型</th>
          <th class="num">时长</th>
          <th class="num">发数</th>
          <th class="num">单发</th>
          <th class="num">间隔</th>
          <th class="num">溅射</th>
          <th class="num">倍率</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, i) in phases" :key="i" :class="p.kind">
          <td>{{ p.label }}</td>
          <td class="dim">{{ KIND_LABEL[p.kind] ?? p.kind }}</td>
          <td class="num">{{ fmtMs(p.ms) }}</td>
          <td class="num">{{ p.shots ?? "—" }}</td>
          <td class="num">{{ p.damage ?? "—" }}</td>
          <td class="num">{{ p.intervalMs === undefined ? "—" : `${p.intervalMs}ms` }}</td>
          <td class="num">{{ p.splash ?? "—" }}</td>
          <td class="num ramp">{{ p.ramp ? `↑${p.ramp.toFixed(1)}×` : "" }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="dim tiny">
      该武器没有可解析的开火阶段（常规武器由引擎内置序列驱动，参数见下方小字）。
    </p>

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
/* 主武器加一道左侧色条 —— 面板 DPS 取的就是它 */
.weapon.primary {
  border-left: 3px solid #4a9eff;
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
.tag {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  white-space: nowrap;
}
.tag.primary {
  background: #1d3a5c;
  color: #8fc4ff;
}
.tag.kind {
  border: 1px solid var(--line, #2a3550);
  color: #b9c4dc;
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

.phases {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-bottom: 10px;
}
.phases th {
  text-align: left;
  font-weight: 500;
  color: #7f8aa6;
  font-size: 11px;
  padding: 2px 8px 4px 0;
  border-bottom: 1px solid var(--line, #2a3550);
}
.phases td {
  padding: 3px 8px 3px 0;
  border-bottom: 1px solid #232b3d;
  color: #b9c4dc;
}
.phases .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.phases tr.charge td {
  color: #d8a13c;
}
.phases tr.pause td {
  color: #6b7a99;
}
.phases .ramp {
  color: #8fc4ff;
}

.tiny {
  font-size: 11px;
  margin: 0 0 8px;
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
