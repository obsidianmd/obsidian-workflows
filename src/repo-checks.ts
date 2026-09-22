import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Finding } from './types.js'

const OSI_APPROVED_SPDX = new Set([
  '0BSD',
  'AAL',
  'AFL-3.0',
  'AGPL-1.0-only',
  'AGPL-1.0-or-later',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'Apache-1.1',
  'Apache-2.0',
  'APSL-1.0',
  'APSL-1.1',
  'APSL-2.0',
  'Artistic-1.0',
  'Artistic-2.0',
  'BlueOak-1.0.0',
  'BSD-1-Clause',
  'BSD-2-Clause',
  'BSD-2-Clause-Patent',
  'BSD-3-Clause',
  'BSD-3-Clause-LBNL',
  'BSL-1.0',
  'CAL-1.0',
  'CAL-1.0-Combined-Work-Exception',
  'CATOSL-1.1',
  'CERN-OHL-P-2.0',
  'CERN-OHL-S-2.0',
  'CERN-OHL-W-2.0',
  'CNRI-Python',
  'CPAL-1.0',
  'CUA-OPL-1.0',
  'ECL-1.0',
  'ECL-2.0',
  'EFL-1.0',
  'EFL-2.0',
  'Entessa',
  'EPL-1.0',
  'EPL-2.0',
  'EUDatagrid',
  'EUPL-1.1',
  'EUPL-1.2',
  'Fair',
  'Frameworx-1.0',
  'FSFAP',
  'FTLL',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'HPND',
  'Intel',
  'IPA',
  'IPL-1.0',
  'ISC',
  'JAM',
  'JSON',
  'LAL-1.2',
  'LAL-1.3',
  'LGPL-2.0-only',
  'LGPL-2.0-or-later',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'LiLiQ-P-1.1',
  'LiLiQ-R-1.1',
  'LiLiQ-Rplus-1.1',
  'LPL-1.0',
  'LPL-1.02',
  'LPPL-1.0',
  'LPPL-1.1',
  'LPPL-1.2',
  'LPPL-1.3a',
  'LPPL-1.3c',
  'MIT',
  'MIT-0',
  'Motosoto',
  'MPL-1.0',
  'MPL-1.1',
  'MPL-2.0',
  'MPL-2.0-no-copyleft-exception',
  'MS-PL',
  'MS-RL',
  'MulanPSL-2.0',
  'Multics',
  'NASA-1.3',
  'NCSA',
  'NGPL',
  'Nokia',
  'NPOSL-3.0',
  'NTP',
  'OCLC-2.0',
  'OFL-1.0',
  'OFL-1.1',
  'OFL-1.1-no-RFN',
  'OFL-1.1-RFN',
  'OGTSL',
  'OLDAP-2.8',
  'OSET-PL-2.1',
  'OSL-1.0',
  'OSL-1.1',
  'OSL-2.0',
  'OSL-2.1',
  'OSL-3.0',
  'PHP-3.0',
  'PHP-3.01',
  'PostgreSQL',
  'Python-2.0',
  'QPL-1.0',
  'RPL-1.1',
  'RPL-1.5',
  'RPSL-1.0',
  'RSCPL',
  'SimPL-2.0',
  'SISSL',
  'Sleepycat',
  'SPL-1.0',
  'UCL-1.0',
  'Unicode-3.0',
  'Unicode-DFS-2016',
  'Unlicense',
  'UPL-1.0',
  'VSL-1.0',
  'W3C',
  'Watcom-1.0',
  'Xnet',
  'Zlib',
  'ZPL-2.0',
  'ZPL-2.1'
])

const LICENSE_FILE_NAMES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'license',
  'license.md',
  'license.txt'
]

function findLicenseFile(workspacePath: string): string | null {
  for (const name of LICENSE_FILE_NAMES) {
    const filePath = path.join(workspacePath, name)
    if (fs.existsSync(filePath)) return filePath
  }
  return null
}

function detectSpdxFromPackageJson(workspacePath: string): string | null {
  const pkgPath = path.join(workspacePath, 'package.json')
  if (!fs.existsSync(pkgPath)) return null

  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw) as Record<string, unknown>
    if (typeof pkg.license === 'string') return pkg.license
  } catch {
    /* intentionally empty — invalid package.json is handled by missing spdx */
  }
  return null
}

export function checkLicense(workspacePath: string): Finding[] {
  const results: Finding[] = []
  const licenseFile = findLicenseFile(workspacePath)

  if (!licenseFile) {
    results.push({
      ruleId: 'license-missing',
      enforcement: 'policy',
      message: 'No LICENSE file found in the repository root.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'license'
    })
    return results
  }

  const spdx = detectSpdxFromPackageJson(workspacePath)

  if (spdx && !OSI_APPROVED_SPDX.has(spdx)) {
    results.push({
      ruleId: 'license-not-osi-approved',
      enforcement: 'policy',
      message: `License "${spdx}" in package.json is not an OSI-approved license.`,
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'license'
    })
  }

  return results
}

const README_FILE_NAMES = [
  'README.md',
  'readme.md',
  'README.txt',
  'README',
  'Readme.md'
]

const SAMPLE_PLUGIN_PHRASES = [
  'this is a sample plugin for obsidian',
  'this project uses typescript to provide type checking and documentation',
  'the repository depends on the latest plugin api',
  'you can create a new obsidian plugin',
  'releasing new releases'
]

// The class excludes its own opening delimiter. Allowing it lets a run of
// "<img<img" restart the match at every offset and rescan the rest of the
// README each time, which is quadratic.
const IMG_TAG_REGEX = /<img\b[^><]*>/gi

interface MarkdownSpan {
  readonly start: number
  readonly end: number
}

// A regex cannot match balanced delimiters, and the narrow character classes one
// needs to stay linear silently drop valid Markdown such as `![x](a_(b).png)` or
// `![a[b]](c.png)`. Two delimiter passes plus one scan are linear and handle
// nesting and escapes.
function matchingDelimiters(
  content: string,
  open: string,
  close: string
): Map<number, number> {
  const pairs = new Map<number, number>()
  const stack: number[] = []

  for (let index = 0; index < content.length; index++) {
    const character = content[index]
    if (character === '\\') {
      index++
    } else if (character === open) {
      stack.push(index)
    } else if (character === close) {
      const start = stack.pop()
      if (start !== undefined) pairs.set(start, index)
    }
  }

  return pairs
}

function markdownImages(content: string): MarkdownSpan[] {
  const labels = matchingDelimiters(content, '[', ']')
  const destinations = matchingDelimiters(content, '(', ')')
  const images: MarkdownSpan[] = []

  for (let index = 1; index < content.length; index++) {
    if (content[index] !== '[' || content[index - 1] !== '!') continue

    const labelEnd = labels.get(index)
    if (labelEnd === undefined || content[labelEnd + 1] !== '(') continue

    const destinationEnd = destinations.get(labelEnd + 1)
    if (destinationEnd === undefined) continue

    images.push({ start: index - 1, end: destinationEnd + 1 })
  }

  return images
}

function removeMarkdownImages(content: string): string {
  const images = markdownImages(content)
  if (images.length === 0) return content

  let result = ''
  let cursor = 0

  for (const image of images) {
    if (image.start >= cursor) {
      result += content.slice(cursor, image.start)
      cursor = image.end
    } else if (image.end > cursor) {
      cursor = image.end
    }
  }

  return result + content.slice(cursor)
}

const README_PLACEHOLDER_REGEX =
  /\b(?:TODO|FIXME)\b|<your|yourusername|plugin-name|lorem ipsum/i

const PROMOTIONAL_LANGUAGE_REGEX =
  /\b(?:amazing|awesome|best|effortless(?:ly)?|game[- ]changing|incredible|must[- ]have|powerful|revolutionary|seamless(?:ly)?|supercharge|transformative|transform|ultimate)\b/gi

function readManifestName(workspacePath: string): string | null {
  try {
    const raw = fs.readFileSync(
      path.join(workspacePath, 'manifest.json'),
      'utf-8'
    )
    const manifest = JSON.parse(raw) as unknown
    if (typeof manifest !== 'object' || manifest === null) return null
    const name = (manifest as Record<string, unknown>).name
    return typeof name === 'string' ? name : null
  } catch {
    return null
  }
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function readableText(content: string): string {
  const withoutCode = content
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/^ {4}.*$/gm, '')
    .replace(/`[^`]*`/g, '')

  return removeMarkdownImages(withoutCode)
    .replace(IMG_TAG_REGEX, '')
    .replace(/<[^><]+>/g, '')
    .replace(/[#>*_~[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function checkReadme(workspacePath: string): Finding[] {
  const results: Finding[] = []

  let readmePath: string | null = null
  for (const name of README_FILE_NAMES) {
    const candidate = path.join(workspacePath, name)
    if (fs.existsSync(candidate)) {
      readmePath = candidate
      break
    }
  }

  if (!readmePath) {
    results.push({
      ruleId: 'readme-missing',
      enforcement: 'policy',
      message: 'No README file found in the repository root.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'readme'
    })
    return results
  }

  const content = fs.readFileSync(readmePath, 'utf-8').trim()

  if (content.length === 0) {
    results.push({
      ruleId: 'readme-empty',
      enforcement: 'policy',
      message: 'README file is empty.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'readme'
    })
  } else if (content.length < 200) {
    results.push({
      ruleId: 'readme-too-short',
      enforcement: 'policy',
      message: `README is very short (${content.length} chars). Consider adding more documentation.`,
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'readme'
    })
  }

  const lowerContent = content.toLowerCase()
  const samplePhraseCount = SAMPLE_PLUGIN_PHRASES.filter((phrase) =>
    lowerContent.includes(phrase)
  ).length
  if (samplePhraseCount >= 2) {
    results.push({
      ruleId: 'readme-sample-template',
      enforcement: 'policy',
      message:
        'README contains unmodified text from the Obsidian sample plugin template.',
      severity: 'error',
      status: 'failed',
      coverage: 'partial',
      check: 'readme'
    })
  }

  if (README_PLACEHOLDER_REGEX.test(content)) {
    results.push({
      ruleId: 'readme-placeholder',
      enforcement: 'policy',
      message: 'README contains unfilled placeholder text.',
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'readme'
    })
  }

  const imageCount =
    markdownImages(content).length + (content.match(IMG_TAG_REGEX)?.length ?? 0)
  const text = readableText(content)
  if (imageCount >= 2 && text.length < 150) {
    results.push({
      ruleId: 'readme-screenshots-only',
      enforcement: 'policy',
      message: 'README relies on screenshots without enough explanatory text.',
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'readme'
    })
  }

  const promotionalMatches =
    content.match(PROMOTIONAL_LANGUAGE_REGEX)?.length ?? 0
  if (promotionalMatches >= 3) {
    results.push({
      ruleId: 'readme-promotional-language',
      enforcement: 'policy',
      message: 'README uses excessive promotional language.',
      severity: 'recommendation',
      status: 'failed',
      coverage: 'partial',
      check: 'readme'
    })
  }

  const letters = content.match(/\p{L}/gu) ?? []
  const outsideLatin = letters.filter(
    (letter) => (letter.codePointAt(0) ?? 0) > 0x024f
  ).length
  if (letters.length >= 50 && outsideLatin / letters.length > 0.5) {
    results.push({
      ruleId: 'readme-non-english',
      enforcement: 'policy',
      message: 'README should include primarily English documentation.',
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'readme'
    })
  }

  const firstHeading = content.match(/^#\s+(.+)$/m)?.[1]
  const manifestName = readManifestName(workspacePath)
  if (
    firstHeading !== undefined &&
    manifestName !== null &&
    normalizeName(firstHeading) !== normalizeName(manifestName)
  ) {
    results.push({
      ruleId: 'readme-name-mismatch',
      enforcement: 'policy',
      message:
        'The first README heading should match the plugin manifest name.',
      severity: 'warning',
      status: 'failed',
      coverage: 'partial',
      check: 'readme'
    })
  }

  return results
}
