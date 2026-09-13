<script setup lang="ts">
/**
 * **对战面板** —— 把一场 `Duel` 的跑分结果画出来，并给出文字版事件日志。
 *
 * ## 为什么"图 + 日志"两样都要（用户要求）
 *
 * 图回答"**什么时候发生了什么**"：两侧共一根时间轴 ⇒ 谁先开火、谁先掉血、掉血是脉冲还是连续，
 * 一眼就能对上。日志回答"**这一下具体是什么**"：打了谁、扣了多少、走哪条交付路径（只打最后一员 /
 * 每人各一份）、毒气第几跳 —— 这些图里挤不下，硬塞进条内就会被窄段裁掉（时序图踩过这个坑）。
 *
 * ## 版面（从上到下）
 *
 * | 块 | 内容 |
 * | --- | --- |
 * | ① 结论 | 胜负 / 耗时 / 双方开火数 / 伤害 / 阵亡数 |
 * | ② 血量 | 两条折线（A 蓝、B 橙），纵轴是**整队总血比例**；阵亡处画竖线 |
 * | ③ 时序 | 每名队员每把武器一行：**状态段** + 条**上方**的攻击标志 + 条**下方**的死亡标志 |
 * | ④ 日志 | `时间 · 侧 · 文本`，可按**分组筛选**（开火/直击/弹头效果/阵亡/格子效果/修改/提示） |
 *
 * ## 标志沿用"以前的 icon"（用户要求）
 *
 * | 标志 | 图形 | 位置 | 说明 |
 * | --- | --- | --- | --- |
 * | **攻击** | `sword` 金剑 | 条**上方** | 每次 `firing` 一个 |
 * | **自杀式攻击** | `burst` 爆星 | 条**上方** | 这把武器 `selfDestruct`：打完这一发自己就销毁 |
 * | **死亡** | `skull` 骷髅 | 条**下方** | 被打死的那一刻（`unit_dead`，`cause = killed`） |
 *
 * ⚠️ **没有"受伤"标志**（用户：「受伤就不用了因为场地伤害不好算」）：要给每一次扣血都标一个，
 * 就得把火 / 毒气 / 爆炸的落点都算准，而那些还没有位置信息。伤害走**文字日志**与血量折线。
 *
 * ⚠️ **死亡单位的条到阵亡那一刻就结束**（用户：「死亡单位不应该有条」）：武器机在人死之后
 * 不再被驱动，最后一段会被拉到全场末尾 —— 不截断就会读成"人都死了还在冷却"。
 */
import { computed, ref } from "vue";

import type { DuelView, DuelLogGroup } from "../duel-view.ts";
import { groupLabel } from "../duel-view.ts";
import { fmtTime } from "../format.ts";
import { targetListZh, targetZh } from "../text.ts";
import MarkIcon from "./MarkIcon.vue";

const props = defineProps<{ view: DuelView }>();

const A_COLOR = "#4da8ff";
const B_COLOR = "#ffab7a";

/** 日志筛选：默认全开（"提示"这类噪声少，但默认也开着 —— 它们是未建模声明） */
const groups: DuelLogGroup[] = ["fired", "hit", "warhead", "death", "tile", "modify", "note"];
const off = ref<Set<DuelLogGroup>>(new Set());

function toggle(g: DuelLogGroup): void {
  const next = new Set(off.value);
  if (next.has(g)) next.delete(g);
  else next.add(g);
  off.value = next;
}

const shownLog = computed(() => props.view.log.filter((l) => !off.value.has(l.group)));

/** 图上实际出现的分组（没出现的按钮不画 —— 免得点了没反应） */
const shownGroups = computed(() => groups.filter((g) => props.view.logGroups.includes(g)));

/** 日志里每一类的条数（按钮上带数字，免得点了才发现是空的） */
function countOf(g: DuelLogGroup): number {
  return props.view.log.filter((l) => l.group === g).length;
}

/** 血量折线 —— `viewBox` 固定 1000×100，线段用 `non-scaling-stroke` 保证不被横轴拉伸 */
function polyline(points: Array<{ atMs: number; frac: number }>): string {
  const span = Math.max(1, props.view.spanMs);
  return points.map((p) => `${((p.atMs / span) * 1000).toFixed(2)},${((1 - p.frac) * 100).toFixed(2)}`).join(" ");
}

const outcomeText = computed(() => {
  const v = props.view;
  const [a, b] = v.sides;
  if (v.summary.outcome === "draw") return `${a.unitName} 与 ${b.unitName} 同归于尽`;
  if (v.summary.outcome === "timeout") return "到时间上限仍未分出胜负";
  const win = v.summary.outcome === "A" ? a : b;
  return `${win.unitName} 存活（剩 ${win.aliveUnits}/${win.memberCount} 员、${win.hp} 血）`;
});

const cls = computed(() => props.view.summary.outcome.toLowerCase());
</script>

<template>
  <section class="duel">
    <!-- ① 结论 -->
    <div class="outcome">
      <span class="verdict" :class="cls">{{ outcomeText }}</span>
      <span class="dim">
        耗时 {{ (view.summary.endedAtMs / 1000).toFixed(2) }}s ·
        开火 {{ view.summary.totalFired }} 发 / 命中 {{ view.summary.totalHits }} 次 ·
        合计 {{ view.summary.totalDamage }} 伤害 ·
        阵亡 {{ view.summary.totalDeaths }} 员
      </span>
      <span class="dim">开火 → 命中固定延迟 {{ fmtTime(view.summary.flightMs) }}（占位值，见下方未建模项）</span>
    </div>

    <!-- **打不到对面**的武器必须单独说一句：不然"某一方 0 伤害"会被读成算错了 -->
    <p v-if="view.blockedWeapons.length" class="blocked">
      <b>打不到对面</b>
      <span v-for="b in view.blockedWeapons" :key="`${b.side}${b.weaponId}`">
        {{ b.unitName }} 的 <b>{{ b.weaponLabel || "武器" }}</b> 打不到{{ targetZh(b.targetType) }}
        （它能打：{{ targetListZh(b.canAttack) || "未知" }}）⇒ 整场<b>一发都不会打</b>。
      </span>
      <span class="dim">射程与走位没有数据，所以这里不是射程问题，而是这类目标不在它的攻击范围内。</span>
    </p>

    <div class="stats">
      <div v-for="s in view.sides" :key="s.side" class="stat" :class="s.side === 'A' ? 'a' : 'b'">
        <b>{{ s.unitName }}</b>
        <span>{{ s.memberCount }} 员 × {{ s.members[0]?.maxHp ?? 0 }} 血 = {{ s.maxHp }}</span>
        <span>打出 {{ s.fired }} 发 / {{ s.hitsDealt }} 次命中 / {{ s.damageDealt }} 伤害</span>
        <span>承受 {{ s.hitsTaken }} 次 / {{ s.damageTaken }} 伤害 · 剩 {{ s.aliveUnits }} 员（{{ s.hp }} 血）</span>
      </div>
    </div>

    <!-- ②③ 共用一根时间轴的图 -->
    <div class="chart">
      <div class="axis">
        <span v-for="t in view.ticks" :key="t.atMs" class="tick-label" :style="{ left: `${t.left}%` }">{{ t.label }}</span>
        <span class="axis-note">横轴 = {{ (view.spanMs / 1000).toFixed(2) }}s</span>
      </div>

      <h4>血量（整队总血比例）</h4>
      <svg class="hp" viewBox="0 0 1000 100" preserveAspectRatio="none">
        <line x1="0" y1="50" x2="1000" y2="50" class="grid" vector-effect="non-scaling-stroke" />
        <polyline
          v-for="s in view.sides"
          :key="s.side"
          :points="polyline(s.hpPoints)"
          :stroke="s.side === 'A' ? A_COLOR : B_COLOR"
          vector-effect="non-scaling-stroke"
        />
        <line
          v-for="s in view.sides.filter((x) => x.killedAtMs !== null)"
          :key="`d${s.side}`"
          :x1="((s.killedAtMs ?? 0) / Math.max(1, view.spanMs)) * 1000"
          :x2="((s.killedAtMs ?? 0) / Math.max(1, view.spanMs)) * 1000"
          y1="0"
          y2="100"
          :stroke="s.side === 'A' ? A_COLOR : B_COLOR"
          stroke-dasharray="4 3"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <h4>单位状态 + 武器时序（每名队员每把武器一条）</h4>
      <p class="legend">
        <span><i class="sw deploy" />部署（架设）</span>
        <span><i class="sw ready" />已架好</span>
        <span><i class="sw charge" />前摇 / 首发充能</span>
        <span><i class="sw gap" />冷却</span>
        <span><i class="sw reload" />等装填</span>
        <span><i class="sw idle" />空转 / 等待</span>
        <span><MarkIcon class="lg atk" name="sword" :size="14" />攻击</span>
        <span><MarkIcon class="lg self" name="burst" :size="14" />自杀式攻击（打完自爆）</span>
        <span><MarkIcon class="lg skull" name="skull" :size="14" />死亡</span>
      </p>

      <!--
        每个阵营一个块：块内每行之间一条**细分隔线**，两块之间一条**更粗的**分隔线
        （用户要求：「每个单位的条之间加分割线，阵营之间的分割线更粗」）。
        块只是排版容器，行本身还是各自独立的一行。
      -->
      <div v-for="s in view.sides" :key="`g${s.side}`" class="side-block" :class="s.side === 'A' ? 'a' : 'b'">
        <!--
          **单位状态行** —— 单位级的东西（现在只有部署 / 架设），**一侧只有一条**
          （部署全队同时，不按队员错开，J81）。武器行左边那段"没被驱动"的空白，
          原因就在这条上：没架好 ⇒ 武器机根本没跑。
        -->
        <div v-if="s.unitRow.segs.length > 0" class="row unit" :class="s.side === 'A' ? 'a' : 'b'">
          <span class="who">{{ s.unitName }}</span>
          <span class="slot unit-slot">单位状态</span>
          <div class="track">
            <div class="bar">
              <span class="bar-bg" style="width: 100%" />
              <span
                v-for="(seg, k) in s.unitRow.segs"
                :key="k"
                class="seg"
                :class="seg.kind"
                :style="{ left: `${seg.left}%`, width: `${seg.width}%` }"
                :data-tip="seg.title"
              />
            </div>
            <!-- 架好那一刻：一条竖线（部署段的右边界已经在 tooltip 里写了确切时长） -->
            <span
              v-if="s.unitRow.readyAtMs !== null"
              class="ready-line"
              :style="{ left: `${(s.unitRow.readyAtMs / Math.max(1, view.spanMs)) * 100}%` }"
              :data-tip="`${s.side} ${s.unitRow.unitName}：架好（${(s.unitRow.readyAtMs / 1000).toFixed(2)}s）`"
            />
          </div>
        </div>

        <div
          v-for="r in s.rows"
          :key="r.key"
          class="row"
          :class="[r.side === 'A' ? 'a' : 'b', { dead: r.deadAtMs !== null }]"
        >
          <span class="who">{{ r.unitName }} {{ r.who }}</span>
          <span class="slot">{{ r.weaponLabel }}</span>
          <div class="track">
            <!--
              条的**底色只画到阵亡那一刻**（用户：「死亡单位不应该有条」）。
              ⚠️ **底色单独一层**（`.bar-bg`），`.bar` 自己保持整宽 —— 见下面 CSS 里那段说明：
              把 `.bar` 缩窄会让里面的段（百分比是相对**整条轴**算的）被一起压扁。
            -->
            <div class="bar">
              <span class="bar-bg" :style="{ width: `${r.barEndPct}%` }" />
              <!--
                ⚠️ **段不挂 `data-float`**：全局 `[data-float]:hover { transform: scale(1.06) }`
                会让段**横向变长** —— 横轴是时间，宽度变了就是谎报时长。
                悬停反馈由 scoped 的 `.seg:hover` 承担（提亮 + 内描边，尺寸不变）。
              -->
              <span
                v-for="(seg, k) in r.segs"
                :key="k"
                class="seg"
                :class="seg.kind"
                :style="{ left: `${seg.left}%`, width: `${seg.width}%` }"
                :data-tip="seg.title"
              />
            </div>

            <!--
              攻击 / 自杀式攻击：条**上方**的槽位（与旧战斗时间线同一套 icon 与槽位）。
              ⚠️ **提示挂在外面这层 `<span>` 上，不能挂在 `MarkIcon` 上**：
              `data-tip` 的提示框是元素的 `::after`，而 **`::after` 对 SVG 元素不生效**
              （伪元素只在 HTML 元素上渲染）—— 直接挂在图标上就"悬停了什么都不出"
              （用户：「事件图标悬浮没有提示」）。所以外层负责定位 + 提示，里层只画图形。
            -->
            <span
              v-for="m in r.shots"
              :key="`s${m.n}`"
              class="mark mark-atk"
              :class="{ self: m.mark === 'burst' }"
              :style="{ left: `${m.left}%` }"
              :data-tip="m.title"
            >
              <MarkIcon :name="m.mark" :size="14" />
            </span>

            <!-- 死亡：条**下方**的槽位（被打死用骷髅；自杀式的死亡已经由爆星表达了） -->
            <span
              v-if="r.deadAtMs !== null && r.deadCause === 'killed'"
              class="mark mark-dead"
              :style="{ left: `${(r.deadAtMs / Math.max(1, view.spanMs)) * 100}%` }"
              :data-tip="`${r.unitName} ${r.who} ${r.weaponLabel}：被打死（剩 0）`"
            >
              <MarkIcon name="skull" :size="13" />
            </span>
          </div>
        </div>
      </div>

      <div v-if="view.tiles.length" class="tiles">
        <b>格子效果</b>
        <span v-for="t in view.tiles" :key="`${t.name}${t.placedAtMs}`">
          {{ t.unitName }} 铺 {{ t.label }}（每 {{ fmtTime(t.tickMs) }} 跳 {{ t.tickDamage }}、持续
          {{ fmtTime(t.persistMs) }}）@ {{ fmtTime(t.placedAtMs) }}
        </span>
      </div>
    </div>

    <!-- ④ 文字版事件日志 -->
    <div class="log-box">
      <div class="log-head">
        <h4>文字版事件日志</h4>
        <span class="dim">共 {{ view.log.length }} 条，显示 {{ shownLog.length }} 条</span>
        <span class="filters">
          <button
            v-for="g in shownGroups"
            :key="g"
            type="button"
            :class="{ off: off.has(g) }"
            @click="toggle(g)"
          >
            {{ groupLabel(g) }} {{ countOf(g) }}
          </button>
        </span>
      </div>
      <ol class="log">
        <!-- 时间列统一走 `fmtTime`；左侧那道色条标出**是哪一队**（A 蓝 / B 红），
             正文里已经不出现 `A` / `B` 了 -->
        <li v-for="(l, i) in shownLog" :key="i" :class="[l.group, l.side === 'B' ? 'side-b' : 'side-a']">
          <span class="t">{{ fmtTime(l.atMs) }}</span>
          <span class="tag">{{ groupLabel(l.group) }}</span>
          <span class="txt">{{ l.text }}</span>
        </li>
      </ol>
    </div>

    <p v-if="view.notes.length" class="notes">
      <b>这一场里未建模的东西</b>
      <span v-for="(n, i) in view.notes" :key="i">{{ n }}</span>
    </p>
  </section>
</template>

<style scoped>
.duel {
  margin-top: 12px;
}
.outcome {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 14px;
  font-size: 13px;
}
.verdict {
  font-size: 15px;
  font-weight: 600;
}
.verdict.a {
  color: #8cc4ff;
}
.verdict.b {
  color: #ffab7a;
}
.verdict.draw,
.verdict.timeout {
  color: #d8c07a;
}
.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 8px 0 0;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 9px;
  font-size: 12px;
  color: var(--dim, #9aa5b8);
  border-radius: 5px;
  background: #171b23;
  border-left: 3px solid #2b3038;
}
.stat.a {
  border-left-color: #2f6fa8;
}
.stat.b {
  border-left-color: #a8642f;
}
.stat b {
  color: #dbe6f7;
  font-size: 12.5px;
}
.chart {
  margin-top: 14px;
  padding: 8px 10px 10px;
  background: #171b23;
  border: 1px solid var(--line, #2b3038);
  border-radius: 6px;
}
/* 区块标题：与武器卡 `WeaponCard.vue` 的 `.block h4` 同一套（更大 / 加粗 / 上色 + 左侧色条） */
h4 {
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
/* 时间轴：刻度用绝对定位铺在一条线上，与下面的条共用百分比坐标 */
.axis {
  position: relative;
  height: 14px;
  /* 与下面的 `.track` 左边界对齐：`.who` 104 + gap 6 + `.slot` 56 + gap 6 = 172 */
  margin-left: 172px;
  border-bottom: 1px solid #2b3038;
}
.tick-label {
  position: absolute;
  bottom: 2px;
  transform: translateX(-50%);
  font-size: 9.5px;
  color: #7f8aa6;
  white-space: nowrap;
}
.axis-note {
  position: absolute;
  right: 0;
  bottom: 2px;
  font-size: 9.5px;
  color: #7f8aa6;
}
.hp {
  display: block;
  width: calc(100% - 172px);
  height: 64px;
  /* 与行/轴同一个左边界（纵轴没有刻度标签，靠边距对齐比画一套坐标轴省事） */
  margin-left: 172px;
  background: #10131a;
  border-radius: 4px;
}
.hp polyline {
  fill: none;
  stroke-width: 1.6;
}
.hp .grid {
  stroke: #232833;
  stroke-width: 1;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 2px 0 4px;
  font-size: 10px;
  color: var(--dim, #9aa5b8);
}
.legend span {
  display: flex;
  align-items: center;
  gap: 4px;
}
.sw {
  display: inline-block;
  width: 10px;
  height: 8px;
  border-radius: 2px;
}
.sw.charge {
  background: #8a7434;
}
.sw.gap {
  background: repeating-linear-gradient(45deg, #1d3a5c, #1d3a5c 3px, #2f6fa8 3px, #2f6fa8 6px);
}
.sw.reload {
  background: #5a3a3a;
}
.sw.idle {
  background: #2b3038;
}
.sw.deploy {
  background: repeating-linear-gradient(45deg, #3a2a55, #3a2a55 3px, #5b3f86 3px, #5b3f86 6px);
}
.sw.ready {
  background: #1d4a48;
}
/* ⚠️ 图例里的标志**用同一个 `MarkIcon`**（同一份图形定义），不另画色块 —— 否则迟早不一致 */
.lg {
  position: static;
  transform: none;
  flex: 0 0 auto;
}
.lg.atk {
  color: #ffcc55;
}
.lg.self {
  color: #ffe08a;
}
.lg.skull {
  color: #ff5555;
}
/*
 * **阵营块**：块内每行之间一条细分隔线；两块之间一条**更粗的**分隔线
 * （用户要求：「每个单位的条之间加分割线，阵营之间的分割线更粗」）。
 */
.side-block {
  position: relative;
}
.side-block + .side-block {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 2px solid #3c4657;
}
.row + .row {
  border-top: 1px solid #1f242d;
}
/*
 * 一行的高度与几何（像素）—— 标志要**伸出条子上下**，所以行比分栏高：
 *
 * ```
 *   ┌ 攻击 / 自杀式攻击图标（中心 = 条顶 − 10）     行高 32
 *   │ 条 8px（条顶 = 行顶 + 16）
 *   └ 死亡图标（中心 = 条顶 + 12，会略微越到下一条的留白里）
 * ```
 * `.track` 用 `margin-top` 把条推到下半部分，上面 16px 留给攻击标志；
 * 行间距给 6px，正好接得住越界 2.5px 的骷髅。
 */
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
}
/*
 * 标签列要**放得下单位名 + 队员号**（`步枪兵 队员 5` ≈ 8 个汉字宽）——
 * 早先只有 46px，于是"单位名"和"队员 N"被折成两行（用户报的）。
 * 左栏总宽 = `.who` 104 + gap 6 + `.slot` 56 + gap 6 = **172px**（下面轴与血量图的左边距跟着改）。
 */
.who {
  width: 104px;
  flex: none;
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* 队伍配色：左（A）蓝、右（B）红 —— 与统计块、胜者文字同一套 */
  color: #8cc4ff;
}
.row.b .who {
  color: #ff9b8a;
}
/*
 * 死掉的那一行：**保留队伍色，只压暗一档**（用户：「阵亡行也保留队伍色因为我们看不到过程，
 * 只不过比正常暗」）—— 早先直接涂成灰的，等于把"哪一队"这条信息也抹掉了。
 */
.row.dead.a .who {
  color: #56789c;
}
.row.dead.b .who {
  color: #a86e5c;
}
.row.dead.a .slot {
  color: #4c6a8a;
}
.row.dead.b .slot {
  color: #8a6152;
}
.slot {
  width: 56px;
  flex: none;
  overflow: hidden;
  font-size: 10px;
  color: #7f8aa6;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 武器列也跟队伍走色，但要压暗一档（标签才是主角） */
.row.a .slot {
  color: #6f9dd0;
}
.row.b .slot {
  color: #c08a72;
}
.track {
  position: relative;
  flex: 1;
  height: 8px;
  margin-top: 16px;
}
/*
 * ⚠️ **`.bar` 必须保持"整宽"，只作定位容器** —— 里面的 `.seg` 用的是**相对整条轴**的百分比
 * （`duel-view.ts` 里按 `spanMs` 算的）。曾经把"死亡截断"直接做成 `.bar { width: endMs }`，
 * 于是死人那几行（摩托 3 名队员全死）里所有段的百分比都被**又乘了一次 26%**，
 * 段被压到行首一小块 —— 图与文字日志对不上（用户：「摩托时序条不对」「文字日志正常」）。
 * 底色是**另一个元素**（`.bar-bg`），它才需要缩窄。
 */
.bar {
  position: absolute;
  inset: 0;
}
.bar-bg {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: #10131a;
  border-radius: 4px;
}
.seg {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 3px;
  /* 悬停只加亮 + 内描边（**不用 transform**：段带 data-tip，父级变换会把提示文字一起拉长） */
  transition:
    filter 0.1s ease-out,
    box-shadow 0.1s ease-out;
}
.seg:hover {
  filter: brightness(1.5);
  box-shadow: inset 0 0 0 2px #ffffff7a;
  z-index: 3;
}
.seg.charge {
  background: repeating-linear-gradient(45deg, #6b5a2a, #6b5a2a 4px, #8a7434 4px, #8a7434 8px);
}
.seg.gap {
  background: repeating-linear-gradient(45deg, #1d3a5c, #1d3a5c 4px, #2f6fa8 4px, #2f6fa8 8px);
}
.seg.reload {
  background: repeating-linear-gradient(45deg, #3a2a2a, #3a2a2a 4px, #5a3a3a 4px, #5a3a3a 8px);
}
.seg.idle {
  background: #2b3038;
}
/* 部署 / 架设：紫色斜纹（与单位页那条**部署**段同一个颜色语义） */
.seg.deploy {
  background: repeating-linear-gradient(45deg, #3a2a55, #3a2a55 4px, #5b3f86 4px, #5b3f86 8px);
}
/* 已架好：暗青实心（"这段时间它是架着的"，不是"在等"） */
.seg.ready {
  background: #1d4a48;
}
/* 架好那一刻的竖线 */
.ready-line {
  position: absolute;
  top: -3px;
  width: 1px;
  height: 14px;
  background: #6fd3e0aa;
  pointer-events: auto;
}
/* 单位状态行的标签换一种写法（不是武器槽名） */
.unit-slot {
  color: #b79af0;
}
/* 单位状态行：底色带一条极淡的横线，跟武器行区分开 */
.row.unit {
  height: 28px;
  margin-bottom: 2px;
}
.row.unit .track {
  margin-top: 12px;
}
/*
 * 标志（图形在 `web/src/icons.ts` 的 `MARK_ICONS`，与单位页/旧战斗时间线**同一份**）：
 * `left` 是时刻、`top` 是相对**条顶**的偏移，所以用 `translate(-50%, -50%)` 居中到那一格。
 * 颜色沿用旧战斗时间线：攻击金、自杀式爆星亮黄、死亡红。
 */
/*
 * 事件图标 = **外层 `<span>`（管定位 + `data-tip`） + 里层 SVG（只画图形）**。
 * 之所以要多包一层：`data-tip` 的提示框是 `::after`，而伪元素对 SVG 不生效。
 * 颜色写在**外层**上（`currentColor` 会被里层 SVG 继承），所以 `color` 仍然按种类走。
 */
.mark {
  position: absolute;
  display: block;
  line-height: 0;
  transform: translate(-50%, -50%);
  opacity: 0.85;
  z-index: 5;
}
/*
 * ⚠️ **悬停不加任何"光辉"**（用户：「图标的悬浮提示有不应该有的'光辉'效果」）：
 * 事件图标是**只读的标记**，不是可点的东西 —— 悬停只要把提示框显出来就够了。
 * 早先这里加了 `drop-shadow + brightness` 的发光，还会被全局 `[data-float]:hover`
 * 的 `scale` 带上缩放，两个效果叠在一起看着像"这个图标能点"。
 * 现在连 `data-float` 都不挂：既不缩放、也不发光，位置一格不动。
 */
.mark:hover {
  opacity: 1;
}
/* 攻击：金剑（条上方） */
.mark-atk {
  top: -10px;
  color: #ffcc55;
}
/* 自杀式攻击：亮黄爆星（与攻击同槽位 —— "我打完之后我炸了"，不是"我挨了一下"） */
.mark-atk.self {
  color: #ffe08a;
  opacity: 0.9;
}
/* 死亡：红骷髅（条下方） */
.mark-dead {
  top: 12px;
  color: #ff5555;
}
.tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--dim, #9aa5b8);
}
.tiles b {
  color: #dbe6f7;
}
.log-box {
  margin-top: 12px;
  border: 1px solid var(--line, #2b3038);
  border-radius: 6px;
  background: #14181f;
}
.log-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid #2b3038;
}
.log-head h4 {
  margin: 0;
}
.log-head .filters {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-left: auto;
}
.log-head button {
  padding: 2px 8px;
  font-size: 11px;
  color: #cfe0f5;
  background: #1d3a5c;
  border: 1px solid #2f6fa8;
  border-radius: 10px;
  cursor: pointer;
}
.log-head button.off {
  color: #7f8aa6;
  background: #1a1e26;
  border-color: #2b3038;
}
.log {
  max-height: 320px;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  list-style: none;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
}
.log li {
  display: flex;
  gap: 8px;
  padding: 1px 10px;
  white-space: nowrap;
}
.log li:hover {
  background: #1b212b;
}
/* 队伍色条：左（A）蓝、右（B）红 —— 正文里不再写 `A` / `B`，靠这道条区分 */
.log li.side-a {
  border-left: 2px solid #4da8ff66;
}
.log li.side-b {
  border-left: 2px solid #ff9b8a66;
}
.log .t {
  width: 62px;
  flex: none;
  color: #8ea0be;
  text-align: right;
}
/* 原来这里还有一列是 `A` / `B` —— 单位名现在写进正文里了，那一列去掉 */
.log .tag {
  width: 56px;
  flex: none;
  color: #7f8aa6;
}
.log .txt {
  flex: 1;
  min-width: 0;
  color: #cfd8e6;
}
.log li.death .txt {
  color: #ff9b8a;
}
.log li.tile .txt {
  color: #9fd8a0;
}
.log li.modify .txt {
  color: #c9a6ff;
}
.log li.note .txt {
  color: #d8c07a;
}
.log li.hit .txt {
  color: #ffd9a0;
}
/* 弹头效果那一组（催化爆炸）—— 紫色，与直击分开 */
.log li.warhead .txt {
  color: #c9a6ff;
}
.notes {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 10px 0 0;
  font-size: 11.5px;
  color: #d8c07a;
}
/* 「打不到对面」：红底 —— 它是"这一场有一方白打"的解释，比提示更硬 */
.blocked {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 8px 0 0;
  padding: 6px 10px;
  font-size: 12px;
  color: #ffc9b8;
  background: #2c1a16;
  border: 1px solid #5a2f26;
  border-radius: 5px;
}
.blocked b {
  color: #ff9b8a;
}
.blocked code {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11.5px;
  color: #ffd9a0;
}
.notes b {
  color: #ffe08a;
}
.dim {
  color: var(--dim, #9aa5b8);
}
@media (max-width: 900px) {
  .stats {
    grid-template-columns: 1fr;
  }
}
</style>
