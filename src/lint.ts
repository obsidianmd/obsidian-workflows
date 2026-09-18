import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { ensureUserDeps } from './deps.js'
import { readManifest } from './detect.js'
import type { Finding, PolicySeverity, ProjectType } from './types.js'

const SCANNER_STYLELINT_CONFIG = {
  plugins: ['stylelint-no-unsupported-browser-features'],
  ignoreDisables: true,
  ignoreFiles: [
    'node_modules',
    'dist',
    'build',
    'pkg',
    'test-vault',
    '.obsidian',
    '**/.obsidian/**',
    'esbuild.config.mjs',
    'version-bump.mjs',
    '**/*.test.*',
    '**/*.tests.*',
    '**/*.spec.*',
    '**/*.specs.*',
    '**/test/**',
    '**/tests/**',
    '**/__tests__/**',
    '**/mocks/**',
    '**/__mocks__/**',
    '**/*.cjs',
    '**/*.mjs',
    '**/*.cts',
    '**/*.mts',
    '**/vite*',
    '**/scripts/**',
    '**/docs/**',
    '**/i18n/**',
    '**/i18next/**',
    '**/locale/**',
    '**/locales/**',
    '**/translations/**',
    '**/l10n/**',
    '.pnpm-store',
    '**/*.spec.ts',
    '**/testUtils**',
    'automation/**',
    'e2e-tests/**'
  ],
  rules: {
    'function-url-scheme-disallowed-list': [
      ['http', 'https', 'file'],
      {
        severity: 'error',
        message:
          'External URLs are not allowed in themes. To embed images & fonts encode them as base64 <https://docs.obsidian.md/Themes/App+themes/Embed+fonts+and+images+in+your+theme>'
      }
    ],
    'function-url-scheme-allowed-list': ['data'],
    'declaration-no-important': [
      true,
      {
        severity: 'warning',
        message:
          'Avoid !important — override styles by increasing selector specificity or using CSS variables instead.'
      }
    ],
    'color-named': [
      'never',
      {
        severity: 'warning',
        message:
          'Use hex colors or Obsidian CSS variables instead of named colors to ensure proper light/dark theme support. <https://docs.obsidian.md/Reference/CSS+variables/CSS+variables>'
      }
    ],
    'custom-property-no-missing-var-function': null,
    'no-duplicate-selectors': null,
    'no-duplicate-at-import-rules': null,
    'declaration-block-no-duplicate-properties': [
      true,
      { severity: 'warning' }
    ],
    'shorthand-property-no-redundant-values': null,
    'plugin/no-unsupported-browser-features': [
      true,
      {
        severity: 'warning',
        browsers: ['electron >= 39'],
        ignore: ['css-nesting', 'css-cascade-layers']
      }
    ],
    'selector-pseudo-class-disallowed-list': [
      ['has'],
      {
        severity: 'warning',
        message:
          'Avoid :has() — it can cause significant performance issues due to broad selector invalidation.'
      }
    ],
    'selector-pseudo-class-no-unknown': [
      true,
      {
        ignorePseudoClasses: ['global', 'local'],
        severity: 'warning'
      }
    ],
    'selector-pseudo-element-no-unknown': [true, { severity: 'warning' }],
    'selector-type-no-unknown': [
      true,
      { ignoreTypes: [], severity: 'warning' }
    ],
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: ['layer', 'property', 'container'],
        severity: 'warning'
      }
    ],
    'unit-no-unknown': [true, { severity: 'warning' }],
    'property-disallowed-list': [['all'], { severity: 'warning' }]
  }
}

// Source: community-workers/src/worker/electronVersions.json
const ELECTRON_VERSIONS: Record<number, string> = {
  25: '1.4.5',
  28: '1.5.8',
  30: '1.6.5',
  31: '1.7.4',
  37: '1.9.12',
  39: '1.11.4'
}

const DEFAULT_ELECTRON = 39

function semverToNum(v: string): number {
  const [major = 0, minor = 0, patch = 0] = v.split('.').map(Number)
  return major * 100_000 + minor * 1_000 + patch
}

export function getMinElectronVersion(
  minAppVersion: string | undefined
): number {
  if (!minAppVersion) return DEFAULT_ELECTRON

  const target = semverToNum(minAppVersion)
  let result = Math.min(...Object.keys(ELECTRON_VERSIONS).map(Number))

  for (const [electronStr, obsidianVersion] of Object.entries(
    ELECTRON_VERSIONS
  )) {
    const electron = Number(electronStr)
    if (semverToNum(obsidianVersion) <= target) {
      result = Math.max(result, electron)
    }
  }

  return result
}

function buildStylelintConfig(minAppVersion: string | undefined): object {
  const minElectron = getMinElectronVersion(minAppVersion)
  const config = JSON.parse(JSON.stringify(SCANNER_STYLELINT_CONFIG))
  config.rules['plugin/no-unsupported-browser-features'][1].browsers = [
    `electron >= ${minElectron}`
  ]
  return config
}

const SCANNER_STYLELINT_DEPS: Record<string, string> = {
  stylelint: '17.6.0',
  'stylelint-no-unsupported-browser-features': '8.1.1'
}

const SCANNER_ESLINT_DEPS: Record<string, string> = {
  eslint: '9.37.0',
  'eslint-plugin-obsidianmd': '0.4.1',
  'typescript-eslint': '8.61.1'
}

function relativeFile(workspacePath: string, filePath: string): string {
  return path.normalize(
    path.isAbsolute(filePath)
      ? path.relative(workspacePath, filePath)
      : filePath
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

export function parseStylelintOutput(
  stdout: string,
  workspacePath: string
): Finding[] {
  const parsed: unknown = JSON.parse(stdout)
  if (!Array.isArray(parsed))
    throw new Error('Stylelint output is not an array.')

  const findings: Finding[] = []
  for (const result of parsed) {
    if (!isRecord(result)) continue
    const source = typeof result.source === 'string' ? result.source : ''
    const warnings = Array.isArray(result.warnings) ? result.warnings : []
    for (const warning of warnings) {
      if (!isRecord(warning)) continue
      const severity: PolicySeverity =
        warning.severity === 'error' ? 'error' : 'warning'
      findings.push({
        ruleId:
          typeof warning.rule === 'string'
            ? warning.rule
            : 'stylelint-unknown-rule',
        enforcement: 'policy',
        check: 'scanner-stylelint',
        message:
          typeof warning.text === 'string'
            ? warning.text
            : 'Stylelint reported an issue.',
        severity,
        status: 'failed',
        coverage: 'full',
        location: {
          file: relativeFile(workspacePath, source),
          startLine: optionalNumber(warning.line),
          endLine: optionalNumber(warning.endLine),
          startColumn: optionalNumber(warning.column),
          endColumn: optionalNumber(warning.endColumn)
        }
      })
    }

    const parseErrors = Array.isArray(result.parseErrors)
      ? result.parseErrors
      : []
    for (const parseError of parseErrors) {
      const detail = isRecord(parseError) ? parseError : {}
      findings.push({
        ruleId: 'css-parse-error',
        enforcement: 'policy',
        check: 'scanner-stylelint',
        message:
          typeof detail.text === 'string'
            ? detail.text
            : typeof parseError === 'string'
              ? parseError
              : 'Stylelint could not parse this stylesheet.',
        severity: 'error',
        status: 'failed',
        coverage: 'full',
        location: {
          file: relativeFile(workspacePath, source),
          startLine: optionalNumber(detail.line),
          startColumn: optionalNumber(detail.column)
        }
      })
    }
  }
  return findings
}

type RuleDocs = { meta?: { docs?: { url?: unknown } } }
type ObsidianPlugin = { rules?: Record<string, RuleDocs> }

export function resolveEslintHelpUrl(
  ruleId: string | null,
  plugin: ObsidianPlugin | undefined
): string | undefined {
  if (!ruleId?.startsWith('obsidianmd/')) return undefined
  const name = ruleId.slice('obsidianmd/'.length)
  const url = plugin?.rules?.[name]?.meta?.docs?.url
  return typeof url === 'string' && url.length > 0 ? url : undefined
}

export function parseEslintOutput(
  stdout: string,
  workspacePath: string,
  plugin?: ObsidianPlugin
): Finding[] {
  const parsed: unknown = JSON.parse(stdout)
  if (!Array.isArray(parsed)) throw new Error('ESLint output is not an array.')

  const findings: Finding[] = []
  for (const result of parsed) {
    if (!isRecord(result)) continue
    const filePath = typeof result.filePath === 'string' ? result.filePath : ''
    const messages = Array.isArray(result.messages) ? result.messages : []
    for (const entry of messages) {
      if (!isRecord(entry)) continue
      const ruleId = typeof entry.ruleId === 'string' ? entry.ruleId : null
      const fatal = entry.fatal === true || ruleId === null
      findings.push({
        ruleId: fatal ? 'eslint-execution-failure' : ruleId,
        enforcement: 'policy',
        check: 'scanner-eslint',
        message:
          typeof entry.message === 'string'
            ? entry.message
            : 'ESLint reported an issue.',
        severity: fatal
          ? 'recommendation'
          : entry.severity === 2
            ? 'error'
            : 'warning',
        status: fatal ? 'inconclusive' : 'failed',
        coverage: fatal ? 'unavailable' : 'full',
        location: {
          file: relativeFile(workspacePath, filePath),
          startLine: optionalNumber(entry.line),
          endLine: optionalNumber(entry.endLine),
          startColumn: optionalNumber(entry.column),
          endColumn: optionalNumber(entry.endColumn)
        },
        helpUrl: resolveEslintHelpUrl(ruleId, plugin)
      })
    }
  }
  return findings
}

function findCssFiles(directory: string, workspacePath = directory): string[] {
  const ignored = new Set([
    'node_modules',
    'dist',
    'build',
    '.git',
    '.obsidian'
  ])
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) {
        files.push(
          ...findCssFiles(path.join(directory, entry.name), workspacePath)
        )
      }
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      files.push(path.relative(workspacePath, path.join(directory, entry.name)))
    }
  }
  return files
}

async function createScannerDepsDir(
  deps: Record<string, string>
): Promise<string> {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'obsidian-scanner-lint-')
  )
  const pkg = {
    name: 'obsidian-scanner-lint',
    private: true,
    dependencies: deps
  }
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg))

  const exitCode = await exec.exec('npm', ['install'], {
    cwd: tempDir,
    ignoreReturnCode: true
  })

  if (exitCode !== 0) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    throw new Error('Failed to install scanner lint dependencies.')
  }

  return tempDir
}

async function runUserLint(workspacePath: string): Promise<Finding[]> {
  const results: Finding[] = []

  const pkgPath = path.join(workspacePath, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    core.info('No package.json found. Skipping user lint.')
    return results
  }

  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw) as Record<string, unknown>
    const scripts = pkg.scripts as Record<string, string> | undefined
    if (!scripts?.lint) {
      core.info('No "lint" script in package.json. Skipping user lint.')
      return results
    }
  } catch {
    return results
  }

  core.info('Running user lint script...')
  const exitCode = await exec.exec('npm', ['run', 'lint'], {
    cwd: workspacePath,
    ignoreReturnCode: true
  })

  if (exitCode !== 0) {
    results.push({
      ruleId: 'user-lint-failed',
      enforcement: 'policy',
      message: `User lint script failed (exit code ${exitCode}).`,
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'lint'
    })
  }

  return results
}

async function runScannerStylelint(
  workspacePath: string,
  projectType: ProjectType,
  minAppVersion: string | undefined
): Promise<Finding[]> {
  const cssFiles =
    projectType === 'theme'
      ? fs.existsSync(path.join(workspacePath, 'theme.css'))
        ? ['theme.css']
        : []
      : findCssFiles(workspacePath)

  if (cssFiles.length === 0) {
    core.info('No CSS files found to lint.')
    return [
      {
        ruleId: 'scanner-stylelint-no-files',
        enforcement: 'policy',
        check: 'scanner-stylelint',
        message: 'Scanner Stylelint skipped because no CSS files were found.',
        severity: 'recommendation',
        status: 'skipped',
        coverage: 'unavailable'
      }
    ]
  }

  core.info('Installing scanner stylelint dependencies...')
  let scannerDir: string
  try {
    scannerDir = await createScannerDepsDir(SCANNER_STYLELINT_DEPS)
  } catch {
    return [
      {
        ruleId: 'scanner-stylelint-setup-failed',
        enforcement: 'policy',
        message: 'Failed to install scanner stylelint dependencies.',
        severity: 'recommendation',
        status: 'inconclusive',
        coverage: 'unavailable',
        check: 'scanner-stylelint'
      }
    ]
  }

  const configPath = path.join(workspacePath, '.stylelintrc.scanner.json')
  const config = buildStylelintConfig(minAppVersion)
  fs.writeFileSync(configPath, JSON.stringify(config))

  try {
    core.info('Running scanner stylelint...')
    const output = await exec.getExecOutput(
      'npx',
      [
        '--prefix',
        scannerDir,
        'stylelint',
        ...cssFiles,
        '--config',
        configPath,
        '--config-basedir',
        path.join(scannerDir, 'node_modules'),
        '--formatter',
        'json'
      ],
      {
        cwd: workspacePath,
        ignoreReturnCode: true,
        env: {
          ...process.env,
          NODE_PATH: path.join(scannerDir, 'node_modules')
        }
      }
    )

    try {
      const stylelintJson =
        output.stderr.match(/^\s*(\[.*\])\s*$/m)?.[1] ?? output.stdout
      const findings = parseStylelintOutput(stylelintJson, workspacePath)
      if (findings.length > 0) return findings
      if (output.exitCode === 0) {
        return [
          {
            ruleId: 'scanner-stylelint-passed',
            enforcement: 'policy',
            check: 'scanner-stylelint',
            message: 'Scanner Stylelint found no issues.',
            severity: 'recommendation',
            status: 'passed',
            coverage: 'full'
          }
        ]
      }
    } catch {
      // Report execution uncertainty rather than assigning malformed tool output to the author.
    }
    return [
      {
        ruleId: 'scanner-stylelint-execution-failed',
        enforcement: 'policy',
        check: 'scanner-stylelint',
        message: `Scanner Stylelint did not produce usable JSON (exit code ${output.exitCode}).`,
        severity: 'recommendation',
        status: 'inconclusive',
        coverage: 'unavailable'
      }
    ]
  } catch (error) {
    return [
      {
        ruleId: 'scanner-stylelint-execution-failed',
        enforcement: 'policy',
        check: 'scanner-stylelint',
        message: `Scanner Stylelint could not run: ${error instanceof Error ? error.message : String(error)}.`,
        severity: 'recommendation',
        status: 'inconclusive',
        coverage: 'unavailable'
      }
    ]
  } finally {
    fs.rmSync(scannerDir, { recursive: true, force: true })
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath)
  }
}

function buildScannerEslintConfig(hasTsconfig: boolean): string {
  if (!hasTsconfig) {
    return `import obsidianmd from "eslint-plugin-obsidianmd";
import { globalIgnores } from "eslint/config";

const IGNORES = ${JSON.stringify(SCANNER_STYLELINT_CONFIG.ignoreFiles)};

export default [
  globalIgnores(IGNORES),
  { ignores: ["eslint.config.scanner.mjs", "main.js", "styles.css", "manifest.json"] },
  ...obsidianmd.configs.recommended.map(config => {
    if (config.rules) {
      const filtered = { ...config.rules };
      delete filtered["obsidianmd/no-plugin-as-component"];
      delete filtered["obsidianmd/no-view-references-in-plugin"];
      delete filtered["obsidianmd/no-unsupported-api"];
      delete filtered["obsidianmd/prefer-create-el"];
      delete filtered["obsidianmd/prefer-file-manager-trash-file"];
      delete filtered["obsidianmd/prefer-instanceof"];
      return { ...config, rules: filtered };
    }
    return config;
  })
];
`
  }

  return `import { cwd } from "node:process";
import { globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

const IGNORES = ${JSON.stringify(SCANNER_STYLELINT_CONFIG.ignoreFiles)};

function toWarns(config) {
  if (!config) return config;
  if (!Array.isArray(config) && typeof config[Symbol.iterator] === "function") {
    return [...config].map(toWarns);
  }
  if (Array.isArray(config)) return config.map(toWarns);
  const result = { ...config };
  if (result.extends) result.extends = toWarns(result.extends);
  if (result.rules) {
    result.rules = Object.fromEntries(
      Object.entries(result.rules).map(([key, value]) => {
        if (key.startsWith("eslint-comments/")) return [key, value];
        if (value === "error" || value === 2) return [key, "warn"];
        if (Array.isArray(value) && (value[0] === "error" || value[0] === 2)) return [key, ["warn", ...value.slice(1)]];
        return [key, value];
      })
    );
  }
  return result;
}

export default [
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.js",
            "eslint.config.mjs",
            "eslint.config.mts",
          ]
        },
        tsconfigRootDir: cwd(),
        extraFileExtensions: [".json"]
      },
    },
  },
  ...toWarns(obsidianmd.configs.recommended),
  {
    linterOptions: {
      noInlineConfig: false,
      reportUnusedDisableDirectives: "off",
      reportUnusedInlineConfigs: "off",
    },
  },
  {
    files: ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "obsidianmd/regex-lookbehind": "error",
      "obsidianmd/no-forbidden-elements": "error",

      "no-undef": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "import/no-unresolved": "off",

      "obsidianmd/validate-manifest": "off",
      "obsidianmd/validate-license": "off",

      "obsidianmd/commands/no-command-in-command-id": "off",
      "obsidianmd/commands/no-plugin-id-in-command-id": "off",
    }
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    rules: {
      "obsidianmd/ui/sentence-case": "off",
      "obsidianmd/ui/sentence-case-json": "off",
      "obsidianmd/ui/sentence-case-locale-module": "off",
    }
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    rules: {
      "eslint-comments/require-description": "error",
    }
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "obsidianmd": obsidianmd,
    },
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",

      "obsidianmd/commands/no-command-in-command-id": "warn",
      "obsidianmd/commands/no-plugin-id-in-command-id": "warn",

      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/sample-names": "error",
      "obsidianmd/no-sample-code": "error",
      "obsidianmd/platform": "error",
      "obsidianmd/no-plugin-as-component": "error",
      "obsidianmd/detach-leaves": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/no-view-references-in-plugin": "error",
      "obsidianmd/no-unsupported-api": "error",
    }
  },
  globalIgnores(IGNORES),
  { ignores: ["eslint.config.scanner.mjs", "main.js", "styles.css", "manifest.json"] },
];
`
}

async function runScannerEslint(workspacePath: string): Promise<Finding[]> {
  const hasTsconfig = fs.existsSync(path.join(workspacePath, 'tsconfig.json'))

  await ensureUserDeps(workspacePath)

  core.info('Installing scanner ESLint dependencies...')
  let scannerDir: string
  try {
    scannerDir = await createScannerDepsDir(SCANNER_ESLINT_DEPS)
  } catch {
    return [
      {
        ruleId: 'scanner-eslint-setup-failed',
        enforcement: 'policy',
        message: 'Failed to install scanner ESLint dependencies.',
        severity: 'recommendation',
        status: 'inconclusive',
        coverage: 'unavailable',
        check: 'scanner-eslint'
      }
    ]
  }

  const configContent = buildScannerEslintConfig(hasTsconfig)
  const configPath = path.join(scannerDir, 'eslint.config.scanner.mjs')
  fs.writeFileSync(configPath, configContent)

  try {
    core.info(
      hasTsconfig
        ? 'Running scanner ESLint with type-aware rules...'
        : 'Running scanner ESLint without type-aware rules (no tsconfig.json)...'
    )

    const nodePath = [
      path.join(scannerDir, 'node_modules'),
      path.join(workspacePath, 'node_modules')
    ].join(path.delimiter)

    const output = await exec.getExecOutput(
      'npx',
      [
        '--prefix',
        scannerDir,
        'eslint',
        '--config',
        configPath,
        '--format',
        'json',
        '--no-error-on-unmatched-pattern',
        '.'
      ],
      {
        cwd: workspacePath,
        ignoreReturnCode: true,
        env: {
          ...process.env,
          NODE_PATH: nodePath
        }
      }
    )

    let plugin: ObsidianPlugin | undefined
    try {
      const modulePath = path.join(
        scannerDir,
        'node_modules',
        'eslint-plugin-obsidianmd',
        'dist',
        'index.js'
      )
      const loaded: unknown = await import(pathToFileURL(modulePath).href)
      if (isRecord(loaded)) {
        const candidate = isRecord(loaded.default) ? loaded.default : loaded
        plugin = candidate as ObsidianPlugin
      }
    } catch {
      plugin = undefined
    }

    try {
      const findings = parseEslintOutput(output.stdout, workspacePath, plugin)
      if (findings.length > 0) return findings
      if (output.exitCode === 0) {
        return [
          {
            ruleId: 'scanner-eslint-passed',
            enforcement: 'policy',
            check: 'scanner-eslint',
            message: 'Scanner ESLint found no issues.',
            severity: 'recommendation',
            status: 'passed',
            coverage: 'full'
          }
        ]
      }
    } catch {
      // Report execution uncertainty rather than assigning malformed tool output to the author.
    }
    return [
      {
        ruleId: 'scanner-eslint-execution-failed',
        enforcement: 'policy',
        check: 'scanner-eslint',
        message: `Scanner ESLint did not produce usable JSON (exit code ${output.exitCode}).`,
        severity: 'recommendation',
        status: 'inconclusive',
        coverage: 'unavailable'
      }
    ]
  } catch (error) {
    return [
      {
        ruleId: 'scanner-eslint-execution-failed',
        enforcement: 'policy',
        check: 'scanner-eslint',
        message: `Scanner ESLint could not run: ${error instanceof Error ? error.message : String(error)}.`,
        severity: 'recommendation',
        status: 'inconclusive',
        coverage: 'unavailable'
      }
    ]
  } finally {
    fs.rmSync(scannerDir, { recursive: true, force: true })
  }
}

export async function runLint(
  workspacePath: string,
  projectType: ProjectType,
  useScannerLint: boolean,
  mode: string
): Promise<Finding[]> {
  const results: Finding[] = []
  const effectiveScannerLint = mode === 'release' || useScannerLint

  if (!effectiveScannerLint) {
    results.push(...(await runUserLint(workspacePath)))
    return results
  }

  const manifest = readManifest(workspacePath)
  const minAppVersion =
    manifest && typeof manifest === 'object'
      ? ((manifest as Record<string, unknown>).minAppVersion as
          | string
          | undefined)
      : undefined

  results.push(
    ...(await runScannerStylelint(workspacePath, projectType, minAppVersion))
  )

  if (projectType === 'plugin') {
    results.push(...(await runScannerEslint(workspacePath)))
  }

  return results
}
