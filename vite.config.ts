import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  plugins: [glsl({ compress: false })],
  server: { port: 5178, host: '127.0.0.1' },
  build: { target: 'esnext', sourcemap: true },
});
