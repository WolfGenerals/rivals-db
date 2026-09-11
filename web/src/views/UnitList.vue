<script setup lang="ts">
/**
 * 单位列表页。每行链接到 `#/unit/<id>` 的独立详情页。
 *
 * DPS 分两步：先用索引里的 `damage / cooldown` 出近似值，再按需加载武器配置
 * 校正。因为弹夹式武器（`reloadTuning`，仅 7 个）公式不同，
 * `damage / cooldown` 会算错（MLRS 会算成 2664，真值 1319.8）。
 */
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import { baseDps, type UnitSummary } from "@rivals/core/types";
import { level, startingMajorOfRarity, type Level } from "@rivals/core/levels";

import { findEntryById } from "../data.ts";
import { detailPath } from "../router.ts";
import { displayLevel } from "../state.ts";
import { useData } from "../useData.ts";
const props = defineProps<{ commandersOnly?: boolean }>();
const data = useData();

const q = ref("");
const faction = ref("");
const rarity = ref("");

/** 详细 DPS 缓存：id -> 1-0 级基础 DPS（只在加载完成后填入） */
const exactDps = ref(new Map<string, number>());

const source = computed(() =>
  props.commandersOnly ? (data.value?.commanderIndex?.commanders ?? []) : (data.value?.all ?? []),
);

const units = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return source.value.filter((u) => {
    if (faction.value && u.faction !== faction.value) return false;
    if (rarity.value && (u.rarity ?? "") !== rarity.value) return false;
    if (needle && !`${u.id} ${u.variant}`.toLowerCase().includes(needle)) return false;
    return true;
  });
});

interface Row {
  u: UnitSummary;
  level: Level;
  totalHP: number | null;
  perMemberHP: number | null;
  dps: number | null;
  delta: number | null;
}

/** 索引里的 `damage / cooldown` 近似值（对弹夹式武器不准）。 */
function approxBaseDps(u: UnitSummary): number | null {
  if (u.damage === undefined || u.cooldown === undefined || u.cooldown === 0) return null;
  return (u.damage * (u.wave_size ?? 1)) / u.cooldown;
}

const rows = computed<Row[]>(() =>
  units.value.map((u) => {
    const lv = displayLevel(u);
    const per = u.health;
    const wave = u.wave_size ?? 1;
    const startAt = level(startingMajorOfRarity(u.rarity) ?? 1, 0);
    const totalHP = per === undefined ? null : lv.hp(per * wave);
    const startHP = per === undefined ? null : startAt.hp(per * wave);
    const upgraded = lv.isAbove(startAt);

    // 精确值优先；没有就用近似
    const exact = exactDps.value.get(u.id);
    const base = exact ?? approxBaseDps(u);
    return {
      u,
      level: lv,
      totalHP,
      perMemberHP: per === undefined ? null : lv.hp(per),
      dps: base === null || base === undefined ? null : lv.dps(base),
      delta: totalHP !== null && startHP !== null && upgraded ? totalHP - startHP : null,
    };
  }),
);

/** 从武器配置算精确的 1-0 级 DPS。 */
function exactBaseDpsOf(cfg: { squadTuning?: { waveSize?: number }; combatantTuning?: { weaponTunings?: unknown[] } }): number {
  const wave = cfg.squadTuning?.waveSize ?? 1;
  let best = 0;
  for (const w of cfg.combatantTuning?.weaponTunings ?? []) {
    best = Math.max(best, baseDps(w as never, wave));
  }
  return best;
}

/** 后台逐条校正 DPS，只对尚未取到的 id 发起请求。 */
watch(
  units,
  async (list) => {
    const pending = list.filter((u) => !exactDps.value.has(u.id));
    if (!pending.length) return;
    const next = new Map(exactDps.value);
    await Promise.all(
      pending.map(async (u) => {
        const rec = await findEntryById(u.id);
        if (!rec) return;
        const dps = exactBaseDpsOf(rec.config ?? {});
        if (dps > 0) next.set(u.id, dps);
      }),
    );
    exactDps.value = next;
  },
  { immediate: true },
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
        <td class="rarity" :class="`r-${r.u.rarity ?? '-'}`">{{ r.u.rarity ?? "-" }}</td>
        <td class="num">{{ r.level.format() }}</td>
        <td class="num">{{ r.u.cost ?? "—" }}</td>
        <td class="num">
          {{ r.totalHP ?? "—" }}
          <span v-if="r.delta !== null" class="delta-up">+{{ r.delta }}</span>
        </td>
        <td class="num">{{ (r.u.wave_size ?? 1) > 1 ? (r.perMemberHP ?? "—") : "—" }}</td>
        <td class="num" :title="exactDps.has(r.u.id) ? '精确值（按武器配置算出）' : '近似值（damage / cooldown）'">
          {{ r.dps?.toFixed(1) ?? "—" }}
        </td>
        <td class="num">{{ r.u.range ?? "—" }}</td>
      </tr>
    </tbody>
  </table>
</template>
