import { useRef, useState, type FormEvent } from 'react'
import { session } from '../api'

type Candidate = {
  id: string; source: string; title: string; authors: string[]; isbn: string
  imageUrl: string; sourceUrl: string; match: 'isbn' | 'title'
}
type Discovery = { candidates: Candidate[]; errors: string[] }
type SourceName = 'Open Library' | 'Google Books'
type SourceProgress = { status: 'waiting' | 'done' | 'failed'; count: number }
type Progress = { phase: 'connecting' | 'searching' | 'done' | 'failed'; sources: Record<SourceName, SourceProgress> }
type StreamEvent =
  | { type: 'progress'; source: SourceName; status: 'done' | 'failed'; count: number }
  | ({ type: 'result' } & Discovery)
  | { type: 'error'; message: string }

const sourceNames: SourceName[] = ['Open Library', 'Google Books']
const initialProgress = (): Progress => ({
  phase: 'connecting',
  sources: { 'Open Library': { status: 'waiting', count: 0 }, 'Google Books': { status: 'waiting', count: 0 } },
})

export default function CoverDiscovery() {
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [isbn, setIsbn] = useState('')
  const [result, setResult] = useState<Discovery | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [copied, setCopied] = useState('')
  const requestId = useRef(0)

  const search = async (event: FormEvent) => {
    event.preventDefault()
    const id = ++requestId.current
    setResult(null)
    setError('')
    setCopied('')
    setLoading(true)
    setProgress(initialProgress())
    try {
      const response = await fetch('/cover-agent/discover?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session()?.token ?? ''}` },
        body: JSON.stringify({ title, author, isbn }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.message ?? '커버 탐색 서비스에 연결할 수 없습니다. npm run cover-agent를 실행해 주세요.')
      }
      if (!response.body) throw new Error('진행 상태를 받을 수 없습니다.')
      setProgress(p => p && { ...p, phase: 'searching' })
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      const handleLine = (line: string) => {
        if (!line.trim()) return
        const event = JSON.parse(line) as StreamEvent
        if (event.type === 'progress') {
          setProgress(p => p && { ...p, sources: { ...p.sources, [event.source]: { status: event.status, count: event.count } } })
        } else if (event.type === 'result') {
          finished = true
          setResult({ candidates: event.candidates, errors: event.errors })
          setProgress(p => p && { ...p, phase: 'done' })
        } else if (event.type === 'error') {
          throw new Error(event.message)
        }
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
      if (!finished) throw new Error('탐색이 완료되기 전에 연결이 끊겼습니다.')
    } catch (e) {
      if (id === requestId.current) {
        setError(e instanceof Error ? e.message : String(e))
        setProgress(p => p && { ...p, phase: 'failed' })
      }
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  const copy = async (candidate: Candidate) => {
    try {
      await navigator.clipboard.writeText(candidate.imageUrl)
      setCopied(candidate.id)
    } catch {
      setError('주소를 복사하지 못했습니다. 이미지 링크를 열어 주소를 복사해 주세요.')
    }
  }

  return (
    <>
      <h1>커버 탐색</h1>
      <p className="muted">도서 정보를 입력하면 공개 서지 자료에서 커버 후보를 찾습니다. ISBN을 입력하면 해당 판의 후보를 우선 표시합니다.</p>
      <form className="panel discovery-form" onSubmit={search}>
        <label>도서 제목<input value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 채식주의자" /></label>
        <label>저자 <span className="muted small">선택</span><input value={author} onChange={e => setAuthor(e.target.value)} placeholder="예: 한강" /></label>
        <label>ISBN <span className="muted small">선택</span><input value={isbn} onChange={e => setIsbn(e.target.value)} placeholder="예: 9788936433598" /></label>
        <button className="primary" disabled={loading || (!title.trim() && !isbn.trim())}>{loading ? '커버 찾는 중…' : '커버 찾기'}</button>
      </form>
      {progress && <section className="panel discovery-progress" aria-label="커버 탐색 진행도" aria-live="polite">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>{progress.phase === 'connecting' ? '관리자 확인 중…' : progress.phase === 'searching' ? '커버 출처 조회 중…' : progress.phase === 'done' ? '탐색 완료' : '탐색 중단'}</strong>
          <span className="muted small">{sourceNames.filter(name => progress.sources[name].status !== 'waiting').length} / {sourceNames.length}곳 완료</span>
        </div>
        <progress max={sourceNames.length} value={sourceNames.filter(name => progress.sources[name].status !== 'waiting').length} />
        <div className="discovery-sources">
          {sourceNames.map(name => {
            const source = progress.sources[name]
            return <span key={name} className="small">{name}: {source.status === 'done' ? `완료 · ${source.count}개 후보` : source.status === 'failed' ? '조회 실패' : progress.phase === 'connecting' ? '대기 중' : '조회 중'}</span>
          })}
        </div>
      </section>}
      {error && <p className="error" role="alert">{error}</p>}
      {result && <>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>커버 후보 {result.candidates.length}개</h2>
          {result.errors.map(e => <span key={e} className="muted small">{e}</span>)}
        </div>
        {!result.candidates.length && <p className="panel muted">커버 후보를 찾지 못했습니다. 제목이나 ISBN을 바꿔 다시 검색해 보세요.</p>}
        <div className="discovery-grid">
          {result.candidates.map(candidate => <article className="discovery-card" key={candidate.id}>
            <div className="discovery-image"><img src={candidate.imageUrl} alt={`${candidate.title} 커버 후보`} loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} /></div>
            <div className="discovery-info">
              <div className="row"><span className={'badge ' + (candidate.match === 'isbn' ? 's-created' : 's-dry')}>
                {candidate.match === 'isbn' ? 'ISBN 일치' : '제목 후보 · 판 확인 필요'}
              </span></div>
              <strong>{candidate.title}</strong>
              <span className="muted small">{candidate.authors.join(', ')}</span>
              {candidate.isbn && <span className="muted small">ISBN {candidate.isbn}</span>}
              <span className="muted small">{candidate.source}</span>
              <div className="row">
                <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">출처</a>
                <a href={candidate.imageUrl} target="_blank" rel="noopener noreferrer">이미지</a>
                <button type="button" onClick={() => copy(candidate)}>{copied === candidate.id ? '복사됨' : '주소 복사'}</button>
              </div>
            </div>
          </article>)}
        </div>
      </>}
    </>
  )
}
