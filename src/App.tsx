import { useState, type DragEvent } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { CHANGBI_DRAG, coverAgent, session } from './api'
import Dashboard from './pages/Dashboard'
import Entities from './pages/Entities'
import Covers from './pages/Covers'
import CoverDiscovery from './pages/CoverDiscovery'
import Runs from './pages/Runs'
import Changbi from './pages/Changbi'
import Publish from './pages/Publish'

const MENU = [
  ['/dashboard', '대시보드'],
  ['/covers', '표지 묶기'],
  ['/cover-discovery', '커버 탐색'],
  ['/changbi', '창비 자료실'],
  ['/publish', '퍼블리시'],
  ['/runs', '등록 기록'],
  ['/entities', '엔티티 정리'],
] as const

export default function App() {
  return <Shell />
}

function Shell() {
  return (
    <div className="layout">
      <nav className="side">
        <div className="brand">COVERAGE 백오피스</div>
        {MENU.map(([to, label]) => to === '/publish' ? <PublishLink key={to} label={label} /> : (
          <NavLink key={to} to={to}>{label}</NavLink>
        ))}
      </nav>
      <main className="page">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/covers" element={<Covers />} />
          <Route path="/covers/:originalId" element={<Covers />} />
          <Route path="/cover-discovery" element={<CoverDiscovery />} />
          <Route path="/changbi" element={<Changbi />} />
          <Route path="/publish" element={<Publish />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:file" element={<Runs />} />
          <Route path="/entities" element={<Entities />} />
          <Route path="/login" element={<Navigate to="/cover-discovery" replace />} />
          <Route path="*" element={<Navigate to="/cover-discovery" replace />} />
        </Routes>
      </main>
    </div>
  )
}

// 창비 자료실 카드를 끌어다 놓으면 DRAFT 원서로 등록한다. 결과는 'publish:queued' 이벤트로 각 화면에 알린다

function PublishLink({ label }: { label: string }) {
  const [over, setOver] = useState(false)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(CHANGBI_DRAG)
  const drop = async (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const key = e.dataTransfer.getData(CHANGBI_DRAG)
    setStatus({ text: '펜딩으로 등록하는 중…' })
    try {
      const result = await coverAgent<{ title: string; applied: unknown }>('/changbi/register', { key }, { token: session()?.token })
      window.dispatchEvent(new CustomEvent('publish:queued', { detail: { key, applied: result.applied } }))
      setStatus({ text: `'${result.title}' 펜딩 등록` })
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), error: true })
    }
  }
  return <>
    <NavLink to="/publish" className={over ? 'drop-over' : ''}
      onDragOver={e => { if (accepts(e)) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)} onDrop={e => void drop(e)}>{label}</NavLink>
    {status && <span className={'small ' + (status.error ? 'error' : 'muted')} role="status">{status.text}</span>}
  </>
}
