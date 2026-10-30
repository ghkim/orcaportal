import test from 'node:test'
import assert from 'node:assert/strict'
import { Servers, nameOf, parseListening } from '../src/servers.mjs'

// What lsof and ps print on a machine with a few things listening.
const LISTEN = ['p100', 'cnode', 'f20', 'n127.0.0.1:5179', 'f21', 'n[::1]:5179', 'p200', 'c2.1.312', 'f9', 'n127.0.0.1:59473', 'p300', 'cnode', 'f5', 'n*:7777', 'p400', 'cnode', 'f7', 'n127.0.0.1:4870', 'p500', 'cpython3', 'f3', 'n*:8000', 'p600', 'cnode', 'f3', 'n127.0.0.1:3000'].join('\n')
const CWDS = ['p100', 'fcwd', 'n/w/typing', 'p200', 'fcwd', 'n/w/tank', 'p300', 'fcwd', 'n/w/tank/net', 'p400', 'fcwd', 'n/w/portal', 'p500', 'fcwd', 'n/elsewhere', 'p600', 'fcwd', 'n/w/app/packages/web'].join('\n')
const PS = [
  '  100 node /w/typing/node_modules/.bin/vite --port 5179 --strictPort',
  '  200 /Users/me/.local/share/claude/versions/2.1.312 --session-id abc',
  '  300 node /home/.claude/plugins/tank/net/tank-net.mjs host',
  '  400 node server.mjs',
  '  500 python3 -m http.server',
  '  600 node /w/app/node_modules/.bin/next dev'
].join('\n')

function fakeRun(outputs) {
  const calls = []
  const run = async (file, args) => {
    calls.push([file, ...args].join(' '))
    if (file === 'ps') return outputs.ps
    return args.includes('cwd') ? outputs.cwd : outputs.listen
  }
  return { run, calls }
}

test('servers are matched to the worktree they run in', async () => {
  const { run } = fakeRun({ listen: LISTEN, cwd: CWDS, ps: PS })
  const servers = new Servers({ paths: () => ['/w/typing', '/w/tank', '/w/portal', '/w/app', '/w/app/packages/web'], run, self: 400 })
  const found = await servers.find()
  assert.deepEqual(found, {
    '/w/typing': [{ pid: 100, name: 'vite', ports: [5179] }],
    '/w/tank': [{ pid: 300, name: 'tank-net', ports: [7777] }],
    // The deepest worktree wins.
    '/w/app/packages/web': [{ pid: 600, name: 'next', ports: [3000] }]
  })
})

test('agent CLIs, the portal itself and servers outside worktrees are left out', async () => {
  const { run } = fakeRun({ listen: LISTEN, cwd: CWDS, ps: PS })
  const servers = new Servers({ paths: () => ['/w/tank', '/w/portal', '/elsewhere'], run, self: 400 })
  const found = await servers.find()
  assert.deepEqual(Object.keys(found).sort(), ['/elsewhere', '/w/tank'])
  assert.equal(found['/w/tank'].length, 1)
  assert.equal(found['/w/tank'][0].pid, 300)
})

test('an event goes out only when the set of servers changes', async () => {
  const outputs = { listen: LISTEN, cwd: CWDS, ps: PS }
  const { run } = fakeRun(outputs)
  const servers = new Servers({ paths: () => ['/w/typing'], run, self: 400 })
  const events = []
  servers.on('servers', (e) => events.push(e.paths))
  await servers.scan()
  await servers.scan()
  assert.equal(events.length, 1)
  outputs.listen = ''
  await servers.scan()
  assert.equal(events.length, 2)
  assert.deepEqual(events[1], {})
})

test('nothing listening means no further lsof or ps calls', async () => {
  const { run, calls } = fakeRun({ listen: '', cwd: '', ps: '' })
  const servers = new Servers({ paths: () => ['/w/a'], run, self: 1 })
  assert.deepEqual(await servers.find(), {})
  assert.equal(calls.length, 1)
})

test('a failing lsof keeps the last result', async () => {
  let fail = false
  const servers = new Servers({
    paths: () => ['/w/typing'],
    self: 400,
    run: async (file, args) => {
      if (fail) throw new Error('lsof: not found')
      if (file === 'ps') return PS
      return args.includes('cwd') ? CWDS : LISTEN
    }
  })
  await servers.scan()
  fail = true
  await servers.scan()
  assert.deepEqual(Object.keys(servers.snapshot().paths), ['/w/typing'])
})

test('parsing and naming', () => {
  const listening = parseListening(['p1', 'cnode', 'f1', 'n[::1]:4300', 'f2', 'n127.0.0.1:4300', 'f3', 'n127.0.0.1:4301', 'p2', 'cnode'].join('\n'))
  assert.deepEqual([...listening.get(1).ports], [4300, 4301])
  assert.equal(listening.has(2), false)
  assert.equal(nameOf('node /a/node_modules/.bin/vite --port 1', 'node'), 'vite')
  assert.equal(nameOf('node --inspect server.mjs', 'node'), 'server')
  assert.equal(nameOf('/usr/local/bin/redis-server *:6379', 'redis-ser'), 'redis-server')
  assert.equal(nameOf('', 'postgres'), 'postgres')
  assert.equal(nameOf('node --require /p/tsx/dist/preflight.cjs --import file:///p/tsx/dist/loader.mjs src/server.ts', 'node'), 'server')
  assert.equal(nameOf('node --require /p/preflight.cjs --import file:///p/loader.mjs server/src/index.ts', 'node'), 'server')
  assert.equal(nameOf('node --no-warnings /p/node_modules/wrangler/wrangler-dist/cli.js dev', 'node'), 'wrangler')
  assert.equal(nameOf('python3 -m http.server 8000', 'python3'), 'http.server')
})
