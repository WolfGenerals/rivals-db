# 给 AI 助手的项目约定

## 硬性规则

### 1. 每得出一个结论，必须写进 `docs/findings.md`

**这是本项目的强制约定。** 无论是数值模型、字段语义、外部数据源行为、还是工程踩坑，
只要构成一条「可以拿去做判断的结论」，就要在 `docs/findings.md` 的对应分类下追加一行。

每行必须包含：

| 列 | 要求 |
| --- | --- |
| 结论 | 一句话，可证伪 |
| 证据 | **可复查**的东西：`文件:行号` / 命令 / 实测数据 / 产物字段路径。禁止只写"已分析" |
| 状态 | `✅ 已确认` / `⚠️ 推断` / `❓ 待验证` / `❌ 已推翻` |

补充约定：

- **结论被推翻时不要删旧行**，把状态改成 `❌ 已推翻`，并在证据列写清是什么证据推翻的。
  保留错误结论是为了避免以后重复踩同一个坑。
- 推导过程长、值得展开的内容，写进 `docs/` 下的专题文档，`findings.md` 只放指针。
- 尚未成为结论的假设，放进 `findings.md` 末尾的「待办」，不要混进结论表。

### 2. 不要动 `tmp/`

`tmp/` 是 gitignore 的，装着游戏原始资产（约 3 GB，含 `tmp/ghidra`）。
只读，不删，不移。

### 3. 写文件不要带 BOM

Windows PowerShell 5 的 `Set-Content -Encoding UTF8` 会写 BOM，
会让 Vite / PostCSS 报 `Unexpected token ''`。用 edit/write 工具，或 `-Encoding utf8NoBOM`。

### 4. TS import 必须带 `.ts` 扩展名

Node 24 的原生 type-stripping 要求如此，`tsconfig.base.json` 已开
`allowImportingTsExtensions`。

### 5. 产物字段有真伪之分

`docs/data-semantics.md` 里标注为占位值的字段（如 `descriptors` 的位掩码数字）
**不可当作真实数据使用**。新增字段时同样要在文档里标明来源。

---

## 项目速览

- 目标：把《命令与征服：宿敌》(C&C Rivals) 的客户端调参数据变成纯 JSON + 数据站。
- 数据源：`tmp/com.ea.gp.candcwarzones/published/nfd/scripts/gameplay/{units,commanders}/*.lua`
  （随客户端分发的**原始开发源码**，不是反编译产物）。
- 产物：`data/unit/*.lua.json`、`data/commander/*.lua.json`、`data/index.json`、
  `data/commander-index.json`、`data/locale/*.json`、`data/img/<id>.webp`（图标，
  **只有图标，不含立绘**）。
- 技术栈：pnpm workspace = `core/`（纯逻辑）+ `cli/`（命令行）+ `web/`（Vue 3 + Vite，hash 路由）。
- 提取靠 **wasmoon**（Lua 5.4 WASM）真跑 Lua，正则解析必失败（文件里有原生位运算）。

## 常用命令

```powershell
pnpm -r build                       # 构建全部
pnpm --filter @rivals/cli start extract   # 重新提取 data/
pnpm --filter @rivals/web dev       # 起网页
```

根目录 `_*.py` / `_*.mjs` 是**一次性反解脚本**（gitignore 的），
本地研究用，不算正式代码。
