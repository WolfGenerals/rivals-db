/**
 * **单位 def 的 JSON 形态（编码 / 解码）** —— 让我们的 def 能进 `data/` 被网页读。
 *
 * ## 为什么需要这一层
 *
 * `UnitDef` 里混了**类实例**：`Damage` 是个 class，`against(target)` 是**方法**
 * （`unit-def.ts:97`）。JSON 存不下方法 ⇒ 直接 `JSON.stringify(def)` 出去的产物
 * 解回来就**不会算伤害**了（`damage.against("Vehicle")` 直接 `TypeError`）。
 *
 * 所以产物里存的是**纯数据形态**（`DamageJson` = `{base, overrides}`），
 * 读回来时由 {@link decodeDef} **补回 `Damage` 实例**。这也是网页侧唯一的解码动作。
 *
 * ## 边界
 *
 * - **只有 `Damage` 需要补**：`WarheadDef` / `SplashDef` / `Timing` / `usage` / `deploy`
 *   本来就是纯数据（`warhead-def.ts` 顶部就写着"弹头是数据"）。
 * - **不转换语义、不做兼容**：形状一改就改这里，产物跟着重生成（`rivals emit-defs`）。
 * - **`source.anchors` 一起进产物**（J52：没有锚点的数不可信，产物里也得带着）。
 */

import { Damage } from "./unit-def.ts";
import type { CombatantBase, Override, UnitDef } from "./unit-def.ts";
import type { WeaponDamage, WeaponDef } from "./weapon-def.ts";
import type { WarheadDef, WarheadEffectDef } from "./warhead-def.ts";

/** 解码后的类型就是 `UnitDef` —— 转出去给消费方（网页/模拟器）用，省得各自引子路径 */
export type { UnitDef } from "./unit-def.ts";

/** `Damage` 的纯数据形态 */
export interface DamageJson {
  base: number;
  /** ⚠️ **没写就是不出现**（与模型同规矩，见 findings J54） */
  overrides?: Array<[Override, number]>;
}

/** 一项伤害的纯数据形态（分段武器每段一项） */
export interface WeaponDamageJson {
  main: DamageJson;
  side?: DamageJson;
  sideTargetCount?: number;
}

/** 弹头效果里带伤害的那条（催化爆炸）—— 把 `Damage` 换成纯数据形态 */
type WithJsonDamage<T> = T extends { damage?: unknown } ? Omit<T, "damage"> & { damage?: DamageJson } : T;

/** 弹头效果的纯数据形态（与 `WarheadEffectDef` 同构，只是伤害是纯数据） */
export type WarheadEffectDefJson = WithJsonDamage<WarheadEffectDef>;

/** 弹头的纯数据形态 */
export type WarheadDefJson = WarheadEffectDefJson[];

/** 武器的纯数据形态（`damage` 与 `warhead` 里的伤害都是纯数据） */
export type WeaponDefJson = Omit<WeaponDef, "damage" | "warhead"> & {
  damage: WeaponDamageJson[];
  warhead?: WarheadDefJson;
};

/** 单位的纯数据形态 */
export type UnitDefJson = Omit<UnitDef, "combatant"> & {
  combatant: Omit<CombatantBase, "weapons"> & { weapons: WeaponDefJson[] };
};

/** 一份 def 产物文件（`data/units.def.json`） */
export interface DefFileJson {
  /** 说明（读的时候忽略） */
  _note?: string;
  /** 形状版本 —— 与 `derive.ts` 的 `_schema` 同一个作用 */
  _schema: number;
  /** `id` → **完整单位记录**（单位 + 指挥官都在这儿） */
  units: Record<string, UnitRecordJson>;
  /** 同上，指挥官（数据形状一致，分开放只是为了页面能分开列） */
  commanders?: Record<string, UnitRecordJson>;
}

// ─────────────────────────────────────────────────────────────
// 展示三件套（本地化 / 图标 / 稀有度）—— **新格式必须自己带着**
// ─────────────────────────────────────────────────────────────

/**
 * **本地化文案**（来源 `data/locale/*.json`，产物里已带这四项）。
 *
 * ⚠️ 这四项**曾经住在 `data/units.json` 的条目顶层**（旧形状）。新格式把它们收进来，
 * 否则"全切新格式"的那一刻页面就没有名字和描述了。
 */
export interface LocaleJson {
  name_zh?: string;
  name_en?: string;
  desc_zh?: string;
  desc_en?: string;
}

/**
 * **美术资源**（按 `data/` 实际盘点得来，不是猜的）。
 *
 * 图标路径本来能由 id 拼（`web/src/assets.ts` 的 `unitIconUrl`），但
 * **"有没有这张图"必须记下来** —— 否则页面只能靠 404 去发现缺失。
 */
export interface ArtJson {
  /** 卡面（`data/img/<id>.webp`）；**不出现 = 磁盘上没有这张图** */
  card?: string;
}

/**
 * **一条完整单位记录**（新格式的顶层单位形状）。
 *
 * | 块 | 装什么 | 谁负责填 |
 * | --- | --- | --- |
 * | 身份 | `id` / `faction` / `variant` / `suffixes` | 提取产物（现成） |
 * | `locale` | 中英文名与描述 | 提取产物（`data/locale/*`） |
 * | `pb` | 稀有度等 game-config.pb 字段 | 提取产物 |
 * | `art` | 卡面路径（**按磁盘盘点**） | `emit-defs` 盘点 |
 * | **`def`** | **机械定义**（血量/武器/节奏/伤害/部署/出处） | `core/src/units/*.ts`（手写或批量转换） |
 *
 * ⚠️ **`def` 可以不出现**：那说明这个单位**还没转换出新格式的机械定义**（批量转换的进度），
 * 页面仍能显示它（名字/图标/稀有度齐全），只是没有武器细节与时间轴。
 */
export interface UnitRecordJson {
  id: string;
  faction?: string;
  variant?: string;
  suffixes?: string[];
  /** 源码脚本（`gameplay/units/xxx.lua`） */
  source?: string;
  locale?: LocaleJson;
  /** game-config.pb 的字段（`rarity` 等） */
  pb?: Record<string, unknown>;
  art?: ArtJson;
  /** **机械定义**；不出现 = 还没转（见上面 ⚠️） */
  def?: UnitDefJson;
  /**
   * **手写 patch 覆盖过的路径**（`combatant.weapons.0.timing.hits`）。
   *
   * 与 `data/units.patch.json` 的 `patchedPaths` 同一个用途：让界面能标出"这条是手填的"。
   * 规则见 `core/src/units/patches.ts`（深合并；**数组按下标合并**）。
   */
  defPatched?: string[];
  /** 手写 patch 的**理由与出处**（patch 文件里的 `note`） */
  defPatchNote?: string;
  /**
   * **这个单位的 def 还缺什么**（只有机器转换的会有；手写的没有这一项）。
   *
   * 内容一律是"读不出来 / 故意没转"的具体说明（`core/src/convert/unit-def.ts`），
   * 例如"伤害住在 ability 脚本里，没转"、"`chargeUpLockOnTime` 亚相位没建模"。
   * ⇒ **不许拿它当"没有这个机制"**，它是待办清单。
   */
  defGaps?: string[];
}

// ─────────────────────────────────────────────────────────────
// 编码：类实例 → 纯数据
// ─────────────────────────────────────────────────────────────

const encodeDamage = (d: Damage): DamageJson => {
  const out: DamageJson = { base: d.base };
  // `.slice()` 出来的仍是元组数组；`overrides` 为空数组时按"没写"处理（J54）
  if (d.overrides !== undefined && d.overrides.length > 0) {
    out.overrides = d.overrides.map(([tag, value]) => [tag, value] as [Override, number]);
  }
  return out;
};

/**
 * **弹头效果里的伤害**（目前只有催化爆炸那条：`catalyst_explosion.damage`）。
 *
 * ⚠️ 它是**被请求的那个 ability 的调参**（`tiberiumExplosionTuning`），不是武器的伤害 ——
 * 但同样是个 `Damage` 类实例，**编码/解码时不能漏**（漏了就 `.against()` 报错，踩过）。
 */
function encodeWarhead(w: WarheadDef | undefined): WarheadDefJson | undefined {
  if (w === undefined) return undefined;
  return w.map((e): WarheadEffectDefJson => {
    if (e.kind !== "catalyst_explosion" || e.damage === undefined) {
      // ⚠️ 这一步的类型断言是**必须的**：这一类效果的**声明类型**里 `damage?: Damage`
      // （类实例），而"没写伤害"的那些在产物的类型里是 `damage?: DamageJson`；
      // 两者在运行期是同一份数据，只是 TS 不认这种"缺席时的差异"。
      return e as WarheadEffectDefJson;
    }
    return { ...e, damage: encodeDamage(e.damage) };
  });
}

function decodeWarhead(w: WarheadDefJson | undefined): WarheadDef | undefined {
  if (w === undefined) return undefined;
  return w.map((e): WarheadEffectDef => {
    if (e.kind !== "catalyst_explosion" || e.damage === undefined) return e as WarheadEffectDef;
    return { ...e, damage: decodeDamage(e.damage) };
  });
}

const encodeWeaponDamage = (wd: WeaponDamage): WeaponDamageJson => {
  const out: WeaponDamageJson = { main: encodeDamage(wd.main) };
  if (wd.side !== undefined) out.side = encodeDamage(wd.side);
  if (wd.sideTargetCount !== undefined) out.sideTargetCount = wd.sideTargetCount;
  return out;
};

/**
 * `UnitDef` → 纯数据（可直接 `JSON.stringify`）。
 *
 * ⚠️ **不是通用递归转换**：只逐字段搬该搬的（`Damage`），其余块**原样带过去**
 * （它们是纯数据，抄一遍反而会漏字段）。
 */
export function encodeDef(def: UnitDef): UnitDefJson {
  const weapons = def.combatant.weapons.map((w): WeaponDefJson => {
    // ⚠️ 键序**显式写出来**（不靠展开顺序）—— 产物是要被人读的，
    // 顺序按 `weapon-def.ts` 的分块：身份 · 节奏 · 伤害 · 弹头 · 溅射 · 飞行 · 用它的规矩 · 出处
    return {
      id: w.id,
      ...(w.name === undefined ? {} : { name: w.name }),
      timing: w.timing,
      damage: w.damage.map(encodeWeaponDamage),
      ...(w.warhead === undefined ? {} : { warhead: encodeWarhead(w.warhead) }),
      ...(w.splash === undefined ? {} : { splash: w.splash }),
      ...(w.flightMs === undefined ? {} : { flightMs: w.flightMs }),
      ...(w.selfDestruct === undefined ? {} : { selfDestruct: w.selfDestruct }),
      usage: w.usage,
      source: w.source,
    };
  });
  return {
    ...def,
    combatant: { ...def.combatant, weapons },
  };
}

// ─────────────────────────────────────────────────────────────
// 解码：纯数据 → 可用 def（补回 `Damage` 实例）
// ─────────────────────────────────────────────────────────────

const decodeDamage = (d: DamageJson): Damage =>
  new Damage(
    d.base,
    d.overrides === undefined ? undefined : d.overrides.map(([tag, value]) => [tag, value] as const),
  );

const decodeWeapon = (w: WeaponDefJson): WeaponDef => {
  const { damage, warhead, ...rest } = w;
  return {
    ...rest,
    ...(warhead === undefined ? {} : { warhead: decodeWarhead(warhead) }),
    damage: damage.map((wd) => {
      const out: WeaponDamage = { main: decodeDamage(wd.main) };
      if (wd.side !== undefined) out.side = decodeDamage(wd.side);
      if (wd.sideTargetCount !== undefined) out.sideTargetCount = wd.sideTargetCount;
      return out;
    }),
  };
};
/**
 * 纯数据 → `UnitDef`。
 *
 * ⚠️ 解码后 `damage[].main.against(...)` **必须能算**（这正是这个函数存在的理由）——
 * 有测试守着（`core/test/def-json-check.ts`）。
 */
export function decodeDef(json: UnitDefJson): UnitDef {
  const { combatant, ...rest } = json;
  return {
    ...rest,
    combatant: { ...combatant, weapons: combatant.weapons.map(decodeWeapon) },
  };
}

// ─────────────────────────────────────────────────────────────
// 记录的解码
// ─────────────────────────────────────────────────────────────

/** 一条完整记录的解码结果（`def` 里的 `Damage` 已补回实例） */
export interface UnitRecord {
  id: string;
  faction?: string;
  variant?: string;
  suffixes?: string[];
  source?: string;
  locale?: LocaleJson;
  pb?: Record<string, unknown>;
  art?: ArtJson;
  /** **机械定义**；`undefined` = 还没转换（不是"没有武器"） */
  def?: UnitDef;
  /** 机器转换留下的待办（见 `UnitRecordJson.defGaps`） */
  defGaps?: string[];
  /** 手写 patch 覆盖过的路径（见 `UnitRecordJson.defPatched`） */
  defPatched?: string[];
  /** 手写 patch 的理由与出处 */
  defPatchNote?: string;
}

/** 纯数据 → 完整记录（只对 `def` 做解码，其余原样） */
export function decodeRecord(json: UnitRecordJson): UnitRecord {
  const out: UnitRecord = { id: json.id };
  if (json.faction !== undefined) out.faction = json.faction;
  if (json.variant !== undefined) out.variant = json.variant;
  if (json.suffixes !== undefined) out.suffixes = json.suffixes;
  if (json.source !== undefined) out.source = json.source;
  if (json.locale !== undefined) out.locale = json.locale;
  if (json.pb !== undefined) out.pb = json.pb;
  if (json.art !== undefined) out.art = json.art;
  if (json.def !== undefined) out.def = decodeDef(json.def);
  if (json.defGaps !== undefined) out.defGaps = json.defGaps;
  if (json.defPatched !== undefined) out.defPatched = json.defPatched;
  if (json.defPatchNote !== undefined) out.defPatchNote = json.defPatchNote;
  return out;
}

/** 解一份产物文件里的**一个区**（`units` / `commanders`） */
export function decodeRecordMap(zone: Record<string, UnitRecordJson> | undefined): Map<string, UnitRecord> {
  const out = new Map<string, UnitRecord>();
  for (const [id, json] of Object.entries(zone ?? {})) out.set(id, decodeRecord(json));
  return out;
}

/** 当前形状版本 —— 改结构就 +1（与 `derive.ts` 的 `_schema` 各自独立） */
export const DEF_SCHEMA = 2;
