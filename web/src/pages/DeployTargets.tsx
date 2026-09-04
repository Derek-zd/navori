import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus, Plug, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { DeployTarget } from '../lib/types'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Toast, useToast } from '../components/ui'

type TestStatus = 'success' | 'error'

export default function DeployTargets() {
  const [dts, setDts] = useState<DeployTarget[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<DeployTarget | null>(null)
  const [name, setName] = useState('')
  const [kubeconfig, setKubeconfig] = useState('')
  const [busy, setBusy] = useState(false)
  const [testResults, setTestResults] = useState<Record<number, TestStatus>>({})
  const { toast, setToast } = useToast()

  async function load() {
    const rs = await api<DeployTarget[]>('/api/deploy-targets')
    setDts(rs)
    const initial: Record<number, TestStatus> = {}
    for (const t of rs) {
      if (t.lastTestStatus === 'success' || t.lastTestStatus === 'error') {
        initial[t.id] = t.lastTestStatus
      }
    }
    setTestResults(initial)
  }
  useEffect(() => {
    load().catch(() => {})
  }, [])

  function resetForm() {
    setName('')
    setKubeconfig('')
  }

  function openCreate() {
    resetForm()
    setEditing(null)
    setShowModal(true)
  }

  function openEdit(t: DeployTarget) {
    setEditing(t)
    setName(t.name)
    setKubeconfig('')
    setShowModal(true)
  }

  async function save() {
    setBusy(true)
    try {
      const body: Record<string, unknown> = { name }
      if (kubeconfig) body.kubeconfig = kubeconfig
      if (editing) {
        await api('/api/deploy-targets/' + editing.id, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        setToast({ type: 'success', text: '部署目标已更新' })
      } else {
        await api('/api/deploy-targets', {
          method: 'POST',
          body: JSON.stringify({ ...body, kubeconfig }),
        })
        setToast({ type: 'success', text: '部署目标已添加' })
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
    if (!confirm('确认删除该部署目标？')) return
    try {
      await api('/api/deploy-targets/' + id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  async function test(id: number) {
    try {
      await api('/api/deploy-targets/' + id + '/test', { method: 'POST' })
      setTestResults((prev) => ({ ...prev, [id]: 'success' }))
      setToast({ type: 'success', text: '连通正常' })
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [id]: 'error' }))
      setToast({ type: 'error', text: e instanceof Error ? e.message : '连接失败' })
    }
  }

  const testBadge = (id: number) => {
    const s = testResults[id]
    if (s === 'success') return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />正常</span>
    if (s === 'error') return <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />失败</span>
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" />未测</span>
  }

  return (
    <div>
      <PageHeader
        title="部署环境"
        description="目标 Kubernetes 集群（kubeconfig），命名空间在流水线级配置"
        action={
          <Button onClick={openCreate}>
            <Plus size={16} />
            添加部署目标
          </Button>
        }
      />
      <Card>
        {dts.length === 0 ? (
          <EmptyState
            title="还没有部署环境"
            description="添加 Kubernetes 集群并粘贴 kubeconfig，流水线部署时会用它更新 workload。"
            action={<Button onClick={openCreate}><Plus size={16} />添加部署环境</Button>}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">kubeconfig</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">最近部署</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {dts.map((t) => (
                <tr key={t.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900">{t.name}</td>
                  <td className="px-4 py-3 text-slate-600">{t.type}</td>
                  <td className="px-4 py-3 text-slate-500">{t.kubeconfigSet ? '已设置' : '未设置'}</td>
                  <td className="px-4 py-3">{testBadge(t.id)}</td>
                  <td className="px-4 py-3">
                    {t.lastDeploy ? (
                      <div className="text-xs">
                        <div className="font-mono text-slate-600">{t.lastDeploy.imageTag}</div>
                        <div className="mt-0.5 text-slate-400">{t.lastDeploy.finishedAt ? new Date(t.lastDeploy.finishedAt).toLocaleString() : ''}</div>
                      </div>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Link to={'/deploy-targets/' + t.id} className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100">详情</Link>
                      <Button variant="ghost" onClick={() => test(t.id)}>
                        <Plug size={15} />
                        测试
                      </Button>
                      <Button variant="ghost" onClick={() => openEdit(t)}>
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" onClick={() => remove(t.id)} className="text-red-600 hover:bg-red-50">
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? '编辑部署目标' : '添加部署目标'}>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">名称</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 production" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">kubeconfig</label>
            <textarea
              value={kubeconfig}
              onChange={(e) => setKubeconfig(e.target.value)}
              placeholder={editing ? '留空不修改，粘贴新内容则替换' : '粘贴 kubeconfig 内容…'}
              className="min-h-32 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
            <Button onClick={save} disabled={busy || !name || (!editing && !kubeconfig)}>
              {busy ? '保存中…' : editing ? '保存修改' : '添加'}
            </Button>
          </div>
        </div>
      </Modal>
      <Toast toast={toast} />
    </div>
  )
}
