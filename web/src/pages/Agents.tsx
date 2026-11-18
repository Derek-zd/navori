import { useEffect, useState } from 'react'
import { Cpu, KeyRound, Plus, Power, RefreshCw, Server, Trash2 } from 'lucide-react'
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
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [labels, setLabels] = useState('')
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
    setName('')
    setLabels('')
    setShowCreate(true)
  }

  async function create() {
    setBusy(true)
    try {
      const res = await api<{ agent: Agent; token: string }>('/api/agents', {
        method: 'POST',
        body: JSON.stringify({ name, labels }),
      })
      setShowCreate(false)
      setTokenInfo({ name: res.agent.name, token: res.token })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '创建失败' })
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
                    <th className="px-5 py-3 font-medium">标签</th>
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
                      <td className="max-w-[260px] px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {labelList(a.labels).length > 0 ? labelList(a.labels).map((l) => (
                            <span key={l} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{l}</span>
                          )) : <span className="text-[11px] text-faint">未设置标签</span>}
                        </div>
                      </td>
                      <td className="hidden px-5 py-3 font-mono text-[10px] text-faint xl:table-cell">{a.version || '—'} / p{a.protocol}</td>
                      <td className="px-5 py-3">
                        <div className="text-[11px] text-ink" title={formatDateTime(a.lastSeenAt)}>{timeAgo(a.lastSeenAt)}</div>
                        <div className="mt-0.5 hidden text-[10px] text-faint sm:block">{a.lastSeenAt ? formatDateTime(a.lastSeenAt) : '从未上线'}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-0.5">
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
                  <div className="mt-3 flex flex-wrap gap-1">
                    {labelList(a.labels).length > 0 ? labelList(a.labels).map((l) => (
                      <span key={l} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{l}</span>
                    )) : <span className="text-[11px] text-faint">未设置标签</span>}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-faint">心跳 {timeAgo(a.lastSeenAt)}</span>
                    <div className="flex gap-0.5">
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
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="添加执行器"
        description="名称必须与目标机器上的 AGENT_NAME 完全一致。"
        width="max-w-[520px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>取消</Button>
            <Button onClick={create} disabled={busy || !name.trim()}>{busy ? '创建中…' : '创建'}</Button>
          </div>
        }
      >
        <div className="space-y-5">
          <Field label="名称" hint="例如 overseas-build-1；用于 hello 校验，不可重复。">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="overseas-build-1" />
          </Field>
          <Field label="标签" hint="逗号分隔的 key=value。流水线用 selector 按标签选择执行器，例如 role=build,region=overseas。">
            <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="role=build,region=overseas" className="font-mono text-xs" />
          </Field>
          <FormSection title="接入步骤" description="创建后复制一次性 token，在目标机器上启动 agent。">
            <ol className="space-y-2 text-[11px] leading-5 text-muted">
              <li className="flex gap-2"><span className="font-mono text-faint">01</span><span>在目标机器安装 git、docker（或 podman）与 kubectl。</span></li>
              <li className="flex gap-2"><span className="font-mono text-faint">02</span><span>把 token 写入 <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">navori-agent.env</code> 的 <code className="font-mono text-[10px]">AGENT_TOKEN</code>。</span></li>
              <li className="flex gap-2"><span className="font-mono text-faint">03</span><span>启动 agent；它只主动出站访问服务端，不读取数据库。</span></li>
            </ol>
            <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-surface px-3 py-2 font-mono text-[10px] text-ink">./navori-agent -config navori-agent.env</pre>
          </FormSection>
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
