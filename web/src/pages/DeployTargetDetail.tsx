import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { api } from '../lib/api'
import type { DeployTarget, Run } from '../lib/types'
import { Card, EmptyState, PageHeader, Status } from '../components/ui'

export default function DeployTargetDetail() {
  const { id } = useParams()
  const [dt, setDt] = useState<DeployTarget | null>(null)
  const [history, setHistory] = useState<Run[]>([])

  useEffect(() => {
    if (!id) return
    Promise.all([
      api<DeployTarget>('/api/deploy-targets/' + id),
      api<Run[]>('/api/deploy-targets/' + id + '/history'),
    ])
      .then(([d, h]) => { setDt(d); setHistory(h) })
      .catch(() => {})
  }, [id])

  if (!dt) return <p className="text-slate-500">加载中…</p>

  return (
    <div>
      <div className="mb-4">
        <Link to="/deploy-targets" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={15} />
          返回部署环境
        </Link>
      </div>
      <PageHeader
        title={'部署环境 · ' + dt.name}
        description={'类型 ' + dt.type + (dt.kubeconfigSet ? ' · kubeconfig 已设置' : ' · kubeconfig 未设置')}
      />
      <Card>
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">部署历史</div>
        {history.length === 0 ? (
          <EmptyState title="暂无部署记录" description="该环境下还没有部署过，先跑一条带部署的流水线。" />
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
              {history.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900">#{r.number}</td>
                  <td className="px-4 py-3 text-slate-600">{r.triggerType}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.ref}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.commitShort}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.imageTag || '—'}</td>
                  <td className="px-4 py-3"><Status value={r.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link to={"/runs/" + r.id} className="text-sm text-indigo-600 hover:underline">查看详情</Link>
                    </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
