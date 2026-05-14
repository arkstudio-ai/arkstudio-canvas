import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { readFileSync } from 'fs';

// Read the monorepo root version so the admin "Source" card shows a
// number that matches `git tag` / GitHub releases. Falls back to the
// web-app's own version if the root file ever moves.
const rootPkg = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
);
const ARK_REPO_URL = 'https://github.com/arkstudio-ai/arkstudio-canvas';

const rootDir = path.resolve(__dirname);
const canvasCoreRoot = path.resolve(__dirname, '../../packages/core');
const canvasCoreSrc = path.resolve(canvasCoreRoot, 'src');
const rootNodeModules = path.resolve(rootDir, 'node_modules');
const aliasReact = path.resolve(rootNodeModules, 'react');
const aliasReactDom = path.resolve(rootNodeModules, 'react-dom');
const aliasReactFlow = path.resolve(rootNodeModules, '@xyflow/react');
const aliasLucide = path.resolve(rootNodeModules, 'lucide-react');

const serverConfig = {
  host: '0.0.0.0',
  port: 5173,
  strictPort: false,
  cors: true,
  allowedHosts: ['e3337169l8.qicp.vip', 'localhost', '.qicp.vip'],
  hmr: {
    protocol: 'ws',
    host: 'localhost',
    port: 5173,
  },
  fs: {
    allow: [rootDir, canvasCoreRoot],
  },
  // 🎬 代理 video-editor，实现同源通信
  proxy: {
    '/video-edit': {
      target: 'http://localhost:3000',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/video-edit/, '/edit'),
    },
    // 代理 video-editor 的静态资源
    '/_next': {
      target: 'http://localhost:3000',
      changeOrigin: true,
    },
    // 代理 video-editor 的 API
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
    },
    // 本地存储 — 让 <img src="/static/uploads/..."> 在 dev 模式下
    // 同源访问到 backend (18500)。生产模式由 nginx 反代同样路径，
    // 所以前端代码无需做 dev/prod 分叉。
    '/static/uploads': {
      target: 'http://localhost:18500',
      changeOrigin: true,
    },
  },
};

export default defineConfig({
  base: '/',
  plugins: [react()],
  // Compile-time constants; `JSON.stringify` is required so vite
  // substitutes them as literals rather than identifier references.
  // These power the AGPL §13 "Source" card on /admin/system — every
  // SaaS instance must surface a way to retrieve corresponding source.
  define: {
    __ARK_VERSION__: JSON.stringify(rootPkg.version ?? '0.0.0'),
    __ARK_REPO_URL__: JSON.stringify(ARK_REPO_URL),
    __ARK_LICENSE_NAME__: JSON.stringify('AGPL-3.0-only'),
    __ARK_LICENSE_URL__: JSON.stringify(`${ARK_REPO_URL}/blob/main/LICENSE`),
  },
  server: serverConfig,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@canvas-flow/core': canvasCoreSrc,
      react: aliasReact,
      'react-dom': aliasReactDom,
      '@xyflow/react': aliasReactFlow,
      'lucide-react': aliasLucide,
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', '@xyflow/react', 'lucide-react'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
    },
  },
});
