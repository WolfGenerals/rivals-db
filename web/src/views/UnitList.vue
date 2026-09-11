<script setup lang="ts">
/**
 * 单位表格 —— 一屏横向对比所有数值。
 *
 * 设计取舍：
 *   · **不列等级**（`I160`）：等级由顶栏统一控制，每行都一样，列出来纯占宽度。
 *   · **不列每员血量**：那是卡片/详情页该讲的，表格里"总血"才是对比要点。
 *   · **射程用 `attack_range_tiles`**（`I126`）：`weapon.maxRangeInTiles` 引擎不读它、
 *     区分不了步兵和炮兵，不能当射程用。
 *   · **五类目标的列可切换「DPS / 补正」**：DPS 看实战输出，补正看克制倍率，
 *     两者同一个数据源的两种表达，切换比重开一列省一半宽度。
 */
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";

import type { DatasetEntry, Weapon } from "@rivals/core/derive";
import { DAMAGE_CASCADE, type DamageOverrideTag } from "@rivals/core/types";
import { startingMajorOfRarity, type Level } from "@rivals/core/levels";

import { detailPath } from "../router.ts";
import { displayLevel } from "../state.ts";
import { useData } from "../useData.ts";

const props = defineProps<{ commandersOnly?: boolean }>();
const data = useData();

const q = ref("");
const faction = ref("");
const rarity = ref("");
const type = ref("");
const hiddenMode = ref<"hide" | "only" | "all">("hide");

const TYPES = ["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"] as const;
type T = (typeof TYPES)[number];
const SHORT: Record<T, string> = {
  Infantry: "步兵",
  Vehicle: "载具",
  Aircraft: "空军",
  Structure: "建筑",
  Harvester: "运矿车",
};

const TYPE_ORDER = ["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"];
const TYPE_LABEL: Record<string, string> = SHORT;
const RARITIES = ["Common", "Rare", "Epic"];

/** 目标列显示什么：`dps` 实战输出 / `ratio` 补正倍率 */
const cellMode = ref<"dps" | "ratio">("dps");

const source = computed(() =>
  props.commandersOnly ? (data.value?.dataset.commanders ?? []) : (data.value?.all ?? []),
);

const entries = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return source.value.filter((u) => {
    if (faction.value && u.faction !== faction.value) return false;
    if (rarity.value && (u.pb?.rarity ?? "") !== rarity.value) return false;
    if (type.value && (u.derived.stats.unit_type ?? "") !== type.value) return false;
    const isHidden = u.derived.stats.hidden === true;
    if (hiddenMode.value === "hide" && isHidden) return false;
    if (hiddenMode.value === "only" && !isHidden) return false;
    if (needle && !`${u.id} ${u.variant} ${u.name_zh ?? ""} ${u.name_en ?? ""}`.toLowerCase().includes(needle))
      return false;
    return true;
  });
});

/** 主武器（面板 DPS 的来源） */
function primaryWeapon(e: DatasetEntry): Weapon | undefined {
  return e.derived.weapons.find((w) => w.id === e.derived.primary) ?? e.derived.weapons[0];
}

/** 按 `DAMAGE_CASCADE` 回退链算对某类目标的伤害（补正值已在 `overrides` 里） */
function dmgVs(w: Weapon, t: T): number {
  for (const tag of DAMAGE_CASCADE[t] as DamageOverrideTag[]) {
    const hit = w.overrides.find((e) => e[0] === tag);
    if (hit) return hit[1];
  }
  return w.damage;
}

interface Cell {
  /** 能打得到吗（看 `can_attack`，不是"有没有写补正"） */
  reach: boolean;
  text: string;
  /** 补正倍率，用于上色 */
  ratio: number;
}

interface Row {
  u: DatasetEntry;
  level: Level;
  totalHP: number | null;
  range: number | undefined;
  dps: number | null;
  cells: Cell[];
}

const rows = computed<Row[]>(() =>
  entries.value.map((u) => {
    const lv = displayLevel(u);
    const h = u.derived.health;
    const w = primaryWeapon(u);
    const base = u.derived.dps;

    const cells = TYPES.map<Cell>((t) => {
      if (!w) return { reach: false, text: "—", ratio: 0 };
      const reach = w.can_attack.includes(t);
      const d = dmgVs(w, t);
      const ratio = w.damage > 0 ? d / w.damage : 0;
      if (!reach) return { reach: false, text: "—", ratio: 0 };
      if (cellMode.value === "ratio") {
        return { reach, text: `${Math.round(ratio * 100)}%`, ratio };
      }
      const dps = base === null ? null : lv.dps(base) * ratio;
      return { reach, text: dps === null ? "—" : dps.toFixed(0), ratio };
    });

    return {
      u,
      level: lv,
      totalHP: h ? lv.hp(h.total) : null,
      range: u.derived.stats.attack_range_tiles,
      dps: base === null ? null : lv.dps(base),
      cells,
    };
  }),
);

/** 补正分档配色：<70% 减伤 / 70~130% 正常 / >130% 增伤 */
function cellClass(c: Cell): string {
  if (!c.reach) return "dead";
  if (c.ratio < 0.7) return "low";
  if (c.ratio > 1.3) return "high";
  return "normal";
}
void startingMajorOfRarity;
</script>

<template>
  <div class="filters">
    <input v-model="q" type="search" placeholder="搜索…" />
    <select v-model="faction">
      <option value="">全部阵营</option>
      <option value="GDI">GDI</option>
      <option value="NOD">NOD</option>
    </select>
    <select v-model="rarity">
      <option value="">全部稀有度</option>
      <option v-for="r in RARITIES" :key="r" :value="r">{{ r }}</option>
    </select>
    <select v-model="type">
      <option value="">全部类型</option>
      <option v-for="t in TYPE_ORDER" :key="t" :value="t">{{ TYPE_LABEL[t] }}</option>
    </select>
    <select v-model="hiddenMode">
      <option value="hide">不显示隐藏单位</option>
      <option value="only">只显示隐藏单位</option>
      <option value="all">全部单位</option>
    </select>
    <!-- 五类目标列的表达方式：DPS 看输出、补正看克制 -->
    <div class="modes">
      <button type="button" :class="{ on: cellMode === 'dps' }" @click="cellMode = 'dps'">对目标 DPS</button>
      <button type="button" :class="{ on: cellMode === 'ratio' }" @click="cellMode = 'ratio'">伤害补正</button>
    </div>
  </div>

  <p class="muted" style="margin: 8px 0">
    {{ rows.length }} 个条目　·　等级由顶栏控制（{{ cellMode === "dps" ? "已按当前等级换算" : "补正与等级无关" }}）
  </p>

  <table class="grid-table">
    <thead class="sticky">
      <tr>
        <th>单位</th>
        <th>阵营</th>
        <th>稀有度</th>
        <th class="num">造价</th>
        <th class="num">总血</th>
        <th class="num">DPS</th>
        <th class="num">射程</th>
        <th v-for="t in TYPES" :key="t" class="num target">{{ SHORT[t] }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in rows" :key="r.u.id">
        <td>
          <!--
            本地化名：中文 → 英文 → 去掉前缀的 id。
            只有 3 个测试桩两者都没有（`unit_dlc_test`/`unit_example`/`cmdr_dlc_test`），
            而它们默认被隐藏，正常浏览看不到。
          -->
          <RouterLink :to="detailPath(r.u.id)">
            {{ r.u.name_zh || r.u.name_en || r.u.id.replace(/^(unit|cmdr|bldg)_/, "") }}
          </RouterLink>
        </td>
        <td class="dim">{{ r.u.faction }}</td>
        <td class="dim">{{ r.u.pb?.rarity ?? "—" }}</td>
        <td class="num">{{ r.u.derived.stats.cost ?? "—" }}</td>
        <td class="num">{{ r.totalHP?.toFixed(0) ?? "—" }}</td>
        <td class="num strong">{{ r.dps?.toFixed(0) ?? "—" }}</td>
        <td class="num">{{ r.range === undefined ? "—" : `${r.range} 格` }}</td>
        <td v-for="(c, i) in r.cells" :key="i" class="num target" :class="cellClass(c)">{{ c.text }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin: 14px 0 6px;
}
.filters input[type="search"] {
  flex: 1 1 200px;
}
.modes {
  display: flex;
  gap: 0;
  margin-left: auto;
}
/* 分段按钮：两半贴在一起，一眼看出是"二选一" */
.modes button:first-child {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.modes button:last-child {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  border-left: none;
}
.modes button.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: #cfe4ff;
}

.grid-table {
  width: 100%;
}
.grid-table th.target,
.grid-table td.target {
  /* 五类目标列窄一些，把宽度让给单位名 */
  min-width: 46px;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.strong {
  font-weight: 600;
}
.dim {
  color: var(--dim);
  font-size: 12px;
}
/* 补正分档 —— 与详情页「克制」行同一套语义 */
td.low {
  color: #7f8aa6;
}
td.normal {
  color: var(--up);
}
td.high {
  color: #ffcc55;
  font-weight: 600;
}
td.dead {
  color: #4a5163;
}
</style>
