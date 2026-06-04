import { exec } from 'node:child_process'
import type { RunCommandResult } from '../../shared/types'

export function runCommand(
  command: string,
  cwd: string,
  extraEnv: Record<string, string> = {}
): Promise<RunCommandResult> {
  return new Promise((resolve) => {
    exec(
      command.trim(),
      {
        cwd: cwd || undefined,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          ...extraEnv
        }
      },
      (error, stdout, stderr) => {
        const code = typeof (error as NodeJS.ErrnoException | null)?.errno === 'number' ? null : 0
        resolve({
          stdout,
          stderr,
          code: error && 'code' in error ? Number(error.code) : code,
          error: error?.message
        })
      }
    )
  })
}
