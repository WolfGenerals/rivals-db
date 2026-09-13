/**
 * **把新格式的 `timing` 变成时间轴上的段** —— 供 `WeaponTimeline` 画。
 *
 * 段模型与配色**复用** `squad-timeline.ts` 的 `Seg`（与战斗时间线同一套语义），
 * 所以"前摇 / 开火 / 冷却 / 装填 / 分段"在两处的长相完全一致。
 *
 * ## 三种时序怎么落到段上（口径来自源码，不能改）
 *
 * | 时序 | 一轮多长 | 段 |
 * | --- | --- | --- |
 * | `cyclic` | `cooldownMs`（**轮首到轮首**） | `charge`（前摇，**在周期之内**）→ `fire`（`hits` 发，刻度逐发）→ `gap`（周期剩下的等待） |
 * | `magazine` | `reloadTimeMs`（**从弹夹第一发起算**） | `charge` → `fire`（`clipSize` 发，刻度逐发）→ `reload`（**剩余**的装填窗口） |
 * | `staged` | `initialChargeUpMs + Σ(段时长)` | `charge`（整段之前）→ 每段一个 `stage`（段内逐跳刻度） |
 *
 * ⚠️ **零宽度的开火段是故意的**（一击 / 同轮齐射没有"开火跨度"）：它的可见性由
 * 金刻度承担 —— 这是 `squad-timeline.ts` 早就定下的规矩（findings I168/I169）。
 *
 * ⚠️ **前摇与周期的关系必须靠位置表达**：常规武器的 `chargeUpMs` 从 0 起画、
 * 整轮仍等于 `cooldownMs`（"含在周期里"）；分段武器的 `initialChargeUpMs` 画在
 * 所有段**之前**，总长 = 蓄力 + 各段之和（"时间相加"）。
 */

import type { UnitDef } from "@rivals/core/model/unit-def";
import type { WeaponDef } from "@rivals/core/model/weapon-def";

import { fmtTime, fmtTimeShort } from "./format.ts";

/**
 * **时间轴上的一个段** —— 段语义全站唯一（`WeaponTimeline` / `UnitTimeline` / `DuelPanel` 共用）。
 *
 * ⚠️ **这个类型原来住在 `squad-timeline.ts`**（旧战斗时间线的模块）。那条路已经删掉
 * （`BattleTimeline` / `sim` / `sim-chart` 都没人挂载了），但段语义还得留着，所以搬到这里 ——
 * 它是"时序图"这件事的定义，不属于任何一个页面。
 *
 * | 字段 | 含义 |
 * | --- | --- |
 * | `kind` | 段色（前摇 / 开火 / 冷却 / 装填 / 部署 / 分段 / 自爆） |
 * | `at` / `ms` | 相对该队员时间轴起点的左边界与宽度（毫秒）；`fire` 的一瞬间为 0 |
 * | `ticks` | 伤害落点（毫秒，相对时间轴起点）—— 一击/齐射**只有刻度没有跨度** |
 * | `label` | 标注带上的小字（`前摇 0.1s` / `段 1` / `自爆`） |
 * | `scope` | `"member"`（默认，按队员错开）或 `"squad"`（单位级，全队同时，如部署） |
 * | `once` | 只画第一轮（一次性：部署、首发充能） |
 */
export interface Seg {
  kind: "charge" | "fire" | "gap" | "reload" | "deploy" | "stage" | "death";
  at: number;
  ms: number;
  ticks?: number[];
  title: string;
  label?: string;
  scope?: "squad" | "member";
  once?: boolean;
}

/** **标注带**上的文字用短记法（`3s` 而不是 `3.00s`）—— 用户要求去掉末尾的 0 */
const len = fmtTimeShort;

export interface DefTimeline {
  segs: Seg[];
  /** **一轮多长**（横轴的"一个周期"） */
  cycleMs: number;
  /**
   * **首发前的一次性充能**（`initialChargeUpMs`）—— 它不在周期里，只画一次。
   *
   * 例子：催化剂炮艇的毒气武器要**充能 4.5s 才打第一发**；分段武器（音波坦克 3s）也是这条。
   * 图画出来才看得见"第一发为什么晚"。
   */
  initialMs: number;
  /** 横轴总长（最后一名队员的起点 + 若干周期） */
  spanMs: number;
  /** 图例右侧那行小字 */
  axisNote: string;
}

/** 分段武器末段无限 ⇒ 图上画这么多跳示意（不假装知道它会打多久） */
const LAST_STAGE_DEMO_TICKS = 4;

/**
 * **横轴下限 5 秒** —— 短节拍的武器要铺够，否则一轮就是一根刻度。
 *
 * 用户两条要求的结合：
 * · 「攻击间隔极短的可以考虑画 5 秒」+「弹弓也不会画 5s 的轴」（弹弓周期 **180ms**，
 *   只画一轮就是一根线）；
 * · 「沙暴导弹车这样的怎么都渲染两轮，应该只有催化剂要」⇒ **"整轮"的数量仍是 1**
 *   （催化剂那种首发充能不同的才 2 轮），5 秒下限只是把横轴**拉长**到够看，
 *   多出来的部分是**没有标注的半轮**（标注只画第 0 轮）。
 */
const MIN_AXIS_MS = 5000;

const needsSecondCycle = (initialMs: number): boolean => initialMs > 0;

export interface DefTimelineOpts {
  waveSize: number;
  separationMs: number;
}

/**
 * **单位状态条**（一个单位一条）—— 只画**单位级**的东西。
 *
 * ## 为什么叫"单位状态"而不是"部署条"
 *
 * 以后要往里加**移动 / 停止**（用户提的）⇒ 名字中性化，加状态不用改名。但**来源要分清**：
 *
 * | 状态 | 谁给的 | 现在有没有 |
 * | --- | --- | --- |
 * | `packed` / `unpacking` / `unpacked` / `packing` | **我们算的**（`DeployMachine`，源码 `modifier_intro/outro`） | ✅ 有 |
 * | `moving` / `stopped` / `in_combat` | **引擎报的只读事实**（`IsMoving()` / `IsIdle()` / `InCombat()`，J40 全树零个"指挥移动"） | ❌ 还没建模 —— 将来由**驱动喂进来**，与本层算出来的相位**并列**，不混进同一个类 |
 * | 阵亡残留 | 源码 `squadTuning.deathTimer`（6 个单位有），产物还没收 | ❌ |
 *
 * ⚠️ **武器条不再画部署** —— 那会让两把武器的图各画一遍（用户：「一个自身条 + 每个独立武器一个」）。
 */
export function unitStateTimeline(def: UnitDef): { segs: Seg[]; spanMs: number; axisNote: string } {
  const segs: Seg[] = [];
  const deployMs = def.deploy?.unpackMs ?? 0;
  const packMs = def.deploy?.packMs ?? 0;
  const selfDestruct = def.combatant.weapons.some((w) => w.selfDestruct === true);

  if (deployMs > 0) {
    segs.push({
      kind: "deploy",
      at: 0,
      ms: deployMs,
      scope: "squad",
      label: `部署 ${len(deployMs)}`,
      title: `部署（架设炮位）${fmtTime(deployMs)}，全队同时` +
        (def.deploy?.mustDeployToFire === false ? "；架设期间也能开火" : "；架设期间不能开火"),
    });
  }
  if (packMs > 0) {
    segs.push({
      kind: "deploy",
      at: deployMs,
      ms: packMs,
      scope: "squad",
      label: `撤收 ${len(packMs)}`,
      title: `撤收 ${fmtTime(packMs)}（要收起来时才发生）`,
    });
  } else if (def.deploy !== undefined && packMs === 0) {
    segs.push({
      kind: "deploy",
      at: deployMs,
      ms: 0,
      scope: "squad",
      label: "撤收瞬时",
      title: "撤收是瞬间完成的",
    });
  }

  const span = Math.max(deployMs + packMs, 1);
  const parts = [`横轴 = ${fmtTime(span)}`, "单位级"];
  if (selfDestruct) parts.push("自杀式：打完那一发就销毁");
  if (def.deploy?.mustDeployToFire === false) parts.push("可边跑边打");
  return { segs, spanMs: span, axisNote: parts.join(" · ") };
}

/** 画在图上的一段（百分比定位，`WeaponTimeline` 直接用） */
export interface PlacedSeg extends Seg {
  left: string;
  width: string;
  tickPct: string[];
  /** **第几轮**（0 = 第一轮）—— 标注带只画第 0 轮：结构是周期的，重复标就是噪声 */
  cycle?: number;
}

/**
 * **把段铺到横轴上**（每个队员一行）：队员错开 → 首发充能 → 按周期重复。
 *
 * ⚠️ 这段算式**从组件里搬出来**就是为了能被测（`core/test/def-timeline-check.ts`）：
 * 用户报过一次"MLRS 的开火刻度落在部署条里"—— 位置算错只有画出来才看得见。
 *
 * 三条容易错的规矩：
 * 1. **`once` 段只画第一行**（部署 / 首发充能是一次性的，重复画等于说"每轮都要架一次"）；
 * 2. **一次性段的起点不随轮次平移**（部署恒在 0，首发充能恒在"部署之后、第一轮之前"）；
 * 3. **刻度要按横轴过滤**（超出 100% 的绝对定位元素会把页面撑出横向滚动条）。
 */
export function layoutSegs(
  segs: Seg[],
  opts: { cycleMs: number; initialMs: number; spanMs: number; memberIndex: number; separationMs: number },
): PlacedSeg[] {
  const pct = (ms: number): string => `${(ms / Math.max(1, opts.spanMs)) * 100}%`;
  const shift = opts.memberIndex * opts.separationMs;
  const initial = Math.max(0, opts.initialMs);
  const cyc = Math.max(1, opts.cycleMs);
  const reps = Math.ceil((opts.spanMs - shift - initial) / cyc) + 1;
  const out: PlacedSeg[] = [];
  for (let k = 0; k < reps; k++) {
    // 第 k 轮的起点：队员错开 + 首发充能（只算一次）+ k 个周期
    const cycleAt = shift + initial + k * cyc;
    for (const s of segs) {
      if (s.once === true && k > 0) continue;
      /*
       * 零宽度的段一般要丢（一击 / 齐射靠金刻度表达）。
       * ⚠️ 但**带标注的零宽度段要留**：`自爆` 这种"只出文字、不出条"的标记
       * （用户报过它没显示 —— 因为这里把它当空段丢了）。
       */
      if (s.ms <= 0 && !(s.ticks?.length) && (s.label ?? "") === "") continue;
      // 一次性段：起点固定在"队员起点"（首发充能在部署之后）—— 不随轮次平移
      /*
       * ⚠️ **单位级动作不跟队员走**（`scope: "squad"`）：部署/撤收是**全队同时**发生的
       * （用户：「部署不是同时（游戏里是同时）」「部署条依旧没有上下对齐」）——
       * 各队员那几行里的部署条必须**上下对齐**，只有武器相位（开火/前摇）才按错开平移。
       */
      const base =
        s.scope === "squad"
          ? s.once === true
            ? 0
            : k * cyc
          : s.once === true
            ? shift
            : cycleAt;
      const at = s.at + base;
      if (at > opts.spanMs) continue;
      const ticks = (s.ticks ?? []).map((x) => x + base).filter((x) => x <= opts.spanMs);
      out.push({
        ...s,
        cycle: k,
        left: pct(at),
        width: pct(Math.max(0, Math.min(s.ms, opts.spanMs - at))),
        tickPct: ticks.map(pct),
      });
    }
  }
  return out;
}
/** 一名队员在**一轮内**的段（重复、错开与一次性段交给 `layoutSegs`） */
export function defSegsOf(w: WeaponDef): { segs: Seg[]; cycleMs: number; initialMs: number } {
  const t = w.timing;
  const out: Seg[] = [];
  const dmg = w.damage[0]?.main.base ?? 0;

  if (t.kind === "cyclic") {
    if (t.cooldownMs <= 0) return { segs: [], cycleMs: 0, initialMs: 0 };
    const charge = Math.max(0, Math.min(t.chargeUpMs, t.cooldownMs));
    const fireSpan = t.hits > 1 ? t.hits * Math.max(0, t.intervalMs) : 0;
    const cool = Math.max(0, t.cooldownMs - charge - fireSpan);
    /*
     * ⚠️ **自杀式武器不画冷却**（用户：「圣甲虫死了还要开火」）：
     * 圣甲虫是先开火、**同一时刻**就 `TakeHiddenDestroyDamage()` 自爆
     * （`ability_scarab_weapon_sequence.lua:50-51`）—— 武器级那个 `cooldown = 5s` 在它身上
     * **没有意义**，画出来会读成"它等 5 秒再打一发"。
     */
    if (cool > 0 && w.selfDestruct !== true) {
      out.push({
        kind: "gap",
        at: charge + fireSpan,
        ms: cool,
        label: `冷却 ${len(cool)}`,
        title: `冷却 ${fmtTime(cool)}`,
      });
    }
    out.push({
      kind: "fire",
      at: charge,
      ms: fireSpan,
      label: fireSpan > 0 ? `连打 ${t.hits} 发` : t.hits > 1 ? `${t.hits} 发齐射` : undefined,
      ticks: Array.from({ length: Math.max(1, t.hits) }, (_, i) => charge + i * t.intervalMs),
      title:
        fireSpan > 0
          ? `连打 ${t.hits} 发，每 ${fmtTime(t.intervalMs)} 一发`
          : t.hits > 1
            ? `${t.hits} 发同时出膛`
            : `一击`,
    });
    if (charge > 0) {
      out.push({
        kind: "charge",
        at: 0,
        ms: charge,
        label: `前摇 ${len(charge)}`,
        title: `前摇 ${fmtTime(charge)}`,
      });
    }
    if (w.selfDestruct === true) {
      out.push({
        kind: "death",
        at: charge + fireSpan,
        ms: 0,
        label: "自爆",
        title: "攻击后销毁自己",
      });
    }
    // **首发的一次性充能**：只在它跟"每轮前摇"不一样时才单独画（一样就没必要画两条）。
    const initialMs = Math.max(0, t.initialChargeUpMs);
    if (initialMs > 0 && initialMs !== charge) {
      out.push({
        kind: "charge",
        at: 0,
        ms: initialMs,
        once: true,
        label: `首发充能 ${len(initialMs)}`,
        title: `首次开火充能 ${fmtTime(initialMs)}`,
      });
    }
    return { segs: out, cycleMs: t.cooldownMs, initialMs: initialMs > 0 && initialMs !== charge ? initialMs : 0 };
  }

  if (t.kind === "magazine") {
    const fireSpan = t.clipSize > 1 ? (t.clipSize - 1) * t.gapMs : 0;
    const charge = Math.max(0, Math.min(t.chargeUpMs, t.reloadTimeMs));
    const fireAt = charge;
    /*
     * **那条紫色的装填条 = "剩余装填"**（用户：「我让你显示的那个条改名剩余装填」——
     * 是**改名**，不是删掉；我上一版误删了条）。
     *
     * 它量的**不是**整段装填（`reloadTimeMs`），而是"**打完最后一发之后还剩多少**"：
     * `剩余装填 = reloadTimeMs − (前摇 + (弹夹数−1) × 夹内间隔)`。
     * MLRS：`5000 − (250 + 2×250) = 4250ms` ⇒ 条上写 **剩余装填 4.25s**，
     * 而且条正好填满本轮剩下那一段（250 + 500 + 4250 = 5000 = 一轮）。
     *
     * 之所以不能标成"装填 5.00s"：装填窗口**从首发就开始算**、跟连打**重叠**，
     * 标整段会让人读成"打完还要再等 5 秒"。
     */
    const reloadRest = Math.max(0, t.reloadTimeMs - (fireAt + fireSpan));
    if (reloadRest > 0) {
      out.push({
        kind: "reload",
        at: fireAt + fireSpan,
        ms: reloadRest,
        label: `剩余装填 ${len(reloadRest)}`,
        title: `打完最后一发之后还要装填 ${fmtTime(reloadRest)}`,
      });
    }
    out.push({
      kind: "fire",
      at: fireAt,
      ms: fireSpan,
      label: t.clipSize > 1 ? `${t.clipSize} 发` : undefined,
      ticks: Array.from({ length: t.clipSize }, (_, i) => fireAt + i * t.gapMs),
      title: `一夹 ${t.clipSize} 发，每 ${fmtTime(t.gapMs)} 一发，每发 ${dmg} 伤害`,
    });
    if (charge > 0) {
      out.push({
        kind: "charge",
        at: 0,
        ms: charge,
        label: `前摇 ${len(charge)}`,
        title: `一夹第一发之前的前摇 ${fmtTime(charge)}`,
      });
    }
    return { segs: out, cycleMs: t.reloadTimeMs, initialMs: 0 };
  }

  // 分段：蓄力在**所有段之前**，每段按 `tickPeriodMs` 一跳
  let at = 0;
  const initialMs = Math.max(0, t.initialChargeUpMs);
  if (initialMs > 0) {
    /*
     * ⚠️ **分段武器的蓄力是"每轮都付"的，不标 `once`** —— 整轮 = 蓄力 + 各段，
     * 重复整轮就该重复这段蓄力（音波坦克 3s、万钧巨炮 0.5s）。
     * 标成 `once` 会让第二轮之后凭空少一段蓄力（早先标错过）。
     */
    out.push({
      kind: "charge",
      at: 0,
      ms: initialMs,
      label: `蓄力 ${len(initialMs)}`,
      title: `连打之前的蓄力 ${fmtTime(initialMs)}，每轮都要重新蓄`,
    });
    at = initialMs;
  }
  t.stages.forEach((st, i) => {
    const count = st.attackCount ?? LAST_STAGE_DEMO_TICKS;
    const span = count * st.tickPeriodMs;
    const tier = w.damage[i];
    const main = tier?.main.base ?? 0;
    const side = tier?.side?.base;
    out.push({
      kind: "stage",
      at,
      ms: span,
      ticks: Array.from({ length: count }, (_, k) => at + k * st.tickPeriodMs),
      label: `段 ${i + 1}${st.attackCount === undefined ? "（无限）" : ""}`,
      title:
        `段 ${i + 1}：每 ${fmtTime(st.tickPeriodMs)} 造成 ${main} 伤害` +
        (side === undefined ? "" : `，副目标 ${side}`) +
        (st.attackCount === undefined ? "；末段没有上限，图上只画 4 跳示意" : `，共 ${st.attackCount} 跳`),
    });
    at += span;
  });
  // ⚠️ 分段武器**没有**一次性前缀：蓄力已经在 `cycleMs`（整轮 = 蓄力 + 各段）里了
  return { segs: out, cycleMs: at, initialMs: 0 };
}

/** 组装成给 `WeaponTimeline` 的整条时间轴（含部署段、首发充能与小队错开） */
export function defTimeline(w: WeaponDef, opts: DefTimelineOpts): DefTimeline {
  const { segs, cycleMs, initialMs } = defSegsOf(w);
  const all: Seg[] = segs;
  /*
   * **横轴 = max(画出来的那几轮, 5 秒) + 首发充能 + 队员错开**
   * · **整轮数量**：默认 1（一轮内部已经表达了前摇/连打/装填/冷却）；首发充能不同才 2；自杀式恒 1；
   * · **5 秒下限**只影响横轴长度（弹弓 180ms 那种不然只剩一根刻度），多出来的是无标注的半轮；
   * · 队员错开必须算进去，否则最后一名队员那一行会被截掉；
   * · ⚠️ **部署不在这里** —— 那是**单位条**的事（`unitTimeline`），见那个函数的说明。
   */
  const oneTime = initialMs;
  const shift = Math.max(0, opts.waveSize - 1) * opts.separationMs;
  const cycles = w.selfDestruct === true ? 1 : needsSecondCycle(initialMs) ? 2 : 1;
  /*
   * **自杀式武器的横轴 = 段画到哪就到哪里 + 一点尾巴**：
   * 它没有"下一轮"，所以按周期铺满 5s 只会得到一大片没有意义的空白（用户报的"死了还要开火"）。
   * 尾巴是给"自爆"那个标注留位置（纯显示，不是数据）。
   */
  const drawnEnd = all.reduce((n, s) => Math.max(n, s.at + s.ms), 0);
  const drawn = cycles * Math.max(1, cycleMs);
  const body =
    w.selfDestruct === true
      ? drawnEnd + Math.max(400, Math.round(drawnEnd * 0.15))
      : Math.max(drawn, MIN_AXIS_MS);
  const span = oneTime + body + shift;
  const roundNote =
    w.selfDestruct === true
      ? "自杀式：打完这一发就自爆"
      : cycles === 2
        ? "2 轮（首发那一轮不一样）"
        : body > drawn
          ? "1 轮（横轴按 5s 下限铺）"
          : "1 轮";
  const parts = [`横轴 = ${fmtTime(span)}`, roundNote];
  if (opts.waveSize > 1) parts.push(`${opts.waveSize} 人 × 错开 ${fmtTime(opts.separationMs)}`);
  if (initialMs > 0) parts.push(`首发充能 ${fmtTime(initialMs)}`);
  return { segs: all, cycleMs: Math.max(1, cycleMs), initialMs, spanMs: span, axisNote: parts.join(" · ") };
}
