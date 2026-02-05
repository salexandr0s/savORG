import path from 'node:path'
import { app } from 'electron'

export function isDev(): boolean {
  return process.env.NODE_ENV === 'development' || !app.isPackaged
}

export function getAssetPath(...segments: string[]): string {
  return path.resolve(__dirname, '..', 'assets', ...segments)
}
