import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, safeUrl } from '../api'
import { langName } from '../lang'
import { loadEditions } from '../catalog'

type Cover = { id: string; imageUrl: string | null; thumbnailUrl: string | null; width: number; height: number; similarGroupId: string | null; label?: string | null }
type Book = { id: string; title: string; languageCode: string; isbn: string | null; frontCover: Cover | null; covers?: Cover[] }
type SearchItem = { id: string; type: string; title: string; author: string; year: number | null; thumbnailUrl: string | null }
type SimilarBook = { id: string; title: string; type: string }

export default function Covers() {
  const { originalId } = useParams()
  return (
    <>
      <h1>표지 묶기</h1>
      <p className="muted">언어·판이 달라도 디자인이 비슷한 표지를 묶습니다. 대표 표지와 표지 변형을 모두 표시합니다. 동일 이미지나 같은 판이라는 의미는 아닙니다.</p>
      <BookSearch />
      {originalId && <Board key={originalId} originalId={originalId} />}
    </>
  )
}

function BookSearch() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [items, setItems] = useState<SearchItem[] | null>(null)
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  const requestId = useRef(0)
  const search = async () => {
    const id = ++requestId.current
    setError('')
    setItems(null)
    setSearching(true)
    try {
      const query = q.trim()
      let originals: SearchItem[]
      try {
        const r = await api<{ items: SearchItem[] }>(`/search?${new URLSearchParams({ query, size: '50' })}`, { signal: AbortSignal.timeout(5000) })
        originals = r.items.filter(item => item.type === 'ORIGINAL')
      } catch {
        // 검색 인덱스가 실패해도 DB에 등록된 원서는 찾을 수 있다.
        const isbn = query.replace(/[-\s]/g, '')
        const path = /^\d{13}$|^\d{9}[\dXx]$/.test(isbn)
          ? `/books/original/check-duplicate?${new URLSearchParams({ isbn })}`
          : `/books/original/find-similar?${new URLSearchParams({ title: query, authorName: '' })}`
        const similar = await api<SimilarBook[]>(path, { signal: AbortSignal.timeout(5000) })
        originals = similar.filter(item => item.type === 'OriginalBook').map(item => ({
          id: item.id, title: item.title, type: 'ORIGINAL', author: '', year: null, thumbnailUrl: null,
        }))
      }
      if (id === requestId.current) setItems(originals)
    } catch {
      if (id === requestId.current) setError('등록 도서 검색 서버에 연결할 수 없습니다. 백엔드와 데이터베이스 실행 상태를 확인해 주세요.')
    } finally {
      if (id === requestId.current) setSearching(false)
    }
  }
  return (
    <div className="panel">
      <form className="row" onSubmit={e => { e.preventDefault(); if (q.trim()) search() }}>
        <input aria-label="원서 검색어" placeholder="원서 제목, 작가 또는 ISBN으로 찾기" value={q} onChange={e => setQ(e.target.value)} />
        <button disabled={searching || !q.trim()}>{searching ? '찾는 중…' : '찾기'}</button>
      </form>
      {error && <p className="error" role="alert">{error} <Link to="/cover-discovery">온라인 커버 후보 탐색</Link>은 계속 사용할 수 있습니다.</p>}
      {items && (
        <div className="row" style={{ marginTop: 8 }}>
          {items.map(i => (
            <button key={i.id} onClick={() => { setItems(null); nav(`/covers/${i.id.replace(/^original_/, '')}`) }}>
              {i.title} <span className="muted small">{i.author} {i.year ?? ''}</span>
            </button>
          ))}
          {!items.length && <span className="muted">등록된 원서가 없습니다. <Link to="/cover-discovery">온라인 커버 후보 탐색</Link>에서 먼저 표지를 확인할 수 있습니다.</span>}
        </div>
      )}
    </div>
  )
}

function Board({ originalId }: { originalId: string }) {
  const [books, setBooks] = useState<Book[] | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const busy = useRef(false)

  const load = useCallback(async () => {
    try {
      setBooks(await loadEditions<Book>(originalId))
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }, [originalId])
  useEffect(() => { setBooks(null); load() }, [load])

  const move = async (coverId: string, withCoverId: string | null) => {
    if (busy.current) return
    busy.current = true
    setSaving('저장 중…')
    try {
      await api(`/admin/covers/${coverId}/similar-group`, { method: 'PUT', body: { withCoverId } })
      await load()
      setSelected(null)
      setSaving('저장됨')
    } catch (e) {
      setSaving('저장 실패: ' + e)
    } finally {
      busy.current = false
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!books) return <p className="muted">불러오는 중…</p>
  const withCover = books.flatMap(b => [...new Map([...(b.frontCover ? [b.frontCover] : []), ...(b.covers ?? [])].map(c => [c.id, c])).values()]
    .filter(c => safeUrl(c.thumbnailUrl || c.imageUrl))
    .map(c => ({ ...b, title: c.label ? `${b.title} · ${c.label}` : b.title, frontCover: c })))
  // 같은 similarGroupId끼리 한 더미. 다른 작품의 표지와 묶였을 수도 있지만 여기서는 이 작품의 판만 보인다
  const piles: Book[][] = []
  const byGroup = new Map<string, Book[]>()
  for (const b of withCover) {
    const g = b.frontCover!.similarGroupId
    if (!g) { piles.push([b]); continue }
    if (!byGroup.has(g)) { byGroup.set(g, []); piles.push(byGroup.get(g)!) }
    byGroup.get(g)!.push(b)
  }
  piles.sort((a, b) => b.length - a.length)
  const noCover = books.filter(b => !withCover.some(item => item.id === b.id))
  const selectedBook = withCover.find(b => b.frontCover!.id === selected)

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{books[0].title} <span className="muted small">원서 + 번역서 {books.length - 1}종 · 표지 {withCover.length}개 · 묶음 {piles.length}개</span></h2>
        <span className={saving.startsWith('저장 실패') ? 'error small' : 'muted small'} role="status">{saving}</span>
      </div>
      {selectedBook && <div className="selection-bar row">
        <span><strong>{selectedBook.title}</strong> ({langName(selectedBook.languageCode)}) 선택됨</span>
        <span className="muted small">이동할 묶음의 버튼을 누르세요.</span>
        <button disabled={saving === '저장 중…' || !selectedBook.frontCover!.similarGroupId} onClick={() => move(selected!, null)}>묶음에서 분리</button>
        <button onClick={() => setSelected(null)}>선택 취소</button>
      </div>}
      <DragBoard piles={piles} selected={selected} saving={saving === '저장 중…'} onSelect={setSelected} onMove={move} />
      {noCover.length > 0 && <p className="muted small">표지 없음: {noCover.map(b => `${b.title} (${langName(b.languageCode)})`).join(', ')}</p>}
    </>
  )
}

// 드래그와 버튼을 모두 지원한다.
function DragBoard({ piles, selected, saving, onSelect, onMove }: {
  piles: Book[][]
  selected: string | null
  saving: boolean
  onSelect: (id: string | null) => void
  onMove: (coverId: string, withCoverId: string | null) => void
}) {
  const boardRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ coverId: string; src: string; x: number; y: number; over: string | null } | null>(null)

  const pileUnder = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest('[data-pile]') as HTMLElement | null)?.dataset.pile ?? null

  useEffect(() => {
    if (!drag) return
    const moveH = (e: PointerEvent) => setDrag(d => d && { ...d, x: e.clientX, y: e.clientY, over: pileUnder(e.clientX, e.clientY) })
    const up = (e: PointerEvent) => {
      const over = pileUnder(e.clientX, e.clientY)
      const onBoard = boardRef.current?.contains(document.elementFromPoint(e.clientX, e.clientY))
      const src = piles.find(p => p.some(b => b.frontCover!.id === drag.coverId))
      const target = piles.find(p => p[0].frontCover!.id === over)
      if (src && target && target !== src) {
        onMove(drag.coverId, target[0].frontCover!.id)
      } else if (src && !over && onBoard && src.some(b => b.frontCover!.id === drag.coverId && b.frontCover!.similarGroupId)) {
        onMove(drag.coverId, null)
      }
      setDrag(null)
    }
    const cancel = () => setDrag(null)
    window.addEventListener('pointermove', moveH)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', moveH)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [drag, piles, onMove])

  return (
    <div className="board" ref={boardRef}>
      {piles.map((p, index) => {
        const targetId = p[0].frontCover!.id
        const isCurrent = p.some(b => b.frontCover!.id === selected)
        return <div key={targetId} data-pile={targetId}
             className={'cover-group' + (drag?.over === targetId ? ' over' : '')}>
          <div className="cover-group-head row">
            <strong>묶음 {index + 1}</strong>
            <span className="muted small">{p.length}개</span>
            {selected && !isCurrent && <button disabled={saving} onClick={() => onMove(selected, targetId)}>이 묶음으로 이동</button>}
          </div>
          <div className="cover-group-items">
            {p.map(b => {
              const c = b.frontCover!
              const src = safeUrl(c.thumbnailUrl || c.imageUrl)
              return (
                <div key={c.id} className={'cover-item' + (selected === c.id ? ' selected' : '')}>
                  <img className={drag?.coverId === c.id ? 'dragging' : ''} src={src} alt={`${b.title} 표지`}
                       title="끌어서 다른 묶음으로 이동" draggable={false}
                       onPointerDown={e => { if (saving) return; e.preventDefault(); setDrag({ coverId: c.id, src, x: e.clientX, y: e.clientY, over: null }) }} />
                  <strong title={b.title}>{b.title}</strong>
                  <span className="muted small">{langName(b.languageCode)}</span>
                  <button className={selected === c.id ? 'primary' : ''} disabled={saving}
                          aria-pressed={selected === c.id} onClick={() => onSelect(selected === c.id ? null : c.id)}>
                    {selected === c.id ? '선택됨' : '선택'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      })}
      {!piles.length && <p className="muted">표시할 표지가 없습니다.</p>}
      {drag && <img className="ghost" src={drag.src} alt="" style={{ left: drag.x, top: drag.y }} />}
    </div>
  )
}
