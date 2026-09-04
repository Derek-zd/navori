import { useEffect, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { X } from 'lucide-react'

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
  const sizes: Record<string, string> = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-3.5 py-2 text-sm',
  }
  const variants: Record<string, string> = {
    primary: 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-500',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-red-600 text-white shadow-sm hover:bg-red-500',
  }
  return <button className={base + ' ' + sizes[size] + ' ' + variants[variant] + ' ' + className} {...props} />
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={
        'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ' + className
      }
      {...props}
    />
  )
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={
        'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ' + className
      }
      {...props}
    />
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={'rounded-xl border border-slate-200 bg-white shadow-sm ' + className}>{children}</div>
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  success: { label: '成功', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500' },
  done: { label: '完成', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500' },
  healthy: { label: '健康', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500' },
  failed: { label: '失败', cls: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-500' },
  error: { label: '失败', cls: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-500' },
  rejected: { label: '已拒绝', cls: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-500' },
  degraded: { label: '降级', cls: 'bg-amber-50 text-amber-700 ring-amber-600/20', dot: 'bg-amber-500' },
  running: { label: '运行中', cls: 'bg-blue-50 text-blue-700 ring-blue-600/20', dot: 'bg-blue-500 animate-pulse' },
  scanning: { label: '扫描中', cls: 'bg-blue-50 text-blue-700 ring-blue-600/20', dot: 'bg-blue-500 animate-pulse' },
  pending: { label: '等待中', cls: 'bg-slate-100 text-slate-600 ring-slate-500/20', dot: 'bg-slate-400' },
  waiting: { label: '等待', cls: 'bg-slate-100 text-slate-600 ring-slate-500/20', dot: 'bg-slate-400' },
  queued: { label: '排队中', cls: 'bg-slate-100 text-slate-600 ring-slate-500/20', dot: 'bg-slate-400' },
  skipped: { label: '跳过', cls: 'bg-slate-100 text-slate-600 ring-slate-500/20', dot: 'bg-slate-400' },
  cancelled: { label: '已取消', cls: 'bg-slate-100 text-slate-600 ring-slate-500/20', dot: 'bg-slate-400' },
  awaiting_approval: { label: '待审批', cls: 'bg-amber-50 text-amber-700 ring-amber-600/20', dot: 'bg-amber-500' },
}

export function Status({ value }: { value: string }) {
  const s = STATUS[value] || { label: value, cls: 'bg-slate-100 text-slate-600 ring-slate-500/20', dot: 'bg-slate-400' }
  return (
    <span className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ' + s.cls}>
      <span className={'h-1.5 w-1.5 rounded-full ' + s.dot} />
      {s.label}
    </span>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  width = 'max-w-lg',
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  width?: string
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className={'relative w-full ' + width + ' rounded-xl bg-white p-6 shadow-2xl'}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export interface ToastMsg {
  type: 'success' | 'error'
  text: string
}

export function useToast() {
  const [toast, setToast] = useState<ToastMsg | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])
  return { toast, setToast }
}

export function Toast({ toast }: { toast: ToastMsg | null }) {
  if (!toast) return null
  const cls = toast.type === 'success'
    ? 'bg-emerald-600 text-white'
    : 'bg-red-600 text-white'
  return (
    <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2">
      <div className={'rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ' + cls}>
        {toast.text}
      </div>
    </div>
  )
}


export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon ? <div className="mb-3 text-slate-300">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  icon,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'success' | 'danger' | 'warning' | 'info'
  icon?: ReactNode
}) {
  const tones: Record<string, string> = {
    default: 'text-slate-900',
    success: 'text-emerald-600',
    danger: 'text-red-600',
    warning: 'text-amber-600',
    info: 'text-blue-600',
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
        {icon ? <div className="text-slate-300">{icon}</div> : null}
      </div>
      <div className={'mt-2 text-2xl font-semibold ' + (tones[tone] || tones.default)}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  )
}
