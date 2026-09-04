import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Square } from 'lucide-react'
import { api } from '../lib/api'
import type { Pipeline, Repository, Run } from '../lib/types'
import { Button, Card, EmptyState, PageHeader, Status, Toast, useToast } from '../components/ui'

export default function PipelinesDetail() {
  const { id } = useParams()
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)
  const [repo, setRepo] = useState<Repository | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const { toast, setToast } = useToast()

  useEffect(() => {
    if (!id) return
    Promise.all([
      api<Pipeline>('/api/pipelines/' + id),
      api<Run[]>('/api/runs?pipelineId=' + id),
    ])
      .then(async ([p, rs]) => {
        setPipeline(p)
        setRuns(rs)
        if (p.repoId) {
          try {
            setRepo(await api<Repository>('/api/repositories/' + p.repoId))
          } catch {
            setRepo(null)
          }
        }
      })
      .catch(() => {})
  }, [id])

  async function cancelRun(runId: number) {
    try {
      await api('/api/runs/' + runId + '/stop', { method: 'POST' })
      setToast({ type: 'success', text: '已请求取消' })
      const rs = await api<Run[]>('/api/runs?pipelineId=' + id)
      setRuns(rs)
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '取消失败' })
    }
  }

  function isActive(r: Run) {
    return r.status === 'running' || r.status === 'pending' || r.status === 'awaiting_approval'
  }

  if (!pipeline) {
    return <p className="text-slate-500">加载中…</p>
  }

  return (
    <div>
      <div className="mb-4">
        <Link to="/pipelines" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={15} />
          返回流水线
        </Link>
      </div>
      <PageHeader
        title={'流水线 #' + pipeline.id}
        description={repo ? repo.name + ' · ' + (repo.gitUrl || '') : '仓库 #' + pipeline.repoId}
      />
      <Card>
        {runs.length === 0 ? (
          <EmptyState title="还没有运行记录" description="点击流水线列表中的「运行」触发第一次构建。" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">编号</th>
                <th className="px-4 py-3">触发</th>
                <th className="px-4 py-3">分支</th>
                <th className="px-4 py-3">commit</th>
                <th className="px-4 py-3">镜像</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900">#{r.number}</td>
                  <td className="px-4 py-3 text-slate-600">{r.triggerType}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.ref}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.commitShort}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.imageTag || '—'}</td>
                  <td className="px-4 py-3"><Status value={r.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {isActive(r) ? (
                        <Button variant="danger" size="sm" onClick={() => cancelRun(r.id)}>
                          <Square size={13} />
                          取消
                        </Button>
                      ) : null}
                      <Link to={'/runs/' + r.id} className="text-sm text-indigo-600 hover:underline">查看详情</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Toast toast={toast} />
    </div>
  )
}
