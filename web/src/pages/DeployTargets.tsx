import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, Pencil, Plug, Plus, RefreshCw, Server, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { Agent, DeployTarget } from '../lib/types'
import { Button, Card, Drawer, EmptyState, Field, FormSection, Input, PageHeader, Select, Textarea, Toast, useToast } from '../components/ui'
import { timeAgo } from '../lib/format'

type TestStatus = 'success' | 'error'

export default function DeployTargets() {
  const [dts, setDts] = useState<DeployTarget[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentId, setAgentId] = useState(0)
  const [showDrawer, setShowDrawer] = useState(false)
  const [editing, setEditing] = useState<DeployTarget | null>(null)
  const [name, setName] = useState('')
  const [kubeconfig, setKubeconfig] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, TestStatus>>({})
  const { toast, setToast } = useToast()

  const ready = dts.filter((t) => t.kubeconfigSet).length
  const healthy = Object.values(testResults).filter((s) => s === 'success').length

  async function load() {
    const [rs, ags] = await Promise.all([
      api<DeployTarget[]>('/api/deploy-targets'),
      api<Agent[]>('/api/agents').catch(() => []),
    ])
    setDts(rs)
    setAgents(ags)
    const initial: Record<number, TestStatus> = {}
    for (const t of rs) {
      if (t.lastTestStatus === 'success' || t.lastTestStatus === 'error') {
        initial[t.id] = t.lastTestStatus
      }
    }
    setTestResults(initial)
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
  }, [])

  function resetForm() {
    setName('')
    setKubeconfig('')
    setAgentId(0)
  }

  function openCreate() {
    resetForm()
    setEditing(null)
    setShowDrawer(true)
  }

  function openEdit(t: DeployTarget) {
    setEditing(t)
    setName(t.name)
    setKubeconfig('')
    setAgentId(t.agentId || 0)
    setShowDrawer(true)
  }

  async function save() {
    setBusy(true)
    try {
      const body: Record<string, unknown> = { name, agentId }
      if (kubeconfig) body.kubeconfig = kubeconfig
      if (editing) {
        await api('/api/deploy-targets/' + editing.id, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        setToast({ type: 'success', text: '部署环境已更新' })
      } else {
        await api('/api/deploy-targets', {
          method: 'POST',
          body: JSON.stringify({ ...body, kubeconfig, agentId }),
        })
        setToast({ type: 'success', text: '部署环境已添加' })
      }
      setShowDrawer(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(t: DeployTarget) {
    if (!confirm('确认删除部署环境「' + t.name + '」？')) return
    try {
      await api('/api/deploy-targets/' + t.id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  async function test(t: DeployTarget) {
    setTestingId(t.id)
    try {
      const r = await api<{ via?: string; agentName?: string }>('/api/deploy-targets/' + t.id + '/test', { method: 'POST' })
      setTestResults((prev) => ({ ...prev, [t.id]: 'success' }))
      const who = r.via === 'agent' && r.agentName ? `（由 ${r.agentName} 测试）` : '（服务端本机测试）'
      setToast({ type: 'success', text: '连通正常 ' + who })
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [t.id]: 'error' }))
      setToast({ type: 'error', text: e instanceof Error ? e.message : '连接失败' })
    } finally {
      setTestingId(null)
    }
  }

  const typeLabel = (t: string) => (t === 'k8s' ? 'Kubernetes' : t)

  const testLabel = (id: number) => {
    const s = testResults[id]
    if (s === 'success') return <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink"><span className="h-1.5 w-1.5 rounded-full bg-success" />正常</span>
    if (s === 'error') return <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-danger"><span className="h-1.5 w-1.5 rounded-full bg-danger" />失败</span>
    return <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted"><span className="h-1.5 w-1.5 rounded-full border border-faint" />未测</span>
  }

  return (
    <div>
      <PageHeader
        eyebrow="资源"
        title="部署环境"
        description="目标 Kubernetes 集群（kubeconfig）；命名空间与 workload 在流水线级配置。"
        action={
          <>
            <Button variant="secondary" onClick={refresh} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              刷新
            </Button>
            <Button onClick={openCreate}>
              <Plus size={15} />
              添加部署环境
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
        {[
          { label: '环境总数', value: dts.length, note: '已登记集群' },
          { label: 'kubeconfig 已设置', value: ready, note: '可执行部署' },
          { label: '连接正常', value: healthy, note: '本次会话测试通过' },
          { label: '已绑定执行器', value: dts.filter((t) => t.agentId).length, note: '内网集群需绑定' },
        ].map((s) => (
          <div key={s.label} className="bg-surface px-4 py-3.5 sm:px-5">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">{s.label}</div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-xl font-semibold tabular text-ink">{s.value}</span>
              <span className="hidden text-[10px] text-faint sm:inline">{s.note}</span>
            </div>
          </div>
        ))}
      </div>

      <Card className="overflow-hidden">
        {dts.length === 0 ? (
          <EmptyState
            icon={<Server size={32} />}
            title="还没有部署环境"
            description="添加 Kubernetes 集群并粘贴 kubeconfig，流水线部署时会用它更新 workload。"
            action={<Button onClick={openCreate}><Plus size={15} />添加部署环境</Button>}
          />
        ) : (
          <>
            <div className="hidden w-full overflow-x-auto md:block">
              <table className="w-full min-w-[920px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                    <th className="px-5 py-3 font-medium">环境</th>
                    <th className="px-5 py-3 font-medium">命名空间</th>
                    <th className="px-5 py-3 font-medium">kubeconfig</th>
                    <th className="px-5 py-3 font-medium">执行器</th>
                    <th className="px-5 py-3 font-medium">连接</th>
                    <th className="px-5 py-3 font-medium">最近部署</th>
                    <th className="px-5 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {dts.map((t) => (
                    <tr key={t.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface-2 text-muted">
                            <Server size={14} />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Link to={'/deploy-targets/' + t.id} className="truncate text-xs font-medium text-ink hover:text-brand">{t.name}</Link>
                              {t.isDefault ? <span className="rounded border border-copper/30 bg-copper/10 px-1 py-0.5 text-[9px] text-copper">默认</span> : null}
                            </div>
                            <div className="mt-0.5 text-[10px] text-faint">{typeLabel(t.type || 'k8s')}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 font-mono text-[11px] text-muted">{t.defaultNamespace || 'default'}</td>
                      <td className="px-5 py-3">
                        <span className={'inline-flex items-center gap-1.5 text-[11px] ' + (t.kubeconfigSet ? 'text-ink' : 'text-danger')}>
                          <KeyRound size={12} className="text-faint" />
                          {t.kubeconfigSet ? '已设置' : '未设置'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {t.agentId ? (
                          <div className="text-[11px] text-ink">
                            {t.agentName || '执行器 #' + t.agentId}
                            <div className="mt-0.5 text-[10px] text-faint">{t.agentStatus === 'online' ? '在线' : t.agentStatus === 'disabled' ? '已禁用' : '离线'}</div>
                          </div>
                        ) : <span className="text-[11px] text-faint">服务端本机</span>}
                      </td>
                      <td className="px-5 py-3">{testLabel(t.id)}</td>
                      <td className="px-5 py-3">
                        {t.lastDeploy ? (
                          <div className="text-[11px]">
                            <div className="font-mono text-ink">#{t.lastDeploy.number} · {t.lastDeploy.imageTag}</div>
                            <div className="mt-0.5 text-[10px] text-faint">{timeAgo(t.lastDeploy.finishedAt)}</div>
                          </div>
                        ) : <span className="text-[11px] text-faint">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="sm" onClick={() => test(t)} disabled={testingId === t.id}>
                            <Plug size={14} className={testingId === t.id ? 'animate-pulse' : ''} />
                            <span className="hidden xl:inline">{testingId === t.id ? '测试中' : '测试'}</span>
                          </Button>
                          <Link to={'/deploy-targets/' + t.id} className="inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink">
                            详情
                          </Link>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(t)} title="编辑">
                            <Pencil size={14} />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => remove(t)} className="text-danger hover:bg-danger/10" title="删除">
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-line md:hidden">
              {dts.map((t) => (
                <div key={t.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-muted">
                        <Server size={13} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Link to={'/deploy-targets/' + t.id} className="truncate text-xs font-medium text-ink">{t.name}</Link>
                          {t.isDefault ? <span className="rounded border border-copper/30 bg-copper/10 px-1 py-0.5 text-[9px] text-copper">默认</span> : null}
                        </div>
                        <div className="mt-0.5 text-[10px] text-faint">{typeLabel(t.type || 'k8s')}</div>
                      </div>
                    </div>
                    {testLabel(t.id)}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                    <div>
                      <div className="text-[10px] text-faint">命名空间</div>
                      <div className="mt-0.5 font-mono text-ink">{t.defaultNamespace || 'default'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-faint">kubeconfig</div>
                      <div className={'mt-0.5 ' + (t.kubeconfigSet ? 'text-ink' : 'text-danger')}>{t.kubeconfigSet ? '已设置' : '未设置'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-faint">执行器</div>
                      <div className="mt-0.5 text-ink">{t.agentId ? (t.agentName || '执行器 #' + t.agentId) : '服务端本机'}</div>
                    </div>
                  </div>
                  {t.lastDeploy ? (
                    <div className="mt-2 text-[10px] text-faint">最近部署 #{t.lastDeploy.number} · {timeAgo(t.lastDeploy.finishedAt)}</div>
                  ) : null}
                  <div className="mt-3 flex items-center justify-end gap-1">
                    <Button variant="secondary" size="sm" onClick={() => test(t)} disabled={testingId === t.id}>
                      <Plug size={13} />
                      {testingId === t.id ? '测试中' : '测试'}
                    </Button>
                    <Link to={'/deploy-targets/' + t.id} className="inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink">
                      详情
                    </Link>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                      <Pencil size={14} />
                      编辑
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(t)} className="text-danger">
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Drawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        title={editing ? '编辑部署环境' : '添加部署环境'}
        description={editing ? 'kubeconfig 留空表示不修改。' : '粘贴集群 kubeconfig；服务端加密保存，接口不会回显。'}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-faint">建议使用最小权限的 ServiceAccount</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowDrawer(false)}>取消</Button>
              <Button onClick={save} disabled={busy || !name || (!editing && !kubeconfig)}>
                {busy ? '保存中…' : editing ? '保存修改' : '添加部署环境'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-7">
          <FormSection title="集群" description="名称用于流水线的部署目标选择。">
            <Field label="名称">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 production / 萧山集群" />
            </Field>
          </FormSection>

          <FormSection title="执行器" description="内网集群需指定能访问该集群的 agent；未绑定时由服务端本机执行。">
            <Field label="部署执行器" hint="测试连接与实际部署都会经过这个执行器；执行器离线时步骤会排队。">
              <Select value={agentId} onChange={(e) => setAgentId(Number(e.target.value))}>
                <option value={0}>服务端本机</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.status === 'online' ? '' : a.status === 'disabled' ? '（已禁用）' : '（离线）'}</option>)}
              </Select>
            </Field>
          </FormSection>

          <FormSection title="kubeconfig" description="内容仅用于执行 kubectl，保存后不会在页面回显。">
            <Textarea
              value={kubeconfig}
              onChange={(e) => setKubeconfig(e.target.value)}
              placeholder={editing ? '留空不修改；粘贴新内容则替换' : '粘贴 kubeconfig 内容…'}
              className="min-h-[260px] font-mono !text-xs leading-relaxed"
              spellCheck={false}
            />
            <div className="mt-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-[10px] leading-5 text-faint">
              生产环境建议单独创建只允许更新 workload 的 ServiceAccount，避免使用集群管理员凭证。
            </div>
          </FormSection>
        </div>
      </Drawer>
      <Toast toast={toast} />
    </div>
  )
}
