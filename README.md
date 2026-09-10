# Rivals — 《命令与征服：宿敌》数据提取

本仓库用于从《Command & Conquer: Rivals》（EA / Glu Mobile）安卓客户端中提取**单位数值**，
并输出为 JSON。

数据源是游戏在设备上落盘的 **Lua 原始源码**，数值零损失，不需要反编译。

---

## 1. 从哪里获取数据

游戏数据在设备上的位置：

```
/Android/data/com.ea.gp.candcwarzones/
```

完整路径通常是：

```
/storage/emulated/0/Android/data/com.ea.gp.candcwarzones/
```

（`/sdcard/Android/data/com.ea.gp.candcwarzones/` 是其等价软链接。）

> **为什么是这里而不是 APK**
> APK 里只有引导内容。真正的单位数值由游戏在首次启动 / 更新时下载并落盘到
> `/Android/data/com.ea.gp.candcwarzones/`，后续每个版本的平衡性调整也写在这里。
> 拿 APK 里的 assets 会读到过时或缺失的数据。

### 需要的目录

```
/Android/data/com.ea.gp.candcwarzones/
├── published/
│   ├── nfd/scripts/        ← ★ 必需：单位数值（Lua 原始源码）
│   ├── config/nfd/          客户端配置 JSON
│   └── models/units/        单位模型（.sb3d，本工具不用）
├── files/
│   └── game-config.pb     ← ★ 必需：等级/星级成长与卡牌元数据（protobuf）
├── .idx/                    资源清单（路径 + 哈希 + 大小）
└── cache/                   着色器缓存（可忽略）
```

抽取单位数值**最少只需要** `published/nfd/scripts/`。
要等级成长数据再加 `files/game-config.pb`。

### 方法一：adb（推荐，无需 root）

```bash
# 确认设备已连接
adb devices

# 只拉取必要的数据（几十 MB）
adb pull /sdcard/Android/data/com.ea.gp.candcwarzones/published/nfd/scripts ./tmp/com.ea.gp.candcwarzones/published/nfd/scripts
adb pull /sdcard/Android/data/com.ea.gp.candcwarzones/files ./tmp/com.ea.gp.candcwarzones/files

# 或者整体拉取（含模型与缓存，会比较大）
adb pull /sdcard/Android/data/com.ea.gp.candcwarzones ./tmp/com.ea.gp.candcwarzones
```

**拉到 `tmp/` 下** —— 该目录已在 `.gitignore` 中忽略，不会污染仓库。
原因见 [MIGRATION.md](MIGRATION.md)。

拉完之后目录结构直接就是工具需要的形态，无需再处理：

```
tmp/com.ea.gp.candcwarzones/
└── published/nfd/scripts/gameplay/units/*.lua
```

### 方法二：设备上的文件管理器

`Android/data/` 在 Android 11+ 上受分区存储限制，普通文件管理器打不开。
可用支持该目录的第三方管理器（如 Material Files、MiXplorer 等，部分需通过
SAF 授权），把 `com.ea.gp.candcwarzones` 整个文件夹复制到
`Download/` 等可访问位置，再传到电脑。

**Android 13+ 提示**：Google 进一步收紧了 `Android/data` 的访问，
adb 仍是多数设备上最可靠的方式。

### 方法三：如果只有 APK

APK 里的 `assets/published/` 也含部分数据，但**不完整**（缺 DLC 单位与最新平衡性调整）。
若确实要用：

```bash
unzip 1_13_0new.apk.1 'assets/*' -d apk_assets
```

然后把它当作输入目录交给工具——工具会识别 `published/nfd/scripts` 结构。
此时 `files/game-config.pb` 需要从设备上另行获取。

---

## 2. 安装

需要 Python ≥ 3.13。

```powershell
uv sync
```

---

## 3. 使用命令行工具

```powershell
uv run rivals extract <输入目录> [输出目录]
```

输出目录默认为 `data/`（该目录入库），一般不用传。

**输入目录**可以是以下任意一种，工具会自动定位到 `gameplay/units`：

| 传入 | 说明 |
| --- | --- |
| `tmp/com.ea.gp.candcwarzones` | 包名目录（adb pull 的结果，推荐） |
| `/Android/data/com.ea.gp.candcwarzones` | 设备上的原始路径形态 |
| `.../published/nfd/scripts` | 直接指向脚本根 |
| `.../published/nfd/scripts/gameplay` | 直接指向 gameplay |
| `tmp` | 解包根目录 |

### 例子

```powershell
# 基本用法：读 tmp/ 下的游戏数据，写到 data/
uv run rivals extract tmp/com.ea.gp.candcwarzones

# 并发写文件（单位多时更快）
uv run rivals extract tmp/com.ea.gp.candcwarzones --jobs 4

# 只打印前 20 行概览
uv run rivals extract tmp/com.ea.gp.candcwarzones --limit 20

# 任何一个单位求值失败就中止（CI 用）
uv run rivals extract tmp/com.ea.gp.candcwarzones --strict

# 写到别处
uv run rivals extract tmp/com.ea.gp.candcwarzones /tmp/dry-run
```

### 实际输出

```
输入根目录 : ...\tmp\com.ea.gp.candcwarzones\published\nfd\scripts
输出目录   : ...\data

单位       : 84 个
GDI / NOD  : 43 / 39
写出文件   : 84 个 .json + index.json
带告警     : 29 个

-- 概览（按造价）--
单位                               阵营       HP    造价     伤害
unit_gdi_riflemen                GDI     130    10     38
unit_gdi_robodogs                GDI     300    10     22
unit_nod_cyberwheel              NOD     200    10     21
...
```

退出码：`0` 成功，`1` 有单位求值失败，`2` 输入路径错误。

### 沙箱 / 权限提示

若 `uv run` 报 `Failed to initialize cache` 或 `拒绝访问 (os error 5)`，
说明 uv 无法写工作区外的缓存目录。改用项目虚拟环境即可：

```powershell
.venv\Scripts\python.exe -m rivals extract tmp/com.ea.gp.candcwarzones
```

---

## 4. 输出格式

输出目录结构（`data/`，入库）：

```
data/
├── index.json      全部单位的汇总索引（按造价升序）
├── gdi/            43 个：unit_gdi_*.json
├── nod/            39 个：unit_nod_*.json
└── misc/            2 个：unit_example / unit_dlc_test
```

每个单位的字段含义、JSON 样例、以及**哪些字段是占位值不可使用**，
见 **[docs/output-format.md](docs/output-format.md)**。

提取原理（lupa 求值、宿主桩、踩过的坑）见
**[docs/extraction.md](docs/extraction.md)**。

仓库结构与「什么入库 / 什么不入库」见 **[MIGRATION.md](MIGRATION.md)**。

### 为什么用 JSON 而不是 TOML

实测过两种格式，JSON 更适合这份数据：

| 维度 | 结果 |
| --- | --- |
| 嵌套深度 | 中位 7 层、最深 10 层 |
| TOML 的深路径 | 出现 `[[config.combatantTuning.weaponTunings.projectile.modifier.tuning.damageFalloff.distances]]` 这类**近 100 字符**的节标题 |
| 两种格式的往返保真 | 均无损（数据里没有 `null`，TOML 的短板没有暴露） |
| 体积 | TOML 171 KiB vs JSON 200 KiB（TOML 小 17%，但它牺牲的是结构可读性） |

单位配置本质是**深嵌套树**，JSON 的括号结构直接映射树形，
TOML 则要把每个子树摊平成点分标题——层级一深，路径比数据本身还长。
JSON 另有优势：任何语言、任何工具链都原生支持，无需 `tomlkit` 这类第三方库
（Python 也只到 3.11 才有 `tomllib`）。

---

## 5. 已知限制

| 限制 | 影响 |
| --- | --- |
| `combatantTuning.descriptors` 是位掩码占位值 | **不要使用**。该枚举定义在宿主 C++ 里，Lua 源码中没有 |
| `tags` / `goodAgainstTags` 只有名字，没有数字 | 名字语义正确可用于判断克制关系；需要数字值须逆向 `libapp.so` |
| 只覆盖单位 | 指挥官、建筑、技能的提取尚未实装（机制相同） |
| 缺显示名本地化 | `unit_gdi_riflemen` → "Riflemen" 多数可推；中文名在 `published/strings/CHS_CN/app.sb`，尚未解出 |
| 缺等级 / 星级成长 | 在 `files/game-config.pb`（裸 protobuf），尚未解析 |

生成的文件里 `warnings` 字段会列出该单位被丢弃的字段路径，
便于判断哪些数据没能提出来。

---

## 6. 项目结构

```
Rivals/
├── data/                     ✅ 提取产物（唯一真相，约 274 KiB）
├── reference/rivals/         ✅ Python 参考实现（真值来源，见下）
├── packages/core/            ✅ 共享纯逻辑（TS，不依赖 DOM / Node API）
├── apps/cli/                 ✅ 命令行查询工具
├── apps/web/                 ✅ 网页（vite）
├── docs/                     ✅ 输出格式与提取原理
├── tmp/                      ❌ 游戏原始资产（386 MiB，版权）
└── pnpm-workspace.yaml       工作区定义
```

### 为什么参考实现放在 `reference/`

Python 版是**真值来源**：它直接执行游戏分发的 Lua 源码，产出 `data/`。
将来若用其他语言重写运算逻辑（例如网页需要计算升级或 buff 后的数据），
重写结果是否正确，只能靠它来交叉验证。所以它必须入库、不能丢。

其他语言的重写实现放在 `packages/`（pnpm workspace），`reference/` 保持独立，
仅在本地或 CI 中作为校验基准运行。

什么入库、什么不入库、以及数据流的完整说明见 **[MIGRATION.md](MIGRATION.md)**。

---

## 7. 其他语言的实现（pnpm workspace）

```powershell
pnpm install
```

| 命令 | 作用 |
| --- | --- |
| `pnpm typecheck` | 全部包类型检查 |
| `pnpm test` | 单元测试 |
| `pnpm cli <命令>` | 命令行查询 |
| `pnpm web` | 本地起网页（dev） |
| `pnpm web:build` | 构建网页到 `apps/web/dist/` |
| `pnpm extract` | 跑 Python 参考实现，重新生成 `data/` |

### CLI

```powershell
pnpm cli list                              # 列出全部单位
pnpm cli counter Aircraft                  # 克制空中的单位
pnpm cli cheap 30                          # 造价 <= 30
pnpm cli damage unit_gdi_predatortank Infantry   # 计算伤害
pnpm cli list --json                       # JSON 输出
```

### 分层原则

| 层 | 依赖 | 说明 |
| --- | --- | --- |
| `reference/` | Python + lupa | **唯一**读取游戏 Lua 的环节，离线跑 |
| `data/` | —— | 两层之间的契约 |
| `packages/core` | 无 | 纯函数，CLI 与网页共用 |
| `apps/*` | core | 只做各自的 I/O |

**不要在 TS 侧重新解析游戏 Lua。** 那会造成同一份数据出现两套理解。
需要新数据时，改 `reference/` 提取进 `data/`。

### 网页的数据从哪来

`data/` 在仓库根，而 vite 的 `publicDir` 必须位于项目目录之内，所以构建时
由 `apps/web/scripts/sync-data.mjs` 把 `data/` 复制到 `apps/web/public/data/`。

`publicDir` 里的文件**原样复制**到构建输出根（不改名、不打包、不做类型检查），
正适合纯运行时读取的 JSON。`public/data/` 已在 `.gitignore` 中忽略 ——
唯一真相始终是仓库根的 `data/`，避免两份副本入库后不一致。
