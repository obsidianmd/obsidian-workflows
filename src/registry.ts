import * as fs from 'node:fs'
import * as path from 'node:path'
import * as github from '@actions/github'
import type { Finding, ProjectType, RegistryCheckResult } from './types.js'

const PLUGIN_REGISTRY_URL =
  'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json'
const THEME_REGISTRY_URL =
  'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-css-themes.json'

interface RegistryEntry {
  repo: string
  id?: string
  name?: string
}

function readRegistryKey(
  workspacePath: string,
  projectType: ProjectType
): string | null {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'manifest.json'), 'utf8')
    ) as unknown
    if (typeof manifest !== 'object' || manifest === null) return null
    const key = (manifest as Record<string, unknown>)[
      projectType === 'plugin' ? 'id' : 'name'
    ]
    return typeof key === 'string' ? key : null
  } catch {
    return null
  }
}

function parseRegistry(value: unknown): RegistryEntry[] {
  if (!Array.isArray(value))
    throw new Error('Registry response is not an array')

  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('Registry entry is not an object')
    }
    const record = entry as Record<string, unknown>
    if (typeof record.repo !== 'string') {
      throw new Error('Registry entry has no repository')
    }
    return {
      repo: record.repo,
      id: typeof record.id === 'string' ? record.id : undefined,
      name: typeof record.name === 'string' ? record.name : undefined
    }
  })
}

function unavailableFinding(): Finding {
  return {
    ruleId: 'registry-unavailable',
    enforcement: 'policy',
    check: 'registry',
    message: 'The Obsidian community registry could not be checked.',
    severity: 'warning',
    status: 'inconclusive',
    coverage: 'unavailable'
  }
}

export async function inspectRegistry(
  workspacePath: string,
  projectType: ProjectType
): Promise<RegistryCheckResult> {
  const key = readRegistryKey(workspacePath, projectType)
  if (!key) return { findings: [], immutableIdentifierExempt: false }

  const url =
    projectType === 'plugin' ? PLUGIN_REGISTRY_URL : THEME_REGISTRY_URL
  let entries: RegistryEntry[]
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok)
      return {
        findings: [unavailableFinding()],
        immutableIdentifierExempt: false
      }
    entries = parseRegistry((await response.json()) as unknown)
  } catch {
    return {
      findings: [unavailableFinding()],
      immutableIdentifierExempt: false
    }
  }

  const conflict = entries.find((entry) =>
    projectType === 'plugin' ? entry.id === key : entry.name === key
  )
  if (!conflict) return { findings: [], immutableIdentifierExempt: false }

  const repository = process.env.GITHUB_REPOSITORY
  if (repository?.toLowerCase() === conflict.repo.toLowerCase()) {
    return { findings: [], immutableIdentifierExempt: true }
  }

  if (github.context.payload.repository?.fork === true) {
    return {
      immutableIdentifierExempt: false,
      findings: [
        {
          ruleId: 'registry-fork-detected',
          enforcement: 'policy',
          check: 'registry',
          message: `This fork shares ${projectType === 'plugin' ? 'plugin ID' : 'theme name'} "${key}" with upstream repository ${conflict.repo}; no registry conflict is reported.`,
          severity: 'recommendation',
          status: 'failed',
          coverage: 'full'
        }
      ]
    }
  }

  const ownershipCaveat = repository
    ? ''
    : ' Repository ownership could not be confirmed because GITHUB_REPOSITORY is unset.'
  return {
    immutableIdentifierExempt: false,
    findings: [
      {
        ruleId:
          projectType === 'plugin'
            ? 'registry-plugin-id-taken'
            : 'registry-theme-name-taken',
        enforcement: 'policy',
        check: 'registry',
        message: `${projectType === 'plugin' ? 'Plugin ID' : 'Theme name'} "${key}" is already registered by ${conflict.repo}.${ownershipCaveat}`,
        severity: 'warning',
        status: 'failed',
        coverage: 'full'
      }
    ]
  }
}

export async function checkRegistry(
  workspacePath: string,
  projectType: ProjectType
): Promise<Finding[]> {
  return (await inspectRegistry(workspacePath, projectType)).findings
}
