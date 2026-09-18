import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { checkDependencies } from '../src/dep-checks.js'

function createWorkspace(packageJson: object): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-checks-test-'))
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify(packageJson)
  )
  return workspace
}

describe('checkDependencies', () => {
  let workspace: string

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  it.each(['*', '', 'x', 'latest', '>1.0.0', '>=2.0.0'])(
    'warns for unpinned dependency specifier %s without a lockfile',
    (specifier) => {
      workspace = createWorkspace({ dependencies: { example: specifier } })

      expect(checkDependencies(workspace)).toEqual([
        expect.objectContaining({
          ruleId: 'dependency-unpinned-version',
          severity: 'warning'
        })
      ])
    }
  )

  it.each(['^1.2.3', '~1.2.3'])(
    'recommends narrowing dependency range %s without a lockfile',
    (specifier) => {
      workspace = createWorkspace({ dependencies: { example: specifier } })

      expect(checkDependencies(workspace)).toEqual([
        expect.objectContaining({
          ruleId: 'dependency-broad-range',
          severity: 'recommendation'
        })
      ])
    }
  )

  it('suppresses the same dependency findings when a lockfile exists', () => {
    workspace = createWorkspace({
      dependencies: { unpinned: '*', broad: '^1.0.0' }
    })

    expect(checkDependencies(workspace)).toHaveLength(2)
    fs.writeFileSync(path.join(workspace, 'package-lock.json'), '{}')
    expect(checkDependencies(workspace)).toEqual([])
  })

  it('ignores devDependencies and bounded dependency versions', () => {
    workspace = createWorkspace({
      dependencies: { exact: '1.2.3', bounded: '>=1.0.0 <2.0.0' },
      devDependencies: { developmentOnly: '*' }
    })

    expect(checkDependencies(workspace)).toEqual([])
  })

  it('returns no findings when package.json is unavailable or invalid', () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-checks-test-'))
    expect(checkDependencies(workspace)).toEqual([])
    fs.writeFileSync(path.join(workspace, 'package.json'), 'not json')
    expect(checkDependencies(workspace)).toEqual([])
  })
})
