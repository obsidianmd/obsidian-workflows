import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Finding, PolicySeverity, ProjectType } from './types.js'

const BUNDLE_LOCATIONS = [
  'main.js',
  'dist/main.js',
  'build/main.js',
  'out/main.js'
]
const DOMAIN_LIMIT = 20
const PATH_BOUNDARY = /[\s"'`\\)\]}>,;]/
const HELP_MESSAGE =
  'This is an advisory preflight check; the authoritative scan runs at release against the published bundle. main.js bundles dependencies, so this finding may originate from a third-party package rather than the author’s own source.'

function finding(
  ruleId: string,
  message: string,
  severity: PolicySeverity,
  status: Finding['status'],
  bundlePath?: string
): Finding {
  return {
    ruleId,
    enforcement: 'policy',
    check: 'artifact-preflight',
    message,
    severity,
    status,
    coverage: 'partial',
    helpMessage: HELP_MESSAGE,
    ...(bundlePath ? { location: { file: bundlePath } } : {})
  }
}

function findBundle(workspacePath: string): string | null {
  for (const relativePath of BUNDLE_LOCATIONS) {
    if (fs.existsSync(path.join(workspacePath, relativePath)))
      return relativePath
  }
  return null
}

// Anchored on the ".wasm" literal and expanded backwards. A leading unbounded
// character class backtracks quadratically across the long unbroken runs that
// inline base64 payloads produce, which stalls the check for tens of minutes.
function collectWasmReferences(bundle: string): string[] {
  const references = new Set<string>()

  for (const match of bundle.matchAll(/\.wasm\b/gi)) {
    let start = match.index
    while (start > 0 && !PATH_BOUNDARY.test(bundle[start - 1])) start -= 1
    references.add(bundle.slice(start, match.index + match[0].length))
  }

  return [...references].slice(0, DOMAIN_LIMIT)
}

function externalDomains(bundle: string): string[] {
  const domains = new Set<string>()
  const callPattern =
    /\b(?:fetch|requestUrl|request|XMLHttpRequest|ajax)\s*\([^)]{0,1000}/g
  const urlPattern = /https?:\/\/[^\s"'`\\)\]}>,;]+/g

  for (const call of bundle.matchAll(callPattern)) {
    for (const urlMatch of call[0].matchAll(urlPattern)) {
      try {
        domains.add(new URL(urlMatch[0]).hostname)
      } catch {
        continue
      }
    }
  }

  return [...domains].slice(0, DOMAIN_LIMIT)
}

export function checkArtifactBundle(
  workspacePath: string,
  projectType: ProjectType
): Finding[] {
  if (projectType !== 'plugin') {
    return [
      finding(
        'bundle-artifact-preflight',
        'Artifact preflight applies only to plugins.',
        'recommendation',
        'skipped'
      )
    ]
  }

  const bundlePath = findBundle(workspacePath)
  if (!bundlePath) {
    return [
      finding(
        'bundle-artifact-preflight',
        'Built main.js was not found; artifact preflight was skipped.',
        'recommendation',
        'skipped'
      )
    ]
  }

  const bundle = fs.readFileSync(path.join(workspacePath, bundlePath), 'utf8')
  const results: Finding[] = []

  if (/\b(?:__awaiter|__generator|__spreadArray)\b/.test(bundle)) {
    results.push(
      finding(
        'bundle-es5-helpers',
        'The bundle contains ES5 compatibility helpers.',
        'recommendation',
        'failed',
        bundlePath
      )
    )
  }

  if (/AGFz[A-Za-z0-9+/=]{8,}/.test(bundle)) {
    results.push(
      finding(
        'bundle-inline-wasm',
        'The bundle contains inline base64 data with a WebAssembly magic header.',
        'warning',
        'failed',
        bundlePath
      )
    )
  }

  const wasmReferences = collectWasmReferences(bundle)
  if (wasmReferences.length > 0) {
    results.push(
      finding(
        'bundle-wasm-reference',
        `The bundle references WebAssembly file(s): ${wasmReferences.join(', ')}.`,
        'recommendation',
        'failed',
        bundlePath
      )
    )
  }

  const domains = externalDomains(bundle)
  if (domains.length > 0) {
    results.push(
      finding(
        'bundle-external-domain',
        `The bundle passes URL(s) for these domain(s) to network APIs: ${domains.join(', ')}.`,
        'recommendation',
        'failed',
        bundlePath
      )
    )
  }

  if (/navigator\s*\.\s*sendBeacon\s*\(/.test(bundle)) {
    results.push(
      finding(
        'bundle-send-beacon',
        'The bundle calls navigator.sendBeacon().',
        'warning',
        'failed',
        bundlePath
      )
    )
  }

  if (/rejectUnauthorized\s*:\s*false\b/.test(bundle)) {
    results.push(
      finding(
        'bundle-tls-verification-disabled',
        'The bundle contains rejectUnauthorized: false, which disables TLS certificate verification.',
        'error',
        'failed',
        bundlePath
      )
    )
  }

  return results
}
