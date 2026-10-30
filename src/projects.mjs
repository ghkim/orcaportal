// A new project from the galaxy: a folder beside the user's other projects, a git repo in
// it with the same empty "Initial commit" Orca starts projects with (or a clone of a repo
// the user named), added to Orca, and an agent (or a plain shell) in a terminal there.
// That terminal is what lights the new star. The work runs in the background and reports
// how far it has got, so the page can show the star gathering meanwhile.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile, spawn } from 'node:child_process'

export const AGENTS = ['claude', 'codex', 'shell']
// A clone that takes longer than this is stopped.
const CLONE_TIMEOUT_MS = 30 * 60_000
// How far along the whole birth is when each step starts; a clone fills the gap after it.
const STEPS = { start: 0, clone: 0.04, repo: 0.4, orca: 0.86, agent: 0.92 }

export class ProjectError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// A folder name the user typed: any language, spaces kept, nothing that walks the path.
export function projectName(value) {
  const name = typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : ''
  if (!name || name.length > 60 || name.startsWith('.') || /[/\\:*?"<>|\u0000-\u001f]/.test(name)) return null
  return name
}

// A repository address to clone: https, ssh or git, or the short `git@host:owner/repo`.
// Never an option, a local path or one of git's command-running transports. A bare
// `github.com/owner/repo` gets https in front.
export function gitUrl(value) {
  let url = typeof value === 'string' ? value.trim() : ''
  if (!url || url.length > 500 || /\s/.test(url) || url.startsWith('-')) return null
  if (/^[\w.-]+\.[a-z]{2,}\/[^:]+$/i.test(url)) url = `https://${url}`
  if (/^(?:https?|ssh|git):\/\/[^/@\s]+(?:@[^/\s]+)?\/[^\s]+$/.test(url)) return url
  if (/^[\w.-]+@[\w.-]+:[\w./~-]+$/.test(url)) return url
  return null
}

// The folder name a clone would get, as git names it: the address's last part without .git.
export function repoNameOf(url) {
  const last = (url || '').replace(/[/\\]+$/, '').split(/[/:]/).pop() || ''
  return last.replace(/\.git$/i, '')
}

// How far along a clone is, 0..1, from one line of git's progress (null for other lines).
export function cloneShare(line) {
  const match = /(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files):\s+(\d+)%/.exec(line)
  if (!match) return null
  const [from, to] = { 'Counting objects': [0, 0.04], 'Compressing objects': [0.04, 0.08], 'Receiving objects': [0.08, 0.82], 'Resolving deltas': [0.82, 0.93], 'Updating files': [0.93, 1] }[match[1]]
  return from + ((to - from) * Number(match[2])) / 100
}

// Where new projects go: the folder most of Orca's projects already share.
export function projectsHome(repoPaths, fallback = path.join(os.homedir(), 'orca', 'projects')) {
  const counts = new Map()
  for (const p of repoPaths) counts.set(path.dirname(p), (counts.get(path.dirname(p)) || 0) + 1)
  let home = fallback
  let most = 0
  for (const [dir, n] of counts) {
    if (n > most) {
      most = n
      home = dir
    }
  }
  return home
}

export class Projects extends EventEmitter {
  constructor(client, { git = runGit, clone = cloneAnyAccount, attempts = 4, retryMs = 600 } = {}) {
    super()
    this.client = client
    this.git = git
    this.clone = clone
    this.attempts = attempts
    this.retryMs = retryMs
    this.jobs = new Map() // path -> a birth under way, as last told
  }

  async home() {
    const repos = (await this.client.cli(['repo', 'list'])).repos || []
    return projectsHome(repos.map((r) => r.path))
  }

  // Where a project of this name would go, and whether something is already there.
  async check(name) {
    const dir = path.join(await this.home(), name)
    return { path: dir, taken: this.jobs.has(dir) || (await exists(dir)) }
  }

  // Starts a birth and answers once it is under way: the rest is told as 'birth' events,
  // { id, name, path, clone, step, progress } and at the end done with started, a
  // warning or an error.
  async begin({ name, agent = 'claude', prompt = '', url = null }) {
    const { path: dir, taken } = await this.check(name)
    if (taken) throw new ProjectError('exists', '같은 이름의 폴더가 이미 있어요.')
    const job = { id: crypto.randomUUID(), name, path: dir, clone: Boolean(url), step: 'start', progress: 0, done: false }
    this.jobs.set(dir, job)
    const tell = (patch) => {
      // Progress only ever goes forward, and small steps aren't worth a message.
      const progress = Math.max(job.progress, patch.progress ?? job.progress)
      if (patch.step === job.step && progress - job.progress < 0.01 && !patch.done) return
      Object.assign(job, patch, { progress })
      this.emit('birth', { ...job })
    }
    this.emit('birth', { ...job })
    this.create({ name, agent, prompt, url }, tell)
      .then(
        (result) => ({ step: 'done', progress: 1, done: true, started: result.started, warning: result.warning }),
        (error) => ({ done: true, error: error.message })
      )
      .then((last) => {
        this.jobs.delete(dir)
        tell(last)
      })
    return { path: dir, name }
  }

  async create({ name, agent = 'claude', prompt = '', url = null }, tell = () => {}) {
    const home = await this.home()
    const dir = path.join(home, name)
    try {
      await fsp.mkdir(home, { recursive: true })
      // A clone makes its own folder; it only has to be free.
      if (url && (await exists(dir))) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      if (!url) await fsp.mkdir(dir)
    } catch (error) {
      if (error.code === 'EEXIST') throw new ProjectError('exists', '같은 이름의 폴더가 이미 있어요.')
      throw new ProjectError('mkdir_failed', `폴더를 만들지 못했어요: ${error.message}`)
    }
    if (url) {
      tell({ step: 'clone', progress: STEPS.clone })
      await this.clone(url, dir, (share) => tell({ step: 'clone', progress: STEPS.clone + share * (STEPS.orca - STEPS.clone) }))
    } else {
      tell({ step: 'repo', progress: STEPS.repo })
      await this.git(dir, ['init', '-b', 'main'])
      // Without a git identity the commit fails; the repo works without one, as Orca's do.
      await this.git(dir, ['commit', '--allow-empty', '-m', 'Initial commit']).catch(() => {})
    }
    tell({ step: 'orca', progress: STEPS.orca })
    await this.client.cli(['repo', 'add', `--path=${dir}`])
    tell({ step: 'agent', progress: STEPS.agent })
    try {
      await this.launch(dir, { agent, prompt })
    } catch (error) {
      return { path: dir, name, started: false, warning: `프로젝트는 만들었는데 터미널을 열지 못했어요: ${error.message}` }
    }
    return { path: dir, name, started: true }
  }

  // An agent (or a plain shell) in a new terminal in `dir`, a folder Orca knows.
  async launch(dir, { agent = 'claude', prompt = '' } = {}) {
    const worktree = `--worktree=path:${dir}`
    const start =
      agent === 'shell'
        ? () => this.client.cli(['terminal', 'create', worktree])
        : () => this.client.cli(['agent', 'launch', `--agent=${agent}`, worktree, '--surface=terminal', ...(prompt ? [`--prompt=${prompt}`] : [])], 60_000)
    await this.retryUnseen(start)
    return { path: dir, started: true }
  }

  // A project Orca has just added can take a moment to answer to its path. Only that
  // refusal is retried: anything else may have started an agent already.
  async retryUnseen(start) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await start()
      } catch (error) {
        if (error.code !== 'selector_not_found' || attempt >= this.attempts) throw error
        await new Promise((resolve) => setTimeout(resolve, this.retryMs))
      }
    }
  }
}

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 15_000 }, (error, stdout, stderr) => {
      if (error) reject(new ProjectError('git_failed', (stderr || error.message).trim()))
      else resolve(stdout)
    })
  })
}

// `git clone` with its progress read as it goes. It never waits on a prompt: a private
// repo without saved credentials fails at once instead of hanging the clone. With a token,
// git signs in with it alone, for this clone only; the token stays out of the command line
// and out of the new repo's config.
export function runClone(url, dir, onShare, token = null) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes'
    const signIn = token ? ['-c', 'credential.helper=', '-c', 'credential.helper=!f() { echo username=x-access-token; echo "password=$ORRERY_GIT_TOKEN"; }; f'] : []
    if (token) env.ORRERY_GIT_TOKEN = token
    const child = spawn('git', [...signIn, 'clone', '--progress', '--', url, dir], { env, stdio: ['ignore', 'ignore', 'pipe'] })
    let tail = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, CLONE_TIMEOUT_MS)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      tail = (tail + chunk).slice(-4000)
      for (const line of chunk.split(/[\r\n]+/)) {
        const share = cloneShare(line)
        if (share !== null) onShare(share)
      }
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new ProjectError('git_missing', `git을 실행하지 못했어요: ${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve()
      const error = new ProjectError('clone_failed', timedOut ? '클론이 30분 넘게 걸려서 멈췄어요.' : cloneTrouble(tail))
      error.denied = !timedOut && cloneDenied(tail)
      reject(error)
    })
  })
}

// git signs in to GitHub as one account, and GitHub answers "not found" for a private repo
// that account can't see. When that happens, the clone is tried again as each account the
// gh CLI is signed in to on this Mac, until one gets in.
export async function cloneAnyAccount(url, dir, onShare, { clone = runClone, accounts = githubAccounts } = {}) {
  try {
    return await clone(url, dir, onShare)
  } catch (error) {
    if (!error.denied || !/^https:\/\/(?:[^@/]+@)?github\.com\//i.test(url)) throw error
    const tried = []
    for (const { login, token } of await accounts().catch(() => [])) {
      tried.push(login)
      try {
        return await clone(url, dir, onShare, token)
      } catch (again) {
        if (!again.denied) throw again
      }
    }
    if (!tried.length) throw error
    throw new ProjectError('clone_failed', `저장소를 찾을 수 없어요. 주소가 맞다면 비공개 저장소인데, 이 맥의 깃허브 계정(${tried.join(', ')})에는 들어갈 권한이 없어요.`)
  }
}

// The GitHub accounts the gh CLI is signed in to, each with its token, the active one last
// (git has most likely just tried it). None when gh isn't installed.
export async function githubAccounts(gh = findGh()) {
  if (!gh) return []
  const status = await runFile(gh, ['auth', 'status', '--hostname', 'github.com', '--json', 'hosts'])
  const signedIn = (JSON.parse(status).hosts?.['github.com'] || []).filter((a) => a.state === 'success')
  signedIn.sort((a, b) => Number(a.active) - Number(b.active))
  const accounts = []
  for (const { login } of signedIn) {
    const token = (await runFile(gh, ['auth', 'token', '--hostname', 'github.com', '--user', login]).catch(() => '')).trim()
    if (token) accounts.push({ login, token })
  }
  return accounts
}

// The Mac app starts with a short PATH, so Homebrew's folders are looked in as well.
export function findGh() {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin']
  for (const dir of dirs.filter(Boolean)) {
    const candidate = path.join(dir, 'gh')
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {}
  }
  return null
}

// gh exits non-zero when any one account has trouble, yet still prints the rest.
function runFile(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10_000 }, (error, stdout) => (stdout || !error ? resolve(stdout) : reject(error)))
  })
}

// GitHub turned the clone away: no access, or no sign-in at all.
export function cloneDenied(output) {
  return /Repository not found|could not read Username|Authentication failed|terminal prompts disabled|returned error: 40[13]/i.test(output)
}

// What went wrong, from the end of git's output, in words the user can act on.
export function cloneTrouble(output) {
  if (/could not read Username|Authentication failed|Permission denied \(publickey\)|terminal prompts disabled|Host key verification failed/i.test(output)) return '저장소를 찾을 수 없거나 들어갈 권한이 없어요. 주소를 확인하고, 비공개 저장소라면 이 맥에서 git 로그인(인증)을 먼저 해 주세요.'
  if (/not found|does not exist|does not appear to be a git repository/i.test(output)) return '저장소를 찾을 수 없어요. 주소를 확인하고, 비공개 저장소라면 이 맥의 git 계정에 권한이 있는지 확인해 주세요.'
  if (/Could not resolve host|unable to access|Connection refused|timed out/i.test(output)) return '저장소 주소에 연결하지 못했어요. 인터넷 연결이나 주소를 확인해 주세요.'
  const fatal = output.split(/[\r\n]+/).filter((line) => /^(fatal|error):/.test(line.trim())).pop()
  return `클론하지 못했어요${fatal ? `: ${fatal.trim().replace(/^(fatal|error):\s*/, '')}` : '.'}`
}

async function exists(p) {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}
