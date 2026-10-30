import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Disk, measureDir } from '../src/disk.mjs'

test('every open worktree is measured once and published', async () => {
  const measured = []
  const disk = new Disk({ paths: () => ['/w/a', '/w/b', '/w/a'], measure: async (p) => (measured.push(p), p === '/w/a' ? 5e9 : 2e8) })
  const events = []
  disk.on('disk', (e) => events.push(e.paths))
  disk.subscribers = 1
  await disk.pass()
  disk.unsubscribe()
  assert.deepEqual(measured, ['/w/a', '/w/b'])
  assert.deepEqual(disk.snapshot().paths, { '/w/a': 5e9, '/w/b': 2e8 })
  assert.equal(events.length, 2)
})

test('a fresh measurement is not repeated until it is due', async () => {
  let calls = 0
  const disk = new Disk({ paths: () => ['/w/a'], measure: async () => (calls++, 1e9), refreshMs: 60_000 })
  disk.subscribers = 1
  await disk.pass()
  await disk.pass()
  disk.unsubscribe()
  assert.equal(calls, 1)
})

test('closed worktrees drop out and failures are skipped', async () => {
  let open = ['/w/a', '/w/gone']
  const disk = new Disk({ paths: () => open, measure: async (p) => { if (p === '/w/gone') throw new Error('ENOENT'); return 1e9 } })
  disk.subscribers = 1
  await disk.pass()
  disk.unsubscribe()
  assert.deepEqual(disk.snapshot().paths, { '/w/a': 1e9 })
  open = []
  assert.deepEqual(disk.snapshot().paths, {})
})

test('du skips .git', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-'))
  fs.mkdirSync(path.join(dir, '.git'))
  fs.writeFileSync(path.join(dir, '.git', 'big'), Buffer.alloc(2 * 1024 * 1024))
  fs.writeFileSync(path.join(dir, 'small'), Buffer.alloc(64 * 1024))
  const bytes = await measureDir(dir)
  fs.rmSync(dir, { recursive: true, force: true })
  assert.ok(bytes >= 64 * 1024 && bytes < 1024 * 1024, `measured ${bytes}`)
})
