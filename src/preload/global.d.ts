import type { ElectronApi } from './index'

declare global {
  interface Window {
    electronAPI: ElectronApi
  }
}
