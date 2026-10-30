// Talks to the running Orca app.
// Reads (polled every second) go straight to Orca's local runtime socket, the same
// newline-delimited JSON RPC the `orca` CLI uses. Writes (send, focus) go through the
// CLI so its prompt-delivery and recovery logic applies. If the socket protocol ever
// changes, reads fall back to the CLI automatically.
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'

const MAC_CLI = '/Applications/Orca.app/Contents/Resources/bin/orca'
// Socket errors that mean "this call failed for a real reason", not "the protocol moved".
const APP_LEVEL_CODES = new Set(['terminal_handle_stale', 'invalid_argument', 'not_found'])

export class OrcaError extends Error {
  constructor(code, message) {
    super(message || code)
    this.code = code
  }
}

export function defaultUserDataPath() {
  if (process.env.ORCA_USER_DATA_PATH) return process.env.ORCA_USER_DATA_PATH
  const home = os.homedir()
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'orca')
  if (process.platform === 'win32') return path.join(process.env.APPDATA || home, 'orca')
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca')
}

export function resolveCli() {
  if (process.env.ORCA_CLI_COMMAND) return process.env.ORCA_CLI_COMMAND
  // On Linux a bare `orca` is usually the GNOME screen reader.
  if (process.platform === 'linux') return 'orca-ide'
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, 'orca')
    if (dir && isExecutable(candidate)) return candidate
  }
  return isExecutable(MAC_CLI) ? MAC_CLI : 'orca'
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

export class OrcaClient {
  constructor({ userDataPath = defaultUserDataPath(), cli = resolveCli() } = {}) {
    this.metadataPath = path.join(userDataPath, 'orca-runtime.json')
    this.cliPath = cli
    this.socketBrokenUntil = 0
  }

  get transport() {
    return Date.now() < this.socketBrokenUntil ? 'cli' : 'socket'
  }

  // Re-read on every call so an Orca restart (new socket, new token) is picked up.
  readMetadata() {
    let metadata
    try {
      metadata = JSON.parse(fs.readFileSync(this.metadataPath, 'utf8'))
    } catch {
      throw new OrcaError('runtime_unavailable', 'Orca 런타임 정보를 읽을 수 없어요. Orca 앱이 켜져 있는지 확인해 주세요.')
    }
    const transports = Array.isArray(metadata.transports) ? metadata.transports : [metadata.transport]
    const unix = transports.find((t) => t && (t.kind === 'unix' || t.kind === 'named-pipe'))
    if (!unix || !metadata.authToken) throw new OrcaError('runtime_unavailable', 'Orca 런타임 정보가 불완전해요.')
    return { endpoint: unix.endpoint, authToken: metadata.authToken, runtimeId: metadata.runtimeId }
  }

  rpc(method, params, timeoutMs = 8000) {
    const metadata = this.readMetadata()
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(metadata.endpoint)
      const id = crypto.randomUUID()
      let buffer = ''
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        error ? reject(error) : resolve(value)
      }
      const timer = setTimeout(() => finish(new OrcaError('runtime_timeout', 'Orca가 응답하지 않아요.')), timeoutMs)
      socket.setEncoding('utf8')
      socket.on('connect', () => {
        socket.write(`${JSON.stringify({ id, authToken: metadata.authToken, method, params })}\n`)
      })
      socket.on('error', () => finish(new OrcaError('runtime_unavailable', 'Orca에 연결할 수 없어요. Orca 앱이 켜져 있는지 확인해 주세요.')))
      socket.on('close', () => finish(new OrcaError('runtime_unavailable', 'Orca가 응답 전에 연결을 끊었어요.')))
      socket.on('data', (chunk) => {
        buffer += chunk
        let newline
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (!line.trim()) continue
          let frame
          try {
            frame = JSON.parse(line)
          } catch {
            return finish(new OrcaError('invalid_runtime_response', 'Orca 응답을 해석할 수 없어요.'))
          }
          if (frame._keepalive) {
            timer.refresh()
            continue
          }
          if (frame.id !== id) return finish(new OrcaError('invalid_runtime_response', 'Orca 응답 id가 맞지 않아요.'))
          if (frame.ok === false) return finish(new OrcaError(frame.error?.code || 'rpc_failed', frame.error?.message))
          return finish(null, frame.result)
        }
      })
    })
  }

  cli(args, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      execFile(this.cliPath, [...args, '--json'], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
        let parsed = null
        try {
          parsed = JSON.parse(stdout)
        } catch {}
        if (parsed?.ok === true) return resolve(parsed.result)
        if (parsed?.ok === false) return reject(new OrcaError(parsed.error?.code || 'cli_failed', parsed.error?.message))
        const detail = (stderr || stdout || error?.message || '').trim().split('\n').slice(-3).join(' ')
        reject(new OrcaError(error?.code === 'ENOENT' ? 'cli_missing' : 'cli_failed', detail || 'orca CLI 실행에 실패했어요.'))
      })
    })
  }

  async read(method, params, cliArgs) {
    if (this.transport === 'socket') {
      try {
        return await this.rpc(method, params)
      } catch (error) {
        if (APP_LEVEL_CODES.has(error.code)) throw error
        // Orca is down: the CLI would fail the same way, so don't double the cost.
        if (error.code === 'runtime_unavailable' && !fs.existsSync(this.metadataPath)) throw error
        const result = await this.cli(cliArgs)
        this.socketBrokenUntil = Date.now() + 60_000
        return result
      }
    }
    return this.cli(cliArgs)
  }

  workspaces() {
    return this.read('worktree.ps', { limit: 1000 }, ['worktree', 'ps', '--limit', '1000'])
  }

  terminals() {
    return this.read('terminal.list', { includeVisualLayouts: false }, ['terminal', 'list'])
  }

  screen(handle) {
    return this.read('terminal.read', { terminal: handle, screen: true }, ['terminal', 'read', `--terminal=${handle}`, '--screen'])
  }

  // `submit` sends text as a prompt with Enter; otherwise bytes go to the PTY verbatim.
  send(handle, text, { submit = false } = {}) {
    const args = ['terminal', 'send', `--terminal=${handle}`]
    if (text) args.push(`--text=${text}`)
    if (submit) args.push('--enter')
    return this.cli(args)
  }

  focus(handle) {
    return this.cli(['terminal', 'switch', `--terminal=${handle}`])
  }

  // Prefer the Orca worktree we were started from; outside one, let Orca pick.
  async openBrowserTab(url) {
    try {
      return await this.cli(['tab', 'create', `--url=${url}`, '--worktree=active'])
    } catch {
      return this.cli(['tab', 'create', `--url=${url}`])
    }
  }
}
