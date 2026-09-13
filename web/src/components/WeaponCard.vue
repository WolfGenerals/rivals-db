<script setup lang="ts">
/**
 * **一件武器** —— 只有三块（用户定的范围）：
 *
 * | 块 | 数据 | 说明 |
 * | --- | --- | --- |
 * | ① 伤害 | `damage[]`（分段武器每段一行） | 基础值 + 逐目标覆写，**随等级缩放**（J50） |
 * | ② 发射时序 | `timing`（只有 `cyclic` / `magazine` / `staged`） | 图（`WeaponTimingBar`）+ 话（口径写清） |
 * | ③ 弹头效果 | `warhead`（**不写 = 只打最后一个成员**） | 命中之后做什么（J55） |
 *
 * ⚠️ 数据**一律来自新格式 def**（`record.def.combatant.weapons[i]`），不再读旧 `derived`。
 * 机器转换还没吃下的部分显示在卡片底部的「待办」里（`record.defGaps`）。
 */
import { computed } from "vue";

import type { Level } from "@rivals/core/levels";
import type { WeaponDef } from "@rivals/core/model/weapon-def";
import type { CatalystTriggerDef, WarheadEffectDef } from "@rivals/core/model/warhead-def";

import { displayName } from "../display-names.ts";
import { fmtTime } from "../format.ts";
import { targetZh } from "../text.ts";
import { DPS_MODES, dpsMode } from "../state.ts";
import { defTimeline } from "../def-timeline.ts";
import {
  TARGETS,
  damageAgainst,
  damageRows,
  dpsOf,
  dpsStageLabel,
  explosionDamageView,
  hasOverrides,
  headlineTier,
  scaled,
  targetingUnknown,
  tileDamageView,
  timingView,
  volleyCount,
  volleyWord,
  warheadEntries,
  warheadLines,
} from "../weapon-view.ts";
import EffectDamageMatrix from "./EffectDamageMatrix.vue";
import WeaponDamageMatrix from "./WeaponDamageMatrix.vue";
import WeaponTimeline from "./WeaponTimeline.vue";

const props = defineProps<{
  weapon: WeaponDef;
  index: number;
  level: Level;
  /** 是否单位的主武器（源码里第一把） */
  primary?: boolean;
  /** 这个单位 def 还没转出来的东西（可能包含本武器的） */
  gaps?: string[];
  /** 小队人数与成员错开 —— 时序条要给每个队员各画一条 */
  waveSize?: number;
  separationMs?: number;
  /** 单位中文名 —— 只用来把"节奏由哪个脚本驱动"说成中文（界面不露内部脚本名） */
  unitName?: string;
}>();

const rows = computed(() => damageRows(props.weapon));
const timing = computed(() =>
  timingView(props.weapon, { ...(props.unitName === undefined ? {} : { unitName: props.unitName }) }),
);
/**
 * **时序图**：一段一轮的段 + 小队错开 —— 算式在 `web/src/def-timeline.ts`，
 * 段语义与配色与战斗时间线共用（`squad-timeline.ts` 的 `Seg`）。
 */
const timeline = computed(() =>
  defTimeline(props.weapon, {
    waveSize: props.waveSize ?? 1,
    separationMs: props.separationMs ?? 0,
  }),
);
/**
 * **弹头效果的一条一行** —— 效果名加大上色，`tile` / `explosion` 那两条再挂一个伤害矩阵。
 *
 * ⚠️ 矩阵的构造留在这里（它要等级），条目本身是 `warheadEntries()` 给的纯数据。
 */
const warheadBlocks = computed(() =>
  warheadEntries(props.weapon).map((e) => {
    const eff = e.effect;
    const matrix =
      eff?.kind === "place_modifier"
        ? tileDamageView(eff, props.level)
        : eff?.kind === "catalyst_explosion" && eff.damage !== undefined
          ? explosionDamageView(eff.damage, props.level, { ...(eff.groundOnly === undefined ? {} : { groundOnly: eff.groundOnly }) })
          : undefined;
    return { ...e, ...(matrix === undefined ? {} : { matrix }) };
  }),
);
const dpsLabel = computed(() => DPS_MODES.find((m) => m.key === dpsMode.value)?.label ?? "");
const dps = computed(() => dpsOf(props.weapon, props.level, dpsMode.value));
/** 另一个口径也一并给出 —— 两个数放一起才看得出"蓄力/装填摊掉多少" */
const dpsOther = computed(() => dpsOf(props.weapon, props.level, dpsMode.value === "avg" ? "burst" : "avg"));
const dpsOtherLabel = computed(() => (dpsMode.value === "avg" ? "爆发" : "平均"));
const dpsStage = computed(() => dpsStageLabel(props.weapon));

/** **一轮/一跳的总伤害（全队）** —— 单发 × 一轮发数 × 人数（小队每人各打各的） */
const volleyTotal = computed(
  () => scaled(props.level, headlineTier(props.weapon)?.main.base ?? 0) * volleyCount(props.weapon) * Math.max(1, props.waveSize ?? 1),
);

/** 结论行下面那句说明（只在需要解释时出现） */
const damageNote = computed(() => {
  if (targetingUnknown(props.weapon)) return "这把武器的索敌范围还没有数据，所以打谁、打多少都不确定。";
  if (props.weapon.timing.kind === "staged") {
    return `分段武器：伤害逐段变强，下面是末段的数；每段见下表（每 ${fmtTime(props.weapon.timing.stages[0]?.tickPeriodMs ?? 0)} 一次）。`;
  }
  return undefined;
});

/** 把文案里的 `\`代码\`` 与 `**加粗**` 拆成片段渲染（不用 v-html） */
function parts(text: string): Array<{ t: string; b?: boolean; c?: boolean }> {
  const out: Array<{ t: string; b?: boolean; c?: boolean }> = [];
  for (const chunk of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
    if (!chunk) continue;
    if (chunk.startsWith("**") && chunk.endsWith("**")) out.push({ t: chunk.slice(2, -2), b: true });
    else if (chunk.startsWith("`") && chunk.endsWith("`")) out.push({ t: chunk.slice(1, -1), c: true });
    else out.push({ t: chunk });
  }
  return out;
}

/** 逐目标矩阵：只有真的写了覆写才铺满五类（否则一行基础值就够） */
const showMatrix = computed(() => rows.value.some((r) => hasOverrides(r.tier?.main)));

/**
 * **这把武器打不到的目标** —— 逐目标伤害表里显示 `—`，不是显示一个数。
 *
 * ⚠️ 这是两张不同的表：**能不能打**看 `usage.canAttack`（`descriptors` 位掩码展开，
 * findings J53），**打多少**才看覆写表。步枪兵对空返回 38（基础值），但它**根本没有
 * 飞行位** ⇒ 打不到空中；照抄覆写表会显示成一个不存在的伤害。
 */
const cannotHit = computed(() => new Set(TARGETS.filter((t) => !props.weapon.usage.canAttack.includes(t))));
/** 顶部那个小标签的中文（`cyclic` / `magazine` / `staged` 是内部形状名，不直接露） */
const timingWord = computed(() => {
  switch (props.weapon.timing.kind) {
    case "cyclic":
      return "周期";
    case "magazine":
      return "弹夹";
    case "staged":
      return "分段";
    default:
      return "时序";
  }
});
</script>

<template>
  <div class="weapon" :class="{ primary }">
    <div class="head">
      <!--
        标题只写**由数据决定的序数**（单武器 = 主武器，多武器 = 武器 N）。
        ⚠️ 源码槽名（`rifle` / `gasWeapon` …）**不显示**：它是内部标识，而且同一名字
        在不同单位上是不同武器（摩托的 `rifle` 其实是双联火箭）—— 产物里也没有武器的本地化名。
      -->
      <b>{{ primary ? "主武器" : `武器 ${index + 1}` }}</b>
      <span class="tag" :class="weapon.timing.kind">{{ timingWord }}</span>
      <span v-if="weapon.selfDestruct === true" class="tag suicide" title="打完这一发自己就销毁，只有一轮">自杀式</span>
    </div>

    <!-- ① 伤害 -->
    <section class="block">
      <h4>伤害</h4>
      <div class="key">
        <div class="key-item">
          <span>{{ rows.length > 1 ? "末段单跳" : "单发" }}</span>
          <b>{{ scaled(level, headlineTier(weapon)?.main.base ?? 0) }}</b>
        </div>
        <div class="key-item">
          <span>{{ volleyWord(weapon) }}总伤害<template v-if="(waveSize ?? 1) > 1">（全队 ×{{ waveSize }}）</template></span>
          <b>{{ volleyTotal }}</b>
        </div>
        <div class="key-item">
          <span>DPS（{{ dpsLabel }}<template v-if="dpsStage">，{{ dpsStage }}</template>）</span>
          <b>{{ dps.toFixed(1) }}</b>
          <span class="alt">{{ dpsOtherLabel }} {{ dpsOther.toFixed(1) }}</span>
        </div>
      </div>
      <p v-if="damageNote" class="sub dim">{{ damageNote }}</p>

      <!-- 逐目标矩阵（五个目标各四个数，档位色）—— 与旧版同一套语言 -->
      <WeaponDamageMatrix :weapon="weapon" :level="level" :wave-size="waveSize ?? 1" />

      <!-- 分段武器：每段的数逐条列出来（矩阵画的是末段） -->
      <table v-if="rows.length > 1" class="matrix">
        <thead>
          <tr>
            <th>段</th>
            <th>每跳</th>
            <th v-for="t in TARGETS" :key="t" :class="{ no: cannotHit.has(t) }">{{ t }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.stage">
            <td class="stage">{{ r.stage }}<span class="dim">{{ r.stageLabel }}</span></td>
            <td class="num">{{ scaled(level, r.tier?.main.base ?? 0) }}</td>
            <td
              v-for="t in TARGETS"
              :key="t"
              class="num"
              :class="{ dim: !hasOverrides(r.tier?.main) || cannotHit.has(t), no: cannotHit.has(t) }"
              :title="cannotHit.has(t) ? `打不到${targetZh(t)}` : undefined"
            >
              {{ cannotHit.has(t) ? "—" : r.tier ? damageAgainst(r.tier.main, t, level) : "—" }}
            </td>
          </tr>
        </tbody>
      </table>

      <p v-if="rows.some((r) => r.tier?.side)" class="sub">
        <span class="dim">副目标</span>
        <span v-for="r in rows.filter((x) => x.tier?.side)" :key="r.stage">
          段 {{ r.stage }}：{{ scaled(level, r.tier!.side!.base) }}
          <template v-if="r.tier!.sideTargetCount !== undefined">× {{ r.tier!.sideTargetCount }} 个</template>
        </span>
      </p>
    </section>

    <!-- ② 发射时序：图（每名队员一条，段的位置关系自己说话） + 字（口径写清） -->
    <section class="block">
      <h4>发射时序 <span class="dim">{{ timing.headline }}</span></h4>
      <WeaponTimeline
        v-if="timeline.segs.length"
        :segs="timeline.segs"
        :cycle-ms="timeline.cycleMs"
        :initial-ms="timeline.initialMs"
        :span-ms="timeline.spanMs"
        :wave-size="waveSize ?? 1"
        :separation-ms="separationMs ?? 0"
        :axis-note="timeline.axisNote"
      />
      <p v-else class="sub dim">时序图画不出来（这一把的节奏还没转出来，见下面的待办）。</p>
      <ul class="lines">
        <li v-for="(l, i) in timing.lines" :key="i">
          <span v-for="(p, j) in parts(l)" :key="j" :class="{ b: p.b, c: p.c }">{{ p.t }}</span>
        </li>
      </ul>
    </section>

    <!-- ③ 弹头效果：一条一行 —— **效果名加大上色**，细节交给旁边的伤害矩阵 -->
    <section class="block">
      <h4>弹头效果</h4>
      <div v-for="(e, i) in warheadBlocks" :key="i" class="eff">
        <p class="sub">
          <b v-if="e.name !== ''" class="eff-name" :class="e.tone">{{ e.name }}</b>
          <span class="eff-detail">{{ e.detail }}</span>
        </p>
        <EffectDamageMatrix v-if="e.matrix" :view="e.matrix" :title="e.name" />
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 效果名：比正文大一档 + 按种类上色（毒气绿 / 火焰橙 / 爆炸紫 / 伤害对象蓝） */
.eff-name {
  margin-right: 6px;
  font-size: 14.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.eff-name.delivery {
  color: #8cc4ff;
}
.eff-name.gas {
  color: #b6e34a;
}
.eff-name.fire {
  color: #ffb347;
}
.eff-name.explosion {
  color: #c9a6ff;
}
.eff-detail {
  font-size: 12px;
  color: var(--dim, #9aa5b8);
  line-height: 1.6;
}
</style>

<style scoped>
.weapon {
  border: 1px solid var(--line, #2a3550);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
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
  font-weight: 400;
}
.tag {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: #22304a;
  color: #9fc0ee;
}
.tag.magazine {
  background: #3a2b4f;
  color: #c8a8f0;
}
.tag.staged {
  background: #1f4148;
  color: #8fd8e8;
}
/* 自杀式：红褐色，与"时序类型"那种中性标签区分开 */
.tag.suicide {
  background: #4a2626;
  color: #ff9b8a;
}
.idx {
  margin-left: auto;
  font-size: 11px;
  color: #6b7a99;
}

.block {
  margin-top: 8px;
}
/*
 * **区块标题**（伤害 / 发射时序 / 弹头效果）—— 用户要求："更上层的标题，要更大加粗上色"。
 * 左侧一道色条给出层级感；同一套样式在 `UnitTimeline` / `DuelPanel` / `UnitWeapons` 里保持一致
 * （第 2 步会把这套值收进 `theme.css` 的设计令牌）。
 */
.block h4 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 14px 0 8px;
  padding-left: 9px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #a8c8f0;
  border-left: 3px solid #4a9eff;
}
.block h4 .dim {
  font-size: 11.5px;
  font-weight: 400;
  color: #7f8aa6;
}

.key {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 8px;
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

.matrix {
  border-collapse: collapse;
  font-size: 12px;
  margin-bottom: 6px;
}
.matrix th,
.matrix td {
  border: 1px solid #232b3d;
  padding: 2px 8px;
  text-align: right;
}
.matrix th {
  color: #7f8aa6;
  font-weight: 500;
  background: #1b2233;
}
.matrix th.no {
  color: #4f5872;
  text-decoration: line-through;
}
.matrix td.stage {
  text-align: left;
  color: #cfd8ea;
}
.matrix td.stage .dim {
  margin-left: 6px;
}
.matrix .num {
  font-variant-numeric: tabular-nums;
}
.matrix .num.dim {
  color: #8b96b3;
}
.matrix .num.no {
  color: #5b6580;
}

.lines {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 12.5px;
  color: #b9c4dc;
}
.lines li {
  padding: 2px 0;
}
.lines .b {
  color: #ffd08a;
  font-weight: 600;
}
.lines .c {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11.5px;
  color: #9fc0ee;
  background: #1b2233;
  padding: 0 4px;
  border-radius: 3px;
}
.small {
  font-size: 12px;
}
.sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: #b9c4dc;
}
.sub > span:first-child {
  margin-right: 8px;
}

.gaps {
  margin-top: 8px;
  font-size: 11.5px;
  color: #c8a86a;
}
.gaps summary {
  cursor: pointer;
}
.gaps ul {
  margin: 4px 0 0;
  padding-left: 18px;
  color: #a89a7a;
}
.src {
  margin: 8px 0 0;
  font-size: 11px;
  color: #6b7a99;
}
</style>
