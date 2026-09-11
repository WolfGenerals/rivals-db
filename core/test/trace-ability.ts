/**
 * 轨迹录制器：**真跑** `ability_*_weapon_sequence.lua` 的 `Timeline()`，把开火序列录下来。
 *
 * 为什么不用静态分析、也不写 16 个 TS 类：
 *   Lua 源码已经是唯一真相，转写成 TS 会有第二份真相、会漂移，而且转写时仍要"读懂逻辑"。
 *   直接跑它，拿到的是**实际序列**（含循环、条件、分支），改动自动跟随。
 *
 * 做法：伪造 `thread` / `weapon` / `self` 的最小接口，`WaitForAge` 推进假时钟并计数，
 * 超过步数上限就 `error` 跳出 `while true`。
 *
 * 跑法：`node --experimental-strip-types core/test/trace-ability.ts [单位id]`
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createLuaRuntime } from "../src/extract/luaRuntime.ts";

const SCRIPTS = "tmp/com.ea.gp.candcwarzones/published/nfd/scripts";

const load = async (rel: string): Promise<string | null> => {
  try {
    return await readFile(join(SCRIPTS, rel), "utf8");
  } catch {
    return null;
  }
};

/** JSON 值 → Lua 字面量（只处理 tuning 里会出现的类型） */
function lua(value: unknown): string {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `{${value.map(lua).join(", ")}}`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([k]) => /^\d+$/.test(k) || true);
  return `{${entries.map(([k, v]) => `${/^[A-Za-z_]\w*$/.test(k) ? k : `["${k}"]`} = ${lua(v)}`).join(", ")}}`;
}

interface TraceStep {
  tMs: number;
  kind: string;
  muzzle?: number;
  detail?: string;
}

export interface TraceResult {
  steps: TraceStep[];
  truncated: boolean;
  error?: string;
}

function harness(abilityName: string, visualGlobal: string, seqName: string, tuning: unknown, muzzleCount: number): string {
  return `
do
  local LIMIT = 64
  local TRACE = { steps = {}, clock = 0, nudges = 0, limit = LIMIT }
  local function rec(kind, extra)
    local s = { t = TRACE.clock, kind = kind }
    if extra then for k, v in pairs(extra) do s[k] = v end end
    TRACE.steps[#TRACE.steps + 1] = s
  end
  local function tick(ms)
    if type(ms) == "number" and ms > TRACE.clock then TRACE.clock = ms end
    TRACE.nudges = TRACE.nudges + 1
    if TRACE.nudges > TRACE.limit then error("__TRACE_LIMIT__", 0) end
  end

  -- 可链式索引且**可调用**的假对象：未定义全局产生的 autotable 不可调用，会报 ttempt to call a table value。
  local function deepAuto()
    local t = {}
    return setmetatable(t, {
      __index = function() return deepAuto() end,
      __call = function(self) return self end,
    })
  end
  -- 覆盖 _G 的未定义全局回落：bootstrap 的 autotable 有 __index 但**没有 __call**，
  -- 于是 gWorld:GetCombatContext() 会报 "attempt to call a table value"。
  -- 轨迹场景下我们希望这些调用一律"成功"，所以换成可调用的 deepAuto。
  setmetatable(_G, {__index = function(_, k)
    if type(k) ~= "string" then return nil end
    return deepAuto()
  end})

  local fakeTarget = deepAuto()
  fakeTarget.targetCombatant = deepAuto()
  fakeTarget.squadId = 1
  fakeTarget.armyId = 1
  local fakeTile = deepAuto()
  local fakeWeapon = {}
  fakeWeapon.GetMuzzleCount = function() return ${muzzleCount} end
  fakeWeapon.FireFromMuzzle = function(_, _, muzzle) rec("fire", { muzzle = muzzle }) end
  fakeWeapon.GetCurrentTarget = function() return fakeTarget end
  fakeWeapon.GetWeaponObject = function() return {} end
  fakeWeapon.IsFacingTargetRanged = function() return true end
  local fakeSquad = {}
  fakeSquad.GetUniqueSquadId = function() return 1 end
  fakeSquad.GetArmyId = function() return 1 end
  fakeSquad.GetSquadTile = function() return fakeTile end
  fakeSquad.GetBase = function() return {} end
  local fakeCombatant = {}
  fakeCombatant.GetPrimaryWeapon = function() return fakeWeapon end
  fakeCombatant.GetSquad = function() return fakeSquad end

  for _, t in ipairs({ fakeWeapon, fakeCombatant, fakeSquad }) do
    setmetatable(t, {__index = function() return function() end end})
  end

  local fakeThread = {}
  fakeThread.WaitForAge = function(_, ms) tick(ms); rec("wait", { detail = tostring(ms) }) end

  nWeaponSequenceUtil = {
    WaitForCooldown = function() return 0 end,
    WaitToFaceTarget = function() end,
    WaitForAge = function(ms) tick(ms); rec("wait", { detail = tostring(ms) }) end,
    SetCooldown = function(ms) rec("cooldown", { detail = tostring(ms) }) end,
    VerifyExists = function() end,
  }
  nAnimation = setmetatable({}, {__index = function() return function() return 1 end end})
  nAudioUtil = deepAuto()
  nBlackboard = setmetatable({}, {__index = function() return function() return deepAuto() end end})
  nGameObject = deepAuto()
  nTargetUtil = setmetatable({ HasTargetSquadChanged = function() return false end, TrySetOriginalTargetSquad = function() return true end }, {__index = function() return function() return true end end})
  nSquad = deepAuto()
  Ability = setmetatable({}, {__index = function() return function() end end})
  gWorld = deepAuto()

  local ABIL = ${abilityName}
  local fakeSelf = {
    id = "trace",
    tuning = ${lua(tuning)},
    -- self.visual 是 visual 表里**以能力名为键的那一张子表**，不是整张表
    visual = (${visualGlobal}) and (${visualGlobal})[${JSON.stringify(seqName)}] or deepAuto(),
    settings = {},
    originalTarget = fakeTarget,
    originalTargetSquadId = 1,
    originalTargetEntry = {},
    combatContext = {},
    targetTile = fakeTile,
  }
  fakeSelf.GetOwnerCombatant = function() return fakeCombatant end
  fakeSelf.GetOwner = function() return {} end
  fakeSelf.GetTarget = function() return fakeTarget end
  fakeSelf.GetAgeMS = function() return TRACE.clock end
  fakeSelf.CheckCurrentTarget = function() return fakeTarget end
  fakeSelf.MarkForDelete = function() end
  fakeSelf.PlayVFXAtWorldPos = function() return 1 end
  fakeSelf.StopVFX = function() end
  fakeSelf.weapon = fakeWeapon
  -- 没显式定义的，回落到 ability 自己的方法（Fire 等），再不行给个空函数
  setmetatable(fakeSelf, {__index = function(_, k)
    local m = rawget(ABIL, k)
    if m ~= nil then return m end
    -- Lua 惯例：大写开头是方法（self:GetFoo()），小写是数据字段（self.currentMuzzle）。
    -- 数据字段必须返回 nil，否则 currentMuzzle == nil 的判断会走错分支
    -- （ability_simple_weapon_sequence 就栽在这里）。
    if type(k) == "string" and k:match("^%u") then return function() end end
    return nil
  end})

  local ok, err = pcall(ABIL.Timeline, fakeSelf, fakeThread)
  __TRACE_RESULT = {
    steps = TRACE.steps,
    truncated = (not ok) and tostring(err):find("__TRACE_LIMIT__") ~= nil,
    error = (not ok) and tostring(err) or nil,
  }
end
`;
}

/** wasmoon 把 Lua 数组返回成「带数字键的对象」，不是 JS 数组，要归一 */
function toArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v !== null && typeof v === "object") {
    return Object.keys(v as object)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (v as Record<string, T>)[k]!);
  }
  return [];
}

export async function traceUnit(unitId: string): Promise<Array<TraceResult & { ability: string; seqName: string }>> {
  const unitSrcRel = `gameplay/units/${unitId}.lua`;
  const unitSrc = await load(unitSrcRel);
  if (!unitSrc) throw new Error(`读不到 ${unitSrcRel}`);

  /*
   * 一个单位可能有多把带 `modifier_sequence` 的武器：
   *   · 有的只有 `name` 没有 `behaviour`（占位桩，如 orcabomber 的 `targetSelector`）
   *   · 真正的实现由 `behaviour = <函数名>` 指定
   * 所以按源码里 `name` + `behaviour` 配对，再用 `name` 去 JSON 取该武器自己的 `tuning`。
   */
  // 全库通用模式：每张表都是 `name = "..."` 紧跟 `behaviour = <ident>`。
  // 用 ability_ 前缀 + weapon_sequence 过滤，避免串到 modifier_* 表（orcabomber 曾踩）。
  const pairs: Array<{ name: string; behaviour: string }> = [];
  for (const m of unitSrc.matchAll(/name\s*=\s*"([^"]+)"\s*,\s*\n\s*behaviour\s*=\s*(\w+)/g)) {
    const [, name, behaviour] = m;
    if (name!.startsWith("ability_") && behaviour!.includes("weapon_sequence")) {
      pairs.push({ name: name!, behaviour: behaviour! });
    }
  }
  if (!pairs.length) throw new Error(`${unitId} 里找不到带 behaviour 的 modifier_sequence`);

  const rec = JSON.parse(await readFile(`data/unit/${unitId}.lua.json`, "utf8")) as {
    config: {
      combatantTuning?: {
        weaponTunings?: Array<{
          name?: string;
          muzzleCount?: number;
          modifier_sequence?: { name?: string; tuning?: unknown };
        }>;
      };
    };
  };
  const weapons = rec.config.combatantTuning?.weaponTunings ?? [];

  const out: Array<TraceResult & { ability: string; seqName: string }> = [];
  for (const { name, behaviour } of pairs) {
    const w = weapons.find((x) => x.modifier_sequence?.name === name);
    if (!w) continue;
    const file = `${behaviour.replace(/_behaviour$/, "")}.lua`;
    const abilSrc = await load(`gameplay/abilities/${file}`);
    if (!abilSrc) throw new Error(`读不到 gameplay/abilities/${file}（behaviour=${behaviour}）`);

    const rt = await createLuaRuntime(load);
    try {
      await rt.exec(unitSrc);
      await rt.exec(abilSrc);
      await rt.exec(harness(behaviour, `${unitId}_visual`, name, w.modifier_sequence?.tuning ?? {}, w.muzzleCount ?? 1));
      const raw = rt.get("__TRACE_RESULT") as { steps?: unknown; truncated?: unknown; error?: unknown } | undefined;
      out.push({
        seqName: name,
        ability: behaviour,
        steps: toArray<TraceStep>(raw?.steps),
        truncated: Boolean(raw?.truncated),
        error: typeof raw?.error === "string" ? raw.error : undefined,
      });
    } finally {
      rt.close();
    }
  }
  return out;
}

const UNITS = [
  "unit_gdi_juggernaut",
  "unit_gdi_sandstorm",
  "unit_gdi_slingshot",
  "unit_gdi_wolverine",
  "unit_gdi_kodiak",
  "unit_gdi_orcabomber",
  "unit_nod_beamcannon",
  "unit_nod_basilisk",
  "unit_nod_avatar",
  "unit_nod_scarab",
  "unit_nod_catalystgunship",
  "unit_nod_flametank",
  "unit_nod_widowmaker",
  "unit_nod_confessor",
  "unit_nod_flametroopers",
  "unit_nod_chemicalwarrior",
  "unit_nod_chemquad",
  "unit_nod_rockwyrm",
  "unit_gdi_disruptor",
];

const only = process.argv[2];
for (const u of only ? [`unit_${only.replace(/^unit_/, "")}`] : UNITS) {
  try {
    for (const t of await traceUnit(u)) {
      const fires = t.steps.filter((s) => s.kind === "fire");
      console.log(
        `${u.replace("unit_", "").padEnd(22)} ${t.ability.padEnd(44)} 步 ${String(t.steps.length).padStart(3)} 开火 ${String(fires.length).padStart(2)}次 ` +
          `落点[${fires.map((s) => s.tMs + "ms").join(", ")}]` +
          (t.truncated ? "  [持续型，已截断]" : "") +
          (t.error && !t.truncated ? `  ⚠ ${t.error}` : ""),
      );
    }
  } catch (e) {
    console.log(`${u.replace("unit_", "").padEnd(22)} ❌ ${(e as Error).message.slice(0, 100)}`);
  }
}

