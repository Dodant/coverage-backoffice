# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

COVERAGE 백오피스: Vite + React 19 + TypeScript SPA, plus one small Node service (`server/cover-agent.mjs`). UI text, comments, and error messages are written in Korean — keep it that way.

## Commands

- `npm run dev` — Vite dev server on http://localhost:5173
- `npm run cover-agent` — cover discovery service on 127.0.0.1:8766 (`COVERAGE_COVER_AGENT_PORT`, optional `GOOGLE_BOOKS_API_KEY`, `KAKAO_REST_API_KEY`)
- `npm run build` — `tsc -b && vite build` (this is the type check)
- `npm run lint` — ESLint
- `npm run test:cover-agent` — `node --test server/cover-agent.test.mjs`
- Single test: `node --test --test-name-pattern "<name substring>" server/cover-agent.test.mjs`

Verification before finishing: `npm run build && npm run lint && npm run test:cover-agent`. There are no frontend tests.

## Runtime topology

The SPA talks to three backends, all same-origin via the Vite proxy (`vite.config.ts`). The backend has **no CORS**, so any deployment must also route these paths from one origin.

| Path prefix | Target (env override) | What it is |
|---|---|---|
| `/api` | `localhost:8080` (`COVERAGE_BACKEND`) | Spring backend in sibling repo `../coverage-backend` (`docker compose up -d && ./gradlew bootRun`) |
| `/agent` → stripped | `localhost:8765` (`COVERAGE_AGENT_RUNS`) | Agent run records, served by `python3 .claude/skills/register-book/api.py serve` in `../coverage-backend` |
| `/cover-agent` → stripped | `localhost:8766` (`COVERAGE_COVER_AGENT`) | `server/cover-agent.mjs` in this repo |

## Architecture

- `src/api.ts` — `api<T>(path)` wraps `fetch('/api' + path)`, attaches `Authorization: Bearer` from the `coverage-backoffice-session` sessionStorage entry if present, throws `ApiError`. Use `safeUrl()` for any externally sourced URL put into `href`/`src`.
- Login UI was removed for development preview (`/login` redirects to `/cover-discovery`), but backend admin mutations (`/admin/...`) and cover-agent `/apply` still require an ADMIN bearer token.
- `src/App.tsx` — sidebar menu + routes; one file per screen in `src/pages/`. Shared bits: `ui.tsx` (`Page<T>` Spring pagination type, `Pager`), `lang.ts` (language code → Korean name).
- Pages call `api()` for backend data, but call `fetch('/cover-agent/...')` and `fetch('/agent/...')` directly.

### Cover agent (`server/cover-agent.mjs`)

Plain `node:http`, no dependencies, bound to 127.0.0.1. `localRequest` rejects non-localhost `Host` (DNS rebinding) and non-JSON POSTs (cross-site requests without preflight), so callers must send `Content-Type: application/json`. Endpoints:
- `/books/search` — searches Kakao (only when `KAKAO_REST_API_KEY` is set; listed first for Korean books), Open Library and Google Books; a failing source is reported in `errors` while the others' results still return. Kakao thumbnails (`search1.kakaocdn.net`) are display-only — not in the `coverUrl` allowlist, so they can't be applied as covers.
- `/discover` — finds cover candidates for a selected book; `?stream=1` streams NDJSON `progress` events then a `result` (or `error`) event.
- `/apply` — verifies the token via backend `/api/users/me` (role must be `ADMIN`), downloads the image (only HTTPS from `covers.openlibrary.org` / `books.google.com` / `books.googleusercontent.com`, manual redirect re-validation, ≤10MB, JPEG/PNG magic-byte check), then uploads to the backend as a cover variant and sets it as primary.

- `/changbi/*` — 창비 자료실 (`Changbi.tsx`). Reads the scraped press-kit data in `../changbi-press` (`COVERAGE_CHANGBI_DIR`; built by `tools/collect.py` there): `GET /changbi/books`, `GET /changbi/{covers,thumbs,candidates}/<file>` (path-checked by `changbiFile`), `POST /changbi/candidates` (unzip a press kit's images), `/changbi/pick` (choose the cover; saved to `overrides.json`, which `collect.py` also honors), `/changbi/apply` (ADMIN; uploads the local file via the same `attachCover` path as `/apply`, shrinking >10MB files). `/changbi/register` (ADMIN) creates a new original as `status: DRAFT` — dropped from 창비 자료실 onto the sidebar 퍼블리시 link; `Publish.tsx` lists drafts via backend `GET /admin/books?status=DRAFT`, edits with `PUT /books/original/:id`, and publishes with `POST /admin/moderation/content/restore`. Translated books are refused (they need an original to attach to). Image work shells out to `changbi-press/venv/bin/python tools/backoffice.py`.

Exported functions take an injectable `fetcher` (and `callBackend` for `applyCover`) — tests stub these instead of hitting the network. Keep that seam when adding logic.

### Domain notes

- Books are originals (원서) with translated editions linked by original id (`/books/original/:id`, `/books/translated/by-original/:id`).
- 표지 묶기 (`Covers.tsx`) groups visually similar covers across languages via backend `similar_group_id`; only registered originals can be grouped. Search falls back to DB similar-book search when the search index errors.
- 커버 탐색 (`CoverDiscovery.tsx`) still shows online search results when registered-book search fails. Ribbon/띠지 status (`clean`/`banded`/`unknown`) is set manually by the admin.
