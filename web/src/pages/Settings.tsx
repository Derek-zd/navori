import { useEffect, useState } from 'react'
import { Database, Mail, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { User } from '../lib/types'
import { useAuth } from '../lib/auth'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select, Toast, useToast } from '../components/ui'

interface SettingsAPI {
  smtp: Record<string, string>
}
interface AuditLog {
  id: number
  username: string
  action: string
  target: string
  createdAt: string
}
interface DiskUsage {
  path: string
  exists: boolean
  percent: number
  usedGi: number
  totalGi: number
}
interface StorageAPI {
  usage: DiskUsage[]
  cleanup: {
    frequency: string
    threshold: number
    lastAt?: string | null
    lastMode?: string
  }
}

export default function Settings() {
  const [users, setUsers] = useState<User[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [uName, setUName] = useState('')
  const [uPass, setUPass] = useState('')
  const [uRole, setURole] = useState('user')
  const [busy, setBusy] = useState(false)
  const [smtp, setSmtp] = useState({ host: '', port: '', username: '', password: '', from: '' })
  const [smtpSaved, setSmtpSaved] = useState(false)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [actionFilter, setActionFilter] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [storage, setStorage] = useState<StorageAPI | null>(null)
  const [cleaning, setCleaning] = useState<'prune' | 'deep' | null>(null)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { toast, setToast } = useToast()

  async function loadStorage() {
    if (!isAdmin) return
    try {
      setStorage(await api<StorageAPI>('/api/system/storage'))
    } catch {
      setStorage(null)
    }
  }

  async function saveStoragePolicy() {
    if (!storage) return
    try {
      setStorage(await api<StorageAPI>('/api/system/storage', {
        method: 'PATCH',
        body: JSON.stringify({ frequency: storage.cleanup.frequency, threshold: storage.cleanup.threshold }),
      }))
      setToast({ type: 'success', text: '清理策略已保存' })
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    }
  }

  async function runClean(mode: 'prune' | 'deep') {
    if (mode === 'deep' && !confirm('深度清理会删除所有未使用的镜像与构建缓存，确认继续？')) return
    setCleaning(mode)
    try {
      const res = await api<{ usage: DiskUsage[]; output: string }>('/api/system/storage/cleanup', {
        method: 'POST',
        body: JSON.stringify({ mode }),
      })
      if (storage) setStorage({ ...storage, usage: res.usage, cleanup: { ...storage.cleanup, lastAt: new Date().toISOString(), lastMode: mode } })
      setToast({ type: 'success', text: mode === 'prune' ? '构建缓存已清理' : '深度清理完成' })
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '清理失败' })
    } finally {
      setCleaning(null)
    }
  }

  async function load() {
    const [us, settings, logs] = await Promise.all([
      api<User[]>('/api/users'),
      api<SettingsAPI>('/api/system/settings').catch(() => ({ smtp: {} }) as SettingsAPI),
      api<AuditLog[]>('/api/audit-logs').catch(() => [] as AuditLog[]),
    ])
    setUsers(us)
    setLogs(logs)
    setSmtp({
      host: settings.smtp?.host || '',
      port: settings.smtp?.port || '',
      username: settings.smtp?.username || '',
      password: settings.smtp?.password === 'already-set' ? '' : (settings.smtp?.password || ''),
      from: settings.smtp?.from || '',
    })
  }
  useEffect(() => {
    load().catch(() => {})
    loadStorage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isAdmin) loadStorage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  function resetForm() {
    setUName(''); setUPass(''); setURole('user')
  }
  function openCreate() {
    resetForm(); setEditing(null); setShowModal(true)
  }
  function openEdit(u: User) {
    setEditing(u); setUName(u.username); setUPass(''); setURole(u.role); setShowModal(true)
  }
  async function save() {
    setBusy(true)
    try {
      const body: Record<string, unknown> = { role: uRole }
      if (uPass) body.password = uPass
      if (editing) {
        await api('/api/users/' + editing.id, { method: 'PATCH', body: JSON.stringify(body) })
        setToast({ type: 'success', text: '用户已更新' })
      } else {
        await api('/api/users', { method: 'POST', body: JSON.stringify({ username: uName, password: uPass, role: uRole }) })
        setToast({ type: 'success', text: '用户已添加' })
      }
      setShowModal(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setBusy(false)
    }
  }
  async function remove(id: number) {
    if (!confirm('确认删除该用户？')) return
    try {
      await api('/api/users/' + id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  const filteredLogs = logs.filter((l) => !actionFilter || l.action === actionFilter)

  async function saveSmtp() {
    setSmtpSaved(true)
    try {
      await api('/api/system/settings', { method: 'PATCH', body: JSON.stringify({ smtp }) })
      setToast({ type: 'success', text: '发件邮箱已保存' })
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setSmtpSaved(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="设置" description="用户管理 / 发件邮箱 / 存储清理" />

      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">用户管理</h2>
          <Button onClick={openCreate} size="sm"><Plus size={14} />添加用户</Button>
        </div>
        {users.length === 0 ? (
          <EmptyState title="还没有用户" description="添加一个普通用户，用于登录和操作审批等流程。" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">用户名</th>
                <th className="px-4 py-3">角色</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 text-slate-700">{u.username}</td>
                  <td className="px-4 py-3">
                    <span className={'rounded-full px-2 py-0.5 text-xs ' + (u.role === 'admin' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-600')}>{u.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" onClick={() => openEdit(u)}><Pencil size={15} /></Button>
                      <Button variant="ghost" onClick={() => remove(u.id)} className="text-red-600 hover:bg-red-50"><Trash2 size={15} /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Mail size={15} />发件邮箱（SMTP）</h2>
        </div>
        <div className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">SMTP 主机</label>
            <Input value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.xxx.com" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">端口</label>
            <Input value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} placeholder="465/587/25" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">用户名</label>
            <Input value={smtp.username} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} placeholder="发信账号" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">密码 / 授权码</label>
            <Input type="password" value={smtp.password} onChange={(e) => setSmtp({ ...smtp, password: e.target.value })} placeholder="留空则不修改" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">发件人</label>
            <Input value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} placeholder="no-reply@xxx.com" />
          </div>
        </div>
          <Button onClick={saveSmtp} disabled={smtpSaved}>{smtpSaved ? '保存中…' : '保存发件邮箱'}</Button>
        </div>
      </Card>

      {isAdmin ? (
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Database size={15} />存储管理（镜像构建缓存）</h2>
          </div>
          <div className="space-y-4 p-5">
            {storage ? (
              <>
                {storage.usage.filter((u) => u.exists).map((u) => (
                  <div key={u.path}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-500">{u.path}</span>
                      <span className="text-slate-600">{u.usedGi} GiB / {u.totalGi} GiB（{u.percent}%）</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={'h-full rounded-full ' + (u.percent > 85 ? 'bg-red-500' : u.percent > 70 ? 'bg-amber-400' : 'bg-emerald-500')}
                        style={{ width: Math.min(100, u.percent) + '%' }}
                      />
                    </div>
                  </div>
                ))}

                <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-600">自动清理频率</label>
                    <Select value={storage.cleanup.frequency} onChange={(e) => setStorage({ ...storage, cleanup: { ...storage.cleanup, frequency: e.target.value } })} className="!w-28 !py-1.5 text-xs">
                      <option value="off">关闭</option>
                      <option value="daily">每日</option>
                      <option value="weekly">每周</option>
                      <option value="monthly">每月</option>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-600">超阈值深度清理</label>
                    <Input
                      type="number" min={50} max={99}
                      value={storage.cleanup.threshold}
                      onChange={(e) => setStorage({ ...storage, cleanup: { ...storage.cleanup, threshold: Number(e.target.value) } })}
                      className="!w-20 !py-1.5 text-xs"
                    /> %
                  </div>
                  <Button variant="secondary" size="sm" onClick={saveStoragePolicy}>保存策略</Button>
                  <span className="text-xs text-slate-400">
                    {storage.cleanup.lastAt ? '上次清理：' + new Date(storage.cleanup.lastAt).toLocaleString() + '（' + (storage.cleanup.lastMode || '') + '）' : '尚未自动清理'}
                  </span>
                </div>

                <div className="flex gap-2 border-t border-slate-100 pt-4">
                  <Button size="sm" onClick={() => runClean('prune')} disabled={!!cleaning}>
                    {cleaning === 'prune' ? '清理中…' : '清理构建缓存（prune）'}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => runClean('deep')} disabled={!!cleaning}>
                    {cleaning === 'deep' ? '清理中…' : '深度清理（image prune）'}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">加载存储信息失败（仅管理员可见）。</p>
            )}
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">操作审计</h2>
          <Select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="!w-36 !py-1.5 text-xs">
            <option value="">全部操作</option>
            {Array.from(new Set(logs.map((l) => l.action))).map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        </div>
        <div className="overflow-x-auto">
          {filteredLogs.length === 0 ? (
            <EmptyState title="暂无审计记录" description="增删改、审批等写操作会在这里留下记录。" />
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3">时间</th>
                    <th className="px-4 py-3">操作</th>
                    <th className="px-4 py-3">用户</th>
                    <th className="px-4 py-3">目标</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.slice(0, showAll ? undefined : 50).map((l) => (
                    <tr key={l.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 text-slate-500">{l.createdAt ? new Date(l.createdAt).toLocaleString() : ''}</td>
                      <td className="px-4 py-3"><span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{l.action}</span></td>
                      <td className="px-4 py-3 text-slate-700">{l.username || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{l.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs.length > 50 ? (
                <div className="px-4 py-3">
                  <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>{showAll ? '收起' : '显示全部'}</Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? '编辑用户' : '添加用户'}>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">用户名</label>
            <Input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="用户名" disabled={!!editing} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">密码</label>
            <Input type="password" value={uPass} onChange={(e) => setUPass(e.target.value)} placeholder={editing ? '留空不修改' : '密码'} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">角色</label>
            <Select value={uRole} onChange={(e) => setURole(e.target.value)}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
            <Button onClick={save} disabled={busy || (!editing && (!uName || !uPass))}>{busy ? '保存中…' : editing ? '保存修改' : '添加'}</Button>
          </div>
        </div>
      </Modal>
      <Toast toast={toast} />
    </div>
  )
}
