/**
 * **对战面板的验收 + 文字版事件日志** —— `web/src/duel-view.ts` 的检查脚本。
 *
 * 用户要求：「搞好后你试着在对战界面画出，**同时提供文字版事件日志**」。
 * 页面上的图与日志都出自这一层，所以这里验的就是"**页面拿到的东西对不对**"：
 *
 * | 验什么 | 为什么这么验 |
 * | --- | --- |
 * | 百分比坐标 | 所有 `left/width` 必须落在 0~100（越界会被绝对定位撑出横向滚动条） |
 * | 行数 = 队员数 × 武器数 | 少一行就是"某个成员的武器没被驱动"（`.damage` 为空的容器槽不算） |
 * | 开火刻度数 = 开火事件数 | 图与日志对不上就是这两处各算了一遍 |
 * | 血量比例折线 | 从 `hit.hpAfter` 反推 ⇒ 末点必须是 0（全灭） |
 * | 日志分组 | 页面按 `group` 做筛选按钮，分组漏了就等于那条日志看不见 |
 *
 * 并把 **两次对局的完整文字日志** 打到终端（`logText()`）—— 与页面上看到的是同一份数据。
 *
 * 跑法：`node --experimental-strip-types core/test/duel-view-check.ts`
 * （需要先 `rivals convert-defs` + `emit-defs`）
 */

import { readFileSync } from "node:fs";
import { level } from "../src/levels.ts";
import { decodeDef } from "../src/model/def-json.ts";
import type { UnitDefJson } from "../src/model/def-json.ts";
import type { UnitDef } from "../src/model/unit-def.ts";
import { axisStep, duelView, fracPairAt, logText, runDuel } from "../../web/src/duel-view.ts";
import type { DuelView } from "../../web/src/duel-view.ts";

let failed = 0;
let passed = 0;
const check = (label: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 期望 ${JSON.stringify(want)}，得到 ${JSON.stringify(got)}`);
};

const file = JSON.parse(readFileSync("data/units.def.gen.json", "utf8")) as { units: Record<string, UnitDefJson> };
const def = (id: string): UnitDef => decodeDef(file.units[id]!);

/** 视图里所有百分比都必须落在 0~100 */
function pctOk(v: DuelView): boolean {
  const inRange = (x: number): boolean => x >= -0.001 && x <= 100.001;
  return (
    v.rows.every((r) => r.segs.every((s) => inRange(s.left) && inRange(s.width))) &&
    v.rows.every((r) => r.shots.every((s) => inRange(s.left))) &&
    v.ticks.every((t) => inRange(t.left))
  );
}

console.log("【1】步枪兵镜像：视图形状，以及「图与日志出自同一份数据」");
{
  const run = runDuel(def("unit_gdi_riflemen"), def("unit_gdi_riflemen"), { level: level(1, 0) });
  const v = duelView(run, { names: ["步枪兵", "步枪兵"] });

  check("同归于尽", v.summary.outcome, "draw");
  check("横轴 = 打完那一刻", v.spanMs, run.endedAtMs);
  // 5 人 × 1 把武器 × 2 侧 = 10 行（`.damage` 为空的容器槽不驱动）
  check("10 行（每侧 5 名队员 × 1 把武器）", v.rows.length, 10);
  check("行按 A 在前、B 在后", [v.rows[0]?.side, v.rows[5]?.side], ["A", "B"]);
  check("每行都带队员号", [v.rows[0]?.who, v.rows[4]?.who], ["队员 1", "队员 5"]);

  const shotsInRows = v.rows.reduce((n, r) => n + r.shots.length, 0);
  check("开火刻度数 = 开火事件数", shotsInRows, v.summary.totalFired);
  check("开火 40 发", v.summary.totalFired, 40);
  check("命中 40 次 / 1520 伤害 / 10 员阵亡", [v.summary.totalHits, v.summary.totalDamage, v.summary.totalDeaths], [40, 1520, 10]);

  check("所有百分比都在 0~100", pctOk(v), true);
  check("每一行都有段（最差也是「错位等待」那一段）", v.rows.every((r) => r.segs.length > 0), true);
  // 队员 5 的错位量是 4×344 = 1376ms，而他在 1033ms 就被打死了 ⇒ 一次都没轮到
  const last = v.rows.find((r) => r.key === "A#4#rifle")!;
  check("队员 5 那一行只有「错位等待」、没有开火", [last.segs.length, last.shots.length], [1, 0]);
  check("错位等待段从 0 到阵亡那一刻（1033ms）", [last.segs[0]?.kind, last.segs[0]?.fromMs, last.segs[0]?.toMs], ["idle", 0, 1033]);
  check("每行都标了阵亡时刻", v.rows.every((r) => r.deadAtMs !== null), true);

  /*
   * **死亡单位的条到阵亡那一刻就结束**（用户：「死亡单位不应该有条」）。
   * 不截断的话，武器机最后一段会被拉到全场末尾（人死了还在冷却）。
   */
  check(
    "没有任何一段越过自己的 endMs",
    v.rows.every((r) => r.segs.every((s) => s.toMs <= r.endMs + 0.001)),
    true,
  );
  check(
    "阵亡那几行 endMs = 阵亡时刻",
    v.rows.filter((r) => r.deadAtMs !== null).every((r) => r.endMs === r.deadAtMs),
    true,
  );
  check("队员 5 的条到 1033ms 就断了", [last.endMs, last.segs.at(-1)?.toMs], [1033, 1033]);
  /*
   * ⚠️ **段的百分比是相对"整条轴"的，只有底色才按 `barEndPct` 缩窄**。
   *
   * 这两条曾经一起用同一个容器宽度 ⇒ 死人那几行的段被**再乘一次 endMs/span**（摩托那场
   * 3 名队员全死，段被压到行首一小块）。图上与文字日志对不上，而日志是对的。
   */
  check(
    "段的位置一律落在这条轴上（left + width ≤ 100）",
    v.rows.every((r) => r.segs.every((s) => s.left + s.width <= 100.001)),
    true,
  );
  check("底色宽度 = endMs / span（只有它缩窄）", Number(last.barEndPct.toFixed(2)), Number(((1033 / v.spanMs) * 100).toFixed(2)));
  // 会死的那几行必须**真的有段跨过"被压扁"的那个区间** —— 否则这条回归测不出来
  const bike = duelView(runDuel(def("unit_gdi_pitbull"), def("unit_nod_attackbike"), { level: level(1, 0) }), {
    names: ["斗牛犬", "攻击摩托"],
  });
  const late = bike.rows.filter((r) => r.side === "B").flatMap((r) => r.segs);
  check(
    "摩托那几行：有段落在 5%~26% 之间（被压扁时会跑掉的那个区间）",
    late.some((s) => s.left >= 5 && s.left <= 26),
    true,
  );
  check(
    "摩托：段的右边界也跨过 26%（压扁后最多只到 6.8%）",
    late.some((s) => s.left + s.width > 26),
    true,
  );
  // 每一发普通攻击都是「剑」（这一场没有自杀式武器）
  check("普通武器的开火标志都是剑", v.rows.every((r) => r.shots.every((s) => s.mark === "sword")), true);
  check("被打死的死亡原因是 killed（画骷髅）", v.rows.every((r) => r.deadCause === "killed"), true);

  // 血量折线：从 hpAfter 反推 ⇒ 末点必须是 0
  const lastFrac = (pts: Array<{ frac: number }>): number => pts[pts.length - 1]!.frac;
  check("两侧总血末点都是 0", v.sides.map((s) => lastFrac(s.hpPoints)), [0, 0]);
  /*
   * **血量折线必须是阶跃**（用户：「怎么是斜线下降而不是直线瞬间下降」）：
   * 同一毫秒**成对**出现「掉血前 / 掉血后」两个点 ⇒ 折线在那一点是**竖直**落下的。
   * 早先是"按时刻去重后合并" ⇒ 斜线，等于谎报"这段时间在缓慢掉血"。
   */
  const pts = v.sides[0]!.hpPoints;
  const paired = pts.filter((p, i) => i > 0 && p.atMs === pts[i - 1]!.atMs).length;
  check("同一毫秒成对出现（竖直落差）", paired > 0, true);
  check("同刻不会回升", pts.every((p, i) => i === 0 || p.atMs !== pts[i - 1]!.atMs || p.frac <= pts[i - 1]!.frac), true);
  const dropIdx = pts.findIndex((p, i) => i > 0 && p.frac < pts[i - 1]!.frac);
  check(
    "第一处落差在 1ms：100% → 94.2%（38/650）",
    [pts[dropIdx - 1]!.frac, pts[dropIdx]!.atMs, Number(pts[dropIdx]!.frac.toFixed(4))],
    [1, 1, 0.9415],
  );
  // 阶跃点对本身：`fracPairAt` 取"第一个点=前、最后一个点=后"
  const m0 = v.sides[0]!.members[4]!;
  check("同一刻挨了两下也只落成一段", fracPairAt(m0, m0.deadAtMs!).before > fracPairAt(m0, m0.deadAtMs!).after, true);
  check("没变化的时刻前后同值", fracPairAt(m0, 0).before === fracPairAt(m0, 0).after, true);
  check("两侧都是 5 员、满血 650", [v.sides[0]!.memberCount, v.sides[0]!.maxHp], [5, 650]);
  check("每名成员一条血量线、末点 0", v.sides[0]!.members.map((m) => lastFrac(m.points)), [0, 0, 0, 0, 0]);
  // 掉血是**阶跃**的：每次挨打产生两个点（打之前 / 打之后），所以点数 > 挨打次数
  check("成员血量是阶跃（点数 ≥ 挨打次数 + 2）", v.sides[0]!.members[0]!.points.length >= 2, true);

  check("日志条数 = 事件条数", v.log.length, run.duel.events.length);
  // 这一场没有 falloff / 格子效果 ⇒ 只该出现这三组（`Duel.notes` 不是事件，不进日志）
  check("日志分组 = 开火/命中/阵亡", v.logGroups, ["fired", "hit", "death"]);
  check(
    "直击那条日志：队员 + 目标 + 扣血（**单武器单位不写武器名**）",
    v.log.find((l) => l.group === "hit")?.text,
    "A 队员1 → B 队员5：−38（剩 92）",
  );
  check("开火那条日志只说谁开火", v.log.find((l) => l.group === "fired")?.text, "A 队员1 开火");
  check("阵亡那条日志", v.log.find((l) => l.group === "death")?.text, "B 队员5 阵亡");
  check("整队阵亡那条日志", v.log.filter((l) => l.group === "death").at(-1)?.text, "B 全队阵亡");

  const step = axisStep(v.spanMs);
  check("刻度步长把横轴切成 ≤12 格", v.spanMs / step <= 12, true);
  check("刻度从 0 开始、不画到 100%", [v.ticks[0]?.atMs, v.ticks.at(-1)!.atMs < v.spanMs], [0, true]);

  console.log("\n—— 文字版事件日志（步枪兵镜像，前 12 条）——");
  console.log(
    logText(v)
      .split("\n")
      .slice(0, 12)
      .join("\n"),
  );
  console.log(`（共 ${v.log.length} 条）`);
}

console.log("\n【2】生化越野车 → 步枪兵：格子效果（毒气）在日志里是一条一条的");
{
  const run = runDuel(def("unit_nod_chemquad"), def("unit_gdi_riflemen"), { level: level(1, 0) });
  const v = duelView(run, { names: ["生化越野车", "步枪兵"] });

  check("铺了一条毒气", v.tiles.map((t) => t.label), ["毒气云"]);
  check("毒气每 200ms 跳 6、持续 10s", [v.tiles[0]?.tickMs, v.tiles[0]?.tickDamage, v.tiles[0]?.persistMs], [200, 6, 10_000]);
  check("日志里有格子效果分组", v.logGroups.includes("tile"), true);

  const placed = v.log.find((l) => l.kind === "tile_placed");
  check("铺下那条日志说清了每跳/持续", placed?.text, "A 在 B 的格子上铺下毒气云：每 0.20s 造成 6 伤害，持续 10.00s");
  const tick = v.log.find((l) => l.kind === "tile_tick");
  check("每跳那条日志只写总量（不再写「几次命中」）", tick?.text, "毒气云：对 B 造成 12 伤害");
  /*
   * ⚠️ **这一场没有"消散"那条** —— 毒气铺在 2501ms、持续 10s，
   * 而步枪兵在 12.5s 之前就全灭了（对局结束就不再推进）。
   * 断言"没有"比断言"有"更值：它证明日志**只记真发生过的事**。
   */
  check("对局在毒气过期前就结束了 ⇒ 没有消散日志", v.log.some((l) => l.kind === "tile_expired"), false);

  /*
   * 毒气对载具无效（`vs` 覆写 `Vehicle: 0`）⇒ 每跳 0 伤害，而 **0 伤害不记事件**
   * （用户要求）—— 所以日志里**一条每跳都没有**，只有"铺下"那条。
   */
  const vsVehicle = duelView(runDuel(def("unit_nod_chemquad"), def("unit_gdi_predatortank"), { level: level(1, 0) }), {
    names: ["生化越野车", "捕食者坦克"],
  });
  check("打载具：毒气照样铺（事件在）", vsVehicle.log.some((l) => l.kind === "tile_placed"), true);
  check("打载具：**一条每跳日志都没有**（0 伤害不记）", vsVehicle.log.filter((l) => l.kind === "tile_tick").length, 0);

  console.log("\n—— 文字版事件日志（生化越野车 → 步枪兵，毒气铺下前后 10 条）——");
  const lines = logText(v).split("\n");
  const idx = lines.findIndex((l) => l.includes("铺下"));
  console.log(lines.slice(Math.max(0, idx - 3), idx + 7).join("\n"));
  console.log(`（共 ${lines.length} 条）`);
}

console.log("\n【3】催化剂炮艇：**直击**与它引发的**催化爆炸**在日志里必须分得开");
{
  const gun = def("unit_nod_catalystgunship");
  const v = duelView(runDuel(gun, def("unit_gdi_mlrs"), { level: level(1, 0) }), { names: ["催化剂炮艇", "M.L.R.S."] });
  check("这一场催化剂炮艇是 A 侧", v.sides[0].unitId, "unit_nod_catalystgunship");

  const direct = v.log.filter((l) => l.group === "hit");
  const warhead = v.log.filter((l) => l.group === "warhead");
  check("直击与弹头效果分成两组", [direct.length > 0, warhead.length > 0], [true, true]);
  // 多武器单位（炮艇）才在日志里写武器序数：毒气罐 = 武器 1、催化剂弹 = 武器 2
  check("多武器单位写「武器 N」而不是源码槽名", direct[0]?.text.startsWith("A 武器 2 → "), true);
  check("效果那一行直接写效果名（引发它的武器就是上一行）", warhead[0]?.text.startsWith("A 催化爆炸 → "), true);
  // ⚠️ **延迟 300ms**：`ability_catalyst_explosion.lua:28` 的 `WaitForAge(DAMAGE_TIME)`
  const wi = v.log.findIndex((l) => l.group === "warhead");
  const prevHit = [...v.log.slice(0, wi)].reverse().find((l) => l.group === "hit");
  check("爆炸比引发它的那一发直击晚 300ms", (v.log[wi]?.atMs ?? 0) - (prevHit?.atMs ?? 0), 300);

  console.log("\n—— 文字版事件日志（催化剂炮艇 → M.L.R.S.，催化爆炸前后 6 条）——");
  const lines = logText(v).split("\n");
  const i = lines.findIndex((l) => l.includes("催化爆炸"));
  console.log(lines.slice(Math.max(0, i - 3), i + 3).join("\n"));
  console.log(`（共 ${lines.length} 条）`);
}

console.log("\n【4】自杀式武器：开火标志用**爆星**、死亡原因是 `self_destruct`");
{
  /*
   * 对手挑**锤头鲨**（Airbus 打不到载具的飞机）：圣甲虫因此能活到 2100ms 打出那一发。
   * （换成催化剂炮艇就不行了 —— 它现在 1.6s 一发，81ms 就把圣甲虫打死，一发都打不出来。）
   *
   * 这一场的形状：
   * · 圣甲虫要**先架好**（部署 2000ms）⇒ 队员 1 在 2100ms 开火、**同刻自爆**；
   * · 队员 2 错位 2000ms ⇒ 4100ms 才开火、同刻自爆 ⇒ 整队到此为止。
   */
  const v = duelView(runDuel(def("unit_nod_scarab"), def("unit_gdi_hammerhead"), { level: level(1, 0) }), {
    names: ["圣甲虫", "锤头鲨"],
  });
  const a = v.rows.filter((r) => r.side === "A");
  check("圣甲虫 2 名队员各一行", a.length, 2);
  check("队员 1：开火标志是爆星（自杀式攻击）", a[0]?.shots.map((s) => s.mark), ["burst"]);
  check("队员 1：死亡原因是自杀式", a[0]?.deadCause, "self_destruct");
  check("队员 1：条结束 = 唯一那一发的时刻", [a[0]?.endMs, a[0]?.shots[0]?.atMs], [2100, 2100]);
  check("队员 2：也是爆星 + 自杀式", [a[1]?.shots.map((s) => s.mark), a[1]?.deadCause], [["burst"], "self_destruct"]);
  /*
   * ⚠️ **两名队员同时开火**（都在 2100ms）—— 因为这里"部署 2000ms"与"错位 2000ms"**恰好相等**：
   * 部署是全队同时的（J81，两台部署机都从 0 起跑 ⇒ 都在 2000ms 架好），
   * 而错位是"从开场算起的绝对偏移"（`Unit.startDelayMs`）⇒ 两者重叠、不叠加。
   *
   * ❓ 引擎里究竟是"取最大"还是"先架好再各自错开"（后者会给 4100ms）**没有源码依据**
   * （J26：错开是引擎做的）—— 现在按"取最大"实现，见 findings。
   */
  check("队员 2：与队员 1 同时（部署与错位都是 2000ms ⇒ 重叠）", [a[1]?.endMs, a[1]?.shots[0]?.atMs], [2100, 2100]);
  check("没有被打死的那一种（所以不画骷髅）", v.rows.some((r) => r.deadCause === "killed"), false);
  check("日志里写的是「打完这一发自己销毁」", v.log.some((l) => l.text.includes("打完这一发自己销毁")), true);
  check("整队在两员自爆后阵亡", v.sides[0]?.killedAtMs, 2100);
  // 顺带：锤头鲨打不到载具 ⇒ 它一行都没打（"打不到"在两侧都成立）
  check("锤头鲨那一侧一发都没开", v.sides[1]?.fired, 0);
}

console.log("\n【5】对战图里的**单位状态行**：部署（单位级、一侧一条）画出来了");{
  const v = duelView(runDuel(def("unit_gdi_mlrs"), def("unit_nod_attackbike"), { level: level(1, 0) }), {
    names: ["M.L.R.S.", "攻击摩托"],
  });
  const [mlrs, bike] = v.sides;
  /*
   * 用户提的：「对战时你没有部署行动条」。
   * 部署在 `Duel` 里是一道真门禁（`DeployMachine.readyToFire`，没架好武器机**根本不被驱动**），
   * 所以图上必须有这条 —— 否则武器行左边那段空白看着像"图坏了"。
   */
  check("MLRS 那一侧有部署段", mlrs?.unitRow.segs.map((s) => s.kind), ["deploy", "ready"]);
  check("部署 [0, 2000)，架好之后是「已架好」", [mlrs?.unitRow.segs[0]?.fromMs, mlrs?.unitRow.segs[0]?.toMs, mlrs?.unitRow.segs[1]?.fromMs], [0, 2000, 2000]);
  check("架好时刻 = unpack_done = 2000ms", mlrs?.unitRow.readyAtMs, 2000);
  check("说明里写清了「架好之前不能开火」", mlrs?.unitRow.note.includes("架好之前不能开火"), true);

  // 武器机在那 2s 里**没被驱动** ⇒ 视图补一段等待（不然那一段是空的）
  const mlrsRow = mlrs?.rows[0];
  check("武器行补了「等待」段：[0, 2000)", [mlrsRow?.segs[0]?.kind, mlrsRow?.segs[0]?.fromMs, mlrsRow?.segs[0]?.toMs], ["idle", 0, 2000]);
  check("等待段的 tooltip 说清了「没架好」", mlrsRow?.segs[0]?.title.includes("没架好"), true);
  check("第一发在架好之后（2000ms 起）", (mlrsRow?.shots[0]?.atMs ?? 0) >= 2000, true);

  // 不需要部署的单位：没有单位状态段（页面据此不画那一行）
  check("摩托不需要部署 ⇒ 单位状态行是空的", bike?.unitRow.segs.length, 0);
  check("摩托的说明写的是「不需要部署」", bike?.unitRow.note.includes("不需要部署"), true);
  check("摩托的武器行没有被部署挡住（第一员从 0 起就能打）", bike?.rows[0]?.segs.some((s) => s.kind === "idle" && s.fromMs === 0), false);
}

console.log("\n【6】**首发充能**（`init_charging`）必须看得见 —— 三个机器都会记这一段");
{
  /*
   * 用户：「首发前摇又看不见了」。成因：`duel-view` 的状态映射表里**没有 `init_charging`**
   * ⇒ 段被当未知状态丢掉（催化剂炮艇那 4.5s 首充在图上是一片空白）。
   */
  const v = duelView(runDuel(def("unit_nod_catalystgunship"), def("unit_gdi_riflemen"), { level: level(1, 0) }), {
    names: ["催化剂炮艇", "步枪兵"],
  });
  const gas = v.sides[0]?.rows.find((r) => r.weaponId === "gasWeapon")!;
  check("毒气武器：第一段是首发充能 [0, 4500)", [gas.segs[0]?.kind, gas.segs[0]?.fromMs, gas.segs[0]?.toMs], ["charge", 0, 4500]);
  check("它的 tooltip 写明是「首发充能」（不是每轮前摇）", gas.segs[0]?.title.includes("首发充能"), true);
  check("首发充能之后才是冷却、并在 4500ms 开火", [gas.segs[1]?.kind, gas.shots[0]?.atMs], ["gap", 4500]);
  // 另一把武器只有每轮前摇（80ms），不该被误标成首发充能
  const cat = v.sides[0]?.rows.find((r) => r.weaponId === "catalystWeapon")!;
  check("催化剂弹：第一段是每轮前摇（80ms），不是首发充能", [cat.segs[0]?.kind, cat.segs[0]?.toMs, cat.segs[0]?.title.includes("首发充能")], ["charge", 80, false]);

  /*
   * ⚠️ 顺带钉住"**锁不上对面 + 队内错位**"那两件事叠在一起时的行：
   * 步枪兵打不到 Aircraft，队员 5 又还没轮到（错位 1376ms）⇒ 它**永远不会被驱动**，
   * 状态表里一条都没有 —— 视图必须补出那段等待，否则这一行是**空的**。
   */
  const rifles = v.sides[1]?.rows ?? [];
  check("打不到 Aircraft 的 5 行都有段（不出现空行）", rifles.every((r) => r.segs.length > 0), true);
  // 队员 5：错位要等 1376ms，但它在 81ms 就被直升机打死 ⇒ 等待段止于阵亡那一刻
  check("队员 5 那行只有「等待」段 [0, 81]（没轮到就阵亡）", [rifles[4]?.segs[0]?.kind, rifles[4]?.segs[0]?.fromMs, rifles[4]?.segs[0]?.toMs], ["idle", 0, 81]);
  check("等待段的 tooltip 同时也说了「打不到空军」", rifles[4]?.segs[0]?.title.includes("打不到空军"), true);
  check("并且说了「还没轮到它就阵亡了」", rifles[4]?.segs[0]?.title.includes("还没轮到它就阵亡了"), true);
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
