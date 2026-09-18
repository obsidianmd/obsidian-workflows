import * as core from '@actions/core'
import type { Finding, ProjectType, RunMode } from './types.js'

const DEFERRED_PLUGIN_CHECKS = [
  [
    'plugin-releases',
    'Published release and build verification require release metadata'
  ],
  ['plugin-network', 'partial — advisory, authoritative scan runs at release'],
  ['plugin-behavior', 'partial — advisory, authoritative scan runs at release'],
  ['plugin-es5', 'partial — advisory, authoritative scan runs at release'],
  ['plugin-obfuscation', 'Private thresholds; only partial parity is possible'],
  ['plugin-wasm', 'partial — advisory, authoritative scan runs at release'],
  ['plugin-funding', 'Analyzes the published main.js bundle']
] as const

const ACTION_VERSION = '1.0.0'
const CATALOG_VERSION = 'eslint-plugin-obsidianmd@0.4.1; local-rules@1'

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function locationText(finding: Finding): string {
  if (!finding.location) return '—'
  const line = finding.location.startLine
    ? `:${finding.location.startLine}`
    : ''
  return `${finding.location.file}${line}`
}

function remediation(finding: Finding): string {
  if (finding.helpUrl) {
    return `[Documentation](${finding.helpUrl})`
  }
  return finding.helpMessage ?? '—'
}

export async function writeJobSummary(
  findings: Finding[],
  mode: RunMode,
  projectType: ProjectType,
  strict: boolean
): Promise<void> {
  const failed = findings.filter((finding) => finding.status === 'failed')
  const errors = failed.filter((finding) => finding.severity === 'error').length
  const warnings = failed.filter(
    (finding) => finding.severity === 'warning'
  ).length
  const recommendations = failed.filter(
    (finding) => finding.severity === 'recommendation'
  ).length
  const inconclusive = findings.filter(
    (finding) => finding.status === 'inconclusive'
  ).length
  const overall =
    errors > 0 ? 'Failed' : inconclusive > 0 ? 'Inconclusive' : 'Passed'

  let markdown = '# Obsidian workflow results\n\n'
  markdown += strict
    ? '**Strict mode:** policy enforcement is active; policy errors fail the build.\n\n'
    : '**Advisory mode:** policy findings are reported as warnings. Set `strict: true` to fail the build on them.\n\n'
  markdown += `**Overall:** ${overall} · **Errors:** ${errors} · **Warnings:** ${warnings} · **Recommendations:** ${recommendations} · **Inconclusive:** ${inconclusive}\n\n`

  for (const check of [...new Set(findings.map((finding) => finding.check))]) {
    markdown += `## ${check}\n\n`
    markdown +=
      '| Rule ID | Severity | Status | Location | Message | Remediation |\n'
    markdown += '| --- | --- | --- | --- | --- | --- |\n'
    for (const finding of findings.filter((item) => item.check === check)) {
      markdown += `| ${escapeCell(finding.ruleId)} | ${finding.severity} | ${finding.status} | ${escapeCell(locationText(finding))} | ${escapeCell(finding.message)} | ${escapeCell(remediation(finding))} |\n`
    }
    markdown += '\n'
  }

  markdown += '## Coverage\n\n'
  markdown += '| Check | Coverage | Reason |\n'
  markdown += '| --- | --- | --- |\n'
  markdown +=
    '| Repository and manifest checks | Checked here | Source files are available in this run |\n'
  markdown +=
    '| Community scanner parity | Partial | Public rules only; private heuristics are unavailable |\n'

  if (mode === 'pr' && projectType === 'plugin') {
    for (const [task, reason] of DEFERRED_PLUGIN_CHECKS) {
      const coverage = reason.startsWith('partial')
        ? 'Partial'
        : 'Deferred to release'
      markdown += `| ${task} | ${coverage} | ${reason} |\n`
    }
  }
  if (mode === 'pr' && projectType === 'theme') {
    markdown +=
      '| theme-screenshot | Deferred | requires directory submission context |\n'
  }

  markdown += '\n'
  markdown +=
    'These checks mirror a subset of the community directory scanner. Passing here does **not** guarantee directory acceptance.'
  if (mode === 'pr' && projectType === 'plugin') {
    markdown +=
      ' Some checks remain fully deferred until a published release exists.'
  } else if (mode === 'pr') {
    markdown += ' Release-only checks did not run.'
  }
  markdown += '\n\n'
  markdown += `Action version: ${ACTION_VERSION} · Rule-catalog version: ${CATALOG_VERSION}\n`

  core.summary.addRaw(markdown)
  await core.summary.write()
}
