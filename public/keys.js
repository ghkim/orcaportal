// Named keys the page can press in a terminal, as the bytes a real keyboard would send.
// Shared by the page (labels) and the server (bytes), so the two can't drift apart.
export const KEYS = {
  up: { label: '↑', bytes: '\x1b[A' },
  down: { label: '↓', bytes: '\x1b[B' },
  left: { label: '←', bytes: '\x1b[D' },
  right: { label: '→', bytes: '\x1b[C' },
  enter: { label: 'Enter', bytes: '\r' },
  esc: { label: 'Esc', bytes: '\x1b' },
  tab: { label: 'Tab', bytes: '\t' },
  'shift-tab': { label: '⇧Tab', bytes: '\x1b[Z' },
  space: { label: 'Space', bytes: ' ' },
  backspace: { label: '⌫', bytes: '\x7f' },
  'ctrl-c': { label: '⌃C', bytes: '\x03' },
  y: { label: 'y', bytes: 'y' },
  n: { label: 'n', bytes: 'n' }
}
for (let digit = 0; digit <= 9; digit++) KEYS[String(digit)] = { label: String(digit), bytes: String(digit) }

export function keyBytes(keys) {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 40) return null
  let bytes = ''
  for (const key of keys) {
    const entry = Object.hasOwn(KEYS, key) ? KEYS[key] : null
    if (!entry) return null
    bytes += entry.bytes
  }
  return bytes
}
