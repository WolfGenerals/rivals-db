/**
 * 把仓库根的 data/ 同步到 apps/web/public/data/。
 *
 * 为什么需要这一步：Vite 的 publicDir 必须在项目根目录**之内**，
 * 不能指向 ../../data。所以唯一真相留在仓库根，构建时复制一份。
 * public/data/ 已在 .gitignore 中忽略，避免两份数据入库后不一致。
 */
import { cp, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "..");
// apps/web/scripts/ -> 上溯 3 级到仓库根
const REPO_ROOT = resolve(HERE, "../../..");
const SRC = join(REPO_ROOT, "data");
const DEST = join(WEB_ROOT, "public", "data");

try {
  await stat(SRC);
} catch {
  console.error(`数据目录不存在：${SRC}`);
  console.error("提示：先运行 reference/ 里的提取器生成 data/。");
  process.exit(1);
}

await rm(DEST, { recursive: true, force: true });
await cp(SRC, DEST, { recursive: true });
console.log(`已同步 ${SRC} -> ${DEST}`);