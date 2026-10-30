import test from 'node:test'
import assert from 'node:assert/strict'
import { smartTarget, githubLink, worktreeName, refName, githubRepoOf, createArgs, createdPath, Worktrees } from '../src/worktrees.mjs'

test('the smart field reads links, numbers, Jira keys, remote branches and names', () => {
  assert.deepEqual(smartTarget('https://github.com/a/b/pull/7'), { kind: 'link', url: 'https://github.com/a/b/pull/7' })
  assert.deepEqual(smartTarget('#42'), { kind: 'number', number: 42 })
  assert.deepEqual(smartTarget('42'), { kind: 'number', number: 42 })
  assert.deepEqual(smartTarget('ORCA-12'), { kind: 'jira', key: 'ORCA-12' })
  assert.deepEqual(smartTarget('origin/feature/login', ['feature/login']), { kind: 'branch', branch: 'feature/login' })
  assert.deepEqual(smartTarget('fix login', ['feature/login']), { kind: 'name', name: 'fix login' })
})

test('names and refs never become options or paths', () => {
  assert.equal(worktreeName('  fix the  login '), 'fix-the-login')
  assert.equal(worktreeName('../../etc'), 'etc')
  assert.equal(worktreeName('a/b:c'), 'a-b-c')
  assert.equal(worktreeName('   '), null)
  assert.equal(refName('origin/main'), 'origin/main')
  assert.equal(refName('-rf'), null)
  assert.equal(refName('a..b'), null)
  assert.equal(refName('main; rm'), null)
  assert.deepEqual(githubLink('https://github.com/a/b/issues/3'), { repo: 'a/b', kind: 'issue', number: 3 })
  assert.equal(githubRepoOf('github.com/torderdev/api'), 'torderdev/api')
  assert.equal(githubRepoOf('git@github.com:ghkim/moatool.git'), 'ghkim/moatool')
  assert.equal(githubRepoOf('https://gitlab.com/a/b.git'), null)
})

test('the create command names the repo, never infers a parent and starts the agent in a terminal', () => {
  const args = createArgs({ repoId: 'r1', name: 'pr-7', base: 'origin/feat', branch: 'feat', references: ['https://github.com/a/b/pull/7'], agent: 'claude', prompt: 'go', setup: 'skip', activate: true })
  assert.deepEqual(args, ['worktree', 'create', '--repo=id:r1', '--name=pr-7', '--no-parent', '--base-branch=origin/feat', '--branch=feat', '--reference=https://github.com/a/b/pull/7', '--agent=claude', '--surface=terminal', '--prompt=go', '--setup=skip', '--activate'])
  const shell = createArgs({ repoId: 'r1', name: 'x', references: [], agent: 'shell', prompt: 'ignored', setup: 'inherit' })
  assert.deepEqual(shell, ['worktree', 'create', '--repo=id:r1', '--name=x', '--no-parent', '--setup=inherit'])
  assert.equal(createdPath({ worktree: { id: 'r1::/p/x' } }), '/p/x')
  assert.equal(createdPath({ worktree: { path: '/p/y' } }), '/p/y')
})

function fakes({ kind = 'git', github = 'a/b', pr = { headRefName: 'feat/x', isCrossRepository: false }, isPull = true } = {}) {
  const calls = []
  const client = {
    async cli(args) {
      calls.push(args)
      if (args[0] === 'repo') return { repo: { kind, path: '/p/app', gitRemoteIdentity: github ? { canonicalKey: `github.com/${github}` } : null } }
      return { worktree: { id: `r1::/p/${args.find((a) => a.startsWith('--name=')).slice(7)}`, branch: 'made' } }
    }
  }
  const git = async (_dir, args) => {
    calls.push(['git', ...args])
    if (args[0] === 'symbolic-ref') return 'origin/main\n'
    if (args[0] === 'for-each-ref') return 'origin/HEAD\norigin/main\norigin/feat/x\norigin/old\n'
    return ''
  }
  const gh = async (args) => {
    calls.push(['gh', ...args])
    if (args[0] === 'api') return isPull ? 'true\n' : 'false\n'
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify(pr)
    if (args[0] === 'pr') return JSON.stringify([{ number: 7, title: 'Login', headRefName: 'feat/x', author: { login: 'k' } }])
    return JSON.stringify([{ number: 3, title: 'Bug' }])
  }
  return { worktrees: new Worktrees(client, { git, gh }), calls }
}

test('options give the base and the remote branches, newest first', async () => {
  const { worktrees } = fakes()
  assert.deepEqual(await worktrees.options('/p/app', 'r1::/p/app'), { git: true, base: 'origin/main', branches: ['main', 'feat/x', 'old'], github: 'a/b' })
  assert.deepEqual(await fakes({ kind: 'folder' }).worktrees.options('/p/app', 'r1::/p/app'), { git: false })
})

test('a PR number of this repo is checked out on its own branch, with the PR linked', async () => {
  const { worktrees, calls } = fakes()
  const made = await worktrees.create('/p/app', 'r1::/p/app', { mode: 'smart', value: '#7', base: 'origin/main', agent: 'codex', prompt: 'review it' })
  assert.deepEqual(made, { path: '/p/pr-7', name: 'pr-7', branch: 'made' })
  assert.ok(calls.some((c) => c.join(' ') === 'git fetch origin feat/x'))
  const create = calls.find((c) => c[0] === 'worktree')
  assert.deepEqual(create, ['worktree', 'create', '--repo=id:r1', '--name=pr-7', '--no-parent', '--base-branch=origin/feat/x', '--branch=feat/x', '--reference=https://github.com/a/b/pull/7', '--agent=codex', '--surface=terminal', '--prompt=review it', '--setup=inherit'])
})

test('an issue gets a new branch from the base; a name too; a remote branch is fetched', async () => {
  let { worktrees, calls } = fakes({ isPull: false })
  await worktrees.create('/p/app', 'r1::/p/app', { mode: 'github', value: '3', base: 'origin/main', agent: 'shell' })
  assert.deepEqual(calls.find((c) => c[0] === 'worktree'), ['worktree', 'create', '--repo=id:r1', '--name=issue-3', '--no-parent', '--base-branch=origin/main', '--reference=https://github.com/a/b/issues/3', '--setup=inherit'])
  ;({ worktrees, calls } = fakes())
  await worktrees.create('/p/app', 'r1::/p/app', { mode: 'smart', value: 'fix login page', base: 'origin/main', branch: 'kim/fix', agent: 'shell' })
  assert.deepEqual(calls.find((c) => c[0] === 'worktree'), ['worktree', 'create', '--repo=id:r1', '--name=fix-login-page', '--no-parent', '--base-branch=origin/main', '--branch=kim/fix', '--setup=inherit'])
  ;({ worktrees, calls } = fakes())
  await worktrees.create('/p/app', 'r1::/p/app', { mode: 'branch', value: 'origin/old', base: 'origin/main', agent: 'shell' })
  assert.deepEqual(calls.find((c) => c[0] === 'worktree'), ['worktree', 'create', '--repo=id:r1', '--name=old', '--no-parent', '--base-branch=origin/old', '--branch=old', '--setup=inherit'])
})

test('the GitHub tab takes only issues and PRs, and a folder project has no worktrees', async () => {
  const { worktrees } = fakes()
  await assert.rejects(worktrees.create('/p/app', 'r1::/p/app', { mode: 'github', value: 'just a name' }), /GitHub 이슈·PR/)
  await assert.rejects(fakes({ kind: 'folder' }).worktrees.create('/p/app', 'r1::/p/app', { mode: 'name', value: 'x' }), /깃 저장소가 아닌/)
  await assert.rejects(fakes({ github: null }).worktrees.create('/p/app', 'r1::/p/app', { mode: 'smart', value: '#4' }), /GitHub 저장소에서만/)
  const list = await worktrees.github('r1::/p/app')
  assert.deepEqual(list, { repo: 'a/b', pulls: [{ number: 7, title: 'Login', branch: 'feat/x', author: 'k' }], issues: [{ number: 3, title: 'Bug' }] })
})
