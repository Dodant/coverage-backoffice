import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, safeUrl } from '../api'
import { langName } from '../lang'

type Cover = { id: string; imageUrl: string | null; thumbnailUrl: string | null; width: number; height: number; similarGroupId: string | null }
type Book = { id: string; title: string; languageCode: string; isbn: string | null; frontCover: Cover | null }
type SearchItem = { id: string; type: string; title: string; author: string; year: number | null; thumbnailUrl: string | null }

export default function Covers() {
  const { originalId } = useParams()
  return (
    <>
      <h1>표지 묶기</h1>
      <p className="muted">언어가 달라도 디자인이 비슷한 표지를 묶습니다. 표지를 다른 표지 위로 끌어다 놓으면 묶이고, 빈 곳에 놓으면 빠집니다. 묶음에 마우스를 올리면 펼쳐집니다.</p>
      <BookSearch />
      {originalId && <Board originalId={originalId} />}
    </>
  )
}

function BookSearch() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [items, setItems] = useState<SearchItem[] | null>(null)
  const [error, setError] = useState('')
  const search = async () => {
    setError('')
    try {
      const r = await api<{ items: SearchItem[] }>(`/search?${new URLSearchParams({ query: q, size: '20' })}`)
      setItems(r.items.filter(i => i.type === 'ORIGINAL'))
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <div className="panel">
      <form className="row" onSubmit={e => { e.preventDefault(); if (q.trim()) search() }}>
        <input placeholder="원서 제목으로 찾기" value={q} onChange={e => setQ(e.target.value)} />
        <button>찾기</button>
      </form>
      {error && <p className="error">{error}</p>}
      {items && (
        <div className="row" style={{ marginTop: 8 }}>
          {items.map(i => (
            <button key={i.id} onClick={() => { setItems(null); nav(`/covers/${i.id.replace(/^original_/, '')}`) }}>
              {i.title} <span className="muted small">{i.author} {i.year ?? ''}</span>
            </button>
          ))}
          {!items.length && <span className="muted">원서가 없습니다</span>}
        </div>
      )}
    </div>
  )
}

function Board({ originalId }: { originalId: string }) {
  const [books, setBooks] = useState<Book[] | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')

  const load = useCallback(async () => {
    try {
      const [orig, trans] = await Promise.all([
        api<Book>(`/books/original/${originalId}`),
        api<Book[]>(`/books/translated/by-original/${originalId}`),
      ])
      setBooks([orig, ...trans])
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }, [originalId])
  useEffect(() => { setBooks(null); load() }, [load])

  const move = async (coverId: string, withCoverId: string | null) => {
    setSaving('저장 중…')
    try {
      await api(`/admin/covers/${coverId}/similar-group`, { method: 'PUT', body: { withCoverId } })
      await load()
      setSaving('저장됨')
    } catch (e) {
      setSaving('저장 실패: ' + e)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!books) return <p className="muted">불러오는 중…</p>
  const withCover = books.filter(b => b.frontCover && safeUrl(b.frontCover.thumbnailUrl || b.frontCover.imageUrl))
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
  const noCover = books.filter(b => !withCover.includes(b))

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{books[0].title} <span className="muted small">원서 + 번역서 {books.length - 1}종</span></h2>
        <span className="muted small">{saving}</span>
      </div>
      <DragBoard piles={piles} onMove={move} />
      {noCover.length > 0 && <p className="muted small">표지 없음: {noCover.map(b => `${b.title} (${langName(b.languageCode)})`).join(', ')}</p>}
    </>
  )
}

// 끌어서 묶기. pointer 이벤트라 마우스와 터치 모두 된다
function DragBoard({ piles, onMove }: { piles: Book[][]; onMove: (coverId: string, withCoverId: string | null) => void }) {
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
      const src = piles.find(p => p.some(b => b.frontCover!.id === drag.coverId))!
      if (over) {
        const target = piles.find(p => p[0].frontCover!.id === over)!
        if (target !== src) onMove(drag.coverId, target[0].frontCover!.id)
      } else if (onBoard && src.length > 1) {
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
      {piles.map(p => (
        <div key={p[0].frontCover!.id} data-pile={p[0].frontCover!.id}
             className={'pile' + (p.length > 1 ? ' group' : '') + (drag?.over === p[0].frontCover!.id ? ' over' : '')}>
          <div className="stack" style={{ '--n': p.length } as React.CSSProperties}>
            {p.map((b, j) => {
              const c = b.frontCover!
              const src = safeUrl(c.thumbnailUrl || c.imageUrl)
              return (
                <img key={c.id} className={'pc' + (drag?.coverId === c.id ? ' dragging' : '')} src={src} alt={b.title}
                     title={`${b.title} (${langName(b.languageCode)})`} draggable={false}
                     style={{ '--j': j, left: j * 26, top: j * 4 } as React.CSSProperties}
                     onPointerDown={e => { e.preventDefault(); setDrag({ coverId: c.id, src, x: e.clientX, y: e.clientY, over: null }) }} />
              )
            })}
          </div>
          <div className="cap">{p.map(b => langName(b.languageCode)).join(' · ')}</div>
        </div>
      ))}
      {drag && <img className="ghost" src={drag.src} alt="" style={{ left: drag.x, top: drag.y }} />}
    </div>
  )
}
