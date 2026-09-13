/**
 * **1v1 站桩决斗** —— 两个小队贴着站、互相打，把**伤害结算层**真正跑起来的第一个消费者。
 *
 * ## 它管什么
 *
 * 逐帧按**固定顺序**驱动（顺序写在 {@link Duel.tick} 的注释里）：
 *
 * | # | 谁 | 为什么在这个位置 |
 * | --- | --- | --- |
 * | ① | **部署机** | 先结清"刚架好"，这一帧就能开火 |
 * | ② | **武器机** | 产出 `firing` 事件 ⇒ 变成"在飞的弹" |
 * | ③ | **落地结算** | 走到点的弹按落地先后扣血（`damage.ts`） |
 * | ④ | **排队的爆炸** | 催化爆炸那种"命中之后 `DAMAGE_TIME` 才扣血"的，到点在这里结算 |
 * | ⑤ | **格子效果** | 火 / 毒气的每跳（整队每人各一份，`AoeDamageSquad*`） |
 * | ⑥ | **死亡** | 整队没人了就记一条（对方的机器自然停） |
 * | ⑦ | **时钟最后推** | 帧内所有读者看到的是"这一帧的开始"（时间线不偏） |
 *
 * ## 它**不**管什么（"站桩"的前提，如实列出）
 *
 * - **移动 / 寻路 / 转向 / 索敌 / 射程判定** —— 引擎侧、Lua 里没有（J40）⇒ 两队**恒在射程内**、
 *   目标**恒定**（各打各自的对面）；"两队在不在射程内"由调用方决定（要打就拿来跑）；
 *   ⚠️ **但"这类目标在不在它的打击清单里"是管了的**（`canAttack`，见
 *   {@link reachesType}）：MLRS 的 `rockets` 没有 `Aircraft` ⇒ **每帧喂给武器机的目标是 `null`**，
 *   武器机自己停在 `idle`、一发都不打（用户实测提出：「MLRS 咋打死催化剂直升机了」）；
 * - **飞行时间**：`WeaponDef.flightMs` 只在"距离无关"时才填得出来（J45）⇒ 其余用
 *   {@link DEFAULT_FLIGHT_MS} 占位。它只保证一件事：**伤害不在开火那一帧落地**（镜像对局才会同归于尽）；
 * - **按距离衰减**：需要位置 ⇒ `damage.ts` 退化成"每人各一份"并记 `falloff_unmodeled`；
 * - **攻速/装填类 debuff 对节奏的影响**：`modify`（EMP）会**记录并计时**，但武器机吃的是固定参数
 *   ⇒ **节奏不变**（下一步做"有效参数"覆盖；作用公式在引擎里、没有源码，属约定）。
 *
 * 另外两条**目标级**的门禁也在这里（都是"这个目标根本不吃这一下"，不是射程）：
 * - **格子效果的 `groundOnly`** —— 火 / 毒气只打地面，空军站在上面不掉血；
 * - **格子效果的 `immune` 名单** —— 化武兵 / 毒车不吃自己的毒气（`IMMUNE_UNIT1/2`）。
 */

import type { Clock } from "./clock.ts";
import { level as levelOf, type Level } from "../levels.ts";
import { DeployMachine } from "./behaviors/deploy-machine.ts";
import { EffectMachine } from "./behaviors/effect-machine.ts";
import { NOTES, deliveryOf, reachesType, resolveShot, sideEffectsOf, targetTypeOf } from "./damage.ts";
import type { Shot, ShotOutcome } from "./damage.ts";
import { Damage, Tile, TileEffect } from "./unit-def.ts";
import type { UnitDef } from "./unit-def.ts";
import { spawn } from "./unit-instance.ts";
import type { Squad, Unit } from "./unit-instance.ts";
import type { WeaponDef } from "./weapon-def.ts";
import type { WarheadEffectDef } from "./warhead-def.ts";
import { weaponMachineFor } from "./weapons/weapon-factory.ts";
import type { WeaponMachine } from "./weapons/weapon-machine.ts";

/** ⚠️ 占位：飞行时间（"1 tick"）。只保证**伤害不在开火那一帧落地**（J45 还没按武器算） */
export const DEFAULT_FLIGHT_MS = 1;

/** 决斗时间线上的一个事件 */
export type DuelEvent =
  | { atMs: number; kind: "fired"; side: string; unitIndex: number; weapon: string; landAtMs: number }
  | {
      atMs: number;
      kind: "hit";
      side: string;
      unitIndex: number;
      targetSide: string;
      targetIndex: number;
      /** 哪把武器打的（槽名）—— 日志要用；催化爆炸那种没有成员的攻击方也靠它认 */
      weapon: string;
      /**
       * **这一下是哪个弹头效果打的**（不出现 = 就是那把武器的直击）。
       *
       * 例：催化爆炸（`ability_catalyst_explosion`）—— 它在**命中之后 300ms** 才扣血
       * （`ability_catalyst_explosion.lua:28` 的 `WaitForAge(DAMAGE_TIME)`），
       * 所以它是一条**独立**的 hit 事件，得能认出它是爆炸、不是那一发直击。
       */
      effect?: string;
      damage: number;
      hpAfter: number;
      killed: boolean;
      /** 这一次伤害走的是哪条交付路径（`damage.ts` 的 `Delivery`） */
      via: string;
    }
  | { atMs: number; kind: "unit_dead"; side: string; unitIndex: number; cause: "killed" | "self_destruct" }
  | { atMs: number; kind: "squad_dead"; side: string }
  | {
      atMs: number;
      kind: "tile_placed";
      side: string;
      targetSide: string;
      effect: string;
      tickMs: number;
      tickDamage: number;
      persistMs: number;
    }
  | { atMs: number; kind: "tile_tick"; side: string; effect: string; hits: number; damage: number }
  | { atMs: number; kind: "tile_expired"; effect: string }
  | { atMs: number; kind: "modify"; side: string; targetSide: string; stat: string; value: number; untilMs: number }
  | { atMs: number; kind: "note"; text: string };

/** 一名成员身上的一把武器（机器 + 它每轮出几发） */
interface MountedWeapon {
  def: WeaponDef;
  machine: WeaponMachine;
  /** 每轮出几发 —— `muzzleStrategy = All` 时每个枪口各一发（伤害侧的事） */
  shotsPerPull: number;
  /**
   * **这把武器锁不锁得上对面的兵种** —— `"no"` 时**每帧喂给武器机的目标是 `null`**
   * （武器机因此全程停在 `idle`，见 `tick` 里那一步）。
   *
   * 用户实测提出：MLRS 的 `rockets` 里没有 `Aircraft` ⇒ 打不掉催化剂直升机。
   */
  reach: "yes" | "no" | "unknown";
}

/** 一名射手（成员） */
interface Shooter {
  side: string;
  unit: Unit;
  enemy: Squad;
  deploy: DeployMachine | null;
  weapons: MountedWeapon[];
}

/** 场上跑着的格子效果（火 / 毒气） */
interface RunningTileEffect {
  name: string;
  effect: TileEffect;
  /** **铺在哪块格子上** —— 只有站在这块格子上的小队才吃它的每跳 */
  tile: Tile;
  untilMs: number;
  casterSide: string;
  /** 伤害按**施法者的等级**缩放（DoT 走的是施法者那条伤害流水线，J50） */
  casterLevel: Level;
  /**
   * **只打地面** —— 空军站在格子上**不吃**每跳（源码 `DESCRIPTOR_FILTERS = Ground`，
   * 火 / 毒气都是这样）。`false`/不出现 = 空军照吃。
   */
  groundOnly: boolean;
  /** **完全免疫这个效果的兵种**（源码 `IMMUNE_UNIT1/2`，例如化武兵 / 毒车不吃自己的毒气） */
  immune: string[];
  /** 每个站在格子上的小队一台节拍机 */
  machines: Map<Squad, EffectMachine>;
}

interface SideRuntime {
  name: string;
  squad: Squad;
  shooters: Shooter[];
  /** **连续开打**从哪一刻算起（毒气 `spawnGasTimeMs` 门槛用它）；`null` = 还没开始 */
  attackSinceMs: number | null;
  /**
   * **起始行动延迟**（毫秒）—— 这一侧"还在赶路 / 还没到位"的那段时间，
   * 整条时间轴（含部署与队内错开）都从这里往后推（用户定的：
   * 「把该侧整条时间轴后移」「错开从这个延迟之后开始算」）。
   *
   * ⚠️ 它是**假设**，不是源码数据：源码里没有"谁先到位"这回事（没有地图/位置）。
   */
  startDelayMs: number;
}

/** 时间线上挂着的属性修改（EMP / 晕眩）—— 已记录、已计时，**还没接进攻速** */
export interface RunningModifier {
  atMs: number;
  untilMs: number;
  targetSide: string;
  stat: string;
  value: number;
}

/**
 * **排队等扣血的爆炸** —— 催化爆炸。
 *
 * 它不是"命中即扣血"：`ability_catalyst_explosion.lua` 的 Timeline 是
 * `WaitForAge(EXPLOSION_START_TIME)`（放特效）→ **`WaitForAge(DAMAGE_TIME)`**（扣血）→ `WaitForAge(DURATION)`。
 * `WaitForAge(x)` 在引擎里是"**等到年龄 = x**"（绝对时刻，`WeaponSequenceUtil.lua:35-38` 的累加写法为证），
 * 所以从命中算起 **`damageMs` 之后**才扣血（直升机 300ms）。
 *
 * ⚠️ 触发**只在命中那一刻判一次**（格上有没有那个 modifier）——排进来之后照常炸，
 * 不因为那格上的毒气中间过期了就取消（源码里也是一旦 `RequestAbility` 就按线程走完）。
 */
interface PendingExplosion {
  atMs: number;
  casterSide: string;
  casterLevel: Level;
  target: Squad;
  damage: Damage;
  weaponId: string;
  /** 弹头效果名（日志/界面用它标出"这是爆炸，不是直击"） */
  effect: string;
}

export interface DuelOptions {
  /** 等级（默认 `level(1, 0)`）—— **两侧同一个等级**；要分开给就用 `levels` */
  level?: Level;
  /**
   * **两侧各自的等级**（`[A, B]`）—— 战斗页允许单独设置（用户要求：
   * 「战斗界面允许单独设置等级」）。给了它就覆盖 `level`。
   */
  levels?: [Level, Level];
  /** 两侧开局就位的时刻（默认 0） */
  startMs?: number;
  /**
   * **两侧开局是否已经架好**（`[A, B]`）—— 默认 `false`（都从"收着"开始架）。
   *
   * `true` = 这一侧**不是刚落地**，而是已经架在那儿 ⇒ 整个部署时长跳过、第一帧就能开火
   * （对战页的「初始已部署」开关；用户要求「…是否初始部署」）。
   */
  deployed?: [boolean, boolean];
  /**
   * **两侧的"起始行动延迟"**（毫秒，`[A, B]`）—— 默认 0。
   *
   * 语义：这一侧**还没到位**（在赶路 / 要等一会儿才动手）⇒ 它的**整条时间轴右移**这么多：
   * 部署从这一刻才开始架、队内错开也从这一刻起算（用户定的两条）。
   *
   * ⚠️ **它是假设、不是源码数据**：源码里没有位置/地图，`maxAttackRangeInTiles` 与 `speed`
   * 只能算出"射程差要走多久"这种**近似**，所以对战页上它由使用者选择（无延迟 / 按时间 / 按路程），
   * 默认值来自 `web/src/start-delay.ts` 的算式。
   */
  startDelay?: [number, number];
}

export class Duel implements Clock {
  elapsedMs = 0;
  readonly events: DuelEvent[] = [];
  readonly modifiers: RunningModifier[] = [];
  readonly sides: SideRuntime[] = [];
  readonly #notes: string[] = [];
  /** 还在飞的弹 */
  readonly #inFlight: Shot[] = [];
  /** 场上跑着的格子效果 */
  readonly #tiles: RunningTileEffect[] = [];
  /** 排队等扣血的爆炸（催化爆炸 —— 命中之后 `DAMAGE_TIME` 才扣） */
  readonly #pending: PendingExplosion[] = [];
  /** 已经提示过的事（按 key 去重） */
  readonly #noted = new Set<string>();
  /** 已经记过"整队阵亡"的 */
  readonly #deadSides = new Set<string>();
  /** **锁不上对面**的武器（`canAttack` 里没有对面的兵种）—— 整场不驱动，界面要明说 */
  readonly #blocked: Array<{ side: string; weaponId: string; canAttack: string[]; targetType: string }> = [];

  constructor(a: UnitDef, b: UnitDef, opts: DuelOptions = {}) {
    const shared = opts.level ?? levelOf(1, 0);
    const levels: [Level, Level] = opts.levels ?? [shared, shared];
    // ⚠️ 站桩：没有地图 ⇒ 现造两块格子（各占一块）
    const squadA = spawn(a, levels[0], new Tile());
    const squadB = spawn(b, levels[1], new Tile());
    this.elapsedMs = opts.startMs ?? 0;
    this.sides.push({ name: "A", squad: squadA, shooters: [], attackSinceMs: null, startDelayMs: opts.startDelay?.[0] ?? 0 });
    this.sides.push({ name: "B", squad: squadB, shooters: [], attackSinceMs: null, startDelayMs: opts.startDelay?.[1] ?? 0 });

    for (const [i, side] of this.sides.entries()) {
      const enemy = this.sides[1 - i]!.squad;
      const enemyType = targetTypeOf(enemy.def);
      for (const unit of side.squad.units) {
        const deploy = unit.def.deploy === undefined ? null : new DeployMachine(this, unit.def.deploy);
        // 「初始已部署」= 这一侧不是刚落地，而是已经架在那儿 ⇒ 跳过整个部署时长
        if (deploy !== null && opts.deployed?.[i] === true) deploy.startDeployed();
        const weapons: MountedWeapon[] = [];
        for (const def of unit.def.combatant.weapons) {
          // 没有伤害表的槽（壁虱的 `hidden` 那种容器）不驱动
          if (def.damage.length === 0) continue;
          const muzzle = def.usage.muzzleCount ?? 1;
          /*
           * **锁不上对面兵种的武器，整场不驱动**（`canAttack` 里没有这一类）。
           *
           * 用户实测提出：「MLRS 咋打死催化剂直升机了」—— 直升机的 `tags` 是 `Aircraft`，
           * 而 MLRS 的 `rockets` 与直升机自己的两把武器的 `canAttack` 都**不含 `Aircraft`**：
           * 这类武器在游戏里**根本锁不上**它，不是"打得中但伤害低"。
           * 早先这里只看"有没有伤害表"，于是站桩对局里它照样一发一发把直升机打下来了。
           */
          const reach = reachesType(def, enemyType);
          if (reach === "no") {
            this.#blocked.push({
              side: side.name,
              weaponId: def.id,
              canAttack: [...def.usage.canAttack],
              targetType: enemyType,
            });
            this.#notes.push(
              `${side.name} 的 \`${def.id}\` 打不到 ${enemyType}（\`canAttack\` = ${JSON.stringify(def.usage.canAttack)}）` +
                `⇒ 它每帧拿到的目标是空的、**全程停在 idle**、一发都不会打` +
                ` —— 这不是射程问题，是**打击清单里没有这类目标**`,
            );
          } else if (reach === "unknown") {
            this.#notes.push(
              `${side.name} 的 \`${def.id}\` 索敌方式没解出来（\`descriptors\` 空的）⇒ 这一场按"能打"处理，结论不可信`,
            );
          }
          weapons.push({
            def,
            machine: weaponMachineFor(def, this),
            shotsPerPull: def.usage.muzzleStrategy === "All" ? muzzle : 1,
            reach,
          });
        }
        side.shooters.push({ side: side.name, unit, enemy, deploy, weapons });
      }
    }
    this.#notes.push(
      NOTES.damageModifier,
      NOTES.falloff,
      "站位 / 射程 / 索敌未建模：两队恒在射程内、互相锁定（站桩）",
      `飞行时间：按武器算需要产物补 \`initialSpeed\`（J45）⇒ 未填的用 ${DEFAULT_FLIGHT_MS}ms 占位`,
      "攻速/装填类 debuff：已记录并计时，但武器机吃固定参数 ⇒ 节奏未变",
    );
  }

  get nowMs(): number {
    return this.elapsedMs;
  }

  /** 本场"未建模 / 无证据"清单（导出用） */
  get notes(): readonly string[] {
    return this.#notes;
  }

  alive(side: string): boolean {
    return this.#side(side).squad.alive;
  }

  /** 某一侧当前生效的属性修改（给以后的"有效参数"用） */
  statsOn(side: string): Array<{ stat: string; value: number; untilMs: number }> {
    return this.modifiers
      .filter((m) => m.targetSide === side && m.untilMs > this.elapsedMs)
      .map((m) => ({ stat: m.stat, value: m.value, untilMs: m.untilMs }));
  }

  /** 场上还活着的格子效果（导出 / 断言用） */
  get tileEffects(): ReadonlyArray<{ name: string; untilMs: number; casterSide: string }> {
    return this.#tiles.map((t) => ({ name: t.name, untilMs: t.untilMs, casterSide: t.casterSide }));
  }

  /**
   * **锁不上对面的武器**（`canAttack` 里没有对面的兵种）—— 这一场它们**一发都没打**。
   *
   * 界面必须把它显示出来：否则"某一方 0 伤害"会被读成"伤害算错了"，
   * 而真相是"这类目标压根不在它的打击清单里"（用户实测：MLRS 打不掉催化剂直升机）。
   */
  get blockedWeapons(): ReadonlyArray<{ side: string; weaponId: string; canAttack: string[]; targetType: string }> {
    return this.#blocked;
  }

  /**
   * **每名成员每把武器的记录** —— 导出"全行为系列"用（状态段 + 事件 + 发射时机）。
   *
   * 机器自己记这些（`states` / `events` / `shots`），这里只是把它们摊平成可 JSON 化的表。
   */
  weaponRecords(): Array<{
    side: string;
    unitIndex: number;
    weaponId: string;
    /** **自杀式武器**（打完这一发自己就销毁）—— 界面上开火标志要用爆星而不是剑 */
    selfDestruct: boolean;
    states: Array<{ start: number; state: string }>;
    events: Array<{ at: number; event: string }>;
    firedAtMs: number[];
  }> {
    const out: Array<{
      side: string;
      unitIndex: number;
      weaponId: string;
      selfDestruct: boolean;
      states: Array<{ start: number; state: string }>;
      events: Array<{ at: number; event: string }>;
      firedAtMs: number[];
    }> = [];
    for (const side of this.sides) {
      for (const s of side.shooters) {
        for (const mounted of s.weapons) {
          out.push({
            side: side.name,
            unitIndex: s.unit.index,
            weaponId: mounted.def.id,
            selfDestruct: mounted.def.selfDestruct === true,
            states: mounted.machine.states.map((x) => ({ start: x.start, state: x.state })),
            events: mounted.machine.events.map((x) => ({ at: x.at, event: x.event })),
            firedAtMs: mounted.machine.shots,
          });
        }
      }
    }
    return out;
  }

  /**
   * **推进一步** —— 顺序见文件头那张表：部署 → 武器 → 落地 → 格子 → 死亡 → 时钟。
   *
   * ⚠️ 时钟**最后**推：帧内所有读者看到的是"这一帧的开始"。
   */
  tick(deltaMs: number): void {
    const now = this.elapsedMs;

    // ① 部署机（站桩：一直要求架着）
    for (const side of this.sides) {
      if (!side.squad.alive) continue;
      // 还在赶路（起始行动延迟）时**不驱动部署机** —— 架设从"到位"那一刻才开始
      if (now < side.startDelayMs) continue;
      for (const s of side.shooters) {
        if (!s.unit.alive) continue;
        s.deploy?.update(true);
      }
    }

    // ② 武器机 → "在飞的弹"
    for (const side of this.sides) {
      if (!side.squad.alive) continue;
      for (const s of side.shooters) {
        if (!s.unit.alive) continue;
        /*
         * ⚠️ **队内错位是引擎侧的事**（J26）：`attackSeparationDurationMS` = 每个成员的起手偏移
         * （`Unit.startDelayMs = index × sep`）。错位没到点之前，调用方**根本不该驱动它** ——
         * 这条不做的话 5 个成员会在同一帧齐射（实测镜像对局从 15482ms 变成 13762ms）。
         *
         * ⚠️ **错开是"架好之后"才起算的，不是与部署取最大**（用户实测给的判据：
         * 「如果开局未部署，两只圣甲虫会同时自爆而不是第二只等第一只 2s」——
         * 圣甲虫 `unpackMs = 2000` 而 `attackSeparationDurationMS` 也是 2000，
         * 取最大会让两只在 2100ms 同时自爆；叠加才对：第 2 只 = 2000 + 2000 + 100 = 4100ms）。
         * 不部署的单位 `deployedAtMs` 就是 0 ⇒ 这一条对它们退化成原来的样子。
         *
         * ⚠️ **起始行动延迟在最外层**（用户定的：「整条时间轴后移」「错开从这个延迟之后开始算」）：
         * `起始延迟 → 架好 → 队内错开`，三段是**相加**的关系。
         */
        const readyAtMs = side.startDelayMs + (s.deploy?.deployedAtMs ?? 0) + s.unit.startDelayMs;
        if (now < readyAtMs) continue;
        for (const mounted of s.weapons) {
          // 没架好不许开火（部署机是唯一门禁）
          if (s.deploy !== null && !s.deploy.readyToFire) continue;
          const before = mounted.machine.shots.length;
          /*
           * **目标不对就"拒绝"它，并把这件事交给武器状态机**（用户的要求）。
           *
           * 判断在**喂目标这一步**做：`canAttack` 里没有对面兵种的武器，喂进去的是 `null`
           * ⇒ 武器机自己走 `idle` 分支（`CyclicWeapon.update` 的 ②），**照常记状态、照常走时间**，
           * 只是永远不会 `firing`。
           *
           * ⚠️ 早先这里是"整场不驱动它"（`continue`）—— 那样武器机一行状态都没有，
           * 界面上只能靠外面补一条假段来解释，等于把"能不能打"这件事挪出了武器机。
           * 现在 `reach` 只用在**这一个表达式**里，状态与事件仍然只有武器机一个来源。
           */
          const target = s.enemy.alive && mounted.reach !== "no" ? s.enemy : null;
          mounted.machine.update(target);
          if (mounted.machine.shots.length === before) continue;
          const tier = mounted.def.damage[0];
          if (tier === undefined) continue;
          side.attackSinceMs ??= now;
          const flight = mounted.def.flightMs ?? DEFAULT_FLIGHT_MS;
          for (let i = 0; i < mounted.shotsPerPull; i++) {
            this.#inFlight.push({
              firedAtMs: now,
              landAtMs: now + flight,
              shooter: s.unit,
              attacker: side.squad,
              target: s.enemy,
              weapon: mounted.def,
              tier,
            });
            this.events.push({
              atMs: now,
              kind: "fired",
              side: side.name,
              unitIndex: s.unit.index,
              weapon: mounted.def.id,
              landAtMs: now + flight,
            });
          }
          /*
           * **自杀式武器：打完这一发，自己就销毁**（`TakeHiddenDestroyDamage`，
           * `ability_scarab_weapon_sequence.lua:50-51`）—— **同一时刻**，不延迟。
           * 打出去的那一发照常在 ③ 落地结算（"人没了，弹还在飞"）。
           * ⚠️ 记 `cause: "self_destruct"` 而不是"阵亡"：界面上这两种要用**不同的图标**
           * （自杀式攻击是爆星，被打死是骷髅）。
           */
          if (mounted.def.selfDestruct === true) {
            s.unit.hurt(s.unit.hp);
            this.events.push({
              atMs: now,
              kind: "unit_dead",
              side: side.name,
              unitIndex: s.unit.index,
              cause: "self_destruct",
            });
          }
        }
      }
    }

    // ③ 落地结算（按落地时刻；同刻按开火先后）
    const landed = this.#inFlight
      .filter((s) => s.landAtMs <= now)
      .sort((a, b) => a.landAtMs - b.landAtMs || a.firedAtMs - b.firedAtMs);
    for (const shot of landed) {
      const at = this.#inFlight.indexOf(shot);
      if (at >= 0) this.#inFlight.splice(at, 1);
      this.#resolve(shot, now);
    }

    // ④ 排队的爆炸到点（催化爆炸：命中之后 `DAMAGE_TIME` 才扣血）
    this.#resolvePendingExplosions(now);

    // ⑤ 格子效果
    this.#tickTiles(now);

    // ⑥ 死亡
    for (const side of this.sides) {
      if (!side.squad.alive && !this.#deadSides.has(side.name)) {
        this.#deadSides.add(side.name);
        this.events.push({ atMs: now, kind: "squad_dead", side: side.name });
      }
    }

    // ⑦ 时钟最后推
    this.elapsedMs += deltaMs;
  }

  #side(name: string): SideRuntime {
    const s = this.sides.find((x) => x.name === name);
    if (s === undefined) throw new Error(`没有这一侧：${name}`);
    return s;
  }

  #sideOf(squad: Squad): string {
    return this.sides.find((s) => s.squad === squad)?.name ?? "?";
  }

  /** 结算一发：伤害 + 交付 + 弹头副作用 */
  #resolve(shot: Shot, now: number): void {
    const via = deliveryOf(shot.weapon);
    const outcome: ShotOutcome = resolveShot(shot);
    if (outcome.falloffUnmodeled) {
      this.events.push({
        atMs: now,
        kind: "note",
        text: `${shot.weapon.id}：按距离衰减未建模（没有位置）⇒ 按"每人各一份"结算`,
      });
    }
    for (const hit of outcome.hits) {
      /*
       * **0 伤害不记事件**（用户要求）。两种来路：
       * - 逐目标覆写成 0（毒气对载具 `Vehicle: 0`）；
       * - 等级/公式把小数抹成 0。
       * 它们**什么都没改**（`hurt(0)` 不动血、也不可能击杀），记进事件流只会把日志刷满
       * `−0（剩 1380）`这种噪声 —— 真相在产物里（覆写表），不在这一场的流水里。
       */
      if (hit.damage <= 0) continue;
      const victimSide = this.#sideOf(hit.victim.squad);
      this.events.push({
        atMs: now,
        kind: "hit",
        side: this.#sideOf(shot.attacker),
        unitIndex: shot.shooter?.index ?? -1,
        targetSide: victimSide,
        targetIndex: hit.victim.index,
        weapon: shot.weapon.id,
        damage: hit.damage,
        hpAfter: hit.hpAfter,
        killed: hit.killed,
        via,
      });
      if (hit.killed)
        this.events.push({ atMs: now, kind: "unit_dead", side: victimSide, unitIndex: hit.victim.index, cause: "killed" });
    }
    for (const eff of sideEffectsOf(shot.weapon)) this.#applySideEffect(eff, shot, now);
  }

  /** 执行一条弹头副作用（铺格子 / 续时 / 属性修改 / 催化爆炸） */
  #applySideEffect(eff: WarheadEffectDef, shot: Shot, now: number): void {
    const casterSide = this.#sideOf(shot.attacker);
    switch (eff.kind) {
      case "place_modifier": {
        /*
         * ⚠️ `spawnDelayMs`（毒气：**要连续开打这么久才铺得出**）——
         * 源码 `ability_chemical_weapon_sequence.lua:61` 判的是 `self:GetAgeMS() > spawnGasTimeMs`，
         * 即"从这次连续开打算起"⇒ 用 `attackSinceMs`。
         */
        const need = eff.effect.spawnDelayMs;
        if (need !== undefined) {
          const since = this.#side(casterSide).attackSinceMs ?? now;
          if (now - since < need) return;
        }
        const tile = shot.target.tile;
        if (tile === null) {
          this.events.push({ atMs: now, kind: "note", text: `${eff.name}：目标没有格子 ⇒ 没铺` });
          return;
        }
        const damage = new Damage(eff.effect.tickDamage, eff.effect.vs);
        const effect = new TileEffect(damage, eff.effect.tickMs, eff.effect.persistMs, now + eff.effect.persistMs);
        // 同名效果已存在 ⇒ **续时**（`refresh_modifier` 会单独再推一次；这里保证不重复铺）
        const exist = this.#tiles.find((t) => t.name === eff.name);
        if (exist !== undefined) {
          exist.untilMs = now + eff.effect.persistMs;
          return;
        }
        this.#tiles.push({
          name: eff.name,
          effect,
          tile,
          untilMs: now + eff.effect.persistMs,
          casterSide,
          casterLevel: shot.attacker.level,
          groundOnly: eff.effect.groundOnly,
          immune: [...(eff.effect.immune ?? [])],
          machines: new Map(),
        });
        this.events.push({
          atMs: now,
          kind: "tile_placed",
          side: casterSide,
          targetSide: this.#sideOf(shot.target),
          effect: eff.name,
          tickMs: eff.effect.tickMs,
          tickDamage: eff.effect.tickDamage,
          persistMs: eff.effect.persistMs,
        });
        return;
      }
      case "refresh_modifier": {
        for (const t of this.#tiles) {
          if (t.name !== eff.name) continue;
          t.untilMs = now + (t.effect.durationMs ?? 0);
        }
        return;
      }
      case "modify": {
        const targetSide = this.#sideOf(shot.target);
        for (const [stat, value] of eff.stats) {
          const untilMs = now + eff.durationMs;
          this.modifiers.push({ atMs: now, untilMs, targetSide, stat, value });
          this.events.push({ atMs: now, kind: "modify", side: casterSide, targetSide, stat, value, untilMs });
        }
        return;
      }
      case "catalyst_explosion": {
        /*
         * **打进已有对应效果的格子才炸**（`modifier_catalystgunship_projectile.lua:37-41`）：
         * 条件 = 目标格上有没有那个 modifier —— 本层就是 `#tiles` 里有没有那个名字。
         */
        const triggered = eff.triggers.some(
          (t) => t.kind === "tileHasModifier" && this.#tiles.some((x) => x.name === t.modifier && x.untilMs > now),
        );
        if (!triggered) return;
        if (eff.damage === undefined) {
          this.events.push({ atMs: now, kind: "note", text: "催化爆炸：伤害表没转出来 ⇒ 没结算" });
          return;
        }
        /*
         * **扣血是排队的、不是即时的**：`ability_catalyst_explosion.lua:21-28` 的线程是
         * `WaitForAge(EXPLOSION_START_TIME)`（放特效）→ `WaitForAge(DAMAGE_TIME)`（扣血）。
         * `WaitForAge(x)` = "等到年龄 = x"（绝对时刻，`WeaponSequenceUtil.lua:35-38` 的累加写法为证），
         * 所以从**命中**算起等 `damageMs`（直升机 300ms）。
         * ⚠️ 早先这里是"命中即扣" —— 于是日志里那一发直击与爆炸**同毫秒**出现且都叫 `catalystWeapon`，
         * 根本分不清哪个是哪个（用户指出）。
         */
        const delayMs = eff.timing?.damageMs;
        if (delayMs === undefined) {
          this.#noteOnce(`explosion-timing:${eff.impl}`, `催化爆炸（${eff.impl}）的扣血时刻没读出来 ⇒ 按「命中即扣」处理`);
        }
        this.#pending.push({
          atMs: now + Math.max(0, delayMs ?? 0),
          casterSide,
          casterLevel: shot.attacker.level,
          target: shot.target,
          damage: eff.damage,
          weaponId: shot.weapon.id,
          effect: eff.impl,
        });
        return;
      }
      default:
        return; // 其余（falloff / 交付类 / 未用到的）不在这里处理
    }
  }
  /**
   * **到点的爆炸真的扣血** —— 一整格每人各一份（`ability_catalyst_explosion.lua:33`
   * 的 `AoeDamageSquadListOverride`）。
   *
   * ⚠️ 0 伤害不记事件（同直击 / 每跳那条规矩）。
   */
  #resolvePendingExplosions(now: number): void {
    const due = this.#pending.filter((p) => p.atMs <= now).sort((a, b) => a.atMs - b.atMs);
    for (const p of due) {
      const at = this.#pending.indexOf(p);
      if (at >= 0) this.#pending.splice(at, 1);
      const per = Math.round(p.casterLevel.dps(p.damage.against(targetTypeOf(p.target.def))));
      if (per <= 0) continue;
      const side = this.#sideOf(p.target);
      for (const u of p.target.aliveUnits) {
        u.hurt(per);
        this.events.push({
          atMs: now,
          kind: "hit",
          side: p.casterSide,
          unitIndex: -1,
          targetSide: side,
          targetIndex: u.index,
          weapon: p.weaponId,
          effect: p.effect,
          damage: per,
          hpAfter: u.hp,
          killed: !u.alive,
          via: "squad_each",
        });
        if (!u.alive) this.events.push({ atMs: now, kind: "unit_dead", side, unitIndex: u.index, cause: "killed" });
      }
    }
  }

  /** 同一件事只提示一次（例如"某个字段没读出来"，每发都记会把日志刷满） */
  #noteOnce(key: string, text: string): void {
    if (this.#noted.has(key)) return;
    this.#noted.add(key);
    this.#notes.push(text);
    this.events.push({ atMs: this.elapsedMs, kind: "note", text });
  }

  /** 格子效果：每跳打一次（**整队每人各一份**） */
  #tickTiles(now: number): void {
    for (let i = this.#tiles.length - 1; i >= 0; i--) {
      const t = this.#tiles[i]!;
      if (t.untilMs <= now) {
        this.events.push({ atMs: now, kind: "tile_expired", effect: t.name });
        this.#tiles.splice(i, 1);
        continue;
      }
      for (const side of this.sides) {
        // ⚠️ **只有站在这块格子上的小队才吃每跳**（铺在对面格子上，施法者自己不受影响）
        if (!side.squad.alive || side.squad.tile !== t.tile) continue;
        /*
         * **只打地面的效果不吃空军**（火 / 毒气都是 `DESCRIPTOR_FILTERS = Ground`）——
         * 直升机站在火里不该掉血；这条不判的话"空军站桩"会被毒气白嫖。
         */
        if (t.groundOnly && targetTypeOf(side.squad.def) === "Aircraft") continue;
        /*
         * **免疫名单**：源码 `aura_gas_cloud.condition` 的 `IMMUNE_UNIT1/2`
         * （`Unit_Nod_ChemicalWarrior` / `Unit_Nod_ChemQuad` —— 化武兵与毒车不吃自己的毒气）。
         * ⚠️ 名单里是 **Lua 的类型名**，与我们的 id 只差大小写（`Unit_Nod_ChemQuad` → `unit_nod_chemquad`），
         * 所以直接小写比对；对不上的名字**不会**被当成免疫（宁可多掉血，也不凭空免伤）。
         */
        if (t.immune.length > 0 && t.immune.some((n) => n.toLowerCase() === side.squad.def.id)) continue;
        let machine = t.machines.get(side.squad);
        if (machine === undefined) {
          // 首次在 `delayMs` = 一个 tickPeriod 之后跳第一下（`modifier_unstackable_damage_over_time.lua:33`）
          machine = new EffectMachine(this, { tickMs: t.effect.tickMs, delayMs: t.effect.tickMs });
          t.machines.set(side.squad, machine);
        }
        const before = machine.ticks.length;
        machine.update(true); // 站桩：一直站在格子里
        const ticks = machine.ticks.length - before;
        if (ticks === 0) continue;
        const per = Math.round(t.casterLevel.dps(t.effect.damage.against(targetTypeOf(side.squad.def))));
        /*
         * **0 伤害不记事件**（与直击同一条规矩）：毒气打在载具上（`Vehicle: 0`）就是这种 ——
         * 跳了、但一点血都没掉，记进日志只会得到一串 `共 0 伤害`。
         * ⚠️ 节拍机**照样推进**（`machine.update` 已经在上面跑过了），只是不产出事件。
         */
        if (per <= 0) continue;
        let total = 0;
        let hits = 0;
        for (let k = 0; k < ticks; k++) {
          for (const u of side.squad.aliveUnits) {
            u.hurt(per);
            total += per;
            hits++;
            if (!u.alive) this.events.push({ atMs: now, kind: "unit_dead", side: side.name, unitIndex: u.index, cause: "killed" });
          }
        }
        this.events.push({ atMs: now, kind: "tile_tick", side: t.casterSide, effect: t.name, hits, damage: total });
      }
    }
  }
}
