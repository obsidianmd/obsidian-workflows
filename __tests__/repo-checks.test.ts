import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { checkLicense, checkReadme } from '../src/repo-checks.js'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-test-'))
}

describe('checkLicense', () => {
  it('errors when no LICENSE file exists', () => {
    const dir = createTempDir()
    const results = checkLicense(dir)
    expect(results.some((r) => r.severity === 'error')).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it('passes when LICENSE file exists', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT License...')
    const results = checkLicense(dir)
    expect(results.filter((r) => r.severity === 'error')).toHaveLength(0)
    fs.rmSync(dir, { recursive: true })
  })

  it('passes with LICENSE.md', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'LICENSE.md'), '# MIT License')
    const results = checkLicense(dir)
    expect(results.filter((r) => r.severity === 'error')).toHaveLength(0)
    fs.rmSync(dir, { recursive: true })
  })

  it('warns when package.json has non-OSI license', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'Some license text')
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ license: 'WTFPL' })
    )
    const results = checkLicense(dir)
    expect(
      results.some((r) => r.severity === 'warning' && r.message.includes('OSI'))
    ).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it('does not warn for MIT license', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT License')
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ license: 'MIT' })
    )
    const results = checkLicense(dir)
    expect(results.filter((r) => r.severity === 'warning')).toHaveLength(0)
    fs.rmSync(dir, { recursive: true })
  })
})

describe('checkReadme', () => {
  const normalReadme = `# Note Helper

Note Helper organizes project notes into clear sections and adds convenient
commands for navigating between related documents. It includes configurable
settings, keyboard shortcuts, and detailed instructions so users can adapt the
workflow to their vault without changing existing files or metadata.`

  it('errors when no README exists', () => {
    const dir = createTempDir()
    const results = checkReadme(dir)
    expect(results.some((r) => r.severity === 'error')).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it('errors when README is empty', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'README.md'), '')
    const results = checkReadme(dir)
    expect(
      results.some((r) => r.severity === 'error' && r.message.includes('empty'))
    ).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it('warns when README is very short', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'README.md'), 'Hello world')
    const results = checkReadme(dir)
    expect(
      results.some(
        (r) => r.severity === 'warning' && r.message.includes('short')
      )
    ).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it('passes for README with sufficient content', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'README.md'), normalReadme)
    const results = checkReadme(dir)
    expect(results).toHaveLength(0)
    fs.rmSync(dir, { recursive: true })
  })

  it('warns when the trimmed README has 199 characters', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'README.md'), `  ${'a'.repeat(199)}  `)
    const results = checkReadme(dir)
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'readme-too-short',
        severity: 'warning'
      })
    )
    fs.rmSync(dir, { recursive: true })
  })

  it('errors when at least two sample-plugin template phrases remain', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      `# Custom Tool

This project uses TypeScript to provide type checking and documentation.
The repository depends on the latest plugin API and includes example code.
${'Additional documentation. '.repeat(10)}`
    )
    const results = checkReadme(dir)
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'readme-sample-template',
        severity: 'error'
      })
    )
    fs.rmSync(dir, { recursive: true })
  })

  it.each([
    'TODO',
    'FIXME',
    '<your name>',
    'yourusername',
    'plugin-name',
    'lorem ipsum'
  ])('warns about the %s README placeholder', (placeholder) => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      `${normalReadme}\n\n${placeholder}`
    )
    const results = checkReadme(dir)
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'readme-placeholder',
        severity: 'warning'
      })
    )
    fs.rmSync(dir, { recursive: true })
  })

  it('warns when a README has at least two images and little prose', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      '# Gallery\n\n![First](one.png)\n\n<img src="two.png">'
    )
    const results = checkReadme(dir)
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'readme-screenshots-only',
        severity: 'warning'
      })
    )
    fs.rmSync(dir, { recursive: true })
  })

  it.each([
    ['balanced parentheses in the destination', '![One](img/a_(dark).png)'],
    ['nested brackets in the label', '![A[one]](img/a.png)'],
    [
      'an image nested inside a link',
      '[![One](img/a.png)](https://example.com)'
    ]
  ])('counts a markdown image with %s', (_label, image) => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      `# Gallery\n\n${image}\n\n<img src="two.png">`
    )
    const results = checkReadme(dir)
    expect(results).toContainEqual(
      expect.objectContaining({ ruleId: 'readme-screenshots-only' })
    )
    fs.rmSync(dir, { recursive: true })
  })

  it('scans a README of unbalanced markdown delimiters quickly', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'README.md'), '!['.repeat(400_000))

    const startedAt = Date.now()
    checkReadme(dir)

    expect(Date.now() - startedAt).toBeLessThan(5_000)
    fs.rmSync(dir, { recursive: true })
  })

  it('does not flag a README with only one image as screenshots-only', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      '# Gallery\n\n![First](one.png)'
    )
    const results = checkReadme(dir)
    expect(results.some((r) => r.ruleId === 'readme-screenshots-only')).toBe(
      false
    )
    fs.rmSync(dir, { recursive: true })
  })

  it('recommends replacing excessive promotional language', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      `${normalReadme}\n\nAn amazing, powerful, game-changing experience.`
    )
    const results = checkReadme(dir)
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'readme-promotional-language',
        severity: 'recommendation'
      })
    )
    fs.rmSync(dir, { recursive: true })
  })

  it('warns when most letters are outside Latin character ranges', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      `# 工具\n\n${'这是一个用于整理笔记和管理文档的实用工具。'.repeat(12)}`
    )
    const results = checkReadme(dir)
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'readme-non-english',
        severity: 'warning'
      })
    )
    fs.rmSync(dir, { recursive: true })
  })

  it('does not flag a normal English README as non-English', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'README.md'), normalReadme)
    const results = checkReadme(dir)
    expect(results.some((r) => r.ruleId === 'readme-non-english')).toBe(false)
    fs.rmSync(dir, { recursive: true })
  })

  it('warns when the first H1 does not match the manifest name', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'README.md'), normalReadme)
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ name: 'Different Tool' })
    )
    const results = checkReadme(dir)
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'readme-name-mismatch',
        severity: 'warning'
      })
    )
    fs.rmSync(dir, { recursive: true })
  })

  it('normalizes punctuation and case when comparing the first H1', () => {
    const dir = createTempDir()
    fs.writeFileSync(path.join(dir, 'README.md'), normalReadme)
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ name: 'NOTE HELPER!' })
    )
    const results = checkReadme(dir)
    expect(results.some((r) => r.ruleId === 'readme-name-mismatch')).toBe(false)
    fs.rmSync(dir, { recursive: true })
  })

  it('skips name comparison without an H1 or readable manifest', () => {
    const dir = createTempDir()
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      normalReadme.replace('# ', '')
    )
    fs.writeFileSync(path.join(dir, 'manifest.json'), 'not json')
    const results = checkReadme(dir)
    expect(results.some((r) => r.ruleId === 'readme-name-mismatch')).toBe(false)
    fs.rmSync(dir, { recursive: true })
  })
})
