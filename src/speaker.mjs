import { EventEmitter } from 'node:events'

// Orrery can be open in several places at once (Orca's own tab, a browser window), and
// each would play its own sea and bells. Only one page plays: the one touched last among
// those on screen, or the one touched last at all if none is. A page that closes hands
// over to the one before it. A reload keeps its turn: the page keeps its id, and a short
// grace lets it come back before anything changes hands.
export class Speaker extends EventEmitter {
  constructor({ graceMs = 4000 } = {}) {
    super()
    this.graceMs = graceMs
    this.order = [] // page ids, touched longest ago first
    this.visible = new Set()
    this.streams = new Map() // page id -> open event streams
    this.leaving = new Map() // page id -> timer
    this.current = null
  }

  join(id, { visible = true } = {}) {
    clearTimeout(this.leaving.get(id))
    this.leaving.delete(id)
    this.streams.set(id, (this.streams.get(id) || 0) + 1)
    // A page nobody has touched yet waits behind the ones that have been.
    if (!this.order.includes(id)) this.order.unshift(id)
    this.see(id, visible)
    this.settle()
  }

  leave(id) {
    const left = (this.streams.get(id) || 0) - 1
    if (left > 0) return void this.streams.set(id, left)
    this.streams.delete(id)
    clearTimeout(this.leaving.get(id))
    this.leaving.set(
      id,
      setTimeout(() => {
        this.leaving.delete(id)
        this.order = this.order.filter((page) => page !== id)
        this.visible.delete(id)
        this.settle()
      }, this.graceMs)
    )
  }

  // A page was clicked or typed into, or came on or off screen.
  update(id, { touched = false, visible } = {}) {
    if (!this.streams.has(id)) return false
    if (typeof visible === 'boolean') this.see(id, visible)
    if (touched) this.order = [...this.order.filter((page) => page !== id), id]
    this.settle()
    return true
  }

  see(id, visible) {
    if (visible) this.visible.add(id)
    else this.visible.delete(id)
  }

  settle() {
    const next = this.order.filter((id) => this.visible.has(id)).at(-1) ?? this.order.at(-1) ?? null
    if (next === this.current) return
    this.current = next
    this.emit('speaker', { id: next })
  }

  stop() {
    for (const timer of this.leaving.values()) clearTimeout(timer)
    this.leaving.clear()
  }
}
