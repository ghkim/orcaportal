import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { readGrowth, Growth, STAGES, githubRepo, githubReleases } from '../src/growth.mjs'

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
  // The same release tagged twice, and a tag moved along to the latest build: neither
  // is a release of its own.
  git('tag', 'us-east/v1.1.0')
  git('tag', 'mac-latest')
  git('remote', 'add', 'origin', 'git@github.com:k/orrery-test.git')
  const growth = await readGrowth(dir)
  assert.equal(growth.repo, 'k/orrery-test')
  assert.equal(growth.source, 'tags')
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

test('releases: GitHub first for a repo it has releases for, the tags for the rest', async () => {
  const tags = (repo) => ({ repo, source: 'tags', landings: 9, releases: 2, latest: [{ name: 't2' }, { name: 't1' }] })
  const local = { '/a': tags('k/app'), '/b': tags('k/app'), '/c': tags('k/hidden'), '/d': tags(null) }
  const asked = []
  let remote = async (repo) => (asked.push(repo), repo === 'k/app' ? [{ name: 'v3' }, { name: 'v2' }, { name: 'v1' }] : null)
  const growth = new Growth({ paths: () => Object.keys(local), read: async (p) => local[p], releases: (repo) => remote(repo), refreshMs: 60_000, remoteMs: 60_000 })
  const seen = []
  growth.on('growth', (snapshot) => seen.push(snapshot.paths))
  growth.subscribers = 1
  await growth.pass()
  // Two worktrees of one repo ask GitHub once; a repo not on GitHub is not asked.
  assert.deepEqual(asked.sort(), ['k/app', 'k/hidden'])
  // What the repos say goes out first, and GitHub's answer after it.
  assert.equal(seen.length, 2)
  assert.equal(seen[0]['/a'].source, 'tags')
  const after = seen[1]
  for (const p of ['/a', '/b']) {
    assert.equal(after[p].source, 'github')
    assert.equal(after[p].releases, 3)
    assert.deepEqual(after[p].latest.map((r) => r.name), ['v3', 'v2', 'v1'])
  }
  assert.equal(after['/c'].source, 'tags')
  assert.equal(after['/c'].releases, 2)
  assert.equal(after['/d'].source, 'tags')
  // GitHub out of reach keeps what it said last; without gh, it is not asked again.
  growth.remoteMs = -1
  remote = async () => {
    throw new Error('offline')
  }
  await growth.pass()
  assert.equal(growth.view()['/a'].releases, 3)
  remote = async () => {
    throw Object.assign(new Error('no gh'), { code: 'ENOENT' })
  }
  await growth.pass()
  assert.equal(growth.releases, null)
  assert.equal(growth.view()['/a'].source, 'github')
  growth.unsubscribe()
})

test("a repo's place on GitHub, and its releases there through gh", async () => {
  assert.equal(githubRepo('git@github.com:torderdev/torder-socketio.git'), 'torderdev/torder-socketio')
  assert.equal(githubRepo('https://github.com/ghkim/surtitle'), 'ghkim/surtitle')
  assert.equal(githubRepo('https://ghkim@github.com/ghkim/my.repo.git\n'), 'ghkim/my.repo')
  assert.equal(githubRepo('ssh://git@github.com/k/r.git'), 'k/r')
  assert.equal(githubRepo('git@gitlab.com:k/r.git'), null)
  assert.equal(githubRepo(''), null)

  let args
  const gh = async (a) => ((args = a), 'v1.0.0\t2026-01-02T00:00:00Z\tfalse\nv1.1.0-rc\t2026-03-04T00:00:00Z\ttrue\n')
  const releases = await githubReleases('k/r', gh)
  assert.ok(args.includes('repos/k/r/releases?per_page=100'))
  assert.deepEqual(releases, [
    { name: 'v1.1.0-rc', at: Date.parse('2026-03-04T00:00:00Z'), pre: true },
    { name: 'v1.0.0', at: Date.parse('2026-01-02T00:00:00Z'), pre: false }
  ])
  // A repo the account cannot see is no answer; anything else is GitHub out of reach.
  const missing = async () => {
    throw Object.assign(new Error('exit 1'), { stderr: 'gh: Not Found (HTTP 404)' })
  }
  assert.equal(await githubReleases('k/r', missing), null)
  await assert.rejects(githubReleases('k/r', async () => {
    throw Object.assign(new Error('exit 1'), { stderr: 'error connecting to api.github.com' })
  }))
  assert.equal(await githubReleases('k/r; rm -rf', gh), null)
})
