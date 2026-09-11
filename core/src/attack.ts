/**
 * 攻击类型 —— 用多态处理 22 把「能力序列武器」与 61 把常规武器的开火节奏。
 *
 * 设计见 `docs/attack-mechanics.md`，验证点见其第 3 节。
 *
 * **两层**：
 *   `WeaponAttack`（武器级）—— 各族的公式与 `phases()`
 *   `UnitAttack`（单位级）  —— 聚合：双武器**取最大**（不求和）、小队信息
 *
 * **`phases()` 是给展示用的**（形状），`dps()` 是给排序/对比用的（数字）。
 * 精确数值不要塞进图形，交给表格。
 */

import type { EntityRecord, WeaponTuning } from "./types.ts";

/** 时序图与明细表共用的段 */
export interface Phase {
  kind: "charge" | "fire" | "pause" | "reload";
  label: string;
  ms: number | null;
  damage?: number;
  shots?: number;
  intervalMs?: number;
  /** 溅射目标数（B 族随阶段递增） */
  splash?: number;
  /** 相对上一段的倍率（用于标 ↑2.0×） */
  ramp?: number;
}

export abstract class WeaponAttack {
  // ⚠️ 不能写成参数属性 `constructor(readonly x: T)` —— Node 的 type-stripping 不支持
  readonly weapon: WeaponTuning;
  readonly waveSize: number;
  /**
   * 该武器序列的枪口分配模式长度（`unit_<id>_visual[<序列名>].MUZZLE_INFO` 的条目数）。
   *
   * ⚠️ **这是「枪口数」，不是「发数」。** 别把它当发数用。
   *
   * 反例（沙暴，用户指出）：`#MUZZLE_INFO = 2`，但一轮打 **12 发**（`missileCount`），
   * 它的 Timeline 是**在 2 个枪口上轮转 12 发**：
   * ```
   * while totalMuzzlesFired < missileCount do
   *   MUZZLE_INFO[totalMuzzlesFired % #MUZZLE_INFO + 1].muzzleIndex
   * ```
   *
   * `#MUZZLE_INFO` 只在「一发占一个枪口」的实现里恰好等于发数（科迪亚克 `ipairs(MUZZLE_INFO)`
   * 遍历开火）；神像机甲的 3 发更是**硬编码的三个 `Fire()` 调用**，与 MUZZLE_INFO 只是巧合相等。
   *
   * 当前的 `VolleyAttack` 只在「伤害写在弹体上」时乘它 —— 那是一个**由实测拟合出来的窄规则**
   * （正例神像机甲 ×3；反例沙暴 ×12、科迪亚克不乘），不是从引擎语义推出的定律。
   * 见 `docs/attack-mechanics.md` 9.1 与 findings I91。
   */
  readonly patternLength: number;

  constructor(weapon: WeaponTuning, waveSize: number, patternLength = 1) {
    this.weapon = weapon;
    this.waveSize = waveSize;
    this.patternLength = patternLength;
  }

  abstract get label(): string;
  /** 1-0 级基准 DPS */
  abstract dps(): number;
  abstract phases(): Phase[];

  /**
   * 伤害从哪取 —— **三处**（findings I76）：
   *   ① `damageTuning.default`（常规；对「一轮多发」的武器它已是**整轮总和**）
   *   ② `projectile.modifier.tuning.damage.default`（爆炸类，**每发**）
   *   ③ `modifier_sequence.tuning.damageMain.default`（火焰坦克这类）
   */
  damage(): number {
    const direct = this.weapon.damageTuning?.default;
    if (direct !== undefined) return direct;
    const t = this.tuning() as { damageMain?: { default?: number }; damage?: { default?: number } };
    // `damageMain`（火焰坦克）与 `damage`（圣灵/寡妇的 `{damage, tickPeriodMs}`）都要认
    return this.projectileDamage() ?? t.damageMain?.default ?? t.damage?.default ?? 0;
  }

  /** 伤害是否来自弹体的爆炸 modifier（那种是**每发**值，要乘发射数） */
  protected projectileDamage(): number | undefined {
    const mod = (this.weapon.projectile as { modifier?: { tuning?: { damage?: { default?: number } } } })
      ?.modifier;
    return mod?.tuning?.damage?.default;
  }

  /** `modifier_sequence.tuning`，能力序列武器的参数都在这 */
  protected tuning(): Record<string, unknown> {
    const ms = (this.weapon as { modifier_sequence?: { tuning?: Record<string, unknown> } })
      .modifier_sequence;
    return ms?.tuning ?? {};
  }

  /**
   * **固定为 1** —— muzzleCount 不参与 DPS 计算。
   * 实测：火焰坦克 muzzleStrategy=All + muzzleCount=2，但面板 DPS 是 380/0.5 = 760（×1），
   * 乘 2 会得到 1520。早先 aseDps 里的 strategy===""All"" 就乘 muzzleCount` 那条是错的。
   */
  protected muzzleFactor(): number {
    return 1;
  }
}

/** A 族 · 持续射击：`damage × waveSize ÷ burstCooldown_s` */
export class ContinuousAttack extends WeaponAttack {
  get label() {
    return "持续射击";
  }
  private intervalMs(): number {
    const t = this.tuning() as { burstCooldown?: number };
    if (t.burstCooldown) return t.burstCooldown;
    const spawn = (this.weapon as { modifier_spawn?: { tuning?: { burstTuning?: { shotCooldownMs?: number } } } }).modifier_spawn;
    return spawn?.tuning?.burstTuning?.shotCooldownMs ?? 0;
  }
  dps(): number {
    const ms = this.intervalMs();
    if (!ms) return 0;
    return (this.damage() * this.waveSize * this.muzzleFactor() * 1000) / ms;
  }
  phases(): Phase[] {
    const cu = (this.tuning() as { chargeUpDuration?: number }).chargeUpDuration ?? 0;
    const out: Phase[] = [];
    if (cu > 0) out.push({ kind: "charge", label: "前摇", ms: cu * 1000 });
    out.push({
      kind: "fire",
      label: "持续射击",
      ms: null,
      damage: this.damage(),
      intervalMs: this.intervalMs(),
    });
    return out;
  }
}

/** B 族 · 分段光束：`末段 damageMain ÷ tickPeriodMs_s`。**伤害随时间递增**（I77） */
export class StagedAttack extends WeaponAttack {
  get label() {
    return "分段光束";
  }
  private stages(): Array<{ name: string; dmg: number; side?: number; count?: number; splash?: number; tick: number }> {
    const t = this.tuning() as Record<string, { damageMain?: { default?: number }; damageSide?: { default?: number }; attackCount?: number; sideTargetCount?: number; tickPeriodMs?: number }>;
    const out = [];
    for (const name of ["stage1", "stage2", "stage3", "stage4"]) {
      const s = t[name];
      if (!s) continue;
      out.push({
        name,
        dmg: s.damageMain?.default ?? 0,
        side: s.damageSide?.default,
        count: s.attackCount,
        splash: s.sideTargetCount,
        tick: s.tickPeriodMs ?? 0,
      });
    }
    return out;
  }
  dps(): number {
    const st = this.stages();
    const last = st[st.length - 1];
    if (!last?.tick) return 0;
    return (last.dmg * 1000) / last.tick;
  }
  phases(): Phase[] {
    const t = this.tuning() as { initialChargeUpMs?: number };
    const out: Phase[] = [];
    const cu = t.initialChargeUpMs ?? 0;
    if (cu > 0) out.push({ kind: "charge", label: "前摇", ms: cu });
    const st = this.stages();
    let prev = 0;
    for (const s of st) {
      const ramp = prev > 0 && s.dmg > prev ? s.dmg / prev : undefined;
      out.push({
        kind: "fire",
        label: s.name.replace("stage", "阶段"),
        ms: s.count ? s.count * s.tick : null,
        damage: s.dmg,
        shots: s.count,
        intervalMs: s.tick,
        splash: s.splash,
        ramp,
      });
      prev = s.dmg;
    }
    return out;
  }
}

/** C 族 · 倾泻 + 停顿：`missileCount × damage ÷ burstCooldown_s`。按目标小队数分档 */
export class PourAttack extends WeaponAttack {
  get label() {
    return "倾泻";
  }
  /** 目标小队数 → 该档参数；[1] 是单目标档 */
  private tiers(): Array<{ squads: number; count: number; per: number }> {
    const t = this.tuning() as {
      perTargetCount?: Record<string, { missileCount?: number; timePerMissile?: number }>;
    };
    const ptc = t.perTargetCount ?? {};
    return Object.keys(ptc)
      .map(Number)
      .sort((a, b) => a - b)
      .map((n) => ({
        squads: n,
        count: ptc[String(n)]?.missileCount ?? 0,
        per: ptc[String(n)]?.timePerMissile ?? 0,
      }));
  }
  dps(): number {
    const t = this.tuning() as { burstCooldown?: number };
    const cyc = t.burstCooldown ?? 0;
    const one = this.tiers()[0];
    if (!cyc || !one) return 0;
    return (one.count * this.damage() * 1000) / cyc;
  }
  phases(): Phase[] {
    const t = this.tuning() as { burstCooldown?: number };
    const cyc = t.burstCooldown ?? 0;
    const out: Phase[] = [];
    for (const tier of this.tiers()) {
      const pour = tier.count * tier.per;
      out.push({
        kind: "fire",
        label: `倾泻（${tier.squads} 个目标）`,
        ms: pour,
        damage: this.damage(),
        shots: tier.count,
        intervalMs: tier.per,
      });
      if (cyc > pour) out.push({ kind: "pause", label: "停顿", ms: cyc - pour });
    }
    return out;
  }
}

/** D 族 · 铺场 + 引爆：`主动武器伤害 ÷ catalystBurst.cooldown_s`（机制待第二观测点） */
export class DetonateAttack extends WeaponAttack {
  /**
   * ⚠️ `catalystBurst` 往往**不在开火的那把武器上** —— 催化剂直升机把它写在 `gasWeapon`
   * 的 tuning 里，而伤害在 `catalystWeapon` 上。所以周期允许由 `UnitAttack` 从另一把武器传入。
   */
  private cycleOverride?: number;

  get label() {
    return "铺场 + 引爆";
  }
  withCycle(ms: number): this {
    this.cycleOverride = ms;
    return this;
  }
  private cycleMs(): number {
    if (this.cycleOverride) return this.cycleOverride;
    const t = this.tuning() as { catalystBurst?: { cooldown?: number } };
    return t.catalystBurst?.cooldown ?? 0;
  }
  dps(): number {
    const cd = this.cycleMs();
    if (!cd) return 0;
    return (this.damage() * 1000) / cd;
  }
  phases(): Phase[] {
    const t = this.tuning() as { catalystBurst?: { cooldown?: number }; gasBurst?: { cooldown?: number } };
    const out: Phase[] = [];
    if (t.gasBurst?.cooldown) out.push({ kind: "reload", label: "铺瓦斯", ms: t.gasBurst.cooldown });
    if (t.catalystBurst?.cooldown)
      out.push({ kind: "fire", label: "引爆", ms: t.catalystBurst.cooldown, damage: this.damage() });
    return out;
  }
}

/** E 族 · 齐射：`每轮总伤害 ÷ durationBetweenVolley_s`。**不含**枪口模式乘法 */
export class VolleyAttack extends WeaponAttack {
  get label() {
    return "齐射";
  }
  protected cycleMs(): number {
    const t = this.tuning() as { durationBetweenVolley?: number };
    return t.durationBetweenVolley ?? 0;
  }
  dps(): number {
    const cyc = this.cycleMs();
    if (!cyc) return 0;
    return (this.damage() * this.waveSize * 1000) / cyc;
  }
  phases(): Phase[] {
    const t = this.tuning() as { delayAfterShot?: number; initialChargeUpMs?: number };
    const out: Phase[] = [];
    if (t.initialChargeUpMs) out.push({ kind: "charge", label: "前摇", ms: t.initialChargeUpMs });
    out.push({
      kind: "fire",
      label: "一轮",
      ms: this.cycleMs(),
      damage: this.damage(),
      shots: this.patternLength,
    });
    if (t.delayAfterShot) out.push({ kind: "fire", label: "副炮延迟", ms: t.delayAfterShot });
    return out;
  }
}

/**
 * 单段持续光束：`{damage, tickPeriodMs}` —— `damage ÷ tickPeriodMs_s`。
 *
 * 与 B 族（`stage1/2/3`）同类，但只有一段、伤害不递增。
 * 代表：圣灵的 laser（160/0.25=640）、fire（140/0.5=280）、寡妇制造者的喷火器（140/0.5=280）。
 */
export class TickAttack extends WeaponAttack {
  get label() {
    return "持续光束";
  }
  private tickMs(): number {
    return (this.tuning() as { tickPeriodMs?: number }).tickPeriodMs ?? 0;
  }
  dps(): number {
    const tick = this.tickMs();
    if (!tick) return 0;
    return (this.damage() * 1000) / tick;
  }
  phases(): Phase[] {
    const t = this.tuning() as { initialChargeUpMs?: number };
    const out: Phase[] = [];
    if (t.initialChargeUpMs) out.push({ kind: "charge", label: "前摇", ms: t.initialChargeUpMs });
    out.push({ kind: "fire", label: "持续光束", ms: null, damage: this.damage(), intervalMs: this.tickMs() });
    return out;
  }
}

/** 认得出来但公式未定 —— **不猜**，如实标未知 */
export class UnknownAttack extends WeaponAttack {
  readonly reason: string;
  constructor(weapon: WeaponTuning, waveSize: number, patternLength: number, reason: string) {
    super(weapon, waveSize, patternLength);
    this.reason = reason;
  }
  get label() {
    return "未知";
  }
  dps(): number {
    return 0;
  }
  phases(): Phase[] {
    return [];
  }
}

/** 常规武器：`burstTiming.cooldown` 驱动的单发/连发 */
export class BasicAttack extends WeaponAttack {
  get label() {
    return "常规";
  }
  private cooldownS(): number {
    return (this.weapon.burstTiming as { cooldown?: number })?.cooldown ?? 0;
  }
  dps(): number {
    const cd = this.cooldownS();
    if (!cd) return 0;
    const num = (this.weapon.burstTiming as { numToBurst?: number })?.numToBurst ?? 1;
    return (this.damage() * num * this.waveSize * this.muzzleFactor()) / cd;
  }
  phases(): Phase[] {
    const bt = this.weapon.burstTiming as { chargeUpDuration?: number; numToBurst?: number };
    const out: Phase[] = [];
    if (bt?.chargeUpDuration) out.push({ kind: "charge", label: "前摇", ms: bt.chargeUpDuration * 1000 });
    out.push({
      kind: "fire",
      label: "开火",
      ms: this.cooldownS() * 1000,
      damage: this.damage(),
      shots: bt?.numToBurst,
    });
    return out;
  }
}

// ── 15 个开火行为实现 ─────────────────────────────────────────────
//
// **按 `behaviourName` 精确派发**，不再嗅探字段。
//
// 为什么：22 把特殊武器的真正实现在 `gameplay/abilities/*.lua` 的 `Timeline()` 里，
// 与参数表（`tuning`）是两回事。靠 `if ("stage1" in tuning)` 这类嗅探去猜形状，
// 本项目已经错过多次（漏 TickAttack、muzzleFactor 搞错、damage 少两支）。
// 用 behaviour 名派发是**精确**的，且类名直接对应 Lua 文件，便于审计。
//
// 每个类只写**已验证过的公式**（`core/test/attack-verify.ts` 的观测点会抓漂移），
// 不是对着 Lua 逐行转写。行为的细节说明见 `docs/attack-mechanics.md` 第 9 节。

/**
 * `ability_simple_weapon_sequence` —— 弹弓 / 狼獾 / 忏悔者 / 烈焰之手
 *
 * Lua：`while true` + `SetCooldown(burstCooldown)`，前摇在周期开头；
 * `muzzleStrategy` 只决定多发**怎么分配**，**不乘 DPS**。
 */
export class SimpleWeaponSequence extends ContinuousAttack {}

/** `ability_chemical_weapon_sequence` —— 生化战士 / 生化越野车。额外生成毒雾，**毒雾不计入 DPS** */
export class ChemicalWeaponSequence extends ContinuousAttack {}

/** `ability_rockwyrm_weapon_sequence_behaviour` —— 深岩巨虫。范围伤害 */
export class RockWyrmWeaponSequence extends ContinuousAttack {}

/** `ability_flametank_weapon_sequence_behaviour` —— 火焰坦克。主伤打目标格、副伤只打邻格，故 DPS 只用 `damageMain` */
export class FlameTankWeaponSequence extends ContinuousAttack {}

/** `ability_avatar_laser_weapon_sequence_behaviour` —— 圣灵（laser） */
export class AvatarLaserWeaponSequence extends TickAttack {}

/** `ability_avatar_fire_weapon_sequence_behaviour` —— 圣灵（fire） */
export class AvatarFireWeaponSequence extends TickAttack {}

/** `ability_widowmaker_fire_weapon_sequence_behaviour` —— 黑寡妇 */
export class WidowMakerWeaponSequence extends TickAttack {}

/** `ability_beamcannon_weapon_sequence_behaviour` —— 万钧巨炮。三段递增，取末段 */
export class BeamCannonWeaponSequence extends StagedAttack {}

/** `ability_basilisk_weapon_sequence_behaviour` —— 蛇怪。两段递增，取末段 */
export class BasiliskWeaponSequence extends StagedAttack {}

/**
 * `ability_kodiak_weapon_sequence_behaviour` —— 科迪亚克
 *
 * `damageTuning.default = 1500` 是**整轮总和**（3 个枪口分摊），所以**不乘**枪口数。
 * `1500 / 3.0 = 500` ✅
 */
export class KodiakWeaponSequence extends VolleyAttack {}

/**
 * `ability_juggernaut_weapon_sequence_behaviour` —— 神像机甲 / 神像机甲_ST
 *
 * 一轮 **3 发**（Timeline 里硬编码三个 `Fire()`），伤害 `400` 写在
 * `projectile.modifier` 上是**每发值**，所以要乘枪口模式长度：
 * `400 × 3 / 2.5 = 480` ✅
 *
 * ⚠️ 这是**实测拟合的窄规则**，不是引擎语义：沙暴也是「伤害在弹体上」，
 * 但它的枪口模式只有 2 条而一轮打 12 发（见 `SandstormWeaponSequence`）。
 */
export class JuggernautWeaponSequence extends VolleyAttack {
  dps(): number {
    const cyc = this.cycleMs();
    if (!cyc) return 0;
    return (this.damage() * this.patternLength * this.waveSize * 1000) / cyc;
  }
}

/**
 * `ability_sandstorm_weapon_sequence_behaviour` —— 沙暴 / 沙暴_ST
 *
 * 按目标小队数分档倾泻 `missileCount` 发；`MUZZLE_INFO` 只是**枪口轮转**用的
 * （2 个枪口轮流打 12 发），**不是发数**。`12 × 150 / 4.0 = 450` ✅
 */
export class SandstormWeaponSequence extends PourAttack {}

/** `ability_catalyst_chemical_weapon_sequence` —— 催化炮艇。周期在**另一把武器**上，由 `UnitAttack` 补 */
export class CatalystWeaponSequence extends DetonateAttack {}

/** `ability_scarab_weapon_sequence_behaviour` —— 圣甲虫。前摇后一枪，然后自爆；DPS 走 `burstTiming` */
export class ScarabWeaponSequence extends BasicAttack {}

/**
 * `ability_disruptor_weapon_sequence_behaviour` —— 破坏者
 *
 * 有 `FireEndlessBeam` / `FireLimitedBeam` 两种模式，但 `tuning` 里**只有 `initialChargeUpMs`**，
 * 没有周期参数，**公式未解**（也没有游戏内观测点）。如实标未知，不猜。
 */
export class DisruptorWeaponSequence extends UnknownAttack {
  constructor(weapon: WeaponTuning, waveSize: number, patternLength: number) {
    super(weapon, waveSize, patternLength, "破坏者的 Timeline 分无限/有限光束两模式，tuning 里没有周期参数");
  }
}

type BehaviourCtor = new (w: WeaponTuning, waveSize: number, patternLength: number) => WeaponAttack;

/** `behaviour` 名 → 实现类。键必须与 `gameplay/abilities/<名去掉 _behaviour>.lua` 对应 */
export const BEHAVIOURS: Record<string, BehaviourCtor> = {
  ability_simple_weapon_sequence: SimpleWeaponSequence,
  ability_chemical_weapon_sequence: ChemicalWeaponSequence,
  ability_rockwyrm_weapon_sequence_behaviour: RockWyrmWeaponSequence,
  ability_flametank_weapon_sequence_behaviour: FlameTankWeaponSequence,
  ability_avatar_laser_weapon_sequence_behaviour: AvatarLaserWeaponSequence,
  ability_avatar_fire_weapon_sequence_behaviour: AvatarFireWeaponSequence,
  ability_widowmaker_fire_weapon_sequence_behaviour: WidowMakerWeaponSequence,
  ability_beamcannon_weapon_sequence_behaviour: BeamCannonWeaponSequence,
  ability_basilisk_weapon_sequence_behaviour: BasiliskWeaponSequence,
  ability_kodiak_weapon_sequence_behaviour: KodiakWeaponSequence,
  ability_juggernaut_weapon_sequence_behaviour: JuggernautWeaponSequence,
  ability_sandstorm_weapon_sequence_behaviour: SandstormWeaponSequence,
  ability_catalyst_chemical_weapon_sequence: CatalystWeaponSequence,
  ability_scarab_weapon_sequence_behaviour: ScarabWeaponSequence,
  ability_disruptor_weapon_sequence_behaviour: DisruptorWeaponSequence,
};

/**
 * 武器 → 攻击类型。
 *
 * **先按 `behaviourName` 精确派发**（22 把特殊武器），
 * 没有 behaviour 的（61 把常规武器）才退到字段驱动。
 */
export function weaponAttackOf(weapon: WeaponTuning, waveSize: number, patternLength = 1): WeaponAttack {
  const beh = (weapon.modifier_sequence as { behaviourName?: string } | undefined)?.behaviourName;
  const Ctor = beh ? BEHAVIOURS[beh] : undefined;
  if (Ctor) return new Ctor(weapon, waveSize, patternLength);

  /*
   * 常规武器：`burstTiming.cooldown` 驱动。
   *
   * ⚠️ 但少数武器把间隔写在 `modifier_spawn.burstTuning.shotCooldownMs`（虎鲸轰炸机），
   * 而它们的 `burstTiming.cooldown` 也在（值不同）—— **必须先查前者**，
   * 否则会用错间隔（虎鲸会算成 800 而正确值是 1600）。
   */
  const spawn = (weapon as { modifier_spawn?: { tuning?: { burstTuning?: { shotCooldownMs?: number } } } })
    .modifier_spawn;
  if (spawn?.tuning?.burstTuning?.shotCooldownMs) {
    return new ContinuousAttack(weapon, waveSize, patternLength);
  }
  if ((weapon.burstTiming as { cooldown?: number })?.cooldown) {
    return new BasicAttack(weapon, waveSize, patternLength);
  }

  const why = beh ? `认不出 behaviour「${beh}」` : "既无 behaviour，也无 burstTiming.cooldown";
  return new UnknownAttack(weapon, waveSize, patternLength, why);
}

/** 单位级聚合：双武器**取最大**（不求和），并带上小队信息 */
export class UnitAttack {
  readonly unit: EntityRecord;
  readonly weapons: WeaponAttack[];
  readonly waveSize: number;
  readonly separationMs: number;

  private constructor(
    unit: EntityRecord,
    weapons: WeaponAttack[],
    waveSize: number,
    separationMs: number,
  ) {
    this.unit = unit;
    this.weapons = weapons;
    this.waveSize = waveSize;
    this.separationMs = separationMs;
  }

  static of(unit: EntityRecord, waveSize?: number): UnitAttack {
    const cfg = unit.config;
    const wave = waveSize ?? cfg.squadTuning?.waveSize ?? 1;
    const sep = cfg.squadTuning?.attackSeparationDurationMS ?? 0;
    const ws = (cfg.combatantTuning?.weaponTunings ?? []) as WeaponTuning[];

    /*
     * 一轮发数 = `#MUZZLE_INFO`（引擎自己的规则，见类头注释）。
     * 按武器的 `modifier_sequence.name` 去 `unit.visual` 里找对应的枪口模式。
     */
    const patternFor = (w: WeaponTuning): number => {
      const seqName = (w.modifier_sequence as { name?: string } | undefined)?.name;
      if (!seqName || !unit.visual) return 1;
      return unit.visual[seqName]?.muzzleInfo?.length ?? 1;
    };

    const attacks = ws.map((w) => weaponAttackOf(w, wave, patternFor(w)));

    /*
     * D 族特例：`catalystBurst` 写在**铺场那把手**上，伤害却在**另一把手**上。
     * 所以把所有武器里能找到的 `catalystBurst.cooldown` 取出来，交给伤害最高的那把引爆武器。
     * 依据：催化剂直升机 —— `gasWeapon` 有 `catalystBurst{cooldown:1600}`，
     * `catalystWeapon` 伤害 270，实测 270/1.6 = 168.75（见 findings I82）。
     */
    const catalystCd = ws.reduce<number | undefined>((found, w) => {
      const cd = (w.modifier_sequence as { tuning?: { catalystBurst?: { cooldown?: number } } })
        ?.tuning?.catalystBurst?.cooldown;
      return cd && (found === undefined || cd < found) ? cd : found;
    }, undefined);
    if (catalystCd) {
      // 伤害最高、且自身不是"铺场"那把的武器，改判为引爆型
      let victim: WeaponAttack | undefined;
      for (const a of attacks) {
        if (a instanceof DetonateAttack) continue;
        if (a.damage() <= 0) continue;
        if (victim === undefined || a.damage() > victim.damage()) victim = a;
      }
      if (victim) {
        const idx = attacks.indexOf(victim);
        attacks[idx] = new DetonateAttack(victim.weapon, wave).withCycle(catalystCd);
      }
    }

    return new UnitAttack(unit, attacks, wave, sep);
  }

  /** 招牌：**取最大，不求和**（findings I75） */
  dps(): number {
    return this.weapons.reduce((m, w) => Math.max(m, w.dps()), 0);
  }

  /** DPS 来自哪把武器（便于核对） */
  best(): WeaponAttack | undefined {
    return this.weapons.reduce<WeaponAttack | undefined>(
      (best, w) => (best === undefined || w.dps() > best.dps() ? w : best),
      undefined,
    );
  }

  labels(): string[] {
    return [...new Set(this.weapons.map((w) => w.label))];
  }
}
