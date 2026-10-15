import { useState, type FormEvent } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { login, logout, session } from './api'
import Dashboard from './pages/Dashboard'
import Entities from './pages/Entities'
import Covers from './pages/Covers'
import Runs from './pages/Runs'

const MENU = [
  ['/dashboard', '대시보드'],
  ['/covers', '표지 묶기'],
  ['/runs', '등록 기록'],
  ['/entities', '엔티티 정리'],
] as const

export default function App() {
  const s = session()
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={s ? <Shell /> : <Navigate to="/login" replace />} />
    </Routes>
  )
}

function Shell() {
  const s = session()!
  return (
    <div className="layout">
      <nav className="side">
        <div className="brand">COVERAGE 백오피스</div>
        {MENU.map(([to, label]) => (
          <NavLink key={to} to={to}>{label}</NavLink>
        ))}
        <div className="me">
          {s.user.displayName} ({s.user.email})<br />
          <button onClick={logout}>로그아웃</button>
        </div>
      </nav>
      <main className="page">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/covers" element={<Covers />} />
          <Route path="/covers/:originalId" element={<Covers />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:file" element={<Runs />} />
          <Route path="/entities" element={<Entities />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function Login() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      nav('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="panel" onSubmit={submit} style={{ maxWidth: 360, margin: '15vh auto', display: 'grid', gap: 10 }}>
      <h1>COVERAGE 백오피스</h1>
      <input type="email" placeholder="관리자 이메일" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" />
      <input type="password" placeholder="비밀번호" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
      <button className="primary" disabled={busy}>로그인</button>
      {error && <div className="error">{error}</div>}
    </form>
  )
}
