import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, safeUrl, type SearchItem } from './api'
import { loadChangbiBooks, thumbUrl } from './changbi'
import type { Page } from './ui'

// 사이드바 전역 검색('/' 키). 등록된 책·펜딩·창비 자료실을 한 번에 찾고, 고르면 그 책이 선택된 화면으로 간다
type Hit = { key: string; title: string; sub: string; thumb?: string; to: string | (() => Promise<string>) }
type Group = { label: string; hits: Hit[]; note?: string }
type Draft = { id: string; title: string; isbn: string | null; author: { name: string } | null; publisher: { name: string } | null; frontCover: { thumbnailUrl: string | null } | null }
type Drafts = { list: Draft[]; note?: string }

const LIMIT = 8
const has = (q: string, ...values: (string | null | undefined)[]) => values.some(value => value?.toLowerCase().includes(q))

// 펜딩 목록은 관리자만 볼 수 있다. 못 보면 '없음'이 아니라 이유를 보여 준다
const loadDrafts = (): Promise<Drafts> => api<Page<Draft>>('/admin/books?status=DRAFT&size=200').then(page => ({ list: page.content }))
  .catch(error => ({ list: [], note: error instanceof ApiError && (error.status === 401 || error.status === 403) ? '관리자 인증이 필요합니다.' : '펜딩 목록을 불러올 수 없습니다.' }))

async function search(q: string, drafts: Promise<Drafts>): Promise<Group[]> {
  const registered = api<{ items: SearchItem[] }>(`/search?${new URLSearchParams({ query: q, size: String(LIMIT) })}`, { signal: AbortSignal.timeout(5000) })
    .then((data): Group => ({ label: '등록된 책', hits: data.items
      .filter(item => item.type === 'ORIGINAL' || item.type === 'TRANSLATED') // 리디자인 문서도 섞여 온다
      .map(item => ({
        key: item.id, title: item.title, thumb: safeUrl(item.thumbnailUrl),
        sub: [item.type === 'ORIGINAL' ? '원서' : '번역서', item.author, item.publisher, item.year].filter(Boolean).join(' · '),
        to: `/books/${item.id.replace(/^(original_|translated_)/, '')}`,
      })) }))
    .catch((): Group => ({ label: '등록된 책', hits: [], note: '검색 서버에 연결할 수 없습니다.' }))
  const pending = drafts.then((drafts): Group => ({ label: '펜딩', note: drafts.note, hits: drafts.list
    .filter(book => has(q, book.title, book.isbn, book.author?.name)).slice(0, LIMIT)
    .map(book => ({ key: book.id, title: book.title, thumb: safeUrl(book.frontCover?.thumbnailUrl),
      sub: [book.author?.name, book.publisher?.name].filter(Boolean).join(' · '), to: `/publish?id=${book.id}` })) }))
  const changbi = loadChangbiBooks().then((list): Group => ({ label: '창비 자료실', hits: list
    .filter(book => has(q, book.title, book.original_title, book.authors, book.translators, book.isbn, book.series)).slice(0, LIMIT)
    .map(book => ({ key: book.key, title: book.title, thumb: thumbUrl(book),
      sub: [book.imprint, book.authors, book.pub_month].filter(Boolean).join(' · '), to: `/publishers/changbi?key=${encodeURIComponent(book.key)}` })) }))
    .catch((error): Group => ({ label: '창비 자료실', hits: [], note: error instanceof Error ? error.message : String(error) }))
  return Promise.all([registered, pending, changbi])
}

export default function GlobalSearch() {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const drafts = useRef<Promise<Drafts> | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setOpen(true) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    input.current?.select()
    drafts.current = loadDrafts() // 열 때 한 번
  }, [open])
  useEffect(() => {
    const term = q.trim().toLowerCase()
    if (!open || !term) { setGroups(null); return }
    const id = ++requestId.current
    setBusy(true)
    const timer = setTimeout(() => search(term, drafts.current ?? loadDrafts()).then(result => {
      if (id !== requestId.current) return
      setGroups(result)
      setCursor(0)
      setBusy(false)
    }), 200)
    return () => clearTimeout(timer)
  }, [q, open])

  const hits = groups?.flatMap(group => group.hits) ?? []
  const go = async (hit: Hit) => {
    setBusy(true)
    try { nav(typeof hit.to === 'string' ? hit.to : await hit.to()) } catch { /* 원서를 못 찾으면 그대로 둔다 */ }
    setBusy(false)
    setOpen(false)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, Math.max(0, hits.length - 1))) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter' && hits[cursor]) { e.preventDefault(); void go(hits[cursor]) }
  }

  return <>
    <button className="side-search" onClick={() => setOpen(true)}>검색 <kbd>/</kbd></button>
    {open && <div className="palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div className="palette" role="dialog" aria-label="전역 검색">
        <input ref={input} placeholder="제목, 저자, ISBN — 등록된 책 · 펜딩 · 창비 자료실" value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
          role="combobox" aria-expanded={Boolean(groups)} aria-controls="palette-results" aria-activedescendant={hits[cursor] ? `hit-${cursor}` : undefined} />
        {groups && <div id="palette-results" role="listbox">
          {groups.map(group => <section key={group.label}>
            <h3>{group.label} {group.note && <span className="muted small">— {group.note}</span>}</h3>
            {group.hits.map(hit => {
              const index = hits.indexOf(hit)
              return <button key={hit.key} id={`hit-${index}`} role="option" aria-selected={index === cursor} className={index === cursor ? 'on' : ''}
                onMouseEnter={() => setCursor(index)} onClick={() => void go(hit)}>
                {hit.thumb ? <img src={hit.thumb} alt="" /> : <span className="nocover" />}
                <span><strong>{hit.title}</strong><span className="muted small">{hit.sub}</span></span>
              </button>
            })}
            {!group.hits.length && !group.note && <p className="muted small">없음</p>}
          </section>)}
          {!hits.length && !busy && <p className="muted">검색 결과가 없습니다.</p>}
        </div>}
        <p className="muted small palette-help">{busy ? '찾는 중…' : '↑↓ 이동 · Enter 열기 · Esc 닫기'}</p>
      </div>
    </div>}
  </>
}
