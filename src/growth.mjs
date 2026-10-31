// How far each repo has grown, for its star to grow by: what has landed on its default
// branch (each step of its first-parent line, a merged PR or a commit pushed straight to
// it), all the commits that branch holds, and the releases (tags) on it. Read from the
// repo's own refs, never fetched or written; it moves when the user pulls or fetches.
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'

const REFRESH_MS = 3 * 60_000
// Landings for each stage a star grows through; the page and the galaxy use the same.
export const STAGES = [5, 20, 60, 150, 400]
const RECENT = 12 // the latest landings, with what each one said
const RELEASES = 12 // the latest releases

export class Growth extends EventEmitter {
  constructor({ paths, read = readGrowth, refreshMs = REFRESH_MS }) {
    super()
    this.paths = paths
    this.read = read
    this.refreshMs = refreshMs
    this.found = new Map() // path -> { growth, at }
    this.subscribers = 0
    this.timer = null
    this.running = false
  }

  subscribe() {
    this.subscribers += 1
    if (this.subscribers === 1) this.schedule(1500)
  }

  unsubscribe() {
    this.subscribers = Math.max(0, this.subscribers - 1)
    if (this.subscribers === 0) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  // A new worktree is read soon, not on the next pass.
  pathsChanged() {
    if (!this.subscribers || this.running) return
    if (this.paths().some((p) => p && !this.found.has(p))) this.schedule(2000)
  }

  snapshot() {
    const paths = {}
    for (const p of this.paths()) {
      const found = this.found.get(p)
      if (found?.growth) paths[p] = found.growth
    }
    return { at: Date.now(), paths }
  }

  schedule(delay) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.pass(), delay)
  }

  async pass() {
    clearTimeout(this.timer)
    this.timer = null
    if (this.running) return
    this.running = true
    try {
      const now = Date.now()
      const due = [...new Set(this.paths().filter(Boolean))].filter((p) => !this.found.has(p) || now - this.found.get(p).at > this.refreshMs)
      let changed = false
      for (const p of due) {
        if (!this.subscribers) break
        const growth = await this.read(p).catch(() => null)
        const before = this.found.get(p)?.growth
        this.found.set(p, { growth, at: Date.now() })
        if (JSON.stringify(before) !== JSON.stringify(growth)) changed = true
      }
      if (changed) this.emit('growth', this.snapshot())
    } finally {
      this.running = false
      if (this.subscribers) this.schedule(this.refreshMs)
    }
  }
}

// One repo's growth, or null when it has no default branch to read.
export async function readGrowth(dir, git = runGit) {
  const base = await defaultRef(dir, git)
  if (!base) return null
  const count = async (args) => Number((await git(dir, args)).trim()) || 0
  const [landings, commits, log, tags] = await Promise.all([
    count(['rev-list', '--count', '--first-parent', base]),
    count(['rev-list', '--count', base]),
    git(dir, ['log', '--first-parent', `-n${RECENT}`, '--format=%h%x09%ct%x09%s', base]),
    git(dir, ['for-each-ref', `--merged=${base}`, '--sort=-creatordate', '--format=%(refname:short)%09%(objectname:short)%09%(creatordate:unix)', 'refs/tags'])
  ])
  // The landing that took the star into each stage it has reached: the n-th from the
  // first, counted along the first-parent line. Its hash picks what the stage adds.
  const marks = []
  for (const n of STAGES) {
    if (n > landings) break
    marks.push((await git(dir, ['rev-list', '--first-parent', `--skip=${landings - n}`, '-n1', base])).trim().slice(0, 12))
  }
  const releases = rows(tags).map(([name, hash, at]) => ({ name, hash, at: Number(at) * 1000 || null }))
  return {
    base: base.replace(/^origin\//, ''),
    landings,
    commits,
    releases: releases.length,
    latest: releases.slice(0, RELEASES),
    recent: rows(log).map(([hash, at, subject]) => ({ hash, at: Number(at) * 1000 || null, subject: (subject || '').slice(0, 120) })),
    marks
  }
}

// The branch PRs land on: origin's HEAD, else the usual names, remote first.
async function defaultRef(dir, git) {
  const head = (await git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')).trim()
  if (head) return head
  for (const name of ['origin/main', 'origin/master', 'main', 'master']) {
    if (await git(dir, ['rev-parse', '--verify', '--quiet', `${name}^{commit}`]).then(() => true, () => false)) return name
  }
  return null
}

function rows(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
}

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })
}
