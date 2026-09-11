<script setup lang="ts">
/**
 * 开火时序条 —— 一把武器（含小队成员）什么时候造成伤害。
 *
 * **模型**：每个队员各自按 `t = i × 错开 + k × 周期` 开火（`i` 是队员序号、
 * `k` 是轮次）。数据里**没有任何分组逻辑**，所以：
 *
 *   攻击摩托  错开 250 / 周期 4250  → 三人 0.5s 内打完，然后等 3.75s（爆发）
 *   狂信徒    错开 750 / 周期  850  → 相位漂移，1500/1600/1700 挤成"三人齐射"
 *   游侠      错开 100 / 周期 2700  → 几乎同时，齐射
 *
 * **横轴跨度**：`max(周期, (人数-1) × 错开)`。
 *
 * ⚠️ **修正一处算错的说法**：这里原写「绝大多数小队 `错开×人数 == 周期`（步枪兵
 * 344×5=1720=周期）」，但跨度是 `错开 × (人数-1)`，步枪兵应为 344×4 = **1376 ≠ 1720**。
 * 按 `错开×(N-1) / 周期` 全量统计（25 个小队单位）：
 *   · `== 周期`（均匀铺满）：**0 个** —— 没有一个小队是完全均匀的
 *   · `< 周期`（打一波再等）：**22 个** —— 步枪兵 1376/1720、攻击摩托 500/4250…
 *   · `> 周期`（相位漂移）：**3 个** —— 忏悔者 2000/400（**5 倍漂移**）、狂热者 1500/850、生化战士 600/500
 *
 * **所以必须画全部队员的条** —— 只画一条会把「脉冲式输出」和「相位漂移」整个藏掉，
 * 而那正是小队最反直觉的部分。见 findings I166。
 *
 * **每名队员一条彩色条**，条上按时长比例分「前摇 / 冷却」两段 —— 前摇是周期
 * **末尾**的那一段（见 docs/data-semantics.md 第 5 节），不是前置相加。
 * 伤害落点用金色三角标出，悬停显示精确毫秒。
 */
import { computed } from "vue";

const props = defineProps<{
  /** 开火周期（秒） */
  cycle: number;
  /** 小队成员开火错开（毫秒）；单人单位传 0 */
  separationMs: number;
  /** 小队人数 */
  waveSize: number;
  /** 周期末尾的前摇（秒） */
  chargeUp: number;
}>();

const cycleMs = computed(() => props.cycle * 1000);
const chargeMs = computed(() => props.chargeUp * 1000);

const spanMs = computed(() => {
  const cyc = cycleMs.value;
  // 最后一名队员要能放下「前摇 + 开火」，所以是 (人数-1)×错开 + 前摇；
  // 单人/常规小队取一个周期即可
  const last = Math.max(0, props.waveSize - 1) * props.separationMs + chargeMs.value;
  return Math.max(cyc, last) || 1;
});

const pct = (ms: number) => `${(ms / spanMs.value) * 100}%`;

interface Segment {
  kind: "cooldown" | "charge";
  left: string;
  width: string;
  ms: number;
}

interface Member {
  index: number;
  shots: Array<{ ms: number; pct: string; nth: number }>;
  /** 该队员自己的彩色条：每轮「前摇 → 冷却」两段 */
  segments: Segment[];
}

/**
 * 每名队员一条轴。
 *
 * 顺位是 **前摇 → 开火 → 冷却**：前摇是开火**之前**的蓄力，必须画在伤害点左边。
 * （早先版本把标记放在周期开头、前摇放在周期末尾，结果前摇跑到伤害点后面了。）
 *
 * 每名队员按自己的相位 `i × 错开` 排，所以 `segments` 是逐队员算的，不能共用。
 */
const members = computed<Member[]>(() => {
  const n = Math.max(1, props.waveSize);
  const cyc = cycleMs.value;
  const cu = chargeMs.value;

  return Array.from({ length: n }, (_, i) => {
    const phase = i * props.separationMs;
    const shots: Member["shots"] = [];
    const segments: Segment[] = [];

    for (let k = 0; ; k++) {
      const base = phase + k * cyc;
      if (base > spanMs.value + 0.5) break;

      // 前摇：base .. base+cu
      const cuEnd = Math.min(base + cu, spanMs.value);
      if (cuEnd > base) {
        segments.push({ kind: "charge", left: pct(base), width: pct(cuEnd - base), ms: Math.round(cuEnd - base) });
      }
      // 开火就在前摇结束的那一刻
      shots.push({ ms: Math.round(cuEnd), pct: pct(cuEnd), nth: k + 1 });
      // 冷却：前摇结束 .. 下一轮开始（末尾可能被跨度截断）
      const cdEnd = Math.min(base + cyc, spanMs.value);
      if (cdEnd > cuEnd) {
        segments.push({ kind: "cooldown", left: pct(cuEnd), width: pct(cdEnd - cuEnd), ms: Math.round(cdEnd - cuEnd) });
      }
      if (cyc <= 0) break;
    }
    return { index: i + 1, shots, segments };
  });
});

const multi = computed(() => props.waveSize > 1);
/** 错开 × 人数 超过一个周期 → 会跨轮重叠 */
const overlaps = computed(() => multi.value && props.separationMs * props.waveSize > cycleMs.value);
const cyclesDrawn = computed(() => Math.ceil(spanMs.value / cycleMs.value - 1e-6));
</script>

<template>
  <div class="timeline">
    <div class="rows">
      <div v-for="m in members" :key="m.index" class="row">
        <span class="who">{{ multi ? `队员 ${m.index}` : "开火" }}</span>
        <span class="track">
          <!-- 每个人一条彩色条：前摇 → 冷却，顺序与「开火在中间」一致 -->
          <i
            v-for="(s, j) in m.segments"
            :key="`s${j}`"
            class="seg"
            :class="s.kind"
            :style="{ left: s.left, width: s.width }"
            :title="`${s.kind === 'charge' ? '前摇' : '冷却'} ${s.ms} ms`"
          />
          <!-- 伤害落点 -->
          <i
            v-for="(s, j) in m.shots"
            :key="`m${j}`"
            class="shot"
            :style="{ left: s.pct }"
            :title="`队员 ${m.index} 第 ${s.nth} 发：${s.ms} ms`"
          >
            <em>伤害 {{ s.ms }}ms</em>
          </i>
        </span>
      </div>
    </div>

    <p class="axis">
      <span>0</span>
      <span>{{ (spanMs / 1000).toFixed(2) }}s</span>
    </p>

    <p class="hint">
      周期 <b>{{ cycle }}s</b>
      <template v-if="multi">　·　{{ waveSize }} 名队员每 <b>{{ separationMs }} ms</b> 一名</template>
      <template v-if="chargeUp">　·　<span class="k charge" />前摇 <b>{{ chargeUp }}s</b>（开火前蓄力）</template>
      <span class="k cooldown" />冷却
      <template v-if="cyclesDrawn > 1">
        　·　横轴铺了 <b>{{ cyclesDrawn }}</b> 个周期（因为错开×人数超出周期）
      </template>
    </p>
    <p v-if="overlaps" class="warn-line">
      ⚠ 全员轮完需 {{ ((separationMs * waveSize) / 1000).toFixed(2) }}s，<b>超过一个周期</b>，会跨轮重叠
    </p>
  </div>
</template>

<style scoped>
.timeline {
  margin: 4px 0 10px;
}
.rows {
  border: 1px solid var(--line, #2a3550);
  border-radius: 6px;
  background: #171c26;
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
}
.row + .row {
  border-top: 1px solid #232b3d;
}
.who {
  flex: 0 0 46px;
  font-size: 10px;
  color: #7f8aa6;
}
.track {
  position: relative;
  flex: 1 1 auto;
  height: 16px;
  border-radius: 3px;
  background: #10141c;
}
.seg {
  position: absolute;
  top: 2px;
  bottom: 2px;
}
.seg.cooldown {
  background: #4a6da8;
}
.seg.charge {
  background: #d8a13c;
}
.shot {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 2;
}
.shot::before {
  content: "";
  display: block;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 8px solid #ffd479;
  filter: drop-shadow(0 0 2px #000c);
}
.shot em {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 100%;
  font-style: normal;
  font-size: 9px;
  line-height: 1;
  padding: 1px 4px;
  border-radius: 3px;
  background: #ffd479;
  color: #1a1408;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.12s;
  pointer-events: none;
}
.shot:hover em {
  opacity: 1;
}

.axis {
  display: flex;
  justify-content: space-between;
  margin: 2px 0 0;
  font-size: 10px;
  color: #6b7a99;
}
.hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: #7f8aa6;
}
.hint b {
  color: #b9c4dc;
  font-weight: 600;
}
.hint .k {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin: 0 4px 0 0;
  vertical-align: -1px;
}
.k.charge {
  background: #d8a13c;
}
.k.cooldown {
  background: #4a6da8;
  margin-left: 8px;
}
.warn-line {
  margin: 3px 0 0;
  font-size: 11px;
  color: #f0a35e;
}
</style>
