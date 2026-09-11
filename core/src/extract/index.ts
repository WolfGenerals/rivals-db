/** 数据提取：执行游戏 Lua 调参脚本 + 解析 game-config.pb，产出 JSON 产物。 */

export {
  extractAll,
  findScriptsRoot,
  splitVariant,
  factionOf,
  toPlain,
  RivalsError,
  type ExtractOptions,
  type ExtractResult,
} from "./extract.ts";

export {
  readVarint,
  decodeFields,
  asString,
  firstField,
  subFields,
  extractPbUnits,
  extractPbFaction,
  startingMajor,
  PB_PATH,
  RARITY_BY_INDEX,
  type PbUnit,
  type PbFaction,
  type WireField,
} from "./gameConfigPb.ts";

export {
  writeAll,
  indexPayload,
  payloadFor,
  stableJson,
  FILE_NOTE,
  INDEX_NOTE,
  type WriteOptions,
} from "./write.ts";

export { createLuaRuntime, stripBom, REAL_MODULES, firstLine, type LuaRuntime } from "./luaRuntime.ts";
