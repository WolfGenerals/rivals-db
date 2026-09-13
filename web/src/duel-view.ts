/**
 * **决斗视图层** —— 把 `core/src/model/duel.ts` 跑出来的一串事件变成**界面能画的东西**。
 *
 * ## 为什么要单独一层
 *
 * `Duel` 只负责"按帧推进 + 记账"（事件流 / 状态段 / 属性修改），它**不知道页面长什么样**。
 * 而"画"需要的是**另一套形状**：百分比坐标、按队员分组的行、按秒取舍的刻度、
 * 以及**给人读的文字日志**。两边混在一起的话，`Duel` 就会开始依赖 DOM 尺寸。
 *
 * ⚠️ 这里**不跑模拟、不改数值**（`runDuel` 只是把循环写在一处，STEP/LIMIT 的默认值也只在这里定义）。
 * 视图层只做四件事：**跑 → 分组 → 算百分比 → 说人话**。
 *
 * ## 一条时间轴、两侧共用
 *
 * 两类元素都换算成**同一根横轴的百分比**（`spanMs` 为分母）：
 *
 * | 元素 | 内容 |
 * | --- | --- |
 * | **行**（`DuelRowView`） | 每名队员每把武器一条：**状态段**（前摇/冷却/等装填/空转）+ **开火刻度** |
 * | **血量**（`DuelSideView.hpPoints`） | 两支小队的**总血比例**折线（0~1）—— 谁先掉血、什么时候掉光 |
 *
 * ## 文字日志（用户要求「同时提供文字版事件日志」）
 *
 * 图上能看"什么时候开火"，但**看不出"这一发打了谁、扣了多少、走哪条交付路径"**。
 * 那些全在事件里，所以日志是图的**必要补充**，不是附属品 —— 逐条对齐到同一根时间轴（毫秒）。
 * 每条日志带 `group`（开火/命中/阵亡/格子/修改/提示），页面据此做筛选。
 */

import { level as levelOf, type Level } from "@rivals/core/levels";
import { DEFAULT_FLIGHT_MS, Duel } from "@rivals/core/model/duel";
import type { DuelEvent } from "@rivals/core/model/duel";
import type { UnitDef } from "@rivals/core/model/unit-def";

import { displayName } from "./display-names.ts";
import { fmtTime } from "./format.ts";
import { weaponOrdinalZh } from "./text.ts";

export type SideName = "A" | "B";

// ─────────────────────────────────────────────────────────────
// ① 跑
// ─────────────────────────────────────────────────────────────

export interface DuelRun {
  duel: Duel;
  /** 打完（或超时）那一刻 */
  endedAtMs: number;
  outcome: "A" | "B" | "draw" | "timeout";
}

export interface RunDuelOptions {
  /** 等级（两侧同一个；默认 1-0）—— 要分开给就用 `levels` */
  level?: Level;
  /** **两侧各自的等级**（战斗页可以单独设；用户要求） */
  levels?: [Level, Level];
  /** **两侧开局是否已经架好**（战斗页的「初始已部署」开关） */
  deployed?: [boolean, boolean];
  /**
   * **两侧的起始行动延迟**（毫秒）—— "这一侧还没到位"的那段时间，
   * 整条时间轴（部署 + 队内错开）都从这里往后推（见 `core/src/model/duel.ts` 的同名字段）。
   */
  startDelay?: [number, number];
  /** 每帧多少毫秒（默认 1 —— 与 `core/test/duel-check.ts` 同一粒度） */
  stepMs?: number;
  /** 上限（默认 120s；到点还没分出胜负就是超时） */
  limitMs?: number;
}

/**
 * **跑一场 1v1 站桩决斗** —— 驱动循环只写在这一处。
 *
 * ⚠️ **跑到什么时候为止**（用户要求：「模拟要持续到火和毒气消失或者双方死亡」）：
 *
 * | 还在推进 | 为什么 |
 * | --- | --- |
 * | 双方都活着 | 还在互打 |
 * | 一方已死、**场上还有火 / 毒气** | 格子效果还在跳，得让它跳完（否则图上会缺掉后面那几跳与"消散"） |
 *
 * 也就是说：**一方死光并不立刻结束**，要等格子效果散尽；**双方都死**才立刻停（没活人可掉血了）。
 *
 * ⚠️ 每帧 1ms 是**精度**不是游戏帧率：所有时刻都是"从 0 起的毫秒"，
 * 帧大小只影响同一毫秒内事件的先后，不影响数值（武器机是按时间戳补齐的，J57）。
 */
export function runDuel(a: UnitDef, b: UnitDef, opts: RunDuelOptions = {}): DuelRun {
  const step = opts.stepMs ?? 1;
  const limit = opts.limitMs ?? 120_000;
  const duel = new Duel(a, b, {
    level: opts.level ?? levelOf(1, 0),
    ...(opts.levels === undefined ? {} : { levels: opts.levels }),
    ...(opts.deployed === undefined ? {} : { deployed: opts.deployed }),
    ...(opts.startDelay === undefined ? {} : { startDelay: opts.startDelay }),
  });
  const running = (): boolean => {
    const aAlive = duel.alive("A");
    const bAlive = duel.alive("B");
    if (!aAlive && !bAlive) return false; // 双方阵亡 ⇒ 立刻停
    if (aAlive && bAlive) return true; // 还在互打
    // 只剩一方活着：还有格子效果就继续，等它跳完散尽
    return duel.tileEffects.length > 0;
  };
  while (duel.elapsedMs < limit && running()) duel.tick(step);
  const aAlive = duel.alive("A");
  const bAlive = duel.alive("B");
  const outcome: DuelRun["outcome"] = aAlive && bAlive ? "timeout" : aAlive ? "A" : bAlive ? "B" : "draw";
  return { duel, endedAtMs: duel.elapsedMs, outcome };
}

// ─────────────────────────────────────────────────────────────
// ② 视图形状
// ─────────────────────────────────────────────────────────────

/** 状态段（**绝对时刻 + 百分比**都给，页面不用再算） */
export interface DuelSegView {
  kind: "charge" | "gap" | "reload" | "idle" | "deploy" | "ready";
  left: number;
  width: number;
  fromMs: number;
  toMs: number;
  title: string;
}

export interface DuelShotView {
  /** 第几发（从 1 起） */
  n: number;
  atMs: number;
  left: number;
  /**
   * **这一发用哪个标志**：
   * · `"sword"` 普通攻击；
   * · `"burst"` **自杀式攻击**（这把武器 `selfDestruct`，打完这一发自己就销毁）。
   */
  mark: "sword" | "burst";
  title: string;
}

/**
 * **单位状态行** —— 一侧一条，画**单位级**的东西：现在只有**部署 / 架设**。
 *
 * 为什么要它：部署是 `Duel` 里的一道真门禁（"没架好不许开火"，`DeployMachine.readyToFire`）——
 * 不画出来的话，武器行左边那段空白看着像"图坏了"，而真相是"这段时间它在架炮"。
 * 与单位页同一个语义（J81：部署是**全队同时**的，不按队员错开），所以**一侧只有一条**。
 */
export interface DuelUnitRowView {
  side: SideName;
  unitId: string;
  unitName: string;
  segs: DuelSegView[];
  /** **架好那一刻**（`unpack_done`）；这个单位不需要部署时是 `null` */
  readyAtMs: number | null;
  /** **起始行动延迟**（毫秒，0 = 不延迟）—— 单位状态行左边那一段"赶路" */
  startDelayMs: number;
  /** 一条说明（有没有部署、架了多久、架设期间能不能打） */
  note: string;
}

/** **一名队员的一把武器** —— 图上的一条 */
export interface DuelRowView {
  key: string;
  side: SideName;
  unitIndex: number;
  who: string;
  weaponId: string;
  /** 行标签上的**单位名**（界面上不出现 `A` / `B`） */
  unitName: string;
  /** 行标签列上的武器称呼：单武器 = `主武器`，多武器 = `武器 N`（**不显示源码槽名**） */
  weaponLabel: string;
  segs: DuelSegView[];
  shots: DuelShotView[];
  /**
   * **这一行的条画到哪为止** —— 阵亡就**在阵亡那一刻截断**（用户：「死亡单位不应该有条」）。
   *
   * 不能画到全场结束：武器机在人死之后**不再被驱动**（`Duel.tick` 里 `if (!s.unit.alive) continue`），
   * 于是它最后那段状态会被"拉"到整场末尾 —— 画出来就是"人都死了还在冷却"。
   */
  endMs: number;
  /**
   * 条的**底色**该多宽（占整条轴的百分比）—— 就是 `endMs / spanMs × 100`。
   *
   * ⚠️ 它只能用在**底色的那一层**上：`segs[].left/width` 全是**相对整条轴**的百分比，
   * 把承载段的容器缩窄会让段被"再乘一次"而压到行首（曾经就是这么错的 —— 见 `DuelPanel.vue` 的 CSS）。
   */
  barEndPct: number;
  /** 这一员阵亡的时刻（没死就是 `null`） */
  deadAtMs: number | null;
  /** 怎么死的：`killed` 被打死（骷髅）/ `self_destruct` 打完自爆（爆星）；没死 = `null` */
  deadCause: "killed" | "self_destruct" | null;
  /** 这把武器是不是自杀式（`selfDestruct`）—— 决定开火标志用剑还是爆星 */
  selfDestruct: boolean;
  /**
   * **这把武器锁不上对面**（`canAttack` 里没有对面的兵种）⇒ 整场没驱动它。
   * 有值时这一行只会有一条"打不到"的灰条（用户实测提出：MLRS 打不掉催化剂直升机）。
   */
  blocked?: { canAttack: string[]; targetType: string };
}

/** 一名队员的血量折线（阶跃：只在挨打的那一刻变） */
export interface DuelMemberView {
  index: number;
  who: string;
  maxHp: number;
  hp: number;
  alive: boolean;
  deadAtMs: number | null;
  deadCause: "killed" | "self_destruct" | null;
  /** `{atMs, frac}`：`frac = hp / maxHp`（0~1），**阶跃点成对出现** */
  points: Array<{ atMs: number; frac: number }>;
}

export interface DuelSideView {
  side: SideName;
  unitId: string;
  /** 中文名（调用方给；没给就是 id） */
  unitName: string;
  members: DuelMemberView[];
  rows: DuelRowView[];
  /** **单位状态行**（部署 / 架设）—— 与武器行同一根轴，画在它们上面 */
  unitRow: DuelUnitRowView;
  /** 整队总血比例（0~1）折线 */
  hpPoints: Array<{ atMs: number; frac: number }>;
  maxHp: number;
  hp: number;
  aliveUnits: number;
  memberCount: number;
  fired: number;
  hitsDealt: number;
  damageDealt: number;
  hitsTaken: number;
  damageTaken: number;
  deaths: number;
  /** 整队阵亡的时刻 */
  killedAtMs: number | null;
  /** 这一侧**打不到对面**的武器（`canAttack` 里没有对面兵种）—— 它们一发都没打 */
  blocked: Array<{ weaponId: string; weaponLabel: string; unitName: string; canAttack: string[]; targetType: string }>;
}

/** 日志分组（页面上的筛选按钮按它来） */
export type DuelLogGroup = "fired" | "hit" | "warhead" | "death" | "tile" | "modify" | "note";

export interface DuelLogLine {
  atMs: number;
  /** 原始事件种类（上色用） */
  kind: DuelEvent["kind"];
  group: DuelLogGroup;
  side?: SideName;
  text: string;
}

export interface DuelTileView {
  name: string;
  /** 中文显示名（`displayName`） */
  label: string;
  side: SideName;
  /** 谁铺的 —— **单位名**（界面上不出现 `A` / `B`） */
  unitName: string;
  placedAtMs: number;
  tickMs: number;
  tickDamage: number;
  persistMs: number;
}

export interface DuelAxisTick {
  atMs: number;
  left: number;
  label: string;
}

export interface DuelView {
  spanMs: number;
  ticks: DuelAxisTick[];
  sides: [DuelSideView, DuelSideView];
  /** 所有行（A 的在前，B 的在后）—— 两侧共用一根横轴，所以放在同一张图里 */
  rows: DuelRowView[];
  log: DuelLogLine[];
  /** 日志里实际出现过的分组（没出现的筛选按钮不画） */
  logGroups: DuelLogGroup[];
  tiles: DuelTileView[];
  /** 打不到对面的武器（双方合并；空的就说明双方都能互相打到） */
  blockedWeapons: Array<{ side: SideName; weaponId: string; weaponLabel: string; unitName: string; canAttack: string[]; targetType: string }>;
  /** 未建模项（原样来自 `Duel.notes`） */
  notes: readonly string[];
  summary: {
    outcome: DuelRun["outcome"];
    endedAtMs: number;
    totalFired: number;
    totalHits: number;
    totalDamage: number;
    totalDeaths: number;
    /** 开火 → 命中的延迟（占位值，见 `DEFAULT_FLIGHT_MS`） */
    flightMs: number;
  };
}

const GROUP_OF: Record<DuelEvent["kind"], DuelLogGroup> = {
  fired: "fired",
  hit: "hit",
  unit_dead: "death",
  squad_dead: "death",
  tile_placed: "tile",
  tile_tick: "tile",
  tile_expired: "tile",
  modify: "modify",
  note: "note",
};

const GROUP_LABEL: Record<DuelLogGroup, string> = {
  fired: "开火",
  hit: "直击",
  warhead: "弹头效果",
  death: "阵亡",
  tile: "格子效果",
  modify: "属性修改",
  note: "提示",
};

/** 日志筛选按钮的文字（页面直接用） */
export function groupLabel(g: DuelLogGroup): string {
  return GROUP_LABEL[g];
}

/**
 * 武器机的状态 → 段色（`Seg.kind` 的子集）。
 *
 * ⚠️ **`init_charging` 不能漏**（用户：「首发前摇又看不见了」）：三个机器都会在**第一次开火之前**
 * 记这一段（`CyclicWeapon` / `MagazineWeapon` / `StagedWeapon` 的 `initialChargeUpMs`，
 * 一辈子只付一次）—— 漏掉它，催化剂炮艇那 4.5s 首充在图上就是**一片空白**
 * （段被 `if (kind === undefined) continue` 丢了，而不是"没发生"）。
 */
const STATE_KIND: Record<string, DuelSegView["kind"] | undefined> = {
  init_charging: "charge",
  charging: "charge",
  cooling: "gap",
  wait_reload: "reload",
  idle: "idle",
};

const STATE_ZH: Record<string, string> = {
  init_charging: "首发充能",
  charging: "前摇",
  cooling: "冷却",
  wait_reload: "等装填",
  idle: "空转",
};

const DELIVERY_ZH: Record<string, string> = {
  one_member: "只打最后一员",
  squad_each: "每人各一份",
  per_combatant: "逐个点名",
  falloff: "按距离衰减（未建模 ⇒ 按每人各一份）",
};

const STAT_ZH: Record<string, string> = {
  AttackSpeedDecrease: "攻速降低",
  AttackSpeedIncrease: "攻速提高",
  ReloadSpeedPercentDecrease: "装填速度降低",
  ReloadSpeedPercentIncrease: "装填速度提高",
  MovementSpeedPercentDecrease: "移速降低",
  MovementSpeedPercentIncrease: "移速提高",
  MovementSpeedFlatIncrease: "移速提高（绝对值）",
  AngularSpeedPercentDecrease: "转向速度降低",
  AngularSpeedPercentIncrease: "转向速度提高",
  IncomingDamageReduction: "受到伤害降低",
  IncomingDamageAddition: "受到伤害提高",
  OutgoingDamagePercentIncrease: "打出伤害提高",
};

// ─────────────────────────────────────────────────────────────
// ③ 组装
// ─────────────────────────────────────────────────────────────

const pct = (ms: number, span: number): number => (ms / Math.max(1, span)) * 100;

/** 刻度步长：切成 4~12 格（优先整秒那种好读的数） */
export function axisStep(spanMs: number): number {
  for (const s of [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 20_000, 30_000, 60_000]) {
    if (spanMs / s <= 12) return s;
  }
  return 60_000;
}

/**
 * **某一员在时刻 `t` 上"掉血前 / 掉血后"的血量比例** —— 画阶跃折线用的。
 *
 * `DuelMemberView.points` 里同一毫秒是**成对**出现的：`(t, 掉血前)`、`(t, 掉血后)`。
 * 所以：
 * · 该员在 `t` 上没有变化 ⇒ 前后同值（保持）；
 * · 有变化 ⇒ `before` 取那一刻**第一个**点、`after` 取**最后一个**点
 *   （同一毫秒挨了两下也只会落成一段竖直的落差，而不是两段）。
 */
export function fracPairAt(m: DuelMemberView, t: number): { before: number; after: number } {
  let before = 1;
  let after = 1;
  let seen = false;
  for (const p of m.points) {
    if (p.atMs < t) {
      before = p.frac;
      after = p.frac;
      continue;
    }
    if (p.atMs > t) break;
    if (!seen) {
      before = p.frac;
      seen = true;
    }
    after = p.frac;
  }
  return { before, after };
}

export interface DuelViewOptions {
  /** 两侧中文名（`[A, B]`）—— 界面上的标签与日志都用它 */
  names?: [string, string];
}

/**
 * **跑完的一场 → 可画 + 可读的视图**。
 *
 * ⚠️ 血量折线是**从事件流反推**的（`hit` 事件带 `hpAfter`），不是另记一份历史 ——
 * 只有一处真相，图与日志不可能对不上。
 */
export function duelView(run: DuelRun, opts: DuelViewOptions = {}): DuelView {
  const { duel } = run;
  const span = Math.max(1, run.endedAtMs);
  const names: [string, string] = opts.names ?? ["A", "B"];
  const records = duel.weaponRecords();
  /**
   * **槽名 → 界面上的武器称呼**（由数据决定，不编名字）：
   * 单武器单位 = `主武器`（日志里省略），多武器单位 = `武器 1 / 武器 2`。
   */
  const weaponNames = new Map<string, { row: string; log: string }>();
  for (const side of duel.sides) {
    const damaging = side.squad.def.combatant.weapons.filter((w) => w.damage.length > 0);
    damaging.forEach((w, i) => {
      const row = weaponOrdinalZh(i, damaging.length);
      weaponNames.set(`${side.name}#${w.id}`, { row, log: damaging.length > 1 ? row : "" });
    });
  }
  const nameOfWeapon = (side: SideName, slot: string): { row: string; log: string } =>
    weaponNames.get(`${side}#${slot}`) ?? { row: "", log: "" };
  /** `side#weaponId` → 打不到对面的理由（`canAttack` 里没有对面兵种） */
  const blockedOf = new Map(
    duel.blockedWeapons.map((b) => [`${b.side}#${b.weaponId}`, { canAttack: [...b.canAttack], targetType: b.targetType }]),
  );

  /**
   * **界面上不再用 `A` / `B` 这两个字母**（用户要求：「A 和 B 换成单位名字」）——
   * 一律用单位中文名，多成员队伍再带队员号（`步枪兵 队员2`）。
   */
  const unitNameOf = (side: SideName): string => names[side === "A" ? 0 : 1];
  const stateNameOf = (side: SideName, index: number): string => {
    const squad = duel.sides.find((s) => s.name === side)!.squad;
    return squad.size > 1 ? `${unitNameOf(side)} 队员${index + 1}` : unitNameOf(side);
  };

  /** 每名成员的挨打历史（按事件顺序，`hit` 事件自带 `hpAfter`） */
  const hitsOf = new Map<string, Array<{ atMs: number; hpAfter: number }>>();
  const deathsOf = new Map<string, number>();
  /** 怎么死的：`killed`（被打死）/ `self_destruct`（打完自爆）—— 两种在图上用不同图标 */
  const deathsCause = new Map<string, "killed" | "self_destruct">();
  /**
   * **自杀式销毁导致的掉血** —— 它没有 `hit` 事件（不是被打的），血量直接归零。
   * 不补这一条的话，血量折线里那些队员会"满血活到最后"。
   */
  const selfDeadOf = new Map<string, number>();
  const squadDeadAt = new Map<SideName, number>();
  for (const e of duel.events) {
    if (e.kind === "hit") {
      const k = `${e.targetSide}#${e.targetIndex}`;
      const list = hitsOf.get(k) ?? [];
      list.push({ atMs: e.atMs, hpAfter: e.hpAfter });
      hitsOf.set(k, list);
      if (e.killed && !deathsOf.has(k)) {
        deathsOf.set(k, e.atMs);
        deathsCause.set(k, "killed");
      }
    } else if (e.kind === "unit_dead") {
      const k = `${e.side}#${e.unitIndex}`;
      if (!deathsOf.has(k)) {
        deathsOf.set(k, e.atMs);
        deathsCause.set(k, e.cause);
      }
      if (e.cause === "self_destruct" && !selfDeadOf.has(k)) selfDeadOf.set(k, e.atMs);
    } else if (e.kind === "squad_dead") {
      const s = e.side as SideName;
      if (!squadDeadAt.has(s)) squadDeadAt.set(s, e.atMs);
    }
  }

  const sides = [0, 1].map((i): DuelSideView => {
    const name = (i === 0 ? "A" : "B") as SideName;
    const runtime = duel.sides.find((s) => s.name === name)!;
    const squad = runtime.squad;
    const enemy: SideName = i === 0 ? "B" : "A";

    const members = squad.units.map((u): DuelMemberView => {
      const key = `${name}#${u.index}`;
      const maxHp = Math.max(1, u.maxHp);
      const points: Array<{ atMs: number; frac: number }> = [{ atMs: 0, frac: 1 }];
      let cur = u.maxHp;
      /** 同一毫秒掉两次（多把武器）也要落成一个点对 */
      const dropAt = (atMs: number, hpAfter: number): void => {
        points.push({ atMs, frac: cur / maxHp });
        cur = hpAfter;
        points.push({ atMs, frac: cur / maxHp });
      };
      for (const h of hitsOf.get(key) ?? []) dropAt(h.atMs, h.hpAfter);
      const selfAt = selfDeadOf.get(key);
      if (selfAt !== undefined && cur > 0) dropAt(selfAt, 0); // 自杀式：不是被打的，直接归零
      points.push({ atMs: span, frac: cur / maxHp });
      return {
        index: u.index,
        who: squad.size > 1 ? `队员 ${u.index + 1}` : "—",
        maxHp: u.maxHp,
        hp: u.hp,
        alive: u.alive,
        deadAtMs: deathsOf.get(key) ?? null,
        deadCause: deathsCause.get(key) ?? null,
        points,
      };
    });

    /**
     * **整队总血比例** —— 必须是**阶跃**：同一毫秒里先记"掉血前"、再记"掉血后"，
     * 两点之间是**竖直**的落差。
     *
     * ⚠️ 早先这里是"把每名成员的点按时刻去重后合并"⇒ 同一时刻只剩一个点，
     * 折线就从上一个时刻**斜着**连到掉血后的值（用户：「怎么是斜线下降而不是直线瞬间下降」）。
     * 时间轴上的斜线等于谎报"这段时间在缓慢掉血"，而实际是**挨了一下**。
     */
    const times = [...new Set(members.flatMap((m) => m.points.map((p) => p.atMs)))].sort((a, b) => a - b);
    const totalMax = members.reduce((n, m) => n + m.maxHp, 0);
    const hpPoints: Array<{ atMs: number; frac: number }> = [];
    for (const t of times) {
      let before = 0;
      let after = 0;
      for (const m of members) {
        const pair = fracPairAt(m, t);
        before += pair.before * m.maxHp;
        after += pair.after * m.maxHp;
      }
      hpPoints.push({ atMs: t, frac: totalMax > 0 ? before / totalMax : 0 });
      hpPoints.push({ atMs: t, frac: totalMax > 0 ? after / totalMax : 0 });
    }

    /*
     * **单位状态行** —— 部署机的状态段（`packed` → `unpacking` → `unpacked`）。
     *
     * ⚠️ 部署是**全队同时**的（J81）：`Duel` 给每名成员各造了一台部署机，但它们的相位一模一样，
     * 所以只取第一台（拿第一台以外的那几台会画出完全重合的段）。
     */
    const deployMachine = runtime.shooters.map((s) => s.deploy).find((d) => d !== null) ?? null;
    const unitSegs: DuelSegView[] = [];
    let readyAtMs: number | null = null;
    if (deployMachine !== null) {
      const unpackMs = squad.def.deploy?.unpackMs ?? 0;
      for (const [k, st] of deployMachine.states.entries()) {
        const to = k + 1 < deployMachine.states.length ? deployMachine.states[k + 1]!.start : span;
        const ms = to - st.start;
        if (ms <= 0) continue;
        const unpacking = st.state === "unpacking";
        const packing = st.state === "packing";
        unitSegs.push({
          kind: unpacking || packing ? "deploy" : st.state === "unpacked" ? "ready" : "idle",
          left: pct(st.start, span),
          width: pct(ms, span),
          fromMs: st.start,
          toMs: to,
          title: unpacking
            ? `部署 ${fmtTime(ms)}`
            : packing
              ? `撤收 ${fmtTime(ms)}`
              : st.state === "unpacked"
                ? `已部署`
                : `收起（${fmtTime(ms)}）`,
        });
      }
      readyAtMs = deployMachine.events.find((e) => e.event === "unpack_done")?.at ?? null;
    }
    const unitRow: DuelUnitRowView = {
      side: name,
      unitId: squad.def.id,
      unitName: names[i]!,
      segs: unitSegs,
      readyAtMs,
      startDelayMs: runtime.startDelayMs,
      note:
        runtime.startDelayMs > 0
          ? `起始行动延迟 ${fmtTime(runtime.startDelayMs)}（还没到位，整条时间轴后移）`
          : deployMachine === null
            ? "不需要部署"
            : `部署 ${fmtTime(squad.def.deploy?.unpackMs ?? 0)}` +
              (squad.def.deploy?.mustDeployToFire === false ? "" : "；架好之前不能开火"),
    };

    const rows = records
      .filter((r) => r.side === name)
      .map((r): DuelRowView => {
        const who = stateNameOf(name, r.unitIndex);
        const deadAtMs = deathsOf.get(`${name}#${r.unitIndex}`) ?? null;
        const segs: DuelSegView[] = [];
        /*
         * **打不到对面**的武器：它整场都在空转（每帧拿不到目标）。
         *
         * ⚠️ 这条理由**只在顶部那条红字里说一次**，不再挂到每一段的提示上 ——
         * 挂上去会把提示框拉得很长，盖住下面的时间轴（用户：「悬浮条会往横向变长导致看不出时间」）。
         */
        const blocked = blockedOf.get(`${name}#${r.weaponId}`);
        const blockedWhy = blocked === undefined ? "" : " —— 打不到对面";
        /*
         * **驱动层等待** —— 武器机在两种情况下**根本没被驱动**，所以 `machine.states` 里
         * 不会有这一段（`Duel.tick` 的两道 `continue`）：
         *
         * | 谁 | 条件 | 代表 |
         * | --- | --- | --- |
         * | **没架好** | `deploy !== null && !readyToFire` | MLRS：部署 2s，武器机从 2000ms 才开始记 |
         * | **没轮到自己** | `now < unit.startDelayMs` | 步枪兵队员 5：错位 1376ms，1033ms 就阵亡 |
         *
         * 不补这一段的话那一行左边是**空的**（图看着像坏了），而真相是"这段时间它没被驱动"。
         * 终点的三种取法（谁先到算谁）：错位量、架好时刻、第一次状态/阵亡。
         */
        const staggerMs = squad.size > 1 ? squad.attackSeparationMs * r.unitIndex : 0;
        const deployGateMs = squad.def.deploy !== undefined && squad.def.deploy.mustDeployToFire !== false
          ? (readyAtMs ?? squad.def.deploy.unpackMs)
          : 0;
        /*
         * ⚠️ **三段相加**：起始行动延迟 → 架好 → 队内错开（与 `Duel.tick` 的门禁同一条规则）。
         * 部署与错开不是取最大（圣甲虫会两只同时自爆）；起始延迟在最外层（整条时间轴后移）。
         */
        const driverWaitMs = runtime.startDelayMs + deployGateMs + staggerMs;
        if (driverWaitMs > 0) {
          const until = Math.min(driverWaitMs, r.states[0]?.start ?? deadAtMs ?? span);
          if (until > 0) {
            const why: string[] = [];
            if (runtime.startDelayMs > 0) why.push(`还没到位（延迟 ${fmtTime(runtime.startDelayMs)}）`);
            if (deployGateMs > 0) why.push(`未部署`);
            if (staggerMs > 0) why.push(`小队延迟`);
            segs.push({
              kind: "idle",
              left: pct(0, span),
              width: pct(until, span),
              fromMs: 0,
              toMs: until,
              title:
                `${who} ${nameOfWeapon(name, r.weaponId).row}：等待 ${fmtTime(until)} · ${why.join(" · ")}` +
                (deadAtMs !== null && deadAtMs <= driverWaitMs ? " · 已阵亡" : "") +
                blockedWhy,
            });
          }
        }
        /*
         * **条只画到阵亡那一刻**（用户：「死亡单位不应该有条」）。
         *
         * 武器机在人死之后**不再被驱动**（`Duel.tick` 里 `if (!s.unit.alive) continue`），
         * 于是它最后那段状态会被"拉"到整场末尾 —— 画出来就是"人都死了还在冷却/还在打"。
         * 所以：`endMs` 之前的状态照画，越过它的一律截断（状态本身不动，只切显示）。
         */
        const endMs = Math.min(span, deadAtMs ?? span);
        for (const [k, st] of r.states.entries()) {
          const kind = STATE_KIND[st.state];
          if (kind === undefined) continue;
          if (st.start >= endMs) continue;
          const to = Math.min(k + 1 < r.states.length ? r.states[k + 1]!.start : span, endMs);
          const ms = to - st.start;
          if (ms <= 0) continue;
          segs.push({
            kind,
            left: pct(st.start, span),
            width: pct(ms, span),
            fromMs: st.start,
            toMs: to,
            title: `${who} ${nameOfWeapon(name, r.weaponId).row}：${STATE_ZH[st.state] ?? "等待"} ${fmtTime(ms)}${blockedWhy}`,
          });
        }
        /*
         * **开火标志**：普通武器是剑（`sword`），**自杀式**武器是爆星（`burst`）——
         * 「用以前的 icon 表示攻击 / 自杀式攻击」（用户）。都画在条**上方**的槽位。
         */
        const suicide = r.selfDestruct === true;
        const shots = r.firedAtMs.map((atMs, n): DuelShotView => ({
          n: n + 1,
          atMs,
          left: pct(atMs, span),
          mark: suicide ? "burst" : "sword",
          title: suicide
            ? `${who} ${nameOfWeapon(name, r.weaponId).row} 自杀式攻击（${fmtTime(atMs)}）`
            : `${who} ${nameOfWeapon(name, r.weaponId).row} 第 ${n + 1} 发（${fmtTime(atMs)}）`,
        }));
        return {
          key: `${name}#${r.unitIndex}#${r.weaponId}`,
          side: name,
          unitIndex: r.unitIndex,
          /** 行标签上的单位名（界面上不出现 `A` / `B`） */
          unitName: unitNameOf(name),
          who: squad.size > 1 ? `队员 ${r.unitIndex + 1}` : "",
          weaponId: r.weaponId,
          /** 行标签列用的称呼（单武器 = 主武器） */
          weaponLabel: nameOfWeapon(name, r.weaponId).row,
          segs,
          shots,
          endMs,
          barEndPct: pct(endMs, span),
          deadAtMs,
          deadCause: deathsCause.get(`${name}#${r.unitIndex}`) ?? null,
          selfDestruct: suicide,
          ...(blocked === undefined ? {} : { blocked }),
        };
      });

    const dealt = duel.events.filter((e) => e.kind === "hit" && e.side === name);
    const taken = duel.events.filter((e) => e.kind === "hit" && e.targetSide === name);
    return {
      side: name,
      unitId: squad.def.id,
      unitName: names[i]!,
      members,
      rows,
      unitRow,
      hpPoints,
      maxHp: squad.maxHp,
      hp: squad.hp,
      aliveUnits: squad.aliveUnits.length,
      memberCount: squad.size,
      fired: records.filter((r) => r.side === name).reduce((n, r) => n + r.firedAtMs.length, 0),
      hitsDealt: dealt.length,
      damageDealt: dealt.reduce((n, e) => n + (e.kind === "hit" ? e.damage : 0), 0),
      hitsTaken: taken.length,
      damageTaken: taken.reduce((n, e) => n + (e.kind === "hit" ? e.damage : 0), 0),
      deaths: members.filter((m) => !m.alive).length,
      killedAtMs: squadDeadAt.get(name) ?? null,
      blocked: duel.blockedWeapons
        .filter((b) => b.side === name)
        .map((b) => ({
          weaponId: b.weaponId,
          weaponLabel: nameOfWeapon(b.side as SideName, b.weaponId).row,
          unitName: unitNameOf(b.side as SideName),
          canAttack: [...b.canAttack],
          targetType: b.targetType,
        })),
    } satisfies DuelSideView;
  }) as [DuelSideView, DuelSideView];

  // ── 文字日志 ────────────────────────────────────────────────
  const log: DuelLogLine[] = duel.events.map((e): DuelLogLine => {
    // 弹头效果打出来的那一下单独一组（"直击"与"它引发的爆炸"筛选得开）
    const group: DuelLogGroup = e.kind === "hit" && e.effect !== undefined ? "warhead" : GROUP_OF[e.kind];
    switch (e.kind) {
      case "fired":
        return {
          atMs: e.atMs,
          kind: e.kind,
          group,
          side: e.side as SideName,
          text: `${stateNameOf(e.side as SideName, e.unitIndex)} ${nameOfWeapon(e.side as SideName, e.weapon).log} 开火`
            .replace(/\s+/g, " "),
        };
      case "hit": {
        /*
         * **直击 vs 它引发的效果要能一眼分开**（用户指出：那一发直击和它引发的催化爆炸
         * 早先长得一模一样）：直击写武器（**只有多武器单位才写**，否则纯噪声），
         * 效果那一行直接写效果名（引发它的那把武器就是上一行）。
         */
        const w = nameOfWeapon(e.side as SideName, e.weapon).log;
        const head =
          e.effect === undefined
            ? `${stateNameOf(e.side as SideName, e.unitIndex)}${w === "" ? "" : ` ${w}`}`
            : `${unitNameOf(e.side as SideName)} ${displayName(e.effect)}`;
        return {
          atMs: e.atMs,
          kind: e.kind,
          group,
          side: e.side as SideName,
          text:
            `${head} → ${stateNameOf(e.targetSide as SideName, e.targetIndex)}：−${e.damage}（剩 ${e.hpAfter}）` +
            (e.killed ? " ☠ 阵亡" : ""),
        };
      }
      case "unit_dead":
        return {
          atMs: e.atMs,
          kind: e.kind,
          group,
          side: e.side as SideName,
          text:
            e.cause === "self_destruct"
              ? `${stateNameOf(e.side as SideName, e.unitIndex)} 自杀`
              : `${stateNameOf(e.side as SideName, e.unitIndex)} 阵亡`,
        };
      case "squad_dead":
        return {
          atMs: e.atMs,
          kind: e.kind,
          group,
          side: e.side as SideName,
          text: `${unitNameOf(e.side as SideName)} 全队阵亡`,
        };
      case "tile_placed":
        return {
          atMs: e.atMs,
          kind: e.kind,
          group,
          side: e.side as SideName,
          text:
            `${unitNameOf(e.side as SideName)} 在 ${unitNameOf(e.targetSide as SideName)} 的格子上铺下${displayName(e.effect)}：` +
            `每 ${fmtTime(e.tickMs)} 造成 ${e.tickDamage} 伤害，持续 ${fmtTime(e.persistMs)}`,
        };
      case "tile_tick":
        return {
          atMs: e.atMs,
          kind: e.kind,
          group,
          side: e.side as SideName,
          text: `${displayName(e.effect)}：对 ${unitNameOf(e.side === "A" ? "B" : "A")} 造成 ${e.damage} 伤害`,
        };
      case "tile_expired":
        return { atMs: e.atMs, kind: e.kind, group, text: `${displayName(e.effect)} 消散` };
      case "modify":
        return {
          atMs: e.atMs,
          kind: e.kind,
          group,
          side: e.side as SideName,
          text: `${unitNameOf(e.side as SideName)} → ${unitNameOf(e.targetSide as SideName)}：${STAT_ZH[e.stat] ?? "属性"} ${e.value < 0 ? "−" : "+"}${Math.round(
            Math.abs(e.value) * 100,
          )}%，持续到 ${fmtTime(e.untilMs)}`,
        };
      case "note":
        return { atMs: e.atMs, kind: e.kind, group, text: e.text };
    }
  });

  const tiles: DuelTileView[] = duel.events
    .filter((e): e is Extract<DuelEvent, { kind: "tile_placed" }> => e.kind === "tile_placed")
    .map((e) => ({
      name: e.effect,
      label: displayName(e.effect),
      side: e.side as SideName,
      unitName: unitNameOf(e.side as SideName),
      placedAtMs: e.atMs,
      tickMs: e.tickMs,
      tickDamage: e.tickDamage,
      persistMs: e.persistMs,
    }));

  const step = axisStep(span);
  const ticks: DuelAxisTick[] = [];
  // ⚠️ **不画 `t === span` 那一格**：它在 100% 处会被右边界裁掉半个字，
  // 而"横轴多长"已经写在轴说明里了
  for (let t = 0; t < span; t += step) {
    ticks.push({ atMs: t, left: pct(t, span), label: fmtTime(t) });
  }

  const hits = duel.events.filter((e) => e.kind === "hit");
  return {
    spanMs: span,
    ticks,
    sides,
    rows: [...sides[0].rows, ...sides[1].rows],
    log,
    logGroups: [...new Set(log.map((l) => l.group))],
    tiles,
    blockedWeapons: duel.blockedWeapons.map((b) => ({
      side: b.side as SideName,
      weaponId: b.weaponId,
      weaponLabel: nameOfWeapon(b.side as SideName, b.weaponId).row,
      unitName: unitNameOf(b.side as SideName),
      canAttack: [...b.canAttack],
      targetType: b.targetType,
    })),
    notes: duel.notes,
    summary: {
      outcome: run.outcome,
      endedAtMs: run.endedAtMs,
      totalFired: records.reduce((n, r) => n + r.firedAtMs.length, 0),
      totalHits: hits.length,
      totalDamage: hits.reduce((n, e) => n + (e.kind === "hit" ? e.damage : 0), 0),
      totalDeaths: duel.events.filter((e) => e.kind === "unit_dead").length,
      flightMs: DEFAULT_FLIGHT_MS,
    },
  };
}

/** 日志的一行文字（`时间 | 侧 | 文本`）—— 导出/测试用的纯文本版 */
export function logText(view: DuelView): string {
  return view.log
    .map((l) => `${String(l.atMs).padStart(6)}ms  ${(l.side ?? "—").padEnd(1)}  [${GROUP_LABEL[l.group]}] ${l.text}`)
    .join("\n");
}
