// 3D galaxy view: every app is a star system on a spiral arm, every terminal a
// planet orbiting it. Loaded only when the galaxy view first opens (three.js is ~2 MB).
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

const GALAXY_RADIUS = 320
const ARMS = 3
const SPIN = 0.0145 // arm twist, radians per unit of radius
const WARP = 30 // how far the rim of the disc bends up on one side and down on the other
const SPOT_CHOICES = 16 // a new star looks at this many spots of its own and takes the emptiest
const MILESTONES = [1e7, 5e7, 1e8, 5e8, 1e9] // an app's tokens: each one passed is celebrated
const CROWN_GLINTS = [0, 3, 5, 7, 9, 12] // glints in a star's crown, by milestones passed
const WARMUP_MS = 60_000 // tokens still being counted after the page opens: no celebrations yet
const DISC_SPIN = 0.012 // galaxy rotation, radians per second (about 9 minutes a turn)
const UP = new THREE.Vector3(0, 1, 0)
const OVERVIEW_DIR = new THREE.Vector3(0, 0.6, 0.8).normalize()
const PIXEL_BUDGET = 3.7e6 // about 2560×1440 drawn pixels
const DISK_DAYS = [2.5, 7] // a new star's dusty disc: thick until here, gone by here
const LABEL_NEAR = 95 // planet names show once the camera is this close to their system
const FLY_MS = 1700
const WARP_MS = 2600 // jumping to another app's system takes the warp drive
const FADE_MS = 1700 // a closed terminal's planet collapses into a spark
const NOVA_MS = 4400 // an app's last terminal closes: its star swells, collapses and blows away
const BIRTH_MS = 3800 // a new app: gas gathers, a star ignites, planets form
const FORM_MS = 1600 // a new terminal in a known app: a planet gathers from a ring of dust
const BLOOM = 0.78
// The Milky Way: the plane of the far sky's band and the direction of its bright heart.
const BAND_NORMAL = new THREE.Vector3(0.3, 1, 0.2).normalize()
const BAND_CENTER = new THREE.Vector3(1, 0, -1.5).projectOnPlane(BAND_NORMAL).normalize()
const METEOR_TINTS = [new THREE.Color(1, 0.97, 0.9), new THREE.Color(0.7, 1, 0.8), new THREE.Color(0.7, 0.85, 1), new THREE.Color(1, 0.85, 0.6)]
const PASTELS = ['#ffc8e8', '#c8d8ff', '#dccbff', '#c8fff0', '#ffe2c4']
const TILT_PERIOD = 110 // seconds for the idle camera's slow rise and dip
// What a star wears around its own light. Each star's is picked from its name, so every
// window shows it the same: a shell of glowing gas, butterfly wings, a rose, an aurora, a
// halo, a whirl, a pulsar's beams, prism-split spikes, or nothing at all. Its core keeps
// the colour of its age; the dress brings colours of its own.
const STAR_DRESSES = [
  ['bare', '맨별', 1],
  ['shell', '고리 성운 별', 2],
  ['wings', '나비 성운 별', 1.5],
  ['rose', '장미 성운 별', 1.5],
  ['aurora', '오로라 별', 1.5],
  ['halo', '빛고리 별', 2],
  ['whirl', '소용돌이 별', 1.5],
  ['pulsar', '펄서', 1],
  ['prism', '프리즘 별', 2]
]
// The colours come from the hour the star was born: dawn pinks and golds, daylight skies
// and mints, sunset corals and violets, night ices and lavenders.
const DRESS_TIMES = [
  { label: '새벽', icon: '🌅', from: 4, to: 8, colors: [['#ffb3c7', '#ffd36e'], ['#c39bff', '#ffc2a1'], ['#ff9ec4', '#a6d8ff']] },
  { label: '낮', icon: '☀️', from: 8, to: 17, colors: [['#8fd3ff', '#6fffe0'], ['#5fe8ff', '#ffcf5c'], ['#4dffb8', '#a6d8ff']] },
  { label: '저녁', icon: '🌇', from: 17, to: 21, colors: [['#ff9a6b', '#9b6bff'], ['#ffd36e', '#ff4f8b'], ['#ff7ad9', '#ffb36b']] },
  { label: '밤', icon: '🌙', from: 21, to: 4, colors: [['#a6c8ff', '#c39bff'], ['#5fe8ff', '#ff4f8b'], ['#6f8bff', '#a6ffea']] }
]
const CRUISE_STAY = [20, 34] // seconds the cruising camera circles a star before moving on
const CRUISE_WIDE_EVERY = 4 // every so many legs, the cruise pulls back to the whole galaxy
// Play: comets thrown by hand and bent by the stars, things to catch, the black hole.
const HOLD_MS = 420 // press and hold this long without moving to throw a comet or grab a planet
const STAR_GM = 22000 // a star's pull, times its size squared
const CORE_GM = 400000
const SOFTEN = 4
const MAX_THROW = 320
const AIM_STEPS = 90 // the predicted path: 3 seconds, 30 points a second
const TRAIL = 48
// A thrown comet takes two of these: its head, and the shade its tail fades into.
const COMET_COLORS = ['#ff9fd0', '#9fe8ff', '#ffd27a', '#b9a6ff', '#8fffc6', '#ffb38a', '#ff8fa3', '#a6c8ff', '#f0ff9f']
const CATCH_PX = 44
const HOLE_PX = 80 // the black hole's radius on screen
const HOLE_DEPTH = 20
const SWALLOW_MS = 2400

// Status → light colour, close to the 2D palette so the meaning carries over.
const TONE = {
  choice: '#ffb340',
  waiting: '#ffb340',
  blocked: '#ff5a6e',
  working: '#5fb8ff',
  new: '#6dffb6',
  done: '#ffe2b0',
  idle: '#c4c8d6',
  shell: '#8d94a8'
}
const RIM = { choice: 2.2, waiting: 2.2, blocked: 2.2, working: 1.3, new: 1.4, done: 0.5, idle: 0.35, shell: 0.25 }
const RANK = { choice: 0, waiting: 0, blocked: 1, working: 2, new: 3, done: 4, idle: 5, shell: 6 }
const ALERT = new Set(['choice', 'waiting', 'blocked'])
const RED_GIANT = new THREE.Color(1.1, 0.4, 0.16)
const RED_GLOW = new THREE.Color('#ff5a2e')
const WHITE_DWARF = new THREE.Color(0.85, 1, 1.3)
const AMBER = new THREE.Color(TONE.choice)
const WHITE = new THREE.Color('#ffffff')
const SPOT = new THREE.Color('#fff0b8') // the warm light a search lights planets with
// A star's colour is the project's age, as with real stars: new projects burn blue, old ones
// cool through white and yellow to orange and red. Days since the first agent record.
// Pushed brighter than real star colours so they read at a glance.
const SPECTRAL = [
  [0, '#3f6dff'],
  [1, '#46c8ff'],
  [4, '#dfeaff'],
  [14, '#ffd84a'],
  [45, '#ff8a2a'],
  [120, '#ff3b3b']
].map(([days, color]) => [Math.log1p(days), new THREE.Color(color)])
const UNKNOWN_STAR = new THREE.Color('#f4f2ff') // until a star's colour is known

// onPlay hears about play (a meteor caught, a comet swallowed) for the page's log.
// onClean is asked when a planet is dropped into the black hole; the page confirms
// with the user, closes the terminal and then calls swallow(), or cancelClean().
export function createGalaxy(host, { onPick, onPickSystem, onWarp, onWatch, onSound, onOverview, onPlay, onClean, onRemnant, spots: knownSpots = {}, onSpot, onGlide, onMilestone }) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.88
  renderer.domElement.className = 'gx-canvas'
  const labelRenderer = new CSS2DRenderer()
  labelRenderer.domElement.className = 'gx-labels'
  const tip = Object.assign(document.createElement('div'), { className: 'gx-tip', hidden: true })
  // Destination readout shown while the warp drive is engaged.
  const warpHud = Object.assign(document.createElement('div'), { className: 'gx-warp', hidden: true })
  warpHud.innerHTML = '<span class="gx-warp-k">WARP</span><b></b><small></small><i></i>'
  // A grabbed planet follows the pointer as a glowing orb with its name.
  const ghost = Object.assign(document.createElement('div'), { className: 'gx-ghost', hidden: true })
  ghost.innerHTML = '<i></i><span></span>'
  host.append(renderer.domElement, labelRenderer.domElement, tip, warpHud, ghost)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#010207')
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 12000)
  camera.position.copy(OVERVIEW_DIR).multiplyScalar(2600).add(new THREE.Vector3(900, 400, 0))
  const controls = new OrbitControls(camera, renderer.domElement)
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.07, rotateSpeed: 0.55, zoomSpeed: 0.9, minDistance: 4, maxDistance: 2200, autoRotate: true })

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM, 0.5, 0.5)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  const tex = {
    glow: glowTexture(),
    spikes: spikeTexture(),
    ring: ringTexture(),
    thinRing: ringTexture(256, 0.9, 0.955),
    beam: beamTexture(),
    nebula: [nebulaTexture(11), nebulaTexture(29), nebulaTexture(47)]
  }
  // The camera carries the warp streaks, so it has to be in the scene.
  scene.add(camera)
  const warp = createWarp(camera, tex)
  const flashes = []
  const dying = [] // planets and stars playing out their exit
  const births = [] // new stars condensing out of gas, new planets gathering from dust
  const comets = [] // replies flying from the viewer to a planet
  const meteors = [] // shooting stars when work finishes
  const satBody = new THREE.BoxGeometry(0.16, 0.16, 0.24)
  const satPanel = new THREE.BoxGeometry(0.95, 0.015, 0.22)
  const satMetal = new THREE.MeshBasicMaterial({ color: '#aab4c8' })
  const satCells = new THREE.MeshBasicMaterial({ color: '#2b4a94' })
  const moonMaterial = new THREE.MeshBasicMaterial({ color: '#c3cbe0' })
  const probeBody = new THREE.OctahedronGeometry(0.16)
  const probeMaterial = new THREE.MeshBasicMaterial({ color: '#9dffe0' })
  const sphere = new THREE.SphereGeometry(1, 48, 32)
  const hitSphere = new THREE.SphereGeometry(1, 8, 6)
  const plane = new THREE.PlaneGeometry(1, 1)
  // A pulsar's beam: an open cone from its pole outwards, one unit long.
  const beamCone = new THREE.ConeGeometry(0.2, 1, 24, 1, true).translate(0, -0.5, 0)
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false })
  const circle = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 96 }, (_, i) => new THREE.Vector3(Math.cos((i / 96) * Math.PI * 2), 0, Math.sin((i / 96) * Math.PI * 2)))
  )

  const pointUniforms = { uScale: { value: 1 }, uPixel: { value: 1 }, uTime: { value: 0 } }
  const sky = skyDome()
  const beacons = brightStars(tex)
  const drifter = driftingComet(tex.glow)
  const band = milkyWay(tex)
  const veils = nebulae(tex.nebula)
  scene.add(sky, backgroundStars(pointUniforms), band, veils, ringNebulae(tex), beacons, distantGalaxies(plane), drifter.group)
  const disc = new THREE.Group()
  scene.add(disc)
  const clouds = armNebulae(tex.nebula)
  // Decorations the viewer can switch off one by one in the settings.
  // Supernova remnants turn with the disc; the others sit in the sky around it.
  const jets = coreJets(tex.glow)
  const decor = { magellan: magellanicClouds(tex, pointUniforms), remnants: new THREE.Group(), jets: jets.group }
  scene.add(decor.magellan, decor.jets)
  disc.add(decor.remnants)
  let jetLevel = 0
  let decorOn = {} // which decorations the viewer left on (anything not named is on)
  const auroraRing = aurora()
  const core = galaxyCore(tex.glow)
  let breathAt = 0 // where the core is in its breathing, in radians
  disc.add(...galaxyDisc(pointUniforms), ...core, clouds, globularClusters(pointUniforms), auroraRing)
  const hole = blackHole(tex.thinRing)
  camera.add(hole.group)
  let nextMeteor = 8 + Math.random() * 12
  let nextShower = 60 + Math.random() * 60
  let nextEvent = 45 + Math.random() * 60
  const events = [] // far supernovae and stars being born in the arms
  const thrown = [] // comets the viewer threw
  const bursts = [] // flashes from catches and collisions

  const systems = new Map() // app name -> system
  const spots = new Map(Object.entries(knownSpots)) // app name -> which of its spots it took
  const planets = new Map() // terminal handle -> planet
  const protostars = new Map() // app name -> a star still forming, see forming()
  let order = []
  let layoutKey = ''
  let selected = null
  let searching = false // a search is typed: the planets it finds light up
  let searchTarget = null // the planet Enter goes to next
  let foundSoundAt = 0
  const spotPos = new THREE.Vector3()
  let hovered = null
  let follow = null // system the camera rides along with
  let watchKey = null // what the page was last told about it
  let watchedAt = 0
  let flight = null
  let area = { x: 0, y: 0, width: 1, height: 1 }
  let areaGoal = null // the pane slides in and out; the view centre follows smoothly
  let size = { width: 1, height: 1 }
  let quality = 1 // eased down when frames run slow, back up when there's room
  let frameEma = 0
  let frameBusy = false
  let qualityAt = performance.now() + 4000 // let the first heavy frames (shader builds) pass
  let active = false
  let lastFrame = 0
  let lastInput = 0
  let dragging = false
  let releasedAt = 0
  let time = 0
  let pointer = null
  let pointerDirty = false
  let down = null
  let fullView = { width: 1, height: 1 }
  let idle = 0
  let cruising = null // quiet mode's slow tour, see setCruise()
  let glow = BLOOM // the viewer can turn the bloom and the exposure down (or up)
  let busyAgents = 0 // agents working right now, for the aurora
  let auroraLevel = 0
  let auroraUntil = 0 // an aurora bought with stardust lasts until then (scene time)
  const openedAt = performance.now()
  let auroraSeen = false
  let hold = null // a press that may turn into a throw or a grab
  let aim = null // pulling back a comet
  let grab = null // dragging a planet towards the black hole
  let cleaning = null // the planet waiting in the black hole while the page asks
  let holeShow = 0
  let holeGoal = 0
  let holeHeat = 0
  let holeHeatGoal = 0
  const tmp = new THREE.Vector3()
  const tmp2 = new THREE.Vector3()
  const tmp3 = new THREE.Vector3()
  const ndc = new THREE.Vector2()
  const turn = new THREE.Quaternion()
  const partTurn = new THREE.Quaternion()
  const orbitSph = new THREE.Spherical()
  const raycaster = new THREE.Raycaster()

  // ---------- systems & planets ----------

  // gone: handles whose terminals were closed, so they leave with a show rather than just disappearing.
  // born: handles of terminals that just opened, so they arrive with one.
  // stats: per app { tokens, activeMs, firstAt } for the stars' size and colour.
  // searching: a search is typed, so the planets left showing are what it found.
  function update(items, { focused = null, gone = new Set(), born = new Set(), stats = new Map(), searching: nowSearching = false } = {}) {
    searching = nowSearching
    host.classList.toggle('gx-searching', searching)
    let lit = 0
    const byApp = new Map()
    for (const item of items) {
      if (!byApp.has(item.app)) byApp.set(item.app, [])
      byApp.get(item.app).push(item)
    }
    // Pinned apps take the inner orbits, next to the core.
    const pinned = (app) => byApp.get(app).some((i) => i.pinned)
    const apps = [...byApp.keys()].sort((a, b) => Number(pinned(b)) - Number(pinned(a)) || a.localeCompare(b, 'ko'))
    for (const list of byApp.values()) list.sort((a, b) => a.planet.localeCompare(b.planet, 'ko') || a.handle.localeCompare(b.handle))

    const key = apps.map((app) => `${app}:${byApp.get(app).map((i) => i.handle).join(',')}`).join('|')
    if (key !== layoutKey) {
      layoutKey = key
      relayout(apps, byApp, items.length && !reduceMotion ? gone : new Set(), reduceMotion ? new Set() : born)
    }
    busyAgents = items.filter((i) => i.status === 'working').length
    for (const app of apps) {
      const system = systems.get(app)
      const bornAt = bornOf(byApp.get(app))
      if (bornAt !== system.bornAt) redress(system, bornAt)
      let best = 'shell'
      let anyShown = false
      let working = 0
      let active = 0
      for (const item of byApp.get(app)) {
        const planet = planets.get(item.handle)
        Object.assign(planet, { item })
        if (!planet.swallowing) paintPlanet(planet)
        // Found ones flare on one after another rather than all at once.
        if (setSpot(planet, searching && item.show && !planet.swallowing, lit * 70)) lit++
        if (RANK[item.status] < RANK[best]) best = item.status
        anyShown ||= item.show
        if (item.status === 'working') working++
        if (item.active) active++
      }
      // Busy apps (agents working, output streaming) sparkle; more work, more sparkle.
      system.busy = Math.min(1, working * 0.5 + active * 0.3)
      paintSystem(system, best, anyShown)
      applyStats(system, stats.get(app))
      const paths = new Set()
      for (const item of byApp.get(app)) {
        const planet = planets.get(item.handle)
        const first = !paths.has(item.path)
        if (planet.swallowing) continue
        setMoons(planet, item.moons || 0)
        // One satellite per pull request and one probe per running server, on the
        // first terminal of their worktree.
        setSatellite(planet, first ? item.pr : null)
        setProbes(planet, first ? item.servers || [] : [])
        paths.add(item.path)
      }
      setCompanions(system, paths.size - 1)
      const sizes = system.planets.map((p) => p.sizeGoal.toFixed(2)).join()
      if (sizes !== system.sizesKey) {
        system.sizesKey = sizes
        arrange(system)
      }
      system.label.element.classList.toggle('pinned', pinned(app))
    }
    order = apps.flatMap((app) => byApp.get(app).filter((i) => i.show).map((i) => i.handle))
    select(focused)
    if (lit && performance.now() - foundSoundAt > 600) {
      foundSoundAt = performance.now()
      onSound?.('found')
    }
    return order
  }

  function relayout(apps, byApp, gone, born) {
    const keep = new Set(apps.flatMap((app) => byApp.get(app).map((i) => i.handle)))
    const fading = new Set()
    const now = performance.now()
    for (const [handle, planet] of planets) {
      if (keep.has(handle)) continue
      planets.delete(handle)
      if (hovered === planet) hovered = null
      // Closed from the black hole: the hole eats it (if the close beat the page's
      // own confirmation back, start that now), and a last planet takes its star along.
      if (planet === cleaning) startSwallow(planet)
      if (planet.swallowing) {
        if (planet.eaten) removePlanet(planet)
        if (!byApp.has(planet.system.app) && !reduceMotion) fading.add(planet.system)
        continue
      }
      if (!gone.has(handle)) {
        removePlanet(planet)
        continue
      }
      const last = !byApp.has(planet.system.app)
      fading.add(planet.system)
      // When the whole system goes, the swelling star swallows its planets from the inside out.
      dying.push({ kind: 'planet', planet, start: now + (last ? 500 + (planet.orbitRadius - 4.5) * 160 : 0), duration: FADE_MS, quiet: last, wasSelected: handle === selected })
    }
    for (const [app, system] of systems) {
      if (byApp.has(app)) continue
      systems.delete(app)
      if (fading.has(system)) {
        dying.push({ kind: 'star', system, start: now, duration: NOVA_MS })
        continue
      }
      disc.remove(system.group)
      disposeSystem(system)
      if (follow === system) follow = null
    }
    // Whatever was under the pointer may be gone; look again on the next frame.
    pointerDirty = Boolean(pointer)
    const homes = homesOf(apps, (app) => byApp.get(app).some((i) => i.pinned))
    apps.forEach((app) => {
      // A star forming here: its terminal opened, so it ignites and the cloud clears.
      if (protostars.has(app)) unform(app)
      const system = systems.get(app) || createSystem(app, bornOf(byApp.get(app)))
      system.home.copy(homes.get(app))
      if (!system.placed) {
        system.group.position.copy(system.home)
        system.placed = true
      }
      const list = byApp.get(app)
      const fresh = !system.planets.length
      const known = new Set(system.planets)
      system.planets = list.map((item) => planets.get(item.handle) || createPlanet(system, item))
      arrange(system)
      const arrived = system.planets.filter((p) => !known.has(p) && born.has(p.handle))
      if (!arrived.length) return
      // A whole new app condenses into a star; a new terminal in a known app gathers into a planet.
      if (fresh && arrived.length === system.planets.length) births.push({ kind: 'star', system, start: performance.now(), duration: BIRTH_MS })
      else for (const planet of arrived) births.push({ kind: 'planet', planet, start: performance.now(), duration: FORM_MS })
    })
  }

  // CSS2D labels only clean up when they themselves are removed, not an ancestor, so drop them by hand.
  function removePlanet(planet) {
    planet.system.tilt.remove(planet.pivot, planet.orbit)
    planet.label.element.remove()
    planet.mesh.material.dispose()
    planet.orbit.material.dispose()
    for (const beacon of planet.beacons) beacon.material.dispose()
    if (planet.spot) dropSpot(planet)
    for (const m of planet.moons) m.glint.material.dispose()
    planet.satellite?.light.material.dispose()
    for (const p of planet.probes.values()) p.glow.material.dispose()
    planet.aura?.material.dispose()
    planet.ring?.material.dispose()
  }

  function disposeSystem(system) {
    system.label.element.remove()
    for (const planet of system.planets) planet.label.element.remove()
    system.core.material.dispose()
    system.disk?.material.dispose()
    for (const m of system.dress.materials) m.dispose()
    for (const s of [system.glow, system.corona, system.spikes, system.spikes2, ...system.beacons, ...system.sparkles.map((x) => x.sprite), ...system.crown.children]) s.material.dispose()
    for (const c of system.companions) {
      c.body.material.dispose()
      c.halo.material.dispose()
    }
  }

  // Running subagents circle their planet as small moons.
  function setMoons(planet, count) {
    planet.moonGoal = Math.min(6, count)
    while (planet.moons.length < planet.moonGoal) {
      const i = planet.moons.length
      const rand = mulberry32(hash(planet.handle) + i * 31)
      const pivot = new THREE.Object3D()
      pivot.rotation.set((rand() - 0.5) * 1.2, rand() * Math.PI * 2, (rand() - 0.5) * 1.2)
      const moon = new THREE.Mesh(sphere, moonMaterial)
      moon.position.x = 1.6 + i * 0.34
      moon.scale.setScalar(0.001)
      const glint = sprite(tex.glow, 0.001, 0)
      glint.material.color.set('#bcd4ff')
      glint.position.copy(moon.position)
      pivot.add(moon, glint)
      planet.holder.add(pivot)
      planet.moons.push({ pivot, moon, glint, k: 0, speed: 2.4 / (1 + i * 0.3) })
    }
  }

  function stepMoons(planet, dt) {
    for (let i = planet.moons.length - 1; i >= 0; i--) {
      const m = planet.moons[i]
      const goal = i < planet.moonGoal ? 1 : 0
      m.k += (goal - m.k) * Math.min(1, dt * 3)
      m.pivot.rotation.y += m.speed * dt
      m.moon.position.x = m.glint.position.x = (1.6 + i * 0.34) * planet.size
      m.moon.scale.setScalar(Math.max(0.001, 0.13 * m.k))
      m.glint.scale.setScalar(Math.max(0.001, 0.9 * m.k))
      m.glint.material.opacity = 0.55 * m.k
      if (goal || m.k > 0.02) continue
      planet.holder.remove(m.pivot)
      m.glint.material.dispose()
      planet.moons.splice(i, 1)
    }
  }

  // A server running in the worktree is a small probe: it lifts off the planet's surface
  // into orbit when the server starts and drops back in when it stops.
  function setProbes(planet, servers) {
    const live = new Set()
    for (const server of servers.slice(0, 5)) {
      live.add(server.pid)
      const known = planet.probes.get(server.pid)
      if (known) {
        known.leaving = false
        continue
      }
      // Servers already up when the page opens are simply there; later ones launch.
      const launch = time > 6 && !reduceMotion
      const i = planet.probes.size
      const rand = mulberry32(hash(planet.handle) + server.pid)
      const pivot = new THREE.Object3D()
      pivot.rotation.set((rand() - 0.5) * 1.6, rand() * Math.PI * 2, (rand() - 0.5) * 1.6)
      const craft = new THREE.Group()
      const body = new THREE.Mesh(probeBody, probeMaterial)
      const glow = sprite(tex.glow, 0.001, 0)
      glow.material.color.set('#4dffc3')
      craft.add(body, glow)
      pivot.add(craft)
      planet.holder.add(pivot)
      planet.probes.set(server.pid, { pivot, craft, body, glow, t: launch ? 0 : 1, leaving: false, radius: 2.7 + i * 0.36, speed: 1.6 / (1 + i * 0.25), phase: rand() * 6 })
      if (launch) onSound?.('probe-up')
    }
    for (const [pid, probe] of planet.probes) {
      if (live.has(pid) || probe.leaving) continue
      probe.leaving = true
      if (time > 6) onSound?.('probe-down')
    }
  }

  function stepProbes(planet, dt) {
    for (const [pid, p] of planet.probes) {
      p.t = Math.max(0, Math.min(1, p.t + (p.leaving ? -dt / 1.1 : dt / 1.4)))
      // Up with a little overshoot; down in a falling curve, back into the planet.
      const e = p.leaving ? p.t * p.t : easeOutBack(p.t)
      p.craft.position.x = (0.9 + (p.radius - 0.9) * e) * planet.size
      p.pivot.rotation.y += p.speed * dt
      p.body.rotation.x += dt * 2.1
      p.body.rotation.y += dt * 1.4
      const size = p.leaving ? p.t : Math.min(1, p.t * 4)
      p.body.scale.setScalar(Math.max(0.001, size))
      // A bright flare as it leaves the surface.
      const flare = p.leaving ? 0 : Math.max(0, 1 - p.t * 2.2) * 2.2
      p.glow.scale.setScalar(Math.max(0.001, 1.1 * size + flare))
      p.glow.material.opacity = (0.5 + 0.3 * Math.sin(time * 4 + p.phase)) * size + flare * 0.45
      if (!p.leaving || p.t > 0) continue
      planet.holder.remove(p.pivot)
      p.glow.material.dispose()
      planet.probes.delete(pid)
    }
  }

  // A pull request is a satellite on a polar orbit; its light shows the PR state and CI.
  function setSatellite(planet, pr) {
    const color = pr ? prTone(pr) : null
    const key = color ? `${pr.number}|${color}` : ''
    if (key === planet.prKey) return
    planet.prKey = key
    if (planet.satellite) {
      planet.holder.remove(planet.satellite.pivot)
      planet.satellite.light.material.dispose()
      planet.satellite = null
    }
    if (!color) return
    const pivot = new THREE.Object3D()
    pivot.rotation.set(1.15, hash(planet.handle) % 7, 0.3)
    const craft = new THREE.Group()
    const light = sprite(tex.glow, 0.6, 1)
    light.material.color.set(color)
    light.position.y = 0.14
    craft.add(new THREE.Mesh(satBody, satMetal), new THREE.Mesh(satPanel, satCells), light)
    craft.position.x = 2.2 * planet.size
    craft.scale.setScalar(1.4)
    pivot.add(craft)
    planet.holder.add(pivot)
    planet.satellite = { pivot, craft, light }
  }

  // ---------- stars forming ----------

  // A project being made from the page shows as a cloud of gas gathering at the spot its
  // star will take: dust spirals in, the cloud turns faster and draws together, and a glow
  // grows in its middle as the work goes on (a clone, as it downloads). When the project's
  // terminal opens the star ignites right there and the cloud clears. If the work fails,
  // the cloud drifts apart.
  function forming(app, { progress = 0, label = '', go = false } = {}) {
    if (systems.has(app)) return
    let proto = protostars.get(app)
    if (proto?.leaving) {
      dropProtostar(proto)
      proto = null
    }
    if (!proto) {
      proto = createProtostar(app)
      protostars.set(app, proto)
    }
    proto.goal = Math.max(proto.goal, Math.min(1, Math.max(0, progress)))
    proto.note.textContent = label
    if (go) flyToSystem(proto, '별이 모이는 중')
  }

  function unform(app, { failed = false } = {}) {
    const proto = protostars.get(app)
    if (proto && !proto.leaving) proto.leaving = { start: performance.now(), failed }
  }

  function createProtostar(app) {
    const taken = [...systems.values()].map((s) => s.home).concat([...protostars.values()].map((p) => p.group.position))
    const spot = spots.has(app) ? spots.get(app) : takeSpot(app, taken)
    const group = new THREE.Group()
    group.position.copy(spotOf(app, spot, false))
    // The cloud already has the colours of the hour the star is born in.
    const [first, second] = dressOf(app, Date.now()).colors
    const clouds = [first, second, '#a493ff'].map((color) => {
      const cloud = sprite(tex.nebula[Math.floor(Math.random() * tex.nebula.length)], 0.001, 0)
      cloud.material.color.set(color)
      cloud.material.rotation = Math.random() * Math.PI * 2
      return cloud
    })
    const core = sprite(tex.glow, 0.001, 0)
    core.material.color.set('#ffe6c4')
    // Dust falling in along two arms: each grain starts outside near an arm, and as it
    // falls it turns faster, so the arms wind into a spiral. Once in, it starts again.
    const count = 700
    const position = new Float32Array(count * 3)
    const tint = new Float32Array(count * 3)
    const size = new Float32Array(count)
    const c = new THREE.Color()
    const grains = Array.from({ length: count }, (_, i) => {
      c.set(PASTELS[i % PASTELS.length]).multiplyScalar(0.6 + Math.random() * 0.6)
      tint.set([c.r, c.g, c.b], i * 3)
      size[i] = 0.8 + Math.random() * 1.4
      return { r: Math.random(), a: 0, arm: i % 2, y: gauss(Math.random), speed: 0.6 + Math.random() * 0.8 }
    })
    for (const g of grains) g.a = g.arm * Math.PI + gauss(Math.random) * 0.35 - Math.log(0.15 + g.r) * 1.6
    const swirl = new THREE.Points(geometryOf(position, tint, size), pointsMaterial(pointUniforms, THREE.AdditiveBlending, 0))
    swirl.rotation.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5)
    const label = labelObject('gx-star gx-forming', app)
    label.center.set(0.5, 0)
    label.position.y = -4
    const note = el('small', '')
    label.element.append(note)
    group.add(...clouds, core, swirl, label)
    disc.add(group)
    // Enough of a system's shape for the camera to fly to it and ride along.
    return { app, group, clouds, core, swirl, grains, label, note, goal: 0, shown: 0, born: performance.now(), leaving: null, reach: 9, planets: [], stats: null, ageDays: 0, busy: 0, seed: hash(app) }
  }

  function stepForming(now, dt) {
    for (const proto of [...protostars.values()]) {
      proto.shown += (proto.goal - proto.shown) * Math.min(1, dt * 1.2)
      const age = (now - proto.born) / 1000
      let fade = smooth(0, 2.5, age)
      let spread = 1
      if (proto.leaving) {
        const k = Math.min(1, (now - proto.leaving.start) / (proto.leaving.failed ? 2800 : 1500))
        if (k >= 1) {
          dropProtostar(proto)
          continue
        }
        fade *= 1 - smooth(0, 1, k)
        spread = proto.leaving.failed ? 1 + k * 1.6 : 1 - k * 0.75
      }
      // Without news the cloud still turns and slowly draws in, so a long step never looks stuck.
      const pull = Math.min(1, proto.shown * 0.85 + Math.min(0.15, age / 300))
      const breath = 1 + 0.05 * Math.sin(age * 1.6)
      proto.clouds.forEach((cloud, i) => {
        cloud.scale.setScalar(Math.max(0.001, (42 - i * 8) * (1 - pull * 0.6) * spread * breath))
        cloud.material.opacity = fade * (0.75 - i * 0.15) * (0.75 + 0.25 * pull)
        cloud.material.rotation += dt * (0.04 + pull * 0.3) * (i % 2 ? -1 : 1)
      })
      proto.core.scale.setScalar(1.5 + 8 * proto.shown)
      proto.core.material.opacity = fade * (0.12 + 0.7 * proto.shown) * (0.85 + 0.15 * Math.sin(age * 3.1))
      const outer = (24 - 11 * pull) * spread
      const position = proto.swirl.geometry.attributes.position
      proto.grains.forEach((g, i) => {
        g.r -= dt * g.speed * (0.04 + 0.22 * pull)
        if (g.r <= 0.05) {
          g.r = 1
          g.a = g.arm * Math.PI + gauss(Math.random) * 0.35 + age * 0.3
        }
        // Faster the closer in, as round a star.
        g.a += (dt * g.speed * (0.35 + 1.4 * pull)) / (0.25 + g.r)
        const r = g.r * outer
        position.setXYZ(i, Math.cos(g.a) * r, g.y * r * 0.08, Math.sin(g.a) * r)
      })
      position.needsUpdate = true
      proto.swirl.material.uniforms.uAlpha.value = fade
      proto.label.element.style.opacity = String(fade)
    }
  }

  function dropProtostar(proto) {
    if (protostars.get(proto.app) === proto) protostars.delete(proto.app)
    disc.remove(proto.group)
    proto.label.element.remove()
    for (const s of [...proto.clouds, proto.core]) s.material.dispose()
    proto.swirl.geometry.dispose()
    proto.swirl.material.dispose()
    if (follow === proto) follow = null
  }

  // ---------- arriving ----------

  function stepBirths(now) {
    for (const entry of [...births]) {
      if (now < entry.start) continue
      const k = Math.min(1, (now - entry.start) / entry.duration)
      const alive = entry.kind === 'star' ? systems.get(entry.system.app) === entry.system : planets.get(entry.planet.handle) === entry.planet
      if (alive) {
        if (entry.kind === 'star') ignite(entry, k)
        else gather(entry, k)
      }
      if (alive && k < 1) continue
      births.splice(births.indexOf(entry), 1)
      for (const s of entry.extras || []) {
        s.parent?.remove(s)
        s.material.dispose()
      }
      if (!alive) continue
      if (entry.kind === 'star') {
        entry.system.grow = 1
        for (const planet of entry.system.planets) planet.holder.scale.setScalar(1)
      } else entry.planet.holder.scale.setScalar(1)
    }
  }

  // A cloud of gas spins up and contracts, the star ignites with a flash, then its planets form.
  function ignite(entry, k) {
    const { system } = entry
    if (!entry.ready) {
      entry.ready = true
      system.grow = 0.001
      system.label.element.classList.add('born')
      entry.clouds = [0, 1, 2].map((i) => {
        const cloud = sprite(tex.nebula[i], 0.001, 0)
        cloud.material.color.copy(i === 1 ? new THREE.Color('#ff9f6b') : system.colorGoal)
        cloud.material.rotation = Math.random() * Math.PI * 2
        system.group.add(cloud)
        return cloud
      })
      entry.flash = sprite(tex.glow, 0.001, 0)
      entry.flash.material.color.set('#f2f6ff')
      system.group.add(entry.flash)
      entry.extras = [...entry.clouds, entry.flash]
      for (const planet of system.planets) {
        planet.holder.scale.setScalar(0.001)
        planet.label.element.classList.add('born')
      }
    }
    const pull = smooth(0, 0.55, k)
    entry.clouds.forEach((cloud, i) => {
      cloud.scale.setScalar(0.001 + (44 - i * 8) * (1 - pull * 0.9))
      cloud.material.opacity = smooth(0, 0.2, k) * (1 - smooth(0.55, 0.72, k)) * (0.5 - i * 0.1)
      cloud.material.rotation += (0.004 + pull * 0.05) * (i % 2 ? -1 : 1)
    })
    const lit = Math.max(0, (k - 0.55) / 0.45)
    if (lit > 0 && !entry.lit) {
      entry.lit = true
      onSound?.('star-birth')
    }
    system.grow = lit ? Math.max(0.001, easeOutBack(Math.min(1, lit / 0.5))) : 0.001
    const bang = Math.min(1, lit / 0.3)
    entry.flash.scale.setScalar(0.001 + bang * 32)
    entry.flash.material.opacity = lit ? (1 - bang) * (1 - bang) : 0
    system.planets.forEach((planet, i) => {
      planet.holder.scale.setScalar(Math.max(0.001, easeOutBack(smooth(0.66 + i * 0.06, 0.86 + i * 0.06, k))))
    })
  }

  // A ring of dust closes in on the orbit and a new planet swells out of it.
  function gather(entry, k) {
    const { planet } = entry
    if (!entry.ready) {
      entry.ready = true
      planet.holder.scale.setScalar(0.001)
      planet.label.element.classList.add('born')
      entry.ring = sprite(tex.ring, 0.001, 0)
      entry.ring.material.color.set('#bcd6ff')
      planet.pivot.add(entry.ring)
      entry.extras = [entry.ring]
      onSound?.('planet-birth')
    }
    entry.ring.position.copy(planet.holder.position)
    entry.ring.scale.setScalar(1 + 9 * (1 - smooth(0, 0.45, k)))
    entry.ring.material.opacity = smooth(0, 0.15, k) * (1 - smooth(0.4, 0.56, k)) * 0.8
    planet.holder.scale.setScalar(Math.max(0.001, easeOutBack(smooth(0.38, 0.85, k))))
  }

  // ---------- comets & shooting stars ----------

  // A reply leaves from just below the viewer and arcs into the planet it was sent to.
  function comet(handle) {
    const planet = planets.get(handle)
    if (!planet || reduceMotion || !active) return
    const head = sprite(tex.glow, 1.6, 1)
    head.material.color.set('#e8f1ff')
    const points = 28
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points * 3), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(points * 3), 3))
    const tail = new THREE.Line(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    tail.frustumCulled = false
    scene.add(head, tail)
    const start = camera.localToWorld(new THREE.Vector3(3, -2.6, -7))
    comets.push({ planet, head, tail, start, trail: [], points, begin: performance.now(), duration: 1300 })
  }

  function stepComets(now) {
    for (const c of [...comets]) {
      const k = Math.min(1, (now - c.begin) / c.duration)
      const alive = planets.get(c.planet.handle) === c.planet
      if (!c.arrived) {
        const goal = c.planet.holder.getWorldPosition(tmp)
        const e = k * k * (3 - 2 * k)
        const bend = tmp2.copy(c.start).lerp(goal, 0.5)
        bend.y += c.start.distanceTo(goal) * 0.25
        // Quadratic Bézier from the viewer, over the top, into the planet.
        const p = new THREE.Vector3()
          .copy(c.start)
          .multiplyScalar((1 - e) * (1 - e))
          .addScaledVector(bend, 2 * (1 - e) * e)
          .addScaledVector(goal, e * e)
        c.head.position.copy(p)
        c.trail.unshift(p)
        c.trail.length = Math.min(c.trail.length, c.points)
        const pos = c.tail.geometry.attributes.position
        const col = c.tail.geometry.attributes.color
        for (let i = 0; i < c.points; i++) {
          const q = c.trail[Math.min(i, c.trail.length - 1)]
          pos.setXYZ(i, q.x, q.y, q.z)
          const f = Math.pow(1 - i / c.points, 1.6)
          col.setXYZ(i, 0.55 * f, 0.75 * f, f)
        }
        pos.needsUpdate = true
        col.needsUpdate = true
        if (k < 1 && alive) continue
        c.arrived = now
        scene.remove(c.tail)
        c.tail.geometry.dispose()
        c.tail.material.dispose()
        if (alive) {
          onSound?.('comet')
          c.planet.holder.add(c.head)
          c.head.position.set(0, 0, 0)
        }
      }
      // A soft splash of light on the planet, then gone.
      const s = Math.min(1, (now - c.arrived) / 700)
      c.head.scale.setScalar(1.6 + s * 6)
      c.head.material.opacity = (1 - s) * (1 - s)
      if (s < 1 && alive) continue
      c.head.parent?.remove(c.head)
      c.head.material.dispose()
      comets.splice(comets.indexOf(c), 1)
    }
  }

  // Work finished somewhere: a shooting star crosses the sky behind the systems.
  function cameraBasis() {
    const forward = camera.getWorldDirection(new THREE.Vector3())
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize()
    const up = new THREE.Vector3().crossVectors(right, forward).normalize()
    return { forward, right, up }
  }

  function shootingStar({ velocity = null, delay = 0, offset = null } = {}) {
    if (reduceMotion || !active) return
    const { forward, right, up } = cameraBasis()
    const from = camera.position
      .clone()
      .addScaledVector(forward, 520)
      .addScaledVector(right, offset ? offset.x : (Math.random() - 0.5) * 520)
      .addScaledVector(up, offset ? offset.y : 90 + Math.random() * 160)
    velocity ||= right
      .clone()
      .multiplyScalar(Math.random() < 0.5 ? -1 : 1)
      .addScaledVector(up, -0.5)
      .normalize()
      .multiplyScalar(380 + Math.random() * 120)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(6), 3))
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    line.frustumCulled = false
    line.visible = false
    const tint = METEOR_TINTS[Math.floor(Math.random() * METEOR_TINTS.length)]
    // A small glowing head makes the streak read even though lines are one pixel wide.
    const head = sprite(tex.glow, 4 + Math.random() * 3, 0)
    head.material.color.copy(tint)
    head.visible = false
    scene.add(line, head)
    meteors.push({ line, head, tint, from, velocity, begin: performance.now() + delay, duration: 1000 + Math.random() * 600 })
  }

  function meteorShower(count = 4 + Math.floor(Math.random() * 4)) {
    if (reduceMotion || !active) return
    const { right, up } = cameraBasis()
    const dir = right.multiplyScalar(Math.random() < 0.5 ? -1 : 1).addScaledVector(up, -0.6).normalize()
    for (let i = 0; i < count; i++) {
      shootingStar({
        velocity: dir.clone().multiplyScalar(420 + Math.random() * 140),
        delay: i * (220 + Math.random() * 650),
        offset: { x: (Math.random() - 0.5) * 640, y: 40 + Math.random() * 240 }
      })
    }
  }

  function stepMeteors(now) {
    for (const m of [...meteors]) {
      const k = (now - m.begin) / m.duration
      if (k < 0) continue
      if (k >= 1) {
        scene.remove(m.line, m.head)
        m.line.geometry.dispose()
        m.line.material.dispose()
        m.head.material.dispose()
        meteors.splice(meteors.indexOf(m), 1)
        continue
      }
      m.line.visible = m.head.visible = true
      const head = tmp.copy(m.from).addScaledVector(m.velocity, k * (m.duration / 1000))
      const tailEnd = tmp2.copy(head).addScaledVector(m.velocity, -0.3 * smooth(0, 0.3, k))
      const b = Math.sin(Math.PI * k)
      m.line.geometry.attributes.position.array.set([head.x, head.y, head.z, tailEnd.x, tailEnd.y, tailEnd.z])
      m.line.geometry.attributes.color.array.set([m.tint.r * b, m.tint.g * b, m.tint.b * b, 0, 0, 0])
      m.line.geometry.attributes.position.needsUpdate = true
      m.line.geometry.attributes.color.needsUpdate = true
      m.head.position.copy(head)
      m.head.material.opacity = b
    }
  }

  // ---------- stardust ----------

  // The page pays for these with the stardust that agents' tokens pile up. False when
  // nothing can be shown right now (another view, or reduced motion).
  function spend(kind) {
    if (reduceMotion || !active) return false
    if (kind === 'shower') meteorShower(16)
    else if (kind === 'aurora') auroraUntil = time + 120
    else if (kind === 'swarm') cometSwarm()
    else if (kind === 'fireworks') {
      for (let i = 0; i < 7; i++) setTimeout(() => active && farNova({ show: true }), i * (550 + Math.random() * 500))
    }
    return true
  }

  // Six comets in pastel colours, one after another from beside the viewer, each steered
  // through the galaxy's pull into a planet on screen (the core if there are none).
  function cometSwarm() {
    const onScreen = [...planets.values()].filter((planet) => {
      if (planet.swallowing) return false
      const p = planet.holder.getWorldPosition(tmp).project(camera)
      return p.z < 1 && Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9
    })
    const targets = onScreen.sort(() => Math.random() - 0.5).slice(0, 6)
    for (let i = 0; i < 6; i++) setTimeout(() => active && swarmComet(targets[i % Math.max(1, targets.length)]), i * 420)
  }

  function swarmComet(planet) {
    if (planet && planets.get(planet.handle) !== planet) return
    const { forward, right, up } = cameraBasis()
    const goal = planet ? planet.holder.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3()
    const range = camera.position.distanceTo(goal)
    const from = camera.position
      .clone()
      .addScaledVector(forward, range * 0.12)
      .addScaledVector(right, (Math.random() < 0.5 ? -1 : 1) * range * (0.35 + Math.random() * 0.25))
      .addScaledVector(up, range * (0.1 + Math.random() * 0.25))
    const v = goal.clone().sub(from).setLength(Math.min(MAX_THROW, 60 + range * 0.5))
    const reach = planet ? 1.1 * planet.size + 0.3 : 9
    steer({ at: goal, reach, system: null, turns: Boolean(planet) }, v, from)
    launch(from, v, cometTint(), true)
  }

  // An app's tokens passed a milestone: bursts of colour round its star.
  function celebrate(system) {
    const s = system.size * system.grow
    PASTELS.forEach((color, i) => {
      setTimeout(() => {
        if (systems.get(system.app) !== system) return
        const at = new THREE.Vector3((Math.random() - 0.5) * 7, Math.random() * 5, (Math.random() - 0.5) * 7).multiplyScalar(s)
        burst(at, { color, size: 15 * s, parent: system.group, sparks: 12, ms: 1900 })
      }, i * 380)
    })
    onSound?.('celebrate')
  }

  // ---------- far events ----------

  // Now and then something happens out there: a supernova flares in the sky, or gas in an
  // arm gathers and a new star lights up. Both happen where the viewer is looking.
  function cosmicEvent(kind = Math.random() < 0.5 ? 'nova' : 'birth') {
    if (reduceMotion || !active) return
    if (kind === 'birth' && starBirth()) return
    farNova()
  }

  // show: one of a stardust firework display, spread wider and up the sky, not counted as
  // a supernova seen.
  function farNova({ show = false } = {}) {
    const { forward, right, up } = cameraBasis()
    const group = new THREE.Group()
    group.position
      .copy(camera.position)
      .addScaledVector(forward, 2600)
      .addScaledVector(right, (Math.random() - 0.5) * (show ? 2600 : 1700))
      .addScaledVector(up, (Math.random() - (show ? 0.1 : 0.3)) * 900)
    const tint = Math.floor(Math.random() * PASTELS.length)
    const color = new THREE.Color(PASTELS[tint])
    const core = sprite(tex.glow, 0.001, 0)
    core.material.color.copy(color).lerp(WHITE, 0.5)
    const spikes = sprite(tex.spikes, 0.001, 0)
    spikes.material.color.copy(color).lerp(WHITE, 0.3)
    spikes.material.rotation = Math.random() * Math.PI
    const shell = sprite(tex.ring, 0.001, 0)
    shell.material.color.copy(color)
    // The remnant: two veils of gas, its own colour and the next pastel along.
    const remnant = [0, 1].map((i) => {
      const cloud = sprite(tex.nebula[(tint + i) % tex.nebula.length], 0.001, 0)
      cloud.material.color.set(PASTELS[(tint + i * 2) % PASTELS.length])
      cloud.material.rotation = Math.random() * Math.PI * 2
      return cloud
    })
    group.add(...remnant, core, spikes, shell)
    scene.add(group)
    events.push({ kind: 'nova', parent: scene, group, core, spikes, shell, remnant, begin: time, duration: show ? 30 : 45 })
    if (show) return onSound?.('firework')
    onSound?.('far-nova')
    onPlay?.({ type: 'supernova' })
  }

  function starBirth() {
    // A well-formed gas cloud in an arm, on screen.
    const candidates = clouds.children.filter((cloud) => {
      if (cloud.material.opacity < 0.12) return false
      const p = cloud.getWorldPosition(tmp).project(camera)
      return p.z < 1 && Math.abs(p.x) < 0.8 && Math.abs(p.y) < 0.8
    })
    const cloud = candidates[Math.floor(Math.random() * candidates.length)]
    if (!cloud) return false
    const size = cloud.userData.size
    const group = new THREE.Group()
    group.position.copy(cloud.position).add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(size * 0.3))
    const gas = sprite(tex.nebula[Math.floor(Math.random() * tex.nebula.length)], 0.001, 0)
    gas.material.color.set(PASTELS[Math.random() < 0.5 ? 0 : 2])
    gas.material.rotation = Math.random() * Math.PI * 2
    const core = sprite(tex.glow, 0.001, 0)
    core.material.color.set('#e4ecff')
    const spikes = sprite(tex.spikes, 0.001, 0)
    spikes.material.color.set('#dfe8ff')
    spikes.material.rotation = Math.random() * Math.PI
    const shell = sprite(tex.ring, 0.001, 0)
    shell.material.color.set(PASTELS[1])
    group.add(gas, core, spikes, shell)
    disc.add(group)
    events.push({ kind: 'birth', parent: disc, group, gas, core, spikes, shell, size, begin: time, duration: 40 })
    return true
  }

  function stepEvents(dt) {
    for (const e of [...events]) {
      const s = time - e.begin
      if (s >= e.duration) {
        e.parent.remove(e.group)
        for (const part of e.group.children) part.material.dispose()
        events.splice(events.indexOf(e), 1)
        continue
      }
      if (e.kind === 'nova') {
        // A star brightens a thousandfold in a second, fades over the next few, and its
        // shell of gas spreads and glows for most of a minute.
        const flare = smooth(0, 0.8, s) * (1 - smooth(1.2, 9, s))
        const end = 1 - smooth(30, 45, s)
        e.core.scale.setScalar(30 + 300 * flare)
        e.core.material.opacity = (0.25 + 0.75 * flare) * end
        e.spikes.scale.setScalar(0.001 + 520 * flare)
        e.spikes.material.opacity = flare * 0.8
        const shell = smooth(0.6, 14, s)
        e.shell.scale.setScalar(40 + 900 * Math.sqrt(shell))
        e.shell.material.opacity = (1 - shell) * 0.55 * smooth(0.6, 1.2, s)
        const spread = smooth(1, 45, s)
        e.remnant.forEach((cloud, i) => {
          cloud.scale.setScalar((250 + 650 * Math.sqrt(spread)) * (1 + i * 0.4))
          cloud.material.opacity = Math.pow(Math.sin(Math.PI * spread), 0.8) * (0.32 - i * 0.1)
          cloud.material.rotation += (i ? -0.01 : 0.01) * dt
        })
        continue
      }
      // Gas draws together into a bright knot, the star lights with a flash and a ring,
      // blows the leftover gas away and shines on for a while.
      const { size } = e
      if (s > 5 && !e.lit) {
        e.lit = true
        onSound?.('far-birth')
        onPlay?.({ type: 'starbirth' })
      }
      const gather = smooth(0, 5, s)
      const blow = smooth(5, 20, s)
      e.gas.scale.setScalar(size * (1.3 - 0.8 * gather + 1.2 * blow))
      e.gas.material.opacity = 0.5 * smooth(0, 2, s) * (1 - blow)
      const flash = smooth(5, 5.4, s) * (1 - smooth(5.4, 8, s))
      const life = 1 - smooth(32, 40, s)
      const twinkle = s > 5 ? 0.9 + 0.1 * Math.sin(s * 3.1) : 1
      e.core.scale.setScalar(Math.max(0.001, size * (0.15 * gather + 1.1 * flash) * twinkle * (0.4 + 0.6 * life)))
      e.core.material.opacity = (0.5 + 0.5 * smooth(4, 5, s)) * gather * life
      e.spikes.scale.setScalar(0.001 + size * 0.9 * smooth(5, 6, s) * (1 + flash))
      e.spikes.material.opacity = 0.6 * smooth(5, 6, s) * life
      const ring = smooth(5, 9, s)
      e.shell.scale.setScalar(0.001 + size * (0.2 + 1.8 * Math.sqrt(ring)))
      e.shell.material.opacity = s > 5 ? (1 - ring) * 0.7 : 0
    }
  }

  // ---------- supernova remnants ----------

  // Where an app's star died, a shell of gas stays for three days: pink and teal threads
  // like the Veil, a faint glow inside and a neutron star blinking at the heart. It spreads
  // slowly and fades out over the last day and a half.
  const REMNANT_MS = 3 * 86_400_000
  const remnantTex = [remnantTexture(5), remnantTexture(17), remnantTexture(31)]
  const remnants = new Map() // app@diedAt -> its sprites

  function setRemnants(list) {
    const keep = new Set()
    for (const remnant of list) {
      const key = `${remnant.app}@${remnant.diedAt}`
      keep.add(key)
      if (!remnants.has(key)) remnants.set(key, makeRemnant(remnant))
    }
    for (const key of remnants.keys()) if (!keep.has(key)) dropRemnant(key)
  }

  function makeRemnant({ at, color, diedAt, seed }) {
    const group = new THREE.Group()
    group.position.fromArray(at)
    const pink = sprite(remnantTex[seed % 3], 1, 0)
    pink.material.color.set(color).lerp(new THREE.Color('#ff9fd0'), 0.6)
    pink.material.rotation = (seed % 628) / 100
    const teal = sprite(remnantTex[(seed + 1) % 3], 1, 0)
    teal.material.color.set('#8fe8ff')
    teal.material.rotation = ((seed >>> 5) % 628) / 100
    const haze = sprite(tex.nebula[seed % tex.nebula.length], 1, 0)
    haze.material.color.set('#c9b4ff')
    const pulsar = sprite(tex.glow, 1, 0)
    pulsar.material.color.set('#e6f4ff')
    group.add(haze, pink, teal, pulsar)
    decor.remnants.add(group)
    return { group, pink, teal, haze, pulsar, diedAt, phase: (seed % 100) / 16, spin: seed % 2 ? 0.012 : -0.012 }
  }

  function dropRemnant(key) {
    const remnant = remnants.get(key)
    decor.remnants.remove(remnant.group)
    for (const part of remnant.group.children) part.material.dispose()
    remnants.delete(key)
  }

  function stepRemnants(dt) {
    if (!remnants.size || !decor.remnants.visible) return
    const now = Date.now()
    for (const [key, r] of remnants) {
      const age = now - r.diedAt
      if (age > REMNANT_MS) {
        dropRemnant(key)
        continue
      }
      const k = age / REMNANT_MS
      // Settles in as the blast clears, fades over the last day and a half.
      const show = smooth(0, 20_000, age) * (1 - smooth(0.5, 1, k))
      const size = 26 + 22 * Math.sqrt(k)
      const d = r.group.getWorldPosition(tmp).distanceTo(camera.position)
      const near = smooth(size * 0.3, size * 1.2, d)
      const breathe = 0.85 + 0.15 * Math.sin(time * 0.3 + r.phase)
      r.pink.scale.setScalar(size)
      r.pink.material.opacity = 0.5 * show * near * breathe
      r.pink.material.rotation += r.spin * dt
      r.teal.scale.setScalar(size * 0.82)
      r.teal.material.opacity = 0.38 * show * near * (1.7 - breathe)
      r.teal.material.rotation -= r.spin * 0.7 * dt
      r.haze.scale.setScalar(size * 0.9)
      r.haze.material.opacity = 0.12 * show * near
      // The neutron star at the heart flashes like a lighthouse, a few times a second.
      r.pulsar.scale.setScalar(Math.max(1.2, d * 0.006))
      r.pulsar.material.opacity = show * (0.3 + 0.7 * Math.pow(Math.max(0, Math.sin(time * 8.2 + r.phase)), 8))
    }
  }

  // Jets from the galactic core: while agents work, two thin beams shoot out of the core's
  // poles with knots of light running up them. More agents, brighter and longer.
  function stepJets(dt) {
    jetLevel += (Math.min(1, busyAgents / 3) - jetLevel) * Math.min(1, dt * 0.4)
    jets.group.visible = decorOn.jets !== false && jetLevel > 0.01
    if (!jets.group.visible) return
    const length = 130 + 130 * jetLevel
    // Each beam is a flat strip that turns about its own axis to face the camera.
    const facing = Math.atan2(camera.position.x, camera.position.z)
    for (const beam of jets.beams) {
      beam.rotation.set(0, facing, beam.userData.dir > 0 ? 0 : Math.PI)
      beam.scale.set(9 + 5 * jetLevel, length, 1)
      beam.position.y = (beam.userData.dir * length) / 2
      beam.material.opacity = jetLevel * (0.5 + 0.06 * Math.sin(time * 7 + beam.userData.dir))
    }
    for (const knot of jets.knots) {
      const u = knot.userData
      u.t = (u.t + dt * u.speed) % 1
      knot.position.y = u.dir * u.t * length
      knot.scale.setScalar(2.5 + 4 * u.t)
      knot.material.opacity = jetLevel * Math.sin(Math.PI * u.t) * 0.55
    }
  }

  // ---------- play ----------

  // Comets the viewer throws: pull back and let go. Every star and the galactic core pull
  // on them; too close and they're swallowed, into a planet and they splash.
  const aimLine = new THREE.Line(lineGeometry(AIM_STEPS), glowLine())
  const pullLine = new THREE.Line(lineGeometry(2), new THREE.LineBasicMaterial({ color: '#8fa4d8', transparent: true, opacity: 0.45, depthWrite: false }))
  const aimHead = sprite(tex.glow, 3, 0.95)
  // A ring round whatever the aimed throw will fall into.
  const aimMark = sprite(tex.ring, 1, 0)
  aimMark.material.depthTest = false
  aimMark.renderOrder = 40
  for (const part of [aimLine, pullLine, aimHead, aimMark]) {
    part.frustumCulled = false
    part.visible = false
  }
  scene.add(aimLine, pullLine, aimHead, aimMark)
  const spot = new THREE.Vector3()
  const proj1 = new THREE.Vector3()
  const proj2 = new THREE.Vector3()
  const screenA = new THREE.Vector3()
  const screenB = new THREE.Vector3()
  const shade = new THREE.Color()
  let lastTint = -1

  // Every throw gets its own colours, never the same head twice running. Now and then one
  // trails a whole rainbow.
  function cometTint() {
    let i
    do i = Math.floor(Math.random() * COMET_COLORS.length)
    while (i === lastTint)
    lastTint = i
    const tail = COMET_COLORS[(i + 2 + Math.floor(Math.random() * 4)) % COMET_COLORS.length]
    return { head: new THREE.Color(COMET_COLORS[i]), tail: new THREE.Color(tail), rainbow: Math.random() < 0.1 ? Math.random() : -1 }
  }

  // The colour k of the way back from the head (0) to the tail's end (1).
  function tintAt(tint, k, out) {
    if (tint.rainbow >= 0) return out.setHSL((tint.rainbow + k * 0.85 + time * 0.15) % 1, 0.85, 0.72)
    return out.copy(tint.head).lerp(tint.tail, Math.min(1, k * 1.3))
  }

  // How far one screen pixel reaches this far in front of the camera.
  function worldPerPixel(depth) {
    return (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, canvas.clientHeight)
  }

  function toScreen(at, rect, out) {
    out.copy(at).project(camera)
    return out.set(((out.x + 1) * rect.width) / 2, ((1 - out.y) * rect.height) / 2, 0)
  }

  // The first thing a throw from the aim's start, heading (sx, sy) across the screen, would
  // seem to run into: the core, a star or a planet.
  function aimedAt(sx, sy) {
    const rect = canvas.getBoundingClientRect()
    const forward = camera.getWorldDirection(tmp2)
    toScreen(aim.from, rect, screenA)
    let best = null
    // system: the star itself; null for the core and for planets. turns: moves with the disc.
    const consider = (at, radius, reach, system = null, turns = true) => {
      const depth = tmp.subVectors(at, camera.position).dot(forward)
      if (depth <= 1) return
      toScreen(at, rect, screenB)
      const wx = screenB.x - screenA.x
      const wy = screenB.y - screenA.y
      const along = wx * sx + wy * sy
      const off = Math.abs(wx * sy - wy * sx)
      if (along < 6 || off > Math.max(12, (1.3 * radius) / worldPerPixel(depth)) + along * 0.03) return
      if (!best || along < best.along) best = { at: at.clone(), along, reach, system, turns }
    }
    consider(spot.set(0, 0, 0), 12, 9, null, false)
    for (const system of systems.values()) {
      const s = system.size * system.grow
      consider(system.group.getWorldPosition(spot), 2.5 * s, 1.6 * s, system)
    }
    for (const planet of planets.values()) {
      if (!planet.swallowing) consider(planet.holder.getWorldPosition(spot), 1.1 * planet.size + 0.3, 1.1 * planet.size + 0.3)
    }
    return best
  }

  // The galaxy turns while a comet flies: everything but the core moves on with the disc.
  function turnWithDisc(sources, dt) {
    for (const source of sources) if (source.system) source.at.applyAxisAngle(UP, DISC_SPIN * dt)
  }

  // Gravity bends every path, so a throw sent straight at its target falls short or wide.
  // Fly it ahead of time, see where it misses, and turn the heading to cancel the miss.
  function steer(target, v, from = aim.from) {
    const speed = v.length()
    const p = new THREE.Vector3()
    const velocity = new THREE.Vector3()
    const goal = new THREE.Vector3()
    const miss = new THREE.Vector3()
    for (let n = 0; n < 5; n++) {
      const sources = attractors()
      p.copy(from)
      velocity.copy(v)
      goal.copy(target.at)
      let best = Infinity
      let bestAt = 0
      for (let i = 1; i <= 180; i++) {
        const hit = fall(p, velocity, 1 / 30, sources)
        turnWithDisc(sources, 1 / 30)
        if (target.turns) goal.applyAxisAngle(UP, DISC_SPIN / 30)
        const gap = p.distanceTo(goal)
        if (gap < best) {
          best = gap
          bestAt = i / 30
          miss.subVectors(p, goal)
        } else if (gap > best * 1.5 + 20) break // past it and leaving
        if (hit) {
          if (hit.system === target.system && (hit.system || !target.turns)) return
          break
        }
      }
      if (best < target.reach) return
      // Moving the start velocity by dv moves the point reached at time t by about dv * t.
      v.addScaledVector(miss, -1 / Math.max(0.2, bestAt)).setLength(speed)
    }
  }

  function attractors() {
    const list = [{ at: new THREE.Vector3(), gm: CORE_GM, reach: 9, system: null }]
    for (const system of systems.values()) {
      const s = system.size * system.grow
      list.push({ at: system.group.getWorldPosition(new THREE.Vector3()), gm: STAR_GM * s * s, reach: 1.6 * s, system })
    }
    return list
  }

  // Moves p and v on by dt; returns the attractor it fell into, if any.
  function fall(p, v, dt, sources) {
    const h = dt / 4
    for (let n = 0; n < 4; n++) {
      for (const s of sources) {
        tmp.copy(s.at).sub(p)
        v.addScaledVector(tmp, (s.gm * h) / Math.pow(tmp.lengthSq() + SOFTEN, 1.5))
      }
      tmp3.copy(p)
      p.addScaledVector(v, h)
      for (const s of sources) if (segmentGap(tmp3, p, s.at) < s.reach) return s
    }
    return null
  }

  function planetAlong(a, b) {
    for (const planet of planets.values()) {
      if (planet.swallowing) continue
      if (segmentGap(a, b, planet.holder.getWorldPosition(spot)) < 1.1 * planet.size + 0.3) return planet
    }
    return null
  }

  function pointOn(plane, event, out) {
    const rect = canvas.getBoundingClientRect()
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    return raycaster.ray.intersectPlane(plane, out)
  }

  // Aim in the disc's plane when looking down on it, else in a plane facing the camera.
  function startAim(event) {
    const forward = camera.getWorldDirection(new THREE.Vector3())
    const plane =
      Math.abs(forward.y) > 0.3 ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -controls.target.y) : new THREE.Plane().setFromNormalAndCoplanarPoint(forward.negate(), controls.target)
    const from = pointOn(plane, event, new THREE.Vector3())
    if (!from || from.distanceTo(camera.position) > 3000) return false
    aim = { plane, from, to: from.clone(), x: event.clientX, y: event.clientY, pulled: 0, v: new THREE.Vector3(), tint: cometTint() }
    controls.enabled = false
    canvas.style.cursor = 'crosshair'
    tip.hidden = true
    aimHead.position.copy(from)
    aimHead.material.color.copy(aim.tint.head)
    aimHead.visible = aimLine.visible = pullLine.visible = true
    moveAim(event)
    return true
  }

  function moveAim(event) {
    // Pulled out past the horizon of the disc's plane: carry on in one facing the camera.
    if (!pointOn(aim.plane, event, aim.to)) {
      const facing = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(tmp).negate(), aim.from)
      pointOn(facing, event, aim.to)
    }
    const sx = aim.x - event.clientX
    const sy = aim.y - event.clientY
    aim.pulled = Math.hypot(sx, sy)
    // A slingshot: it flies away from where it was pulled to, faster the further. The pull
    // is measured on screen, so a tug towards the horizon counts the same as one sideways;
    // up close, where everything is small, a pull counts for more.
    const depth = camera.position.distanceTo(aim.from)
    const reach = Math.max(1, Math.pow(400 / Math.max(1, depth), 0.6))
    const speed = Math.min(MAX_THROW, aim.pulled * worldPerPixel(depth) * 1.6 * reach)
    // The screen can't show how deep a throw goes. Aimed at something, it goes for that
    // thing, at its depth; aimed at empty space, it stays in the aiming plane.
    const target = aim.pulled < 14 ? null : aimedAt(sx / aim.pulled, sy / aim.pulled)
    aim.target = target
    aim.v.subVectors(target ? target.at : aim.from, target ? aim.from : aim.to).setLength(speed)
    if (target && speed > 1) steer(target, aim.v)
  }

  // The path it will take, bent by the stars, drawn while aiming.
  function stepAim() {
    const { from, to, v, tint } = aim
    pullLine.geometry.attributes.position.array.set([from.x, from.y, from.z, to.x, to.y, to.z])
    pullLine.geometry.attributes.position.needsUpdate = true
    aimHead.position.copy(from)
    if (tint.rainbow >= 0) tintAt(tint, 0, aimHead.material.color)
    aimHead.scale.setScalar(Math.max(1.4, camera.position.distanceTo(from) * 0.014) * (1 + 0.15 * Math.sin(time * 9)))
    const sources = attractors()
    const p = from.clone()
    const last = new THREE.Vector3()
    const velocity = v.clone()
    const pos = aimLine.geometry.attributes.position
    const col = aimLine.geometry.attributes.color
    const near = camera.position.distanceTo(from)
    let stopped = aim.pulled < 14
    let end = null
    for (let i = 0; i < AIM_STEPS; i++) {
      if (i && !stopped) {
        last.copy(p)
        const hit = fall(p, velocity, 1 / 30, sources)
        turnWithDisc(sources, 1 / 30)
        const planet = hit ? null : planetAlong(last, p)
        if (planet) end = { at: planet.holder.getWorldPosition(new THREE.Vector3()), size: 6 * planet.size + 2 }
        else if (hit) end = { at: hit.at, size: hit.system ? 10 * hit.system.size * hit.system.grow : 50 }
        stopped = Boolean(end)
      }
      pos.setXYZ(i, p.x, p.y, p.z)
      // Fainter where the path runs away from the eye, brighter where it comes closer.
      const depth = Math.min(1.25, Math.max(0.4, Math.pow(near / Math.max(1, camera.position.distanceTo(p)), 0.7)))
      const f = stopped ? 0 : Math.pow(1 - i / AIM_STEPS, 1.3) * 0.8 * depth
      tintAt(tint, i / AIM_STEPS, shade).lerp(WHITE, 0.25)
      col.setXYZ(i, shade.r * f, shade.g * f, shade.b * f)
    }
    pos.needsUpdate = true
    col.needsUpdate = true
    aimMark.visible = Boolean(end)
    if (end) {
      const beat = Math.sin(time * 6)
      aimMark.position.copy(end.at)
      aimMark.scale.setScalar(end.size * (1 + 0.12 * beat))
      aimMark.material.opacity = 0.6 + 0.25 * beat
      aimMark.material.color.copy(tint.head)
    }
  }

  function endAim() {
    aim = null
    controls.enabled = true
    canvas.style.cursor = ''
    aimHead.visible = aimLine.visible = pullLine.visible = aimMark.visible = false
  }

  function releaseAim() {
    const { from, v, pulled, tint } = aim
    endAim()
    if (pulled < 14 || v.lengthSq() < 1) return
    launch(from, v, tint)
    onPlay?.({ type: 'throw' })
  }

  // gift: a comet of the stardust swarm, which the play log doesn't count.
  function launch(from, v, tint, gift = false) {
    const head = sprite(tex.glow, 2, 0)
    head.material.color.copy(tint.head)
    const tail = new THREE.Line(lineGeometry(TRAIL), glowLine())
    tail.frustumCulled = false
    scene.add(head, tail)
    thrown.push({ p: from.clone(), v: v.clone(), head, tail, trail: [], age: 0, end: 0, tint, gift, near: camera.position.distanceTo(from) })
    onSound?.('throw')
  }

  function stepThrown(dt) {
    if (!thrown.length) return
    const sources = attractors()
    for (const c of [...thrown]) {
      c.age += dt
      if (!c.end) {
        const start = c.p.clone()
        const hit = fall(c.p, c.v, dt, sources)
        const planet = hit ? null : planetAlong(start, c.p)
        if (hit || planet) collide(hit, planet, c.tint, c.gift)
        if (hit || planet || c.age > 30 || c.p.length() > 2400) c.end = c.age
        c.trail.unshift(c.p.clone())
        c.trail.length = Math.min(c.trail.length, TRAIL)
      } else c.trail.pop()
      if (!c.trail.length) {
        scene.remove(c.head, c.tail)
        c.head.material.dispose()
        c.tail.geometry.dispose()
        c.tail.material.dispose()
        thrown.splice(thrown.indexOf(c), 1)
        continue
      }
      // Once it's gone, the tail draws in after it.
      const pos = c.tail.geometry.attributes.position
      const col = c.tail.geometry.attributes.color
      for (let i = 0; i < TRAIL; i++) {
        const q = c.trail[Math.min(i, c.trail.length - 1)]
        pos.setXYZ(i, q.x, q.y, q.z)
        const f = i < c.trail.length ? Math.pow(1 - i / TRAIL, 1.6) : 0
        tintAt(c.tint, i / TRAIL, shade)
        col.setXYZ(i, shade.r * f, shade.g * f, shade.b * f)
      }
      pos.needsUpdate = true
      col.needsUpdate = true
      c.head.position.copy(c.p)
      if (c.tint.rainbow >= 0) tintAt(c.tint, 0, c.head.material.color)
      // Bigger as it comes towards the eye, smaller as it flies off into the deep.
      const far = Math.max(1, camera.position.distanceTo(c.p))
      c.head.scale.setScalar(Math.max(1.4, far * 0.012 * Math.min(2.5, Math.sqrt(c.near / far))))
      c.head.material.opacity = c.end ? 0 : Math.min(1, c.age * 4)
    }
  }

  function collide(hit, planet, tint, gift = false) {
    const play = gift ? () => {} : (event) => onPlay?.(event)
    if (planet) {
      burst(new THREE.Vector3(), { color: tint.head.clone().lerp(WHITE, 0.3), size: 5 * planet.size, parent: planet.holder, sparks: 6 })
      strike(planet, tint.head)
      onSound?.('comet')
      play({ type: 'splash', app: planet.system.app })
    } else if (hit.system) {
      const s = hit.system.size * hit.system.grow
      burst(new THREE.Vector3(), { color: hit.system.color, size: 16 * s, parent: hit.system.group, sparks: 8 })
      hit.system.gulp = 1
      onSound?.('gulp')
      play({ type: 'swallow', app: hit.system.app })
    } else {
      burst(new THREE.Vector3(), { color: new THREE.Color('#ffe9cf').lerp(tint.head, 0.5), size: 70, parent: disc, sparks: 12, ms: 1600 })
      onSound?.('core')
      play({ type: 'core' })
    }
  }

  // A comet leaves its mark on the planet it hits: knocked a little off its orbit, set
  // spinning and wobbling, and wrapped in a glow of the comet's colour that fades over a few
  // minutes (hits add up, colours mix). The third hit leaves a dust ring of that colour for
  // as long as the page is open.
  function strike(planet, color) {
    planet.holder.position.x += 1.4 * planet.size
    planet.knock = 1
    if (!planet.aura) {
      planet.aura = sprite(tex.glow, 1, 0)
      planet.aura.material.color.copy(color)
      planet.holder.add(planet.aura)
    } else planet.aura.material.color.lerp(color, 0.5)
    planet.auraHeat = Math.min(1.6, (planet.auraHeat || 0) + 0.6)
    planet.hits = (planet.hits || 0) + 1
    if (planet.hits === 3 && !planet.ring) {
      planet.ring = planetRing(hash(planet.handle), color.clone().lerp(WHITE, 0.25))
      planet.ring.scale.setScalar(0.001)
      planet.holder.add(planet.ring)
      onPlay?.({ type: 'ring', app: planet.system.app, planet: planet.item.planet })
    }
  }

  function stepStrike(planet, dt) {
    if (planet.knock > 0.001) {
      planet.knock *= Math.exp(-dt * 1.4)
      planet.mesh.rotation.y += dt * 6 * planet.knock
      planet.mesh.scale.setScalar(planet.size * (1 + 0.14 * planet.knock * Math.sin(time * 22)))
    }
    if (planet.auraHeat > 0.002) {
      planet.auraHeat *= Math.exp(-dt / 180)
      planet.aura.scale.setScalar(5 * planet.size * (1 + 0.15 * planet.auraHeat))
      planet.aura.material.opacity = Math.min(0.55, 0.38 * planet.auraHeat) * (0.85 + 0.15 * Math.sin(time * 2))
    } else if (planet.aura) planet.aura.material.opacity = 0
  }

  // A flash and a spreading ring; with sparks, a few glints flung outwards.
  function burst(at, { color = '#ffffff', size = 10, parent = scene, sparks = 0, ms = 1000, front = false } = {}) {
    const glow = sprite(tex.glow, 0.001, 0)
    const ring = sprite(tex.ring, 0.001, 0)
    glow.material.color.set(color)
    ring.material.color.set(color)
    const glints = []
    for (let i = 0; i < sparks; i++) {
      const s = sprite(tex.glow, size * 0.14, 0)
      s.material.color.set(color).lerp(WHITE, 0.4)
      glints.push({ s, v: new THREE.Vector3().randomDirection().multiplyScalar(size * (1 + Math.random() * 1.4)) })
    }
    const parts = [glow, ring, ...glints.map((g) => g.s)]
    for (const part of parts) {
      part.position.copy(at)
      if (front) {
        part.material.depthTest = false
        part.renderOrder = 40
      }
      parent.add(part)
    }
    bursts.push({ glow, ring, glints, parts, parent, size, start: performance.now(), ms })
  }

  function stepBursts(now, dt) {
    for (const b of [...bursts]) {
      const k = (now - b.start) / b.ms
      if (k >= 1) {
        for (const part of b.parts) {
          b.parent.remove(part)
          part.material.dispose()
        }
        bursts.splice(bursts.indexOf(b), 1)
        continue
      }
      b.glow.scale.setScalar(b.size * (0.5 + 1.3 * Math.sqrt(k)))
      b.glow.material.opacity = Math.pow(1 - k, 2)
      b.ring.scale.setScalar(b.size * (0.3 + 2.8 * Math.sqrt(k)))
      b.ring.material.opacity = (1 - k) * 0.75
      for (const g of b.glints) {
        g.s.position.addScaledVector(g.v, dt * (1 - k))
        g.s.material.opacity = Math.pow(1 - k, 1.5)
      }
    }
  }

  // Click a shooting star (or the far comet) as it passes to catch it.
  function catchAt(event) {
    if (reduceMotion) return false
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const meteor = meteors.find((m) => m.head.visible && screenGap(m.head.position, tmp.fromArray(m.line.geometry.attributes.position.array, 3), x, y, rect) < CATCH_PX)
    if (meteor) {
      burst(meteor.head.position, { color: meteor.tint, size: camera.position.distanceTo(meteor.head.position) * 0.06, sparks: 10 })
      meteor.begin = -Infinity
      onSound?.('catch')
      onPlay?.({ type: 'meteor', tint: METEOR_TINTS.indexOf(meteor.tint) })
      return true
    }
    const head = drifter.head
    if (drifter.group.visible && head.material.opacity > 0.3 && screenGap(head.position, head.position, x, y, rect) < CATCH_PX * 1.3) {
      burst(head.position, { color: '#c8f6ff', size: camera.position.distanceTo(head.position) * 0.06, sparks: 14 })
      drifter.stop(time)
      onSound?.('catch')
      onPlay?.({ type: 'comet' })
      return true
    }
    return false
  }

  // Distance on screen from (x, y) to the segment a-b; Infinity when it's behind the camera.
  function screenGap(a, b, x, y, rect) {
    const pa = proj1.copy(a).project(camera)
    const pb = proj2.copy(b).project(camera)
    if (pa.z > 1 || pb.z > 1) return Infinity
    const ax = ((pa.x + 1) / 2) * rect.width
    const ay = ((1 - pa.y) / 2) * rect.height
    const dx = ((pb.x + 1) / 2) * rect.width - ax
    const dy = ((1 - pb.y) / 2) * rect.height - ay
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / Math.max(1e-6, dx * dx + dy * dy)))
    return Math.hypot(ax + dx * t - x, ay + dy * t - y)
  }

  // The black hole: pick up a planet and it opens near the bottom of the view; drop the
  // planet in and the page asks whether to close that terminal.
  function holeSpot() {
    return { x: area.x + area.width / 2, y: area.y + area.height * 0.76 }
  }

  function grabPlanet(planet, at) {
    grab = { planet, near: false }
    controls.enabled = false
    holeGoal = 1
    tip.hidden = true
    ghost.querySelector('span').textContent = planet.item.planet
    ghost.dataset.status = planet.item.status
    ghost.classList.remove('held', 'near')
    ghost.hidden = false
    planet.label.element.classList.add('grabbed')
    moveGhost(at)
    onSound?.('grab')
  }

  function moveGhost(event) {
    const rect = host.getBoundingClientRect()
    let x = event.clientX - rect.left
    let y = event.clientY - rect.top
    const hole = holeSpot()
    const d = Math.hypot(x - hole.x, y - hole.y)
    grab.near = d < HOLE_PX * 1.15
    // Close by, the hole tugs the planet towards it.
    const pull = grab.near ? 0.5 : (1 - smooth(HOLE_PX * 1.15, HOLE_PX * 2.6, d)) * 0.3
    x += (hole.x - x) * pull
    y += (hole.y - y) * pull
    ghost.style.transform = `translate(${x}px, ${y}px) scale(${1 - pull * 0.6})`
    ghost.classList.toggle('near', grab.near)
    holeHeatGoal = grab.near ? 1 : (1 - smooth(HOLE_PX * 1.15, HOLE_PX * 3, d)) * 0.4
  }

  function dropPlanet(cancelled = false) {
    const { planet, near } = grab
    grab = null
    controls.enabled = true
    planet.label.element.classList.remove('grabbed')
    if (!cancelled && near && planets.get(planet.handle) === planet) {
      // It waits in the hole while the page asks.
      cleaning = planet
      holeHeatGoal = 0.6
      const hole = holeSpot()
      ghost.style.transform = `translate(${hole.x}px, ${hole.y}px) scale(0.5)`
      ghost.classList.add('held')
      onClean(planet.handle)
      return
    }
    ghost.hidden = true
    holeGoal = 0
    holeHeatGoal = 0
  }

  function cancelClean() {
    cleaning = null
    ghost.hidden = true
    ghost.classList.remove('held', 'near')
    holeGoal = 0
    holeHeatGoal = 0
  }

  function startSwallow(planet) {
    if (planet.swallowing) return
    planet.swallowing = true
    if (cleaning === planet) cleaning = null
    if (hovered === planet) hovered = null
    ghost.hidden = true
    ghost.classList.remove('held', 'near')
    holeGoal = 1
    holeHeatGoal = 1
    onSound?.('blackhole')
    dying.push({ kind: 'swallow', planet, start: performance.now(), duration: reduceMotion ? 1 : SWALLOW_MS })
  }

  // The planet leaves its orbit and spirals, ever faster and smaller, into the hole.
  function swallowPlanet(entry, k) {
    const { planet } = entry
    if (!entry.ready) {
      entry.ready = true
      planet.holder.remove(planet.hit)
      for (const beacon of planet.beacons) beacon.visible = false
      if (planet.spot) dropSpot(planet)
      planet.label.element.classList.add('gone')
      scene.attach(planet.holder)
      entry.from = planet.holder.position.clone()
      entry.depth = Math.max(HOLE_DEPTH, entry.from.distanceTo(camera.position))
      entry.scale = planet.holder.scale.x
      entry.orbitOpacity = planet.orbit.material.opacity
      planet.mesh.material.uniforms.rim.value.set('#ffc6a0')
    }
    // It falls along the line of sight to the hole, staying at its own depth, so on
    // screen it slides into the hole without looming up at the camera.
    const goal = hole.group.getWorldPosition(tmp2).sub(camera.position).setLength(entry.depth).add(camera.position)
    const axis = tmp3.copy(goal).sub(camera.position).normalize()
    const e = Math.pow(k, 1.6)
    const offset = tmp.copy(entry.from).sub(goal).multiplyScalar(1 - e).applyAxisAngle(axis, e * Math.PI * 4)
    planet.holder.position.copy(goal).add(offset)
    planet.holder.scale.setScalar(Math.max(0.001, entry.scale * (1 - smooth(0.4, 1, k))))
    planet.mesh.material.uniforms.rimStrength.value = 0.5 + 3 * smooth(0, 0.5, k)
    planet.orbit.material.opacity = entry.orbitOpacity * (1 - smooth(0, 0.3, k))
  }

  function stepHole(dt) {
    holeShow += (holeGoal - holeShow) * Math.min(1, dt * (holeGoal ? 6 : 3))
    holeHeat += (holeHeatGoal - holeHeat) * Math.min(1, dt * 4)
    hole.group.visible = holeShow > 0.01
    if (!hole.group.visible) return
    // HOLE_DEPTH in front of the camera, under its spot on the screen.
    const at = holeSpot()
    ndc.set((at.x / size.width) * 2 - 1, -(at.y / size.height) * 2 + 1)
    camera.updateMatrixWorld()
    const world = tmp.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).setLength(HOLE_DEPTH).add(camera.position)
    hole.group.position.copy(camera.worldToLocal(world))
    const perPixel = (2 * HOLE_DEPTH * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / fullView.height
    const grow = holeGoal ? easeOutBack(Math.min(1, holeShow)) : holeShow
    hole.group.scale.setScalar(Math.max(0.001, 2 * HOLE_PX * perPixel * grow * (1 + 0.1 * holeHeat)))
    hole.step(time, holeHeat, Math.min(1, holeShow))
  }

  function cancelPlay() {
    if (hold) cancelHold()
    if (aim) endAim()
    if (grab) dropPlanet(true)
    stopListening()
  }

  // ---------- leaving ----------

  function stepDying(now) {
    for (const entry of [...dying]) {
      if (now < entry.start) continue
      const k = Math.min(1, (now - entry.start) / entry.duration)
      if (entry.kind === 'planet') fadePlanet(entry, k)
      else if (entry.kind === 'swallow') swallowPlanet(entry, k)
      else nova(entry, k)
      if (k < 1) continue
      dying.splice(dying.indexOf(entry), 1)
      finish(entry)
    }
  }

  // The planet's rim flares, it shrinks to nothing, and a small spark marks the spot.
  function fadePlanet(entry, k) {
    const { planet } = entry
    if (!entry.ready) {
      entry.ready = true
      planet.holder.remove(planet.hit)
      for (const beacon of planet.beacons) beacon.visible = false
      if (planet.spot) dropSpot(planet)
      planet.label.element.classList.add('gone')
      // Swallowed by its swelling star, a planet glows red-hot; otherwise it flares blue-white.
      planet.mesh.material.uniforms.rim.value.set(entry.quiet ? '#ff8a4a' : '#cfe4ff')
      entry.orbitOpacity = planet.orbit.material.opacity
      if (!entry.quiet) {
        entry.spark = sprite(tex.glow, 0.001, 0)
        entry.spark.material.color.set('#d8ebff')
        entry.ring = sprite(tex.ring, 0.001, 0)
        entry.ring.material.color.set('#9fcbff')
        entry.spark.position.copy(planet.holder.position)
        entry.ring.position.copy(planet.holder.position)
        planet.pivot.add(entry.spark, entry.ring)
      }
    }
    const flare = smooth(0, 0.3, k)
    const shrink = smooth(0.25, 0.68, k)
    planet.mesh.material.uniforms.rimStrength.value = 0.5 + flare * 3.5
    planet.holder.scale.setScalar(Math.max(0.001, (1 + 0.12 * flare) * (1 - shrink)))
    planet.orbit.material.opacity = entry.orbitOpacity * (1 - smooth(0.15, 0.8, k))
    const pop = Math.max(0, (k - 0.62) / 0.38)
    if (entry.quiet) return
    if (pop > 0 && !entry.popped) {
      entry.popped = true
      onSound?.('planet')
    }
    entry.spark.scale.setScalar(0.001 + pop * 7)
    entry.spark.material.opacity = pop ? (1 - pop) * (1 - pop) * 0.95 : 0
    entry.ring.scale.setScalar(0.001 + Math.sqrt(pop) * 11)
    entry.ring.material.opacity = pop ? (1 - pop) * 0.7 : 0
  }

  // Red giant, collapse, then a burst of light and a slowly spreading remnant cloud.
  function nova(entry, k) {
    const { system } = entry
    if (!entry.ready) {
      entry.ready = true
      system.group.remove(system.hit)
      system.label.element.classList.add('gone')
      for (const s of system.sparkles) s.sprite.visible = false
      entry.core = system.core.material.uniforms.color.value.clone()
      for (const beacon of system.beacons) beacon.visible = false
      entry.glow = system.glow.material.color.clone()
      entry.remnant = [
        [tex.nebula[0], '#9b6bff', 0.4],
        [tex.nebula[1], '#3fc3ff', -0.3],
        [tex.nebula[2], '#ff8a5c', 0.15]
      ].map(([map, color, spin]) => {
        const cloud = sprite(map, 0.001, 0)
        cloud.material.color.set(color)
        cloud.material.rotation = Math.random() * Math.PI * 2
        cloud.userData.spin = spin
        system.group.add(cloud)
        return cloud
      })
      entry.flash = sprite(tex.glow, 0.001, 0)
      entry.flash.material.color.set('#eef4ff')
      // The shock front spreads flat through the orbit plane, so it reads as an ellipse like the orbits.
      entry.shock = new THREE.Mesh(
        plane,
        new THREE.MeshBasicMaterial({ map: tex.thinRing, color: '#a9cfff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      )
      entry.shock.rotation.x = -Math.PI / 2
      system.group.add(entry.flash)
      system.tilt.add(entry.shock)
    }
    const swell = smooth(0, 0.42, k)
    const crush = smooth(0.42, 0.48, k)
    const after = smooth(0.48, 1, k)
    const size = system.size
    system.core.material.uniforms.color.value.copy(entry.core).lerp(RED_GIANT, swell).lerp(WHITE_DWARF, crush)
    system.core.scale.setScalar(Math.max(0.001, 1.25 * size * (1 + 1.2 * swell) * (1 - 0.93 * crush) * (1 - after)))
    system.glow.material.color.copy(entry.glow).lerp(RED_GLOW, swell)
    system.glow.scale.setScalar(Math.max(0.001, 10 * size * (1 + 1.3 * swell + 0.25 * Math.sin(k * 40) * swell * (1 - crush)) * (1 - 0.88 * crush)))
    system.glow.material.opacity = 0.85 * (1 - after)
    system.corona.material.opacity = 0.2 * (1 - swell)
    system.spikes.material.opacity = 0.5 * (1 - swell)
    system.spikes2.material.opacity = 0.2 * (1 - swell)
    // Companions are swallowed along with the planets.
    for (const c of system.companions) c.holder.scale.setScalar(Math.max(0.001, 1 - smooth(0.15, 0.4, k)))
    if (k >= 0.48 && !entry.burst) {
      entry.burst = true
      onSound?.('star')
    }
    const blast = Math.max(0, (k - 0.48) / 0.52)
    const bang = Math.min(1, blast / 0.3)
    entry.flash.scale.setScalar(0.001 + bang * 46)
    entry.flash.material.opacity = blast ? (1 - bang) * (1 - bang) : 0
    entry.shock.scale.setScalar(0.001 + Math.sqrt(blast) * 110)
    entry.shock.material.opacity = blast ? Math.pow(1 - blast, 3) * 0.75 : 0
    entry.remnant.forEach((cloud, i) => {
      cloud.scale.setScalar(0.001 + (8 + i * 4) * (0.4 + Math.sqrt(blast) * 2.2))
      cloud.material.opacity = Math.pow(Math.sin(Math.PI * blast), 0.8) * (0.6 - i * 0.1)
      cloud.material.rotation += cloud.userData.spin * 0.004
    })
  }

  function finish(entry) {
    if (entry.kind === 'swallow') {
      const { planet } = entry
      scene.remove(planet.holder)
      burst(new THREE.Vector3(), { color: '#ffe6f2', size: 0.5, parent: hole.group, sparks: 8, ms: 900, front: true })
      holeGoal = 0
      holeHeatGoal = 0
      onPlay?.({ type: 'clean', app: planet.system.app })
      // Still listed until the next update: that one tidies it away.
      if (planets.get(planet.handle) === planet) planet.eaten = true
      else removePlanet(planet)
      return
    }
    if (entry.kind === 'planet') {
      const { planet } = entry
      if (entry.spark) {
        planet.pivot.remove(entry.spark, entry.ring)
        entry.spark.material.dispose()
        entry.ring.material.dispose()
      }
      removePlanet(planet)
      // Its star lives on, so move to whatever the pane shows now. (A dying star moves the camera itself.)
      if (!entry.quiet && entry.wasSelected && follow === planet.system && selected && planets.has(selected) && planets.get(selected).system !== follow) flyTo(selected)
      return
    }
    const { system } = entry
    // The page keeps the shell of gas it leaves, so it outlasts a reload.
    const at = system.group.position.toArray().map((v) => Math.round(v * 10) / 10)
    onRemnant?.({ app: system.app, at, color: `#${system.color.getHexString()}`, diedAt: Date.now(), seed: system.seed })
    disc.remove(system.group)
    disposeSystem(system)
    for (const s of [...entry.remnant, entry.flash, entry.shock]) s.material.dispose()
    if (follow !== system) return
    // The camera watched the star go; now head for whatever the pane shows.
    follow = null
    if (selected && planets.has(selected)) flyTo(selected)
    else overview()
  }

  // Apps sit on the spiral arms. Each one's place comes from its name alone, so a star stays
  // put while other apps come and go. Pinned apps sit near the core. A star that would land
  // on top of one already placed slides further out along its arm.
  // Names alone scattered stars unevenly: half of them could land on one arm, bunched
  // up. So a new star looks at a handful of spots of its own and takes the one farthest
  // from the stars already there, and keeps that spot from then on (remembered by the
  // page), so stars coming and going never move the others.
  function homesOf(apps, pinned) {
    const homes = new Map()
    for (const app of apps) if (spots.has(app)) homes.set(app, spotOf(app, spots.get(app), pinned(app)))
    const fresh = apps.filter((app) => !spots.has(app)).sort((a, b) => hash(a) - hash(b) || a.localeCompare(b))
    for (const app of fresh) homes.set(app, spotOf(app, takeSpot(app, [...homes.values()], pinned(app)), pinned(app)))
    return homes
  }

  // Of an app's spots, the one farthest from the stars already placed; kept from then on.
  function takeSpot(app, taken, pinned = false) {
    let best = 0
    let room = -1
    for (let i = 0; i < SPOT_CHOICES; i++) {
      const spot = spotOf(app, i, pinned)
      const nearest = Math.min(Infinity, ...taken.map((other) => other.distanceTo(spot)))
      if (nearest > room) {
        room = nearest
        best = i
      }
    }
    spots.set(app, best)
    onSpot?.(app, best)
    return best
  }

  // A star's i-th possible spot. along: 0 at the inner end of the arms, 1 at the rim,
  // measured along the arm; the inner turns of a spiral are short, and spreading stars by
  // radius instead piled them around the core. Pinned stars stay near the core. The disc
  // is thick like a real one: up to 46 above or below near the core's bulge, thinning to
  // 18 at the rim.
  function spotOf(app, i, pinned) {
    const h = mix(hash(`${app}#${i}`))
    const along = ((h >>> 8) / 2 ** 24) * (pinned ? 0.2 : 1)
    const radius = armRadius(along)
    const depth = (radius - ARM_INNER) / (ARM_OUTER - ARM_INNER)
    // Height off the disc's middle plane, from -1 to 1: most stars near it, a few far.
    const k = hash(`${app}~height`)
    const lift = ((k % 1000) + ((k >>> 12) % 1000)) / 1000 - 1
    const angle = ((h % ARMS) / ARMS) * Math.PI * 2 + radius * SPIN + (((h >>> 2) % 1000) / 1000 - 0.5) * 0.2
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    return new THREE.Vector3(x, lift * (46 - 28 * depth) + warpAt(x, z), z)
  }

  function createSystem(app, bornAt = null) {
    const group = new THREE.Group()
    const tilt = new THREE.Group()
    const h = hash(app)
    const rand = mulberry32(h)
    tilt.rotation.set(((h % 100) / 100 - 0.5) * 0.5, 0, (((h >>> 8) % 100) / 100 - 0.5) * 0.5)
    // Every star has its own look: a churning surface, corona wisps of its own shape,
    // its own cut of diffraction spikes, and its own spin.
    const core = new THREE.Mesh(sphere, starMaterial(rand() * 100, pointUniforms.uTime))
    core.scale.setScalar(1.25)
    const glow = sprite(tex.glow, 10, 0.9)
    const corona = sprite(tex.nebula[h % tex.nebula.length], 7, 0.2)
    corona.material.rotation = rand() * Math.PI * 2
    const spikes = sprite(tex.spikes, 17, 0.55)
    const spikes2 = sprite(tex.spikes, 11, 0)
    const hit = new THREE.Mesh(hitSphere, hitMaterial)
    hit.scale.setScalar(4.5)
    const label = labelObject('gx-star', app)
    label.center.set(0.5, 0)
    const sparkles = Array.from({ length: 9 }, () => {
      const s = sprite(tex.glow, 1, 0)
      const r = 2.5 + rand() * 9
      const a = rand() * Math.PI * 2
      s.position.set(Math.cos(a) * r, (rand() - 0.5) * 5, Math.sin(a) * r)
      s.material.color.set(rand() < 0.5 ? '#bfe3ff' : '#ffffff')
      return { sprite: s, phase: rand() * 10, rate: 0.9 + rand() * 1.8, size: 3 + rand() * 4 }
    })
    // A star with a terminal waiting on the user sends out slow amber rings.
    const beacons = [sprite(tex.thinRing, 1, 0), sprite(tex.thinRing, 1, 0)]
    for (const beacon of beacons) beacon.material.color.copy(AMBER)
    // A crown of glints over the star, one more for each token milestone the app has passed.
    const crown = new THREE.Group()
    crown.rotation.set((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4)
    for (let i = 0; i < CROWN_GLINTS.at(-1); i++) {
      const glint = sprite(tex.spikes, 1, 0)
      glint.material.color.set(i % 3 === 2 ? '#ffd0ec' : '#ffe2a8')
      crown.add(glint)
    }
    crown.visible = false
    group.add(tilt, core, corona, glow, spikes, spikes2, hit, label, crown, ...sparkles.map((s) => s.sprite), ...beacons)
    disc.add(group)
    const system = {
      app,
      group,
      tilt,
      core,
      corona,
      glow,
      spikes,
      spikes2,
      hit,
      label,
      sparkles,
      beacons,
      crown,
      tier: null, // token milestones passed, once its tokens are known
      companions: [],
      look: { angle: rand() * Math.PI, eight: rand() < 0.45, coronaSpin: (rand() - 0.5) * 0.08, spin: 0.04 + rand() * 0.1 },
      color: UNKNOWN_STAR.clone(),
      colorGoal: UNKNOWN_STAR.clone(),
      size: 1,
      sizeGoal: 1,
      grow: 1,
      stats: null,
      busy: 0,
      seed: h,
      home: new THREE.Vector3(),
      planets: [],
      reach: 5,
      tone: 'done',
      placed: false
    }
    hit.userData.system = system
    label.element.addEventListener('click', () => pickSystem(system))
    system.bornAt = bornAt
    system.dress = dress(system)
    systems.set(app, system)
    return system
  }

  // Puts on the star what dressOf() picked for it. Each dress has its parts, and an update
  // that sizes and lights them every frame.
  function dress(system) {
    const look = dressOf(system.app, system.bornAt)
    const [a, b] = look.colors.map((c) => new THREE.Color(c))
    const materials = []
    const objects = []
    const keep = (m) => (materials.push(m), m)
    const wear = (parent, ...parts) => {
      parent.add(...parts)
      objects.push(...parts)
    }
    let update = () => {}
    if (['shell', 'wings', 'rose', 'aurora'].includes(look.kind)) {
      // Gas around the star, as seen from wherever the camera is.
      const material = keep(cloudMaterial(look, a, b, pointUniforms.uTime))
      const mesh = new THREE.Mesh(plane, material)
      mesh.frustumCulled = false
      wear(system.group, mesh)
      const reach = { shell: 6.2, wings: 9.5, rose: 6.8, aurora: 5.2 }[look.kind]
      update = (size, level) => {
        material.uniforms.uSize.value = reach * size
        material.uniforms.uLevel.value = level
      }
    } else if (look.kind === 'halo' || look.kind === 'whirl') {
      // Lying in the plane its planets orbit in.
      const material = keep(ringMaterial(look, a, b, pointUniforms.uTime))
      const mesh = new THREE.Mesh(plane, material)
      mesh.rotation.x = -Math.PI / 2
      wear(system.tilt, mesh)
      const reach = look.kind === 'halo' ? 7.6 : 9
      update = (size, level) => {
        mesh.scale.setScalar(Math.max(0.001, reach * size))
        material.uniforms.uLevel.value = level
      }
    } else if (look.kind === 'pulsar') {
      // Two beams from its poles, swept round as it turns, and a beat in its glow.
      const spinner = new THREE.Group()
      const axis = new THREE.Group()
      axis.rotation.z = 0.45 + look.rand() * 0.5
      const material = keep(beamMaterial(a))
      for (const flip of [0, Math.PI]) {
        const beam = new THREE.Mesh(beamCone, material)
        beam.rotation.x = flip
        axis.add(beam)
      }
      spinner.add(axis)
      const flash = sprite(tex.glow, 1, 0)
      const beat = keep(flash.material)
      beat.color.copy(a)
      wear(system.group, spinner, flash)
      update = (size, level, t, dt) => {
        spinner.rotation.y += dt * 1.4
        axis.scale.setScalar(Math.max(0.001, 15 * size))
        material.uniforms.uLevel.value = level
        const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * 5.2), 8)
        flash.scale.setScalar(Math.max(0.001, 7 * size * (0.8 + 0.5 * pulse)))
        beat.opacity = level * (0.25 + 0.5 * pulse)
      }
    } else if (look.kind === 'prism') {
      // Its spikes split into colours, and glints wink round it like cut glass.
      const fringes = ['#ff5f8a', '#ffe36a', '#5fffb0', '#6f8bff'].map((color) => {
        const fringe = sprite(tex.spikes, 1, 0)
        keep(fringe.material).color.set(color)
        return fringe
      })
      const glints = Array.from({ length: 6 }, (_, i) => {
        const glint = sprite(tex.spikes, 1, 0)
        keep(glint.material).color.copy(i % 2 ? a : b).lerp(WHITE, 0.4)
        const r = 2.6 + look.rand() * 3.4
        const angle = look.rand() * Math.PI * 2
        glint.position.set(Math.cos(angle) * r, (look.rand() - 0.5) * 3, Math.sin(angle) * r)
        return { sprite: glint, phase: look.rand() * 10, rate: 0.6 + look.rand() * 0.8 }
      })
      wear(system.group, ...fringes, ...glints.map((g) => g.sprite))
      update = (size, level, t) => {
        fringes.forEach((fringe, i) => {
          fringe.material.rotation = look.angle + t * 0.04 + (i - 1.5) * 0.035
          fringe.scale.setScalar(Math.max(0.001, 15 * size * (1 + i * 0.06)))
          fringe.material.opacity = level * 0.3
        })
        for (const g of glints) {
          const shine = Math.pow(Math.max(0, Math.sin(t * g.rate + g.phase)), 10)
          g.sprite.material.opacity = level * shine * 0.9
          g.sprite.material.rotation = t * 0.1 + g.phase
          g.sprite.scale.setScalar(Math.max(0.001, size * (0.6 + 2.2 * shine)))
        }
      }
    }
    return { ...look, tint: look.kind === 'bare' ? null : a.clone().lerp(b, 0.3), materials, objects, update }
  }

  // Its birth time came to light (or changed): the star is dressed again by the rule.
  function redress(system, bornAt) {
    system.bornAt = bornAt
    for (const part of system.dress.objects) part.removeFromParent()
    for (const m of system.dress.materials) m.dispose()
    system.dress = dress(system)
  }

  // A star's birth: the earliest its terminals' repo is known to have appeared.
  function bornOf(items) {
    const times = items.map((i) => i.bornAt).filter(Boolean)
    return times.length ? Math.min(...times) : null
  }

  // Size from how much agent work went in (tokens, then hours), on a log scale so one huge
  // project doesn't swallow the screen. Colour from age. Old stars also get sunspots.
  function applyStats(system, stats) {
    system.stats = stats || null
    // The first count only sets where it stands; passing a milestone later is celebrated.
    // Counts are still coming in for a minute after the page opens.
    if (stats) {
      const tier = MILESTONES.filter((m) => stats.tokens >= m).length
      if (system.tier !== null && tier > system.tier && performance.now() - openedAt > WARMUP_MS) {
        celebrate(system)
        onMilestone?.(system.app, MILESTONES[tier - 1])
      }
      system.tier = Math.max(system.tier ?? 0, tier)
    }
    const days = stats?.firstAt ? Math.max(0, (Date.now() - stats.firstAt) / 86_400_000) : null
    // No agent records (yet): still give each app its own place on the spectrum.
    system.ageDays = days ?? Math.expm1(((system.seed % 1000) / 1000) * SPECTRAL[SPECTRAL.length - 1][0])
    spectral(system.ageDays, system.colorGoal)
    // Stars of the same age still differ a little in hue.
    system.colorGoal.offsetHSL((((system.seed >>> 3) % 100) / 100 - 0.5) * 0.09, 0.08, 0)
    system.core.material.uniforms.spots.value = days === null ? 0 : smooth(10, 60, days) * 0.9
    setDisk(system, days)
    const tokens = (stats?.tokens || 0) / 1e6
    const hours = (stats?.activeMs || 0) / 3.6e6
    const size = stats ? Math.min(2.3, Math.max(0.75, 0.75 + 0.2 * Math.log2(1 + tokens) + 0.08 * Math.log2(1 + hours))) : 1
    if (Math.abs(size - system.sizeGoal) < 0.01) return
    system.sizeGoal = size
    system.hit.scale.setScalar(4.5 * size)
    arrange(system)
  }

  // Companion stars: one for each extra worktree (branch) of the app, up to two.
  function setCompanions(system, count) {
    count = Math.min(2, Math.max(0, count))
    if (count === system.companions.length) return
    while (system.companions.length < count) {
      const i = system.companions.length
      const rand = mulberry32(system.seed + 7 * (i + 1))
      const pivot = new THREE.Object3D()
      pivot.rotation.set((rand() - 0.5) * 0.7, rand() * Math.PI * 2, (rand() - 0.5) * 0.7)
      const body = new THREE.Mesh(sphere, starMaterial(rand() * 100, pointUniforms.uTime))
      // One companion burns hotter than most, the other cooler.
      body.material.uniforms.color.value.set(i ? '#ffb27a' : '#a9c1ff')
      const halo = sprite(tex.glow, 3.4, 0.75)
      halo.material.color.copy(body.material.uniforms.color.value)
      const holder = new THREE.Object3D()
      holder.add(body, halo)
      pivot.add(holder)
      system.group.add(pivot)
      system.companions.push({ pivot, holder, body, halo, speed: 0.45 + rand() * 0.35, grow: 0 })
    }
    while (system.companions.length > count) {
      const c = system.companions.pop()
      system.group.remove(c.pivot)
      c.body.material.dispose()
      c.halo.material.dispose()
    }
    arrange(system)
  }

  // Orbits start clear of the star and its companions.
  function arrange(system) {
    const core = 1.25 * system.sizeGoal
    const n = system.companions.length
    const first = system.planets[0]?.sizeGoal || 1
    const base = Math.max(core + 3.25, n ? core + 1.3 + (n - 1) * 0.75 + 1.6 : 0) + Math.max(0, first - 1) * 1.4
    // Bigger planets (and the moons and probes they carry) get roomier orbits.
    let radius = base
    system.planets.forEach((planet, k) => {
      if (k) radius += 0.6 + 0.75 * (system.planets[k - 1].sizeGoal + planet.sizeGoal)
      planet.orbitRadius = radius
      planet.speed = 0.55 / Math.sqrt(planet.orbitRadius)
      if (!planet.placed) {
        planet.placed = true
        planet.holder.position.x = planet.orbitRadius
        planet.orbit.scale.setScalar(planet.orbitRadius)
      }
    })
    system.reach = radius
    fitDisk(system)
  }

  // A star only a few days old still has the dusty disc it formed from, with dark
  // lanes where its planets are clearing their orbits. It thins away within a week.
  function setDisk(system, days) {
    const fade = days === null ? 0 : 1 - smooth(DISK_DAYS[0], DISK_DAYS[1], days)
    if (fade <= 0) {
      if (system.disk) {
        system.tilt.remove(system.disk)
        system.disk.material.dispose()
        system.disk = null
      }
      return
    }
    if (!system.disk) {
      system.disk = new THREE.Mesh(plane, diskMaterial(pointUniforms.uTime))
      system.disk.rotation.x = -Math.PI / 2
      system.disk.visible = decorOn.disks !== false
      system.tilt.add(system.disk)
    }
    system.disk.material.uniforms.uFade.value = fade
    fitDisk(system)
  }

  function fitDisk(system) {
    if (!system.disk) return
    const u = system.disk.material.uniforms
    const outer = system.reach + 6
    u.uInner.value = 1.25 * system.sizeGoal * 1.6
    u.uOuter.value = outer
    u.uGaps.value = Array.from({ length: 8 }, (_, i) => system.planets[i]?.orbitRadius ?? 1e4)
    system.disk.scale.setScalar(outer * 2)
  }

  function createPlanet(system, item) {
    const seed = hash(item.handle)
    const pivot = new THREE.Object3D()
    pivot.rotation.y = ((seed % 3600) / 3600) * Math.PI * 2
    const holder = new THREE.Object3D()
    const material = planetMaterial(planetTexture(seed % 14))
    const mesh = new THREE.Mesh(sphere, material)
    mesh.rotation.z = ((seed >>> 4) % 100) / 100 - 0.5
    const hit = new THREE.Mesh(hitSphere, hitMaterial)
    hit.scale.setScalar(2.6)
    const label = labelObject('gx-planet', item.planet)
    label.center.set(0.5, 0)
    label.element.prepend(Object.assign(document.createElement('i'), { className: 'ret' }))
    const beacons = [sprite(tex.ring, 1, 0), sprite(tex.ring, 1, 0)]
    holder.add(mesh, hit, label, ...beacons)
    // Some gas giants get rings.
    const ring = (seed >>> 12) % 4 === 0 ? planetRing(seed) : null
    if (ring) holder.add(ring)
    pivot.add(holder)
    const orbit = new THREE.LineLoop(circle, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.12, depthWrite: false }))
    system.tilt.add(pivot, orbit)
    const planet = { handle: item.handle, system, pivot, holder, mesh, hit, label, beacons, orbit, item, orbitRadius: 5, speed: 0.2, painted: '', moons: [], moonGoal: 0, satellite: null, prKey: '', probes: new Map(), ring: null, size: 0.9, sizeGoal: 0.9 }
    hit.userData.planet = planet
    label.element.addEventListener('click', () => onPick(planet.handle))
    planet.ring = ring
    planets.set(item.handle, planet)
    return planet
  }

  // A planet's size is how much disk its worktree takes (without .git): about 1 at
  // 1 GB, 1.65 at 8 GB. Until that's measured, a little variety from its name.
  function sizeOf(item) {
    const base = item.disk > 0 ? Math.min(1.85, Math.max(0.72, 0.72 + 0.3 * Math.log2(1 + item.disk / 1e9))) : 0.8 + ((hash(item.handle) >>> 6) % 100) / 220
    return item.status === 'shell' ? base * 0.6 : base
  }

  function paintPlanet(planet) {
    const { item } = planet
    planet.sizeGoal = sizeOf(item)
    if (!planet.painted) planet.size = planet.sizeGoal
    const key = `${item.status}|${item.show}|${item.planet}|${item.background}|${searching}`
    if (key === planet.painted) return
    planet.painted = key
    const tone = new THREE.Color(TONE[item.status])
    const u = planet.mesh.material.uniforms
    u.rim.value.copy(tone)
    u.rimStrength.value = RIM[item.status]
    // While searching, what wasn't found sinks further back.
    u.dim.value = item.show ? 1 : searching ? 0.1 : 0.22
    planet.orbit.material.color.copy(tone)
    planet.orbit.material.opacity = !item.show ? (searching ? 0.015 : 0.04) : ALERT.has(item.status) ? 0.42 : item.status === 'working' ? 0.3 : 0.11
    for (const beacon of planet.beacons) beacon.material.color.copy(tone)
    planet.label.element.querySelector('span').textContent = item.planet
    planet.label.element.dataset.status = item.status
    planet.label.element.classList.toggle('dim', !item.show)
    planet.label.element.classList.toggle('found', searching && item.show)
  }

  // A found planet lights up: a soft glow and a pillar of light over it, both sized
  // to the camera's distance so they read from the far overview too.
  function setSpot(planet, on, delay) {
    const spot = planet.spot
    if (!on) {
      if (spot && !spot.leaving) spot.leaving = performance.now()
      return false
    }
    if (spot) {
      spot.leaving = 0
      return false
    }
    const parts = [sprite(tex.glow, 0.001, 0), sprite(tex.beam, 0.001, 0), sprite(tex.thinRing, 0.001, 0)]
    for (const part of parts) part.material.color.set(SPOT)
    parts[1].center.set(0.5, 0)
    planet.holder.add(...parts)
    planet.spot = { glow: parts[0], beam: parts[1], ring: parts[2], parts, at: performance.now() + delay, flared: false, leaving: 0 }
    return true
  }

  function dropSpot(planet) {
    for (const part of planet.spot.parts) {
      planet.holder.remove(part)
      part.material.dispose()
    }
    planet.spot = null
  }

  function stepSpot(planet, now, time) {
    const spot = planet.spot
    const since = (now - spot.at) / 1000
    const out = spot.leaving ? 1 - (now - spot.leaving) / 450 : 1
    if (out <= 0) return dropSpot(planet)
    if (since < 0) return
    if (!spot.flared) {
      spot.flared = true
      if (!reduceMotion) burst(tmp.set(0, 0, 0), { color: SPOT, size: planet.size * 3.4, parent: planet.holder, sparks: 5, ms: 900 })
    }
    const fade = smooth(0, 0.45, since) * out
    const target = planet.handle === searchTarget
    const breathe = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 2.4 + planet.orbitRadius)
    const far = camera.position.distanceTo(planet.holder.getWorldPosition(spotPos))
    const s = planet.size
    spot.glow.scale.setScalar(Math.max(s * 5.5, far * 0.034) * (target ? 1.3 : 1) * (0.92 + 0.12 * breathe))
    spot.glow.material.opacity = fade * (0.55 + 0.25 * breathe)
    const tall = Math.min(140, Math.max(14, far * 0.13)) * (target ? 1.3 : 1)
    spot.beam.scale.set(Math.max(s * 1.6, far * 0.014), tall * (0.96 + 0.08 * breathe), 1)
    spot.beam.material.opacity = fade * (target ? 0.8 : 0.5)
    // Where Enter goes next: a ring keeps reaching out from it.
    spot.ring.visible = target
    if (target) {
      const phase = reduceMotion ? 0.4 : (time * 0.7) % 1
      spot.ring.scale.setScalar(Math.max(s * 2.4, far * 0.012) * (1 + phase * 2.6))
      spot.ring.material.opacity = fade * (1 - phase) * 0.85
    }
  }

  function paintSystem(system, status, anyShown) {
    system.tone = status
    system.anyShown = anyShown
    system.core.material.uniforms.level.value = anyShown ? 2.2 : 0.7
    system.glow.material.opacity = anyShown ? 0.85 : 0.18
    system.corona.material.opacity = anyShown ? 0.2 : 0.05
    system.label.element.dataset.status = status
    system.label.element.classList.toggle('dim', !anyShown)
  }

  function select(handle) {
    if (selected === handle) return
    planets.get(selected)?.label.element.classList.remove('selected')
    selected = handle
    planets.get(selected)?.label.element.classList.add('selected')
  }

  // ---------- camera ----------

  function flyTo(handle) {
    const planet = planets.get(handle)
    if (!planet) return
    select(handle)
    flyToSystem(planet.system, planet.item.planet)
  }

  function flyToSystem(system, subtitle = `터미널 ${system.planets.length}개`) {
    const distance = 18 + system.reach * 2.4
    // Another app's system: engage the warp drive. Same system: just glide over.
    const jump = !reduceMotion && follow !== system && camera.position.distanceTo(system.group.getWorldPosition(tmp)) > 60
    if (jump) {
      onWarp?.(WARP_MS / 1000, voiceOf(system))
      warpHud.querySelector('b').textContent = system.app
      warpHud.querySelector('small').textContent = subtitle
      warpHud.style.left = `${area.x + area.width / 2}px`
      warpHud.style.top = `${area.y + area.height * 0.2}px`
      warpHud.hidden = false
    }
    flight = {
      from: camera.position.clone(),
      fromTarget: controls.target.clone(),
      start: performance.now(),
      duration: reduceMotion ? 0 : jump ? WARP_MS : FLY_MS,
      warp: jump,
      // Look across the system towards the galactic core, from slightly above.
      end: () => {
        const at = system.group.getWorldPosition(tmp2).clone()
        const out = tmp.set(at.x, 0, at.z).normalize()
        if (out.lengthSq() === 0) out.set(0, 0, 1)
        return { target: at, position: at.clone().add(out.multiplyScalar(distance * 0.82)).add(new THREE.Vector3(0, distance * 0.46, 0)) }
      },
      system
    }
    follow = system
    if (jump || reduceMotion) return
    // Same system: a breath of air passes the way the camera moves.
    const goal = flight.end()
    if (goal.position.distanceTo(camera.position) > 4) onGlide?.(FLY_MS / 1000, Math.max(-1, Math.min(1, goal.target.clone().project(camera).x)))
  }

  // What the music hears about a star: how old it looks (0 young and blue … 1 old and red),
  // whether its agents are at work, how much work went in (0 … 1, a hundred thousand
  // tokens to a hundred million), and a seed so stars of one age still differ.
  function voiceOf(system) {
    const tokens = system.stats?.tokens || 0
    const size = tokens ? Math.min(1, Math.max(0, Math.log10(tokens / 1e5) / 3)) : 0.4
    return { warmth: Math.min(1, Math.log1p(system.ageDays ?? 0) / Math.log1p(120)), busy: system.busy >= 0.5, size, seed: system.seed }
  }

  // Tells the page when the camera takes up with another star, or that star's agents start
  // or stop work.
  function tellWatch() {
    const voice = follow && voiceOf(follow)
    const key = voice ? `${follow.app}|${voice.busy}|${voice.warmth.toFixed(2)}|${voice.size.toFixed(1)}` : ''
    if (key === watchKey) return
    watchKey = key
    onWatch?.(voice)
  }

  function overview() {
    follow = null
    const distance = overviewDistance()
    if (!reduceMotion && camera.position.distanceTo(OVERVIEW_DIR.clone().multiplyScalar(distance)) > 30) onGlide?.((FLY_MS * 1.75) / 1000, 0)
    flight = {
      from: camera.position.clone(),
      fromTarget: controls.target.clone(),
      start: performance.now(),
      duration: reduceMotion ? 0 : FLY_MS * 1.75,
      end: () => ({ target: new THREE.Vector3(), position: OVERVIEW_DIR.clone().multiplyScalar(distance) }),
      system: null
    }
  }

  // Far enough that the whole disc fits the visible area beside the session pane.
  function overviewDistance() {
    const fov = THREE.MathUtils.degToRad(camera.fov)
    const shortest = Math.max(160, Math.min(area.width, area.height * 1.25))
    return Math.min(2000, Math.max(420, (GALAXY_RADIUS * 1.08 * size.height) / (shortest * Math.tan(fov / 2))))
  }

  // ---------- cruising ----------

  // Quiet mode's slow tour. The camera glides to a star (no warp), circles it for a while
  // at a height of its own (skimming the disc, from the side, or from high above), then
  // moves on to one it hasn't seen lately. Every few legs it pulls back to show the whole
  // galaxy from a low angle. The music follows the star in view. Anything touched stops it
  // where it is.
  function setCruise(on) {
    on = on && !reduceMotion
    if (on === Boolean(cruising)) return
    cruising = on ? { legs: 0, recent: [], leg: null } : null
    if (!on && flight?.cruise) flight = null
  }

  function stepCruise(now, dt, flying) {
    const leg = cruising.leg
    if (!leg || now > leg.until || (leg.system && systems.get(leg.system.app) !== leg.system)) return nextLeg(now)
    if (flying) return
    // Circling: round the star, easing towards this leg's height and distance.
    const offset = tmp.copy(camera.position).sub(controls.target)
    orbitSph.setFromVector3(offset)
    orbitSph.theta += dt * leg.spin
    orbitSph.phi += (leg.phi - orbitSph.phi) * Math.min(1, dt * 0.04)
    orbitSph.radius += (leg.radius - orbitSph.radius) * Math.min(1, dt * 0.04)
    camera.position.copy(controls.target).add(offset.setFromSpherical(orbitSph))
  }

  function nextLeg(now) {
    const list = [...systems.values()]
    const side = Math.random() < 0.5 ? -1 : 1
    cruising.legs++
    if (!list.length || cruising.legs % CRUISE_WIDE_EVERY === 0) {
      // The whole galaxy, from low enough to see its depth.
      follow = null
      const radius = overviewDistance() * (0.75 + Math.random() * 0.25)
      const phi = THREE.MathUtils.degToRad(64 + Math.random() * 20)
      const at = new THREE.Vector3().setFromSphericalCoords(radius, phi, Math.random() * Math.PI * 2)
      const ms = 15_000
      cruiseGlide(() => ({ target: new THREE.Vector3(), position: at }), ms, null)
      cruising.leg = { system: null, until: now + ms + 26_000, spin: side * 0.025, phi, radius }
      return
    }
    const fresh = list.filter((s) => !cruising.recent.includes(s.app))
    const pool = fresh.length ? fresh : list
    const system = pool[Math.floor(Math.random() * pool.length)]
    cruising.recent = [...cruising.recent.slice(-5), system.app]
    const radius = (16 + system.reach * 2.4) * (0.85 + Math.random() * 0.6)
    // Skimming the disc, from the side and above, or from high up.
    const heights = [[74, 84], [52, 66], [28, 42]]
    const [low, high] = heights[Math.floor(Math.random() * heights.length)]
    const phi = THREE.MathUtils.degToRad(low + Math.random() * (high - low))
    const theta = Math.random() * Math.PI * 2
    const far = camera.position.distanceTo(system.group.getWorldPosition(tmp))
    const ms = Math.min(18_000, 7000 + far * 9)
    follow = system
    cruiseGlide(
      () => {
        const at = system.group.getWorldPosition(tmp2).clone()
        return { target: at, position: at.clone().add(new THREE.Vector3().setFromSphericalCoords(radius, phi, theta)) }
      },
      ms,
      system
    )
    const stay = CRUISE_STAY[0] + Math.random() * (CRUISE_STAY[1] - CRUISE_STAY[0])
    cruising.leg = { system, until: now + ms + stay * 1000, spin: side * (0.06 + Math.random() * 0.05), phi: phi + (Math.random() - 0.5) * 0.3, radius }
  }

  function cruiseGlide(end, duration, system) {
    flight = { from: camera.position.clone(), fromTarget: controls.target.clone(), start: performance.now(), duration, end, system, cruise: true }
    onGlide?.(duration / 1000, Math.max(-1, Math.min(1, end().target.clone().project(camera).x)))
  }

  function stepCamera(now, dt) {
    if (follow) {
      // Ride along as the galaxy turns, without fighting the user's own orbit.
      const at = follow.group.getWorldPosition(tmp)
      if (follow.lastAt) {
        const delta = tmp2.copy(at).sub(follow.lastAt)
        camera.position.add(delta)
        controls.target.add(delta)
        flight?.from.add(delta)
        flight?.fromTarget.add(delta)
        aim?.from.add(delta)
        aim?.to.add(delta)
      }
      follow.lastAt = (follow.lastAt || new THREE.Vector3()).copy(at)
    }
    if (warp.active && !flight?.warp) endWarp()
    if (!flight) return false
    const t = flight.duration ? Math.min(1, (now - flight.start) / flight.duration) : 1
    if (flight.warp) {
      const fx = warp.update(t, dt, time)
      camera.fov = 50 + fx.fov
      applyViewOffset()
      bloom.strength = glow + fx.intensity * 0.45
      labelRenderer.domElement.style.opacity = String(1 - fx.intensity)
      warpHud.style.opacity = String(smooth(0.04, 0.16, t) * (1 - smooth(0.82, 0.95, t)))
      warpHud.style.setProperty('--p', String(t))
      if (t > 0.88 && !flight.flashed) {
        flight.flashed = true
        flashAt(flight.system)
      }
    }
    const end = flight.end()
    if (flight.warp) {
      // Star to star: turn to face the destination, fly straight at it, then ease into the usual view.
      controls.target.lerpVectors(flight.fromTarget, end.target, smooth(0, 0.2, t))
      const approach = tmp.copy(flight.from).sub(end.target).setLength(end.position.distanceTo(end.target)).add(end.target)
      camera.position.lerpVectors(flight.from, approach, easeInOut(Math.max(0, Math.min(1, (t - 0.12) / 0.74))))
      camera.position.lerp(end.position, smooth(0.8, 1, t))
    } else {
      // A glide: the look-at point slides across, the distance changes on a log scale
      // (a 50x pull-back feels as even as a 2x one) and the viewing angle turns along an
      // arc, all on a gentle ease so nothing whips round at the start or snaps at the end.
      const e = smootherstep(t)
      const fromOffset = tmp.copy(flight.from).sub(flight.fromTarget)
      const toOffset = tmp2.copy(end.position).sub(end.target)
      const d0 = Math.max(0.01, fromOffset.length())
      const d1 = Math.max(0.01, toOffset.length())
      turn.setFromUnitVectors(fromOffset.normalize(), toOffset.normalize())
      partTurn.identity().slerp(turn, smootherstep(Math.min(1, t * 1.1)))
      controls.target.lerpVectors(flight.fromTarget, end.target, e)
      camera.position
        .copy(fromOffset)
        .applyQuaternion(partTurn)
        .multiplyScalar(Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * e))
        .add(controls.target)
    }
    if (t >= 1) {
      if (flight.warp) endWarp()
      flight = null
    }
    return true
  }

  function endWarp() {
    warp.reset()
    camera.fov = 50
    applyViewOffset()
    bloom.strength = glow
    labelRenderer.domElement.style.opacity = ''
    warpHud.hidden = true
  }

  // Dropping out of warp: a burst of light and a shock ring at the arrival system.
  function flashAt(system) {
    const glow = sprite(tex.glow, 1, 1)
    glow.material.color.set('#d6ebff')
    const ring = sprite(tex.ring, 1, 0.9)
    ring.material.color.set('#9fd0ff')
    system.group.add(glow, ring)
    flashes.push({ glow, ring, system, start: performance.now() })
  }

  function stepFlashes(now) {
    for (const f of [...flashes]) {
      const k = (now - f.start) / 1100
      if (k >= 1) {
        f.system.group.remove(f.glow, f.ring)
        f.glow.material.dispose()
        f.ring.material.dispose()
        flashes.splice(flashes.indexOf(f), 1)
        continue
      }
      f.glow.scale.setScalar(6 + 46 * k)
      f.glow.material.opacity = (1 - k) * (1 - k)
      f.ring.scale.setScalar(3 + 80 * Math.sqrt(k))
      f.ring.material.opacity = (1 - k) * 0.85
    }
  }

  // The session pane slides in and out; ease the galaxy's centre along with it.
  function stepArea() {
    if (!areaGoal) return
    let still = true
    for (const key of ['x', 'y', 'width', 'height']) {
      const gap = areaGoal[key] - area[key]
      area[key] += gap * 0.14
      if (Math.abs(gap) > 0.5) still = false
    }
    if (still) {
      area = areaGoal
      areaGoal = null
    }
    applyViewOffset()
  }

  // Keep the galaxy centred in the free area beside the session pane.
  function applyViewOffset() {
    const { width, height } = size
    const cx = area.x + area.width / 2
    const cy = area.y + area.height / 2
    const fullWidth = 2 * Math.max(cx, width - cx)
    const fullHeight = 2 * Math.max(cy, height - cy)
    camera.aspect = fullWidth / fullHeight
    fullView = { width: fullWidth, height: fullHeight }
    camera.setViewOffset(fullWidth, fullHeight, fullWidth / 2 - cx, fullHeight / 2 - cy, width, height)
    camera.updateProjectionMatrix()
    pointUniforms.uScale.value = (fullHeight * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
  }

  function resize() {
    const width = host.clientWidth || 1
    const height = host.clientHeight || 1
    if (width === size.width && height === size.height) return applyViewOffset()
    size = { width, height }
    labelRenderer.setSize(width, height)
    applyPixelRatio(true)
  }

  // A big monitor shouldn't cost more than a laptop: past PIXEL_BUDGET drawn pixels the
  // picture renders a little softer instead of slower, and lower still while frames lag.
  function applyPixelRatio(force = false) {
    const fit = Math.sqrt(PIXEL_BUDGET / Math.max(1, size.width * size.height))
    const ratio = Math.max(0.5, Math.min(window.devicePixelRatio || 1, 1.5, fit) * quality)
    if (!force && Math.abs(ratio - renderer.getPixelRatio()) < 0.01) return
    renderer.setPixelRatio(ratio)
    composer.setPixelRatio(ratio)
    renderer.setSize(size.width, size.height, false)
    composer.setSize(size.width, size.height)
    pointUniforms.uPixel.value = ratio
    applyViewOffset()
  }

  // Frames that keep running long (a slow machine, a huge window) bring the resolution
  // down a step; smooth motion for a while lets it climb back. The 30 fps idle pace
  // can only show slowness, so only moving frames count as room to spare.
  function watchSpeed(interval, busy, now) {
    if (interval > 250) return
    if (busy !== frameBusy) {
      frameBusy = busy
      frameEma = 0
    }
    frameEma = frameEma ? frameEma * 0.92 + interval * 0.08 : interval
    if (now - qualityAt < 3000) return
    if ((busy ? frameEma > 26 : frameEma > 52) && quality > 0.55) quality *= 0.85
    else if (busy && frameEma < 18.5 && quality < 1) quality = Math.min(1, quality / 0.9)
    else return
    qualityAt = now
    applyPixelRatio()
  }

  // ---------- frame loop ----------

  function frame(now) {
    if (!active) return
    requestAnimationFrame(frame)
    stepArea()
    const busy =
      flight || dying.length || births.length || comets.length || meteors.length || thrown.length || bursts.length || aim || grab || hole.group.visible || areaGoal || now - lastInput < 2500
    // 60 fps while something moves on purpose, 30 fps for the ambient drift.
    if (now - lastFrame < (busy ? 0 : 32)) return
    const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000)
    if (lastFrame) watchSpeed(now - lastFrame, Boolean(busy), now)
    lastFrame = now
    time += dt
    pointUniforms.uTime.value = time

    // The universe keeps turning; only the camera's own drift pauses while the user drags.
    disc.rotation.y += DISC_SPIN * dt
    if (now - watchedAt > 500) {
      watchedAt = now
      tellWatch()
    }
    sky.position.copy(camera.position)
    for (const star of beacons.children) {
      const { phase, rate, base } = star.userData
      star.material.opacity = base * (0.7 + 0.3 * Math.sin(time * rate + phase))
    }
    // Gas clouds in the arms swirl and breathe, every few minutes thin away and gather
    // again somewhere else on an arm, and thin out as the camera flies into them.
    for (const cloud of clouds.children) {
      const u = cloud.userData
      if (time > u.born + u.span) placeCloud(cloud, Math.random, time)
      const age = time - u.born
      const life = smooth(0, 14, age) * (1 - smooth(u.span - 14, u.span, age))
      const breathe = 0.7 + 0.3 * Math.sin(time * u.rate + u.phase)
      cloud.material.rotation += u.spin * dt
      cloud.scale.setScalar(u.size * (0.92 + 0.08 * breathe) * (0.75 + 0.25 * life))
      const d = cloud.getWorldPosition(tmp).distanceTo(camera.position)
      cloud.material.opacity = u.base * life * breathe * smooth(u.size * 0.35, u.size * 1.4, d)
    }
    // The far nebulae and the Milky Way's clouds turn and brighten more slowly still.
    for (const group of [veils, band, decor.magellan]) {
      for (const veil of group.children) {
        const u = veil.userData
        if (!u.rate) continue
        veil.material.rotation += u.spin * dt
        veil.material.opacity = u.base * (0.72 + 0.28 * Math.sin(time * u.rate + u.phase))
      }
    }
    // Space weather: the more agents at work, the brighter the aurora round the disc.
    const auroraGoal = Math.max(Math.min(1, Math.max(0, (busyAgents - 1) / 4)), time < auroraUntil ? 1 : 0)
    auroraLevel += (auroraGoal - auroraLevel) * Math.min(1, dt * 0.3)
    auroraRing.visible = auroraLevel > 0.005
    // The galactic core breathes: slow breaths, in a little quicker than out, each one
    // spreading from the hot heart out to the violet halo. Every sixth is a deeper sigh,
    // and the more agents at work, the quicker it breathes.
    breathAt += (dt * Math.PI * 2) / (8.5 - 2 * auroraLevel)
    for (const part of core) {
      const u = part.userData
      const at = breathAt - u.lag
      const deep = Math.floor(at / (Math.PI * 2)) % 6 === 5 ? 1.7 : 1
      const b = (Math.pow(0.5 - 0.5 * Math.cos(at), 1.5) - 0.35) * deep * (reduceMotion ? 0.3 : 1)
      part.scale.setScalar(u.size * (1 + u.swell * b))
      part.material.opacity = u.opacity * (1 + u.glow * b)
    }
    auroraRing.material.uniforms.uTime.value = time
    auroraRing.material.uniforms.uLevel.value = auroraLevel
    if (auroraLevel > 0.6 && !auroraSeen) {
      auroraSeen = true
      onSound?.('aurora')
      onPlay?.({ type: 'aurora' })
    } else if (auroraLevel < 0.2) auroraSeen = false
    if (time > nextEvent) {
      nextEvent = time + 75 + Math.random() * 120
      cosmicEvent()
    }
    if (time > nextMeteor) {
      nextMeteor = time + 10 + Math.random() * 20
      shootingStar()
    }
    // Now and then a shower: several from one radiant, a beat apart.
    if (time > nextShower) {
      nextShower = time + 180 + Math.random() * 180
      meteorShower()
    }
    if (!reduceMotion) drifter.step(time)
    for (const planet of planets.values()) {
      if (planet.swallowing) continue
      const working = planet.item.status === 'working'
      planet.pivot.rotation.y += planet.speed * dt * (working ? 1.6 : 0.45)
      planet.holder.position.x += (planet.orbitRadius - planet.holder.position.x) * Math.min(1, dt * 2)
      planet.orbit.scale.setScalar(planet.holder.position.x)
      planet.mesh.rotation.y += dt * 0.25
      planet.size += (planet.sizeGoal - planet.size) * Math.min(1, dt * 1.6)
      planet.mesh.scale.setScalar(planet.size)
      if (planet.ring) planet.ring.scale.setScalar(planet.ring.scale.x + (planet.size - planet.ring.scale.x) * Math.min(1, dt * 0.8))
      if (planet.knock || planet.aura) stepStrike(planet, dt)
      planet.hit.scale.setScalar(2.6 * Math.max(0.8, planet.size))
      if (planet.satellite) planet.satellite.craft.position.x = 2.2 * planet.size
      const alert = ALERT.has(planet.item.status) && planet.item.show
      planet.beacons.forEach((beacon, i) => {
        beacon.visible = alert
        if (!alert) return
        const phase = (time * 0.55 + i * 0.5) % 1
        beacon.scale.setScalar((2 + phase * 9) * planet.size)
        beacon.material.opacity = (1 - phase) * 0.9
      })
      planet.mesh.material.uniforms.starPos.value.copy(planet.system.group.getWorldPosition(tmp))
      if (planet.spot) stepSpot(planet, now, time)
      if (planet.moons.length) stepMoons(planet, dt)
      if (planet.probes.size) stepProbes(planet, dt)
      if (planet.satellite) {
        planet.satellite.pivot.rotation.y += 0.8 * dt
        planet.satellite.light.material.opacity = Math.sin(time * 3 + planet.orbitRadius) > 0.55 ? 1 : 0.25
      }
    }
    for (const system of systems.values()) {
      system.group.position.lerp(system.home, 0.04)
      const pulse = ALERT.has(system.tone) ? 1 + 0.18 * Math.sin(time * 3.2) : 1
      twinkle(system, pulse, dt)
    }

    const flying = stepCamera(now, dt)
    stepFlashes(now)
    stepDying(now)
    stepBirths(now)
    stepForming(now, dt)
    stepComets(now)
    stepRemnants(dt)
    stepJets(dt)
    stepMeteors(now)
    stepEvents(dt)
    if (aim) stepAim()
    stepThrown(dt)
    stepBursts(now, dt)
    stepHole(dt)
    if (cruising) stepCruise(now, dt, flying)
    controls.autoRotate = !cruising && !flying && !dragging && !aim && !grab && now - releasedAt > 1200
    controls.autoRotateSpeed = follow ? 0.7 : 0.45
    // Left alone, the view also rises and dips, slowly enough not to make anyone dizzy:
    // from looking down on the disc to nearly side-on and back over a couple of minutes.
    if (controls.autoRotate && !reduceMotion) {
      idle += dt
      const offset = tmp.copy(camera.position).sub(controls.target)
      orbitSph.setFromVector3(offset)
      const goal = (follow ? 1.02 : 0.98) + (follow ? 0.22 : 0.36) * Math.sin((idle / TILT_PERIOD) * Math.PI * 2)
      orbitSph.phi += (goal - orbitSph.phi) * Math.min(1, dt * 0.15)
      camera.position.copy(controls.target).add(offset.setFromSpherical(orbitSph))
    } else idle = 0
    controls.update(dt)
    updateLabels()
    if (pointerDirty && !aim && !grab) hoverAt(pointer)
    composer.render()
    labelRenderer.render(scene, camera)
  }

  // Busy stars flicker and throw off glints; quiet ones just glow.
  function twinkle(system, pulse, dt) {
    const busy = system.busy
    const t = time + (system.seed % 100)
    system.color.lerp(system.colorGoal, Math.min(1, dt * 2))
    system.size += (system.sizeGoal - system.size) * Math.min(1, dt * 2)
    // A star that just swallowed a comet swells for a moment.
    const gulp = system.gulp || 0
    if (gulp) system.gulp = Math.max(0, gulp - dt * 1.4)
    pulse *= 1 + 0.8 * gulp
    const size = system.size * system.grow * (1 + 0.2 * gulp)
    const flicker = busy ? 1 + busy * 0.35 * (0.5 + 0.5 * Math.sin(t * 7.1)) * (0.5 + 0.5 * Math.sin(t * 2.3 + 1)) : 1
    const alert = ALERT.has(system.tone) && system.anyShown
    system.core.material.uniforms.color.value.copy(system.color)
    system.core.scale.setScalar(Math.max(0.001, 1.25 * size))
    system.core.rotation.y += system.look.spin * dt
    system.glow.material.color.copy(system.color)
    // A dressed star's glow takes a little of its dress's colour, so stars differ from afar.
    if (system.dress.tint) system.glow.material.color.lerp(system.dress.tint, 0.22)
    if (alert) system.glow.material.color.lerp(AMBER, 0.3)
    system.dress.update(size, system.anyShown ? 1 + busy * 0.3 : 0.12, t, dt)
    // From far away a star keeps a minimum glow, so its colour still reads in the overview.
    const far = camera.position.distanceTo(system.group.getWorldPosition(tmp2)) * 0.042 * Math.sqrt(system.size)
    system.glow.scale.setScalar(Math.max(0.001, Math.max(10 * size, far * system.grow) * pulse * flicker * (1 + busy * 0.6)))
    system.corona.material.color.copy(system.color)
    system.corona.scale.setScalar(Math.max(0.001, 7 * size * (1 + busy * 0.25)))
    system.corona.material.rotation += system.look.coronaSpin * dt
    const spin = system.look.angle + (busy ? t * 0.15 : 0)
    system.spikes.material.color.copy(system.color).lerp(WHITE, 0.25)
    system.spikes.scale.setScalar(Math.max(0.001, 17 * size * (1 + busy * (1 + 0.5 * Math.sin(t * 3.7)))))
    system.spikes.material.rotation = spin
    system.spikes.material.opacity = system.anyShown ? 0.5 + busy * 0.45 * (0.6 + 0.4 * Math.sin(t * 5.3)) : 0.08
    // Eight-pointed stars: a fainter, shorter set of spikes between the main ones.
    system.spikes2.material.color.copy(system.spikes.material.color)
    system.spikes2.scale.setScalar(Math.max(0.001, 11 * size))
    system.spikes2.material.rotation = spin + Math.PI / 4
    system.spikes2.material.opacity = system.look.eight ? system.spikes.material.opacity * 0.45 : 0
    system.beacons.forEach((beacon, i) => {
      beacon.visible = alert
      if (!alert) return
      const phase = (time * 0.35 + i * 0.5) % 1
      beacon.scale.setScalar(size * (5 + phase * 24))
      beacon.material.opacity = (1 - phase) * 0.7
    })
    const core = 1.25 * system.size
    system.companions.forEach((c, i) => {
      c.grow += (1 - c.grow) * Math.min(1, dt * 1.5)
      c.pivot.rotation.y += c.speed * dt
      c.holder.position.x = core + 1.3 + i * 0.75
      c.body.scale.setScalar(Math.max(0.001, 0.36 * c.grow * system.grow))
      c.body.material.uniforms.level.value = system.anyShown ? 2.6 : 0.8
      c.halo.scale.setScalar(Math.max(0.001, 3.4 * c.grow * system.grow))
      c.halo.material.opacity = system.anyShown ? 0.75 : 0.2
    })
    for (const s of system.sparkles) {
      s.sprite.visible = busy > 0 && system.grow > 0.95
      if (!s.sprite.visible) continue
      // Short glints: a sharp peak once per cycle, at a different moment for each.
      const glint = Math.pow(Math.max(0, Math.sin(t * s.rate + s.phase)), 8)
      s.sprite.material.opacity = glint * (0.6 + busy * 0.4)
      s.sprite.scale.setScalar(s.size * size * (0.6 + glint))
    }
    const glints = CROWN_GLINTS[system.tier || 0]
    system.crown.visible = decorOn.crowns !== false && glints > 0 && system.grow > 0.95
    if (!system.crown.visible) return
    system.crown.position.y = 2.2 * size
    system.crown.rotation.y += dt * 0.22
    system.crown.children.forEach((s, i) => {
      s.visible = i < glints
      if (!s.visible) return
      const a = (i / glints) * Math.PI * 2
      s.position.set(Math.cos(a) * 2.7 * size, 0, Math.sin(a) * 2.7 * size)
      const shine = Math.pow(Math.max(0, Math.sin(t * 1.3 + i * 2.4)), 6)
      s.material.opacity = system.anyShown ? 0.6 + 0.4 * shine : 0.15
      s.material.rotation = t * 0.2 + i
      s.scale.setScalar(size * (1.1 + 1.1 * shine))
    })
  }

  function updateLabels() {
    const eye = camera.position
    for (const system of systems.values()) {
      const near = eye.distanceTo(system.group.getWorldPosition(tmp)) < LABEL_NEAR + system.reach * 2
      for (const planet of system.planets) {
        const on = near || planet.handle === selected || planet === hovered || (ALERT.has(planet.item.status) && planet.item.show)
        planet.label.element.classList.toggle('on', on)
      }
    }
  }

  // ---------- pointer ----------

  function hits(event) {
    const rect = renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const targets = []
    for (const system of systems.values()) targets.push(system.hit, ...system.planets.filter((p) => !p.swallowing).map((p) => p.hit))
    // Planets win over their star when both are under the pointer, and when planets'
    // generous hit areas overlap, the one whose centre is nearest the pointer wins.
    const found = raycaster.intersectObjects(targets, false)
    const near = (h) => raycaster.ray.distanceToPoint(h.object.userData.planet.holder.getWorldPosition(tmp)) / h.object.userData.planet.size
    const planetHits = found.filter((h) => h.object.userData.planet)
    return planetHits.sort((a, b) => near(a) - near(b))[0] || found[0]
  }

  function hoverAt(event) {
    pointerDirty = false
    if (!event) return
    const hit = hits(event)
    const planet = hit?.object.userData.planet || null
    const system = hit?.object.userData.system || null
    hovered = planet
    renderer.domElement.style.cursor = planet || system ? 'pointer' : ''
    if (!planet && !system) {
      tip.hidden = true
      return
    }
    tip.replaceChildren(...(planet ? planetTip(planet.item) : systemTip(system)))
    tip.dataset.status = planet ? planet.item.status : system.tone
    tip.hidden = false
    const rect = host.getBoundingClientRect()
    const x = Math.min(event.clientX - rect.left + 16, rect.width - tip.offsetWidth - 8)
    const y = Math.min(event.clientY - rect.top + 16, rect.height - tip.offsetHeight - 8)
    tip.style.transform = `translate(${x}px, ${y}px)`
  }

  function planetTip(item) {
    const lines = [
      el('b', item.planet),
      el('span', `${item.app} · ${item.branch}${item.background ? ' · 백그라운드' : ''}`),
      el('em', `${item.statusLabel}${item.summary ? ` — ${item.summary}` : ''}`)
    ]
    if (item.moons) lines.push(el('span', `🌙 서브에이전트 ${item.moons}개 작업 중`))
    if (item.disk > 0) lines.push(el('span', `💽 디스크 ${bytesText(item.disk)} (.git 제외)`))
    for (const server of (item.servers || []).slice(0, 4)) lines.push(el('span', `📡 ${server.name} ${server.ports.map((p) => `:${p}`).join(' ')}`))
    if (item.servers?.length > 4) lines.push(el('span', `📡 서버 ${item.servers.length - 4}개 더`))
    if (item.pr && prTone(item.pr)) lines.push(el('span', `🛰 PR #${item.pr.number} · ${PR_STATE[item.pr.state] || item.pr.state}${item.pr.state === 'open' && CHECKS[item.pr.checks] ? ` · ${CHECKS[item.pr.checks]}` : ''}`))
    return lines
  }

  function systemTip(system) {
    const lines = [el('b', system.app), el('span', `터미널 ${system.planets.length}개${system.companions.length ? ` · 동반성 ${system.companions.length}개 (다른 워크트리)` : ''}`)]
    const stats = system.stats
    if (stats?.firstAt) {
      const days = Math.floor((Date.now() - stats.firstAt) / 86_400_000)
      lines.push(el('span', `토큰 ${compact(stats.tokens || 0)} · 작업 ${hoursText(stats.activeMs || 0)} · ${days ? `${days}일 된 별` : '오늘 태어난 별'}`))
    }
    lines.push(el('em', '눌러서 가장 급한 터미널로 가기'))
    return lines
  }

  // A star stands for the whole app: fly over and let the page report on all its terminals.
  function pickSystem(system) {
    if (onPickSystem) {
      flyToSystem(system)
      return onPickSystem(system.app)
    }
    const first = [...system.planets].filter((p) => p.item.show).sort((a, b) => RANK[a.item.status] - RANK[b.item.status])[0] || system.planets[0]
    if (first) onPick(first.handle)
  }

  const canvas = renderer.domElement

  // Play gestures: Alt+drag, or press and hold and then drag. From empty space that pulls
  // back a comet to throw; from a planet it picks the planet up for the black hole. Both
  // take the pointer away from the orbit controls.
  function cancelHold() {
    clearTimeout(hold.timer)
    hold = null
  }

  function beginPlay(target, planet, at) {
    if (target === 'planet') {
      if (!onClean || cleaning || grab || planets.get(planet.handle) !== planet) return false
      grabPlanet(planet, at)
    } else if (reduceMotion || !startAim(at)) return false
    down = null
    window.addEventListener('pointermove', onPlayMove)
    window.addEventListener('pointerup', onPlayUp)
    window.addEventListener('pointercancel', cancelPlay)
    return true
  }

  function stopListening() {
    window.removeEventListener('pointermove', onPlayMove)
    window.removeEventListener('pointerup', onPlayUp)
    window.removeEventListener('pointercancel', cancelPlay)
  }

  function onPlayMove(event) {
    lastInput = performance.now()
    if (aim) moveAim(event)
    if (grab) moveGhost(event)
  }

  function onPlayUp() {
    if (aim) releaseAim()
    if (grab) dropPlanet()
    stopListening()
  }

  canvas.addEventListener(
    'pointerdown',
    (event) => {
      // A second finger means a pinch, not a hold.
      if (hold) return cancelHold()
      if (event.button !== 0 || aim || grab) return
      const hit = hits(event)
      const planet = hit?.object.userData.planet || null
      const target = planet ? 'planet' : hit ? null : 'space'
      if (!target) return
      if (event.altKey) {
        if (!beginPlay(target, planet, event)) return
        event.stopImmediatePropagation()
        event.preventDefault()
        return
      }
      const at = { clientX: event.clientX, clientY: event.clientY }
      hold = {
        ...at,
        timer: setTimeout(() => {
          hold = null
          beginPlay(target, planet, at)
        }, HOLD_MS)
      }
    },
    { capture: true }
  )
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !(aim || grab)) return
      event.stopImmediatePropagation()
      cancelPlay()
    },
    { capture: true }
  )
  canvas.addEventListener('pointermove', (event) => {
    if (hold && Math.hypot(event.clientX - hold.clientX, event.clientY - hold.clientY) > 6) cancelHold()
    pointer = { clientX: event.clientX, clientY: event.clientY }
    pointerDirty = true
    lastInput = performance.now()
  })
  canvas.addEventListener('pointerleave', () => {
    pointer = null
    hovered = null
    tip.hidden = true
  })
  canvas.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY, at: performance.now() }
  })
  canvas.addEventListener('pointerup', (event) => {
    if (hold) cancelHold()
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 || performance.now() - down.at > 500) return
    if (catchAt(event)) return
    const hit = hits(event)
    if (hit?.object.userData.planet) onPick(hit.object.userData.planet.handle)
    else if (hit?.object.userData.system) pickSystem(hit.object.userData.system)
  })
  canvas.addEventListener('dblclick', (event) => {
    if (hits(event)) return
    overview()
    onOverview?.()
  })
  canvas.addEventListener(
    'wheel',
    () => {
      if (hold) cancelHold()
      lastInput = performance.now()
    },
    { passive: true }
  )
  controls.addEventListener('start', () => {
    flight = null
    if (warp.active) endWarp()
    dragging = true
    lastInput = performance.now()
  })
  controls.addEventListener('end', () => {
    dragging = false
    releasedAt = performance.now()
  })
  new ResizeObserver(() => resize()).observe(host)

  return {
    update,
    flyTo,
    flyToApp(app) {
      const system = systems.get(app)
      if (system) flyToSystem(system)
    },
    forming,
    unform,
    // Quiet mode's slow tour of the galaxy, on or off.
    cruise: setCruise,
    // How a star was made: its dress, and the hour and moment it was born.
    lookOf: (app) => {
      const system = systems.get(app)
      if (!system) return null
      const { name, time, bornAt } = system.dress
      return { name, time, bornAt }
    },
    overview,
    setArea(rect, { animate = false } = {}) {
      const box = host.getBoundingClientRect()
      const next = { x: rect.left - box.left, y: rect.top - box.top, width: rect.width, height: rect.height }
      if (animate && active && !reduceMotion) {
        areaGoal = next
        return
      }
      area = next
      areaGoal = null
      applyViewOffset()
    },
    comet,
    shootingStar,
    cosmicEvent,
    // The page confirmed and closed the terminal: the hole eats its planet.
    swallow(handle) {
      const planet = planets.get(handle)
      if (planet && !planet.swallowing) startSwallow(planet)
    },
    cancelClean,
    // Light from the settings panel: glow scales the bloom, brightness the exposure (1 = as designed).
    // flags: { name: false } hides that decoration; anything not named stays on.
    setRemnants,
    spend,
    // Admin test mode: a crown's celebration on any star.
    celebrate(app) {
      const system = systems.get(app)
      if (system) celebrate(system)
    },
    // Admin test mode: the sky's rare events on demand.
    test(kind) {
      if (kind === 'shower') nextShower = time
      else if (kind === 'far-nova') cosmicEvent('nova')
      else if (kind === 'far-birth') cosmicEvent('birth')
    },
    setDecor(flags = {}) {
      decorOn = flags
      for (const [name, group] of Object.entries(decor)) group.visible = flags[name] !== false
      for (const system of systems.values()) if (system.disk) system.disk.visible = flags.disks !== false
    },
    // The planet Enter in the search box goes to next: its light stands out.
    setSearchTarget(handle) {
      if (searchTarget === handle) return
      planets.get(searchTarget)?.label.element.classList.remove('target')
      searchTarget = handle
      planets.get(searchTarget)?.label.element.classList.add('target')
    },
    setLook({ glow: g = 1, brightness = 1 } = {}) {
      glow = BLOOM * g
      if (!warp.active) bloom.strength = glow
      renderer.toneMappingExposure = 0.88 * brightness
    },
    // Where the black hole sits on the page, for the question asked above it.
    holeSpot() {
      const box = host.getBoundingClientRect()
      const at = holeSpot()
      return { x: box.left + at.x, y: box.top + at.y, radius: HOLE_PX }
    },
    setActive(on) {
      if (on === active) return
      active = on
      if (!on) return cancelPlay()
      resize()
      lastFrame = 0
      if (!follow && !flight) overview()
      requestAnimationFrame(frame)
    }
  }
}

// ---------- warp drive ----------

// Streaks of starlight rushing past the camera, a blue glow at the end of the tunnel.
function createWarp(camera, tex) {
  const group = new THREE.Group()
  group.visible = false
  camera.add(group)

  const COUNT = 700
  const positions = new Float32Array(COUNT * 6)
  const colors = new Float32Array(COUNT * 6)
  const streaks = Array.from({ length: COUNT }, () => respawn({}, true))
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })
  )
  lines.frustumCulled = false
  lines.renderOrder = 5
  group.add(lines)

  // The far end of the tunnel glows blue, and a flash marks the jump to lightspeed.
  const tunnel = sprite(tex.glow, 1, 0)
  tunnel.material.color.set('#3a5cff')
  tunnel.position.set(0, 0, -300)
  const burst = sprite(tex.glow, 1, 0)
  burst.material.color.set('#dfe9ff')
  burst.position.set(0, 0, -140)
  for (const s of [tunnel, burst]) {
    s.material.depthTest = false
    s.renderOrder = 4
  }
  group.add(tunnel, burst)

  let active = false

  function respawn(s, anywhere) {
    const a = Math.random() * Math.PI * 2
    s.r = 1.2 + Math.pow(Math.random(), 0.7) * 40
    s.x = Math.cos(a) * s.r
    s.y = Math.sin(a) * s.r
    s.z = anywhere ? -20 - Math.random() * 480 : -480 - Math.random() * 60
    s.tint = Math.random()
    return s
  }

  return {
    get active() {
      return active
    },
    // t: flight progress 0..1. Returns how hard we're warping and the FOV kick.
    update(t, dt, time) {
      active = true
      group.visible = true
      const intensity = smooth(0.06, 0.3, t) * (1 - smooth(0.7, 0.94, t))
      const speed = 40 + intensity * 1500
      const stretch = 0.4 + intensity * 75
      for (let i = 0; i < COUNT; i++) {
        const s = streaks[i]
        s.z += speed * dt
        if (s.z > -6) respawn(s, false)
        const len = stretch * (0.5 + s.tint)
        const b = intensity * (0.35 + s.tint * 0.9)
        positions.set([s.x, s.y, s.z, s.x, s.y, s.z - len], i * 6)
        // Bright head fading to nothing at the tail. Light near the centre is blue-shifted,
        // and a few warm streaks ride among the blue.
        const blue = 1 - Math.min(1, s.r / 22)
        const warm = s.tint > 0.9
        colors.set(warm ? [b, b * 0.85, b * 0.7] : [b * (0.72 - 0.3 * blue), b * (0.86 - 0.12 * blue), b], i * 6)
      }
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true

      tunnel.scale.setScalar(40 + intensity * 260)
      tunnel.material.opacity = intensity * 0.32
      const flash = smooth(0.13, 0.21, t) * (1 - smooth(0.21, 0.38, t))
      burst.scale.setScalar(60 + flash * 320)
      burst.material.opacity = flash * 0.55

      const charge = smooth(0, 0.1, t) * (1 - smooth(0.1, 0.22, t))
      return { intensity, fov: -5 * charge + 32 * intensity }
    },
    reset() {
      active = false
      group.visible = false
    }
  }
}

const PR_STATE = { open: '열림', merged: '합쳐짐', closed: '닫힘', draft: '초안' }
const CHECKS = { success: 'CI 통과', failure: 'CI 실패', pending: 'CI 도는 중' }

function prTone(pr) {
  if (pr.state === 'merged') return '#a98bff'
  if (pr.state !== 'open' && pr.state !== 'draft') return null
  return { success: '#5dff9d', failure: '#ff5a6e', pending: '#ffb340' }[pr.checks] || '#7cc4ff'
}

function bytesText(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)}GB`
  return `${Math.max(1, Math.round(bytes / 1e6))}MB`
}

function compact(n) {
  return new Intl.NumberFormat('ko', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

function hoursText(ms) {
  const hours = ms / 3.6e6
  return hours < 1 ? `${Math.max(1, Math.round(ms / 60000))}분` : `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}시간`
}

function spectral(days, out) {
  const x = Math.log1p(days)
  if (x <= SPECTRAL[0][0]) return out.copy(SPECTRAL[0][1])
  for (let i = 1; i < SPECTRAL.length; i++) {
    const [at, color] = SPECTRAL[i]
    if (x <= at) {
      const [from, previous] = SPECTRAL[i - 1]
      return out.copy(previous).lerp(color, (x - from) / (at - from))
    }
  }
  return out.copy(SPECTRAL[SPECTRAL.length - 1][1])
}

// A star's surface: churning granulation, sunspots on old stars, darker towards the limb.
function starMaterial(seed, time) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color('#f4f2ff') }, level: { value: 3.1 }, spots: { value: 0 }, seed: { value: seed }, time },
    vertexShader: `
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vPos = position;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float level;
      uniform float spots;
      uniform float seed;
      uniform float time;
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec3 vView;
      float hash3(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
          mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
          f.z);
      }
      void main() {
        vec3 p = normalize(vPos);
        float cells = noise(p * 9.0 + vec3(seed, time * 0.12, 0.0)) * 0.6 + noise(p * 23.0 - vec3(0.0, time * 0.25, seed)) * 0.4;
        float spot = smoothstep(0.64, 0.72, noise(p * 3.1 + seed * 1.7)) * spots;
        float mu = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
        float limb = 0.3 + 0.7 * pow(mu, 0.55);
        gl_FragColor = vec4(color * level * (0.72 + 0.56 * cells) * limb * (1.0 - 0.75 * spot), 1.0);
      }`
  })
}

function easeOutBack(x) {
  const c = 1.70158
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2)
}

function smootherstep(t) {
  const x = Math.max(0, Math.min(1, t))
  return x * x * x * (x * (x * 6 - 15) + 10)
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function smooth(a, b, t) {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return x * x * (3 - 2 * x)
}

// ---------- scenery ----------

function backgroundStars(uniforms) {
  const rand = mulberry32(7)
  const count = 34000
  const position = new Float32Array(count * 3)
  const tint = new Float32Array(count * 3)
  const size = new Float32Array(count)
  const v = new THREE.Vector3()
  const c = new THREE.Color()
  for (let i = 0; i < count; i++) {
    v.set(gauss(rand), gauss(rand), gauss(rand)).normalize()
    const inBand = i > count * 0.35
    // A fifth of the band crowds round its bright heart.
    if (inBand && rand() < 0.22) v.copy(BAND_CENTER).addScaledVector(v, 0.35 + rand() * 0.3).normalize()
    if (inBand) v.addScaledVector(BAND_NORMAL, -v.dot(BAND_NORMAL) * (1 - Math.abs(gauss(rand)) * 0.12)).normalize()
    v.multiplyScalar(4200 + rand() * 1500)
    position.set([v.x, v.y, v.z], i * 3)
    c.copy(starColor(rand())).multiplyScalar(inBand ? 0.26 + rand() * 0.4 : 0.35 + rand() * 0.5)
    tint.set([c.r, c.g, c.b], i * 3)
    size[i] = inBand ? 0.8 + rand() * 1.2 : 0.9 + Math.pow(rand(), 8) * 4.5
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(size, 1))
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute vec3 tint; attribute float size; uniform float uPixel; uniform float uTime;
      varying vec3 vTint;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        float twinkle = 0.82 + 0.18 * sin(uTime * (0.7 + fract(size * 17.3) * 1.8) + position.x * 0.01);
        vTint = tint * twinkle;
        gl_PointSize = size * uPixel;
      }`,
    fragmentShader: `
      varying vec3 vTint;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = exp(-dot(c, c) * 18.0);
        gl_FragColor = vec4(vTint, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  return new THREE.Points(geometry, material)
}

function nebulae(textures) {
  const group = new THREE.Group()
  // A different sky each visit.
  const rand = mulberry32((Math.random() * 2 ** 32) >>> 0)
  const pairs = [
    ['#7b3bff', '#ff4fd8'],
    ['#2a7bff', '#22d3ee'],
    ['#ff3d8b', '#ffb02e'],
    ['#19c2b0', '#3b82f6'],
    ['#b03bff', '#ff3d8b'],
    ['#ff7a3d', '#ff3d8b'],
    ['#3b5bff', '#a855f7'],
    ['#22d3ee', '#34d399'],
    ['#f43f5e', '#7b3bff'],
    ['#6366f1', '#22d3ee'],
    ['#ff4fd8', '#6366f1'],
    ['#14b8a6', '#a3e635'],
    ['#ff6b6b', '#ffd166'],
    ['#4361ee', '#f72585'],
    ['#7209b7', '#4cc9f0'],
    ['#06d6a0', '#118ab2'],
    ['#ef476f', '#8338ec'],
    ['#3a86ff', '#ff006e'],
    ['#fb5607', '#ffbe0b'],
    ['#2ec4b6', '#cbf3f0']
  ]
  pairs.forEach(([outer, inner], i) => {
    const dir = new THREE.Vector3(gauss(rand), gauss(rand) * 0.55, gauss(rand)).normalize()
    const at = dir.multiplyScalar(2600 + rand() * 1200)
    const scale = 1400 + rand() * 1700
    // A wide veil in one colour with a brighter heart in another.
    for (const [color, k, opacity] of [
      [outer, 1, 0.16 + rand() * 0.12],
      [inner, 0.5, 0.14 + rand() * 0.12]
    ]) {
      const material = new THREE.SpriteMaterial({
        map: textures[(i + (k < 1 ? 1 : 0)) % textures.length],
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        rotation: rand() * Math.PI * 2
      })
      const s = new THREE.Sprite(material)
      s.position.copy(at)
      s.scale.setScalar(scale * k)
      s.userData = breath(rand, opacity, 0.004)
      group.add(s)
    }
  })
  return group
}

// Glowing gas along the spiral arms, pink where stars are being born, blue round
// young clusters. They turn with the disc; the frame loop makes them swirl, breathe,
// and now and then thin away and gather again elsewhere.
function armNebulae(textures) {
  const group = new THREE.Group()
  for (let i = 0; i < 64; i++) {
    const s = sprite(textures[i % textures.length], 1, 0)
    placeCloud(s, Math.random)
    // Part-way through their lives already, so they don't all come and go together.
    s.userData.born = -Math.random() * s.userData.span
    group.add(s)
  }
  return group
}

const CLOUD_COLORS = ['#ff3d8b', '#ff5fb0', '#c04bff', '#3fa9ff', '#22d3ee', '#ff7a5c', '#8b5cf6']

function placeCloud(s, rand, born = 0) {
  const r = 55 + Math.pow(rand(), 0.85) * (GALAXY_RADIUS - 55)
  const arm = Math.floor(rand() * ARMS)
  const angle = (arm / ARMS) * Math.PI * 2 + r * SPIN + gauss(rand) * 0.06
  s.material.color.set(CLOUD_COLORS[Math.floor(rand() * CLOUD_COLORS.length)])
  s.material.rotation = rand() * Math.PI * 2
  const x = Math.cos(angle) * r + gauss(rand) * 5
  const z = Math.sin(angle) * r + gauss(rand) * 5
  s.position.set(x, gauss(rand) * 2 + warpAt(x, z), z)
  Object.assign(s.userData, {
    size: 22 + rand() * 54,
    base: 0.32 + rand() * 0.3,
    born,
    span: 150 + rand() * 210,
    phase: rand() * Math.PI * 2,
    rate: (Math.PI * 2) / (25 + rand() * 50),
    spin: (rand() - 0.5) * 0.03
  })
  s.scale.setScalar(s.userData.size)
}

// A few close, bright stars with diffraction spikes, twinkling in the dark.
function brightStars(tex) {
  const group = new THREE.Group()
  const rand = mulberry32(21)
  const colors = ['#9fc3ff', '#ffffff', '#ffd9a0', '#ff9f7a', '#b7a4ff', '#7fe3ff']
  for (let i = 0; i < 34; i++) {
    const at = new THREE.Vector3(gauss(rand), gauss(rand), gauss(rand)).normalize().multiplyScalar(3600 + rand() * 900)
    const color = colors[Math.floor(rand() * colors.length)]
    const size = 26 + Math.pow(rand(), 2) * 60
    const glow = sprite(tex.glow, size, 0.8)
    const spikes = sprite(tex.spikes, size * 2.6, 0.5)
    spikes.material.rotation = rand() * 0.6
    for (const s of [glow, spikes]) {
      s.material.color.set(color)
      s.position.copy(at)
      s.userData = { phase: rand() * Math.PI * 2, rate: 0.6 + rand() * 1.6, base: s.material.opacity }
      group.add(s)
    }
  }
  return group
}

// Other galaxies, far off: small tilted spirals in soft colours.
function distantGalaxies(plane) {
  const group = new THREE.Group()
  const rand = mulberry32(64)
  const textures = [spiralTexture(3), spiralTexture(8), spiralTexture(13)]
  const colors = ['#cfe0ff', '#ffe2b8', '#ffc6e8', '#c7b8ff', '#b8fff0']
  for (let i = 0; i < 12; i++) {
    const material = new THREE.MeshBasicMaterial({
      map: textures[i % textures.length],
      color: colors[Math.floor(rand() * colors.length)],
      transparent: true,
      opacity: 0.45 + rand() * 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
    const mesh = new THREE.Mesh(plane, material)
    mesh.position.copy(new THREE.Vector3(gauss(rand), gauss(rand) * 0.7, gauss(rand)).normalize().multiplyScalar(3300 + rand() * 1300))
    mesh.scale.setScalar(70 + rand() * 170)
    mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI)
    group.add(mesh)
  }
  return group
}

// The far sky: violet, teal and rose gas and the glow of the Milky Way band, painted
// once into a small panorama that rides with the camera.
function skyDome() {
  const w = 512
  const h = 256
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(w, h)
  const hue = makeNoise(5)
  const gas = makeNoise(17)
  const band = BAND_NORMAL
  const warm = new THREE.Color('#ffc58a')
  const violet = new THREE.Color('#5b21b6')
  const teal = new THREE.Color('#0e7490')
  const rose = new THREE.Color('#be185d')
  const c = new THREE.Color()
  for (let y = 0; y < h; y++) {
    const theta = (y / (h - 1)) * Math.PI
    for (let x = 0; x < w; x++) {
      // The same mapping SphereGeometry uses, so the band lines up with the stars.
      const phi = (x / w) * Math.PI * 2
      const dx = -Math.cos(phi) * Math.sin(theta)
      const dy = Math.cos(theta)
      const dz = Math.sin(phi) * Math.sin(theta)
      const m = fbm(hue, dx * 1.4 + 3, dy * 1.4, dz * 1.4, 3)
      const g = fbm(gas, dx * 2.6, dy * 2.6 + 5, dz * 2.6, 5)
      const across = dx * band.x + dy * band.y + dz * band.z
      const inBand = Math.exp(-across * across * 22)
      const heart = Math.pow(Math.max(0, dx * BAND_CENTER.x + dy * BAND_CENTER.y + dz * BAND_CENTER.z), 3)
      // A dark lane of dust runs along the middle of the band, ragged at the edges.
      const lane = Math.exp(-Math.pow(across - 0.015 + (g - 0.5) * 0.05, 2) * 1400)
      c.copy(violet).lerp(teal, smooth(0.4, 0.62, m)).lerp(rose, smooth(0.55, 0.72, g) * 0.55).lerp(warm, inBand * heart * 0.6)
      const k = (Math.pow(Math.max(0, g - 0.33) / 0.67, 1.3) * 1.1 + inBand * (0.3 + g * 0.6 + heart * 0.5)) * (1 - lane * 0.7)
      image.data.set([Math.min(255, c.r * k * 255), Math.min(255, c.g * k * 255), Math.min(255, c.b * k * 255), 255], (y * w + x) * 4)
    }
  }
  ctx.putImageData(image, 0, 0)
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  const dome = new THREE.Mesh(new THREE.SphereGeometry(8000, 48, 24), new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, depthWrite: false }))
  dome.renderOrder = -1
  return dome
}

// The Milky Way's glow: soft clouds strung along the band, warm at its heart and
// blue-violet elsewhere, with dark dust drifting in front.
function milkyWay(tex) {
  const group = new THREE.Group()
  const rand = mulberry32(91)
  const side = new THREE.Vector3().crossVectors(BAND_NORMAL, BAND_CENTER)
  const cool = ['#8fa8ff', '#a98bff', '#7fd0ff', '#c79bff']
  for (let i = 0; i < 110; i++) {
    const angle = gauss(rand) * 1.1 + (rand() < 0.5 ? 0 : Math.PI * (rand() * 2 - 1))
    const heart = Math.max(0, Math.cos(angle))
    const at = BAND_CENTER.clone().multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle)).addScaledVector(BAND_NORMAL, gauss(rand) * 0.035)
    const cloud = sprite(tex.nebula[i % tex.nebula.length], 600 + rand() * 900 + heart * 400, 0.04 + rand() * 0.05 + heart * 0.025)
    cloud.material.color.set(heart > 0.6 && rand() < 0.75 ? (rand() < 0.5 ? '#ffd2a0' : '#ffb27a') : cool[Math.floor(rand() * cool.length)])
    cloud.material.rotation = rand() * Math.PI * 2
    cloud.position.copy(at.normalize().multiplyScalar(5200))
    cloud.userData = breath(rand, cloud.material.opacity, 0.002)
    group.add(cloud)
  }
  for (let i = 0; i < 40; i++) {
    const angle = gauss(rand) * 0.9
    const at = BAND_CENTER.clone().multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle)).addScaledVector(BAND_NORMAL, 0.01 + gauss(rand) * 0.012)
    const dust = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex.nebula[i % tex.nebula.length], color: '#000000', transparent: true, opacity: 0.35 + rand() * 0.25, depthWrite: false, rotation: rand() * Math.PI * 2 })
    )
    dust.position.copy(at.normalize().multiplyScalar(4100))
    dust.scale.set(500 + rand() * 600, 180 + rand() * 200, 1)
    group.add(dust)
  }
  return group
}

// Planetary nebulae: glowing shells left by dying stars, one colour outside, another in.
function ringNebulae(tex) {
  const group = new THREE.Group()
  const rand = mulberry32(55)
  const pairs = [
    ['#22d3ee', '#ff4fd8'],
    ['#34d399', '#60a5fa'],
    ['#f472b6', '#facc15'],
    ['#818cf8', '#22d3ee'],
    ['#fb7185', '#a78bfa']
  ]
  for (const [shell, heart] of pairs) {
    const at = new THREE.Vector3(gauss(rand), gauss(rand) * 0.6, gauss(rand)).normalize().multiplyScalar(3000 + rand() * 900)
    const size = 120 + rand() * 160
    const ring = sprite(tex.thinRing, size, 0.55)
    ring.material.color.set(shell)
    const halo = sprite(tex.ring, size * 1.15, 0.3)
    halo.material.color.set(shell)
    const core = sprite(tex.glow, size * 0.7, 0.45)
    core.material.color.set(heart)
    const star = sprite(tex.glow, size * 0.08, 1)
    for (const s of [ring, halo, core, star]) {
      s.position.copy(at)
      group.add(s)
    }
  }
  return group
}

// Globular clusters: tight balls of old, golden stars hanging above and below the disc.
function globularClusters(uniforms) {
  const rand = mulberry32(33)
  const clusters = 16
  const each = 520
  const position = new Float32Array(clusters * each * 3)
  const tint = new Float32Array(clusters * each * 3)
  const size = new Float32Array(clusters * each)
  const c = new THREE.Color()
  let n = 0
  for (let k = 0; k < clusters; k++) {
    const r = 140 + rand() * 300
    const a = rand() * Math.PI * 2
    const centre = new THREE.Vector3(Math.cos(a) * r, gauss(rand) * 110, Math.sin(a) * r)
    const spread = 3 + rand() * 4
    for (let i = 0; i < each; i++, n++) {
      const d = spread * Math.pow(rand(), 1.8) * 3
      const v = new THREE.Vector3(gauss(rand), gauss(rand), gauss(rand)).normalize().multiplyScalar(d)
      position.set([centre.x + v.x, centre.y + v.y, centre.z + v.z], n * 3)
      c.set(rand() < 0.8 ? '#ffe2b0' : '#cfdcff').multiplyScalar(0.25 + rand() * 0.35 + Math.max(0, 1 - d / spread) * 0.3)
      tint.set([c.r, c.g, c.b], n * 3)
      size[n] = 0.6 + rand() * 0.9
    }
  }
  return new THREE.Points(geometryOf(position, tint, size), pointsMaterial(uniforms, THREE.AdditiveBlending))
}

// A young star's protoplanetary disc: peach dust near the star cooling to lavender at
// the rim, turning slowly, streaked and ringed, with a dark lane at each planet's orbit.
// The geometry is a unit plane laid flat and scaled to the disc's diameter.
function diskMaterial(time) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: time,
      uInner: { value: 2 },
      uOuter: { value: 10 },
      uFade: { value: 1 },
      uGaps: { value: new Array(8).fill(1e4) },
      uWarm: { value: new THREE.Color('#ffcfae') },
      uCool: { value: new THREE.Color('#c7a8ff') }
    },
    vertexShader: `
      uniform float uOuter; varying vec2 vPos;
      void main() {
        vPos = position.xy * 2.0 * uOuter;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uInner; uniform float uOuter; uniform float uFade;
      uniform float uGaps[8]; uniform vec3 uWarm; uniform vec3 uCool; varying vec2 vPos;
      void main() {
        float r = length(vPos);
        if (r > uOuter) discard;
        float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
        float a = atan(vPos.y, vPos.x) + uTime * 0.05;
        // Bright rings with thin dark lanes between them, like HL Tauri.
        float ring = 0.35 + 0.65 * smoothstep(0.15, 0.85, 0.5 + 0.5 * sin(r * 3.1 + sin(a * 2.0) * 0.25));
        float streak = 0.82 + 0.18 * sin(a * 3.0 + r * 1.3) * sin(a * 7.0 - r * 0.6 + 1.7);
        // Fine grains, so it reads as dust rather than haze.
        vec2 cell = floor(vec2(a * 90.0, r * 14.0));
        float grain = 0.9 + 0.2 * fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
        float edge = smoothstep(uInner * 0.7, uInner * 1.2, r) * (1.0 - smoothstep(uOuter * 0.6, uOuter, r));
        float gap = 1.0;
        for (int i = 0; i < 8; i++) gap *= 0.12 + 0.88 * smoothstep(0.15, 0.85, abs(r - uGaps[i]));
        float alpha = edge * gap * ring * streak * grain * uFade * 0.5;
        gl_FragColor = vec4(mix(uWarm, uCool, t) * alpha, alpha);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  })
}

// The rule a star is made by. Its seed is a hash of its name and the minute it was born
// (when its repo first appeared on this Mac), so the same name born at another time is
// another star. The seed picks the dress by weight and its shape; the hour it was born
// picks its colours. Without a birth time, the name alone decides.
export function dressOf(app, bornAt = null) {
  const minute = bornAt ? Math.floor(bornAt / 60_000) : ''
  const rand = mulberry32(hash(`${app}|${minute}`) ^ 0x5bd1e995)
  let roll = rand() * STAR_DRESSES.reduce((sum, [, , weight]) => sum + weight, 0)
  let pick = STAR_DRESSES[0]
  for (const dress of STAR_DRESSES) {
    roll -= dress[2]
    if (roll < 0) {
      pick = dress
      break
    }
  }
  const hour = bornAt ? new Date(bornAt).getHours() : null
  const time = hour === null ? null : DRESS_TIMES.find(({ from, to }) => (from < to ? hour >= from && hour < to : hour >= from || hour < to))
  const family = time ? time.colors : DRESS_TIMES.flatMap((t) => t.colors)
  const [a, b] = family[Math.floor(rand() * family.length)]
  const colors = rand() < 0.5 ? [a, b] : [b, a]
  return { kind: pick[0], name: pick[1], time: time && { label: time.label, icon: time.icon }, bornAt, colors, seed: rand() * 100, angle: rand() * Math.PI, petals: 5 + Math.floor(rand() * 3), rand }
}

const NOISE_GLSL = `
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, w = 0.5;
    for (int i = 0; i < 4; i++) { v += w * noise(p); p *= 2.03; w *= 0.5; }
    return v;
  }`

// Gas round a star, always facing the camera: a ring nebula's shell, butterfly wings, a
// rose of petals, or an aurora's curtains. uSize is its radius in world units.
function cloudMaterial(look, a, b, time) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uSize: { value: 1 }, uLevel: { value: 1 }, uA: { value: a }, uB: { value: b }, uSeed: { value: look.seed }, uAngle: { value: look.angle }, uPetals: { value: look.petals } },
    defines: { [`KIND_${look.kind.toUpperCase()}`]: '' },
    vertexShader: `
      uniform float uSize; varying vec2 vP;
      void main() {
        vP = position.xy * 2.0;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * 2.0 * uSize;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uLevel; uniform float uSeed; uniform float uAngle; uniform float uPetals;
      uniform vec3 uA; uniform vec3 uB; varying vec2 vP;
      ${NOISE_GLSL}
      void main() {
        float r = length(vP);
        if (r > 1.0) discard;
        // atan(0, 0) is NaN on some GPUs, and the bloom spreads a NaN into a dark square.
        float a = r < 1e-4 ? 0.0 : atan(vP.y, vP.x);
        float t = uTime;
        vec3 col = vec3(0.0);
        #ifdef KIND_SHELL
          // A hollow shell of gas, brightest where we look through most of it: its rim.
          float n = fbm(vP * 3.2 + vec2(uSeed, t * 0.015));
          float shell = smoothstep(0.3, 0.6, r) * (1.0 - smoothstep(0.6, 0.9, r));
          float inner = (1.0 - smoothstep(0.0, 0.6, r)) * 0.35;
          col = mix(uA, uB, smoothstep(0.4, 0.78, r)) * shell * (0.3 + 1.2 * n) + uA * inner * (0.5 + 0.6 * n);
        #endif
        #ifdef KIND_WINGS
          // Two lobes out of a pinched waist, their edges brighter than their middles.
          vec2 q = mat2(cos(uAngle), -sin(uAngle), sin(uAngle), cos(uAngle)) * vP;
          float x = abs(q.x);
          float width = 0.06 + 0.42 * sin(clamp(x * 1.05, 0.0, 1.0) * 3.14159) * (0.9 + 0.1 * sin(t * 0.2 + uSeed));
          float lobe = (1.0 - smoothstep(width * 0.75, width, abs(q.y))) * smoothstep(0.02, 0.14, x) * (1.0 - smoothstep(0.72, 0.95, x));
          float rim = 0.35 + 0.65 * smoothstep(width * 0.3, width * 0.85, abs(q.y));
          float n = fbm(q * 4.0 + vec2(uSeed, t * 0.015));
          float waist = (1.0 - smoothstep(0.0, 0.16, r)) * 0.5;
          col = mix(uA, uB, smoothstep(0.1, 0.85, x)) * lobe * rim * (0.35 + 1.0 * n) + uA * waist;
        #endif
        #ifdef KIND_ROSE
          // Petals round a hollow heart, turning very slowly.
          float petal = 0.45 + 0.42 * pow(abs(cos(a * uPetals * 0.5 + t * 0.015)), 1.6);
          float body = (1.0 - smoothstep(petal - 0.22, petal, r)) * smoothstep(0.06, 0.24, r);
          float rim = 0.5 + 0.8 * smoothstep(petal - 0.32, petal - 0.06, r);
          float n = fbm(vP * 4.2 + vec2(uSeed, -t * 0.015));
          col = mix(uA, uB, smoothstep(0.15, 0.85, r / petal)) * body * rim * (0.3 + 0.9 * n);
        #endif
        #ifdef KIND_AURORA
          // Curtains of light round the star, waving, their colour drifting round.
          float wave = 0.56 + 0.06 * sin(a * 5.0 + t * 0.4) + 0.04 * sin(a * 9.0 - t * 0.25);
          float streak = 0.6 * noise(vec2(cos(a), sin(a)) * 7.0 + vec2(t * 0.05, 0.0)) + 0.4 * noise(vec2(cos(a), sin(a)) * 15.0 - vec2(t * 0.03, 0.0));
          float band = smoothstep(wave - 0.1, wave, r) * (1.0 - smoothstep(wave, wave + 0.12 + 0.3 * streak, r));
          col = mix(uA, uB, 0.5 + 0.5 * sin(a * 2.0 + t * 0.12)) * band * (0.35 + 1.0 * streak);
          // A faint glow inside the curtains, so the middle isn't a dark hole.
          col += mix(uA, uB, 0.5) * (1.0 - smoothstep(0.0, wave, r)) * 0.14;
        #endif
        float edge = 1.0 - smoothstep(0.85, 1.0, r);
        gl_FragColor = vec4(col * uLevel * edge * 0.5, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
}

// Light lying in a star's plane: a halo with beads of light running round it, or a whirl
// of two glowing arms.
function ringMaterial(look, a, b, time) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uLevel: { value: 1 }, uA: { value: a }, uB: { value: b }, uSeed: { value: look.seed } },
    defines: { [`KIND_${look.kind.toUpperCase()}`]: '' },
    vertexShader: `
      varying vec2 vP;
      void main() {
        vP = position.xy * 2.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uLevel; uniform float uSeed; uniform vec3 uA; uniform vec3 uB; varying vec2 vP;
      ${NOISE_GLSL}
      void main() {
        float r = length(vP);
        if (r > 1.0) discard;
        // atan(0, 0) is NaN on some GPUs, and the bloom spreads a NaN into a dark square.
        float a = r < 1e-4 ? 0.0 : atan(vP.y, vP.x);
        float t = uTime;
        vec3 col = vec3(0.0);
        #ifdef KIND_HALO
          float ring = exp(-pow((r - 0.8) / 0.022, 2.0)) + 0.3 * exp(-pow((r - 0.8) / 0.11, 2.0)) + 0.3 * exp(-pow((r - 0.94) / 0.01, 2.0));
          float beads = pow(max(0.0, cos(a * 12.0 - t * 0.35)), 24.0) * exp(-pow((r - 0.8) / 0.03, 2.0));
          col = mix(uA, uB, 0.5 + 0.5 * cos(a + t * 0.05)) * ring + vec3(1.0) * beads * 0.8;
        #endif
        #ifdef KIND_WHIRL
          float arms = pow(0.5 + 0.5 * sin(a * 2.0 + log(max(r, 0.02)) * 5.0 - t * 0.3), 2.5);
          float n = fbm(vP * 5.0 + vec2(uSeed, t * 0.02));
          float body = smoothstep(0.1, 0.28, r) * (1.0 - smoothstep(0.55, 1.0, r));
          col = mix(mix(vec3(1.0), uA, smoothstep(0.12, 0.4, r)), uB, smoothstep(0.4, 0.9, r)) * body * arms * (0.4 + 0.9 * n);
        #endif
        gl_FragColor = vec4(col * uLevel * 0.6, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  })
}

// A pulsar's beam: brightest at the star, fading out along the cone.
function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uLevel: { value: 1 } },
    vertexShader: `
      varying float vAlong; varying float vFacing;
      void main() {
        vAlong = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Seen side-on the cone's skin is thin: its outline fades, so the beam looks soft.
        vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uLevel; varying float vAlong; varying float vFacing;
      void main() {
        float soft = smoothstep(0.0, 0.6, vFacing);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), vAlong * 0.5) * pow(vAlong, 2.2) * soft * uLevel * 0.5, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  })
}

// The Magellanic Clouds: two small, ragged galaxies hanging below ours, the larger
// with a barred heart and the pink glow of the Tarantula, the smaller a lavender
// smudge, and a faint bridge of stars and gas between them. They sit outside the
// disc, so as it turns they seem to drift slowly round it.
function magellanicClouds(tex, uniforms) {
  const rand = mulberry32(151)
  const group = new THREE.Group()
  const stars = []
  const c = new THREE.Color()
  const add = (x, y, z, color, bright, size) => {
    c.set(color).multiplyScalar(bright)
    stars.push(x, y, z, c.r, c.g, c.b, size)
  }
  const young = ['#c9d8ff', '#b4c8ff', '#d9ccff', '#c2b4ff', '#ffd0ea']
  const pick = (list) => list[Math.floor(rand() * list.length)]
  // Each cloud: a tilted frame, a bar (or a lump), clumps along one side, a thin haze.
  const cloud = (centre, tilt, radius, { bar, thick, clumps, haze, knots }) => {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...tilt))
    const v = new THREE.Vector3()
    const put = (x, y, z, color, bright, size) => {
      v.set(x, y, z).applyMatrix4(m).add(centre)
      add(v.x, v.y, v.z, color, bright, size)
    }
    for (let i = 0; i < bar; i++) put(gauss(rand) * radius * 0.42, gauss(rand) * radius * 0.06, gauss(rand) * radius * thick, rand() < 0.75 ? pick(young) : '#ffe6c4', 0.13 + rand() * 0.17, 0.8 + rand() * 1.1)
    for (let k = 0; k < clumps; k++) {
      const a = -0.3 + rand() * 2.2
      const r = radius * (0.35 + rand() * 0.6)
      const cx = Math.cos(a) * r
      const cz = Math.sin(a) * r * 0.8
      const spread = radius * (0.08 + rand() * 0.12)
      for (let i = 0; i < 420; i++) put(cx + gauss(rand) * spread, gauss(rand) * spread * 0.4, cz + gauss(rand) * spread, pick(young), 0.25 + rand() * 0.3, 0.7 + rand() * 1)
    }
    for (let i = 0; i < haze; i++) put(gauss(rand) * radius * 0.7, gauss(rand) * radius * 0.12, gauss(rand) * radius * 0.55, rand() < 0.5 ? '#ffe6c4' : pick(young), 0.12 + rand() * 0.14, 0.6 + rand() * 0.8)
    // Star-forming knots: small, bright and pink.
    for (let i = 0; i < knots; i++) put(gauss(rand) * radius * 0.5, gauss(rand) * radius * 0.05, gauss(rand) * radius * 0.35, rand() < 0.7 ? '#ff9fd0' : '#9fe8ff', 0.6 + rand() * 0.3, 1.4 + rand() * 1.2)
  }
  // Just past the disc's rim, a little below it, so the overview catches them at its edge.
  const large = new THREE.Vector3(-385, -40, 280)
  const small = new THREE.Vector3(-480, -70, 120)
  cloud(large, [0.5, 0.4, 0.25], 80, { bar: 2400, thick: 0.15, clumps: 9, haze: 2600, knots: 90 })
  cloud(small, [0.9, -0.3, 0.5], 42, { bar: 900, thick: 0.32, clumps: 4, haze: 1400, knots: 30 })
  // The bridge: thin stars strung from one to the other.
  for (let i = 0; i < 900; i++) {
    const k = rand()
    add(small.x + (large.x - small.x) * k + gauss(rand) * 9, small.y + (large.y - small.y) * k + gauss(rand) * 5, small.z + (large.z - small.z) * k + gauss(rand) * 9, pick(young), 0.12 + rand() * 0.12, 0.6 + rand() * 0.7)
  }
  const n = stars.length / 7
  const position = new Float32Array(n * 3)
  const tint = new Float32Array(n * 3)
  const size = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    position.set(stars.slice(i * 7, i * 7 + 3), i * 3)
    tint.set(stars.slice(i * 7 + 3, i * 7 + 6), i * 3)
    size[i] = stars[i * 7 + 6]
  }
  group.add(new THREE.Points(geometryOf(position, tint, size), pointsMaterial(uniforms, THREE.AdditiveBlending)))
  // Their gas: soft pastel veils that breathe like the far nebulae.
  const veil = (at, color, scale, opacity) => {
    const s = sprite(tex.nebula[Math.floor(rand() * tex.nebula.length)], scale, opacity)
    s.material.color.set(color)
    s.material.rotation = rand() * Math.PI * 2
    s.position.copy(at)
    s.userData = breath(rand, opacity, 0.01)
    group.add(s)
  }
  const near = (centre, r) => centre.clone().add(new THREE.Vector3(gauss(rand) * r, gauss(rand) * r * 0.25, gauss(rand) * r))
  for (const color of ['#b49bff', '#ff9fd0', '#8fd8ff', '#c9a6ff', '#ffb8d8']) veil(near(large, 26), color, 110 + rand() * 70, 0.16 + rand() * 0.08)
  for (const color of ['#c2a8ff', '#9fe0ff', '#ffb3dc']) veil(near(small, 12), color, 65 + rand() * 35, 0.15 + rand() * 0.07)
  for (let i = 1; i <= 3; i++) veil(small.clone().lerp(large, i / 4), '#b8d8ff', 60 + rand() * 30, 0.05)
  // The Tarantula: the brightest star-forming cloud nearby, a pink glow with a lacy halo.
  const tarantula = large.clone().add(new THREE.Vector3(28, 6, -18))
  veil(tarantula, '#ff9fd0', 60, 0.45)
  const heart = sprite(tex.glow, 24, 0.7)
  heart.material.color.set('#ffb3da')
  heart.position.copy(tarantula)
  group.add(heart)
  return group
}

// A comet far out, crossing the sky over a minute or two with its tail turned away
// from the galaxy's core.
function driftingComet(glow) {
  const TAIL = 90
  const positions = new Float32Array(TAIL * 3)
  const colors = new Float32Array(TAIL * 3)
  const jitter = Array.from({ length: TAIL }, () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5))
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const tail = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ map: glow, size: 70, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  )
  tail.frustumCulled = false
  const head = sprite(glow, 80, 0)
  head.material.color.set('#c8f6ff')
  const group = new THREE.Group()
  group.add(tail, head)
  group.visible = false
  const away = new THREE.Vector3()
  let run = null
  let next = 30 + Math.random() * 40
  return {
    group,
    head,
    // Caught: it's gone until the next one comes.
    stop(time) {
      run = null
      group.visible = false
      next = time + 150 + Math.random() * 150
    },
    step(time) {
      if (!run && time > next) {
        const a = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.5, Math.random() - 0.5).normalize()
        const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(a).normalize()
        const b = a.clone().applyAxisAngle(axis, 0.8 + Math.random() * 0.6)
        run = { a: a.multiplyScalar(4300), b: b.multiplyScalar(4300), begin: time, duration: 70 + Math.random() * 50 }
      }
      if (!run) return
      const k = (time - run.begin) / run.duration
      if (k >= 1) {
        run = null
        group.visible = false
        next = time + 150 + Math.random() * 150
        return
      }
      group.visible = true
      const fade = Math.min(1, k * 6, (1 - k) * 6)
      head.position.lerpVectors(run.a, run.b, k)
      head.material.opacity = 0.95 * fade
      away.copy(head.position).normalize()
      for (let i = 0; i < TAIL; i++) {
        const t = i / TAIL
        const j = jitter[i]
        positions[i * 3] = head.position.x + away.x * t * 700 + j.x * t * 90
        positions[i * 3 + 1] = head.position.y + away.y * t * 700 + j.y * t * 90
        positions[i * 3 + 2] = head.position.z + away.z * t * 700 + j.z * t * 90
        const b = Math.pow(1 - t, 1.5) * 0.45 * fade
        colors[i * 3] = 0.55 * b
        colors[i * 3 + 1] = 0.85 * b
        colors[i * 3 + 2] = b
      }
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
    }
  }
}

function galaxyDisc(uniforms) {
  const rand = mulberry32(42)
  const count = 150000
  const position = new Float32Array(count * 3)
  const tint = new Float32Array(count * 3)
  const size = new Float32Array(count)
  const inner = new THREE.Color('#ffcf8f')
  const outer = new THREE.Color('#4a7bff')
  const pink = new THREE.Color('#ff4f9a')
  const cyan = new THREE.Color('#3fd8ff')
  const violet = new THREE.Color('#a66bff')
  const white = new THREE.Color('#e9efff')
  const c = new THREE.Color()
  const R = GALAXY_RADIUS
  for (let i = 0; i < count; i++) {
    let x, y, z, r, b
    const kind = rand()
    if (kind < 0.12) {
      // Bulge: a dense, warm, nearly round swell around the core, so from the side the
      // middle stands up out of the disc.
      r = Math.abs(gauss(rand)) * 34
      const th = rand() * Math.PI * 2
      const ph = Math.acos(2 * rand() - 1)
      x = r * Math.sin(ph) * Math.cos(th)
      y = r * Math.cos(ph) * 0.78
      z = r * Math.sin(ph) * Math.sin(th)
      c.copy(inner).lerp(white, rand() * 0.25)
      b = 0.045 + 0.08 * Math.max(0, 1 - r / 45)
      size[i] = 0.9 + rand() * 1.4
    } else if (kind < 0.22) {
      // Thin field between the arms.
      r = Math.sqrt(rand()) * R * 1.05
      const a = rand() * Math.PI * 2
      x = Math.cos(a) * r
      z = Math.sin(a) * r
      y = gauss(rand) * 3 + warpAt(x, z)
      c.copy(inner).lerp(outer, Math.min(1, r / R))
      b = 0.07
      size[i] = 0.6 + rand() * 0.9
    } else if (kind < 0.32) {
      // Thick disc: old, faint stars in a puffier layer that flares towards the rim.
      r = Math.pow(rand(), 0.75) * R
      const a = rand() * Math.PI * 2
      x = Math.cos(a) * r
      z = Math.sin(a) * r
      y = gauss(rand) * (7 + 18 * (r / R)) + warpAt(x, z)
      c.copy(inner).lerp(white, 0.35)
      b = 0.045 + rand() * 0.04
      size[i] = 0.6 + rand() * 0.8
    } else {
      r = Math.pow(rand(), 1.25) * R
      const arm = Math.floor(rand() * ARMS)
      const angle = (arm / ARMS) * Math.PI * 2 + r * SPIN
      const spread = 6 + r * (0.1 + 0.16 * (r / R))
      const off = () => Math.pow(rand(), 2.6) * (rand() < 0.5 ? -1 : 1) * spread
      x = Math.cos(angle) * r + off()
      z = Math.sin(angle) * r + off()
      y = gauss(rand) * (2 + 5 * (1 - r / R)) + warpAt(x, z)
      c.copy(inner).lerp(outer, Math.min(1, r / (R * 0.55)))
      // Young arms: the outer reaches run cyan and violet.
      if (r > R * 0.35) c.lerp(rand() < 0.5 ? cyan : violet, rand() * 0.45)
      b = 0.15 + rand() * 0.22
      size[i] = 0.55 + rand() * 1
      const roll = rand()
      if (roll < 0.012 && r > 60) {
        c.copy(roll < 0.006 ? pink : cyan) // star-forming knots and hot young clusters
        b = 0.65
        size[i] *= 1.8
      } else if (roll < 0.03) {
        c.copy(white)
        b = 0.5
      }
    }
    position.set([x, y, z], i * 3)
    c.multiplyScalar(b)
    tint.set([c.r, c.g, c.b], i * 3)
  }
  const stars = new THREE.Points(geometryOf(position, tint, size), pointsMaterial(uniforms, THREE.AdditiveBlending))

  // Dust lanes on the inner edge of each arm dim what lies behind them. Not one even
  // ribbon per arm: the dust gathers in clouds of their own length, width and weight that
  // drift off the arm and back and leave gaps, and some send a feather out across the
  // gap between arms. Thick near the core, broken up towards the rim.
  const clouds = []
  for (let arm = 0; arm < ARMS; arm++) {
    let r = 32 + rand() * 12
    while (r < R - 20) {
      const length = (14 + rand() * 46) * (1.25 - (r / R) * 0.6)
      const weight = length * (0.3 + rand() * 0.9) * (1.4 - r / R)
      clouds.push({ arm, from: r, length, weight, width: 0.5 + rand() * 1.1, shift: gauss(rand) * 0.05, wave: rand() * Math.PI * 2 })
      if (rand() < 0.5) clouds.push({ arm, from: r + rand() * length, length: 14 + rand() * 30, weight: weight * 0.3, feather: true })
      r += length + (rand() < 0.4 ? 6 + rand() * (10 + r * 0.12) : rand() * 4)
    }
  }
  const total = clouds.reduce((sum, cloud) => sum + cloud.weight, 0)
  const dustCount = 26000
  const dPos = new Float32Array(dustCount * 3)
  const dTint = new Float32Array(dustCount * 3)
  const dSize = new Float32Array(dustCount)
  for (let i = 0; i < dustCount; i++) {
    let pickAt = rand() * total
    const cloud = clouds.find((c) => (pickAt -= c.weight) <= 0) || clouds[clouds.length - 1]
    const start = (cloud.arm / ARMS) * Math.PI * 2 - 0.16
    let r, angle, spread
    if (cloud.feather) {
      // Leaves the lane at a steeper pitch than the arm, thinning as it goes.
      const t = Math.pow(rand(), 0.8)
      r = cloud.from + t * cloud.length
      angle = start + cloud.from * SPIN + (r - cloud.from) * SPIN * 0.25
      spread = (1.5 + r * 0.02) * (1 - 0.6 * t)
      dSize[i] = 4 + rand() * 5
    } else {
      // Densest mid-cloud, fading out at both ends.
      r = cloud.from + ((rand() + rand()) / 2) * cloud.length
      angle = start + r * SPIN + cloud.shift + 0.05 * Math.sin(r * 0.045 + cloud.wave)
      spread = (3 + r * 0.06) * cloud.width
      dSize[i] = 5 + rand() * 7
    }
    const x = Math.cos(angle) * r + gauss(rand) * spread
    const z = Math.sin(angle) * r + gauss(rand) * spread
    dPos.set([x, gauss(rand) * 1.2 + warpAt(x, z), z], i * 3)
    dTint.set([0.012, 0.01, 0.012], i * 3)
  }
  const dust = new THREE.Points(geometryOf(dPos, dTint, dSize), dustMaterial(uniforms))
  dust.renderOrder = 1

  // Halo: a sparse, faint cloud of old stars all round the disc, above and below it too,
  // thickest near the core. It gives the galaxy depth from the side.
  const haloCount = 9000
  const hPos = new Float32Array(haloCount * 3)
  const hTint = new Float32Array(haloCount * 3)
  const hSize = new Float32Array(haloCount)
  for (let i = 0; i < haloCount; i++) {
    const r = 25 + Math.pow(rand(), 1.7) * R * 1.05
    const th = rand() * Math.PI * 2
    const ph = Math.acos(2 * rand() - 1)
    hPos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.62, r * Math.sin(ph) * Math.sin(th)], i * 3)
    c.copy(inner).lerp(white, rand() * 0.5).multiplyScalar((0.07 + rand() * 0.09) * (1.25 - (r / R) * 0.6))
    hTint.set([c.r, c.g, c.b], i * 3)
    hSize[i] = 0.6 + rand() * 0.9
  }
  const halo = new THREE.Points(geometryOf(hPos, hTint, hSize), pointsMaterial(uniforms, THREE.AdditiveBlending))
  return [stars, dust, halo]
}

function galaxyCore(glow) {
  const halo = sprite(glow, 300, 0.05)
  halo.material.color.set('#8a5cff')
  const big = sprite(glow, 120, 0.1)
  big.material.color.set('#ff9d55')
  const mid = sprite(glow, 30, 0.16)
  mid.material.color.set('#ffcf94')
  const hot = sprite(glow, 5, 0.9)
  hot.material.color.setRGB(1.5, 1.3, 1.05)
  // How each layer breathes: how far behind the heart, how much it swells and brightens.
  const breath = [
    [hot, 0, 0.14, 0.12],
    [mid, 0.35, 0.13, 0.4],
    [big, 0.8, 0.09, 0.45],
    [halo, 1.3, 0.05, 0.55]
  ]
  for (const [part, lag, swell, glow] of breath) part.userData = { size: part.scale.x, opacity: part.material.opacity, lag, swell, glow }
  return [halo, big, mid, hot]
}

function geometryOf(position, tint, size) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(size, 1))
  return geometry
}

// Stars stay pin-sharp up close (capped size) and fade out right in front of the camera.
function pointsMaterial(uniforms, blending, alpha = 1, maxSize = 4.5) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uAlpha: { value: alpha }, uMax: { value: maxSize } },
    vertexShader: `
      attribute vec3 tint; attribute float size; uniform float uScale; uniform float uPixel; uniform float uMax;
      varying vec3 vTint; varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = clamp(size * uScale / d, 0.0, uMax * uPixel);
        vFade = smoothstep(2.0, 35.0, d);
        vTint = tint;
      }`,
    fragmentShader: `
      uniform float uAlpha; varying vec3 vTint; varying float vFade;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = exp(-dot(c, c) * 14.0) * uAlpha * vFade;
        gl_FragColor = vec4(vTint, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending
  })
}

// The dust's dark points. Seen from the side they would pile up into black slabs taller
// than the disc, so the closer the eye is to the disc's plane, the smaller and fainter
// each point gets: edge-on the dust is a thin, soft lane through the middle.
function dustMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uAlpha: { value: 0.26 }, uMax: { value: 36 } },
    vertexShader: `
      attribute vec3 tint; attribute float size; uniform float uScale; uniform float uPixel; uniform float uMax;
      varying vec3 vTint; varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float face = smoothstep(0.03, 0.55, abs(dot(normalize(normalMatrix * vec3(0.0, 1.0, 0.0)), normalize(-mv.xyz))));
        gl_PointSize = clamp(size * mix(0.35, 1.0, face) * uScale / d, 0.0, uMax * uPixel);
        vFade = smoothstep(2.0, 35.0, d) * mix(0.45, 1.0, face);
        vTint = tint;
      }`,
    fragmentShader: `
      uniform float uAlpha; varying vec3 vTint; varying float vFade;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = exp(-dot(c, c) * 14.0) * uAlpha * vFade;
        gl_FragColor = vec4(vTint, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending
  })
}

// ---------- planets ----------

function planetMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      starPos: { value: new THREE.Vector3() },
      rim: { value: new THREE.Color() },
      rimStrength: { value: 1 },
      dim: { value: 1 }
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform vec3 starPos; uniform vec3 rim; uniform float rimStrength; uniform float dim;
      varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main() {
        vec3 n = normalize(vN);
        vec3 l = normalize(starPos - vW);
        vec3 v = normalize(cameraPosition - vW);
        float ndl = dot(n, l);
        float day = smoothstep(-0.1, 0.3, ndl);
        vec3 albedo = texture2D(map, vUv).rgb;
        vec3 col = albedo * (0.03 + 1.35 * max(ndl, 0.0) + 0.12 * day);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);
        col += rim * fres * rimStrength * (0.3 + 0.7 * smoothstep(-0.5, 0.4, ndl));
        gl_FragColor = vec4(col * dim, 1.0);
      }`
  })
}

const textureCache = new Map()
function planetTexture(variant) {
  if (textureCache.has(variant)) return textureCache.get(variant)
  const W = 256
  const H = 128
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H })
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(W, H)
  const rand = mulberry32(variant * 977 + 13)
  const noise = makeNoise(variant * 31 + 5)
  const kind = ['gas', 'rock', 'ocean', 'gas', 'ice', 'rock', 'gas'][variant % 7]
  const palettes = {
    gas: [
      ['#8a5a3c', '#d9b98c', '#f3e6cc', '#b07a52'],
      ['#3d5f8a', '#7fa6cf', '#d2e4f2', '#5b80ad'],
      ['#7b6a4e', '#c8b58c', '#efe2c0', '#9c845c']
    ][variant % 3],
    rock: [
      ['#4a2f22', '#8a5536', '#b9784b', '#d9a77a'],
      ['#3b3a38', '#6b6863', '#9a958c', '#c9c2b4']
    ][variant % 2],
    ice: [['#7f9fb8', '#b9d0e0', '#e6f1f7', '#ffffff']][0],
    ocean: [['#0d2a52', '#1d4f8a', '#3a7a4a', '#c2b280']][0]
  }
  const pal = palettes[kind].map((hex) => new THREE.Color(hex))
  const bands = 6 + rand() * 10
  const c = new THREE.Color()
  for (let y = 0; y < H; y++) {
    const lat = (y / (H - 1) - 0.5) * Math.PI
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2
      const px = Math.cos(lat) * Math.cos(lon)
      const py = Math.sin(lat)
      const pz = Math.cos(lat) * Math.sin(lon)
      let t
      if (kind === 'gas') {
        const n = fbm(noise, px * 2.2, py * 2.2, pz * 2.2, 4)
        t = Math.sin(py * bands * 1.6 + n * 5) * 0.5 + 0.5
        ramp(c, pal, t)
      } else if (kind === 'ocean') {
        const n = fbm(noise, px * 1.8, py * 1.8, pz * 1.8, 5)
        if (Math.abs(py) > 0.86 + n * 0.08) c.set('#f4f8fb')
        else if (n > 0.53) ramp(c, [pal[2], pal[3]], (n - 0.53) * 4)
        else ramp(c, [pal[0], pal[1]], n * 1.8)
      } else {
        const n = fbm(noise, px * 2.6, py * 2.6, pz * 2.6, 5)
        t = kind === 'ice' ? n * 1.2 : n
        ramp(c, pal, Math.min(1, t))
      }
      const i = (y * W + x) * 4
      image.data[i] = c.r * 255
      image.data[i + 1] = c.g * 255
      image.data[i + 2] = c.b * 255
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  textureCache.set(variant, texture)
  return texture
}

function planetRing(seed, color = new THREE.Color(0.85, 0.77, 0.62)) {
  const geometry = new THREE.RingGeometry(1.5, 2.5, 96, 1)
  const material = new THREE.ShaderMaterial({
    uniforms: { seed: { value: (seed % 1000) / 1000 }, tint: { value: color } },
    vertexShader: `varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float seed; uniform vec3 tint; varying vec3 vP;
      void main() {
        float r = length(vP.xy);
        float t = (r - 1.5);
        float bands = 0.55 + 0.45 * sin(t * 38.0 + seed * 20.0) * sin(t * 11.0 + seed * 7.0);
        float edge = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.85, t);
        gl_FragColor = vec4(tint * 0.8, bands * edge * 0.55);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  })
  const ring = new THREE.Mesh(geometry, material)
  ring.rotation.x = Math.PI / 2 + ((seed % 60) / 60 - 0.5) * 0.6
  return ring
}

// ---------- textures ----------

function canvasTexture(size, paint) {
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size })
  paint(canvas.getContext('2d'), size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// A pillar of light: brightest at its foot, thinning out upwards, soft at the sides.
function beamTexture() {
  return canvasTexture(128, (ctx, s) => {
    const image = ctx.createImageData(s, s)
    for (let y = 0; y < s; y++) {
      const up = 1 - y / (s - 1)
      const fall = (1 - up) ** 1.8 * Math.min(1, up * 30)
      for (let x = 0; x < s; x++) {
        const u = (x / (s - 1)) * 2 - 1
        const a = fall * (Math.exp(-u * u * 18) * 0.7 + Math.exp(-u * u * 120) * 0.3)
        image.data.set([255, 255, 255, Math.round(255 * Math.min(1, a))], (y * s + x) * 4)
      }
    }
    ctx.putImageData(image, 0, 0)
  })
}

function glowTexture() {
  return canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.12, 'rgba(255,255,255,0.6)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.14)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
  })
}

// Diffraction spikes, like a bright star through a telescope.
function spikeTexture() {
  return canvasTexture(256, (ctx, s) => {
    const image = ctx.createImageData(s, s)
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const u = (x / (s - 1)) * 2 - 1
        const v = (y / (s - 1)) * 2 - 1
        const a = Math.max(Math.exp(-Math.abs(v) * 90) * Math.pow(1 - Math.abs(u), 3), Math.exp(-Math.abs(u) * 90) * Math.pow(1 - Math.abs(v), 3))
        const i = (y * s + x) * 4
        image.data.set([255, 255, 255, Math.min(255, a * 255)], i)
      }
    }
    ctx.putImageData(image, 0, 0)
  })
}

function ringTexture(size = 128, inner = 0.72, peak = 0.86) {
  return canvasTexture(size, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(inner, 'rgba(255,255,255,0)')
    g.addColorStop(peak, 'rgba(255,255,255,0.9)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
  })
}

function spiralTexture(seed) {
  return canvasTexture(128, (ctx, s) => {
    const rand = mulberry32(seed)
    const core = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.22)
    core.addColorStop(0, 'rgba(255,240,220,0.9)')
    core.addColorStop(1, 'rgba(255,240,220,0)')
    ctx.fillStyle = core
    ctx.fillRect(0, 0, s, s)
    const arms = 2 + (seed % 2)
    for (let i = 0; i < 1400; i++) {
      const r = Math.pow(rand(), 0.8) * s * 0.46
      const angle = (Math.floor(rand() * arms) / arms) * Math.PI * 2 + r * 0.09 + gauss(rand) * 0.25
      ctx.fillStyle = `rgba(255,255,255,${0.12 + rand() * 0.25})`
      ctx.fillRect(s / 2 + Math.cos(angle) * r, s / 2 + Math.sin(angle) * r, 1.2, 1.2)
    }
  })
}

// Two jets along the galaxy's axis: a strip for each beam and a few knots riding up it.
function coreJets(glow) {
  const group = new THREE.Group()
  const map = jetTexture()
  const beams = [1, -1].map((dir) => {
    const material = new THREE.MeshBasicMaterial({ map, color: '#a8c2ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    beam.userData.dir = dir
    return beam
  })
  const knots = Array.from({ length: 12 }, (_, i) => {
    const knot = sprite(glow, 3, 0)
    knot.material.color.set(i % 3 ? '#c4d2ff' : '#dcc2ff')
    knot.userData = { dir: i % 2 ? 1 : -1, t: i / 12, speed: 0.05 + (i % 4) * 0.012 }
    return knot
  })
  group.add(...beams, ...knots)
  for (const part of group.children) part.frustumCulled = false
  return { group, beams, knots }
}

// A jet: a thin bright spine in a soft sheath, flaring a little and fading towards its tip.
// The foot is at the bottom.
function jetTexture() {
  return canvasTexture(128, (ctx, s) => {
    const image = ctx.createImageData(s, s)
    for (let y = 0; y < s; y++) {
      const t = 1 - y / (s - 1) // 0 at the foot, 1 at the tip
      const along = Math.pow(1 - t, 1.3) * Math.min(1, (1 - t) * 30) * Math.min(1, t * 12 + 0.2)
      const width = 1 + t * 1.6
      for (let x = 0; x < s; x++) {
        const u = ((x / (s - 1)) * 2 - 1) / width
        const a = along * (Math.exp(-u * u * 90) * 0.8 + Math.exp(-u * u * 9) * 0.25)
        image.data.set([255, 255, 255, Math.round(255 * Math.min(1, a))], (y * s + x) * 4)
      }
    }
    ctx.putImageData(image, 0, 0)
  })
}

// A supernova remnant's shell: thin tangled threads round a wandering ring, brighter on
// one side, with a little glow inside. Ridged noise (bright where the noise crosses its
// middle) draws the threads.
function remnantTexture(seed) {
  return canvasTexture(256, (ctx, s) => {
    const noise = makeNoise(seed)
    const image = ctx.createImageData(s, s)
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const u = x / s - 0.5
        const v = y / s - 0.5
        const r = Math.hypot(u, v)
        const a = Math.atan2(v, u)
        const edge = 0.33 + 0.14 * (fbm(noise, Math.cos(a) * 1.4, Math.sin(a) * 1.4, seed * 0.7, 3) - 0.5)
        const band = Math.exp(-(((r - edge) / 0.075) ** 2))
        const thread = Math.pow(1 - Math.abs(fbm(noise, u * 9, v * 9, seed * 0.37, 4) - 0.5) * 2, 7)
        const side = 0.5 + 0.5 * Math.cos(a - seed)
        const inner = Math.max(0, 1 - r / edge) * 0.1 * fbm(noise, u * 4, v * 4, seed * 1.3, 3)
        const alpha = Math.min(1, band * (thread * (0.4 + side) * 1.5 + 0.08) + inner) * Math.min(1, (0.5 - r) * 12)
        image.data.set([255, 255, 255, Math.max(0, alpha) * 255], (y * s + x) * 4)
      }
    }
    ctx.putImageData(image, 0, 0)
  })
}

function nebulaTexture(seed) {
  return canvasTexture(256, (ctx, s) => {
    const noise = makeNoise(seed)
    const image = ctx.createImageData(s, s)
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const u = x / s - 0.5
        const v = y / s - 0.5
        const falloff = Math.max(0, 1 - (u * u + v * v) * 4)
        const n = fbm(noise, u * 3.2, v * 3.2, seed * 0.13, 5)
        const a = Math.pow(Math.max(0, n - 0.38) / 0.62, 1.6) * falloff
        image.data.set([255, 255, 255, a * 255], (y * s + x) * 4)
      }
    }
    ctx.putImageData(image, 0, 0)
  })
}

// Slow breathing for a far cloud: its opacity swells and fades over a minute or more
// and it turns a little.
function breath(rand, base, spin) {
  return { base, rate: (Math.PI * 2) / (60 + rand() * 120), phase: rand() * Math.PI * 2, spin: (rand() - 0.5) * spin }
}

// Space weather: when many agents work at once, pastel curtains of light ripple round
// the disc. The frame loop sets uLevel from how many are working.
function aurora() {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLevel: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uTime;
      uniform float uLevel;
      varying vec2 vUv;
      void main() {
        float x = vUv.x * 6.2831853;
        float t = uTime;
        // Only a few arcs of the ring light at a time, drifting slowly round.
        float arcs = smoothstep(0.5, 0.95, 0.5 + 0.5 * sin(x * 3.0 + t * 0.04) * sin(x * 2.0 - t * 0.03 + 1.3));
        // A soft, rippling lower hem, fading out upwards.
        float hem = 0.2 + 0.05 * sin(x * 9.0 + t * 0.4) + 0.03 * sin(x * 23.0 - t * 0.7);
        float v = vUv.y - hem;
        float body = smoothstep(-0.14, 0.06, v) * exp(-max(v, 0.0) * 2.6) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
        float ray = 0.5 + 0.5 * sin(x * 90.0 + sin(x * 13.0 + t * 0.25) * 5.0);
        float fine = 0.5 + 0.5 * sin(x * 260.0 + t * 0.6);
        float rays = 0.6 + 0.25 * ray + 0.15 * fine;
        vec3 low = vec3(0.62, 1.0, 0.82);
        vec3 high = vec3(0.86, 0.72, 1.0);
        vec3 col = mix(low, high, smoothstep(0.15, 0.8, vUv.y)) * body * rays * arcs;
        gl_FragColor = vec4(col * uLevel * 0.32, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  })
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(GALAXY_RADIUS * 1.15, GALAXY_RADIUS * 1.15, 80, 192, 1, true), material)
  mesh.position.y = 28
  mesh.visible = false
  return mesh
}

// A black hole for closing terminals: a dark heart, a swirling pastel disc of gas and a
// bright photon ring. It rides in front of the camera, so it stays put on screen.
function blackHole(ringTex) {
  const group = new THREE.Group()
  group.visible = false
  const swirl = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHeat: { value: 0 }, uFade: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uTime;
        uniform float uHeat;
        uniform float uFade;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          float a = atan(p.y, p.x);
          // Gas spirals inwards, faster near the heart and faster still while it feeds.
          float s = a + 2.2 / (r + 0.15) - uTime * (0.8 + uHeat * 1.6);
          float bands = 0.55 + 0.45 * sin(s * 3.0) * (0.6 + 0.4 * sin(s * 5.0 + r * 12.0));
          float disc = smoothstep(0.28, 0.4, r) * (1.0 - smoothstep(0.55, 1.0, r));
          // Kept dim: the bloom pass makes anything bright wash the dark heart out.
          vec3 col = mix(vec3(1.0, 0.8, 0.72), vec3(0.62, 0.5, 1.0), smoothstep(0.35, 0.85, r)) * disc * bands * (0.14 + uHeat * 0.18);
          float edge = (r - 0.31) / 0.04;
          col += vec3(1.0, 0.86, 0.8) * exp(-edge * edge) * (0.22 + uHeat * 0.25);
          gl_FragColor = vec4(col * uFade, 1.0);
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  )
  const heart = new THREE.Mesh(new THREE.CircleGeometry(0.15, 48), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, depthTest: false, depthWrite: false }))
  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.42),
    new THREE.MeshBasicMaterial({ map: ringTex, color: '#ffe6d0', transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending })
  )
  heart.renderOrder = 30
  swirl.renderOrder = 31
  ring.renderOrder = 32
  group.add(heart, swirl, ring)
  return {
    group,
    step(time, heat, fade) {
      const u = swirl.material.uniforms
      u.uTime.value = time
      u.uHeat.value = heat
      u.uFade.value = fade
      heart.material.opacity = fade
      ring.material.opacity = fade * (0.18 + 0.2 * heat)
      ring.rotation.z = time * 0.3
    }
  }
}

function lineGeometry(points) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points * 3), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(points * 3), 3))
  return geometry
}

function glowLine() {
  return new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
}

const gapA = new THREE.Vector3()
const gapB = new THREE.Vector3()

// Distance from point c to the segment a-b.
function segmentGap(a, b, c) {
  const ab = gapA.subVectors(b, a)
  const t = Math.max(0, Math.min(1, gapB.subVectors(c, a).dot(ab) / Math.max(1e-9, ab.lengthSq())))
  return gapB.copy(a).addScaledVector(ab, t).distanceTo(c)
}

// ---------- helpers ----------

function sprite(map, scale, opacity) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }))
  s.scale.setScalar(scale)
  return s
}

function labelObject(className, text) {
  const element = document.createElement('div')
  element.className = className
  element.append(Object.assign(document.createElement('span'), { textContent: text }))
  return new CSS2DObject(element)
}

function el(tag, text) {
  return Object.assign(document.createElement(tag), { textContent: text })
}

// Black-body-ish star colours: mostly white and yellow, a few blue and orange.
function starColor(t) {
  if (t < 0.12) return new THREE.Color('#9bb5ff')
  if (t < 0.55) return new THREE.Color('#f4f6ff')
  if (t < 0.82) return new THREE.Color('#fff1d8')
  if (t < 0.95) return new THREE.Color('#ffd2a1')
  return new THREE.Color('#ffaa7a')
}

function ramp(out, stops, t) {
  const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1)
  const i = Math.floor(x)
  return out.copy(stops[i]).lerp(stops[i + 1], x - i)
}

// The outer disc bends like a hat brim, up on one side and down on the other, as real
// discs do; flat inside, bending more the farther out.
function warpAt(x, z) {
  const r = Math.hypot(x, z) / GALAXY_RADIUS
  if (r < 0.45) return 0
  const k = (r - 0.45) / 0.55
  return WARP * k * k * Math.sin(Math.atan2(z, x) - 0.6)
}

// Where stars sit on an arm: from just outside the core's bulge to near the rim.
const ARM_INNER = 78
const ARM_OUTER = GALAXY_RADIUS - 22
// Radius a given share of the way along an arm, by length. An arm's length out to radius
// r is ∫ √(1 + (r·SPIN)²) dr; it is tabulated once and read back by interpolation.
const ARM_RADII = (() => {
  const length = (r) => {
    const u = r * SPIN
    return (u * Math.sqrt(1 + u * u) + Math.asinh(u)) / (2 * SPIN)
  }
  const from = length(ARM_INNER)
  const total = length(ARM_OUTER) - from
  return Array.from({ length: 129 }, (_, i) => {
    let lo = ARM_INNER
    let hi = ARM_OUTER
    for (let n = 0; n < 40; n++) {
      const mid = (lo + hi) / 2
      if (length(mid) - from < (i / 128) * total) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  })
})()

function armRadius(along) {
  const at = Math.min(1, Math.max(0, along)) * 128
  const i = Math.min(127, Math.floor(at))
  return ARM_RADII[i] + (ARM_RADII[i + 1] - ARM_RADII[i]) * (at - i)
}

// Murmur3's finalizer: every bit of the input stirs every bit of the output.
function mix(h) {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

function hash(text) {
  let h = 2166136261
  for (const ch of text) {
    h ^= ch.codePointAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gauss(rand) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
}

// 3D value noise: sampling it on a sphere gives seamless planet textures.
function makeNoise(seed) {
  const rand = mulberry32(seed)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const fade = (t) => t * t * (3 - 2 * t)
  const lerp = (a, b, t) => a + (b - a) * t
  return (x, y, z) => {
    const X = Math.floor(x)
    const Y = Math.floor(y)
    const Z = Math.floor(z)
    const fx = fade(x - X)
    const fy = fade(y - Y)
    const fz = fade(z - Z)
    const xi = X & 255
    const yi = Y & 255
    const zi = Z & 255
    const at = (i, j, k) => perm[perm[perm[(xi + i) & 255] + ((yi + j) & 255)] + ((zi + k) & 255)] / 255
    return lerp(
      lerp(lerp(at(0, 0, 0), at(1, 0, 0), fx), lerp(at(0, 1, 0), at(1, 1, 0), fx), fy),
      lerp(lerp(at(0, 0, 1), at(1, 0, 1), fx), lerp(at(0, 1, 1), at(1, 1, 1), fx), fy),
      fz
    )
  }
}

function fbm(noise, x, y, z, octaves) {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq, z * freq)
    norm += amp
    freq *= 2.03
    amp *= 0.5
  }
  return sum / norm
}
