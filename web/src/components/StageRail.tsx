import { Box, CheckCircle2, GitBranch, Rocket, Upload } from 'lucide-react'
import { Status } from './ui'

export interface Stage {
  key: string
  label: string
  status: string
  note?: string
}

const ICONS: Record<string, typeof GitBranch> = {
  pull: GitBranch,
  build: Box,
  push: Upload,
  approve: CheckCircle2,
  deploy: Rocket,
}

function nodeClass(status: string) {
  if (status === 'success' || status === 'done') return 'border-brand bg-brand text-on-brand'
  if (status === 'running' || status === 'awaiting_approval') return 'border-copper bg-copper/10 text-copper'
  if (status === 'failed' || status === 'rejected' || status === 'error') return 'border-danger bg-danger/10 text-danger'
  return 'border-line-strong bg-surface text-faint'
}

function lineClass(status: string) {
  if (status === 'success' || status === 'done') return 'bg-brand/50'
  if (status === 'running' || status === 'awaiting_approval') return 'bg-copper/40'
  return 'bg-line'
}

export function StageRail({ stages }: { stages: Stage[] }) {
  return (
    <>
    <div className="hidden w-full overflow-x-auto md:block">
      <div className="grid min-w-[640px] grid-cols-5 px-2 py-3">
        {stages.map((stage, i) => {
          const Icon = ICONS[stage.key] || Box
          return (
            <div key={stage.key} className="relative flex flex-col items-center text-center">
              {i < stages.length - 1 ? (
                <div className={'absolute left-1/2 top-4 h-px w-full ' + lineClass(stage.status)} />
              ) : null}
              <div className={'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border ' + nodeClass(stage.status)}>
                <Icon size={14} />
              </div>
              <div className="mt-3 text-xs font-medium text-ink">{stage.label}</div>
              <div className="mt-1"><Status value={stage.status} /></div>
              <div className="mt-1.5 max-w-[120px] truncate font-mono text-[10px] text-faint" title={stage.note || ''}>
                {stage.note || '\u00a0'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
    <div className="px-5 py-3 md:hidden">
      {stages.map((stage, i) => {
        const Icon = ICONS[stage.key] || Box
        return (
          <div key={stage.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ' + nodeClass(stage.status)}>
                <Icon size={13} />
              </div>
              {i < stages.length - 1 ? <div className={'w-px flex-1 ' + lineClass(stage.status)} /> : null}
            </div>
            <div className={'min-w-0 flex-1 ' + (i < stages.length - 1 ? 'pb-4' : '')}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-ink">{stage.label}</span>
                <Status value={stage.status} />
              </div>
              {stage.note ? <div className="mt-1 truncate font-mono text-[10px] text-faint" title={stage.note}>{stage.note}</div> : null}
            </div>
          </div>
        )
      })}
    </div>
    </>
  )
}
