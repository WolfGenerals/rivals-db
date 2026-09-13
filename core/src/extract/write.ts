/**
 * 把提取结果写成 JSON 产物。
 *
 * 布局：
 *   data/
 *   ├── index.json                        汇总索引，按造价升序（= 游戏内商店顺序）
 *   ├── unit/*.lua.json                   单位，文件名 = 源 Lua 文件名
 *   └── commander/*.lua.json              指挥官
 *
 * JSON 没有注释，所以把注意事项写进文件本身，避免脱离文档后误用。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { panelDps } from "../attack.ts";
import { deriveAttack } from "../derive.ts";
import { baseUnitType, modifierIntroMs, modifierOutroMs } from "../types.ts";
import type { EntityRecord } from "./extract.ts";

export const FILE_NOTE =
  "combatantTuning.descriptors / weaponTunings[].descriptors 是位掩码占位值" +
  "（枚举定义在宿主 C++ 中，Lua 源码里没有），不要当作真实数值使用。" +
  "tags / goodAgainstTags 是枚举名字符串，语义正确。" +
  "注意 health 是每员血量，小队总血 = health × squadTuning.waveSize；" +
  "goodAgainstTags 是 AI 索敌偏好而非伤害加成，真实伤害见 damageTuning.overrides。";

export const INDEX_NOTE =
  "health 是每员血量，小队总血 = health × wave_size。start_major 为起始 major 等级" +
  "（= 2×稀有度编号−1，经验式）。damage 取第一件武器的基础伤害；" +
  "多武器单位 weapon_count > 1，具体伤害需读单位文件。" +
  "⚠ good_against 是 AI 索敌偏好，不是克制关系；真实克制看 damage_overrides。";

/** 按路径取值，容忍中途缺失。 */
function pick(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * `CombatantDescriptor.Ground` 的位值。
 *
 * **必须与 `luaRuntime.ts` 的 `DESCRIPTOR_BITS.Ground = 8` 一致** —— 那边是权威定义
 * （显式钉死就是为了让 `bit32.bor(CombatantDescriptor.Ground)` 合法、且不随访问顺序漂移）。
 * 这里引一个常量而不是各处写 8，改的时候 grep 得到。
 */
export const GROUND_DESCRIPTOR_BIT = 8;
/**
 * `CombatantDescriptor.Vehicle` 的位值（`luaRuntime.ts` 的 `DESCRIPTOR_BITS` 里钉死）。
 * 用于判 EMP 打谁 —— 实测 5 个带 EMP 的弹体全是 `Vehicle`。
 */
export const VEHICLE_DESCRIPTOR_BIT = 32;

/**
 * **把一棵调参树里所有的 `stats` 子块扫出来** —— 游戏里"给自己人上加速/减防"、
 * "给对面挂减速"用的全是同一套 `Stat.*` 修正器。
 *
 * 全库用到的 12 个名字（`grep 'Stat\.\w+'`）：
 *
 * | Stat | 次数 | 语义（对着 `DamageUtil`/`Modifier` 的实现读出来的） |
 * | --- | --- | --- |
 * | `AttackSpeedIncrease` / `Decrease` | 16 / 10 | **开火周期** × `1/(1±pct)` |
 * | `ReloadSpeedPercentIncrease` / `Decrease` | 7 / 6 | 装填周期 |
 * | `IncomingDamageAddition` | 4 | **受到的伤害 × (1+pct)**（奥克萨娜的狂热 25%） |
 * | `OutgoingDamagePercentIncrease` | 1 | 打出的伤害 × (1+pct)（M.S.V. 写的是 0） |
 * | `MovementSpeedFlatIncrease` / `MovementSpeedPercentIncrease` / `Decrease` | 6 / 2 / 8 | 移速 |
 * | `AngularSpeedPercentIncrease` / `Decrease` | 5 / 7 | 转向 |
 * | `MaxHealthIncrease` | 1 | 最大生命 |
 *
 * ⚠️ 移速/转向对**本页的 1v1 固定站位**没有意义；真正影响结果的是
 * **攻速 / 装填 / 受伤加成 / 打出加成**这四类，所以只解这四个。
 */
export function statModsOf(
  cfg: unknown,
  path = "",
  out: Array<{ name: string; duration_ms?: number; stats: Record<string, number> }> = [],
): Array<{ name: string; duration_ms?: number; stats: Record<string, number> }> {
  if (cfg === null || typeof cfg !== "object") return out;
  const obj = cfg as Record<string, unknown>;
  const stats = obj["stats"];
  if (stats !== null && typeof stats === "object" && !Array.isArray(stats)) {
    const key = path.split(".").pop() ?? "";
    const found: Record<string, number> = {};    for (const [k, v] of Object.entries(stats as Record<string, unknown>)) {
      if (typeof v !== "number") continue;
      const pct = Math.round(v * 100);
      if (k === "AttackSpeedIncrease") found["attack_speed_pct"] = pct;
      else if (k === "AttackSpeedDecrease") found["attack_speed_pct"] = -pct;
      else if (k === "ReloadSpeedPercentIncrease") found["reload_speed_pct"] = pct;
      else if (k === "ReloadSpeedPercentDecrease") found["reload_speed_pct"] = -pct;
      else if (k === "IncomingDamageAddition") found["incoming_damage_pct"] = pct;
      else if (k === "OutgoingDamagePercentIncrease") found["outgoing_damage_pct"] = pct;
    }
    if (Object.keys(found).length) {
      const dur = obj["durationMs"];
      out.push({
        name: key,
        ...(typeof dur === "number" ? { duration_ms: dur } : {}),
        stats: found,
      });
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "stats") continue;
    statModsOf(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}


/**
 * 把 `descriptors` 那个"位掩码占位值"读成**一个数字**。
 *
 * 形状有三种（wasmoon 视 Lua 表的具体写法而定）：数字、数组、数字键对象。
 * ⚠️ 这个掩码整体**没有真实语义**（枚举定义在宿主的 C++ 里），
 * **只有 `Ground` 位可靠**（见 `GROUND_DESCRIPTOR_BIT` 的说明）。
 */
export function descriptorBits(v: unknown): number {
  if (typeof v === "number") return v;
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n | (typeof x === "number" ? x : 0), 0);
  if (v !== null && typeof v === "object") {
    return Object.values(v as Record<string, unknown>).reduce<number>(
      (n, x) => n | (typeof x === "number" ? x : 0),
      0,
    );
  }
  return 0;
}

/**
 * 空容器归一成 undefined，好在概览里被省略。
 *
 * 原因：Lua 的空表无法区分「空数组」和「空字典」，提取时统一变成 `{}`。
 * 对扁平概览没有语义，留着会让消费者拿到 `{}` 却以为是数组
 * （真实踩过：`(u.good_against ?? []).includes is not a function`）。
 * 完整 config 树里仍保留 `{}`，那里要求保真。
 */
function nonEmptyArray(v: unknown): unknown[] | undefined {
  if (Array.isArray(v)) return v.length ? v : undefined;
  if (v !== null && typeof v === "object" && Object.keys(v as object).length === 0) return undefined;
  return v === undefined ? undefined : (v as unknown[]);
}

/** 给 index.json 用的扁平概览。 */
function summarize(rec: EntityRecord): Record<string, unknown> {
  const weapons = pick(rec.config, "combatantTuning", "weaponTunings");
  const first = Array.isArray(weapons) && weapons.length ? weapons[0] : undefined;

  const out: Record<string, unknown> = {
    id: rec.id,
    faction: rec.faction,
    variant: rec.variant,
  };
  const suffixes = rec.suffixes;
  if (suffixes?.length) out.suffixes = suffixes;

  const fields: Array<[string, unknown]> = [
    ["health", pick(rec.config, "combatantTuning", "health")],
    ["speed", pick(rec.config, "combatantTuning", "speed")],
    ["cost", pick(rec.config, "combatStoreTuning", "tiberiumCost")],
    ["damage", pick(first, "damageTuning", "default")],
    ["damage_overrides", pick(first, "damageTuning", "overrides")],
    ["range", pick(first, "maxRangeInTiles")],
    ["cooldown", pick(first, "burstTiming", "cooldown")],
    ["weapon_count", Array.isArray(weapons) && weapons.length ? weapons.length : undefined],
    ["tags", nonEmptyArray(pick(rec.config, "combatantTuning", "tags"))],
    ["good_against", nonEmptyArray(pick(rec.config, "combatantTuning", "goodAgainstTags"))],
    ["wave_size", pick(rec.config, "squadTuning", "waveSize")],
    ["vision_range", pick(rec.config, "squadTuning", "visionRangeInTiles")],
  ];
  for (const [key, value] of fields) {
    if (value !== undefined) out[key] = value;
  }
  if (rec.pb) {
    if (rec.pb.rarity) out.rarity = rec.pb.rarity;
    if (rec.pb.start_major !== undefined) out.start_major = rec.pb.start_major;
  }
  return out;
}

/** 单个实体的输出载荷（**不含 `config`** —— 单文件数据集用这个）。 */
export function payloadFor(rec: EntityRecord, resolveUnit?: (id: string) => EntityRecord | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {
    _schema: 3,
    id: rec.id,
    faction: rec.faction,
    variant: rec.variant,
  };
  if (rec.suffixes?.length) out.suffixes = rec.suffixes;
  out.source = rec.source;
  if (rec.pb) out.pb = rec.pb;
  if (rec.warnings?.length) out.warnings = rec.warnings;

  // 本地化
  if (rec.name_zh) out.name_zh = rec.name_zh;
  if (rec.name_en) out.name_en = rec.name_en;
  if (rec.desc_zh) out.desc_zh = rec.desc_zh;
  if (rec.desc_en) out.desc_en = rec.desc_en;

  // ── 迁移结果：官方结构 → 我们的规范格式（武器 + 时序）──
  const { weapons, attack, primary, notes } = deriveAttack(rec);
  /*
   * `derived.dps` = **官方面板口径**（`panelDps` = `TryGetBaseDps` 的移植），
   * **不是**时序隐含值 —— 两者在烈焰之手这类「遍历枪口齐射」的单位上会差一倍
   * （面板漏乘枪口数，findings I195）。**实际值**由 web 端按 `attack.tracks` 现算
   * （`web/src/dps.ts`），落在：表格的「对目标 DPS」列、武器卡、单位页的「对目标 DPS」
   * 那一排 —— 表格的 DPS 列与单位页的 DPS 格用的都是**这个面板值**（口径定稿见 findings I197）。
   */
  const dps = panelDps(rec, resolveUnit);
  const cfg = rec.config;
  const wave = cfg.squadTuning?.waveSize ?? 1;
  const per = cfg.combatantTuning?.health;
  const derived: Record<string, unknown> = {
    health: per === undefined ? null : { per_member: per, wave_size: wave, total: per * wave },
    dps: dps > 0 ? Number(dps.toFixed(4)) : null,
    stats: statsOf(rec),
    weapons,
    attack,
    primary,
  };
  if (wave > 1) derived.squad = { wave_size: wave, member_offset_ms: attack.member_offset_ms };
  if (notes.length) derived.notes = notes;
  out.derived = derived;

  /*
   * **`Stat.*` 修正器**（"给自己人上加速/减防" / "给对面挂减速"）—— 见 `statModsOf`。
   * 挂在**条目级**（不是 `derived`）因为它不是这个单位的属性，而是它/它的指挥官
   * **能对战场施加的效果**：M.S.V. 的 `boostTuning`、奥克萨娜的 `fanaticismTuning`、
   * 杰克逊的 `coordinatedAssaultTuning`。
   */
  const effects = statModsOf(cfg);
  if (effects.length) out.stat_mods = effects;
  return out;
}

/**
 * 固有属性 —— 组件要展示的那些，**从原始树里摘出来**。
 * 缺的字段不出现（不写 null，省得消费方判断两种"空"）。
 */
function statsOf(rec: EntityRecord): Record<string, unknown> {
  const cfg = rec.config;
  const s: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined && v !== null) s[k] = v;
  };
  /*
   * **`unit_type` 在提取时算准，别让消费方各判各的。**
   *
   * `baseUnitType()` 取的是**第一个非 `override_` 标签**，而采矿车的 tags 是
   * `[Vehicle, override_harvester, override_vehicle]` → 得到 `Vehicle`，
   * 于是过滤/分组把它归进载具（用户发现）。**`override_harvester` 必须优先判**。
   *
   * 总部的 tags 只有 `[override_structure]`，`baseUnitType()` 返回空 → 补 `Structure`。
   */
  const tags = cfg.combatantTuning?.tags ?? [];
  put(
    "unit_type",
    tags.includes("override_harvester")
      ? "Harvester"
      : (baseUnitType(rec) ?? (tags.includes("override_structure") ? "Structure" : undefined)),
  );
  /*
   * **隐藏单位** = 不在正常阵容里的条目，列表默认不显示：
   *   · 后缀 `_ST`（钢爪）/ `_CR`（指挥官衍生）/ `_mayhem` 的变体
   *   · 测试桩 `unit_dlc_test` / `unit_example` / `cmdr_dlc_test`
   *
   * ⚠️ 测试桩**不能按 `variant` 判** —— `splitVariant` 只剥 `unit_<faction>_` 这种前缀，
   * 而它们的 stem 是 `unit_dlc_test`（第二段是 `dlc` 不是阵营），所以 `variant` 是**整个 stem**。
   */
  const HIDDEN_SUFFIXES = ["ST", "CR", "mayhem"];
  const HIDDEN_IDS = ["unit_dlc_test", "unit_example", "cmdr_dlc_test"];
  if (
    (rec.suffixes ?? []).some((s) => HIDDEN_SUFFIXES.includes(s)) ||
    HIDDEN_IDS.includes(rec.id)
  ) {
    s.hidden = true;
  }
  put("cost", cfg.combatStoreTuning?.tiberiumCost);
  put("speed", cfg.combatantTuning?.speed);
  put("vision_tiles", cfg.squadTuning?.visionRangeInTiles);
  if (cfg.combatantTuning?.tags?.length) put("tags", cfg.combatantTuning.tags);
  put("can_be_crushed", cfg.squadTuning?.canBeCrushed);
  put("stealth_detect_tiles", cfg.squadTuning?.stealthDetectionRangeInTiles);
  put("kill_award_tiberium", cfg.squadTuning?.killAwardTiberium);
  put("separation_ms", cfg.squadTuning?.attackSeparationDurationMS);
  /*
   * 新增（原先被丢弃）：
   *   attack_range_tiles —— squadTuning.maxAttackRangeInTiles，**与武器射程不是一回事**
   *     （万钧巨炮 2 vs 2.5）。玩家问「能打多远」看的是它。
   *   aggro_radius_tiles —— 主动索敌半径，决定会不会先手开打
   *   turn_speed         —— 转向速度，影响绕后 / 风筝
   *   avoidance_radius   —— 避免拥挤的半径，影响阵型
   *
   * **故意不加**：accelerationDistance / decelerationDistance / hexReservationRadius
   * 语义未明，按 AGENTS.md 第 6 条不混进产物；combatStoreTuning 的三个布尔是商店内部机制。
   */
  put("attack_range_tiles", cfg.squadTuning?.maxAttackRangeInTiles);
  put("aggro_radius_tiles", cfg.combatantTuning?.aggroRadiusInTiles);
  put("turn_speed", cfg.combatantTuning?.angularSpeed);
  put("avoidance_radius", cfg.combatantTuning?.avoidanceRadius);
  // 官方文案里的"强于 XXX" —— **AI 索敌意图，不是伤害克制**
  if (cfg.combatantTuning?.goodAgainstTags?.length) {
    put("preferred_targets", cfg.combatantTuning.goodAgainstTags);
  }
  // 架设/收起时间：对全部武器取最大（巨无霸/MLRS 这类要展开才能打）
  const wts = cfg.combatantTuning?.weaponTunings ?? [];
  const dep = Math.max(0, ...wts.map(modifierIntroMs));
  if (dep) s.deploy_ms = dep;
  const und = Math.max(0, ...wts.map(modifierOutroMs));
  if (und) s.undeploy_ms = und;
  /*
   * **"必须先部署才能开火"** —— 有部署动作 **且** 武器不支持移动中开火。
   *
   * 用户给的游戏内事实：MLRS 停车自动部署、没架完不能打；壁虱坦克可以"架好再打"，
   * 也可以"不架、边跑边打"。源码层面的分界就是 `canShootWhileMoving`
   * （`CombatTuningInfo.lua:422` 的 `TryGetCanFireWhileMoving`，面板上叫 Raider）。
   */
  const canMoveFire = wts.some((w) => (w as { canShootWhileMoving?: boolean }).canShootWhileMoving === true);
  if (dep && !canMoveFire) s.must_deploy_to_fire = true;
  /*
   * **自杀式单位**（圣甲虫）：开火序列最后一行 `TakeHiddenDestroyDamage()`
   * （`ability_scarab_weapon_sequence.lua:51`）—— 打完就没了。标记来自 `extract.ts` 的
   * `attachSelfDestruct`（扫引用到的实现，与"整队伤害"同一套判据）。
   */
  if (rec.selfDestruct) s.self_destruct = true;
  /*
   * **地面单位** —— `combatantTuning.descriptors` 里有 `CombatantDescriptor.Ground`。
   *
   * 为什么这是个值得单列的字段：**格子上的效果（火/毒）只烧地面**。
   * `aura_fire.fire_tuning.condition.DESCRIPTOR_MASK = bit32.bor(CombatantDescriptor.Ground)`
   * （`gameplay/auras/aura_fire.lua`），而 `condition_fire_bomber_fire:Test` 就是拿这个掩码
   * 去与目标的 descriptors 做 `bit32.band` —— **空中单位（ Aircraft）不吃圣甲虫留下的火**。
   * 同理 `trigger_single_tile_aura` 整体是"格子上的小队进出才生效"。
   *
   * ⚠️ 判据是 `descriptors` 位掩码里的 **`Ground` 位**。`FILE_NOTE` 说 `descriptors` 是
   * 占位值、不可当数值用 —— 那是说"整个掩码没有真实语义"，但 `luaRuntime.ts:175-196`
   * 把 **`Ground = 8` 显式钉死**了（正是为了让 `bit32.bor(...)` 合法），所以这一个位可靠：
   * 实测地面单位 `[8,256,2,4]`、空军 `[64,32,2,4]`（见 `_ground_probe.ts` 的输出）。
   */
  if (descriptorBits(cfg.combatantTuning?.descriptors) & GROUND_DESCRIPTOR_BIT) {
    s.ground = true;
  }
  /*
   * **命中后铺一层火**（圣甲虫 / 火焰轰炸机）—— 只记"有火"与"火叫什么"，
   * 数值挂在**数据集顶层**的 `auras` 里（`payloadFor` 的 `auras` 参数）；
   * 同一个火被多个单位共用，不该每个单位抄一份（改一处漏一处）。
   */
  if (rec.leavesFire) {
    s.leaves_fire = rec.leavesFire;
  }
  /*
   * **命中后铺一层毒气**（催化剂炮艇 / 化武兵 / 生化越野车）。
   * 与火不同：毒气**只对步兵**（`DESCRIPTOR_MASK = Ground + Infantry`，载具 override 0），
   * 而且 `aura_gas_cloud.condition` 里有 `IMMUNE_UNIT1/2`（化武兵、毒车自己免疫）。
   */
  if (rec.leavesGas) {
    s.leaves_gas = rec.leavesGas;
    /*
     * **要打多久才铺得出毒气** —— 毒车的 `spawnGasTimeMs`。
     *
     * `ability_chemical_weapon_sequence.lua:58-67`（毒车唯一用的那条序列）：
     *
     * ```lua
     * if self:GetAgeMS() > self.tuning.spawnGasTimeMs then
     *   local tile = currentTarget.targetCombatant:GetSquad():GetSquadTile()
     *   local myTile = nHexMap.GetTileAtPos(gWorld, self:GetOwnerCombatant():GetSquad():GetWorldPosition())
     *   if nHexTile.GetDistance(tile, myTile) <= 1 then self:RefreshCloud(tile) end
     * end
     * ```
     *
     * ⇒ 判据是**这条开火序列的存活时间**（`GetAgeMS`），不是"打了几发"；
     * 目标一换人序列就 `MarkForDelete` 重开、**计时归零**。`unit_nod_chemquad.lua:38` 写的是 2100。
     *
     * ⚠️ **催化剂没有这道门槛**（`ability_catalyst_chemical_weapon_sequence.lua:69-74`
     * 是直接 `RefreshCloud`），所以它取不到这个字段 → 不写 → 消费方按 0 处理。
     */
    const seqTunings = wts.map(
      (w) => (w as { modifier_sequence?: { tuning?: Record<string, unknown> } }).modifier_sequence?.tuning,
    );
    const spawnGas = seqTunings
      .map((t) => t?.["spawnGasTimeMs"])
      .find((v) => typeof v === "number");
    if (typeof spawnGas === "number" && spawnGas > 0) s.spawn_gas_ms = spawnGas;
  }
  const ranges = wts.map((w) => w.maxRangeInTiles).filter((x): x is number => typeof x === "number");
  if (ranges.length) s.range_tiles = Math.max(...ranges);

  /*
   * **文案占位符能算的值**（<stat|X>）。
   *
   * 描述里的 <stat|BuffEffect> 之类，游戏会在运行期由**每个单位自己的**
   * GetStatInfo.overrideTable[X] 函数填值（如 unit_nod_ticktank.lua:172）。
   * 那些函数的取值来源就是各单位自己的 tuning —— 我们手里有，所以直接算好。
   *
   * 目前只解出有明确来源的：**伤害减免百分比**（壁虱坦克的壕沟 70%）。
   * 其余 12 种占位符（DebuffDuration/Clip/RampTime…）来源未查明，
   * 按 AGENTS.md 第 6 条**不猜**，UI 会显示成未被解码的占位符。
   */
  const pcts = wts
    .flatMap((w) => [
      (w.modifier_intro as { tuning?: Record<string, unknown> } | undefined)?.tuning,
      (w.modifier_outro as { tuning?: Record<string, unknown> } | undefined)?.tuning,
    ])
    .map((tt) => tt?.["damageReductionPercent"])
    .filter((v): v is number => typeof v === "number");
  if (pcts.length) s.damage_reduction_pct = Math.round(Math.max(...pcts) * 100);

  /*
   * **最小攻击距离** —— 有的单位有"死区"（太近打不到）。
   * 神像机甲 2、自行火炮 1（`squadTuning.minAttackRangeInTiles`）。
   */
  put("min_attack_range_tiles", cfg.squadTuning?.minAttackRangeInTiles);

  /*
   * **EMP 半径**（幽灵）。原始值 18，与虎鲸的 `damageRadius = 18` **同值** ——
   * 两者同属弹体/modifier 子系统。
   *
   * ⚠️ **提取期不做换算**（用户决定："换算应该前端进行"）：这里存的是**原始世界单位**
   * （幽灵就是 18），换算成格在展示层由 `web/src/format.ts` 的 `fmtTiles()` 现算。
   * 字段名因此**不带 `_tiles` 后缀** —— 带这个后缀的都是"本来就是格"的字段
   * （`attack_range_tiles` / `aggro_radius_tiles` / `vision_tiles`…），
   * 两者混在一起正是当初把量纲搞错的原因。
   */
  const mods = wts.flatMap((w) => [
    w.projectile?.modifier?.tuning,
    (w as { modifier_shot?: { tuning?: Record<string, unknown> } }).modifier_shot?.tuning,
    // ⚠️ `modifier_spawn` 有两个位置：**武器上**（虎鲸轰炸机的投弹 `burstTuning`）
    // 和 **`squadTuning` 里**（幽灵的 `modifier_wraith_squad`，`unit_nod_wraith.lua:79-90`）。
    // 两处都要扫。
    (w as { modifier_spawn?: { tuning?: Record<string, unknown> } }).modifier_spawn?.tuning,
    (cfg.squadTuning as { modifier_spawn?: { tuning?: Record<string, unknown> } } | undefined)
      ?.modifier_spawn?.tuning,
  ]);
  const emp = mods.map((m) => m?.["empRadius"]).find((v) => typeof v === "number");
  if (typeof emp === "number") s.emp_radius = emp;

  /*
   * **EMP（挂减速）** —— 用户在说"还有些单位可以给对面挂减速(EMP)"时点的这条。
   *
   * 它**不是一条属性，而是一枚打在弹体上的减益**：弹体 tuning 里的 `emp` 子表
   * （`unit_gdi_grenadier.lua:31-42`、`unit_nod_cyborg.lua:41-52`、
   * `unit_gdi_zonetrooper_ST.lua:42-53`）：
   *
   * ```lua
   * emp = {
   *   MODIFIER = RequiredHash("modifier_grenadier_emp_combatant"),
   *   durationMs = 700,
   *   stats = {
   *     [Stat.AttackSpeedDecrease]        = 0.25,
   *     [Stat.MovementSpeedPercentDecrease] = 0.3,
   *     [Stat.ReloadSpeedPercentDecrease] = 0.25,
   *     [Stat.AngularSpeedPercentDecrease]= 0.3,
   *   }
   * }
   * ```
   *
   * ⚠️ **只有载具吃** —— 弹体的 `DESCRIPTOR_FILTERS = CombatantDescriptor.Vehicle`。
   * 所以别把它当成"打谁都能挂"。
   */
  const empTuning = mods.map((m) => m?.["emp"]).find((v) => v !== null && typeof v === "object") as
    | { durationMs?: number; stats?: Record<string, number> }
    | undefined;
  if (empTuning) {
    const e: Record<string, unknown> = {};
    const putPct = (key: string, field: string) => {
      const v = empTuning.stats?.[field];
      if (typeof v === "number") e[key] = Math.round(v * 100);
    };
    if (typeof empTuning.durationMs === "number") e.duration_ms = empTuning.durationMs;
    putPct("attack_speed_pct", "AttackSpeedDecrease");
    putPct("reload_speed_pct", "ReloadSpeedPercentDecrease");
    putPct("move_speed_pct", "MovementSpeedPercentDecrease");
    putPct("turn_speed_pct", "AngularSpeedPercentDecrease");
    /*
     * **EMP 打谁**：弹体自己的 `DESCRIPTOR_FILTERS`。
     * 实测 5 个单位全是 `CombatantDescriptor.Vehicle` ⇒ **只对载具**，别当成通用减速。
     * （`descriptors` 数字不可信，但 `Vehicle = 32` 与 `Ground = 8` 一样是钉死的位值。）
     */
    const filters = mods
      .map((m) => m?.["DESCRIPTOR_FILTERS"])
      .find((v) => v !== undefined && v !== null);
    const bits = descriptorBits(filters);
    if (bits & VEHICLE_DESCRIPTOR_BIT) e["targets"] = ["Vehicle"];
    if (Object.keys(e).length) s.emp = e;
  }

  /*
   * **弹夹空时的移速修正**（火焰轰炸机的 `reloadTuning.speedPercModWhileEmpty = 0.20`）。
   * 它同时是"打一发就装填"那类单位的**装填时长**来源之一 —— 见 `_sim` 的说明。
   */
  const speedWhileEmpty = wts
    .map((w) => (w as { reloadTuning?: { speedPercModWhileEmpty?: number } }).reloadTuning?.speedPercModWhileEmpty)
    .find((v) => typeof v === "number");
  if (typeof speedWhileEmpty === "number") {
    s.speed_mod_while_empty_pct = Math.round(speedWhileEmpty * 100);
  }

  return s;
}

/**
 * 稳定的 JSON 文本。
 *
 * `sortKeys` 让字段顺序稳定（数值表没有固有序，Lua 表遍历顺序也不确定），
 * 从而保证多次运行逐字节一致，产物可 diff。
 */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k]);
    return out;
  }
  return value;
}

/** index.json 的载荷（不含序列化）。 */
export function indexPayload(records: EntityRecord[]): Record<string, unknown> {
  const rows = records.map(summarize);
  rows.sort((a, b) => {
    const ca = asNumber(a.cost);
    const cb = asNumber(b.cost);
    if (ca === undefined && cb !== undefined) return 1;
    if (ca !== undefined && cb === undefined) return -1;
    if (ca !== cb) return (ca ?? 0) - (cb ?? 0);
    return String(a.id).localeCompare(String(b.id));
  });
  const count = (f: string) => records.filter((r) => r.faction === f).length;
  const out: Record<string, unknown> = {
    _note: INDEX_NOTE,
    unit_count: records.length,
    gdi_count: count("GDI"),
    nod_count: count("NOD"),
  };
  const misc = records.length - count("GDI") - count("NOD");
  if (misc) out.misc_count = misc;
  out.units = rows;
  return out;
}

/** 单文件数据集的说明 */
const DATASET_NOTE =
  "已解析好的单位数据。每条含 derived.weapons（打出去的**是什么**：伤害/补正/范围/可打目标）与 " +
  "derived.attack（**什么时候**打**哪一把**：composition + tracks）。不含原始 config 树。";

export interface WriteOptions {
  /** 输出根目录，通常是仓库的 data/ */
  outDir: string;
}

/**
 * 写出全部产物。
 *
 * **只有一个文件**：`data/units.json` —— 全部单位与指挥官，每条是
 * 「解析出来的攻击逻辑（武器 + 时序）+ 其他必要部分（名称/描述/稀有度/血量/造价…）」。
 *
 * ⚠️ **不含原始 `config` 树**（那是"冗长的提取结果"）。需要原始结构时重跑提取即可
 * —— 它本来就是从 `tmp/` 的 Lua 源码现算的。
 */
export async function writeAll(
  result: {
    units: EntityRecord[];
    commanders: EntityRecord[];
    factions: unknown[];
    /** `gameplay/auras/*.lua` 归一后的**共享**效果表（键 = 单位侧引用的那个名字） */
    sharedAuras?: Record<string, Record<string, unknown>>;
  },
  opts: WriteOptions,
): Promise<string[]> {
  const written: string[] = [];
  const write = async (path: string, text: string) => {
    await mkdir(dirname(path), { recursive: true });
    // newline: \n，避免在 Windows 上写出 CRLF 造成产物不稳定
    await writeFile(path, text.replace(/\r\n/g, "\n"), "utf8");
    written.push(path);
  };

  /*
   * 变体的面板值要沿到本体（实现的 `TranslateToken` 硬编码读本体）—— 先建一张
   * 「lua 名 → 记录」的表给 `panelDps` 用。见 `attack.ts` 的 `panelDps` 与 findings I196。
   */
  const byId = new Map<string, EntityRecord>();
  for (const rec of [...result.units, ...result.commanders]) byId.set(rec.id, rec);
  const resolveUnit = (id: string) => byId.get(id);

  const payload = {
    _schema: 3,
    _note: DATASET_NOTE,
    unit_count: result.units.length,
    commander_count: result.commanders.length,
    /*
     * **共享的场地效果表**（`gameplay/auras/*.lua`）放在顶层 —— 它们不属于任何单位，
     * 却被单位**引用**（火就是 `modifier_fire_bomber_fire`，圣甲虫与火焰轰炸机共用）。
     * 单位侧只有 `stats.leaves_fire` / `stats.leaves_gas` 这两个名字，
     * **数值一律来这里查**（用户："场地效果应该不放在单位里面而是单独被引用"）。
     */
    auras: result.sharedAuras ?? {},
    units: result.units.map((r) => payloadFor(r, resolveUnit)),
    commanders: result.commanders.map((r) => payloadFor(r, resolveUnit)),
  };
  await write(join(opts.outDir, "units.json"), stableJson(payload));
  return written;
}
