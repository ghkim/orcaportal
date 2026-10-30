// Reads a terminal's rendered screen (plain text rows) and finds what the page can act on:
// an open selection menu (permission prompt, question with options) and line kinds for styling.

const OPTION = /^(?:([❯›>▸▶➤])\s*)?(\d{1,2})[.)]\s+(\S.*)$/
const RULE = /^[\s─━═╌┄┈╍┉—_-]{8,}$/
const BOX_EDGE = /^[\s│┃║|╭╮╰╯]+|[\s│┃║|╭╮╰╯]+$/g
// The bottom input box agents draw when idle: a rule, then a prompt line, then a rule.
const PROMPT_LINE = /^\s*[❯›>](\s|$)/
// Options that open a text field inside the menu instead of answering outright.
const FREE_TEXT = /^(Type something|Other|직접 입력|기타)(?=$|[\s.:…(])/i
const MENU_SCAN_ROWS = 50
const MAX_OPTION_GAP = 6

export function isRule(line) {
  return RULE.test(line)
}

function strip(line) {
  return line.replace(BOX_EDGE, '')
}

export function parseMenu(lines, { agentWaiting = false } = {}) {
  if (!lines || lines.length === 0) return null
  const start = Math.max(0, lines.length - MENU_SCAN_ROWS)
  const options = []
  for (let i = start; i < lines.length; i++) {
    const match = strip(lines[i]).match(OPTION)
    if (match) options.push({ row: i, n: Number(match[2]), label: match[3].trim(), cursor: Boolean(match[1]) })
  }

  const run = lastNumberedRun(options)
  if (!run) return null
  const first = run[0].row
  const last = run[run.length - 1].row

  // An idle prompt box below the list means it's just a numbered list in the conversation.
  for (let i = last + 1; i < lines.length; i++) {
    if (PROMPT_LINE.test(lines[i]) && (isRule(lines[i - 1] || '') || isRule(lines[i + 1] || ''))) return null
  }
  const cursor = run.findIndex((o) => o.cursor)
  if (cursor === -1 && !agentWaiting) return null

  for (let k = 0; k < run.length; k++) {
    const end = k + 1 < run.length ? run[k + 1].row : Math.min(lines.length, run[k].row + 3)
    const desc = []
    for (let i = run[k].row + 1; i < end; i++) {
      const text = strip(lines[i]).trim()
      if (text && !isRule(text)) desc.push(text)
    }
    run[k].desc = k + 1 < run.length ? desc.join(' ') : ''
  }

  const context = []
  let header = ''
  for (let i = first - 1; i >= Math.max(0, first - 14); i--) {
    const text = strip(lines[i]).trim()
    // Question tabs: "☐ Topic" or "←  ☐ Topic  ✔ Submit  →".
    if (/^[←→]?\s*[☐☒✔✓□■]/.test(text)) {
      header = text.replace(/[←→]/g, '').replace(/\s*[✔✓]\s*Submit\s*/i, '').replace(/[☐☒□■]\s*/g, '').trim().replace(/\s{2,}/g, ' · ')
      break
    }
    if (isRule(lines[i]) || /^[⏺●⎿✻✶✳✢]/.test(text)) break
    context.unshift(text)
  }
  while (context.length && !context[0]) context.shift()
  while (context.length && !context[context.length - 1]) context.pop()
  const question = [...context].reverse().find((t) => /[?？]$/.test(t)) || context[context.length - 1] || ''

  let hint = ''
  for (let i = last + 1; i < Math.min(lines.length, last + 6); i++) {
    const text = strip(lines[i]).trim()
    if (/esc|enter|tab|취소|선택/i.test(text) && !OPTION.test(text)) {
      hint = text
      break
    }
  }

  return {
    header,
    question,
    context: context.filter((t) => t !== question).slice(-8),
    options: run.map(({ n, label, desc, cursor: c }) => ({ n, label, desc, cursor: c, freeText: FREE_TEXT.test(label) })),
    cursor: cursor === -1 ? null : run[cursor].n,
    multiSelect: run.some((o) => /^\[[ x✔]\]|^[☐☒✔]/.test(o.label)),
    hint,
    signature: run.map((o) => `${o.n}:${o.label}`).join('|') + `#${question}`
  }
}

// The last 1, 2, 3… sequence with options close together.
function lastNumberedRun(options) {
  for (let j = options.length - 1; j >= 0; j--) {
    if (options[j].n !== 1) continue
    const run = [options[j]]
    for (let k = j + 1; k < options.length; k++) {
      const prev = run[run.length - 1]
      if (options[k].n !== prev.n + 1 || options[k].row - prev.row > MAX_OPTION_GAP) break
      run.push(options[k])
    }
    if (run.length >= 2) return run
  }
  return null
}

// Keys that pick option `n`: its number when it has one digit, arrows otherwise.
export function keysForOption(menu, n) {
  if (n <= 9) return [String(n)]
  if (menu.cursor == null) return null
  const delta = n - menu.cursor
  return [...Array(Math.abs(delta)).fill(delta > 0 ? 'down' : 'up'), 'enter']
}

export function lineKind(line) {
  const text = line.trimStart()
  if (isRule(line)) return 'rule'
  if (/^⏺/.test(text)) return 'msg'
  if (/^[❯›]\s/.test(text) || text === '❯' || text === '›') return 'you'
  if (/^⎿/.test(text)) return 'out'
  if (/^[✻✶✳✢✽·*]\s.*(…|for \d|ing)/.test(text)) return 'spin'
  if (/^⏵⏵|^⏸|auto mode|accept edits|plan mode/.test(text)) return 'mode'
  if (/^\s*\d+\s+[+]/.test(line)) return 'add'
  if (/^\s*\d+\s+[-]/.test(line)) return 'del'
  if (/error|failed|오류|실패|denied|refused/i.test(text)) return 'err'
  return ''
}
