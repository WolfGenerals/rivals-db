<script setup lang="ts">
/**
 * **对战页 —— 1v1 站桩决斗**（驱动：`core/src/model/duel.ts`，视图：`web/src/duel-view.ts`）。
 *
 * ## 这一页是什么
 *
 * 两支小队贴着站、互相锁定、同时开打，**逐帧**跑一遍（部署 → 武器 → 落地结算 → 格子效果 → 死亡），
 * 然后画出来：血量折线 + 每名队员每把武器的状态条/开火刻度 + **文字版事件日志**。
 *
 * ## 这一页不是什么（页面底部原样列出，不折叠）
 *
 * **移动 / 索敌 / 射程 / 命中判定** 全部没有 —— 那是引擎侧的，Lua 里查不到（J40）。
 * 所以这里恒为"两队已在射程内、互相锁定"，**不代表游戏里会发生的事**，
 * 而是"**在这些假设下**，双方各自的节奏与伤害叠起来是什么样"。
 *
 * ## 能上场的单位
 *
 * 只有**转出新格式 `def`** 的单位（`data/units.def.json` 里有 `def` 的那些）——
 * 没有 def 就没有血量/武器/节奏，连一行都画不出来。选择器按这个列表过滤（`Arsenal` 的 `only`）。
 */
import { computed, ref, watch } from "vue";

import type { Level } from "@rivals/core/levels";
import type { UnitDef } from "@rivals/core/model/unit-def";

import Arsenal from "./Arsenal.vue";
import DuelPanel from "../components/DuelPanel.vue";
import UnitLevelPicker from "../components/UnitLevelPicker.vue";
import { duelView, runDuel } from "../duel-view.ts";
import { fmtTime } from "../format.ts";
import { isMobile, tilesToMs, walkDelay } from "../start-delay.ts";
import { displayLevel } from "../state.ts";
import { useData } from "../useData.ts";

/** 「起始行动延迟」的三档输入方式 */
type DelayMode = "none" | "time" | "walk";

const data = useData();

/** 两侧已选单位 / 是否正在选 */
const left = ref("");
const right = ref("");
const pickingLeft = ref(true);
const pickingRight = ref(true);

/** 能上场的单位：转出了新格式 def 的 */
const playable = computed(() => data.value?.defs.defIds ?? []);
const picked = computed(() => [left.value, right.value].filter(Boolean));

const recordOf = (id: string) => data.value?.defs.byId.get(id);
const defOf = (id: string): UnitDef | undefined => recordOf(id)?.def;
const nameOf = (id: string): string => {
  const r = recordOf(id);
  return r?.locale?.name_zh ?? r?.locale?.name_en ?? id;
};

/**
 * **每侧的假设**：等级 + 是否初始已部署 + 起始行动延迟（用户要求单独设置）。
 *
 * · `level` 默认跟随顶栏的全局等级；勾了「单独」才用这一侧自己的值 ——
 *   与其它页面的等级控件同一个约定（`UnitLevelPicker` 的 `independent`）。
 * · `deployed` 只对**需要部署**的单位有意义（不需要部署的单位开关不显示）。
 * · `delay` 三档：`none` 无延迟 / `time` 按时间（秒）/ `walk` 按路程（格）——
 *   `walk` 的**默认格数**由 `start-delay.ts` 按射程差与 raider 旗标算出来，
 *   **不能移动的单位**（没有移速的建筑/炮塔）不给这一档（用户定的）。
 */
const assume = {
  left: { level: ref(displayLevel()), independent: ref(false), deployed: ref(false), mode: ref<DelayMode>("none"), timeS: ref(0), tiles: ref<number | null>(null) },
  right: { level: ref(displayLevel()), independent: ref(false), deployed: ref(false), mode: ref<DelayMode>("none"), timeS: ref(0), tiles: ref<number | null>(null) },
} as const;
const sideOf = (side: "left" | "right") => assume[side];
/** 这一侧真正生效的等级 */
const levelOf = (side: "left" | "right"): Level => (assume[side].independent.value ? assume[side].level.value : displayLevel());
/** 这一侧要不要部署（不需要部署的单位不显示「初始已部署」开关） */
const needsDeploy = (side: "left" | "right"): boolean =>
  defOf(side === "left" ? left.value : right.value)?.deploy !== undefined;

/** 这一侧 / 对面的 def（算射程差与走路时间用） */
const pairOf = (side: "left" | "right"): { mine: UnitDef; theirs: UnitDef } | null => {
  const a = defOf(left.value);
  const b = defOf(right.value);
  if (a === undefined || b === undefined) return null;
  return side === "left" ? { mine: a, theirs: b } : { mine: b, theirs: a };
};
/** 「按路程」的默认格数（射程差 + 不能边跑边打的半格；手长给 0） */
function defaultTiles(side: "left" | "right"): number {
  const pair = pairOf(side);
  return pair === null ? 0 : walkDelay(pair.mine, pair.theirs).tiles;
}
/** 这一侧能不能移动（不能 ⇒ 不给「按路程」这一档） */
const mobileOf = (side: "left" | "right"): boolean => {
  const pair = pairOf(side);
  return pair !== null && isMobile(pair.mine);
};
/** 这一侧最终传给 `Duel` 的延迟（毫秒） */
function delayMs(side: "left" | "right"): number {
  const s = assume[side];
  if (s.mode.value === "time") return Math.max(0, Math.round(s.timeS.value * 1000));
  if (s.mode.value === "walk") {
    const pair = pairOf(side);
    if (pair === null) return 0;
    return tilesToMs(pair.mine, s.tiles.value ?? defaultTiles(side)) ?? 0;
  }
  return 0;
}
/** 算式说明（供「恢复默认」之类的提示用；页面正文里不再显示） */
function defaultTilesOf(side: "left" | "right"): number {
  return defaultTiles(side);
}
void defaultTilesOf;

/**
 * **移动中就不能"预先架好"**（用户定的：「需要部署的单位移动，不允许初始选择部署」）：
 * 还在赶路却说它早就架好了，是自相矛盾的 —— 所以这一档直接禁用（并强制为未勾选）。
 */
function canStartDeployed(side: "left" | "right"): boolean {
  return !(needsDeploy(side) && delayMs(side) > 0);
}

/**
 * **换单位就把手填的格数清掉，回到自动默认**（用户报的：
 * 「我手动切换按照路程的值之后，就不会自动设置了，哪怕切换了单位或者方式」）。
 *
 * 规则：`tiles === null` = 用自动默认；一旦手填就变成定值 —— 所以换单位 / 换方式时**清回 null**。
 * 换方式也在模板的 `@change` 里清（见那一处）。
 */
watch([left, right], () => {
  assume.left.tiles.value = null;
  assume.right.tiles.value = null;
});

/**
 * **跑这一场** —— 每侧的**等级**与**是否初始已部署**都能单独设（用户要求：
 * 「战斗界面允许单独设置等级 / 是否初始部署」）。
 *
 * · 等级默认跟随顶栏的全局等级（与其它页面一致），勾了「单独设置」才脱离；
 * · 「初始已部署」= 这一侧不是刚落地，而是**已经架在那儿** ⇒ 整个部署时长跳过、第一帧就能开火。
 *
 * ⚠️ 每帧 1ms（与 `core/test/duel-check.ts` 同一粒度）：时刻都是"从 0 起的毫秒"，
 * 帧大小不影响数值，只影响同一毫秒内事件的先后。
 * 上限 90s —— 两个高血量建筑互啃时，"打到时间上限"比"卡住页面"好。
 */
const run = computed(() => {
  const a = defOf(left.value);
  const b = defOf(right.value);
  if (a === undefined || b === undefined) return null;
  return runDuel(a, b, {
    levels: [levelOf("left"), levelOf("right")],
    deployed: [
      canStartDeployed("left") && assume.left.deployed.value,
      canStartDeployed("right") && assume.right.deployed.value,
    ],
    startDelay: [delayMs("left"), delayMs("right")],
    limitMs: 90_000,
  });
});

const view = computed(() => {
  const r = run.value;
  if (r === null) return null;
  return duelView(r, { names: [nameOf(left.value), nameOf(right.value)] });
});

function pick(side: "left" | "right", id: string) {
  if (side === "left") {
    left.value = id;
    pickingLeft.value = false;
  } else {
    right.value = id;
    pickingRight.value = false;
  }
}

/** 这一页**固定不做**的假设（与 `Duel.notes` 里那几条"这一场"的说明互补） */
const PAGE_CAVEATS = [
  "移动 / 寻路 / 转向：引擎侧，Lua 里没有（J40）⇒ 双方恒在原地",
  "索敌 / 射程 / 命中判定：⇒ 恒为「已接触、互相锁定、都在射程内」",
  "开火 → 命中的飞行时间：占位值，见下方「未建模」",
  "按距离衰减（离子炮 / 虎鲸那种）：需要位置 ⇒ 退化成「每人各一份」并记一条提示",
  "攻速 / 装填类 debuff（EMP）：**记录了也计时了，但节奏没变**（有效参数还没接）",
];
</script>

<template>
  <div class="battle">
    <p class="bar">
      <b>对战</b>
      <span class="muted">
        1v1 站桩决斗：部署 → 武器 → 落地结算 → 格子效果 → 阵亡，逐帧跑一遍
      </span>
      <span class="muted">
        等级 左 {{ levelOf("left").format() }} / 右 {{ levelOf("right").format() }}
        （默认跟随顶栏，可在各自那一栏单独设）
      </span>
      <span class="muted">可上场 {{ playable.length }} 个单位（转出了新格式 def 的）</span>
      <button
        v-if="picked.length"
        type="button"
        @click="((left = ''), (right = ''), (pickingLeft = true), (pickingRight = true))"
      >
        清空
      </button>
    </p>

    <div class="cols">
      <section v-for="side in (['left', 'right'] as const)" :key="side" class="col">
        <div class="col-head">
          <span class="tag" :class="side">{{ side === "left" ? "左 A" : "右 B" }}</span>
          <b v-if="(side === 'left' ? left : right)">{{ nameOf(side === "left" ? left : right) }}</b>
          <span v-else class="muted">选一个单位</span>
          <button
            v-if="(side === 'left' ? left : right) && (side === 'left' ? !pickingLeft : !pickingRight)"
            type="button"
            @click="side === 'left' ? (pickingLeft = true) : (pickingRight = true)"
          >
            换一个
          </button>
        </div>
        <div v-if="side === 'left' ? pickingLeft : pickingRight" class="wall">
          <Arsenal pickable :only="playable" :picked="picked" @pick="pick(side, $event)" />
        </div>
        <div v-else class="assume">
          <!-- **每侧单独设等级**（默认跟随顶栏的全局等级） -->
          <div class="ctl">
            <UnitLevelPicker
              v-model:level="sideOf(side).level.value"
              v-model:independent="sideOf(side).independent.value"
              :global-level="displayLevel()"
            />
          </div>
          <!--
            **初始已部署**：这一侧不是刚落地，而是已经架在那儿 ⇒ 跳过整个部署时长。
            ⚠️ **移动中不能预先架好** —— 填了起始行动延迟就禁用（用户定的）。
          -->
          <label v-if="needsDeploy(side)" class="deploy" :class="{ off: !canStartDeployed(side) }">
            <input v-model="sideOf(side).deployed.value" type="checkbox" :disabled="!canStartDeployed(side)" />
            <span>初始已部署</span>
            <span class="muted small">
              <template v-if="canStartDeployed(side)">
                （跳过 {{ fmtTime(defOf(side === "left" ? left : right)!.deploy!.unpackMs) }} 的架设）
              </template>
              <template v-else>（已经在移动，不能预先架好）</template>
            </span>
          </label>

          <!--
            **起始行动延迟**（假设项）：这一侧还没到位 ⇒ 整条时间轴右移。
            三档：无延迟 / 按时间（秒）/ 按路程（格，默认值由射程差与 raider 旗标算）。
            ⚠️ **不能移动的单位**（没有移速的建筑 / 炮塔）不给「按路程」这一档。
          -->
          <div class="ctl delay">
            <span class="lbl">起始行动延迟</span>
            <!-- 换方式也把手填的格数清掉（回到自动默认） -->
            <select v-model="sideOf(side).mode.value" @change="sideOf(side).tiles.value = null">
              <option value="none">无延迟</option>
              <option value="time">按时间</option>
              <option v-if="mobileOf(side)" value="walk">按路程</option>
            </select>
            <template v-if="sideOf(side).mode.value === 'time'">
              <input v-model.number="sideOf(side).timeS.value" type="number" min="0" step="0.1" />
              <span class="unit">s</span>
            </template>
            <template v-else-if="sideOf(side).mode.value === 'walk'">
              <input
                v-model.number="sideOf(side).tiles.value"
                type="number"
                min="0"
                step="0.5"
                :placeholder="String(defaultTiles(side))"
              />
              <span class="unit">格</span>
              <button type="button" class="mini" @click="sideOf(side).tiles.value = null">自动</button>
              <span class="muted small">= {{ (delayMs(side) / 1000).toFixed(2) }}s</span>
            </template>
          </div>

          <span class="muted small">
            {{ defOf(side === "left" ? left : right)?.squad.waveSize ?? 1 }} 员一队
            <template v-if="defOf(side === 'left' ? left : right)?.deploy">· 需部署（全队同时）</template>
          </span>
        </div>
      </section>
    </div>

    <DuelPanel v-if="view" :view="view" />
    <p v-else class="muted hint">两边都选好单位后（左侧列表里的都能跑），这里会出现时间线与事件日志。</p>

    <section class="caveats">
      <h3>这一页固定不建模的东西</h3>
      <ul>
        <li v-for="(c, i) in PAGE_CAVEATS" :key="i">{{ c }}</li>
      </ul>
      <p class="muted small">
        模型本身（`core/src/model/duel.ts`）只做「节奏 + 伤害 + 交付 + 格子效果」；
        未建模项会随每一场一起列在上面（不折叠）。
      </p>
    </section>
  </div>
</template>

<style scoped>
.battle {
  padding-top: 12px;
}
.bar {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 0 0 10px;
}
.bar button {
  padding: 3px 12px;
  font-size: 12px;
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
/* ⚠️ grid 子项必须能收缩，否则长内容撑破分栏 */
.col {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.col-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 6px;
}
.col-head button {
  margin-left: auto;
  padding: 2px 10px;
  font-size: 12px;
}
.tag {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
}
.tag.left {
  background: #1d3a5c;
  color: #8cc4ff;
}
.tag.right {
  background: #4a2a1d;
  color: #ffab7a;
}
.wall {
  /*
   * 选人墙**至少一屏高**（用户：「卡片墙太短，至少一个屏幕长」）——
   * 减去的是顶栏 + 页面工具条 + 两栏标题占掉的高度（80px 顶栏 + 90px 页头 + 30px 余量）。
   * 内部滚动，所以再多的单位也不会把整页撑长。
   */
  height: max(440px, calc(100dvh - 200px));
  overflow: auto;
  border: 1px solid var(--line, #2b3038);
  border-radius: 6px;
  padding: 8px;
  background: #14181f;
}
.assume {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--line, #2b3038);
  border-radius: 6px;
  background: #171b23;
}
/* 等级选择器 / 延迟控件那一行 */
.assume .ctl {
  display: flex;
  align-items: center;
  gap: 8px;
}
.assume .delay .lbl {
  font-size: 12.5px;
  color: #cfe0f5;
}
.assume select,
.assume input[type="number"] {
  padding: 2px 6px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: #10131a;
  border: 1px solid var(--line, #2b3038);
  border-radius: 4px;
}
.assume input[type="number"] {
  width: 68px;
}
.assume .unit {
  font-size: 12px;
  color: var(--dim, #9aa5b8);
}
/* 「初始已部署」勾选：不要被上面的 input 宽度规则撑成输入框 */
.assume label.deploy {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12.5px;
  cursor: pointer;
}
/* 移动中：这一档被禁用（点不动、字变灰） */
.assume label.deploy.off {
  cursor: not-allowed;
  opacity: 0.55;
}
.assume label.deploy input {
  width: auto;
  margin: 0;
  accent-color: var(--accent, #4da8ff);
}
/* 「自动」小按钮：把手填的格数清掉、回到默认值 */
.assume button.mini {
  padding: 1px 7px;
  font-size: 11px;
  color: #cfe0f5;
  background: #1d3a5c;
  border: 1px solid #2f6fa8;
  border-radius: 10px;
  cursor: pointer;
}
.small {
  font-size: 11px;
}
.muted,
.dim {
  color: var(--dim, #9aa5b8);
}
.hint {
  margin-top: 16px;
}
.caveats {
  margin-top: 22px;
  padding: 10px 12px;
  border: 1px solid #4a3a1d;
  border-radius: 6px;
  background: #1d1a12;
}
.caveats h3 {
  margin: 0 0 6px;
  font-size: 13px;
  color: #d8c07a;
}
.caveats ul {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--dim, #9aa5b8);
}
.caveats li {
  margin: 2px 0;
}
@media (max-width: 1100px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
</style>
