import * as github from '@actions/github'
import type { Finding } from './types.js'

const SAMPLE_PLUGIN_REPOSITORY = 'obsidianmd/obsidian-sample-plugin'

function unavailableFinding(status: 'skipped' | 'inconclusive'): Finding {
  return {
    ruleId: 'repository-metadata-unavailable',
    enforcement: 'policy',
    check: 'repository metadata',
    message:
      status === 'skipped'
        ? 'Repository metadata checks were skipped because GITHUB_TOKEN is not set.'
        : 'Repository metadata could not be retrieved from the GitHub API.',
    severity: 'warning',
    status,
    coverage: 'unavailable'
  }
}

export async function checkRepositoryMetadata(): Promise<Finding[]> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return [unavailableFinding('skipped')]

  try {
    const octokit = github.getOctokit(token)
    const { owner, repo } = github.context.repo
    const { data } = await octokit.rest.repos.get({ owner, repo })
    const results: Finding[] = []

    if (!data.has_issues) {
      results.push({
        ruleId: 'repository-issues-disabled',
        enforcement: 'policy',
        check: 'repository metadata',
        message:
          'GitHub Issues are disabled. Enable them so users can report problems and request features.',
        severity: 'warning',
        status: 'failed',
        coverage: 'full'
      })
    }

    if (data.fork && data.parent?.full_name !== SAMPLE_PLUGIN_REPOSITORY) {
      results.push({
        ruleId: 'repository-fork-license-review',
        enforcement: 'policy',
        check: 'repository metadata',
        message:
          'This repository is a fork. Review the upstream license and attribution requirements before submission.',
        severity: 'recommendation',
        status: 'failed',
        coverage: 'full'
      })
    }

    if (
      data.template_repository &&
      data.template_repository.full_name !== SAMPLE_PLUGIN_REPOSITORY
    ) {
      results.push({
        ruleId: 'repository-template-license-review',
        enforcement: 'policy',
        check: 'repository metadata',
        message:
          'This repository was generated from a template. Review the template license and attribution requirements before submission.',
        severity: 'recommendation',
        status: 'failed',
        coverage: 'full'
      })
    }

    return results
  } catch {
    return [unavailableFinding('inconclusive')]
  }
}
