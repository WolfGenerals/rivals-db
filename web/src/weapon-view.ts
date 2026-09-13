/**
 * **武器卡的三块内容**（用户定的范围）：**伤害 / 发射时序 / 弹头效果**。
 *
 * 一个武器就这三件事 + 配置（J51：「武器 = 时序行为 + 弹头」）：
 *
 * | 块 | def 里的字段 | 谁写的值 |
 * | --- | --- | --- |
 * | 伤害 | `damage[]`（分段武器每段一项：`main` / `side` / `sideTargetCount`） | 转换器 / 手写 def |
 * | 发射时序 | `timing`（只有 3 种：`cyclic` / `magazine` / `staged`） | 同上 |
 * | 弹头效果 | `warhead`（**不写 = 只打最后一个成员**，`warheadOf()`） | 同上（14 把还没转，见 `defGaps`） |
 *
 * ⚠️ **这里只做"把数读成人话"**，不做机制判断、不重算数据：
 * - 伤害一律走 `Damage.against(目标)`（覆写取最大是模型里的语义）；
 * - 等级缩放走 `level.dps()` —— **伤害也随等级指数缩放**（findings J50），
 *   不是只有血量缩放；
 * - 时序的措辞与源码口径绑定（`reloadTimeMs` **从弹夹第一发计时**、普通武器的
 *   `chargeUpMs` **在周期之内**、序列武器的 `initialChargeUpMs` **在连打之前**）。
 */

import type { Level } from "@rivals/core/levels";
import { Damage } from "@rivals/core/model/unit-def";
import type { Target } from "@rivals/core/model/unit-def";
import type { Timing, WeaponDamage, WeaponDef } from "@rivals/core/model/weapon-def";
import { warheadOf, warheadOrigin } from "@rivals/core/model/weapon-def";
import type { PlaceModifierEffectDef, WarheadEffectDef } from "@rivals/core/model/warhead-def";

import { fmtTime, fmtTimeShort } from "./format.ts";
import { displayName } from "./display-names.ts";
import { deliveryZh, overrideZh, immuneZh } from "./text.ts";

/** 五类目标 —— 逐目标伤害表的行序（与 `TARGET_TAGS` 同序，读起来才固定） */
export const TARGETS: readonly Target[] = ["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"];

/** 一档伤害（分段武器有 N 档，其余 1 档） */
export interface DamageRow {
  /** 段号（从 1 起；非分段恒为 1） */
  stage: number;
  /** 这一档的伤害表；分段武器可能某段没写 */
  tier?: WeaponDamage;
  /** 段标签（分段武器才有：`12 发 × 250ms`） */
  stageLabel?: string;
}

/** 把 `damage[]` + `timing.stages[]` 合成"段行"（分段武器逐段、其余一行） */
export function damageRows(w: WeaponDef): DamageRow[] {
  if (w.timing.kind === "staged") {
    return w.timing.stages.map((st, i) => ({
      stage: i + 1,
      ...(w.damage[i] === undefined ? {} : { tier: w.damage[i]! }),
      stageLabel:
        st.attackCount === undefined
          ? `末段（无上限）· 每 ${fmtTime(st.tickPeriodMs)} 一次`
          : `${st.attackCount} 次 · 每 ${fmtTime(st.tickPeriodMs)} 一次`,
    }));
  }
  return [{ stage: 1, ...(w.damage[0] === undefined ? {} : { tier: w.damage[0]! }) }];
}

/** 伤害数值按等级缩放（**与 DPS 同一个系数**，findings J50） */
export function scaled(level: Level, value: number): number {
  return value > 0 ? Math.round(level.dps(value)) : value;
}

/** 逐目标取值（走模型语义：覆写命中取最大、`0` 合法） */
export function damageAgainst(d: Damage, target: Target, level: Level): number {
  return scaled(level, d.against(target));
}

/** 这一档的伤害表里有没有"因目标而异"（有覆写才画满五行，否则只写基础值） */
export function hasOverrides(d: Damage | undefined): boolean {
  return (d?.overrides?.length ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────
// 格子效果（火 / 毒气）的伤害 —— **用与武器一样的"逐目标矩阵"显示**
// ─────────────────────────────────────────────────────────────

/** 格子效果 / 爆炸的一格（一类目标） */
export interface TileDamageCell {
  target: Target;
  /** **按等级缩放后**的单次伤害（每跳 / 单次爆炸） */
  perHit: number;
  /** 每秒多少（= 每跳 ÷ 跳间隔 × 1000）；**一次性爆炸没有这个数** */
  perSec?: number;
  /** 相对**这个效果自己的基础伤害**的百分比（档位色用它）—— 与等级无关 */
  ratio: number;
  /** 打不打得到（**只对地 ⇒ 空军是 `false`**） */
  reachable: boolean;
}

/**
 * 格子效果 / 爆炸的伤害矩阵。
 *
 * ⚠️ **口径与武器完全一致**（用户：「毒气云/火焰也用标准的伤害显示」「催化爆炸也要的」）：
 * - **伤害随单位等级缩放**（用户：「毒气什么的伤害跟随单位等级你也忘了」）——
 *   依据 J50：**每一次伤害提交**都走同四步（`DamageUtil.lua:15-17`），
 *   其中第 ② 步就是 `GetRankedStatExponential(…, baseDamage)`；
 *   火/毒气走的 `AoeDamageSquadOverride` 也是这条流水线 ⇒ **不是"与等级无关"**（我先写错过）；
 * - **只对地**（`groundOnly`）⇒ **空军那格是"打不到"**（画 `—`），不是"伤害 0"；
 * - `vs` 覆写复用模型语义（造一个 `Damage`：命中取最大、`0` 合法）。
 */
export interface EffectDamageView {
  cells: TileDamageCell[];
  /** `tick` = 每跳一次（火/毒气）；`once` = 一次性（催化爆炸） */
  mode: "tick" | "once";
  tickMs?: number;
  persistMs?: number;
  immune?: string[];
  /** 连续开打多久才铺得出（`spawnDelayMs`） */
  spawnDelayMs?: number;
  /** 逐目标有没有覆写（没有的话五格数字一样） */
  hasOverrides: boolean;
  /** 相对基础值的总量（矩阵下面的小字用） */
  base: number;
  /**
   * **按当前等级缩放后的基础值**。
   *
   * ⚠️ 显示时两个都要给（用户：「相对基础伤害 6，但是缩放后基础 18」）——
   * 补正的百分比是**以未缩放的 `base` 为基准**（比值与等级无关），
   * 而格子里显示的每跳/单次伤害是**缩放后**的数；只写一个会被读成"对不上"。
   */
  scaledBase: number;
}

/** 造矩阵的一格（缩放 + 补正 + 可达性三件事只做一次） */
function effectCell(
  target: Target,
  damage: Damage,
  level: Level,
  groundOnly: boolean,
  tickMs: number | undefined,
): TileDamageCell {
  const reachable = !(groundOnly && target === "Aircraft");
  const raw = reachable ? damage.against(target) : 0;
  const perHit = scaled(level, raw);
  return {
    target,
    perHit,
    ...(tickMs === undefined || tickMs <= 0 ? {} : { perSec: (perHit * 1000) / tickMs }),
    ratio: reachable && damage.base > 0 ? raw / damage.base : 0,
    reachable,
  };
}

/** **格子效果**（火 / 毒气）→ 逐目标矩阵 */
export function tileDamageView(e: PlaceModifierEffectDef, level: Level): EffectDamageView {
  const damage = new Damage(e.effect.tickDamage, e.effect.vs);
  const groundOnly = e.effect.groundOnly === true;
  return {
    cells: TARGETS.map((t) => effectCell(t, damage, level, groundOnly, e.effect.tickMs)),
    mode: "tick",
    tickMs: e.effect.tickMs,
    persistMs: e.effect.persistMs,
    ...(e.effect.immune === undefined ? {} : { immune: e.effect.immune }),
    ...(e.effect.spawnDelayMs === undefined ? {} : { spawnDelayMs: e.effect.spawnDelayMs }),
    hasOverrides: (e.effect.vs?.length ?? 0) > 0,
    base: e.effect.tickDamage,
    scaledBase: scaled(level, e.effect.tickDamage),
  };
}

/** **催化爆炸**（`ability_catalyst_explosion`）→ 逐目标矩阵（一次性） */
export function explosionDamageView(
  damage: Damage,
  level: Level,
  opts: { groundOnly?: boolean; damageMs?: number } = {},
): EffectDamageView {
  const groundOnly = opts.groundOnly === true;
  return {
    cells: TARGETS.map((t) => effectCell(t, damage, level, groundOnly, undefined)),
    mode: "once",
    hasOverrides: (damage.overrides?.length ?? 0) > 0,
    base: damage.base,
    scaledBase: scaled(level, damage.base),
  };
}

// ─────────────────────────────────────────────────────────────
// ② 发射时序
// ─────────────────────────────────────────────────────────────

/**
 * 时序图的一段（画横条用）。`kind` 只影响配色，不参与计算。
 *
 * - `charge` 前摇（`cyclic.chargeUpMs` / `magazine.chargeUpMs` / `staged.initialChargeUpMs`）
 * - `shot` 出膛的一发（连打的每一发都画一个刻度）
 * - `gap` 空档（周期里除了前摇与连打之外的部分）
 * - `reload` 装填窗口（**从弹夹第一发开始算**，所以它会**盖住**连打的那些刻度）
 * - `stage` 分段武器的一段
 */
export interface TimingSegment {
  kind: "charge" | "shot" | "gap" | "reload" | "stage";
  /** 这一段占多少毫秒（画宽度用） */
  ms: number;
  /** 段上的小字（可空） */
  label?: string;
  /** 悬停解释 */
  title: string;
}

export interface TimingView {
  /** 图：一段一轮（或一段推进）里的时间分布 */
  segments: TimingSegment[];
  /** 这一整条画了多久（毫秒）—— 图的时间尺度 */
  spanMs: number;
  /** 字：把这条时序读成话（2–3 条） */
  lines: string[];
  /** 顶上那句话（"每 X 秒造成 Y 伤害"这种口径） */
  headline: string;
}

/** 这一档打出去多少伤害（不打折、不缩放 —— 缩放交给显示层） */
function tierDamage(tier: WeaponDamage | undefined): number {
  return tier?.main.base ?? 0;
}

/**
 * 把 `timing` 读成图 + 字。
 *
 * ⚠️ 三种时序的口径都来自源码，措辞里必须体现出来（否则读者会算错 DPS）：
 * - **循环**：`cooldownMs` 是**轮首到轮首**，`chargeUpMs` **在它之内**；
 * - **弹夹**：`reloadTimeMs` **从弹夹第一发起算**（MLRS 打光 3 发 = 首发 + 5s），
 *   所以装填窗口会**盖住**连打的刻度；
 * - **分段**：`initialChargeUpMs` 在**整段连打之前**（时间相加），每段按 `tickPeriodMs` 一跳，
 *   末段无限；`storeChargeTimeMs` 是"段进度保质期"。
 *
 * `opts.unitName` 只用来把"节奏由哪个脚本驱动"说成中文（`X的专属武器序列脚本`）——
 * **界面上不直接露内部脚本名**（用户：「这样的名字别直接出现，汉化掉」）。
 */
export function timingView(w: WeaponDef, opts: { unitName?: string } = {}): TimingView {
  const t: Timing = w.timing;
  const dmg = tierDamage(w.damage[0]);

  if (t.kind === "cyclic") {
    /*
     * ⚠️ **周期读不到**（极少见）：**不能**画成"每 0.00s 一轮"，那等于谎报。
     * 这里只陈述已知事实，不猜原因（原因写在产物里，不上面向玩家的界面）。
     */
    if (t.cooldownMs <= 0) {
      return {
        segments: [],
        spanMs: 0,
        headline: "周期未知",
        lines: ["这把武器的周期还没有数据，所以这一格空着 —— 不要按 0 理解。"],
      };
    }
    const charge = Math.max(0, Math.min(t.chargeUpMs, t.cooldownMs));
    const shooting = t.hits > 1 ? Math.max(0, (t.hits - 1) * t.intervalMs) : 0;
    const gap = Math.max(0, t.cooldownMs - charge - shooting);
    const segments: TimingSegment[] = [];
    if (charge > 0) segments.push({ kind: "charge", ms: charge, label: "前摇", title: `前摇 ${fmtTime(charge)}` });
    for (let i = 0; i < t.hits; i++) {
      segments.push({ kind: "shot", ms: 0, label: t.hits > 1 ? `${i + 1}` : "开火", title: `第 ${i + 1} 发` });
      if (i < t.hits - 1 && t.intervalMs > 0) {
        segments.push({ kind: "gap", ms: t.intervalMs, label: "间隔", title: `连打间隔 ${fmtTime(t.intervalMs)}` });
      }
    }
    if (gap > 0) segments.push({ kind: "gap", ms: gap, label: `空档 ${fmtTimeShort(gap)}`, title: `等待 ${fmtTime(gap)}` });

    const amount = t.hits > 1 ? `${dmg}×${t.hits}` : `${dmg}`;
    const lines: string[] = [`每 ${fmtTime(t.cooldownMs)} 造成 ${amount} 伤害`];
    if (charge > 0) lines.push(`前摇 ${fmtTime(charge)}`);
    if (t.hits > 1) {
      lines.push(t.intervalMs > 0 ? `一轮 ${t.hits} 发，每 ${fmtTime(t.intervalMs)} 一发` : `一轮 ${t.hits} 发，同时出膛`);
    }
    if (t.initialChargeUpMs > 0) lines.push(`首发充能 ${fmtTime(t.initialChargeUpMs)}`);
    return { segments, spanMs: t.cooldownMs, lines, headline: `每 ${fmtTime(t.cooldownMs)} 一轮` };
  }

  if (t.kind === "magazine") {
    /*
     * 打光一夹 = `clipSize` 发；"打完最后一发之后还要装填多久" = `装填 − 前摇 − 连打跨度`，
     * 连打跨度是 `(容量 − 1) × 间隔`。
     */
    const clipSpan = t.clipSize > 1 ? (t.clipSize - 1) * t.gapMs : 0;
    const tail = Math.max(0, t.reloadTimeMs - t.chargeUpMs - clipSpan);
    const segments: TimingSegment[] = [];
    if (t.chargeUpMs > 0) {
      segments.push({ kind: "charge", ms: t.chargeUpMs, label: "前摇", title: `前摇 ${fmtTime(t.chargeUpMs)}` });
    }
    for (let i = 0; i < t.clipSize; i++) {
      segments.push({ kind: "shot", ms: 0, label: `${i + 1}`, title: `第 ${i + 1} 发` });
      if (i < t.clipSize - 1) segments.push({ kind: "gap", ms: t.gapMs, label: "开火", title: `攻击间隔 ${fmtTime(t.gapMs)}` });
    }
    segments.push({ kind: "reload", ms: tail, label: `剩余装填 ${fmtTimeShort(tail)}`, title: `打完最后一发之后还要装填 ${fmtTime(tail)}` });

    const lines = [
      `弹匣 ${t.clipSize} 发，每发 ${dmg} 伤害，每 ${fmtTime(t.gapMs)} 一发`,
      `弹匣的周期是 ${fmtTime(t.reloadTimeMs)}`,
    ];
    if (t.chargeUpMs > 0) lines.push(`第一发之前有前摇 ${fmtTime(t.chargeUpMs)}`);

    return {
      segments,
      spanMs: Math.max(t.reloadTimeMs, t.chargeUpMs + clipSpan),
      lines,
      headline: `每 ${fmtTime(t.reloadTimeMs)} 发射 ${t.clipSize} 发`,
    };
  }

  // 分段：逐段推进，每段 `attackCount` 跳、每跳 `tickPeriodMs`
  const segments: TimingSegment[] = [];
  if (t.initialChargeUpMs > 0) {
    segments.push({
      kind: "charge",
      ms: t.initialChargeUpMs,
      label: `蓄力 ${fmtTimeShort(t.initialChargeUpMs)}`,
      title: `蓄力 ${fmtTime(t.initialChargeUpMs)}`,
    });
  }
  const lines: string[] = [];
  if (t.initialChargeUpMs > 0) lines.push(`蓄力 ${fmtTime(t.initialChargeUpMs)}`);
  t.stages.forEach((st, i) => {
    const span = (st.attackCount ?? 4) * st.tickPeriodMs; // 末段无限 ⇒ 画 4 跳示意
    const tier = w.damage[i];
    const main = tier?.main.base ?? 0;
    const side = tier?.side?.base;
    const last = i === t.stages.length - 1;
    segments.push({
      kind: "stage",
      ms: span,
      label: `段 ${i + 1}${st.attackCount === undefined ? "（无限）" : ""}`,
      title: `段 ${i + 1}：每 ${fmtTime(st.tickPeriodMs)} 造成 ${main} 伤害${side === undefined ? "" : `，副目标 ${side}`}`,
    });
    lines.push(
      `段 ${i + 1}：每 ${fmtTime(st.tickPeriodMs)} 造成 ${main} 伤害` +
        (side === undefined
          ? ""
          : `，副目标 ${side}${tier?.sideTargetCount === undefined ? "" : ` ×${tier.sideTargetCount}`}`) +
        (st.attackCount === undefined
          ? "；末段没有上限"
          : last
            ? `，共 ${st.attackCount} 次`
          : `，${fmtTime(st.attackCount * st.tickPeriodMs)} 后进入下一段`),
    );
  });
  if (t.storeChargeTimeMs !== undefined) {
    lines.push(`${fmtTime(t.storeChargeTimeMs)} 内没有接着打，段进度会从头开始`);
  }
  const headline =
    t.stages.length > 1
      ? `分 ${t.stages.length} 段，越打越强`
      : `单段连打${t.initialChargeUpMs > 0 ? `（蓄力 ${fmtTimeShort(t.initialChargeUpMs)}）` : ""}`;
  return { segments, spanMs: t.initialChargeUpMs + segments.reduce((n, s) => n + s.ms, 0), lines, headline };
}

// ─────────────────────────────────────────────────────────────
// ③ 弹头效果
// ─────────────────────────────────────────────────────────────

/**
 * `ModifyStat` 的中文名 —— 弹头效果（EMP / 晕眩）要说人话。
 *
 * ⚠️ 名字里的 `Decrease/Increase` 是**源码的方向**（`AttackSpeedDecrease` = 攻速变慢）；
 * 显示统一写成"攻速 −25%"这种带符号的形式，避免"减慢了 25%"读成"只剩 25%"。
 */
const STAT_LABEL: Record<string, string> = {
  AttackSpeedDecrease: "攻速",
  AttackSpeedIncrease: "攻速",
  ReloadSpeedPercentDecrease: "装填速度",
  ReloadSpeedPercentIncrease: "装填速度",
  MovementSpeedPercentDecrease: "移动速度",
  MovementSpeedPercentIncrease: "移动速度",
  MovementSpeedFlatIncrease: "移动速度",
  AngularSpeedPercentDecrease: "转向速度",
  AngularSpeedPercentIncrease: "转向速度",
  IncomingDamageReduction: "受到伤害",
  IncomingDamageAddition: "受到伤害",
  OutgoingDamagePercentIncrease: "造成伤害",
};

/** 一条 `ModifyStat` → `攻速 −25%`（方向由源码的 Decrease/Increase 决定） */
function statLine(key: string, value: number): string {
  const label = STAT_LABEL[key] ?? key;
  const down = /Decrease|Reduction/.test(key);
  const pct = Math.round(value * 100);
  const sign = down ? "−" : "+";
  return `${label} [${sign}${pct}%]`;
}

/** 一条弹头效果读成人话（**不出现内部名、不写我们怎么算的**） */
function effectLine(e: WarheadEffectDef): string {
  switch (e.kind) {
    case "one_member":
      return deliveryZh("one_member");
    case "squad_each":
      return `${deliveryZh("squad_each")}（范围伤害）`;
    case "per_combatant":
      return deliveryZh("per_combatant");
    case "falloff":
      return `圆内的目标按距离衰减（半径 ${e.radius} 世界单位）`;
    case "catalyst_explosion": {
      const trigger = e.triggers
        .map((t) => (t.kind === "tileHasModifier" ? `格子被铺了${displayName(t.modifier)}` : `格子上有目标单位`))
        .join("、");
      return (
        `引爆：打进${trigger === "" ? "目标格" : trigger}才炸，整格每人各一份、只炸一次` +
        (e.timing?.damageMs === undefined ? "" : `，${fmtTime(e.timing.damageMs)} 后结算伤害`)
      );
    }
    case "catalyst_chained_explosion":
      return `连锁引爆：主格 + 往外 ${e.rings} 环`;
    case "place_modifier": {
      const f = e.effect;
      /*
       * ⚠️ **逐目标伤害与免疫名单不在这里重复**（用户指出：和旁边那块毒气面板是同一个信息）——
       * 那些由 `EffectDamageMatrix` 一格一格摆出来。这里只说"铺什么、多久跳一次、持续多久、打谁"。
       */
      const gate = f.spawnDelayMs === undefined ? "" : `（连续开打 ${fmtTime(f.spawnDelayMs)} 后才铺得出）`;
      return (
        `铺下${displayName(e.name)}${gate}：每 ${fmtTime(f.tickMs)} 造成 ${f.tickDamage} 伤害，持续 ${fmtTime(f.persistMs)}` +
        (f.groundOnly ? "，只对地面生效" : "")
      );
    }
    case "refresh_modifier":
      return `再次命中同一格：${displayName(e.name)} 重新计时`;
    case "remove_modifier":
      return `移除格子上的${displayName(e.name)}`;
    case "modify":
      return `${fmtTime(e.durationMs)} 内使目标 ${e.stats.map(([k, v]) => statLine(k, v)).join("、")}`;
  }
}

/**
 * **弹头效果的一条** —— 结构化，因为页面上**效果名要单独加大上色**（用户要求：
 * 「伤害对象和催化爆炸/铺设 xxx 一样，这种效果名字加大设置颜色」）。
 *
 * | 字段 | 谁用 |
 * | --- | --- |
 * | `name` | 加大的名字（`伤害对象` / `毒气云` / `催化爆炸`）；纯说明条目留空 |
 * | `detail` | 名字后面那句话（细节交给旁边的伤害矩阵，避免重复） |
 * | `tone` | 上色用（毒气绿 / 火焰橙 / 爆炸紫 / 伤害对象蓝） |
 * | `effect` | `tile` / `explosion` 用它画伤害矩阵 |
 */
export interface WarheadEntry {
  kind: "delivery" | "tile" | "explosion" | "text";
  name: string;
  detail: string;
  tone: "delivery" | "gas" | "fire" | "explosion" | "none";
  effect?: WarheadEffectDef;
}

/**
 * 弹头读成**结构化条目**（`WeaponCard` 用它排版）。
 *
 * ⚠️ **没写弹头 ≠ 没有效果**：默认就是"攻击单个成员"（{@link warheadOf}）。
 * ⚠️ **不重复矩阵已经表达的**（用户第 ④ 条）：逐目标伤害、免疫名单、每跳/持续
 * 都交给旁边的伤害矩阵，这里只说"是什么效果、什么条件触发、打谁"。
 */
export function warheadEntries(w: WeaponDef): WarheadEntry[] {
  const out: WarheadEntry[] = [];
  for (const e of warheadOf(w)) {
    switch (e.kind) {
      case "one_member":
      case "squad_each":
      case "per_combatant":
      case "falloff":
        out.push({ kind: "delivery", name: "伤害对象", detail: deliveryZh(e.kind), tone: "delivery" });
        break;
      case "place_modifier": {
        const f = e.effect;
        const bits: string[] = [];
        if (f.spawnDelayMs !== undefined) bits.push(`连续开火 ${fmtTime(f.spawnDelayMs)} 后才生成`);
        bits.push(`持续 ${fmtTime(f.persistMs)}`);
        if (f.groundOnly) bits.push("只对地面生效");
        const tone = /gas|chem/i.test(e.name) ? "gas" : "fire";
        out.push({ kind: "tile", name: displayName(e.name), detail: bits.join(" · "), tone, effect: e });
        break;
      }
      case "catalyst_explosion": {
        const trigger = e.triggers
          .map((t) => (t.kind === "tileHasModifier" ? `命中${displayName(t.modifier)}触发` : "命中目标格触发"))
          .join("、");
        const bits = [trigger];
        if (e.timing?.damageMs !== undefined) bits.push(`${fmtTime(e.timing.damageMs)} 后结算伤害`);
        if (e.groundOnly === true) bits.push("只对地面生效");
        out.push({ kind: "explosion", name: displayName(e.impl), detail: bits.join(" · "), tone: "explosion", effect: e });
        break;
      }
      case "catalyst_chained_explosion":
        out.push({
          kind: "text",
          name: displayName(e.impl),
          detail: `主格 + 往外 ${e.rings} 环`,
          tone: "explosion",
        });
        break;
      case "refresh_modifier":
        out.push({ kind: "text", name: "", detail: `再次命中：${displayName(e.name)} 重置剩余时间`, tone: "none" });
        break;
      case "remove_modifier":
        out.push({ kind: "text", name: "", detail: `移除格子上的${displayName(e.name)}`, tone: "none" });
        break;
      case "modify":
        out.push({
          kind: "text",
          name: "施加修正",
          detail: `${fmtTime(e.durationMs)} 内使目标: ${e.stats.map(([k, v]) => statLine(k, v)).join("、 ")}`,
          tone: "none",
        });
        break;
    }
  }
  if (out.length === 0) out.push({ kind: "text", name: "", detail: "命中后没有任何效果", tone: "none" });
  if (w.selfDestruct === true) {
    out.push({ kind: "text", name: "", detail: "自杀式：打完这一发自己就销毁，没有第二轮", tone: "none" });
  }
  return out;
}

/**
 * 弹头那一段要说的话（**纯文本版**，给日志/测试用；页面排版走 {@link warheadEntries}）。
 */
export function warheadLines(w: WeaponDef): string[] {
  return warheadEntries(w).map((e) => (e.name === "" ? e.detail : `${e.name}：${e.detail}`));
}

// ─────────────────────────────────────────────────────────────
// DPS（从上面两块算出来，不另读数据）
// ─────────────────────────────────────────────────────────────

/** 顶栏那两个口径 */
export type DpsMode = "burst" | "avg";

/**
 * 一把武器的 DPS（**按等级缩放后**）。
 *
 * 三种时序各有各的式子，都用"**一轮里打出去多少 ÷ 一轮多长**"：
 *
 * | 时序 | `avg`（平均） | `burst`（爆发） |
 * | --- | --- | --- |
 * | 循环 | `伤害 × 发数 ÷ 周期` | `伤害 × 发数 ÷ 连打时长` |
 * | 弹夹 | `伤害 × 夹容量 ÷ 装填时长`（**装填从首发算** ⇒ 与面板公式一致） | `伤害 ÷ 夹内间隔` |
 * | 分段 | 目前这一段 `伤害 ÷ 跳间隔`（段是越打越强的，所以标了段号） | 同左 |
 *
 * ⚠️ 面板 DPS 与这里的 `avg` 在弹夹型上是一致的（面板就是 `clip ÷ reload`）；
 * 分段/序列型面板忽略前摇，所以两者不等（findings I231 那笔账）。
 */
export function dpsOf(w: WeaponDef, level: Level, mode: DpsMode): number {
  const t = w.timing;
  const per = (v: number): number => scaled(level, v);
  if (t.kind === "cyclic") {
    const dmg = per(tierDamage(w.damage[0]));
    const shooting = t.hits > 1 ? Math.max(1, (t.hits - 1) * t.intervalMs) : 0;
    const window = mode === "burst" && shooting > 0 ? shooting : t.cooldownMs;
    return window > 0 ? (dmg * t.hits * 1000) / window : 0;
  }
  if (t.kind === "magazine") {
    const dmg = per(tierDamage(w.damage[0]));
    const window = mode === "burst" ? (t.gapMs > 0 ? t.gapMs : t.reloadTimeMs) : t.reloadTimeMs;
    const count = mode === "burst" ? 1 : t.clipSize;
    return window > 0 ? (dmg * count * 1000) / window : 0;
  }
  const last = t.stages[t.stages.length - 1];
  const dmg = per(tierDamage(w.damage[w.damage.length - 1]));
  return last !== undefined && last.tickPeriodMs > 0 ? (dmg * 1000) / last.tickPeriodMs : 0;
}

/** 分段武器的 DPS 该标"哪一段"（其余武器返回 `undefined`） */
export function dpsStageLabel(w: WeaponDef): string | undefined {
  return w.timing.kind === "staged" ? `段 ${w.timing.stages.length}` : undefined;
}

/**
 * **"一轮"打出去几发** —— 「单轮总伤害」与逐目标矩阵的"单轮"都用它。
 *
 * | 时序 | 一轮几发 |
 * | --- | --- |
 * | 循环 | `hits`（`numToBurst`） |
 * | 弹夹 | `clipSize`（一夹） |
 * | 分段 | **1**（分段是逐跳打的，"一轮"就是一跳；标成「单跳」） |
 */
export function volleyCount(w: WeaponDef): number {
  const t = w.timing;
  if (t.kind === "cyclic") return Math.max(1, t.hits);
  if (t.kind === "magazine") return Math.max(1, t.clipSize);
  return 1;
}

/** 「单轮」这个词在分段武器上叫「单跳」（它不是"一轮打完"，是一跳） */
export function volleyWord(w: WeaponDef): string {
  return w.timing.kind === "staged" ? "单跳" : "单轮";
}

/** 矩阵/结论行用的那张伤害表 —— **分段武器取末段**（面板口径也是末段，J-x） */
export function headlineTier(w: WeaponDef): WeaponDamage | undefined {
  return w.damage[w.damage.length - 1];
}

/**
 * 对某类目标的**伤害补正**（相对这把武器自己的基础伤害）。
 *
 * ⚠️ 分母是**这把武器自己的 `main.base`**，不是"全库最好"也不是别的目标 ——
 * 所以补正 200% 的意思是"打这类比打普通目标更疼"，只在这把武器内部有意义。
 */
export function damageRatio(d: Damage, target: Target): number {
  const base = d.base;
  return base > 0 ? d.against(target) / base : 0;
}

/** 该武器的可攻击集是空的（索敌未知，全库 6 把）⇒ 不该下"打得到/打不到"的结论 */
export function targetingUnknown(w: WeaponDef): boolean {
  return w.usage.canAttack.length === 0;
}
