import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 개발 서버가 백엔드와 에이전트 실행 기록 API를 같은 출처로 프록시한다 (CORS 설정 불필요)
const BACKEND = process.env.COVERAGE_BACKEND ?? 'http://localhost:8080'
const AGENT_RUNS = process.env.COVERAGE_AGENT_RUNS ?? 'http://localhost:8765'
const COVER_AGENT = process.env.COVERAGE_COVER_AGENT ?? 'http://localhost:8766'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/agent': { target: AGENT_RUNS, changeOrigin: true, rewrite: p => p.replace(/^\/agent/, '') },
      '/cover-agent': { target: COVER_AGENT, changeOrigin: true, rewrite: p => p.replace(/^\/cover-agent/, '') },
    },
  },
})
