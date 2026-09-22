import { jest } from '@jest/globals'
import * as fs from 'node:fs'
import * as path from 'node:path'

const existsSyncMock = jest.fn<typeof fs.existsSync>()
const readFileSyncMock = jest.fn<typeof fs.readFileSync>()

jest.unstable_mockModule('node:fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock
}))

const { checkArtifactBundle } = await import('../src/artifact-checks.js')

describe('artifact preflight', () => {
  beforeEach(() => {
    existsSyncMock.mockReturnValue(false)
  })

  it('skips themes and plugins without a built bundle', () => {
    expect(checkArtifactBundle('/workspace', 'theme')[0].status).toBe('skipped')
    expect(checkArtifactBundle('/workspace', 'plugin')[0].status).toBe(
      'skipped'
    )
    expect(readFileSyncMock).not.toHaveBeenCalled()
  })

  it('reads the first available bundle once and reports all detectors', () => {
    existsSyncMock.mockImplementation(
      (file) => file === path.join('/workspace', 'dist/main.js')
    )
    readFileSyncMock.mockReturnValue(
      '__awaiter __generator __spreadArray AGFzAAAAAAA= module.wasm ' +
        'fetch("https://api.example.com/data") requestUrl(`https://api.example.com/again`) ' +
        'ajax("https://cdn.example.org/file") navigator.sendBeacon("/event") ' +
        'const tls = { rejectUnauthorized: false }'
    )

    const findings = checkArtifactBundle('/workspace', 'plugin')

    expect(readFileSyncMock).toHaveBeenCalledTimes(1)
    expect(findings.map(({ ruleId }) => ruleId)).toEqual([
      'bundle-es5-helpers',
      'bundle-inline-wasm',
      'bundle-wasm-reference',
      'bundle-external-domain',
      'bundle-send-beacon',
      'bundle-tls-verification-disabled'
    ])
    expect(findings.every(({ coverage }) => coverage === 'partial')).toBe(true)
    expect(
      findings.every(
        ({ helpMessage }) =>
          helpMessage?.includes('authoritative scan runs at release') &&
          helpMessage.includes('third-party package')
      )
    ).toBe(true)
    expect(findings[3].message.match(/api\.example\.com/g)).toHaveLength(1)
  })

  it('scans bundles containing a large inline base64 payload', () => {
    existsSyncMock.mockImplementation(
      (file) => file === path.join('/workspace', 'main.js')
    )
    readFileSyncMock.mockReturnValue(
      `const mod = load("AGFzbQEAAAA${'A'.repeat(600_000)}")\n` +
        'const parser = await import("./web-tree-sitter.wasm")'
    )

    const startedAt = Date.now()
    const findings = checkArtifactBundle('/workspace', 'plugin')

    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(
      findings.find(({ ruleId }) => ruleId === 'bundle-wasm-reference')?.message
    ).toContain('./web-tree-sitter.wasm')
  })

  it('caps the deduplicated external domain list at twenty', () => {
    existsSyncMock.mockImplementation(
      (file) => file === path.join('/workspace', 'main.js')
    )
    const calls = Array.from(
      { length: 25 },
      (_, index) => `fetch("https://host${index}.example/path")`
    )
    readFileSyncMock.mockReturnValue(calls.join('\n'))

    const finding = checkArtifactBundle('/workspace', 'plugin')[0]
    expect(finding.ruleId).toBe('bundle-external-domain')
    expect(finding.message).toContain('host19.example')
    expect(finding.message).not.toContain('host20.example')
  })
})
