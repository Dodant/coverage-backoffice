// 백엔드 호출. 개발 서버가 /api를 백엔드로 프록시한다(vite.config.ts).

export type User = { id: string; email: string; displayName: string; role: string }

const KEY = 'coverage-backoffice-session'

export function session(): { token: string; user: User } | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
  } catch {
    return null
  }
}

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown) {
    const msg = typeof body === 'object' && body && 'message' in body ? String((body as { message: unknown }).message) : String(body)
    super(`${status} ${msg}`)
    this.status = status
    this.body = body
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const s = session()
  if (s) headers.Authorization = `Bearer ${s.token}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch('/api' + path, {
    method: init.method ?? 'GET',
    headers,
    signal: init.signal,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  let data: unknown = text
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* 본문이 JSON이 아니면 문자열 그대로 */
  }
  if (!res.ok) throw new ApiError(res.status, data)
  return data as T
}

// 커버 탐색 서비스(cover-agent) POST. JSON이 아니면 서비스가 403으로 거절한다.
export async function coverAgent<T>(path: string, body: unknown, init: { token?: string; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch('/cover-agent' + path, {
    method: 'POST', body: JSON.stringify(body), signal: init.signal,
    headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message ?? `커버 탐색 서비스에 연결할 수 없습니다 (HTTP ${res.status}). npm run cover-agent를 실행해 주세요.`)
  return data as T
}

// http(s)만 href/src에 넣는다 (에이전트 기록은 웹에서 모은 값이라 javascript: 등을 막는다)
export const safeUrl = (u: unknown) => (/^https?:\/\//i.test(String(u ?? '')) ? String(u) : '')

// 백엔드 /search 결과 한 줄 (id는 original_/translated_ 접두어가 붙는다)
export type SearchItem = { id: string; type: string; title: string; author: string; publisher: string | null; year: number | null; thumbnailUrl: string | null }

// 창비 자료실 카드 → 사이드바 '퍼블리시' 드래그 데이터 형식
export const CHANGBI_DRAG = 'application/x-changbi-key'
