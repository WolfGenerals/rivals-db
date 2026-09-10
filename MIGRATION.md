# 仓库结构说明

## 什么入库，什么不入库

| 路径 | 入库 | 说明 |
| --- | --- | --- |
| `src/rivals/` | ✅ | 提取器源码 |
| `data/` | ✅ | 提取产物，`data/*/*.json` + `data/index.json`（约 274 KiB） |
| `docs/` | ✅ | 文档 |
| `README.md` / `pyproject.toml` / `uv.lock` | ✅ | 项目定义 |
| `tmp/` | ❌ | 游戏原始资产，见下 |

## `tmp/` —— 游戏原始资产

游戏文件**不入库**，放在 `tmp/` 下（已在 `.gitignore` 中忽略）：

```
tmp/
├── 1_13_0new.apk.1              92 MiB   客户端安装包
└── com.ea.gp.candcwarzones/    294 MiB   从设备提取的数据目录
```

### 为什么要移出去

1. **版权** —— 这是 EA 的资产。`tmp/com.ea.gp.candcwarzones/` 含 4.4 MiB 的
   游戏 Lua 原始源码。公开仓库里放原始游戏文件风险很实在。
2. **体积** —— 合计 386 MiB。Git 对二进制和大量小文件都不友好，
   一旦提交就永久留在历史里，之后很难清掉。
3. **可重建** —— 任何人都能从自己的设备重新提取（见 README）。
   入库的 `data/` 是**派生数据（数值事实）**，约 274 KiB，
   性质比原始脚本干净得多，体积也小三个数量级。

### 怎么重新获取

见 [README「从哪里获取数据」](README.md#1-从哪里获取数据)。

提取时把数据放到 `tmp/` 即可，`.gitignore` 已经覆盖：

```powershell
# 数据在设备上，用 adb 拉到 tmp/
adb pull /sdcard/Android/data/com.ea.gp.candcwarzones tmp/com.ea.gp.candcwarzones

# 然后生成入库的 data/
uv run rivals extract tmp/com.ea.gp.candcwarzones
```

## 数据流

```
tmp/com.ea.gp.candcwarzones/          ← 不入库（386 MiB，版权资产）
        │
        │  rivals extract   （唯一读取 Lua 的环节，Python + lupa）
        ▼
data/                                 ← 入库（274 KiB，派生数值）
├── index.json
├── gdi/*.json  (43)
├── nod/*.json  (39)
└── misc/*.json  (2)
        │
        │  静态托管 / 直接读取
        ▼
   网页 / 机器人 / 任何下游
```

**关键约定：只有提取器读 Lua。** 下游一律只读 `data/` 下的 JSON，
不要在任何其他语言里重新解析游戏文件 —— 那会导致同一份数据出现多套理解。
详见 [docs/output-format.md](docs/output-format.md)。
