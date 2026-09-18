import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { attest, buildSLSAProvenancePredicate } from '@actions/attest'
import * as github from '@actions/github'
import { readManifest } from './detect.js'
import type { Finding, ProjectType } from './types.js'

type SigstoreInstance = 'public-good' | 'github'

function getSigstoreInstance(): SigstoreInstance {
  return github.context.payload.repository?.visibility === 'public'
    ? 'public-good'
    : 'github'
}

function getTagFromRef(): string | null {
  const ref = process.env.GITHUB_REF ?? ''
  if (ref.startsWith('refs/tags/')) return ref.replace('refs/tags/', '')
  return null
}

function computeSha256(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

export function validateReleaseAssets(
  workspacePath: string,
  projectType: ProjectType
): Finding[] {
  const results: Finding[] = []

  if (projectType === 'plugin') {
    if (!fs.existsSync(path.join(workspacePath, 'main.js'))) {
      results.push({
        ruleId: 'release-asset-main-js-missing',
        enforcement: 'correctness',
        message:
          'Release asset main.js not found. Did the build step complete successfully?',
        severity: 'error',
        status: 'failed',
        coverage: 'partial',
        check: 'release'
      })
    }

    if (!fs.existsSync(path.join(workspacePath, 'manifest.json'))) {
      results.push({
        ruleId: 'release-asset-manifest-missing',
        enforcement: 'correctness',
        message: 'Release asset manifest.json not found.',
        severity: 'error',
        status: 'failed',
        coverage: 'partial',
        check: 'release'
      })
    }
  }

  if (projectType === 'theme') {
    if (!fs.existsSync(path.join(workspacePath, 'theme.css'))) {
      results.push({
        ruleId: 'release-asset-theme-css-missing',
        enforcement: 'correctness',
        message: 'Release asset theme.css not found.',
        severity: 'error',
        status: 'failed',
        coverage: 'partial',
        check: 'release'
      })
    }

    if (!fs.existsSync(path.join(workspacePath, 'manifest.json'))) {
      results.push({
        ruleId: 'release-asset-manifest-missing',
        enforcement: 'correctness',
        message: 'Release asset manifest.json not found.',
        severity: 'error',
        status: 'failed',
        coverage: 'partial',
        check: 'release'
      })
    }
  }

  return results
}

export function validateManifestConsistency(workspacePath: string): Finding[] {
  const results: Finding[] = []
  const tag = getTagFromRef()

  if (!tag) return results

  const manifest = readManifest(workspacePath)
  if (!manifest || typeof manifest !== 'object') return results

  const obj = manifest as Record<string, unknown>
  const manifestVersion = obj.version as string | undefined

  if (manifestVersion && manifestVersion !== tag) {
    results.push({
      ruleId: 'release-manifest-version-mismatch',
      enforcement: 'policy',
      message: `manifest.json version "${manifestVersion}" does not match the release tag "${tag}".`,
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'release'
    })
  }

  return results
}

interface ArtifactSubject {
  name: string
  filePath: string
}

function collectSubjects(
  workspacePath: string,
  projectType: ProjectType
): ArtifactSubject[] {
  const subjects: ArtifactSubject[] = []

  if (projectType === 'plugin') {
    const mainJs = path.join(workspacePath, 'main.js')
    if (fs.existsSync(mainJs))
      subjects.push({ name: 'main.js', filePath: mainJs })

    const stylesCss = path.join(workspacePath, 'styles.css')
    if (fs.existsSync(stylesCss))
      subjects.push({ name: 'styles.css', filePath: stylesCss })
  }

  if (projectType === 'theme') {
    const themeCss = path.join(workspacePath, 'theme.css')
    if (fs.existsSync(themeCss))
      subjects.push({ name: 'theme.css', filePath: themeCss })
  }

  return subjects
}

export async function attestBuildArtifacts(
  workspacePath: string,
  projectType: ProjectType
): Promise<Finding[]> {
  const results: Finding[] = []
  const subjects = collectSubjects(workspacePath, projectType)

  if (subjects.length === 0) {
    results.push({
      ruleId: 'release-attestation-no-artifacts',
      enforcement: 'policy',
      message: 'No artifacts found to attest.',
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'release'
    })
    return results
  }

  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    results.push({
      ruleId: 'release-attestation-missing-id-token',
      enforcement: 'policy',
      message:
        'Missing id-token permission. Add "permissions: id-token: write" to your workflow.',
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'release'
    })
    return results
  }

  const token = process.env.GITHUB_TOKEN ?? ''
  if (!token) {
    results.push({
      ruleId: 'release-attestation-missing-token',
      enforcement: 'policy',
      message:
        'GITHUB_TOKEN not set. Attestation requires a token with attestations:write permission.',
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'release'
    })
    return results
  }

  const sigstoreInstance = getSigstoreInstance()
  const subjectDigests = subjects.map((s) => ({
    name: s.name,
    digest: { sha256: computeSha256(s.filePath) }
  }))

  core.info(
    `Attesting build artifacts: ${subjects.map((s) => s.name).join(', ')}`
  )
  core.info(`Sigstore instance: ${sigstoreInstance}`)

  try {
    const predicate = await buildSLSAProvenancePredicate()

    const attestation = await attest({
      subjects: subjectDigests,
      predicateType: predicate.type,
      predicate: predicate.params,
      sigstore: sigstoreInstance,
      token
    })

    core.info(`Attestation created (ID: ${attestation.attestationID})`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    results.push({
      ruleId: 'release-attestation-failed',
      enforcement: 'policy',
      message: `Attestation failed: ${message}. Ensure the workflow has id-token:write and attestations:write permissions.`,
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'release'
    })
  }

  return results
}

export async function createDraftRelease(
  workspacePath: string,
  projectType: ProjectType
): Promise<Finding[]> {
  const results: Finding[] = []
  const tag = getTagFromRef()

  if (!tag) {
    results.push({
      ruleId: 'release-tag-required',
      enforcement: 'correctness',
      message:
        'Cannot create release: not triggered by a tag push (GITHUB_REF does not start with refs/tags/).',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'release'
    })
    return results
  }

  const releaseAssets: string[] = ['manifest.json']

  if (projectType === 'plugin') {
    releaseAssets.push('main.js')
    if (fs.existsSync(path.join(workspacePath, 'styles.css'))) {
      releaseAssets.push('styles.css')
    }
  }

  if (projectType === 'theme') {
    releaseAssets.push('theme.css')
  }

  core.info(`Creating draft release for tag "${tag}"...`)

  let releaseUrl = ''
  const exitCode = await exec.exec(
    'gh',
    ['release', 'create', tag, '--title', tag, '--draft', ...releaseAssets],
    {
      cwd: workspacePath,
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => {
          releaseUrl += data.toString()
        }
      }
    }
  )

  if (exitCode !== 0) {
    results.push({
      ruleId: 'release-draft-creation-failed',
      enforcement: 'correctness',
      message: `Failed to create draft release (exit code ${exitCode}).`,
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'release'
    })
  } else {
    const url = releaseUrl.trim()
    if (url) {
      core.setOutput('release-url', url)
      core.info(`Draft release created: ${url}`)
    }
  }

  return results
}
