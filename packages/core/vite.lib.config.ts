import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // 监听所有地址
    port: 5173,
    strictPort: false,
    cors: true, // 允许跨域
    // 允许任何 host 访问（解决花生壳 403 问题）
    allowedHosts: [
      'e3337169l8.qicp.vip',
      'localhost',
      '.qicp.vip', // 允许所有 qicp.vip 子域名
    ],
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5173,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'CanvasFlow',
      fileName: (format) => `canvas-flow.${format}.js`,
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', '@xyflow/react'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          '@xyflow/react': 'ReactFlow',
        },
      },
    },
  },
});
