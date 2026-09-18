import { jest } from '@jest/globals'

interface MockRepoData {
  has_issues: boolean
  fork: boolean
  parent?: { full_name: string }
  template_repository?: { full_name: string } | null
}

const repoGetMock = jest.fn<
  (args: { owner: string; repo: string }) => Promise<{ data: MockRepoData }>
>(async () => ({ data: { has_issues: true, fork: false } }))
const getOctokitMock = jest.fn(() => ({
  rest: { repos: { get: repoGetMock } }
}))

jest.unstable_mockModule('@actions/github', () => ({
  context: { repo: { owner: 'author', repo: 'project' } },
  getOctokit: getOctokitMock
}))

const { checkRepositoryMetadata } = await import('../src/repo-meta.js')

describe('checkRepositoryMetadata', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'token'
    repoGetMock.mockResolvedValue({
      data: { has_issues: true, fork: false }
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
    delete process.env.GITHUB_TOKEN
  })

  it('skips gracefully without GITHUB_TOKEN', async () => {
    delete process.env.GITHUB_TOKEN

    await expect(checkRepositoryMetadata()).resolves.toEqual([
      expect.objectContaining({ status: 'skipped' })
    ])
    expect(getOctokitMock).not.toHaveBeenCalled()
  })

  it('warns when GitHub Issues are disabled', async () => {
    repoGetMock.mockResolvedValueOnce({
      data: { has_issues: false, fork: false }
    })

    await expect(checkRepositoryMetadata()).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'repository-issues-disabled',
        severity: 'warning'
      })
    ])
    expect(repoGetMock).toHaveBeenCalledWith({
      owner: 'author',
      repo: 'project'
    })
  })

  it('recommends license review for a non-sample fork', async () => {
    repoGetMock.mockResolvedValueOnce({
      data: {
        has_issues: true,
        fork: true,
        parent: { full_name: 'upstream/project' }
      }
    })

    await expect(checkRepositoryMetadata()).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'repository-fork-license-review',
        severity: 'recommendation'
      })
    ])
  })

  it('does not recommend license review for a sample-plugin fork', async () => {
    repoGetMock.mockResolvedValueOnce({
      data: {
        has_issues: true,
        fork: true,
        parent: { full_name: 'obsidianmd/obsidian-sample-plugin' }
      }
    })

    await expect(checkRepositoryMetadata()).resolves.toEqual([])
  })

  it('recommends license review for a non-sample template', async () => {
    repoGetMock.mockResolvedValueOnce({
      data: {
        has_issues: true,
        fork: false,
        template_repository: { full_name: 'author/template' }
      }
    })

    await expect(checkRepositoryMetadata()).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'repository-template-license-review',
        severity: 'recommendation'
      })
    ])
  })

  it('does not recommend license review for the sample-plugin template', async () => {
    repoGetMock.mockResolvedValueOnce({
      data: {
        has_issues: true,
        fork: false,
        template_repository: {
          full_name: 'obsidianmd/obsidian-sample-plugin'
        }
      }
    })

    await expect(checkRepositoryMetadata()).resolves.toEqual([])
  })

  it('is inconclusive when the GitHub API call fails', async () => {
    repoGetMock.mockRejectedValueOnce(new Error('API unavailable'))

    await expect(checkRepositoryMetadata()).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'repository-metadata-unavailable',
        status: 'inconclusive'
      })
    ])
  })
})
