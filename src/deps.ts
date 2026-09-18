import * as fs from 'node:fs'
import * as path from 'node:path'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'

export interface PackageManager {
  name: string
  lockfile: string
  install: string[]
  frozenInstall: string[]
}

/**
 * Ordered by precedence. A repository containing several lockfiles resolves to
 * the first match, so non-npm lockfiles are checked first: a stale
 * `package-lock.json` alongside a `pnpm-lock.yaml` is far more common than the
 * reverse.
 */
const PACKAGE_MANAGERS: PackageManager[] = [
  {
    name: 'pnpm',
    lockfile: 'pnpm-lock.yaml',
    install: ['pnpm', 'install'],
    frozenInstall: ['pnpm', 'install', '--frozen-lockfile']
  },
  {
    name: 'yarn',
    lockfile: 'yarn.lock',
    install: ['yarn', 'install'],
    frozenInstall: ['yarn', 'install', '--immutable']
  },
  {
    name: 'bun',
    lockfile: 'bun.lockb',
    install: ['bun', 'install'],
    frozenInstall: ['bun', 'install', '--frozen-lockfile']
  },
  {
    name: 'bun',
    lockfile: 'bun.lock',
    install: ['bun', 'install'],
    frozenInstall: ['bun', 'install', '--frozen-lockfile']
  },
  {
    name: 'npm',
    lockfile: 'npm-shrinkwrap.json',
    install: ['npm', 'install'],
    frozenInstall: ['npm', 'ci']
  },
  {
    name: 'npm',
    lockfile: 'package-lock.json',
    install: ['npm', 'install'],
    frozenInstall: ['npm', 'ci']
  }
]

const NPM_FALLBACK: PackageManager = {
  name: 'npm',
  lockfile: '',
  install: ['npm', 'install'],
  frozenInstall: ['npm', 'install']
}

const PNPM_DEFAULT: PackageManager = {
  name: 'pnpm',
  lockfile: '',
  install: ['pnpm', 'install'],
  frozenInstall: ['pnpm', 'install']
}

export function hasPackageJson(workspacePath: string): boolean {
  return fs.existsSync(path.join(workspacePath, 'package.json'))
}

export function detectPackageManager(
  workspacePath: string
): PackageManager | null {
  return (
    PACKAGE_MANAGERS.find((pm) =>
      fs.existsSync(path.join(workspacePath, pm.lockfile))
    ) ?? null
  )
}

async function isAvailable(tool: string): Promise<boolean> {
  return (await io.which(tool, false)) !== ''
}

export async function ensureUserDeps(workspacePath: string): Promise<boolean> {
  if (!hasPackageJson(workspacePath)) return true

  if (fs.existsSync(path.join(workspacePath, 'node_modules'))) return true

  core.info('Installing user dependencies for type resolution...')

  const detected = detectPackageManager(workspacePath)
  const manager = detected ?? PNPM_DEFAULT
  let command = detected ? manager.frozenInstall : manager.install

  if (!detected) {
    core.warning(
      'No lockfile found (pnpm-lock.yaml, yarn.lock, bun.lockb, bun.lock, ' +
        'npm-shrinkwrap.json, or package-lock.json). Defaulting to "pnpm ' +
        'install". The community directory ' +
        'requires a committed lockfile to verify that your release can be ' +
        'reproduced from source.'
    )
  }

  if (!(await isAvailable(manager.name))) {
    core.warning(
      `${detected ? `Found ${manager.lockfile}` : 'No lockfile was found'} but ` +
        `"${manager.name}" is not available on ` +
        `this runner. Falling back to "npm install", which ignores that ` +
        `${detected ? 'lockfile' : 'preferred default'} and may resolve different dependency versions. Add the ` +
        `matching setup step (for example pnpm/action-setup) before this action.`
    )
    command = NPM_FALLBACK.install
  } else if (detected) {
    core.info(`Detected ${manager.lockfile}; using "${command.join(' ')}".`)
  }

  const [tool, ...args] = command
  const exitCode = await exec.exec(tool, args, {
    cwd: workspacePath,
    ignoreReturnCode: true
  })

  return exitCode === 0
}
