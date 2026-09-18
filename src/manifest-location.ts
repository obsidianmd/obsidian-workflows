import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Finding } from './types.js'

function fieldForFinding(finding: Finding): string | undefined {
  if (finding.ruleId.startsWith('manifest-description-')) return 'description'

  switch (finding.ruleId) {
    case 'manifest-id-banned-word':
      return 'id'
    case 'manifest-disallowed-name':
    case 'manifest-name-too-long':
    case 'manifest-name-all-caps':
      return 'name'
    case 'manifest-version-placeholder':
      return 'version'
    case 'manifest-author-placeholder':
    case 'manifest-author-email':
    case 'manifest-author-url':
      return 'author'
    case 'manifest-author-url-own-repo':
    case 'manifest-author-url-repo':
      return 'authorUrl'
    case 'manifest-is-desktop-only-type':
      return 'isDesktopOnly'
    case 'manifest-unknown-field':
      return finding.message.match(/unknown field: (.*)\.$/)?.[1]
    case 'manifest-invalid-semver':
    case 'manifest-url-invalid':
    case 'manifest-url-non-https':
    case 'manifest-url-raw-ip':
    case 'manifest-url-obsidian':
      return finding.message.match(/^([\w]+)/)?.[1]
    case 'manifest-invalid-field-type':
      return finding.message.match(/field ([\w]+)/)?.[1]
    default:
      return undefined
  }
}

export function locateManifestFindings(
  workspacePath: string,
  findings: Finding[]
): Finding[] {
  const source = fs.readFileSync(
    path.join(workspacePath, 'manifest.json'),
    'utf8'
  )
  const lines = source.split(/\r?\n/)

  return findings.map((finding) => {
    const field = fieldForFinding(finding)?.split('.')[0]
    if (field === undefined) return finding

    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const lineIndex = lines.findIndex((line) =>
      new RegExp(`^\\s*"${escapedField}"\\s*:`).test(line)
    )
    if (lineIndex < 0) return finding

    return {
      ...finding,
      location: { file: 'manifest.json', startLine: lineIndex + 1 }
    }
  })
}
