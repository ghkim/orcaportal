// Servers running inside open worktrees: any process listening on a TCP port whose
// working directory is in a worktree (a dev server, a preview, a local API). Found
// with lsof every few seconds, only while a page is watching. Read-only.
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import path from 'node:path'

const POLL_MS = 4000
// Agent CLIs keep a port open for editor hookups; nobody started those as a server.
const AGENT = /(^|\/)(claude|codex)(\s|$)|\/\.local\/share\/claude\/versions\/|@anthropic-ai\/claude-code|@openai\/codex/
const RUNTIMES = /^(node|bun|deno|python[\d.]*|ruby|php|java)$/

export class Servers extends EventEmitter {
  constructor({ paths, run = runCommand, self = process.pid, pollMs = POLL_MS }) {
    super()
    this.paths = paths
    this.run = run
    this.self = self
    this.pollMs = pollMs
    this.current = {}
    this.key = '{}'
    this.subscribers = 0
    this.timer = null
    this.scanning = false
  }

  subscribe() {
    this.subscribers += 1
    if (this.subscribers === 1) this.poll()
  }

  unsubscribe() {
    this.subscribers = Math.max(0, this.subscribers - 1)
    if (this.subscribers === 0) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  snapshot() {
    return { at: Date.now(), paths: this.current }
  }

  async poll() {
    clearTimeout(this.timer)
    this.timer = null
    await this.scan()
    if (this.subscribers) this.timer = setTimeout(() => this.poll(), this.pollMs)
  }

  async scan() {
    if (this.scanning) return
    this.scanning = true
    try {
      const found = await this.find()
      const key = JSON.stringify(found)
      if (key === this.key) return
      this.key = key
      this.current = found
      this.emit('servers', this.snapshot())
    } catch {
      // No lsof (or it failed this once): keep what we had.
    } finally {
      this.scanning = false
    }
  }

  async find() {
    const listening = parseListening(await this.run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']))
    listening.delete(this.self)
    if (!listening.size) return {}
    const ids = [...listening.keys()].join(',')
    const [cwdOut, psOut] = await Promise.all([this.run('lsof', ['-a', '-d', 'cwd', '-p', ids, '-F', 'pn']), this.run('ps', ['-o', 'pid=,command=', '-p', ids])])
    const cwds = parseCwds(cwdOut)
    const commands = parseCommands(psOut)
    // The deepest worktree wins when one sits inside another.
    const roots = [...new Set(this.paths().filter(Boolean))].sort((a, b) => b.length - a.length)
    const found = {}
    for (const [pid, { command, ports }] of listening) {
      const line = commands.get(pid) || command
      if (AGENT.test(line) || AGENT.test(command)) continue
      const dir = cwds.get(pid)
      const root = dir && roots.find((r) => dir === r || dir.startsWith(r + path.sep))
      if (!root) continue
      ;(found[root] ||= []).push({ pid, name: nameOf(line, command), ports: [...ports].sort((a, b) => a - b) })
    }
    for (const list of Object.values(found)) list.sort((a, b) => a.ports[0] - b.ports[0])
    return found
  }
}

// lsof -F output: one field per line, tagged by its first letter.
export function parseListening(text) {
  const out = new Map()
  let current = null
  for (const line of text.split('\n')) {
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') {
      current = { command: '', ports: new Set() }
      out.set(Number(value), current)
    } else if (tag === 'c' && current) {
      current.command = value
    } else if (tag === 'n' && current) {
      const port = Number(value.slice(value.lastIndexOf(':') + 1))
      if (port) current.ports.add(port)
    }
  }
  for (const [pid, entry] of out) if (!entry.ports.size) out.delete(pid)
  return out
}

export function parseCwds(text) {
  const out = new Map()
  let pid = 0
  for (const line of text.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1))
    else if (line[0] === 'n' && pid) out.set(pid, line.slice(1))
  }
  return out
}

export function parseCommands(text) {
  const out = new Map()
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (match) out.set(Number(match[1]), match[2])
  }
  return out
}

// A short name: the script for `node vite …`-style launches, else the program. Generic
// entry files (cli.js, index.ts) are named after their package or folder instead.
const VALUE_FLAGS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--env-file', '-m'])
const GENERIC = new Set(['cli', 'index', 'main', 'bin', 'run', 'start'])

export function nameOf(line, fallback) {
  const parts = line.trim().split(/\s+/)
  const program = path.basename(parts[0] || fallback || '')
  if (!RUNTIMES.test(program)) return program || fallback
  let script = ''
  for (let i = 1; i < parts.length; i++) {
    if (parts[i] === '-m') return parts[i + 1] || program // python -m http.server
    if (VALUE_FLAGS.has(parts[i])) i++
    else if (!parts[i].startsWith('-')) {
      script = parts[i]
      break
    }
  }
  if (!script) return program
  const base = path.basename(script).replace(/\.(m?js|cjs|m?ts|py|rb)$/, '')
  if (!GENERIC.has(base)) return base
  const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules\/)/.exec(script)
  if (pkg) return pkg[1]
  const dirs = script.split('/').filter((d) => d && d !== 'src' && d !== 'dist' && d !== '.')
  return dirs.length > 1 ? dirs[dirs.length - 2] : base
}

// lsof exits 1 when some pid has gone away mid-call; what it printed is still good.
function runCommand(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error && !stdout) return reject(error)
      resolve(stdout)
    })
  })
}
