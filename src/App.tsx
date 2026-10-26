import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Entities from './pages/Entities'
import Covers from './pages/Covers'
import CoverDiscovery from './pages/CoverDiscovery'
import Runs from './pages/Runs'
import Changbi from './pages/Changbi'

const MENU = [
  ['/dashboard', '대시보드'],
  ['/covers', '표지 묶기'],
  ['/cover-discovery', '커버 탐색'],
  ['/changbi', '창비 자료실'],
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
        {MENU.map(([to, label]) => (
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
