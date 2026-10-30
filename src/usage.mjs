// Measures how much agent work went into each worktree, read-only, from the transcripts
// Claude Code and Codex already keep on disk. Transcripts are append-only, so each file is
// read once and afterwards only from the byte offset where the previous read stopped.
// Nothing is written anywhere; everything lives in memory.
import { EventEmitter } from 'node:events'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const SCAN_MS = 30_000
const LIVE_MS = 5_000
const RUNNING_MS = 20_000 // a subagent transcript touched this recently is still running
const GAP_MS = 5 * 60_000 // a longer pause between records is idle time, not work
const CHUNK = 1 << 20
const MAX_LINE = 64 << 20 // longer lines are skipped instead of buffered
const MAX_POOLED = 16 << 20
const HEAD = 64 << 10
const TAIL = 64 << 10
const CONCURRENCY = 2

const TS_KEY = Buffer.from('"timestamp":"')
const CWD_KEY = Buffer.from('"cwd":"')
const USAGE_KEY = Buffer.from('"usage":{')
const ID_KEY = Buffer.from('"id":"msg_')
const TYPE_FIRST = Buffer.from('{"type":"')
const SNAPSHOT_PREFIX = Buffer.from('{"type":"file-history-snapshot"')
const USER_KEY = Buffer.from('"type":"user"')
const CODEX_PREFIX = Buffer.from('{"timestamp":"')
const TOKEN_COUNT_KEY = Buffer.from('"type":"token_count"')
const IMPORT_KEY = Buffer.from('"turn_id":"external-import-turn-')

export class Usage extends EventEmitter {
  constructor({
    paths = [],
    claudeRoot = path.join(os.homedir(), '.claude', 'projects'),
    codexRoot = path.join(os.homedir(), '.codex', 'sessions'),
    scanMs = SCAN_MS,
    liveMs = LIVE_MS,
    now = Date.now
  } = {}) {
    super()
    this.getPaths = typeof paths === 'function' ? paths : () => paths
    this.claudeRoot = claudeRoot
    this.codexRoot = codexRoot
    this.scanMs = scanMs
    this.liveMs = liveMs
    this.now = now
    this.files = new Map() // transcript file -> what has been read from it so far
    this.codexHeads = new Map() // rollout file -> { cwd, firstAt, imported } from its first line
    this.results = new Map() // worktree path -> { tokens, activeMs, firstAt, lastAt }
    this.running = new Map() // worktree path -> subagents running right now
    this.paths = []
    this.pathKey = null
    this.lastKey = '{}' // the empty snapshot every client gets on connect
    this.subscribers = 0
    this.scanTimer = null
    this.liveTimer = null
    this.scanning = false
    this.rescan = false
    this.living = false
  }

  subscribe() {
    this.subscribers += 1
    if (this.subscribers === 1) {
      this.runScan()
      this.runLive()
    }
  }

  unsubscribe() {
    this.subscribers = Math.max(0, this.subscribers - 1)
    if (this.subscribers === 0) {
      clearTimeout(this.scanTimer)
      clearTimeout(this.liveTimer)
      this.scanTimer = this.liveTimer = null
    }
  }

  // Called on every Portal state change; only a different set of worktrees starts a pass.
  pathsChanged() {
    if (this.subscribers > 0 && currentPaths(this.getPaths).join('\n') !== this.pathKey) this.scheduleScan(200)
  }

  scheduleScan(ms) {
    clearTimeout(this.scanTimer)
    this.scanTimer = this.subscribers > 0 ? setTimeout(() => this.runScan(), ms) : null
  }

  async runScan() {
    if (this.scanning) {
      this.rescan = true
      return
    }
    this.scanning = true
    this.rescan = false
    try {
      await this.scan({ stop: () => this.subscribers === 0 })
    } catch {
      // Keep the last good numbers; the next pass tries again.
    } finally {
      this.scanning = false
      this.scheduleScan(this.rescan ? 200 : this.scanMs)
    }
  }

  async runLive() {
    clearTimeout(this.liveTimer)
    if (this.living) return
    this.living = true
    try {
      await this.live()
    } catch {
      // Keep the last counts; the next tick tries again.
    } finally {
      this.living = false
      if (this.subscribers > 0) this.liveTimer = setTimeout(() => this.runLive(), this.liveMs)
    }
  }

  snapshot() {
    const paths = {}
    for (const [p, r] of this.results) paths[p] = { ...r, subagents: this.running.get(p) || 0 }
    return { at: this.now(), paths }
  }

  publish() {
    const snapshot = this.snapshot()
    const key = JSON.stringify(snapshot.paths)
    if (key === this.lastKey) return
    this.lastKey = key
    this.emit('usage', snapshot)
  }

  // One incremental pass over every transcript of the current worktrees. Worktrees whose
  // Claude slugs collide share a project dir, so they are measured together. The cheapest
  // groups go first and new worktrees are published as soon as they're measured, so most
  // stars get their size within a second; later passes publish once, at the end.
  async scan({ stop = () => false } = {}) {
    const paths = currentPaths(this.getPaths)
    this.paths = paths
    this.pathKey = paths.join('\n')
    const codex = await this.codexFiles(paths)
    const groups = []
    for (const [dir, members] of slugGroups(this.claudeRoot, paths)) {
      const files = [...(await this.claudeFiles(dir)), ...members.flatMap((p) => codex.get(p) || [])]
      const pending = files.reduce((sum, f) => sum + Math.max(0, f.size - (this.files.get(f.file)?.offset || 0)), 0)
      groups.push({ members, files, pending })
    }
    groups.sort((a, b) => a.pending - b.pending)
    try {
      for (const group of groups) {
        if (stop()) return // nobody is watching any more; the next pass picks up from here
        await mapLimit(group.files, CONCURRENCY, async (f) => {
          await this.consume(f)
          await yieldNow()
        })
        const fresh = group.members.some((p) => !this.results.has(p))
        for (const p of group.members) this.results.set(p, this.aggregate(p, group.members, group.files))
        if (fresh) this.publish()
      }
    } finally {
      releaseBuffers()
    }
    for (const p of this.results.keys()) if (!paths.includes(p)) this.results.delete(p)
    this.publish()
  }

  // Subagents count as running while their transcript keeps changing.
  async live() {
    const paths = currentPaths(this.getPaths)
    const now = this.now()
    const running = new Map()
    for (const [dir, members] of slugGroups(this.claudeRoot, paths)) {
      for (const p of members) running.set(p, 0)
      for (const f of await this.claudeFiles(dir, { subagentsOnly: true })) {
        if (now - f.mtimeMs > RUNNING_MS) continue
        const state = this.stateFor(f)
        if (state.cwd == null) state.cwd = await peekCwd(f.file)
        for (const p of members) if (belongs(state.cwd, p, members)) running.set(p, running.get(p) + 1)
      }
    }
    this.running = running
    this.publish()
  }

  aggregate(p, members, files) {
    const total = { tokens: 0, activeMs: 0, firstAt: null, lastAt: null }
    for (const f of files) {
      const state = this.files.get(f.file)
      if (!state || state.foreign || !belongs(state.cwd, p, members)) continue
      total.tokens += state.tokens
      total.activeMs += state.activeMs
      if (state.firstAt && (total.firstAt === null || state.firstAt < total.firstAt)) total.firstAt = state.firstAt
      if (state.lastAt && (total.lastAt === null || state.lastAt > total.lastAt)) total.lastAt = state.lastAt
    }
    return total
  }

  stateFor(f, cwd = null) {
    let state = this.files.get(f.file)
    if (!state) {
      state = newState(f.kind, cwd)
      this.files.set(f.file, state)
    }
    return state
  }

  // Reads whatever was appended to one transcript since the last pass.
  async consume(f) {
    let state = this.stateFor(f, f.cwd)
    if (f.size < state.offset) {
      // Shrunk, so it was rewritten: start over.
      state = newState(f.kind, f.cwd ?? state.cwd)
      this.files.set(f.file, state)
    }
    if (state.foreign) {
      // A colliding project's transcript. Only read it once that project is open too.
      if (!claimed(state.cwd, this.paths)) return
      state = newState(f.kind, state.cwd)
      this.files.set(f.file, state)
    }
    if (state.cwd != null && !claimed(state.cwd, this.paths)) {
      state.foreign = true
      return
    }
    if (f.size === state.size) return
    if (f.kind === 'codex' && state.offset === 0 && (await this.codexShortcut(f, state))) {
      state.size = f.size
      return
    }
    const onLine = f.kind === 'codex' ? (line) => codexLine(state, line) : (line) => this.claudeLine(state, line)
    try {
      state.offset = await readLines(f.file, state.offset, f.size, onLine)
    } catch {
      // Vanished or unreadable partway: forget it rather than count some lines twice.
      this.files.set(f.file, newState(f.kind, state.cwd))
      return
    }
    if (state.foreign) Object.assign(state, newState(f.kind, state.cwd), { foreign: true })
    else state.size = f.size
  }

  // Lines can be megabytes of tool output, so each kind of record is searched only where
  // its own keys live (checked against every record type on this machine).
  claudeLine(state, line) {
    // Bookkeeping records (API requests, snapshots, mode changes) start with their type,
    // keep any timestamp among their first keys and never carry usage. A snapshot's only
    // timestamp is nested inside it.
    if (startsWith(line, TYPE_FIRST)) {
      if (!startsWith(line, SNAPSHOT_PREFIX)) addTime(state, firstTime(line, 2048))
      return
    }
    if (state.cwd == null) {
      // The last "cwd" on a line is the record's own; earlier ones belong to tool inputs.
      const at = line.lastIndexOf(CWD_KEY)
      if (at !== -1) state.cwd = readJsonString(line, at + CWD_KEY.length)
      if (state.cwd != null && !claimed(state.cwd, this.paths)) {
        state.foreign = true
        return false
      }
    }
    // User records keep tool results after their own timestamp, the others keep tool
    // inputs before it, so the record's key is the first or the last one respectively.
    if (line.subarray(0, 1024).indexOf(USER_KEY) !== -1) {
      addTime(state, firstTime(line))
      return
    }
    addTime(state, lastTime(line))
    if (line.indexOf(USAGE_KEY) !== -1) claudeUsage(state, line)
  }

  // Codex rollouts are discovered by their first line, which names the session's cwd.
  // Every file is opened once for that; only those of open worktrees are read further.
  async codexFiles(paths) {
    const byPath = new Map()
    for (const file of await listJsonl(this.codexRoot, 3)) {
      let head = this.codexHeads.get(file)
      if (!head) {
        head = await readCodexHead(file)
        if (!head) continue // its first line is still being written
        this.codexHeads.set(file, head)
      }
      // Imported Claude transcripts are copies of work already counted from ~/.claude.
      if (head.imported || !head.cwd) continue
      const owner = ownerOf(head.cwd, paths)
      if (!owner) continue
      const stat = await statFile(file)
      if (!stat) continue
      if (!byPath.has(owner)) byPath.set(owner, [])
      byPath.get(owner).push({ file, kind: 'codex', cwd: head.cwd, size: stat.size, mtimeMs: stat.mtimeMs })
    }
    return byPath
  }

  // Most Codex runs are short `codex exec` jobs: every record lies within one idle gap of
  // the first, and the token totals are cumulative. Then the first and last records say
  // everything, and a 30 MB rollout costs two small reads instead of a full one.
  async codexShortcut(f, state) {
    const head = this.codexHeads.get(f.file)
    if (!head?.firstAt || f.size <= TAIL) return false
    for (let window = TAIL; ; window *= 4) {
      const start = Math.max(0, f.size - window)
      let tail
      try {
        tail = await withRange(f.file, start, f.size, (buf) => {
          // Whole lines only: the window can begin and end mid-line.
          const end = buf.lastIndexOf(10)
          let from = start === 0 ? 0 : buf.indexOf(10) + 1
          let lastAt = 0
          let tokens = null
          while (end !== -1 && from <= end) {
            const nl = buf.indexOf(10, from)
            const line = buf.subarray(from, nl)
            from = nl + 1
            const time = recordTime(line)
            if (time > lastAt) lastAt = time
            if (isTokenCount(line)) tokens = codexTokens(parseJson(line)) ?? tokens
          }
          return { end, lastAt, tokens }
        })
      } catch {
        return false
      }
      const { end, lastAt, tokens } = tail
      if (lastAt && lastAt - head.firstAt > GAP_MS) return false // has idle gaps: read it all
      if ((!lastAt || tokens === null) && start > 0) continue // look further back
      if (end === -1) return false
      state.firstAt = head.firstAt
      state.lastAt = Math.max(lastAt, head.firstAt)
      state.activeMs = state.lastAt - state.firstAt
      state.tokens = tokens || 0
      state.offset = start + end + 1
      return true
    }
  }

  // Every transcript in one Claude project dir: <session>.jsonl, plus the subagent ones kept
  // in <session>/subagents/agent-*.jsonl (workflow agents one level deeper). Images, tool
  // output, memory and workflow journals sit next to them and are skipped.
  async claudeFiles(dir, { subagentsOnly = false } = {}) {
    const found = []
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return found
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        if (!subagentsOnly) found.push(full)
      } else if (entry.isDirectory()) {
        for (const file of await listJsonl(path.join(full, 'subagents'), 2)) if (path.basename(file).startsWith('agent-')) found.push(file)
      }
    }
    const files = []
    await mapLimit(found, 8, async (file) => {
      const stat = await statFile(file)
      if (stat) files.push({ file, kind: 'claude', size: stat.size, mtimeMs: stat.mtimeMs })
    })
    return files
  }
}

function newState(kind, cwd = null) {
  return { kind, cwd, foreign: false, size: 0, offset: 0, tokens: 0, activeMs: 0, firstAt: 0, lastAt: 0, lastId: null, lastCounted: 0, lastOut: 0, usagePrefix: null }
}

// Claude Code names a project dir after its cwd with every non-alphanumeric character
// replaced, so different paths (Korean names, for one) can map to the same dir.
export function claudeSlug(p) {
  return p.replace(/[^a-zA-Z0-9]/g, '-')
}

function slugGroups(root, paths) {
  const groups = new Map()
  for (const p of paths) {
    const dir = path.join(root, claudeSlug(p))
    if (!groups.has(dir)) groups.set(dir, [])
    groups.get(dir).push(p)
  }
  return groups
}

function currentPaths(getPaths) {
  const paths = new Set()
  for (const p of getPaths() || []) {
    if (typeof p === 'string' && path.isAbsolute(p)) paths.add(p.length > 1 ? p.replace(/\/+$/, '') : p)
  }
  return [...paths].sort()
}

function within(cwd, p) {
  return cwd === p || cwd.startsWith(p.endsWith('/') ? p : p + '/')
}

function claimed(cwd, paths) {
  return paths.some((p) => within(cwd, p))
}

// The most specific worktree, so a session in a nested worktree isn't counted twice.
function ownerOf(cwd, paths) {
  let owner = null
  for (const p of paths) if (within(cwd, p) && (!owner || p.length > owner.length)) owner = p
  return owner
}

// A transcript whose cwd is still unknown is given the benefit of the doubt unless its
// project dir is shared with another open worktree.
function belongs(cwd, p, members) {
  return cwd == null ? members.length === 1 : within(cwd, p)
}

function addTime(state, time) {
  if (!time) return
  if (!state.firstAt || time < state.firstAt) state.firstAt = time
  const gap = time - state.lastAt
  if (state.lastAt && gap > 0 && gap <= GAP_MS) state.activeMs += gap
  if (time > state.lastAt) state.lastAt = time
}

// One API message is written as one line per content block, each repeating the message id
// and its usage so far (output_tokens can still grow), so the last line of a run wins.
function claudeUsage(state, line) {
  const hint = readHintId(line)
  if (hint && hint === state.lastId && state.usagePrefix) {
    // Same message again: only output_tokens can have moved, so skip the full parse.
    const at = line.indexOf(state.usagePrefix)
    const out = at === -1 ? NaN : readInt(line, at + state.usagePrefix.length)
    if (Number.isFinite(out)) {
      state.tokens += out - state.lastOut
      state.lastCounted += out - state.lastOut
      state.lastOut = out
      return
    }
  }
  const record = parseJson(line)
  const usage = record?.type === 'assistant' && record.message?.usage
  if (!usage || typeof usage !== 'object') return
  const id = record.message.id || null
  const out = count(usage.output_tokens)
  const counted = count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + out
  if (id && id === state.lastId) state.tokens += counted - state.lastCounted
  else state.tokens += counted
  state.lastId = id
  state.lastCounted = counted
  state.lastOut = out
  state.usagePrefix = usagePrefix(usage)
}

// The exact text of a usage object up to its output_tokens value, e.g.
// "usage":{"input_tokens":2,"cache_creation_input_tokens":18811,...,"output_tokens":
function usagePrefix(usage) {
  let text = '"usage":{'
  for (const [key, value] of Object.entries(usage)) {
    text += `${JSON.stringify(key)}:`
    if (key === 'output_tokens') return Buffer.from(text)
    text += `${JSON.stringify(value)},`
  }
  return null
}

function codexLine(state, line) {
  addTime(state, recordTime(line))
  if (isTokenCount(line)) {
    const tokens = codexTokens(parseJson(line))
    if (tokens !== null) state.tokens = tokens
  }
}

// Codex reports cumulative totals, and its input_tokens include the cached part.
export function codexTokens(record) {
  const usage = record?.type === 'event_msg' && record.payload?.type === 'token_count' && record.payload.info?.total_token_usage
  if (!usage) return null
  return Math.max(0, count(usage.input_tokens) - count(usage.cached_input_tokens)) + count(usage.output_tokens)
}

function count(n) {
  return Number.isFinite(n) && n > 0 ? n : 0
}

// Codex lines start with their timestamp and type, ahead of any payload.
function recordTime(line) {
  return startsWith(line, CODEX_PREFIX) ? readTime(line, CODEX_PREFIX.length) : firstTime(line)
}

function isTokenCount(line) {
  return (startsWith(line, CODEX_PREFIX) ? line.subarray(0, 512) : line).indexOf(TOKEN_COUNT_KEY) !== -1
}

function firstTime(line, limit = line.length) {
  const at = line.subarray(0, limit).indexOf(TS_KEY)
  return at === -1 ? 0 : readTime(line, at + TS_KEY.length)
}

function lastTime(line) {
  const at = line.lastIndexOf(TS_KEY)
  return at === -1 ? 0 : readTime(line, at + TS_KEY.length)
}

function readTime(buf, start) {
  const end = buf.indexOf(34, start)
  if (end === -1 || end - start > 40) return 0
  return Date.parse(buf.toString('latin1', start, end)) || 0
}

function readHintId(line) {
  const at = line.indexOf(ID_KEY)
  if (at === -1) return null
  const start = at + 6 // past "id":"
  const end = line.indexOf(34, start)
  return end === -1 || end - start > 200 ? null : line.toString('latin1', start, end)
}

function readInt(buf, start) {
  let n = 0
  let i = start
  while (i < buf.length && buf[i] >= 48 && buf[i] <= 57) n = n * 10 + buf[i++] - 48
  return i === start ? NaN : n
}

// A JSON string value starting right after its opening quote.
function readJsonString(buf, start) {
  let i = start
  while (i < buf.length && buf[i] !== 34) i += buf[i] === 92 ? 2 : 1
  if (i >= buf.length) return null
  try {
    return JSON.parse(`"${buf.toString('utf8', start, i)}"`)
  } catch {
    return null
  }
}

function startsWith(buf, prefix) {
  return buf.length >= prefix.length && buf.compare(prefix, 0, prefix.length, 0, prefix.length) === 0
}

function parseJson(buf) {
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    return null
  }
}

// Calls onLine for every complete line in [start, end) and returns the offset just past the
// last newline, so a line still being written is read again, whole, next time. onLine can
// return false to stop early. An unfinished line is kept at the front of the buffer and
// the next read lands after it, so long lines cost no extra allocations.
async function readLines(file, start, end, onLine) {
  const handle = await fsp.open(file, 'r')
  let buf = takeBuffer(CHUNK)
  let pos = start // file offset of the next read
  let kept = 0 // bytes of an unfinished line at the front of buf
  let consumed = start
  let skipping = false // inside a line too long to keep
  try {
    while (pos < end) {
      if (kept === buf.length) {
        if (buf.length >= MAX_LINE) {
          skipping = true
          kept = 0
        } else {
          const bigger = takeBuffer(buf.length * 2)
          buf.copy(bigger, 0, 0, kept)
          giveBuffer(buf)
          buf = bigger
        }
      }
      const { bytesRead } = await handle.read(buf, kept, Math.min(buf.length - kept, end - pos), pos)
      if (!bytesRead) break
      const data = buf.subarray(0, kept + bytesRead)
      const base = pos - kept // file offset of data[0]
      let from = 0
      let nl = data.indexOf(10, kept)
      while (nl !== -1) {
        const line = data.subarray(from, nl)
        consumed = base + nl + 1
        from = nl + 1
        if (skipping) skipping = false
        else if (line.length && onLine(line) === false) return consumed
        nl = data.indexOf(10, from)
      }
      kept = skipping ? 0 : data.length - from
      if (kept && from) buf.copy(buf, 0, from, data.length)
      pos += bytesRead
    }
  } finally {
    giveBuffer(buf)
    await handle.close()
  }
  return consumed
}

// Reads [start, end) of a file and hands it to fn, which must be done with it on return:
// the buffer goes back to the pool for the next read.
async function withRange(file, start, end, fn) {
  const buf = takeBuffer(end - start)
  try {
    const handle = await fsp.open(file, 'r')
    let bytesRead
    try {
      ;({ bytesRead } = await handle.read(buf, 0, end - start, start))
    } finally {
      await handle.close()
    }
    return fn(buf.subarray(0, bytesRead))
  } finally {
    giveBuffer(buf)
  }
}

// Read buffers, grown ones included, are reused for the rest of a pass, so reading
// gigabytes with multi-megabyte lines doesn't churn the allocator. Dropped between passes.
const spare = []

function takeBuffer(size) {
  const i = spare.findIndex((b) => b.length >= size)
  return i === -1 ? Buffer.allocUnsafe(Math.max(size, CHUNK)) : spare.splice(i, 1)[0]
}

function giveBuffer(buf) {
  if (buf.length < CHUNK || buf.length > MAX_POOLED) return
  if (spare.length <= CONCURRENCY) return void spare.push(buf)
  const i = spare.findIndex((b) => b.length < buf.length)
  if (i !== -1) spare[i] = buf
}

function releaseBuffers() {
  spare.length = 0
}

async function readCodexHead(file) {
  try {
    const head = await withRange(file, 0, HEAD, codexHead)
    // A first line longer than HEAD: look once more, much further.
    return head === undefined ? await withRange(file, 0, CHUNK, (buf) => codexHead(buf) ?? null) : head
  } catch {
    return null
  }
}

// undefined: the first line goes on past this buffer. null: it is still being written.
function codexHead(buf) {
  const nl = buf.indexOf(10)
  if (nl === -1) return buf.length === HEAD ? undefined : buf.length >= CHUNK ? { cwd: null, firstAt: 0, imported: false } : null
  const record = parseJson(buf.subarray(0, nl))
  const cwd = record?.type === 'session_meta' && typeof record.payload?.cwd === 'string' ? record.payload.cwd : null
  return { cwd, firstAt: Date.parse(record?.timestamp) || 0, imported: buf.indexOf(IMPORT_KEY) !== -1 }
}

// The cwd of a transcript that hasn't been scanned yet, from its first lines.
async function peekCwd(file) {
  try {
    return await withRange(file, 0, HEAD, (buf) => {
      let from = 0
      let nl
      while ((nl = buf.indexOf(10, from)) !== -1) {
        const line = buf.subarray(from, nl)
        const at = line.lastIndexOf(CWD_KEY)
        if (at !== -1) return readJsonString(line, at + CWD_KEY.length)
        from = nl + 1
      }
      return null
    })
  } catch {
    return null
  }
}

async function listJsonl(dir, depth) {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full)
    else if (entry.isDirectory() && depth > 0) files.push(...(await listJsonl(full, depth - 1)))
  }
  return files
}

async function statFile(file) {
  try {
    const stat = await fsp.stat(file)
    return stat.isFile() ? stat : null
  } catch {
    return null
  }
}

function yieldNow() {
  return new Promise((resolve) => setImmediate(resolve))
}

async function mapLimit(items, limit, fn) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  })
  await Promise.all(workers)
}
