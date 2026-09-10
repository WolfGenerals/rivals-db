import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages 部署在 https://<user>.github.io/<repo>/ 这类子路径时，
  // 必须把 base 改成 "/<repo>/"。用相对路径 "./" 则无需关心子路径。
  base: "./",

  // publicDir：其中的文件**原样复制**到构建输出根，不做打包/哈希/类型检查。
  // 默认值就是 "public"。data/ 是纯运行时读取的静态资源，正适合放这里。
  // 注意：publicDir 必须位于项目根之内，不能写 "../../data"。
  publicDir: "public",

  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
