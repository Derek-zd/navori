import { useEffect, useState } from 'react'
import { Cpu, KeyRound, Plus, Power, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { Agent } from '../lib/types'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Status, Toast, useToast } from '../components/ui'

function fmtTime(value?: string) {
  if (!value) return '—'
  const d = new Date(value)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString()
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
    try {
      await navigator.clipboard.writeText(tokenInfo.token)
      setToast({ type: 'success', text: 'token 已复制' })
    } catch {
      setToast({ type: 'error', text: '复制失败，请手动选择复制' })
    }
  }

  return (
    <div>
      <PageHeader
        title="执行器"
        description="分布式执行 agent：主动轮询任务，按标签领取构建/部署步骤"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={load}>
              <RefreshCw size={16} />
              刷新
            </Button>
            <Button onClick={openCreate}>
              <Plus size={16} />
              添加执行器
            </Button>
          </div>
        }
      />

      <Card>
        {agents.length === 0 ? (
          <EmptyState
            icon={<Cpu size={32} />}
            title="还没有执行器"
            description="创建执行器并把一次性 token 配到目标机器的 navori-agent.env，agent 上线后状态会变为在线。"
            action={<Button onClick={openCreate}><Plus size={16} />添加执行器</Button>}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">标签</th>
                <th className="px-4 py-3">版本</th>
                <th className="px-4 py-3">最后心跳</th>
                <th className="px-4 py-3">主机</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900">{a.name}</td>
                  <td className="px-4 py-3"><Status value={a.status} /></td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{a.labels || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{a.version || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtTime(a.lastSeenAt)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{a.hostname || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" onClick={() => rotate(a)}>
                        <KeyRound size={15} />
                        token
                      </Button>
                      <Button variant="ghost" onClick={() => toggle(a)}>
                        <Power size={15} />
                        {a.status === 'disabled' ? '启用' : '禁用'}
                      </Button>
                      <Button variant="ghost" onClick={() => remove(a)}>
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={showCreate} title="添加执行器" onClose={() => setShowCreate(false)}>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="overseas-build-1"
            />
            <p className="mt-1 text-xs text-slate-500">必须与 agent 配置中的 AGENT_NAME 完全一致。</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">标签</label>
            <Input
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder="role=build,region=overseas"
            />
            <p className="mt-1 text-xs text-slate-500">逗号分隔的 key=value；流水线按标签选择执行器，以这里登记的为准。</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>取消</Button>
            <Button onClick={create} disabled={busy || !name.trim()}>
              {busy ? '创建中…' : '创建'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!tokenInfo} title="执行器 token" onClose={() => setTokenInfo(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            这是 <span className="font-medium text-slate-900">{tokenInfo?.name}</span> 的 token，
            <span className="font-medium text-red-600">只显示这一次</span>。请立即写入目标机器的
            <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">navori-agent.env</code>。
          </p>
          <div className="break-all rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700">
            {tokenInfo?.token}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={copyToken}>复制</Button>
            <Button onClick={() => setTokenInfo(null)}>我已保存</Button>
          </div>
        </div>
      </Modal>

      <Toast toast={toast} />
    </div>
  )
}
