import { lazy, Suspense, useEffect, useState } from 'react'
import { NavLink, Link, Route, Routes, useLocation } from 'react-router-dom'
import {
  Bell,
  Boxes,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Cpu,
  FolderGit2,
  LayoutDashboard,
  LogOut,
  Menu,
  Server,
  Settings,
  Variable,
  Workflow,
  X,
} from 'lucide-react'
import { Dropdown, Menu as ArcoMenu } from '@arco-design/web-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Agent, Run } from '../lib/types'
import Brand from '../components/Brand'
import ThemeMenu from '../components/ThemeMenu'
const Dashboard = lazy(() => import('./Dashboard'))
const Repositories = lazy(() => import('./Repositories'))
const Pipelines = lazy(() => import('./Pipelines'))
const PipelinesDetail = lazy(() => import('./PipelinesDetail'))
const Registries = lazy(() => import('./Registries'))
const DeployTargets = lazy(() => import('./DeployTargets'))
const DeployTargetDetail = lazy(() => import('./DeployTargetDetail'))
const Approvals = lazy(() => import('./Approvals'))
const Variables = lazy(() => import('./Variables'))
const NotifyChannels = lazy(() => import('./NotifyChannels'))
const SettingsPage = lazy(() => import('./Settings'))
const RunDetail = lazy(() => import('./RunDetail'))
const Agents = lazy(() => import('./Agents'))

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted">
      加载中…
    </div>
  )
}

type NavItemDef = { to: string; label: string; icon: typeof LayoutDashboard; admin?: boolean }

const operationsNav: NavItemDef[] = [
  { to: '/', label: '运行总览', icon: LayoutDashboard },
  { to: '/pipelines', label: '流水线', icon: Workflow },
  { to: '/approvals', label: '审批中心', icon: ClipboardCheck },
]

const resourceNav: NavItemDef[] = [
  { to: '/repositories', label: '代码仓库', icon: FolderGit2 },
  { to: '/registries', label: '镜像仓库', icon: Boxes },
  { to: '/deploy-targets', label: '部署环境', icon: Server },
  { to: '/variables', label: '环境变量', icon: Variable },
  { to: '/notify-channels', label: '通知通道', icon: Bell },
  { to: '/agents', label: '执行器', icon: Cpu, admin: true },
]

const pageTitles: Record<string, string> = {
  '/': '运行总览',
  '/pipelines': '流水线',
  '/approvals': '审批中心',
  '/repositories': '代码仓库',
  '/registries': '镜像仓库',
  '/deploy-targets': '部署环境',
  '/variables': '环境变量',
  '/notify-channels': '通知通道',
  '/agents': '执行器',
  '/settings': '设置',
  '/runs': '运行详情',
}

function sectionLabel(pathname: string) {
  if (pathname === '/') return pageTitles['/']
  const key = Object.keys(pageTitles)
    .filter((k) => k !== '/' && (pathname === k || pathname.startsWith(k + '/')))
    .sort((a, b) => b.length - a.length)[0]
  return key ? pageTitles[key] : '工作台'
}

function NavItem({ to, label, icon, end = false }: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }) {
  const Icon = icon
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        'relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors ' +
        (isActive
          ? 'bg-copper/10 text-ink'
          : 'text-muted hover:bg-surface-2 hover:text-ink')
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-copper" /> : null}
          <Icon size={16} strokeWidth={1.8} className={isActive ? 'text-copper' : 'text-faint'} />
          {label}
        </>
      )}
    </NavLink>
  )
}

function NavSection({ label, items }: { label: string; items: NavItemDef[] }) {
  return (
    <div className="space-y-0.5">
      <div className="px-3 pb-1.5 pt-5 text-[9px] font-semibold uppercase tracking-[0.2em] text-faint">{label}</div>
      {items.map((n) => (
        <NavItem key={n.to} to={n.to} label={n.label} icon={n.icon} end={n.to === '/'} />
      ))}
    </div>
  )
}

function AppStatusBar({ apiOk, running, agents, version }: {
  apiOk: boolean | null
  running: number
  agents: Agent[] | null
  version: string
}) {
  const online = agents?.filter((a) => a.status === 'online').length ?? 0
  const dot = apiOk === null ? 'bg-white/25' : apiOk ? 'bg-[#6fbf8f]' : 'bg-[#e08078]'
  const label = apiOk === null ? '检查中' : apiOk ? '正常' : '异常'

  return (
    <footer className="fixed inset-x-0 bottom-0 z-40 flex h-7 items-center gap-3 border-t border-white/10 bg-[#121512] px-4 text-[10px] text-white/55 md:gap-5 md:px-6">
      <span className="flex items-center gap-1.5">
        <span className={'h-1.5 w-1.5 rounded-full ' + dot} />
        <span className="uppercase tracking-[0.12em] text-white/35">API</span>
        <span className={apiOk === false ? 'text-[#e08078]' : 'text-white/75'}>{label}</span>
      </span>
      <span className="h-3 w-px bg-white/10" />
      <Link to="/" className="flex items-center gap-1.5 text-white/55 transition-colors hover:text-white">
        进行中 <span className="font-mono text-[11px] text-white/80">{running}</span>
      </Link>
      {agents !== null ? (
        <>
          <span className="hidden h-3 w-px bg-white/10 sm:block" />
          <Link
            to="/agents"
            className="hidden items-center gap-1.5 text-white/55 transition-colors hover:text-white sm:flex"
          >
            执行器 <span className="font-mono text-[11px] text-white/80">{online}/{agents.length}</span>
          </Link>
        </>
      ) : null}
      <span className="ml-auto flex items-center gap-3">
        <span className="hidden text-white/30 md:inline">单实例控制台</span>
        {version ? <span className="font-mono text-[10px] text-white/45">v{version.replace(/^v/, '')}</span> : null}
      </span>
    </footer>
  )
}

export default function Shell() {
  const location = useLocation()
  const { user } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [apiOk, setApiOk] = useState<boolean | null>(null)
  const [running, setRunning] = useState(0)
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [version, setVersion] = useState('')

  const isAdmin = user?.role === 'admin'
  const visibleResources = resourceNav.filter((n) => !n.admin || isAdmin)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    let alive = true

    async function load() {
      if (document.visibilityState === 'hidden') return
      try {
        await api('/api/system/health')
        if (alive) setApiOk(true)
      } catch {
        if (alive) setApiOk(false)
      }
      try {
        const runs = await api<Run[]>('/api/runs')
        if (alive) {
          setRunning(
            runs.filter((r) => ['running', 'pending', 'queued', 'awaiting_approval'].includes(r.status)).length,
          )
        }
      } catch {
        /* the health light already communicates connectivity */
      }
      try {
        const info = await api<{ version: string }>('/api/system/info')
        if (alive) setVersion(info.version || '')
      } catch {
        /* version is optional */
      }
      if (isAdmin) {
        try {
          const list = await api<Agent[]>('/api/agents')
          if (alive) setAgents(list)
        } catch {
          if (alive) setAgents(null)
        }
      }
    }

    load()
    const timer = window.setInterval(load, 30_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [isAdmin])

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    window.location.reload()
  }

  const initial = (user?.username || '?').slice(0, 1).toUpperCase()
  const roleLabel = isAdmin ? '管理员' : '成员'

  const sidebar = (
    <aside className="flex h-full w-[232px] flex-col border-r border-line bg-surface pb-7">
      <div className="flex h-14 items-center justify-between px-5">
        <Brand />
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-ink md:hidden"
          aria-label="关闭菜单"
        >
          <X size={17} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <NavSection label="运行" items={operationsNav} />
        <NavSection label="资源" items={visibleResources} />
      </nav>

      <div className="border-t border-line px-3 py-3">
        <NavItem to="/settings" label="设置" icon={Settings} />
        <div className="mt-2 flex items-center gap-2 px-3 py-1.5 text-[10px] text-faint">
          <span className="h-1 w-1 rounded-full bg-faint" />
          <span>单实例 · 本地存储</span>
        </div>
      </div>
    </aside>
  )

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:block">{sidebar}</div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="关闭菜单"
            className="absolute inset-0 bg-black/35"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-[232px]">{sidebar}</div>
        </div>
      ) : null}

      <div className="flex min-h-screen flex-col md:pl-[232px]">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas/90 px-4 backdrop-blur-md md:px-8">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="-ml-1 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink md:hidden"
            aria-label="打开菜单"
          >
            <Menu size={18} />
          </button>
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
            <span className="hidden sm:inline">工作台</span>
            <ChevronRight size={12} className="hidden shrink-0 sm:block" />
            <span className="truncate font-medium text-muted">{sectionLabel(location.pathname)}</span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <ThemeMenu />
            <span className="mx-1 h-4 w-px bg-line" />
            <Dropdown
              trigger="click"
              position="br"
              droplist={
                <ArcoMenu onClickMenuItem={(key) => key === 'logout' && logout()}>
                  <ArcoMenu.Item key="logout">
                    <span className="flex items-center gap-2 text-danger">
                      <LogOut size={13} />
                      退出登录
                    </span>
                  </ArcoMenu.Item>
                </ArcoMenu>
              }
            >
              <button
                type="button"
                className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 text-left transition-colors hover:bg-surface-2"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line-strong bg-surface-2 text-[10px] font-semibold text-ink">
                  {initial}
                </span>
                <span className="hidden sm:block">
                  <span className="block max-w-[120px] truncate text-[11px] font-medium leading-3 text-ink">
                    {user?.username}
                  </span>
                  <span className="block text-[9px] leading-3 text-faint">{roleLabel}</span>
                </span>
                <ChevronDown size={13} className="hidden text-faint sm:block" />
              </button>
            </Dropdown>
          </div>
        </header>

        <main className="w-full max-w-[1440px] flex-1 px-4 pb-16 pt-6 md:px-8 md:pt-8">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/repositories" element={<Repositories />} />
              <Route path="/pipelines" element={<Pipelines />} />
              <Route path="/pipelines/:id" element={<PipelinesDetail />} />
              <Route path="/registries" element={<Registries />} />
              <Route path="/deploy-targets" element={<DeployTargets />} />
              <Route path="/deploy-targets/:id" element={<DeployTargetDetail />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/variables" element={<Variables />} />
              <Route path="/notify-channels" element={<NotifyChannels />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/runs/:id" element={<RunDetail />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      <AppStatusBar apiOk={apiOk} running={running} agents={agents} version={version} />
    </div>
  )
}
