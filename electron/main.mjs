// Orrery as a Mac app: the same server and page in a window of its own, with the Dock
// badge counting questions and a notification when one comes while the window is away.
//   npm run app                              run from the source
//   ORRERY_PORT=4899 npm run app             another port
//   ORRERY_SMOKE=/tmp/shot.png npm run app   open quietly, save a picture of the window, quit
import { app, BrowserWindow, Menu, Notification, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.ORRERY_PORT || 4870)
const SMOKE = process.env.ORRERY_SMOKE
const SMOKE_MS = 7000

let win = null
let pageUrl = null
// Shown notifications, kept so a click on one still reaches us.
const notes = new Set()

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', show)
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]))
    pageUrl = await serverUrl()
    open()
  })
}
app.on('activate', show)
// On a Mac the app stays in the Dock with its window closed; the server idles meanwhile.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || SMOKE) app.quit()
})

// An Orrery already running on this port (started from a terminal) is used as it is:
// two servers would both read Orca and both play sound.
async function serverUrl() {
  const url = `http://127.0.0.1:${PORT}/`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) })
    if ((await res.text()).includes('<title>Orrery</title>')) return url
  } catch {}
  const { start } = await import('../server.mjs')
  return start({ port: PORT })
}

function open() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 520,
    title: 'Orrery',
    backgroundColor: '#03040e',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    // The sea and the bells keep playing while the window is behind others.
    webPreferences: { preload: path.join(HERE, 'preload.cjs'), backgroundThrottling: false }
  })
  win.once('ready-to-show', () => (SMOKE ? win.showInactive() : win.show()))
  win.on('closed', () => (win = null))
  // Still running behind other windows, but hidden or in the Dock there is nothing to
  // draw: the page stops the galaxy until the window is back.
  for (const [event, shown] of [['hide', false], ['minimize', false], ['show', true], ['restore', true]]) win.on(event, () => win?.webContents.send('shown', shown))
  // Links (a PR, a dev server) open in the browser; the window only ever shows Orrery.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(pageUrl)) return
    event.preventDefault()
    openOutside(url)
  })
  if (SMOKE) smoke()
  win.loadURL(pageUrl)
}

function show() {
  if (!pageUrl) return
  if (!win) return open()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function openOutside(url) {
  if (/^https?:\/\//.test(url)) shell.openExternal(url)
}

ipcMain.on('badge', (_event, count) => app.dock?.setBadge(count > 0 ? String(count) : ''))

ipcMain.on('notify', (_event, { handle, title, body }) => {
  if (!win || win.isFocused() || !Notification.isSupported()) return
  // The page rings its own bell, so the notification stays silent.
  const note = new Notification({ title: String(title).slice(0, 120), body: String(body).slice(0, 240), silent: true })
  notes.add(note)
  note.on('close', () => notes.delete(note))
  note.on('click', () => {
    notes.delete(note)
    show()
    win?.webContents.send('pick', handle)
  })
  note.show()
})

// Opens without taking the focus and without sound, saves what the window shows, and quits.
function smoke() {
  const errors = []
  win.webContents.setAudioMuted(true)
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message)
  })
  setTimeout(async () => {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(SMOKE, image.toPNG())
    console.log(JSON.stringify({ url: pageUrl, errors, badge: app.dock?.getBadge(), page: await win.webContents.executeJavaScript("({ inApp: document.body.classList.contains('in-app'), conn: document.querySelector('.conn').dataset.state, why: document.querySelector('.conn').title, sessions: document.querySelector('[data-count=all]').textContent })") }))
    app.quit()
  }, SMOKE_MS)
}
