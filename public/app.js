import { parseMenu, keysForOption, lineKind, mainColumn } from './screen.js'
import { KEYS } from './keys.js'
import { createSound, MIX_DEFAULTS } from './sound.js'

const TOKEN = document.querySelector('meta[name="portal-token"]').content
// group: header filter chips. section: where the session sits in the list view.
const STATUS = {
  choice: { label: '선택 필요', rank: 0, group: 'attention', section: 'attention' },
  waiting: { label: '응답 필요', rank: 0, group: 'attention', section: 'attention' },
  blocked: { label: '막힘', rank: 1, group: 'attention', section: 'attention' },
  working: { label: '작업 중', rank: 2, group: 'working', section: 'working' },
  new: { label: '새 결과', rank: 3, group: 'done', section: 'new' },
  done: { label: '완료', rank: 4, group: 'done', section: 'done' },
  idle: { label: '대기', rank: 5, group: 'done', section: 'done' },
  shell: { label: '셸', rank: 6, group: 'shell', section: 'shell' }
}
const SECTIONS = [
  { id: 'pinned', label: '고정' },
  { id: 'attention', label: '확인 필요' },
  { id: 'working', label: '작업 중' },
  { id: 'new', label: '새 결과' },
  { id: 'done', label: '완료' },
  { id: 'shell', label: '셸' }
]
const VIEWS = { focus: '목록 보기', galaxy: '은하 보기', grid: '격자 보기' }
const KEYPAD = ['up', 'down', 'left', 'right', 'enter', 'esc', 'tab', 'shift-tab', 'space', 'backspace', 'ctrl-c']
const ICONS = {
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  shrink: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  open: '<path d="M7 17 17 7M8 7h9v9"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9 16h6"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  pin: '<path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sound: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>'
}
// The settings panel: light in the galaxy and the listener's sound mix, in percent.
const LOOK_DEFAULTS = { glow: 10, brightness: 50 }
const LOOK_SETTINGS = [
  ['glow', '빛 번짐', 0, 150],
  ['brightness', '밝기', 50, 130]
]
// Every sound has its own switch and volume.
const SOUNDS = [
  ['waves', '파도'],
  ['wind', '바람'],
  ['bamboo', '대나무 숲'],
  ['birds', '새 (아침 · 낮)'],
  ['crickets', '풀벌레 (밤)'],
  ['drops', '물방울'],
  ['music', '음악'],
  ['windbells', '풍경'],
  ['temple', '범종'],
  ['alerts', '알림 · 효과음']
]
// Kept in this browser: the play log, the remnants of stars that died, and where each
// star settled.
const LOG_KEY = 'orca-portal-log'
const REMNANT_KEY = 'orrery-remnants'
const SPOT_KEY = 'orrery-spots'
const STARDUST_KEY = 'orrery-stardust'
const DUST_TOKENS = 1e7 // a grain of stardust for every ten million tokens
const compactFormat = new Intl.NumberFormat('ko', { notation: 'compact', maximumFractionDigits: 1 })
const REMNANT_MS = 3 * 86_400_000
const ADMIN_KEY = 'orrery-admin'
const TEST_KEY = 'orrery-test-items'
// The status filters' names, for the search box while one is on.
const FILTER_NAMES = { attention: '확인 필요', working: '작업 중', done: '완료' }
// What a new project can start with, in the order offered.
const BIRTH_AGENTS = [
  ['claude', 'Claude'],
  ['codex', 'Codex'],
  ['shell', '셸만']
]
// How long a project made here waits for its first terminal before the camera stops waiting.
const BIRTH_WAIT_MS = 90_000
// What a project being made is doing, under its gathering cloud.
const BIRTH_STEPS = { start: '자리 잡는 중', clone: '가져오는 중', repo: '저장소 만드는 중', orca: 'Orca에 넣는 중', agent: '터미널 여는 중', done: '곧 빛나요' }
// Korean initial consonants, in syllable order, for searching by initials.
const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
// Decorations in the galaxy, each of which can be switched off.
const DECOR = [
  ['magellan', '마젤란 구름', '은하 옆 작은 위성 은하 둘'],
  ['disks', '원시행성 원반', '태어난 지 일주일 안 된 별의 먼지 원반'],
  ['remnants', '초신성 잔해', '닫힌 앱의 별이 남긴 가스 껍질 · 사흘'],
  ['jets', '은하 중심 제트', '에이전트가 일할 때 중심에서 뿜는 빛줄기'],
  ['crowns', '별의 왕관', '앱 토큰이 1천만 · 5천만 · 1억… 넘을 때마다 빛 하나']
]
// A new universe starts plain, and decorations open up as it is used: by tokens the agents
// spend from the day this browser started counting, or by things seen in the galaxy.
const UNLOCKS = {
  disks: { hint: '도감: 별의 탄생 보기', met: (log) => log.births >= 1 },
  remnants: { hint: '도감: 초신성 세 번 보기', met: (log) => log.novas >= 3 },
  magellan: { tokens: 3e7 },
  crowns: { tokens: 6e7 },
  jets: { tokens: 1e8 }
}
// What a browser that had Orrery before unlocks kept showing: everything there was then.
const DECOR_BEFORE = ['magellan', 'disks', 'remnants', 'jets']
// Stardust is spent on these, in the galaxy.
const DUST_EVENTS = [
  { id: 'shower', icon: '🌠', name: '유성우', cost: 1 },
  { id: 'aurora', icon: '🌌', name: '오로라 2분', cost: 2 },
  { id: 'swarm', icon: '☄️', name: '혜성 떼', cost: 2 },
  { id: 'fireworks', icon: '🎆', name: '초신성 불꽃놀이', cost: 3 }
]
// Volumes saved before each sound had its own: one old channel fed several.
const OLD_MIX = { sea: ['waves', 'wind'], nature: ['birds', 'crickets', 'drops'], bells: ['windbells', 'temple'] }
// Shown in the ? help dialog: only what's for looking around the galaxy. The handlers
// live in onShortcut; the older working keys (reply, maximise, views...) still work there
// but aren't listed.
const SHORTCUTS = [
  {
    title: '둘러보기',
    keys: [
      [['J', 'K'], '다음 행성 / 이전 행성'],
      [['N'], '신호를 보내는 행성으로 (차례로 돌아요)'],
      [['B'], '바로 전에 보던 행성'],
      [['/'], '찾기 · Enter로 찾은 행성까지 날아가기'],
      [['↑', '↓'], '선택지가 떠 있으면 고르기 · Enter로 확정'],
      [['V'], '은하 전체 보기'],
      [['T'], '별·행성 이름 모두 끄기 / 켜기'],
      [['Z'], '고요 모드: 은하와 소리만 남기기']
    ]
  },
  {
    title: '우주 놀이',
    keys: [
      [['클릭'], '지나가는 별똥별·혜성 잡기'],
      [['Alt+끌기'], '빈 곳에서 당겼다 놓으면 혜성 던지기'],
      [['Alt+끌기'], '행성을 블랙홀에 넣어 터미널 닫기 (한 번 물어봐요)'],
      [['C'], '새 별 만들기: 새 프로젝트를 시작해요'],
      [['L'], '우주 도감'],
      [['I'], '보는 법']
    ]
  },
  {
    title: '빛과 소리',
    keys: [
      [['M'], '소리 켜기 / 끄기'],
      [['S'], '밝기 · 빛 번짐 · 소리 크기'],
      [['?'], '단축키']
    ]
  }
]
const CHOICE_LOCK_MS = 4000
// Auto-follow waits this long after the last click, key or scroll before moving the view.
const FOLLOW_IDLE_MS = 4000
const ADVANCE_DELAY_MS = 1200
const NOTICE_MS = 9000
// Statuses settle over the first screen reads; transitions before this aren't news.
const SETTLE_MS = 2500
const DONE_EVENT_TTL_MS = 60_000
const loadedAt = Date.now()

const sessions = new Map()
const screens = new Map() // handle -> screen rows, without a side panel beside the conversation
const fullScreens = new Map() // handle -> screen rows as the terminal shows them
const menus = new Map()
const cards = new Map()
const pendingChoice = new Map() // handle -> { signature, n, until }
let menuPick = null // the option the arrow keys are on: { handle, signature, n }
const prevStatus = new Map()
const prevMenuSig = new Map()
const attentionSince = new Map()
const seenAt = new Map() // finished results the user has looked at here
const flashUntil = new Map()
const lastActionAt = new Map()
const prefs = loadPrefs()
let focusedHandle = null
// Terminals closed since the galaxy last drew; their planets (and maybe stars) leave with a show.
const vanished = new Set()
// Terminals opened since the galaxy last drew; they arrive with a show.
const born = new Set()
// Per worktree path: agent tokens, active time, first record, running subagents (from the server).
let usage = {}
// Per worktree path: servers listening inside it, each { pid, name, ports } (from the server).
let servers = {}
// Per worktree path: bytes on disk without .git (from the server, refreshed every half hour).
let disk = {}
// In the galaxy view the session pane slides in only when a session is picked.
let paneOpen = false
// The galaxy's short report: one app's terminals, only what needs a decision and how work is going.
let report = null // { app, handle } — handle is the terminal the report points at, if any
const quickDrafts = new Map() // handle -> half-written quick reply, kept across redraws
// Quiet mode: after a while with nothing to do, everything but the galaxy fades away.
const ZEN_IDLE_MS = 3 * 60_000
let zen = false
let zenMoved = 0
let expandedHandle = null
let followQueue = [] // { handle, kind: 'attention' | 'done', at }
let eventsReady = false
let lastInteraction = 0
let displayOrder = []
let searchAt = null // where Enter in the search box last went
let searchFor = ''
let jumpedAt = 0
let renderQueued = false
let noticeTimer = null
let listScrolledTo = null
let userPicked = false
let previousHandle = null
let maximized = false
let galaxy = null
let galaxyLoad = null
let toastTimer = null

const grid = document.querySelector('.grid')
const list = document.querySelector('.list')
const paneNotice = document.querySelector('.pane-notice')
const paneEmpty = document.querySelector('.pane-empty')
const attention = document.querySelector('.attention')
const attentionList = document.querySelector('.attention-list')
const emptyState = document.querySelector('.empty')
const backdrop = document.querySelector('.backdrop')
const search = document.querySelector('.search')
const searchHint = document.querySelector('.search-hint')
const showShells = document.querySelector('.show-shells')
const autoFollow = document.querySelector('.auto-follow')
const conn = document.querySelector('.conn')
const help = document.querySelector('.help')
const cosmos = document.querySelector('.cosmos')
const layoutEl = document.querySelector('.layout')
const paneEl = document.querySelector('.pane')
const paneToggle = document.querySelector('.pane-toggle')
const reportEl = document.querySelector('.gx-report')
const gxHud = document.querySelector('.gx-hud')
const gxSignals = document.querySelector('.gx-signals')
const soundButton = document.querySelector('.sound-btn')
const settingsButton = document.querySelector('.settings-btn')
const settingsEl = document.querySelector('.settings')
const paletteEl = document.querySelector('.palette')
const paletteInput = paletteEl.querySelector('input')
const paletteResults = paletteEl.querySelector('.palette-results')
const sound = createSound()
const palette = { items: [], index: 0, closeTimer: null }
const toastEl = document.querySelector('.toast')
const logEl = document.querySelector('.gx-log')
const logButton = document.querySelector('.gx-log-btn')
const guideEl = document.querySelector('.gx-guide')
const guideButton = document.querySelector('.gx-guide-btn')
const confirmEl = document.querySelector('.gx-confirm')
const birthEl = document.querySelector('.gx-birth')
// The Mac app's bridge (Dock badge, notifications), when the page runs inside it.
const desktop = window.orrery || null
const birthButton = document.querySelector('.gx-birth-btn')
const playLog = loadLog()
let remnants = loadRemnants() // shells of gas where apps' stars died, for three days
let spots = loadSpots() // app name -> which of its possible spots its star took
const stardust = loadStardust() // tokens counted since this browser started, and what they bought
// Admin test mode: fake stars and planets, and the galaxy's rare events on demand, to try
// things out without touching a real terminal. Fake handles start with test_, which the
// server never accepts.
const admin = adminMode()
const testItems = new Map() // test_ handle -> a fake galaxy item
let testSerial = 0
let testFocus = null // the fake star last looked at, where new fake planets go
if (admin) loadTestItems()
let cleanAsk = null // the terminal dropped into the black hole, while we ask
// The new star / new planet form: its name check in flight, the star a planet joins, and
// the folder whose next new terminal gets the camera ({ path, known, until }).
const birth = { check: 0, timer: null, busy: false, target: null, wait: null, autoName: '' }
// Projects being made (from any window): path -> the last news, as the server tells it.
const forming = new Map()
let orcaStatus = { ok: true }
// With Orrery open in more than one place, the server lets one page play sound: the one
// touched last. The id lives in sessionStorage, so a reload keeps the page's turn.
const PAGE_ID = pageId()
let speakerHere = true
let touchedAt = 0
let moodKey = '' // the counts the music last heard

// ---------- data ----------

function connect() {
  const visible = document.visibilityState === 'visible' ? 1 : 0
  const events = new EventSource(`/events?token=${encodeURIComponent(TOKEN)}&page=${PAGE_ID}&visible=${visible}`)
  events.addEventListener('open', () => setConn('live'))
  events.addEventListener('speaker', (e) => setSpeaker(JSON.parse(e.data).id))
  events.addEventListener('state', (e) => onState(JSON.parse(e.data)))
  events.addEventListener('screen', (e) => onScreen(JSON.parse(e.data)))
  events.addEventListener('usage', (e) => {
    usage = JSON.parse(e.data).paths || {}
    trackTokens(usage)
    if (prefs.view === 'galaxy') scheduleRender()
  })
  events.addEventListener('disk', (e) => {
    disk = JSON.parse(e.data).paths || {}
    if (prefs.view === 'galaxy') scheduleRender()
  })
  events.addEventListener('servers', (e) => {
    servers = JSON.parse(e.data).paths || {}
    if (prefs.view === 'galaxy') scheduleRender()
  })
  events.addEventListener('birth', (e) => onBirthNews(JSON.parse(e.data)))
  events.addEventListener('status', (e) => {
    orcaStatus = JSON.parse(e.data)
    setConn(orcaStatus.ok ? 'live' : 'orca-down', orcaStatus)
    renderAll()
  })
  events.addEventListener('error', () => {
    if (events.readyState === EventSource.CLOSED) {
      // The server restarted with a new token: reload to pick it up.
      setConn('offline')
      setTimeout(() => location.reload(), 3000)
    } else setConn('reconnecting')
  })
}

function onState({ sessions: list }) {
  const firstState = sessions.size === 0 && !eventsReady
  const seen = new Set()
  for (const session of list) {
    seen.add(session.handle)
    if (!firstState && !sessions.has(session.handle) && prefs.view === 'galaxy') born.add(session.handle)
    sessions.set(session.handle, session)
    // The agent's waiting state can turn a plain numbered list into a menu.
    const card = cards.get(session.handle)
    if (updateMenu(session.handle) && card) renderMenu(card)
  }
  for (const handle of [...sessions.keys()]) {
    if (!seen.has(handle)) {
      sessions.delete(handle)
      if (prefs.view === 'galaxy') vanished.add(handle)
      screens.delete(handle)
      menus.delete(handle)
      cards.get(handle)?.el.remove()
      cards.delete(handle)
      if (expandedHandle === handle) collapse()
      if (focusedHandle === handle) focusedHandle = null
    }
  }
  renderAll()
  if (firstState) setTimeout(settle, SETTLE_MS)
  if (birth.wait) greetNewStar(list)
  // A project's first terminal is here: its star ignites (if the names differ, the cloud
  // still has to clear).
  for (const [path, job] of forming) {
    if (!list.some((s) => s.path === path)) continue
    forming.delete(path)
    galaxy?.unform(job.name)
  }
}

function onScreen({ handle, lines }) {
  if (!lines) {
    screens.delete(handle)
    fullScreens.delete(handle)
    return
  }
  screens.set(handle, mainColumn(lines))
  fullScreens.set(handle, lines)
  const before = statusOf(handle)
  const menuChanged = updateMenu(handle)
  const card = cards.get(handle)
  if (card) {
    renderScreen(card)
    if (menuChanged) renderMenu(card)
    if (!menus.has(handle)) stopMenuTyping(card)
  }
  if (menuChanged || before !== statusOf(handle)) renderAll()
}

function updateMenu(handle) {
  const session = sessions.get(handle)
  const lines = screens.get(handle)
  const menu = session && lines ? parseMenu(lines, { agentWaiting: session.agent?.state === 'waiting' }) : null
  const previous = menus.get(handle)
  if ((previous?.signature || '') === (menu?.signature || '')) return false
  if (menu) menus.set(handle, menu)
  else menus.delete(handle)
  return true
}

function statusOf(handle) {
  const session = sessions.get(handle)
  if (!session) return 'shell'
  if (menus.has(handle)) return 'choice'
  const state = session.agent?.state
  if (state === 'waiting') return 'waiting'
  if (state === 'blocked') return 'blocked'
  // An agent only watching a background task waits, as Orca's sidebar has it.
  if (state === 'working') return session.agent.monitoring ? 'idle' : 'working'
  if (state === 'done') {
    const finishedAt = session.agent.stateStartedAt || session.agent.updatedAt || 0
    const unseen = (seenAt.get(handle) || 0) < finishedAt
    return unseen && (session.unread || finishedAt > loadedAt) ? 'new' : 'done'
  }
  return session.agentType ? 'idle' : 'shell'
}

function sectionOf(handle) {
  return STATUS[statusOf(handle)].section
}

// ---------- auto-follow ----------

// Menus are only known once screens arrive, so the opening pick is revisited after
// statuses settle, unless the user has already chosen a session. The galaxy opens on the
// whole galaxy and stays there: the camera only leaves for a question that is waiting,
// and only with auto-follow on.
function settle() {
  eventsReady = true
  const first = attentionHandles()[0] || displayOrder[0]
  const go = prefs.view !== 'galaxy' || (prefs.autoFollow && sectionOf(first) === 'attention')
  if (first && !userPicked && first !== focusedHandle) setFocus(first, { quiet: true, stay: !go })
}

function trackEvents() {
  const now = Date.now()
  if (focusedHandle && document.visibilityState === 'visible') seenAt.set(focusedHandle, now)
  for (const handle of sessions.keys()) {
    const status = statusOf(handle)
    const prev = prevStatus.get(handle)
    const signature = menus.get(handle)?.signature || ''
    const prevSignature = prevMenuSig.get(handle) || ''
    prevStatus.set(handle, status)
    prevMenuSig.set(handle, signature)
    const inAttention = STATUS[status].section === 'attention'
    const wasAttention = prev !== undefined && STATUS[prev].section === 'attention'
    if (inAttention && !wasAttention) attentionSince.set(handle, now)
    if (!inAttention) attentionSince.delete(handle)
    if (!eventsReady) continue
    if (prev === undefined) {
      // A session that opens already asking something is news too.
      if (inAttention) queueEvent(handle, 'attention')
      continue
    }

    if (inAttention && (!wasAttention || (signature && signature !== prevSignature))) queueEvent(handle, 'attention')
    else if (prev === 'working' && status !== 'working' && !inAttention) queueEvent(handle, 'done')
    // The user just answered the session in view: move on to the next one waiting.
    if (wasAttention && !inAttention && handle === focusedHandle && now - (lastActionAt.get(handle) || 0) < 20_000) scheduleAdvance(handle)
  }
  for (const handle of [...prevStatus.keys()]) {
    if (!sessions.has(handle)) {
      prevStatus.delete(handle)
      prevMenuSig.delete(handle)
      attentionSince.delete(handle)
    }
  }
}

// In the Mac app, a question that comes while the window is away is also a notification.
function notifyDesktop(handle) {
  const session = sessions.get(handle)
  if (!desktop || !session) return
  const question = menus.get(handle)?.question
  desktop.notify({ handle, title: session.project, body: question || `${session.title || session.name} · ${STATUS[statusOf(handle)].label}` })
}

function queueEvent(handle, kind) {
  sound.chime(kind)
  if (kind === 'attention') {
    setZen(false)
    notifyDesktop(handle)
  }
  if (kind === 'done' && prefs.view === 'galaxy') galaxy?.shootingStar()
  flashUntil.set(handle, Date.now() + 3600)
  followQueue = followQueue.filter((p) => p.handle !== handle)
  followQueue.push({ handle, kind, at: Date.now() })
  processQueue()
}

function processQueue() {
  const now = Date.now()
  followQueue = followQueue.filter(
    (p) =>
      sessions.has(p.handle) &&
      (p.kind === 'attention' ? sectionOf(p.handle) === 'attention' : now - p.at < DONE_EVENT_TTL_MS)
  )
  if (!prefs.autoFollow || followQueue.length === 0 || userBusy()) return
  // A finished task never pulls the view away from a question that's still open.
  const viewingQuestion = focusedHandle && sectionOf(focusedHandle) === 'attention'
  const pinnedFirst = [...followQueue].sort((a, b) => Number(isPinned(b.handle)) - Number(isPinned(a.handle)))
  const next = pinnedFirst.find((p) => p.kind === 'attention') || (viewingQuestion ? null : pinnedFirst.find((p) => p.kind === 'done'))
  if (!next) return
  followQueue = followQueue.filter((p) => p !== next)
  if (next.handle !== focusedHandle) setFocus(next.handle, { auto: true, reason: next.kind })
}

function scheduleAdvance(from) {
  setTimeout(() => {
    if (!prefs.autoFollow || focusedHandle !== from || typingReply()) return
    const next = attentionHandles().find((h) => h !== from)
    if (next) setFocus(next, { auto: true, reason: 'next' })
  }, ADVANCE_DELAY_MS)
}

function attentionHandles() {
  return [...sessions.keys()]
    .filter((h) => sectionOf(h) === 'attention')
    .sort(
      (a, b) =>
        Number(isPinned(b)) - Number(isPinned(a)) ||
        STATUS[statusOf(a)].rank - STATUS[statusOf(b)].rank ||
        (attentionSince.get(a) || 0) - (attentionSince.get(b) || 0)
    )
}

function typingReply() {
  const active = document.activeElement
  return active?.tagName === 'TEXTAREA' && active.value.trim() !== ''
}

function userBusy() {
  if (typingReply()) return true
  if (String(window.getSelection?.() || '')) return true
  return Date.now() - lastInteraction < FOLLOW_IDLE_MS
}

// quiet: the opening pick, which shouldn't pop the galaxy's pane open unless something is waiting.
// stay: the galaxy's camera doesn't move.
function setFocus(handle, { auto = false, reason, quiet = false, stay = false } = {}) {
  if (!sessions.has(handle)) return
  const previous = focusedHandle
  if (previous && previous !== handle) previousHandle = previous
  focusedHandle = handle
  seenAt.set(handle, Date.now())
  followQueue = followQueue.filter((p) => p.handle !== handle)
  if (prefs.view === 'grid') {
    const card = cards.get(handle)
    if (card && !card.el.hidden) card.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    flashUntil.set(handle, Date.now() + 3600)
  }
  if (auto && previous !== handle) showNotice(handle, previous, reason)
  else if (!auto) hideNotice()
  if (prefs.view === 'galaxy' && !stay) {
    galaxy?.flyTo(handle)
    // The full terminal stays in the pane only once the user has gone in; otherwise a pick
    // (or a question arriving) shows the short report.
    if (!paneOpen && ((!auto && !quiet) || sectionOf(handle) === 'attention' || report)) openReport(sessions.get(handle).project, handle)
  }
  scheduleRender()
}

function showNotice(handle, previous, reason) {
  if (!isDocked()) return
  const session = sessions.get(handle)
  const text = { done: '작업이 끝나서 이 세션으로 왔어요', next: '다음으로 확인할 세션으로 왔어요' }[reason] || '확인이 필요해서 이 세션으로 왔어요'
  paneNotice.dataset.status = statusOf(handle)
  const parts = [el('span', { className: 'dot' }), el('span', { textContent: `${session.project} · ${text}` })]
  if (previous && sessions.has(previous)) {
    const back = el('button', { type: 'button', textContent: `← ${sessions.get(previous).project}(으)로 돌아가기` })
    back.addEventListener('click', () => pick(previous))
    parts.push(back)
  }
  paneNotice.replaceChildren(...parts)
  paneNotice.hidden = false
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(hideNotice, NOTICE_MS)
}

function hideNotice() {
  clearTimeout(noticeTimer)
  paneNotice.hidden = true
}

// ---------- render ----------

function scheduleRender() {
  if (renderQueued) return
  renderQueued = true
  setTimeout(() => {
    renderQueued = false
    renderAll()
  }, 0)
}

function renderAll() {
  const counts = { all: 0, attention: 0, working: 0, done: 0 }
  const visible = []
  const all = []
  for (const [handle, session] of sessions) {
    const status = statusOf(handle)
    const group = STATUS[status].group
    if (group === 'shell' && !prefs.showShells && handle !== focusedHandle) {
      cards.get(handle)?.el.setAttribute('hidden', '')
      continue
    }
    counts.all++
    if (counts[group] !== undefined) counts[group]++
    const card = cards.get(handle) || createCard(handle)
    updateCard(card, session, status)
    const show = (prefs.filter === 'all' || prefs.filter === group) && matchesSearch(session, handle)
    if (prefs.view === 'grid') {
      card.el.toggleAttribute('hidden', !show && expandedHandle !== handle)
      if (!card.el.hidden && card.dirty) renderScreen(card)
    }
    all.push({ handle, session, status, show })
    if (show) visible.push({ handle, session, status })
  }

  for (const [key, value] of Object.entries(counts)) {
    document.querySelector(`[data-count="${key}"]`).textContent = value
  }
  // The music hears how many agents work and how many questions wait.
  const fakes = [...testItems.values()]
  const working = counts.working + fakes.filter((i) => i.status === 'working').length
  const attention = counts.attention + fakes.filter((i) => STATUS[i.status].group === 'attention').length
  const mood = `${working}|${attention}`
  if (mood !== moodKey) {
    moodKey = mood
    desktop?.setBadge(attention)
    sound.setMood({ working, attention })
  }
  document.title = counts.attention ? `(${counts.attention}) Orrery` : 'Orrery'
  if (focusedHandle && !sessions.has(focusedHandle)) focusedHandle = null

  if (prefs.view === 'grid') {
    orderCards(visible)
    renderAttention()
  } else {
    if (prefs.view === 'galaxy') renderGalaxy(all)
    else renderList(visible)
    syncDock()
  }
  renderSearchHint()
  renderEmpty(visible.length)
  trackEvents()
}

function syncDock() {
  if (!focusedHandle && displayOrder[0]) focusedHandle = displayOrder[0]
  for (const card of cards.values()) {
    const docked = isDocked() && card.handle === focusedHandle
    if (docked === card.el.classList.contains('docked')) continue
    card.el.classList.toggle('docked', docked)
    if (docked) {
      card.el.hidden = false
      card.stick = true
      if (prefs.view === 'galaxy') warp(card.el)
      card.detailsKey = ''
      renderDetails(card, sessions.get(card.handle), statusOf(card.handle))
      renderScreen(card)
    }
  }
  paneEmpty.hidden = !isDocked() || Boolean(focusedHandle) || sessions.size === 0
}

function renderList(visible) {
  const bySection = new Map(SECTIONS.map((s) => [s.id, []]))
  for (const item of visible) bySection.get(isPinned(item.handle) ? 'pinned' : STATUS[item.status].section).push(item)
  const byName = (a, b) =>
    a.session.project.localeCompare(b.session.project, 'ko') || a.session.name.localeCompare(b.session.name, 'ko') || a.handle.localeCompare(b.handle)
  bySection.get('attention').sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || (attentionSince.get(a.handle) || 0) - (attentionSince.get(b.handle) || 0))
  bySection.get('pinned').sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || byName(a, b))
  bySection.get('new').sort((a, b) => finishedAt(b.session) - finishedAt(a.session) || byName(a, b))
  for (const id of ['working', 'done', 'shell']) bySection.get(id).sort(byName)

  displayOrder = []
  const groups = []
  for (const { id, label } of SECTIONS) {
    const items = bySection.get(id)
    if (items.length === 0) continue
    const collapsed = Boolean(prefs.collapsed[id])
    const head = el('button', { type: 'button', className: 'group-head', ariaExpanded: String(!collapsed) })
    head.innerHTML = `${icon('chevron', 14)}<span></span><span class="count"></span>`
    head.children[1].textContent = label
    head.children[2].textContent = items.length
    head.dataset.section = id
    head.addEventListener('click', () => {
      prefs.collapsed[id] = !collapsed
      savePrefs()
      renderAll()
    })
    const group = el('div', { className: 'list-group' })
    group.append(head)
    for (const item of items) {
      displayOrder.push(item.handle)
      // A collapsed group still shows the session in view, so the selection never disappears.
      if (collapsed && item.handle !== focusedHandle) continue
      group.append(listRow(item))
    }
    groups.push(group)
  }
  list.replaceChildren(...groups)
  // Follow the selection only when it changes, so scrolling the list by hand sticks.
  if (focusedHandle !== listScrolledTo) {
    listScrolledTo = focusedHandle
    list.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  }
}

function listRow({ handle, session, status }) {
  const row = el('button', { type: 'button', className: 'row', dataset: { status, handle } })
  if (handle === focusedHandle) row.classList.add('selected')
  if ((flashUntil.get(handle) || 0) > Date.now()) row.classList.add('flash')
  const since = status === 'working' ? session.agent?.stateStartedAt : session.lastOutputAt || session.agent?.updatedAt
  const top = el('span', { className: 'row-top' })
  top.append(
    el('span', { className: 'row-project', textContent: session.project }),
    el('span', { className: 'row-name', textContent: session.name }),
    el('span', { className: 'row-time', textContent: since ? ago(since) : '' })
  )
  const main = el('span', { className: 'row-main' })
  main.append(top, el('span', { className: 'row-sub', textContent: rowSummary(handle, session, status) }))
  row.append(el('span', { className: 'dot' }), main)
  row.title = `${session.project} · ${session.name}\n${STATUS[status].label}${session.background ? ' · 백그라운드' : ''}`
  row.addEventListener('click', () => pick(handle))
  return row
}

function rowSummary(handle, session, status) {
  const menu = menus.get(handle)
  if (menu) return menu.question || '선택지를 골라 주세요'
  if (status === 'waiting' || status === 'blocked') return attentionSummary(session, null, status)
  if (status === 'working') {
    const tool = session.agent?.toolName ? `${session.agent.toolName} ${session.agent.toolInput}` : ''
    return tool.trim() || '작업 중'
  }
  if (session.agent) return firstLine(session.agent.lastAssistantMessage) || firstLine(session.agent.prompt) || STATUS[status].label
  const lines = screens.get(handle) || []
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i].trim()
    if (text && lineKind(lines[i]) !== 'rule') return text
  }
  return session.title || ''
}

function firstLine(text) {
  for (const line of (text || '').split('\n')) {
    const clean = line.replace(/^[#>*\-\s|]+/, '').replace(/\*\*|`/g, '').trim()
    if (clean) return clean
  }
  return ''
}

function finishedAt(session) {
  return session.agent?.stateStartedAt || session.agent?.updatedAt || 0
}

function orderCards(visible) {
  // Reordering moves DOM nodes, which would steal focus from a reply being typed.
  if (grid.contains(document.activeElement) && document.activeElement.matches('textarea')) return
  visible.sort(
    (a, b) =>
      STATUS[a.status].rank - STATUS[b.status].rank ||
      Number(isPinned(b.handle)) - Number(isPinned(a.handle)) ||
      a.session.project.localeCompare(b.session.project, 'ko') ||
      a.session.name.localeCompare(b.session.name, 'ko') ||
      a.handle.localeCompare(b.handle)
  )
  displayOrder = visible.map((v) => v.handle)
  const current = [...grid.children].filter((node) => !node.hidden).map((node) => node.dataset.handle)
  if (current.join() === displayOrder.join()) return
  for (const { handle } of visible) grid.appendChild(cards.get(handle).el)
}

function renderAttention() {
  const items = attentionHandles()
  attention.hidden = items.length === 0
  attentionList.replaceChildren(
    ...items.map((handle) => {
      const session = sessions.get(handle)
      const status = statusOf(handle)
      const menu = menus.get(handle)
      const li = el('li', { className: 'att', dataset: { status } })
      const head = el('button', { type: 'button', className: 'att-head', title: '크게 보기' })
      head.append(
        el('span', { className: 'dot' }),
        el('span', { className: 'att-project', textContent: session.project }),
        el('span', { className: 'att-name', textContent: session.name }),
        el('span', { className: 'badge', textContent: STATUS[status].label })
      )
      head.addEventListener('click', () => expand(handle))
      const summary = el('div', { className: 'att-text', textContent: attentionSummary(session, menu, status) })
      li.append(head, summary)
      if (menu) li.append(menuButtons(handle, menu, { compact: true }))
      return li
    })
  )
}

function attentionSummary(session, menu, status) {
  if (menu) return [menu.context.at(-1), menu.question].filter(Boolean).join(' — ') || '선택지를 골라 주세요'
  const message = session.agent?.lastAssistantMessage || ''
  const lastPara = message.trim().split(/\n\s*\n/).at(-1) || ''
  if (status === 'blocked') return lastPara || '에이전트가 막혔어요'
  return lastPara || '답을 기다리고 있어요'
}

function renderEmpty(visibleCount) {
  let message = ''
  if (!orcaStatus.ok) message = `Orca에 연결할 수 없어요. ${orcaStatus.error || ''}`
  else if (sessions.size === 0) message = '열린 세션이 없어요. Orca에서 터미널이나 에이전트를 열면 여기에 바로 나타나요.'
  else if (visibleCount === 0) message = '조건에 맞는 세션이 없어요.'
  emptyState.hidden = !message
  emptyState.textContent = message
}

// ---------- card ----------

function createCard(handle) {
  const root = el('article', { className: 'card', dataset: { handle } })
  root.innerHTML = `
    <header class="card-head">
      <span class="dot"></span>
      <div class="titles">
        <div class="line1"><span class="project"></span><span class="name"></span></div>
        <div class="line2"><span class="badge"></span><span class="meta"></span></div>
      </div>
      <div class="actions">
        <button type="button" class="icon" data-act="pin" title="고정 (P)">${icon('pin')}</button>
        <button type="button" class="icon" data-act="details" title="답변 보기">${icon('doc')}</button>
        <button type="button" class="icon" data-act="focus" title="Orca에서 열기">${icon('open')}</button>
        <button type="button" class="icon" data-act="expand" title="크게 보기">${icon('expand')}</button>
      </div>
    </header>
    <div class="body">
      <div class="main">
        <div class="screen" tabindex="0"><pre></pre></div>
        <div class="menu" hidden></div>
        <form class="reply">
          <textarea rows="1" placeholder="메시지 보내기 · Enter 전송, Shift+Enter 줄바꿈"></textarea>
          <button type="button" class="icon" data-act="keys" title="키 입력">${icon('keyboard')}</button>
          <button type="submit" class="icon primary" title="보내기">${icon('send')}</button>
        </form>
        <div class="keypad" hidden></div>
        <div class="note" hidden></div>
      </div>
      <aside class="details"></aside>
    </div>`
  const card = {
    handle,
    el: root,
    screen: root.querySelector('.screen'),
    pre: root.querySelector('pre'),
    menu: root.querySelector('.menu'),
    form: root.querySelector('.reply'),
    input: root.querySelector('textarea'),
    keypad: root.querySelector('.keypad'),
    note: root.querySelector('.note'),
    details: root.querySelector('.details'),
    stick: true,
    dirty: true,
    detailsKey: ''
  }

  card.keypad.append(
    ...KEYPAD.map((key) => {
      const button = el('button', { type: 'button', textContent: KEYS[key].label, title: key })
      button.addEventListener('click', () => pressKeys(handle, [key]))
      return button
    })
  )
  root.querySelector('[data-act="keys"]').addEventListener('click', () => {
    card.keypad.hidden = !card.keypad.hidden
  })
  root.querySelector('[data-act="details"]').addEventListener('click', () => {
    card.el.classList.toggle('show-details')
    if (!card.el.classList.contains('show-details')) renderScreen(card)
  })
  root.querySelector('[data-act="expand"]').addEventListener('click', () => {
    if (isDocked()) setMaximized(!maximized)
    else if (expandedHandle === handle) collapse()
    else expand(handle)
  })
  root.querySelector('[data-act="focus"]').addEventListener('click', () => focusInOrca(handle))
  root.querySelector('[data-act="pin"]').addEventListener('click', () => togglePin(handle))
  root.querySelector('.card-head').addEventListener('dblclick', (e) => {
    if (!e.target.closest('button') && prefs.view === 'grid') expand(handle)
  })
  card.screen.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = card.screen
    card.stick = scrollTop + clientHeight >= scrollHeight - 12
  })
  card.input.addEventListener('input', () => autosize(card.input))
  card.input.addEventListener('keydown', (e) => {
    // Korean IME: Enter that ends a composition must not send the half-typed text.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      card.form.requestSubmit()
    }
    // Esc leaves the box so single-key shortcuts work again; the draft stays.
    if (e.key === 'Escape') {
      if (expandedHandle === handle && !card.input.value) collapse()
      else card.input.blur()
    }
  })
  card.input.addEventListener('blur', () => scheduleRender())
  card.form.addEventListener('submit', (e) => {
    e.preventDefault()
    sendReply(card)
  })

  cards.set(handle, card)
  grid.appendChild(root)
  setExpandButton(card, maximized)
  renderMenu(card)
  return card
}

function updateCard(card, session, status) {
  card.el.dataset.status = status
  const pinned = isPinned(card.handle)
  card.el.classList.toggle('pinned', pinned)
  const pin = card.el.querySelector('[data-act="pin"]')
  pin.ariaPressed = String(pinned)
  pin.title = pinned ? '고정 풀기 (P)' : '고정 (P)'
  card.el.querySelector('.project').textContent = session.project
  const name = card.el.querySelector('.name')
  name.textContent = session.name
  name.title = session.path
  card.el.querySelector('.badge').textContent = STATUS[status].label
  const since = status === 'working' ? session.agent?.stateStartedAt : session.lastOutputAt || session.agent?.updatedAt
  const meta = [
    session.agentType || '터미널',
    session.title && session.title !== session.name ? session.title : '',
    session.background ? '백그라운드' : '',
    since ? ago(since) : ''
  ]
  const metaEl = card.el.querySelector('.meta')
  metaEl.textContent = meta.filter(Boolean).join(' · ')
  metaEl.title = session.background ? 'Orca 창에 탭으로 열려 있지 않지만 실행 중인 터미널이에요' : ''
  if (!card.typeMode) card.input.placeholder = session.agentType ? '메시지 보내기 · Enter 전송, Shift+Enter 줄바꿈' : '명령 입력 · Enter 실행'
  card.input.disabled = !session.writable
  if (expandedHandle === card.handle || card.el.classList.contains('docked')) renderDetails(card, session, status)
}

function isShown(card) {
  if (isDocked()) return card.handle === focusedHandle
  return !card.el.hidden
}

// Hidden cards skip the redraw and catch up when they are shown again.
function renderScreen(card) {
  if (!isShown(card)) {
    card.dirty = true
    return
  }
  card.dirty = false
  const lines = trimTrailingBlank(fullScreens.get(card.handle) || [])
  if (lines.length === 0) {
    card.pre.innerHTML = '<span class="placeholder">화면을 불러오는 중…</span>'
    return
  }
  card.pre.innerHTML = lines
    .map((line) => {
      const kind = lineKind(line)
      if (kind === 'rule') return '<span class="l rule"></span>'
      return `<span class="l${kind ? ` ${kind}` : ''}">${escapeHtml(line) || ' '}</span>`
    })
    .join('')
  if (card.stick) card.screen.scrollTop = card.screen.scrollHeight
}

function renderMenu(card) {
  const menu = menus.get(card.handle)
  card.menu.hidden = !menu
  if (!menu) {
    card.menu.replaceChildren()
    return
  }
  const parts = []
  if (menu.header) parts.push(el('div', { className: 'menu-header', textContent: menu.header }))
  if (menu.context.length) parts.push(el('div', { className: 'menu-ctx', textContent: menu.context.join('\n') }))
  if (menu.question) parts.push(el('div', { className: 'menu-q', textContent: menu.question }))
  parts.push(menuButtons(card.handle, menu))
  if (menu.hint) parts.push(el('div', { className: 'menu-hint', textContent: menu.hint }))
  card.menu.replaceChildren(...parts)
}

function menuButtons(handle, menu, { compact = false } = {}) {
  const wrap = el('div', { className: compact ? 'opts compact' : 'opts' })
  // A second press on the same menu would land in whatever the agent shows next,
  // so options stay locked until the screen changes (or a few seconds pass).
  const sent = pendingChoice.get(handle)
  const locked = isChoicePending(handle, menu)
  for (const option of menu.options) {
    const button = el('button', { type: 'button', className: option.cursor ? 'opt current' : 'opt', title: [option.label, option.desc].filter(Boolean).join('\n') })
    if (isPicked(handle, menu, option)) button.classList.add('picked')
    button.append(el('kbd', { textContent: option.n }), el('span', { className: 'opt-label', textContent: option.label }))
    if (option.desc) button.append(el('span', { className: 'opt-desc', textContent: option.desc }))
    if (locked && sent.n === option.n) button.classList.add('sending')
    button.disabled = !keysForOption(menu, option.n) || locked
    button.addEventListener('click', () => choose(handle, menu, option))
    wrap.append(button)
  }
  if (menu.multiSelect) {
    const submit = el('button', { type: 'button', className: 'opt submit', textContent: 'Enter로 확정' })
    submit.addEventListener('click', () => pressKeys(handle, ['enter']))
    wrap.append(submit)
  }
  return wrap
}

async function choose(handle, menu, option) {
  const keys = keysForOption(menu, option.n)
  if (!keys || isChoicePending(handle, menu)) return
  pendingChoice.set(handle, { signature: menu.signature, n: option.n, until: Date.now() + CHOICE_LOCK_MS })
  refreshMenus(handle)
  const ok = await pressKeys(handle, keys)
  if (ok && prefs.view === 'galaxy') galaxy?.comet(handle)
  if (ok && option.freeText) startMenuTyping(handle)
  if (!ok) pendingChoice.delete(handle)
  setTimeout(() => refreshMenus(handle), ok ? CHOICE_LOCK_MS : 0)
}

// The arrow keys walk the options of the menu in front without touching the terminal;
// Enter then sends the picked one, the same as clicking it.
function isPicked(handle, menu, option) {
  return menuPick?.handle === handle && menuPick.signature === menu.signature && menuPick.n === option.n
}

// The menu in front: the session being looked at, or in the galaxy, the first one in the
// report that is asking.
function menuHandle() {
  const handle = activeHandle()
  if (menus.has(handle)) return handle
  if (prefs.view !== 'galaxy' || !report) return null
  return [...reportEl.querySelectorAll('.rp-row')].map((row) => row.dataset.handle).find((h) => menus.has(h)) || null
}

function movePick(step) {
  const handle = menuHandle()
  const menu = handle && menus.get(handle)
  if (!menu || isChoicePending(handle, menu)) return Boolean(menu)
  const options = menu.options.filter((option) => keysForOption(menu, option.n))
  if (!options.length) return false
  const held = menuPick?.handle === handle && menuPick.signature === menu.signature
  // The first press moves on from where the terminal's own cursor is.
  const at = options.findIndex((option) => (held ? option.n === menuPick.n : option.cursor))
  const next = at < 0 ? options[step > 0 ? 0 : options.length - 1] : options[Math.max(0, Math.min(options.length - 1, at + step))]
  menuPick = { handle, signature: menu.signature, n: next.n }
  sound.chime('seek')
  refreshMenus(handle)
  return true
}

function choosePicked() {
  const handle = menuHandle()
  const menu = handle && menus.get(handle)
  const option = menu?.options.find((o) => isPicked(handle, menu, o))
  if (!option) return false
  menuPick = null
  choose(handle, menu, option)
  return true
}

function isChoicePending(handle, menu) {
  const sent = pendingChoice.get(handle)
  return sent?.signature === menu.signature && Date.now() < sent.until
}

// Redraw both places a menu's buttons appear: the card and the attention band.
function refreshMenus(handle) {
  const card = cards.get(handle)
  if (card) renderMenu(card)
  if (prefs.view === 'grid') renderAttention()
  if (report) renderReport()
}

function renderDetails(card, session, status) {
  if (!session) return
  const agent = session.agent
  const key = JSON.stringify([session, status])
  if (key === card.detailsKey) return
  card.detailsKey = key
  const sections = []
  const info = el('dl', { className: 'info' })
  const rows = [
    ['상태', STATUS[status].label],
    ['브랜치', session.branch],
    ['위치', session.path],
    ['메모', session.comment]
  ]
  for (const [label, value] of rows) {
    if (value) info.append(el('dt', { textContent: label }), el('dd', { textContent: value }))
  }
  sections.push(info)
  if (agent?.state === 'working' && !agent.monitoring && agent.toolName) {
    sections.push(section('지금 하는 일', el('pre', { className: 'tool', textContent: `${agent.toolName}  ${agent.toolInput}`.trim() })))
  }
  if (agent?.prompt) sections.push(section('마지막 요청', el('div', { className: 'prompt', textContent: agent.prompt })))
  if (agent?.lastAssistantMessage) {
    const answer = el('div', { className: 'md' })
    answer.innerHTML = renderMarkdown(agent.lastAssistantMessage)
    sections.push(section('마지막 답변', answer))
  }
  if (!agent) sections.push(el('p', { className: 'muted', textContent: '이 터미널에는 Orca가 추적하는 에이전트가 없어요. 화면과 키 입력으로 다룰 수 있어요.' }))
  card.details.replaceChildren(...sections)
}

function section(title, body) {
  const wrap = el('section')
  wrap.append(el('h3', { textContent: title }), body)
  return wrap
}

// ---------- actions ----------

async function api(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Portal-Token': TOKEN },
      body: JSON.stringify(body)
    })
    if (res.status === 403) return { ok: false, error: { message: '오러리 서버가 다시 시작됐어요. 새로고침해 주세요.' } }
    return await res.json()
  } catch {
    return { ok: false, error: { message: '오러리 서버에 연결할 수 없어요.' } }
  }
}

// After picking a "Type something" option, the agent's menu has its own text field:
// the next reply is typed into it instead of being sent as a new prompt.
function startMenuTyping(handle) {
  const card = cards.get(handle)
  if (!card) return
  if (prefs.view === 'grid' && expandedHandle !== handle) expand(handle)
  if (isDocked() && focusedHandle !== handle) setFocus(handle)
  card.typeMode = true
  card.el.classList.add('typing-menu')
  card.input.placeholder = '메뉴 입력칸에 들어갈 답 · Enter로 입력'
  setTimeout(() => card.input.focus(), 0)
  showNote(card, '메뉴의 입력칸을 열었어요. 아래에 답을 쓰고 Enter를 누르면 그 칸에 입력돼요.', 'ok')
}

function stopMenuTyping(card) {
  if (!card.typeMode) return
  card.typeMode = false
  card.el.classList.remove('typing-menu')
  updateCard(card, sessions.get(card.handle), statusOf(card.handle))
}

async function sendReply(card, mode = card.typeMode && menus.has(card.handle) ? 'type' : undefined) {
  const text = card.input.value
  if (!text.trim()) return
  const submit = card.form.querySelector('[type="submit"]')
  submit.disabled = true
  const res = await api('/api/send', { handle: card.handle, text, mode })
  submit.disabled = false
  if (res.ok) {
    lastActionAt.set(card.handle, Date.now())
    card.input.value = ''
    autosize(card.input)
    card.stick = true
    stopMenuTyping(card)
    if (prefs.view === 'galaxy') galaxy?.comet(card.handle)
    showNote(card, mode === 'type' ? '입력했어요' : '보냈어요', 'ok')
    return
  }
  if (res.error?.code === 'agent_prompt_blocked') {
    const button = el('button', { type: 'button', textContent: '메뉴 입력칸에 입력' })
    button.addEventListener('click', () => sendReply(card, 'type'))
    showNote(card, '선택 메뉴가 열려 있어서 메시지로 보낼 수 없어요. 위에서 선택지를 고르거나, 메뉴의 입력칸에 바로 입력할 수 있어요.', 'warn', button)
    return
  }
  showNote(card, res.error?.message || '보내지 못했어요.', 'err')
}

async function pressKeys(handle, keys) {
  const res = await api('/api/keys', { handle, keys })
  if (res.ok) lastActionAt.set(handle, Date.now())
  else {
    const card = cards.get(handle)
    if (card) showNote(card, res.error?.message || '키를 보내지 못했어요.', 'err')
  }
  return res.ok
}

async function focusInOrca(handle) {
  const res = await api('/api/focus', { handle })
  const card = cards.get(handle)
  if (card) showNote(card, res.ok ? 'Orca에서 이 터미널을 열었어요' : res.error?.message || 'Orca에서 열지 못했어요.', res.ok ? 'ok' : 'err')
}

function showNote(card, message, tone, action) {
  clearTimeout(card.noteTimer)
  card.note.hidden = false
  card.note.dataset.tone = tone
  card.note.replaceChildren(el('span', { textContent: message }), ...(action ? [action] : []))
  if (!action) card.noteTimer = setTimeout(() => (card.note.hidden = true), tone === 'err' ? 8000 : 2500)
}

function expand(handle, { focusInput = true } = {}) {
  if (isDocked()) return pick(handle)
  if (expandedHandle && expandedHandle !== handle) {
    previousHandle = expandedHandle
    collapse()
  }
  const card = cards.get(handle)
  if (!card) return
  expandedHandle = handle
  card.el.hidden = false
  card.el.classList.add('expanded')
  setExpandButton(card, true)
  card.keypad.hidden = false
  card.stick = true
  backdrop.hidden = false
  document.body.classList.add('has-expanded')
  card.detailsKey = ''
  renderDetails(card, sessions.get(handle), statusOf(handle))
  renderScreen(card)
  if (focusInput) card.input.focus()
}

function collapse() {
  const card = cards.get(expandedHandle)
  expandedHandle = null
  backdrop.hidden = true
  document.body.classList.remove('has-expanded')
  if (card) {
    card.el.classList.remove('expanded')
    setExpandButton(card, false)
    if (!card.input.value) card.input.blur()
    card.keypad.hidden = true
    card.stick = true
    renderScreen(card)
  }
  renderAll()
}

// Grid view opens a card as an overlay; list view maximizes the docked pane instead.
function setExpandButton(card, active) {
  const button = card.el.querySelector('[data-act="expand"]')
  const [name, title] =
    isDocked() ? (active ? ['shrink', '되돌리기 (F)'] : ['expand', '최대화 (F)']) : active ? ['close', '닫기 (Esc)'] : ['expand', '크게 보기 (F)']
  button.innerHTML = icon(name)
  button.title = title
}

function setMaximized(on) {
  if (on && !isDocked()) return
  if (on && prefs.view === 'galaxy') setPaneOpen(true)
  maximized = on
  document.body.classList.toggle('maximized', on)
  galaxy?.setActive(prefs.view === 'galaxy' && !on)
  for (const card of cards.values()) setExpandButton(card, on)
  const card = cards.get(focusedHandle)
  if (card) {
    card.stick = true
    renderScreen(card)
  }
  if (on) toast('최대화했어요 · F나 Esc로 되돌려요')
}

function toggleMaximize() {
  if (isDocked()) return setMaximized(!maximized)
  if (expandedHandle) collapse()
  else if (focusedHandle || displayOrder[0]) expand(focusedHandle || displayOrder[0], { focusInput: false })
}

// ---------- controls ----------

function setupControls() {
  // A status filter works like a search: its planets light up, Enter goes from one to the
  // next, and words typed in the search box narrow it further. Pressed again, it lets go.
  for (const button of document.querySelectorAll('button[data-filter]')) {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter === prefs.filter ? 'all' : button.dataset.filter
      const started = prefs.filter === 'all' && filter !== 'all' && !searchQuery()
      prefs.filter = filter
      searchAt = null
      savePrefs()
      applyPrefs()
      renderAll()
      if (filter !== 'all' && prefs.view === 'galaxy') {
        if (started && !paneOpen) galaxy?.overview()
        search.focus()
      }
    })
  }
  for (const button of document.querySelectorAll('button[data-size]')) {
    button.addEventListener('click', () => {
      prefs.size = button.dataset.size
      savePrefs()
      applyPrefs()
      for (const card of cards.values()) {
        card.stick = true
        renderScreen(card)
      }
    })
  }
  for (const button of document.querySelectorAll('button[data-view]')) {
    button.addEventListener('click', () => setView(button.dataset.view))
  }
  showShells.addEventListener('change', () => {
    prefs.showShells = showShells.checked
    savePrefs()
    renderAll()
  })
  autoFollow.addEventListener('change', () => {
    prefs.autoFollow = autoFollow.checked
    savePrefs()
    if (prefs.autoFollow) processQueue()
  })
  search.addEventListener('input', () => {
    const started = !searchFor && searchQuery()
    searchFor = searchQuery()
    searchAt = null
    renderAll()
    // A search just begun: step back so everything it lights up is in view.
    if (started && prefs.view === 'galaxy' && !paneOpen) galaxy?.overview()
  })
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    // Enter that only finishes a Korean syllable: go once the letter has landed.
    if (e.isComposing) setTimeout(() => jumpToMatch(e.shiftKey ? -1 : 1), 30)
    else jumpToMatch(e.shiftKey ? -1 : 1)
  })
  backdrop.addEventListener('click', collapse)
  for (const type of ['pointerdown', 'keydown', 'wheel']) {
    document.addEventListener(type, () => (lastInteraction = Date.now()), { capture: true, passive: true })
  }
  // Any real touch wakes the page from quiet mode (Z itself toggles it, so it's left to the shortcut).
  for (const type of ['pointerdown', 'wheel', 'keydown']) {
    document.addEventListener(type, (e) => zen && !(type === 'keydown' && ['KeyZ', 'Escape'].includes(e.code)) && setZen(false), { capture: true, passive: true })
  }
  document.addEventListener('pointermove', (e) => {
    if (!zen) return
    zenMoved += Math.abs(e.movementX) + Math.abs(e.movementY)
    if (zenMoved > 80) setZen(false)
  })
  setInterval(checkZen, 10_000)
  paneToggle.addEventListener('click', () => {
    setPaneOpen(!paneOpen)
    if (paneOpen && focusedHandle) galaxy?.flyTo(focusedHandle)
  })
  document.addEventListener('keydown', onShortcut)
  document.querySelector('.help-btn').addEventListener('click', openHelp)
  help.addEventListener('click', (e) => {
    if (e.target === help || e.target.closest('[data-act="close-help"]')) help.close()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRender()
    syncAmbient()
    api('/api/speaker', { page: PAGE_ID, visible: document.visibilityState === 'visible' })
  })
  addEventListener('pointerdown', touchSpeaker, true)
  addEventListener('keydown', touchSpeaker, true)
  soundButton.addEventListener('click', () => setSound(!prefs.sound))
  settingsButton.innerHTML = icon('sliders')
  settingsButton.addEventListener('click', () => toggleSettings())
  sound.setMix(mixLevels())
  sound.setMoodEnabled(prefs.musicMood)
  logButton.addEventListener('click', () => toggleLog())
  guideButton.addEventListener('click', () => toggleGuide())
  birthButton.addEventListener('click', () => toggleBirth())
  document.body.classList.toggle('titles-off', !prefs.titles)
  if (desktop) {
    document.body.classList.add('in-app')
    desktop.onPick((handle) => sessions.has(handle) && pick(handle))
  }
  birthEl.addEventListener('input', onBirthInput)
  birthEl.addEventListener('submit', onBirthSubmit)
  setSound(prefs.sound)
  setupPalette()
  setInterval(processQueue, 1000)
  setInterval(renderAll, 15_000)
  applyPrefs()
}

// List and galaxy views both dock one session on the right.
function isDocked() {
  return prefs.view !== 'grid'
}

// ---------- pins ----------

// Pins follow the worktree path, which survives Orca restarts (terminal handles don't).
function isPinned(handle) {
  const path = sessions.get(handle)?.path
  return Boolean(path) && prefs.pins.includes(path)
}

function togglePin(handle) {
  const path = sessions.get(handle)?.path
  if (!path) return
  const pinned = prefs.pins.includes(path)
  prefs.pins = pinned ? prefs.pins.filter((p) => p !== path) : [...prefs.pins, path]
  savePrefs()
  renderAll()
  toast(pinned ? '고정을 풀었어요' : '고정했어요 · 맨 위에 두고 먼저 챙겨요')
}

// ---------- settings ----------

// Percent in the panel; factors (1 = as designed) for the galaxy and the sound.
function lookOf(look) {
  return { glow: look.glow / 100, brightness: look.brightness / 100 }
}

// Volume factors for the sound engine: a switched-off sound is 0.
function mixLevels() {
  return Object.fromEntries(Object.keys(MIX_DEFAULTS).map((key) => [key, prefs.mixOff[key] ? 0 : volumeOf(key) / 100]))
}

function volumeOf(key) {
  return prefs.mix[key] ?? MIX_DEFAULTS[key] * 100
}

function toggleSettings(on = settingsEl.hidden) {
  settingsEl.hidden = !on
  settingsButton.setAttribute('aria-expanded', String(on))
  if (on) renderSettings()
}

function renderSettings() {
  const head = el('header', { className: 'st-head' })
  const close = el('button', { type: 'button', className: 'rp-close', title: '닫기 (Esc)', textContent: '×' })
  close.addEventListener('click', () => toggleSettings(false))
  head.append(el('b', { textContent: '빛과 소리' }), close)
  const section = (title) => {
    const box = el('section', { className: 'st-section' })
    box.append(el('h3', { textContent: title }))
    return box
  }

  const light = section('빛')
  for (const [key, label, min, max] of LOOK_SETTINGS) {
    const row = el('label', { className: 'st-row' })
    row.append(el('span', { textContent: label }), ...slider(prefs.look[key], min, max, (value) => {
      prefs.look = { ...prefs.look, [key]: value }
      savePrefs()
      galaxy?.setLook(lookOf(prefs.look))
    }))
    light.append(row)
  }

  const sounds = section('소리')
  for (const [key, label] of SOUNDS) {
    const row = el('div', { className: 'st-row st-sound' })
    const [range, value] = slider(volumeOf(key), 0, 150, (v) => {
      prefs.mix = { ...prefs.mix, [key]: v }
      savePrefs()
      sound.setMix(mixLevels())
    })
    // Let go of a slider and hear that sound at its new level.
    range.addEventListener('change', () => sound.preview(key))
    range.setAttribute('aria-label', `${label} 크기`)
    const toggle = el('input', { type: 'checkbox', className: 'st-switch', checked: !prefs.mixOff[key], title: `${label} 켜기 / 끄기` })
    toggle.setAttribute('aria-label', `${label} 켜기`)
    const paint = () => {
      row.classList.toggle('off', !toggle.checked)
      range.disabled = !toggle.checked
    }
    toggle.addEventListener('change', () => {
      const { [key]: _, ...rest } = prefs.mixOff
      prefs.mixOff = toggle.checked ? rest : { ...rest, [key]: true }
      savePrefs()
      sound.setMix(mixLevels())
      paint()
      if (toggle.checked) sound.preview(key)
    })
    paint()
    row.append(toggle, el('span', { textContent: label }), range, value)
    sounds.append(row)
  }
  const moodRow = el('label', { className: 'st-row st-decor' })
  const moodToggle = el('input', { type: 'checkbox', className: 'st-switch', checked: prefs.musicMood })
  moodToggle.addEventListener('change', () => {
    prefs.musicMood = moodToggle.checked
    savePrefs()
    sound.setMoodEnabled(prefs.musicMood)
  })
  moodRow.append(moodToggle, el('span', { textContent: '음악이 상태 따라 변하기' }), el('small', { textContent: '질문 · 작업량 · 보는 별 따라' }))
  sounds.append(moodRow)

  const decor = section('장식')
  for (const [key, label, note] of DECOR) {
    const locked = isLocked(key)
    const row = el('label', { className: locked ? 'st-row st-decor locked' : 'st-row st-decor' })
    const toggle = el('input', { type: 'checkbox', className: 'st-switch', checked: !locked && prefs.decor[key] !== false, disabled: locked })
    toggle.addEventListener('change', () => {
      prefs.decor = { ...prefs.decor, [key]: toggle.checked }
      savePrefs()
      galaxy?.setDecor(decorFlags())
    })
    row.append(toggle, el('span', { textContent: locked ? `🔒 ${label}` : label }), el('small', { textContent: locked ? unlockText(key) : note }))
    decor.append(row)
  }

  const test = admin ? adminSection(section('관리자 테스트')) : null
  const foot = el('div', { className: 'st-foot' })
  if (!prefs.sound) foot.append(el('small', { textContent: '소리가 꺼져 있어요 · M으로 켜요' }))
  const reset = el('button', { type: 'button', className: 'st-reset', textContent: '처음대로' })
  reset.addEventListener('click', () => {
    Object.assign(prefs, { look: { ...LOOK_DEFAULTS }, mix: {}, mixOff: {}, decor: {}, musicMood: true })
    savePrefs()
    sound.setMoodEnabled(true)
    galaxy?.setLook(lookOf(prefs.look))
    galaxy?.setDecor(decorFlags())
    sound.setMix(mixLevels())
    renderSettings()
  })
  foot.append(reset)
  settingsEl.replaceChildren(...[head, light, sounds, decor, test, foot].filter(Boolean))
}

function loadTestItems() {
  try {
    const saved = JSON.parse(localStorage.getItem(TEST_KEY) || '{}')
    const valid = (i) => /^test_\d+$/.test(i?.handle) && typeof i.app === 'string' && typeof i.planet === 'string' && STATUS[i.status]
    for (const item of Array.isArray(saved.items) ? saved.items.filter(valid) : []) {
      testItems.set(item.handle, { handle: item.handle, app: item.app, path: `/test/${item.app}`, pr: null, servers: [], disk: 0, moons: 0, planet: item.planet, branch: 'test', status: item.status, statusLabel: STATUS[item.status].label, summary: '관리자 테스트', background: false, pinned: false, active: item.status === 'working', show: true })
    }
    testSerial = Math.max(Number(saved.serial) || 0, ...[...testItems.keys()].map((h) => Number(h.slice(5))))
  } catch {}
}

function saveTestItems() {
  try {
    const items = [...testItems.values()].map(({ handle, app, planet, status }) => ({ handle, app, planet, status }))
    localStorage.setItem(TEST_KEY, JSON.stringify({ serial: testSerial, items }))
  } catch {}
}

function adminMode() {
  try {
    const flag = new URLSearchParams(location.search).get('admin')
    if (flag !== null) localStorage.setItem(ADMIN_KEY, flag === '0' ? '' : '1')
    return localStorage.getItem(ADMIN_KEY) === '1'
  } catch {
    return false
  }
}

// Buttons for trying things out. Fake stars and planets are kept in this browser until
// they're swept away; the black hole swallows them without closing anything.
function adminSection(box) {
  const apps = () => [...new Set([...testItems.values()].map((i) => i.app))]
  const fake = (app, status) => {
    const handle = `test_${++testSerial}`
    const item = { handle, app, path: `/test/${app}`, pr: null, servers: [], disk: 0, moons: 0, planet: `테스트 행성 ${testSerial}`, branch: 'test', status, statusLabel: STATUS[status].label, summary: '관리자 테스트', background: false, pinned: false, active: false, show: true }
    testItems.set(handle, item)
    born.add(handle)
  }
  const setStatus = (item, status) => Object.assign(item, { status, statusLabel: STATUS[status].label, active: status === 'working' })
  const drop = (app) => {
    for (const [handle, item] of testItems) {
      if (item.app !== app) continue
      testItems.delete(handle)
      vanished.add(handle)
    }
  }
  const actions = [
    ['⭐ 별 탄생', () => {
      testFocus = `테스트별 ${String.fromCharCode(65 + (apps().length % 26))}${testSerial}`
      fake(testFocus, 'done')
    }],
    // Onto the fake star last looked at, else the newest one, else a new star.
    ['🪐 행성 하나 추가', () => {
      const app = apps().includes(testFocus) ? testFocus : apps().at(-1) || `테스트별 A${testSerial}`
      testFocus = app
      fake(app, 'done')
      toast(`🪐 ${app}에 행성을 더했어요 · ${[...testItems.values()].filter((i) => i.app === app).length}개`)
    }],
    ['💥 별 터뜨리기', () => (apps().length ? drop(apps().at(-1)) : toast('먼저 테스트 별을 만들어요'))],
    ['⚙️ 일하기 ↔ 쉬기', () => {
      const items = [...testItems.values()]
      const busy = items.some((i) => i.status === 'working')
      for (const item of items) setStatus(item, busy ? 'done' : 'working')
    }],
    ['❓ 질문 띄우기', () => {
      const item = [...testItems.values()].find((i) => STATUS[i.status].group !== 'attention')
      if (!item) return toast('먼저 테스트 별을 만들어요')
      setStatus(item, 'choice')
      sound.chime('attention')
    }],
    ['💬 답하기', () => {
      const item = [...testItems.values()].find((i) => STATUS[i.status].group === 'attention')
      if (item) setStatus(item, 'done')
    }],
    ['🌠 유성우', () => galaxy?.test('shower')],
    ['💫 먼 초신성', () => galaxy?.test('far-nova')],
    ['✨ 먼 별 탄생', () => galaxy?.test('far-birth')],
    ['⏩ 잔해 하루 지나게', () => {
      remnants = remnants.map((r) => ({ ...r, diedAt: r.diedAt - 86_400_000 })).filter((r) => Date.now() - r.diedAt < REMNANT_MS)
      try {
        localStorage.setItem(REMNANT_KEY, JSON.stringify(remnants))
      } catch {}
      galaxy?.setRemnants(remnants)
    }],
    ['🧹 테스트 별 치우기', () => apps().forEach(drop)],
    ['🪙 토큰 +1천만', () => addTokens(1e7)],
    ['✦ 별가루 +5', () => {
      stardust.bonus += 5
      saveStardust()
      toast(`✦ 별가루 ${dustLeft()}개`)
      if (!logEl.hidden) renderLog()
    }],
    ['🎉 기념 불꽃', () => {
      const app = sessions.get(focusedHandle)?.project || apps()[0] || [...sessions.values()][0]?.project
      if (app) galaxy?.celebrate(app)
    }],
    ['🔓 장식 모두 열기', () => {
      unlock(Object.keys(UNLOCKS).filter(isLocked))
      renderSettings()
    }],
    ['🔒 해금 처음부터', () => {
      Object.assign(stardust, { since: Date.now(), earned: 0, bonus: 0, spent: 0, unlocked: [] })
      saveStardust()
      galaxy?.setDecor(decorFlags())
      renderSettings()
      if (!logEl.hidden) renderLog()
      toast('새 우주처럼 장식을 다시 잠갔어요')
    }]
  ]
  const grid = el('div', { className: 'st-admin' })
  for (const [label, act] of actions) {
    const button = el('button', { type: 'button', className: 'st-reset', textContent: label })
    button.addEventListener('click', () => {
      act()
      saveTestItems()
      scheduleRender()
    })
    grid.append(button)
  }
  box.append(grid, el('small', { className: 'st-note', textContent: '가짜 별과 행성은 이 브라우저에 남아 있다가 🧹로 치우면 사라져요. 행성은 마지막으로 본 테스트 별에 붙어요. 블랙홀로 보내도 실제 터미널은 닫히지 않아요.' }))
  return box
}

// A percent slider and the number beside it.
function slider(start, min, max, onInput) {
  const value = el('output', { textContent: `${start}%` })
  const range = el('input', { type: 'range', min, max, step: 5, value: start })
  range.addEventListener('input', () => {
    value.textContent = `${range.value}%`
    onInput(Number(range.value))
  })
  return [range, value]
}

// ---------- play ----------

// What the viewer caught, threw and saw in the galaxy, kept in this browser (LOG_KEY).
const TINTS = [
  ['흰', '#fff7e6'],
  ['초록', '#b3ffcc'],
  ['파랑', '#b3d9ff'],
  ['금빛', '#ffd999']
]
const LOG_FIELDS = { meteor: 'meteors', comet: 'comets', throw: 'thrown', swallow: 'swallowed', core: 'core', splash: 'splashes', clean: 'cleaned', aurora: 'auroras', supernova: 'novas', starbirth: 'births' }
const BADGES = [
  { id: 'meteor', icon: '🌠', name: '첫 별똥별', hint: '지나가는 별똥별을 눌러 잡기', earned: (l) => l.meteors >= 1 },
  { id: 'hunter', icon: '🏹', name: '유성 사냥꾼', hint: '별똥별 10개 잡기', earned: (l) => l.meteors >= 10 },
  { id: 'colors', icon: '🌈', name: '네 빛깔', hint: '네 가지 색 별똥별을 다 잡기', earned: (l) => l.tints.every(Boolean) },
  { id: 'comet', icon: '☄️', name: '혜성 사냥꾼', hint: '멀리 지나가는 큰 혜성 잡기', earned: (l) => l.comets >= 1 },
  { id: 'throw', icon: '🎯', name: '첫 투척', hint: '빈 곳을 Alt+끌기로 혜성 던지기', earned: (l) => l.thrown >= 1 },
  { id: 'feed', icon: '⭐', name: '별 먹이 주기', hint: '혜성을 별에 떨어뜨리기', earned: (l) => l.swallowed >= 1 },
  { id: 'core', icon: '🌀', name: '은하 중심으로', hint: '혜성을 은하 한가운데에 떨어뜨리기', earned: (l) => l.core >= 1 },
  { id: 'splash', icon: '💥', name: '명중', hint: '혜성으로 행성 맞히기', earned: (l) => l.splashes >= 1 },
  { id: 'clean', icon: '🕳', name: '우주 청소부', hint: '다 쓴 터미널을 블랙홀로 보내기', earned: (l) => l.cleaned >= 1 },
  { id: 'aurora', icon: '🌌', name: '오로라', hint: '에이전트 여럿이 함께 일할 때 나타나요', earned: (l) => l.auroras >= 1 },
  { id: 'nova', icon: '💫', name: '초신성 목격', hint: '먼 하늘에서 별이 터질 때', earned: (l) => l.novas >= 1 },
  { id: 'birth', icon: '✨', name: '별의 탄생', hint: '팔의 가스에서 새 별이 켜질 때', earned: (l) => l.births >= 1 }
]

// The newest eight remnants, each kept for three days after its star died.
function loadRemnants() {
  try {
    const saved = JSON.parse(localStorage.getItem(REMNANT_KEY) || '[]')
    const valid = (r) => typeof r?.app === 'string' && Array.isArray(r.at) && r.at.length === 3 && r.at.every(Number.isFinite) && typeof r.color === 'string' && Number.isFinite(r.diedAt) && Number.isInteger(r.seed)
    return saved.filter((r) => valid(r) && Date.now() - r.diedAt < REMNANT_MS)
  } catch {
    return []
  }
}

function loadSpots() {
  try {
    const saved = JSON.parse(localStorage.getItem(SPOT_KEY) || '{}')
    return Object.fromEntries(Object.entries(saved).filter(([, i]) => Number.isInteger(i) && i >= 0))
  } catch {
    return {}
  }
}

// Apps long gone drop out first once there are more than a few hundred.
function saveSpot(app, i) {
  spots = Object.fromEntries([...Object.entries(spots).filter(([name]) => name !== app), [app, i]].slice(-300))
  try {
    localStorage.setItem(SPOT_KEY, JSON.stringify(spots))
  } catch {}
}

// ---------- stardust ----------

// Tokens are counted from when this browser started: a worktree seen for the first time
// adds only what comes after, unless the whole of it is newer than the count.
function loadStardust() {
  try {
    const saved = JSON.parse(localStorage.getItem(STARDUST_KEY) || 'null')
    if (saved && Number.isFinite(saved.earned)) {
      const number = (n) => (Number.isFinite(n) ? n : 0)
      return { since: number(saved.since), seen: saved.seen && typeof saved.seen === 'object' ? saved.seen : {}, earned: saved.earned, bonus: number(saved.bonus), spent: number(saved.spent), unlocked: Array.isArray(saved.unlocked) ? saved.unlocked : [] }
    }
  } catch {}
  let before = false
  try {
    before = localStorage.getItem('orca-portal-prefs') !== null
  } catch {}
  return { since: Date.now(), seen: {}, earned: 0, bonus: 0, spent: 0, unlocked: before ? [...DECOR_BEFORE] : [] }
}

function saveStardust() {
  try {
    localStorage.setItem(STARDUST_KEY, JSON.stringify(stardust))
  } catch {}
}

function dustLeft() {
  return Math.floor(stardust.earned / DUST_TOKENS) + stardust.bonus - stardust.spent
}

function trackTokens(paths) {
  let gained = 0
  let changed = false
  for (const [p, u] of Object.entries(paths)) {
    const tokens = u.tokens || 0
    const before = stardust.seen[p]
    if (before === tokens) continue
    if (before === undefined) gained += u.firstAt > stardust.since ? tokens : 0
    else gained += Math.max(0, tokens - before)
    stardust.seen[p] = tokens
    changed = true
  }
  if (!changed) return
  // Worktrees long gone drop out first once there are more than a few hundred.
  const seen = Object.keys(stardust.seen)
  for (const p of seen.slice(0, Math.max(0, seen.length - 400))) delete stardust.seen[p]
  addTokens(gained)
}

function addTokens(gained) {
  const before = dustLeft()
  stardust.earned += gained
  saveStardust()
  const more = dustLeft() - before
  if (more > 0) {
    sound.chime('stardust')
    toast(`✦ 별가루가 ${more > 1 ? `${more}개 ` : ''}생겼어요 · 모두 ${dustLeft()}개 · 도감(L)에서 써요`, 3200)
  }
  checkUnlocks()
  if (!logEl.hidden) renderLog()
}

// An app's tokens passed a milestone (the galaxy celebrates it): a grain of stardust.
function onMilestone(app, tokens) {
  stardust.bonus += 1
  saveStardust()
  toast(`🎉 ${app} 토큰이 ${compactNumber(tokens)}을 넘었어요 · 별가루 +1`, 4000)
  if (!logEl.hidden) renderLog()
}

function isLocked(id) {
  return Boolean(UNLOCKS[id]) && !stardust.unlocked.includes(id)
}

function unlockMet(id) {
  const rule = UNLOCKS[id]
  return rule.tokens ? stardust.earned >= rule.tokens : rule.met(playLog)
}

function unlockText(id) {
  const rule = UNLOCKS[id]
  return rule.tokens ? `함께 쓴 토큰 ${compactNumber(rule.tokens)}부터 · 지금 ${compactNumber(stardust.earned)}` : rule.hint
}

// Locked decorations stay off whatever the switches say.
function decorFlags() {
  const flags = { ...prefs.decor }
  for (const id of Object.keys(UNLOCKS)) if (isLocked(id)) flags[id] = false
  return flags
}

function checkUnlocks() {
  const ready = Object.keys(UNLOCKS).filter((id) => isLocked(id) && unlockMet(id))
  if (ready.length) unlock(ready)
}

// A decoration opens up: it appears in the galaxy with a bowl, a run of glass and a shower.
function unlock(ids) {
  if (!ids.length) return
  stardust.unlocked.push(...ids)
  saveStardust()
  galaxy?.setDecor(decorFlags())
  const names = ids.map((id) => DECOR.find(([key]) => key === id)?.[1] || id)
  toast(`🔓 새 장식이 열렸어요 · ${names.join(', ')}`, 4500)
  sound.chime('unlock')
  if (prefs.view === 'galaxy') galaxy?.test('shower')
  if (!settingsEl.hidden) renderSettings()
  if (!logEl.hidden) renderLog()
}

function spendDust(event) {
  if (dustLeft() < event.cost) return toast(`별가루가 ${event.cost - dustLeft()}개 모자라요`)
  if (prefs.view !== 'galaxy' || !galaxy) return toast('은하 보기에서 써요')
  if (!galaxy.spend(event.id)) return toast('지금은 볼 수 없어요 · 동작 줄이기가 켜져 있어요')
  stardust.spent += event.cost
  saveStardust()
  toast(`${event.icon} ${event.name} · 별가루 ${dustLeft()}개 남았어요`)
  renderLog()
}

// The top of the play log: stardust to spend, and what opens up next.
function dustSection() {
  const box = el('section', { className: 'lg-dust' })
  const head = el('div', { className: 'lg-dust-head' })
  const toNext = DUST_TOKENS - (stardust.earned % DUST_TOKENS)
  head.append(el('b', { textContent: `✦ 별가루 ${dustLeft()}` }), el('small', { textContent: `함께 쓴 토큰 ${compactNumber(stardust.earned)} · 다음 별가루까지 ${compactNumber(toNext)}` }))
  const buttons = el('div', { className: 'lg-dust-events' })
  for (const event of DUST_EVENTS) {
    const button = el('button', { type: 'button', disabled: dustLeft() < event.cost, title: `별가루 ${event.cost}개` })
    button.append(el('i', { textContent: event.icon }), el('span', { textContent: event.name }), el('small', { textContent: `✦${event.cost}` }))
    button.addEventListener('click', () => spendDust(event))
    buttons.append(button)
  }
  const unlocks = el('ul', { className: 'lg-unlocks' })
  for (const id of Object.keys(UNLOCKS)) {
    const name = DECOR.find(([key]) => key === id)?.[1] || id
    const rule = UNLOCKS[id]
    const open = !isLocked(id)
    const li = el('li', { className: open ? 'open' : '' })
    li.append(el('i', { textContent: open ? '✦' : '🔒' }), el('b', { textContent: name }), el('small', { textContent: open ? '열림' : unlockText(id) }))
    if (!open && rule.tokens) {
      const bar = el('span', { className: 'lg-bar' })
      bar.style.setProperty('--at', `${Math.min(100, (stardust.earned / rule.tokens) * 100).toFixed(1)}%`)
      li.append(bar)
    }
    unlocks.append(li)
  }
  box.append(head, buttons, el('h4', { textContent: '열리는 장식' }), unlocks)
  return box
}

function addRemnant(remnant) {
  remnants = [...remnants.filter((r) => Date.now() - r.diedAt < REMNANT_MS), remnant].slice(-8)
  try {
    localStorage.setItem(REMNANT_KEY, JSON.stringify(remnants))
  } catch {}
  galaxy?.setRemnants(remnants)
}

function loadLog() {
  const empty = { meteors: 0, tints: [0, 0, 0, 0], comets: 0, thrown: 0, swallowed: 0, core: 0, splashes: 0, cleaned: 0, auroras: 0, novas: 0, births: 0, badges: [], since: Date.now() }
  try {
    const saved = JSON.parse(localStorage.getItem(LOG_KEY) || '{}')
    return { ...empty, ...saved, tints: empty.tints.map((n, i) => saved.tints?.[i] || n), badges: Array.isArray(saved.badges) ? saved.badges : [] }
  } catch {
    return empty
  }
}

function saveLog() {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(playLog))
  } catch {}
}

function onPlay(event) {
  if (event.type === 'ring') return toast(`🪐 ${event.planet} 둘레에 먼지 고리가 생겼어요`)
  const field = LOG_FIELDS[event.type]
  if (!field) return
  playLog[field]++
  if (event.type === 'meteor' && event.tint >= 0) playLog.tints[event.tint]++
  const fresh = BADGES.filter((b) => !playLog.badges.includes(b.id) && b.earned(playLog))
  playLog.badges.push(...fresh.map((b) => b.id))
  saveLog()
  checkUnlocks()
  if (fresh.length) toast(`${fresh[0].icon} 새 배지 · ${fresh[0].name}`)
  else if (event.type === 'meteor') toast(`🌠 별똥별을 잡았어요 · ${playLog.meteors}개째`)
  else if (event.type === 'comet') toast('☄️ 큰 혜성을 잡았어요')
  if (!logEl.hidden) renderLog()
}

function toggleGuide(on = guideEl.hidden) {
  guideEl.hidden = !on
  guideButton.setAttribute('aria-expanded', String(on))
}

function toggleLog(on = logEl.hidden) {
  logEl.hidden = !on
  logButton.setAttribute('aria-expanded', String(on))
  if (on) renderLog()
}

function renderLog() {
  const head = el('header', { className: 'lg-head' })
  const close = el('button', { type: 'button', className: 'rp-close', title: '닫기 (Esc)', textContent: '×' })
  close.addEventListener('click', () => toggleLog(false))
  head.append(el('b', { textContent: '우주 도감' }), el('span', { textContent: `${playLog.badges.length} / ${BADGES.length} 배지` }), close)

  const stats = el('dl', { className: 'lg-stats' })
  const stat = (name, value, extra) => {
    const dd = el('dd', { textContent: String(value) })
    if (extra) dd.append(extra)
    stats.append(el('dt', { textContent: name }), dd)
  }
  const tints = el('span', { className: 'lg-tints' })
  TINTS.forEach(([name, color], i) => {
    const dot = el('i', { title: `${name} ${playLog.tints[i]}개`, textContent: String(playLog.tints[i]) })
    dot.style.setProperty('--tint', color)
    tints.append(dot)
  })
  stat('잡은 별똥별', playLog.meteors, tints)
  stat('잡은 큰 혜성', playLog.comets)
  stat('던진 혜성', playLog.thrown)
  stat('별이 삼킨 혜성', playLog.swallowed)
  stat('은하 중심으로', playLog.core)
  stat('행성 명중', playLog.splashes)
  stat('블랙홀로 정리', playLog.cleaned)
  stat('본 오로라', playLog.auroras)
  stat('본 초신성', playLog.novas)
  stat('본 별의 탄생', playLog.births)

  const badges = el('ul', { className: 'lg-badges' })
  for (const b of BADGES) {
    const earned = playLog.badges.includes(b.id)
    const li = el('li', { className: earned ? 'earned' : '', title: b.hint })
    li.append(el('i', { textContent: earned ? b.icon : '·' }), el('b', { textContent: earned ? b.name : '???' }), el('small', { textContent: b.hint }))
    badges.append(li)
  }
  const how = el('p', { className: 'lg-how' })
  how.innerHTML = '지나가는 별똥별은 <b>눌러서</b> 잡아요. 빈 곳을 <kbd class="key">Alt</kbd>+끌기(또는 꾹 눌렀다 끌기)로 당겼다 놓으면 혜성이 날아가요. 별 옆을 지나면 휘어요. 행성을 같은 식으로 끌어 아래 블랙홀에 넣으면 그 터미널을 닫을지 물어봐요.'
  logEl.replaceChildren(head, dustSection(), stats, badges, how)
}

// A planet dropped into the black hole: say what closing it means and ask first.
function askClean(handle) {
  const test = testItems.get(handle)
  const session = sessions.get(handle) || (test && { title: test.planet, project: test.app })
  if (!session) return galaxy?.cancelClean()
  const status = test ? test.status : statusOf(handle)
  cleanAsk = { handle }
  const title = el('b', { id: 'cf-title', textContent: '🕳 블랙홀로 보낼까요?' })
  const name = el('p', { className: 'cf-name', textContent: `${session.title || session.name} · ${session.project}` })
  const what = el('p', { textContent: '이 터미널을 닫아요. 안에서 돌던 프로그램도 같이 끝나고, 되돌릴 수 없어요.' })
  const parts = [title, name, what]
  if (status === 'working' || STATUS[status].group === 'attention') {
    parts.push(el('p', { className: 'cf-warn', textContent: `⚠ 지금 ${STATUS[status].label} 상태예요. 하던 일이 그대로 사라져요.` }))
  }
  const actions = el('div', { className: 'cf-actions' })
  const no = el('button', { type: 'button', className: 'cf-no', textContent: '그만두기' })
  const yes = el('button', { type: 'button', className: 'cf-yes', textContent: '블랙홀로 보내기' })
  no.addEventListener('click', cancelClean)
  yes.addEventListener('click', confirmClean)
  actions.append(no, yes)
  confirmEl.replaceChildren(...parts, actions)
  confirmEl.dataset.status = status
  const spot = galaxy.holeSpot()
  confirmEl.style.left = `${spot.x}px`
  confirmEl.style.top = `${Math.max(240, spot.y - spot.radius - 14)}px`
  confirmEl.hidden = false
  // The safe choice has the focus.
  no.focus()
}

function closeCleanAsk() {
  cleanAsk = null
  confirmEl.hidden = true
  confirmEl.replaceChildren()
}

function cancelClean() {
  closeCleanAsk()
  galaxy?.cancelClean()
}

async function confirmClean() {
  const { handle } = cleanAsk
  closeCleanAsk()
  if (testItems.delete(handle)) {
    saveTestItems()
    return galaxy?.swallow(handle)
  }
  const result = await api('/api/close', { handle, confirmed: true })
  if (!result.ok) {
    galaxy?.cancelClean()
    return toast(result.error?.message || '터미널을 닫지 못했어요')
  }
  galaxy?.swallow(handle)
}

// ---------- a new star (a new project) or a new planet (another session in one) ----------

// `target` is the star a new planet joins: { app, path }. Without one, a new star.
function toggleBirth(on = birthEl.hidden, target = null) {
  if (on && prefs.view !== 'galaxy') return toast('새 별은 은하 보기에서 만들어요')
  birthEl.hidden = !on
  birth.target = on ? target : null
  birthButton.setAttribute('aria-expanded', String(on && !target))
  clearTimeout(birth.timer)
  birth.check++
  if (!on) return birthEl.replaceChildren()
  toggleLog(false)
  toggleGuide(false)
  renderBirth()
}

// A new planet for the star in the report, in the folder of the planet being looked at.
function openPlanetForm(app) {
  const own = [...sessions.values()].filter((s) => s.project === app)
  const looking = sessions.get(report?.handle)
  const path = (looking?.project === app ? looking : own[0])?.path
  if (path) toggleBirth(true, { app, path })
}

function renderBirth() {
  const target = birth.target
  const head = el('header', { className: 'lg-head' })
  const close = el('button', { type: 'button', className: 'rp-close', title: '닫기 (Esc)', textContent: '×' })
  close.addEventListener('click', () => toggleBirth(false))
  head.append(el('b', { textContent: target ? `🪐 ${target.app}에 새 행성` : '✨ 새 별 만들기' }), close)
  const about = el('p', {
    className: 'nb-about',
    textContent: target ? '이 프로젝트에서 에이전트를 하나 더 띄워요. 터미널이 열리면 행성이 생겨요.' : '새 프로젝트 폴더를 만들거나 깃 저장소를 가져와 Orca에 넣고, 그 안에서 에이전트를 시작해요. 그동안 별이 모이고, 터미널이 열리면 빛나요.'
  })
  const parts = [head, about]
  if (target) {
    parts.push(planetWhere(target))
  } else {
    const name = el('input', { name: 'name', className: 'nb-name', placeholder: '프로젝트 이름', maxLength: 60, required: true, spellcheck: false })
    name.setAttribute('aria-label', '프로젝트 이름')
    const url = el('input', { name: 'url', className: 'nb-url', placeholder: '깃 주소에서 가져오기 (선택) · https://github.com/…', maxLength: 500, spellcheck: false, autocomplete: 'off' })
    url.setAttribute('aria-label', '가져올 깃 주소')
    parts.push(name, url, el('p', { className: 'nb-where', textContent: '이름을 적으면 어디에 만들지 알려드려요.' }))
    birth.autoName = ''
  }
  const agents = el('fieldset', { className: 'nb-agents' })
  agents.append(el('legend', { textContent: '띄울 것' }))
  const agent = BIRTH_AGENTS.some(([id]) => id === prefs.newAgent) ? prefs.newAgent : 'claude'
  for (const [id, label] of BIRTH_AGENTS) {
    const option = el('label', { className: 'nb-agent' })
    option.append(el('input', { type: 'radio', name: 'agent', value: id, checked: id === agent }), el('span', { textContent: label }))
    agents.append(option)
  }
  const prompt = el('textarea', { name: 'prompt', className: 'nb-prompt', rows: 3, maxLength: 4000, disabled: agent === 'shell', placeholder: target ? '할 일 (비워 둬도 돼요)\n예: 테스트를 고쳐줘' : '처음 할 일 (비워 둬도 돼요)\n예: 할일 앱을 만들어줘' })
  prompt.setAttribute('aria-label', '할 일')
  const actions = el('div', { className: 'cf-actions' })
  const no = el('button', { type: 'button', className: 'cf-no', textContent: '그만두기' })
  const go = el('button', { type: 'submit', className: 'cf-yes nb-go', textContent: goLabel(), disabled: !target })
  no.addEventListener('click', () => toggleBirth(false))
  actions.append(no, go)
  birthEl.replaceChildren(...parts, agents, prompt, actions)
  ;(target ? (prompt.disabled ? go : prompt) : birthEl.querySelector('.nb-name')).focus()
}

// Where the new planet starts: the folder, or a choice when the star has several.
function planetWhere(target) {
  const folders = new Map()
  for (const s of sessions.values()) if (s.project === target.app && !folders.has(s.path)) folders.set(s.path, s.branch)
  if (folders.size < 2) return el('p', { className: 'nb-where', textContent: `띄울 곳 · ${shortPath(target.path)}` })
  const label = el('label', { className: 'nb-where nb-folder' })
  const select = el('select', { name: 'folder' })
  for (const [path, branch] of folders) select.append(el('option', { value: path, textContent: `${branch || '작업 폴더'} · ${shortPath(path)}`, selected: path === target.path }))
  label.append(el('span', { textContent: '띄울 곳' }), select)
  return label
}

function goLabel() {
  if (birth.target) return '🪐 행성 만들기'
  return birthEl.querySelector('.nb-url')?.value.trim() ? '☄️ 가져와서 별 만들기' : '✨ 별 만들기'
}

// The same address rule the server keeps (it has the last word), and the folder name git
// would give the clone.
function birthUrl(value) {
  const url = value.trim()
  const ok = /^(?:https?|ssh|git):\/\/[^/@\s]+(?:@[^/\s]+)?\/\S+$/.test(url) || /^[\w.-]+@[\w.-]+:[\w./~-]+$/.test(url) || /^[\w.-]+\.[a-z]{2,}\/[^:\s]+$/i.test(url)
  return { url, bad: Boolean(url) && (!ok || url.startsWith('-')), name: (url.replace(/[/\\]+$/, '').split(/[/:]/).pop() || '').replace(/\.git$/i, '') }
}

// The same rule the server keeps, so the form can say so before asking.
function birthName(value) {
  const name = value.normalize('NFC').trim().replace(/\s+/g, ' ')
  return { name, bad: name.length > 60 || name.startsWith('.') || /[/\\:*?"<>|\u0000-\u001f]/.test(name) }
}

function showWhere(text, warn = false) {
  const where = birthEl.querySelector('.nb-where')
  if (!where) return
  where.textContent = text
  where.classList.toggle('warn', warn)
}

function onBirthInput(e) {
  if (e.target.name === 'agent') {
    prefs.newAgent = e.target.value
    savePrefs()
    birthEl.querySelector('.nb-prompt').disabled = e.target.value === 'shell'
    return
  }
  if (e.target.name === 'folder') return void (birth.target.path = e.target.value)
  const nameInput = birthEl.querySelector('.nb-name')
  if (e.target.name === 'url') {
    // The name follows the address until the user writes one of their own.
    const { name } = birthUrl(e.target.value)
    if (!nameInput.value || nameInput.value === birth.autoName) nameInput.value = birth.autoName = name
  } else if (e.target.name !== 'name') return
  checkBirth(nameInput.value, birthEl.querySelector('.nb-url').value)
}

// Says where the project would go, or what's wrong, and only then lets it be made.
function checkBirth(nameValue, urlValue) {
  clearTimeout(birth.timer)
  const ask = ++birth.check
  const go = birthEl.querySelector('.nb-go')
  go.disabled = true
  go.textContent = goLabel()
  const url = birthUrl(urlValue)
  const { name, bad } = birthName(nameValue)
  if (url.bad) return showWhere('깃 주소는 https://… 또는 git@…:… 꼴이어야 해요.', true)
  if (!name) return showWhere(url.url ? '가져올 폴더 이름을 적어 주세요.' : '이름을 적으면 어디에 만들지 알려드려요.')
  if (bad) return showWhere('이름에는 / \\ : * ? " < > | 를 쓸 수 없고, 점으로 시작할 수 없어요. 60자까지예요.', true)
  birth.timer = setTimeout(async () => {
    const res = await api('/api/project', { name, check: true })
    if (ask !== birth.check || birthEl.hidden) return
    if (!res.ok) return showWhere(res.error?.message || '어디에 만들지 확인하지 못했어요.', true)
    if (res.result.taken) return showWhere(`이미 있는 폴더예요 · ${shortPath(res.result.path)}`, true)
    showWhere(`${url.url ? '가져올 곳' : '만들 곳'} · ${shortPath(res.result.path)}`)
    go.disabled = birth.busy
  }, 250)
}

async function onBirthSubmit(e) {
  e.preventDefault()
  const go = birthEl.querySelector('.nb-go')
  const target = birth.target
  if (birth.busy || !go || go.disabled) return
  const { name, bad } = target ? { name: target.app } : birthName(birthEl.querySelector('.nb-name').value)
  if (!name || bad) return
  const url = target ? '' : birthUrl(birthEl.querySelector('.nb-url').value).url
  const agent = birthEl.querySelector('input[name="agent"]:checked')?.value || 'claude'
  const prompt = agent === 'shell' ? '' : birthEl.querySelector('.nb-prompt').value.trim()
  // Terminals already in that folder, so the camera can tell the new one.
  const known = new Set(target ? [...sessions.keys()].filter((h) => sessions.get(h).path === target.path) : [])
  birth.busy = true
  go.disabled = true
  go.textContent = target ? '띄우는 중…' : url ? '가져오는 중…' : '만드는 중…'
  const res = target ? await api('/api/session', { path: target.path, agent, prompt }) : await api('/api/project', { name, agent, prompt, ...(url && { url }) })
  birth.busy = false
  if (!res.ok) {
    const message = res.error?.message || (target ? '새 행성을 만들지 못했어요' : '새 별을 만들지 못했어요')
    if (birthEl.hidden || birth.target !== target) return toast(message, 4000)
    go.disabled = false
    go.textContent = goLabel()
    return showWhere(message, true)
  }
  if (birth.target === target) toggleBirth(false)
  if (target) {
    birth.wait = { path: res.result.path, known, until: Date.now() + BIRTH_WAIT_MS }
    if (!res.result.started) toast(res.result.warning, 6000)
    else toast(`🪐 ${name} · 행성이 생기고 있어요`, 3500)
    return
  }
  // A new star: the work goes on in the background while its cloud gathers. The camera
  // goes to watch, and waits there until the terminal opens.
  birth.wait = { path: res.result.path, known, until: Infinity }
  galaxy?.forming(name, { label: BIRTH_STEPS.start, go: true })
  toast(url ? `☄️ ${name} · 저장소를 가져오는 동안 별이 모여요` : `✨ ${name} · 별이 모이고 있어요`, 3500)
}

// News of a project being made, from this window or another.
function onBirthNews(job) {
  if (!job.done) {
    forming.set(job.path, job)
    return showForming(job)
  }
  const mine = birth.wait?.path === job.path
  if (job.warning) toast(job.warning, 6000)
  if (job.error || !job.started) {
    // Failed, or made without a terminal: nothing to light the star.
    forming.delete(job.path)
    galaxy?.unform(job.name, { failed: true })
    if (mine) birth.wait = null
    if (job.error) toast(`${job.name} · ${job.error}`, 7000)
    return
  }
  // Kept until the terminal shows up (onState clears it), within moments; if it never
  // does, the cloud clears anyway.
  forming.set(job.path, job)
  if (mine) birth.wait.until = Date.now() + BIRTH_WAIT_MS
  galaxy?.forming(job.name, { progress: 1, label: BIRTH_STEPS.done })
  setTimeout(() => {
    if (forming.get(job.path) !== job) return
    forming.delete(job.path)
    galaxy?.unform(job.name)
  }, BIRTH_WAIT_MS)
}

function showForming(job) {
  if (!galaxy) return
  if (job.done) return galaxy.forming(job.name, { progress: 1, label: BIRTH_STEPS.done })
  const percent = job.step === 'clone' && job.progress > 0.05 ? ` ${Math.round(((job.progress - 0.04) / 0.82) * 100)}%` : ''
  galaxy.forming(job.name, { progress: job.progress, label: `${BIRTH_STEPS[job.step] || ''}${percent}` })
}

// The terminal just started from here: the camera goes to meet its star or planet.
function greetNewStar(list) {
  const wait = birth.wait
  if (Date.now() > wait.until) return (birth.wait = null)
  const session = list.find((s) => s.path === wait.path && !wait.known.has(s.handle))
  if (!session) return
  birth.wait = null
  setTimeout(() => sessions.has(session.handle) && pick(session.handle), 600)
}

function shortPath(p) {
  return p.replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, '~')
}

// ---------- galaxy ----------

function ensureGalaxy() {
  if (galaxy || galaxyLoad) return galaxyLoad
  galaxyLoad = import('./galaxy.js')
    .then(({ createGalaxy }) => {
      galaxy = createGalaxy(cosmos, {
        onPick: pick,
        onPickSystem: (app) => {
          if ([...testItems.values()].some((i) => i.app === app)) testFocus = app
          openReport(app, null)
        },
        onWarp: (seconds, star) => sound.warp(seconds, star),
        // The star the camera is with gives the music its colour.
        onWatch: (star) => sound.setMood({ star }),
        onSound: (kind) => sound.chime(kind),
        onPlay,
        onClean: askClean,
        onRemnant: addRemnant,
        spots,
        onSpot: saveSpot,
        onGlide: (seconds, pan) => sound.glide(seconds, pan),
        onMilestone,
        onOverview: () => {
          setPaneOpen(false)
          closeReport()
        }
      })
      new ResizeObserver(layoutGalaxy).observe(gxHud)
      layoutGalaxy()
      galaxy.setLook(lookOf(prefs.look))
      galaxy.setDecor(decorFlags())
      galaxy.setRemnants(remnants)
      galaxy.setActive(prefs.view === 'galaxy' && !maximized)
      renderAll()
      for (const job of forming.values()) showForming(job)
      // Only a session the user chose; the opening view is the whole galaxy.
      if (focusedHandle && prefs.view === 'galaxy' && userPicked) galaxy.flyTo(focusedHandle)
      checkUnlocks()
    })
    .catch((error) => {
      console.error(error)
      galaxyLoad = null
      toast('이 브라우저에서는 은하 보기를 열 수 없어요')
      if (prefs.view === 'galaxy') setView('focus')
    })
  return galaxyLoad
}

// The galaxy centres itself in the free area beside the session pane (all of it when the pane is shut).
function layoutGalaxy({ animate = false } = {}) {
  if (!galaxy || !gxHud.offsetWidth) return
  const hud = gxHud.getBoundingClientRect()
  const area = { left: hud.left, top: hud.top, width: hud.width, height: hud.height }
  if (paneOpen) {
    const box = layoutEl.getBoundingClientRect()
    // Side panel on wide screens, bottom sheet on narrow ones.
    if (paneEl.offsetLeft > 0) area.width = Math.max(160, box.left + paneEl.offsetLeft - hud.left)
    else area.height = Math.max(120, box.top + paneEl.offsetTop - hud.top)
  }
  galaxy.setArea(area, { animate })
}

function setPaneOpen(open) {
  if (paneOpen === open) return
  paneOpen = open
  if (open) closeReport()
  document.body.classList.toggle('pane-closed', !open)
  paneToggle.setAttribute('aria-expanded', String(open))
  paneToggle.title = open ? '세션 패널 닫기 (Esc)' : '세션 패널 열기'
  if (open) setZen(false)
  layoutGalaxy({ animate: true })
}

function setZen(on) {
  if (zen === on || (on && prefs.view !== 'galaxy')) return
  zen = on
  zenMoved = 0
  document.body.classList.toggle('zen', on)
  if (!on) return
  // The camera stays where it was: quiet mode only clears the screen around it.
  setPaneOpen(false)
  closeReport()
}

// Nothing to answer, nobody touching anything, the pane shut: let the galaxy have the screen.
function checkZen() {
  if (zen || prefs.view !== 'galaxy' || paneOpen || report || document.hidden || searching()) return
  if (Date.now() - lastInteraction < ZEN_IDLE_MS || attentionHandles().length) return
  setZen(true)
}

function renderGalaxy(all) {
  const moons = moonHosts(all)
  const items = all.map(({ handle, session, status, show }) => ({
    handle,
    app: session.project,
    path: session.path,
    pr: session.pr,
    servers: servers[session.path] || [],
    disk: disk[session.path],
    moons: moons.get(handle) || 0,
    planet: session.title || session.name,
    branch: session.name,
    status,
    statusLabel: STATUS[status].label,
    summary: rowSummary(handle, session, status),
    background: session.background,
    pinned: isPinned(handle),
    // Printed something in the last 15 seconds: its star sparkles.
    active: Date.now() - (session.lastOutputAt || 0) < 15_000,
    show
  }))
  items.push(...testItems.values())
  displayOrder = galaxy ? galaxy.update(items, { focused: focusedHandle, gone: vanished, born, stats: appStats(all), searching: searching() }) : items.filter((i) => i.show).map((i) => i.handle)
  galaxy?.setSearchTarget(nextMatch())
  vanished.clear()
  born.clear()
  // Closed some other way while we were asking: the galaxy lets it fall in by itself.
  if (cleanAsk && !sessions.has(cleanAsk.handle)) closeCleanAsk()
  if (report) renderReport()
  renderSignals()
}

// ---------- star report ----------

function openReport(app, handle) {
  if (prefs.view !== 'galaxy') return
  report = { app, handle }
  reportEl.dataset.key = ''
  renderReport()
}

function closeReport() {
  if (!report) return
  report = null
  reportEl.hidden = true
  reportEl.replaceChildren()
}

// Waiting first, then work in progress, then results; shells only as a count.
function renderReport() {
  const handles = [...sessions.keys()].filter((h) => sessions.get(h).project === report.app)
  if (!handles.length) return closeReport()
  const order = handles.sort((a, b) => STATUS[statusOf(a)].rank - STATUS[statusOf(b)].rank || (sessions.get(a).title || '').localeCompare(sessions.get(b).title || '', 'ko'))
  const rows = order.filter((h) => STATUS[statusOf(h)].group !== 'shell')
  const shells = order.length - rows.length
  const minute = Math.floor(Date.now() / 60000)
  const key = JSON.stringify([report, minute, shells, rows.map((h) => [h, statusOf(h), rowSummary(h, sessions.get(h), statusOf(h)), menus.get(h)?.signature, !!menus.get(h) && isChoicePending(h, menus.get(h)), menuPick?.handle === h && menuPick.n, sessions.get(h).title, servers[sessions.get(h).path], disk[sessions.get(h).path]])])
  if (key === reportEl.dataset.key) return
  reportEl.dataset.key = key
  const typing = document.activeElement?.closest?.('.rp-quick')?.dataset.handle

  const counts = {}
  for (const h of handles) counts[STATUS[statusOf(h)].group] = (counts[STATUS[statusOf(h)].group] || 0) + 1
  const head = el('header', { className: 'rp-head' })
  const title = el('div', { className: 'rp-title' })
  title.append(el('b', { textContent: report.app }), el('span', { textContent: reportCounts(counts) }))
  const planet = el('button', { type: 'button', className: 'rp-new', title: '이 프로젝트에 에이전트를 하나 더 띄워요', textContent: '🪐 새 행성' })
  planet.addEventListener('click', () => openPlanetForm(report.app))
  const close = el('button', { type: 'button', className: 'rp-close', title: '닫기 (Esc)', textContent: '×' })
  close.addEventListener('click', closeReport)
  head.append(title, planet, close)

  const list = el('div', { className: 'rp-list' })
  const serversShown = new Set()
  for (const handle of rows) {
    const path = sessions.get(handle).path
    list.append(reportRow(handle, serversShown.has(path) ? [] : servers[path] || []))
    serversShown.add(path)
  }
  if (!rows.length) list.append(el('p', { className: 'rp-empty', textContent: '에이전트가 없는 셸만 열려 있어요' }))
  if (shells && rows.length) list.append(el('p', { className: 'rp-shells', textContent: `셸 ${shells}개는 따로 할 일이 없어요` }))
  reportEl.replaceChildren(head, list)
  reportEl.hidden = false
  const input = typing && reportEl.querySelector(`.rp-quick[data-handle="${typing}"] input`)
  if (input) {
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }
}

function reportCounts(counts) {
  const parts = [['attention', '확인 필요'], ['working', '작업 중'], ['done', '완료']].filter(([g]) => counts[g]).map(([g, label]) => `${label} ${counts[g]}`)
  return parts.join(' · ') || '할 일 없음'
}

function reportRow(handle, running = []) {
  const session = sessions.get(handle)
  const status = statusOf(handle)
  const menu = menus.get(handle)
  const row = el('article', { className: 'rp-row', dataset: { status, handle } })
  if (handle === report.handle) row.classList.add('focused')
  const head = el('div', { className: 'rp-row-head' })
  head.append(el('i', { className: 'dot' }), el('b', { textContent: session.title || session.name || '터미널' }), el('span', { className: 'rp-state', textContent: reportState(session, status) }))
  const open = el('button', { type: 'button', className: 'rp-open', title: '터미널 화면 전체 보기', textContent: '자세히 ›' })
  open.addEventListener('click', (e) => {
    e.stopPropagation()
    drillIn(handle)
  })
  head.append(open)
  row.append(head)
  const summary = menu ? attentionSummary(session, menu, status) : rowSummary(handle, session, status)
  if (summary && summary !== STATUS[status].label) row.append(el('p', { className: 'rp-sum', textContent: summary }))
  if (running.length) row.append(serverChips(running))
  const idleFor = Date.now() - (session.agent?.updatedAt || session.lastOutputAt || Date.now())
  const bytes = disk[session.path]
  if (bytes > 1e9 && idleFor > 3 * 86_400_000 && !['attention', 'working'].includes(STATUS[status].section)) {
    row.append(el('p', { className: 'rp-clean', textContent: `🧹 정리 후보 · 디스크 ${(bytes / 1e9).toFixed(1)}GB · ${ago(session.agent?.updatedAt || session.lastOutputAt)} 마지막 작업` }))
  }
  if (menu) row.append(menuButtons(handle, menu, { compact: true }))
  else if (session.writable) row.append(quickReply(handle, STATUS[status].section === 'attention'))
  // A click points the camera at that planet; going all the way in is the button's job.
  row.addEventListener('click', (e) => {
    if (e.target.closest('button, input, form')) return
    report.handle = handle
    galaxy?.flyTo(handle)
    for (const r of reportEl.querySelectorAll('.rp-row')) r.classList.toggle('focused', r.dataset.handle === handle)
  })
  row.addEventListener('dblclick', (e) => !e.target.closest('button, input, form') && drillIn(handle))
  return row
}

// Servers running in this worktree, each port a link to open it.
function serverChips(running) {
  const wrap = el('div', { className: 'rp-srv' })
  for (const server of running) {
    const chip = el('span', { className: 'rp-srv-chip', title: `${server.name} (pid ${server.pid})` })
    chip.append(el('i', { textContent: '📡' }), el('b', { textContent: server.name }))
    for (const port of server.ports.slice(0, 3)) chip.append(el('a', { href: `http://localhost:${port}/`, target: '_blank', rel: 'noopener', textContent: `:${port}` }))
    wrap.append(chip)
  }
  return wrap
}

function reportState(session, status) {
  const label = STATUS[status].label
  if (status === 'working' && session.agent?.stateStartedAt) return `${label} · ${ago(session.agent.stateStartedAt).replace(' 전', '째')}`
  const at = session.agent?.updatedAt || session.lastOutputAt
  return at && STATUS[status].section !== 'attention' ? `${label} · ${ago(at)}` : label
}

// One line to the agent: an answer when it's waiting, otherwise the next instruction.
function quickReply(handle, answering) {
  const form = el('form', { className: 'rp-quick', dataset: { handle } })
  const input = el('input', { type: 'text', placeholder: answering ? '답하기 · Enter' : '명령 보내기 · Enter', value: quickDrafts.get(handle) || '' })
  input.addEventListener('input', () => quickDrafts.set(handle, input.value))
  const send = el('button', { type: 'submit', textContent: '보내기' })
  form.append(input, send)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = input.value
    if (!text.trim()) return
    send.disabled = true
    const res = await api('/api/send', { handle, text })
    send.disabled = false
    if (!res.ok) return toast(res.error?.message || '보내지 못했어요')
    quickDrafts.delete(handle)
    input.value = ''
    lastActionAt.set(handle, Date.now())
    galaxy?.comet(handle)
    toast('보냈어요')
  })
  return form
}

// Going deeper: the full terminal in the side pane.
function drillIn(handle) {
  setFocus(handle)
  setPaneOpen(true)
}

// Each app's star is sized and coloured by the agent work in all of its worktrees.
function appStats(all) {
  const stats = new Map()
  const counted = new Set()
  for (const { session } of all) {
    const u = usage[session.path]
    if (!u || counted.has(session.path)) continue
    counted.add(session.path)
    const s = stats.get(session.project) || { tokens: 0, activeMs: 0, firstAt: 0 }
    s.tokens += u.tokens || 0
    s.activeMs += u.activeMs || 0
    if (u.firstAt && (!s.firstAt || u.firstAt < s.firstAt)) s.firstAt = u.firstAt
    stats.set(session.project, s)
  }
  return stats
}

// Running subagents become moons of their worktree's agent terminal: the working one,
// or else whichever printed last.
function moonHosts(all) {
  const byPath = new Map()
  for (const entry of all) {
    if (!entry.session.agentType || !usage[entry.session.path]?.subagents) continue
    if (!byPath.has(entry.session.path)) byPath.set(entry.session.path, [])
    byPath.get(entry.session.path).push(entry)
  }
  const hosts = new Map()
  for (const [path, list] of byPath) {
    const host = list.find((e) => e.status === 'working') || [...list].sort((a, b) => (b.session.lastOutputAt || 0) - (a.session.lastOutputAt || 0))[0]
    hosts.set(host.handle, usage[path].subagents)
  }
  return hosts
}

// Sessions waiting on the user, floating over the galaxy.
function renderSignals() {
  const waiting = attentionHandles()
  const head = el('div', { className: 'gx-signals-head', textContent: waiting.length ? `신호 ${waiting.length}` : '조용해요 · 확인할 세션이 없어요' })
  const rows = waiting.slice(0, 6).map((handle) => {
    const session = sessions.get(handle)
    const status = statusOf(handle)
    const row = el('button', { type: 'button', className: 'gx-signal', dataset: { status } })
    if (handle === focusedHandle) row.classList.add('selected')
    const text = el('span', { className: 'gx-signal-text' })
    text.append(
      el('b', { textContent: `${isPinned(handle) ? '★ ' : ''}${session.project}` }),
      el('span', { textContent: session.title || session.name }),
      el('em', { textContent: rowSummary(handle, session, status) })
    )
    row.append(el('span', { className: 'dot' }), text)
    row.addEventListener('click', () => pick(handle))
    return row
  })
  gxSignals.replaceChildren(head, ...rows)
}

function warp(node) {
  node.classList.remove('warp')
  void node.offsetWidth
  node.classList.add('warp')
}

// ---------- sound ----------

function setSound(on) {
  prefs.sound = on
  savePrefs()
  paintSound()
  sound.setEnabled(on && speakerHere)
  syncAmbient()
}

function paintSound() {
  const elsewhere = prefs.sound && !speakerHere
  soundButton.innerHTML = icon(prefs.sound && !elsewhere ? 'sound' : 'mute')
  soundButton.ariaPressed = String(prefs.sound)
  soundButton.classList.toggle('elsewhere', elsewhere)
  soundButton.title = elsewhere ? '다른 창에서 소리가 나고 있어요 · 이 창을 누르면 여기서 나요' : prefs.sound ? '소리 끄기 (M)' : '소리 켜기 (M)'
}

function pageId() {
  try {
    const saved = sessionStorage.getItem('orrery-page')
    if (saved) return saved
    const id = crypto.randomUUID()
    sessionStorage.setItem('orrery-page', id)
    return id
  } catch {
    return crypto.randomUUID()
  }
}

function setSpeaker(id) {
  const here = !id || id === PAGE_ID
  if (here === speakerHere) return
  speakerHere = here
  paintSound()
  sound.setEnabled(prefs.sound && speakerHere)
}

// A click or key press brings the sound to this page (checked in again now and then, so
// the server knows which page was touched last).
function touchSpeaker() {
  const now = Date.now()
  if (speakerHere && now - touchedAt < 10_000) return
  touchedAt = now
  api('/api/speaker', { page: PAGE_ID, touched: true, visible: document.visibilityState === 'visible' })
}

// The drone plays while the galaxy is on screen; event bells ring in every view, even hidden.
function syncAmbient() {
  sound.setAmbient(prefs.view === 'galaxy' && document.visibilityState === 'visible')
}

// ---------- search palette ----------

function setupPalette() {
  paletteInput.addEventListener('input', () => {
    palette.index = 0
    renderPalette()
  })
  paletteInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      movePalette(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choosePalette(palette.items[palette.index])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closePalette()
    }
  })
  paletteEl.addEventListener('pointerdown', (e) => {
    if (e.target === paletteEl) closePalette()
  })
}

function openPalette() {
  if (!paletteEl.hidden && !paletteEl.classList.contains('closing')) return paletteInput.focus()
  clearTimeout(palette.closeTimer)
  paletteEl.classList.remove('closing')
  paletteEl.hidden = false
  paletteInput.value = ''
  palette.index = 0
  paletteResults.classList.add('intro')
  renderPalette()
  // Next frame, so the drop-in transition starts from the closed state.
  requestAnimationFrame(() => requestAnimationFrame(() => paletteEl.classList.add('open')))
  paletteInput.focus()
  sound.chime('open')
  setTimeout(() => paletteResults.classList.remove('intro'), 900)
}

function closePalette() {
  if (paletteEl.hidden) return
  paletteEl.classList.remove('open')
  paletteEl.classList.add('closing')
  paletteInput.blur()
  palette.closeTimer = setTimeout(() => {
    paletteEl.hidden = true
    paletteEl.classList.remove('closing')
  }, 220)
}

function choosePalette(handle) {
  if (!handle) return
  closePalette()
  go(handle)
}

function movePalette(step) {
  if (palette.items.length === 0) return
  palette.index = (palette.index + step + palette.items.length) % palette.items.length
  for (const [i, row] of [...paletteResults.children].entries()) row.classList.toggle('active', i === palette.index)
  paletteResults.children[palette.index]?.scrollIntoView({ block: 'nearest' })
}

// Every word must match somewhere; names count more than screen text.
function searchSessions(query) {
  const words = searchWords(query)
  const results = []
  for (const [handle, session] of sessions) {
    const status = statusOf(handle)
    if (status === 'shell' && !prefs.showShells) continue
    const summary = rowSummary(handle, session, status)
    const fields = [
      [session.project, 6],
      [session.title || '', 6],
      [session.name, 3],
      [summary, 2],
      [(screens.get(handle) || []).slice(-60).join('\n'), 1]
    ]
    let score = 0
    let snippet = summary
    for (const word of words) {
      let best = 0
      for (const [text, weight] of fields) {
        const at = text.toLowerCase().indexOf(word)
        if (at === -1 && !foundIn(text, word, { initials: weight >= 3 })) continue
        const value = weight * (at === 0 ? 1.5 : 1)
        if (value > best) best = value
        if (weight === 1 && best === value && at >= 0) snippet = lineAround(text, at)
      }
      if (!best) {
        score = 0
        break
      }
      score += best
    }
    if (words.length === 0) score = 1
    if (score) results.push({ handle, session, status, summary: snippet, score })
  }
  const recent = (r) => r.session.lastOutputAt || 0
  results.sort(
    (a, b) =>
      b.score - a.score ||
      Number(isPinned(b.handle)) - Number(isPinned(a.handle)) ||
      STATUS[a.status].rank - STATUS[b.status].rank ||
      recent(b) - recent(a)
  )
  return results.slice(0, 40)
}

function lineAround(text, at) {
  const start = text.lastIndexOf('\n', at) + 1
  const end = text.indexOf('\n', at)
  return text.slice(start, end === -1 ? undefined : end).trim()
}

function renderPalette() {
  const query = paletteInput.value.trim()
  const results = searchSessions(query)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  palette.items = results.map((r) => r.handle)
  palette.index = Math.min(palette.index, Math.max(0, results.length - 1))
  if (results.length === 0) {
    paletteResults.replaceChildren(el('div', { className: 'palette-empty', textContent: '찾는 세션이 없어요' }))
    return
  }
  paletteResults.replaceChildren(
    ...results.map(({ handle, session, status, summary }, i) => {
      const row = el('button', { type: 'button', className: 'palette-item', dataset: { status } })
      row.style.setProperty('--i', Math.min(i, 12))
      if (i === palette.index) row.classList.add('active')
      const title = el('span', { className: 'pi-title' })
      title.innerHTML = highlight(session.title || session.name, words)
      const app = el('span', { className: 'pi-app' })
      app.innerHTML = `${isPinned(handle) ? '★ ' : ''}${highlight(session.project, words)}`
      const badge = el('span', { className: 'pi-badge', textContent: STATUS[status].label })
      const snippet = el('span', { className: 'pi-snippet' })
      snippet.innerHTML = highlight(summary || '', words)
      const head = el('span', { className: 'pi-head' })
      head.append(title, app)
      row.append(el('span', { className: 'dot' }), head, badge, snippet)
      row.addEventListener('pointermove', () => {
        if (palette.index !== i) {
          palette.index = i
          movePalette(0)
        }
      })
      row.addEventListener('click', () => choosePalette(handle))
      return row
    })
  )
}

function highlight(text, words) {
  let html = escapeHtml(text)
  for (const word of words) {
    const safe = escapeHtml(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (safe) html = html.replace(new RegExp(`(${safe})(?![^<]*>)`, 'gi'), '<mark>$1</mark>')
  }
  return html
}

// ---------- search ----------

// Enter in the search box goes to what it found, best match first; Enter again moves
// on to the next (Shift+Enter goes back), so a handful of matches can be walked through.

function searchQuery() {
  return search.value.trim().toLowerCase()
}

// Words in the search box, or a status filter: either lights planets up for Enter.
function searching() {
  return Boolean(searchQuery()) || prefs.filter !== 'all'
}

// Every word has to turn up somewhere, in any order. Spaces don't count, so '포탈모드'
// finds '포탈 모드'. In names, Korean initials count too, so 'ㅁㄹ' finds '메모리'; on
// screen they would match nearly everything.
function searchWords(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

function foundIn(text, word, { initials = false } = {}) {
  if (!text) return false
  const folded = text.toLowerCase().replace(/\s+/g, '')
  if (folded.includes(word)) return true
  return initials && /^[ㄱ-ㅎ]+$/.test(word) && folded.replace(/[가-힣]/g, (c) => INITIALS[Math.floor((c.charCodeAt(0) - 0xac00) / 588)]).includes(word)
}

// Where a session's words live, the ones that name it first.
function searchFields(session, handle) {
  return [
    [session.title, session.name],
    [session.project],
    [session.branch, session.comment, session.agent?.prompt, session.agent?.lastAssistantMessage, (screens.get(handle) || []).join('\n')]
  ]
}

// How well a session answers the query: 0 by its own title or name, 1 by its app, 2 by
// anything else it holds, -1 not at all.
function searchRank(session, handle, words = searchWords(searchQuery())) {
  const fields = searchFields(session, handle)
  let rank = 0
  for (const word of words) {
    const at = fields.findIndex((group, i) => group.some((text) => foundIn(text, word, { initials: i < 2 })))
    if (at < 0) return -1
    rank = Math.max(rank, at)
  }
  return rank
}

// Found in the planet's own name first, then in its app's, then anywhere on screen. With
// only a status filter on, every planet it lets through, in order.
function searchHits() {
  const words = searchWords(searchQuery())
  if (!words.length) return prefs.filter === 'all' ? [] : displayOrder.filter((handle) => sessions.has(handle))
  const rank = (handle) => searchRank(sessions.get(handle), handle, words)
  return displayOrder
    .filter((handle) => sessions.has(handle))
    .map((handle, i) => ({ handle, i, rank: rank(handle) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((hit) => hit.handle)
}

function nextMatch(step = 1, hits = searchHits()) {
  if (!hits.length) return null
  const at = hits.indexOf(searchAt)
  if (at < 0) return hits[step > 0 ? 0 : hits.length - 1]
  return hits[(at + step + hits.length) % hits.length]
}

function jumpToMatch(step) {
  // An Enter that finished a syllable can arrive twice; one jump is enough.
  if (Date.now() - jumpedAt < 150) return
  const hits = searchHits()
  if (!searching()) return
  if (!hits.length) return toast('찾은 게 없어요')
  jumpedAt = Date.now()
  searchAt = nextMatch(step, hits)
  sound.chime('seek')
  setFocus(searchAt)
}

function renderSearchHint() {
  search.placeholder = prefs.filter === 'all' ? '찾기 · Enter로 이동' : `${FILTER_NAMES[prefs.filter]}에서 찾기 · Enter로 이동`
  searchHint.hidden = !searching()
  if (searchHint.hidden) return
  const hits = searchHits()
  const at = hits.indexOf(searchAt)
  searchHint.textContent = !hits.length ? '없음' : at < 0 ? `${hits.length}개 ↵` : `${at + 1}/${hits.length} ↵`
  searchHint.classList.toggle('none', !hits.length)
}

// ---------- shortcuts ----------

// Letters match by physical key (e.code), so they also work with the Korean
// input source on, where e.key would be a jamo like 'ㅓ'.
function onShortcut(e) {
  if (help.open || !paletteEl.hidden) return
  const typing = e.target.matches('input, textarea, select')
  // An empty reply box lets the arrows and Enter through to a menu that is waiting.
  const idle = e.target.matches('.reply textarea') && !e.target.value && !e.isComposing && menuHandle()
  if (idle && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && movePick(e.key === 'ArrowDown' ? 1 : -1)) return e.preventDefault()
  if (idle && e.key === 'Enter' && !e.shiftKey && choosePicked()) return e.preventDefault()
  if (e.key === 'Escape' && !typing) return onEscape()
  if (e.key === 'Escape' && e.target === search) return search.blur()
  if (e.key === 'Escape' && e.target.closest('.gx-birth')) return toggleBirth(false)
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyK') {
    e.preventDefault()
    return openPalette()
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return
  const handle = activeHandle()
  const run = (fn) => {
    e.preventDefault()
    fn()
  }
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1]
  if (digit && !e.shiftKey) {
    if (handle && !e.repeat) run(() => chooseByNumber(handle, Number(digit)))
    return
  }
  if (e.key === '?') return run(openHelp)
  if (e.key === '/') return run(openPalette)
  if (e.key === 'Enter') {
    const row = e.target.closest('.row')
    // Other buttons keep their own Enter.
    if (e.target.closest('button') && !row) return
    if (!row && choosePicked()) return e.preventDefault()
    return run(() => {
      if (row) pick(row.dataset.handle)
      enterReply(row?.dataset.handle || handle)
    })
  }
  // Arrows pick among the options of a menu in front, otherwise they move between
  // sessions. They scroll a focused terminal screen instead.
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.target.closest('.screen')) {
    const step = e.key === 'ArrowDown' ? 1 : -1
    return run(() => movePick(step) || moveFocus(step))
  }
  const actions = {
    KeyJ: () => moveFocus(1),
    KeyK: () => moveFocus(-1),
    KeyN: nextAttention,
    KeyB: goBack,
    KeyR: () => enterReply(handle),
    KeyO: () => handle && focusInOrca(handle),
    KeyF: toggleMaximize,
    KeyG: () => {
      const views = Object.keys(VIEWS)
      setView(views[(views.indexOf(prefs.view) + 1) % views.length])
      toast(VIEWS[prefs.view])
    },
    KeyV: () => {
      if (prefs.view !== 'galaxy') return
      galaxy?.overview()
      setPaneOpen(false)
      closeReport()
    },
    KeyC: () => toggleBirth(),
    KeyT: () => {
      if (prefs.view !== 'galaxy') return toast('이름 끄기는 은하 보기에서 써요')
      prefs.titles = !prefs.titles
      savePrefs()
      document.body.classList.toggle('titles-off', !prefs.titles)
      toast(prefs.titles ? '별과 행성 이름을 켰어요' : '이름을 모두 껐어요 · T로 다시 켜요')
    },
    KeyL: () => {
      if (prefs.view !== 'galaxy') return toast('우주 도감은 은하 보기에서 봐요')
      toggleLog()
    },
    KeyI: () => {
      if (prefs.view !== 'galaxy') return toast('보는 법은 은하 보기에서 봐요')
      toggleGuide()
    },
    KeyZ: () => {
      if (prefs.view !== 'galaxy') return toast('고요 모드는 은하 보기에서 써요')
      setZen(!zen)
    },
    KeyP: () => handle && togglePin(handle),
    KeyS: () => toggleSettings(),
    KeyM: () => {
      setSound(!prefs.sound)
      toast(prefs.sound ? '우주 소리를 켰어요' : '소리를 껐어요')
    },
    KeyA: () => {
      autoFollow.checked = !autoFollow.checked
      autoFollow.dispatchEvent(new Event('change'))
      toast(prefs.autoFollow ? '자동 이동을 켰어요' : '자동 이동을 껐어요')
    }
  }
  if (actions[e.code]) run(actions[e.code])
}

function onEscape() {
  if (cleanAsk) cancelClean()
  else if (!birthEl.hidden) toggleBirth(false)
  else if (!settingsEl.hidden) toggleSettings(false)
  else if (zen) setZen(false)
  else if (maximized) setMaximized(false)
  else if (expandedHandle) collapse()
  else if (!paneNotice.hidden) hideNotice()
  else if (!logEl.hidden) toggleLog(false)
  else if (!guideEl.hidden) toggleGuide(false)
  else if (document.activeElement?.matches('textarea, input, select')) document.activeElement.blur()
  else if (report && !paneOpen) closeReport()
  else if (prefs.view === 'galaxy' && paneOpen) {
    setPaneOpen(false)
    document.activeElement?.blur()
  } else if (report) closeReport()
  else if (document.activeElement !== document.body) document.activeElement.blur()
}

// The session the shortcuts act on: the docked one, or the open card in the grid.
function activeHandle() {
  return isDocked() ? focusedHandle : expandedHandle
}

function go(handle) {
  if (isDocked()) pick(handle)
  else expand(handle, { focusInput: false })
}

function moveFocus(step) {
  const order = prefs.view === 'focus' ? [...list.querySelectorAll('.row')].map((row) => row.dataset.handle) : displayOrder
  // In the grid, J/K page through cards only while one is open.
  if (order.length === 0 || (prefs.view === 'grid' && !expandedHandle)) return
  const index = order.indexOf(activeHandle())
  const next = order[Math.max(0, Math.min(order.length - 1, index === -1 ? 0 : index + step))]
  if (next && next !== activeHandle()) go(next)
}

function nextAttention() {
  const waiting = attentionHandles()
  if (waiting.length === 0) return toast('확인이 필요한 세션이 없어요')
  const index = waiting.indexOf(activeHandle())
  go(waiting[(index + 1) % waiting.length])
}

function goBack() {
  if (previousHandle && sessions.has(previousHandle) && previousHandle !== activeHandle()) go(previousHandle)
  else toast('돌아갈 세션이 없어요')
}

function enterReply(handle) {
  const card = cards.get(handle)
  if (!card) return
  if (prefs.view === 'grid' && expandedHandle !== handle) expand(handle)
  if (prefs.view === 'galaxy') {
    // A question with a short-answer box in the report: answer there without opening the terminal.
    const quick = report && reportEl.querySelector(`.rp-quick[data-handle="${handle}"] input`)
    if (quick) return quick.focus()
    setPaneOpen(true)
  }
  if (card.input.disabled) return toast('이 세션에는 입력할 수 없어요')
  card.input.focus()
}

function chooseByNumber(handle, n) {
  const menu = menus.get(handle)
  if (!menu) return toast('지금 고를 선택지가 없어요')
  const option = menu.options.find((o) => o.n === n)
  if (!option) return toast(`${n}번 선택지가 없어요`)
  if (isChoicePending(handle, menu)) return
  choose(handle, menu, option)
}

function openHelp() {
  if (!help.firstChild) {
    const head = el('div', { className: 'help-head' })
    head.append(el('h2', { textContent: '단축키' }))
    const close = el('button', { type: 'button', className: 'icon', title: '닫기 (Esc)', dataset: { act: 'close-help' } })
    close.innerHTML = icon('close')
    head.append(close)
    const body = el('div', { className: 'help-body' })
    for (const group of SHORTCUTS) {
      const dl = el('dl')
      for (const [keys, label] of group.keys) {
        const dt = el('dt')
        dt.append(...keys.map((key) => el('kbd', { className: 'key', textContent: key })))
        dl.append(dt, el('dd', { textContent: label }))
      }
      const wrap = el('section')
      wrap.append(el('h3', { textContent: group.title }), dl)
      body.append(wrap)
    }
    const foot = el('p', {
      className: 'help-foot',
      textContent: '답장 칸에 글을 쓰는 동안에는 단축키가 꺼져요. Esc로 칸에서 나오면 다시 돼요. 한글 입력 상태에서도 써요.'
    })
    help.append(head, body, foot)
  }
  help.showModal()
}

function toast(message, ms = 1800) {
  clearTimeout(toastTimer)
  toastEl.textContent = message
  toastEl.hidden = false
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms)
}

// A session the user chose themselves (as opposed to auto-follow).
function pick(handle) {
  if (testItems.has(handle)) {
    testFocus = testItems.get(handle).app
    return galaxy?.flyTo(handle)
  }
  userPicked = true
  setFocus(handle)
}

function setView(view) {
  if (view === prefs.view) return
  if (cleanAsk) cancelClean()
  if (expandedHandle) collapse()
  if (maximized) setMaximized(false)
  prefs.view = view
  savePrefs()
  applyPrefs()
  for (const card of cards.values()) {
    card.el.classList.remove('docked', 'show-details')
    card.el.hidden = false
    card.dirty = true
    setExpandButton(card, false)
  }
  hideNotice()
  setZen(false)
  closeReport()
  if (view === 'galaxy') setPaneOpen(false)
  galaxy?.setActive(view === 'galaxy')
  if (view === 'galaxy') ensureGalaxy()
  syncAmbient()
  renderAll()
  if (view === 'galaxy' && focusedHandle) galaxy?.flyTo(focusedHandle)
  if (view === 'grid' && focusedHandle) cards.get(focusedHandle)?.el.scrollIntoView({ block: 'nearest' })
}

function applyPrefs() {
  document.body.dataset.size = prefs.size
  document.body.dataset.view = prefs.view
  document.body.classList.toggle('pane-closed', !paneOpen)
  showShells.checked = prefs.showShells
  autoFollow.checked = prefs.autoFollow
  for (const button of document.querySelectorAll('button[data-filter]')) button.classList.toggle('active', button.dataset.filter === prefs.filter)
  for (const button of document.querySelectorAll('button[data-size]')) button.classList.toggle('active', button.dataset.size === prefs.size)
  for (const button of document.querySelectorAll('button[data-view]')) button.classList.toggle('active', button.dataset.view === prefs.view)
}

function loadPrefs() {
  const defaults = { version: 2, filter: 'all', size: 'm', showShells: true, view: 'galaxy', autoFollow: true, collapsed: { done: true, shell: true }, pins: [], sound: true, look: LOOK_DEFAULTS, mix: {}, mixOff: {}, decor: {}, musicMood: true, newAgent: 'claude', titles: true }
  try {
    const saved = JSON.parse(localStorage.getItem('orca-portal-prefs') || '{}')
    if (saved.version !== 2) Object.assign(saved, { version: 2, view: 'galaxy' })
    if (!VIEWS[saved.view]) delete saved.view
    const mix = { ...saved.mix }
    for (const [old, keys] of Object.entries(OLD_MIX)) {
      if (!(old in mix)) continue
      for (const key of keys) mix[key] ??= mix[old]
      delete mix[old]
    }
    return { ...defaults, ...saved, collapsed: { ...defaults.collapsed, ...saved.collapsed }, look: { ...LOOK_DEFAULTS, ...saved.look }, mix, mixOff: { ...saved.mixOff }, decor: { ...saved.decor } }
  } catch {
    return defaults
  }
}

function savePrefs() {
  try {
    localStorage.setItem('orca-portal-prefs', JSON.stringify(prefs))
  } catch {}
}

function setConn(state, status) {
  const labels = { live: '연결됨', reconnecting: '다시 연결 중', offline: '오러리 서버 꺼짐', 'orca-down': 'Orca 연결 안 됨', connecting: '연결 중' }
  conn.dataset.state = state
  conn.querySelector('.conn-text').textContent = labels[state]
  conn.title = status?.error || (status?.transport === 'cli' ? 'orca CLI로 읽는 중' : labels[state])
}

// ---------- helpers ----------

function matchesSearch(session, handle) {
  return !searchQuery() || searchRank(session, handle) >= 0
}

function compactNumber(n) {
  return compactFormat.format(n)
}

function el(tag, props = {}) {
  const node = document.createElement(tag)
  const { dataset, ariaExpanded, ...rest } = props
  Object.assign(node, rest)
  if (dataset) Object.assign(node.dataset, dataset)
  if (ariaExpanded !== undefined) node.setAttribute('aria-expanded', ariaExpanded)
  return node
}

function icon(name, size = 16) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
}

function autosize(textarea) {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  textarea.style.overflowY = textarea.scrollHeight > 160 ? 'auto' : 'hidden'
}

function trimTrailingBlank(lines) {
  let end = lines.length
  while (end > 0 && !lines[end - 1].trim()) end--
  return lines.slice(0, end)
}

function ago(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 10) return '방금'
  if (seconds < 60) return `${seconds}초 전`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`
  return `${Math.floor(seconds / 86400)}일 전`
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

// Just enough Markdown for agent answers: code blocks, tables, headings, lists, inline code, bold.
function renderMarkdown(source) {
  const out = []
  const lines = source.replace(/\r/g, '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^```/.test(line)) {
      const code = []
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i])
      out.push(`<pre class="code">${escapeHtml(code.join('\n'))}</pre>`)
    } else if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++])
      i--
      const cells = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).map((r) => r.trim().slice(1, -1).split('|').map((c) => inline(c.trim())))
      const [head, ...body] = cells
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
    } else if (/^#{1,6}\s/.test(line)) {
      out.push(`<h4>${inline(line.replace(/^#+\s*/, ''))}</h4>`)
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const indent = line.match(/^\s*/)[0].length
      out.push(`<div class="li" style="padding-left:${Math.min(indent, 8) * 0.5 + 1}em"><span class="bullet">${escapeHtml(line.trim().match(/^([-*]|\d+\.)/)[0].replace(/^[-*]$/, '•'))}</span><span>${inline(line.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</span></div>`)
    } else if (!line.trim()) {
      out.push('<div class="gap"></div>')
    } else {
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  return out.join('')
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

setupControls()
if (prefs.view === 'galaxy') ensureGalaxy()
connect()
