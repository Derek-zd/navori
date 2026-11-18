import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, KeyRound, Plug, RefreshCw, Server } from 'lucide-react'
import { api } from '../lib/api'
import type { DeployTarget, Run } from '../lib/types'
import { Button, Card, EmptyState, PageHeader, Status, Toast, useToast } from '../components/ui'
import { formatDateTime, timeAgo } from '../lib/format'

export default function DeployTargetDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [dt, setDt] = useState<DeployTarget | null>(null)
  const [history, setHistory] = useState<Run[]>([])
  const [testing, setTesting] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'success' | 'error'>('idle')
  const { toast, setToast } = useToast()

  async function load() {
    if (!id) return
    const [d, h] = await Promise.all([
      api<DeployTarget>('/api/deploy-targets/' + id),
      api<Run[]>('/api/deploy-targets/' + id + '/history'),
    ])
    setDt(d)
    setHistory(h)
    if (d.lastTestStatus === 'success' || d.lastTestStatus === 'error') setTestState(d.lastTestStatus)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function test() {
    setTesting(true)
    try {
      await api('/api/deploy-targets/' + id + '/test', { method: 'POST' })
      setTestState('success')
      setToast({ type: 'success', text: '连通正常' })
    } catch (e) {
      setTestState('error')
      setToast({ type: 'error', text: e instanceof Error ? e.message : '连接失败' })
    } finally {
      setTesting(false)
    }
  }

  if (!dt) return <p className="text-sm text-muted">加载中…</p>

  const typeLabel = (t: string) => (t === 'k8s' ? 'Kubernetes' : t)
  const last = history[0]

  return (
    <div>
      <div className="mb-4">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/deploy-targets'))}
          className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} />
          返回部署环境
        </button>
      </div>

      <PageHeader
        eyebrow="部署环境"
        title={dt.name}
        description={typeLabel(dt.type || 'k8s') + ' · 默认命名空间 ' + (dt.defaultNamespace || 'default')}
        action={
          <>
            <Button variant="secondary" onClick={() => load().catch(() => {})}>
              <RefreshCw size={15} />
              刷新
            </Button>
            <Button onClick={test} disabled={testing || !dt.kubeconfigSet}>
              <Plug size={15} />
              {testing ? '测试中…' : '测试连接'}
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
        {[
          { label: '类型', value: typeLabel(dt.type || 'k8s'), mono: false },
          { label: '默认命名空间', value: dt.defaultNamespace || 'default', mono: true },
          { label: 'kubeconfig', value: dt.kubeconfigSet ? '已设置' : '未设置', mono: false, danger: !dt.kubeconfigSet },
          { label: '最近部署', value: last ? '#' + last.number : '—', mono: false, note: last ? timeAgo(last.finishedAt) : '暂无记录' },
        ].map((s) => (
          <div key={s.label} className="bg-surface px-4 py-3.5 sm:px-5">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">{s.label}</div>
            <div className={'mt-1.5 truncate text-sm font-semibold ' + (s.danger ? 'text-danger' : s.mono ? 'font-mono text-xs text-ink' : 'text-ink')}>{s.value}</div>
            {s.note ? <div className="mt-0.5 text-[10px] text-faint">{s.note}</div> : null}
          </div>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <KeyRound size={13} className="text-faint" />
          kubeconfig {dt.kubeconfigSet ? '已加密保存' : '尚未设置'}
        </span>
        <span className="h-3 w-px bg-line" />
        <span className="inline-flex items-center gap-1.5">
          <Server size={13} className="text-faint" />
          最近测试 {dt.lastTestAt ? formatDateTime(dt.lastTestAt) : '从未测试'}
        </span>
        <span className="h-3 w-px bg-line" />
        <span className="inline-flex items-center gap-1.5">
          连接
          {testState === 'success' ? <span className="text-ink">正常</span> : testState === 'error' ? <span className="text-danger">失败</span> : <span className="text-faint">未测试</span>}
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">部署历史</h2>
            <p className="mt-0.5 text-[10px] text-faint">该环境最近的部署运行，点击查看完整日志。</p>
          </div>
          <span className="text-[10px] text-faint">{history.length} 条</span>
        </div>
        {history.length === 0 ? (
          <EmptyState title="暂无部署记录" description="该环境下还没有部署过，先跑一条带部署的流水线。" />
        ) : (
          <>
            <div className="hidden w-full overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                    <th className="px-5 py-3 font-medium">运行</th>
                    <th className="px-5 py-3 font-medium">状态</th>
                    <th className="px-5 py-3 font-medium">分支 / commit</th>
                    <th className="px-5 py-3 font-medium">镜像</th>
                    <th className="px-5 py-3 font-medium">时间</th>
                    <th className="px-5 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((r) => (
                    <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                      <td className="px-5 py-3">
                        <Link to={'/runs/' + r.id} className="text-xs font-medium text-ink hover:text-brand">#{r.number}</Link>
                        <div className="mt-0.5 text-[10px] text-faint">{r.triggerType}</div>
                      </td>
                      <td className="px-5 py-3"><Status value={r.status} /></td>
                      <td className="px-5 py-3">
                        <div className="max-w-[220px] truncate font-mono text-[10px] text-ink">{r.ref}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-faint">{r.commitShort || '—'}</div>
                      </td>
                      <td className="max-w-[240px] truncate px-5 py-3 font-mono text-[10px] text-muted">{r.imageTag || '—'}</td>
                      <td className="px-5 py-3">
                        <div className="text-[11px] text-ink">{timeAgo(r.finishedAt || r.startedAt)}</div>
                        <div className="mt-0.5 hidden text-[10px] text-faint lg:block">{r.startedAt ? formatDateTime(r.startedAt) : ''}</div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Link to={'/runs/' + r.id} className="text-xs font-medium text-brand hover:underline">查看详情</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-line md:hidden">
              {history.map((r) => (
                <Link key={r.id} to={'/runs/' + r.id} className="block p-4 transition-colors hover:bg-surface-2/60">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-ink">#{r.number} · {r.triggerType}</div>
                    <Status value={r.status} />
                  </div>
                  <div className="mt-2 truncate font-mono text-[10px] text-muted">{r.ref} · {r.commitShort || '—'}</div>
                  <div className="mt-1 truncate font-mono text-[10px] text-faint">{r.imageTag || '—'}</div>
                  <div className="mt-2 text-[10px] text-faint">{timeAgo(r.finishedAt || r.startedAt)}</div>
                </Link>
              ))}
            </div>
          </>
        )}
      </Card>

      <Toast toast={toast} />
    </div>
  )
}
