import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm']
  },
  worker: {
    format: 'es'
  }
})