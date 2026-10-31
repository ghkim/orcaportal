// The page's bridge to the Mac app: the Dock badge, notifications, a click on one, and
// whether the window is on screen.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('orrery', {
  setBadge: (count) => ipcRenderer.send('badge', Number(count) || 0),
  notify: ({ handle, title, body }) => ipcRenderer.send('notify', { handle: String(handle), title: String(title), body: String(body) }),
  onPick: (fn) => ipcRenderer.on('pick', (_event, handle) => fn(handle)),
  onShown: (fn) => ipcRenderer.on('shown', (_event, shown) => fn(Boolean(shown)))
})
