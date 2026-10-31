// The universe this Mac's galaxy grows from: the Mac's name and the moment Orca first
// ran on it (when its data folder was made). The page turns them into a seed, as it does
// a star's name and birth. Only read, never written.
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import { defaultUserDataPath } from './orca.mjs'

export async function universeOf({ name = computerName, orcaData = defaultUserDataPath() } = {}) {
  const [mac, stat] = await Promise.all([name().catch(() => null), fs.stat(orcaData).catch(() => null)])
  const born = stat ? stat.birthtimeMs || stat.ctimeMs : null
  return { name: mac || hostName(), bornAt: born ? Math.floor(born) : null }
}

// The name the Mac was given in its settings ("Kim's MacBook Pro"); elsewhere, the host's.
function computerName() {
  if (process.platform !== 'darwin') return Promise.resolve(hostName())
  return new Promise((resolve, reject) => {
    execFile('scutil', ['--get', 'ComputerName'], { timeout: 3000 }, (error, stdout) => (error ? reject(error) : resolve(stdout.trim() || null)))
  })
}

function hostName() {
  return os.hostname().replace(/\.local$/, '') || 'orrery'
}
