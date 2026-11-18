import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, KeyRound, Plus } from 'lucide-react'
import { api } from '../lib/api'
import type { Credential } from '../lib/types'
import { Button, Drawer, Field, Input, Select, Toast, useToast } from './ui'

const TYPE_LABELS: Record<string, string> = {
  https: 'Git HTTPS',
  ssh: 'Git SSH',
  registry: '镜像仓库',
}

export function CredentialSelect({
  value,
  onChange,
  credentials,
  onCreated,
  filter,
  allowedTypes,
  emptyLabel = '不使用凭证（公开仓库）',
}: {
  value: number
  onChange: (id: number) => void
  credentials: Credential[]
  onCreated?: (cred: Credential) => void
  filter: (c: Credential) => boolean
  allowedTypes?: string[]
  emptyLabel?: string
}) {
  const { toast, setToast } = useToast()
  const [open, setOpen] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState((allowedTypes && allowedTypes[0]) || 'https')
  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const creds = credentials.filter(filter)
  const types = allowedTypes || ['https', 'ssh', 'registry']
  const current = creds.find((c) => c.id === value)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  function reset() {
    setName('')
    setUsername('')
    setSecret('')
    setType(types[0])
  }

  function openNew() {
    reset()
    setOpen(false)
    setShowDrawer(true)
  }

  async function create() {
    setBusy(true)
    try {
      const cred = await api<Credential>('/api/credentials', {
        method: 'POST',
        body: JSON.stringify({ name, type, username, secret }),
      })
      onCreated?.(cred)
      onChange(cred.id)
      setShowDrawer(false)
      setToast({ type: 'success', text: '凭证已添加' })
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '添加失败' })
    } finally {
      setBusy(false)
    }
  }

  const label = current ? current.name + '（' + (TYPE_LABELS[current.type] || current.type) + '）' : emptyLabel

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink transition-colors hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
        >
          <span className="flex min-w-0 items-center gap-2">
            <KeyRound size={14} className="shrink-0 text-faint" />
            <span className={current ? 'truncate' : 'truncate text-faint'}>{label}</span>
          </span>
          <ChevronDown size={15} className="shrink-0 text-faint" />
        </button>
        {open ? (
          <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-surface py-1 shadow-overlay">
            <button
              type="button"
              onClick={() => { onChange(0); setOpen(false) }}
              className={'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 ' + (value === 0 ? 'text-brand' : 'text-ink')}
            >
              {emptyLabel}
              {value === 0 ? <Check size={15} /> : null}
            </button>
            {creds.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.id); setOpen(false) }}
                className={'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 ' + (value === c.id ? 'text-brand' : 'text-ink')}
              >
                <span className="min-w-0 truncate">
                  {c.name}
                  <span className="ml-1.5 text-[10px] text-faint">{TYPE_LABELS[c.type] || c.type}</span>
                </span>
                {value === c.id ? <Check size={15} className="shrink-0" /> : null}
              </button>
            ))}
            <div className="my-1 border-t border-line" />
            <button
              type="button"
              onClick={openNew}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-brand transition-colors hover:bg-brand/5"
            >
              <Plus size={14} />
              新建凭证…
            </button>
          </div>
        ) : null}
      </div>

      <Drawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        title="新建凭证"
        description="凭证加密保存，创建后 API 不会回显密码或私钥。"
        width="max-w-[520px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowDrawer(false)}>取消</Button>
            <Button onClick={create} disabled={busy || !name.trim() || !secret}>
              {busy ? '添加中…' : '添加凭证'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="名称" hint="用于在流水线和资源里辨认，例如 github-token。">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 github-token" />
          </Field>
          <Field label="类型">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>
              ))}
            </Select>
          </Field>
          <Field label="用户名" hint="可选；Git SSH 可留空，镜像仓库通常填账号。">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="可选" />
          </Field>
          <Field label="Secret / 密码 / 私钥" hint="加密写入数据库，之后只显示是否已设置。">
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Token、密码或私钥内容" />
          </Field>
        </div>
      </Drawer>
      <Toast toast={toast} />
    </>
  )
}
