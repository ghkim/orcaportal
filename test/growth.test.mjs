import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { readGrowth, Growth, STAGES } from '../src/growth.mjs'

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-growth-'))
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  return { dir, git }
}

test("a repo's growth: landings on its default branch, all its commits, its releases", async () => {
  const { dir, git } = repo()
  for (let i = 1; i <= 6; i++) git('commit', '-q', '--allow-empty', '-m', `step ${i}`)
  // A merged branch: two commits of its own, one landing.
  git('checkout', '-q', '-b', 'feature/login')
  git('commit', '-q', '--allow-empty', '-m', 'login a')
  git('commit', '-q', '--allow-empty', '-m', 'login b')
  git('checkout', '-q', 'main')
  git('merge', '-q', '--no-ff', 'feature/login', '-m', 'Merge pull request #7 from k/feature/login')
  git('tag', 'v1.0.0')
  git('commit', '-q', '--allow-empty', '-m', 'after')
  git('tag', '-a', 'v1.1.0', '-m', 'release')
  const growth = await readGrowth(dir)
  assert.equal(growth.base, 'main')
  assert.equal(growth.landings, 8)
  assert.equal(growth.commits, 10)
  assert.equal(growth.releases, 2)
  assert.deepEqual(growth.latest.map((r) => r.name).sort(), ['v1.0.0', 'v1.1.0'])
  assert.equal(growth.recent[0].subject, 'after')
  assert.equal(growth.recent[1].subject, 'Merge pull request #7 from k/feature/login')
  // Past the first stage (5 landings): the 5th landing from the first marks it.
  assert.equal(growth.marks.length, STAGES.filter((n) => n <= 8).length)
  const fifth = git('log', '--first-parent', '--reverse', '--format=%h', 'main').trim().split('\n')[4]
  assert.ok(fifth.startsWith(growth.marks[0]) || growth.marks[0].startsWith(fifth))
  fs.rmSync(dir, { recursive: true })
})

test('a folder without a default branch has no growth, and a pass reports only changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-growth-'))
  assert.equal(await readGrowth(dir).catch(() => null), null)
  fs.rmSync(dir, { recursive: true })
  let reads = 0
  const growth = new Growth({ paths: () => ['/a', '/a', '/b'], read: async (p) => (reads++, p === '/a' ? { landings: 3 } : null), refreshMs: 60_000 })
  const seen = []
  growth.on('growth', (snapshot) => seen.push(snapshot.paths))
  growth.subscribers = 1
  await growth.pass()
  await growth.pass()
  growth.unsubscribe()
  assert.equal(reads, 2)
  assert.deepEqual(seen, [{ '/a': { landings: 3 } }])
})
