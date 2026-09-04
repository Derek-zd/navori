import { useEffect, useState } from 'react'
import { Mail, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { User } from '../lib/types'
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
  const { toast, setToast } = useToast()

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
  }, [])

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
      <PageHeader title="设置" description="用户管理 / 发件邮箱" />

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
