/**
 * 战斗时间线的**渲染模型** —— 把 `sim.ts` 的结果 + `derived.attack.tracks` 编成
 * "每个队员一行"的甘特条。
 *
 * ## 与单位页的时序图**共用同一份段算法**
 *
 * 段（前摇 / 开火 / 冷却 / 装填）全部来自 `squad-timeline.ts` 的 `baseSegsOf()`
 * —— 与 `WeaponTimeline.vue` 是同一个函数，**不再各写一遍**。
 * 于是两处的段语义、配色、DOM 结构一致（用户："为什么不能直接用和时序图那边一样的样式"）。
 *
 * 战斗侧只多三样东西：
 *   · **队员错开**（`i × separation_ms`，I44）与**按周期重复**（超出一个周期的交叠要看得见）
 *   · **阵亡**：该员阵亡后不再有段，只留一条 `dead` 底色
 *   · **挨打记录**：给血量细条用（`sim.ts` 的 `hits`）
 *
 * ⚠️ `sequence` 的段**只演一次**（`lasts_ms` 为空的段按整轮算），不做周期重复 ——
 * 与 `sim.ts` 同规则（万钧巨炮 stage1→2→3 是接替）。
 */

import type { Track } from "@rivals/core/derive";

import type { SimResult } from "./sim.ts";
import { baseSegsOf, baseStart, cycleMsOf, deploySeg, type Seg } from "./squad-timeline.ts";

export interface ChartRow {
  side: 0 | 1;
  member: number;
  label: string;
  maxHp: number;
  /** 相对于该队员起点的段（含多轮重复），已按阵亡截断 */
  segs: Array<Seg & { dead?: boolean }>;
  /** 该员自己开的枪 */
  shots: Array<{ t: number; aoe: boolean; reachable: boolean; damage: number }>;
  /** 挨打的时刻（画血量细条与竖线） */
  hits: Array<{ t: number; damage: number }>;
  deathT: number | null;
  /** 这一员是不是**开火后自爆**销毁的（`Death.cause`）—— 决定画骷髅还是自爆标志 */
  selfDestruct: boolean;
}

export interface ChartModel {
  rows: ChartRow[];
  /** 横轴长度 = 战斗结束（或模拟上限） */
  spanMs: number;
  /**
   * **未部署的单位"架设完成"在哪一刻**（毫秒）—— 画一个小标注用。
   *
   * ⚠️ 它是一个**点**，不是一段：那 2 秒的代价已经体现在首发时刻里
   * （`sim.ts` 的 `deployLead`），画成 2 秒宽的段等于把同一段时间算两次
   * （用户："圣甲虫部署条不会把其他行为往前推, 导致出现了冷却条(尽管死了)"）。
   */
  deploy: Array<{ side: 0 | 1; atMs: number; ms: number; mustDeploy: boolean; label: string }>;
}

/**
 * **一条基础周期里，"开火"落在哪个相对时刻** —— 用它把周期锚到真实首发上。
 *
 * 取所有 `fire` 段里最靠前的那个 `at`（一击型就是 `charge_ms` 处）。
 * 取不到（例如只画了 `charge`）就退到 `baseStart`。
 */
function fireOffsetOf(base: Seg[]): number {
  const fires = base.filter((s) => s.kind === "fire").map((s) => s.at);
  if (fires.length) return Math.min(...fires);
  return baseStart(base);
}

export function buildChart(tracksA: Track[], tracksB: Track[], result: SimResult): ChartModel {
  const spanMs = Math.max(result.endedAtMs, 1);
  const rows: ChartRow[] = [];
  const tracksOf: [Track[], Track[]] = [tracksA, tracksB];
  const deploy: ChartModel["deploy"] = [];

  for (const side of [0, 1] as const) {
    const info = result.sideInfo[side]!;
    const tracks = tracksOf[side];
    const base = baseSegsOf(tracks);
    const cycle = cycleMsOf(tracks, base);
    const separationMs = info.separationMs;
    const count = Math.max(1, info.members);

    /*
     * **排布：左方正序（1→N）、右方倒序（N→1）** —— 于是两侧在中间"相接"：
     *
     * ```
     *   左 队员 1     ← 左方首发最早（也是最后才死的那员）
     *   左 队员 2
     *   …
     *   左 队员 N
     *   右 队员 N     ← 右方最后开火的那员，紧挨左侧末位
     *   …
     *   右 队员 1
     * ```
     *
     * ⚠️ **不要两侧都倒序**：那样会排成 `5..1 | 5..1`，两军的"1 号"分别在最上和最下，
     * 中间的相邻两行反而是各自的末位，读起来别扭（用户指出）。
     * 注意 `#1` 对左右两侧的含义不同：它是**数组下标 0**，对左方是首发最早的那员、
     * 对右方同样是下标 0（其相位 `0 × 错开` 最早）—— 两侧都是"相位最靠前"的那个。
     */
    const order = Array.from({ length: count }, (_, i) => i);
    const members = side === 0 ? order : order.slice().reverse();

    for (const member of members) {
      const death = result.deaths.find((d) => d.side === side && d.member === member);
      const deadAt = death ? death.t : null;
      const limit = Math.min(spanMs, deadAt ?? spanMs);

      const segs: Array<Seg & { dead?: boolean }> = [];
      /*
       * **一行 = [部署段] + [等待段] + 真实开火**（用户给的模型）：
       *
       * ```
       * 队员 1: [部署 2.00s][前摇 0.10s][开火]            ← 部署是**全队一次**的动作
       * 队员 2: [部署 2.00s][等待 …][前摇 0.10s][开火]    ← 等待 = 它在小队里的相位
       * ```
       *
       * ⚠️ **周期锚定在 `sim` 给出的真实开火时刻上，不自己用 `i × 错开` 重算**。
       * 这是踩了三次才定下来的：
       * ① 早先"无限重复到轴末" ⇒ 死了还挂着冷却（"导致出现了冷却条(尽管死了)"）；
       * ② 改成"用 ticks 出现次数当爆发轮数" ⇒ **每人多画一轮**（圣甲虫 2 人的
       *    `fire` 各自出现在两轮里，被算成 2 次），于是第 1 员在 `0.10s` 还多一条前摇；
       * ③ 相位两边各算一次 ⇒ 第 2 员实际 `4.00s` 开火，图上却画在 `2.10s`。
       * 现在只认一个事实来源：`result.shots` 里**这一员的**开火时刻。
       */
      /*
       * **部署段**（只由下标 0 那一名队员代表全队画一次）—— 它真的占时间轴、把后面推后
       * （用户："难道不是加入部署段,第一只加入前摇段第二只根据自己在小队的位置加入 (2-1)*2s
       * 的等待段之类的吗"）。段宽 = `deployMs`，与 `sim` 的 `deployLead` 是同一件事的两种呈现。
       */
      const deployShift = !info.deployed && info.deployMs > 0 ? info.deployMs : 0;
      if (deployShift > 0 && member === 0) {
        segs.push(
          deploySeg(
            deployShift,
            `全队部署 ${(deployShift / 1000).toFixed(2)}s` +
              (info.mustDeployToFire
                ? "（架完才能开火，后面的段整体推后这么久）"
                : "（架完才有减伤，可中途取消）"),
          ),
        );
      }
      /*
       * **这一员的真实开火时刻**（唯一的锚点）与**整条周期的平移量**。
       *
       * ⚠️ 平移量**不是** `首发 − baseStart(base)`：`baseStart` 是所有段里最靠左的 `at`
       * （前摇从 **0** 开始 ⇒ 恒为 0），而开火点在周期**内部**的 `fireAt = start + charge`。
       * 正确做法是把"周期里的开火位置"挪到首发上 —— 即平移 `首发 − fireOffsetOf(base)`。
       * 早先那一版把整条周期推到了首发**之后**，于是前摇被 clamp 成 0 宽、图上只剩"等待 + 一击"。
       */
      const ownShots = result.shots
        .filter((sh) => sh.side === side && sh.member === member && !sh.hazard)
        .map((sh) => sh.t);
      const first = ownShots[0];
      const off0 = first === undefined ? 0 : first - fireOffsetOf(base);

      /*
       * **等待段 = 开场延迟 + 队员相位**（用户："开场延迟段也没进时间线"）。
       *
       * 它是行首到"整条周期开始"之间的那段空白，由两部分拼成，来源完全不同：
       *   · **开场延迟**（`openingDelayMs`，用户填的冷却余量 + 转身 —— 是**输入**）
       *   · **队员相位**（`i × 错开`，小队成员依次开火）
       *
       * ⚠️ 不自己用 `i × separationMs` 重算相位：`sim` 已经把两件事都算进首发时刻了，
       * 这里倒推，**永远不会与 `sim` 打架**。
       */
      if (first !== undefined) {
        const waitMs = off0 - deployShift;
        if (waitMs > 1e-6) {
          const opening = info.openingDelayMs;
          const phase = Math.max(0, waitMs - opening);
          const parts = [
            opening > 0 ? `开场延迟 ${(opening / 1000).toFixed(2)}s` : "",
            phase > 0 ? `队员相位 ${(phase / 1000).toFixed(2)}s` : "",
          ].filter(Boolean);
          segs.push({
            kind: "gap",
            at: deployShift,
            ms: waitMs,
            ticks: [],
            title: `等待 ${(waitMs / 1000).toFixed(2)}s：${parts.join(" + ") || "等轮到自己"}`,
          });
        }
      }

      if (first !== undefined) {
        for (const shotT of ownShots) {
          const off = off0 + (shotT - first);
          for (const s of base) {
            if (s.ms <= 0 && !(s.ticks?.length)) continue;
            const at = s.at + off;
            if (at > limit) continue;
            const ms = Math.min(s.ms, Math.max(0, limit - at));
            // 零宽段不画：`charge`/`gap` 被 `limit`（阵亡时刻）裁成 0 时留在 DOM 里
            // 只会产生看不见的节点与悬停热点（`fire` 是"一击"，零宽要靠最小宽度显示，故例外）
            if (ms <= 0 && s.kind !== "fire") continue;
            segs.push({
              ...s,
              at,
              ms,
              ticks: (s.ticks ?? []).map((x) => x + off).filter((x) => x <= limit),
            });
          }
        }
      }
      if (deadAt !== null) {
        segs.push({ kind: "gap", at: deadAt, ms: Math.max(0, spanMs - deadAt), ticks: [], title: "已阵亡", dead: true });
      }

      rows.push({
        side,
        member,
        label: count > 1 ? `队员 ${member + 1}` : info.label,
        maxHp: info.maxHp,
        segs,
        shots: result.shots
          .filter((s) => s.side === side && s.member === member)
          .map((s) => ({ t: s.t, aoe: s.aoe, reachable: s.reachable, damage: s.damage })),
        hits: result.hits
          .filter((h) => h.side === side && h.member === member)
          .map((h) => ({ t: h.t, damage: h.damage })),
        deathT: deadAt,
        selfDestruct: death?.cause === "selfDestruct",
      });
    }
  }

  return { rows, spanMs, deploy };
}
