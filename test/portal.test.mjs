import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeSessions, joinWrappedRows } from '../src/portal.mjs'

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
      { paneKey: 'tabB:leafB', parentPaneKey: null, agentType: 'codex', state: 'working' }
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
