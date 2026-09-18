import {
  parseEslintOutput,
  parseStylelintOutput,
  resolveEslintHelpUrl
} from '../src/lint.js'

const plugin = {
  rules: {
    'detach-leaves': {
      meta: { docs: { url: 'https://example.com/detach-leaves' } }
    }
  }
}

describe('ESLint rule metadata', () => {
  it('resolves non-empty Obsidian rule documentation', () => {
    expect(
      resolveEslintHelpUrl('obsidianmd/detach-leaves', plugin)
    ).toBeTruthy()
  })

  it('adds the resolved documentation URL to a finding', () => {
    const [finding] = parseEslintOutput(
      JSON.stringify([
        {
          filePath: '/workspace/main.ts',
          messages: [
            {
              ruleId: 'obsidianmd/detach-leaves',
              severity: 2,
              message: 'Detach leaves'
            }
          ]
        }
      ]),
      '/workspace',
      plugin
    )
    expect(finding.helpUrl).toBe(plugin.rules['detach-leaves'].meta.docs.url)
  })

  it('does not resolve non-plugin or missing rules', () => {
    expect(resolveEslintHelpUrl('no-eval', plugin)).toBeUndefined()
    expect(resolveEslintHelpUrl('obsidianmd/missing', plugin)).toBeUndefined()
    expect(
      resolveEslintHelpUrl('obsidianmd/detach-leaves', undefined)
    ).toBeUndefined()
  })

  it('does not look up Stylelint rules', () => {
    const [finding] = parseStylelintOutput(
      JSON.stringify([
        {
          source: '/workspace/styles.css',
          warnings: [
            { rule: 'color-named', severity: 'warning', text: 'Named color' }
          ]
        }
      ]),
      '/workspace'
    )
    expect(finding.helpUrl).toBeUndefined()
  })
})
