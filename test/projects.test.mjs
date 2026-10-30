import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Projects, projectName, projectsHome, gitUrl, repoNameOf, cloneShare, cloneTrouble } from '../src/projects.mjs'

test('project names keep any language and refuse anything that walks the path', () => {
  assert.equal(projectName('  할일   앱 '), '할일 앱')
  assert.equal(projectName('tank-survival'), 'tank-survival')
  for (const bad of ['', '   ', '../x', 'a/b', 'a\\b', '.hidden', 'x'.repeat(61), 'a\u0000b', 42, null]) assert.equal(projectName(bad), null, String(bad))
})

test('new projects go where most projects already live', () => {
  const home = projectsHome(['/u/orca/projects/a', '/u/orca/projects/b', '/u/orca/c', '/u/other'])
  assert.equal(home, '/u/orca/projects')
  assert.equal(projectsHome([], '/fallback'), '/fallback')
})

// Orca and git stand-ins: what was asked of them is recorded, nothing real is touched.
function fakes(root, { launchFails = false, unseen = 0 } = {}) {
  const calls = []
  let misses = unseen
  const client = {
    async cli(args) {
      calls.push(args)
      if (args[0] === 'repo' && args[1] === 'list') return { repos: [{ path: path.join(root, 'old') }] }
      if (args[0] === 'agent' && misses-- > 0) throw Object.assign(new Error('selector_not_found'), { code: 'selector_not_found' })
      if (args[0] === 'agent' && launchFails) throw new Error('agent not installed')
      return {}
    }
  }
  const git = async (cwd, args) => calls.push(['git', ...args, cwd])
  // A clone that reports halfway, then all the way, and leaves a folder like git does.
  const clone = async (url, dir, onShare) => {
    calls.push(['clone', url, dir])
    if (url.includes('missing')) throw Object.assign(new Error('저장소를 찾을 수 없어요.'), { code: 'clone_failed' })
    onShare(0.5)
    onShare(1)
    fs.mkdirSync(dir)
  }
  return { calls, projects: new Projects(client, { git, clone, retryMs: 1 }) }
}

test('creating a project makes the folder, a repo, adds it to Orca and starts the agent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-projects-'))
  const { calls, projects } = fakes(root)
  const dir = path.join(root, '새 별')
  assert.deepEqual(await projects.check('새 별'), { path: dir, taken: false })
  const result = await projects.create({ name: '새 별', agent: 'claude', prompt: '할일 앱 만들어줘' })
  assert.deepEqual(result, { path: dir, name: '새 별', started: true })
  assert.ok(fs.statSync(dir).isDirectory())
  assert.deepEqual(calls.slice(1), [
    ['repo', 'list'],
    ['git', 'init', '-b', 'main', dir],
    ['git', 'commit', '--allow-empty', '-m', 'Initial commit', dir],
    ['repo', 'add', `--path=${dir}`],
    ['agent', 'launch', '--agent=claude', `--worktree=path:${dir}`, '--surface=terminal', '--prompt=할일 앱 만들어줘']
  ])
  assert.equal((await projects.check('새 별')).taken, true)
  await assert.rejects(projects.create({ name: '새 별' }), { code: 'exists' })
  fs.rmSync(root, { recursive: true })
})

test('a shell instead of an agent, and a launch that fails still leaves the project', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-projects-'))
  const shell = fakes(root)
  await shell.projects.create({ name: 'plain', agent: 'shell' })
  assert.deepEqual(shell.calls.at(-1), ['terminal', 'create', `--worktree=path:${path.join(root, 'plain')}`])
  const failing = fakes(root, { launchFails: true })
  const result = await failing.projects.create({ name: 'broken' })
  assert.equal(result.started, false)
  assert.match(result.warning, /agent not installed/)
  fs.rmSync(root, { recursive: true })
})

test('a project Orca has not picked up yet is tried again, a failed launch is not', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-projects-'))
  const late = fakes(root, { unseen: 2 })
  assert.equal((await late.projects.create({ name: 'late' })).started, true)
  assert.equal(late.calls.filter((c) => c[0] === 'agent').length, 3)
  const failing = fakes(root, { launchFails: true })
  await failing.projects.create({ name: 'once' })
  assert.equal(failing.calls.filter((c) => c[0] === 'agent').length, 1)
  fs.rmSync(root, { recursive: true })
})

test('another planet: an agent or a shell in a project already there, and nothing else', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-projects-'))
  const { calls, projects } = fakes(root)
  const dir = path.join(root, 'old')
  assert.deepEqual(await projects.launch(dir, { agent: 'codex', prompt: '테스트 고쳐줘' }), { path: dir, started: true })
  await projects.launch(dir, { agent: 'shell', prompt: 'ignored' })
  assert.deepEqual(calls, [
    ['agent', 'launch', '--agent=codex', `--worktree=path:${dir}`, '--surface=terminal', '--prompt=테스트 고쳐줘'],
    ['terminal', 'create', `--worktree=path:${dir}`]
  ])
  assert.equal(fs.readdirSync(root).length, 0)
  const failing = fakes(root, { launchFails: true })
  await assert.rejects(failing.projects.launch(dir, {}), /agent not installed/)
  fs.rmSync(root, { recursive: true })
})

test('git addresses: web, ssh and the short form, and nothing that could run a command', () => {
  assert.equal(gitUrl('https://github.com/ghkim/orcaportal.git'), 'https://github.com/ghkim/orcaportal.git')
  assert.equal(gitUrl(' git@github.com:ghkim/orcaportal.git '), 'git@github.com:ghkim/orcaportal.git')
  assert.equal(gitUrl('ssh://git@host.example/team/app.git'), 'ssh://git@host.example/team/app.git')
  assert.equal(gitUrl('github.com/ghkim/orcaportal'), 'https://github.com/ghkim/orcaportal')
  for (const bad of ['', '--upload-pack=touch x', 'ext::sh -c touch% x', 'file:///etc', '/Users/me/repo', '../repo', 'https://github.com', 'https://a.b/c d', 42]) assert.equal(gitUrl(bad), null, String(bad))
  assert.equal(repoNameOf('https://github.com/ghkim/orcaportal.git'), 'orcaportal')
  assert.equal(repoNameOf('git@github.com:team/할일-앱.git'), '할일-앱')
  assert.equal(repoNameOf('https://host/team/app/'), 'app')
})

test("a clone's progress is read from git's own lines, and its failures in plain words", () => {
  assert.equal(cloneShare('Cloning into app...'), null)
  assert.equal(cloneShare('remote: Counting objects: 100% (5/5), done.'), 0.04)
  assert.ok(Math.abs(cloneShare('Receiving objects:  50% (5/10), 1.00 MiB | 2 MiB/s') - 0.45) < 1e-9)
  assert.equal(cloneShare('Updating files: 100% (9/9), done.'), 1)
  assert.match(cloneTrouble("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), /권한이 없어요/)
  assert.match(cloneTrouble("remote: Repository not found.\nfatal: repository 'https://github.com/x/y/' not found"), /찾을 수 없어요/)
  assert.match(cloneTrouble('fatal: unable to access: Could not resolve host: nowhere'), /연결하지 못했어요/)
  assert.equal(cloneTrouble('fatal: something odd'), '클론하지 못했어요: something odd')
})

// Waits for the birth under way at `dir` to finish, collecting what it told.
function births(projects) {
  const told = []
  const done = new Promise((resolve) => projects.on('birth', (job) => (told.push(job), job.done && resolve())))
  return { told, done }
}

test('a birth answers at once, then tells each step until the terminal is up', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-projects-'))
  const { calls, projects } = fakes(root)
  const { told, done } = births(projects)
  const dir = path.join(root, '할일')
  assert.deepEqual(await projects.begin({ name: '할일', agent: 'shell' }), { path: dir, name: '할일' })
  assert.equal((await projects.check('할일')).taken, true)
  await done
  assert.deepEqual(told.map((j) => j.step), ['start', 'repo', 'orca', 'agent', 'done'])
  assert.ok(told.every((j, i) => i === 0 || j.progress >= told[i - 1].progress))
  assert.equal(told.at(-1).started, true)
  assert.equal(projects.jobs.size, 0)
  assert.deepEqual(calls.at(-1), ['terminal', 'create', `--worktree=path:${dir}`])
  await assert.rejects(projects.begin({ name: '할일' }), { code: 'exists' })
  fs.rmSync(root, { recursive: true })
})

test('a project from a git address is cloned, added to Orca and started; a failed clone says why', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-projects-'))
  const { calls, projects } = fakes(root)
  const dir = path.join(root, 'orcaportal')
  let run = births(projects)
  await projects.begin({ name: 'orcaportal', url: 'https://github.com/ghkim/orcaportal.git', agent: 'claude' })
  await run.done
  assert.deepEqual(run.told.map((j) => j.step), ['start', 'clone', 'clone', 'clone', 'orca', 'agent', 'done'])
  assert.ok(run.told.every((j) => j.clone))
  assert.deepEqual(calls.filter((c) => c[0] === 'clone' || c[0] === 'git' || c[1] === 'add'), [['clone', 'https://github.com/ghkim/orcaportal.git', dir], ['repo', 'add', `--path=${dir}`]])
  projects.removeAllListeners('birth')
  run = births(projects)
  await projects.begin({ name: 'gone', url: 'https://github.com/ghkim/missing.git' })
  await run.done
  assert.equal(run.told.at(-1).error, '저장소를 찾을 수 없어요.')
  assert.ok(!calls.some((c) => c[1] === 'add' && c[2].endsWith('gone')))
  fs.rmSync(root, { recursive: true })
})
