/**
 * 时间显示 —— **秒**，全站唯一实现。
 *
 * 早先每个组件各写一份（`WeaponCard` 有 `fmtMs`/`fmtSec`、`WeaponTimeline` 有 `fmt`、
 * `UnitPanel` 有 `sec`），于是同一个数在三处显示成三种样子：`250ms` / `0.25s` / `0.3s`。
 * 用户要求**统一用秒**，所以收到这里。
 *
 * 位数规则：
 *   · ≥ 1s  —— 固定两位（`2.00s` / `13.00s`），和游戏面板的 `chargeUpDuration` 记法一致
 *   · < 1s  —— 最多三位、去掉多余的零，但**至少两位**（`0.25s` / `0.04s` / `0.035s`）
 *     —— 三位的必要性：飞影的每发间隔 35ms，写成 `0.04s` 就看不出与 40ms 的差别了
 */
export function fmtSec(ms: number): string {
  const v = ms / 1000;
  if (v >= 1) return `${v.toFixed(2)}s`;
  let s = v.toFixed(3).replace(/0+$/, "");
  if (s.endsWith(".")) s += "00";
  else if (s.split(".")[1]!.length === 1) s += "0";
  return `${s}s`;
}
