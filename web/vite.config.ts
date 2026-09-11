import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],

  // GitHub Pages 部署在 https://<user>.github.io/<repo>/ 这类子路径时，
  // 必须把 base 改成 "/<repo>/"。用相对路径 "./" 则无需关心子路径。
  // hash 路由也因此能在 file:// 下直接打开。
  base: "./",

  // publicDir：其中的文件**原样复制**到构建输出根，不做打包/哈希/类型检查。
  // 默认值就是 "public"。data/ 是纯运行时读取的静态资源，正适合放这里。
  // 注意：publicDir 必须位于项目根之内，不能写 "../../data"。
  publicDir: "public",

  build: {
    outDir: "dist",
    emptyOutDir: true,
  },

  server: {
    watch: {
      // Windows 上工具/编辑器保存文件常常是「先写临时目录，再原子替换」，
      // Vite 会试图去 watch 那个临时文件，等它被删掉时就抛
      // `EBUSY: resource busy or locked`，**直接把 dev server 弄崩**。
      // 踩过两次：一次是 sync-data 重建 public/data，一次是改 web/src 下的 .vue。
      ignored: ["**/.*.tmpdir/**", "**/*.tmpdir/**", "**/*.tmp", "**/.*.tmp"],
    },
  },
});
