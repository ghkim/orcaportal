#!/usr/bin/env node
// `npx` entry: start Orrery and open it as a tab in Orca's browser.
// `--no-open` only starts the server.
const { startFromCli } = await import('../server.mjs')
startFromCli(!process.argv.includes('--no-open'))
