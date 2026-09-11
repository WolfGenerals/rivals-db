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
import { unitBaseDps } from "../dps.ts";
import { displayLevel, dpsMode } from "../state.ts";
// 排序状态放 `state.ts` 的模块级单例 —— 组件内的 ref 会在路由切换时被重置
import { useData } from "../useData.ts";

// 指挥官已从界面移除（I142），表格只列单位
const data = useData();

/*
 * 筛选状态放 `state.ts` 的**模块级单例**（这里只取别名，模板不用改）——
 * 组件内的 ref 会在换路由时被重置，点进单位再返回筛选就没了。
 */
import {
  listFaction as faction,
  listHidden as hiddenMode,
  listQuery as q,
  listRarity as rarity,
  listType as type,
  tableCellMode as cellMode,
} from "../state.ts";

const TYPES = ["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"] as const;
type T = (typeof TYPES)[number];
const SHORT: Record<T, string> = {
  Infantry: "步兵",
  Vehicle: "载具",
  Aircraft: "空军",
  Structure: "建筑",
  Harvester: "采集车",
};

const TYPE_ORDER = ["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"];
const TYPE_LABEL: Record<string, string> = SHORT;
const RARITIES = ["Common", "Rare", "Epic"];

/** 目标列显示什么：`dps` 实战输出 / `ratio` 补正倍率 → 见 `state.ts` 的 `tableCellMode` */

/**
 * 排序。点列名切换：**首次点按该列的合理方向**（数值列默认降序、名称默认升序），
 * 再点同一列则反向。这是表格的通行约定 —— 点"DPS"想看的是最高的那几个。
 */
import { tableSortDir as sortDir, tableSortKey as sortKey } from "../state.ts";

/** 数值列首次点击用降序（最大值更有参考价值）；文本列用升序 */
const DESC_FIRST = new Set(["cost", "totalHP", "dps", "range", ...TYPES]);

function toggleSort(key: string) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortDir.value = DESC_FIRST.has(key) ? "desc" : "asc";
  }
}

const RARITY_RANK: Record<string, number> = { Common: 1, Rare: 2, Epic: 3 };

const source = computed(() =>
  data.value?.dataset.units ?? [],
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

/**
 * 「一轮几下 · 两下之间多少毫秒」。
 *
 * 取主武器的轨道：单发看 `hits`/`interval_ms`，装填看 `clip`/`interval_ms`。
 * 一轮只有 1 下、或没有间隔数据的，显示 `—`（没有"连击"可言）。
 */
function burstText(e: DatasetEntry): string {
  const w = primaryWeapon(e);
  if (!w) return "—";
  const t = e.derived.attack.tracks.find((x) => x.weapon === w.id);
  if (!t) return "—";
  const tm = t.timing;
  if (tm.kind === "一次") return "—"; // 一次性（自爆），没有"连击"可言
  const hits = tm.kind === "装填" ? tm.clip : tm.hits;
  const iv = tm.interval_ms;
  if (!hits || hits <= 1) return "—";
  return iv ? `${hits} 发 · ${iv}ms` : `${hits} 发`;
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
  /**
   * **一轮打几下 × 两下之间的间隔** —— 用来区分「持续」与「爆发」。
   *
   * 只看 DPS 分不出音波坦克（20 发 @40ms，然后蓄力 3s）和普通持续光束：
   * 它的 DPS 是**光束瞬时速率**，不是平均输出（见 findings I164）。
   * 把「几下 / 多少毫秒一下」摆出来，读者一眼能判断。
   */
  burst: string;
  cells: Cell[];
}

/** 排序取值。**打不到的按 -1**（排最后），而不是当 0 —— 否则会混进"最低输出"那一档 */
function sortVal(r: Row, key: string): number | string {
  const ti = TYPES.indexOf(key as T);
  if (ti >= 0) {
    const c = r.cells[ti]!;
    if (!c.reach) return -1;
    return cellMode.value === "ratio" ? c.ratio : Number(c.text);
  }
  switch (key) {
    case "name":
      return r.u.name_zh ?? r.u.name_en ?? r.u.id;
    case "faction":
      return r.u.faction;
    case "rarity":
      return RARITY_RANK[r.u.pb?.rarity ?? ""] ?? 0;
    case "cost":
      return r.u.derived.stats.cost ?? -1;
    case "totalHP":
      return r.totalHP ?? -1;
    case "dps":
      return r.dps ?? -1;
    case "range":
      return r.range ?? -1;
    default:
      return 0;
  }
}

const rows = computed<Row[]>(() => {
  const out = entries.value.map((u) => {
    const lv = displayLevel(u);
    const h = u.derived.health;
    const w = primaryWeapon(u);
    // 按顶栏选的 DPS 口径（原先写死 `derived.dps`，切口径时表格不动）
    const base = unitBaseDps(u, dpsMode.value);

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
      burst: burstText(u),
      cells,
    };
  });

  const key = sortKey.value;
  const dir = sortDir.value === "asc" ? 1 : -1;
  // 排序副本而不是原地排序 —— `entries` 是 computed 的派生，不该被改动
  return [...out].sort((a, b) => {
    const va = sortVal(a, key);
    const vb = sortVal(b, key);
    let c: number;
    if (typeof va === "string" || typeof vb === "string") {
      c = String(va).localeCompare(String(vb), "zh");
    } else {
      c = va - vb;
    }
    // 同值时按名字稳定排序，避免每次渲染顺序抖动
    if (c === 0) c = (a.u.name_zh ?? a.u.id).localeCompare(b.u.name_zh ?? b.u.id, "zh");
    return c * dir;
  });
});

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
        <th class="sortable" @click="toggleSort('name')">
          单位<i class="arrow">{{ sortKey === "name" ? (sortDir === "asc" ? "▲" : "▼") : "" }}</i>
        </th>
        <th class="sortable" @click="toggleSort('faction')">
          阵营<i class="arrow">{{ sortKey === "faction" ? (sortDir === "asc" ? "▲" : "▼") : "" }}</i>
        </th>
        <th class="sortable" @click="toggleSort('rarity')">
          稀有度<i class="arrow">{{ sortKey === "rarity" ? (sortDir === "asc" ? "▲" : "▼") : "" }}</i>
        </th>
        <th class="num sortable" @click="toggleSort('cost')">
          造价<i class="arrow">{{ sortKey === "cost" ? (sortDir === "asc" ? "▲" : "▼") : "" }}</i>
        </th>
        <th class="num sortable" @click="toggleSort('totalHP')">
          总血<i class="arrow">{{ sortKey === "totalHP" ? (sortDir === "asc" ? "▲" : "▼") : "" }}</i>
        </th>
        <th class="num sortable" @click="toggleSort('dps')">
          DPS<i class="arrow">{{ sortKey === "dps" ? (sortDir === "asc" ? "▲" : "▼") : "" }}</i>
        </th>
        <th class="num sortable" @click="toggleSort('range')">
          射程<i class="arrow">{{ sortKey === "range" ? (sortDir === "asc" ? "▲" : "▼") : "" }}</i>
        </th>
        <th title="一轮打几下 · 两下之间的间隔。用来区分持续与爆发">连击</th>
        <th v-for="t in TYPES" :key="t" class="num target sortable" @click="toggleSort(t)">
          {{ SHORT[t] }}<i class="arrow">{{ sortKey === t ? (sortDir === "asc" ? "▲" : "▼") : "" }}</i>
        </th>
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
        <td class="burst">{{ r.burst }}</td>
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
.burst {
  font-size: 11px;
  color: var(--dim);
  white-space: nowrap;
}
/* 可排序表头：手型 + hover 提亮，让人知道能点 */
th.sortable {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
th.sortable:hover {
  color: var(--accent);
}
.arrow {
  display: inline-block;
  width: 0.9em;
  font-style: normal;
  font-size: 8px;
  color: var(--accent);
  vertical-align: middle;
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
