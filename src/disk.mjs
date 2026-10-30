// How much disk each open worktree takes, without its .git (that stays when the
// worktree goes). Walking a tree with node_modules takes seconds, so this runs
// rarely, one worktree at a time at low priority, and remembers what it found.
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'

const REFRESH_MS = 30 * 60_000
const DU_TIMEOUT_MS = 180_000

export class Disk extends EventEmitter {
  constructor({ paths, measure = measureDir, refreshMs = REFRESH_MS }) {
    super()
    this.paths = paths
    this.measure = measure
    this.refreshMs = refreshMs
    this.sizes = new Map() // path -> { bytes, at }
    this.subscribers = 0
    this.timer = null
    this.running = false
  }

  subscribe() {
    this.subscribers += 1
    if (this.subscribers === 1) this.schedule(0)
  }

  unsubscribe() {
    this.subscribers = Math.max(0, this.subscribers - 1)
    if (this.subscribers === 0) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  // A new worktree gets measured soon, not on the next half-hourly pass.
  pathsChanged() {
    if (!this.subscribers || this.running) return
    if (this.paths().some((p) => p && !this.sizes.has(p))) this.schedule(2000)
  }

  snapshot() {
    const paths = {}
    for (const p of this.paths()) {
      const size = this.sizes.get(p)
      if (size) paths[p] = size.bytes
    }
    return { at: Date.now(), paths }
  }

  schedule(delay) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.pass(), delay)
  }

  async pass() {
    this.timer = null
    if (this.running) return
    this.running = true
    try {
      const now = Date.now()
      const due = [...new Set(this.paths().filter(Boolean))]
        .filter((p) => !this.sizes.has(p) || now - this.sizes.get(p).at > this.refreshMs)
        // Never-measured worktrees first.
        .sort((a, b) => (this.sizes.get(a)?.at || 0) - (this.sizes.get(b)?.at || 0))
      for (const p of due) {
        if (!this.subscribers) break
        try {
          const bytes = await this.measure(p)
          const before = this.sizes.get(p)?.bytes
          this.sizes.set(p, { bytes, at: Date.now() })
          if (before !== bytes) this.emit('disk', this.snapshot())
        } catch {
          // Gone or unreadable: try again next pass.
        }
      }
    } finally {
      this.running = false
      if (this.subscribers) this.schedule(this.refreshMs)
    }
  }
}

// du in kilobytes, skipping .git, at low priority so a big node_modules walk never
// competes with the agents.
export function measureDir(dir) {
  const exclude = process.platform === 'darwin' || process.platform.endsWith('bsd') ? ['-I', '.git'] : ['--exclude=.git']
  return new Promise((resolve, reject) => {
    execFile('nice', ['-n', '15', 'du', '-sk', ...exclude, dir], { timeout: DU_TIMEOUT_MS }, (error, stdout) => {
      const kb = Number.parseInt(stdout, 10)
      if (Number.isFinite(kb)) return resolve(kb * 1024)
      reject(error || new Error('du gave no size'))
    })
  })
}
