import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, safeUrl } from '../api'
import { langName } from '../lang'

type CoverRef = { coverId: string; bookId: string; title: string; languageCode: string; edition: string | null; imageUrl: string; thumbnailUrl: string | null }
type Match = { left: CoverRef; right: CoverRef; kind: 'EXACT_FILE' | 'SAME_URL' | 'SIMILAR'; distance: number }
type Results = { matches: Match[]; totalMatches: number; totalCovers: number; indexedCovers: number; page: number; totalPages: number }
type ScanResult = { examined: number; indexed: number; nextCursor: string | null; hasMore: boolean; failures: { coverId: string; bookId: string; message: string }[] }
const LABELS = { EXACT_FILE: '동일 파일 · SHA-256 일치', SAME_URL: '같은 이미지 주소', SIMILAR: '유사 이미지 · 확인 필요' }

export default function ImageDuplicates() {
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<Results | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState({ examined: 0, indexed: 0 })
  const [failures, setFailures] = useState<ScanResult['failures']>([])
  const [scanMessage, setScanMessage] = useState('')
  const scanControl = useRef<AbortController | null>(null)
  const query = params.toString()
  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError('')
    api<Results>(`/admin/image-inspection/matches?${query}`, { signal: controller.signal }).then(setData)
      .catch(e => { if (!controller.signal.aborted) setError(String(e)) })
    return () => controller.abort()
  }, [query, refresh])
  useEffect(() => () => scanControl.current?.abort(), [])
  const scan = async () => {
    if (scanning) return
    const controller = new AbortController(); scanControl.current = controller
    setScanning(true); setProgress({ examined: 0, indexed: 0 }); setFailures([]); setScanMessage(''); setError('')
    let after: string | null = null
    try {
      do {
        const result: ScanResult = await api('/admin/image-inspection/scan', { method: 'POST', body: { after, limit: 10 }, signal: controller.signal })
        if (controller.signal.aborted) return
        setProgress(p => ({ examined: p.examined + result.examined, indexed: p.indexed + result.indexed }))
        setFailures(old => [...old, ...result.failures]); after = result.nextCursor
        if (!result.hasMore) break
      } while (!controller.signal.aborted)
      setScanMessage('기존 표지의 이미지 분석을 완료했습니다.'); setRefresh(v => v + 1)
    } catch (e) { if (!controller.signal.aborted) setError(String(e)) }
    finally { if (!controller.signal.aborted) setScanning(false) }
  }
  const set = (key: string, value: string) => { const next = new URLSearchParams(params); next.delete('page'); if (value) next.set(key, value); else next.delete(key); setParams(next) }
  return <>
    <div className="row catalog-heading"><h1>동일·유사 이미지 탐지</h1><button disabled={scanning} onClick={() => setRefresh(v => v + 1)}>새로고침</button></div>
    <p className="muted">동일 파일은 저장 파일의 SHA-256으로, 크기·압축이 다른 이미지는 지각 해시로 후보를 찾습니다. 유사 후보는 직접 비교해 확인하세요.</p>
    <section className="panel"><div className="row"><button className="primary" disabled={scanning} onClick={() => void scan()}>{scanning ? '기존 표지 분석 중…' : '기존 표지 이미지 분석'}</button>
      {scanning && <button onClick={() => { scanControl.current?.abort(); setScanning(false); setScanMessage('분석을 중단했습니다. 완료된 해시는 유지됩니다.'); setRefresh(v => v + 1) }}>분석 중단</button>}
      <span role="status" className="muted small">{progress.examined > 0 ? `${progress.examined}개 확인 · ${progress.indexed}개 새로 분석` : '새 업로드는 자동으로 분석됩니다.'}</span></div>
      {data && <p className="small muted">분석 완료 {data.indexedCovers} / 비교 대상 표지 {data.totalCovers}개 · 숨김·삭제·차단 표지는 제외합니다.</p>}
      {scanMessage && <p className="note" role="status">{scanMessage}</p>}
      {failures.length > 0 && <details><summary>분석 실패 {failures.length}개</summary>{failures.map(f => <p key={f.coverId} className="small error"><Link to={`/books/${f.bookId}`}>도서 확인</Link> · {f.message} <span className="muted">({f.coverId})</span></p>)}</details>}
    </section>
    <div className="panel row"><label>결과 종류 <select aria-label="이미지 비교 결과 종류" value={params.get('kind') ?? ''} onChange={e => set('kind', e.target.value)}><option value="">전체</option>{Object.entries(LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {params.get('bookId') && <><span className="small">선택 도서와 관련된 결과</span><button onClick={() => set('bookId', '')}>전체 도서로 보기</button></>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}{!data && !error && <p role="status">비교 결과를 불러오는 중…</p>}
    {data && <><p className="muted small" role="status">총 {data.totalMatches}쌍</p>
      {data.matches.map(match => <article className="panel image-match" key={`${match.left.coverId}-${match.right.coverId}`}>
        <div className="row"><strong className={match.kind === 'SIMILAR' ? 's-dry' : 's-created'}>{LABELS[match.kind]}</strong>{match.kind === 'SIMILAR' && <span className="muted small">해시 거리 {match.distance}/64 · 동일 이미지로 확정되지 않은 후보</span>}</div>
        <div className="image-match-pair">{[match.left, match.right].map(c => <figure key={c.coverId}>
          {safeUrl(c.imageUrl) && <a href={safeUrl(c.imageUrl)} target="_blank" rel="noopener noreferrer"><img src={safeUrl(c.thumbnailUrl || c.imageUrl)} alt={`${c.title} 비교 표지`} loading="lazy" /></a>}
          <figcaption><Link to={`/books/${c.bookId}`}>{c.title}</Link><p className="muted small">{langName(c.languageCode)} · {c.edition || '판 미입력'} · {match.left.bookId === match.right.bookId ? '같은 도서의 표지 변형' : '서로 다른 도서'}</p></figcaption>
        </figure>)}</div>
      </article>)}{!data.matches.length && <p className="panel muted">조건에 맞는 결과가 없습니다. 기존 표지가 미분석 상태라면 이미지 분석을 실행하세요.</p>}
      {data.totalPages > 1 && <div className="row"><button disabled={data.page === 0} onClick={() => { const n = new URLSearchParams(params); n.set('page', String(data.page - 1)); setParams(n) }}>이전</button><span>{data.page + 1} / {data.totalPages}</span><button disabled={data.page + 1 >= data.totalPages} onClick={() => { const n = new URLSearchParams(params); n.set('page', String(data.page + 1)); setParams(n) }}>다음</button></div>}
    </>}
  </>
}
