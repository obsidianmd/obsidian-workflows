import * as core from '@actions/core'
import * as path from 'node:path'
import { detectProjectType } from './detect.js'
import { validateManifest } from './manifest.js'
import { checkLicense, checkReadme } from './repo-checks.js'
import { inspectRegistry } from './registry.js'
import { checkRepositoryMetadata } from './repo-meta.js'
import { checkDependencies } from './dep-checks.js'
import { runBuild } from './build.js'
import { checkArtifactBundle } from './artifact-checks.js'
import { runLint } from './lint.js'
import {
  validateReleaseAssets,
  validateManifestConsistency,
  attestBuildArtifacts,
  createDraftRelease
} from './release.js'
import { writeJobSummary } from './summary.js'
import type { ActionInputs, Finding, RunMode } from './types.js'

export const PR_PASS_MESSAGE =
  "All checks in this Action's PR scope passed. Release-only checks did not run."
const ADVISORY_HELP =
  'Advisory only: set `strict: true` to enforce this policy finding.'

function applyEnforcement(findings: Finding[], strict: boolean): Finding[] {
  if (strict) return findings

  return findings.map((finding) => {
    if (
      finding.enforcement !== 'policy' ||
      finding.severity !== 'error' ||
      finding.status !== 'failed'
    ) {
      return finding
    }

    return {
      ...finding,
      severity: 'warning',
      helpMessage: finding.helpMessage
        ? `${finding.helpMessage} ${ADVISORY_HELP}`
        : ADVISORY_HELP
    }
  })
}

function parseInputs(): ActionInputs {
  const typeRaw = core.getInput('type') || 'auto'
  if (typeRaw !== 'plugin' && typeRaw !== 'theme' && typeRaw !== 'auto') {
    throw new Error(
      `Invalid type input: "${typeRaw}". Must be "plugin", "theme", or "auto".`
    )
  }

  const modeRaw = core.getInput('mode') || 'pr'
  if (modeRaw !== 'pr' && modeRaw !== 'release') {
    throw new Error(
      `Invalid mode input: "${modeRaw}". Must be "pr" or "release".`
    )
  }

  const nodeVersion = core.getInput('node-version') || '24'
  const nodeVersionNum = parseInt(nodeVersion, 10)
  if (isNaN(nodeVersionNum) || nodeVersionNum < 20) {
    throw new Error(
      `Node version "${nodeVersion}" is below the minimum required version (20).`
    )
  }

  return {
    type: typeRaw as 'plugin' | 'theme' | 'auto',
    mode: modeRaw as RunMode,
    build: core.getInput('build') || '',
    lint: core.getInput('lint') !== 'false',
    scannerLint: core.getInput('scanner-lint') === 'true',
    strict: core.getInput('strict') === 'true',
    nodeVersion
  }
}

export async function run(): Promise<void> {
  try {
    const inputs = parseInputs()
    const workspacePath = process.env.GITHUB_WORKSPACE ?? process.cwd()
    const allResults: Finding[] = []

    const projectType = detectProjectType(workspacePath, inputs.type)
    core.setOutput('type', projectType)
    core.info(`Project type: ${projectType}`)

    core.startGroup('Registry checks')
    const registry = await inspectRegistry(workspacePath, projectType)
    allResults.push(...registry.findings)
    core.endGroup()

    core.startGroup('Manifest validation')
    allResults.push(
      ...validateManifest(
        workspacePath,
        projectType,
        registry.immutableIdentifierExempt
      )
    )
    core.endGroup()

    core.startGroup('Repository checks')
    allResults.push(...checkReadme(workspacePath))
    allResults.push(...checkLicense(workspacePath))
    core.endGroup()

    core.startGroup('Repository metadata')
    allResults.push(...(await checkRepositoryMetadata()))
    core.endGroup()

    core.startGroup('Dependency checks')
    allResults.push(...checkDependencies(workspacePath))
    core.endGroup()

    core.startGroup('Build')
    allResults.push(
      ...(await runBuild(workspacePath, projectType, inputs.build))
    )
    core.endGroup()

    core.startGroup('Artifact preflight')
    allResults.push(...checkArtifactBundle(workspacePath, projectType))
    core.endGroup()

    if (inputs.lint) {
      core.startGroup('Lint')
      allResults.push(
        ...(await runLint(
          workspacePath,
          projectType,
          inputs.scannerLint,
          inputs.mode
        ))
      )
      core.endGroup()
    }

    if (inputs.mode === 'release') {
      core.startGroup('Release validation')
      allResults.push(...validateReleaseAssets(workspacePath, projectType))
      allResults.push(...validateManifestConsistency(workspacePath))
      core.endGroup()
    }

    const effectiveResults = applyEnforcement(allResults, inputs.strict)

    if (inputs.mode === 'release') {
      const hasErrors = effectiveResults.some(
        (result) => result.status === 'failed' && result.severity === 'error'
      )
      if (hasErrors) {
        core.error(
          'Validation errors found. Skipping attestation and release creation.'
        )
      } else {
        core.startGroup('Attestation')
        effectiveResults.push(
          ...(await attestBuildArtifacts(workspacePath, projectType))
        )
        core.endGroup()

        core.startGroup('Draft release')
        effectiveResults.push(
          ...(await createDraftRelease(workspacePath, projectType))
        )
        core.endGroup()
      }
    }

    reportResults(effectiveResults, workspacePath, inputs.mode)
    await writeJobSummary(
      effectiveResults,
      inputs.mode,
      projectType,
      inputs.strict
    )

    const hasErrors = effectiveResults.some(
      (result) => result.status === 'failed' && result.severity === 'error'
    )
    core.setOutput('validation-passed', (!hasErrors).toString())

    if (hasErrors) {
      core.setFailed('Validation failed. See the errors above for details.')
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

export function reportResults(
  results: Finding[],
  workspacePath: string,
  mode: RunMode
): void {
  if (results.length === 0) {
    core.info(
      mode === 'pr'
        ? PR_PASS_MESSAGE
        : "All checks in this Action's release scope passed."
    )
    return
  }

  for (const result of results) {
    if (result.status === 'passed' || result.status === 'skipped') continue
    const location = result.location
      ? {
          file: path.isAbsolute(result.location.file)
            ? path.relative(workspacePath, result.location.file)
            : path.normalize(result.location.file),
          startLine: result.location.startLine,
          endLine: result.location.endLine,
          startColumn: result.location.startColumn,
          endColumn: result.location.endColumn,
          title: `${result.check}: ${result.ruleId}`
        }
      : { title: `${result.check}: ${result.ruleId}` }
    const message = `[${result.check}] ${result.message}`
    switch (result.severity) {
      case 'error':
        core.error(message, location)
        break
      case 'warning':
        core.warning(message, location)
        break
      case 'recommendation':
        core.notice(message, location)
        break
    }
  }

  const failed = results.filter((result) => result.status === 'failed')
  const errors = failed.filter((result) => result.severity === 'error').length
  const warnings = failed.filter(
    (result) => result.severity === 'warning'
  ).length
  const recommendations = failed.filter(
    (result) => result.severity === 'recommendation'
  ).length
  if (errors === 0) {
    core.info(
      mode === 'pr'
        ? PR_PASS_MESSAGE
        : "All checks in this Action's release scope passed."
    )
  }
  core.info(
    `Summary: ${errors} error(s), ${warnings} warning(s), ${recommendations} recommendation(s)`
  )
}
