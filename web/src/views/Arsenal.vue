<script setup lang="ts">
/**
 * 图鉴页：卡片墙。
 *
 * 这里是 `UnitCard` 的唯一调用方，可以看清它为什么只需要两个入参 ——
 * 页面只负责「挑出哪些单位」和「每个单位是什么等级」，其余全部由记录本身提供。
 *
 * 因为卡片要算**精确 DPS**（弹夹式武器不能用 `damage / cooldown`），
 * 需要完整记录而不是索引概览：103 个文件合计约 0.3 MiB，一次并发取回。
 */
import { computed, ref, watch } from "vue";

import { squadHealth, unitBaseDps, type EntityRecord } from "@rivals/core/types";

import UnitCard from "../components/UnitCard.vue";
import { loadAllRecords } from "../data.ts";
import { displayLevel } from "../state.ts";
import { useData } from "../useData.ts";

const props = defineProps<{ commandersOnly?: boolean }>();
const data = useData();

const records = ref<EntityRecord[]>([]);
const loading = ref(true);

watch(
  data,
  async (d) => {
    if (!d) return;
    records.value = await loadAllRecords(d);
    loading.value = false;
  },
  { immediate: true },
);

const q = ref("");
const faction = ref("");
const rarity = ref("");
const sort = ref<"cost" | "name" | "hp" | "dps">("cost");

const RARITY_ORDER: Record<string, number> = { Common: 1, Rare: 2, Epic: 3 };

/** 该条目在当前等级设置下应显示的等级（「相对起始」模式下每个单位不同）。 */
function levelOf(rec: EntityRecord) {
  return displayLevel({ rarity: rec.pb?.rarity });
}

function sortKey(rec: EntityRecord): number {
  switch (sort.value) {
    case "hp":
      return squadHealth(rec) ?? -1;
    case "dps":
      return unitBaseDps(rec);
    case "name":
      return 0;
    default:
      return rec.config.combatStoreTuning?.tiberiumCost ?? 9999;
  }
}

const shown = computed(() => {
  const needle = q.value.trim().toLowerCase();
  const wantCommander = Boolean(props.commandersOnly);

  const list = records.value.filter((rec) => {
    if (wantCommander !== rec.id.startsWith("cmdr_")) return false;
    if (faction.value && rec.faction !== faction.value) return false;
    if (rarity.value && (rec.pb?.rarity ?? "") !== rarity.value) return false;
    if (needle) {
      const hay = `${rec.id} ${rec.variant} ${rec.name_zh ?? ""} ${rec.name_en ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const by = sort.value;
  list.sort((a, b) => {
    if (by === "name") {
      return (a.name_zh ?? a.name_en ?? a.id).localeCompare(b.name_zh ?? b.name_en ?? b.id, "zh");
    }
    if (by === "cost") {
      const ca = a.config.combatStoreTuning?.tiberiumCost ?? 9999;
      const cb = b.config.combatStoreTuning?.tiberiumCost ?? 9999;
      if (ca !== cb) return ca - cb;
      return (a.name_zh ?? a.id).localeCompare(b.name_zh ?? b.id, "zh");
    }
    return sortKey(b) - sortKey(a);
  });
  return list;
});

const total = computed(() =>
  records.value.filter((r) => Boolean(props.commandersOnly) === r.id.startsWith("cmdr_")).length,
);

/** 顶部汇总：当前筛选下每档造价的单位数，方便一眼看出曲线形状。 */
const costSpread = computed(() => {
  const map = new Map<number, number>();
  for (const rec of shown.value) {
    const c = rec.config.combatStoreTuning?.tiberiumCost;
    if (c === undefined) continue;
    map.set(c, (map.get(c) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
});
</script>

<template>
  <div class="filters">
    <input v-model="q" type="search" placeholder="搜索中文名 / 英文名 / id…" />
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
    <select v-model="sort">
      <option value="cost">按造价</option>
      <option value="name">按名称</option>
      <option value="hp">按总血</option>
      <option value="dps">按 DPS</option>
    </select>
  </div>

  <p v-if="loading" class="muted">正在加载 {{ total }} 个条目…</p>
  <template v-else>
    <p class="muted summary">
      {{ shown.length }} / {{ total }} 个条目
      <span v-if="costSpread.length" class="spread">
        · 造价分布
        <span v-for="[c, n] in costSpread" :key="c" class="pill">{{ c }}<i>×{{ n }}</i></span>
      </span>
    </p>

    <p v-if="!shown.length" class="muted">没有符合筛选条件的条目。</p>
    <div v-else class="grid">
      <UnitCard
        v-for="rec in shown"
        :key="rec.id"
        :unit="rec"
        :level="levelOf(rec)"
        :fields="['type', 'level', 'faction', 'cost', 'name']"
      />
    </div>
  </template>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 14px 0 6px;
}
.filters input[type="search"] {
  flex: 1 1 240px;
}
.summary {
  margin: 6px 0 12px;
}
.spread {
  margin-left: 6px;
}
.pill {
  display: inline-block;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--line, #2a3550);
  font-size: 11px;
}
.pill i {
  font-style: normal;
  color: #7f8aa6;
  margin-left: 3px;
}

.grid {
  display: grid;
  /* 列宽 170~210px：一屏能多放几张，同时角标（按 cqw 等比缩放）不至于小到看不清 */
  grid-template-columns: repeat(auto-fill, minmax(170px, 210px));
  /* 角标探出约 24%（等级圈 ≈ 6cqw ≈ 12px），间隙留够即可，不必夸张 */
  gap: 26px 28px;
  justify-content: start;
  /* 第一列/第一行卡片的角标会探出容器，给点内边距免得贴边 */
  padding: 8px 14px 4px;
}
</style>
