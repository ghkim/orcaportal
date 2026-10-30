// A new planet as a new worktree, made the way Orca's own "create worktree" dialog makes
// one: a project, the ref to start from, and what to make it from (a name, a branch the
// remote has, or a GitHub issue or PR), with an agent (or a shell) in its first terminal.
import { execFile } from 'node:child_process'
import { AGENTS, ProjectError, githubAccounts, findGh } from './projects.mjs'

export const SETUPS = ['inherit', 'run', 'skip']
// Remote branches offered to start from or to check out, the most recently touched first.
const BRANCH_LIMIT = 200
// Creating can run the repo's setup and start an agent.
const CREATE_TIMEOUT_MS = 180_000

// What the smart field means: a link (GitHub, GitLab, Linear, Jira), `#123`, a Jira key,
// a branch the remote has, or else the name for a new branch.
export function smartTarget(value, branches = []) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (/^https?:\/\/\S+$/.test(text)) return { kind: 'link', url: text }
  const number = /^#?(\d{1,7})$/.exec(text)
  if (number) return { kind: 'number', number: Number(number[1]) }
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(text)) return { kind: 'jira', key: text }
  const branch = text.replace(/^origin\//, '')
  if (branch && branches.includes(branch)) return { kind: 'branch', branch }
  return { kind: 'name', name: text }
}

// A GitHub issue or PR link: which repo, which kind, which number.
export function githubLink(url) {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)/.exec(url || '')
  return match ? { repo: match[1], kind: match[2] === 'pull' ? 'pr' : 'issue', number: Number(match[3]) } : null
}

// A worktree (and folder) name: spaces become dashes, nothing that walks a path.
export function worktreeName(value) {
  const name = (typeof value === 'string' ? value : '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[/\\:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 60)
  return name || null
}

// A git ref the user picked or typed. Never an option, never anything a shell would read.
export function refName(value) {
  const ref = typeof value === 'string' ? value.trim() : ''
  return ref && ref.length <= 200 && /^[\w][\w./-]*$/.test(ref) && !ref.includes('..') ? ref : null
}

// `owner/repo` of a GitHub remote, from Orca's record of it or the remote's address.
export function githubRepoOf(remote) {
  const match = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remote || '')
  return match ? match[1] : null
}

// The `orca worktree create` arguments for a plan. Its parent is never inferred from
// wherever Orrery itself happens to run.
export function createArgs({ repoId, name, base, branch, references = [], agent, prompt, setup, activate }) {
  return [
    'worktree',
    'create',
    `--repo=id:${repoId}`,
    `--name=${name}`,
    '--no-parent',
    ...(base ? [`--base-branch=${base}`] : []),
    ...(branch ? [`--branch=${branch}`] : []),
    ...references.map((reference) => `--reference=${reference}`),
    ...(agent !== 'shell' ? [`--agent=${agent}`, '--surface=terminal', ...(prompt ? [`--prompt=${prompt}`] : [])] : []),
    `--setup=${setup}`,
    ...(activate ? ['--activate'] : [])
  ]
}

// Where Orca put the new worktree, from its answer.
export function createdPath(result) {
  return result?.worktree?.path || result?.path || String(result?.worktree?.id || result?.id || '').split('::')[1] || null
}

export class Worktrees {
  constructor(client, { git = runGit, gh = runGh } = {}) {
    this.client = client
    this.git = git
    this.gh = gh
  }

  // The repo a session's folder belongs to, as Orca has it.
  async repoOf(worktreeId) {
    const repoId = String(worktreeId || '').split('::')[0]
    if (!repoId) throw new ProjectError('invalid_argument', '이 프로젝트를 찾을 수 없어요.')
    const { repo } = await this.client.cli(['repo', 'show', `--repo=id:${repoId}`])
    return { id: repoId, kind: repo?.kind || 'git', path: repo?.path, github: githubRepoOf(repo?.gitRemoteIdentity?.canonicalKey || repo?.gitRemoteIdentity?.remoteUrl) }
  }

  // What the form offers for a project: where it starts from, and the branches it has.
  async options(dir, worktreeId) {
    const repo = await this.repoOf(worktreeId)
    if (repo.kind !== 'git') return { git: false }
    const head = await this.git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')
    const branches = await this.branches(dir)
    // Without a recorded default the usual names stand in, as Orca's own default does.
    const base = head.trim() || ['main', 'master'].filter((b) => branches.includes(b)).map((b) => `origin/${b}`)[0] || null
    return { git: true, base, branches, github: repo.github }
  }

  async branches(dir) {
    const refs = await this.git(dir, ['for-each-ref', '--sort=-committerdate', `--count=${BRANCH_LIMIT}`, '--format=%(refname:short)', 'refs/remotes/origin']).catch(() => '')
    return refs
      .split('\n')
      .map((ref) => ref.trim().replace(/^origin\//, ''))
      .filter((ref) => ref && ref !== 'HEAD' && ref !== 'origin')
  }

  // Open PRs and issues to pick from in the GitHub tab.
  async github(worktreeId) {
    const repo = await this.repoOf(worktreeId)
    if (!repo.github) throw new ProjectError('no_github', '이 프로젝트는 GitHub 저장소가 아니에요.')
    const [pulls, issues] = await Promise.all([
      this.gh(['pr', 'list', '--repo', repo.github, '--state', 'open', '--limit', '12', '--json', 'number,title,headRefName,author']),
      this.gh(['issue', 'list', '--repo', repo.github, '--state', 'open', '--limit', '12', '--json', 'number,title'])
    ])
    return {
      repo: repo.github,
      pulls: JSON.parse(pulls).map((p) => ({ number: p.number, title: p.title, branch: p.headRefName, author: p.author?.login || '' })),
      issues: JSON.parse(issues).map((i) => ({ number: i.number, title: i.title }))
    }
  }

  // Turns what the form says into a worktree: its name, the ref it starts from, its
  // branch and the links it carries. A PR of this repo is checked out on its own branch.
  async plan(dir, repo, { mode, value, base, branch }) {
    const target = mode === 'smart' ? smartTarget(value, await this.branches(dir)) : mode === 'branch' ? { kind: 'branch', branch: refName(String(value || '').replace(/^origin\//, '')) } : mode === 'github' ? smartTarget(value) : { kind: 'name', name: value }
    if (mode === 'github' && !['link', 'number'].includes(target.kind)) throw new ProjectError('invalid_argument', '#번호나 GitHub 이슈·PR 주소를 적어 주세요.')
    const plan = { name: null, base: refName(base), branch: refName(branch), references: [] }
    if (target.kind === 'number') {
      if (!repo.github) throw new ProjectError('no_github', '#번호는 GitHub 저장소에서만 쓸 수 있어요.')
      target.kind = 'link'
      target.url = await this.numberLink(repo.github, target.number)
    }
    if (target.kind === 'link') {
      const link = githubLink(target.url)
      plan.references.push(target.url)
      plan.name = link ? `${link.kind}-${link.number}` : worktreeName(target.url.replace(/[?#].*$/, '').split('/').filter(Boolean).slice(-2).join('-'))
      if (link?.kind === 'pr' && link.repo.toLowerCase() === (repo.github || '').toLowerCase()) {
        const head = await this.pullHead(repo.github, link.number)
        if (head) Object.assign(target, { kind: 'branch', branch: head })
      }
    } else if (target.kind === 'jira') {
      plan.references.push(target.key)
      plan.name = target.key.toLowerCase()
    }
    if (target.kind === 'branch') {
      if (!target.branch) throw new ProjectError('invalid_argument', '브랜치 이름을 확인해 주세요.')
      // The branch as the remote has it now, checked out under its own name (Orca adds a
      // number if that name is taken).
      await this.git(dir, ['fetch', 'origin', target.branch]).catch(() => {})
      plan.base = `origin/${target.branch}`
      plan.branch = target.branch
      plan.name ||= worktreeName(target.branch.split('/').pop())
    }
    if (target.kind === 'name') plan.name = worktreeName(target.name)
    if (!plan.name) throw new ProjectError('invalid_argument', '이름을 적어 주세요.')
    return plan
  }

  // `#123` is a PR or an issue; GitHub says which.
  async numberLink(github, number) {
    const out = await this.gh(['api', `repos/${github}/issues/${number}`, '--jq', '.pull_request != null']).catch(() => null)
    if (out === null) throw new ProjectError('not_found', `GitHub에서 #${number}을 찾지 못했어요. 주소를 붙여 넣어 보세요.`)
    return `https://github.com/${github}/${out.trim() === 'true' ? 'pull' : 'issues'}/${number}`
  }

  // A PR's branch, when it lives in this repo (not a fork).
  async pullHead(github, number) {
    const out = await this.gh(['pr', 'view', String(number), '--repo', github, '--json', 'headRefName,isCrossRepository']).catch(() => null)
    if (!out) return null
    const pr = JSON.parse(out)
    return pr.isCrossRepository ? null : refName(pr.headRefName)
  }

  async create(dir, worktreeId, { mode = 'smart', value = '', base = '', branch = '', agent = 'claude', prompt = '', setup = 'inherit', activate = false }) {
    const repo = await this.repoOf(worktreeId)
    if (repo.kind !== 'git') throw new ProjectError('not_git', '깃 저장소가 아닌 프로젝트에는 작업 트리를 만들 수 없어요.')
    const plan = await this.plan(dir, repo, { mode, value, base, branch })
    const args = createArgs({ repoId: repo.id, ...plan, agent: AGENTS.includes(agent) ? agent : 'claude', prompt, setup: SETUPS.includes(setup) ? setup : 'inherit', activate })
    const result = await this.client.cli(args, CREATE_TIMEOUT_MS)
    return { path: createdPath(result), name: plan.name, branch: result?.worktree?.branch || plan.branch || null }
  }
}

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
      if (error) reject(new ProjectError('git_failed', (stderr || error.message).trim()))
      else resolve(stdout)
    })
  })
}

// gh as the signed-in account first; a private repo that one can't see is tried with the
// others, as clones are.
async function runGh(args) {
  const gh = findGh()
  if (!gh) throw new ProjectError('no_gh', 'GitHub CLI(gh)가 없어서 GitHub 목록을 가져오지 못했어요.')
  const run = (env) =>
    new Promise((resolve, reject) => {
      execFile(gh, args, { timeout: 15_000, env: { ...process.env, ...env, GH_PROMPT_DISABLED: '1' } }, (error, stdout, stderr) => (error ? reject(new ProjectError('gh_failed', (stderr || error.message).trim())) : resolve(stdout)))
    })
  try {
    return await run({})
  } catch (first) {
    for (const { token } of await githubAccounts(gh).catch(() => [])) {
      try {
        return await run({ GH_TOKEN: token })
      } catch {}
    }
    throw first
  }
}
