import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import type { User } from '../lib/auth'
import { Button, Input } from '../components/ui'
import Brand from '../components/Brand'
import ThemeMenu from '../components/ThemeMenu'

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
      const data = await api<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      onLogin(data.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-canvas">
      <div className="absolute right-4 top-4 z-10">
        <ThemeMenu />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex justify-center">
            <Brand />
          </div>

          <div className="rounded-xl border border-line bg-surface p-7 shadow-overlay">
            <div className="mb-6">
              <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-faint">控制台</div>
              <h1 className="mt-2 text-[20px] font-semibold tracking-[-0.01em] text-ink">登录 Navori</h1>
              <p className="mt-1.5 text-[12px] leading-5 text-muted">使用管理员或成员账号继续。</p>
            </div>

            <form onSubmit={submit}>
              <div className="mb-4">
                <label htmlFor="username" className="mb-1.5 block text-[11px] font-medium text-muted">
                  用户名
                </label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="输入用户名"
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div className="mb-5">
                <label htmlFor="password" className="mb-1.5 block text-[11px] font-medium text-muted">
                  密码
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="输入密码"
                  autoComplete="current-password"
                />
              </div>

              {error ? (
                <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-[12px] text-danger">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
                  {error}
                </div>
              ) : null}

              <Button type="submit" disabled={busy || !username || !password} className="w-full">
                {busy ? '登录中…' : '登录'}
              </Button>
            </form>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-[10px] text-faint">
            <span className="h-px w-6 bg-line" />
            <span>单容器 · 自托管 · 无外部依赖</span>
            <span className="h-px w-6 bg-line" />
          </div>
        </div>
      </div>
    </div>
  )
}
