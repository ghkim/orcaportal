// Polls Orca and keeps one merged picture of every live session: which project it
// belongs to, what its agent is doing, and what its terminal currently shows.
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'

const TICK_MS = 1000
const OFFLINE_RETRY_MS = 5000
const SCREEN_REFRESH_MS = 15_000
const SCREEN_CONCURRENCY = 6
// How long a session keeps the agent it last had when Orca briefly leaves it out.
const AGENT_HOLD_MS = 30_000

export class Portal extends EventEmitter {
  constructor(client) {
    super()
    this.client = client
    this.sessions = []
    this.screens = new Map() // handle -> { lines, key, lastOutputAt, readAt }
    this.status = { ok: false, error: null, transport: client.transport, checkedAt: 0 }
    this.stateKey = ''
    this.subscribers = 0
    this.timer = null
    this.ticking = false
    this.forced = new Set()
    this.agents = new Map() // handle -> what holdAgents last saw
    this.born = new Map() // folder -> when its repo appeared, see repoBornAt()
    this.bases = new Map() // folder -> the branch its pull requests go into
  }

  subscribe() {
    this.subscribers += 1
    if (this.subscribers === 1) this.loop()
  }

  unsubscribe() {
    this.subscribers = Math.max(0, this.subscribers - 1)
    if (this.subscribers === 0) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  // After the user acts on a terminal, read it again right away instead of waiting.
  refreshSoon(handle) {
    if (handle) this.forced.add(handle)
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.loop(), 150)
  }

  async loop() {
    clearTimeout(this.timer)
    if (this.ticking) return
    this.ticking = true
    try {
      await this.tick()
    } finally {
      this.ticking = false
      // While Orca is unreachable, retry slowly instead of spawning CLI fallbacks every second.
      if (this.subscribers > 0) this.timer = setTimeout(() => this.loop(), this.status.ok ? TICK_MS : OFFLINE_RETRY_MS)
    }
  }

  async tick() {
    let workspaces
    let terminals
    try {
      ;[workspaces, terminals] = await Promise.all([this.client.workspaces(), this.client.terminals()])
    } catch (error) {
      this.setStatus({ ok: false, error: error.message, code: error.code })
      return
    }
    this.setStatus({ ok: true, error: null })

    const sessions = holdAgents(mergeSessions(workspaces.worktrees || [], terminals.terminals || []), this.agents)
    await this.stampBirths(sessions)
    const live = new Set(sessions.map((s) => s.handle))
    for (const handle of this.screens.keys()) {
      if (!live.has(handle)) {
        this.screens.delete(handle)
        this.emit('screen', { handle, lines: null })
      }
    }

    const key = JSON.stringify(sessions.map((s) => ({ ...s, lastOutputAt: Math.floor((s.lastOutputAt || 0) / 10_000) })))
    this.sessions = sessions
    if (key !== this.stateKey) {
      this.stateKey = key
      this.emit('state', this.snapshot())
    }

    const now = Date.now()
    const due = sessions.filter((s) => {
      const known = this.screens.get(s.handle)
      return !known || this.forced.has(s.handle) || known.lastOutputAt !== s.lastOutputAt || now - known.readAt > SCREEN_REFRESH_MS
    })
    this.forced.clear()
    await mapLimit(due, SCREEN_CONCURRENCY, (s) => this.readScreen(s))
  }

  // When each session's repo first appeared on this Mac: the star's birth, for its look.
  // Read once per folder.
  async stampBirths(sessions) {
    for (const session of sessions) {
      if (!session.path) continue
      if (!this.born.has(session.path)) this.born.set(session.path, await repoBornAt(session.path))
      session.bornAt = this.born.get(session.path)
      // Where its pull request goes, to say "feature → main" when it merges.
      if (!session.pr) continue
      if (!this.bases.has(session.path)) this.bases.set(session.path, await baseBranch(session.path))
      session.base = this.bases.get(session.path)
    }
  }

  async readScreen(session) {
    let result
    try {
      result = await this.client.screen(session.handle)
    } catch {
      return
    }
    const terminal = result.terminal || {}
    const lines = joinWrappedRows(terminal.tail || [], terminal.tailRows || [])
    const key = lines.join('\n')
    const previous = this.screens.get(session.handle)
    this.screens.set(session.handle, { lines, key, lastOutputAt: session.lastOutputAt, readAt: Date.now() })
    if (previous?.key !== key) this.emit('screen', { handle: session.handle, lines })
  }

  setStatus(patch) {
    const next = { ...this.status, ...patch, transport: this.client.transport, checkedAt: Date.now() }
    const changed = next.ok !== this.status.ok || next.error !== this.status.error || next.transport !== this.status.transport
    this.status = next
    if (changed) this.emit('status', next)
  }

  snapshot() {
    return { sessions: this.sessions, at: Date.now() }
  }
}

export function mergeSessions(worktrees, terminals) {
  const byWorktree = new Map()
  const agentByPane = new Map()
  for (const worktree of worktrees) {
    byWorktree.set(worktree.worktreeId, worktree)
    for (const agent of worktree.agents || []) {
      const existing = agentByPane.get(agent.paneKey)
      // Prefer the pane's main agent over any child it spawned.
      if (!existing || (existing.parentPaneKey && !agent.parentPaneKey)) agentByPane.set(agent.paneKey, agent)
    }
  }

  // Orphaned terminals have a live PTY but no tab in Orca's window right now; they are
  // still the user's sessions, so they stay in.
  return terminals.map((t) => {
    const worktree = byWorktree.get(t.worktreeId)
    // Background terminals have no live tab; Orca remembers their pane as recordedPaneKey.
    const agent = agentByPane.get(`${t.tabId}:${t.leafId}`) || agentByPane.get(t.recordedPaneKey)
    const worktreePath = t.worktreePath || worktree?.path || ''
    return {
      handle: t.handle,
      title: t.paneTitle || t.title || '',
      worktreeId: t.worktreeId,
      path: worktreePath,
      project: worktree?.repo || path.basename(worktreePath) || '터미널',
      name: worktree?.displayName || shortBranch(t.branch) || '',
      branch: shortBranch(t.branch || worktree?.branch),
      comment: worktree?.comment || '',
      unread: Boolean(worktree?.unread),
      pinned: Boolean(worktree?.isPinned),
      pr: worktree?.linkedPR ? { number: worktree.linkedPR.number, state: worktree.linkedPR.state, title: worktree.linkedPR.title || '', checks: worktree.linkedPR.checksStatus || null } : null,
      connected: t.connected !== false,
      writable: t.writable !== false,
      background: Boolean(t.orphaned),
      lastOutputAt: t.lastOutputAt || 0,
      agentType: agent?.agentType || t.agentIdentity || null,
      agent: agent
        ? {
            state: agent.state,
            prompt: agent.prompt || '',
            lastAssistantMessage: agent.lastAssistantMessage || '',
            toolName: agent.toolName || '',
            toolInput: agent.toolInput || '',
            interrupted: Boolean(agent.interrupted),
            // Waiting on a background task it watches; Orca's sidebar shows it idle.
            monitoring: agent.workingMode === 'monitoring',
            stateStartedAt: agent.stateStartedAt || 0,
            updatedAt: agent.updatedAt || 0
          }
        : null
    }
  })
}

// Orca's agent fields blink: a terminal's agentIdentity drops out for a moment every few
// seconds, and an agent can miss a poll. Without a hold, a finished session falls to a
// plain shell and back, and the done count jumps with it.
export function holdAgents(sessions, memory, now = Date.now(), holdMs = AGENT_HOLD_MS) {
  const live = new Set()
  for (const session of sessions) {
    live.add(session.handle)
    const known = memory.get(session.handle) || {}
    if (session.agentType) Object.assign(known, { agentType: session.agentType, typeAt: now })
    else if (known.agentType && now - known.typeAt < holdMs) session.agentType = known.agentType
    if (session.agent) Object.assign(known, { agent: session.agent, agentAt: now })
    else if (known.agent && now - known.agentAt < holdMs) session.agent = known.agent
    memory.set(session.handle, known)
  }
  for (const handle of memory.keys()) if (!live.has(handle)) memory.delete(handle)
  return sessions
}

// When a repo first appeared here: the birth of its .git folder. A worktree's .git is a
// file pointing into the main repo's .git/worktrees, so every worktree of one repo gets
// the same time. A folder that isn't a repo gives its own birth; one that can't be read,
// null.
export async function repoBornAt(dir) {
  const birth = (stat) => Math.round(stat.birthtimeMs || stat.mtimeMs) || null
  const dotGit = path.join(dir, '.git')
  try {
    let gitDir = dotGit
    if ((await fsp.stat(dotGit)).isFile()) {
      const linked = (await fsp.readFile(dotGit, 'utf8')).match(/^gitdir:\s*(.+)$/m)?.[1]?.trim()
      if (linked) {
        const full = path.resolve(dir, linked)
        const at = full.lastIndexOf(`${path.sep}.git${path.sep}worktrees${path.sep}`)
        gitDir = at >= 0 ? full.slice(0, at + 5) : full
      }
    }
    return birth(await fsp.stat(gitDir))
  } catch {
    return fsp.stat(dir).then(birth, () => null)
  }
}

// The branch a repo's pull requests go into: what origin's HEAD points at ("main").
export function baseBranch(dir) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { timeout: 3000 }, (error, stdout) => {
      resolve(error ? null : stdout.trim().replace(/^origin\//, '') || null)
    })
  })
}

// A row flagged `wrapped` continues the row above it (xterm semantics).
export function joinWrappedRows(tail, rows) {
  const lines = []
  tail.forEach((text, index) => {
    if (rows[index]?.wrapped && lines.length > 0) lines[lines.length - 1] += text
    else lines.push(text)
  })
  return lines
}

function shortBranch(ref) {
  return (ref || '').replace(/^refs\/heads\//, '')
}

async function mapLimit(items, limit, fn) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  })
  await Promise.all(workers)
}
