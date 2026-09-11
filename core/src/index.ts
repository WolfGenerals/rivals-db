/**
 * `@rivals/core` 的公开 API。
 *
 * - `./types`    读 `data/` 产物的类型定义与安全访问器（推荐入口）
 * - `./query`    基于 Lua 语义重写的纯函数（旧 API，保留兼容）
 * - `./extract`  提取层：执行游戏 Lua + 解析 game-config.pb
 *
 * 字段语义与陷阱见 docs/data-semantics.md，
 * 等级换算公式见 docs/level-scaling.md。
 */

export * from "./types.ts";
export * from "./levels.ts";
export * from "./query.ts";
export * from "./extract/index.ts";