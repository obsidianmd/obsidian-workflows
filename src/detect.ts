import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ProjectType, PluginManifest, ThemeManifest } from './types.js'

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function isOptionalFundingUrl(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value === 'string') return true
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).every((v) => typeof v === 'string')
  }
  return false
}

export function isPluginManifest(data: unknown): data is PluginManifest {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.version === 'string' &&
    typeof obj.description === 'string' &&
    isOptionalString(obj.author) &&
    isOptionalString(obj.minAppVersion) &&
    isOptionalString(obj.authorUrl) &&
    isOptionalFundingUrl(obj.fundingUrl) &&
    isOptionalBoolean(obj.isDesktopOnly)
  )
}

export function isThemeManifest(data: unknown): data is ThemeManifest {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj.name === 'string' &&
    typeof obj.version === 'string' &&
    typeof obj.author === 'string' &&
    typeof obj.minAppVersion === 'string' &&
    isOptionalString(obj.authorUrl)
  )
}

export function readManifest(workspacePath: string): unknown | null {
  const manifestPath = path.join(workspacePath, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return null

  const raw = fs.readFileSync(manifestPath, 'utf-8')
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export function detectProjectType(
  workspacePath: string,
  explicitType: 'plugin' | 'theme' | 'auto'
): ProjectType {
  if (explicitType !== 'auto') return explicitType

  const manifest = readManifest(workspacePath)

  if (manifest !== null && typeof manifest === 'object') {
    const obj = manifest as Record<string, unknown>
    if (typeof obj.id === 'string') return 'plugin'
  }

  const hasThemeCss = fs.existsSync(path.join(workspacePath, 'theme.css'))

  if (manifest !== null && typeof manifest === 'object') {
    const obj = manifest as Record<string, unknown>
    if (typeof obj.id !== 'string' && hasThemeCss) return 'theme'
  }

  if (hasThemeCss) return 'theme'

  throw new Error(
    'Could not detect project type. manifest.json has no `id` field (not a plugin) ' +
      'and no theme.css found (not a theme). Set the `type` input to "plugin" or "theme" explicitly.'
  )
}
