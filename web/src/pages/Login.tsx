import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import type { User } from '../lib/auth'
import { Button, Input } from '../components/ui'
import Brand from '../components/Brand'

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      onLogin(data.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100">
      <form onSubmit={submit} className="w-80 rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
        <div className="mb-2 flex justify-center">
          <Brand />
        </div>
        <p className="mb-8 text-center text-sm text-slate-400">轻量 CI/CD 平台</p>
        <div className="mb-5 space-y-3">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名" autoFocus />
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
        </div>
        {error ? <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}
        <Button type="submit" disabled={busy || !username || !password} className="w-full">
          {busy ? '登录中…' : '登录'}
        </Button>
      </form>
    </div>
  )
}
