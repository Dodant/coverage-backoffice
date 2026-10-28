import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { imageOf, STATUS_LABELS, type CatalogItem, type Detail } from '../catalog'
import { langName } from '../lang'
import type { Page } from '../ui'
import { useWork } from '../useWork'

type Action = 'MOVE_TRANSLATION' | 'JOIN_WORK' | 'LEAVE_WORK'
type Preview = { source: CatalogItem; target: CatalogItem | null; originalId: string | null; workId: string | null; targetWorkId: string | null; affectedBooks: CatalogItem[]; summary: string }
export default function BookRelationships({ detail, onSaved }: { detail: Detail; onSaved: () => Promise<void> }) {
  const [action, setAction] = useState<Action>(detail.kind === 'TRANSLATED' ? 'MOVE_TRANSLATION' : 'JOIN_WORK')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogItem[] | null>(null)
  const [target, setTarget] = useState<CatalogItem | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [searchError, setSearchError] = useState('')
  const [searching, setSearching] = useState(false)
  const { busy, error, message, setMessage, work } = useWork()
  useEffect(() => {
    if (!query.trim() || action === 'LEAVE_WORK') return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true); setSearchError('')
      api<Page<CatalogItem>>(`/admin/catalog?${new URLSearchParams({ query: query.trim(), kind: 'ORIGINAL', size: '20' })}`, { signal: controller.signal })
        .then(data => setResults(data.content.filter(b => b.id !== detail.book.id && b.id !== detail.book.originalBookId && b.status !== 'DELETED')))
        .catch(e => { if (!controller.signal.aborted) setSearchError(String(e)) })
        .finally(() => { if (!controller.signal.aborted) setSearching(false) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, detail.book.id, detail.book.originalBookId, action])
  const request = { action, targetId: action === 'LEAVE_WORK' ? null : target?.id }
  return <section className="panel relationship-editor"><h2>도서 관계 수정</h2>
    <p className="muted small">연결만 변경하며 도서·표지·ISBN은 병합하지 않습니다. 적용 전에 대상과 영향을 받는 도서를 확인하세요.</p>
    {detail.kind === 'TRANSLATED' ? <p>현재 연결 원서: <Link to={`/books/${detail.book.originalBookId}`}>{detail.book.originalBookTitle || '원서 상세'}</Link></p>
      : <label>작업<select aria-label="관계 수정 작업" value={action} onChange={e => { setAction(e.target.value as Action); setTarget(null); setQuery(''); setResults(null); setPreview(null) }} disabled={Boolean(busy)}>
        <option value="JOIN_WORK">다른 원서와 같은 작품의 판으로 연결</option><option value="LEAVE_WORK" disabled={!detail.book.workId}>현재 작품 묶음에서 분리</option>
      </select></label>}
    {action !== 'LEAVE_WORK' && <>
      <label>대상 원서 검색<input value={query} placeholder="제목·저자·ISBN으로 원서 검색" disabled={Boolean(busy)} onChange={e => { setQuery(e.target.value); setTarget(null); setPreview(null); setResults(null); setSearching(false) }} /></label>
      {searching && <p role="status">대상 원서 검색 중…</p>}{searchError && <p role="alert" className="error">{searchError}</p>}
      <div className="book-search-results">{results?.map(book => <button type="button" className={`book-search-item${target?.id === book.id ? ' selected' : ''}`} key={book.id} disabled={Boolean(busy)} onClick={() => { setTarget(book); setPreview(null) }}>
        {imageOf(book.frontCover) ? <img src={imageOf(book.frontCover)} alt="" /> : <span className="nocover">표지 없음</span>}
        <span><strong>{book.title}</strong><small>{[book.author, book.publisher, langName(book.languageCode), book.edition, book.year].filter(Boolean).join(' · ')}</small><small>{book.isbn || 'ISBN 없음'} · {STATUS_LABELS[book.status]}</small></span>
      </button>)}</div>{results?.length === 0 && <p className="muted">선택할 수 있는 다른 원서가 없습니다.</p>}
    </>}
    <button type="button" disabled={Boolean(busy) || action !== 'LEAVE_WORK' && !target} onClick={() => void work('변경 영향 확인 중…', async () => {
      setPreview(null)
      setPreview(await api<Preview>(`/admin/catalog/${detail.book.id}/relationship-preview`, { method: 'POST', body: request }))
    })}>변경 내용 확인</button>
    {preview && <div className="relationship-preview"><h3>적용할 변경</h3><p>{preview.summary}</p>
      <p><strong>{preview.source.title}</strong> → <strong>{preview.target?.title || '작품 묶음에서 분리'}</strong></p>
      <p className="muted small">영향을 받는 도서 {preview.affectedBooks.length}권</p><ul>{preview.affectedBooks.map(b => <li key={b.id}>{b.title} · {langName(b.languageCode)} · {b.edition || '판 미입력'}</li>)}</ul>
      <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void work('도서 관계 변경 중…', async () => {
        await api(`/admin/catalog/${detail.book.id}/relationship`, { method: 'PUT', body: { ...request, expectedOriginalId: preview.originalId, expectedWorkId: preview.workId, expectedTargetWorkId: preview.targetWorkId } })
        setPreview(null); setTarget(null); setResults(null); setQuery(''); setAction(detail.kind === 'TRANSLATED' ? 'MOVE_TRANSLATION' : 'JOIN_WORK'); setMessage('도서 관계를 변경했습니다.'); await onSaved()
      })}>이 내용으로 관계 변경</button>
    </div>}
    {busy && <p role="status">{busy}</p>}{error && <p role="alert" className="error">{error}</p>}{message && <p role="status" className="note">{message}</p>}
  </section>
}
