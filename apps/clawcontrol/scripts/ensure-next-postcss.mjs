import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..', '..')

const rootPostcssDir = resolve(repoRoot, 'node_modules', 'postcss')
const nextNodeModulesDir = resolve(repoRoot, 'node_modules', 'next', 'node_modules')
const nextPostcssPath = resolve(nextNodeModulesDir, 'postcss')
const nextPostcssEntrypoint = resolve(nextPostcssPath, 'lib', 'postcss.js')

function log(message) {
  process.stdout.write(`[ensure-next-postcss] ${message}\n`)
}

if (!existsSync(rootPostcssDir)) {
  log('Skipping: root postcss package not found.')
  process.exit(0)
}

if (existsSync(nextPostcssEntrypoint)) {
  process.exit(0)
}

mkdirSync(nextNodeModulesDir, { recursive: true })

if (existsSync(nextPostcssPath)) {
  try {
    const stat = lstatSync(nextPostcssPath)
    if (stat.isSymbolicLink()) {
      const currentTarget = readlinkSync(nextPostcssPath)
      log(`Replacing stale symlink: ${nextPostcssPath} -> ${currentTarget}`)
      rmSync(nextPostcssPath, { recursive: true, force: true })
    } else {
      log(`Replacing stale directory at ${nextPostcssPath}`)
      rmSync(nextPostcssPath, { recursive: true, force: true })
    }
  } catch {
    rmSync(nextPostcssPath, { recursive: true, force: true })
  }
}

symlinkSync(rootPostcssDir, nextPostcssPath, 'dir')
log(`Linked ${nextPostcssPath} -> ${rootPostcssDir}`)
