/**
 * 1v1 伤害赛跑（"战斗时间线"）。
 *
 * ## 这是什么，不是什么
 *
 * **是**：两个单位**已经接触、都够得着**的前提下，按各自 `derived.attack.tracks` 的开火时序
 * 逐发结算伤害、逐员扣血，直到一方全灭 —— 一个确定性的事件驱动模拟。
 *
 * **不是**：对战回放。未建模的项集中在 `SIM_CAVEATS`，页面上必须原样列出。
 *
 * ## 建模依据（每条都有台账行）
 *
 * · **伤害与血量都是「每员」量**（I228）：`weapons[].damage` 打一员；
 *   血量 = `health.per_member`（逐员存），面板总血 = `per_member × wave_size`。
 * · **普通攻击一次只打一员**（`DamageSquadList` → `GetLastCombatant()`，I228）。
 * · **减员按开火顺序倒序淘汰**（I229：被打的总是最后一个开火的）——
 *   于是"谁是当前被打的那一员"= `alive` 的末位，该员死后自然前移。
 * · **AoE 对存活成员各打一份**（I228 的 `AoeDamageSquadList`）。
 * · **开场三段**：冷却余量 → 转身 → `initialChargeUpMs`（I231）。本页把前两项压成
 *   一个可输入的"开场延迟"，前摇由各轨的 `charge_ms` 承担。
 * · **`chargeInCycle` 只影响相位归属**：为真 ⇒ 前摇在周期内（首发落在 `charge`，之后每 `cycle` 一轮）；
 *   为假 ⇒ 前摇在周期外（时间相加，首发即 `charge` 之后进第 0 相）。
 * · **等级倍率**用 `levels.ts` 的 `F`（`factor()`），伤害 `round(base × F)`。
 *
 * ⚠️ **不确定的地方宁可留空也不猜**：找不到周期的轨直接跳过并记进 `notes`，不编一个数出来。
 */

import type { DatasetEntry, Track, Weapon } from "@rivals/core/derive";
import type { DamageOverrideTag } from "@rivals/core/types";
import type { Level } from "@rivals/core/levels";

import { damageOf } from "./damageTiers.ts";

/** 模拟上限：超过这个时长就判"打不死"（防止某些组合永不结束） */
export const SIM_LIMIT_MS = 120_000;

/** 页面上要明示的未建模项（与文件头同源） */
export const SIM_CAVEATS: string[] = [
  "站位与接近：假设双方已接触、互相够得着（地图与避让公式不在客户端，I223/I221）",
  "整队伤害的判据是「伤害走 AoeDamageSquad*」（I228/I239）：打对面**小队**每人各一份。" +
    "而神像机甲/沙暴/泰坦/虎鲸/自行火炮的「多格 · 圆形」是**每个战斗员各一份**，" +
    "对**别的**小队也有伤害 —— 本页 1v1 只算对面那一队，不编多格收益",
  "AoE 同时打死多员的次序：这里按倒序逐员结算，未必等于引擎同帧次序（I230）",
  "全局冷却（unitHealthAffectsGCD）：字段已知、取值未取，未建模（I234）",
  "毒雾 / 光环 / 指挥官技 / 压制 / 隐身 / EMP / 减速：未建模（`auras/` 与 36 个 ability 未提取）",
  "开场延迟是你填的，不是算出来的：冷却余量、转身时间、是否已部署都要你自己判断（I231/I232/I234）",
];

export interface SimInput {
  entry: DatasetEntry;
  level: Level;
  /** 开场额外延迟（毫秒）—— 冷却余量 + 转身，由使用者给出 */
  openingDelayMs?: number;
  /**
   * **生效中的 `Stat.*` 修正器**（"给自己人上加速/减防"那一套）。
   *
   * ⚠️ **本页不会自己判断"什么时候开"**：指挥官技是玩家点的、狂热是队友阵亡触发的、
   * M.S.V. 的加成是它落地时给周围友军的 —— 触发条件全都不在这份数据里。
   * 所以由使用者在页面上勾选"这一局里它生效了"，这里只负责按勾选改时序与伤害。
   */
  statMods?: Array<{ name: string; stats: Record<string, number> }>;
  /**
   * **共享的场地效果表**（`data/units.json` 顶层的 `auras`）—— 见 `hazardSpecOf`。
   * 单位里只有引用名，数值必须从这张表查。
   */
  auras?: Record<string, Record<string, unknown>>;
  /**
   * **是否已架设**（`modifier_intro` 那套）。两件事由它决定：
   *
   *   · **减伤**：壁虱坦克 70%、机枪小队 50%（`stats.damage_reduction_pct`），
   *     架设后在 `deploy_ms − 250ms` 生效（`DAMAGE_REDUCTION_TIME_MS`，
   *     见 `modifier_damagereduction_intro.lua` 的 `ApplyDamageReduction`）
   *   · **机枪小队必须先架起来才能打**（用户指出）—— 未架设时它的开火被推迟
   *
   * 默认 `true`（打起来的时候通常已经架好了）；设成 `false` 就能看到"没架设"的代价。
   */
  deployed?: boolean;
}

export interface SimSide {
  entry: DatasetEntry;
  level: Level;
  /** 当前存活成员的**开火下标**（升序；沿用 I44 的 `i`，末位 = 当前被打的那员） */
  alive: number[];
  /** 开火下标 → 剩余血量 */
  hp: Map<number, number>;
  /** 每员最大血（已套等级） */
  maxHp: number;
  /** 该单位的可攻击目标类型 */
  type: DamageOverrideTag;
  /** 参与输出的武器（已排除靶子桩与索敌未知） */
  weapons: Weapon[];
  /** 面板总血 */
  maxTotal: number;
  /**
   * **受到的伤害倍率**（`1 − 减伤%`）。
   *
   * 壁虱坦克/机枪小队的 `modifier_intro` 是"架起来才有的减伤"，所以这个倍率是
   * **随时间变的**：架设后 `deploy_ms − 250ms` 处从 1 降到 `1 − pct`。
   * 见 `modifier_damagereduction_intro.lua` 的 `ApplyDamageReduction`。
   */
  damageTakenMult: number;
  /** 减伤生效的时刻（毫秒）；`null` = 没有减伤或已生效（倍率已是终值） */
  reductionAtMs: number | null;
  /** **停下/架设完成前不能开火**（`stats.must_deploy_to_fire`）—— MLRS 这种 */
  mustDeployToFire: boolean;
  /** 开场是否已部署 */
  deployed: boolean;
  /** 部署动作的时长（`stats.deploy_ms`，即 `modifier_intro.durationMs`） */
  deployMs: number;
  /** 开场是否已部署 —— 未部署时时间线要画出这段动作 */
  deployFromMs: number | null;
  /**
   * **用户填的"开场延迟"**（冷却余量 + 转身）—— 时间线要把它画成行首的等待段。
   *
   * ⚠️ 它是**输入**不是算出来的（`SimInput.openingDelayMs`），但图上必须看得见：
   * 否则"行的最左边那段空白"读不出是哪来的（用户："开场延迟段也没进时间线"）。
   */
  openingDelayMs: number;
  /**
   * **攻击后自身消失**（`stats.self_destruct`）—— 圣甲虫。
   *
   * 用户实测："自爆不会杀死自己, 也不会对全队造成伤害"；源码一致：
   * `ability_scarab_weapon_sequence.lua:51` 打完最后一发就
   * `self:GetOwnerCombatant():TakeHiddenDestroyDamage()` —— **直接销毁，不是"受到伤害"**，
   * 所以不参与减伤，也不经过 `modifier_scarab_projectile` 的 AOE 查询
   * （那个查询另有 `FilterSquads` 把被打方排除，见 I242）。
   *
   * ⚠️ 本页把它建模成"**这一发打出去了，然后射手全灭**"：射出的弹体照样结算伤害
   * （源码是 `FireFromMuzzle` 在前、`TakeHiddenDestroyDamage` 在后）。
   */
  selfDestruct: boolean;
  /**
   * **命中后在目标格铺的格子效果**（火 / 毒气）—— 数值全部来自产物，见 `hazardSpecOf`。
   * 空数组 = 这个单位不铺任何东西。
   */
  hazards: HazardSpec[];
  /** 地面单位（`stats.ground`）—— 决定它会不会被格子上的火/毒烧到 */
  ground: boolean;
  /**
   * **这一方首次命中对手的时刻** —— 毒车的 `spawnGasTimeMs` 是"开火序列活了多久"，
   * 本页用"首次命中起算的时长"近似（1v1 只有一个目标 ⇒ 与"序列存活时间"等价）。
   */
  firstHitAtMs: number | null;
  /**
   * **被挂了 EMP 之后的攻速倍率**（1 = 正常）。
   *
   * EMP 是"给对面挂减速"（用户的说法）：`stats.emp.attack_speed_pct` 是**攻速降幅**，
   * 于是被挂者的**开火周期**拉长 `1 / (1 − pct)` —— 飞影 100% ⇒ 这 2 秒内**完全打不出**。
   *
   * ⚠️ 这里只建模**攻速**（装填/移速/转向对 1v1 的固定站位没有意义）。
   */
  cadenceMult: number;
  /**
   * **这一方打出的 EMP 会把对面周期乘多少**（1 = 不带 EMP）。
   * 飞影 100% ⇒ `Infinity`（被打的这两秒**完全开不出火**）。
   */
  empDeals: number;
  /** EMP 时长（毫秒）—— 每次命中会把对面那张窗口往后顺延 */
  empMs: number;
  /** EMP 能挂到哪些目标类型（`stats.emp.targets`，实测 5 个单位都是 `Vehicle`） */
  empTargets: DamageOverrideTag[];
  /**
   * **时序被拉长的窗口**（EMP 减速 / 加速类修正器）。
   *
   * 统一成一张表的原因：这两件事在数学上是同一个东西 —— 都是
   * "某段时间里，名义时间每过 1ms，实际世界时间过 `mult` ms"。
   * 之前 EMP 自己写了一套 `slowAt`，加速再写一套必然分叉，所以合成 `dilateAt`。
   *
   * ⚠️ 拉长的是**名义周期**，不是"把周期字段改大"：`mult = Infinity`
   * （飞影 100%）表示这段窗口里**完全开不出火**。
   */
  cadenceWindows: Array<{ name: string; from: number; to: number; mult: number }>;
  /** 本局生效的 `Stat.*` 修正器（勾选后生效） */
  statMods: Array<{ name: string; stats: Record<string, number> }>;
  /** **受到的伤害加成**（`IncomingDamageAddition`，奥克萨娜的狂热 25%）⇒ 伤害 × 它 */
  modIncoming: number;
  /** **打出的伤害加成**（`OutgoingDamagePercentIncrease`，M.S.V. 写的是 0）⇒ 伤害 × 它 */
  modOutgoing: number;
}

/**
 * **`modifier_intro` 到底是什么**（用户两条实测：MLRS 停车自动部署、没架完不能开火；
 * 壁虱坦克可以停下来架好再打、也可以不架边跑边打）。
 *
 * 源码逐条核对：
 *
 * | 单位 | `modifier_intro.behaviour` | `canShootWhileMoving` | 部署是门禁吗 |
 * | --- | --- | --- | --- |
 * | 多管火箭 / 神像 / … | `modifier_simple_intro` | 无 | **是**（用户确认 MLRS） |
 * | 自行火炮 | `modifier_slowturn_intro` | 无 | 待确认 |
 * | 壁虱坦克 / 机枪小队 | `modifier_damagereduction_intro` | 壁虱 `true`、机枪无 | 壁虱**否**（可选）· 机枪待确认 |
 * | M.S.V. | `modifier_spawnmodifier_intro` | 无 | 待确认 |
 *
 * **分界线就是 `canShootWhileMoving`**（`CombatTuningInfo.lua:422`，面板上叫 Raider）：
 * 有它的单位能边跑边打 ⇒ 部署只是可选收益（壁虱的 70% 减伤，一动就丢）；
 * 没有它的就得停下架好再打。
 *
 * ⚠️ **仍未确认**：那 7 个"没有 `canShootWhileMoving` + 有 `deploy_ms`"的单位里，
 * 哪些的部署是**硬门禁**、哪些只是"停下才开火但不必等完动作"。产物里
 * `stats.must_deploy_to_fire` 目前按"有 deploy_ms 且无 canShootWhileMoving"标，
 * 这批需要游戏内逐个确认（台账 I241）。
 */
const REDUCTION_LEAD_MS = 250;

export interface Shot {
  t: number;
  /** 0 = 左，1 = 右 */
  side: 0 | 1;
  /** 开火的那一员（开火下标；AoE 也知道是谁放的） */
  member: number;
  weaponId: string;
  weaponName: string;
  /** 这一发打在目标身上的实际伤害（0 = 打不到） */
  damage: number;
  reachable: boolean;
  /** 是否**打对面整队**（每个存活成员各吃一份，`weapons[].squad_damage`） */
  aoe: boolean;
  /**
   * 这一发**打到了对方的哪几员**（各掉多少）—— 渲染标志用。
   * 普通攻击只有一项（打 `alive` 末位，I229）；AoE 是全体存活成员（I228）。
   * 打不到该类型时为空数组。
   */
  hits: Array<{ side: 0 | 1; member: number; damage: number; killed: boolean }>;
  /**
   * **格子效果**的伤害（不是这把武器直接打的）—— 目前只有圣甲虫/火焰轰炸机留下的火。
   *
   * `null` = 普通的一发；有值 = 这是"站在火里挨的那一下"（每 250ms 一次），
   * 渲染时**不能画成攻击标志**（那不是开火）。见下面的 `Hazard`。
   */
  hazard?: HazardKind | null;
}

/** 格子上的持续效果：火（圣甲虫/火焰轰炸机）与毒气（催化剂/化武兵/毒车） */
export type HazardKind = "fire" | "gas";

/**
 * **格子效果（火 / 毒气）的份额从共享表解析**。
 *
 * ⚠️ **单位里没有数值副本** —— `stats.leaves_fire` / `stats.leaves_gas` 只是**引用**
 * （名字就是那个 modifier），数值来 `data/units.json` 顶层的 `auras` 表查
 * （用户："场地效果应该不放在单位里面而是单独被引用"）。
 * 理由：圣甲虫与火焰轰炸机铺的是**同一个火**；太伯利亚力场更是没有任何单位"拥有"它 ——
 * 抄副本必然分叉。
 *
 * ⚠️ **只做形状转换，不填任何默认值**：查不到就让这一侧完全没有该效果。
 * 宁可少画一层火，也不硬编码一个可能过期的数。
 */
function hazardSpecOf(
  kind: HazardKind,
  ref: string | undefined,
  auras: Record<string, Record<string, unknown>>,
  /** 这一方的"要打多久才铺得出来"（`stats.spawn_gas_ms`；火没有这道门槛 ⇒ 0） */
  delayMs = 0,
): HazardSpec | null {
  if (!ref) return null;
  const raw = auras[ref];
  if (!raw) return null;
  const tickMs = typeof raw["tick_ms"] === "number" ? raw["tick_ms"] : 0;
  const tickDamage = typeof raw["tick_damage"] === "number" ? raw["tick_damage"] : 0;
  const persistMs = typeof raw["persist_ms"] === "number" ? raw["persist_ms"] : 0;
  if (!(tickMs > 0) || !(tickDamage > 0) || !(persistMs > 0)) return null;
  const spec: HazardSpec = {
    kind,
    ref,
    tickDamage,
    tickMs,
    persistMs,
    delayMs: Math.max(0, delayMs),
    groundOnly: raw["ground_only"] !== false,
  };
  /*
   * `vs` 是"这个效果打谁"的逐类型覆盖（毒气写的是 `Vehicle: 0` ⇒ **载具完全不吃**）。
   * 它同时承担两件事：① 打不到的类型伤害为 0；② 反过来看它能打到的类型集合。
   */
  const vs = raw["vs"];
  if (vs !== null && typeof vs === "object" && !Array.isArray(vs)) {
    spec.vs = vs as Partial<Record<DamageOverrideTag, number>>;
  }
  const immune = raw["immune"];
  if (Array.isArray(immune)) spec.immune = immune.map(String);
  return spec;
}

interface HazardSpec {
  kind: HazardKind;
  /** 共享表里的键（就是那个 modifier 名）—— 渲染与提示里要显示它 */
  ref: string;
  /** 每跳每员伤害（**1-0 基准**，结算时再套等级） */
  tickDamage: number;
  tickMs: number;
  persistMs: number;
  /** 只对地面单位生效（`condition.DESCRIPTOR_MASK = Ground`） */
  groundOnly: boolean;
  /**
   * **要"开打多久"才铺得出来**（毫秒）—— 毒车的 `spawnGasTimeMs = 2100`。
   *
   * 源码判据是 `self:GetAgeMS() > spawnGasTimeMs`（`ability_chemical_weapon_sequence.lua:58`），
   * 即**这条开火序列的存活时间**。本页近似成"这一方**首次命中**起算的时长" ——
   * 真实规则里目标一换人计时就归零，而 1v1 只有一个目标，两者等价。
   * 催化剂没有这道门槛（直接 `RefreshCloud`），所以是 0。
   */
  delayMs: number;
  /** 逐类型伤害覆盖（`damage.override`）—— **0 表示完全不吃** */
  vs?: Partial<Record<DamageOverrideTag, number>>;
  /** 免疫名单（**单位 id**，`condition.IMMUNE_UNITn`）—— 本页是 1v1，不建它的模，只如实带出 */
  immune?: string[];
}

/**
 * **格子上的持续效果** —— 火（圣甲虫/火焰轰炸机）与毒气（催化剂/化武兵/毒车）。
 *
 * ## 为什么单独建 `Tile` 这个对象（用户："有没有可能地块也视作一个对象"）
 *
 * **因为游戏里就是这样的**，这不是抽象洁癖：
 *
 * | 环节 | 位置 | 事实 |
 * | --- | --- | --- |
 * | 铺 | `modifier_scarab_projectile.lua:71-72` | `RequestModifier(tile, …, MODIFIER_FIRE, …)` —— 效果**挂在 tile 上** |
 * | 查/续 | `ability_chemical_weapon_sequence.lua:92,101` | `GetAbilityByNameId(tile, …)` + `ResetPersistTime()` —— **按 tile 查、按 tile 续** |
 * | 谁挨打 | `common/trigger_single_tile_aura.lua:7,26-32` | 订阅 `hexTile:GetOccupantSquadChangeEvent()` —— **tile 自己持有占位者** |
 *
 * 压成"一串 hazard（带 `from` 字段）"会立刻出两个错，都是真实踩过的：
 * ① **火被当成"施法者的效果"** ⇒ 圣甲虫开火后自爆，那层火跟着失效（用户："猛犸被圣甲虫炸没有火伤"）。
 *    正确语义是：**火属于地块，铺下去之后跟铺它的人死没死无关**。
 * ② **没有"格子上站了谁"** ⇒ 只能假设"打谁就烧谁"，于是第二只圣甲虫被打时，
 *    已铺好的火还在不在、算不算自己铺的，全都说不清。
 */
export interface Tile {
  /** 格子编号 —— 本页是 1v1，只有"被攻击方所站的那一格"，所以恒为 `"target"` */
  id: string;
  /** 上面的效果（每种最多一层，重复铺只是续时） */
  hazards: Hazard[];
  /** 占位者：本页把"被打的那一方"当作站在这一格上（站位数据不在客户端，I223） */
  occupants: Array<0 | 1>;
}

/** 建一张格子的初始状态 */
function makeTargetTile(): Tile {
  return { id: "target", hazards: [], occupants: [0, 1] };
}

/**
 * **格子上的一层效果** —— 铺在哪张格子、谁铺的、还剩多久。
 *
 * 铺 / 续的语义（`modifier_fire_bomber_fire:ResetPersistTime` /
 * `ability_chemical_weapon_sequence:RefreshCloud`）：**同一格重复铺只是续时**，
 * 既**不叠加伤害**，也**不会把时限拉长到超过 `PERSIST_DURATION_MS`** ——
 * 后者是关键：火焰轰炸机每 3.2s 打一发、火能活 10s，若"续时"是无限延长，
 * 火就永远不会灭；实测（I243）它确实会灭（末跳 23.00s，不是打到结束）。
 */
export interface Hazard extends HazardSpec {
  /** 哪一方留下的（铺下去之后**不再影响判定**，只用于渲染配色与提示） */
  from: 0 | 1;
  /** 铺下的时刻 */
  atMs: number;
  /** 这一层最多活到什么时候（`atMs + persistMs`，**续时不会突破它**） */
  untilMs: number;
  /** 已经结算到哪一跳了（内部状态，由模拟循环推进） */
  nextTick: number;
}

export interface Death {
  t: number;
  side: 0 | 1;
  member: number;
  /**
   * **这一员是怎么没的**：
   *   · `killed` —— 被打死
   *   · `selfDestruct` —— 自己开火后 `TakeHiddenDestroyDamage()` 销毁（圣甲虫那一员）
   *
   * ⚠️ 区分它是因为**渲染要画不同的标志**（骷髅 vs 自爆），而且同一次开火会造成
   * "对面被打死 + 自己自爆"两类死亡 —— 不区分就只能按"一方"画一个，于是
   * 2 员的圣甲虫只有第一只会显示自爆标志（用户："第一只圣甲虫攻击和自杀式攻击两个图标提示出现,
   * 第二个只有攻击"）。
   */
  cause: "killed" | "selfDestruct";
}

/** 挨打记录：给"每员一条横条"的渲染用（谁、什么时候、掉了多少） */
export interface Hit {
  t: number;
  /** 被打的那一方 */
  side: 0 | 1;
  /** 被打的那一员 */
  member: number;
  damage: number;
}

export interface TimelinePoint {
  t: number;
  /** 两侧剩余总血 */
  hp: [number, number];
}

export interface SimResult {
  shots: Shot[];
  deaths: Death[];
  hits: Hit[];
  timeline: TimelinePoint[];
  endedAtMs: number;
  winner: 0 | 1 | null;
  notes: string[];
  /**
   * **格子上的火**（圣甲虫/火焰轰炸机铺下的）。`null` = 本局没有火。
   *
   * 它不是"某一发子弹"，所以**不混进 `shots` 里的普通开火**（`Shot.hazard` 有值的那些
   * 才是火的跳伤，渲染时不能画成攻击标志）。
   */
  hazards: Hazard[];
  sideInfo: Array<{
    maxHp: number;
    members: number;
    maxTotal: number;
    label: string;
    /** 队员开火错开（毫秒）—— 渲染"每员一行"时整条轴要后移 `i × 它`（I44） */
    separationMs: number;
    /** 部署动作时长（`modifier_intro.durationMs`）—— 时间线要画出这一段 */
    deployMs: number;
    /** 开场是否已部署（未部署才画那段动作） */
    deployed: boolean;
    /** 未部署时是否**不能开火**（MLRS 那种；壁虱是可选部署） */
    mustDeployToFire: boolean;
    /** 用户填的**开场延迟**（冷却余量 + 转身）—— 时间线要画成行首的等待段 */
    openingDelayMs: number;
    /** **攻击后自身消失**（圣甲虫）—— 时间线要标出来 */
    selfDestruct: boolean;
    /**
     * **每一员自爆的时刻**（下标 → 毫秒）；没自爆的员不出现。
     *
     * ⚠️ 早先只存"第一次自爆的时刻"（一个标量），于是多员的自杀式单位
     * **只有第一员会画出自爆标志**（用户："第一只圣甲虫攻击和自杀式攻击两个图标提示出现,
     * 第二个只有攻击"）。2 员的圣甲虫两只是一前一后各炸一次的。
     */
    selfDestructAt: Array<[number, number]>;
    /** 这一方开火后**不会**自己消失（正常单位）—— 只用于提示文案 */
    suicideMembers: number;
    /** **这一方带 EMP**（`stats.emp`）—— 结果区要说明"只对载具" */
    emp: { attack_speed_pct?: number; duration_ms?: number; targets?: string[] } | null;
    /** **本局勾选生效的 `Stat.*` 修正器**（用户勾的，不是数据自带的触发条件） */
    statMods: Array<{ name: string; stats: Record<string, number> }>;
    /** 这一方能铺的场地效果名（`stats.leaves_fire` / `leaves_gas`）—— 提示用 */
    hazards: string[];
  }>;
}

/** 该条目在产物里的基础类型标签（与 `DAMAGE_CASCADE` 的键一致） */
function targetTypeOf(entry: DatasetEntry): DamageOverrideTag {
  const t = entry.derived.stats.unit_type;
  if (t === "Infantry" || t === "Vehicle" || t === "Aircraft" || t === "Structure" || t === "Harvester") {
    return t;
  }
  // 没有 unit_type 的（总部/建筑）按结构处理 —— 武器对 Structure 恒可打
  return "Structure";
}

/**
 * 该武器是不是**打对面整队**（每个存活成员各吃一份）。
 *
 * ⚠️ **判据只能是 `squad_damage`，不能用 `area.kind`** —— 这是页面上
 * "圣甲虫一发打不死对面一队"那个 bug 的根因（`area.kind` 是 `none`，而它其实是整队伤害）。
 *
 * 判据是**伤害走哪个 API**（`DamageUtil.lua`）：
 *
 * | 实现 | API | 效果 |
 * | --- | --- | --- |
 * | `AoeDamageSquadListOverride` | `squad:TakeAOEDamage` | **整队每人各一份** |
 * | `DamageCombatantListOverride` | `combatant:TakeDirectDamage` | 列表里**每个战斗员**各一份 |
 * | `DamageSquadListOverride` | `GetLastCombatant():TakeRedirectDamage` | **只掉一员** |
 *
 * 于是只看 `area.kind` 会把**泰坦机甲 / 沙暴 / 神像机甲 / 虎鲸轰炸机 / 自行火炮**
 * 全部误判成"整队伤害"（它们的 `area` 非 `none`，但走的是 `DamageCombatantList*`
 * —— 那是"多格/圆形里各打一员"，**不是**每人一份）。反过来圣甲虫的 `area.kind` 是
 * `none` 却被漏判。两个方向都错，所以 `area` 在这里**根本不是判据**。
 *
 * ⚠️ 已知未建模：上述"多格/圆形里各打一员"对**单个小队之外**的敌人也造成伤害，
 * 本页是 1v1、只算对面那一队，所以只取"每格一员"里的第一员 —— 不编多格收益。
 */
function isAoe(w: Weapon): boolean {
  return w.squad_damage === true;
}

/** 造一侧的初始状态 */
export function makeSide(input: SimInput): SimSide {
  const { entry, level } = input;
  const auras = input.auras ?? {};
  const per = entry.derived.health?.per_member ?? 0;
  const wave = entry.derived.health?.wave_size ?? 1;
  const maxHp = level.hp(per);
  const hp = new Map<number, number>();
  for (let i = 0; i < wave; i++) hp.set(i, maxHp);
  /*
   * 只保留"有伤害 + 打得到某类目标"的武器 —— 与 `dps.ts` 的 `unitDpsVs` 同判据。
   * `targeting_unknown` 的 4 把（真的未知那几把）不参与。
   */
  const weapons = entry.derived.weapons.filter(
    (w) => w.damage > 0 && !w.targeting_unknown && w.can_attack.length > 0,
  );
  const deployed = input.deployed !== false;
  const pct = entry.derived.stats.damage_reduction_pct ?? 0;
  const deployMs = entry.derived.stats.deploy_ms ?? 0;
  const mustDeploy = entry.derived.stats.must_deploy_to_fire === true;
  const side: SimSide = {
    entry,
    level,
    alive: [...hp.keys()],
    hp,
    maxHp,
    type: targetTypeOf(entry),
    weapons,
    maxTotal: maxHp * wave,
    // 已部署 ⇒ 开场就带着减伤；未部署 ⇒ 部署动作走完后才有
    damageTakenMult: deployed ? 1 - pct / 100 : 1,
    reductionAtMs: !deployed && pct > 0 ? Math.max(0, deployMs - REDUCTION_LEAD_MS) : null,
    mustDeployToFire: mustDeploy,
    deployed,
    deployMs,
    deployFromMs: !deployed && deployMs > 0 ? 0 : null,
    openingDelayMs: Math.max(0, input.openingDelayMs ?? 0),
    selfDestruct: entry.derived.stats.self_destruct === true,
    ground: entry.derived.stats.ground === true,
    hazards: [
      hazardSpecOf("fire", entry.derived.stats.leaves_fire, auras),
      hazardSpecOf(
        "gas",
        entry.derived.stats.leaves_gas,
        auras,
        entry.derived.stats.spawn_gas_ms ?? 0,
      ),
    ].filter((h): h is HazardSpec => h !== null),
    firstHitAtMs: null,
    /*
     * EMP 的攻速降幅 → 周期倍率：`攻速 × (1 − pct)` ⇒ 周期 `× 1/(1 − pct)`。
     * pct = 100（飞影）时倍率是无穷大 —— 用 `Infinity` 表示"这段时间开不出火"，
     * 由 `peek` 负责跳过（不是"周期变得很长"，是**根本打不出来**）。
     */
    cadenceMult: 1,
    empDeals: (() => {
      const pct = entry.derived.stats.emp?.attack_speed_pct;
      if (pct === undefined || !(pct > 0)) return 1;
      return pct >= 100 ? Infinity : 1 / (1 - pct / 100);
    })(),
    empMs: entry.derived.stats.emp?.duration_ms ?? 0,
    empTargets: (entry.derived.stats.emp?.targets ?? []).filter((t): t is DamageOverrideTag =>
      (["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"] as string[]).includes(t),
    ),
    cadenceWindows: [],
    statMods: (input.statMods ?? []).map((m) => ({ name: m.name, stats: m.stats ?? {} })),
    modIncoming: 1,
    modOutgoing: 1,
  };
  /*
   * **勾选的修正器**：从开场生效，按它自己的 `durationMs` 到期。
   *
   * ⚠️ `durationMs = -1` 在 McNeil 的 EMP 上出现过（**无时限**）——
   * 按"整局有效"处理，**不能当成 0**（那就变成完全不生效了）。
   */
  const rate = (field: string) => {
    const pct = sumPct(side.statMods, field) / 100;
    if (pct <= -1) return Infinity; // 攻速 -100% ⇒ 打不出
    return 1 / (1 + pct);
  };
  if (side.statMods.length) {
    const mult = Math.max(rate("attack_speed_pct"), rate("reload_speed_pct"));
    if (mult !== 1) {
      const durs = (input.statMods ?? [])
        .map((m) => m.stats?.["duration_ms"])
        .filter((d): d is number => typeof d === "number");
      const life = durs.length === 0 || durs.includes(-1) ? Infinity : Math.max(...durs);
      side.cadenceWindows.push({ name: "statMods", from: 0, to: life, mult });
    }
  }
  // 受伤 / 打出的伤害加成（奥克萨娜的狂热是 25% 受伤加成、M.S.V. 的打出加成写的是 0）
  side.modIncoming = 1 + sumPct(side.statMods, "incoming_damage_pct") / 100;
  side.modOutgoing = 1 + sumPct(side.statMods, "outgoing_damage_pct") / 100;
  return side;
}

/** 修正器里某一类字段的总和（百分比） */
function sumPct(mods: Array<{ stats: Record<string, number> }>, field: string): number {
  return mods.reduce((n, m) => n + (m.stats[field] ?? 0), 0);
}

/** 一条轨的**一轮内**射击时刻（相对该轮起点）、整轮周期、以及是否重复 */
function shotShape(
  track: Track,
  openingDelayMs: number,
  repeat: boolean,
): { times: number[]; period: number; repeat: boolean } | null {
  const tm = track.timing;
  const charge = track.charge_ms ?? 0;
  if (tm.kind === "一次") {
    return { times: [openingDelayMs + charge], period: Math.max(1, tm.charge_ms), repeat };
  }
  if (tm.kind === "装填") {
    // 装填窗口从首发开始 ⇒ 整轮 = reload_ms；连打落点由每发间隔决定（I201）
    const iv = tm.interval_ms ?? 0;
    const times =
      iv > 0
        ? Array.from({ length: tm.clip }, (_, k) => openingDelayMs + k * iv)
        : [openingDelayMs + charge];
    return { times, period: tm.reload_ms > 0 ? tm.reload_ms : 0, repeat };
  }
  const period = tm.cycle_ms;
  if (!(period > 0)) return null; // 没有周期 ⇒ 不猜
  const iv = tm.interval_ms ?? 0;
  /*
   * 前摇相位：`chargeInCycle` 为真 ⇒ 前摇在周期**内**（首发放 `charge`）；
   * 为假 ⇒ 前摇在周期**外**（时间相加）。无论哪种，一轮内的相对落点都从 `charge` 起算 ——
   * 差别落在"整轮多长"上，由 `period` 与 `openingDelayMs` 承担。
   */
  const base = charge;
  const times = tm.hits > 1 && iv > 0 ? Array.from({ length: tm.hits }, (_, k) => base + k * iv) : [base];
  return { times, period, repeat };
}

interface Cursor {
  side: 0 | 1;
  /** 该侧的状态 —— 时间映射（EMP / 修正器）要读它的 `cadenceWindows` */
  sideState: SimSide;
  member: number;
  weapon: Weapon;
  /** 该成员这条轨的下一轮起点 */
  nextCycle: number;
  /** 本轮内已用掉的落点下标 */
  idx: number;
  times: number[];
  period: number;
  /** 是否循环（`sequence` 的段只演一次 ⇒ false） */
  repeat: boolean;
}

/**
 * 该游标**下一个射点**的时刻（**只读，不改变状态**）。
 *
 * ⚠️ **必须与"提交"分开**：主循环要先扫所有游标找出最近的一枪，
 * 如果在扫描过程中就推进游标，**没被选中的那些射点会被白白吞掉**
 * （第一版就是这么错的 —— 表现为"右侧一发没打、时间被拖长"）。
 */
function peek(c: Cursor, limitMs: number): number | null {
  if (!c.repeat && c.idx >= c.times.length) return null; // 一次性轨已打完
  let nextCycle = c.nextCycle;
  let idx = c.idx;
  while (idx >= c.times.length) {
    nextCycle += c.period;
    idx = 0;
    if (nextCycle > limitMs) return null;
  }
  const t = nextCycle + c.times[idx]!;
  if (t > limitMs) return null;
  return dilateAt(c.sideState, t);
}

/** 把名义时间按该侧的 `cadenceWindows` 映射到真实时间（见 `SimSide.cadenceWindows`） */
function dilateAt(s: SimSide, t: number): number {
  if (!s.cadenceWindows.length) return t;
  // 窗口按起点排好；累加每个窗口多出来的那部分
  const ws = [...s.cadenceWindows].sort((a, b) => a.from - b.from);
  let extra = 0;
  for (const w of ws) {
    if (t <= w.from) break;
    const end = Math.min(t, w.to);
    if (end <= w.from) continue;
    if (!Number.isFinite(w.mult)) return Infinity; // 这段窗口里完全开不出火
    extra += (end - w.from) * (w.mult - 1);
    if (t <= w.to) break;
  }
  return t + extra;
}

/**
 * 提交该游标的一次射点（与 `peek` 的返回值配套使用）。
 *
 * ⚠️ 主循环里"找最近一枪"时必须**只 `peek` 不 `commit`** ——
 * 扫描过程中提交会吞掉没被选中的射点（见 `peek` 的说明）。
 */
function commit(c: Cursor): void {
  c.idx += 1;
  if (!c.repeat) return; // 一次性轨：打完就停，不再翻轮
  while (c.idx >= c.times.length) {
    c.nextCycle += c.period;
    c.idx = 0;
  }
}

function buildCursors(side: 0 | 1, s: SimSide, openingDelayMs: number, notes: string[]): Cursor[] {
  const out: Cursor[] = [];
  const seq = s.entry.derived.attack.composition === "sequence";
  /*
   * **队员开火错开**（I44）：成员 `i` 的整条轴后移 `i × separation_ms`。
   * 这是小队"脉冲式输出 / 相位漂移"的来源，不加会让所有成员在同一毫秒齐射
   * （第一版就这么错了 —— 表现为 5 个步枪兵全在 0.00s 开火）。
   */
  const sep = s.entry.derived.attack.member_offset_ms ?? s.entry.derived.stats.separation_ms ?? 0;
  for (const w of s.weapons) {
    const tracks = s.entry.derived.attack.tracks.filter((t) => t.weapon === w.id);
    if (!tracks.length) continue;
    for (const track of tracks) {
      /*
       * ⚠️ **`sequence` 的每一段只演一次，不循环** —— 段是"接替"而不是"周期"：
       * 万钧巨炮 stage1(3s) → stage2(6s) → stage3(持续)，由 `after_ms` 摆在一轮里。
       * 若让每段按自己的 `cycle_ms` 无限重复，段与段会在交界处**重叠**（第一版就是这么错的：
       * 3.50s 处同时冒出 stage1 的尾发与 stage2 的首发）。
       */
      const shape = shotShape(track, openingDelayMs, !seq);
      if (!shape || !(shape.period > 0)) {
        notes.push(`${s.entry.name_zh ?? s.entry.id} 的「${w.name}」没有可用周期，已跳过`);
        continue;
      }
      const after = seq ? (track.after_ms ?? 0) : 0;
      for (const member of s.alive) {
        out.push({
          side,
          sideState: s,
          member,
          weapon: w,
          nextCycle: after + openingDelayMs + member * sep,
          idx: 0,
          times: shape.times,
          period: shape.period,
          repeat: shape.repeat,
        });
      }
    }
  }
  return out;
}

/** 一发子弹/一次攻击对目标的每员伤害（1-0 基准 → 套等级） */
function damageOfShot(w: Weapon, side: SimSide, victim: SimSide): number {
  if (!w.can_attack.includes(victim.type)) return 0;
  /*
   * ⚠️ **引爆类武器（催化剂）先看 `explosion`**：这把武器的实际伤害不是
   * `damage`（270）也不是弹体的 50 —— 是 `ability_catalyst_explosion` 里
   * `tiberiumExplosionTuning.damageMain` 的 **800（步兵 300）**。
   * 见 `core/src/derive.ts` 的 `Weapon.explosion`。
   */
  const table = w.explosion ?? { damage: w.damage, overrides: w.overrides };
  const base = damageOf({ ...w, damage: table.damage, overrides: table.overrides }, victim.type);
  return Math.round(base * side.level.factor());
}

export function simulate(a: SimInput, b: SimInput): SimResult {
  const notes: string[] = [];
  const sideA = makeSide(a);
  const sideB = makeSide(b);
  const sides: SimSide[] = [sideA, sideB];
  /** 展示名 —— 提前定义，主循环里的自爆提示要用 */
  const label = (s: SimSide) => s.entry.name_zh ?? s.entry.name_en ?? s.entry.id;
  /*
   * **未部署的代价**：
   *   · **MLRS 这类"必须先部署"的**（`stats.must_deploy_to_fire`）—— 开火整体推迟 `deploy_ms`
   *   · **有减伤的**（壁虱 70% / 机枪 50%）—— 部署动作走完前没有减伤
   *   · **壁虱**是"可选部署"的代表：它可以不架（`must_deploy_to_fire` 为假 ⇒ 照常开火），
   *     代价是没有那 70% 减伤
   */
  const deployLead = (s: SimSide): number => (!s.deployed && s.mustDeployToFire ? s.deployMs : 0);
  const delay = [
    (a.openingDelayMs ?? 0) + deployLead(sideA),
    (b.openingDelayMs ?? 0) + deployLead(sideB),
  ];
  for (const [i, s] of [sideA, sideB].entries()) {
    if (deployLead(s) > 0) {
      notes.push(
        `${s.entry.name_zh ?? s.entry.id} 未部署：要先花 ${(s.deployMs / 1000).toFixed(2)}s 架设才能开火`,
      );
    } else if (!s.deployed && s.deployMs > 0) {
      notes.push(
        `${s.entry.name_zh ?? s.entry.id} 未部署：可以照常开火，代价是${s.entry.derived.stats.damage_reduction_pct ? `没有 ${s.entry.derived.stats.damage_reduction_pct}% 减伤` : "没有部署带来的效果"}`,
      );
    }
    void i;
  }

  const cursors: Cursor[] = [
    ...buildCursors(0, sideA, delay[0]!, notes),
    ...buildCursors(1, sideB, delay[1]!, notes),
  ];

  const shots: Shot[] = [];
  const deaths: Death[] = [];
  const hits: Hit[] = [];
  const timeline: TimelinePoint[] = [];
  /*
   * **被攻击方所站的那一格** —— 火/毒挂在它身上（`RequestModifier(tile, …)`）。
   * 站位数据不在客户端（I223），所以本页只有这一张格子；`occupants` 记着"谁在这一格上"。
   */
  const tile = makeTargetTile();
  const totalOf = (s: SimSide) => s.alive.reduce((n, m) => n + (s.hp.get(m) ?? 0), 0);

  timeline.push({ t: 0, hp: [totalOf(sideA), totalOf(sideB)] });

  let endedAtMs = 0;
  let winner: 0 | 1 | null = null;
  let guard = 0;
  /** 已经就 EMP 提示过的一方（只提示一次，免得每发都刷） */
  const empNoted = new Set<0 | 1>();
  /** 已经自爆过的**队员**（开火下标）—— 只销毁开火的那一个，不是全队 */
  const selfDestructed = new Set<string>();
  /** 第一次自爆发生的时刻（毫秒） */
  let selfDestructAtMs: number | null = null;

  while (guard++ < 200_000) {
    /*
     * **一方全灭不等于模拟结束** —— 格子上可能还铺着火/毒，而它们**不关心谁死了**：
     * 火在 `modifier_unstackable_damage_over_time:OnUpdate` 里每 `tickPeriodMs` 打一次，
     * 打的是**当前站在格上的小队**。所以只要格子上还有活着的占位者 + 还有没烧完的效果，
     * 就继续把它烧完（用户："猛犸被圣甲虫炸没有火伤" —— 根因有两层：
     * ① 火曾经跟着自爆的圣甲虫一起失效 ② 这个循环在圣甲虫自爆时直接退出）。
     *
     * ⚠️ 胜负在退出循环后统一判（`winner` 只看谁还有人活着），这里不做判定。
     */
    const hazardAlive = tile.hazards.some(
      (h) =>
        h.nextTick <= h.untilMs + 1e-6 &&
        tile.occupants.some((o) => o !== h.from && sides[o]!.alive.length > 0),
    );
    if ((!sideA.alive.length || !sideB.alive.length) && !hazardAlive) break;
    /** 到点了就把"架设减伤"生效（只做一次） */
    const tickReduction = (s: SimSide, now: number) => {
      if (s.reductionAtMs !== null && now >= s.reductionAtMs) {
        const pct = s.entry.derived.stats.damage_reduction_pct ?? 0;
        s.damageTakenMult = 1 - pct / 100;
        s.reductionAtMs = null;
      }
    };
    /*
     * ① 找出**同一时刻的全部射击** —— 只 `peek`，不 `commit`。
     *
     * ⚠️ **必须按时刻成批**：同一毫秒里双方可能都在开火（齐射、相位撞上）。
     * 早先是"一发一结算"，于是先结算的那一方把对方打死后，**对方同一时刻的那一发
     * 就永远不会发生** —— 表现为"同时开火却只有一方死亡"。用户指出正确行为是
     * **先都造成伤害、再一起结算死亡**（同帧结算），这里照此实现。
     */
    let t = Infinity;
    for (const c of cursors) {
      if (!sides[c.side]!.alive.includes(c.member)) continue; // 该员已阵亡
      const nt = peek(c, SIM_LIMIT_MS);
      if (nt !== null && nt < t) t = nt;
    }
    /*
     * **火也要参与"下一件事发生在什么时候"的竞争**：它每 `tick_ms` 跳一次、
     * 铺下后 `persist_ms` 内有效（第一跳在 `atMs + tickMs`，与
     * `modifier_unstackable_damage_over_time:OnUpdate` 的 `lastDamageTime + tickPeriodMs < age` 一致）。
     * 不把它算进来的话，火只会在"恰好有别的射击"时才结算 —— 两支都不开火的单位
     * 站在火里会永远不掉血。
     *
     * ⚠️ 本页是 1v1：假设对方一直站在火里（真实对局里走出去就不烧了，I223）。
     */
    let tickHazards: Hazard[] = [];
    for (const h of tile.hazards) {
      /*
       * ⚠️ **只看"受烧方是否还活着"，不看铺火的那一方** —— 火/毒是**地块上的独立 modifier**
       * （`RequestModifier(tile, …)`），铺下去之后跟铺它的人死没死**没有关系**。
       * 早先这里写的是 `if (!sides[对面].alive.length) continue`，于是
       * **圣甲虫刚铺完火就自爆、那层火立刻失效**（用户实测："猛犸被圣甲虫炸没有火伤"）。
       */
      const victimSide: 0 | 1 = h.from === 0 ? 1 : 0;
      if (!tile.occupants.includes(victimSide)) continue; // 没人在这一格
      if (!sides[victimSide]!.alive.length) continue; // 上面的人已经没了
      if (h.nextTick > h.untilMs + 1e-6) continue; // 这一层已经烧完
      if (h.nextTick >= t) continue; // 这一跳不早于已知的最近射击
      const lead = tickHazards[0];
      if (!lead || h.nextTick < lead.nextTick) tickHazards = [h];
      else if (h.nextTick === lead.nextTick) tickHazards.push(h);
    }
    if (tickHazards.length) t = tickHazards[0]!.nextTick;
    if (!Number.isFinite(t)) break;
    tickReduction(sideA, t);
    tickReduction(sideB, t);

    const batch = cursors
      .map((c) => ({ c, at: sides[c.side]!.alive.includes(c.member) ? peek(c, SIM_LIMIT_MS) : null }))
      .filter((x): x is { c: Cursor; at: number } => x.at !== null && x.at === t);

    /*
     * ② 先给这一批**全部登记伤害**（读的是这一批开始前的血量），一个都没结算死亡。
     *
     * 这样同一时刻的多发都打得出来；「谁死了」放到 ③ 统一判定。
     * 血量取 `max(0, …)` 只是为了让曲线不掉到负数，死亡判定在 ③ 单独做。
     */
    const lethal = new Map<string, Death>();
    /** 这一跳（或这一发）打到了谁、谁死了 —— 开火与火的跳伤**共用同一套结算** */
    const applyDamage = (
      attackerSide: 0 | 1,
      perMemberDamage: number,
      aoe: boolean,
    ): Shot["hits"] => {
      const victimIdx: 0 | 1 = attackerSide === 0 ? 1 : 0;
      const victim = sides[victimIdx]!;
      const hitList: Shot["hits"] = [];
      if (perMemberDamage <= 0 || !victim.alive.length) return hitList;
      const targets = aoe ? [...victim.alive].reverse() : [victim.alive[victim.alive.length - 1]!];
      for (const m of targets) {
        const before = victim.hp.get(m) ?? 0;
        const left = before - perMemberDamage;
        victim.hp.set(m, Math.max(0, left));
        // 血量条只该掉到 0 为止 —— 超额伤害（过量击杀）不计入扣血
        const dealt = Math.min(perMemberDamage, before);
        hits.push({ t, side: victimIdx, member: m, damage: dealt });
        hitList.push({ side: victimIdx, member: m, damage: dealt, killed: left <= 0 });
        if (left <= 0) {
          lethal.set(`${victimIdx}:${m}`, { t, side: victimIdx, member: m, cause: "killed" });
        }
      }
      return hitList;
    };

    /*
     * ②⓪ **格子效果的那一跳先结算**（如果它就是这个时刻）。
     *
     * 火与毒气都是**整队每人各一份**（`AoeDamageSquadOverride` ⇒ `squad:TakeAOEDamage`，
     * `modifier_unstackable_damage_over_time.lua:35`），但与直击不同的是：
     * **它不经过 `IncomingDamageReduction`**（伤害来自独立的 `modifier_*_burn`/`_poison`，
     * 不是打在这把武器的弹体上），而且各自有生效范围 ——
     * 火 `DESCRIPTOR_MASK = Ground`，毒气 `Ground + Infantry` 且**载具 override 为 0**。
     */
    for (const h of tickHazards) {
      if (Math.abs(h.nextTick - t) >= 1e-6) continue;
      h.nextTick += h.tickMs;
      const victim = sides[h.from === 0 ? 1 : 0]!;
      if (h.groundOnly && !victim.ground) continue; // 空中单位：火与毒都不吃
      const override = h.vs?.[victim.type];
      if (override === 0) continue; // 明确写了 0 ⇒ 这一类完全不吃（毒气对载具）
      const perMember = override ?? h.tickDamage;
      if (perMember <= 0) continue;
      const dmg = Math.max(1, Math.round(perMember * sides[h.from]!.level.factor()));
      const hitList = applyDamage(h.from, dmg, true);
      shots.push({
        t,
        side: h.from,
        // 格子效果不是"某一员开的枪"：记 0 号，渲染时按 `hazard` 分支处理，不画攻击标志
        member: 0,
        weaponId: `hazard:${h.kind}`,
        weaponName: h.kind === "fire" ? "火" : "毒气",
        damage: dmg,
        reachable: true,
        aoe: true,
        hits: hitList,
        hazard: h.kind,
      });
    }

    for (const { c } of batch) {
      commit(c);
      const shooter = sides[c.side]!;
      const victim = sides[c.side === 0 ? 1 : 0]!;
      if (!victim.alive.length) continue;

      const w = c.weapon;
      /*
       * **减伤**（壁虱 70% / 机枪 50%）—— `IncomingDamageReduction` 是**加法修饰器**，
       * 所以实际伤害 = `每员伤害 × (1 − pct)`，在架设动画走完后生效
       * （`modifier_damagereduction_intro.lua` 的 `ApplyDamageReduction`）。
       */
      const rawDmg = damageOfShot(w, shooter, victim);
      /*
       * 伤害三段相乘：**打出加成**（`OutgoingDamagePercentIncrease`，M.S.V. 是 0）
       * → **受到的伤害加成**（`IncomingDamageAddition`，奥克萨娜的狂热 25%）
       * → **减伤**（壁虱 70% / 机枪 50% 的架设减伤，是独立的 modifier）。
       */
      const dmg =
        rawDmg > 0
          ? Math.max(
              1,
              Math.round(rawDmg * shooter.modOutgoing * victim.modIncoming * victim.damageTakenMult),
            )
          : 0;
      const aoe = isAoe(w);
      const hitList = applyDamage(c.side, dmg, aoe);
      /*
       * **EMP（给对面挂减速）** —— 只有带 EMP 的武器 + 目标类型对得上才挂
       * （实测 5 个单位的弹体都是 `DESCRIPTOR_FILTERS = Vehicle` ⇒ **只对载具**）。
       * 挂上之后由 `cadenceWindows` 把对面的名义时间拉长。
       */
      if (dmg > 0 && shooter.empDeals !== 1 && shooter.empMs !== 0) {
        if (!shooter.empTargets.length || shooter.empTargets.includes(victim.type)) {
          victim.cadenceWindows = victim.cadenceWindows.filter((x) => x.name !== "emp");
          victim.cadenceWindows.push({
            name: "emp",
            from: t,
            to: t + Math.max(1, shooter.empMs),
            mult: shooter.empDeals,
          });
          if (!empNoted.has(c.side)) {
            empNoted.add(c.side);
            notes.push(
              `${label(shooter)} 的 EMP 生效：${victim.type} 的攻速 ` +
                `${shooter.empDeals === Infinity ? "降到打不出火" : `降到 ${(100 / shooter.empDeals).toFixed(0)}%`}` +
                `，持续 ${(shooter.empMs / 1000).toFixed(1)}s（每次命中会顺延）`,
            );
          }
        }
      }

      shots.push({
        t,
        side: c.side,
        member: c.member,
        weaponId: w.id,
        weaponName: w.name,
        damage: dmg,
        reachable: dmg > 0,
        aoe,
        hits: hitList,
      });
      /*
       * **自杀式单位**：这一发已经打出去了，**开火的那一名队员**随后直接销毁
       * （`ability_scarab_weapon_sequence.lua:51` 的 `TakeHiddenDestroyDamage()` 调在
       * `self:GetOwnerCombatant()` 上 —— 是**那一员**，不是整个小队）。
       *
       * ⚠️ 早先这里按"一方"记，于是 2 员的圣甲虫**第一只开火就把两只一起清空**，
       * 第二只永远没机会打（用户："圣甲虫顺序还不对, 第二个就没攻击过"）。
       * 而 `attackSeparationDurationMS = 2000` 的设计意图正是**让两只错开、各炸各的目标**。
       */
      if (shooter.selfDestruct) selfDestructed.add(`${c.side}:${c.member}`);
      /*
       * **命中后铺格子效果**：火在 `modifier_scarab_projectile.lua:71-72`（`MODIFIER_FIRE`），
       * 毒气在 `unit_nod_catalystgunship.lua:56` 的 `gasCloudModifierId`（顺序里 `RefreshCloud`）。
       * 只在**打得动**（`dmg > 0`）时才铺 —— 打不到该类型的弹体不会命中。
       *
       * ⚠️ 同一格反复铺只是**重置剩余时间**（`ResetPersistTime`），不是叠加伤害，
       * 也**不会把时限拉长到超过一层本来能活的时长**；所以每张格子每种效果最多一层。
       */
      if (dmg > 0 && shooter.firstHitAtMs === null) shooter.firstHitAtMs = t;
      if (dmg > 0) {
        for (const spec of shooter.hazards) {
          /*
           * **"要打一会才铺得出"**（毒车 `spawnGasTimeMs = 2100`）——
           * 源码是 `self:GetAgeMS() > spawnGasTimeMs`，即**序列存活时间**；
           * 本页按"首次命中起算"近似（1v1 只有一个目标，两者等价）。
           */
          if (spec.delayMs > 0 && t - (shooter.firstHitAtMs ?? t) < spec.delayMs) continue;
          const existing = tile.hazards.find((h) => h.kind === spec.kind);
          if (existing) {
            // 续时：重置剩余时间，但**不能把"最晚活到什么时候"往后推**
            existing.nextTick = t + existing.tickMs;
            existing.untilMs = Math.min(existing.untilMs + existing.persistMs, existing.atMs + existing.persistMs);
          } else {
            tile.hazards.push({
              ...spec,
              from: c.side,
              atMs: t,
              untilMs: t + spec.persistMs,
              nextTick: t + spec.tickMs,
            });
            notes.push(
              `${label(shooter)} 在目标格留下${spec.kind === "fire" ? "火" : "毒气"}：` +
                `每 ${(spec.tickMs / 1000).toFixed(2)}s 每员 ` +
                `${Math.round(spec.tickDamage * shooter.level.factor())} 伤害，` +
                `持续 ${(spec.persistMs / 1000).toFixed(0)}s` +
                `${spec.groundOnly ? "（只对地面）" : ""}` +
                `${spec.vs ? `（${Object.entries(spec.vs).map(([k, v]) => `${k} ${v}`).join(" / ")}）` : ""}`,
            );
          }
        }
      }
    }
    endedAtMs = t;

    /*
     * ③ 再统一结算这一批造成的死亡：**同一毫秒内阵亡的成员一次性移除**。
     *
     * ⚠️ 顺序有讲究：先扣血、后移除。若边打边移除，同一时刻后面的射击会在
     * "对手已经少了一员"的状态下选目标，结果与引擎的同帧结算不一致。
     */
    if (lethal.size || selfDestructed.size) {
      for (const d of lethal.values()) {
        const s = sides[d.side]!;
        if (!s.alive.includes(d.member)) continue;
        s.alive = s.alive.filter((x) => x !== d.member);
        deaths.push(d);
      }
      /*
       * **自爆与被打死在同一帧一起结算**：先扣血的成员，再移除自爆的那**一名队员**。
       *
       * ⚠️ **只销毁开火的那一员**（`TakeHiddenDestroyDamage` 调在 `GetOwnerCombatant()` 上）。
       * 早先按"一方"清空，于是 2 员的圣甲虫第一只开火就把两只一起抹掉，第二只永远打不出
       * （用户："圣甲虫顺序还不对, 第二个就没攻击过"）；而 `attackSeparationDurationMS = 2000`
       * 的设计意图就是**让两只错开、各炸各的目标**。
       */
      for (const key of selfDestructed) {
        const [sideStr, memberStr] = key.split(":");
        const sd = Number(sideStr) as 0 | 1;
        const member = Number(memberStr);
        const s = sides[sd]!;
        if (!s.alive.includes(member)) continue;
        s.alive = s.alive.filter((x) => x !== member);
        deaths.push({ t, side: sd, member, cause: "selfDestruct" });
        selfDestructAtMs ??= t;
        notes.push(
          `${label(s)} 队员 ${member + 1} 开火后自爆（TakeHiddenDestroyDamage），该员销毁`,
        );
      }
      selfDestructed.clear();
      timeline.push({ t, hp: [totalOf(sideA), totalOf(sideB)] });
    }
  }

  if (!sideA.alive.length || !sideB.alive.length) {
    winner = sideA.alive.length ? 0 : sideB.alive.length ? 1 : null;
  } else if (endedAtMs >= SIM_LIMIT_MS) {
    notes.push(`${SIM_LIMIT_MS / 1000} 秒内没有分出胜负（已截断）`);
  }

  return {
    shots,
    deaths,
    hits,
    timeline,
    endedAtMs,
    winner,
    notes,
    hazards: tile.hazards,
    sideInfo: sides.map((s, sideIdx) => ({
      maxHp: s.maxHp,
      members: s.entry.derived.health?.wave_size ?? 1,
      maxTotal: s.maxTotal,
      label: label(s),
      separationMs:
        s.entry.derived.attack.member_offset_ms ?? s.entry.derived.stats.separation_ms ?? 0,
      deployMs: s.deployMs,
      deployed: s.deployed,
      mustDeployToFire: s.mustDeployToFire,
      /** 用户填的开场延迟 —— 时间线要画成行首的等待段 */
      openingDelayMs: s.openingDelayMs,
      /** **攻击后自身消失**（圣甲虫）—— 结果区与时间线都要写明，否则"它怎么死了"很反直觉 */
      selfDestruct: s.selfDestruct,
      /** 自爆发生的时刻（毫秒）；没自爆则为 `null` */
      selfDestructAt: deaths
        .filter((d) => d.side === sideIdx && d.cause === "selfDestruct")
        .map((d) => [d.member, d.t] as [number, number]),
      suicideMembers: s.selfDestruct ? (s.entry.derived.health?.wave_size ?? 1) : 0,
      emp: s.entry.derived.stats.emp ?? null,
      statMods: s.statMods.map((m) => ({ name: m.name, stats: m.stats })),
      hazards: s.hazards.map((h) => `${h.kind}:${h.ref}`),
    })),
  };
}
