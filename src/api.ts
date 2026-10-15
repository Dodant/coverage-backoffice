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

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const s = session()
  if (s) headers.Authorization = `Bearer ${s.token}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch('/api' + path, {
    method: init.method ?? 'GET',
    headers,
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

// http(s)만 href/src에 넣는다 (에이전트 기록은 웹에서 모은 값이라 javascript: 등을 막는다)
export const safeUrl = (u: unknown) => (/^https?:\/\//i.test(String(u ?? '')) ? String(u) : '')
