import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  validatePluginManifest,
  validateThemeManifest,
  validateVersionsJson,
  validateManifest
} from '../src/manifest.js'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-test-'))
}

describe('validatePluginManifest', () => {
  const validPlugin = {
    id: 'my-tool',
    name: 'My Tool',
    version: '1.0.0',
    description: 'Provides useful tools for managing notes.',
    minAppVersion: '1.0.0',
    author: 'Jane Developer',
    isDesktopOnly: false
  }

  it('returns no errors for valid manifest', () => {
    const results = validatePluginManifest({
      id: 'my-tool',
      name: 'My Tool',
      version: '1.0.0',
      description: 'A great plugin for doing things'
    })
    expect(results.filter((r) => r.severity === 'error')).toHaveLength(0)
  })

  it('errors on missing id', () => {
    const results = validatePluginManifest({
      id: '',
      name: 'My Plugin',
      version: '1.0.0',
      description: 'A great plugin'
    })
    expect(results.some((r) => r.message.includes('id'))).toBe(true)
  })

  it('errors on invalid semver version', () => {
    const results = validatePluginManifest({
      id: 'my-tool',
      name: 'My Plugin',
      version: 'not-semver',
      description: 'A great plugin'
    })
    expect(results.some((r) => r.message.includes('not valid semver'))).toBe(
      true
    )
  })

  it('errors when name contains "obsidian"', () => {
    const results = validatePluginManifest({
      id: 'my-tool',
      name: 'Obsidian Helper',
      version: '1.0.0',
      description: 'A great plugin for doing things'
    })
    expect(
      results.some(
        (r) => r.severity === 'error' && r.message.includes('obsidian')
      )
    ).toBe(true)
  })

  it('errors when name contains "plugin"', () => {
    const results = validatePluginManifest({
      id: 'my-tool',
      name: 'Helper Plugin',
      version: '1.0.0',
      description: 'A great plugin for doing things'
    })
    expect(
      results.some(
        (r) => r.severity === 'error' && r.message.includes('plugin')
      )
    ).toBe(true)
  })

  it('warns on short description', () => {
    const results = validatePluginManifest({
      id: 'my-tool',
      name: 'My Tool',
      version: '1.0.0',
      description: 'Short'
    })
    expect(
      results.some(
        (r) => r.severity === 'warning' && r.message.includes('too short')
      )
    ).toBe(true)
  })

  it('errors on invalid authorUrl', () => {
    const results = validatePluginManifest({
      id: 'my-tool',
      name: 'My Tool',
      version: '1.0.0',
      description: 'A great plugin for doing things',
      authorUrl: 'not-a-url'
    })
    expect(
      results.some(
        (r) => r.severity === 'error' && r.message.includes('authorUrl')
      )
    ).toBe(true)
  })

  it('validates object fundingUrl entries', () => {
    const results = validatePluginManifest({
      id: 'my-tool',
      name: 'My Tool',
      version: '1.0.0',
      description: 'A great plugin for doing things',
      fundingUrl: { 'Buy Me a Coffee': 'not-a-url' }
    })
    expect(results.some((r) => r.message.includes('fundingUrl'))).toBe(true)
  })

  it('warns when the plugin name exceeds 50 characters', () => {
    const results = validatePluginManifest({
      ...validPlugin,
      name: 'A'.repeat(51)
    })
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-name-too-long',
        severity: 'warning'
      })
    )
  })

  it('warns when the plugin name is all caps', () => {
    const results = validatePluginManifest({
      ...validPlugin,
      name: 'DARK MODE'
    })
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-name-all-caps',
        severity: 'warning'
      })
    )
  })

  it('does not flag a capitalized plugin name with one uppercase letter', () => {
    const results = validatePluginManifest({ ...validPlugin, name: 'Dark' })
    expect(results.some((r) => r.ruleId === 'manifest-name-all-caps')).toBe(
      false
    )
  })

  it.each([
    ['manifest-description-equals-name', 'MY TOOL', 'error'],
    [
      'manifest-description-starts-with-name',
      'My Tool makes note management easier.',
      'warning'
    ],
    [
      'manifest-description-self-reference',
      'This plugin makes note management easier.',
      'warning'
    ],
    ['manifest-description-too-long', `${'a'.repeat(251)}.`, 'error'],
    [
      'manifest-description-punctuation',
      'Provides useful note management tools',
      'warning'
    ],
    [
      'manifest-description-brand-name',
      'Provides useful tools for Obsidian users.',
      'error'
    ]
  ])('reports %s', (ruleId, description, severity) => {
    const results = validatePluginManifest({ ...validPlugin, description })
    expect(results).toContainEqual(
      expect.objectContaining({ ruleId, severity })
    )
  })

  it('rejects the placeholder version', () => {
    const results = validatePluginManifest({ ...validPlugin, version: '0.0.0' })
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-version-placeholder',
        severity: 'error'
      })
    )
  })

  it.each([
    ['Your Name', 'manifest-author-placeholder'],
    ['developer@example.com', 'manifest-author-email'],
    ['Developer https://example.com', 'manifest-author-url']
  ])('rejects invalid author value %s', (author, ruleId) => {
    const results = validatePluginManifest({ ...validPlugin, author })
    expect(results).toContainEqual(
      expect.objectContaining({ ruleId, severity: 'error' })
    )
  })

  it('rejects a non-boolean isDesktopOnly value', () => {
    const results = validatePluginManifest({
      ...validPlugin,
      isDesktopOnly: 'false'
    })
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-is-desktop-only-type',
        severity: 'error'
      })
    )
  })

  it('warns about unknown plugin manifest fields', () => {
    const results = validatePluginManifest({ ...validPlugin, extra: true })
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-unknown-field',
        severity: 'warning',
        message: expect.stringContaining('extra')
      })
    )
  })

  it('warns for each missing recommended field', () => {
    const results = validatePluginManifest({
      id: validPlugin.id,
      name: validPlugin.name,
      version: validPlugin.version,
      description: validPlugin.description
    }).filter(
      (result) => result.ruleId === 'manifest-missing-recommended-field'
    )
    expect(results).toHaveLength(3)
    expect(results.every((result) => result.severity === 'warning')).toBe(true)
  })

  it.each([
    ['not a url', 'manifest-url-invalid'],
    ['http://example.com', 'manifest-url-non-https'],
    ['https://192.168.1.2', 'manifest-url-raw-ip'],
    ['https://www.obsidian.md/about', 'manifest-url-obsidian']
  ])('reports %s as %s', (authorUrl, ruleId) => {
    const results = validatePluginManifest({ ...validPlugin, authorUrl })
    expect(results).toContainEqual(
      expect.objectContaining({ ruleId, severity: 'error' })
    )
  })

  it('warns when authorUrl points to the plugin own GitHub repository', () => {
    const previousRepository = process.env.GITHUB_REPOSITORY
    process.env.GITHUB_REPOSITORY = 'owner/my-tool'
    const results = validatePluginManifest({
      ...validPlugin,
      authorUrl: 'https://github.com/owner/my-tool'
    })
    if (previousRepository === undefined) delete process.env.GITHUB_REPOSITORY
    else process.env.GITHUB_REPOSITORY = previousRepository
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-author-url-own-repo',
        severity: 'warning'
      })
    )
  })

  it('warns when authorUrl points to any GitHub repository', () => {
    const results = validatePluginManifest({
      ...validPlugin,
      authorUrl: 'https://github.com/someone/project'
    })
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-author-url-repo',
        severity: 'warning'
      })
    )
  })

  it('applies URL checks to string and object funding URLs', () => {
    const stringResults = validatePluginManifest({
      ...validPlugin,
      fundingUrl: 'http://example.com'
    })
    const objectResults = validatePluginManifest({
      ...validPlugin,
      fundingUrl: { Sponsor: 'https://obsidian.md/pricing' }
    })
    expect(
      stringResults.some((r) => r.ruleId === 'manifest-url-non-https')
    ).toBe(true)
    expect(
      objectResults.some((r) => r.ruleId === 'manifest-url-obsidian')
    ).toBe(true)
  })

  it('accepts https://example.com for author and funding URLs', () => {
    const results = validatePluginManifest({
      ...validPlugin,
      authorUrl: 'https://example.com',
      fundingUrl: {
        Sponsor: 'https://example.com',
        Donate: 'https://example.com/donate'
      }
    })
    expect(results.some((r) => r.ruleId.startsWith('manifest-url-'))).toBe(
      false
    )
  })
})

describe('validateThemeManifest', () => {
  const validTheme = {
    name: 'My Theme',
    version: '1.0.0',
    minAppVersion: '1.0.0',
    author: 'Jane Developer'
  }

  it('returns no errors for valid manifest', () => {
    const results = validateThemeManifest(validTheme)
    expect(results.filter((r) => r.severity === 'error')).toHaveLength(0)
  })

  it('errors on missing name', () => {
    const results = validateThemeManifest({
      version: '1.0.0',
      minAppVersion: '1.0.0',
      author: 'Jane Developer'
    })
    expect(results.some((r) => r.message.includes('name'))).toBe(true)
  })

  it('errors on missing version', () => {
    const results = validateThemeManifest({
      name: 'My Theme',
      minAppVersion: '1.0.0',
      author: 'Jane Developer'
    })
    expect(results.some((r) => r.message.includes('version'))).toBe(true)
  })

  it('errors on invalid semver version', () => {
    const results = validateThemeManifest({
      ...validTheme,
      version: 'bad'
    })
    expect(results.some((r) => r.message.includes('not valid semver'))).toBe(
      true
    )
  })

  it('D-1 reports missing author and minAppVersion as two required-field errors', () => {
    const results = validateThemeManifest({
      name: 'My Theme',
      version: '1.0.0'
    })
    const errors = results.filter((result) => result.severity === 'error')

    expect(errors).toHaveLength(2)
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'manifest-missing-required-field',
          message: expect.stringContaining('author')
        }),
        expect.objectContaining({
          ruleId: 'manifest-missing-required-field',
          message: expect.stringContaining('minAppVersion')
        })
      ])
    )
  })

  it('D-2 accepts all required theme manifest fields', () => {
    const results = validateThemeManifest(validTheme)

    expect(
      results.filter((result) => result.severity === 'error')
    ).toHaveLength(0)
  })

  it('D-3 warns when the theme name exceeds 50 characters', () => {
    const results = validateThemeManifest({
      ...validTheme,
      name: 'a'.repeat(51)
    })

    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-name-too-long',
        severity: 'warning'
      })
    )
  })

  it('D-4 warns when the theme name is all caps', () => {
    const results = validateThemeManifest({ ...validTheme, name: 'DARK THEME' })

    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-name-all-caps',
        severity: 'warning'
      })
    )
  })

  it('D-5 does not flag a capitalized name with one uppercase letter', () => {
    const results = validateThemeManifest({ ...validTheme, name: 'Dark' })

    expect(
      results.some((result) => result.ruleId === 'manifest-name-all-caps')
    ).toBe(false)
  })

  it('D-6 rejects the placeholder version', () => {
    const results = validateThemeManifest({ ...validTheme, version: '0.0.0' })

    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-version-placeholder',
        severity: 'error'
      })
    )
  })

  it('D-7 rejects a placeholder author case-insensitively', () => {
    const results = validateThemeManifest({
      ...validTheme,
      author: 'Your Name'
    })

    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-author-placeholder',
        severity: 'error'
      })
    )
  })

  it('D-8 rejects an email address in author', () => {
    const results = validateThemeManifest({
      ...validTheme,
      author: 'me@example.com'
    })

    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-author-email',
        severity: 'error'
      })
    )
  })

  it('D-9 rejects an HTTP or HTTPS URL in author', () => {
    const results = validateThemeManifest({
      ...validTheme,
      author: 'https://example.com'
    })

    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-author-url',
        severity: 'error'
      })
    )
  })

  it('D-10 warns about unknown top-level fields', () => {
    const results = validateThemeManifest({ ...validTheme, foo: 1 })

    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-unknown-field',
        severity: 'warning',
        message: expect.stringContaining('foo')
      })
    )
  })

  it('D-11 does not report cover, screenshot, or thumbnail findings', () => {
    const results = validateThemeManifest(validTheme)

    expect(JSON.stringify(results)).not.toMatch(/cover|screenshot|thumbnail/i)
  })
})

describe('validateVersionsJson', () => {
  it('returns empty when versions.json does not exist', () => {
    const dir = createTempDir()
    expect(validateVersionsJson(dir)).toHaveLength(0)
    fs.rmSync(dir, { recursive: true })
  })

  it('returns error for invalid JSON', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'versions.json'), 'not json')
    const results = validateVersionsJson(dir)
    expect(results.some((r) => r.message.includes('not valid JSON'))).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it('returns error when versions.json is an array', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'versions.json'), '[]')
    const results = validateVersionsJson(dir)
    expect(results.some((r) => r.message.includes('JSON object'))).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it('returns no warnings for valid versions.json', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'versions.json'),
      JSON.stringify({ '1.0.0': '0.15.0', '1.1.0': '0.16.0' })
    )
    expect(validateVersionsJson(dir)).toHaveLength(0)
    fs.rmSync(dir, { recursive: true })
  })

  it('warns on invalid semver keys', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'versions.json'),
      JSON.stringify({ latest: '0.15.0' })
    )
    const results = validateVersionsJson(dir)
    expect(results.some((r) => r.message.includes('"latest"'))).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })
})

describe('validateManifest', () => {
  it('errors when manifest.json is missing', () => {
    const dir = createTempDir()
    const results = validateManifest(dir, 'plugin')
    expect(results.some((r) => r.message.includes('not found'))).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it('validates plugin manifest end-to-end', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'test-tool',
        name: 'Test',
        version: '1.0.0',
        description: 'A sufficiently long description for testing'
      })
    )
    const results = validateManifest(dir, 'plugin')
    expect(results.filter((r) => r.severity === 'error')).toHaveLength(0)
    fs.rmSync(dir, { recursive: true })
  })

  it('reports a non-boolean isDesktopOnly end-to-end', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'test-tool',
        name: 'Test',
        version: '1.0.0',
        description: 'Provides useful tools for managing notes.',
        isDesktopOnly: 'false'
      })
    )
    const results = validateManifest(dir, 'plugin')
    expect(
      results.some((r) => r.ruleId === 'manifest-is-desktop-only-type')
    ).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it('locates manifest findings on their source fields', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      [
        '{',
        '  "id": "test-tool",',
        '  "name": "Test",',
        '  "version": "1.0.0",',
        '  "description": "Obsidian description that is valid otherwise.",',
        '  "author": "your name",',
        '  "mysteryField": true',
        '}'
      ].join('\n')
    )

    const results = validateManifest(dir, 'plugin')

    expect(
      results.find(
        (finding) => finding.ruleId === 'manifest-description-brand-name'
      )?.location
    ).toEqual({ file: 'manifest.json', startLine: 5 })
    expect(
      results.find(
        (finding) => finding.ruleId === 'manifest-author-placeholder'
      )?.location
    ).toEqual({ file: 'manifest.json', startLine: 6 })
    expect(
      results.find((finding) => finding.ruleId === 'manifest-unknown-field')
        ?.location
    ).toEqual({ file: 'manifest.json', startLine: 7 })
    fs.rmSync(dir, { recursive: true })
  })

  it('validates theme manifest end-to-end', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        name: 'Test Theme',
        version: '1.0.0',
        minAppVersion: '1.0.0',
        author: 'Jane Developer'
      })
    )
    const results = validateManifest(dir, 'theme')
    expect(results.filter((r) => r.severity === 'error')).toHaveLength(0)
    fs.rmSync(dir, { recursive: true })
  })
})
