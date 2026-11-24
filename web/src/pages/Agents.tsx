import { useEffect, useState } from 'react'
import { AlertTriangle, Cpu, KeyRound, Pencil, Plus, Power, RefreshCw, Server, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { Agent } from '../lib/types'
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  Field,
  FormSection,
  Input,
  PageHeader,
  Status,
  Toast,
  useToast,
} from '../components/ui'
import { formatDateTime, timeAgo } from '../lib/format'

function labelList(value: string) {
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

function hasCapability(labels: string, kind: 'build' | 'deploy') {
  const tags = labelList(labels)
  return tags.includes(kind + '=true') || tags.includes('role=' + kind)
}

function isCapabilityTag(tag: string) {
  return tag === 'build=true' || tag === 'deploy=true' || tag === 'role=build' || tag === 'role=deploy'
}

function capabilityTags(labels: string) {
  const out: string[] = []
  if (hasCapability(labels, 'build')) out.push('构建')
  if (hasCapability(labels, 'deploy')) out.push('部署')
  return out
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [name, setName] = useState('')
  const [canBuild, setCanBuild] = useState(false)
  const [canDeploy, setCanDeploy] = useState(false)
  const [extraTags, setExtraTags] = useState('')
  const [originalTags, setOriginalTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [tokenInfo, setTokenInfo] = useState<{ name: string; token: string } | null>(null)
  const { toast, setToast } = useToast()

  async function load() {
    try {
      setAgents(await api<Agent[]>('/api/agents'))
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '加载执行器失败' })
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])

  function openCreate() {
    setEditing(null)
    setName('')
    setCanBuild(false)
    setCanDeploy(false)
    setExtraTags('')
    setOriginalTags([])
    setDrawerOpen(true)
  }

  function openEdit(a: Agent) {
    const tags = labelList(a.labels)
    setEditing(a)
    setName(a.name)
    setCanBuild(hasCapability(a.labels, 'build'))
    setCanDeploy(hasCapability(a.labels, 'deploy'))
    setExtraTags(tags.filter((t) => !isCapabilityTag(t)).join(','))
    setOriginalTags(tags)
    setDrawerOpen(true)
  }

  function composedLabels() {
    const out = labelList(extraTags).filter((t) => !/^(build|deploy)=/.test(t) && t !== 'role=build' && t !== 'role=deploy')
    if (canBuild) {
      out.push('build=true')
      if (originalTags.includes('role=build')) out.push('role=build')
    }
    if (canDeploy) {
      out.push('deploy=true')
      if (originalTags.includes('role=deploy')) out.push('role=deploy')
    }
    return out
  }

  async function save() {
    setBusy(true)
    try {
      const labels = composedLabels().join(',')
      if (editing) {
        await api('/api/agents/' + editing.id, {
          method: 'PATCH',
          body: JSON.stringify({ labels }),
        })
        setToast({ type: 'success', text: '执行器已更新' })
      } else {
        const res = await api<{ agent: Agent; token: string }>('/api/agents', {
          method: 'POST',
          body: JSON.stringify({ name, labels }),
        })
        setTokenInfo({ name: res.agent.name, token: res.token })
        setToast({ type: 'success', text: '执行器已创建' })
      }
      setDrawerOpen(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  async function toggle(a: Agent) {
    try {
      await api('/api/agents/' + a.id, {
        method: 'PATCH',
        body: JSON.stringify({ disabled: a.status !== 'disabled' }),
      })
      setToast({ type: 'success', text: a.status === 'disabled' ? '执行器已启用' : '执行器已禁用' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '操作失败' })
    }
  }

  async function rotate(a: Agent) {
    if (!confirm('轮换后旧 token 立即失效，正在运行的 agent 会掉线。确认继续？')) return
    try {
      const res = await api<{ token: string }>('/api/agents/' + a.id + '/rotate-token', { method: 'POST' })
      setTokenInfo({ name: a.name, token: res.token })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '轮换失败' })
    }
  }

  async function remove(a: Agent) {
    if (!confirm('确认删除执行器「' + a.name + '」？正在运行的步骤不会被中断。')) return
    try {
      await api('/api/agents/' + a.id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  async function copyToken() {
    if (!tokenInfo) return
    const ok = await copyText(tokenInfo.token)
    setToast(ok ? { type: 'success', text: 'token 已复制' } : { type: 'error', text: '复制失败，请手动选择复制' })
  }

  const online = agents.filter((a) => a.status === 'online').length
  const offline = agents.filter((a) => a.status === 'offline').length
  const disabled = agents.filter((a) => a.status === 'disabled').length

  return (
    <div>
      <PageHeader
        eyebrow="执行"
        title="执行器"
        description="分布式执行 agent：主动轮询任务，按标签领取构建与部署步骤。服务端从不主动连接 agent。"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={load}>
              <RefreshCw size={15} />
              刷新
            </Button>
            <Button onClick={openCreate}>
              <Plus size={15} />
              添加执行器
            </Button>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-3 divide-x divide-line rounded-lg border border-line bg-surface">
        {[
          { label: '在线', value: online, note: '可领取步骤' },
          { label: '总数', value: agents.length, note: '已登记执行器' },
          { label: '已禁用', value: disabled, note: '不接收任务' },
        ].map((s) => (
          <div key={s.label} className="px-4 py-3.5 sm:px-5">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">{s.label}</div>
            <div className="mt-1.5 text-xl font-semibold tabular text-ink">{s.value}</div>
            <div className="mt-0.5 hidden text-[10px] text-faint sm:block">{s.note}</div>
          </div>
        ))}
      </div>

      {offline > 0 ? (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
          <div className="min-w-0 text-xs leading-5">
            <span className="font-medium text-ink">{offline} 个执行器离线</span>
            <span className="text-muted">。依赖其能力与标签的步骤会保持排队，不会自动回退到本机。</span>
          </div>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        {agents.length === 0 ? (
          <EmptyState
            icon={<Cpu size={32} />}
            title="还没有执行器"
            description="创建执行器，把一次性 token 配到目标机器的 navori-agent.env，agent 上线后状态会变为在线。"
            action={<Button onClick={openCreate}><Plus size={15} />添加执行器</Button>}
          />
        ) : (
          <>
            <div className="hidden w-full overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                    <th className="px-5 py-3 font-medium">执行器</th>
                    <th className="px-5 py-3 font-medium">状态</th>
                    <th className="px-5 py-3 font-medium">能力 / 标签</th>
                    <th className="hidden px-5 py-3 font-medium xl:table-cell">版本 / 协议</th>
                    <th className="px-5 py-3 font-medium">最后心跳</th>
                    <th className="px-5 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface-2 text-muted">
                            <Server size={14} />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-ink">{a.name}</div>
                            <div className="mt-0.5 truncate font-mono text-[10px] text-faint">{a.hostname || '主机未上报'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3"><Status value={a.status} /></td>
                      <td className="max-w-[300px] px-5 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {capabilityTags(a.labels).length > 0 ? capabilityTags(a.labels).map((c) => (
                            <span key={c} className="rounded border border-brand/20 bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">{c}</span>
                          )) : <span className="text-[11px] text-faint">能力未标注</span>}
                          {labelList(a.labels).filter((l) => !isCapabilityTag(l)).map((l) => (
                            <span key={l} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{l}</span>
                          ))}
                        </div>
                      </td>
                      <td className="hidden px-5 py-3 font-mono text-[10px] text-faint xl:table-cell">{a.version || '—'} / p{a.protocol}</td>
                      <td className="px-5 py-3">
                        <div className="text-[11px] text-ink" title={formatDateTime(a.lastSeenAt)}>{timeAgo(a.lastSeenAt)}</div>
                        <div className="mt-0.5 hidden text-[10px] text-faint sm:block">{a.lastSeenAt ? formatDateTime(a.lastSeenAt) : '从未上线'}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(a)} title="编辑能力与标签">
                            <Pencil size={14} />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => rotate(a)} title="轮换 token">
                            <KeyRound size={14} />
                            <span className="hidden xl:inline">token</span>
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => toggle(a)} title={a.status === 'disabled' ? '启用' : '禁用'}>
                            <Power size={14} />
                            <span className="hidden xl:inline">{a.status === 'disabled' ? '启用' : '禁用'}</span>
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => remove(a)} className="text-danger hover:bg-danger/10" title="删除">
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
              {agents.map((a) => (
                <div key={a.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{a.name}</div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-faint">{a.hostname || '主机未上报'}</div>
                    </div>
                    <Status value={a.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1">
                    {capabilityTags(a.labels).length > 0 ? capabilityTags(a.labels).map((c) => (
                      <span key={c} className="rounded border border-brand/20 bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">{c}</span>
                    )) : <span className="text-[11px] text-faint">能力未标注</span>}
                    {labelList(a.labels).filter((l) => !isCapabilityTag(l)).map((l) => (
                      <span key={l} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{l}</span>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-faint">心跳 {timeAgo(a.lastSeenAt)}</span>
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(a)} title="编辑能力与标签"><Pencil size={14} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => rotate(a)} title="轮换 token"><KeyRound size={14} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => toggle(a)} title={a.status === 'disabled' ? '启用' : '禁用'}><Power size={14} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(a)} className="text-danger hover:bg-danger/10" title="删除"><Trash2 size={14} /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="border-t border-line px-5 py-3 text-[11px] leading-5 text-faint">
          agent 每 15 秒上报心跳（以服务端 HelloResp 为准）；超过 45 秒未上报显示离线。标签以服务端登记为准，agent 上报值会被忽略。
        </div>
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? '编辑执行器' : '添加执行器'}
        description={editing ? '调整这台机器愿意接收的任务类型与路由标签。' : '名称是执行器身份；agent 只凭 token 识别，无需在配置里填写名称。'}
        width="max-w-[560px]"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="hidden text-[11px] text-faint sm:block">能力会写入 build=true / deploy=true 标签</span>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => setDrawerOpen(false)}>取消</Button>
              <Button onClick={save} disabled={busy || !name.trim() || (!canBuild && !canDeploy)}>
                {busy ? '保存中…' : editing ? '保存修改' : '创建'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-6">
          <Field label="名称" hint={editing ? '名称是执行器身份，创建后不可修改。' : '例如 overseas-build-1；显示在运行详情，不可重复。'}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="overseas-build-1" disabled={!!editing} />
          </Field>

          <FormSection title="能做什么" description="一台机器可以同时承担构建和部署；实际能否成功还取决于本机工具与网络。">
            <div className="space-y-2">
              <label className={'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ' + (canBuild ? 'border-brand/40 bg-brand/5' : 'border-line bg-surface hover:bg-surface-2/60')}>
                <input type="checkbox" checked={canBuild} onChange={(e) => setCanBuild(e.target.checked)} className="mt-0.5 accent-brand" />
                <span>
                  <span className="block text-xs font-medium text-ink">可以执行构建</span>
                  <span className="mt-0.5 block text-[11px] leading-5 text-muted">pull / build / push；需要 git、docker 或 podman，以及镜像仓库网络。</span>
                </span>
              </label>
              <label className={'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ' + (canDeploy ? 'border-brand/40 bg-brand/5' : 'border-line bg-surface hover:bg-surface-2/60')}>
                <input type="checkbox" checked={canDeploy} onChange={(e) => setCanDeploy(e.target.checked)} className="mt-0.5 accent-brand" />
                <span>
                  <span className="block text-xs font-medium text-ink">可以执行部署</span>
                  <span className="mt-0.5 block text-[11px] leading-5 text-muted">deploy；需要 kubectl，以及目标集群 API 的网络连通性。</span>
                </span>
              </label>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-faint">
              保存后会写入 <code className="font-mono text-[10px]">build=true</code> / <code className="font-mono text-[10px]">deploy=true</code>。
              流水线的构建执行器 selector 填 <code className="font-mono text-[10px]">build=true</code>，部署执行器 selector 填 <code className="font-mono text-[10px]">deploy=true</code>；同一台机器两个都勾选即可两类都接。
              能力是标签约定，最终仍以流水线 selector 匹配为准。
            </p>
          </FormSection>

          <Field label="路由标签（可选）" hint="逗号分隔的 key=value；用于区域、集群等路由条件，例如 region=overseas,cluster=xiaoshan。">
            <Input value={extraTags} onChange={(e) => setExtraTags(e.target.value)} placeholder="region=overseas,cluster=xiaoshan" className="font-mono text-xs" />
          </Field>

          <div className="rounded-md border border-line bg-surface-2/60 px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">保存后的标签</div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {composedLabels().length > 0 ? composedLabels().map((l) => (
                <span key={l} className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">{l}</span>
              )) : <span className="text-[11px] text-faint">至少选择一种能力</span>}
            </div>
          </div>

          {!editing && (
            <FormSection title="接入步骤" description="创建后复制一次性 token，在目标机器上启动 agent。">
              <ol className="space-y-2 text-[11px] leading-5 text-muted">
                <li className="flex gap-2"><span className="font-mono text-faint">01</span><span>在目标机器安装 git、docker（或 podman）与 kubectl；按角色取舍。</span></li>
                <li className="flex gap-2"><span className="font-mono text-faint">02</span><span>把 token 写入 <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">navori-agent.env</code> 的 <code className="font-mono text-[10px]">AGENT_TOKEN</code>。</span></li>
                <li className="flex gap-2"><span className="font-mono text-faint">03</span><span>启动 agent；它只主动出站访问服务端，不读取数据库。</span></li>
              </ol>
              <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-surface px-3 py-2 font-mono text-[10px] text-ink">./navori-agent -config navori-agent.env</pre>
            </FormSection>
          )}
        </div>
      </Drawer>

      <Drawer
        open={!!tokenInfo}
        onClose={() => setTokenInfo(null)}
        title="执行器 token"
        description="只显示这一次，关闭后无法再次查看。"
        width="max-w-[560px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={copyToken}>复制 token</Button>
            <Button onClick={() => setTokenInfo(null)}>我已保存</Button>
          </div>
        }
      >
        <div className="space-y-5">
          <p className="text-xs leading-6 text-muted">
            这是 <span className="font-medium text-ink">{tokenInfo?.name}</span> 的 token。
            请立即写入目标机器的 <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">navori-agent.env</code>，
            并妥善保管；泄露后请立即轮换。
          </p>
          <div className="break-all rounded-md border border-line bg-surface-2 p-3 font-mono text-xs leading-5 text-ink">
            {tokenInfo?.token}
          </div>
          <div className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] leading-5 text-warning">
            轮换 token 会立即让旧 token 失效；正在运行的 agent 会在下一次请求时掉线。
          </div>
        </div>
      </Drawer>

      <Toast toast={toast} />
    </div>
  )
}
