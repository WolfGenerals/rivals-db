<script setup lang="ts">
/**
 * 单位列表页。每行链接到 `#/unit/<id>` 的独立详情页。
 *
 * ⚠️ **不用再异步补 DPS 了** —— 数据集是单文件，`derived.dps` 加载时就在内存里。
 * 早先这里有一套「先显示近似值、再后台逐条取精确值」的机制（`approxBaseDps` +
 * `exactBaseDpsOf` + `watch`），因为旧产物要把 103 个文件逐个拉下来。
 * 现在**整段删掉**。
 */
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";

import type { DatasetEntry } from "@rivals/core/derive";
import { level, startingMajorOfRarity, type Level } from "@rivals/core/levels";

import { detailPath } from "../router.ts";
import { displayLevel } from "../state.ts";
import { useData } from "../useData.ts";

const props = defineProps<{ commandersOnly?: boolean }>();
const data = useData();

const q = ref("");
const faction = ref("");
const rarity = ref("");

const source = computed<DatasetEntry[]>(() =>
  props.commandersOnly ? (data.value?.dataset.commanders ?? []) : (data.value?.all ?? []),
);

const units = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return source.value.filter((u) => {
    if (faction.value && u.faction !== faction.value) return false;
    if (rarity.value && (u.pb?.rarity ?? "") !== rarity.value) return false;
    if (needle && !`${u.id} ${u.variant}`.toLowerCase().includes(needle)) return false;
    return true;
  });
});

interface Row {
  u: DatasetEntry;
  level: Level;
  totalHP: number | null;
  perMemberHP: number | null;
  dps: number | null;
  delta: number | null;
}

const rows = computed<Row[]>(() =>
  units.value.map((u) => {
    const lv = displayLevel(u);
    const h = u.derived.health;
    const per = h?.per_member;
    const wave = h?.wave_size ?? 1;
    const startAt = level(startingMajorOfRarity(u.pb?.rarity) ?? 1, 0);
    const totalHP = per === undefined ? null : lv.hp(per * wave);
    const startHP = per === undefined ? null : startAt.hp(per * wave);
    const upgraded = lv.isAbove(startAt);
    const base = u.derived.dps;
    return {
      u,
      level: lv,
      totalHP,
      perMemberHP: per === undefined ? null : lv.hp(per),
      dps: base === null ? null : lv.dps(base),
      delta: totalHP !== null && startHP !== null && upgraded ? totalHP - startHP : null,
    };
  }),
);

const totalCount = computed(() => data.value?.all.length ?? 0);
</script>

<template>
  <div class="controls" style="margin: 12px 0">
    <input v-model="q" type="search" placeholder="搜索…" />
    <select v-model="faction">
      <option value="">全部阵营</option>
      <option value="GDI">GDI</option>
      <option value="NOD">NOD</option>
    </select>
    <select v-model="rarity">
      <option value="">全部稀有度</option>
      <option value="Common">Common</option>
      <option value="Rare">Rare</option>
      <option value="Epic">Epic</option>
    </select>
    <span class="muted">等级由顶栏控制</span>
  </div>

  <p class="muted" style="margin-bottom: 8px">
    {{ units.length }} / {{ totalCount }} 个条目　·　点击名称进入详情页
  </p>

  <table>
    <thead class="sticky">
      <tr>
        <th>单位</th>
        <th>阵营</th>
        <th>稀有度</th>
        <th class="num">等级</th>
        <th class="num">造价</th>
        <th class="num">总血</th>
        <th class="num">每员</th>
        <th class="num">DPS</th>
        <th class="num">射程</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in rows" :key="r.u.id">
        <td><RouterLink :to="detailPath(r.u.id)">{{ r.u.id.replace(/^(unit|cmdr)_/, "") }}</RouterLink></td>
        <td>{{ r.u.faction }}</td>
        <td class="rarity" :class="`r-${r.u.pb?.rarity ?? '-'}`">{{ r.u.pb?.rarity ?? "-" }}</td>
        <td class="num">{{ r.level.format() }}</td>
        <td class="num">{{ r.u.derived.stats.cost ?? "—" }}</td>
        <td class="num">
          {{ r.totalHP ?? "—" }}
          <span v-if="r.delta !== null" class="delta-up">+{{ r.delta }}</span>
        </td>
        <td class="num">{{ (r.u.derived.health?.wave_size ?? 1) > 1 ? (r.perMemberHP ?? "—") : "—" }}</td>
        <td class="num" title="来自 derived.dps（已按武器与时序解析）">{{ r.dps?.toFixed(1) ?? "—" }}</td>
        <td class="num">{{ r.u.derived.stats.range_tiles ?? "—" }}</td>
      </tr>
    </tbody>
  </table>
</template>
