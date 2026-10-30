// A new project from the galaxy: a folder beside the user's other projects, a git repo in
// it with the same empty "Initial commit" Orca starts projects with, added to Orca, and an
// agent (or a plain shell) in a terminal there. That terminal is what lights the new star.
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

export const AGENTS = ['claude', 'codex', 'shell']

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

export class Projects {
  constructor(client, { git = runGit, attempts = 4, retryMs = 600 } = {}) {
    this.client = client
    this.git = git
    this.attempts = attempts
    this.retryMs = retryMs
  }

  async home() {
    const repos = (await this.client.cli(['repo', 'list'])).repos || []
    return projectsHome(repos.map((r) => r.path))
  }

  // Where a project of this name would go, and whether something is already there.
  async check(name) {
    const dir = path.join(await this.home(), name)
    return { path: dir, taken: await exists(dir) }
  }

  async create({ name, agent = 'claude', prompt = '' }) {
    const home = await this.home()
    const dir = path.join(home, name)
    try {
      await fsp.mkdir(home, { recursive: true })
      await fsp.mkdir(dir)
    } catch (error) {
      if (error.code === 'EEXIST') throw new ProjectError('exists', '같은 이름의 폴더가 이미 있어요.')
      throw new ProjectError('mkdir_failed', `폴더를 만들지 못했어요: ${error.message}`)
    }
    await this.git(dir, ['init', '-b', 'main'])
    // Without a git identity the commit fails; the repo works without one, as Orca's do.
    await this.git(dir, ['commit', '--allow-empty', '-m', 'Initial commit']).catch(() => {})
    await this.client.cli(['repo', 'add', `--path=${dir}`])
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

async function exists(p) {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}
