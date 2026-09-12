/**
 * 攻击类型 —— 用多态处理 83 把武器的开火节奏。
 *
 * 设计见 `docs/attack-mechanics.md`，验证点见 `core/test/attack-verify.ts`（15/15）。
 *
 * ## 分层
 *
 * ```
 * 62 把常规武器   引擎内置默认序列（C++ 侧），参数读 burstTiming    → BasicAttack
 * 21 把特殊武器   gameplay/abilities/*.lua 的 Timeline/OnUpdate    → 15 个行为类
 *                                    ↑ 按 modifier_sequence.behaviourName 精确派发
 * ```
 *
 * **为什么按 behaviour 名派发**：22 把特殊武器的实现在 Lua 函数体里，
 * 与参数表（`tuning`）是两回事。靠 `if ("stage1" in tuning)` 嗅探形状已经错过多次
 * （漏 `TickAttack`、`muzzleFactor` 搞错、`damage()` 少两支）。名字派发是精确的，
 * 且类名直接对应 Lua 文件，便于审计。见 findings I94。
 *
 * `UnitAttack`（单位级）负责聚合：双武器**取最大**（不求和）、催化炮艇的跨武器规则、小队信息。
 *
 * ## `WeaponAttack` 的职责
 *
 *   1. 持有输入 —— `weapon` / `waveSize` / `hitsPerAttack`
 *   2. 声明契约 —— `label` / `dps()` / `phases()`（抽象）
 *   3. 解析伤害来源 —— `damage()` 的三源回退链 + `projectileDamage()`
 *   4. 读参数表 —— `tuning()`（强类型 `SequenceTuning`）
 *
 * **`phases()` 是给展示用的**（形状），`dps()` 是给排序/对比用的（数字）。
 * 精确数值不要塞进图形，交给表格。
 */

import { effectiveDamage, type EntityRecord, type SequenceTuning, type WeaponTuning } from "./types.ts";

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
   * **一次攻击动作打几下。**
   *
   * 来源：`unit_<id>_visual[<序列名>].MUZZLE_INFO` 的条目数。
   * 每个条目对应**一下**，条目里的 `muzzleIndex` 是**这一下从哪个枪口出**
   * （所以它不是「枪口数」—— 神像是 `[0,0,0]`，三下都从枪口 0 出）。
   *
   * 引擎自己的断言印证了这个含义（`ability_kodiak_weapon_sequence.lua:19`）：
   * `durationBetweenVolley >= volleyChargeUpTime + delayAfterShot × #MUZZLE_INFO`
   * —— 一轮要能塞下 `#MUZZLE_INFO` **下**攻击。
   *
   * ⚠️ **但派生公式不统一，要看伤害怎么写**：
   *   · 神像机甲 —— `projectile.modifier.damage = 400` 是**每下** → 乘：`400 × 3 / 2.5 = 480` ✅
   *   · 科迪亚克 —— `damageTuning = 1500` 是**一次攻击的总伤害** → 不乘：`1500 / 3.0 = 500` ✅
   *   · 沙暴 —— 实现用 `missileCount`（12）**覆盖**了击打数，`[0,1]` 只是枪口轮转周期 → 不乘 ✅
   *
   * 所以「乘不乘」由**伤害的粒度**决定，不是由这个数本身决定。
   */
  readonly hitsPerAttack: number;

  constructor(weapon: WeaponTuning, waveSize: number, hitsPerAttack = 1) {
    this.weapon = weapon;
    this.waveSize = waveSize;
    this.hitsPerAttack = hitsPerAttack;
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
  /**
   * 这把武器的**单发伤害**。
   *
   * ⚠️ **必须走 `effectiveDamage()`** —— 伤害有四个可能的位置，别在这里另写一条链。
   * 早先这里自己串了一遍（只认 `damageTuning` / `projectile.modifier` / `damageMain`），
   * 结果**漏了 `modifier_shot`（泰坦机甲）与 `damage1`（地狱火）**，
   * 两把武器的伤害显示成 0。见 findings I111/I112。
   */
  damage(): number {
    return effectiveDamage(this.weapon)?.default ?? 0;
  }

  /** 伤害是否来自**弹体的爆炸 modifier**（那种是每发值，要乘击打数） */
  protected projectileDamage(): number | undefined {
    const d = this.weapon.projectile?.modifier?.tuning?.damage;
    return d && typeof d === "object" ? (d as { default?: number }).default : undefined;
  }

  /** `modifier_sequence.tuning`，能力序列武器的参数都在这 */
  protected tuning(): SequenceTuning {
    return this.weapon.modifier_sequence?.tuning ?? {};
  }

}

/** A 族 · 持续射击：`damage × waveSize ÷ burstCooldown_s` */
export class ContinuousAttack extends WeaponAttack {
  get label() {
    return "持续射击";
  }
  private intervalMs(): number {
    const t = this.tuning();
    if (t.burstCooldown) return t.burstCooldown;
    const spawn = (this.weapon as { modifier_spawn?: { tuning?: { burstTuning?: { shotCooldownMs?: number } } } }).modifier_spawn;
    return spawn?.tuning?.burstTuning?.shotCooldownMs ?? 0;
  }
  dps(): number {
    const ms = this.intervalMs();
    if (!ms) return 0;
    return (this.damage() * this.waveSize * 1000) / ms;
  }
  phases(): Phase[] {
    const cu = this.tuning().chargeUpDuration ?? 0;
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
    const t = this.tuning();
    const out = [];
    for (const name of ["stage1", "stage2", "stage3", "stage4"] as const) {
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
    const t = this.tuning();
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
    const ptc = this.tuning().perTargetCount ?? {};
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
    const t = this.tuning();
    const cyc = t.burstCooldown ?? 0;
    const one = this.tiers()[0];
    if (!cyc || !one) return 0;
    return (one.count * this.damage() * 1000) / cyc;
  }
  phases(): Phase[] {
    const t = this.tuning();
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
    const t = this.tuning();
    return t.catalystBurst?.cooldown ?? 0;
  }
  dps(): number {
    const cd = this.cycleMs();
    if (!cd) return 0;
    return (this.damage() * 1000) / cd;
  }
  phases(): Phase[] {
    const t = this.tuning();
    const out: Phase[] = [];
    if (t.gasBurst?.cooldown) out.push({ kind: "reload", label: "铺瓦斯", ms: t.gasBurst.cooldown });
    if (t.catalystBurst?.cooldown)
      out.push({ kind: "fire", label: "引爆", ms: t.catalystBurst.cooldown, damage: this.damage() });
    return out;
  }
}

/** E 族 · 齐射：`每轮总伤害 ÷ durationBetweenVolley_s`。**不含**击打数乘法（由子类决定） */
export class VolleyAttack extends WeaponAttack {
  get label() {
    return "齐射";
  }
  protected cycleMs(): number {
    const t = this.tuning();
    return t.durationBetweenVolley ?? 0;
  }
  dps(): number {
    const cyc = this.cycleMs();
    if (!cyc) return 0;
    return (this.damage() * this.waveSize * 1000) / cyc;
  }
  phases(): Phase[] {
    const t = this.tuning();
    const out: Phase[] = [];
    if (t.initialChargeUpMs) out.push({ kind: "charge", label: "前摇", ms: t.initialChargeUpMs });
    out.push({
      kind: "fire",
      label: "一轮",
      ms: this.cycleMs(),
      damage: this.damage(),
      shots: this.hitsPerAttack,
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
    return this.tuning().tickPeriodMs ?? 0;
  }
  dps(): number {
    const tick = this.tickMs();
    if (!tick) return 0;
    return (this.damage() * 1000) / tick;
  }
  phases(): Phase[] {
    const t = this.tuning();
    const out: Phase[] = [];
    if (t.initialChargeUpMs) out.push({ kind: "charge", label: "前摇", ms: t.initialChargeUpMs });
    out.push({ kind: "fire", label: "持续光束", ms: null, damage: this.damage(), intervalMs: this.tickMs() });
    return out;
  }
}

/** 认得出来但公式未定 —— **不猜**，如实标未知 */
export class UnknownAttack extends WeaponAttack {
  readonly reason: string;
  constructor(weapon: WeaponTuning, waveSize: number, hitsPerAttack: number, reason: string) {
    super(weapon, waveSize, hitsPerAttack);
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
    return (this.damage() * num * this.waveSize) / cd;
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
 * `muzzleStrategy` 只决定这几下**怎么分配到枪口**，**不乘 DPS**。
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
 * 一次攻击 **3 下**（`MUZZLE_INFO` 三条），但 `damageTuning.default = 1500` 是
 * **这三下的总和**，所以**不再乘**击打数：`1500 / 3.0 = 500` ✅
 */
export class KodiakWeaponSequence extends VolleyAttack {}

/**
 * `ability_juggernaut_weapon_sequence_behaviour` —— 神像机甲 / 神像机甲_ST
 *
 * 一轮 **3 发**（Timeline 里硬编码三个 `Fire()`），伤害 `400` 写在
 * `projectile.modifier` 上是**每下的值**，所以要乘击打数：
 * `400 × 3 / 2.5 = 480` ✅
 *
 * ⚠️ 「乘不乘」由**伤害的粒度**决定（每下 vs 一次攻击总和），不是由击打数本身决定。
 * 沙暴是反例：伤害也在弹体上，但它的实现用 `missileCount` 覆盖了击打数
 * （见 `SandstormWeaponSequence`）。
 */
export class JuggernautWeaponSequence extends VolleyAttack {
  dps(): number {
    const cyc = this.cycleMs();
    if (!cyc) return 0;
    return (this.damage() * this.hitsPerAttack * this.waveSize * 1000) / cyc;
  }
}

/**
 * `ability_sandstorm_weapon_sequence_behaviour` —— 沙暴 / 沙暴_ST
 *
 * 按目标小队数分档倾泻 `missileCount` 发；它的 `MUZZLE_INFO` 只有 2 条，
 * 是因为实现**用 `missileCount`（12）覆盖了击打数**，`[0,1]` 只是枪口轮转周期。
 * `12 × 150 / 4.0 = 450` ✅
 */
export class SandstormWeaponSequence extends PourAttack {}

/** `ability_catalyst_chemical_weapon_sequence` —— 催化炮艇。周期在**另一把武器**上，由 `UnitAttack` 补 */
export class CatalystWeaponSequence extends DetonateAttack {}

/** `ability_scarab_weapon_sequence_behaviour` —— 圣甲虫。前摇后一枪，然后自爆；DPS 走 `burstTiming` */
export class ScarabWeaponSequence extends BasicAttack {}

/**
 * `ability_disruptor_weapon_sequence_behaviour` —— 破坏者
 *
 * 官方实现（该能力的 `TranslateToken("dps")`）：
 * `Fixed32(self.tuning.damage.default) / (Fixed32(self.tuning.tickPeriodMs) / 1000)`
 * —— 即 `damage ÷ tickPeriodMs_s`，与持续光束同式。
 * 实测数据：`damage.default = 26`、`tickPeriodMs = 40` → **650**。
 *
 * 早先标成 `UnknownAttack` 是**错的** —— 当时 `tuning` 里只看到 `initialChargeUpMs`，
 * 漏了 `damage` / `tickPeriodMs`（见 findings I109）。
 */
export class DisruptorWeaponSequence extends TickAttack {}

type BehaviourCtor = new (w: WeaponTuning, waveSize: number, hitsPerAttack: number) => WeaponAttack;

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
export function weaponAttackOf(weapon: WeaponTuning, waveSize: number, hitsPerAttack = 1): WeaponAttack {
  const beh = (weapon.modifier_sequence as { behaviourName?: string } | undefined)?.behaviourName;
  const Ctor = beh ? BEHAVIOURS[beh] : undefined;
  if (Ctor) return new Ctor(weapon, waveSize, hitsPerAttack);

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
    return new ContinuousAttack(weapon, waveSize, hitsPerAttack);
  }
  if ((weapon.burstTiming as { cooldown?: number })?.cooldown) {
    return new BasicAttack(weapon, waveSize, hitsPerAttack);
  }

  const why = beh ? `认不出 behaviour「${beh}」` : "既无 behaviour，也无 burstTiming.cooldown";
  return new UnknownAttack(weapon, waveSize, hitsPerAttack, why);
}

/** 单位级聚合：双武器**取最大**（不求和），并带上小队信息 */
export class UnitAttack {
  readonly unit: EntityRecord;
  readonly weapons: WeaponAttack[];
  readonly waveSize: number;
  readonly separationMs: number;
  /**
   * **主武器的下标** —— 面板显示的就是它。
   *
   * 引擎有 `GetPrimaryWeapon()` 这个概念，**14 个开火行为的 Timeline 都作用于它**
   * （不是「声明该行为的那把武器」—— 行为是写在某把武器的表里，但作用域是单位的）。
   * 见 findings I103。
   */
  readonly primaryIndex: number;

  private constructor(
    unit: EntityRecord,
    weapons: WeaponAttack[],
    waveSize: number,
    separationMs: number,
    primaryIndex: number,
  ) {
    this.unit = unit;
    this.weapons = weapons;
    this.waveSize = waveSize;
    this.separationMs = separationMs;
    this.primaryIndex = primaryIndex;
  }

  static of(unit: EntityRecord, waveSize?: number): UnitAttack {
    const cfg = unit.config;
    const wave = waveSize ?? cfg.squadTuning?.waveSize ?? 1;
    const sep = cfg.squadTuning?.attackSeparationDurationMS ?? 0;
    const ws = (cfg.combatantTuning?.weaponTunings ?? []) as WeaponTuning[];

    /*
     * 一次攻击打几下 = `#MUZZLE_INFO`（引擎自己的断言，见字段注释）。
     * 按武器的 `modifier_sequence.name` 去 `unit.visual` 里找对应的击打序列。
     */
    const patternFor = (w: WeaponTuning): number => {
      const seqName = (w.modifier_sequence as { name?: string } | undefined)?.name;
      if (!seqName || !unit.visual) return 1;
      return unit.visual[seqName]?.muzzleInfo?.length ?? 1;
    };

    const attacks = ws.map((w) => weaponAttackOf(w, wave, patternFor(w)));

    /*
     * **主武器** = 第一把「真武器」：有伤害，或带开火行为。
     *
     * 这样能跳过占位桩 —— 虎鲸轰炸机的武器[0] 是叫 `targetSelector` 的空壳
     * （无伤害、`modifier_sequence` 只有个空 `ability_empty_weapon_sequence`），
     * 真武器是武器[1] 的 `bomb`。
     */
    const hasBehaviour = (w: WeaponTuning) =>
      Boolean((w.modifier_sequence as { behaviourName?: string } | undefined)?.behaviourName);
    let primaryIndex = ws.findIndex((w, i) => attacks[i]!.damage() > 0 || hasBehaviour(w));
    if (primaryIndex < 0) primaryIndex = 0;

    /*
     * D 族特例：催化炮艇的 `catalystBurst` 写在**铺场那把**（`gasWeapon`）上，
     * 伤害却在**另一把**（`catalystWeapon`，270）上。它的 Timeline 是 15 个实现里
     * **唯一「单位级」的**（同时驱动两把武器），所以面板显示的是**被引爆那把**的数值：
     * `270 / 1.6 = 168.75`（findings I82/I103）。
     */
    const catalystCd = ws.reduce<number | undefined>((found, w) => {
      const cd = (w.modifier_sequence as { tuning?: { catalystBurst?: { cooldown?: number } } })
        ?.tuning?.catalystBurst?.cooldown;
      return cd && (found === undefined || cd < found) ? cd : found;
    }, undefined);
    if (catalystCd) {
      let victim: WeaponAttack | undefined;
      for (const a of attacks) {
        if (a instanceof DetonateAttack) continue;
        if (a.damage() <= 0) continue;
        if (victim === undefined || a.damage() > victim.damage()) victim = a;
      }
      if (victim) {
        const idx = attacks.indexOf(victim);
        attacks[idx] = new DetonateAttack(victim.weapon, wave).withCycle(catalystCd);
        primaryIndex = idx; // 单位级行为 → 面板数值由被引爆那把决定
      }
    }

    return new UnitAttack(unit, attacks, wave, sep, primaryIndex);
  }

  /** 主武器（面板显示的那把） */
  primary(): WeaponAttack | undefined {
    return this.weapons[this.primaryIndex];
  }

  /**
   * 单位级 DPS = **主武器的 DPS**。
   *
   * ⚠️ **不是「取最大」**（早先是 max，错在寡妇制造者上：面板 280 是喷火器，
   * 而火箭是 320，取最大会得 320）。见 findings I103。
   */
  dps(): number {
    return this.primary()?.dps() ?? 0;
  }

  /** 各武器各自的值，供页面逐把显示 */
  perWeapon(): Array<{ label: string; dps: number; primary: boolean }> {
    return this.weapons.map((w, i) => ({ label: w.label, dps: w.dps(), primary: i === this.primaryIndex }));
  }

  labels(): string[] {
    return [...new Set(this.weapons.map((w) => w.label))];
  }
}

/**
 * **官方面板口径**的 1-0 基准 DPS —— `CombatTuningInfo.TryGetBaseDps` 的移植
 * （`gameplay/tuning/CombatTuningInfo.lua:654-718`）。
 *
 * 产物里的 `derived.dps` 就是这个数：**与游戏内面板逐字对齐**，用于核对数据。
 * 「实际输出」不在这个函数里 —— 那是 `derive.ts` 的时序模型（`attack.tracks`），
 * 两者在本单位上会差一倍（烈焰之手：面板 112.5 / 实际 225，见 findings I195）。
 *
 * 官方结构（逐条对照）：
 *
 *   ① 面板**只看第 1 把武器**（`CombatTuningInfo.lua:193,201` 写死 `weaponIndex = 1`），
 *      唯一例外是单位自己重写了 `GetStatInfo` 的虎鲸轰炸机（改用武器 2 并自定公式，
 *      `unit_gdi_orcabomber.lua:186-190,211-223`）—— `UnitAttack` 的「主武器」选法
 *      正好落到那把炸弹上，所以这里不特判。
 *   ② 有 `modifier_sequence` → 各实现的 `TranslateToken("dps")`；取不到就
 *      `damage / TranslateToken("burstCooldownMs") × 1000`；再 `× waveSize`，**就返回**。
 *      ⚠️ 「武器级 `muzzleStrategy == All` 时 × muzzleCount」那两行在这个分支**之后**
 *      （:712-714），序列武器**永远走不到** → 烈焰之手的面板漏掉第二个枪口。
 *   ③ 无序列 → 弹夹式（`reloadTuning`）/ 爆发式（`burstTiming`）。
 */
export function panelDps(unit: EntityRecord, resolveUnit?: (id: string) => EntityRecord | undefined): number {
  const cfg = unit.config;
  const ws = (cfg.combatantTuning?.weaponTunings ?? []) as WeaponTuning[];
  const wave = cfg.squadTuning?.waveSize ?? 1;
  const first = ws[0];

  /*
   * ⚠️ **变体的面板值 = 本体的值** —— 因为实现的 `TranslateToken` 硬编码读本体：
   * `ability_sandstorm_weapon_sequence:TranslateToken` 里写的是
   * `nTuningUtil.GetWeaponSequenceTuning(unit_gdi_sandstorm, 1)`，压根不看自己属于谁。
   * 于是钢爪沙暴按**本体**的 `burstCooldown`(4000)/`missileCount`(12) 算得 **450**（自己写的是
   * 3000ms → 我们时序模型算 600），钢爪神像按本体 2.5s 算得 **480**（自己的
   * `durationBetweenVolley` 是 0 → 时序模型给不出值）。
   * 真跑游戏 Lua 逐单位核对（86 个单位、每单位一个进程）时扫出来的：**73 个有 DPS 的单位里
   * 2 个对不上，全是变体**（钢爪沙暴 450 vs 我们的 600、钢爪神像 480 vs 我们算不出值）；
   * 修完 `readsUnit` 后 **73/73 一致、零差异**。见 findings I196。
   */
  const readsUnit = ws
    .map((w) => (w.modifier_sequence as { readsUnit?: string } | undefined)?.readsUnit)
    .find((x): x is string => Boolean(x));
  if (readsUnit && resolveUnit) {
    const base = resolveUnit(readsUnit);
    if (base) return panelDps(base, resolveUnit);
  }

  /*
   * ③ 弹夹式的官方分支（:705-706）：`clipSize × waveSize ÷ reloadTimeMs × 1000 × damage`。
   *
   * ⚠️ 只有**第 1 把武器自己就是弹夹武器**时才走这里 —— 虎鲸轰炸机的弹夹在武器 2 上，
   * 而它的面板走单位自己的 override（`damage ÷ shotCooldownMs`），交给 ② 下面的选法。
   */
  const reload = first?.reloadTuning;
  if (first && !first.modifier_sequence && reload?.clipSize && reload.reloadTimeMs) {
    const dt = effectiveDamage(first);
    const damage = dt?.default ?? 0;
    return (damage * reload.clipSize * wave * 1000) / reload.reloadTimeMs;
  }

  // ② 序列武器 / 常规武器：`UnitAttack` 就是那 15 个 `TranslateToken("dps")` 的移植
  return UnitAttack.of(unit).dps();
}
