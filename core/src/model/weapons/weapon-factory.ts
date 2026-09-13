/**
 * **按 `WeaponDef` 造武器机** —— 调用方不该自己挑类（挑错了就是静默错）。
 *
 * `timing.kind` **就是**分派键，而且**只有三种**（findings J49）⇒ 这里就是一个 switch，
 * 参数**原样**交给机器（`timing` 已经按三类解好了，见 `weapon-def.ts` 的 `Timing`）。
 */

import type { Clock } from "../clock.ts";
import type { WeaponDef } from "../weapon-def.ts";
import { CyclicWeapon } from "./cyclic-weapon.ts";
import { MagazineWeapon } from "./magazine-weapon.ts";
import { StagedWeapon } from "./staged-weapon.ts";
import type { WeaponMachine } from "./weapon-machine.ts";

export function weaponMachineFor(w: WeaponDef, clock: Clock): WeaponMachine {
  switch (w.timing.kind) {
    case "magazine":
      return new MagazineWeapon(clock, w.timing);
    case "staged":
      return new StagedWeapon(clock, w.timing);
    case "cyclic":
      return new CyclicWeapon(clock, w.timing);
  }
}
