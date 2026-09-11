# 攻击方法 ↔ 单位对照

由 `_attack_methods.py` 从 `data/{unit,commander}/*.lua.json` 生成。

**核心结论**：游戏里**没有「N 种可复用攻击方法」** —— 是 **61 把常规武器 + 22 把单位专属能力序列**。
常规武器靠 `burstTiming` 驱动；能力序列各自有一个 `ability_<单位>_weapon_sequence`，
名字全是单位专属、无通用名，参数结构也不同。见 `docs/findings.md` 的 I72/I73。

共 83 把武器。

---

## 一、能力序列武器（22 把）

`modifier_sequence.behaviour.name` 即能力名。**参数结构各不相同，需逐个核对**。

| 单位 | 英文名 | 武器 | 伤害 | 关键参数 |
| --- | --- | --- | --- | --- |
| 音波坦克 `unit_gdi_disruptor` | Disruptor | `cannon` | None | burst{numToBurst=1} · attackCount=20 · beamWidth=6 · damage{default=26, override=['Structure', 'Vehicle']} · initialChargeUpMs=3000 · tickPeriodMs=40 |
| 神像机甲 `unit_gdi_juggernaut` | Juggernaut | `rockets` | None | burst{cooldown=4, chargeUpDuration=0.25, numToBurst=1} · delayAfterShot=250 · durationBetweenVolley=2500 · initialChargeUpMs=500 · volleyChargeUpTime=0 |
| 钢爪神像机甲 `unit_gdi_juggernaut_ST` | Steel Talon Juggernaut | `rockets` | None | burst{cooldown=1.425, chargeUpDuration=0.25, numToBurst=1} · delayAfterShot=475 · durationBetweenVolley=0 · initialChargeUpMs=0 · volleyChargeUpTime=0 |
| 科迪亚克 `unit_gdi_kodiak` | Kodiak | `rocketLauncher` | 1500 | burst{numToBurst=1} · delayAfterShot=1000 · durationBetweenVolley=3000 · initialChargeUpMs=500 · volleyChargeUpTime=0 |
| 虎鲸轰炸机 `unit_gdi_orcabomber` | Orca Bomber | `targetSelector` | None | burst{cooldown=1, chargeUpDuration=0.7, numToBurst=1} |
| 沙暴导弹车 `unit_gdi_sandstorm` | Sandstorm | `cannon` | 150 | burst{numToBurst=1} · burstChargeUpDuration=0 · burstCooldown=4000 · initialChargeUpMs=0 · maxTargetSquadsCount=3 |
| 钢爪沙暴导弹车 `unit_gdi_sandstorm_ST` | Steel Talon Sandstorm | `cannon` | 150 | burst{numToBurst=1} · burstChargeUpDuration=0 · burstCooldown=3000 · initialChargeUpMs=0 · maxTargetSquadsCount=5 |
| 弹弓 `unit_gdi_slingshot` | Slingshot | `cannon` | 54 | burst{numToBurst=1} · burstCooldown=180 · chargeUpDuration=0 · initialChargeUpMs=0 · muzzleStrategy=RoundRobin |
| 狼獾机甲 `unit_gdi_wolverine` | Wolverine | `guns` | 45 | burst{numToBurst=1} · burstCooldown=190 · chargeUpDuration=0 · initialChargeUpMs=0 · muzzleStrategy=RoundRobin |
| 圣灵 `unit_nod_avatar` | Avatar | `laser` | None | burst{numToBurst=1} · damage{default=160, override=['Infantry', 'Harvester']} · initialChargeUpMs=300 · tickPeriodMs=250 |
| 圣灵 `unit_nod_avatar` | Avatar | `fire` | None | burst{numToBurst=1} · damage{default=140, override=['Structure', 'Vehicle']} · initialChargeUpMs=0 · tickPeriodMs=500 |
| 蛇怪 `unit_nod_basilisk` | Basilisk | `rocketLauncher` | None | burst{numToBurst=1} · initialChargeUpMs=300 · stage1{attackCount=8, tickPeriodMs=250} · stage2{tickPeriodMs=250} |
| 万钧巨炮 `unit_nod_beamcannon` | Giga-Cannon | `cannon` | 150 | burst{numToBurst=1} · initialChargeUpMs=500 · stage1{attackCount=12, tickPeriodMs=250} · stage2{attackCount=24, sideTargetCount=2, tickPeriodMs=250} · stage3{sideTargetCount=3, tickPeriodMs=250} · storeChargeTimeMs=700 |
| 催化剂武装直升机 `unit_nod_catalystgunship` | Catalyst Gunship | `gasWeapon` | 25 | burst{numToBurst=1} · catalystBurst{cooldown=1600, initialChargeUpMs=0} · gasBurst{cooldown=6000, initialChargeUpMs=4500} · gasCloudModifierId=modifier_chem_warrior_gas_cloud · initialChargeUpMs=0 · storeGasChargeTimeMs=1000 |
| 生化战士 `unit_nod_chemicalwarrior` | Chemical Warriors | `rifle` | 20 | burst{numToBurst=1} · burstCooldown=500 · gasCloudModifierId=modifier_chem_warrior_gas_cloud · initialChargeUpMs=0 · spawnGasTimeMs=750 |
| 生化越野车 `unit_nod_chemquad` | Chem Buggy | `cannon` | 72 | burst{numToBurst=1} · burstCooldown=500 · gasCloudModifierId=modifier_chem_warrior_gas_cloud · initialChargeUpMs=0 · spawnGasTimeMs=2100 |
| 忏悔者 `unit_nod_confessor` | Confessor | `rifle` | 40 | burst{numToBurst=1} · burstCooldown=400 · chargeUpDuration=0 · initialChargeUpMs=0 |
| 火焰坦克 `unit_nod_flametank` | Flame Tank | `cannon` | None | burst{numToBurst=1} · burstCooldown=500 · damageMain{default=380, override=['Structure', 'Vehicle']} · damageSide{default=380, override=['Structure', 'Vehicle']} · initialChargeUpMs=0 |
| 烈焰之手 `unit_nod_flametroopers` | Flame Troopers | `rifle` | 75 | burst{numToBurst=1} · burstCooldown=2000 · chargeUpDuration=500 · initialChargeUpMs=0 · muzzleStrategy=All |
| 深岩巨虫 `unit_nod_rockwyrm` | Rockworm | `rifle` | None | burst{numToBurst=1} · burstCooldown=3750 · chargeUpDuration=233 · damage{default=2000, override=['Infantry', 'Structure']} |
| 圣甲虫 `unit_nod_scarab` | Scarabs | `rifle` | None | burst{cooldown=5, chargeUpDuration=0.1, numToBurst=1} · durationMs=4500 · initialChargeUpMs=100 |
| 寡妇制造者 `unit_nod_widowmaker` | Widowmaker | `flamethrower` | None | burst{numToBurst=1} · damage{default=140, override=['Structure', 'Vehicle']} · initialChargeUpMs=0 · tickPeriodMs=500 |

### 按能力名分组

- **`ability_avatar_fire_weapon_sequence`** —— 圣灵
- **`ability_avatar_laser_weapon_sequence`** —— 圣灵
- **`ability_basilisk_weapon_sequence`** —— 蛇怪
- **`ability_beamcannon_weapon_sequence`** —— 万钧巨炮
- **`ability_catalystgunship_weapon_sequence`** —— 催化剂武装直升机
- **`ability_chem_quad_weapon_sequence`** —— 生化越野车
- **`ability_chemical_warrior_weapon_sequence`** —— 生化战士
- **`ability_confessor_weapon_sequence`** —— 忏悔者
- **`ability_disruptor_weapon_sequence`** —— 音波坦克
- **`ability_empty_weapon_sequence`** —— 虎鲸轰炸机
- **`ability_flame_trooper_weapon_sequence`** —— 烈焰之手
- **`ability_flametank_weapon_sequence`** —— 火焰坦克
- **`ability_juggernaut_ST_weapon_sequence`** —— 钢爪神像机甲
- **`ability_juggernaut_weapon_sequence`** —— 神像机甲
- **`ability_kodiak_weapon_sequence`** —— 科迪亚克
- **`ability_rockwyrm_weapon_sequence`** —— 深岩巨虫
- **`ability_sandstorm_ST_weapon_sequence`** —— 钢爪沙暴导弹车
- **`ability_sandstorm_weapon_sequence`** —— 沙暴导弹车
- **`ability_scarab_weapon_sequence`** —— 圣甲虫
- **`ability_slingshot_weapon_sequence`** —— 弹弓
- **`ability_widowmaker_fire_weapon_sequence`** —— 寡妇制造者
- **`ability_wolverine_weapon_sequence`** —— 狼獾机甲

---

## 二、常规武器（61 把）

按 `burstTiming` 的字段组合分四种子形状。

| 单位 | 英文名 | 武器 | 伤害 | burstTiming |
| --- | --- | --- | --- | --- |
| 装甲运兵车 `unit_gdi_apc` | A.P.C. | `cannon` | 90 | burst{cooldown=0.85, chargeUpDuration=0.5, numToBurst=1} |
| 攻城槌 `unit_gdi_batteringram` | Battering Ram | `cannon` | 600 | burst{cooldown=3, chargeUpDuration=1.2, numToBurst=1} |
| 无人机群 `unit_gdi_droneswarm` | Drone Swarm | `rifle` | 42 | burst{cooldown=1.5, chargeUpDuration=0, numToBurst=1} |
| 榴弹兵 `unit_gdi_grenadier` | Grenadier | `rifle` | 340 | burst{cooldown=2.64, chargeUpDuration=0, numToBurst=1} |
| 锤头鲨战机 `unit_gdi_hammerhead` | Hammerhead | `rocketLauncher` | 585 | burst{cooldown=1.6, chargeUpDuration=0, numToBurst=1} |
| 喷气飞行兵 `unit_gdi_jumptroopers` | Jump Jet Troopers | `rifle` | 382 | burst{cooldown=5, chargeUpDuration=0.25, numToBurst=1} |
| 猛犸坦克 `unit_gdi_mammothtank` | Mammoth Tank | `cannon` | 1065 | burst{cooldown=4, chargeUpDuration=0, fireRate=0.5, numToBurst=2} |
| 猛犸坦克 `unit_gdi_mammothtank` | Mammoth Tank | `rocketLauncher` | 200 | burst{cooldown=4, chargeUpDuration=0, numToBurst=1} |
| 机枪小队 `unit_gdi_mgsquad` | MG Squad | `rockets` | 28 | burst{cooldown=0.2, chargeUpDuration=0, numToBurst=1} |
| 多管火箭 `unit_gdi_mlrs` | M.L.R.S. | `rockets` | 666 | burst{cooldown=0.25, chargeUpDuration=0.25, numToBurst=1} · reload{clip=3, 5000ms} |
| 莫霍克武装直升机 `unit_gdi_mohawkgunship` | Mohawk Gunship | `rocketLauncher` | 382 | burst{cooldown=1.3, chargeUpDuration=0.075, numToBurst=1} |
| 钢爪莫霍克武装直升机 `unit_gdi_mohawkgunship_ST` | Steel Talon Mohawk | `rocketLauncher` | 396 | burst{cooldown=1.35, chargeUpDuration=0.25, numToBurst=1} |
| M.S.V. `unit_gdi_msv` | M.S.V. | `rockets` | 0 | burst{cooldown=3, chargeUpDuration=0, numToBurst=1} |
| 虎鲸攻击机 `unit_gdi_orca` | Orca | `missile` | 510 | burst{cooldown=0.2, chargeUpDuration=0.1, numToBurst=1} · reload{clip=4, 9000ms} |
| 虎鲸轰炸机 `unit_gdi_orcabomber` | Orca Bomber | `bomb` | None | burst{cooldown=1, chargeUpDuration=0.5, numToBurst=1} · reload{clip=6, 12000ms} |
| 斗牛犬 `unit_gdi_pitbull` | Pitbull | `cannon` | 250 | burst{cooldown=1.8, chargeUpDuration=0.75, chargeUpLockOnTime=0.75, numToBurst=1} |
| 掠食者坦克 `unit_gdi_predatortank` | Predator Tank | `cannon` | 830 | burst{cooldown=3.44, chargeUpDuration=1, chargeUpLockOnTime=0.25, numToBurst=1} |
| 狙击手战队 `unit_gdi_rangers` | Sniper Team | `rifle` | 152 | burst{cooldown=2.7, chargeUpDuration=1, numToBurst=1} |
| 剃刀鲸 `unit_gdi_razorback` | Razorback | `machineGun` | 70 | burst{cooldown=0.4, chargeUpDuration=0, numToBurst=1} |
| 维修无人机 `unit_gdi_repairdrone` | Repair Drone | `guns` | 0 | burst{cooldown=3, chargeUpDuration=0, numToBurst=1} |
| 维修无人机 `unit_gdi_repairdrone_CR` | Repair Drone | `guns` | 0 | burst{cooldown=3, chargeUpDuration=0, numToBurst=1} |
| 犀牛 `unit_gdi_rhino` | Rhino | `cannon` | 80 | burst{cooldown=0.75, chargeUpDuration=0.25, numToBurst=1} |
| 步枪兵 `unit_gdi_riflemen` | Riflemen | `rifle` | 38 | burst{cooldown=1.72, chargeUpDuration=0, numToBurst=1} |
| 军犬 `unit_gdi_robodogs` | War Dogs | `cannon` | 22 | burst{cooldown=1.7, chargeUpDuration=0, numToBurst=1} |
| 飞弹小队 `unit_gdi_rockettroopers` | Missile Squad | `rifle` | 250 | burst{cooldown=5, chargeUpDuration=0.25, numToBurst=1} |
| 飞弹小队 `unit_gdi_rockettroopers_mayhem` | Missile Squad | `rifle` | 750 | burst{cooldown=3.2, chargeUpDuration=0.1, numToBurst=1} |
| 粉碎者 `unit_gdi_shatterer` | Shatterer | `cannon` | 362 | burst{cooldown=0.7, chargeUpDuration=0, numToBurst=1} |
| 音波突击队 `unit_gdi_shocktroopers` | Shockwave Troopers | `rifle` | 150 | burst{cooldown=2, chargeUpDuration=0.5, numToBurst=1} |
| 利爪直升机 `unit_gdi_talon` | Talon | `machineGun` | 57 | burst{cooldown=0.5, chargeUpDuration=0, numToBurst=1} |
| 利爪直升机 `unit_gdi_talon` | Talon | `rocketLauncher` | 345 | burst{cooldown=2, chargeUpDuration=0.1, numToBurst=1} |
| 泰坦机甲 `unit_gdi_titan` | Titan | `laser` | None | burst{cooldown=5, chargeUpDuration=0.3, numToBurst=1} |
| 炮台 `unit_gdi_turret` | Turret | `guns` | 60 | burst{cooldown=0.5, chargeUpDuration=0, numToBurst=1} |
| 炮台 `unit_gdi_turret_CR` | Turret | `guns` | 20 | burst{cooldown=0.05, chargeUpDuration=0, numToBurst=1} |
| 区域装甲兵 `unit_gdi_zonetrooper` | Zone Trooper | `rifle` | 620 | burst{cooldown=3, chargeUpDuration=0, numToBurst=1} |
| 钢爪区域装甲兵 `unit_gdi_zonetrooper_ST` | Steel Talon Zone Trooper | `rifle` | 620 | burst{cooldown=3, chargeUpDuration=0, numToBurst=1} |
| 自行火炮 `unit_nod_artillery` | Artillery | `rockets` | None | burst{cooldown=3.9, chargeUpDuration=0.25, numToBurst=1} |
| 攻击摩托 `unit_nod_attackbike` | Attack Bikes | `rifle` | 244 | burst{cooldown=4.25, chargeUpDuration=0, numToBurst=1} |
| 女妖战机 `unit_nod_banshee` | Banshee | `rocketLauncher` | 211 | burst{cooldown=1.3, chargeUpDuration=0, numToBurst=1} |
| 突袭者侦察车 `unit_nod_buggy` | Buggy | `cannon` | 76 | burst{cooldown=0.66, chargeUpDuration=0.25, numToBurst=1} |
| 催化剂武装直升机 `unit_nod_catalystgunship` | Catalyst Gunship | `catalystWeapon` | 270 | burst{cooldown=3, chargeUpDuration=0.08, numToBurst=1} |
| 百夫长 `unit_nod_centurion` | Centurion | `laser` | 555 | burst{cooldown=1.72, chargeUpDuration=0.5, chargeUpLockOnTime=0.25, numToBurst=1} |
| 网际光轮 `unit_nod_cyberwheel` | Cyberwheel | `cannon` | 21 | burst{cooldown=1.5, chargeUpDuration=0.3, numToBurst=2} |
| 电子生化突击队 `unit_nod_cyborg` | Cyborg | `rifle` | 400 | burst{cooldown=2, chargeUpDuration=0, numToBurst=1} |
| 狂热者 `unit_nod_fanatic` | Fanatic | `rifle` | 57 | burst{cooldown=0.85, chargeUpDuration=0, numToBurst=1} |
| 地狱火 `unit_nod_firebomber` | Inferno | `missile` | None | burst{cooldown=3.2, chargeUpDuration=0.25, numToBurst=1} · reload{clip=1, 13000ms} |
| 激光无人机 `unit_nod_laserdrone` | Laser Drone | `rifle` | 92 | burst{cooldown=1.5, chargeUpDuration=0, numToBurst=1} |
| 激进分子 `unit_nod_militant` | Militant | `rifle` | 38 | burst{cooldown=1.72, chargeUpDuration=0, numToBurst=1} |
| 变种劫掠者 `unit_nod_mutantmarauder` | Mutant Marauder | `rifle` | 382 | burst{cooldown=3, chargeUpDuration=0, numToBurst=1} |
| 激光方尖碑 `unit_nod_obelisk` | Obelisk of Light | `guns` | 3000 | burst{cooldown=4, chargeUpDuration=3, chargeUpLockOnTime=0, numToBurst=1} |
| 激光方尖碑 `unit_nod_obelisk_CR` | Obelisk of Light | `guns` | 1000 | burst{cooldown=3.25, chargeUpDuration=1.75, chargeUpLockOnTime=0, numToBurst=1} |
| 清道夫 `unit_nod_scavenger` | Scavenger | `rifle` | 230 | burst{cooldown=4, chargeUpDuration=0.15, numToBurst=1} |
| 天蝎坦克 `unit_nod_scorpiontank` | Scorpion Tank | `cannon` | 646 | burst{cooldown=2.4, chargeUpDuration=1, chargeUpLockOnTime=0.25, numToBurst=1} |
| 隐形坦克 `unit_nod_stealthtank` | Stealth Tank | `cannon` | 382 | burst{cooldown=0.25, chargeUpDuration=0, numToBurst=1} · reload{clip=4, 11000ms} |
| 激光小队 `unit_nod_stormtroopers` | Laser Squad | `rifle` | 250 | burst{cooldown=5, chargeUpDuration=0.25, numToBurst=1} |
| 激光小队 `unit_nod_stormtroopers_mayhem` | Laser Squad | `rifle` | 750 | burst{cooldown=3.2, chargeUpDuration=0.1, numToBurst=1} |
| 壁虱坦克 `unit_nod_ticktank` | Tick Tank | `cannon` | 750 | burst{cooldown=3, chargeUpDuration=1, chargeUpLockOnTime=0.25, numToBurst=1} |
| 壁虱坦克 `unit_nod_ticktank` | Tick Tank | `hidden` | None | burst{cooldown=2.8, chargeUpDuration=0, numToBurst=1} |
| 毒液战机 `unit_nod_venom` | Venom | `machineGun` | 60 | burst{cooldown=0.4, chargeUpDuration=0, numToBurst=1} |
| 幻影战机 `unit_nod_viper` | Phantom | `rocketLauncher` | 378 | burst{cooldown=0.25, chargeUpDuration=0, numToBurst=1} · reload{clip=4, 8000ms} |
| 寡妇制造者 `unit_nod_widowmaker` | Widowmaker | `rockets` | 80 | burst{cooldown=1.5, chargeUpDuration=0.93, chargeUpLockOnTime=0.18, fireRate=0.095, numToBurst=6} |
| 飞影 `unit_nod_wraith` | Shade | `rocketLauncher` | 192 | burst{cooldown=0.035, chargeUpDuration=0.1, numToBurst=1} · reload{clip=8, 8000ms} |
