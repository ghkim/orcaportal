import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { universeOf } from '../src/universe.mjs'

test("a universe is the Mac's name and when Orca's data folder was made", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-universe-'))
  const made = fs.statSync(dir)
  const universe = await universeOf({ name: async () => 'Kim의 MacBook', orcaData: dir })
  assert.equal(universe.name, 'Kim의 MacBook')
  assert.equal(universe.bornAt, Math.floor(made.birthtimeMs || made.ctimeMs))
  fs.rmSync(dir, { recursive: true })
})

test('without a name or an Orca folder, the host name stands in and the birth is unknown', async () => {
  const universe = await universeOf({ name: async () => { throw new Error('no scutil') }, orcaData: '/nonexistent/orca' })
  assert.equal(universe.name, os.hostname().replace(/\.local$/, '') || 'orrery')
  assert.equal(universe.bornAt, null)
})
