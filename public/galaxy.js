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
const DISC_SPIN = 0.012 // galaxy rotation, radians per second (about 9 minutes a turn)
const OVERVIEW_DIR = new THREE.Vector3(0, 0.6, 0.8).normalize()
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
// Play: comets thrown by hand and bent by the stars, things to catch, the black hole.
const HOLD_MS = 420 // press and hold this long without moving to throw a comet or grab a planet
const STAR_GM = 22000 // a star's pull, times its size squared
const CORE_GM = 400000
const SOFTEN = 4
const MAX_THROW = 320
const AIM_STEPS = 90 // the predicted path: 3 seconds, 30 points a second
const TRAIL = 48
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
export function createGalaxy(host, { onPick, onPickSystem, onWarp, onSound, onOverview, onPlay, onClean }) {
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
  const auroraRing = aurora()
  disc.add(...galaxyDisc(pointUniforms), ...galaxyCore(tex.glow), clouds, globularClusters(pointUniforms), auroraRing)
  const hole = blackHole(tex.thinRing)
  camera.add(hole.group)
  let nextMeteor = 8 + Math.random() * 12
  let nextShower = 60 + Math.random() * 60
  let nextEvent = 45 + Math.random() * 60
  const events = [] // far supernovae and stars being born in the arms
  const thrown = [] // comets the viewer threw
  const bursts = [] // flashes from catches and collisions

  const systems = new Map() // app name -> system
  const planets = new Map() // terminal handle -> planet
  let order = []
  let layoutKey = ''
  let selected = null
  let searching = false // a search is typed: the planets it finds light up
  let searchTarget = null // the planet Enter goes to next
  let foundSoundAt = 0
  const spotPos = new THREE.Vector3()
  let hovered = null
  let follow = null // system the camera rides along with
  let flight = null
  let area = { x: 0, y: 0, width: 1, height: 1 }
  let areaGoal = null // the pane slides in and out; the view centre follows smoothly
  let size = { width: 1, height: 1 }
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
  let glow = BLOOM // the viewer can turn the bloom and the exposure down (or up)
  let busyAgents = 0 // agents working right now, for the aurora
  let auroraLevel = 0
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
    apps.forEach((app, i) => {
      const system = systems.get(app) || createSystem(app)
      system.home.copy(homeOf(i, apps.length, app))
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
  }

  function disposeSystem(system) {
    system.label.element.remove()
    for (const planet of system.planets) planet.label.element.remove()
    system.core.material.dispose()
    for (const s of [system.glow, system.corona, system.spikes, system.spikes2, ...system.beacons, ...system.sparkles.map((x) => x.sprite)]) s.material.dispose()
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

  function meteorShower() {
    if (reduceMotion || !active) return
    const { right, up } = cameraBasis()
    const dir = right.multiplyScalar(Math.random() < 0.5 ? -1 : 1).addScaledVector(up, -0.6).normalize()
    const count = 4 + Math.floor(Math.random() * 4)
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

  // ---------- far events ----------

  // Now and then something happens out there: a supernova flares in the sky, or gas in an
  // arm gathers and a new star lights up. Both happen where the viewer is looking.
  function cosmicEvent(kind = Math.random() < 0.5 ? 'nova' : 'birth') {
    if (reduceMotion || !active) return
    if (kind === 'birth' && starBirth()) return
    farNova()
  }

  function farNova() {
    const { forward, right, up } = cameraBasis()
    const group = new THREE.Group()
    group.position
      .copy(camera.position)
      .addScaledVector(forward, 2600)
      .addScaledVector(right, (Math.random() - 0.5) * 1700)
      .addScaledVector(up, (Math.random() - 0.3) * 900)
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
    events.push({ kind: 'nova', parent: scene, group, core, spikes, shell, remnant, begin: time, duration: 45 })
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

  // ---------- play ----------

  // Comets the viewer throws: pull back and let go. Every star and the galactic core pull
  // on them; too close and they're swallowed, into a planet and they splash.
  const aimLine = new THREE.Line(lineGeometry(AIM_STEPS), glowLine())
  const pullLine = new THREE.Line(lineGeometry(2), new THREE.LineBasicMaterial({ color: '#8fa4d8', transparent: true, opacity: 0.45, depthWrite: false }))
  const aimHead = sprite(tex.glow, 3, 0.95)
  aimHead.material.color.set('#e6f0ff')
  for (const part of [aimLine, pullLine, aimHead]) {
    part.frustumCulled = false
    part.visible = false
  }
  scene.add(aimLine, pullLine, aimHead)
  const spot = new THREE.Vector3()
  const proj1 = new THREE.Vector3()
  const proj2 = new THREE.Vector3()

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
    aim = { plane, from, to: from.clone(), x: event.clientX, y: event.clientY, pulled: 0, v: new THREE.Vector3() }
    controls.enabled = false
    canvas.style.cursor = 'crosshair'
    tip.hidden = true
    aimHead.position.copy(from)
    aimHead.visible = aimLine.visible = pullLine.visible = true
    moveAim(event)
    return true
  }

  function moveAim(event) {
    pointOn(aim.plane, event, aim.to)
    aim.pulled = Math.hypot(event.clientX - aim.x, event.clientY - aim.y)
    // A slingshot: it flies away from where it was pulled to, faster the further. Up
    // close, where everything is small, a pull counts for more.
    const reach = Math.max(1, Math.pow(400 / Math.max(1, camera.position.distanceTo(aim.from)), 0.6))
    aim.v.subVectors(aim.from, aim.to).multiplyScalar(1.6 * reach)
    if (aim.v.length() > MAX_THROW) aim.v.setLength(MAX_THROW)
  }

  // The path it will take, bent by the stars, drawn while aiming.
  function stepAim() {
    const { from, to, v } = aim
    pullLine.geometry.attributes.position.array.set([from.x, from.y, from.z, to.x, to.y, to.z])
    pullLine.geometry.attributes.position.needsUpdate = true
    aimHead.position.copy(from)
    aimHead.scale.setScalar(Math.max(1.4, camera.position.distanceTo(from) * 0.014) * (1 + 0.15 * Math.sin(time * 9)))
    const sources = attractors()
    const p = from.clone()
    const velocity = v.clone()
    const pos = aimLine.geometry.attributes.position
    const col = aimLine.geometry.attributes.color
    let stopped = aim.pulled < 14
    for (let i = 0; i < AIM_STEPS; i++) {
      if (i && !stopped) stopped = Boolean(fall(p, velocity, 1 / 30, sources))
      pos.setXYZ(i, p.x, p.y, p.z)
      const f = stopped ? 0 : Math.pow(1 - i / AIM_STEPS, 1.3) * 0.8
      col.setXYZ(i, 0.75 * f, 0.85 * f, f)
    }
    pos.needsUpdate = true
    col.needsUpdate = true
  }

  function endAim() {
    aim = null
    controls.enabled = true
    canvas.style.cursor = ''
    aimHead.visible = aimLine.visible = pullLine.visible = false
  }

  function releaseAim() {
    const { from, v, pulled } = aim
    endAim()
    if (pulled < 14 || v.lengthSq() < 1) return
    const head = sprite(tex.glow, 2, 0)
    head.material.color.set('#e6f0ff')
    const tail = new THREE.Line(lineGeometry(TRAIL), glowLine())
    tail.frustumCulled = false
    scene.add(head, tail)
    thrown.push({ p: from.clone(), v: v.clone(), head, tail, trail: [], age: 0, end: 0 })
    onSound?.('throw')
    onPlay?.({ type: 'throw' })
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
        if (hit || planet) collide(hit, planet)
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
        col.setXYZ(i, 0.65 * f, 0.8 * f, f)
      }
      pos.needsUpdate = true
      col.needsUpdate = true
      c.head.position.copy(c.p)
      c.head.scale.setScalar(Math.max(1.4, camera.position.distanceTo(c.p) * 0.012))
      c.head.material.opacity = c.end ? 0 : Math.min(1, c.age * 4)
    }
  }

  function collide(hit, planet) {
    if (planet) {
      burst(new THREE.Vector3(), { color: '#e6f0ff', size: 5 * planet.size, parent: planet.holder, sparks: 6 })
      onSound?.('comet')
      onPlay?.({ type: 'splash', app: planet.system.app })
    } else if (hit.system) {
      const s = hit.system.size * hit.system.grow
      burst(new THREE.Vector3(), { color: hit.system.color, size: 16 * s, parent: hit.system.group, sparks: 8 })
      hit.system.gulp = 1
      onSound?.('gulp')
      onPlay?.({ type: 'swallow', app: hit.system.app })
    } else {
      burst(new THREE.Vector3(), { color: '#ffe9cf', size: 70, parent: disc, sparks: 12, ms: 1600 })
      onSound?.('core')
      onPlay?.({ type: 'core' })
    }
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
    disc.remove(system.group)
    disposeSystem(system)
    for (const s of [...entry.remnant, entry.flash, entry.shock]) s.material.dispose()
    if (follow !== system) return
    // The camera watched the star go; now head for whatever the pane shows.
    follow = null
    if (selected && planets.has(selected)) flyTo(selected)
    else overview()
  }

  // Apps sit on the spiral arms, spread from the core outwards in name order.
  function homeOf(i, n, app) {
    const h = hash(app)
    const radius = 78 + ((i + 0.5) / n) * (GALAXY_RADIUS - 100)
    const arm = i % ARMS
    const angle = (arm / ARMS) * Math.PI * 2 + radius * SPIN + ((h % 1000) / 1000 - 0.5) * 0.2
    const y = (((h >>> 10) % 1000) / 1000 - 0.5) * 8
    return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
  }

  function createSystem(app) {
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
    group.add(tilt, core, corona, glow, spikes, spikes2, hit, label, ...sparkles.map((s) => s.sprite), ...beacons)
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
    systems.set(app, system)
    return system
  }

  // Size from how much agent work went in (tokens, then hours), on a log scale so one huge
  // project doesn't swallow the screen. Colour from age. Old stars also get sunspots.
  function applyStats(system, stats) {
    system.stats = stats || null
    const days = stats?.firstAt ? Math.max(0, (Date.now() - stats.firstAt) / 86_400_000) : null
    // No agent records (yet): still give each app its own place on the spectrum.
    if (days === null) spectral(Math.expm1(((system.seed % 1000) / 1000) * SPECTRAL[SPECTRAL.length - 1][0]), system.colorGoal)
    else spectral(days, system.colorGoal)
    // Stars of the same age still differ a little in hue.
    system.colorGoal.offsetHSL((((system.seed >>> 3) % 100) / 100 - 0.5) * 0.09, 0.08, 0)
    system.core.material.uniforms.spots.value = days === null ? 0 : smooth(10, 60, days) * 0.9
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
      onWarp?.(WARP_MS / 1000)
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
  }

  function overview() {
    follow = null
    const distance = overviewDistance()
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
    renderer.setSize(width, height, false)
    composer.setSize(width, height)
    labelRenderer.setSize(width, height)
    pointUniforms.uPixel.value = renderer.getPixelRatio()
    applyViewOffset()
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
    lastFrame = now
    time += dt
    pointUniforms.uTime.value = time

    // The universe keeps turning; only the camera's own drift pauses while the user drags.
    disc.rotation.y += DISC_SPIN * dt
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
    for (const group of [veils, band]) {
      for (const veil of group.children) {
        const u = veil.userData
        if (!u.rate) continue
        veil.material.rotation += u.spin * dt
        veil.material.opacity = u.base * (0.72 + 0.28 * Math.sin(time * u.rate + u.phase))
      }
    }
    // Space weather: the more agents at work, the brighter the aurora round the disc.
    auroraLevel += (Math.min(1, Math.max(0, (busyAgents - 1) / 4)) - auroraLevel) * Math.min(1, dt * 0.3)
    auroraRing.visible = auroraLevel > 0.005
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
      planet.ring?.scale.setScalar(planet.size)
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
    stepComets(now)
    stepMeteors(now)
    stepEvents(dt)
    if (aim) stepAim()
    stepThrown(dt)
    stepBursts(now, dt)
    stepHole(dt)
    controls.autoRotate = !flying && !dragging && !aim && !grab && now - releasedAt > 1200
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
    if (alert) system.glow.material.color.lerp(AMBER, 0.3)
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
  s.position.set(Math.cos(angle) * r + gauss(rand) * 5, gauss(rand) * 2, Math.sin(angle) * r + gauss(rand) * 5)
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
      // Bulge: a dense, warm ellipsoid around the core.
      r = Math.abs(gauss(rand)) * 30
      const th = rand() * Math.PI * 2
      const ph = Math.acos(2 * rand() - 1)
      x = r * Math.sin(ph) * Math.cos(th)
      y = r * Math.cos(ph) * 0.5
      z = r * Math.sin(ph) * Math.sin(th)
      c.copy(inner).lerp(white, rand() * 0.25)
      b = 0.045 + 0.08 * Math.max(0, 1 - r / 45)
      size[i] = 0.9 + rand() * 1.4
    } else if (kind < 0.26) {
      // Thin field between the arms.
      r = Math.sqrt(rand()) * R * 1.05
      const a = rand() * Math.PI * 2
      x = Math.cos(a) * r
      z = Math.sin(a) * r
      y = gauss(rand) * 3
      c.copy(inner).lerp(outer, Math.min(1, r / R))
      b = 0.07
      size[i] = 0.6 + rand() * 0.9
    } else {
      r = Math.pow(rand(), 1.25) * R
      const arm = Math.floor(rand() * ARMS)
      const angle = (arm / ARMS) * Math.PI * 2 + r * SPIN
      const spread = 6 + r * (0.1 + 0.16 * (r / R))
      const off = () => Math.pow(rand(), 2.6) * (rand() < 0.5 ? -1 : 1) * spread
      x = Math.cos(angle) * r + off()
      z = Math.sin(angle) * r + off()
      y = gauss(rand) * (2 + 5 * (1 - r / R))
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

  // Dust lanes on the inner edge of each arm dim what lies behind them.
  const dustCount = 26000
  const dPos = new Float32Array(dustCount * 3)
  const dTint = new Float32Array(dustCount * 3)
  const dSize = new Float32Array(dustCount)
  for (let i = 0; i < dustCount; i++) {
    const r = 35 + Math.pow(rand(), 1.1) * (R - 40)
    const arm = Math.floor(rand() * ARMS)
    const angle = (arm / ARMS) * Math.PI * 2 + r * SPIN - 0.16
    const spread = 3 + r * 0.06
    dPos.set([Math.cos(angle) * r + gauss(rand) * spread, gauss(rand) * 1.2, Math.sin(angle) * r + gauss(rand) * spread], i * 3)
    dTint.set([0.012, 0.01, 0.012], i * 3)
    dSize[i] = 5 + rand() * 7
  }
  const dust = new THREE.Points(geometryOf(dPos, dTint, dSize), pointsMaterial(uniforms, THREE.NormalBlending, 0.26, 36))
  dust.renderOrder = 1
  return [stars, dust]
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

function planetRing(seed) {
  const geometry = new THREE.RingGeometry(1.5, 2.5, 96, 1)
  const material = new THREE.ShaderMaterial({
    uniforms: { seed: { value: (seed % 1000) / 1000 } },
    vertexShader: `varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float seed; varying vec3 vP;
      void main() {
        float r = length(vP.xy);
        float t = (r - 1.5);
        float bands = 0.55 + 0.45 * sin(t * 38.0 + seed * 20.0) * sin(t * 11.0 + seed * 7.0);
        float edge = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.85, t);
        gl_FragColor = vec4(vec3(0.85, 0.77, 0.62) * 0.8, bands * edge * 0.55);
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
