# coverage-backoffice

COVERAGE 관리자 백오피스 (Vite + React + TS). ADMIN 계정으로 로그인한다.

1. 백엔드를 띄운다: `cd ../coverage-backend && docker compose up -d && ./gradlew bootRun` (ADMIN 승격은 백엔드 README)
2. 에이전트 등록 기록을 보려면: `cd ../coverage-backend && python3 .claude/skills/register-book/api.py serve`
3. `npm install && npm run dev` → http://localhost:5173 (개발 서버가 `/api`는 백엔드 8080, `/agent`는 실행 기록 8765로 프록시. 바꾸려면 `COVERAGE_BACKEND`, `COVERAGE_AGENT_RUNS`)
4. 화면: 대시보드·감사 로그, 표지 묶기(언어가 달라도 비슷한 표지, 백엔드 `similar_group_id`), 등록 기록(에이전트 runs/), 엔티티 정리(병합·별칭·재색인)
5. 확인: `npm run build && npm run lint`. 배포 시에는 같은 출처에서 `/api`를 백엔드로 넘겨야 한다(백엔드에 CORS 설정 없음)
