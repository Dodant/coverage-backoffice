# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

COVERAGE 백오피스: Vite + React 19 + TypeScript SPA, plus one small dependency-free Node service (`server/cover-agent.mjs`). UI text, comments, and error messages are written in Korean — keep it that way.

## 문서 지도 — 작업 전에 읽을 것

| 작업 | 먼저 읽을 문서 |
|---|---|
| 구조 파악, 화면·라우트 찾기, 데이터 흐름, 도메인 용어(원서/번역서/표지 변형/디자인 묶음) | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| cover-agent 엔드포인트 추가·수정, 백엔드 API 호출 추가 | [docs/API.md](docs/API.md) |
| 로컬 실행, 환경변수, 테스트 작성, 코딩 규칙, 자주 하는 실수, 배포 제약 | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |
| `server/**` 수정 | `.claude/rules/cover-agent.md` |
| `src/**`, `tests/browser/**` 수정 | `.claude/rules/frontend.md` |

파일명이 날짜로 끝나는 `docs/*-YYYY-MM-DD.md`(예: `docs/backoffice-verification-2026-10-27.md`)는 특정 날짜의 검증 기록이다. 현재 동작의 명세로 쓰지 않는다. 백엔드 API의 원본은 형제 저장소 `../coverage-backend`다.

## Commands

- `npm run dev` — Vite dev server on http://localhost:5173
- `npm run cover-agent` — cover discovery service on 127.0.0.1:8766 (`COVERAGE_COVER_AGENT_PORT`, optional `GOOGLE_BOOKS_API_KEY`, `KAKAO_REST_API_KEY`, `COVERAGE_CHANGBI_DIR`)
- `npm run build` — `tsc -b && vite build` (the only type check; covers `src/` and `vite.config.ts`)
- `npm run lint` — ESLint (`*.ts`/`*.tsx` only — `server/*.mjs` is not linted)
- `npm run test:cover-agent` — `node --test server/cover-agent.test.mjs`
- Single test: `node --test --test-name-pattern "<name substring>" server/cover-agent.test.mjs`
- `npm run test:browser` — Playwright 표지 편집 회귀 테스트. 최초 `npx playwright install chromium` 필요. 로컬 Chrome은 `PLAYWRIGHT_CHANNEL=chrome npm run test:browser`. 전용 포트 4175와 모킹 API를 사용한다.

Verification before finishing: `npm run build && npm run lint && npm run test:cover-agent`. 표지 편집(`src/pages/BookDetail.tsx`) 변경 시 `npm run test:browser`도 실행한다.

## Runtime topology

The SPA talks to three backends, all same-origin via the Vite proxy (`vite.config.ts`). The backend has **no CORS**, so any deployment must also route these paths from one origin.

| Path prefix | Target (env override) | What it is |
|---|---|---|
| `/api` | `localhost:8080` (`COVERAGE_BACKEND`) | Spring backend in sibling repo `../coverage-backend` (`docker compose up -d && ./gradlew bootRun`) |
| `/agent` → stripped | `localhost:8765` (`COVERAGE_AGENT_RUNS`) | Agent run records, served by `python3 .claude/skills/register-book/api.py serve` in `../coverage-backend` |
| `/cover-agent` → stripped | `localhost:8766` (`COVERAGE_COVER_AGENT`) | `server/cover-agent.mjs` in this repo; reads `../changbi-press` |

## 핵심 규칙

요약이다. 규칙의 원본과 예외는 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#코딩-규칙)에 있으며, 바꿀 때는 그쪽을 고친다.

- **Auth**: Login UI was removed for development preview (`/login` → `/cover-discovery`). Backend admin mutations (`/admin/...`, `PUT /books/...`, `/covers`) and cover-agent `/apply`, `/changbi/apply`, `/changbi/register` still require an ADMIN bearer token, read from sessionStorage `coverage-backoffice-session` by `session()` in `src/api.ts`.
- **Calls**: backend via `api<T>('/path')` (no `/api` prefix); cover-agent POSTs via `coverAgent<T>()` — the agent rejects non-JSON POSTs and non-localhost `Host` with 403. Direct `fetch` only for `/agent/*`, cover-agent GETs, the `/discover?stream=1` NDJSON stream, and the multipart upload `POST /api/covers` (`api()` JSON-encodes bodies, so never route `FormData` through it).
- **URLs**: any externally sourced URL put into `href`/`src` goes through `safeUrl()` (or `imageOf()`).
- **Book PUT is partial**: `PUT /books/{original,translated}/:id` treats missing/`null` as "keep" and `''` as a value — send only changed fields and refuse blanks. Cover metadata `PUT /admin/catalog/:id/covers/:coverId` is the opposite: send the whole form; an empty value clears the field (e.g. `copyrightHolder`).
- **Cover sources**: only HTTPS from `covers.openlibrary.org` / `books.google.com` / `books.googleusercontent.com` can be applied. Kakao thumbnails are display-only. Don't widen the allowlist without updating validation and tests.
- **Testability seam**: cover-agent exports take injectable `fetcher` / `callBackend` / `tool` / `dir`; tests stub these instead of hitting the network. Keep that seam when adding logic.
- **Unsaved edits**: `BookDetail.tsx` cover cards are keyed by cover ID and only resync when not dirty. Don't key them by refresh revision.
- **Image identity**: `EXACT_FILE` (file SHA-256), `SAME_URL`, `SIMILAR` (review candidate only) are distinct; never auto-merge similar candidates. 보완 항목(issues) are hints, not publish blockers.
- **창비 등록**: translated books are refused by `/changbi/register` (they need an original). Keep `src/changbi.ts` / `Changbi.tsx` `canQueue` in sync with server rules.
- Don't add dependencies by default; mark deliberate shortcuts with a `// ponytail:` comment naming the limit.
