import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMenu, keysForOption, lineKind } from '../public/screen.js'
import { keyBytes } from '../public/keys.js'

const rule = '─'.repeat(120)

test('Claude permission prompt in a box', () => {
  const menu = parseMenu([
    '⏺ Bash(rm -rf build)',
    '╭──────────────────────────────────────────────╮',
    '│ Bash command                                 │',
    '│                                              │',
    '│   rm -rf build                               │',
    '│   Remove the build directory                 │',
    '│                                              │',
    '│ Do you want to proceed?                      │',
    '│ ❯ 1. Yes                                     │',
    "│   2. Yes, and don't ask again for rm commands │",
    '│   3. No, and tell Claude what to do differently (esc) │',
    '╰──────────────────────────────────────────────╯'
  ])
  assert.equal(menu.question, 'Do you want to proceed?')
  assert.deepEqual(menu.options.map((o) => o.label), ['Yes', "Yes, and don't ask again for rm commands", 'No, and tell Claude what to do differently (esc)'])
  assert.equal(menu.cursor, 1)
  assert.ok(menu.context.includes('rm -rf build'))
})

test('Claude permission prompt without a box, with a hint line', () => {
  const menu = parseMenu([
    '⏺ I will update the config.',
    rule,
    ' Edit file',
    ' src/config.ts',
    ' Do you want to make this edit to config.ts?',
    ' ❯ 1. Yes',
    '   2. Yes, allow all edits during this session (shift+tab)',
    '   3. No',
    '',
    ' Esc to cancel · Tab to amend'
  ])
  assert.equal(menu.options.length, 3)
  assert.equal(menu.question, 'Do you want to make this edit to config.ts?')
  assert.equal(menu.hint, 'Esc to cancel · Tab to amend')
})

test('AskUserQuestion with descriptions and a separated last option', () => {
  const menu = parseMenu([
    '←  ☐ 저장 위치  ☐ 형식  ✔ Submit  →',
    '',
    '결과를 어디에 저장할까요?',
    '',
    '❯ 1. 바탕화면',
    '     ~/Desktop 에 저장해요',
    '  2. 프로젝트 폴더',
    '     현재 레포 안에 저장해요',
    '  3. Type something.',
    rule,
    '  4. Chat about this',
    '',
    'Enter to select · ↑/↓ to navigate · Esc to cancel'
  ])
  assert.equal(menu.question, '결과를 어디에 저장할까요?')
  assert.deepEqual(menu.options.map((o) => o.n), [1, 2, 3, 4])
  assert.equal(menu.options[0].desc, '~/Desktop 에 저장해요')
  assert.equal(menu.options[3].label, 'Chat about this')
  assert.match(menu.hint, /Enter to select/)
})

test('question tab header, box-edged question, multi-line descriptions', () => {
  const menu = parseMenu([
    '⏺ 정리할 파일을 찾았어요.',
    rule,
    ' ☐ 공간 확보',
    '│ 캐시를 지워도 될까?',
    '❯ 1. 둘 다 (추천)',
    '     첫째 줄 설명',
    '     둘째 줄 설명',
    '  2. 하나만',
    '     설명',
    '  3. Type something.',
    rule,
    '  4. Chat about this',
    'Enter to select · ↑/↓ to navigate · Esc to cancel'
  ])
  assert.equal(menu.header, '공간 확보')
  assert.equal(menu.question, '캐시를 지워도 될까?')
  assert.equal(menu.options[0].desc, '첫째 줄 설명 둘째 줄 설명')
  assert.deepEqual(menu.options.map((o) => o.freeText), [false, false, true, false])
})

test('Codex approval prompt', () => {
  const menu = parseMenu([
    '  Would you like to run the following command?',
    '  $ npm test',
    '› 1. Yes, proceed (y)',
    "  2. Yes, and don't ask again for this command (p)",
    '  3. No, and tell Codex what to do differently (esc)',
    '  Press enter to confirm or esc to cancel'
  ])
  assert.equal(menu.options.length, 3)
  assert.equal(menu.cursor, 1)
  assert.equal(menu.question, 'Would you like to run the following command?')
})

test('a numbered list above the idle prompt box is not a menu', () => {
  const lines = [
    '⏺ 확인 순서는 아래와 같아요.',
    '  1. ⌃⌘Q로 잠그고 풀기',
    "  2. '다 열기' 누르기",
    '  3. Chrome 창이 원래 모니터로 돌아가는지 보기',
    '✻ Worked for 2m · done 5:08 PM',
    rule,
    '❯',
    rule,
    '  ⏵⏵ auto mode on (shift+tab to cycle)'
  ]
  assert.equal(parseMenu(lines), null)
  assert.equal(parseMenu(lines, { agentWaiting: true }), null)
})

test('a numbered list without a cursor counts only while the agent is waiting', () => {
  const lines = ['어떤 걸로 할까요?', '  1. 첫째', '  2. 둘째']
  assert.equal(parseMenu(lines), null)
  assert.equal(parseMenu(lines, { agentWaiting: true }).options.length, 2)
})

test('the most recent menu wins when an older numbered list is still on screen', () => {
  const menu = parseMenu(['  1. old', '  2. older', '⏺ Bash(ls)', 'Do you want to proceed?', '❯ 1. Yes', '  2. No'])
  assert.deepEqual(menu.options.map((o) => o.label), ['Yes', 'No'])
})

test('picking options sends digits, or arrows past nine', () => {
  const menu = { cursor: 2 }
  assert.deepEqual(keysForOption(menu, 3), ['3'])
  assert.deepEqual(keysForOption(menu, 11), [...Array(9).fill('down'), 'enter'])
  assert.equal(keysForOption({ cursor: null }, 12), null)
})

test('key names map to terminal bytes and reject unknown keys', () => {
  assert.equal(keyBytes(['down', 'down', 'enter']), '\x1b[B\x1b[B\r')
  assert.equal(keyBytes(['3']), '3')
  assert.equal(keyBytes(['rm -rf /']), null)
  assert.equal(keyBytes(['__proto__']), null)
  assert.equal(keyBytes([]), null)
  assert.equal(keyBytes('enter'), null)
})

test('line kinds', () => {
  assert.equal(lineKind(rule), 'rule')
  assert.equal(lineKind('⏺ 고쳤어요'), 'msg')
  assert.equal(lineKind('❯ 리포트에 추가해줘'), 'you')
  assert.equal(lineKind('  ⎿  Read file (20 lines)'), 'out')
  assert.equal(lineKind('plain text'), '')
})
