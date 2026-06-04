import { createProjectBackup } from './backupService'
import { jsonStore } from '../store'

let backupTimer: NodeJS.Timeout | undefined
let backupRunning = false
let schedulerGeneration = 0

function clearBackupTimer(): void {
  if (!backupTimer) return
  clearInterval(backupTimer)
  backupTimer = undefined
}

export async function runScheduledBackupOnce(): Promise<void> {
  if (backupRunning) return
  backupRunning = true
  try {
    const snapshot = await jsonStore.snapshot()
    if (!snapshot.projectRoot || !snapshot.localSettings.backup.autoBackup) return
    await createProjectBackup(snapshot.projectRoot, snapshot.localSettings)
  } catch (error) {
    console.warn('[backup] scheduled backup failed:', error)
  } finally {
    backupRunning = false
  }
}

export async function refreshBackupScheduler(): Promise<void> {
  const generation = ++schedulerGeneration
  clearBackupTimer()
  const snapshot = await jsonStore.snapshot()
  if (generation !== schedulerGeneration) return
  if (!snapshot.projectRoot || !snapshot.localSettings.backup.autoBackup) return

  const intervalMinutes = Math.max(1, Math.floor(snapshot.localSettings.backup.intervalMinutes || 1))
  const nextTimer = setInterval(() => {
    void runScheduledBackupOnce()
  }, intervalMinutes * 60 * 1000)
  nextTimer.unref?.()
  if (generation !== schedulerGeneration) {
    clearInterval(nextTimer)
    return
  }
  backupTimer = nextTimer
}

export function stopBackupScheduler(): void {
  schedulerGeneration += 1
  clearBackupTimer()
}
