/**
 * **批量转换器：提取器的原始 `config` → 我们的 `UnitDef`**（findings J52 的落地）。
 *
 * ## 三条规矩
 *
 * 1. **数值全部来自机器**（`extractAll` 真跑 Lua 得到的 `config` 树），这里**不猜、不补**；
 * 2. **每个字段带 `file:line` 锚点** —— 扫同一份 Lua 原文找 `键 = 值` 那一行；
 *    **值对不上就不写行号**（写成"行号未定"并记进 `gaps`）。锚点不许撒谎；
 * 3. **读不出来的进 `gaps`**（`warhead` / `splash` / 弹体附加伤害…），**宁可空着也不编**。
 *
 * ## 键名 → 我们的字段（实测对照）
 *
 * | 源码（`config` 里） | 我们的字段 |
 * | --- | --- |
 * | `burstTiming.{cooldown, chargeUpDuration, numToBurst, fireRate}` | `timing` 的 `cyclic`（秒→毫秒；`fireRate` = 多发间隔） |
 * | `reloadTuning.{clipSize, reloadTimeMs}` | `timing` 的 `magazine`（**装填从首发算**） |
 * | `modifier_sequence.tuning.{initialChargeUpMs, storeChargeTimeMs, stageN}` | `timing` 的 `staged` + `damage[]` 每段一项 |
 * | `damageTuning.{default, overrides}` / `stageN.{damageMain, damageSide, sideTargetCount}` | `damage[].{main, side, sideTargetCount}` |
 * | `weapon.descriptors`（位值） | `usage.canAttack: Target[]`（`types.ts` 的 `canAttackTarget`） |
 * | `muzzleCount` / `muzzleStrategy` / `targetingTuning` / 10 个旗标 | `usage.*` |
 * | `modifier_intro` / `modifier_outro`（**可能挂在任意槽**，壁虱挂在 `hidden` 槽） | `UnitDef.deploy`（**归单位**） |
 * | `projectile.calculateSpeedFromTimeToHit` 且 min == max | `flightMs`（J45：只有距离无关时才敢写） |
 *
 * ## ⚠️ 故意**不转**的（进 `gaps`）
 *
 * `warhead`（`projectile.modifier` / `modifier_shot` / 武器级 `modifier_spawn`）要逐把核 ability
 * 脚本；`splash` 的挑法（ring / wedge / line）写在 ability 里（J55）；`chargeUpLockOnTime` 这类亚相位；
 * 顶层那些**属于 ability 的** `<X>Tuning` 只原样留引用。
 */

import { Damage } from "../model/unit-def.ts";
import type { ModifyStat, Override, Target, UnitDef } from "../model/unit-def.ts";
import type { Timing, WeaponDamage, WeaponDef, WeaponUsage, TargetingDef } from "../model/weapon-def.ts";
import type { WarheadEffectDef, TileEffectDef } from "../model/warhead-def.ts";
import type { DeployParams } from "../model/behaviors/deploy-machine.ts";
import type { EntityRecord } from "../types.ts";
import { canAttackTarget } from "../types.ts";
import type { WeaponTuning } from "../types.ts";

/** 五个目标类型（`descriptors` 展开顺序；也是 `Override` 后缀的来源） */
const TARGETS: readonly Target[] = ["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"];

/** 覆写表标签（`"Vehicle"`）→ 目标身上的实际标签（`override_vehicle`） */
const overrideOf = (tag: string): Override => `override_${tag.toLowerCase()}` as Override;

/**
 * **时长硬编码在 Lua 里的 `behaviour`**（不是调参，`tuning` 是空的）——
 * 照抄并标行号，别当"缺字段"。
 *
 * 目前只有 `modifier_core_outro`：`gameplay/modifiers/modifier_core_outro.lua:6` 写着
 * `self.settings.durationms = 0`（圣甲虫的"收"用的就是它 ⇒ **收是瞬时的**）。
 */
const BEHAVIOUR_DURATION_MS: Record<string, { ms: number; anchor: string }> = {
  modifier_core_outro: {
    ms: 0,
    anchor: "gameplay/modifiers/modifier_core_outro.lua:6 `self.settings.durationms = 0`",
  },
};

/** 文件里出现过的 `behaviour = 名字`（判断"这个空 tuning 的挂件用的是哪个 behaviour"） */
function behavioursIn(luaText: string): string[] {
  return [...luaText.matchAll(/behaviour\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!);
}

/**
 * 某个 ability 的调参**挂在单位顶层的哪个键**上（只读**键名**，值仍来自运行时 config）。
 *
 * 依据单位文件里那段：
 *
 * ```lua
 * SetupModifierTuning { name = "ability_catalyst_explosion", tuning = unit_nod_catalystgunship.tiberiumExplosionTuning }
 * ```
 *
 * ⇒ 先找到写着这个 ability 名的那一行，再往下看几行找 `tuning = <单位>.<KEY>`。
 */
function tuningKeyForAbility(luaText: string, ability: string): string | undefined {
  const lines = luaText.split(/\r?\n/);
  /*
   * ⚠️ **要遍历所有出现处**：单位文件里这个名字通常先以 `RequiredHash("ability_x")`
   * 的形式出现在武器块里（那是"请求它"），而 `tuning = <单位>.<KEY>` 在后面的
   * `SetupModifierTuning { name = "ability_x", … }` 块里。只取第一处会**永远找不到键**
   * （踩过：催化爆炸的伤害就是这么没转上的）。
   */
  for (let at = 0; at < lines.length; at++) {
    if (!lines[at]!.includes(`"${ability}"`)) continue;
    for (const line of lines.slice(at, at + 10)) {
      const m = /tuning\s*=\s*[A-Za-z0-9_]+\.([A-Za-z0-9_]+)/.exec(line);
      if (m !== null) return m[1];
    }
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────
// 弹头（命中之后做什么）—— 15 处挂件，逐类可判
// ─────────────────────────────────────────────────────────────

/** 格子效果的数值（提取器收进 `data/units.json` 顶层 `auras` 的那些） */
export interface AuraTables {
  [name: string]: {
    tickMs?: number;
    tickDamage?: number;
    persistMs?: number;
    vs?: Array<[string, number]>;
    immune?: string[];
    groundOnly?: boolean;
    spawnDelayMs?: number;
  };
}

/**
 * **提取器还没收进 `auras` 表、但源码里写得明明白白的格子效果** —— 手工核过，带行号。
 *
 * 目前只有火：`aura_fire.lua:5,14-19`（毒气在 `data/units.json` 的 `auras` 里有）。
 */
const TILE_EFFECT_HAND: Record<string, { effect: TileEffectDef; anchor: string }> = {
  modifier_fire_bomber_fire: {
    effect: {
      tickMs: 250,
      tickDamage: 25,
      persistMs: 10000,
      vs: [["override_vehicle", 25]],
      groundOnly: true,
    },
    anchor: "gameplay/auras/aura_fire.lua:5,14-19（`PERSIST_DURATION_MS = 10000` · `default = 25` · `tickPeriodMs = 250`）",
  },
};

/** 从 `auras` 表（提取器产物）里取格子效果数值 */
function tileEffectFromAura(name: string, auras: AuraTables): TileEffectDef | undefined {
  const a = auras[name];
  if (a === undefined) return undefined;
  return {
    tickMs: a.tickMs ?? 0,
    tickDamage: a.tickDamage ?? 0,
    persistMs: a.persistMs ?? 0,
    ...(a.vs === undefined ? {} : { vs: a.vs.map(([tag, v]) => [tag, v] as [Override, number]) }),
    ...(a.immune === undefined ? {} : { immune: a.immune }),
    groundOnly: a.groundOnly ?? true,
    ...(a.spawnDelayMs === undefined ? {} : { spawnDelayMs: a.spawnDelayMs }),
  };
}

/**
 * **命中之后做什么** —— 挂件的 `tuning` 自描述 + 它 Lua 里那次调用，两样合起来判。
 *
 * | tuning 里的东西 | 判定 | 依据 |
 * | --- | --- | --- |
 * | `emp` / `stun` | `modify`（属性修改 + 时长） | `modifier_grenadier_projectile.lua:13-22` 的 `stats` / `durationMs` |
 * | `damageFalloff` + `damageRadius` | `falloff`（含衰减曲线，**世界单位**） | `modifier_orcabomber_projectile.lua:33` 的 `nDamage.DamageCombatantsFalloff` |
 * | `EXPLOSION_MODIFIER` | `catalyst_explosion`（+ 触发条件） | `modifier_catalystgunship_projectile.lua:37-41` |
 * | `MODIFIER_FIRE` | `place_modifier`（火 / 毒气的格子效果） | `modifier_fire_bomber_projectile.lua:42` 的 `CreateFire` |
 * | Lua 里 `AoeDamageSquad*` | `squad_each`（整队每人各一份） | `modifier_juggernaut_projectile.lua:25,29,33` |
 * | Lua 里 `DamageCombatantList*` | `per_combatant`（逐个战斗员） | `modifier_artillery_projectile.lua:32` |
 * | Lua 里 `GetLastCombatant` | `one_member`（只打最后一员） | `DamageUtil.lua:43` |
 *
 * ⚠️ **读不出来的一律记 gap**（两段命中、催化那两个视觉时刻、弹体自带伤害表…），不编。
 */
function warheadFor(
  where: string,
  mod: Record<string, unknown>,
  modifierText: string,
  auras: AuraTables,
  anchors: string[],
  gaps: string[],
  weaponId: string,
  modifierPath: string,
  /** 单位自己的 Lua 原文（找"被请求的 ability 的调参挂在哪个键上"） */
  unitLuaText: string,
  /** 单位顶层 `<X>Tuning`（催化爆炸的伤害表就在里面） */
  tunings: Record<string, Record<string, unknown>>,
): WarheadEffectDef[] {
  const t = rec(mod["tuning"]);
  const effects: WarheadEffectDef[] = [];
  const name = typeof mod["name"] === "string" ? mod["name"] : "?";
  const at = new AnchorTable(modifierText);

  /** 这个挂件在 Lua 里最后那次"打人"的调用（决定交付形状） */
  const callShape = (): "squad_each" | "per_combatant" | "one_member" | undefined => {
    if (/AoeDamageSquad/.test(modifierText)) return "squad_each";
    if (/DamageCombatantList|DamageCombatantsFalloff/.test(modifierText)) return "per_combatant";
    if (/GetLastCombatant\(\)\s*:\s*TakeRedirectDamage|DamageSquad/.test(modifierText)) return "one_member";
    return undefined;
  };

  // ① 属性修改（EMP / 晕眩）—— `emp` / `stun` 块自描述
  const modifyBlock = rec(t["emp"] ?? t["stun"]);
  if (Object.keys(modifyBlock).length > 0) {
    const durationMs = num(modifyBlock["durationMs"]);
    const stats = Object.entries(rec(modifyBlock["stats"])).filter(([, v]) => typeof v === "number") as Array<[ModifyStat, number]>;
    if (durationMs === undefined) {
      gaps.push(`${weaponId} 弹头（${name}）：EMP/晕眩没有 \`durationMs\` ⇒ \`modify\` 没建`);
    } else {
      effects.push({ kind: "modify", durationMs, stats: stats.map(([k, v]) => [k as ModifyStat, v]) });
      const line = at.line("durationMs", durationMs);
      anchors.push(
        `弹头（${name}）← ${modifierPath}${line === undefined ? "" : `:${line}`} \`${t["emp"] !== undefined ? "emp" : "stun"}\` 块` +
          `（${stats.length} 项属性 · ${durationMs}ms${num(modifyBlock["stunImmunityMs"]) === undefined ? "" : ` · 免疫 ${num(modifyBlock["stunImmunityMs"])}ms`}）`,
      );
    }
  }

  // ② 圆内按距离衰减（虎鲸轰炸机）—— `damageFalloff.distances` + `damageRadius`
  const falloff = rec(t["damageFalloff"]);
  const radius = num(t["damageRadius"]);
  if (radius !== undefined && Array.isArray(falloff["distances"])) {
    const curve = falloff["distances"]
      .map((d) => rec(d))
      .map((d) => ({ distance: num(d["distance"]) ?? 0, percent: num(d["percent"]) ?? 0 }));
    effects.push({
      kind: "falloff",
      radius,
      curve,
    });
    const callLine = at.line("DamageCombatantsFalloff");
    anchors.push(
      `弹头（${name}）← ${modifierPath}${callLine === undefined ? "" : `:${callLine}`} \`nDamage.DamageCombatantsFalloff\`（半径 ${radius} 世界单位 · 曲线 ${curve.length} 点${falloff["isRamped"] === true ? " · ramped" : ""}）`,
    );
  }

  // ③ 催化爆炸（直升机 / 捷德）—— `EXPLOSION_MODIFIER` + 触发条件
  const explosion = t["EXPLOSION_MODIFIER"];
  if (typeof explosion === "string") {
    const activator = t["MODIFIER_THAT_ACTIVATES_EXPLOSION"];
    const effect: WarheadEffectDef = {
      kind: "catalyst_explosion",
      impl: explosion,
      triggers: typeof activator === "string" ? [{ kind: "tileHasModifier", modifier: activator }] : [],
    };
    /*
     * **爆炸自己的伤害表与扣血时刻**：在被请求的那个 ability 的调参里
     * （直升机 = 单位的顶层 `tiberiumExplosionTuning`，`unit_nod_catalystgunship.lua:155-171`：
     * `damageMain 800 / 建筑 800 / 步兵 300`、`DAMAGE_TIME = 300`、`DESCRIPTOR_FILTERS = Ground`）。
     *
     * ⚠️ **怎么找到是哪个 tuning**：单位文件里那段 `SetupModifierTuning { name = "ability_x",
     * tuning = <单位>.<KEY> }` —— 从**原文**里读出那个**键名**（值仍然来自运行时 config）。
     */
    const tuningKey = tuningKeyForAbility(unitLuaText, explosion);
    const tuning = tuningKey === undefined ? undefined : tunings[tuningKey];
    const explosionDamage = tuning === undefined ? undefined : damageOf(rec(tuning)["damageMain"] ?? rec(tuning)["damage"]);
    const damageMs = tuning === undefined ? undefined : num(rec(tuning)["DAMAGE_TIME"]);
    const filters = tuning === undefined ? undefined : num(rec(tuning)["DESCRIPTOR_FILTERS"]);
    if (explosionDamage !== undefined) effect.damage = explosionDamage;
    if (damageMs !== undefined) effect.timing = { damageMs };
    // 只打地面：`DESCRIPTOR_FILTERS` 里没有飞行位（4096 / AllMask 1024）
    if (filters !== undefined) effect.groundOnly = filters !== 4096 && filters !== 1024;
    effects.push(effect);
    const line = at.line("EXPLOSION_MODIFIER", explosion) ?? at.line("EXPLOSION_MODIFIER");
    anchors.push(
      `弹头（${name}）← ${modifierPath}${line === undefined ? ":37-41" : `:${line}`} \`RequestAbility(... ${explosion})\`` +
        (typeof activator === "string" ? `，条件：格上有 \`${activator}\`` : ""),
    );
    if (explosionDamage !== undefined) {
      anchors.push(
        `爆炸伤害 ← 顶层 \`${tuningKey}\` 的 \`damageMain\`：${explosionDamage.base}` +
          `（${explosionDamage.overrides?.map(([k, v]) => `${k} ${v}`).join(" / ") ?? "无覆写"}）`,
      );
    }
    if (damageMs !== undefined) anchors.push(`扣血时刻 ← \`${tuningKey}.DAMAGE_TIME = ${damageMs}\``);
    if (explosionDamage === undefined) {
      gaps.push(
        `${weaponId} 弹头（${name}）：催化爆炸的**伤害表**没找到（应在上层 tuning \`tiberiumExplosionTuning\` 的 \`damageMain\`）`,
      );
    }
    gaps.push(
      `${weaponId} 弹头（${name}）：视觉开演时刻（\`visual.EXPLOSION_START_TIME\`）在视觉块里、提取器还没收 ⇒ 只转了扣血时刻` +
        (damageMs === undefined ? "（连它也没有）" : ` ${damageMs}ms`),
    );
  }

  // ④ 铺格子效果（火 / 毒气）—— `MODIFIER_FIRE` 之类
  const tileModifier = t["MODIFIER_FIRE"] ?? t["MODIFIER_GAS"] ?? t["MODIFIER"];
  if (typeof tileModifier === "string" && (t["MODIFIER_FIRE"] !== undefined || t["MODIFIER_GAS"] !== undefined)) {
    const effect = tileEffectFromAura(tileModifier, auras) ?? TILE_EFFECT_HAND[tileModifier]?.effect;
    const refresh = /RestartModifierByNameId|RequestModifier/.test(modifierText);
    effects.push({ kind: "place_modifier", name: tileModifier, effect: effect ?? { tickMs: 0, tickDamage: 0, persistMs: 0, groundOnly: true } });
    if (refresh) effects.push({ kind: "refresh_modifier", name: tileModifier });
    const line = at.line("MODIFIER_FIRE", tileModifier) ?? at.line("MODIFIER_GAS", tileModifier);
    anchors.push(
      `弹头（${name}）← ${modifierPath}${line === undefined ? "" : `:${line}`} 铺 \`${tileModifier}\`` +
        (effect === undefined ? "（⚠️ 格子数值没找到）" : `（每 ${effect.tickMs}ms 一跳、每跳 ${effect.tickDamage}、持续 ${effect.persistMs}ms）`),
    );
    if (effect === undefined) {
      gaps.push(`${weaponId} 弹头（${name}）：铺 \`${tileModifier}\` 的**格子数值**（每跳伤害/间隔/持续）没找到 ⇒ 三个数按 0`);
    }
  }

  // ⑤ 交付形状（谁挨打）—— 从 Lua 里那次调用判
  const shape = callShape();
  if (effects.length === 0) {
    if (shape !== undefined) {
      effects.push({ kind: shape });
      anchors.push(`弹头（${name}）← ${modifierPath} 的伤害调用（${shape === "squad_each" ? "AoeDamageSquad*" : shape === "per_combatant" ? "DamageCombatantList*" : "GetLastCombatant"}）`);
    } else if (/damage/.test(JSON.stringify(t))) {
      gaps.push(`${weaponId} 弹头（${name}）：自带伤害表但**看不清交付形状**（Lua 里没有可识别的打人调用）⇒ 弹头空着`);
    }
  } else if (shape !== undefined && !effects.some((e) => e.kind === "squad_each" || e.kind === "per_combatant" || e.kind === "one_member")) {
    // 有格子/属性效果，同时也打了人 ⇒ 补一条交付形状
    effects.unshift({ kind: shape });
  }

  // ⑥ 读不出来的：两段命中、弹体自带伤害表、挂件自身时长
  if (isRecord(t["damage1"]) || isRecord(t["damage2"])) {
    const delay = num(t["SECOND_IMPACT_DELAY"]);
    gaps.push(
      `${weaponId} 弹头（${name}）：**两段命中**（\`damage1\`/\`damage2\`${delay === undefined ? "" : `，第二段延后 ${delay}ms`}）—— 模型没有这个形状，只转出了效果`,
    );
  }
  if (num(t["durationMs"]) !== undefined && !isRecord(t["MODIFIER_FIRE"])) {
    gaps.push(`${weaponId} 弹头（${name}）：挂件自身时长 \`durationMs = ${num(t["durationMs"])}\` 的语义还没定 ⇒ 没转`);
  }
  return effects;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const rec = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
/** 秒 → 毫秒（源码的节奏一律是秒） */
const sec = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : n * 1000;
};

/** 伤害表（`default` + `override`/`overrides` 两种写法）→ `Damage` */
function damageOf(src: unknown): Damage | undefined {
  const t = rec(src);
  const base = num(t["default"]);
  if (base === undefined) return undefined;
  const raw = t["overrides"] ?? t["override"];
  const pairs = Array.isArray(raw)
    ? raw
        .filter((e): e is [string, number] => Array.isArray(e) && e.length === 2 && typeof e[1] === "number")
        .map(([tag, value]) => [overrideOf(tag), value] as [Override, number])
    : [];
  return new Damage(base, pairs.length ? pairs : undefined);
}

// ─────────────────────────────────────────────────────────────
// 锚点表
// ─────────────────────────────────────────────────────────────

/**
 * 扫 Lua 原文找 `键 = 值` 那一行。
 *
 * ⚠️ 这是**记行号**，不是取数：值一律来自运行时 `config`。
 * 给了 `value` 就必须在**同一行**里找到它，否则当没找到（⇒ 调用方写"行号未定"）。
 */
export class AnchorTable {
  readonly #lines: string[];

  constructor(luaText: string) {
    this.#lines = luaText.split(/\r?\n/);
  }

  line(key: string, value?: string | number): number | undefined {
    const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const keyRe = new RegExp(`(^|[^A-Za-z0-9_])${esc(key)}\\s*=`);
    const valRe = value === undefined ? undefined : new RegExp(`(^|[^0-9.])${esc(String(value))}([^0-9]|$)`);
    for (let i = 0; i < this.#lines.length; i++) {
      const line = this.#lines[i]!;
      if (!keyRe.test(line)) continue;
      if (valRe !== undefined && !valRe.test(line)) continue;
      return i + 1;
    }
    return undefined;
  }

  /** 记一个锚点；行号没找到就记 `行号未定` 并进 `gaps` */
  anchor(out: string[], gaps: string[], label: string, key: string, value?: string | number): void {
    const line = this.line(key, value);
    if (line === undefined) {
      out.push(`${label} ← 行号未定（\`${key}\`${value === undefined ? "" : ` = ${value}`}）`);
      gaps.push(`${label}：Lua 里没找到 \`${key}${value === undefined ? "" : ` = ${value}`}\` 那一行 ⇒ 锚点未定`);
      return;
    }
    out.push(`${label} ← :${line} \`${key}${value === undefined ? "" : ` = ${value}`}\``);
  }

  /**
   * 找**函数调用**那一行（`self:Foo()` 这种，**没有 `=`**）。
   *
   * ⚠️ `line()` 只认 `键 = 值` 的赋值行；拿它去找调用会**永远找不到**
   * （踩过：圣甲虫的 `TakeHiddenDestroyDamage()` 因此没被认出来）。
   */
  callLine(name: string): number | undefined {
    const re = new RegExp(`(^|[^A-Za-z0-9_])${name}\\s*\\(`);
    for (let i = 0; i < this.#lines.length; i++) {
      if (re.test(this.#lines[i]!)) return i + 1;
    }
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────
// 武器
// ─────────────────────────────────────────────────────────────

interface WeaponParts {
  def: WeaponDef;
  gaps: string[];
  deploy?: DeployParams;
  /** 这个槽上写了 `canShootWhileMoving` */
  shootWhileMoving: boolean;
}

/** 转换时需要的外部料（单位 Lua 原文、挂件 Lua 原文怎么读、格子效果表） */
export interface ConvertContext {
  /** 单位自己的 Lua 原文（锚点用） */
  luaText: string;
  /** 读某个 `gameplay/modifiers/xxx.lua` 的原文（读不到返回 `undefined`） */
  modifierText?: (name: string) => string | undefined;
  /** 提取器收进来的格子效果表（`data/units.json` 顶层 `auras`） */
  auras?: AuraTables;
  /**
   * **单位的顶层 `<X>Tuning` 块** —— 被请求的 ability 的调参住在这儿
   * （催化爆炸的伤害表就是 `tiberiumExplosionTuning.damageMain`）。
   */
  tunings?: Record<string, Record<string, unknown>>;
}

/**
 * **隔壁槽**序列里的具名 burst —— 与"本槽"配对用的那一份。
 *
 * ## 为什么需要它（真实案例：催化剂炮艇）
 *
 * 催化剂炮艇有**两个槽**，而那个驱动它们的序列
 * （`ability_catalyst_chemical_weapon_sequence`）**只挂在毒气槽上**：
 *
 * ```lua
 * -- unit_nod_catalystgunship.lua:38-53（gasWeapon 的 modifier_sequence.tuning）
 * catalystBurst = { initialChargeUpMs = 0, cooldown = 1600 }   -- 催化剂弹 1.6s 一轮
 * gasBurst      = { initialChargeUpMs = 4500, cooldown = 6000 } -- 毒气：蓄 4.5s、6s 一轮
 * ```
 *
 * 而**催化剂弹那个槽自己也写了一个 `burstTiming`**（`:120-124`）：`cooldown = 3.0` / `chargeUpDuration = 0.08`
 * —— 那是**引擎默认路径**的值，**不是**真值：真正开火的是序列，它按 `catalystBurst.cooldown` 排班
 * （`ability_catalyst_chemical_weapon_sequence.lua:10` 的面板 DPS 公式、`:95-96` 的
 * `SetCooldown` / `catalystFireTime +=`）。
 *
 * 实测后果：产物写成 3.0s ⇒ 催化剂炮艇的 DPS 只有 **90**，而面板/公式是 `270 ÷ 1.6s = 169`（wiki 也写 169）。
 *
 * ## 配对规则
 *
 * 槽名去掉 `Weapon` 与 burst 名去掉 `Burst` 后**同名即配对**（`catalystWeapon` ↔ `catalystBurst`）。
 * ⚠️ **本槽自己有条序列时一律不借**（它自己的序列优先，绝不覆盖）。
 */
export interface SiblingBurst {
  /** burst 表的名字（`catalystBurst`） */
  burst: string;
  /** 它的周期（毫秒） */
  cooldownMs: number;
  /** 它挂在哪个槽上（`gasWeapon`）—— 只说给人听 */
  fromWeapon: string;
}

/** 本槽没有序列时，去**别的槽**的序列里找一个与本槽同名的具名 burst */
function siblingBurstFor(w: WeaponTuning, others: WeaponTuning[]): SiblingBurst | undefined {
  const t = w as unknown as Record<string, unknown>;
  if (Object.keys(rec(t["modifier_sequence"])).length > 0) return undefined; // 自己有序列表 ⇒ 不借
  const stem = (typeof t["name"] === "string" ? t["name"] : "").replace(/weapon/i, "").toLowerCase();
  if (stem.length < 3) return undefined;
  for (const other of others) {
    const ot = other as unknown as Record<string, unknown>;
    const oseq = rec(rec(ot["modifier_sequence"])["tuning"]);
    for (const [k, v] of Object.entries(oseq)) {
      if (!/burst/i.test(k) || !isRecord(v)) continue;
      const cd = num((v as Record<string, unknown>)["cooldown"]);
      if (cd === undefined) continue;
      const bstem = k.replace(/burst/i, "").toLowerCase();
      if (bstem.length >= 3 && (bstem === stem || stem.includes(bstem) || bstem.includes(stem))) {
        return { burst: k, cooldownMs: cd, fromWeapon: typeof ot["name"] === "string" ? ot["name"] : "?" };
      }
    }
  }
  return undefined;
}

function convertWeapon(
  w: WeaponTuning,
  index: number,
  src: EntityRecord,
  at: AnchorTable,
  ctx: ConvertContext,
  /**
   * **隔壁槽**序列里的具名 burst（按名字与**本槽**配对）—— 见 {@link siblingBurstFor}。
   * 只有本槽**自己没有** `modifier_sequence` 时才可能非空。
   */
  sibling?: SiblingBurst,
): WeaponParts {
  const t = w as unknown as Record<string, unknown>;
  const gaps: string[] = [];
  const anchors: string[] = [];
  const id = typeof t["name"] === "string" ? t["name"] : `weapon${index + 1}`;
  const weaponLine = at.line("name", id);
  anchors.push(`weaponTunings[${index}] = "${id}"${weaponLine === undefined ? "（行号未定）" : ` ← :${weaponLine}`}`);

  const reload = rec(t["reloadTuning"]);
  const sequence = rec(t["modifier_sequence"]);
  const seq = rec(sequence["tuning"]);
  const burst = rec(t["burstTiming"]);
  const flag = (key: string): boolean | undefined => bool(t[key]);

  // ① 节奏：分段 → 装填 → 循环（顺序不能换：分段武器的 burstTiming 往往是空的）
  let timing: Timing;
  let damage: WeaponDamage[] = [];
  const stageKeys = Object.keys(seq)
    .filter((k) => /^stage\d+$/.test(k))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  /*
   * **"单段"分段武器**：`disruptor` / `avatar` 这些把 `attackCount` / `tickPeriodMs` / `damage`
   * 直接写在 `modifier_sequence.tuning` 顶层的（没有 `stageN`）—— 形状与分段一致，只是一段。
   *
   * ⚠️ **判据必须是"节奏键"（`attackCount` / `tickPeriodMs`），不能只看有没有伤害表**：
   * 火焰坦克 / 岩虫的序列里也有顶层 `damageMain`，但它们**不是**分段武器
   * （周期由 `burstCooldown` 给），把它们当分段会让 `tickPeriodMs` 取到 0 ⇒ 时序整条塌掉
   * （用户报的"火焰坦克的时序也没了"就是这个）。
   */
  const topLevelStage = num(seq["attackCount"]) !== undefined || num(seq["tickPeriodMs"]) !== undefined;

  if (stageKeys.length > 0 || topLevelStage) {
    const sources = stageKeys.length > 0 ? stageKeys.map((k) => seq[k]) : [seq];
    const stages: Array<{ attackCount?: number; tickPeriodMs: number }> = [];
    for (let i = 0; i < sources.length; i++) {
      const st = rec(sources[i]);
      const tick = num(st["tickPeriodMs"]) ?? 0;
      const count = num(st["attackCount"]);
      stages.push(count === undefined ? { tickPeriodMs: tick } : { attackCount: count, tickPeriodMs: tick });

      const main = damageOf(st["damageMain"]) ?? damageOf(st["damage"]);
      if (main === undefined) {
        gaps.push(`${id} 段 ${i + 1}：没有 \`damageMain\`/\`damage\` ⇒ 这一段伤害空着`);
      } else {
        const one: WeaponDamage = { main };
        const side = damageOf(st["damageSide"]);
        if (side !== undefined) one.side = side;
        const cnt = num(st["sideTargetCount"]);
        if (cnt !== undefined) one.sideTargetCount = cnt;
        damage.push(one);
      }
      if (num(st["sideTargetCount"]) !== undefined || isRecord(st["damageSide"])) {
        gaps.push(`${id} 段 ${i + 1}：有副伤，但**挑法**（ring/wedge/line）在 ability 脚本里 ⇒ \`splash\` 空着`);
      }
      const label = stageKeys.length > 0 ? `${id}.timing.stages[${i}].` : `${id}.timing.stages[0].`;
      if (count !== undefined) at.anchor(anchors, gaps, `${label}attackCount`, "attackCount", count);
      at.anchor(anchors, gaps, `${label}tickPeriodMs`, "tickPeriodMs", tick);
    }
    const initial = num(seq["initialChargeUpMs"]);
    const store = num(seq["storeChargeTimeMs"]);
    const impl = typeof sequence["name"] === "string" ? sequence["name"] : undefined;
    timing = {
      kind: "staged",
      initialChargeUpMs: initial ?? 0,
      stages,
      ...(store === undefined ? {} : { storeChargeTimeMs: store }),
      ...(impl === undefined ? {} : { impl }),
    };
    if (initial === undefined) gaps.push(`${id}：分段武器没有 \`initialChargeUpMs\` ⇒ 按 0`);
    else at.anchor(anchors, gaps, `${id}.timing.initialChargeUpMs`, "initialChargeUpMs", initial);
    if (store !== undefined) at.anchor(anchors, gaps, `${id}.timing.storeChargeTimeMs`, "storeChargeTimeMs", store);
    at.anchor(anchors, gaps, `${id}.timing(sequence)`, "modifier_sequence");
  } else if (num(reload["clipSize"]) !== undefined || num(reload["reloadTimeMs"]) !== undefined) {
    const clipSize = num(reload["clipSize"]) ?? 1;
    const reloadTimeMs = num(reload["reloadTimeMs"]) ?? 0;
    /*
     * ⚠️ **弹夹武器的真节奏可能在 `modifier_spawn.tuning.burstTuning` 里**（虎鲸攻击机）：
     *
     * ```lua
     * -- unit_gdi_orcabomber.lua:100-113
     * modifier_spawn = { tuning = { burstTuning = { initialChargeUpMs = 1750, shotCooldownMs = 500 } } }
     * ```
     *
     * `modifier_orcabomber_bomb.lua:44-51` 就是拿这两个数在跑：
     * `waitForAgeMs += initialChargeUpMs`（**每轮**都付 ⇒ 是"一夹第一发前的前摇"，不是首发一次性的）
     * 然后 `for i = 1, clipSize do Fire(); waitForAgeMs += shotCooldownMs end`。
     * 武器级那个 `burstTiming`（cooldown 1.0 / chargeUpDuration 0.5）在这把武器上**不是**真值。
     */
    const spawnBurst = rec(rec(rec(t["modifier_spawn"])["tuning"])["burstTuning"]);
    const spawnShotGap = num(spawnBurst["shotCooldownMs"]);
    const spawnCharge = num(spawnBurst["initialChargeUpMs"]);
    const drivenByAbility = spawnShotGap !== undefined || spawnCharge !== undefined;

    timing = {
      kind: "magazine",
      clipSize,
      reloadTimeMs,
      gapMs: spawnShotGap ?? sec(burst["cooldown"]) ?? 0,
      chargeUpMs: spawnCharge ?? sec(burst["chargeUpDuration"]) ?? 0,
    };
    at.anchor(anchors, gaps, `${id}.timing(clip)`, "reloadTuning");
    at.anchor(anchors, gaps, `${id}.timing.clipSize`, "clipSize", clipSize);
    at.anchor(anchors, gaps, `${id}.timing.reloadTimeMs`, "reloadTimeMs", reloadTimeMs);
    if (drivenByAbility) {
      /** 这条节奏是那个 spawn modifier 在跑的（`modifier_<id>_bomb` 之类） */
      const spawnName = typeof rec(t["modifier_spawn"])["name"] === "string" ? (rec(t["modifier_spawn"])["name"] as string) : "?";
      const spawnAnchors: string[] = [];
      if (spawnCharge !== undefined) at.anchor(spawnAnchors, gaps, `${id}.timing.chargeUpMs（**一夹第一发前**的蓄力）`, "initialChargeUpMs", spawnCharge);
      if (spawnShotGap !== undefined) at.anchor(spawnAnchors, gaps, `${id}.timing.gapMs`, "shotCooldownMs", spawnShotGap);
      anchors.push(
        `${id}.timing ← \`modifier_spawn.tuning.burstTuning\`（由 \`${spawnName}\` 驱动：` +
          `一夹第一发前蓄力 ${spawnCharge ?? "?"}ms、每发间隔 ${spawnShotGap ?? "?"}ms）—— 武器级 \`burstTiming\` 不是真值`,
        ...spawnAnchors,
      );
      gaps.push(
        `${id}：装填**在最后一发之后**才开始（\`${spawnName}\` 里 \`BeginReload()\` 在打完那 ${clipSize} 发之后）—— ` +
          `模型的弹夹是"**从首发算**"（MLRS 那种）⇒ 这一把的实际周期比模型算出来的长约 ${Math.round(((clipSize - 1) * (spawnShotGap ?? 0)) / 100) / 10}s`,
      );
    }
  } else {
    /*
     * **循环类**：先看武器级 `burstTiming`；它缺 `cooldown` 时（10 把）**再看序列里的节奏键**
     * —— 这条路的代表是沙暴导弹车：`burstTiming` 只有 `numToBurst = 1`，真正的节奏写在
     * `modifier_sequence.tuning` 里（`unit_gdi_sandstorm.lua:55-70`）：
     *
     * | 序列键 | 是什么 | 沙暴 |
     * | --- | --- | --- |
     * | `burstCooldown` / `durationBetweenVolley` | **一轮**（轮首到轮首） | 4000ms |
     * | `timePerMissile` / `delayAfterShot` | 一发与一发之间的间隔 | 200ms |
     * | `perTargetCount[N].missileCount` | 一轮发几发（**随交战队数变**） | 1 队 12 / 2 队 24 / 3 队 36 |
     * | `burstChargeUpDuration` / `initialChargeUpMs` | 前摇 | 0 |
     *
     * ⚠️ 序列里的时长是**毫秒**（`burstCooldown = 4000` 是 4 秒；`timePerMissile = 200`），
     * 与武器级 `burstTiming` 的**秒**不同 —— 这是两套单位，不能混（findings J-x）。
     */
    const seqCycle0 = num(seq["burstCooldown"]) ?? num(seq["durationBetweenVolley"]);
    /*
     * **具名 burst**：有的序列把节奏写在**子表**里，而且不止一套 —— 催化剂炮艇的 `gasWeapon`
     * （`unit_nod_catalystgunship.lua:44-53`）是两套：
     *
     * ```lua
     * catalystBurst = { initialChargeUpMs = 0,    cooldown = 1600 }   -- 催化剂弹 1.6s 一轮
     * gasBurst      = { initialChargeUpMs = 4500, cooldown = 6000 }   -- 毒气：蓄 4.5s、6s 一轮
     * ```
     *
     * ⇒ 挑哪一套？**先按名字跟武器槽对上**（`gasWeapon` ↔ `gasBurst`、`catalystWeapon` ↔ `catalystBurst`），
     * 对不上才退回"源码里先写的那一套"。剩下没选中的那几套记进 gap。
     *
     * ⚠️ **"先写的"要按 Lua 行号排，不能按表的键序** —— Lua 的字符串键表是**无序**的
     * （实测：提取出来的 `gasBurst` 排在 `catalystBurst` 前面，与源码相反）。
     */
    const lineOf = (key: string): number | undefined => {
      // ⚠️ 先找**单位文件**（burst 子表是在那儿定义的），再退回序列脚本（那儿只是引用）
      const inUnit = new AnchorTable(ctx.luaText).line(key);
      if (inUnit !== undefined) return inUnit;
      const impl = typeof sequence["name"] === "string" ? sequence["name"] : undefined;
      const text = impl === undefined ? "" : (ctx.modifierText?.(impl) ?? "");
      return text === "" ? undefined : new AnchorTable(text).line(key);
    };
    const namedBursts = Object.entries(seq)
      .filter(([k, v]) => /burst/i.test(k) && isRecord(v) && num(rec(v)["cooldown"]) !== undefined)
      .sort(([a], [b]) => (lineOf(a) ?? Number.MAX_SAFE_INTEGER) - (lineOf(b) ?? Number.MAX_SAFE_INTEGER));
    /** 武器槽名与 burst 名对得上吗（`gasWeapon` ↔ `gasBurst`：把 `Weapon` 去掉再比） */
    const burstMatchesWeapon = ([k]: [string, unknown]): boolean => {
      const stem = id.replace(/weapon/i, "").toLowerCase();
      return stem.length >= 3 && k.toLowerCase().replace(/burst/i, "").includes(stem);
    };
    const chosenBurst = namedBursts.find(burstMatchesWeapon) ?? namedBursts[0];
    /**
     * **充能型**（`gasWeapon` 这一种）：选中的具名 burst 自带 `initialChargeUpMs > 0`
     * ⇒ 那是**开火前的充能**，不是"周期内的前摇" ⇒ 落到 `initialChargeUpMs`（第一次开火前付一次）。
     *
     * ⚠️ **"按名字对上"不是我猜的，是源码自己写的**（所以它算转换、不算启发式）：
     * `modifier_catalystgunship_gas_weapon.lua:4-6` 直接
     * `GetWeaponSequenceTuning(unit_nod_catalystgunship, 1).gasBurst.initialChargeUpMs` ——
     * 那个 modifier 的**名字**（`..._gas_weapon`）与它读的 burst（`gasBurst`）是绑定的。
     * 同理 `...catalyst...` 一侧读 `catalystBurst`（`ability_catalyst_chemical_weapon_sequence.lua:10,47`）。
     *
     * ⚠️ **优先级**：选了具名 burst 就以 **burst 自己的**充能时长为准 —— 序列顶层那个
     * `initialChargeUpMs = 0`（`:54`）管的是别的事，不能让 0 把 4500 盖掉（踩过一次）。
     *
     * 依据：`modifier_catalystgunship_gas_weapon.lua:6-9`（`SetChargeDuration`）与 `:12-24`
     * （每帧按 `chargeTimeLostRate` 回退充能、驱动 UI 充能条）；序列
     * `ability_catalyst_chemical_weapon_sequence.lua:141-150` 把首发定成
     * `min(充能, max(冷却结束, gasBurst.initialChargeUpMs))`。
     */
    const burstCharge = chosenBurst === undefined ? undefined : num(rec(chosenBurst[1])["initialChargeUpMs"]);
    const chargedBurst = burstCharge !== undefined && burstCharge > 0;
    const seqCycle = seqCycle0 ?? (chosenBurst === undefined ? undefined : num(rec(chosenBurst[1])["cooldown"]));
    const seqCharge = chargedBurst
      ? burstCharge
      : (num(seq["burstChargeUpDuration"]) ?? num(seq["initialChargeUpMs"]) ?? burstCharge);
    const seqInterval = num(seq["timePerMissile"]) ?? num(seq["delayAfterShot"]);
    const perTarget = rec(seq["perTargetCount"]);
    const perTargetKeys = Object.keys(perTarget).sort((a, b) => Number(a) - Number(b));
    const muzzleCount = num(t["muzzleCount"]) ?? 1;
    /*
     * **一轮发数**的四个来源，按可信度排：
     * ① `missileCount`（序列自己写着几发）
     * ② `perTargetCount[N].missileCount`（沙暴：随交战队数变，取第 1 档）
     * ③ `numToBurst`（武器级），但 ⚠️ **它常是默认值 1**
     *
     * ⚠️ **不再猜"每发一个枪口"**：巨无霸 / 科迪亚克那条路（`delayAfterShot`）真正的发数在
     * **视觉常量 `MUZZLE_INFO`** 里，配置读不到 ⇒ 记 gap，**由手写 patch 收尾**
     * （`core/src/units/patches.ts`，用户点的：一次性的事实别写成通用启发式）。
     */
    const seqHits =
      num(seq["missileCount"]) ??
      (perTargetKeys.length > 0 ? num(rec(perTarget[perTargetKeys[0]!])["missileCount"]) : undefined);

    const rawCooldown = num(burst["cooldown"]);
    const rawCharge = num(burst["chargeUpDuration"]);
    const rawHits = num(burst["numToBurst"]);
    const rawRate = num(burst["fireRate"]);
    /*
     * ⚠️ **隔壁槽序列里的具名 burst 优先于本槽武器级的 `burstTiming.cooldown`**（催化剂炮艇，见
     * {@link siblingBurstFor}）：真正开火的是那个序列，武器级那个数是引擎默认路径的值、**不是真值**。
     */
    const siblingCycle = sibling?.cooldownMs;
    const fromSequence = siblingCycle !== undefined || (rawCooldown === undefined && seqCycle !== undefined);
    const implName = typeof sequence["name"] === "string" ? sequence["name"] : undefined;
    const seqText = implName === undefined ? "" : (ctx.modifierText?.(implName) ?? "");
    const seqAt = new AnchorTable(seqText);

    timing = {
      kind: "cyclic",
      cooldownMs: siblingCycle ?? (rawCooldown !== undefined ? rawCooldown * 1000 : (seqCycle ?? 0)),
      // 充能型：那条充能是"第一次开火之前"的一次性等待，不是每轮里的前摇
      chargeUpMs: chargedBurst ? 0 : rawCharge !== undefined ? rawCharge * 1000 : (seqCharge ?? 0),
      initialChargeUpMs: chargedBurst ? (seqCharge ?? 0) : 0,
      // 从序列来的节奏，**序列的发数优先**（武器级那个 `numToBurst = 1` 是默认值，不是结论）
      hits: Math.max(1, fromSequence ? (seqHits ?? rawHits ?? 1) : (rawHits ?? 1)),
      intervalMs: rawRate !== undefined && !fromSequence ? rawRate * 1000 : (seqInterval ?? (rawRate === undefined ? 0 : rawRate * 1000)),
      ...(fromSequence && implName !== undefined ? { impl: implName } : {}),
    };
    if (sibling !== undefined) {
      /*
       * **借了隔壁槽的序列**：锚点必须写清"这个数是从哪儿来的"，否则以后没人看得出
       * 为什么产物里的 `cooldownMs` 与**本槽**的 `burstTiming.cooldown` 不一样。
       */
      const burstLine = at.line(sibling.burst);
      anchors.push(
        `${id}.timing ← **隔壁槽 \`${sibling.fromWeapon}\` 的序列**里的 \`${sibling.burst}\`：一轮 ${sibling.cooldownMs}ms` +
          `${burstLine === undefined ? "" : `（本文件 :${burstLine}）`}` +
          `；⚠️ 本槽自己的 \`burstTiming.cooldown = ${rawCooldown ?? "?"}\` **不是真值**` +
          `（真正开火的是那个序列：\`ability_catalyst_chemical_weapon_sequence.lua:95-96\` 用 \`${sibling.burst}.cooldown\` 排班）`,
      );
    } else if (fromSequence) {
      const cycleLine = seqAt.line(seq["burstCooldown"] !== undefined ? "burstCooldown" : "durationBetweenVolley", seqCycle);
      anchors.push(
        `${id}.timing ← 序列 \`${implName ?? "?"}\`：一轮 ${seqCycle}ms` +
          `${seqInterval === undefined ? "" : ` · 每发间隔 ${seqInterval}ms`}` +
          `${seqHits === undefined ? "" : ` · 每轮 ${seqHits} 发`}` +
          `${cycleLine === undefined ? "" : `（${implName}.lua:${cycleLine}）`}`,
      );
      if (namedBursts.length > 1) {
        const chosen = chosenBurst?.[0] ?? "?";
        const table = namedBursts
          .map(([k, v]) => {
            const b = rec(v);
            return `${k === chosen ? "**" : ""}\`${k}\` ${num(b["cooldown"])}ms（蓄 ${num(b["initialChargeUpMs"]) ?? 0}ms）${k === chosen ? "**" : ""}`;
          })
          .join(" / ");
        gaps.push(
          `${id}：这个槽的序列有 **${namedBursts.length} 套节奏**（${table}）—— 模型只有一种，` +
            `按"名字跟武器槽对上"取了 \`${chosen}\`` +
            (chargedBurst ? `；⚠️ 它的充能**不攻击时会回退**（\`fullChargeLostMs\`），模型没有这个形状` : ""),
        );
      } else if (chargedBurst) {
        gaps.push(
          `${id}：**充能型**（第一次开火前充能 ${seqCharge}ms）—— ⚠️ 源码里充能**停止攻击会回退**` +
            `（\`chargeTimeLostRate = 充能 ÷ fullChargeLostMs\`），模型没有这个形状`,
        );
      }
      if (perTargetKeys.length > 1) {        const table = perTargetKeys
          .map((k) => {
            const e = rec(perTarget[k]);
            return `${k} 队 ${num(e["missileCount"]) ?? "?"} 发 ×${num(e["timePerMissile"]) ?? "?"}ms`;
          })
          .join(" / ");
        gaps.push(
          `${id}：**一发一轮的发数与间隔随交战队数变**（${table}）—— 模型只有一个 \`hits\`/\`intervalMs\`，` +
            `这里填的是第 1 档（${seqHits} 发 ×${seqInterval}ms）`,
        );
      }
      if (seqHits === undefined) {
        gaps.push(
          `${id}：一轮发数读不到 —— 它在单位的 **视觉块** \`${id}_visual.MUZZLE_INFO\` 里` +
            `（例如 \`unit_gdi_kodiak.lua:89-93\` 有 3 个枪口），而提取器**还没收 \`*_visual\` 那些全局表**` +
            `⇒ 这里 \`hits\` 按 1 占位。**这是机器侧的缺口，不是"要人手填的事实"**`,
        );
      }
    } else {
      if (rawCooldown === undefined) gaps.push(`${id}：没有 \`burstTiming.cooldown\`，序列里也没有节奏键 ⇒ 周期按 0（这台机器要人看）`);
      else at.anchor(anchors, gaps, `${id}.timing.cooldownMs`, "cooldown", rawCooldown);
      if (rawCharge !== undefined) at.anchor(anchors, gaps, `${id}.timing.chargeUpMs`, "chargeUpDuration", rawCharge);
      if (rawHits !== undefined && rawHits > 1) at.anchor(anchors, gaps, `${id}.timing.hits`, "numToBurst", rawHits);
      if (rawRate !== undefined) at.anchor(anchors, gaps, `${id}.timing.intervalMs`, "fireRate", rawRate);
    }
    if (num(burst["chargeUpLockOnTime"]) !== undefined) {
      gaps.push(`${id}：有 \`chargeUpLockOnTime\`（锁定期亚相位）—— 没建模`);
    }
  }

  // ② 伤害（非分段）：武器级优先，其次序列/弹体（与 `types.ts` 的 `effectiveDamage` 同序）
  if (timing.kind !== "staged") {
    const own = damageOf(t["damageTuning"]);
    if (own !== undefined) {
      damage = [{ main: own }];
      at.anchor(anchors, gaps, `${id}.damage.main`, "damageTuning");
    } else {
      const stage1 = damageOf(rec(seq["stage1"])["damageMain"]) ?? damageOf(seq["damageMain"]) ?? damageOf(seq["damage"]);
      const shot = damageOf(rec(rec(t["modifier_shot"])["tuning"])["damage"]);
      const projTuning = rec(rec(t["projectile"])["modifier"])["tuning"];
      const proj = damageOf(rec(projTuning)["damage"]) ?? damageOf(rec(projTuning)["damage1"]);
      const alt = stage1 ?? shot ?? proj;
      const where = stage1 !== undefined ? "modifier_sequence" : shot !== undefined ? "modifier_shot" : "projectile.modifier";
      if (alt === undefined) {
        gaps.push(`${id}：找不到任何伤害表（\`damageTuning\` / 序列 / 弹体都没有）`);
      } else {
        damage = [{ main: alt }];
        anchors.push(`${id}.damage.main ← \`${where}\`（不在武器级 \`damageTuning\`）`);
        gaps.push(`${id}：伤害转自 \`${where}\`（按 \`effectiveDamage\` 的优先级）—— **要人核一眼**`);
      }
    }
    /*
     * **序列里的副伤**：非分段武器也可能带 `damageSide`（火焰坦克的**楔形**副伤就是这条）。
     * ⚠️ 命中"几个"副目标写在 ability 脚本里（`nSquadUtil.GetSquadsInHexWedge` 之类）——
     * 读不到就只填伤害、把挑法记进 gap。
     */
    const seqSide = damageOf(seq["damageSide"]);
    if (seqSide !== undefined && damage[0] !== undefined) {
      damage[0].side = seqSide;
      const cnt = num(seq["sideTargetCount"]) ?? num(seq["perTargetCount"]);
      if (cnt !== undefined) damage[0].sideTargetCount = cnt;
      const sideLine = at.line("damageSide");
      anchors.push(
        `${id}.damage[0].side ← 序列 \`damageSide\`${sideLine === undefined ? "" : `（本文件 :${sideLine}）`}` +
          `：${seqSide.base}（${seqSide.overrides?.map(([k, v]) => `${k} ${v}`).join(" / ") ?? "无覆写"}）`,
      );
      gaps.push(`${id}：副伤有了，但**挑几个/什么形状**（楔形 / 环 / 线）在 ability 脚本里 ⇒ \`splash\` 空着`);
    }
  }

  // ③ 命中之后做什么（弹头）—— 逐处挂件分类转换，读不出来的记 gap
  const hitHooks: Array<[string, Record<string, unknown>]> = [];
  if (isRecord(rec(t["projectile"])["modifier"])) hitHooks.push(["projectile.modifier", rec(rec(t["projectile"])["modifier"])]);
  if (isRecord(t["modifier_shot"])) hitHooks.push(["modifier_shot", rec(t["modifier_shot"])]);
  if (isRecord(t["modifier_spawn"])) hitHooks.push(["modifier_spawn", rec(t["modifier_spawn"])]);
  const warhead: WarheadEffectDef[] = [];
  for (const [where, mod] of hitHooks) {
    const name = typeof mod["name"] === "string" ? mod["name"] : "?";
    const modText = ctx.modifierText?.(name) ?? "";
    if (modText === "") {
      gaps.push(`${id} 弹头：挂件 \`${name}\`（${where}）的 Lua 读不到 ⇒ 只从 tuning 判`);
    }
    warhead.push(
      ...warheadFor(
        where,
        mod,
        modText,
        ctx.auras ?? {},
        anchors,
        gaps,
        id,
        `gameplay/modifiers/${name}.lua`,
        ctx.luaText,
        ctx.tunings ?? {},
      ),
    );
    const hookLine = at.line(where.startsWith("projectile") ? "modifier" : where);
    anchors.push(`${id}.warhead ← ${where} = \`${name}\`${hookLine === undefined ? "" : `（本文件 :${hookLine}）`}`);
  }

  /*
   * **武器序列自己也能铺格子效果**（毒气就是这么来的，不是命中挂件）：
   * `unit_nod_chemicalwarrior.lua:45-46` 的 `spawnGasTimeMs = 750` + `gasCloudModifierId`，
   * 由 `ability_chemical_weapon_sequence.lua:92-101` 在开火过程中
   * `RequestModifier(tile, …)` 铺上去，之后每发 `ResetPersistTime()` 续时。
   */
  const gasCloudId = seq["gasCloudModifierId"];
  if (typeof gasCloudId === "string") {
    const gasEffect = tileEffectFromAura(gasCloudId, ctx.auras ?? {});
    const spawnMs = num(seq["spawnGasTimeMs"]);
    /*
     * ⚠️ **`spawnGasTimeMs` 不是"铺得慢"，是"要连续开打这么久才铺得出"**
     * （生化战士 750ms、**生化越野车 2100ms**）—— 它落在 `TileEffectDef.spawnDelayMs`
     * 这个字段上（源码里就写着这个语义，不是我们发明的）。
     */
    const effect: TileEffectDef = {
      ...(gasEffect ?? { tickMs: 0, tickDamage: 0, persistMs: 0, groundOnly: true }),
      ...(spawnMs === undefined ? {} : { spawnDelayMs: spawnMs }),
    };
    warhead.push({ kind: "place_modifier", name: gasCloudId, effect });
    warhead.push({ kind: "refresh_modifier", name: gasCloudId });
    const gasLine = at.line("gasCloudModifierId", gasCloudId);
    anchors.push(
      `弹头 ← 武器序列：${spawnMs === undefined ? "" : `**连续开打 ${spawnMs}ms 后**`}铺 \`${gasCloudId}\`` +
        `${gasLine === undefined ? "" : `（本文件 :${gasLine}）`}` +
        `，之后每发续时（\`ability_chemical_weapon_sequence.lua:92-101\`）` +
        (gasEffect === undefined ? "" : `（每 ${gasEffect.tickMs}ms 一跳、每跳 ${gasEffect.tickDamage}、持续 ${gasEffect.persistMs}ms）`),
    );
    if (spawnMs !== undefined) at.anchor(anchors, gaps, `${id}.warhead 的铺气门槛`, "spawnGasTimeMs", spawnMs);
    if (gasEffect === undefined) {
      gaps.push(`${id} 弹头：序列铺的 \`${gasCloudId}\` 没在 auras 表里 ⇒ 格子数值按 0`);
    }
  }

  // ④ 用法
  const targetingRaw = rec(t["targetingTuning"]);
  const mode = targetingRaw["targetMode"];
  // ⚠️ 显式标注：`mode` 来自 `Record<string, unknown>`，不标注会被推宽成 `string`
  const targeting: TargetingDef | undefined =
    mode === "kCenter" || mode === "kRandom" || mode === "kDirect"
      ? {
          mode,
          ...(num(targetingRaw["centerSpread"]) === undefined ? {} : { centerSpread: num(targetingRaw["centerSpread"])! }),
          ...(num(targetingRaw["randomBurstMin"]) === undefined ? {} : { randomBurstMin: num(targetingRaw["randomBurstMin"])! }),
          ...(num(targetingRaw["randomBurstMax"]) === undefined ? {} : { randomBurstMax: num(targetingRaw["randomBurstMax"])! }),
        }
      : undefined;
  const flags = {
    ...(flag("canShootWhileMoving") === undefined ? {} : { canShootWhileMoving: flag("canShootWhileMoving")! }),
    ...(flag("canInterruptIntro") === undefined ? {} : { canInterruptIntro: flag("canInterruptIntro")! }),
    ...(flag("canShootOverWalls") === undefined ? {} : { canShootOverWalls: flag("canShootOverWalls")! }),
    ...(flag("disableSpawnGrace") === undefined ? {} : { disableSpawnGrace: flag("disableSpawnGrace")! }),
    ...(flag("onlyFireWhenPrimary") === undefined ? {} : { onlyFireWhenPrimary: flag("onlyFireWhenPrimary")! }),
    ...(flag("faceTargetBeforePackup") === undefined ? {} : { faceTargetBeforePackup: flag("faceTargetBeforePackup")! }),
    ...(flag("ignoreFacing") === undefined ? {} : { ignoreFacing: flag("ignoreFacing")! }),
    ...(flag("useAlternateAirTarget") === undefined ? {} : { useAlternateAirTarget: flag("useAlternateAirTarget")! }),
    ...(num(t["priority"]) === undefined ? {} : { priority: num(t["priority"])! }),
    ...(num(t["minIdleTimeBeforeUnpack"]) === undefined ? {} : { minIdleTimeBeforeUnpack: num(t["minIdleTimeBeforeUnpack"])! }),
  };
  const muzzleCount = num(t["muzzleCount"]) ?? 1;
  const canAttack = TARGETS.filter((target) => canAttackTarget(w, target));
  const rawStrategy = t["muzzleStrategy"];
  const usage: WeaponUsage = {
    canAttack,
    muzzleCount,
    ...(rawStrategy === "All" || rawStrategy === "RoundRobin" ? { muzzleStrategy: rawStrategy } : {}),
    ...(targeting === undefined ? {} : { targeting }),
    flags,
  };
  if (canAttack.length === 0) gaps.push(`${id}：\`descriptors\` 推不出能打谁（索敌未知）`);
  else at.anchor(anchors, gaps, `${id}.usage.canAttack`, "descriptors");
  if (num(t["muzzleCount"]) !== undefined) at.anchor(anchors, gaps, `${id}.usage.muzzleCount`, "muzzleCount", muzzleCount);
  if (targeting !== undefined) at.anchor(anchors, gaps, `${id}.usage.targeting`, "targetingTuning");
  if (usage.muzzleStrategy !== undefined) at.anchor(anchors, gaps, `${id}.usage.muzzleStrategy`, "muzzleStrategy");
  for (const key of ["canShootWhileMoving", "canInterruptIntro", "canShootOverWalls", "onlyFireWhenPrimary"] as const) {
    if (flags[key] !== undefined) at.anchor(anchors, gaps, `${id}.usage.flags.${key}`, key);
  }

  // ⑤ 飞行时间：只在"距离无关"时才敢写（min == max）
  const proj = rec(t["projectile"]);
  let flightMs: number | undefined;
  if (proj["calculateSpeedFromTimeToHit"] === true) {
    const lo = sec(proj["minRangeTimeToHit"]);
    const hi = sec(proj["maxRangeTimeToHit"]);
    if (lo !== undefined && hi !== undefined && Math.abs(lo - hi) < 1e-9) {
      flightMs = lo;
      at.anchor(anchors, gaps, `${id}.flightMs`, "minRangeTimeToHit", num(proj["minRangeTimeToHit"])!);
    } else {
      gaps.push(`${id}：\`calculateSpeedFromTimeToHit\` 但 min/max 不同（${lo} / ${hi} ms）⇒ \`flightMs\` 空着（距离相关，J45）`);
    }
  }

  // ⑥ 部署（可能挂在这个槽上；**归单位**）
  let deploy: DeployParams | undefined;
  if (isRecord(t["modifier_intro"])) {
    const intro = rec(rec(t["modifier_intro"])["tuning"]);
    const outro = rec(rec(t["modifier_outro"])["tuning"]);
    const unpackMs = num(intro["durationMs"]);
    /*
     * "收"的时长可能在**别的 behaviour 里硬编码**（圣甲虫用的是 `modifier_core_outro`，
     * 它的 Lua 里写着 `settings.durationms = 0`）—— 从**原文**认出是哪个 behaviour 再取值。
     */
    let packMs = num(outro["durationMs"]);
    let packAnchor: string | undefined;
    if (packMs === undefined && isRecord(t["modifier_outro"])) {
      const found = behavioursIn(ctx.luaText).filter((b) => BEHAVIOUR_DURATION_MS[b] !== undefined);
      const uniq = [...new Set(found)];
      if (uniq.length === 1) {
        const known = BEHAVIOUR_DURATION_MS[uniq[0]!]!;
        packMs = known.ms;
        packAnchor = `deploy.packMs ← ${known.anchor}（\`tuning\` 是空的，时长写死在 behaviour 里）`;
      } else if (uniq.length > 1) {
        gaps.push(`${id}：\`modifier_outro\` 没有 \`tuning\`，文件里有多个候选 behaviour（${uniq.join(" / ")}）⇒ 收的时长没定`);
      } else {
        gaps.push(`${id}：\`modifier_outro\` 没有 \`tuning\`，也不认识它的 behaviour ⇒ 收的时长没定`);
      }
    }
    if (unpackMs === undefined || packMs === undefined) {
      gaps.push(`${id}：有 \`modifier_intro\` 但架/收的 \`durationMs\` 凑不齐 ⇒ \`deploy\` 没建`);
    } else {
      const pct = num(intro["damageReductionPercent"]);
      const shieldOn = num(intro["DAMAGE_REDUCTION_TIME_MS"]);
      const shieldOff = num(outro["DAMAGE_REDUCTION_TIME_MS"]);
      const deployAnchors = [`部署挂件在这个槽的 \`modifier_intro/outro\` 上 —— ⚠️ **归单位**，不归武器`];
      if (packAnchor !== undefined) deployAnchors.push(packAnchor);
      at.anchor(deployAnchors, gaps, "deploy.unpackMs", "modifier_intro");
      if (pct !== undefined) at.anchor(deployAnchors, gaps, "deploy.shield.percent", "damageReductionPercent", pct);
      deploy = {
        unpackMs,
        packMs,
        ...(bool(t["canInterruptIntro"]) === undefined ? {} : { canInterruptIntro: bool(t["canInterruptIntro"])! }),
        ...(pct === undefined || shieldOn === undefined || shieldOff === undefined
          ? {}
          : { shield: { percent: pct, unpackAfterMs: shieldOn, packAfterMs: shieldOff } }),
        source: { script: src.source, anchors: deployAnchors },
      };
      if (pct !== undefined && (shieldOn === undefined || shieldOff === undefined)) {
        gaps.push(`${id}：有 \`damageReductionPercent\` 但缺 \`DAMAGE_REDUCTION_TIME_MS\` ⇒ 减伤窗口没建`);
      }
    }
  }

  /*
   * ⑦ **自杀式**：开火序列结束时把使用者销毁。
   *
   * 判据是那句调用本身：`TakeHiddenDestroyDamage()` —— 全库只有两处，
   * 武器侧只有圣甲虫（`ability_scarab_weapon_sequence.lua:51`；
   * 另一处是钻地舱的 intro：`modifier_drillpod_intro.lua:74`，那是"生成完就消失"，不是武器）。
   */
  let selfDestruct = false;
  for (const implName of [sequence["name"], rec(t["modifier_spawn"])["name"]]) {
    if (typeof implName !== "string") continue;
    const text = ctx.modifierText?.(implName) ?? "";
    // ⚠️ 用 `callLine` 而不是 `line` —— 自毁是**调用**（`self:Foo()`），不是赋值
    const line = new AnchorTable(text).callLine("TakeHiddenDestroyDamage");
    if (line === undefined) continue;
    selfDestruct = true;
    anchors.push(
      `${id}.selfDestruct = true ← \`${implName}.lua:${line}\` 的 \`TakeHiddenDestroyDamage()\`` +
        `（打完这一轮就自爆：**没有第二轮**，不吃减伤、不溅射）`,
    );
  }

  return {
    def: {
      id,
      timing,
      damage,
      ...(warhead.length === 0 ? {} : { warhead }),
      ...(flightMs === undefined ? {} : { flightMs }),
      ...(selfDestruct ? { selfDestruct: true } : {}),
      usage,
      source: { script: src.source, anchors },
    },
    gaps,
    ...(deploy === undefined ? {} : { deploy }),
    shootWhileMoving: flag("canShootWhileMoving") === true,
  };
}

// ─────────────────────────────────────────────────────────────
// 单位
// ─────────────────────────────────────────────────────────────

/** 把一条提取记录转成我们的 `UnitDef`（机械部分）+ 没转出来的东西 */
export function convertUnit(src: EntityRecord, luaText: string, ctx: Omit<ConvertContext, "luaText"> = {}): { def: UnitDef; gaps: string[] } {
  const at = new AnchorTable(luaText);
  const gaps: string[] = [];
  const anchors: string[] = [];
  const cfg = rec(src.config);
  const ct = rec(cfg["combatantTuning"]);
  const st = rec(cfg["squadTuning"]);
  const cs = rec(cfg["combatStoreTuning"]);

  const weaponTunings = (Array.isArray(ct["weaponTunings"]) ? ct["weaponTunings"] : []) as WeaponTuning[];
  // 顶层 `<X>Tuning`（`ionCannonTuning` / `tiberiumExplosionTuning` 之类）—— 先算出来，
  // 因为**弹头里被请求的那些 ability 的调参**住在这儿（催化爆炸的伤害表就是它）
  const tunings = Object.fromEntries(
    Object.entries(cfg).filter(
      ([k, v]) =>
        /Tuning$/.test(k) &&
        k !== "combatantTuning" &&
        k !== "squadTuning" &&
        k !== "combatStoreTuning" &&
        isRecord(v),
    ),
  ) as Record<string, Record<string, unknown>>;
  const ctxFull: ConvertContext = { ...ctx, luaText, tunings };
  // 每个槽都去**别的槽**的序列里找一眼同名具名 burst（本槽自己有条序列时不会借）
  const parts = weaponTunings.map((w, i) =>
    convertWeapon(
      w,
      i,
      src,
      at,
      ctxFull,
      siblingBurstFor(
        w,
        weaponTunings.filter((_, k) => k !== i),
      ),
    ),
  );
  for (const p of parts) {
    gaps.push(...p.gaps);
    anchors.push(...p.def.source.anchors);
  }

  // 部署归单位：任意槽上的 intro 都算这个单位的（壁虱挂在 `hidden` 槽）
  const deployPart = parts.find((p) => p.deploy !== undefined);
  let deploy = deployPart?.deploy;
  if (deploy !== undefined) {
    const shootWhileMoving = parts.some((p) => p.shootWhileMoving);
    deploy = {
      ...deploy,
      mustDeployToFire: !shootWhileMoving,
      source: {
        ...deploy.source,
        anchors: [
          ...(deploy.source?.anchors ?? []),
          shootWhileMoving
            ? "`mustDeployToFire = false` ← 该单位有 `canShootWhileMoving`（收着也能打）"
            : "`mustDeployToFire = true` ← 有 intro 且没有 `canShootWhileMoving`",
        ],
      },
    };
  }

  /** 必填标量：缺了就按默认值并记 gap（模型的这些字段是必填） */
  const scalar = (label: string, key: string, value: number | undefined, dflt: number): number => {
    if (value === undefined) {
      gaps.push(`${label}：源码没有 \`${key}\` ⇒ 按 ${dflt}（模型这个字段必填）`);
      return dflt;
    }
    at.anchor(anchors, gaps, label, key, value);
    return value;
  };

  const health = scalar("combatant.health", "health", num(ct["health"]), 0);
  const angularSpeed = scalar("combatant.angularSpeed", "angularSpeed", num(ct["angularSpeed"]), 0);
  const avoidanceRadius = scalar("combatant.avoidanceRadius", "avoidanceRadius", num(ct["avoidanceRadius"]), 0);
  const tiberiumCost = scalar("store.tiberiumCost", "tiberiumCost", num(cs["tiberiumCost"]), 0);
  const waveSize = scalar("squad.waveSize", "waveSize", num(st["waveSize"]), 1);
  const visionRangeInTiles = scalar("squad.visionRangeInTiles", "visionRangeInTiles", num(st["visionRangeInTiles"]), 0);

  const speed = num(ct["speed"]);
  const aggro = num(ct["aggroRadiusInTiles"]);
  const maxRange = num(st["maxAttackRangeInTiles"]);
  const separation = num(st["attackSeparationDurationMS"]);
  if (speed !== undefined) at.anchor(anchors, gaps, "combatant.speed", "speed", speed);
  if (aggro !== undefined) at.anchor(anchors, gaps, "combatant.aggroRadiusInTiles", "aggroRadiusInTiles", aggro);
  if (maxRange !== undefined) at.anchor(anchors, gaps, "squad.maxAttackRangeInTiles", "maxAttackRangeInTiles", maxRange);
  if (separation !== undefined) at.anchor(anchors, gaps, "squad.attackSeparationDurationMS", "attackSeparationDurationMS", separation);
  at.anchor(anchors, gaps, "combatant.descriptors", "descriptors");
  at.anchor(anchors, gaps, "combatant.tags", "tags");
  at.anchor(anchors, gaps, "combatant.goodAgainstTags", "goodAgainstTags");

  const def: UnitDef = {
    id: src.id,
    name: src.id,
    combatant: {
      health,
      tags: Array.isArray(ct["tags"]) ? (ct["tags"] as string[]) : [],
      descriptors: Array.isArray(ct["descriptors"]) ? (ct["descriptors"] as number[]) : [],
      ...(speed === undefined ? {} : { speed }),
      angularSpeed,
      avoidanceRadius,
      ...(aggro === undefined ? {} : { aggroRadiusInTiles: aggro }),
      goodAgainstTags: Array.isArray(ct["goodAgainstTags"]) ? (ct["goodAgainstTags"] as string[]) : [],
      ...(num(ct["flyingHeight"]) === undefined ? {} : { flyingHeight: num(ct["flyingHeight"])! }),
      ...(num(ct["minFlyingHeight"]) === undefined ? {} : { minFlyingHeight: num(ct["minFlyingHeight"])! }),
      ...(num(ct["healthBarWidthOverride"]) === undefined ? {} : { healthBarWidthOverride: num(ct["healthBarWidthOverride"])! }),
      ...(num(ct["maxSimultaneousTargets"]) === undefined ? {} : { maxSimultaneousTargets: num(ct["maxSimultaneousTargets"])! }),
      weapons: parts.map((p) => p.def),
    },
    squad: {
      waveSize,
      ...(maxRange === undefined ? {} : { maxAttackRangeInTiles: maxRange }),
      visionRangeInTiles,
      ...(num(st["accelerationDistance"]) === undefined ? {} : { accelerationDistance: num(st["accelerationDistance"])! }),
      ...(num(st["decelerationDistance"]) === undefined ? {} : { decelerationDistance: num(st["decelerationDistance"])! }),
      ...(num(st["hexReservationRadius"]) === undefined ? {} : { hexReservationRadius: num(st["hexReservationRadius"])! }),
      ...(separation === undefined ? {} : { attackSeparationDurationMS: separation }),
      ...(bool(st["canBeCrushed"]) === undefined ? {} : { canBeCrushed: bool(st["canBeCrushed"])! }),
      ...(num(st["stealthDetectionRangeInTiles"]) === undefined ? {} : { stealthDetectionRangeInTiles: num(st["stealthDetectionRangeInTiles"])! }),
      ...(num(st["priority"]) === undefined ? {} : { priority: num(st["priority"])! }),
      ...(num(st["killAwardTiberium"]) === undefined ? {} : { killAwardTiberium: num(st["killAwardTiberium"])! }),
      ...(num(st["repurchaseDiscountFlat"]) === undefined ? {} : { repurchaseDiscountFlat: num(st["repurchaseDiscountFlat"])! }),
    },
    store: {
      tiberiumCost,
      ...(bool(cs["useGlobalCooldown"]) === undefined ? {} : { useGlobalCooldown: bool(cs["useGlobalCooldown"])! }),
      ...(num(cs["purchaseCooldownMS"]) === undefined ? {} : { purchaseCooldownMS: num(cs["purchaseCooldownMS"])! }),
      ...(num(cs["startCooldownMS"]) === undefined ? {} : { startCooldownMS: num(cs["startCooldownMS"])! }),
      ...(bool(cs["addIncreaseCountOnPurchase"]) === undefined ? {} : { addIncreaseCountOnPurchase: bool(cs["addIncreaseCountOnPurchase"])! }),
      ...(bool(cs["subtractIncreaseCountOnDeath"]) === undefined ? {} : { subtractIncreaseCountOnDeath: bool(cs["subtractIncreaseCountOnDeath"])! }),
      ...(bool(cs["addDecreaseCountOnPurchase"]) === undefined ? {} : { addDecreaseCountOnPurchase: bool(cs["addDecreaseCountOnPurchase"])! }),
    },
    ...(deploy === undefined ? {} : { deploy }),
    modifiers: {
      ...(isRecord(ct["modifier_spawn"]) ? { spawn: ct["modifier_spawn"] } : {}),
      ...(isRecord(ct["modifier_death"]) ? { death: ct["modifier_death"] } : {}),
      ...(isRecord(st["modifier_spawn"]) ? { squadSpawn: st["modifier_spawn"] } : {}),
    },
    // 顶层 `<X>Tuning`（`ionCannonTuning` 之类**属于 ability 的参数**）：原样留引用
    tunings: Object.fromEntries(
      Object.entries(cfg).filter(
        ([k, v]) =>
          /Tuning$/.test(k) &&
          k !== "combatantTuning" &&
          k !== "squadTuning" &&
          k !== "combatStoreTuning" &&
          isRecord(v),
      ),
    ) as Record<string, Record<string, unknown>>,
    source: { script: src.source, anchors: [...new Set(anchors)] },
  };

  if (parts.length === 0) gaps.push("没有武器（建筑 / 采集车 / 指挥官）—— 只有属性与部署");
  return { def, gaps: [...new Set(gaps)] };
}
