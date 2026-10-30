#!/usr/bin/env node
// Orrery: one page that shows every live Orca session at once, as a galaxy.
//   node server.mjs            start and print the URL
//   node server.mjs --open     also open it as a tab in Orca's built-in browser
//   PORT=4870 node server.mjs  pick the port (the next free one is used if taken)
// The Mac app imports it and calls start() itself.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { OrcaClient } from './src/orca.mjs'
import { Portal } from './src/portal.mjs'
import { Usage } from './src/usage.mjs'
import { Servers } from './src/servers.mjs'
import { Disk } from './src/disk.mjs'
import { Speaker } from './src/speaker.mjs'
import { Projects, projectName, AGENTS } from './src/projects.mjs'
import { keyBytes } from './public/keys.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(ROOT, 'public')
const HOST = '127.0.0.1'
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' }

// Anything that can type into a terminal can run commands, so every write needs this
// per-run token. Other sites can't read it: the page carries no CORS headers.
const token = crypto.randomBytes(24).toString('base64url')
const client = new OrcaClient()
const portal = new Portal(client)
// Agent work per worktree, read from Claude/Codex transcripts on disk, for star sizes.
const usage = new Usage({ paths: () => portal.sessions.map((s) => s.path) })
// A newly opened worktree gets measured right away instead of on the next pass.
portal.on('state', () => usage.pathsChanged())
// Dev servers and the like running inside worktrees, shown as small probes in orbit.
const servers = new Servers({ paths: () => portal.sessions.map((s) => s.path) })
// Disk used by each worktree (without .git), for planet sizes. Measured rarely.
const disk = new Disk({ paths: () => portal.sessions.map((s) => s.path) })
portal.on('state', () => disk.pathsChanged())
// With Orrery open in more than one place, only the page touched last plays sound.
const speaker = new Speaker()
// New projects made from the page: a folder, a repo, added to Orca, an agent started in it.
const projects = new Projects(client)
let port = 0 // set by start()

const server = http.createServer(async (req, res) => {
  try {
    if (!isAllowedHost(req.headers.host)) return send(res, 421, 'text/plain', 'Misdirected request')
    const url = new URL(req.url, `http://${req.headers.host}`)

    if (req.method === 'GET' && url.pathname === '/events') {
      if (url.searchParams.get('token') !== token) return send(res, 403, 'text/plain', 'Forbidden')
      return openEventStream(req, res, pageIdOf(url.searchParams.get('page')), url.searchParams.get('visible') !== '0')
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'POST') return send(res, 405, 'text/plain', 'Method not allowed')
      if (req.headers['x-portal-token'] !== token || !isSameOrigin(req)) return send(res, 403, 'text/plain', 'Forbidden')
      return handleApi(url.pathname, await readJson(req), res)
    }
    if (req.method === 'GET') return serveStatic(url.pathname, res)
    send(res, 405, 'text/plain', 'Method not allowed')
  } catch (error) {
    sendJson(res, 500, { ok: false, error: { code: 'server_error', message: error.message } })
  }
})

function isAllowedHost(host) {
  return host === `${HOST}:${port}` || host === `localhost:${port}`
}

function isSameOrigin(req) {
  const origin = req.headers.origin
  return !origin || origin === `http://${req.headers.host}`
}

function pageIdOf(value) {
  return typeof value === 'string' && /^[\w-]{8,64}$/.test(value) ? value : null
}

function openEventStream(req, res, page, visible) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
  const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  write('status', portal.status)
  write('state', portal.snapshot())
  write('usage', usage.snapshot())
  write('servers', servers.snapshot())
  write('disk', disk.snapshot())
  for (const [handle, screen] of portal.screens) write('screen', { handle, lines: screen.lines })
  if (page) speaker.join(page, { visible })
  write('speaker', { id: speaker.current })

  const onState = (data) => write('state', data)
  const onScreen = (data) => write('screen', data)
  const onStatus = (data) => write('status', data)
  const onUsage = (data) => write('usage', data)
  const onServers = (data) => write('servers', data)
  const onDisk = (data) => write('disk', data)
  const onSpeaker = (data) => write('speaker', data)
  portal.on('state', onState)
  portal.on('screen', onScreen)
  portal.on('status', onStatus)
  usage.on('usage', onUsage)
  servers.on('servers', onServers)
  disk.on('disk', onDisk)
  speaker.on('speaker', onSpeaker)
  portal.subscribe()
  usage.subscribe()
  servers.subscribe()
  disk.subscribe()
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    portal.off('state', onState)
    portal.off('screen', onScreen)
    portal.off('status', onStatus)
    usage.off('usage', onUsage)
    servers.off('servers', onServers)
    disk.off('disk', onDisk)
    speaker.off('speaker', onSpeaker)
    if (page) speaker.leave(page)
    portal.unsubscribe()
    usage.unsubscribe()
    servers.unsubscribe()
    disk.unsubscribe()
  })
}

async function handleApi(pathname, body, res) {
  if (pathname === '/api/speaker') {
    const page = pageIdOf(body.page)
    const visible = typeof body.visible === 'boolean' ? body.visible : undefined
    if (!page || !speaker.update(page, { touched: body.touched === true, visible })) return sendJson(res, 400, { ok: false, error: { code: 'invalid_argument', message: '이 창을 찾을 수 없어요.' } })
    return sendJson(res, 200, { ok: true, result: { id: speaker.current } })
  }
  if (pathname === '/api/project') return handleProject(body, res)
  if (pathname === '/api/session') return handleSession(body, res)
  const handle = typeof body.handle === 'string' ? body.handle : ''
  if (!/^term_[\w-]+$/.test(handle)) return sendJson(res, 400, { ok: false, error: { code: 'invalid_argument', message: '터미널을 찾을 수 없어요.' } })
  try {
    let result
    if (pathname === '/api/send') {
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text.trim()) return sendJson(res, 400, { ok: false, error: { code: 'invalid_argument', message: '보낼 내용이 없어요.' } })
      if (body.mode === 'type') {
        // Typing into an open menu's text field: plain bytes, then Enter on its own.
        // A raw newline would submit early, so lines are joined.
        await client.send(handle, text.replace(/\s*\r?\n\s*/g, ' '))
        result = await client.send(handle, '\r')
      } else {
        result = await client.send(handle, text, { submit: true })
      }
    } else if (pathname === '/api/keys') {
      const bytes = keyBytes(body.keys)
      if (!bytes) return sendJson(res, 400, { ok: false, error: { code: 'invalid_argument', message: '알 수 없는 키예요.' } })
      result = await client.send(handle, bytes)
    } else if (pathname === '/api/focus') {
      result = await client.focus(handle)
    } else if (pathname === '/api/close') {
      // Closing kills the terminal's process, so the request has to say it was confirmed.
      if (body.confirmed !== true) return sendJson(res, 400, { ok: false, error: { code: 'invalid_argument', message: '닫기는 확인이 필요해요.' } })
      result = await client.close(handle)
    } else {
      return sendJson(res, 404, { ok: false, error: { code: 'not_found', message: 'Unknown API' } })
    }
    portal.refreshSoon(handle)
    sendJson(res, 200, { ok: true, result })
  } catch (error) {
    sendJson(res, 200, { ok: false, error: { code: error.code || 'failed', message: error.message } })
  }
}

// `check` only says where the project would go; otherwise it is made and started.
async function handleProject(body, res) {
  const name = projectName(body.name)
  if (!name) return sendJson(res, 400, { ok: false, error: { code: 'invalid_argument', message: '이름에는 / \\ : * ? " < > | 를 쓸 수 없고, 점으로 시작할 수 없어요. 60자까지예요.' } })
  const agent = AGENTS.includes(body.agent) ? body.agent : 'claude'
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 4000) : ''
  try {
    const result = body.check === true ? await projects.check(name) : await projects.create({ name, agent, prompt })
    if (body.check !== true) portal.refreshSoon()
    sendJson(res, 200, { ok: true, result })
  } catch (error) {
    sendJson(res, 200, { ok: false, error: { code: error.code || 'failed', message: error.message } })
  }
}

// Another agent (or a shell) in a project already in the galaxy. Only a folder Orca shows
// a terminal for right now is accepted, so nothing starts anywhere else.
async function handleSession(body, res) {
  const dir = typeof body.path === 'string' ? body.path : ''
  if (!portal.sessions.some((s) => s.path === dir)) return sendJson(res, 400, { ok: false, error: { code: 'invalid_argument', message: '이 프로젝트를 찾을 수 없어요.' } })
  const agent = AGENTS.includes(body.agent) ? body.agent : 'claude'
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 4000) : ''
  try {
    const result = await projects.launch(dir, { agent, prompt })
    portal.refreshSoon()
    sendJson(res, 200, { ok: true, result })
  } catch (error) {
    sendJson(res, 200, { ok: false, error: { code: error.code || 'failed', message: `터미널을 열지 못했어요: ${error.message}` } })
  }
}

function serveStatic(pathname, res) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname))
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'text/plain', 'Not found')
  fs.readFile(file, (error, data) => {
    if (error) return send(res, 404, 'text/plain', 'Not found')
    const type = MIME[path.extname(file)] || 'application/octet-stream'
    if (path.basename(file) === 'index.html') data = data.toString('utf8').replace('__PORTAL_TOKEN__', token)
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
    res.end(data)
  })
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('Request too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type })
  res.end(body)
}

function sendJson(res, status, body) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body))
}

// Starts listening and resolves with the page's URL. Without a fixed port the next free
// one is taken; with `open` the page also opens as a tab in Orca's browser.
export function start({ port: wanted = Number(process.env.PORT || 4870), fixed = Boolean(process.env.PORT), open = false } = {}) {
  port = wanted
  return new Promise((resolve, reject) => {
    const attempt = (attemptsLeft) => {
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && attemptsLeft > 0 && !fixed) {
          port += 1
          return attempt(attemptsLeft - 1)
        }
        reject(new Error(`포트 ${port}을(를) 열 수 없어요: ${error.message}`))
      })
      server.listen(port, HOST, async () => {
        const url = `http://${HOST}:${port}/`
        resolve(url)
        if (!open) return
        try {
          await client.openBrowserTab(url)
          console.log('Orca 내장 브라우저에 탭을 열었어요.')
        } catch (error) {
          console.log(`Orca 탭을 열지 못했어요 (${error.message}). 위 주소를 직접 열어 주세요.`)
        }
      })
    }
    attempt(20)
  })
}

export function startFromCli(open) {
  start({ open })
    .then((url) => console.log(`Orrery: ${url}`))
    .catch((error) => {
      console.error(error.message)
      process.exit(1)
    })
}

// `node server.mjs` starts it right away; the npx entry and the app call in themselves.
if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) startFromCli(process.argv.includes('--open'))
