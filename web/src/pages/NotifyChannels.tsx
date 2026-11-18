import { useEffect, useState } from 'react'
import { Bell, Mail, MessageCircle, Pencil, Plus, RefreshCw, Send, Trash2, Webhook } from 'lucide-react'
import { api } from '../lib/api'
import type { NotifyChannel } from '../lib/types'
import { Button, Card, Drawer, EmptyState, Field, FormSection, Input, PageHeader, Select, Toast, useToast } from '../components/ui'

const TYPES = [
  { value: 'rest', label: '通用 REST API', hint: 'POST JSON + 可选 HMAC' },
  { value: 'email', label: '邮件（SMTP）', hint: '收件人由通道配置' },
  { value: 'feishu', label: '飞书机器人', hint: '群机器人 webhook' },
  { value: 'dingtalk', label: '钉钉机器人', hint: '群机器人 webhook' },
  { value: 'wecom', label: '企业微信机器人', hint: '群机器人 webhook' },
]

function TypeIcon({ type, size = 14 }: { type: string; size?: number }) {
  if (type === 'email') return <Mail size={size} />
  if (type === 'rest') return <Webhook size={size} />
  return <MessageCircle size={size} />
}

export default function NotifyChannels() {
  const [channels, setChannels] = useState<NotifyChannel[]>([])
  const [showDrawer, setShowDrawer] = useState(false)
  const [editing, setEditing] = useState<NotifyChannel | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('rest')
  const [cfg, setCfg] = useState<Record<string, string>>({})
  const { toast, setToast } = useToast()

  const chat = channels.filter((c) => ['feishu', 'dingtalk', 'wecom'].includes(c.type)).length
  const mail = channels.filter((c) => c.type === 'email').length

  async function load() {
    setChannels(await api<NotifyChannel[]>('/api/notify-channels'))
  }

  async function refresh() {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { load().catch(() => {}) }, [])

  function reset() {
    setName('')
    setType('rest')
    setCfg({})
  }

  function openCreate() {
    reset()
    setEditing(null)
    setShowDrawer(true)
  }

  function openEdit(c: NotifyChannel) {
    setEditing(c)
    setName(c.name)
    setType(c.type)
    setCfg(typeof c.config === 'object' && c.config ? c.config : {})
    setShowDrawer(true)
  }

  function setField(key: string, val: string) {
    setCfg((prev) => ({ ...prev, [key]: val }))
  }

  async function save() {
    setBusy(true)
    try {
      const body = { name, type, config: cfg }
      if (editing) {
        await api('/api/notify-channels/' + editing.id, { method: 'PATCH', body: JSON.stringify(body) })
        setToast({ type: 'success', text: '通道已更新' })
      } else {
        await api('/api/notify-channels', { method: 'POST', body: JSON.stringify(body) })
        setToast({ type: 'success', text: '通道已添加' })
      }
      setShowDrawer(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(c: NotifyChannel) {
    if (!confirm('确认删除通知通道「' + c.name + '」？')) return
    try {
      await api('/api/notify-channels/' + c.id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  const typeLabel = (t: string) => TYPES.find((x) => x.value === t)?.label || t
  const typeHint = (t: string) => TYPES.find((x) => x.value === t)?.hint || ''
  const configSummary = (c: NotifyChannel) => {
    if (c.type === 'email') return c.config?.to || '未配置收件人'
    if (c.type === 'rest') return c.config?.url || '未配置 URL'
    return c.config?.webhook ? '已配置机器人 webhook' : '未配置 webhook'
  }

  return (
    <div>
      <PageHeader
        eyebrow="资源"
        title="通知通道"
        description="可复用的通知目的地（REST / 邮件 / IM）；流水线里选择通道与触发事件。"
        action={
          <>
            <Button variant="secondary" onClick={refresh} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              刷新
            </Button>
            <Button onClick={openCreate}>
              <Plus size={15} />
              添加通道
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {[
          { label: '通道总数', value: channels.length, note: '可供流水线选择' },
          { label: '即时消息', value: chat, note: '飞书 / 钉钉 / 企微' },
          { label: '邮件与 REST', value: mail + channels.filter((c) => c.type === 'rest').length, note: '邮件 / REST' },
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
        {channels.length === 0 ? (
          <EmptyState
            icon={<Bell size={32} />}
            title="还没有通知通道"
            description="添加一个 REST / 邮件 / 飞书 / 钉钉 / 企微通道，供流水线通知使用。"
            action={<Button onClick={openCreate}><Plus size={15} />添加通道</Button>}
          />
        ) : (
          <>
            <div className="hidden w-full overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                    <th className="px-5 py-3 font-medium">通道</th>
                    <th className="px-5 py-3 font-medium">类型</th>
                    <th className="px-5 py-3 font-medium">配置</th>
                    <th className="px-5 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((c) => (
                    <tr key={c.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface-2 text-muted">
                            <TypeIcon type={c.type} />
                          </span>
                          <div>
                            <div className="text-xs font-medium text-ink">{c.name}</div>
                            <div className="mt-0.5 text-[10px] text-faint">#{c.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-[11px] text-ink">{typeLabel(c.type)}</div>
                        <div className="mt-0.5 text-[10px] text-faint">{typeHint(c.type)}</div>
                      </td>
                      <td className="max-w-[320px] truncate px-5 py-3 font-mono text-[10px] text-muted">{configSummary(c)}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(c)} title="编辑"><Pencil size={14} /></Button>
                          <Button variant="ghost" size="sm" onClick={() => remove(c)} className="text-danger hover:bg-danger/10" title="删除"><Trash2 size={14} /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-line md:hidden">
              {channels.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-muted">
                      <TypeIcon type={c.type} size={13} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-ink">{c.name}</div>
                      <div className="mt-0.5 text-[10px] text-faint">{typeLabel(c.type)} · {configSummary(c)}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(c)} className="text-danger"><Trash2 size={14} /></Button>
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
        title={editing ? '编辑通知通道' : '添加通知通道'}
        description="通道只保存目标配置；触发事件在流水线里选择。"
        width="max-w-[600px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowDrawer(false)}>取消</Button>
            <Button onClick={save} disabled={busy || !name || !type}>
              {busy ? '保存中…' : editing ? '保存修改' : '添加通道'}
            </Button>
          </div>
        }
      >
        <div className="space-y-7">
          <FormSection title="通道">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="名称">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 部署通知" />
              </Field>
              <Field label="类型" hint={typeHint(type)}>
                <Select value={type} onChange={(e) => setType(e.target.value)}>
                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
            </div>
          </FormSection>

          <FormSection title="目标" description="按通道类型填写；密钥会加密保存。">
            {type === 'rest' ? (
              <div className="space-y-4">
                <Field label="Webhook URL">
                  <Input value={cfg.url || ''} onChange={(e) => setField('url', e.target.value)} placeholder="https://…" />
                </Field>
                <Field label="Secret" hint="可选；填写后使用 HMAC 签名请求。">
                  <Input type="password" value={cfg.secret || ''} onChange={(e) => setField('secret', e.target.value)} placeholder={editing && cfg.secret === 'already-set' ? '留空不修改' : '留空则不签名'} />
                </Field>
              </div>
            ) : type === 'email' ? (
              <div className="space-y-4">
                <Field label="收件人" hint="多个地址用逗号分隔；SMTP 发件配置在「设置」中。">
                  <Input value={cfg.to || ''} onChange={(e) => setField('to', e.target.value)} placeholder="a@x.com,b@x.com" />
                </Field>
                <div className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[10px] leading-5 text-faint">
                  邮件通道依赖系统设置里的 SMTP 主机、账号与发件人。
                </div>
              </div>
            ) : (
              <Field label="机器人 Webhook" hint="飞书 / 钉钉 / 企业微信群的机器人地址。">
                <Input value={cfg.webhook || ''} onChange={(e) => setField('webhook', e.target.value)} placeholder="机器人 webhook 地址" />
              </Field>
            )}
          </FormSection>

          <div className="flex items-start gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-[10px] leading-5 text-faint">
            <Send size={12} className="mt-0.5 shrink-0" />
            通知在运行进入终态后发送；失败不会影响运行结果。
          </div>
        </div>
      </Drawer>
      <Toast toast={toast} />
    </div>
  )
}
