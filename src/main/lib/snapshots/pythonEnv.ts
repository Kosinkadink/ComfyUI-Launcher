import fs from 'fs'
import path from 'path'
import type { InstallationRecord } from '../../installations'

export function getUvPath(installPath: string): string {
  if (process.platform === 'win32') {
    return path.join(installPath, 'standalone-env', 'uv.exe')
  }
  return path.join(installPath, 'standalone-env', 'bin', 'uv')
}

export function getActivePythonPath(installation: InstallationRecord): string | null {
  const envName = (installation.activeEnv as string | undefined) || 'default'
  const envDir = path.join(installation.installPath, 'envs', envName)
  const pythonPath = process.platform === 'win32'
    ? path.join(envDir, 'Scripts', 'python.exe')
    : path.join(envDir, 'bin', 'python3')
  return fs.existsSync(pythonPath) ? pythonPath : null
}
