import { useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Bell, Boxes, ChevronDown, ChevronRight, ClipboardCheck, FolderGit2, LayoutDashboard, LogOut, Server, Settings, Variable, Workflow } from 'lucide-react'
import { api } from '../lib/api'
import Brand from '../components/Brand'
import Dashboard from './Dashboard'
import Repositories from './Repositories'
import Pipelines from './Pipelines'
import PipelinesDetail from './PipelinesDetail'
import Registries from './Registries'
import DeployTargets from './DeployTargets'
import DeployTargetDetail from './DeployTargetDetail'
import Approvals from './Approvals'
import Variables from './Variables'
import NotifyChannels from './NotifyChannels'
import SettingsPage from './Settings'
import RunDetail from './RunDetail'

const mainNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/pipelines', label: '流水线', icon: Workflow },
]

const resourceNav = [
  { to: '/repositories', label: '代码仓库', icon: FolderGit2 },
  { to: '/registries', label: '镜像仓库', icon: Boxes },
  { to: '/deploy-targets', label: '部署环境', icon: Server },
  { to: '/variables', label: '环境变量', icon: Variable },
  { to: '/notify-channels', label: '通知通道', icon: Bell },
]

const bottomNav = [
  { to: '/approvals', label: '审批中心', icon: ClipboardCheck },
  { to: '/settings', label: '设置', icon: Settings },
]

function NavItem({ to, label, icon, end = false }: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }) {
  const Icon = icon
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ' +
        (isActive ? 'bg-indigo-500/15 text-indigo-300' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200')
      }
    >
      <Icon size={16} />
      {label}
    </NavLink>
  )
}

export default function Shell() {
  const location = useLocation()
  const [resourcesOpen, setResourcesOpen] = useState(true)
  const resourcesActive = resourceNav.some((n) => location.pathname.startsWith(n.to))

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    window.location.reload()
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col bg-slate-900">
        <div className="px-5 py-5">
          <Brand dark />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {mainNav.map((n) => (
            <NavItem key={n.to} to={n.to} label={n.label} icon={n.icon} end={n.to === '/'} />
          ))}

          <div>
            <button
              onClick={() => setResourcesOpen((v) => !v)}
              className={
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ' +
                (resourcesActive ? 'text-indigo-300' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200')
              }
            >
              {resourcesOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              资源管理
            </button>
            {resourcesOpen ? (
              <div className="mt-1 space-y-1 pl-4">
                {resourceNav.map((n) => (
                  <NavItem key={n.to} to={n.to} label={n.label} icon={n.icon} />
                ))}
              </div>
            ) : null}
          </div>

          {bottomNav.map((n) => (
            <NavItem key={n.to} to={n.to} label={n.label} icon={n.icon} />
          ))}
        </nav>
        <div className="border-t border-slate-800 p-3">
          <button
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <LogOut size={16} />
            退出登录
          </button>
        </div>
      </aside>
      <main className="flex-1 bg-slate-50 p-8">
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
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/runs/:id" element={<RunDetail />} />
        </Routes>
      </main>
    </div>
  )
}
