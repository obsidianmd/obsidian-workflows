import { jest } from '@jest/globals'
import * as fs from 'node:fs'
import * as core from '../__fixtures__/core.js'

const existsSyncMock = jest.fn<typeof fs.existsSync>()
const readFileSyncMock = jest.fn<typeof fs.readFileSync>()
const execMock = jest.fn<typeof import('@actions/exec').exec>()
const attestMock = jest.fn<typeof import('@actions/attest').attest>()
const predicateMock =
  jest.fn<typeof import('@actions/attest').buildSLSAProvenancePredicate>()
const readManifestMock = jest.fn<() => unknown>()
const githubContext = {
  payload: { repository: { visibility: 'public' } }
}

jest.unstable_mockModule('node:fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock
}))
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/exec', () => ({ exec: execMock }))
jest.unstable_mockModule('@actions/attest', () => ({
  attest: attestMock,
  buildSLSAProvenancePredicate: predicateMock
}))
jest.unstable_mockModule('@actions/github', () => ({ context: githubContext }))
jest.unstable_mockModule('../src/detect.js', () => ({
  readManifest: readManifestMock
}))

const {
  validateReleaseAssets,
  validateManifestConsistency,
  attestBuildArtifacts,
  createDraftRelease
} = await import('../src/release.js')

describe('release validation', () => {
  beforeEach(() => {
    existsSyncMock.mockReturnValue(false)
    readFileSyncMock.mockReturnValue(Buffer.from('artifact'))
    readManifestMock.mockReturnValue(null)
    githubContext.payload.repository.visibility = 'public'
    delete process.env.GITHUB_REF
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL
    delete process.env.GITHUB_TOKEN
  })

  it('accepts present plugin assets including optional styles.css', () => {
    existsSyncMock.mockReturnValue(true)
    expect(validateReleaseAssets('/workspace', 'plugin')).toEqual([])
  })

  it('reports missing plugin main.js and manifest.json', () => {
    expect(
      validateReleaseAssets('/workspace', 'plugin').map(({ ruleId }) => ruleId)
    ).toEqual([
      'release-asset-main-js-missing',
      'release-asset-manifest-missing'
    ])
  })

  it('accepts present theme.css and manifest.json', () => {
    existsSyncMock.mockReturnValue(true)
    expect(validateReleaseAssets('/workspace', 'theme')).toEqual([])
  })

  it('reports missing theme.css and manifest.json', () => {
    expect(
      validateReleaseAssets('/workspace', 'theme').map(({ ruleId }) => ruleId)
    ).toEqual([
      'release-asset-theme-css-missing',
      'release-asset-manifest-missing'
    ])
  })

  it('accepts a manifest version matching the tag', () => {
    process.env.GITHUB_REF = 'refs/tags/1.2.3'
    readManifestMock.mockReturnValue({ version: '1.2.3' })
    expect(validateManifestConsistency('/workspace')).toEqual([])
  })

  it('reports a manifest version that differs from the tag', () => {
    process.env.GITHUB_REF = 'refs/tags/1.2.3'
    readManifestMock.mockReturnValue({ version: '2.0.0' })
    expect(validateManifestConsistency('/workspace')[0]).toMatchObject({
      ruleId: 'release-manifest-version-mismatch',
      status: 'failed'
    })
  })

  it('skips consistency without a tag or a readable manifest', () => {
    expect(validateManifestConsistency('/workspace')).toEqual([])
    process.env.GITHUB_REF = 'refs/tags/1.2.3'
    readManifestMock.mockReturnValue(null)
    expect(validateManifestConsistency('/workspace')).toEqual([])
  })
})

describe('artifact attestation', () => {
  beforeEach(() => {
    existsSyncMock.mockReturnValue(false)
    readFileSyncMock.mockReturnValue(Buffer.from('artifact'))
    githubContext.payload.repository.visibility = 'public'
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL
    delete process.env.GITHUB_TOKEN
  })

  it('reports when there are no artifacts', async () => {
    await expect(attestBuildArtifacts('/workspace', 'plugin')).resolves.toEqual(
      [expect.objectContaining({ ruleId: 'release-attestation-no-artifacts' })]
    )
  })

  it('reports a missing ID token permission', async () => {
    existsSyncMock.mockReturnValue(true)
    await expect(attestBuildArtifacts('/workspace', 'theme')).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'release-attestation-missing-id-token'
      })
    ])
  })

  it('reports a missing GitHub token', async () => {
    existsSyncMock.mockReturnValue(true)
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://token.example'
    await expect(attestBuildArtifacts('/workspace', 'theme')).resolves.toEqual([
      expect.objectContaining({ ruleId: 'release-attestation-missing-token' })
    ])
  })

  it('attests plugin main.js and styles.css successfully', async () => {
    existsSyncMock.mockReturnValue(true)
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://token.example'
    process.env.GITHUB_TOKEN = 'token'
    predicateMock.mockResolvedValue({ type: 'predicate-type', params: {} })
    attestMock.mockResolvedValue({
      attestationID: 'attestation-id',
      attestationURL: 'https://example.test/attestation',
      bundle: {
        mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
        verificationMaterial: {
          x509CertificateChain: { certificates: [] },
          publicKey: undefined,
          certificate: undefined,
          tlogEntries: [],
          timestampVerificationData: undefined
        },
        dsseEnvelope: { payload: '', payloadType: '', signatures: [] },
        messageSignature: undefined
      }
    })

    await expect(attestBuildArtifacts('/workspace', 'plugin')).resolves.toEqual(
      []
    )
    expect(attestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subjects: [
          expect.objectContaining({ name: 'main.js' }),
          expect.objectContaining({ name: 'styles.css' })
        ],
        sigstore: 'public-good',
        token: 'token'
      })
    )
  })

  it('returns a finding when attestation throws', async () => {
    existsSyncMock.mockReturnValue(true)
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://token.example'
    process.env.GITHUB_TOKEN = 'token'
    githubContext.payload.repository.visibility = 'private'
    predicateMock.mockRejectedValue(new Error('service unavailable'))

    await expect(attestBuildArtifacts('/workspace', 'theme')).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'release-attestation-failed',
        message: expect.stringContaining('service unavailable')
      })
    ])
  })
})

describe('draft release creation', () => {
  beforeEach(() => {
    existsSyncMock.mockReturnValue(false)
    delete process.env.GITHUB_REF
  })

  it('requires a tag ref', async () => {
    await expect(createDraftRelease('/workspace', 'plugin')).resolves.toEqual([
      expect.objectContaining({ ruleId: 'release-tag-required' })
    ])
    expect(execMock).not.toHaveBeenCalled()
  })

  it('creates a plugin draft with styles.css and sets release-url', async () => {
    process.env.GITHUB_REF = 'refs/tags/1.2.3'
    existsSyncMock.mockReturnValue(true)
    execMock.mockImplementation(async (_command, _args, options) => {
      options?.listeners?.stdout?.(
        Buffer.from('https://github.com/example/releases/tag/1.2.3\n')
      )
      return 0
    })

    await expect(createDraftRelease('/workspace', 'plugin')).resolves.toEqual(
      []
    )
    expect(execMock).toHaveBeenCalledWith(
      'gh',
      [
        'release',
        'create',
        '1.2.3',
        '--title',
        '1.2.3',
        '--draft',
        'manifest.json',
        'main.js',
        'styles.css'
      ],
      expect.objectContaining({ cwd: '/workspace' })
    )
    expect(core.setOutput).toHaveBeenCalledWith(
      'release-url',
      'https://github.com/example/releases/tag/1.2.3'
    )
  })

  it('creates a theme draft with theme.css', async () => {
    process.env.GITHUB_REF = 'refs/tags/1.2.3'
    execMock.mockResolvedValue(0)
    await createDraftRelease('/workspace', 'theme')
    expect(execMock.mock.calls[0]?.[1]).toContain('theme.css')
  })

  it('reports a non-zero gh exit code', async () => {
    process.env.GITHUB_REF = 'refs/tags/1.2.3'
    execMock.mockResolvedValue(7)
    await expect(createDraftRelease('/workspace', 'plugin')).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'release-draft-creation-failed',
        message: expect.stringContaining('exit code 7')
      })
    ])
  })
})
