import * as fs from 'node:fs'
import * as path from 'node:path'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { hasPackageJson, ensureUserDeps } from './deps.js'
import type { Finding, ProjectType } from './types.js'

const BUILD_SCRIPTS_PRIORITY = ['build', 'build:plugin', 'compile']

function detectBuildScript(workspacePath: string): string | null {
  const pkgPath = path.join(workspacePath, 'package.json')
  if (!fs.existsSync(pkgPath)) return null

  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw) as Record<string, unknown>
    const scripts = pkg.scripts as Record<string, string> | undefined
    if (!scripts) return null

    for (const scriptName of BUILD_SCRIPTS_PRIORITY) {
      if (scripts[scriptName]) return scriptName
    }
  } catch {
    /* invalid package.json — no build script to detect */
  }

  return null
}

export async function runBuild(
  workspacePath: string,
  projectType: ProjectType,
  explicitBuildCommand: string
): Promise<Finding[]> {
  const results: Finding[] = []

  if (explicitBuildCommand === 'false') {
    core.info('Build step disabled via input.')
    return results
  }

  let buildCommand: string | null = null

  if (explicitBuildCommand) {
    buildCommand = explicitBuildCommand
  } else if (projectType === 'plugin' && hasPackageJson(workspacePath)) {
    const detected = detectBuildScript(workspacePath)
    if (detected) {
      buildCommand = `npm run ${detected}`
      core.info(`Auto-detected build script: "${detected}"`)
    }
  }

  if (!buildCommand) {
    if (projectType === 'plugin' && hasPackageJson(workspacePath)) {
      core.info(
        'No build script found (checked: build, build:plugin, compile). Skipping build.'
      )
    }
    return results
  }

  const installed = await ensureUserDeps(workspacePath)
  if (!installed) {
    results.push({
      ruleId: 'build-dependency-install-failed',
      enforcement: 'correctness',
      message: 'Dependency installation failed.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'build'
    })
    return results
  }

  core.info(`Running build: ${buildCommand}`)
  const [cmd, ...args] = buildCommand.split(' ')
  const exitCode = await exec.exec(cmd, args, {
    cwd: workspacePath,
    ignoreReturnCode: true
  })

  if (exitCode !== 0) {
    results.push({
      ruleId: 'build-command-failed',
      enforcement: 'correctness',
      message: `Build failed (exit code ${exitCode}). Command: "${buildCommand}".`,
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'build'
    })
  }

  return results
}
