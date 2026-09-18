import * as fs from 'node:fs'
import * as path from 'node:path'
import { isPluginManifest, readManifest } from './detect.js'
import { locateManifestFindings } from './manifest-location.js'
import type { Finding, ProjectType } from './types.js'

const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[\w.]+)?$/

const DISALLOWED_NAME_WORDS = ['obsidian', 'plugin']

const AUTHOR_PLACEHOLDERS = new Set([
  'your name',
  'author',
  'me',
  'unknown',
  'anonymous',
  'plugin author',
  'your-name'
])

const THEME_MANIFEST_FIELDS = new Set([
  'name',
  'version',
  'minAppVersion',
  'author',
  'authorUrl',
  'fundingUrl'
])

const PLUGIN_MANIFEST_FIELDS = new Set([
  'id',
  'name',
  'version',
  'description',
  'minAppVersion',
  'author',
  'authorUrl',
  'fundingUrl',
  'isDesktopOnly'
])

const PLUGIN_RECOMMENDED_FIELDS = ['author', 'minAppVersion', 'isDesktopOnly']

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const HTTP_URL_REGEX = /https?:\/\/\S+/i

function validateSemver(version: string, field: string): Finding[] {
  if (!SEMVER_REGEX.test(version)) {
    return [
      {
        ruleId: 'manifest-invalid-semver',
        enforcement: 'policy',
        message: `${field} "${version}" is not valid semver (expected X.Y.Z).`,
        severity: 'error',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      }
    ]
  }
  return []
}

function validateBannedWords(
  value: string,
  field: 'Plugin ID' | 'Plugin name' | 'Theme name',
  ruleId: 'manifest-id-banned-word' | 'manifest-disallowed-name',
  exempt = false
): Finding[] {
  if (exempt) return []

  const results: Finding[] = []
  const lower = value.toLowerCase()

  for (const word of DISALLOWED_NAME_WORDS) {
    if (lower.includes(word)) {
      results.push({
        ruleId,
        enforcement: 'policy',
        message: `${field} must not contain "${word}". Found in: "${value}".`,
        severity: 'error',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      })
    }
  }

  return results
}

function isAllCaps(value: string): boolean {
  const uppercaseLetters = value.match(/[A-Z]/g)?.length ?? 0
  return uppercaseLetters >= 2 && value === value.toUpperCase()
}

function validateDescription(description: string, name: string): Finding[] {
  const results: Finding[] = []
  const trimmed = description.trim()
  const lower = trimmed.toLowerCase()
  const lowerName = name.trim().toLowerCase()

  if (trimmed.length < 10) {
    results.push({
      ruleId: 'manifest-description-too-short',
      enforcement: 'policy',
      message: `Description is too short (${trimmed.length} chars). Provide a meaningful description (10+ chars).`,
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }

  if (lower === lowerName) {
    results.push({
      ruleId: 'manifest-description-equals-name',
      enforcement: 'policy',
      message: 'Plugin description must not be the same as its name.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }

  if (lowerName.length > 0 && lower.startsWith(lowerName)) {
    results.push({
      ruleId: 'manifest-description-starts-with-name',
      enforcement: 'policy',
      message: 'Plugin description should not start with the plugin name.',
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }

  if (/\b(?:this plugin|a plugin that|the plugin)\b/i.test(trimmed)) {
    results.push({
      ruleId: 'manifest-description-self-reference',
      enforcement: 'policy',
      message: 'Plugin description should not refer to itself as a plugin.',
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }

  if (trimmed.length > 250) {
    results.push({
      ruleId: 'manifest-description-too-long',
      enforcement: 'policy',
      message: `Plugin description is too long (${trimmed.length} chars). The maximum is 250 characters.`,
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }

  if (!/[.!?]$/.test(trimmed)) {
    results.push({
      ruleId: 'manifest-description-punctuation',
      enforcement: 'policy',
      message:
        'Plugin description should end with a period, exclamation mark, or question mark.',
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }

  if (/obsidian/i.test(trimmed)) {
    results.push({
      ruleId: 'manifest-description-brand-name',
      enforcement: 'policy',
      message: 'Plugin description must not contain the Obsidian brand name.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }

  return results
}

function validateAuthor(
  author: string,
  manifestType: 'Plugin' | 'Theme'
): Finding[] {
  const results: Finding[] = []
  const trimmed = author.trim()

  if (AUTHOR_PLACEHOLDERS.has(trimmed.toLowerCase())) {
    results.push({
      ruleId: 'manifest-author-placeholder',
      enforcement: 'policy',
      message: `${manifestType} manifest author must not use the placeholder "${trimmed}".`,
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }
  if (EMAIL_REGEX.test(trimmed)) {
    results.push({
      ruleId: 'manifest-author-email',
      enforcement: 'policy',
      message: `${manifestType} manifest author must not contain an email address.`,
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }
  if (HTTP_URL_REGEX.test(trimmed)) {
    results.push({
      ruleId: 'manifest-author-url',
      enforcement: 'policy',
      message: `${manifestType} manifest author must not contain an HTTP or HTTPS URL.`,
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }

  return results
}

function validateUrl(url: unknown, field: string): Finding[] {
  if (url === undefined || typeof url !== 'string') return []
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return [
      {
        ruleId: 'manifest-url-invalid',
        enforcement: 'policy',
        message: `${field} is not a valid URL: "${url}".`,
        severity: 'error',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      }
    ]
  }

  const results: Finding[] = []
  if (parsed.protocol !== 'https:') {
    results.push({
      ruleId: 'manifest-url-non-https',
      enforcement: 'policy',
      message: `${field} must use HTTPS. Got: "${url}".`,
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname)) {
    results.push({
      ruleId: 'manifest-url-raw-ip',
      enforcement: 'policy',
      message: `${field} must not use a bare IPv4 address.`,
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }
  if (
    parsed.hostname === 'obsidian.md' ||
    parsed.hostname === 'www.obsidian.md'
  ) {
    results.push({
      ruleId: 'manifest-url-obsidian',
      enforcement: 'policy',
      message: `${field} must not point to obsidian.md.`,
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }

  if (
    field === 'authorUrl' &&
    (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com')
  ) {
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length >= 2) {
      const repository = `${segments[0]}/${segments[1].replace(/\.git$/i, '')}`
      const ownRepository = process.env.GITHUB_REPOSITORY
      if (ownRepository?.toLowerCase() === repository.toLowerCase()) {
        results.push({
          ruleId: 'manifest-author-url-own-repo',
          enforcement: 'policy',
          message:
            'authorUrl should identify the author rather than the plugin repository.',
          severity: 'warning',
          status: 'failed',
          coverage: 'partial',
          check: 'manifest'
        })
      }
      results.push({
        ruleId: 'manifest-author-url-repo',
        enforcement: 'policy',
        message:
          'authorUrl should link to an author profile rather than a GitHub repository.',
        severity: 'warning',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      })
    }
  }

  return results
}

export function validatePluginManifest(
  manifest: Record<string, unknown>,
  immutableIdentifierExempt = false
): Finding[] {
  const results: Finding[] = []

  if (typeof manifest.id !== 'string' || manifest.id.trim().length === 0) {
    results.push({
      ruleId: 'manifest-missing-required-field',
      enforcement: 'correctness',
      message: 'Plugin manifest is missing required field: id.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  } else {
    results.push(
      ...validateBannedWords(
        manifest.id,
        'Plugin ID',
        'manifest-id-banned-word',
        immutableIdentifierExempt
      )
    )
  }

  if (typeof manifest.name !== 'string' || manifest.name.trim().length === 0) {
    results.push({
      ruleId: 'manifest-missing-required-field',
      enforcement: 'correctness',
      message: 'Plugin manifest is missing required field: name.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  } else {
    results.push(
      ...validateBannedWords(
        manifest.name,
        'Plugin name',
        'manifest-disallowed-name'
      )
    )
    if (manifest.name.length > 50) {
      results.push({
        ruleId: 'manifest-name-too-long',
        enforcement: 'policy',
        message: `Plugin manifest name is too long (${manifest.name.length} chars). The maximum is 50 characters.`,
        severity: 'warning',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      })
    }
    if (isAllCaps(manifest.name)) {
      results.push({
        ruleId: 'manifest-name-all-caps',
        enforcement: 'policy',
        message: 'Plugin manifest name should not be written in all caps.',
        severity: 'warning',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      })
    }
  }

  if (
    typeof manifest.version !== 'string' ||
    manifest.version.trim().length === 0
  ) {
    results.push({
      ruleId: 'manifest-missing-required-field',
      enforcement: 'correctness',
      message: 'Plugin manifest is missing required field: version.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  } else {
    results.push(...validateSemver(manifest.version, 'version'))
    if (manifest.version === '0.0.0') {
      results.push({
        ruleId: 'manifest-version-placeholder',
        enforcement: 'policy',
        message: 'Plugin manifest version must not use the 0.0.0 placeholder.',
        severity: 'error',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      })
    }
  }

  if (
    typeof manifest.description !== 'string' ||
    manifest.description.trim().length === 0
  ) {
    results.push({
      ruleId: 'manifest-missing-required-field',
      enforcement: 'correctness',
      message: 'Plugin manifest is missing required field: description.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  } else {
    const name = typeof manifest.name === 'string' ? manifest.name : ''
    results.push(...validateDescription(manifest.description, name))
  }

  if (typeof manifest.minAppVersion === 'string' && manifest.minAppVersion) {
    results.push(...validateSemver(manifest.minAppVersion, 'minAppVersion'))
  }

  if (typeof manifest.author === 'string') {
    results.push(...validateAuthor(manifest.author, 'Plugin'))
  }

  if (
    Object.prototype.hasOwnProperty.call(manifest, 'isDesktopOnly') &&
    typeof manifest.isDesktopOnly !== 'boolean'
  ) {
    results.push({
      ruleId: 'manifest-is-desktop-only-type',
      enforcement: 'correctness',
      message: 'Plugin manifest field isDesktopOnly must be a boolean.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  }

  results.push(...validateUrl(manifest.authorUrl, 'authorUrl'))

  if (typeof manifest.fundingUrl === 'string') {
    results.push(...validateUrl(manifest.fundingUrl, 'fundingUrl'))
  } else if (
    typeof manifest.fundingUrl === 'object' &&
    manifest.fundingUrl !== null
  ) {
    for (const [platform, url] of Object.entries(manifest.fundingUrl)) {
      results.push(...validateUrl(url, `fundingUrl.${platform}`))
    }
  }

  for (const field of Object.keys(manifest)) {
    if (!PLUGIN_MANIFEST_FIELDS.has(field)) {
      results.push({
        ruleId: 'manifest-unknown-field',
        enforcement: 'policy',
        message: `Plugin manifest contains unknown field: ${field}.`,
        severity: 'warning',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      })
    }
  }

  for (const field of PLUGIN_RECOMMENDED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(manifest, field)) {
      results.push({
        ruleId: 'manifest-missing-recommended-field',
        enforcement: 'policy',
        message: `Plugin manifest is missing recommended field: ${field}.`,
        severity: 'warning',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      })
    }
  }

  return results
}

export function validateThemeManifest(
  manifest: Record<string, unknown>,
  immutableIdentifierExempt = false
): Finding[] {
  const results: Finding[] = []

  if (typeof manifest.name !== 'string' || manifest.name.trim().length === 0) {
    results.push({
      ruleId: 'manifest-missing-required-field',
      enforcement: 'correctness',
      message: 'Theme manifest is missing required field: name.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  } else {
    results.push(
      ...validateBannedWords(
        manifest.name,
        'Theme name',
        'manifest-disallowed-name',
        immutableIdentifierExempt
      )
    )
    if (manifest.name.length > 50) {
      results.push({
        ruleId: 'manifest-name-too-long',
        enforcement: 'policy',
        message: `Theme manifest name is too long (${manifest.name.length} chars). The maximum is 50 characters.`,
        severity: 'warning',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      })
    }

    if (isAllCaps(manifest.name)) {
      results.push({
        ruleId: 'manifest-name-all-caps',
        enforcement: 'policy',
        message: 'Theme manifest name should not be written in all caps.',
        severity: 'warning',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      })
    }
  }

  if (
    typeof manifest.version !== 'string' ||
    manifest.version.trim().length === 0
  ) {
    results.push({
      ruleId: 'manifest-missing-required-field',
      enforcement: 'correctness',
      message: 'Theme manifest is missing required field: version.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  } else {
    results.push(...validateSemver(manifest.version, 'version'))
    if (manifest.version === '0.0.0') {
      results.push({
        ruleId: 'manifest-version-placeholder',
        enforcement: 'policy',
        message: 'Theme manifest version must not use the 0.0.0 placeholder.',
        severity: 'error',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      })
    }
  }

  if (
    typeof manifest.minAppVersion === 'string' &&
    manifest.minAppVersion.trim().length === 0
  ) {
    results.push({
      ruleId: 'manifest-missing-required-field',
      enforcement: 'correctness',
      message: 'Theme manifest is missing required field: minAppVersion.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  } else if (manifest.minAppVersion === undefined) {
    results.push({
      ruleId: 'manifest-missing-required-field',
      enforcement: 'correctness',
      message: 'Theme manifest is missing required field: minAppVersion.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  } else if (typeof manifest.minAppVersion !== 'string') {
    results.push({
      ruleId: 'manifest-invalid-field-type',
      enforcement: 'correctness',
      message: 'Theme manifest field minAppVersion must be a string.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  } else {
    results.push(...validateSemver(manifest.minAppVersion, 'minAppVersion'))
  }

  if (
    typeof manifest.author !== 'string' ||
    manifest.author.trim().length === 0
  ) {
    results.push({
      ruleId: 'manifest-missing-required-field',
      enforcement: 'correctness',
      message: 'Theme manifest is missing required field: author.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'manifest'
    })
  } else {
    results.push(...validateAuthor(manifest.author, 'Theme'))
  }

  if (manifest.authorUrl !== undefined) {
    results.push(...validateUrl(manifest.authorUrl, 'authorUrl'))
  }

  for (const field of Object.keys(manifest)) {
    if (!THEME_MANIFEST_FIELDS.has(field)) {
      results.push({
        ruleId: 'manifest-unknown-field',
        enforcement: 'policy',
        message: `Theme manifest contains unknown field: ${field}.`,
        severity: 'warning',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      })
    }
  }

  return results
}

export function validateVersionsJson(workspacePath: string): Finding[] {
  const versionsPath = path.join(workspacePath, 'versions.json')
  if (!fs.existsSync(versionsPath)) return []

  const results: Finding[] = []
  let data: unknown

  try {
    const raw = fs.readFileSync(versionsPath, 'utf-8')
    data = JSON.parse(raw)
  } catch {
    results.push({
      ruleId: 'versions-invalid-json',
      enforcement: 'policy',
      message: 'versions.json is not valid JSON.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'versions'
    })
    return results
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    results.push({
      ruleId: 'versions-invalid-format',
      enforcement: 'policy',
      message:
        'versions.json must be a JSON object mapping plugin versions to minimum app versions.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'versions'
    })
    return results
  }

  for (const [pluginVersion, minApp] of Object.entries(
    data as Record<string, unknown>
  )) {
    if (!SEMVER_REGEX.test(pluginVersion)) {
      results.push({
        ruleId: 'versions-invalid-semver',
        enforcement: 'policy',
        message: `versions.json key "${pluginVersion}" is not valid semver.`,
        severity: 'warning',
        status: 'failed',
        coverage: 'partial',
        check: 'versions'
      })
    }
    if (typeof minApp !== 'string' || !SEMVER_REGEX.test(minApp)) {
      results.push({
        ruleId: 'versions-invalid-semver',
        enforcement: 'policy',
        message: `versions.json value for "${pluginVersion}" is not a valid semver string.`,
        severity: 'warning',
        status: 'failed',
        coverage: 'partial',
        check: 'versions'
      })
    }
  }

  return results
}

export function validateManifest(
  workspacePath: string,
  projectType: ProjectType,
  immutableIdentifierExempt = false
): Finding[] {
  const manifest = readManifest(workspacePath)

  if (manifest === null) {
    return [
      {
        ruleId: 'manifest-invalid-json',
        enforcement: 'correctness',
        message: 'manifest.json not found or is not valid JSON.',
        severity: 'error',
        status: 'failed',
        coverage: 'partial',
        check: 'manifest'
      }
    ]
  }

  const obj = manifest as Record<string, unknown>

  if (projectType === 'plugin') {
    const hasOnlyInvalidDesktopFlag =
      Object.prototype.hasOwnProperty.call(obj, 'isDesktopOnly') &&
      isPluginManifest({ ...obj, isDesktopOnly: undefined })
    if (!isPluginManifest(obj) && !hasOnlyInvalidDesktopFlag) {
      return [
        {
          ruleId: 'manifest-schema-invalid',
          enforcement: 'correctness',
          message:
            'manifest.json does not match the plugin schema. ' +
            'Required fields: id (string), name (string), version (string), description (string).',
          severity: 'error',
          status: 'failed',
          coverage: 'partial',
          check: 'manifest'
        }
      ]
    }
    return [
      ...locateManifestFindings(
        workspacePath,
        validatePluginManifest(obj, immutableIdentifierExempt)
      ),
      ...validateVersionsJson(workspacePath)
    ]
  }

  return locateManifestFindings(
    workspacePath,
    validateThemeManifest(obj, immutableIdentifierExempt)
  )
}
