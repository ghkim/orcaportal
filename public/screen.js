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
// Claude Code can open a panel beside the conversation (changed files, a diff), drawn
// after a │ that stands in the same screen column on most rows.
const DIVIDERS = new Set(['│', '┃', '║'])
const MIN_PANEL_COLUMN = 30

// The line an agent draws above its prompt while it works: Claude Code's
// "✽ Forging… (13m 17s · ↓ 67.7k tokens)", Codex's "• Working (12s • esc to interrupt)".
const AT_WORK = [/^\s*[·✢✳✶✻✽*]\s+\S[^()]*…\s*\((?:\d+[hms]\b|esc to interrupt)/, /^\s*•\s+\S[^()]*\(\d+[hms]\b[^)]*esc to interrupt/]
const AT_WORK_ROWS = 12

export function isRule(line) {
  return RULE.test(line)
}

function strip(line) {
  return line.replace(BOX_EDGE, '')
}

// The rows without a side panel, if there is one: only the conversation is read.
export function mainColumn(lines) {
  const counts = new Map()
  let filled = 0
  for (const line of lines) {
    if (!line.trim()) continue
    filled++
    const seen = new Set()
    let column = 0
    for (const ch of line) {
      if (DIVIDERS.has(ch) && column >= MIN_PANEL_COLUMN && !seen.has(column)) {
        seen.add(column)
        counts.set(column, (counts.get(column) || 0) + 1)
      }
      column += cellWidth(ch)
    }
  }
  let divider = -1
  let most = 0
  for (const [column, n] of counts) {
    if (n > most) {
      most = n
      divider = column
    }
  }
  if (divider < 0 || most < Math.max(6, filled * 0.6)) return lines
  return lines.map((line) => cutAt(line, divider))
}

function cutAt(line, column) {
  let at = 0
  let end = 0
  for (const ch of line) {
    if (at >= column) break
    at += cellWidth(ch)
    end += ch.length
  }
  return line.slice(0, end).trimEnd()
}

// Columns a character takes in the terminal: two for Hangul, CJK, fullwidth forms and
// most emoji, one for the rest.
function cellWidth(ch) {
  const cp = ch.codePointAt(0)
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  return wide ? 2 : 1
}

// Whether the agent is at work by its own screen, whatever its state says: it is while
// that line stands among the last rows.
export function atWork(lines) {
  if (!lines) return false
  return lines
    .filter((line) => line.trim())
    .slice(-AT_WORK_ROWS)
    .some((line) => AT_WORK.some((pattern) => pattern.test(line)))
}

export function parseMenu(lines, { agentWaiting = false } = {}) {
  if (!lines || lines.length === 0) return null
  lines = mainColumn(lines)
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
  // The question: the last row that asks something. When the text runs on past the
  // question mark, the row was wrapped, and the rows after it to the paragraph's end belong.
  let asks = context.length - 1
  for (let i = context.length - 1; i >= 0; i--) {
    if (/[?？]/.test(context[i])) {
      asks = i
      break
    }
  }
  let upTo = asks
  if (asks >= 0 && !/[?？]$/.test(context[asks])) while (upTo + 1 < context.length && context[upTo + 1]) upTo++
  const asking = asks < 0 ? [] : context.slice(asks, upTo + 1)
  const question = asking.join(' ')

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
    context: context.filter((t) => !asking.includes(t)).slice(-8),
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
