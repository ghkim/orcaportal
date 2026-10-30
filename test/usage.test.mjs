import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Usage, claudeSlug, codexTokens } from '../src/usage.mjs'

const T0 = Date.parse('2026-10-01T00:00:00.000Z')
const SEC = 1000
const MIN = 60 * SEC
const iso = (ms) => new Date(T0 + ms).toISOString()
const jsonl = (records) => records.map((r) => `${JSON.stringify(r)}\n`).join('')

// Fixture records keep the key order Claude Code writes, which the scanner relies on.
function usage(input, created, read, output) {
  return { input_tokens: input, cache_creation_input_tokens: created, cache_read_input_tokens: read, output_tokens: output, service_tier: 'standard' }
}

function assistant(cwd, at, id, use, extra = {}) {
  return {
    parentUuid: 'p',
    isSidechain: false,
    message: { model: 'claude-x', id, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }], stop_reason: null, usage: use },
    ...extra,
    requestId: 'req_1',
    type: 'assistant',
    uuid: `u-${at}`,
    timestamp: iso(at),
    cwd,
    sessionId: 's1',
    version: '2.1.0'
  }
}

function user(cwd, at, extra = {}) {
  return { parentUuid: null, isSidechain: false, promptId: 'q', type: 'user', message: { role: 'user', content: 'go' }, uuid: `u-${at}`, timestamp: iso(at), ...extra, cwd, sessionId: 's1' }
}

const mode = { type: 'mode', mode: 'normal', sessionId: 's1' }

function codexMeta(cwd, at = 0) {
  return { timestamp: iso(at), ordinal: 0, type: 'session_meta', payload: { session_id: 'c1', id: 'c1', timestamp: iso(at), cwd, originator: 'codex_exec', source: 'exec', base_instructions: { text: 'You are Codex.' } } }
}

function tokenCount(at, info) {
  const totals = info && { input_tokens: info[0], cached_input_tokens: info[1], cache_write_input_tokens: 0, output_tokens: info[2], reasoning_output_tokens: 0, total_tokens: info[0] + info[2] }
  return { timestamp: iso(at), ordinal: 1, type: 'event_msg', payload: { type: 'token_count', info: totals ? { total_token_usage: totals, last_token_usage: totals } : null, rate_limits: null } }
}

function codexItem(at, text = 'done') {
  return { timestamp: iso(at), ordinal: 2, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } }
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orcaportal-usage-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const claudeRoot = path.join(root, 'claude')
  const codexRoot = path.join(root, 'codex')
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    return file
  }
  return {
    claudeRoot,
    codexRoot,
    write,
    claude: (worktree, name, records) => write(path.join(claudeRoot, claudeSlug(worktree), name), jsonl(records)),
    codex: (name, records) => write(path.join(codexRoot, '2026', '10', '01', name), jsonl(records)),
    usage: (paths) => new Usage({ paths, claudeRoot, codexRoot })
  }
}

async function measure(fx, paths) {
  const u = fx.usage(paths)
  await u.scan()
  return u.snapshot().paths
}

test('slugs follow Claude Code: every non-alphanumeric character becomes a dash', () => {
  assert.equal(claudeSlug('/Users/me/orca/projects/orcapotal'), '-Users-me-orca-projects-orcapotal')
  assert.equal(claudeSlug('/p/투명'), '-p---')
  assert.equal(claudeSlug('/p/투명'), claudeSlug('/p/할일'))
})

test('Claude tokens: each message once, its last block wins, cache reads left out', async (t) => {
  const fx = fixture(t)
  const app = '/p/app'
  fx.claude(app, 's1.jsonl', [
    mode,
    user(app, 0),
    // One API message written as two blocks; output_tokens grew by the second.
    assistant(app, 1 * SEC, 'msg_1', usage(2, 100, 5000, 10)),
    assistant(app, 2 * SEC, 'msg_1', usage(2, 100, 5000, 30)),
    user(app, 3 * SEC, { toolUseResult: { stdout: 'x', timestamp: '2020-01-01T00:00:00.000Z' } }),
    assistant(app, 4 * SEC, 'msg_2', usage(1, 0, 6000, 7)),
    assistant(app, 5 * SEC, 'msg_2', usage(1, 0, 6000, 7)),
    // Tool inputs can carry their own cwd and timestamp keys; the record's own ones count.
    assistant(app, 6 * SEC, 'msg_3', usage(3, 0, 6100, 4), { wireToolInputs: { toolu_1: { cwd: '/elsewhere', timestamp: '2020-01-01T00:00:00.000Z' } } }),
    // Not a model call: a background-task notice with its own usage summary.
    { parentUuid: 'p', isSidechain: false, attachment: { type: 'task-notification', usage: { totalTokens: 999 } }, type: 'attachment', uuid: 'a', timestamp: iso(7 * SEC), cwd: app, sessionId: 's1' }
  ])
  const result = (await measure(fx, [app]))[app]
  assert.equal(result.tokens, 2 + 100 + 30 + (1 + 0 + 7) + (3 + 0 + 4))
  assert.equal(result.firstAt, T0)
  assert.equal(result.lastAt, T0 + 7 * SEC)
  assert.equal(result.activeMs, 7 * SEC)
  assert.equal(result.subagents, 0)
})

test('active time adds gaps of up to five minutes per file, and files add up', async (t) => {
  const fx = fixture(t)
  const app = '/p/app'
  fx.claude(app, 'a.jsonl', [
    // A snapshot's only timestamp is nested and can be old; it is not a record time.
    { type: 'file-history-snapshot', messageId: 'm', snapshot: { messageId: 'm', trackedFileBackups: {}, timestamp: iso(-24 * 60 * MIN) }, isSnapshotUpdate: false },
    user(app, 0),
    assistant(app, 1 * MIN, 'msg_a1', usage(1, 0, 0, 1)),
    assistant(app, 2 * MIN, 'msg_a2', usage(1, 0, 0, 1)),
    user(app, 12 * MIN), // ten idle minutes: not work
    assistant(app, 13 * MIN, 'msg_a3', usage(1, 0, 0, 1))
  ])
  fx.claude(app, 'b.jsonl', [
    user(app, 0),
    assistant(app, 5 * MIN, 'msg_b1', usage(1, 0, 0, 1)), // exactly five minutes still counts
    assistant(app, 10 * MIN + SEC, 'msg_b2', usage(1, 0, 0, 1))
  ])
  const result = (await measure(fx, [app]))[app]
  assert.equal(result.activeMs, 3 * MIN + 5 * MIN)
  assert.equal(result.firstAt, T0)
  assert.equal(result.lastAt, T0 + 13 * MIN)
})

test('appended lines are read incrementally, a half-written line once it is whole', async (t) => {
  const fx = fixture(t)
  const app = '/p/app'
  const file = fx.claude(app, 's1.jsonl', [user(app, 0), assistant(app, 10 * SEC, 'msg_1', usage(1, 0, 0, 10))])
  const u = fx.usage([app])
  await u.scan()
  assert.equal(u.snapshot().paths[app].tokens, 11)

  const third = JSON.stringify(assistant(app, 30 * SEC, 'msg_3', usage(0, 0, 0, 100)))
  fs.appendFileSync(file, `${JSON.stringify(assistant(app, 20 * SEC, 'msg_2', usage(0, 0, 0, 5)))}\n${third.slice(0, 40)}`)
  await u.scan()
  assert.equal(u.snapshot().paths[app].tokens, 16)
  assert.equal(u.snapshot().paths[app].activeMs, 20 * SEC)
  assert.equal(u.files.get(file).offset, fs.statSync(file).size - 40, 'the partial line is left for later')

  fs.appendFileSync(file, `${third.slice(40)}\n`)
  await u.scan()
  assert.equal(u.snapshot().paths[app].tokens, 116)

  // The same message's next block arrives in a later write: it replaces, not adds.
  fs.appendFileSync(file, `${JSON.stringify(assistant(app, 31 * SEC, 'msg_3', usage(0, 0, 0, 120)))}\n`)
  await u.scan()
  const result = u.snapshot().paths[app]
  assert.equal(result.tokens, 136)
  assert.equal(result.activeMs, 31 * SEC)
  assert.equal(u.files.get(file).offset, fs.statSync(file).size)
})

test('lines longer than one read chunk are still read whole', async (t) => {
  const fx = fixture(t)
  const app = '/p/app'
  const big = 'y'.repeat(2_500_000) // real transcripts have tool output lines this long
  const huge = assistant(app, 2 * SEC, 'msg_2', usage(5, 0, 0, 5))
  huge.message.content = [{ type: 'text', text: big }]
  fx.claude(app, 's1.jsonl', [user(app, 0), assistant(app, SEC, 'msg_1', usage(1, 0, 0, 1)), user(app, 3 * SEC, { toolUseResult: { stdout: big } }), huge, assistant(app, 4 * SEC, 'msg_3', usage(7, 0, 0, 7))])
  const result = (await measure(fx, [app]))[app]
  assert.equal(result.tokens, 2 + 10 + 14)
  assert.equal(result.activeMs, 4 * SEC)
})

test('Codex tokens: last token_count total, cached input taken out', async (t) => {
  assert.equal(codexTokens(tokenCount(0, [1000, 800, 50])), 250)
  assert.equal(codexTokens(tokenCount(0, null)), null)
  assert.equal(codexTokens(codexItem(0)), null)

  const fx = fixture(t)
  const app = '/p/app'
  fx.codex('rollout-a.jsonl', [codexMeta(app), tokenCount(1 * SEC, null), tokenCount(10 * SEC, [1000, 800, 50]), codexItem(20 * SEC), tokenCount(60 * SEC, [3000, 2000, 120]), tokenCount(61 * SEC, null)])
  fx.codex('rollout-sub.jsonl', [codexMeta(`${app}/packages/web`, 2 * MIN), tokenCount(2 * MIN + SEC, [10, 0, 5])])
  fx.codex('rollout-other.jsonl', [codexMeta('/p/other'), tokenCount(SEC, [9999, 0, 9999])])
  // A Claude transcript imported into Codex repeats work already counted from ~/.claude.
  fx.codex('rollout-import.jsonl', [
    codexMeta(app),
    { timestamp: iso(SEC), ordinal: 1, type: 'event_msg', payload: { type: 'task_started', turn_id: 'external-import-turn-1' } },
    tokenCount(2 * SEC, [5000, 0, 5000])
  ])
  const result = (await measure(fx, [app, '/p/empty']))[app]
  assert.equal(result.tokens, 3000 - 2000 + 120 + 15)
  assert.equal(result.activeMs, 61 * SEC + SEC)
  assert.equal(result.firstAt, T0)
  assert.equal(result.lastAt, T0 + 2 * MIN + SEC)
})

test('large Codex rollouts: read from both ends when short, fully when they have idle gaps', async (t) => {
  const fx = fixture(t)
  const app = '/p/app'
  const filler = 'x'.repeat(200_000) // bigger than one tail read
  fx.codex('rollout-short.jsonl', [codexMeta(app), tokenCount(5 * SEC, [100, 0, 1]), codexItem(30 * SEC, filler), codexItem(60 * SEC, filler), tokenCount(2 * MIN, [400, 100, 20]), codexItem(2 * MIN + SEC)])
  fx.codex('rollout-gappy.jsonl', [codexMeta(app, 10 * MIN), codexItem(11 * MIN, filler), codexItem(30 * MIN, filler), tokenCount(31 * MIN, [50, 0, 50])])
  const u = fx.usage([app])
  await u.scan()
  const result = u.snapshot().paths[app]
  assert.equal(result.tokens, 400 - 100 + 20 + 100)
  assert.equal(result.activeMs, 2 * MIN + SEC + (1 * MIN + 1 * MIN))
  assert.equal(result.lastAt, T0 + 31 * MIN)

  // Either way, later appends continue from where the read stopped.
  fs.appendFileSync(path.join(fx.codexRoot, '2026', '10', '01', 'rollout-short.jsonl'), jsonl([tokenCount(2 * MIN + 30 * SEC, [600, 100, 40])]))
  await u.scan()
  assert.equal(u.snapshot().paths[app].tokens, 600 - 100 + 40 + 100)
  assert.equal(u.snapshot().paths[app].activeMs, 2 * MIN + 30 * SEC + 2 * MIN)
})

test('subagent transcripts touched in the last 20 seconds count as running', async (t) => {
  const fx = fixture(t)
  const app = '/p/app'
  const dir = path.join(fx.claudeRoot, claudeSlug(app))
  fx.claude(app, 's1.jsonl', [user(app, 0), assistant(app, SEC, 'msg_1', usage(1, 0, 0, 1))])
  const running = fx.write(path.join(dir, 's1', 'subagents', 'agent-a.jsonl'), jsonl([user(app, 2 * SEC), assistant(app, 3 * SEC, 'msg_s1', usage(10, 0, 0, 10))]))
  const finished = fx.write(path.join(dir, 's1', 'subagents', 'agent-b.jsonl'), jsonl([user(app, 2 * SEC), assistant(app, 4 * SEC, 'msg_s2', usage(100, 0, 0, 100))]))
  const workflow = fx.write(path.join(dir, 's1', 'subagents', 'workflows', 'wf_1', 'agent-c.jsonl'), jsonl([user(app, 2 * SEC)]))
  // Files that sit next to transcripts but aren't any.
  fx.write(path.join(dir, 's1', 'subagents', 'agent-a.meta.json'), '{"agentType":"general-purpose"}')
  const journal = fx.write(path.join(dir, 's1', 'subagents', 'workflows', 'wf_1', 'journal.jsonl'), '{"type":"started","agentId":"c"}\n')
  fx.write(path.join(dir, 's1', 'tool-results', 'shot.png'), 'PNG')
  fx.write(path.join(dir, 'memory', 'MEMORY.md'), '- note')
  const now = Date.now() / 1000
  fs.utimesSync(running, now - 5, now - 5)
  fs.utimesSync(workflow, now - 1, now - 1)
  fs.utimesSync(finished, now - 60, now - 60)
  fs.utimesSync(journal, now - 1, now - 1)

  const u = fx.usage([app])
  await u.live()
  assert.equal(u.snapshot().paths[app], undefined, 'nothing is reported before the first scan')
  await u.scan()
  const result = u.snapshot().paths[app]
  assert.equal(result.subagents, 2)
  assert.equal(result.tokens, 2 + 20 + 200, 'subagent work counts toward the worktree')

  fs.utimesSync(running, now - 30, now - 30)
  await u.live()
  assert.equal(u.snapshot().paths[app].subagents, 1)
})

test('projects whose slugs collide are told apart by the cwd in their transcripts', async (t) => {
  const fx = fixture(t)
  const clear = '/p/투명'
  const todo = '/p/할일'
  fx.claude(clear, 'a.jsonl', [mode, user(clear, 0), assistant(clear, SEC, 'msg_a', usage(10, 0, 0, 0))])
  fx.claude(todo, 'b.jsonl', [mode, user(todo, 0), assistant(todo, SEC, 'msg_b', usage(20, 0, 0, 0))])
  fx.claude('/p/위험', 'c.jsonl', [user('/p/위험', 0), assistant('/p/위험', SEC, 'msg_c', usage(40, 0, 0, 0))])

  const paths = [clear]
  const u = new Usage({ paths: () => paths, claudeRoot: fx.claudeRoot, codexRoot: fx.codexRoot })
  await u.scan()
  assert.deepEqual(Object.keys(u.snapshot().paths), [clear])
  assert.equal(u.snapshot().paths[clear].tokens, 10)

  // Once the other project is open too, its transcript is read after all.
  paths.push(todo)
  await u.scan()
  assert.equal(u.snapshot().paths[clear].tokens, 10)
  assert.equal(u.snapshot().paths[todo].tokens, 20)

  paths.splice(0, 1)
  await u.scan()
  assert.deepEqual(Object.keys(u.snapshot().paths), [todo], 'closed worktrees drop out')
})

test('a usage event goes out only when the numbers change', async (t) => {
  const fx = fixture(t)
  const app = '/p/app'
  const file = fx.claude(app, 's1.jsonl', [user(app, 0), assistant(app, SEC, 'msg_1', usage(1, 0, 0, 1))])
  const u = fx.usage([app])
  const events = []
  u.on('usage', (e) => events.push(e))
  await u.scan()
  await u.scan()
  assert.equal(events.length, 1)
  assert.deepEqual(Object.keys(events[0]).sort(), ['at', 'paths'])
  assert.deepEqual(events[0].paths[app], { tokens: 2, activeMs: SEC, firstAt: T0, lastAt: T0 + SEC, subagents: 0 })
  fs.appendFileSync(file, jsonl([assistant(app, 2 * SEC, 'msg_2', usage(1, 0, 0, 1))]))
  await u.scan()
  assert.equal(events.length, 2)
  assert.equal(events[1].paths[app].tokens, 4)
})
