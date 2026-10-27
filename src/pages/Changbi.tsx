import { useEffect, useMemo, useState } from 'react'
import { api, CHANGBI_DRAG, coverAgent, safeUrl, session } from '../api'
import { Pager, type Page } from '../ui'

// 창비 자료실 보도자료에서 수집한 책(../changbi-press, cover-agent가 제공)
type ChangbiBook = {
  key: string; url: string; title: string; list_title: string; imprint: string
  original_title?: string; authors?: string; translators?: string; pub_month?: string; pub_month_from_upload?: boolean
  format?: string; isbn?: string; pages?: number; price?: number
  kind: '단권' | '연작' | '총서' | '세트' | '잡지'; series?: string; volume?: string
  cover_status: 'clean' | '띠지' | '미확인' | '여러권' | '오류'; cover_file?: string; cover_source_name?: string
  images: string[]; isbn_shared?: boolean; error?: string
  applied?: { bookId: string; kind: string; coverId: string; at: string }
}
type Candidate = { name: string; file: string; thumb: string; bytes: number }
type SearchItem = { id: string; type: string; title: string; author: string; publisher: string | null; year: number | null; thumbnailUrl: string | null }

const TABS = [['all', '전체'], ['translated', '번역서'], ['review', '확인 필요']] as const
// 한 화면에 위아래로 나눠 보여 주는 묶음. 제목을 눌러 접는다
const SECTIONS = [
  ['single', '단권', (book: ChangbiBook) => book.kind === '단권'],
  ['series', '시리즈', (book: ChangbiBook) => book.kind !== '단권' && book.kind !== '잡지'],
  ['magazine', '잡지', (book: ChangbiBook) => book.kind === '잡지'],
] as const
const STATUS: Record<ChangbiBook['cover_status'], string> = { clean: '띠지 없음', 띠지: '띠지 있음', 미확인: '표지 미확인', 여러권: '여러 권', 오류: '받기 실패' }
const translated = (book: ChangbiBook) => Boolean(book.original_title || book.translators)
const usable = (book: ChangbiBook) => book.cover_status === 'clean' || book.cover_status === '띠지'
const needsReview = (book: ChangbiBook) => !usable(book) || !book.isbn || Boolean(book.isbn_shared)
const SIZE = 60
// 같은 시리즈의 연작·총서·세트·잡지를 한 카드로 묶는 키. 표기 흔들림(개정판/, 따옴표, 끝의 ':' 등)은 무시한다.
const seriesKey = (book: ChangbiBook) => book.kind === '단권' ? '' : (book.series ?? '')
  .replace(/^개정판\//, '').replace(/^창비\s+/, '').replace(/[‘’'"]/g, '').replace(/\s*시리즈$/, '').replace(/[\s:]+$/, '')
type Entry = { key: string; books: ChangbiBook[]; series?: string }
const group = (books: ChangbiBook[]) => {
  const list: Entry[] = [], groups = new Map<string, Entry>()
  for (const book of books) {
    const series = seriesKey(book)
    const found = series && groups.get(series)
    if (found) found.books.push(book)
    else {
      const entry: Entry = { key: series ? 'series:' + series : book.key, books: [book], series: series || undefined }
      list.push(entry)
      if (series) groups.set(series, entry)
    }
  }
  return list
}
const pageOf = <T,>(items: T[], page: number): Page<T> => ({
  content: items.slice(page * SIZE, (page + 1) * SIZE), number: page, totalElements: items.length,
  totalPages: Math.ceil(items.length / SIZE), first: page === 0, last: (page + 1) * SIZE >= items.length,
})
// 묶음 이름은 가장 짧은 표기('창비 ‘소설의 첫 만남’ 시리즈'보다 '소설의 첫 만남')
const seriesName = (books: ChangbiBook[]) => books.map(book => book.series ?? '').reduce((a, b) => b.length < a.length ? b : a)

export default function Changbi() {
  const [books, setBooks] = useState<ChangbiBook[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('all')
  const [status, setStatus] = useState('')
  const [applied, setApplied] = useState('')
  const [query, setQuery] = useState('')
  const [pages, setPages] = useState<Record<string, number>>({})
  const [selectedKey, setSelectedKey] = useState('')
  const [openSeries, setOpenSeries] = useState('')
  const [versions, setVersions] = useState<Record<string, number>>({})

  useEffect(() => {
    fetch('/cover-agent/changbi/books').then(async response => {
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message ?? '창비 자료를 불러올 수 없습니다. npm run cover-agent를 실행해 주세요.')
      setBooks(data)
    }).catch(e => setLoadError(e instanceof Error ? e.message : String(e)))
    const queued = (e: Event) => {
      const { key, applied } = (e as CustomEvent<{ key: string; applied: ChangbiBook['applied'] }>).detail
      setBooks(list => list && list.map(book => book.key === key ? { ...book, applied } : book))
    }
    window.addEventListener('publish:queued', queued)
    return () => window.removeEventListener('publish:queued', queued)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (books ?? []).filter(book =>
      (tab === 'all' || (tab === 'translated' ? translated(book) : needsReview(book)))
      && (!status || book.cover_status === status)
      && (!applied || (applied === 'yes') === Boolean(book.applied))
      && (!q || [book.title, book.original_title, book.authors, book.translators, book.isbn, book.series]
        .some(value => value?.toLowerCase().includes(q))))
  }, [books, tab, status, applied, query])

  const sections = useMemo(() => SECTIONS.map(([key, label, match]) => {
    const list = filtered.filter(match)
    // 단권은 번역서를 앞으로(sort는 안정 정렬이라 나머지 순서는 그대로)
    if (key === 'single') list.sort((a, b) => Number(translated(b)) - Number(translated(a)))
    return { key, label, count: list.length, entries: group(list) }
  }), [filtered])
  const opened = useMemo(() => openSeries ? filtered.filter(book => seriesKey(book) === openSeries) : [], [filtered, openSeries])
  const selected = books?.find(book => book.key === selectedKey)
  const update = (key: string, change: Partial<ChangbiBook>) => {
    setBooks(list => list && list.map(book => book.key === key ? { ...book, ...change } : book))
    setVersions(v => ({ ...v, [key]: (v[key] ?? 0) + 1 }))
  }
  const thumb = (book: ChangbiBook) => book.cover_file && usable(book)
    ? `/cover-agent/changbi/thumbs/${encodeURIComponent(book.cover_file.replace(/\.[^.]+$/, ''))}.jpg?v=${versions[book.key] ?? 0}` : ''
  const filter = (set: () => void) => { set(); setPages({}) }
  const openGroup = (series: string) => { setOpenSeries(series); setPages(p => ({ ...p, open: 0 })) }
  const grid = (entries: Entry[], pageKey: string) => {
    const pageData = pageOf(entries, pages[pageKey] ?? 0)
    return <>
      <div className="changbi-grid">{pageData.content.map(entry => {
        const book = entry.books[0]
        if (entry.series && entry.books.length > 1) {
          const cover = entry.books.map(thumb).find(Boolean)
          const review = entry.books.filter(needsReview).length
          const done = entry.books.filter(b => b.applied).length
          return <button key={entry.key} className="changbi-item changbi-series" onClick={() => openGroup(entry.series!)}>
            {cover ? <img src={cover} alt="" loading="lazy" /> : <span className="nocover">표지 없음</span>}
            <strong>{seriesName(entry.books)}</strong>
            <span className="muted small">{book.kind} · {entry.books.length}권</span>
            <span className="row">
              {review > 0 && <span className="badge s-failed">확인 필요 {review}</span>}
              {done > 0 && <span className="badge s-created">적용 {done}</span>}
            </span>
          </button>
        }
        return <button key={book.key} className={'changbi-item' + (book.key === selectedKey ? ' selected' : '')} onClick={() => setSelectedKey(book.key)}
          draggable={usable(book) && !book.applied} onDragStart={e => e.dataTransfer.setData(CHANGBI_DRAG, book.key)}
          title={usable(book) && !book.applied ? '사이드바의 퍼블리시로 끌어다 놓으면 펜딩으로 등록됩니다' : undefined}>
          {thumb(book) ? <img src={thumb(book)} alt="" loading="lazy" /> : <span className="nocover">{STATUS[book.cover_status]}</span>}
          <strong>{book.title}</strong>
          <span className="muted small">{[book.kind !== '단권' && `${book.series ?? ''} ${book.volume ?? ''}`.trim(), book.authors].filter(Boolean).join(' · ')}</span>
          <span className="row">
            {book.cover_status !== 'clean' && <span className={'badge ' + (usable(book) ? 's-dry' : 's-failed')}>{STATUS[book.cover_status]}</span>}
            {book.applied && <span className="badge s-created">적용됨</span>}
          </span>
        </button>
      })}</div>
      <Pager page={pageData} onPage={page => setPages(p => ({ ...p, [pageKey]: page }))} />
    </>
  }

  return <>
    <h1>창비 자료실</h1>
    <p className="muted">창비 자료실 보도자료에서 모은 표지와 서지정보입니다. 표지가 없거나 틀린 책은 zip 안 이미지에서 고르고, 등록된 책에 대표 표지로 적용합니다.</p>
    {loadError && <p className="error" role="alert">{loadError}</p>}
    {books && <>
      <div className="stats">
        <div className="stat"><b>{books.length}</b>전체</div>
        <div className="stat"><b>{books.filter(usable).length}</b>표지 확보</div>
        <div className="stat"><b>{books.filter(needsReview).length}</b>확인 필요</div>
        <div className="stat"><b>{books.filter(book => book.applied).length}</b>백엔드 적용</div>
      </div>
      <div className="tabs" style={{ marginTop: 16 }}>
        {TABS.map(([key, label]) => <button key={key} className={tab === key ? 'on' : ''} onClick={() => filter(() => { setTab(key); setOpenSeries('') })}>{label}</button>)}
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input aria-label="검색어" placeholder="제목, 원제, 저자, ISBN, 시리즈" value={query} onChange={e => filter(() => setQuery(e.target.value))} />
        <select aria-label="표지 상태" value={status} onChange={e => filter(() => setStatus(e.target.value))}>
          <option value="">표지 상태 전체</option>
          {Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="적용 여부" value={applied} onChange={e => filter(() => setApplied(e.target.value))}>
          <option value="">적용 여부 전체</option><option value="yes">백엔드 적용됨</option><option value="no">미적용</option>
        </select>
        <span className="muted small">{filtered.length}권</span>
      </div>
      {openSeries && <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={() => openGroup('')}>← 목록으로</button>
        <strong>{opened.length ? seriesName(opened) : openSeries}</strong>
        <span className="muted small">{opened.length}권</span>
      </div>}
      <div className={'changbi-layout' + (selected ? ' with-detail' : '')}>
        <div>
          {openSeries ? grid(opened.map(book => ({ key: book.key, books: [book] })), 'open')
            : sections.filter(section => section.count).map(section => <details key={section.key} className="changbi-section" open>
              <summary><h2>{section.label}</h2> <span className="muted small">{section.count}권{section.entries.length !== section.count && ` · ${section.entries.length}개 항목`}</span></summary>
              {grid(section.entries, section.key)}
            </details>)}
          {!openSeries && !filtered.length && <p className="muted">조건에 맞는 책이 없습니다.</p>}
        </div>
        {selected && <Detail key={selected.key} book={selected} thumb={thumb(selected)} onChange={change => update(selected.key, change)} />}
      </div>
    </>}
  </>
}

function Detail({ book, thumb, onChange }: { book: ChangbiBook; thumb: string; onChange: (change: Partial<ChangbiBook>) => void }) {
  const [candidates, setCandidates] = useState<{ id: string; items: Candidate[] } | null>(null)
  const [matches, setMatches] = useState<SearchItem[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const token = session()?.token
  const work = async (label: string, task: () => Promise<void>) => {
    setBusy(label)
    setError('')
    setMessage('')
    try { await task() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  const loadCandidates = () => work('zip 이미지를 받는 중…', async () => setCandidates(await coverAgent('/changbi/candidates', { key: book.key })))
  const pick = (file: string, ribbon: 'clean' | 'banded') => work('표지로 저장하는 중…', async () => {
    const row = await coverAgent<ChangbiBook>('/changbi/pick', { key: book.key, file, ribbon })
    onChange({ cover_status: row.cover_status, cover_file: row.cover_file, cover_source_name: row.cover_source_name })
    setMessage(`${ribbon === 'clean' ? '띠지 없는' : '띠지 있는'} 표지로 저장했습니다.`)
  })
  const findBooks = () => work('등록된 책을 찾는 중…', async () => {
    const search = async (query: string) => (await api<{ items: SearchItem[] }>(`/search?${new URLSearchParams({ query, size: '20' })}`))
      .items.filter(item => item.type === 'ORIGINAL' || item.type === 'TRANSLATED')
    let found = book.isbn ? await search(book.isbn) : []
    if (!found.length) found = await search(book.title.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim())
    setMatches(found)
  })
  const apply = (item: SearchItem) => work('표지를 올리는 중…', async () => {
    const kind = item.type === 'ORIGINAL' ? 'original' : 'translated'
    const bookId = item.id.replace(/^(original|translated)_/, '')
    const result = await coverAgent<{ coverId: string; warning?: string }>('/changbi/apply', { key: book.key, bookId, kind }, { token })
    onChange({ applied: { bookId, kind, coverId: result.coverId, at: new Date().toISOString() } })
    setMessage(result.warning ?? `${item.title}에 표지를 추가하고 대표 표지로 지정했습니다.`)
  })

  return <aside className="panel changbi-detail">
    <div className="changbi-detail-head">
      {thumb ? <a href={`/cover-agent/changbi/covers/${encodeURIComponent(book.cover_file!)}`} target="_blank" rel="noopener noreferrer"><img src={thumb} alt={`${book.title} 표지`} /></a>
        : <div className="nocover">{STATUS[book.cover_status]}</div>}
      <div>
        <strong>{book.title}</strong>
        <div className="row" style={{ marginTop: 6 }}>
          <span className={'badge ' + (book.cover_status === 'clean' ? 's-created' : usable(book) ? 's-dry' : 's-failed')}>{STATUS[book.cover_status]}</span>
          <span className="badge s-skipped">{book.kind}</span>
        </div>
        {book.cover_source_name && <p className="muted small">{book.cover_source_name}</p>}
      </div>
    </div>
    <dl>
      {book.original_title && <><dt>원제</dt><dd>{book.original_title}</dd></>}
      <dt>저자</dt><dd>{book.authors || '-'}</dd>
      {book.translators && <><dt>역자</dt><dd>{book.translators}</dd></>}
      {book.kind !== '단권' && <><dt>시리즈</dt><dd>{book.series} {book.volume}</dd></>}
      <dt>ISBN</dt><dd>{book.isbn || '-'}{book.isbn_shared && <span className="error small"> 다른 책과 같은 ISBN(세트 ISBN일 수 있음)</span>}</dd>
      <dt>출간</dt><dd>{book.pub_month || '-'}{book.pub_month_from_upload && <span className="muted small"> 업로드월로 추정</span>}</dd>
      <dt>판형</dt><dd>{[book.format, book.pages && `${book.pages}쪽`, book.price && `${book.price.toLocaleString()}원`].filter(Boolean).join(' · ') || '-'}</dd>
      <dt>출판사</dt><dd>{book.imprint || '창비'}</dd>
      <dt>자료</dt><dd><a href={safeUrl(book.url)} target="_blank" rel="noopener noreferrer">보도자료 zip</a>{book.error && <span className="error small"> {book.error}</span>}</dd>
      {book.applied && <><dt>적용</dt><dd>{book.applied.kind === 'original' ? '원서' : '번역서'} {book.applied.bookId.slice(0, 8)} · {new Date(book.applied.at).toLocaleString()}</dd></>}
    </dl>
    {busy && <p className="note" role="status">{busy}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="note" role="status">{message}</p>}

    <h2>zip 이미지에서 표지 고르기</h2>
    {!candidates ? <button disabled={Boolean(busy) || book.cover_status === '오류'} onClick={loadCandidates}>zip 이미지 보기 ({book.images.length}장)</button>
      : <div className="changbi-candidates">{candidates.items.map(item => <figure key={item.file}>
        <a href={`/cover-agent/changbi/candidates/${candidates.id}/${item.file}`} target="_blank" rel="noopener noreferrer"><img src={`/cover-agent/changbi/candidates/${candidates.id}/${item.thumb}`} alt={item.name} loading="lazy" /></a>
        <figcaption className="small">{item.name} <span className="muted">{(item.bytes / 1024 / 1024).toFixed(1)}MB</span></figcaption>
        <div className="row"><button disabled={Boolean(busy)} onClick={() => void pick(item.file, 'clean')}>띠지 없음</button><button disabled={Boolean(busy)} onClick={() => void pick(item.file, 'banded')}>띠지 있음</button></div>
      </figure>)}{!candidates.items.length && <p className="muted">zip에 이미지가 없습니다.</p>}</div>}

    <h2>등록된 책에 적용</h2>
    {!token && <p className="note">표지 적용은 백엔드 관리자 인증이 필요합니다.</p>}
    <button disabled={Boolean(busy)} onClick={findBooks}>{matches ? '다시 찾기' : 'ISBN·제목으로 등록된 책 찾기'}</button>
    {matches && <div className="changbi-matches">{matches.map(item => <div key={item.id} className="row">
      <span><strong>{item.title}</strong> <span className="muted small">{[item.type === 'ORIGINAL' ? '원서' : '번역서', item.author, item.publisher, item.year].filter(Boolean).join(' · ')}</span></span>
      <button className="primary" disabled={!token || Boolean(busy) || !usable(book)} onClick={() => void apply(item)}>이 책에 적용</button>
    </div>)}{!matches.length && <p className="muted">등록된 책을 찾지 못했습니다.</p>}</div>}
  </aside>
}
