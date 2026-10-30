import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Projects, projectName, projectsHome } from '../src/projects.mjs'

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
  return { calls, projects: new Projects(client, { git, retryMs: 1 }) }
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
