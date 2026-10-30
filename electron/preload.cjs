// The page's bridge to the Mac app: the Dock badge, notifications, and a click on one.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('orrery', {
  setBadge: (count) => ipcRenderer.send('badge', Number(count) || 0),
  notify: ({ handle, title, body }) => ipcRenderer.send('notify', { handle: String(handle), title: String(title), body: String(body) }),
  onPick: (fn) => ipcRenderer.on('pick', (_event, handle) => fn(handle))
})
