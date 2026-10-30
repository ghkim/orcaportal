import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mergeSessions, joinWrappedRows, holdAgents, repoBornAt, baseBranch } from '../src/portal.mjs'

const worktrees = [
  {
    worktreeId: 'repo1::/p/app',
    repo: 'app',
    path: '/p/app',
    displayName: 'fix-login',
    branch: 'refs/heads/fix-login',
    unread: true,
    linkedPR: { number: 7, state: 'open', title: 'Fix login', url: 'https://example.test/pr/7', checksStatus: 'success' },
    agents: [
      { paneKey: 'tabA:leafA', parentPaneKey: null, agentType: 'claude', state: 'waiting', prompt: 'go' },
      { paneKey: 'tabB:leafB', parentPaneKey: null, agentType: 'codex', state: 'working', workingMode: 'monitoring' }
    ]
  }
]

test('terminals join their agent by tab:leaf, and background ones by recordedPaneKey', () => {
  const sessions = mergeSessions(worktrees, [
    { handle: 'term_1', worktreeId: 'repo1::/p/app', worktreePath: '/p/app', tabId: 'tabA', leafId: 'leafA', branch: 'refs/heads/fix-login' },
    { handle: 'term_2', worktreeId: 'repo1::/p/app', worktreePath: '/p/app', tabId: 'pty:x', leafId: 'pty:x', orphaned: true, recordedPaneKey: 'tabB:leafB' },
    { handle: 'term_3', worktreeId: 'other::/p/tool', worktreePath: '/p/tool', tabId: 't', leafId: 'l' }
  ])
  assert.equal(sessions[0].agent.state, 'waiting')
  assert.equal(sessions[0].project, 'app')
  assert.equal(sessions[0].branch, 'fix-login')
  assert.equal(sessions[0].unread, true)
  assert.equal(sessions[1].agent.state, 'working')
  assert.equal(sessions[1].agentType, 'codex')
  assert.equal(sessions[0].agent.monitoring, false)
  assert.equal(sessions[1].agent.monitoring, true)
  assert.equal(sessions[1].background, true)
  assert.equal(sessions[2].agent, null)
  assert.equal(sessions[2].project, 'tool')
  assert.deepEqual(sessions[0].pr, { number: 7, state: 'open', title: 'Fix login', checks: 'success' })
  assert.equal(sessions[2].pr, null)
})

test('wrapped rows rejoin the row above them', () => {
  assert.deepEqual(joinWrappedRows(['abc', 'def', 'ghi'], [{ wrapped: false }, { wrapped: true }, { wrapped: false }]), ['abcdef', 'ghi'])
  assert.deepEqual(joinWrappedRows(['x'], []), ['x'])
})

test('a session keeps its agent through a blink, and lets it go once it stays gone', () => {
  const memory = new Map()
  const agent = { state: 'done' }
  const at = (now, agentType, withAgent) => holdAgents([{ handle: 'term_1', agentType, agent: withAgent ? agent : null }], memory, now, 30_000)[0]
  assert.equal(at(0, 'claude', true).agentType, 'claude')
  const blink = at(1000, null, false)
  assert.equal(blink.agentType, 'claude')
  assert.equal(blink.agent, agent)
  assert.equal(at(2000, 'claude', true).agentType, 'claude')
  const gone = at(40_000, null, false)
  assert.equal(gone.agentType, null)
  assert.equal(gone.agent, null)
  // A closed terminal is forgotten.
  holdAgents([], memory, 41_000)
  assert.equal(memory.size, 0)
})

test("a star's birth is its repo's .git folder, the same for every worktree of it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-born-'))
  const main = path.join(root, 'app')
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'feature'), { recursive: true })
  const tree = path.join(root, 'app-feature')
  fs.mkdirSync(tree)
  fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'feature')}\n`)
  const plain = path.join(root, 'notes')
  fs.mkdirSync(plain)
  const born = await repoBornAt(main)
  assert.ok(born > 0)
  assert.equal(await repoBornAt(tree), born)
  assert.equal(await repoBornAt(plain), Math.round(fs.statSync(plain).birthtimeMs || fs.statSync(plain).mtimeMs))
  assert.equal(await repoBornAt(path.join(root, 'gone')), null)
  fs.rmSync(root, { recursive: true })
})

test("a merged PR's base is the branch the repo's origin points HEAD at", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-base-'))
  execFileSync('git', ['init', '-q', root])
  assert.equal(await baseBranch(root), null)
  execFileSync('git', ['-C', root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop'])
  assert.equal(await baseBranch(root), 'develop')
  assert.equal(await baseBranch(path.join(root, 'gone')), null)
  fs.rmSync(root, { recursive: true })
})
