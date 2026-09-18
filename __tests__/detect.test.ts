import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  detectProjectType,
  isPluginManifest,
  isThemeManifest,
  readManifest
} from '../src/detect.js'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-test-'))
}

describe('isPluginManifest', () => {
  it('returns true for valid plugin manifest', () => {
    expect(
      isPluginManifest({
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
        description: 'A great plugin'
      })
    ).toBe(true)
  })

  it('returns true with optional fields', () => {
    expect(
      isPluginManifest({
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
        description: 'A great plugin',
        author: 'Author',
        minAppVersion: '0.15.0',
        authorUrl: 'https://example.com',
        fundingUrl: 'https://buymeacoffee.com/author',
        isDesktopOnly: false
      })
    ).toBe(true)
  })

  it('returns true with object fundingUrl', () => {
    expect(
      isPluginManifest({
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
        description: 'A great plugin',
        fundingUrl: { 'Buy Me a Coffee': 'https://buymeacoffee.com/author' }
      })
    ).toBe(true)
  })

  it('returns false without id', () => {
    expect(
      isPluginManifest({
        name: 'My Plugin',
        version: '1.0.0',
        description: 'A great plugin'
      })
    ).toBe(false)
  })

  it('returns false without description', () => {
    expect(
      isPluginManifest({
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0'
      })
    ).toBe(false)
  })

  it('returns false for null', () => {
    expect(isPluginManifest(null)).toBe(false)
  })

  it('returns false for non-object', () => {
    expect(isPluginManifest('string')).toBe(false)
  })
})

describe('isThemeManifest', () => {
  it('returns true for valid theme manifest', () => {
    expect(
      isThemeManifest({
        name: 'My Theme',
        version: '1.0.0',
        author: 'Author',
        minAppVersion: '0.16.0'
      })
    ).toBe(true)
  })

  it('returns true with optional fields', () => {
    expect(
      isThemeManifest({
        name: 'My Theme',
        version: '1.0.0',
        author: 'Author',
        minAppVersion: '0.16.0',
        authorUrl: 'https://example.com'
      })
    ).toBe(true)
  })

  it('returns false without name', () => {
    expect(isThemeManifest({ version: '1.0.0' })).toBe(false)
  })

  it('returns false without version', () => {
    expect(isThemeManifest({ name: 'My Theme' })).toBe(false)
  })
})

describe('readManifest', () => {
  it('returns null when manifest.json does not exist', () => {
    const dir = createTempDir()
    expect(readManifest(dir)).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })

  it('returns parsed JSON when manifest.json exists', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        description: 'Test'
      })
    )
    const result = readManifest(dir)
    expect(result).toEqual({
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      description: 'Test'
    })
    fs.rmSync(dir, { recursive: true })
  })

  it('returns null for invalid JSON', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{invalid json}')
    expect(readManifest(dir)).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })
})

describe('detectProjectType', () => {
  it('returns explicit type when specified', () => {
    expect(detectProjectType('/tmp/nonexistent', 'plugin')).toBe('plugin')
    expect(detectProjectType('/tmp/nonexistent', 'theme')).toBe('theme')
  })

  it('detects plugin from manifest with id field', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
        description: 'Test'
      })
    )
    expect(detectProjectType(dir, 'auto')).toBe('plugin')
    fs.rmSync(dir, { recursive: true })
  })

  it('detects theme from manifest without id + theme.css', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ name: 'My Theme', version: '1.0.0' })
    )
    fs.writeFileSync(path.join(dir, 'theme.css'), 'body {}')
    expect(detectProjectType(dir, 'auto')).toBe('theme')
    fs.rmSync(dir, { recursive: true })
  })

  it('detects theme from theme.css alone when no manifest', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'theme.css'), 'body {}')
    expect(detectProjectType(dir, 'auto')).toBe('theme')
    fs.rmSync(dir, { recursive: true })
  })

  it('throws when detection fails', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ name: 'Ambiguous', version: '1.0.0' })
    )
    expect(() => detectProjectType(dir, 'auto')).toThrow(
      'Could not detect project type'
    )
    fs.rmSync(dir, { recursive: true })
  })
})
