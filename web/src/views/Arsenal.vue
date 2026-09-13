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

import type { DatasetEntry } from "@rivals/core/derive";

import UnitCard from "../components/UnitCard.vue";
import { loadDataset } from "../data.ts";
import { displayLevel } from "../state.ts";
import { useData } from "../useData.ts";

const props = defineProps<{
  commandersOnly?: boolean;
  /** 点选模式：卡片点击抛 `pick` 而不跳转（对比页挑单位用） */
  pickable?: boolean;
  /** 已选中的 id（画高亮） */
  picked?: string[];
  /**
   * **只显示这些 id** —— 对战页用：能上场的只有**转出新格式 def** 的单位
   * （没有 `def` 就没有武器/血量，画不出时序，点进去只会得到一句"还没转换"）。
   */
  only?: string[];
}>();

const emit = defineEmits<{ (e: "pick", id: string): void }>();
const data = useData();

// 数据集是单文件，加载完就全在内存里 —— 同步取即可
const records = computed<DatasetEntry[]>(() => data.value?.all ?? []);
const loading = computed(() => !data.value);

/*
 * 筛选/排序/分组放 `state.ts` 的**模块级单例**（这里取别名，模板不用改）——
 * 组件内的 ref 会在换路由时被重置，点进单位再返回筛选就没了。
 */
import {
  listFaction as faction,
  listGroup as group,
  listHidden as hiddenMode,
  listQuery as q,
  listRarity as rarity,
  listSort as sort,
  listType as type,
} from "../state.ts";

/** 类型分组的显示顺序与中文名。`derived.stats.unit_type` 的取值就是这些 */
const TYPE_ORDER = ["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"];
const TYPE_LABEL: Record<string, string> = {
  Infantry: "步兵",
  Vehicle: "载具",
  Aircraft: "空军",
  Structure: "建筑",
  Harvester: "采集车",
};

const RARITY_ORDER: Record<string, number> = { Common: 1, Rare: 2, Epic: 3 };

/** 卡片显示的等级 = 顶栏的全局等级（条目不再参与计算，见 `state.ts` 的 `displayLevel`）。 */
function levelOf() {
  return displayLevel();
}

function sortKey(rec: DatasetEntry): number {
  switch (sort.value) {
    case "hp":
      return rec.derived.health?.total ?? -1;
    case "dps":
      // 与表格同一口径：**游戏面板值**（`derived.dps`），不是时间轴的实际值
      return rec.derived.dps ?? 0;
    case "name":
      return 0;
    default:
      return rec.derived.stats.cost ?? 9999;
  }
}

const shown = computed(() => {
  const wantCommander = Boolean(props.commandersOnly);
  const allowed = props.only === undefined ? null : new Set(props.only);

  const list = records.value.filter((rec) => {

    if (allowed !== null && !allowed.has(rec.id)) return false;
    if (faction.value && rec.faction !== faction.value) return false;
    if (rarity.value && (rec.pb?.rarity ?? "") !== rarity.value) return false;
    // 类型：空字符串（总部这类 `unit_type` 缺失的）只在"全部类型"下出现
    if (type.value && (rec.derived.stats.unit_type ?? "") !== type.value) return false;
    /*
     * 隐藏单位（后缀 ST / CR / mayhem）。
     * **默认隐藏** —— 它们是特殊/活动变体，混在正常阵容里会把列表撑成两倍且难比。
     */
    const isHidden = rec.derived.stats.hidden === true;
    if (hiddenMode.value === "hide" && isHidden) return false;
    if (hiddenMode.value === "only" && !isHidden) return false;
    return true;
  });

  const by = sort.value;
  list.sort((a, b) => {
    if (by === "name") {
      return (a.name_zh ?? a.name_en ?? a.id).localeCompare(b.name_zh ?? b.name_en ?? b.id, "zh");
    }
    if (by === "cost") {
      const ca = a.derived.stats.cost ?? 9999;
      const cb = b.derived.stats.cost ?? 9999;
      if (ca !== cb) return ca - cb;
      return (a.name_zh ?? a.id).localeCompare(b.name_zh ?? b.id, "zh");
    }
    return sortKey(b) - sortKey(a);
  });
  return list;
});

const total = computed(() =>
  records.value.length,
);

/**
 * 分组后的分节。`group === "none"` 时返回 `null`（走平铺那条路）。
 *
 * 组的顺序按 `TYPE_ORDER` 固定（步兵→载具→空军→建筑→采集车），不按数量排 ——
 * 顺序固定，翻页/筛选时才不会跳来跳去。**组内用当前排序**（默认按造价）。
 * 未知类型（如总部那种 `unit_type` 缺失的）排最后。
 */
const sections = computed(() => {
  if (group.value === "none") return null;
  const keyOf = (r: DatasetEntry) =>
    group.value === "faction" ? r.faction : (r.derived.stats.unit_type ?? "");
  const map = new Map<string, DatasetEntry[]>();
  for (const rec of shown.value) {
    const k = keyOf(rec);
    const arr = map.get(k);
    if (arr) arr.push(rec);
    else map.set(k, [rec]);
  }
  const order = group.value === "faction" ? ["GDI", "NOD"] : TYPE_ORDER;
  const known = order.filter((k) => map.has(k));
  const rest = [...map.keys()].filter((k) => !order.includes(k)).sort();
  return [...known, ...rest].map((k) => ({
    key: k || "（无类型）",
    label: group.value === "faction" ? k : (TYPE_LABEL[k] ?? (k || "其他")),
    items: map.get(k)!,
  }));
});

/** 顶部汇总：当前筛选下每档造价的单位数，方便一眼看出曲线形状。 */
const costSpread = computed(() => {
  const map = new Map<number, number>();
  for (const rec of shown.value) {
    const c = rec.derived.stats.cost;
    if (c === undefined) continue;
    map.set(c, (map.get(c) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
});
</script>

<template>
  <div class="filters">
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
    <select v-model="type">
      <option value="">全部类型</option>
      <option v-for="t in TYPE_ORDER" :key="t" :value="t">{{ TYPE_LABEL[t] }}</option>
    </select>
    <select v-model="hiddenMode">
      <option value="hide">不显示隐藏单位</option>
      <option value="only">只显示隐藏单位</option>
      <option value="all">全部单位</option>
    </select>
    <select v-model="sort">
      <option value="cost">按造价</option>
      <option value="name">按名称</option>
      <option value="hp">按总血</option>
      <option value="dps">按 DPS</option>
    </select>
    <select v-model="group">
      <option value="type">按类型分组</option>
      <option value="faction">按阵营分组</option>
      <option value="none">不分组</option>
    </select>
  </div>

  <p v-if="loading" class="muted">正在加载…</p>
  <template v-else>
    <p v-if="!shown.length" class="muted">没有符合筛选条件的条目。</p>

    <!-- 分组：每节一个小标题 + 数量，节内仍是一张网格 -->
    <template v-else-if="sections">
      <section v-for="s in sections" :key="s.key" class="section">
        <h3 class="sec-head">
          {{ s.label }}<span class="sec-count">{{ s.items.length }}</span>
        </h3>
        <div class="grid">
          <UnitCard
            v-for="rec in s.items"
            :key="rec.id"
            :unit="rec"
            :level="levelOf()"
            :fields="['type', 'level', 'faction', 'cost', 'name']"
            :pickable="pickable"
            :picked="picked?.includes(rec.id)"
            @pick="emit('pick', $event)"
          />
        </div>
      </section>
    </template>

    <div v-else class="grid">
      <UnitCard
        v-for="rec in shown"
        :key="rec.id"
        :unit="rec"
        :level="levelOf()"
        :fields="['type', 'level', 'faction', 'cost', 'name']"
        :pickable="pickable"
        :picked="picked?.includes(rec.id)"
        @pick="emit('pick', $event)"
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

/*
 * 窄屏卡片墙。
 *
 * 原先只有一档 `minmax(170px, 210px)` + 28px 间隙 —— 两列需要 170×2 + 28 = 368px，
 * 而 390 宽的手机上 `main` 内容区只有 354px（`padding: 0 18px`），于是**永远只排 1 列**，
 * 每张卡撑到 210px 宽，86 张卡竖着排成一条极长的滚轴。
 *
 * 目标密度（用户要求）：**手机一屏 3~4 列**。
 * 列数由 `auto-fill` 算，所以关键是把列宽上限压到 82px、间隙压到 12px：
 *   可用宽 W = 视口 − main 左右各 12 − grid 左右各 10
 *   360 → W=316：3 列（4 列要 4×82+3×12=364 > 316）
 *   390 → W=346：3 列（卡宽 ≈107px）
 *   414 → W=370：4 列（卡宽 ≈85px）
 *   430 → W=386：4 列
 *
 * 卡片内部所有尺寸都用 `cqw`（卡宽的 1%）表达，缩小列宽后角标/边框/字号
 * **整体等比缩小**，不会出现「卡小了但角标没大」的错位；中文名另有 9px 下限
 * （见 `UnitCard.vue` 的 `.zh`），否则 85px 卡上会掉到 5px。
 *
 * ⚠️ 间隙不能压到 12px 以下：角标按 `--over: 24%` 探出卡外，两列相邻的角标
 * 相加约需 `24%×24cqw + 24%×16cqw ≈ 10% 卡宽`（107px 卡 ≈ 10.3px），12px 刚好让开。
 */
@media (max-width: 820px) {
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(82px, 1fr));
    gap: 14px 12px;
    padding: 6px 10px 2px;
  }
  .filters {
    gap: 6px;
  }
}
</style>
