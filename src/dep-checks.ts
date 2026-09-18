import * as fs from 'node:fs'
import * as path from 'node:path'
import { detectPackageManager } from './deps.js'
import type { Finding } from './types.js'

function isUnpinned(specifier: string): boolean {
  const normalized = specifier.trim().toLowerCase()
  return (
    normalized === '' ||
    normalized === '*' ||
    normalized === 'x' ||
    normalized === 'latest' ||
    /^>=?\s*\S+$/.test(normalized)
  )
}

export function checkDependencies(workspacePath: string): Finding[] {
  if (detectPackageManager(workspacePath)) return []

  let packageJson: unknown
  try {
    packageJson = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'package.json'), 'utf8')
    ) as unknown
  } catch {
    return []
  }
  if (typeof packageJson !== 'object' || packageJson === null) return []

  const dependencies = (packageJson as Record<string, unknown>).dependencies
  if (typeof dependencies !== 'object' || dependencies === null) return []

  const results: Finding[] = []
  for (const [name, value] of Object.entries(dependencies)) {
    if (typeof value !== 'string') continue

    if (isUnpinned(value)) {
      results.push({
        ruleId: 'dependency-unpinned-version',
        enforcement: 'policy',
        check: 'dependencies',
        message: `Dependency "${name}" uses unpinned version specifier "${value}" without a lockfile.`,
        severity: 'warning',
        status: 'failed',
        coverage: 'full',
        location: { file: 'package.json' }
      })
    } else if (/^[~^]/.test(value.trim())) {
      results.push({
        ruleId: 'dependency-broad-range',
        enforcement: 'policy',
        check: 'dependencies',
        message: `Dependency "${name}" uses broad version range "${value}" without a lockfile.`,
        severity: 'recommendation',
        status: 'failed',
        coverage: 'full',
        location: { file: 'package.json' }
      })
    }
  }

  return results
}
