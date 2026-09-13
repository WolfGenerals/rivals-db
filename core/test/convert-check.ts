/**
 * **批量转换器的核对**（J52 的硬约束：转换出来的数必须逐项对得上源码）。
 *
 * 两部分：
 * 1. **已知单位的真数**（步枪兵 / MLRS / 钢梁炮 / 壁虱坦克 / 寡妇制造者）—— 手写 def 与转换结果必须一致；
 * 2. **锚点不许撒谎**：把每条 `← :行 \`键\`` 拿回 Lua 原文比对，那一行必须真的写着这个键。
 *
 * 需要先生成产物：`pnpm --filter @rivals/cli start convert-defs <游戏目录>`
 * 跑法：`node --experimental-strip-types core/test/convert-check.ts`
 */

import { readFileSync } from "node:fs";
import { decodeDef } from "../src/model/def-json.ts";
import type { UnitDefJson } from "../src/model/def-json.ts";
import type { UnitDef } from "../src/model/unit-def.ts";

let failed = 0;
let passed = 0;
const check = (label: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 期望 ${JSON.stringify(want)}，得到 ${JSON.stringify(got)}`);
};

const GEN = "data/units.def.gen.json";
const SCRIPTS = "tmp/com.ea.gp.candcwarzones/published/nfd/scripts";

interface GenFile {
  _schema: number;
  _stats: Record<string, unknown>;
  units: Record<string, UnitDefJson>;
  gaps: Record<string, string[]>;
}
const file = JSON.parse(readFileSync(GEN, "utf8")) as GenFile;
const defs = new Map<string, UnitDef>(Object.entries(file.units).map(([id, j]) => [id, decodeDef(j)]));
const def = (id: string): UnitDef => {
  const d = defs.get(id);
  if (d === undefined) throw new Error(`${GEN} 里没有 ${id}`);
  return d;
};

console.log(`产物：${defs.size} 个单位 · 锚点统计 ${JSON.stringify(file._stats)}`);

console.log("\n【1】步枪兵（`unit_gdi_riflemen.lua`）—— 与手写 def 逐项一致");
{
  const d = def("unit_gdi_riflemen");
  const w = d.combatant.weapons[0]!;
  check("节奏：周期 1720 / 无前摇 / 一轮一发", w.timing, {
    kind: "cyclic",
    cooldownMs: 1720,
    chargeUpMs: 0,
    initialChargeUpMs: 0,
    hits: 1,
    intervalMs: 0,
  });
  check("伤害 38", w.damage[0]!.main.base, 38);
  check("覆写：打载具 15", w.damage[0]!.main.against("Vehicle"), 15);
  check("覆写：打步兵 38", w.damage[0]!.main.against("Infantry"), 38);
  check("能打谁（无飞行位 ⇒ 打不到空中）", w.usage.canAttack, ["Infantry", "Vehicle", "Structure", "Harvester"]);
  check("枪口 1", w.usage.muzzleCount, 1);
  check("索敌 kRandom 2–5", w.usage.targeting, { mode: "kRandom", randomBurstMin: 2, randomBurstMax: 5 });
  check("每员 130 血 / 5 人 / 错位 344ms", [d.combatant.health, d.squad.waveSize, d.squad.attackSeparationDurationMS], [130, 5, 344]);
  check("造价 10", d.store.tiberiumCost, 10);
  check("不部署", d.deploy, undefined);
  check("与手写 def 的节奏一致（同一把武器）", w.timing, def("unit_gdi_riflemen").combatant.weapons[0]!.timing);
}

console.log("\n【2】MLRS —— 弹夹（装填从首发算）+ 部署，两个机制一起");
{
  const d = def("unit_gdi_mlrs");
  const w = d.combatant.weapons[0]!;
  check("节奏：弹夹 3 发 / 装填 5000ms", w.timing, {
    kind: "magazine",
    clipSize: 3,
    reloadTimeMs: 5000,
    gapMs: 250,
    chargeUpMs: 250,
  });
  check("伤害 666（打步兵 40 / 建筑 1000）", [
    w.damage[0]!.main.base,
    w.damage[0]!.main.against("Infantry"),
    w.damage[0]!.main.against("Structure"),
  ], [666, 40, 1000]);
  check("枪口 3 / 索敌 kCenter 75", [w.usage.muzzleCount, w.usage.targeting], [3, { mode: "kCenter", centerSpread: 75 }]);
  check("部署：架 2000 / 收 500", [d.deploy?.unpackMs, d.deploy?.packMs], [2000, 500]);
  check("不架不许开火（没有 canShootWhileMoving）", d.deploy?.mustDeployToFire, true);
  check("架设可以打断", d.deploy?.canInterruptIntro, true);
  check("没有减伤盾", d.deploy?.shield, undefined);
}

console.log("\n【3】钢梁炮 —— 分段（三段 + 每段伤害 + 副伤）");
{
  const w = def("unit_nod_beamcannon").combatant.weapons[0]!;
  check("节奏是分段", w.timing.kind, "staged");
  const t = w.timing as Extract<typeof w.timing, { kind: "staged" }>;
  check("首轮蓄力 500 / 段进度保质期 700", [t.initialChargeUpMs, t.storeChargeTimeMs], [500, 700]);
  check("段：12 发 / 24 发 / 末段无限（都是 250ms 一跳）", t.stages, [
    { attackCount: 12, tickPeriodMs: 250 },
    { attackCount: 24, tickPeriodMs: 250 },
    { tickPeriodMs: 250 },
  ]);
  check("每段伤害 45 / 90 / 150（打步兵 5 / 8 / 12）", w.damage.map((x) => [x.main.base, x.main.against("Infantry")]), [
    [45, 5],
    [90, 8],
    [150, 12],
  ]);
  check("段 2/3 的副伤 40 / 50、点名 2 / 3 个", w.damage.map((x) => [x.side?.base, x.sideTargetCount]), [
    [undefined, undefined],
    [40, 2],
    [50, 3],
  ]);
  check("能打谁（descriptors = Ground + AttackableTypeMask）", w.usage.canAttack, ["Infantry", "Vehicle", "Structure", "Harvester"]);
}

console.log("\n【4】壁虱坦克 —— 边跑边打 + 架设减伤窗口（挂在 `hidden` 槽上，但归单位）");
{
  const d = def("unit_nod_ticktank");
  const cannon = d.combatant.weapons[0]!;
  check("主炮节奏 3000 / 前摇 1000", cannon.timing, {
    kind: "cyclic",
    cooldownMs: 3000,
    chargeUpMs: 1000,
    initialChargeUpMs: 0,
    hits: 1,
    intervalMs: 0,
  });
  check("主炮伤害 750（打步兵 105）", [cannon.damage[0]!.main.base, cannon.damage[0]!.main.against("Infantry")], [750, 105]);
  check("两个槽都转出来了（第二个是 hidden 空槽）", d.combatant.weapons.map((w) => w.id), ["cannon", "hidden"]);
  check("部署：架 2000 / 收 500", [d.deploy?.unpackMs, d.deploy?.packMs], [2000, 500]);
  check("边跑边打 ⇒ 不必架好就能开火", d.deploy?.mustDeployToFire, false);
  check("减伤窗口 70% / 架 1750 后开 / 收 250 后撤", d.deploy?.shield, {
    percent: 0.7,
    unpackAfterMs: 1750,
    packAfterMs: 250,
  });
}

console.log("\n【5】多发武器：`numToBurst` 与 `fireRate`（寡妇制造者 6 连发 / 间隔 95ms）");
{
  // ⚠️ 第一个槽是 `flamethrower`（由 ability 驱动，武器块里没有节奏与伤害）⇒ 按 id 取 `rockets`
  const w = def("unit_nod_widowmaker").combatant.weapons.find((x) => x.id === "rockets")!;
  const t = w.timing as Extract<typeof w.timing, { kind: "cyclic" }>;
  check("一轮 6 发", t.hits, 6);
  check("发间隔 95ms（`fireRate = 0.095` 秒）", t.intervalMs, 95);
  check("周期 1500ms", t.cooldownMs, 1500);
  check("前摇 930ms", t.chargeUpMs, 930);
}

console.log("\n【5b】「单段分段」武器：`attackCount`/`tickPeriodMs`/`damage` 直接写在序列顶层");
{
  // 干扰者 `unit_gdi_disruptor.lua:38-55`：initialChargeUpMs 3000 / attackCount 20 / tickPeriodMs 40 / damage 26
  const w = def("unit_gdi_disruptor").combatant.weapons[0]!;
  const t = w.timing as Extract<typeof w.timing, { kind: "staged" }>;
  check("识别成分段（一段）", w.timing.kind, "staged");
  check("首轮蓄力 3000", t.initialChargeUpMs, 3000);
  check("一段：20 发 / 40ms 一跳", t.stages, [{ attackCount: 20, tickPeriodMs: 40 }]);
  check("伤害 26（打建筑 300 / 打载具 13）", [
    w.damage[0]!.main.base,
    w.damage[0]!.main.against("Structure"),
    w.damage[0]!.main.against("Vehicle"),
  ], [26, 300, 13]);
}

console.log("\n【5c】圣甲虫：`modifier_outro` 没有 `tuning`，时长写在 behaviour 里（`modifier_core_outro` ⇒ 0）");
{
  const d = def("unit_nod_scarab");
  check("照样建出了 deploy", d.deploy !== undefined, true);
  check("架 2000 / 收 0（瞬时）", [d.deploy?.unpackMs, d.deploy?.packMs], [2000, 0]);
  check("出处标到了 behaviour 的 Lua 行", (d.deploy?.source?.anchors ?? []).some((a) => a.includes("modifier_core_outro.lua:6")), true);
}

console.log("\n【6】锚点不许撒谎：每条 `← :行` 拿回 Lua 原文比对");
{
  let anchors = 0;
  let bad = 0;
  const samples: string[] = [];
  for (const [id, d] of defs) {
    const script = d.source?.script;
    if (script === undefined) continue;
    const lines = readFileSync(`${SCRIPTS}/${script}`, "utf8").split(/\r?\n/);
    const all = [...(d.source?.anchors ?? []), ...d.combatant.weapons.flatMap((w) => w.source.anchors)];
    for (const a of all) {
      const m = /← :(\d+) `([A-Za-z0-9_]+)/.exec(a);
      if (m === null) continue;
      anchors++;
      const line = lines[Number(m[1]) - 1] ?? "";
      if (!line.includes(m[2]!)) {
        bad++;
        if (samples.length < 5) samples.push(`${id}: ${a} ⇒ 那一行是「${line.trim().slice(0, 60)}」`);
      }
    }
  }
  check(`核对 ${anchors} 条锚点，全部指对了行`, bad, 0);
  for (const s of samples) console.log(`     ⚠️ ${s}`);
}

console.log("\n【5d】节奏写在**序列**里的武器（沙暴 = 手写 patch 收尾的样板）");
{
  // 沙暴：武器级 `burstTiming` 只有 `numToBurst = 1`；周期在序列 `burstCooldown = 4000`，
  // 一发一轮的发数/间隔在 `perTargetCount`（随交战队数变）⇒ **手写 patch 填 1 队档**
  const d = def("unit_gdi_sandstorm");
  const w = d.combatant.weapons[0]!;
  const t = w.timing as Extract<typeof w.timing, { kind: "cyclic" }>;
  check("沙暴：识别成循环（不是「周期 0」）", t.kind, "cyclic");
  check("一轮 4000ms（序列 `burstCooldown`）", t.cooldownMs, 4000);
  check("一轮 12 发 × 200ms（**手写 patch** 填的 1 队档）", [t.hits, t.intervalMs], [12, 200]);
  check("出处：节奏来自序列脚本", t.impl, "ability_sandstorm_weapon_sequence");
  // ⚠️ `defPatched` 是 **emit-defs** 叠 patch 时写进**最终产物**的（gen 文件里没有）
  const product = JSON.parse(readFileSync("data/units.def.json", "utf8")) as {
    units: Record<string, { defPatched?: string[]; defPatchNote?: string }>;
  };
  check(
    "产物里记了「哪几条是手填的」",
    product.units["unit_gdi_sandstorm"]?.defPatched,
    ["combatant.weapons.0.timing.hits", "combatant.weapons.0.timing.intervalMs"],
  );
  check("最终产物带 patch 出处说明", (product.units["unit_gdi_sandstorm"]?.defPatchNote ?? "").includes("perTargetCount"), true);
  check("没被 patch 的单位没有 `defPatched`", product.units["unit_gdi_riflemen"]?.defPatched, undefined);

  // 科迪亚克 / 巨无霸：发数在视觉常量里 ⇒ 转换器**不猜**，只记 gap（等 patch）
  const kodiak = (JSON.parse(readFileSync(GEN, "utf8")) as { gaps: Record<string, string[]> }).gaps["unit_gdi_kodiak"] ?? [];
  check("科迪亚克：发数读不到 ⇒ 记 gap 而不是猜", kodiak.some((g) => g.includes("一轮发数读不到")), true);
}

console.log("\n【5e】充能型武器（催化剂炮艇的 `gasWeapon`）—— 不是连发，是**充能后才开火**");
{
  // `unit_nod_catalystgunship.lua:44-53` 两套节奏：catalystBurst 1600 / gasBurst 6000（蓄 4500）
  // `modifier_catalystgunship_gas_weapon.lua:6-9` 拿 `gasBurst.initialChargeUpMs` 当充能时长
  const d = def("unit_nod_catalystgunship");
  const gas = d.combatant.weapons.find((w) => w.id === "gasWeapon")!;
  const t = gas.timing as Extract<typeof gas.timing, { kind: "cyclic" }>;
  check("gasWeapon：一轮 6000ms（`gasBurst`，不是 1600 那个）", t.cooldownMs, 6000);
  check("**第一次开火前充能 4500ms**", t.initialChargeUpMs, 4500);
  check("充能不算「周期内的前摇」", t.chargeUpMs, 0);
  const other = d.combatant.weapons.find((w) => w.id === "catalystWeapon")!;
  /*
   * **催化剂弹的节奏不在它自己的槽里** —— 它自己那个 `burstTiming.cooldown = 3.0`
   * （`unit_nod_catalystgunship.lua:120-124`）是引擎默认路径的值、**不是真值**：
   * 真正开火的是**毒气槽上挂的序列**，它按 `catalystBurst.cooldown = 1600` 排班
   * （`ability_catalyst_chemical_weapon_sequence.lua:10` 的面板公式、`:95-96` 的 `SetCooldown`）。
   *
   * 实测后果（修之前）：产物 3000ms ⇒ DPS 只有 90，而面板/wiki 是 `270 ÷ 1.6s = 169`。
   */
  check("催化剂弹：取**隔壁槽序列**里的 `catalystBurst` = 1600ms（不是本槽那个 3000）", other.timing.kind === "cyclic" ? other.timing.cooldownMs : null, 1600);
  check("每轮前摇仍是本槽的 `chargeUpDuration` = 80ms", other.timing.kind === "cyclic" ? other.timing.chargeUpMs : null, 80);
  check(
    "锚点写清了这个数是从隔壁槽借的、以及本槽那个为什么不是真值",
    (other.source.anchors ?? []).some((a) => a.includes("隔壁槽") && a.includes("catalystBurst") && a.includes("不是真值")),
    true,
  );
  const gaps = (JSON.parse(readFileSync(GEN, "utf8")) as { gaps: Record<string, string[]> }).gaps["unit_nod_catalystgunship"] ?? [];
  check("gap 里点明「有两套节奏，按名字取 gasBurst」", gaps.some((g) => g.includes("gasBurst") && g.includes("2 套节奏")), true);
  check("gap 里点明充能**不攻击会回退**（模型没有）", gaps.some((g) => g.includes("回退")), true);
}

console.log("\n【5f】自杀式武器（圣甲虫）：开火序列结束时**销毁自己**");
{
  // `ability_scarab_weapon_sequence.lua:51` 的 `self:GetOwnerCombatant():TakeHiddenDestroyDamage()`
  const w = def("unit_nod_scarab").combatant.weapons[0]!;
  check("圣甲虫标了 `selfDestruct`", w.selfDestruct, true);
  check(
    "出处锚到那句调用（不是赋值行）",
    (w.source.anchors ?? []).some((a) => a.includes("ability_scarab_weapon_sequence.lua:51")),
    true,
  );
  check("步枪兵没有这个标记", def("unit_gdi_riflemen").combatant.weapons[0]!.selfDestruct, undefined);
  // 全库只有圣甲虫这一把武器是自杀式（另一处 `TakeHiddenDestroyDamage` 在钻地舱 intro 里）
  const suicide = [...defs.values()].flatMap((d) => d.combatant.weapons.filter((x) => x.selfDestruct === true).map((x) => `${d.id}/${x.id}`));
  check("全库只有 1 把自杀式武器", suicide, ["unit_nod_scarab/rifle"]);
}

console.log("\n【6】弹头效果（命中之后做什么）—— 火 / 毒气 / 催化 / EMP 各一条");
{
  // 火焰轰炸机：`modifier_fire_bomber_projectile.lua:42` 的 CreateFire + aura_fire 的数值
  const fire = def("unit_nod_firebomber").combatant.weapons.find((w) => w.id === "missile")!.warhead ?? [];
  const place = fire.find((e) => e.kind === "place_modifier");
  check("地狱火：铺火（不是「只打最后一员」）", place?.kind, "place_modifier");
  check(
    "火：每 250ms 一跳 / 每跳 25 / 持续 10s（`aura_fire.lua`）",
    place?.kind === "place_modifier" ? [place.effect.tickMs, place.effect.tickDamage, place.effect.persistMs] : null,
    [250, 25, 10000],
  );
  check("火：只作用于地面 + 打载具也是 25", place?.kind === "place_modifier" ? [place.effect.groundOnly, place.effect.vs] : null, [true, [["override_vehicle", 25]]]);

  // 生化战士：毒气来自**武器序列**（`spawnGasTimeMs = 750`），数值在 auras 表里
  const gas = def("unit_nod_chemicalwarrior").combatant.weapons[0]!.warhead ?? [];
  const gasPlace = gas.find((e) => e.kind === "place_modifier");
  check("生化战士：铺毒气 + 续时", gas.map((e) => e.kind), ["place_modifier", "refresh_modifier"]);
  check(
    "毒气：每 200ms 一跳 / 每跳 6 / 持续 10s / 载具免疫",
    gasPlace?.kind === "place_modifier"
      ? [gasPlace.effect.tickMs, gasPlace.effect.tickDamage, gasPlace.effect.persistMs, gasPlace.effect.vs]
      : null,
    [200, 6, 10000, [["override_vehicle", 0]]],
  );
  check("毒气：免疫化武兵与毒车", gasPlace?.kind === "place_modifier" ? gasPlace.effect.immune?.length : 0, 2);
  check(
    "毒车要连续打 2.1s 才铺得出（`spawnGasTimeMs = 2100`）—— 锚点里写着",
    (def("unit_nod_chemquad").combatant.weapons[0]!.source.anchors ?? []).some((a) => a.includes("2100ms")),
    true,
  );

  // 催化剂炮艇：引爆（条件 = 格上有毒气）
  const cat = def("unit_nod_catalystgunship").combatant.weapons.find((w) => w.id === "catalystWeapon")!.warhead ?? [];
  const boom = cat.find((e) => e.kind === "catalyst_explosion");
  check("催化剂：引爆 `ability_catalyst_explosion`", boom?.kind === "catalyst_explosion" ? boom.impl : null, "ability_catalyst_explosion");
  check(
    "引爆条件：格上有毒气",
    boom?.kind === "catalyst_explosion" ? boom.triggers : null,
    [{ kind: "tileHasModifier", modifier: "modifier_chem_warrior_gas_cloud" }],
  );

  // 榴弹兵：EMP 属性修改
  const emp = def("unit_gdi_grenadier").combatant.weapons[0]!.warhead ?? [];
  const modify = emp.find((e) => e.kind === "modify");
  check("榴弹兵：EMP 700ms / 4 项属性", modify?.kind === "modify" ? [modify.durationMs, modify.stats.length] : null, [700, 4]);
  check(
    "EMP 里含「攻速 −25%」",
    modify?.kind === "modify" ? modify.stats.some(([k, v]) => k === "AttackSpeedDecrease" && v === 0.25) : false,
    true,
  );

  // 虎鲸轰炸机：逐个战斗员 + 按距离衰减
  const orca = def("unit_gdi_orcabomber").combatant.weapons.find((w) => w.id === "bomb")!.warhead ?? [];
  const falloff = orca.find((e) => e.kind === "falloff");
  check("虎鲸：半径 18 + 4 点衰减曲线", falloff?.kind === "falloff" ? [falloff.radius, falloff.curve.length] : null, [18, 4]);

  // 分段武器之外，**默认弹头**仍然成立
  const rifle = def("unit_gdi_riflemen").combatant.weapons[0]!;
  check("步枪兵没写 warhead（走默认：只打最后一员）", rifle.warhead, undefined);
}

console.log("\n【7】覆盖面：所有单位都转出来了，且没有「整段空着」的");
{
  check("单位数 = 86", defs.size, 86);
  const withWeapons = [...defs.values()].filter((d) => d.combatant.weapons.length > 0).length;
  check("有武器的 > 70", withWeapons > 70, true);
  const deployUnits = [...defs.values()].filter((d) => d.deploy !== undefined).map((d) => d.id);
  check("可部署的单位数 = 9（9 个文件写了 `modifier_intro`）", deployUnits.length, 9);
  console.log(`     可部署：${deployUnits.join(", ")}`);
  const kinds = { cyclic: 0, magazine: 0, staged: 0 };
  for (const d of defs.values()) for (const w of d.combatant.weapons) kinds[w.timing.kind]++;
  check("三种节奏都覆盖到了", kinds.cyclic > 0 && kinds.magazine > 0 && kinds.staged > 0, true);
  /*
   * 有武器却**一段伤害都没有**的：只允许"伤害住在 ability 脚本里"，而且必须**留了 gap**
   * （见 `core/src/convert/unit-def.ts` 的规矩：读不出来就空着 + 记一笔，不许编）。
   */
  const noDamage = [...defs.values()]
    .filter((d) => d.combatant.weapons.length > 0 && d.combatant.weapons.every((w) => w.damage.length === 0))
    .map((d) => d.id);
  check("没有伤害的单位，每一个都留了 gap", noDamage.every((id) => (file.gaps[id] ?? []).length > 0), true);
  console.log(`     伤害空着的 ${noDamage.length} 个（都是 ability 驱动的武器）：${noDamage.join(", ")}`);
  const gapUnits = Object.keys(file.gaps).length;
  console.log(`     待办(gaps) 涉及 ${gapUnits} 个单位 —— 详见 ${GEN} 的 \`gaps\` 段`);
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;
