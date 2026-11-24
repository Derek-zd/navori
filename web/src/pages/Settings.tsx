import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Database, HardDrive, Mail, Pencil, Plus, RefreshCw, ScrollText, ShieldCheck, Trash2, Users } from 'lucide-react'
import { api } from '../lib/api'
import type { User } from '../lib/types'
import { useAuth } from '../lib/auth'
import { Button, Card, Drawer, EmptyState, Field, FormSection, Input, PageHeader, Select, Toast, useToast } from '../components/ui'
import { formatDateTime } from '../lib/format'

interface SettingsAPI {
  smtp: Record<string, string>
}

const ACTION_LABELS: Record<string, string> = {
  'repository.create': '创建仓库', 'repository.update': '更新仓库', 'repository.delete': '删除仓库', 'repository.scan': '扫描仓库',
  'pipeline.create': '创建流水线', 'pipeline.update': '更新流水线', 'pipeline.delete': '删除流水线', 'pipeline.run': '触发运行',
  'registry.create': '创建镜像仓库', 'registry.update': '更新镜像仓库', 'registry.delete': '删除镜像仓库', 'registry.test': '测试镜像仓库',
  'deploytarget.create': '创建部署环境', 'deploytarget.update': '更新部署环境', 'deploytarget.delete': '删除部署环境', 'deploytarget.test': '测试部署环境',
  'variable.create': '创建变量', 'variable.update': '更新变量', 'variable.delete': '删除变量',
  'channel.create': '创建通知通道', 'channel.update': '更新通知通道', 'channel.delete': '删除通知通道',
  'user.create': '创建用户', 'user.update': '更新用户', 'user.delete': '删除用户',
  'credential.create': '创建凭证', 'credential.update': '更新凭证', 'credential.delete': '删除凭证',
  'settings.update': '更新系统设置', 'storage.policy.update': '更新存储策略',
  'storage.cleanup.prune': '清理构建缓存', 'storage.cleanup.deep': '深度清理',
  'approve': '通过审批', 'reject': '拒绝审批', 'run.stop': '取消运行', 'run.rerun': '重跑',
  'agent.register': '登记执行器', 'agent.update': '更新执行器', 'agent.disable': '禁用执行器', 'agent.enable': '启用执行器',
  'agent.rotate': '轮换执行器 token', 'agent.delete': '删除执行器',
  'step.dispatch': '派发步骤', 'step.result': '步骤结果',
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] || action
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

const TABS = [
  { key: 'users', label: '用户与权限', icon: Users, admin: true },
  { key: 'smtp', label: '发件邮箱', icon: Mail, admin: true },
  { key: 'storage', label: '存储', icon: HardDrive, admin: true },
  { key: 'audit', label: '操作审计', icon: ScrollText, admin: false },
]

export default function Settings() {
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState<User[]>([])
  const [showDrawer, setShowDrawer] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [uName, setUName] = useState('')
  const [uPass, setUPass] = useState('')
  const [uRole, setURole] = useState('user')
  const [busy, setBusy] = useState(false)
  const [smtp, setSmtp] = useState({ host: '', port: '', username: '', password: '', from: '' })
  const [smtpBusy, setSmtpBusy] = useState(false)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [actionFilter, setActionFilter] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [storage, setStorage] = useState<StorageAPI | null>(null)
  const [cleaning, setCleaning] = useState<'prune' | 'deep' | null>(null)
  const [storageBusy, setStorageBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { toast, setToast } = useToast()

  const visibleTabs = TABS.filter((t) => !t.admin || isAdmin)
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : (visibleTabs[0]?.key || 'audit')

  useEffect(() => {
    if (!visibleTabs.some((t) => t.key === tab)) setTab(visibleTabs[0]?.key || 'audit')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  async function loadUsers() {
    if (!isAdmin) return
    setUsers(await api<User[]>('/api/users'))
  }

  async function loadSmtp() {
    const settings = await api<SettingsAPI>('/api/system/settings').catch(() => ({ smtp: {} }) as SettingsAPI)
    setSmtp({
      host: settings.smtp?.host || '',
      port: settings.smtp?.port || '',
      username: settings.smtp?.username || '',
      password: settings.smtp?.password === 'already-set' ? '' : (settings.smtp?.password || ''),
      from: settings.smtp?.from || '',
    })
  }

  async function loadLogs() {
    const ls = await api<AuditLog[]>('/api/audit-logs').catch(() => [] as AuditLog[])
    setLogs(ls)
  }

  async function loadStorage() {
    if (!isAdmin) return
    try {
      setStorage(await api<StorageAPI>('/api/system/storage'))
    } catch {
      setStorage(null)
    }
  }

  async function load() {
    await Promise.all([loadUsers(), loadSmtp(), loadLogs(), loadStorage()])
  }

  async function refresh() {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  async function saveStoragePolicy() {
    if (!storage) return
    setStorageBusy(true)
    try {
      setStorage(await api<StorageAPI>('/api/system/storage', {
        method: 'PATCH',
        body: JSON.stringify({ frequency: storage.cleanup.frequency, threshold: storage.cleanup.threshold }),
      }))
      setToast({ type: 'success', text: '清理策略已保存' })
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setStorageBusy(false)
    }
  }

  async function runClean(mode: 'prune' | 'deep') {
    if (mode === 'deep' && !confirm('深度清理会删除所有容器与未使用镜像（含被构建容器占用的中间层），下次构建需重新拉取基础镜像。确认继续？')) return
    setCleaning(mode)
    try {
      const res = await api<{ usage: DiskUsage[]; output: string; reclaimed?: string }>('/api/system/storage/cleanup', {
        method: 'POST',
        body: JSON.stringify({ mode }),
      })
      if (storage) setStorage({ ...storage, usage: res.usage, cleanup: { ...storage.cleanup, lastAt: new Date().toISOString(), lastMode: mode } })
      const freed = res.reclaimed && res.reclaimed !== '0B' ? '，回收 ' + res.reclaimed : ''
      setToast({ type: 'success', text: (mode === 'prune' ? '构建缓存已清理' : '深度清理完成') + freed })
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '清理失败' })
    } finally {
      setCleaning(null)
    }
  }

  function resetForm() {
    setUName('')
    setUPass('')
    setURole('user')
  }
  function openCreate() {
    resetForm()
    setEditing(null)
    setShowDrawer(true)
  }
  function openEdit(u: User) {
    setEditing(u)
    setUName(u.username)
    setUPass('')
    setURole(u.role)
    setShowDrawer(true)
  }
  async function saveUser() {
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
      setShowDrawer(false)
      await loadUsers()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setBusy(false)
    }
  }
  async function removeUser(u: User) {
    if (!confirm('确认删除用户「' + u.username + '」？')) return
    try {
      await api('/api/users/' + u.id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await loadUsers()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  const filteredLogs = useMemo(() => logs.filter((l) => !actionFilter || l.action === actionFilter), [logs, actionFilter])
  const actions = useMemo(() => Array.from(new Set(logs.map((l) => l.action))).sort(), [logs])

  async function saveSmtp() {
    setSmtpBusy(true)
    try {
      await api('/api/system/settings', { method: 'PATCH', body: JSON.stringify({ smtp }) })
      setToast({ type: 'success', text: '发件邮箱已保存' })
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setSmtpBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="系统"
        title="设置"
        description="用户与权限、邮件发件、存储清理和操作审计。"
        action={
          <Button variant="secondary" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            刷新
          </Button>
        }
      />

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {visibleTabs.map((t) => {
          const Icon = t.icon
          const active = activeTab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                'relative -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ' +
                (active ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink')
              }
            >
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'users' ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">用户与权限</h2>
              <p className="mt-0.5 text-[10px] text-faint">管理员可管理用户；普通成员可以触发运行和审批。</p>
            </div>
            <Button size="sm" onClick={openCreate}><Plus size={14} />添加用户</Button>
          </div>
          {users.length === 0 ? (
            <EmptyState icon={<Users size={30} />} title="还没有用户" description="添加一个普通用户，用于登录和操作审批等流程。" />
          ) : (
            <>
              <div className="hidden w-full overflow-x-auto md:block">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                      <th className="px-5 py-3 font-medium">用户</th>
                      <th className="px-5 py-3 font-medium">角色</th>
                      <th className="px-5 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface-2 text-[10px] font-medium uppercase text-muted">
                              {u.username.slice(0, 1)}
                            </span>
                            <span className="text-xs font-medium text-ink">{u.username}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className={'rounded border px-1.5 py-0.5 text-[10px] font-medium ' + (u.role === 'admin' ? 'border-copper/30 bg-copper/10 text-copper' : 'border-line bg-surface-2 text-muted')}>
                            {u.role === 'admin' ? '管理员' : '成员'}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-0.5">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(u)} title="编辑"><Pencil size={14} /></Button>
                            <Button variant="ghost" size="sm" onClick={() => removeUser(u)} className="text-danger hover:bg-danger/10" title="删除"><Trash2 size={14} /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-line md:hidden">
                {users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[10px] uppercase text-muted">{u.username.slice(0, 1)}</span>
                      <div>
                        <div className="text-xs font-medium text-ink">{u.username}</div>
                        <div className="mt-0.5 text-[10px] text-faint">{u.role === 'admin' ? '管理员' : '成员'}</div>
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(u)}><Pencil size={14} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => removeUser(u)} className="text-danger"><Trash2 size={14} /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      ) : null}

      {activeTab === 'smtp' ? (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Mail size={15} className="text-muted" />发件邮箱（SMTP）</h2>
            <p className="mt-0.5 text-[10px] text-faint">用于邮件通知通道；密码加密保存，留空表示不修改。</p>
          </div>
          <div className="max-w-2xl space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SMTP 主机">
                <Input value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.example.com" />
              </Field>
              <Field label="端口">
                <Input value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} placeholder="465 / 587 / 25" />
              </Field>
              <Field label="用户名">
                <Input value={smtp.username} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} placeholder="发信账号" />
              </Field>
              <Field label="密码 / 授权码" hint="留空不修改已保存的密码。">
                <Input type="password" value={smtp.password} onChange={(e) => setSmtp({ ...smtp, password: e.target.value })} placeholder="留空不修改" />
              </Field>
              <Field label="发件人" className="sm:col-span-2">
                <Input value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} placeholder="Navori <no-reply@example.com>" />
              </Field>
            </div>
            <div className="flex items-center gap-2 border-t border-line pt-4">
              <Button onClick={saveSmtp} disabled={smtpBusy}>{smtpBusy ? '保存中…' : '保存发件邮箱'}</Button>
              <span className="text-[10px] text-faint">保存后立即用于新的邮件通知。</span>
            </div>
          </div>
        </Card>
      ) : null}

      {activeTab === 'storage' ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Database size={15} className="text-muted" />存储管理</h2>
              <p className="mt-0.5 text-[10px] text-faint">镜像构建缓存与 Docker 数据目录占用，仅管理员可见。</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => loadStorage().catch(() => {})}>读取最新占用</Button>
          </div>
          <div className="space-y-5 p-5">
            {storage ? (
              <>
                {storage.usage.filter((u) => u.exists).length === 0 ? (
                  <p className="text-xs text-faint">暂无磁盘占用数据；点击「读取最新占用」刷新。</p>
                ) : storage.usage.filter((u) => u.exists).map((u) => (
                  <div key={u.path}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px]">
                      <span className="min-w-0 truncate font-mono text-muted" title={u.path}>{u.path}</span>
                      <span className="shrink-0 tabular text-ink">{u.usedGi} / {u.totalGi} GiB · {u.percent}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={'h-full rounded-full ' + (u.percent > 85 ? 'bg-danger' : u.percent > 70 ? 'bg-warning' : 'bg-success')}
                        style={{ width: Math.min(100, u.percent) + '%' }}
                      />
                    </div>
                  </div>
                ))}

                <div className="flex flex-wrap items-end gap-4 border-t border-line pt-5">
                  <Field label="自动清理频率">
                    <Select
                      value={storage.cleanup.frequency}
                      onChange={(e) => setStorage({ ...storage, cleanup: { ...storage.cleanup, frequency: e.target.value } })}
                      className="!w-28 !py-1.5 text-xs"
                    >
                      <option value="off">关闭</option>
                      <option value="daily">每日</option>
                      <option value="weekly">每周</option>
                      <option value="monthly">每月</option>
                    </Select>
                  </Field>
                  <Field label="超阈值深度清理">
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={50}
                        max={99}
                        value={storage.cleanup.threshold}
                        onChange={(e) => setStorage({ ...storage, cleanup: { ...storage.cleanup, threshold: Number(e.target.value) } })}
                        className="!w-20 !py-1.5 text-xs"
                      />
                      <span className="text-xs text-muted">%</span>
                    </div>
                  </Field>
                  <Button variant="secondary" size="sm" onClick={saveStoragePolicy} disabled={storageBusy}>{storageBusy ? '保存中…' : '保存策略'}</Button>
                  <span className="text-[10px] text-faint">
                    {storage.cleanup.lastAt ? '上次清理：' + formatDateTime(storage.cleanup.lastAt) + '（' + (storage.cleanup.lastMode || '') + '）' : '尚未自动清理'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
                  <Button size="sm" onClick={() => runClean('prune')} disabled={!!cleaning}>
                    {cleaning === 'prune' ? '清理中…' : '清理构建缓存（prune）'}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => runClean('deep')} disabled={!!cleaning}>
                    {cleaning === 'deep' ? '清理中…' : '深度清理（image prune）'}
                  </Button>
                  <span className="inline-flex items-center gap-1 text-[10px] text-faint"><AlertTriangle size={12} />深度清理会删除未使用镜像</span>
                </div>
              </>
            ) : (
              <EmptyState icon={<HardDrive size={30} />} title="无法读取存储信息" description="仅管理员可查看，或后端存储接口暂不可用。" />
            )}
          </div>
        </Card>
      ) : null}

      {activeTab === 'audit' ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><ScrollText size={15} className="text-muted" />操作审计</h2>
              <p className="mt-0.5 text-[10px] text-faint">增删改、审批、运行等写操作会留下记录，最多显示最近 200 条。</p>
            </div>
            <Select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="!w-40 !py-1.5 text-xs">
              <option value="">全部操作</option>
              {actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
            </Select>
          </div>
          {filteredLogs.length === 0 ? (
            <EmptyState icon={<ShieldCheck size={30} />} title="暂无审计记录" description="增删改、审批等写操作会在这里留下记录。" />
          ) : (
            <>
              <div className="hidden w-full overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                      <th className="px-5 py-3 font-medium">时间</th>
                      <th className="px-5 py-3 font-medium">操作</th>
                      <th className="px-5 py-3 font-medium">用户</th>
                      <th className="px-5 py-3 font-medium">目标</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.slice(0, showAll ? undefined : 50).map((l) => (
                      <tr key={l.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                        <td className="whitespace-nowrap px-5 py-3 text-[11px] text-muted">{formatDateTime(l.createdAt)}</td>
                        <td className="px-5 py-3">
                          <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink" title={l.action}>{actionLabel(l.action)}</span>
                        </td>
                        <td className="px-5 py-3 text-[11px] text-ink">{l.username || '—'}</td>
                        <td className="max-w-[300px] truncate px-5 py-3 font-mono text-[10px] text-muted">{l.target}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-line md:hidden">
                {filteredLogs.slice(0, showAll ? undefined : 50).map((l) => (
                  <div key={l.id} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink" title={l.action}>{actionLabel(l.action)}</span>
                      <span className="text-[10px] text-faint">{formatDateTime(l.createdAt)}</span>
                    </div>
                    <div className="mt-1.5 truncate font-mono text-[10px] text-muted">{l.target}</div>
                    <div className="mt-1 text-[10px] text-faint">{l.username || '—'}</div>
                  </div>
                ))}
              </div>
              {logs.length > 50 ? (
                <div className="border-t border-line px-5 py-3">
                  <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>{showAll ? '收起' : '显示全部'}</Button>
                </div>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      <Drawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        title={editing ? '编辑用户' : '添加用户'}
        description="成员可以登录、触发运行和审批；管理员可管理用户与执行器。"
        width="max-w-[520px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowDrawer(false)}>取消</Button>
            <Button onClick={saveUser} disabled={busy || (!editing && (!uName || !uPass))}>
              {busy ? '保存中…' : editing ? '保存修改' : '添加用户'}
            </Button>
          </div>
        }
      >
        <div className="space-y-7">
          <FormSection title="账号">
            <div className="space-y-4">
              <Field label="用户名" hint={editing ? '用户名创建后不可修改。' : undefined}>
                <Input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="用户名" disabled={!!editing} />
              </Field>
              <Field label="密码" hint={editing ? '留空表示不修改密码。' : '至少 6 位，建议使用随机密码。'}>
                <Input type="password" value={uPass} onChange={(e) => setUPass(e.target.value)} placeholder={editing ? '留空不修改' : '密码'} />
              </Field>
              <Field label="角色">
                <Select value={uRole} onChange={(e) => setURole(e.target.value)}>
                  <option value="user">成员（user）</option>
                  <option value="admin">管理员（admin）</option>
                </Select>
              </Field>
            </div>
          </FormSection>
        </div>
      </Drawer>
      <Toast toast={toast} />
    </div>
  )
}
