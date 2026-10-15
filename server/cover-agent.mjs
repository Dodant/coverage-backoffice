import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const backend = (process.env.COVERAGE_BACKEND ?? 'http://localhost:8080').replace(/\/$/, '')
const port = Number(process.env.COVERAGE_COVER_AGENT_PORT ?? 8766)

const clean = value => typeof value === 'string' ? value.trim().slice(0, 200) : ''
const isbnDigits = value => value.replace(/[\s-]/g, '').toUpperCase()
const https = value => typeof value === 'string' && /^https?:\/\//i.test(value) ? value.replace(/^http:/i, 'https:') : ''
function validIsbn(value) {
  if (/^\d{13}$/.test(value)) return [...value].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === 0
  if (/^\d{9}[\dX]$/.test(value)) return [...value].reduce((sum, digit, index) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0) % 11 === 0
  return false
}

async function jsonFrom(url, fetcher) {
  const response = await fetcher(url, { headers: { 'User-Agent': 'coverage-cover-agent/1.0 (cover discovery)' }, signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function fromOpenLibrary(data, isbn) {
  if ('covers' in data) {
    return (data.covers ?? []).slice(0, 8).map(id => ({
      id: `ol-edition-${id}`, source: 'Open Library', title: data.title ?? '', authors: [],
      isbn: isbn || ((data.isbn_13 ?? data.isbn_10 ?? [])[0] ?? ''),
      imageUrl: `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`,
      sourceUrl: `https://openlibrary.org${data.key}`, match: 'isbn',
    }))
  }
  return (data.docs ?? []).filter(doc => Number.isInteger(doc.cover_i)).slice(0, 12).map(doc => ({
    id: `ol-work-${doc.cover_i}`, source: 'Open Library', title: doc.title ?? '',
    authors: (doc.author_name ?? []).slice(0, 3), isbn: '',
    imageUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false`,
    sourceUrl: `https://openlibrary.org${doc.key}`, match: 'title',
  }))
}

function fromGoogleBooks(data, isbn) {
  return (data.items ?? []).flatMap(item => {
    const info = item.volumeInfo ?? {}
    const links = info.imageLinks ?? {}
    const imageUrl = https(links.extraLarge || links.large || links.medium || links.small || links.thumbnail || links.smallThumbnail)
    if (!imageUrl) return []
    const identifiers = (info.industryIdentifiers ?? []).map(x => x.identifier)
    const exact = isbn && identifiers.some(x => isbnDigits(x) === isbn)
    return [{
      id: `google-${item.id}`, source: 'Google Books', title: info.title ?? '',
      authors: (info.authors ?? []).slice(0, 3), isbn: identifiers.find(x => x.length === 13) ?? identifiers[0] ?? '',
      imageUrl, sourceUrl: https(info.infoLink || item.selfLink) || `https://books.google.com/books?id=${encodeURIComponent(item.id)}`,
      match: exact ? 'isbn' : 'title',
    }]
  }).slice(0, 12)
}

export async function discover(input = {}, fetcher = fetch, onProgress = () => {}) {
  const title = clean(input.title)
  const author = clean(input.author)
  const isbn = isbnDigits(clean(input.isbn))
  if (!title && !isbn) throw new Error('제목 또는 ISBN을 입력해 주세요.')
  if (isbn && !validIsbn(isbn)) throw new Error('올바른 ISBN-10 또는 ISBN-13을 입력해 주세요.')

  const ol = new URL(isbn ? `https://openlibrary.org/isbn/${isbn}.json` : 'https://openlibrary.org/search.json')
  if (!isbn) {
    ol.searchParams.set('title', title)
    if (author) ol.searchParams.set('author', author)
    ol.searchParams.set('fields', 'key,title,author_name,cover_i')
    ol.searchParams.set('limit', '20')
  }
  const google = new URL('https://www.googleapis.com/books/v1/volumes')
  google.searchParams.set('q', isbn ? `isbn:${isbn}` : [title, author].filter(Boolean).join(' '))
  google.searchParams.set('maxResults', '20')
  if (process.env.GOOGLE_BOOKS_API_KEY) google.searchParams.set('key', process.env.GOOGLE_BOOKS_API_KEY)
  const sources = [
    { name: 'Open Library', run: async () => fromOpenLibrary(await jsonFrom(ol, fetcher), isbn) },
    { name: 'Google Books', run: async () => fromGoogleBooks(await jsonFrom(google, fetcher), isbn) },
  ]
  const searches = await Promise.allSettled(sources.map(async source => {
    try {
      const found = await source.run()
      onProgress({ source: source.name, status: 'done', count: found.length })
      return found
    } catch (error) {
      onProgress({ source: source.name, status: 'failed', count: 0 })
      throw error
    }
  }))
  const errors = []
  const candidates = []
  if (searches[0].status === 'fulfilled') candidates.push(...searches[0].value)
  else errors.push('Open Library 조회 실패')
  if (searches[1].status === 'fulfilled') candidates.push(...searches[1].value)
  else errors.push('Google Books 조회 실패')
  if (errors.length === 2) throw new Error('커버 출처에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  const unique = [...new Map(candidates.map(c => [c.imageUrl, c])).values()]
  unique.sort((a, b) => (a.match === 'isbn' ? 0 : 1) - (b.match === 'isbn' ? 0 : 1))
  return { candidates: unique, errors }
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 4096) throw new Error('입력 크기가 너무 큽니다.')
    chunks.push(chunk)
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('입력 형식이 올바르지 않습니다.')
    return data
  } catch {
    throw new Error('입력 형식이 올바르지 않습니다.')
  }
}

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

export function startServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    if (request.method !== 'POST' || url.pathname !== '/discover') return send(response, 404, { message: 'Not found' })
    const authorization = request.headers.authorization ?? ''
    if (!/^Bearer \S+$/.test(authorization)) return send(response, 401, { message: '로그인이 필요합니다.' })
    try {
      const check = await fetch(`${backend}/api/users/me`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(5000) })
      if (!check.ok) return send(response, 401, { message: '관리자 인증에 실패했습니다.' })
      const user = await check.json()
      if (user.role !== 'ADMIN') return send(response, 403, { message: '관리자만 사용할 수 있습니다.' })
      const input = await readBody(request)
      if (url.searchParams.get('stream') === '1') {
        response.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no',
        })
        response.flushHeaders()
        const emit = event => response.write(JSON.stringify(event) + '\n')
        const result = await discover(input, fetch, progress => emit({ type: 'progress', ...progress }))
        emit({ type: 'result', ...result })
        response.end()
        return
      }
      return send(response, 200, await discover(input))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (response.headersSent) {
        response.end(JSON.stringify({ type: 'error', message }) + '\n')
        return
      }
      return send(response, /입력|ISBN|제목|JSON/.test(message) ? 400 : 502, { message })
    }
  }).listen(port, '127.0.0.1', () => console.log(`Cover agent listening on http://127.0.0.1:${port}`))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer()
