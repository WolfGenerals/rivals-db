/**
 * 把官方那套「每个单位一个样」的结构，迁移成**我们自己的规范格式**。
 *
 * 设计见 `docs/data-schema.md`。核心是**两个正交的类**：
 *
 *   武器（`Weapon`）  —— 打出去的**是什么**：伤害 / 补正 / 范围 / 可打目标。**不含时间**
 *   时序（`Attack`）  —— **什么时候**打**哪一把**：组合方式 + 若干条轨道
 *
 * 时序不再是一堆"种类"，而是**四种组合方式 × 三种节奏**：
 *
 *   composition  single（一套）· sequence（按时间换武器）· conditional（按条件选武器）· parallel（并行）
 *   timing.kind  单发 · 装填 · 一次
 *
 * 于是「万钧巨炮三段递增」= `sequence` + 3 个武器；「利爪对地/对空」= `conditional`；
 * 「催化剂铺场+引爆」= `parallel`。**不需要"分段/倾泻/齐射"这些种类。**
 */

import type { EntityRecord, WeaponTuning } from "./types.ts";
import { canAttackTarget, effectiveDamage, targetingUnknown, type DamageOverrideTag } from "./types.ts";

const ALL_TARGETS: DamageOverrideTag[] = ["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"];

// ── 武器 ──────────────────────────────────────────────────────────

/** 武器类型 —— 用于描述（"炸弹""光束"…），由数据结构判定 */
export type WeaponType = "炸弹" | "光束" | "弹道" | "自爆";

/** 范围伤害机制。与时序无关，所以挂在武器上 */
export interface Area {
  kind: "none" | "side_targets" | "radius" | "side_damage";
  /** `side_targets`：溅射目标数 */
  targets?: number;
  /** `radius`：半径（格） */
  radius_tiles?: number;
  /** `radius`：随距离衰减（百分比） */
  falloff?: Array<{ distance: number; percent: number }>;
  /** `side_damage`：相邻格的伤害值 */
  side_value?: number;
}

export interface Weapon {
  id: string;
  name: string;
  type: WeaponType;
  damage: number;
  overrides: Array<[DamageOverrideTag, number]>;
  can_attack: DamageOverrideTag[];
  targeting_unknown: boolean;
  range_tiles?: number;
  homing?: boolean;
  area: Area;
}

// ── 时序 ──────────────────────────────────────────────────────────

/** 节奏。只有三种 —— 「分段」不是节奏，是 `composition: sequence` */
/**
 * 节奏 —— **核心只有 `{hits, cycle_ms}`**：
 *
 * ```
 * dps = damage × hits × waveSize × 1000 / cycle_ms
 * ```
 *
 * `interval_ms` / `gap_ms` 是**展示用的细化**（能画成刻度就画），不参与 DPS。
 * 这样 15 种开火方式、包括装填型，全都落进同一个式子。
 */
export type Timing =
  | {
      kind: "单发";
      /** 一轮打几下 */
      hits: number;
      /** 一轮多长（毫秒） */
      cycle_ms: number;
      /** 一轮内的每发间隔（毫秒）；未知则不出现 */
      interval_ms?: number;
      /** 一轮内的空档（毫秒）＝ cycle − hits×interval；用于画"停顿" */
      gap_ms?: number;
    }
  | { kind: "装填"; clip: number; reload_ms: number; interval_ms?: number }
  | { kind: "一次"; charge_ms: number };

export interface Track {
  weapon: string;
  timing: Timing;
  /** `sequence`：这条轨从何时开始（相对一轮起点，毫秒） */
  after_ms?: number;
  /** `sequence`：这条轨持续多久；`null` = 到本轮结束/无限 */
  lasts_ms?: number | null;
  /** `conditional`：什么条件下走这条轨 */
  when?: { target?: DamageOverrideTag[] };
  /** 该轨开火前的蓄力 */
  charge_ms?: number;
}

export type Composition = "single" | "sequence" | "conditional" | "parallel";

export interface Attack {
  composition: Composition;
  tracks: Track[];
  /** 一轮总时长（毫秒）；`null` = 没有"轮"的概念 */
  cycle_ms: number | null;
  /** 小队成员开火错开（毫秒）；单人单位为 0 */
  member_offset_ms: number;
}

export interface DerivedAttack {
  weapons: Weapon[];
  attack: Attack;
  /** 主武器 id —— 面板 DPS 取它 */
  primary: string;
  /** 时序隐含的每秒伤害（1-0 级）；仅供排序与**校验**，不是重点 */
  dps: number;
  notes: string[];
}

// ── 解析 ──────────────────────────────────────────────────────────

type SeqTuning = Record<string, unknown>;

function seqTuning(w: WeaponTuning): SeqTuning {
  return (w.modifier_sequence?.tuning ?? {}) as SeqTuning;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** 从各可能位置取出「一轮的节奏」参数（毫秒） */
function resolveInterval(w: WeaponTuning, stage?: string): { interval: number; from: string } | undefined {
  const t = seqTuning(w);
  const st = stage ? (t[stage] as SeqTuning | undefined) : undefined;
  if (num(st?.["tickPeriodMs"])) return { interval: st!["tickPeriodMs"] as number, from: `${stage}.tickPeriodMs` };
  if (num(t["tickPeriodMs"])) return { interval: t["tickPeriodMs"] as number, from: "tickPeriodMs" };
  if (num(t["durationBetweenVolley"])) return { interval: t["durationBetweenVolley"] as number, from: "durationBetweenVolley" };
  if (num(t["burstCooldown"])) return { interval: t["burstCooldown"] as number, from: "burstCooldown" };
  const shot = num(
    (w.modifier_spawn as { tuning?: { burstTuning?: { shotCooldownMs?: number } } } | undefined)?.tuning
      ?.burstTuning?.shotCooldownMs,
  );
  if (shot) return { interval: shot, from: "modifier_spawn.shotCooldownMs" };
  const cd = num(w.burstTiming?.cooldown);
  if (cd) return { interval: cd * 1000, from: "burstTiming.cooldown" };
  return undefined;
}

/** 一次攻击打几下 —— 见 findings I101：由**伤害的粒度**决定 */
function resolveHits(w: WeaponTuning, muzzles: number): number {
  const t = seqTuning(w);
  const fromSeq = num(t["attackCount"]);
  if (fromSeq) return fromSeq;
  // 沙暴：`perTargetCount` 按目标小队数分档，[0] 是单目标档
  const ptc = t["perTargetCount"] as unknown;
  const tier = Array.isArray(ptc) ? (ptc[0] as { missileCount?: number }) : undefined;
  if (num(tier?.missileCount)) return tier!.missileCount!;
  // 常规武器（无序列）：`numToBurst` 是每轮发数；`All` 时每口各一发
  if (!w.modifier_sequence) {
    const nb = num(w.burstTiming?.numToBurst) ?? 1;
    return nb * (w.muzzleStrategy === "All" ? (w.muzzleCount ?? 1) : 1);
  }
  // 序列没显式说 → 用击打序列长度；但若伤害来自武器级（已是整轮总和）则不乘
  const dm = effectiveDamage(w);
  const isVolleyTotal = dm !== undefined && dm === w.damageTuning;
  return isVolleyTotal ? 1 : muzzles;
}

function weaponTypeOf(w: WeaponTuning): WeaponType {
  const mod = w.projectile?.modifier?.tuning;
  if (mod && typeof mod === "object" && ("damage" in mod || "damage1" in mod)) return "炸弹";
  const t = seqTuning(w);
  if (num(t["tickPeriodMs"]) || num((t["stage1"] as SeqTuning | undefined)?.["tickPeriodMs"])) return "光束";
  if ((w as { modifier_shot?: unknown }).modifier_shot) return "光束";
  return "弹道";
}

/** 范围伤害机制 */
function areaOf(w: WeaponTuning, stage?: string): Area {
  const t = seqTuning(w);
  const st = stage ? (t[stage] as SeqTuning | undefined) : undefined;
  const splash = num(st?.["sideTargetCount"]) ?? num(t["sideTargetCount"]);
  if (splash) return { kind: "side_targets", targets: splash };

  const mod = w.projectile?.modifier?.tuning as
    | { damageRadius?: number; damageFalloff?: { distances?: Array<{ distance?: number; percent?: number }> } }
    | undefined;
  if (num(mod?.damageRadius)) {
    return {
      kind: "radius",
      radius_tiles: mod!.damageRadius,
      falloff: (mod!.damageFalloff?.distances ?? []).map((d) => ({
        distance: d.distance ?? 0,
        percent: d.percent ?? 0,
      })),
    };
  }
  const side = (st?.["damageSide"] as { default?: number } | undefined)?.default ?? (t["damageSide"] as { default?: number } | undefined)?.default;
  if (num(side)) return { kind: "side_damage", side_value: side };
  return { kind: "none" };
}

/** 由单把武器 + 可选阶段，造一个「武器」条目 */
function makeWeapon(w: WeaponTuning, id: string, stage?: string): Weapon {
  const t = seqTuning(w);
  const st = stage ? (t[stage] as SeqTuning | undefined) : undefined;
  const dm = st?.["damageMain"] as { default?: number; override?: unknown } | undefined;
  const base = effectiveDamage(w);

  // 阶段的伤害优先于武器级的
  const overrideRaw = (dm?.override ?? base?.overrides ?? []) as unknown;
  const overrides = Array.isArray(overrideRaw)
    ? overrideRaw.filter((e): e is [DamageOverrideTag, number] => Array.isArray(e) && e.length === 2)
    : [];

  return {
    id,
    name: w.name ?? "?",
    type: weaponTypeOf(w),
    damage: num(dm?.default) ?? base?.default ?? 0,
    overrides,
    can_attack: ALL_TARGETS.filter((tg) => canAttackTarget(w, tg)),
    targeting_unknown: targetingUnknown(w),
    range_tiles: w.maxRangeInTiles,
    homing: w.projectile?.homing,
    area: areaOf(w, stage),
  };
}

/** 时序隐含的每秒伤害（1-0 级） */
export function trackDps(tr: Track, dmg: number, waveSize: number): number {
  // 统一式子：dps = damage × hits × waveSize × 1000 / cycle_ms
  const k = tr.timing.kind;
  if (k === "一次") return 0; // 一次性，不计持续输出
  if (k === "装填") {
    const cycle = tr.timing.reload_ms;
    return cycle > 0 ? (dmg * tr.timing.clip * waveSize * 1000) / cycle : 0;
  }
  const { hits, cycle_ms } = tr.timing;
  return cycle_ms > 0 ? (dmg * hits * waveSize * 1000) / cycle_ms : 0;
}

// ── 主入口 ────────────────────────────────────────────────────────

export function deriveAttack(unit: EntityRecord): DerivedAttack {
  const cfg = unit.config;
  const ws = (cfg.combatantTuning?.weaponTunings ?? []) as WeaponTuning[];
  const wave = cfg.squadTuning?.waveSize ?? 1;
  const sep = cfg.squadTuning?.attackSeparationDurationMS ?? 0;
  const notes: string[] = [];

  /** 该武器序列的击打序列长度 */
  const muzzlesOf = (w: WeaponTuning): number => {
    const n = (w.modifier_sequence as { name?: string } | undefined)?.name;
    return (n && unit.visual?.[n]?.muzzleInfo?.length) || 1;
  };

  const weapons: Weapon[] = [];
  const tracks: Track[] = [];
  let composition: Composition = "single";
  let staged = false; // 分段递增 —— 在 forEach 里置位，循环后再决定 composition
  let cycle_ms: number | null = null;

  ws.forEach((w, wi) => {
    const t = seqTuning(w);
    const stages = (["stage1", "stage2", "stage3"] as const).filter((s) => t[s]);

    // ── 情形 A：分段递增（按时间换武器）→ composition: sequence ──
    if (stages.length) {
      staged = true;
      const mz = muzzlesOf(w);
      let after = num(t["initialChargeUpMs"]) ?? 0;
      let first = true;
      for (const s of stages) {
        const id = `${w.name ?? "w"}${wi}-${s}`;
        const wp = makeWeapon(w, id, s);
        weapons.push(wp);
        const st = t[s] as SeqTuning;
        const count = num(st["attackCount"]);
        const interval = num(st["tickPeriodMs"]) ?? 0;
        const lasts = count ? count * interval : null;
        tracks.push({
          weapon: id,
          /*
           * 每一段本身就是"一轮"：**hits 是这一段的发数 ttackCount**（万钧巨炮 12/24），
           * 周期 = 段时长。末段没有 ttackCount（无限持续）→ 用它的间隔当一个周期。
           */
          timing: {
            kind: "单发",
            hits: count ?? 1,
            cycle_ms: lasts ?? interval,
            interval_ms: interval,
          },
          after_ms: after,
          lasts_ms: lasts,
          charge_ms: first ? num(t["initialChargeUpMs"]) : undefined,
        });
        if (lasts !== null) after += lasts;
        first = false;
        void mz;
      }
      if (tracks.length && tracks[tracks.length - 1]!.lasts_ms === null) cycle_ms = null;
      else cycle_ms = after;
      return;
    }

    // ── 情形 B：单把武器 ──
    const id = `${w.name ?? "w"}${ws.length > 1 ? wi : ""}`;
    weapons.push(makeWeapon(w, id));

    // 节奏
    if (w.reloadTuning?.clipSize && w.reloadTuning.reloadTimeMs) {
      tracks.push({
        weapon: id,
        timing: {
          kind: "装填",
          clip: w.reloadTuning.clipSize,
          reload_ms: w.reloadTuning.reloadTimeMs,
          interval_ms: resolveInterval(w)?.interval,
        },
      });
      return;
    }

    // 每发间隔：`delayAfterShot`（神像的 3 发）与 `perTargetCount[].timePerMissile`（沙暴）
    // 比"周期"更具体 —— 周期是**一轮**，这些是**一轮内每发之间**。
    const hits = resolveHits(w, muzzlesOf(w));
    // ⚠️ **每发间隔只在一轮多发时才有意义**。hits === 1 时间隔就是周期本身
    // （科迪亚克：`delayAfterShot` 1000ms 是主炮→侧炮，不该当成"每隔 1s 打一发"）。
    const perShot =
      hits > 1
        ? (num((t["perTargetCount"] as unknown as Array<{ timePerMissile?: number }> | undefined)?.[0]
            ?.timePerMissile) ?? num(t["delayAfterShot"]))
        : undefined;
    const iv = perShot ? { interval: perShot, from: "per-shot" } : resolveInterval(w);
    if (!iv) {
      notes.push(`武器 ${w.name} 找不到攻击间隔，时序留空`);
      tracks.push({ weapon: id, timing: { kind: "单发", hits, cycle_ms: 0 } });
      return;
    }
    /*
     * 周期（`cycle_ms`）：
     *   · **常规武器** —— `burstTiming.cooldown` **就是一轮**（`numToBurst` 发都在这轮里），
     *     所以 `hits` 不再乘间隔。Mammoth：`numToBurst=2 / cooldown=4s` → hits 2、cycle 4000。
     *   · **序列武器** —— 显式周期（`burstCooldown` / `durationBetweenVolley`）优先，
     *     没有才用 `hits × 每发间隔`。
     */
    const isSeq = Boolean(w.modifier_sequence);
    const explicitPeriod = num(t["burstCooldown"]) ?? num(t["durationBetweenVolley"]);
    const cycle = isSeq
      ? (explicitPeriod ?? (hits > 1 ? hits * iv.interval : iv.interval))
      : iv.interval;
    if (isSeq && hits > 1 && explicitPeriod) {
      cycle_ms = explicitPeriod;
      tracks.push({
        weapon: id,
        timing: {
          kind: "单发",
          hits,
          cycle_ms: explicitPeriod,
          interval_ms: iv.interval,
          gap_ms: Math.max(0, explicitPeriod - hits * iv.interval),
        },
      });
    } else {
      tracks.push({
        weapon: id,
        timing: { kind: "单发", hits, cycle_ms: cycle, interval_ms: isSeq ? iv.interval : undefined },
      });
    }
  });
  void cycle_ms;

  // ── 多武器：判断组合方式 ──────────────────────────────────
  if (staged) composition = "sequence";
  /*
   * 是「择一」还是「并行」？
   *
   * 判据**不是"互斥"** —— 建筑是所有武器都能打的（`canAttackTarget` 里 Structure 恒真），
   * 拿互斥去判会得出错误结论。正确判据：
   *
   *   **某把武器有「别的武器都打不了」的目标类型 → 必须择一（conditional）**
   *
   * 且**索敌未知（`descriptors` 空表）的武器不参与判定** —— 它没有可攻击集，
   * 参与进去会让催化剂被误判成择一。
   *
   * 实测：利爪/猛犸 火箭有 Aircraft（机枪打不了）→ conditional ✅；
   *       圣灵 两把都能打地面 → parallel ✅；
   *       寡妇 火箭只打建筑，而喷火器也能打建筑 → 无独有类型 → parallel ✅；
   *       催化剂 catalystWeapon 索敌未知 → parallel ✅。
   */
  const damageWeapons = weapons.filter((w) => w.damage > 0);
  const known = damageWeapons.filter((w) => !w.targeting_unknown && w.can_attack.length > 0);
  if (damageWeapons.length > 1 && composition === "single") {
    /** 这把武器有、而**别的武器都没有**的目标类型（建筑除外 —— 它谁都能打） */
    const uniqueOf = (w: Weapon) =>
      w.can_attack.filter((tg) => tg !== "Structure" && !known.some((o) => o !== w && o.can_attack.includes(tg)));
    // **双向独有**才算择一：两把武器各有对方打不了的类型
    const withUnique = known.filter((w) => uniqueOf(w).length > 0);
    composition = withUnique.length > 1 ? "conditional" : "parallel";
    if (composition === "conditional") {
      for (const tr of tracks) {
        const wp = weapons.find((x) => x.id === tr.weapon);
        if (wp) tr.when = { target: wp.can_attack };
      }
    }
  }

  // ── 主武器 ──
  // `sequence` 的主武器是**末段**（稳态，面板显示的就是它）；
  // 其余取第一把**有伤害**的武器（跳过 `orcabomber.targetSelector` 那种无伤害占位桩）。
  const lastStage = weapons.filter((w) => w.damage > 0).at(-1);
  const primaryW = (composition === "sequence" && lastStage) || weapons.find((w) => w.damage > 0) || weapons[0];
  const primary = primaryW?.id ?? "";

  // ── DPS：时序隐含值（主武器那条轨）──
  // `sequence` 的稳态是**末段**（面板显示的就是它）；其余取主武器那条轨
  const comp: Composition = composition; // 经 forEach 赋值，直接比较会被 TS 收窄成 never
  const primaryTrack =
    composition === "sequence" ? tracks[tracks.length - 1] : tracks.find((t) => t.weapon === primary);
  const dpsW = primaryTrack ? weapons.find((x) => x.id === primaryTrack.weapon) : primaryW;
  let dps = primaryTrack && dpsW ? trackDps(primaryTrack, dpsW.damage, wave) : 0;

  /*
   * 催化剂特例：周期在**铺场那把**（`gasWeapon.tuning.catalystBurst`）上，伤害在**另一把**上。
   * 面板数值 = **伤害最高的那把**（被引爆的火箭，270）÷ 催化周期（1600）。
   * 见 findings I82/I103。
   */
  const catalystCd = ws.reduce<number | undefined>((found, w) => {
    const cd = num((seqTuning(w)["catalystBurst"] as { cooldown?: number } | undefined)?.cooldown);
    return cd && (found === undefined || cd < found) ? cd : found;
  }, undefined);
  if (catalystCd) {
    const victim = weapons.reduce((best, x) => (x.damage > best.damage ? x : best), weapons[0]!);
    dps = (victim.damage * wave * 1000) / catalystCd;
    const tr = tracks.find((t) => t.weapon === victim.id);
    if (tr) tr.timing = { kind: "单发", hits: 1, cycle_ms: catalystCd };
    notes.push("周期取自另一把武器的 catalystBurst；面板数值由伤害最高的那把决定");
  }

  if (ws.some((w) => (w.modifier_sequence as { tuning?: { catalystBurst?: unknown } })?.tuning?.catalystBurst)) {
    notes.push("双武器：周期取自另一把武器（catalystBurst），面板数值由被引爆那把决定");
  }
  if (weapons.some((w) => w.targeting_unknown)) notes.push("索敌方式未知（descriptors 空表）");
  if (composition === "parallel") notes.push("多武器并行（同时开火）");
  if (composition === "conditional") notes.push("多武器按目标类型择一");

  return { weapons, attack: { composition, tracks, cycle_ms, member_offset_ms: sep }, primary, dps, notes };
}

// ── 数据集（产物 data/units.json 的形状）──────────────────────────

/** 固有属性。**缺的字段不出现**，消费方不该判断两种"空" */
export interface DerivedStats {
  unit_type?: string;
  cost?: number;
  speed?: number;
  vision_tiles?: number;
  tags?: string[];
  /** 官方文案里的"强于 XXX" —— **AI 索敌意图，不是伤害克制** */
  preferred_targets?: string[];
  deploy_ms?: number;
  undeploy_ms?: number;
  range_tiles?: number;
  can_be_crushed?: boolean;
  stealth_detect_tiles?: number;
  kill_award_tiberium?: number;
  /** 小队成员开火错开（毫秒） */
  separation_ms?: number;
  /** **攻击距离**（格）—— 与 range_tiles（射程）不是一回事 */
  attack_range_tiles?: number;
  /** 主动索敌半径（格）—— 决定会不会先手开打 */
  aggro_radius_tiles?: number;
  /** 转向速度 */
  turn_speed?: number;
  /** 避免拥挤的半径（格），影响阵型 */
  avoidance_radius?: number;
}

export interface DerivedHealth {
  /** ⚠️ 游戏里 health 是**每员**血量，总血 = per_member × wave_size */
  per_member: number;
  wave_size: number;
  total: number;
}

export interface Derived {
  health: DerivedHealth | null;
  /** 1-0 级；主武器的；与游戏内面板一致 */
  dps: number | null;
  stats: DerivedStats;
  weapons: Weapon[];
  attack: Attack;
  /** 主武器 id */
  primary: string;
  squad?: { wave_size: number; member_offset_ms: number };
  notes?: string[];
}

/** `data/units.json` 里的一条记录 */
export interface DatasetEntry {
  _schema: number;
  id: string;
  faction: string;
  variant: string;
  suffixes?: string[];
  source: string;
  pb?: { rarity?: string; [k: string]: unknown };
  name_zh?: string;
  name_en?: string;
  desc_zh?: string;
  desc_en?: string;
  warnings?: string[];
  derived: Derived;
}

/** `data/units.json` 整体 */
export interface Dataset {
  _schema: number;
  unit_count: number;
  commander_count: number;
  units: DatasetEntry[];
  commanders: DatasetEntry[];
}

/** 按 id 找一条 */
export function findEntry(ds: Dataset, id: string): DatasetEntry | undefined {
  return ds.units.find((e) => e.id === id) ?? ds.commanders.find((e) => e.id === id);
}

/** 全部条目（单位 + 指挥官） */
export function allEntries(ds: Dataset): DatasetEntry[] {
  return [...ds.units, ...ds.commanders];
}