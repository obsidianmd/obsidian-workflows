# Obsidian Workflows

![CI](https://github.com/obsidianmd/obsidian-workflows/actions/workflows/ci.yml/badge.svg)
![Check dist/](https://github.com/obsidianmd/obsidian-workflows/actions/workflows/check-dist.yml/badge.svg)
![Coverage](./badges/coverage.svg)

A GitHub Action that validates, lints, builds, and releases Obsidian plugins and
themes. Matches the community directory's validation and scanner expectations so
your submissions pass on the first try.

## Quick Start

### PR Checks (CI)

Create a file at `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
    branches: [main, master]

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: obsidianmd/obsidian-workflows@v1
```

The action auto-detects whether your project is a plugin or theme.

### Release

Create a file at `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ['*']

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
      attestations: write
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - uses: obsidianmd/obsidian-workflows@v1
        with:
          mode: release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

This creates a **draft release** — after the workflow completes, go to your
repository's Releases page to review and publish it.

Or use the reusable release workflow for a single-file setup at
`.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ['*']

jobs:
  release:
    uses: obsidianmd/obsidian-workflows/.github/workflows/release.yml@v1
    permissions:
      contents: write
      id-token: write
      attestations: write
```

This also creates a draft release that you need to manually publish.

## Inputs

| Input          | Default   | Description                                                                                                                   |
| -------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `type`         | `auto`    | Project type: `plugin`, `theme`, or `auto`. Auto-detection checks `manifest.json` for an `id` field and `theme.css` presence. |
| `mode`         | `pr`      | Run mode: `pr` (CI checks) or `release` (full release validation, attestation, draft release).                                |
| `build`        | _(empty)_ | Explicit build command override. For plugins, auto-detects `build`/`build:plugin`/`compile`. Set to `false` to disable.       |
| `lint`         | `true`    | Whether to run linting.                                                                                                       |
| `scanner-lint` | `false`   | Use community scanner lint rulesets instead of project config. Always forced `true` in release mode.                          |
| `strict`       | `false`   | Fail the build on policy findings. By default, policy errors are reported as warnings.                                        |
| `node-version` | `24`      | Node.js version. Minimum enforced: 20.                                                                                        |

### Advisory and strict enforcement

Policy findings are advisory by default while the rules are evaluated against
real-world plugins and themes. They are reported as warnings, so validation,
attestation, and draft release creation can continue. Set `strict: true` to
enforce policy findings as build failures.

Correctness failures remain hard errors in both modes. These include build or
dependency-installation failures, an unusable `manifest.json`, missing release
assets, draft release creation failures, and release runs not triggered by a tag
ref.

## Outputs

| Output              | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `type`              | Detected or specified project type (`plugin`/`theme`). |
| `validation-passed` | Whether all validation checks passed (`true`/`false`). |
| `release-url`       | URL of the created draft release (release mode only).  |

## What It Checks

| Check                                       | PR Mode    | Release Mode |
| ------------------------------------------- | ---------- | ------------ |
| `manifest.json` schema                      | Yes        | Yes          |
| `versions.json` format                      | If present | If present   |
| Readme exists and non-empty                 | Yes        | Yes          |
| License (error if missing, warn if non-OSI) | Yes        | Yes          |
| Build (auto-detect or explicit)             | Plugins    | Plugins      |
| Lint (user's config)                        | Default    | No           |
| Lint (scanner rulesets)                     | Opt-in     | Always       |
| Release assets present                      | No         | Yes          |
| Manifest consistency (HEAD vs tag)          | No         | Yes          |
| Build artifact attestation                  | No         | Yes          |
| Draft release creation                      | No         | Yes          |

### Type Detection

The action detects your project type automatically:

1. `manifest.json` has an `id` field (string) → **plugin**
1. `manifest.json` has no `id` field and `theme.css` exists → **theme**
1. Neither condition met → error with instructions to set `type` explicitly

### Scanner Lint Rulesets

In release mode (or when `scanner-lint: true`), the action installs and runs the
same lint configurations used by the Obsidian community directory scanner:

- **Stylelint** with the scanner's ruleset (both plugins and themes)
- **ESLint** with `eslint-plugin-obsidianmd` (plugins only, with type-aware
  rules when `tsconfig.json` is present)

This ensures your release will pass the community directory's automated checks.

### Build Auto-Detection

For plugins, the action checks `package.json` for the first available script:

1. `build`
1. `build:plugin`
1. `compile`

If found, it runs `npm ci` (or `npm install`) followed by the detected script.
Set `build: false` to skip, or `build: <command>` to override.

## Development

```bash
npm install
npm test
npm run bundle
```

## License

MIT
