import type { BackendHealthController } from '../../services/useBackendHealth.ts'

export type ShellContext = {
  health: BackendHealthController
  sidebarCollapsed: boolean
  toggleSidebar: () => void
}
