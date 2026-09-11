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

/** E 族 · 齐射：`每轮总伤害 ÷ durationBetweenVolley_s` */
export class VolleyAttack extends WeaponAttack {
  get label() {
    return "齐射";
  }
  private cycleMs(): number {
    const t = this.tuning() as { durationBetweenVolley?: number };
    return t.durationBetweenVolley ?? 0;
  }
  /**
   * **只有伤害写在弹体上时才乘发射数。**
   *
   * 两个单位 `#MUZZLE_INFO` 都是 3，但一个乘一个不乘：
   *   · 科迪亚克 `damageTuning = 1500` 是**整轮总和** → `1500/3.0 = 500`（不乘）✅
   *   · 神像机甲 `projectile.modifier.damage = 400` 是**每发** → `400×3/2.5 = 480`（乘）✅
   * 拿不准时以实测为准，见 docs/attack-mechanics.md 9.1。
   */
  dps(): number {
    const cyc = this.cycleMs();
    if (!cyc) return 0;
    const volley = this.projectileDamage() === undefined ? this.damage() : this.damage() * this.patternLength;
    return (volley * this.waveSize * 1000) / cyc;
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

/** 武器 → 攻击类型。判别谓词显式写出，便于审查与测试 */
export function weaponAttackOf(weapon: WeaponTuning, waveSize: number, patternLength = 1): WeaponAttack {
  const ms = (weapon as { modifier_sequence?: { tuning?: Record<string, unknown> } }).modifier_sequence;
  const t = ms?.tuning ?? {};

  if ("stage1" in t || "stage2" in t || "stage3" in t) return new StagedAttack(weapon, waveSize, patternLength);
  if ("perTargetCount" in t) return new PourAttack(weapon, waveSize, patternLength);
  if ("catalystBurst" in t || "gasBurst" in t) return new DetonateAttack(weapon, waveSize, patternLength);
  if ("durationBetweenVolley" in t) return new VolleyAttack(weapon, waveSize, patternLength);
  if ("tickPeriodMs" in t) return new TickAttack(weapon, waveSize, patternLength);
  if ("burstCooldown" in t) return new ContinuousAttack(weapon, waveSize, patternLength);
  if ((weapon as { modifier_spawn?: { tuning?: { burstTuning?: { shotCooldownMs?: number } } } }).modifier_spawn?.tuning?.burstTuning?.shotCooldownMs) return new ContinuousAttack(weapon, waveSize, patternLength);

  if ((weapon.burstTiming as { cooldown?: number })?.cooldown) return new BasicAttack(weapon, waveSize, patternLength);

  return new UnknownAttack(weapon, waveSize, patternLength, "既无 burstTiming.cooldown，也认不出 modifier_sequence 结构");
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
