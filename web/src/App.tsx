import Login from './pages/Login'
import Shell from './pages/Shell'
import { useAuth } from './lib/auth'

export default function App() {
  const { user, loading, setUser } = useAuth()
  if (loading) return <div className="p-8 text-slate-500">加载中…</div>
  if (!user) return <Login onLogin={setUser} />
  return <Shell />
}
