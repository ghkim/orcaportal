// How far each repo has grown, for its star to grow by: what has landed on its default
// branch (each step of its first-parent line, a merged PR or a commit pushed straight to
// it), all the commits that branch holds, and its releases. Read from the repo's own
// refs, never fetched or written; it moves when the user pulls or fetches.
// Releases are GitHub's first: a repo on GitHub that has releases there counts those,
// asked through the user's own `gh` (read only), as whichever of its signed-in accounts
// can see the repo. Any other repo, or one none of them can see, or with GitHub out of
// reach, counts the tags on its default branch.
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { findGh, githubAccounts } from './projects.mjs'

const REFRESH_MS = 3 * 60_000
const REMOTE_MS = 10 * 60_000 // GitHub is asked once in this long for each repo
const ACCOUNTS_MS = 60 * 60_000 // gh's signed-in accounts are looked up again after this
// Landings for each stage a star grows through; the page and the galaxy use the same.
export const STAGES = [5, 20, 60, 150, 400]
const RECENT = 12 // the latest landings, with what each one said
const RELEASES = 12 // the latest releases
// Tags (and GitHub releases) moved along to whatever was built last, not releases of
// their own.
const ROLLING = /(^|[-_/.])(latest|nightly|edge|canary)$/i

export class Growth extends EventEmitter {
  constructor({ paths, read = readGrowth, releases = releasesReader(), refreshMs = REFRESH_MS, remoteMs = REMOTE_MS }) {
    super()
    this.paths = paths
    this.read = read
    this.releases = releases // null: tags only
    this.refreshMs = refreshMs
    this.remoteMs = remoteMs
    this.found = new Map() // path -> { growth, at }, as the repo itself says
    this.remote = new Map() // owner/repo -> { releases, at }, null when GitHub has none to tell
    this.reported = '{}'
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
    return { at: Date.now(), paths: this.view() }
  }

  view() {
    const paths = {}
    for (const p of this.paths()) {
      const growth = this.found.get(p)?.growth
      if (growth) paths[p] = this.withReleases(growth)
    }
    return paths
  }

  // GitHub's releases in place of the tags, when GitHub has any for this repo.
  withReleases(growth) {
    const remote = growth.repo && this.remote.get(growth.repo)?.releases
    if (!remote?.length) return growth
    return { ...growth, releases: remote.length, latest: remote.slice(0, RELEASES), source: 'github' }
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
      // The repos first, all of them, and what they say is sent; then GitHub, which is
      // slower, and what it adds is sent after.
      const now = Date.now()
      const paths = [...new Set(this.paths().filter(Boolean))]
      for (const p of paths.filter((p) => !this.found.has(p) || now - this.found.get(p).at > this.refreshMs)) {
        if (!this.subscribers) break
        this.found.set(p, { growth: await this.read(p).catch(() => null), at: Date.now() })
      }
      this.report()
      const repos = new Set(paths.map((p) => this.found.get(p)?.growth?.repo).filter(Boolean))
      for (const repo of repos) {
        if (!this.subscribers || !this.releases) break
        const known = this.remote.get(repo)
        if (!known || Date.now() - known.at > this.remoteMs) await this.ask(repo, known)
      }
      this.report()
    } finally {
      this.running = false
      if (this.subscribers) this.schedule(this.refreshMs)
    }
  }

  // GitHub out of reach keeps what it said last; a Mac without gh stops asking.
  async ask(repo, known) {
    try {
      this.remote.set(repo, { releases: await this.releases(repo), at: Date.now() })
    } catch (error) {
      if (error.code === 'ENOENT') this.releases = null
      this.remote.set(repo, { releases: known?.releases ?? null, at: Date.now() })
    }
  }

  report() {
    const now = JSON.stringify(this.view())
    if (now === this.reported) return
    this.reported = now
    this.emit('growth', this.snapshot())
  }
}

// One repo's growth, or null when it has no default branch to read.
export async function readGrowth(dir, git = runGit) {
  const base = await defaultRef(dir, git)
  if (!base) return null
  const count = async (args) => Number((await git(dir, args)).trim()) || 0
  const [landings, commits, log, tags, origin] = await Promise.all([
    count(['rev-list', '--count', '--first-parent', base]),
    count(['rev-list', '--count', base]),
    git(dir, ['log', '--first-parent', `-n${RECENT}`, '--format=%h%x09%ct%x09%s', base]),
    git(dir, ['for-each-ref', `--merged=${base}`, '--sort=-creatordate', '--format=%(refname:short)%09%(objectname:short)%09%(*objectname:short)%09%(creatordate:unix)', 'refs/tags']),
    git(dir, ['remote', 'get-url', 'origin']).catch(() => '')
  ])
  // The landing that took the star into each stage it has reached: the n-th from the
  // first, counted along the first-parent line. Its hash picks what the stage adds.
  const marks = []
  for (const n of STAGES) {
    if (n > landings) break
    marks.push((await git(dir, ['rev-list', '--first-parent', `--skip=${landings - n}`, '-n1', base])).trim().slice(0, 12))
  }
  const releases = tagReleases(rows(tags))
  return {
    repo: githubRepo(origin),
    source: 'tags',
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

// One release for each commit tagged, the newest first, by its shortest name
// ("v3.1.10" over "us-east/v3.1.10"); tags moved along to the latest build are left out.
function tagReleases(tags) {
  const byCommit = new Map()
  for (const [name, object, peeled, at] of tags) {
    if (ROLLING.test(name)) continue
    const hash = peeled || object
    const known = byCommit.get(hash)
    if (!known) byCommit.set(hash, { name, hash, at: Number(at) * 1000 || null })
    else if (name.length < known.name.length) known.name = name
  }
  return [...byCommit.values()]
}

// "owner/repo" for a repo whose origin is on github.com, else null.
export function githubRepo(url) {
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(url).trim())
  return match ? `${match[1]}/${match[2]}` : null
}

// Asks for a repo's releases as each account gh is signed in to on this Mac until one
// can see it, and keeps that account for the owner's other repos ("torderdev" as the
// work account, the user's own repos as their own). Tokens stay in memory and reach gh
// only through its environment. Null on a Mac without gh.
export function releasesReader({ gh = findGh(), accounts = () => githubAccounts(gh), run = runGh } = {}) {
  if (!gh) return null
  const byOwner = new Map() // owner -> token of the account that sees its repos
  let signedIn = { list: null, at: 0 }
  // The active account first (githubAccounts lists it last).
  const tokens = async () => {
    if (!signedIn.list || Date.now() - signedIn.at > ACCOUNTS_MS) signedIn = { list: await accounts().catch(() => []), at: Date.now() }
    return signedIn.list.map((a) => a.token).reverse()
  }
  // Null when no account can see the repo. An account in trouble (its token gone, or the
  // owner's IP allow list shutting this network out) leaves the next to try; if none
  // sees the repo then, the others' "not found" is no answer, and what GitHub said last
  // is kept, so a star counted by GitHub at the office is not counted by tags at home.
  return async function releases(repo) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null
    const owner = repo.split('/')[0]
    const known = byOwner.get(owner)
    let trouble = null
    for (const token of [...new Set([known, ...(await tokens())])].filter(Boolean)) {
      try {
        const found = await githubReleases(repo, (args) => run(gh, args, token))
        if (!found) continue
        byOwner.set(owner, token)
        return found
      } catch (error) {
        trouble = error
      }
    }
    if (trouble) throw trouble
    return null
  }
}

// A repo's published releases on GitHub, the newest first, asked through `gh`: null
// when GitHub has no such repo for that account (a 403 is more likely the rate limit,
// and is asked again like GitHub out of reach). Drafts are not releases yet, and
// releases moved along to the latest build are not releases of their own.
export async function githubReleases(repo, gh) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null
  let out
  try {
    out = await gh(['api', '--paginate', `repos/${repo}/releases?per_page=100`, '--jq', '.[] | select(.draft | not) | [.tag_name, (.published_at // .created_at), .prerelease] | @tsv'])
  } catch (error) {
    if (/HTTP 404/.test(error.stderr || '')) return null
    throw error
  }
  return rows(out)
    .filter(([name]) => !ROLLING.test(name))
    .map(([name, at, pre]) => ({ name, at: Date.parse(at) || null, pre: pre === 'true' }))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
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

function runGh(gh, args, token) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GH_TOKEN: token, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }
    execFile(gh, args, { timeout: 20_000, maxBuffer: 8 * 1024 * 1024, env }, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr })) : resolve(stdout)))
  })
}
