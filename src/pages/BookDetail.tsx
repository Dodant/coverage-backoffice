import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, safeUrl, session } from '../api'
import { coversOf, imageOf, CREDIT_LABELS, RIBBON_LABELS, STATUS_LABELS, VARIANT_LABELS, type Book, type Cover, type Detail } from '../catalog'
import { langName } from '../lang'
import { useWork } from '../useWork'
import { Pager, type Page } from '../ui'
import { IssueBadges } from './Books'
import BookRelationships from './BookRelationships'

export default function BookDetail() {
  const { id } = useParams()
  return <DetailPage key={id} id={id!} />
}

function DetailPage({ id }: { id: string }) {
  const [params] = useSearchParams()
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('info')
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useState('')
  const [dirtyForms, setDirtyForms] = useState<Record<string, boolean>>({})
  const dirty = Object.values(dirtyForms).some(Boolean)
  const markDirty = useCallback((key: string, value: boolean) => setDirtyForms(old => ({ ...old, [key]: value })), [])
  const reload = useCallback(async () => {
    const result = await api<Detail>(`/admin/catalog/${id}`)
    setData(result)
    setRevision(v => v + 1)
    setNotice('변경사항을 저장했습니다.')
  }, [id])
  useEffect(() => {
    const controller = new AbortController()
    api<Detail>(`/admin/catalog/${id}`, { signal: controller.signal }).then(setData).catch(e => {
      if (!controller.signal.aborted) setError(String(e))
    })
    return () => controller.abort()
  }, [id])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  // 사이드바와 브라우저 내 링크 이동에서도 편집 중인 값을 보호한다.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest('a[href]:not([target="_blank"])') && !confirm('저장하지 않은 변경사항이 있습니다. 이동할까요?')) {
        e.preventDefault(); e.stopPropagation()
      }
    }
    document.addEventListener('click', warn, true)
    return () => document.removeEventListener('click', warn, true)
  }, [dirty])
  const back = params.get('back')
  const backPath = back && /^\/books(?:\?|\/attention(?:\?|$)|$)/.test(back) ? back : '/books'
  if (!data) return <><Link to={backPath}>← 도서 목록</Link><p role={error ? 'alert' : 'status'} className={error ? 'error' : 'muted'}>{error || '도서 상세를 불러오는 중…'}</p></>
  const { book, relatedBooks } = data
  const originalId = data.kind === 'ORIGINAL' ? book.id : book.originalBookId
  const versions = coversOf(book)
  const immutable = book.status === 'DELETED'
  const choices = [...new Map([...versions.map(cover => ({ cover, title: book.title })), ...relatedBooks.flatMap(b => b.frontCover ? [{ cover: b.frontCover, title: `${b.title} (${langName(b.languageCode)})` }] : [])].map(entry => [entry.cover.id, entry])).values()]
  const changeTab = (next: string) => {
    if (next === tab) return
    if (dirty && !confirm('저장하지 않은 변경사항이 있습니다. 탭을 바꿀까요?')) return
    setDirtyForms({}); setTab(next)
  }
  return <>
    <Link to={backPath}>← 도서 목록</Link>
    <header className="panel book-detail-heading">
      {imageOf(book.frontCover) ? <img src={imageOf(book.frontCover)} alt={`${book.title} 대표 표지`} /> : <div className="catalog-no-cover">표지 없음</div>}
      <div><div className="row"><span className="badge">{data.kind === 'ORIGINAL' ? '원서' : '번역서'}</span><span className="badge">{STATUS_LABELS[book.status]}</span></div>
        <h1>{book.title}</h1><p className="muted">{[book.author?.name, book.publisher?.name, langName(book.languageCode), book.year, book.edition].filter(Boolean).join(' · ')}</p>
        <IssueBadges issues={data.issues} />
        <div className="row book-detail-links">{originalId && !immutable && <><Link to={`/covers/${originalId}`}>디자인 묶음 관리</Link><Link to={`/cover-discovery?originalId=${originalId}&bookId=${book.id}`}>온라인 커버 찾기</Link><Link to={`/image-duplicates?bookId=${book.id}`}>동일·유사 이미지 확인</Link></>}{book.status === 'DRAFT' && data.kind === 'ORIGINAL' && <Link to={`/publish?id=${book.id}`}>공개 검토</Link>}</div>
      </div>
    </header>
    {immutable && <p className="note">삭제된 도서는 열람만 할 수 있습니다.</p>}
    {notice && !dirty && <p className="note" role="status">{notice}</p>}
    <div className="tabs" aria-label="도서 상세 메뉴">{[['info', '서지정보'], ['versions', `판·쇄·표지 버전 (${versions.length})`], ['related', `연결 도서 (${relatedBooks.filter(b => b.id !== id).length})`], ['history', '변경 이력']].map(([key, label]) => <button key={key} className={tab === key ? 'on' : ''} aria-pressed={tab === key} onClick={() => changeTab(key)}>{label}</button>)}</div>
    {tab === 'info' && <BookEditor key={`${id}-${revision}`} detail={data} disabled={immutable} onSaved={reload} markDirty={markDirty} />}
    {tab === 'versions' && <>
      <div className="panel cover-concepts"><div><strong>판</strong><p>ISBN·출판사·판이 다른 도서는 별도 도서로 관리합니다. 현재 판: {book.edition || '미입력'} · {book.isbn || 'ISBN 미입력'}</p></div><div><strong>표지 버전</strong><p>이 도서에 속한 리커버·쇄별 표지·띠지·이미지 교체를 기록합니다.</p></div><div><strong>디자인 묶음</strong><p>언어·판이 달라도 비슷한 디자인을 관리자가 묶습니다. 동일 이미지 주소 여부와 별개입니다.</p></div></div>
      <div className="variant-grid">{versions.map(cover => <CoverEditor key={`${cover.id}-${revision}`} book={book} cover={cover} choices={choices} disabled={immutable} onSaved={reload} markDirty={markDirty} />)}</div>
      {!versions.length && <p className="muted">등록된 표지가 없습니다.</p>}
      {!immutable && <AddCover bookId={book.id} onSaved={reload} />}
    </>}
    {tab === 'related' && <>{!immutable && <BookRelationships detail={data} onSaved={reload} />}<section className="panel"><h2>원서·번역서·같은 작품의 다른 판</h2><p className="muted small">같은 작품으로 연결된 원서와 현재 원서의 번역서를 표시합니다. 다른 판의 정보를 이 도서에 덮어쓰지 마세요.</p>
      <div className="book-search-results">{relatedBooks.filter(b => b.id !== id).map(b => <Link className="book-search-item" key={b.id} to={`/books/${b.id}?${new URLSearchParams({ back: backPath })}`}>
        {imageOf(b.frontCover) ? <img src={imageOf(b.frontCover)} alt="" /> : <span className="nocover">표지 없음</span>}
        <span><strong>{b.title}</strong><small>{[b.kind === 'ORIGINAL' ? '원서' : '번역서', langName(b.languageCode), b.publisher, b.edition, b.year].filter(Boolean).join(' · ')}</small><small>{b.isbn || 'ISBN 없음'} · {STATUS_LABELS[b.status]}</small></span>
      </Link>)}</div>{relatedBooks.filter(b => b.id !== id).length === 0 && <p className="muted">연결된 다른 도서가 없습니다.</p>}</section></>}
    {tab === 'history' && <History id={id} kind={data.kind} />}
  </>
}

const BASE_FIELDS = [['title', '제목'], ['isbn', 'ISBN'], ['edition', '판'], ['year', '출간 연도'], ['languageCode', '언어 코드'], ['countryCode', '국가 코드']] as const
function BookEditor({ detail, disabled, onSaved, markDirty }: { detail: Detail; disabled: boolean; onSaved: () => Promise<void>; markDirty: (key: string, value: boolean) => void }) {
  const { book, kind } = detail
  const fields = [...BASE_FIELDS, ...(kind === 'ORIGINAL' ? [['originalTitle', '원제'], ['genre', '장르']] as const : [])]
  const initial = Object.fromEntries(fields.map(([key]) => [key, String(book[key] ?? '')]))
  const [form, setForm] = useState(initial)
  const [author, setAuthor] = useState(book.author)
  const [publisher, setPublisher] = useState(book.publisher)
  const changed = fields.filter(([key]) => form[key] !== initial[key])
  const dirty = changed.length > 0 || author?.id !== book.author?.id || publisher?.id !== book.publisher?.id
  const { busy, error, message, work } = useWork()
  useEffect(() => { markDirty('book', dirty); return () => markDirty('book', false) }, [dirty, markDirty])
  return <form className="panel" onSubmit={e => { e.preventDefault(); void work('저장 중…', async () => {
    const blank = changed.filter(([key]) => !form[key].trim())
    if (blank.length) throw new Error(`${blank.map(([, label]) => label).join(', ')} 항목은 현재 API에서 비울 수 없습니다.`)
    if (changed.some(([key]) => key === 'year') && !/^\d{4}$/.test(form.year)) throw new Error('출간 연도는 네 자리 숫자로 입력하세요.')
    const body: Record<string, unknown> = Object.fromEntries(changed.map(([key]) => [key, key === 'year' ? Number(form[key]) : form[key].trim()]))
    if (author?.id !== book.author?.id) body.authorId = author?.id
    if (publisher?.id !== book.publisher?.id) body.publisherId = publisher?.id
    await api(`/books/${kind === 'ORIGINAL' ? 'original' : 'translated'}/${book.id}`, { method: 'PUT', body })
    markDirty('book', false)
    await onSaved()
  }) }}>
    <fieldset disabled={disabled || Boolean(busy)} className="catalog-fieldset"><legend>서지정보 수정</legend><div className="catalog-edit-grid">
      {fields.map(([key, label]) => <label key={key}>{label}<input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} maxLength={key.endsWith('Code') ? 2 : undefined} placeholder={key === 'edition' ? '초판, 개정판 등' : undefined} /></label>)}
      <EntityPicker kind="authors" label="저자" value={author} onChange={setAuthor} />
      <EntityPicker kind="publishers" label="출판사" value={publisher} onChange={setPublisher} />
    </div></fieldset>
    <p className="muted small">ISBN·출판사·판이 다른 책의 표지는 해당 도서에 등록하세요. 판 설명만 고쳐도 다른 도서로 분리되지는 않습니다.</p>
    <div className="row"><button className="primary" disabled={!dirty || disabled || Boolean(busy)}>{busy || '변경사항 저장'}</button>{dirty && <span className="small s-dry">저장하지 않은 변경사항</span>}</div>
    <Feedback error={error} message={message} />
    <dl><dt>등록</dt><dd>{new Date(book.createdAt).toLocaleString()}</dd><dt>수정</dt><dd>{new Date(book.updatedAt).toLocaleString()}</dd></dl>
  </form>
}

function EntityPicker({ kind, label, value, onChange }: { kind: string; label: string; value: { id: string; name: string } | null; onChange: (v: { id: string; name: string }) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!q.trim()) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api<Page<{ id: string; name: string }>>(`/${kind}?${new URLSearchParams({ name: q, size: '10' })}`, { signal: controller.signal })
        .then(page => { setResults(page.content); setError('') }).catch(e => { if (!controller.signal.aborted) setError(String(e)) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [q, kind])
  return <div className="entity-picker"><label>{label}<input value={q} onChange={e => { setQ(e.target.value); setResults([]) }} placeholder={value?.name || `${label} 이름으로 검색`} /></label><span className="small muted">선택: {value?.name || '미입력'}</span>
    {error && <p className="error" role="alert">{error}</p>}{q && <div className="entity-options">{results.map(r => <button type="button" key={r.id} onClick={() => { onChange(r); setQ(''); setResults([]) }}>{r.name}</button>)}</div>}</div>
}

type CoverForm = { label: string; printingFrom: string; usedFrom: string; variantType: Cover['variantType']; ribbonStatus: Cover['ribbonStatus']; sourceName: string; sourceUrl: string; credits: Cover['credits'] }
const formOf = (c?: Cover): CoverForm => ({ label: c?.label ?? '', printingFrom: String(c?.printingFrom ?? ''), usedFrom: c?.usedFrom ?? '', variantType: c?.variantType ?? 'UNKNOWN', ribbonStatus: c?.ribbonStatus ?? 'UNKNOWN', sourceName: c?.sourceName ?? '', sourceUrl: c?.sourceUrl ?? '', credits: c?.credits ?? [] })
const metadata = (f: CoverForm) => ({ ...f, label: f.label.trim(), sourceName: f.sourceName.trim(), sourceUrl: f.sourceUrl.trim(), printingFrom: f.printingFrom ? Number(f.printingFrom) : null, usedFrom: f.usedFrom || null, credits: f.credits.map(c => ({ designerId: c.designerId, role: c.role })) })
function MetadataFields({ form, setForm }: { form: CoverForm; setForm: (f: CoverForm) => void }) {
  return <div className="catalog-edit-grid">
    <label>표지 종류<select aria-label="표지 종류" value={form.variantType} onChange={e => setForm({ ...form, variantType: e.target.value as Cover['variantType'] })}>{Object.entries(VARIANT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label>띠지<select aria-label="띠지" value={form.ribbonStatus} onChange={e => setForm({ ...form, ribbonStatus: e.target.value as Cover['ribbonStatus'] })}>{Object.entries(RIBBON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label>표지 설명<input maxLength={100} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="예: 10쇄 리커버" /></label>
    <label>처음 사용한 쇄<input type="number" min={1} step={1} value={form.printingFrom} onChange={e => setForm({ ...form, printingFrom: e.target.value })} /></label>
    <label>사용 시작일<input type="date" value={form.usedFrom} onChange={e => setForm({ ...form, usedFrom: e.target.value })} /></label>
    <label>출처 이름<input maxLength={100} value={form.sourceName} onChange={e => setForm({ ...form, sourceName: e.target.value })} /></label>
    <label className="catalog-wide">출처 URL<input type="url" pattern="https?://.*" maxLength={1000} value={form.sourceUrl} onChange={e => setForm({ ...form, sourceUrl: e.target.value })} /></label>
    <div className="catalog-wide credit-editor"><strong className="small">표지 크레딧</strong>
      {form.credits.map((credit, index) => <div className="row" key={`${credit.designerId}-${index}`}>
        <span>{credit.name}</span><label>역할<select value={credit.role} onChange={e => setForm({ ...form, credits: form.credits.map((c, i) => i === index ? { ...c, role: e.target.value } : c) })}>{Object.entries(CREDIT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <button type="button" aria-label={`${credit.name} 크레딧 삭제`} onClick={() => setForm({ ...form, credits: form.credits.filter((_, i) => i !== index) })}>삭제</button>
      </div>)}
      <EntityPicker kind="designers" label="크레딧에 참여자 추가" value={null} onChange={designer => {
        if (form.credits.some(c => c.designerId === designer.id && c.role === 'DESIGN')) return
        setForm({ ...form, credits: [...form.credits, { designerId: designer.id, name: designer.name, role: 'DESIGN' }] })
      }} />
    </div>
  </div>
}

function CoverEditor({ book, cover, choices, disabled, onSaved, markDirty }: { book: Book; cover: Cover; choices: { cover: Cover; title: string }[]; disabled: boolean; onSaved: () => Promise<void>; markDirty: (key: string, value: boolean) => void }) {
  const initial = formOf(cover)
  const [form, setForm] = useState(initial)
  const [groupTarget, setGroupTarget] = useState('')
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const { busy, error, message, setMessage, work } = useWork()
  useEffect(() => { markDirty(cover.id, dirty); return () => markDirty(cover.id, false) }, [cover.id, dirty, markDirty])
  const identical = cover.imageUrl ? choices.filter(entry => entry.cover.id !== cover.id && entry.cover.imageUrl === cover.imageUrl) : []
  const representative = book.frontCover?.id === cover.id
  return <article className="panel variant-card">
    <div className="variant-preview">{safeUrl(cover.imageUrl) ? <a href={safeUrl(cover.imageUrl)} target="_blank" rel="noopener noreferrer"><img src={imageOf(cover)} alt={cover.label || '표지 버전'} /></a> : <div className="catalog-no-cover">{cover.hidden ? '숨겨진 표지' : '이미지 없음'}</div>}
      <div><strong>{cover.label || '표지 버전'}</strong><p className="small muted">{cover.width && cover.height ? `${cover.width} × ${cover.height}px` : '해상도 미확인'}</p><span className={`badge ${representative ? 's-created' : ''}`}>{representative ? '대표 표지' : '표지 변형'}</span>
        <p className="small">{VARIANT_LABELS[cover.variantType ?? 'UNKNOWN']} · {RIBBON_LABELS[cover.ribbonStatus ?? 'UNKNOWN']}</p>
        {cover.credits?.length > 0 && <p className="small muted">크레딧: {cover.credits.map(c => `${c.name} (${c.role})`).join(', ')}</p>}
        {!representative && <button disabled={disabled || cover.hidden || Boolean(busy) || dirty} onClick={() => void work('대표 표지 변경 중…', async () => { await api(`/books/${book.id}/covers/${cover.id}/representative`, { method: 'PUT' }); await onSaved() })}>대표 표지로 지정</button>}
      </div>
    </div>
    <dl className="small"><dt>같은 판</dt><dd>현재 도서에 속함 · {book.edition || '판 미입력'}</dd><dt>동일 이미지 주소</dt><dd>{identical.length ? identical.map(e => e.title).join(', ') : '현재 도서·연결 도서의 대표 표지에서 일치 없음'}</dd><dt>디자인 묶음</dt><dd>{cover.similarGroupId ? <code>{cover.similarGroupId}</code> : '지정되지 않음'}</dd></dl>
    <p className="muted small">동일 이미지 주소는 같은 저장 URL 기준입니다. 다른 주소의 파일 내용까지 비교하지 않습니다.</p>
    <form onSubmit={e => { e.preventDefault(); void work('표지 정보 저장 중…', async () => { await api(`/admin/catalog/${book.id}/covers/${cover.id}`, { method: 'PUT', body: metadata(form) }); markDirty(cover.id, false); await onSaved() }) }}>
      <fieldset className="catalog-fieldset" disabled={disabled || Boolean(busy)}><legend>쇄·표지 메타데이터</legend><MetadataFields form={form} setForm={setForm} /></fieldset>
      <button className="primary" disabled={disabled || Boolean(busy) || !dirty}>표지 정보 저장</button>
    </form>
    <form className="group-editor" onSubmit={e => { e.preventDefault(); void work('디자인 묶음 변경 중…', async () => {
      await api(`/admin/covers/${cover.id}/similar-group`, { method: 'PUT', body: { withCoverId: groupTarget === 'separate' ? null : groupTarget } })
      setMessage('디자인 묶음을 변경했습니다.'); await onSaved()
    }) }}><label>디자인 묶음 변경<select aria-label="디자인 묶음 변경" value={groupTarget} onChange={e => setGroupTarget(e.target.value)} disabled={disabled || Boolean(busy) || dirty}>
      <option value="">함께 묶을 표지 선택</option>{cover.similarGroupId && <option value="separate">현재 묶음에서 분리</option>}
      {choices.filter(entry => entry.cover.id !== cover.id && !entry.cover.hidden).map(entry => <option key={entry.cover.id} value={entry.cover.id}>{entry.title} · {entry.cover.label || '대표/변형 표지'}</option>)}
    </select></label><button disabled={disabled || Boolean(busy) || !groupTarget || dirty}>묶음 적용</button></form>
    {busy && <p role="status">{busy}</p>}<Feedback error={error} message={message} />
  </article>
}

type Upload = { originalUrl: string; thumbnailUrl: string; originalFileName: string; width: number; height: number; fileSize: number }
function AddCover({ bookId, onSaved }: { bookId: string; onSaved: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState(formOf())
  const [uploaded, setUploaded] = useState<Upload | null>(null)
  const [attached, setAttached] = useState<string | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const { busy, error, message, work, setMessage } = useWork()
  return <details className="panel"><summary>이 판에 표지 버전 추가</summary>
    <p className="muted small">JPEG·PNG·WebP, 최대 10MB. 기본 최소 해상도 800×1200px. 다른 ISBN의 표지는 해당 도서에 추가하세요.</p>
    <form onSubmit={e => { e.preventDefault(); void work('표지 버전 추가 중…', async () => {
      if (!file) throw new Error('표지 파일을 선택하세요.')
      if (file.size > 10 * 1024 * 1024) throw new Error('최대 10MB까지 업로드할 수 있습니다.')
      let upload = uploaded
      if (!upload) {
        const body = new FormData(); body.append('file', file)
        const response = await fetch('/api/covers', { method: 'POST', headers: { Authorization: `Bearer ${session()?.token ?? ''}` }, body })
        const result = await response.json()
        if (!response.ok) throw new Error(result.message || '이미지 업로드에 실패했습니다.')
        upload = result as Upload; setUploaded(upload)
      }
      let coverId = attached
      if (!coverId) {
        const cover = await api<Cover>(`/books/${bookId}/covers`, { method: 'POST', body: { ...upload, imageUrl: upload.originalUrl, imageSource: 'OTHER', ...metadata(form) } })
        coverId = cover.id; setAttached(coverId)
      }
      await api(`/admin/catalog/${bookId}/covers/${coverId}`, { method: 'PUT', body: metadata(form) })
      setFile(null); setUploaded(null); setAttached(null); setForm(formOf()); setFileKey(k => k + 1)
      setMessage('표지 버전을 추가했습니다. 대표 표지는 버전 목록에서 지정할 수 있습니다.')
      await onSaved()
    }) }}>
      <fieldset className="catalog-fieldset" disabled={Boolean(busy)}><legend>새 표지</legend>
        <label>표지 파일<input key={fileKey} type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(attached)} onChange={e => { setFile(e.target.files?.[0] ?? null); setUploaded(null) }} /></label>
        <MetadataFields form={form} setForm={setForm} />
      </fieldset>
      <button className="primary" disabled={!file || Boolean(busy)}>{busy || (attached ? '추가한 표지 정보 저장 재시도' : '표지 버전 추가')}</button>
      {attached && error && <p className="note">파일과 표지 버전은 등록되었습니다. 다시 시도하면 메타데이터만 저장합니다.</p>}
      <Feedback error={error} message={message} />
    </form>
  </details>
}

type AuditLog = { id: string; action: string; performedByName: string; createdAt: string; previousValue: string | null; newValue: string | null }
function History({ id, kind }: { id: string; kind: Detail['kind'] }) {
  const [page, setPage] = useState(0)
  const [data, setData] = useState<Page<AuditLog> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError('')
    api<Page<AuditLog>>(`/admin/dashboard/logs/entity/${kind === 'ORIGINAL' ? 'ORIGINAL_BOOK' : 'TRANSLATED_BOOK'}/${id}?page=${page}&size=20&sort=createdAt,desc`, { signal: controller.signal })
      .then(setData).catch(e => { if (!controller.signal.aborted) setError(String(e)) })
    return () => controller.abort()
  }, [id, kind, page])
  return <section className="panel"><h2>변경 이력</h2>{error && <p className="error" role="alert">{error}</p>}{!data && !error && <p role="status">변경 이력 불러오는 중…</p>}
    {data?.content.map(log => <details className="audit-entry" key={log.id}><summary>{new Date(log.createdAt).toLocaleString()} · {log.performedByName} · {log.action}</summary><div className="two-col"><div><strong>변경 전</strong><pre>{pretty(log.previousValue)}</pre></div><div><strong>변경 후</strong><pre>{pretty(log.newValue)}</pre></div></div></details>)}
    {data && !data.content.length && <p className="muted">변경 기록이 없습니다.</p>}{data && <Pager page={data} onPage={setPage} />}
  </section>
}
function pretty(value: string | null) { try { return JSON.stringify(JSON.parse(value ?? 'null'), null, 2) } catch { return value } }
function Feedback({ error, message }: { error: string; message: string }) { return <>{error && <p className="error" role="alert">{error}</p>}{message && <p className="note" role="status">{message}</p>}</> }
