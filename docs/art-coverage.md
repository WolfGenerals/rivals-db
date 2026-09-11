# 美术资源覆盖表

由 `_wiki_page_art.py report` 生成。**图片取自 wiki 页面的固定字段**，不按文件名猜：

| 类型 | 权威位置 |
| --- | --- |
| 图标（单位） | `{{UnitBox}}` 的 `\|name = [[File:CNCRiv X.png\|100px]]` |
| 图标（指挥官） | `{{CharBox}}` 的 `\|image`，或卡面 `CNCRiv <名字> card.png` |
| 立绘 | `== Gallery ==` 段里 `<gallery>` 块的条目 |
| 动作图 | `{{UnitBox}}` 的 `\|slides = File:X stand.png {{!}} Stand` |

分辨率取自 `allimages` 的文件元数据。

**落盘位置**（`data/img/`，由 `_build_img.py` 生成）：**只有图标 `<id>.webp`**。
立绘不再落盘（wiki 上很多单位本来就没传 art）。下表仍列出立绘来源，供查阅。

## 分类

| 类别 | 判定依据 | 条数 | 有图标 | 有立绘 |
| --- | --- | --- | --- | --- |
| 收集单位 | pb 里有稀有度 | 70 | 70 | 70 |
| 指挥官 | id 以 `cmdr_` 开头 | 18 | 17 | 16 |
| **非收集品**（炮台/方尖碑/运矿车/技能召唤物） | pb 里**没有**稀有度 | 12 | 0 | 6 |
| 模板文件 | 不在 `game-config.pb` 内 | 3 | 0 | 0 |

> **重要**：非收集品在游戏里**本来就没有商店卡面**，它们不是「缺图」——
> 炮台 / 方尖碑是基地建筑，运矿车不是可编入卡组的单位，
> 修理无人机 / 钻地舱是梁博士和 Seth 的技能召唤物。
> 之前把 `unit_gdi_turret` 硬套到 `CNCRiv Minigun Turret.png` 是错的：
> 那张是 **Strongarm 的技能卡**。

| id | 显示名 | 类别 | wiki 页面 | 图标文件 | 图标分辨率 | 立绘文件 | 立绘分辨率 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `unit_dlc_test` | — | 模板 | — | **缺** | — | — | — |  |
| `unit_example` | — | 模板 | — | **缺** | — | — | — |  |
| `unit_gdi_apc` | A.P.C. | 收集单位 | A.P.C. (Rivals) | `CNCRiv A.P.C..png` | 270×324 | `CNCRiv APC art.png` (+2) | 500×257 |  |
| `unit_gdi_batteringram` | Battering Ram | 收集单位 | Battering ram | `CNCRiv Battering Ram.png` | 270×324 | `CNCRiv Battering Ram art.jpg` | 1455×818 |  |
| `unit_gdi_disruptor` | Disruptor | 收集单位 | Disruptor (Rivals) | `CNCRiv Disruptor.png` | 270×324 | `CNCRiv Disruptor art.jpg` | 1184×608 |  |
| `unit_gdi_droneswarm` | Drone Swarm | 收集单位 | Drone swarm | `CNCRiv Drone Swarm.png` | 270×324 | `CNCRiv Drone Swarm art.png` (+1) | 1683×864 |  |
| `unit_gdi_grenadier` | Grenadier | 收集单位 | Grenadier (Rivals) | `CNCRiv_Grenadier.png` | 270×324 | `CNCRiv Grenadier art.png` (+1) | 1685×867 |  |
| `unit_gdi_hammerhead` | Hammerhead | 收集单位 | Hammerhead (Rivals) | `CNCRiv Hammerhead.png` | 270×324 | `CNCRiv Hammerhead art.jpg` | 1184×608 |  |
| `unit_gdi_harvester` | Harvester | 非收集品 | Harvester (Rivals) | _本来就没有_ | — | `CNCRiv GDI Harvester art.jpg` (+3) | 909×465 | 该图 `CNCRiv Harvester.png`（64×64）是技能/建筑图，不是商店卡面 |
| `unit_gdi_harvester_mayhem` | Harvester | 非收集品 | Harvester (Rivals) | _本来就没有_ | — | `CNCRiv GDI Harvester art.jpg` (+3) | 909×465 | 该图 `CNCRiv Harvester.png`（64×64）是技能/建筑图，不是商店卡面 |
| `unit_gdi_juggernaut` | Juggernaut | 收集单位 | Juggernaut (Rivals) | `CNCRiv Juggernaut.png` | 270×324 | `CNCRiv Juggernaut art.png` (+4) | 1683×864 |  |
| `unit_gdi_juggernaut_ST` | Steel Talon Juggernaut | 收集单位 | Juggernaut (Rivals) | `CNCRiv Juggernaut.png` | 270×324 | `CNCRiv Juggernaut art.png` (+4) | 1683×864 |  |
| `unit_gdi_jumptroopers` | Jump Jet Troopers | 收集单位 | Jump jet troopers (Rivals) | `CNCRiv Jump Jet Troopers.png` | 270×324 | `CNCRiv Jump Jet Trooper art.jpg` | 1184×608 |  |
| `unit_gdi_kodiak` | Kodiak | 收集单位 | Kodiak (Rivals) | `CNCRiv Kodiak.png` | 270×324 | `CNCRiv Kodiak art.jpg` | 1184×608 |  |
| `unit_gdi_mammothtank` | Mammoth Tank | 收集单位 | Mammoth tank (Rivals) | `CNCRiv Mammoth Tank.png` | 270×324 | `CNCRiv Mammoth Tank art.jpg` (+4) | 1184×608 |  |
| `unit_gdi_mgsquad` | MG Squad | 收集单位 | MG squad | `CNCRiv MG Squad.png` | 270×324 | `CNCRiv MG Squad art.png` | 1685×867 |  |
| `unit_gdi_mlrs` | M.L.R.S. | 收集单位 | M.L.R.S. (Rivals) | `CNCRiv M.L.R.S..png` | 270×324 | `CNCRiv MLRS art.png` | 1184×608 |  |
| `unit_gdi_mohawkgunship` | Mohawk Gunship | 收集单位 | Mohawk gunship | `CNCRiv Mohawk Gunship.png` | 270×324 | `CNCRiv Mohawk Gunship art.png` | 1685×867 |  |
| `unit_gdi_mohawkgunship_ST` | Steel Talon Mohawk | 收集单位 | Mohawk gunship | `CNCRiv Mohawk Gunship.png` | 270×324 | `CNCRiv Mohawk Gunship art.png` | 1685×867 |  |
| `unit_gdi_msv` | M.S.V. | 收集单位 | M.S.V. | `CNCRiv M.S.V..png` | 270×324 | `CNCRiv M.S.V. art.png` | 1685×867 |  |
| `unit_gdi_orca` | Orca | 收集单位 | Orca (Rivals) | `CNCRiv Orca.png` | 270×324 | `CNCRiv Orca art.png` (+4) | 1184×608 |  |
| `unit_gdi_orcabomber` | Orca Bomber | 收集单位 | Orca bomber (Rivals) | `CNCRiv Orca Bomber.png` | 270×324 | `CNCRiv Orca Bomber art.png` | 1685×867 |  |
| `unit_gdi_pitbull` | Pitbull | 收集单位 | Pitbull (Rivals) | `CNCRiv Pitbull.png` | 270×324 | `CNCRiv Pitbull art.jpg` (+1) | 1184×608 |  |
| `unit_gdi_predatortank` | Predator Tank | 收集单位 | Predator tank (Rivals) | `CNCRiv Predator Tank.png` | 270×324 | `CNCRiv Predator Tank art.jpg` (+2) | 1184×608 |  |
| `unit_gdi_rangers` | Sniper Team | 收集单位 | Sniper team (Rivals) | `CNCRiv Sniper Team.png` | 270×324 | `CNCRiv Sniper Team art.jpg` | 1184×608 |  |
| `unit_gdi_razorback` | Razorback | 收集单位 | Razorback | `CNCRiv Razorback.png` | 270×324 | `CNCRiv Razorback art.png` | 1184×608 |  |
| `unit_gdi_repairdrone` | Repair Drone | 非收集品 | Repair drone (Rivals) | _本来就没有_ | — | `CNCRiv Repair Drone heals.png` | 1051×729 | 该图 `CNCRiv Repair Drone.png`（270×324）是技能/建筑图，不是商店卡面 |
| `unit_gdi_repairdrone_CR` | Repair Drone | 非收集品 | Repair drone (Rivals) | _本来就没有_ | — | `CNCRiv Repair Drone heals.png` | 1051×729 | 该图 `CNCRiv Repair Drone.png`（270×324）是技能/建筑图，不是商店卡面 |
| `unit_gdi_rhino` | Rhino | 收集单位 | Rhino (Rivals) | `CNCRiv Rhino.png` | 270×324 | `CNCRiv Rhino art.png` (+1) | 1184×608 |  |
| `unit_gdi_riflemen` | Riflemen | 收集单位 | Riflemen (Rivals) | `CNCRiv Riflemen.png` | 270×324 | `CNCRiv Rifleman art initial.jpg` (+3) | 974×500 |  |
| `unit_gdi_robodogs` | War Dogs | 收集单位 | War dogs | `CNCRiv War Dogs.png` | 270×324 | `CNCRiv War Dogs art.png` | 1683×864 |  |
| `unit_gdi_rockettroopers` | Missile Squad | 收集单位 | Missile squad (Rivals) | `CNCRiv Missile Squad.png` | 270×324 | `CNCRiv Missile Squad art.png` (+6) | 1683×864 |  |
| `unit_gdi_rockettroopers_mayhem` | Missile Squad | 收集单位 | Missile squad (Rivals) | `CNCRiv Missile Squad.png` | 270×324 | `CNCRiv Missile Squad art.png` (+6) | 1683×864 |  |
| `unit_gdi_sandstorm` | Sandstorm | 收集单位 | Sandstorm (Rivals) | `CNCRiv Sandstorm.png` | 270×324 | `CNCRiv Sandstorm art.png` | 1184×608 |  |
| `unit_gdi_sandstorm_ST` | Steel Talon Sandstorm | 收集单位 | Sandstorm (Rivals) | `CNCRiv Sandstorm.png` | 270×324 | `CNCRiv Sandstorm art.png` | 1184×608 |  |
| `unit_gdi_shatterer` | Shatterer | 收集单位 | Shatterer (Rivals) | `CNCRiv Shatterer.png` | 270×324 | `CNCRiv Shatterer art.png` | 1685×867 |  |
| `unit_gdi_shocktroopers` | Shockwave Troopers | 收集单位 | Shockwave troopers | `CNCRiv Shockwave Troopers.png` | 270×324 | `CNCRiv Shockwave Troopers art.png` (+2) | 1685×867 |  |
| `unit_gdi_slingshot` | Slingshot | 收集单位 | Slingshot (Rivals) | `CNCRiv Slingshot.png` | 270×324 | `CNCRiv Slingshot art.png` (+1) | 1685×867 |  |
| `unit_gdi_talon` | Talon | 收集单位 | Talon (Rivals) | `CNCRiv Talon.png` | 270×324 | `CNCRiv Talon art.png` (+1) | 1184×608 |  |
| `unit_gdi_titan` | Titan | 收集单位 | Titan (Rivals) | `CNCRiv Titan.png` | 270×324 | `CNCRiv Titan art.jpg` (+3) | 1184×608 |  |
| `unit_gdi_turret` | Turret | 非收集品 | — | _本来就没有_ | — | — | — |  |
| `unit_gdi_turret_CR` | Turret | 非收集品 | — | _本来就没有_ | — | — | — |  |
| `unit_gdi_wolverine` | Wolverine | 收集单位 | Wolverine (Rivals) | `CNCRiv Wolverine.png` | 270×324 | `CNCRiv GDI Wolverine art.png` (+2) | 1184×608 |  |
| `unit_gdi_zonetrooper` | Zone Trooper | 收集单位 | Zone trooper (Rivals) | `CNCRiv Zone Trooper.png` | 270×324 | `CNCRiv Zone Troopers art.jpg` (+2) | 1184×608 |  |
| `unit_gdi_zonetrooper_ST` | Steel Talon Zone Trooper | 收集单位 | Zone trooper (Rivals) | `CNCRiv Zone Trooper.png` | 270×324 | `CNCRiv Zone Troopers art.jpg` (+2) | 1184×608 |  |
| `unit_nod_artillery` | Artillery | 收集单位 | Artillery (Rivals) | `CNCRiv Artillery.png` | 270×324 | `CNCRiv Artillery art.jpg` | 1184×608 |  |
| `unit_nod_attackbike` | Attack Bikes | 收集单位 | Attack bike (Rivals) | `CNCRiv Attack Bikes.png` | 270×324 | `CNCRiv Attack Bikes art.png` | 1920×1080 |  |
| `unit_nod_avatar` | Avatar | 收集单位 | Avatar (Rivals) | `CNCRiv Avatar.png` | 270×324 | `CNCRiv Avatar art.png` (+1) | 1683×864 |  |
| `unit_nod_banshee` | Banshee | 收集单位 | Banshee (Rivals) | `CNCRiv Banshee.png` | 270×324 | `CNCRiv Banshee art.png` | 1920×1080 |  |
| `unit_nod_basilisk` | Basilisk | 收集单位 | Basilisk (Rivals) | `CNCRiv Basilisk.png` | 270×324 | `CNCRiv_Basilisk_art.jpg` | 1184×608 |  |
| `unit_nod_beamcannon` | Giga-Cannon | 收集单位 | Giga-cannon | `CNCRiv Giga-Cannon.png` | 270×324 | `CNCRiv Giga Cannon art.png` (+3) | 1683×864 |  |
| `unit_nod_buggy` | Buggy | 收集单位 | Buggy (Rivals) | `CNCRiv Buggy.png` | 270×324 | `CNCRiv Buggy art.png` (+3) | 1920×1080 |  |
| `unit_nod_catalystgunship` | Catalyst Gunship | 收集单位 | Catalyst gunship | `CNCRiv Catalyst Gunship.png` | 270×324 | `CNCRiv Catalyst Gunship art.jpg` | 1455×818 |  |
| `unit_nod_centurion` | Centurion | 收集单位 | Centurion (Rivals) | `CNCRiv Centurion.png` | 270×324 | `CNCRiv Centurion art.png` | 1184×609 |  |
| `unit_nod_chemicalwarrior` | Chemical Warriors | 收集单位 | Chemical warriors (Rivals) | `CNCRiv Chemical Warriors.png` | 270×324 | `CNCRiv Chemical Warrior art.jpg` | 1184×608 |  |
| `unit_nod_chemquad` | Chem Buggy | 收集单位 | Chem buggy | `CNCRiv Chem Buggy.png` | 270×324 | `CNCRiv Chem Buggy art.png` (+1) | 2114×1085 |  |
| `unit_nod_confessor` | Confessor | 收集单位 | Confessor (Rivals) | `CNCRiv Confessor.png` | 270×324 | `CNCRiv Confessor art.jpg` (+1) | 1184×608 |  |
| `unit_nod_cyberwheel` | Cyberwheel | 收集单位 | Cyberwheel | `CNCRiv Cyberwheel.png` | 270×324 | `CNCRiv Cyberwheel art.png` | 1685×867 |  |
| `unit_nod_cyborg` | Cyborg | 收集单位 | Cyborg (Rivals) | `CNCRiv Cyborg.png` | 270×324 | `CNCRiv Cyborg art.jpg` | 1184×608 |  |
| `unit_nod_drillpod` | — | 非收集品 | Drill pod | _本来就没有_ | — | — | — | 该图 `CNCRiv Drill Pod.png`（270×324）是技能/建筑图，不是商店卡面 |
| `unit_nod_drillpod_CR` | — | 非收集品 | Drill pod | _本来就没有_ | — | — | — | 该图 `CNCRiv Drill Pod.png`（270×324）是技能/建筑图，不是商店卡面 |
| `unit_nod_fanatic` | Fanatic | 收集单位 | Fanatic (Rivals) | `CNCRiv Fanatic.png` | 270×324 | `CNCRiv Fanatic art.png` | 1683×864 |  |
| `unit_nod_firebomber` | Inferno | 收集单位 | Inferno (Rivals) | `CNCRiv Inferno.png` | 270×324 | `CNCRiv Inferno art.png` (+1) | 1184×608 |  |
| `unit_nod_flametank` | Flame Tank | 收集单位 | Flame tank (Rivals) | `CNCRiv Flame Tank.png` | 270×324 | `CNCRiv Flame Tank art.jpg` (+5) | 1184×608 |  |
| `unit_nod_flametroopers` | Flame Troopers | 收集单位 | Flame troopers (Rivals) | `CNCRiv Flame Troopers.png` | 270×324 | `CNCRiv Flame Trooper art.png` | 1184×608 |  |
| `unit_nod_harvester` | Harvester | 非收集品 | Harvester (Rivals) | _本来就没有_ | — | `CNCRiv GDI Harvester art.jpg` (+3) | 909×465 | 该图 `CNCRiv Harvester.png`（64×64）是技能/建筑图，不是商店卡面 |
| `unit_nod_harvester_mayhem` | Harvester | 非收集品 | Harvester (Rivals) | _本来就没有_ | — | `CNCRiv GDI Harvester art.jpg` (+3) | 909×465 | 该图 `CNCRiv Harvester.png`（64×64）是技能/建筑图，不是商店卡面 |
| `unit_nod_laserdrone` | Laser Drone | 收集单位 | Laser drone | `CNCRiv Laser Drone.png` | 270×324 | `CNCRiv Laser Drone art.png` | 1685×867 |  |
| `unit_nod_militant` | Militant | 收集单位 | Militant (Rivals) | `CNCRiv Militant.png` | 270×324 | `CNCRiv Militant art.png` | 1685×867 |  |
| `unit_nod_mutantmarauder` | Mutant Marauder | 收集单位 | Mutant marauders (Rivals) | `CNCRiv Mutant Marauder.png` | 270×324 | `CNCRiv Mutant Marauder art.png` (+1) | 1683×864 |  |
| `unit_nod_obelisk` | Obelisk of Light | 非收集品 | Obelisk of Light (Rivals) | _本来就没有_ | — | — | — | 该图 `CNCRiv Obelisk of Light.png`（270×324）是技能/建筑图，不是商店卡面 |
| `unit_nod_obelisk_CR` | Obelisk of Light | 非收集品 | Obelisk of Light (Rivals) | _本来就没有_ | — | — | — | 该图 `CNCRiv Obelisk of Light.png`（270×324）是技能/建筑图，不是商店卡面 |
| `unit_nod_rockwyrm` | Rockworm | 收集单位 | Rockworm | `CNCRiv Rockworm.png` | 270×324 | `CNCRiv Rockworm art.jpg` (+4) | 1184×608 |  |
| `unit_nod_scarab` | Scarabs | 收集单位 | Scarabs | `CNCRiv Scarabs.png` | 270×324 | `CNCRiv Scarabs art.png` (+1) | 1184×608 |  |
| `unit_nod_scavenger` | Scavenger | 收集单位 | Scavenger (Rivals) | `CNCRiv Scavenger.png` | 270×324 | `CNCRiv Scavenger art.png` | 1683×864 |  |
| `unit_nod_scorpiontank` | Scorpion Tank | 收集单位 | Scorpion tank (Rivals) | `CNCRiv Scorpion Tank.png` | 270×324 | `CNCRiv Scorpion Tank art.jpg` | 1184×608 |  |
| `unit_nod_stealthtank` | Stealth Tank | 收集单位 | Stealth tank (Rivals) | `CNCRiv Stealth Tank.png` | 270×324 | `CNCRiv Stealth Tank art.jpg` | 1184×608 |  |
| `unit_nod_stormtroopers` | — | 收集单位 | Laser squad | `CNCRiv Laser Squad.png` | 270×324 | `CNCRiv Laser Squad art.png` (+3) | 1184×608 |  |
| `unit_nod_stormtroopers_mayhem` | — | 收集单位 | Laser squad | `CNCRiv Laser Squad.png` | 270×324 | `CNCRiv Laser Squad art.png` (+3) | 1184×608 |  |
| `unit_nod_ticktank` | Tick Tank | 收集单位 | Tick tank (Rivals) | `CNCRiv Tick Tank.png` | 270×324 | `CNCRiv Tick Tank art.png` (+3) | 1683×864 |  |
| `unit_nod_venom` | Venom | 收集单位 | Venom (Rivals) | `CNCRiv Venom.png` | 270×324 | `CNCRiv Venom art.jpg` | 1184×608 |  |
| `unit_nod_viper` | Phantom | 收集单位 | Phantom (Rivals) | `CNCRiv Phantom.png` | 270×324 | `CNCRiv Phantom art.jpg` (+1) | 1683×864 |  |
| `unit_nod_widowmaker` | Widowmaker | 收集单位 | Widowmaker | `CNCRiv Widowmaker.png` | 270×324 | `CNCRiv Widowmaker art.png` (+1) | 1683×864 |  |
| `unit_nod_wraith` | Shade | 收集单位 | Shade | `CNCRiv Shade.png` | 270×324 | `CNCRiv Shade art.jpg` (+1) | 1120×630 |  |
| `cmdr_dlc_test` | — | 模板 | — | **缺** | — | — | — |  |
| `cmdr_gdi_jackson` | Col. Jackson | 指挥官 | Jackson | `CNCRiv_Jackson_card.png` | 270×324 | `CNCRiv Jackson art.jpg` (+4) | 1255×1653 |  |
| `cmdr_gdi_jackson_CR` | Col. Jackson | 指挥官 | Jackson | `CNCRiv_Jackson_card.png` | 270×324 | `CNCRiv Jackson art.jpg` (+4) | 1255×1653 |  |
| `cmdr_gdi_liang` | Dr. Liang | 指挥官 | Liang | `CNCRiv_Liang_card.png` | 270×324 | `CNCRiv Liang unused.png` (+3) | 555×667 |  |
| `cmdr_gdi_liang_CR` | Dr. Liang | 指挥官 | Liang | `CNCRiv_Liang_card.png` | 270×324 | `CNCRiv Liang unused.png` (+3) | 555×667 |  |
| `cmdr_gdi_mcneil` | Cdr. McNeil | 指挥官 | — | `CNCRiv_McNeil_card.png` | 270×324 | — | — |  |
| `cmdr_gdi_solomon` | Gen. Solomon | 指挥官 | James Solomon | `CNCRiv_Solomon_card.png` | 270×324 | `CNCRiv Solomon art.jpg` (+2) | 1255×1653 |  |
| `cmdr_gdi_solomon_CR` | Gen. Solomon | 指挥官 | James Solomon | `CNCRiv_Solomon_card.png` | 270×324 | `CNCRiv Solomon art.jpg` (+2) | 1255×1653 |  |
| `cmdr_gdi_strongarm` | Lt. Strongarm | 指挥官 | Strongarm | `CNCRiv_Strongarm_card.png` | 270×324 | `Strongarm-header.jpg` (+3) | ? |  |
| `cmdr_gdi_strongarm_CR` | Lt. Strongarm | 指挥官 | Strongarm | `CNCRiv_Strongarm_card.png` | 270×324 | `Strongarm-header.jpg` (+3) | ? |  |
| `cmdr_nod_jade` | Jade | 指挥官 | Jade Liang | `CNCRiv_Jade_card.png` | 270×324 | `CNCRiv Jade.jpg` (+4) | 1255×1653 |  |
| `cmdr_nod_jade_CR` | Jade | 指挥官 | Jade Liang | `CNCRiv_Jade_card.png` | 270×324 | `CNCRiv Jade.jpg` (+4) | 1255×1653 |  |
| `cmdr_nod_kane` | Kane | 指挥官 | Kane | `CNCRiv_Kane_card.png` | 270×324 | `TD_Test_screen.jpg` (+43) | ? |  |
| `cmdr_nod_kane_CR` | Kane | 指挥官 | Kane | `CNCRiv_Kane_card.png` | 270×324 | `TD_Test_screen.jpg` (+43) | ? |  |
| `cmdr_nod_marcion` | Marcion | 指挥官 | — | **缺** | — | — | — |  |
| `cmdr_nod_oxanna` | Oxanna | 指挥官 | Oxanna Kristos | `CNCRiv_Oxanna_card.png` | 270×324 | `Oxanna.jpg` (+7) | ? |  |
| `cmdr_nod_oxanna_CR` | Oxanna | 指挥官 | Oxanna Kristos | `CNCRiv_Oxanna_card.png` | 270×324 | `Oxanna.jpg` (+7) | ? |  |
| `cmdr_nod_seth` | Seth | 指挥官 | Seth | `CNCRiv_Seth_card.png` | 270×324 | `Seth_trophy.jpg` (+5) | ? |  |
| `cmdr_nod_seth_CR` | Seth | 指挥官 | Seth | `CNCRiv_Seth_card.png` | 270×324 | `Seth_trophy.jpg` (+5) | ? |  |

## 真的拿不到图标的条目（排除非收集品与模板）

- `cmdr_nod_marcion` —— Marcion（指挥官）

## 非收集品（游戏里本来就没有卡面）

- `unit_gdi_harvester` —— Harvester；该图 `CNCRiv Harvester.png`（64×64）是技能/建筑图，不是商店卡面
- `unit_gdi_harvester_mayhem` —— Harvester；该图 `CNCRiv Harvester.png`（64×64）是技能/建筑图，不是商店卡面
- `unit_gdi_repairdrone` —— Repair Drone；该图 `CNCRiv Repair Drone.png`（270×324）是技能/建筑图，不是商店卡面
- `unit_gdi_repairdrone_CR` —— Repair Drone；该图 `CNCRiv Repair Drone.png`（270×324）是技能/建筑图，不是商店卡面
- `unit_gdi_turret` —— Turret
- `unit_gdi_turret_CR` —— Turret
- `unit_nod_drillpod` —— —；该图 `CNCRiv Drill Pod.png`（270×324）是技能/建筑图，不是商店卡面
- `unit_nod_drillpod_CR` —— —；该图 `CNCRiv Drill Pod.png`（270×324）是技能/建筑图，不是商店卡面
- `unit_nod_harvester` —— Harvester；该图 `CNCRiv Harvester.png`（64×64）是技能/建筑图，不是商店卡面
- `unit_nod_harvester_mayhem` —— Harvester；该图 `CNCRiv Harvester.png`（64×64）是技能/建筑图，不是商店卡面
- `unit_nod_obelisk` —— Obelisk of Light；该图 `CNCRiv Obelisk of Light.png`（270×324）是技能/建筑图，不是商店卡面
- `unit_nod_obelisk_CR` —— Obelisk of Light；该图 `CNCRiv Obelisk of Light.png`（270×324）是技能/建筑图，不是商店卡面
