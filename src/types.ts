/**
 * Shared types for Obsidian plugin and theme validation.
 */

/** Project type — plugin or theme. */
export type ProjectType = 'plugin' | 'theme'

/** Run mode — PR checks or full release validation. */
export type RunMode = 'pr' | 'release'

export type PolicySeverity = 'error' | 'warning' | 'recommendation'
export type ResultStatus = 'failed' | 'passed' | 'skipped' | 'inconclusive'
export type CheckCoverage = 'full' | 'partial' | 'unavailable'

export interface FindingLocation {
  file: string
  startLine?: number
  endLine?: number
  startColumn?: number
  endColumn?: number
}

export interface Finding {
  ruleId: string
  check: string
  message: string
  enforcement: 'policy' | 'correctness'
  severity: PolicySeverity
  status: ResultStatus
  coverage: CheckCoverage
  location?: FindingLocation
  helpMessage?: string
  helpUrl?: string
}

export interface RegistryCheckResult {
  findings: Finding[]
  immutableIdentifierExempt: boolean
}

/** Parsed action inputs. */
export interface ActionInputs {
  type: 'plugin' | 'theme' | 'auto'
  mode: RunMode
  build: string
  lint: boolean
  scannerLint: boolean
  strict: boolean
  nodeVersion: string
}

/**
 * Plugin manifest.json schema.
 *
 * Based on the community directory's PluginManifest interface.
 */
export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  minAppVersion?: string
  author?: string
  authorUrl?: string
  fundingUrl?: string | Record<string, string>
  isDesktopOnly?: boolean
}

/**
 * Theme manifest.json schema.
 *
 * Based on the community directory's ThemeManifest interface.
 */
export interface ThemeManifest {
  name: string
  version: string
  minAppVersion: string
  author: string
  authorUrl?: string
}
