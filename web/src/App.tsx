import Login from './pages/Login'
import Shell from './pages/Shell'
import { useAuth } from './lib/auth'

export default function App() {
  const { user, loading, setUser } = useAuth()
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-muted">加载中…</div>
  if (!user) return <Login onLogin={setUser} />
  return <Shell />
}
