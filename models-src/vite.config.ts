import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Base path 配置(切换点):
 * - 已合并进 Jing-Li/adborder 仓库(branch 部署,站点根 https://adborder.top/),
 *   排行榜挂 /models/ 子路径,构建产物 rsync 至仓库根 models/。
 * - 本地独立开发时如需根路径:VITE_BASE= npm run build
 */
const BASE = process.env.VITE_BASE ?? '/models/'

export default defineConfig({
  plugins: [react()],
  base: BASE,
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
