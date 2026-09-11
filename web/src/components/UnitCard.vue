<script setup lang="ts">
/**
 * 单位卡片 —— 长得像游戏里那张可点的卡。
 *
 * **入参：`unit` + `level`（可选）+ `fields`（可选）**
 *   - `unit`：完整单位记录（卡面、名称、造价、阵营、稀有度、兵种全在里面）
 *   - `level`：`{ major, minor }` 单独一个对象，**可选**。不传就不画等级角标
 *     （商店预览、卡组缩略图这些场景不需要等级）。等级是全局滑块推出来的，
 *     和具体单位无关，所以不塞进 unit 里
 *   - `fields`：要显示哪些**可选信息**。游戏里同一张卡在不同场景露的信息不同
 *     （商店 / 卡组编辑 / 对战 HUD / 详情页），所以做成可选项而不是写死
 *
 * 可选信息的位置是**固定**的（和游戏一致），不随 fields 的书写顺序变：
 *
 *     ┌───────────────────────┐
 *     │ [兵种]         [等级] │  type    → 左上
 *     │                       │  level   → 右上（需传 level）
 *     │        卡面图          │  faction → 左下
 *     │                       │  cost    → 右下
 *     │ [阵营]         [费用] │
 *     ├───────────────────────┤
 *     │        单位名称        │  name    → 图下方
 *     └───────────────────────┘
 *
 * 组件**不算数值**（总血 / DPS 那些属于 `UnitStats`），也不读全局状态 ——
 * 给什么等级就画什么等级，同一张卡可以同时以不同等级出现在同一页上。
 */
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import { baseUnitType } from "@rivals/core/types";
import type { DatasetEntry } from "@rivals/core/derive";
import type { Level } from "@rivals/core/levels";

import { factionIconUrl, tiberiumIconUrl, unitIconUrl } from "../assets.ts";
import { detailPath } from "../router.ts";
import LevelBadge from "./LevelBadge.vue";
import TypeIcon from "./TypeIcon.vue";

export type CardField = "type" | "level" | "faction" | "cost" | "name";

const props = withDefaults(
  defineProps<{
    unit: DatasetEntry;
    /** 可选：不传则连 `fields` 里有 "level" 也不画角标 */
    level?: Level;
    /** 默认只露「名称 + 造价」，就是游戏商店里那张卡的样子 */
    fields?: CardField[];
  }>(),
  { fields: () => ["name", "cost"] as CardField[] },
);

const has = (f: CardField) => props.fields.includes(f);

/**
 * 兵种：优先 `override_harvester`。
 * 运矿车的 `tags` 是 `[Vehicle, override_harvester, override_vehicle]`，
 * 直接用 `baseUnitType()` 会得到 Vehicle，但游戏里运矿车有单独的图标。
 */
const unitType = computed(() => {
  const tags = props.unit.derived.stats.tags ?? [];
  if (tags.includes("override_harvester")) return "Harvester";
  return baseUnitType(props.unit) ?? "";
});

const name = computed(
  () => props.unit.name_zh || props.unit.name_en || props.unit.id.replace(/^(unit|cmdr)_/, ""),
);
const nameEn = computed(() => props.unit.name_en ?? "");
const showNameEn = computed(() => has("name") && nameEn.value.length > 0 && nameEn.value !== name.value);

const rarity = computed(() => props.unit.pb?.rarity ?? "");
const cost = computed(() => props.unit.derived.stats.cost);

/**
 * 卡面缺失时回退。
 *
 * 用运行时 `@error` 而不是硬编码「哪些 id 没图」—— 后者每加一个缺图单位都要改代码，
 * 而且改漏了就会在页面上留一个破图。
 */
const iconFailed = ref(false);
watch(
  () => props.unit.id,
  () => {
    iconFailed.value = false;
  },
);
</script>

<template>
  <RouterLink
    class="card"
    :class="[`f-${unit.faction.toLowerCase()}`, rarity ? `r-${rarity.toLowerCase()}` : 'r-none']"
    :to="detailPath(unit.id)"
    :title="nameEn && nameEn !== name ? `${name} · ${nameEn}` : name"
  >
    <!--
      .frame 只负责当角标的定位参照，不裁剪；.art 只负责把卡面裁进圆角。
      分开的原因：角标要**镶嵌在边框的角上**，就得能压到 .art 的边框之外，
      而 .art 上的 `overflow: hidden`（裁剪卡面圆角用）会把它们切掉。
    -->
    <div class="frame">
      <div class="art">
        <img
          v-if="!iconFailed"
          class="face"
          :src="unitIconUrl(unit.id)"
          :alt="name"
          loading="lazy"
          @error="iconFailed = true"
        />
        <span v-else class="no-art">无卡面</span>
      </div>

      <!-- 左上：兵种（内联 SVG，圆底跟随阵营色） -->
      <TypeIcon v-if="has('type') && unitType" class="badge tl" :type="unitType" />

      <!-- 右上：等级（level 可选，没传就不画） -->
      <LevelBadge v-if="has('level') && level" class="badge tr" variant="mini" :level="level" />

      <!-- 左下：阵营 -->
      <img
        v-if="has('faction')"
        class="badge bl"
        :src="factionIconUrl(unit.faction)"
        :alt="unit.faction"
      />

      <!-- 右下：费用 -->
      <span v-if="has('cost') && cost !== undefined" class="badge br cost">
        <img :src="tiberiumIconUrl()" alt="" aria-hidden="true" />{{ cost }}
      </span>
    </div>

    <div v-if="has('name')" class="caption">
      <span class="zh">{{ name }}</span>
      <span v-if="showNameEn" class="en">{{ nameEn }}</span>
    </div>
  </RouterLink>
</template>

<style scoped>
/* 卡框颜色编码稀有度，和游戏里一致 */
.card.r-common { --frame: #8d99ae; }
.card.r-rare   { --frame: #3f7fd4; }
.card.r-epic   { --frame: #9a5cd0; }
.card.r-none   { --frame: #55607a; }

.card {
  display: block;
  color: inherit;
  text-decoration: none;
  transition: transform 0.12s;

  /*
   * 卡内所有尺寸都用 cqw（= 卡宽的 1%）表达，于是整张卡是**等比缩放**的：
   * 卡片墙排 6 列还是 2 列，角标、边框、字号相对卡面的大小都不变。
   * 用固定 px 的话，卡面一放大角标就显得越来越小 —— 这是踩过的坑。
   */
  container-type: inline-size;
}
.card:hover {
  transform: translateY(-2px);
}
.card:hover .art {
  box-shadow: 0 0 0 0.8cqw var(--frame), 0 2cqw 6cqw #0008;
}

.frame {
  position: relative;
}

.art {
  aspect-ratio: 270 / 324; /* data/img/ 里 99 张卡面统一是这个比例，见 findings E41 */
  border-radius: 3cqw;
  border: 0.9cqw solid var(--frame);
  overflow: hidden;
  background: #0b1020;
}

.face {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.no-art {
  display: grid;
  place-items: center;
  height: 100%;
  font-size: 4.5cqw;
  color: #6b7a99;
}

/*
 * 四角覆盖层：骑在角的顶点上，一小部分探到卡外，把角盖住。
 *
 * `--over` 是「探出量占角标自身尺寸的比例」。注意它不是露出面积：
 * 圆形角标的圆心若正好落在角的顶点（`--over: 50%`），圆只有 1/4 面积在卡内
 * —— 也就是 3/4 都露在外面，视觉上会觉得「几乎整个飞出去了」。
 * 实测 24% 大约是「三成面积在外、七成盖住卡角」，比较耐看。
 *
 * 定位用 `translate(±over, ±over)`；绝对定位不参与布局，卡片再窄也不会被挤变形。
 * 探出的部分会占掉网格间隙，`Arsenal` 的 gap 要留够。
 */
.badge {
  --over: 24%;
  position: absolute;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.8cqw;
  line-height: 1;
  margin: 0;
}
.tl { top: 0; left: 0; transform: translate(calc(-1 * var(--over)), calc(-1 * var(--over))); width: 16cqw; }
.tr { top: 0; right: 0; transform: translate(var(--over), calc(-1 * var(--over))); width: 24cqw; } /* 等级圈 */
.bl { bottom: 0; left: 0; transform: translate(calc(-1 * var(--over)), var(--over)); width: 15cqw; }
.br { bottom: 0; right: 0; transform: translate(var(--over), var(--over)); }

.tl,
.bl {
  filter: drop-shadow(0 0.3cqw 0.7cqw #000c);
}

/* 兵种图标的圆底跟随阵营色（圆底由 TypeIcon 画，读的是 --icon-bg） */
.card.f-gdi .tl { --icon-bg: #33518f; }
.card.f-nod .tl { --icon-bg: #8e2b2b; }
.card.f-unknown .tl { --icon-bg: #4a5163; }

.cost {
  --over: 16%; /* 费用是长条，探太多会吃掉下面的名字 */
  font-size: 12cqw;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 1.2cqw 2.6cqw;
  /* 外角跟着卡框圆角走，看起来才是嵌进去而不是贴上去 */
  border-top-left-radius: 3cqw;
  border-bottom-right-radius: 3cqw;
  background: #000c;
  color: #ffd479;
  box-shadow: 0 0.3cqw 0.7cqw #000a;
}
.cost img {
  width: 11cqw;
  height: 11cqw;
  object-fit: contain;
}

.caption {
  display: flex;
  align-items: baseline;
  gap: 1.8cqw;
  /* 造价角标会往下探（≈1.3cqw），留一点高度免得压到名字 */
  margin-top: 3.2cqw;
  min-width: 0;
}
.zh {
  font-weight: 650;
  font-size: 6.2cqw;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.en {
  font-size: 4.8cqw;
  color: #7f8aa6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
