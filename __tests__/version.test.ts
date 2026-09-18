import * as fs from 'node:fs'
import * as path from 'node:path'
import { ACTION_VERSION } from '../src/summary.js'

describe('action version', () => {
  it('matches the version in package.json', () => {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'package.json'),
      'utf8'
    )
    const pkg: unknown = JSON.parse(raw)
    const version =
      typeof pkg === 'object' && pkg !== null && 'version' in pkg
        ? (pkg as { version: unknown }).version
        : undefined

    expect(version).toBe(ACTION_VERSION)
  })
})
