#!/usr/bin/env node
// `npx` entry: start Orrery and open it as a tab in Orca's browser.
// `--no-open` only starts the server.
if (!process.argv.includes('--no-open') && !process.argv.includes('--open')) process.argv.push('--open')
await import('../server.mjs')
