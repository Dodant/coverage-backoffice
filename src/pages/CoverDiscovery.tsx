import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { loadEditions } from '../catalog'
import { api, coverAgent, safeUrl, session } from '../api'
import { langName } from '../lang'

type Cover = {
  id: string; imageUrl: string | null; thumbnailUrl: string | null; width: number | null; height: number | null
  label: string | null; printingFrom: number | null; sourceName: string | null
}
type Book = {
  id: string; title: string; languageCode: string; isbn: string | null; edition: string | null; year: number | null
  countryCode: string | null; author: { name: string } | null; publisher: { name: string } | null
  frontCover: Cover | null; covers: Cover[]
}
type SearchItem = { id: string; type: string; title: string; author: string; year: number | null }
type OnlineBook = { id: string; source: string; title: string; authors: string[]; isbn: string; year: number | null; language: string; imageUrl: string; sourceUrl: string }
type BookSearchResult = { books: OnlineBook[]; errors: string[] }
type Candidate = {
  id: string; source: string; title: string; authors: string[]; isbn: string; imageUrl: string; sourceUrl: string
  match: 'isbn' | 'title'; publisher: string; year: number | null; edition: string
}
type Discovery = { candidates: Candidate[]; errors: string[] }
type SourceName = 'Open Library' | 'Google Books'
type SourceProgress = { status: 'waiting' | 'done' | 'failed'; count: number }
type Progress = { phase: 'connecting' | 'searching' | 'done' | 'failed'; sources: Record<SourceName, SourceProgress> }
type StreamEvent =
  | { type: 'progress'; source: SourceName; status: 'done' | 'failed'; count: number }
  | ({ type: 'result' } & Discovery)
  | { type: 'error'; message: string }
type Ribbon = 'clean' | 'unknown' | 'banded'

const sources: SourceName[] = ['Open Library', 'Google Books']
const newProgress = (): Progress => ({ phase: 'connecting', sources: {
  'Open Library': { status: 'waiting', count: 0 }, 'Google Books': { status: 'waiting', count: 0 },
} })
const coverImage = (cover: Cover | null) => safeUrl(cover?.thumbnailUrl || cover?.imageUrl)
const versionKey = (candidate: Candidate) => candidate.isbn || [candidate.title, candidate.publisher, candidate.year, candidate.edition].join('|')
const versionLabel = (candidate: Candidate) => [candidate.publisher, candidate.year, candidate.edition, candidate.isbn].filter(Boolean).join(' · ') || candidate.title

export default function CoverDiscovery() {
  const [params] = useSearchParams()
  const initialOriginalId = params.get('originalId')
  const initialBookId = params.get('bookId')
  const [query, setQuery] = useState('')
  const [searchingBooks, setSearchingBooks] = useState(false)
  const [onlineBooks, setOnlineBooks] = useState<OnlineBook[] | null>(null)
  const [selectedOnline, setSelectedOnline] = useState<OnlineBook | null>(null)
  const [bookResults, setBookResults] = useState<SearchItem[] | null>(null)
  const [bookSearchNotice, setBookSearchNotice] = useState('')
  const [bookSearchError, setBookSearchError] = useState('')
  const [original, setOriginal] = useState<Book | null>(null)
  const [translations, setTranslations] = useState<Book[]>([])
  const [targetId, setTargetId] = useState('')
  const [activeEditions, setActiveEditions] = useState<Record<string, string>>({})
  const [searchInput, setSearchInput] = useState({ title: '', author: '', isbn: '' })
  const [result, setResult] = useState<Discovery | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [selectedVersion, setSelectedVersion] = useState('')
  const [selectedCandidate, setSelectedCandidate] = useState('')
  const [ribbons, setRibbons] = useState<Record<string, Ribbon>>({})
  const [dimensions, setDimensions] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState('')
  const requestId = useRef(0)
  const bookSearchId = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const searchBooks = async (event: FormEvent) => {
    event.preventDefault()
    if (!query.trim()) return
    const id = ++bookSearchId.current
    setSearchingBooks(true)
    setOnlineBooks(null)
    setBookResults(null)
    setBookSearchNotice('')
    setBookSearchError('')
    setSelectedOnline(null)
    setOriginal(null)
    setTranslations([])
    setTargetId('')
    abortRef.current?.abort()
    setResult(null)
    setProgress(null)
    const term = query.trim()
    const online = coverAgent<BookSearchResult>('/books/search', { query: term }, { signal: AbortSignal.timeout(15000) }).then(data => {
      if (id === bookSearchId.current) {
        setOnlineBooks(data.books)
        setBookSearchNotice(data.errors.join(' · '))
      }
    }).catch(e => { if (id === bookSearchId.current) setBookSearchError(e instanceof Error ? e.message : String(e)) })
    const registered = api<{ items: SearchItem[] }>(`/search?${new URLSearchParams({ query: term, size: '50' })}`, { signal: AbortSignal.timeout(5000) })
      .then(data => { if (id === bookSearchId.current) setBookResults(data.items.filter(item => item.type === 'ORIGINAL')) })
      .catch(() => { /* 등록 도서 검색 장애는 온라인 검색을 막지 않는다. */ })
    await Promise.all([online, registered])
    if (id === bookSearchId.current) setSearchingBooks(false)
  }

  const discover = async (input: typeof searchInput) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const id = ++requestId.current
    setResult(null)
    setSelectedVersion('')
    setSelectedCandidate('')
    setRibbons({})
    setDimensions({})
    setError('')
    setMessage('')
    setCopied('')
    setLoading(true)
    setProgress(newProgress())
    try {
      const response = await fetch('/cover-agent/discover?stream=1', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.message ?? '커버 탐색 서비스에 연결할 수 없습니다. npm run cover-agent를 실행해 주세요.')
      }
      if (!response.body) throw new Error('진행 상태를 받을 수 없습니다.')
      if (id === requestId.current) setProgress(p => p && { ...p, phase: 'searching' })
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      const handleLine = (line: string) => {
        if (!line.trim() || id !== requestId.current) return
        const event = JSON.parse(line) as StreamEvent
        if (event.type === 'progress') setProgress(p => p && { ...p, sources: { ...p.sources, [event.source]: { status: event.status, count: event.count } } })
        else if (event.type === 'result') {
          finished = true
          setResult({ candidates: event.candidates, errors: event.errors })
          setSelectedVersion(event.candidates[0] ? versionKey(event.candidates[0]) : '')
          setProgress(p => p && { ...p, phase: 'done' })
        } else if (event.type === 'error') throw new Error(event.message)
      }
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) handleLine(line)
        if (done) break
      }
      handleLine(buffer)
      if (!finished && id === requestId.current) throw new Error('탐색이 완료되기 전에 연결이 끊겼습니다.')
    } catch (e) {
      if (id === requestId.current && !controller.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e))
        setProgress(p => p && { ...p, phase: 'failed' })
      }
    } finally { if (id === requestId.current) setLoading(false) }
  }

  const pickBook = (book: Book) => {
    setTargetId(book.id)
    const input = { title: book.title, author: book.author?.name ?? original?.author?.name ?? '', isbn: book.isbn ?? '' }
    setSearchInput(input)
    void discover(input)
  }

  const loadWork = useCallback(async (originalId: string, preferredId?: string, signal?: AbortSignal) => {
    const [main, ...translated] = await loadEditions<Book>(originalId, signal)
    if (signal?.aborted) throw new DOMException('취소됨', 'AbortError')
    setOriginal(main)
    setTranslations(translated)
    const groups: Record<string, string> = {}
    for (const book of translated) groups[book.languageCode] ??= book.id
    if (preferredId) {
      const selected = translated.find(book => book.id === preferredId)
      if (selected) groups[selected.languageCode] = selected.id
    }
    setActiveEditions(groups)
    return { main, translated }
  }, [])

  useEffect(() => {
    if (!initialOriginalId) return
    const controller = new AbortController()
    loadWork(initialOriginalId, initialBookId ?? undefined, controller.signal).then(({ main, translated }) => {
      if (controller.signal.aborted) return
      const book = translated.find(b => b.id === initialBookId) ?? main
      setTargetId(book.id)
      setSearchInput({ title: book.title, author: book.author?.name ?? main.author?.name ?? '', isbn: book.isbn ?? '' })
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)) })
    return () => controller.abort()
  }, [initialOriginalId, initialBookId, loadWork])

  const pickOriginal = async (item: SearchItem) => {
    setSelectedOnline(null)
    setError('')
    try {
      const { main } = await loadWork(item.id.replace(/^original_/, ''))
      abortRef.current?.abort()
      setTargetId(main.id)
      setSearchInput({ title: main.title, author: main.author?.name ?? '', isbn: main.isbn ?? '' })
      setResult(null)
      setProgress(null)
    } catch (e) { setError(String(e)) }
  }

  const pickOnline = (book: OnlineBook) => {
    abortRef.current?.abort()
    setSelectedOnline(book)
    setOriginal(null)
    setTranslations([])
    setTargetId('')
    setSearchInput({ title: book.title, author: book.authors[0] ?? '', isbn: book.isbn })
    setResult(null)
    setProgress(null)
    setError('')
  }

  const setRepresentative = async (book: Book, cover: Cover) => {
    if (!original || applying) return
    setApplying(true)
    setError('')
    try {
      await api(`/books/${book.id}/covers/${cover.id}/representative`, { method: 'PUT' })
      await loadWork(original.id, book.id)
      setMessage(`${book.title}의 대표 표지를 변경했습니다.`)
    } catch (e) { setError(String(e)) }
    finally { setApplying(false) }
  }

  const apply = async () => {
    const candidate = result?.candidates.find(item => item.id === selectedCandidate)
    const book = [original, ...translations].find(item => item?.id === targetId)
    if (!candidate || !book || !original || applying) return
    setApplying(true)
    setError('')
    setMessage('이미지를 검증하고 등록하는 중…')
    try {
      const body = await coverAgent<{ warning?: string }>('/apply', {
        bookId: book.id, kind: book.id === original.id ? 'original' : 'translated',
        imageUrl: candidate.imageUrl, source: candidate.source, ribbon: ribbons[candidate.id] ?? 'unknown',
        edition: candidate.edition, publisher: candidate.publisher, year: candidate.year,
      }, { token: session()?.token ?? '' })
      await loadWork(original.id, book.id)
      setMessage(body.warning ?? `${book.title}에 표지를 추가하고 대표 표지로 지정했습니다.`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setMessage('') }
    finally { setApplying(false) }
  }

  const copyImage = async (candidate: Candidate) => {
    try {
      await navigator.clipboard.writeText(candidate.imageUrl)
      setCopied(candidate.id)
    } catch { setError('이미지 주소를 복사하지 못했습니다.') }
  }

  const groups = new Map<string, Book[]>()
  for (const book of translations) groups.set(book.languageCode, [...(groups.get(book.languageCode) ?? []), book])
  const target = [original, ...translations].find(book => book?.id === targetId)
  const versionMap = new Map<string, Candidate[]>()
  for (const candidate of result?.candidates ?? []) versionMap.set(versionKey(candidate), [...(versionMap.get(versionKey(candidate)) ?? []), candidate])
  const candidates = (versionMap.get(selectedVersion) ?? []).sort((a, b) =>
    ({ clean: 0, unknown: 1, banded: 2 })[ribbons[a.id] ?? 'unknown'] - ({ clean: 0, unknown: 1, banded: 2 })[ribbons[b.id] ?? 'unknown'])
  const chosen = result?.candidates.find(candidate => candidate.id === selectedCandidate)
  const canManage = Boolean(session()?.token)

  return <>
    <h1>커버 탐색·적용</h1>
    <p className="muted">책을 먼저 검색해 원서를 선택하세요. 선택한 책의 저자와 ISBN으로 커버 후보를 찾고, 등록된 책은 번역서도 비교할 수 있습니다.</p>
    {!canManage && <p className="note">개발 미리보기에서는 커버 탐색과 비교를 사용할 수 있습니다. 표지 등록과 대표 표지 변경은 백엔드 관리자 인증이 필요합니다.</p>}
    <section className="panel">
      <h2>1. 책 검색</h2>
      <form className="row" onSubmit={searchBooks}>
        <input aria-label="도서 검색어" placeholder="책 제목, 저자 또는 ISBN" value={query} onChange={e => setQuery(e.target.value)} />
        <button disabled={searchingBooks || !query.trim()}>{searchingBooks ? '책 찾는 중…' : '책 찾기'}</button>
      </form>
    </section>
    {bookSearchError && <p className="error" role="alert">{bookSearchError}</p>}
    {bookSearchNotice && <p className="note" role="status">{bookSearchNotice}</p>}
    {bookResults && bookResults.length > 0 && <section className="panel">
      <h2>등록된 원서</h2>
      <div className="discovery-book-results">{bookResults.map(item => <button key={item.id} onClick={() => void pickOriginal(item)}>{item.title} <span className="muted small">{item.author} {item.year ?? ''}</span></button>)}</div>
    </section>}
    {onlineBooks && <section className="panel">
      <h2>온라인 도서 검색 결과 <span className="muted small">{onlineBooks.length}권</span></h2>
      <div className="book-search-results">{onlineBooks.map(book => <button key={book.id} className={'book-search-item' + (selectedOnline?.id === book.id ? ' selected' : '')} onClick={() => pickOnline(book)}>
        {safeUrl(book.imageUrl) ? <img src={safeUrl(book.imageUrl)} alt="" loading="lazy" /> : <span className="nocover">표지 없음</span>}
        <span><strong>{book.title}</strong><small>{[book.authors.join(', '), book.year, book.language, book.isbn && `ISBN ${book.isbn}`].filter(Boolean).join(' · ')}</small><small>{book.source}</small></span>
      </button>)}</div>
      {!onlineBooks.length && <p className="muted">검색된 책이 없습니다. 제목이나 ISBN을 바꿔 다시 찾아보세요.</p>}
    </section>}
    {selectedOnline && <section className="panel selected-book"><h2>선택한 원서</h2><strong>{selectedOnline.title}</strong><span className="muted small">{selectedOnline.authors.join(', ')} · {selectedOnline.source}</span><a href={safeUrl(selectedOnline.sourceUrl)} target="_blank" rel="noopener noreferrer">도서 정보 보기</a></section>}
    {original && <div className="work-layout">
      <section className="panel work-original">
        <h2>원서 · 메인</h2>
        <BookPanel book={original} active={targetId === original.id} applying={applying} canManage={canManage} onPick={pickBook} onRepresentative={setRepresentative} />
      </section>
      <section className="work-translations">
        <h2>번역서 {translations.length}종</h2>
        <div className="translation-grid">
          {[...groups].map(([language, books]) => {
            const current = books.find(book => book.id === activeEditions[language]) ?? books[0]
            return <section className="panel" key={language}>
              <div className="row"><strong>{langName(language)}</strong><span className="muted small">{books.length}종</span></div>
              {books.length > 1 && <label className="small edition-picker">판 선택
                <select value={current.id} onChange={e => { const book = books.find(item => item.id === e.target.value)!; setActiveEditions(p => ({ ...p, [language]: book.id })); pickBook(book) }}>
                  {books.map(book => <option key={book.id} value={book.id}>{[book.edition, book.publisher?.name, book.year, book.isbn].filter(Boolean).join(' · ') || book.title}</option>)}
                </select>
              </label>}
              <BookPanel book={current} active={targetId === current.id} applying={applying} canManage={canManage} onPick={pickBook} onRepresentative={setRepresentative} />
            </section>
          })}
          {!translations.length && <p className="muted">등록된 번역서가 없습니다.</p>}
        </div>
      </section>
    </div>}
    {(target || selectedOnline) && <section className="panel">
      <h2>2. {target && target.id !== original?.id ? langName(target.languageCode) + ' 번역서' : '원서'} 커버 후보 탐색</h2>
      <form className="discovery-form" onSubmit={e => { e.preventDefault(); void discover(searchInput) }}>
        <label>제목<input value={searchInput.title} onChange={e => setSearchInput(p => ({ ...p, title: e.target.value }))} /></label>
        <label>저자<input value={searchInput.author} onChange={e => setSearchInput(p => ({ ...p, author: e.target.value }))} /></label>
        <label>ISBN<input value={searchInput.isbn} onChange={e => setSearchInput(p => ({ ...p, isbn: e.target.value }))} /></label>
        <button className="primary" disabled={loading || applying || (!searchInput.title.trim() && !searchInput.isbn.trim())}>{loading ? '탐색 중…' : result ? '다시 탐색' : '커버 후보 찾기'}</button>
      </form>
    </section>}
    {progress && <section className="panel discovery-progress" aria-label="커버 탐색 진행도" aria-live="polite">
      <div className="row" style={{ justifyContent: 'space-between' }}><strong>{progress.phase === 'connecting' ? '탐색 서비스 연결 중…' : progress.phase === 'searching' ? '판과 커버를 찾는 중…' : progress.phase === 'done' ? '탐색 완료' : '탐색 중단'}</strong>
        <span className="muted small">{sources.filter(name => progress.sources[name].status !== 'waiting').length} / 2곳 완료</span></div>
      <progress max={2} value={sources.filter(name => progress.sources[name].status !== 'waiting').length} />
      <div className="discovery-sources">{sources.map(name => { const source = progress.sources[name]; return <span key={name} className="small">{name}: {source.status === 'done' ? `${source.count}개 후보` : source.status === 'failed' ? '조회 실패' : progress.phase === 'connecting' ? '대기 중' : '조회 중'}</span> })}</div>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="note" role="status">{message}</p>}
    {result && <section>
      <div className="row"><h2>후보 판 {versionMap.size}종 · 이미지 {result.candidates.length}개</h2>{result.errors.map(error => <span key={error} className="muted small">{error}</span>)}</div>
      {versionMap.size > 0 && <label className="edition-picker">후보 판 선택
        <select value={selectedVersion} onChange={e => { setSelectedVersion(e.target.value); setSelectedCandidate('') }}>
          {[...versionMap].map(([key, items]) => <option key={key} value={key}>{versionLabel(items[0])} · 이미지 {items.length}개</option>)}
        </select>
      </label>}
      {!result.candidates.length && <p className="panel muted">커버 후보가 없습니다. 검색 조건을 바꿔 다시 탐색해 보세요.</p>}
      <div className="discovery-grid">{candidates.map(candidate => <article className={'discovery-card' + (selectedCandidate === candidate.id ? ' selected' : '')} key={candidate.id}>
        <div className="discovery-image"><img src={candidate.imageUrl} alt={`${candidate.title} 커버 후보`} loading="lazy" onLoad={e => {
          const { naturalWidth, naturalHeight } = e.currentTarget
          setDimensions(p => ({ ...p, [candidate.id]: `${naturalWidth}×${naturalHeight}` }))
        }} onError={e => { e.currentTarget.style.display = 'none' }} /></div>
        <div className="discovery-info">
          <span className={'badge ' + (candidate.match === 'isbn' ? 's-created' : 's-dry')}>{candidate.match === 'isbn' ? 'ISBN 일치' : '다른 판 후보'}</span>
          <strong>{candidate.title}</strong><span className="muted small">{[candidate.publisher, candidate.year, candidate.edition].filter(Boolean).join(' · ')}</span>
          <span className="muted small">{candidate.isbn && `ISBN ${candidate.isbn} · `}{candidate.source}{dimensions[candidate.id] && ` · ${dimensions[candidate.id]}`}</span>
          <label className="small">띠지 확인
            <select value={ribbons[candidate.id] ?? 'unknown'} onChange={e => setRibbons(p => ({ ...p, [candidate.id]: e.target.value as Ribbon }))}>
              <option value="unknown">판단 필요</option><option value="clean">띠지 없음</option><option value="banded">띠지 있음</option>
            </select>
          </label>
          <div className="row"><button className={selectedCandidate === candidate.id ? 'primary' : ''} onClick={() => setSelectedCandidate(candidate.id)}>비교 선택</button>
            <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">출처</a>
            <a href={candidate.imageUrl} target="_blank" rel="noopener noreferrer">원본 보기</a>
            <button onClick={() => void copyImage(candidate)}>{copied === candidate.id ? '복사됨' : '주소 복사'}</button></div>
        </div>
      </article>)}</div>
      {chosen && <div className="panel cover-compare">
        {target && <div><h3>현재 대표 표지</h3>{coverImage(target.frontCover) ? <img src={coverImage(target.frontCover)} alt="현재 대표 표지" /> : <p className="muted">표지 없음</p>}</div>}
        <div><h3>선택한 후보</h3><img src={chosen.imageUrl} alt="선택한 커버 후보" />
          <p className="muted small">{versionLabel(chosen)} · {chosen.source} {dimensions[chosen.id]}</p>
          <p className="muted small">띠지: {ribbons[chosen.id] === 'clean' ? '없음' : ribbons[chosen.id] === 'banded' ? '있음' : '판단 필요'}</p>
          {dimensions[chosen.id] && (() => { const [width, height] = dimensions[chosen.id].split('×').map(Number); return width < 800 || height < 1200 ? <p className="error small">기본 업로드 기준(800×1200)보다 작아 적용이 거절될 수 있습니다.</p> : null })()}
          {ribbons[chosen.id] === 'banded' && candidates.some(candidate => ribbons[candidate.id] === 'clean') && <p className="note">같은 판에 띠지 없는 후보가 있습니다.</p>}
          {!ribbons[chosen.id] && <p className="muted small">띠지 여부를 확인하고 표시하면 적용할 수 있습니다.</p>}
          {target && <button className="primary" disabled={!canManage || applying || loading || !ribbons[chosen.id] || ribbons[chosen.id] === 'unknown'} onClick={apply}>{applying ? '적용 중…' : '이 커버를 변형으로 추가하고 대표로 지정'}</button>}
        </div>
      </div>}
    </section>}
  </>
}

function BookPanel({ book, active, applying, canManage, onPick, onRepresentative }: {
  book: Book; active: boolean; applying: boolean; canManage: boolean; onPick: (book: Book) => void; onRepresentative: (book: Book, cover: Cover) => void
}) {
  return <div className="work-book">
    {coverImage(book.frontCover) ? <img className="work-book-cover" src={coverImage(book.frontCover)} alt={`${book.title} 대표 표지`} /> : <div className="nocover">표지 없음</div>}
    <div><strong>{book.title}</strong><div className="muted small">{[book.edition, book.publisher?.name, book.year, book.isbn].filter(Boolean).join(' · ')}</div>
      <button className={active ? 'primary' : ''} disabled={applying} onClick={() => onPick(book)}>{active ? '탐색 중인 판' : '이 판의 커버 찾기'}</button>
    </div>
    {book.covers?.length > 1 && <div className="work-variants"><span className="muted small">등록된 표지 버전 {book.covers.length}개</span>
      <div className="row">{book.covers.filter(cover => coverImage(cover)).map(cover => <div className="work-variant" key={cover.id}>
        <img src={coverImage(cover)} alt={cover.label || '표지 버전'} />
        <span className="small">{cover.label || (cover.printingFrom ? `${cover.printingFrom}쇄부터` : '표지 버전')}</span>
        {book.frontCover?.id !== cover.id && <button disabled={!canManage || applying} onClick={() => onRepresentative(book, cover)}>대표로</button>}
      </div>)}</div>
    </div>}
  </div>
}
