// A temple above the sea, synthesized with Web Audio (no sound files):
// waves (파도) on the shore below, mountain wind (바람), wind bells (풍경) on the eaves
// when the wind picks up, now and then a great temple bell (범종) with its slow beating
// (맥놀이), and a singing bowl (싱잉볼) when a session needs you. Over it, a little
// generative music in the same key as the bells, and the time of day: birds in the
// morning, crickets at night, water dripping into a stone basin, and a bamboo grove
// (대나무 숲) that rustles with each breath of wind, its stems knocking when it gusts.
// Browsers only allow audio after a click or key press, so nothing starts before one.

const CHIME_GAP_MS = 1500
// The listener's own mix, each from 0 to 1.5 (1 is the mix as designed).
// Every sound has its own volume (0 turns it off).
export const MIX_DEFAULTS = { waves: 1, wind: 1, bamboo: 1, birds: 1, crickets: 1, drops: 1, music: 1, windbells: 1, temple: 1, alerts: 1 }
// Small bronze wind bells: two of them, a little out of tune with each other.
const WIND_BELLS = [1568, 1864.7]
const WIND_BELL_PARTIALS = [
  [1, 1],
  [2.32, 0.45],
  [4.25, 0.22],
  [6.63, 0.1]
]
// Great bell: a deep hum and the strongest beating partials, each a near-unison pair.
const TEMPLE_BELL_PARTIALS = [
  [1, 0.35, 0.33, 12],
  [2.06, 0.55, 0.5, 26],
  [2.81, 0.32, 0.7, 18],
  [3.76, 0.2, 0.9, 12],
  [5.02, 0.12, 1.3, 8],
  [6.41, 0.06, 1.7, 5]
]
// The music's modes, brightest first: each a pentatonic set on G (semitones above it).
// Over the whole galaxy the music is in G minor pentatonic, the key the bells and bowls
// are tuned to. A star brings its own mode: young blue stars the bright ones, old red
// stars the dark ones. Every mode keeps G, so moving between stars never jars.
export const MODES = [
  { name: '리디안', steps: [0, 4, 6, 7, 11] }, // G B C♯ D F♯: floating
  { name: '장조', steps: [0, 2, 4, 7, 9] }, // G A B D E: open and bright
  { name: '서스', steps: [0, 2, 5, 7, 10] }, // G A C D F: neither bright nor dark
  { name: '도리안', steps: [0, 2, 3, 7, 9] }, // G A B♭ D E: minor with a lift
  { name: '단조', steps: [0, 3, 5, 7, 10] }, // G B♭ C D F: the bells' own key
  { name: '미야코부시', steps: [0, 1, 5, 7, 8] } // G A♭ C D E♭: hushed, far away
]
export const HOME_MODE = 4
const G3 = 196
const SCALES = MODES.map((_, mode) => modeScale(mode))
// The whole home scale, G3 to G6. Alerts keep to it wherever the camera is.
const SCALE = SCALES[HOME_MODE]
// The music: one note per voice, each repeating on its own slow loop (seconds), in the
// spirit of Music for Airports. The loops never line up the same way twice. A voice is a
// step of the scale (in the home key: D5, B♭4, F4, G4, C5, D4, F5), so a star's mode
// moves every voice to its own note. The music also follows the sessions: a question
// waiting hangs an unresolved note over it, agents at work make it busier, and the star
// the camera is with gives it its mode, its timbre and its pace.
const MUSIC_VOICES = [
  [8, 19.7, 1.5],
  [6, 23.3, 6],
  [4, 29.1, 11],
  [5, 31.7, 3.5],
  [7, 37.3, 16],
  [3, 41.9, 22],
  [9, 47.6, 28]
]
// The music's brightness (lowpass cutoff, Hz): in the overview, and with the youngest and
// the oldest star.
const TONE_OPEN = 6000
const TONE_YOUNG = 9000
const TONE_OLD = 1600
// Water drops are tuned an octave or two above the music, in its mode: from this step up.
const DROP_FROM = 10
// Three crickets, each with its own pitch and place.
const CRICKETS = [
  [4300, -0.5],
  [4750, 0.35],
  [5150, 0.05]
]
// Singing bowl partials (ratio, level).
const BOWL_PARTIALS = [
  [1, 1],
  [2.71, 0.5],
  [5.15, 0.22],
  [8.43, 0.08]
]

export function createSound() {
  let ctx = null
  let bus = null
  let enabled = false
  let ambientOn = false
  let ambient = null
  let windTimer = null
  let waveTimer = null
  let templeTimer = null
  let musicTimer = null
  let birdTimer = null
  let cricketTimer = null
  let dropTimer = null
  let bambooTimer = null
  let grove = null
  let music = null
  let lastChime = 0
  let lastWarp = 0
  let lastGlide = 0
  let waiting = false
  let mix = { ...MIX_DEFAULTS }
  // What the sessions are doing, for the music: agents at work, questions waiting, and the
  // star the camera is with ({ warmth: 0 young … 1 old, busy, seed }, or null).
  let mood = { working: 0, attention: 0, star: null }
  let moodOn = true
  let density = 0 // eased share of agents at work, 0 to 1
  let tension = null // { since, next } while a question waits
  let nextRun = 0
  let musicTone = null
  let shimmer = null
  const births = new Map() // a star being made -> how far it has got, 0 to 1
  let gathering = null // the music of a star forming, while one is (see gather())
  let insideStar = null // the star the camera is inside, for its hum
  let hum = null

  function setup() {
    ctx = new AudioContext()
    const master = ctx.createGain()
    master.gain.value = 0.6
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -16
    limiter.ratio.value = 4
    limiter.connect(master).connect(ctx.destination)
    // Open air around the bells: a long, soft tail with the low end cut, so nothing
    // builds up into a hum.
    const reverb = ctx.createConvolver()
    reverb.buffer = impulse(ctx, 7, 2.4)
    const clear = ctx.createBiquadFilter()
    clear.type = 'highpass'
    clear.frequency.value = 240
    const damp = ctx.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = 3800
    const wet = ctx.createGain()
    wet.gain.value = 0.8
    reverb.connect(clear).connect(damp).connect(wet).connect(limiter)
    // The sea and the wind are outdoors: no reverb. This bus fades them in and out
    // with the galaxy view; each has its own volume after it.
    const ambientBus = ctx.createGain()
    ambientBus.gain.value = 0
    ambientBus.connect(limiter)
    const bellBus = ctx.createGain()
    const bellDry = ctx.createGain()
    bellDry.gain.value = 0.4
    bellBus.connect(bellDry).connect(limiter)
    bellBus.connect(reverb)
    const musicBus = ctx.createGain()
    musicBus.gain.value = 0
    // The star the camera is with colours the music: brighter for a young star, warmer for
    // an old one, and a slow tremolo while its agents work.
    musicTone = ctx.createBiquadFilter()
    musicTone.type = 'lowpass'
    musicTone.frequency.value = TONE_OPEN
    musicTone.Q.value = 0.5
    const tremolo = ctx.createGain()
    shimmer = ctx.createGain()
    shimmer.gain.value = 0
    const wobble = ctx.createOscillator()
    wobble.frequency.value = 4.5
    wobble.connect(shimmer).connect(tremolo.gain)
    wobble.start()
    musicBus.connect(musicTone).connect(tremolo)
    tremolo.connect(limiter)
    tremolo.connect(reverb)
    // One volume per sound the listener can set. Birds and crickets stay dry like the
    // sea; water drops, bells and alerts ring out through the reverb.
    const gain = (to, level) => {
      const node = ctx.createGain()
      node.gain.value = level
      node.connect(to)
      return node
    }
    bus = {
      ambient: ambientBus,
      music: musicBus,
      waves: gain(ambientBus, mix.waves),
      wind: gain(ambientBus, mix.wind),
      birds: gain(limiter, mix.birds),
      crickets: gain(limiter, mix.crickets),
      drops: gain(bellBus, mix.drops),
      windbells: gain(bellBus, mix.windbells),
      temple: gain(bellBus, mix.temple),
      alerts: gain(bellBus, mix.alerts),
      // The grove's leaves are outdoors and dry; a stem's knock carries a little.
      bamboo: gain(limiter, mix.bamboo),
      bambooWet: gain(bellBus, mix.bamboo),
      // A star forming has music of its own, at the music's volume, out in the open air.
      gather: gain(bellBus, 0),
      // Inside a star its hum, at the music's volume, dry: a reverb would only muddy it.
      hum: gain(limiter, mix.music)
    }
    applyTone()
  }

  // Wait for the first click or key press before creating any audio.
  function whenAllowed(fn) {
    if (navigator.userActivation?.hasBeenActive) return fn()
    if (waiting) return
    waiting = true
    const go = () => {
      removeEventListener('pointerdown', go, true)
      removeEventListener('keydown', go, true)
      waiting = false
      fn()
    }
    addEventListener('pointerdown', go, true)
    addEventListener('keydown', go, true)
  }

  function sync() {
    if (!enabled) {
      if (ctx) {
        fade(bus.ambient, 0, 1.5)
        fade(bus.music, 0, 1.5)
        fade(bus.gather, 0, 1.5)
        if (grove) fade(grove.level, 0, 1.5)
      }
      stopTimers()
      return
    }
    if (!ctx) return whenAllowed(() => {
      if (!ctx) setup()
      sync()
    })
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    if (ambientOn) {
      if (!ambient) ambient = startAmbient(ctx, bus.waves, bus.wind)
      if (!grove) grove = startGrove(ctx, bus.bamboo)
      fade(bus.ambient, 0.3, 5)
      fade(grove.level, 1, 6)
      if (!bambooTimer) scheduleBamboo(2500 + Math.random() * 4000)
      fade(bus.music, musicLevel(), 10)
      fade(bus.gather, mix.music, 3)
      if (!musicTimer) scheduleMusic()
      if (!birdTimer) scheduleBirds(3000 + Math.random() * 5000)
      if (!cricketTimer) scheduleCrickets(2000 + Math.random() * 3000)
      if (!dropTimer) scheduleDrop(6000 + Math.random() * 8000)
      if (!waveTimer) scheduleWave(500)
      if (!windTimer) scheduleWind(4000 + Math.random() * 6000)
      if (!templeTimer) scheduleTemple(40000 + Math.random() * 20000)
    } else {
      fade(bus.ambient, 0, 2.5)
      fade(bus.music, 0, 2.5)
      fade(bus.gather, 0, 2.5)
      if (grove) fade(grove.level, 0, 2.5)
      stopTimers()
    }
    if (births.size) gather()
    syncHum()
  }

  // Inside a star, with the galaxy's sounds on: its hum, on its own note; changing stars
  // fades one hum out as the next comes in.
  function syncHum() {
    if (!ctx) return
    const note = enabled && ambientOn && insideStar ? humNote(insideStar) : null
    if (hum && hum.note !== note) {
      const old = hum
      hum = null
      fade(old.level, 0, 1.5)
      setTimeout(() => old.stop(), 2500)
    }
    if (note && !hum) {
      hum = startHum(ctx, bus.hum, note)
      fade(hum.level, 0.045, 5)
    }
  }

  // The usual music steps back while a star forms, so its own music can be heard.
  function musicLevel() {
    return 0.22 * mix.music * (gathering && !gathering.ending ? 0.35 : 1)
  }

  // A star forming: a low open chord (G, D, A, D) swells under a filter that opens as the
  // work goes on, with a breath of gas through it. Glints of the home scale fall in like
  // the dust, more often and higher the further it has got, and now and then three notes
  // climb together. When the star lights, the chord opens right out and fades; if the work
  // fails, it sinks a third and is gone.
  function gather() {
    if (!births.size || !enabled || !ctx || ctx.state !== 'running') return
    const progress = Math.max(...births.values())
    if (!gathering || gathering.ending) {
      const out = ctx.createGain()
      out.gain.value = 0
      out.connect(bus.gather)
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 240
      filter.Q.value = 0.9
      filter.connect(out)
      const swirl = lfo(ctx, 0.07, 90, filter.frequency)
      const voices = [98, 146.83, 220, 293.66].flatMap((freq, i) =>
        [-5, 5].map((cents) => {
          const osc = ctx.createOscillator()
          osc.type = 'sawtooth'
          osc.frequency.value = freq
          osc.detune.value = cents
          const level = ctx.createGain()
          level.gain.value = 0.0045 - i * 0.0007
          osc.connect(level).connect(filter)
          osc.start()
          return osc
        })
      )
      const gas = ctx.createBufferSource()
      gas.buffer = pinkNoise(ctx, 6)
      gas.loop = true
      const band = ctx.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.value = 700
      band.Q.value = 1.4
      const drift = lfo(ctx, 0.05, 260, band.frequency)
      const breath = ctx.createGain()
      breath.gain.value = 0.012
      gas.connect(band).connect(breath).connect(out)
      gas.start()
      gathering = { out, filter, sources: [...voices, gas, swirl, drift], voices, progress: 0, nextRise: ctx.currentTime + 4 + Math.random() * 4 }
      if (ambientOn) fade(bus.music, musicLevel(), 4)
      gatherTick()
    }
    gathering.progress = Math.max(gathering.progress, progress)
    gathering.filter.frequency.setTargetAtTime(240 * Math.pow(8, gathering.progress), ctx.currentTime, 2)
    fade(gathering.out, 0.75 + 0.25 * gathering.progress, 3)
  }

  function gatherTick() {
    const g = gathering
    if (!g || g.ending) return
    g.timer = setTimeout(gatherTick, 400)
    if (!enabled || !ambientOn || !(mix.music > 0)) return
    const notes = SCALE
    const low = 3 + Math.round(g.progress * 6)
    const now = ctx.currentTime
    if (Math.random() < 0.1 + 0.3 * g.progress) {
      const step = Math.min(notes.length - 1, low + Math.floor(Math.random() * 6))
      pluck(ctx, bus.gather, notes[step], { at: now + 0.05 + Math.random() * 0.3, level: 0.004 + Math.random() * 0.004, pan: Math.random() * 1.4 - 0.7 })
    }
    if (now < g.nextRise) return
    const pan = Math.random() * 0.8 - 0.4
    ;[0, 2, 4].forEach((up, i) => {
      const step = Math.min(notes.length - 1, low - 2 + up)
      glassNote(ctx, bus.gather, notes[step], { at: now + 0.1 + i * 0.7, level: 0.007 + 0.003 * g.progress, pan: pan + i * 0.1, glass: 0.4 + 0.5 * g.progress })
    })
    g.nextRise = now + (11 - 5 * g.progress) * (0.8 + Math.random() * 0.4)
  }

  function ungather(failed) {
    const g = gathering
    if (!g || g.ending) return
    g.ending = true
    clearTimeout(g.timer)
    const now = ctx.currentTime
    if (failed) {
      // Sinks a minor third as it goes.
      for (const osc of g.voices) osc.detune.linearRampToValueAtTime(osc.detune.value - 300, now + 4)
      g.filter.frequency.setTargetAtTime(200, now, 1.2)
      fade(g.out, 0, 4)
    } else {
      // Opens right out as the star lights, and a run climbs into its first light.
      g.filter.frequency.setTargetAtTime(4200, now, 0.5)
      fade(g.out, 0, 5)
      if (enabled && ambientOn && mix.music > 0) {
        SCALE.slice(7, 13).forEach((freq, i) => pluck(ctx, bus.gather, freq, { at: now + 0.05 + i * 0.09, level: 0.012, pan: -0.5 + i * 0.2 }))
      }
    }
    for (const source of g.sources) source.stop(now + 7)
    setTimeout(() => {
      if (gathering === g) gathering = null
    }, 7000)
    if (enabled && ambientOn) fade(bus.music, 0.22 * mix.music, 8)
  }


  function stopTimers() {
    clearTimeout(windTimer)
    clearTimeout(waveTimer)
    clearTimeout(templeTimer)
    clearTimeout(musicTimer)
    clearTimeout(birdTimer)
    clearTimeout(cricketTimer)
    clearTimeout(dropTimer)
    clearTimeout(bambooTimer)
    windTimer = waveTimer = templeTimer = musicTimer = birdTimer = cricketTimer = dropTimer = bambooTimer = null
    music = null
  }

  // Birds sing most in the early morning, now and then through the day, and stop at dusk.
  function scheduleBirds(delay) {
    birdTimer = setTimeout(() => {
      birdTimer = null
      if (!enabled || !ambientOn) return
      const hour = new Date().getHours()
      const morning = hour >= 5 && hour < 10
      const day = hour >= 10 && hour < 18
      if ((morning || day) && mix.birds > 0) {
        const at = ctx.currentTime + 0.05
        const pan = Math.random() * 1.6 - 0.8
        birdCall(ctx, bus.birds, { at, level: 0.028 + Math.random() * 0.02, pan })
        // Sometimes another answers from across the way.
        if (Math.random() < (morning ? 0.5 : 0.25)) birdCall(ctx, bus.birds, { at: at + 1.2 + Math.random() * 1.5, level: 0.02 + Math.random() * 0.015, pan: -pan * 0.8 })
      }
      scheduleBirds(morning ? 5000 + Math.random() * 9000 : day ? 14000 + Math.random() * 20000 : 60000)
    }, delay)
  }

  // Crickets from evening till dawn: one at a time chirps a while, then rests.
  function scheduleCrickets(delay) {
    cricketTimer = setTimeout(() => {
      cricketTimer = null
      if (!enabled || !ambientOn) return
      const hour = new Date().getHours()
      const night = hour >= 20 || hour < 5
      const dusk = hour >= 18 && hour < 20
      if ((night || (dusk && Math.random() < 0.5)) && mix.crickets > 0) {
        const [freq, pan] = CRICKETS[Math.floor(Math.random() * CRICKETS.length)]
        let at = ctx.currentTime + 0.05
        const chirps = 4 + Math.floor(Math.random() * 6)
        for (let i = 0; i < chirps; i++) {
          cricket(ctx, bus.crickets, { at, freq, pulses: 3 + (Math.random() < 0.3 ? 1 : 0), level: 0.01 + Math.random() * 0.004, pan })
          at += 0.42 + Math.random() * 0.12
        }
      }
      scheduleCrickets(night ? 2500 + Math.random() * 4000 : 30000)
    }, delay)
  }

  // The bells on the eaves: G, and the mode's second note above it (B♭ in the home key).
  function eaveBells() {
    return [WIND_BELLS[0], WIND_BELLS[0] * 2 ** (MODES[moodOn ? starMode(mood.star) : HOME_MODE].steps[1] / 12)]
  }

  // A drop into the stone basin, sometimes followed by a smaller one.
  function scheduleDrop(delay) {
    dropTimer = setTimeout(() => {
      dropTimer = null
      if (!enabled || !ambientOn) return
      const at = ctx.currentTime + 0.05
      const drops = scale().slice(DROP_FROM)
      const note = drops[Math.floor(Math.random() * drops.length)]
      const pan = Math.random() * 0.8 - 0.4
      if (mix.drops > 0) waterDrop(ctx, bus.drops, note, { at, level: 0.035 + Math.random() * 0.02, pan })
      if (mix.drops > 0 && Math.random() < 0.35) waterDrop(ctx, bus.drops, note * (Math.random() < 0.5 ? 1.5 : 1.333), { at: at + 0.35 + Math.random() * 0.5, level: 0.02, pan })
      scheduleDrop(9000 + Math.random() * 20000)
    }, delay)
  }

  // The grove breathes with the wind: a sway every several seconds, and the harder
  // ones set a stem or two knocking against its neighbour.
  function scheduleBamboo(delay) {
    bambooTimer = setTimeout(() => {
      bambooTimer = null
      if (!enabled || !ambientOn) return
      sway(ctx.currentTime + 0.05, 3 + Math.random() * 4, 0.2 + Math.random() * 0.55)
      scheduleBamboo(5000 + Math.random() * 9000)
    }, delay)
  }

  function sway(at, seconds, strength) {
    grove?.sway(at, seconds, strength)
    if (strength < 0.45 || Math.random() < 0.3 || !(mix.bamboo > 0)) return
    let t = at + seconds * (0.2 + Math.random() * 0.25)
    const freq = 900 + Math.random() * 700
    const pan = Math.random() * 1.4 - 0.7
    const knocks = 2 + Math.floor(Math.random() * 4)
    for (let i = 0; i < knocks; i++) {
      // Each contact lands on a slightly different spot of the stem.
      bambooKnock(ctx, bus.bambooWet, freq * (1 + (Math.random() - 0.5) * 0.25), { at: t, level: 0.012 + Math.random() * 0.014, pan: pan + (Math.random() - 0.5) * 0.3 })
      // Stems rattle against each other: quick, uneven clatters, now and then a pause.
      t += Math.random() < 0.75 ? 0.05 + Math.random() * 0.1 : 0.4 + Math.random() * 0.6
    }
  }

  // Looks a second and a half ahead and books every note that falls in that window.
  function scheduleMusic() {
    if (!music) {
      music = MUSIC_VOICES.map(([step, period, offset], i) => ({ step, period, next: ctx.currentTime + offset, pan: ((i * 0.618) % 1) * 1.2 - 0.6 }))
    }
    musicTimer = setTimeout(() => {
      musicTimer = null
      if (!enabled || !ambientOn) return
      const horizon = ctx.currentTime + 1.5
      // More agents at work, the loops come round sooner; all quiet, they stretch out. A
      // big star (much work gone into it) keeps a quicker pace than a small one.
      density += ((moodOn ? Math.min(1, mood.working / 4) : 0) - density) * 0.05
      const star = moodOn ? mood.star : null
      const pace = (1.25 - 0.45 * density) * (star ? 1.15 - 0.3 * (star.size ?? 0.5) : 1)
      const notes = scale()
      for (const voice of music) {
        while (voice.next < horizon) {
          if (voice.next > ctx.currentTime && mix.music > 0) glassNote(ctx, bus.music, colour(notes[voice.step]), { at: voice.next, level: 0.016 + Math.random() * 0.006, pan: voice.pan, glass: glass() })
          voice.next += voice.period * pace
        }
      }
      if (moodOn && mix.music > 0) {
        run()
        question()
      }
      scheduleMusic()
    }, 1000)
  }

  // The notes the music plays in now: the star's mode, or the home key.
  function scale() {
    return SCALES[moodOn ? starMode(mood.star) : HOME_MODE]
  }

  // How glassy the notes ring: a young star's clear and bright, an old one's warm and round.
  function glass() {
    const star = moodOn && mood.star
    return star ? 1 - star.warmth : 0.5
  }

  // With a young star, a note now and then rises an octave; with an old one, it sinks.
  function colour(freq) {
    const star = moodOn && mood.star
    if (!star) return freq
    const roll = Math.random()
    if (freq < 600 && roll < (1 - star.warmth) * 0.45) return freq * 2
    if (freq > 330 && roll > 1 - star.warmth * 0.45) return freq / 2
    return freq
  }

  // With agents at work, a soft run of rising notes now and then: the more work, the more
  // often.
  function run() {
    const now = ctx.currentTime
    if (density < 0.3) return void (nextRun = 0)
    if (!nextRun) nextRun = now + 6 + Math.random() * 10
    if (now < nextRun) return
    let step = 5 + Math.floor(Math.random() * 4) // from G4 up to the fifth above
    let at = now + 0.1
    const pan = Math.random() * 1.2 - 0.6
    const notes = scale()
    for (let n = 3 + Math.floor(Math.random() * 3); n > 0 && step < notes.length; n--) {
      softNote(ctx, bus.music, colour(notes[step]), { at, level: 0.007 + 0.004 * density, pan, glass: glass() })
      step += Math.random() < 0.3 ? 2 : 1
      at += 0.22 + Math.random() * 0.1
    }
    nextRun = now + (34 - 22 * density) * (0.7 + Math.random() * 0.6)
  }

  // A question waiting: a step down from D that stops on C and hangs there, unresolved.
  // It comes every ten seconds or so, fainter and rarer once it has waited a few minutes.
  function question() {
    const now = ctx.currentTime
    if (mood.attention <= 0) return void (tension = null)
    if (!tension) tension = { since: now, next: now + 5 }
    if (now < tension.next) return
    const waited = now - tension.since
    const fade = waited < 120 ? 1 : Math.max(0.3, 1 - (waited - 120) / 240)
    glassNote(ctx, bus.music, 587.33, { at: now + 0.05, level: 0.017 * fade, pan: -0.2 })
    glassNote(ctx, bus.music, 523.25, { at: now + 0.8, level: 0.02 * fade, pan: 0.2 })
    tension.next = now + (9 + Math.random() * 4) * (waited < 120 ? 1 : 1.8)
  }

  // A question answered: the hanging C steps down to B♭, and once nothing is left waiting,
  // on home to G.
  function resolve(home) {
    const was = tension
    if (home) tension = null
    if (!was || !moodOn || !enabled || !ambientOn || ctx?.state !== 'running' || !(mix.music > 0)) return
    if (ctx.currentTime - was.since < 3) return
    const at = ctx.currentTime + 0.3
    glassNote(ctx, bus.music, 523.25, { at, level: 0.016, pan: 0.15 })
    glassNote(ctx, bus.music, 466.16, { at: at + 0.6, level: 0.018, pan: -0.1 })
    if (home) glassNote(ctx, bus.music, 392, { at: at + 1.3, level: 0.022, pan: 0 })
  }

  // Brightness and tremolo follow the star the camera is with, over several seconds.
  function applyTone() {
    if (!ctx) return
    const star = moodOn ? mood.star : null
    const cutoff = star ? TONE_YOUNG * Math.pow(TONE_OLD / TONE_YOUNG, star.warmth) : TONE_OPEN
    musicTone.frequency.setTargetAtTime(cutoff, ctx.currentTime, 5)
    shimmer.gain.setTargetAtTime(star?.busy ? 0.12 : 0, ctx.currentTime, 4)
  }

  // Waves come in one after another, never quite on a beat; now and then a bigger one.
  function scheduleWave(delay) {
    waveTimer = setTimeout(() => {
      waveTimer = null
      if (!enabled || !ambientOn) return
      const seconds = 7 + Math.random() * 5
      const size = Math.random() < 0.2 ? 0.8 + Math.random() * 0.2 : 0.35 + Math.random() * 0.35
      ambient.wave(ctx.currentTime + 0.05, seconds, size)
      scheduleWave(seconds * (850 + Math.random() * 250))
    }, delay)
  }

  // A gust: the wind swells and the eave bells knock a few times.
  function scheduleWind(delay) {
    windTimer = setTimeout(() => {
      windTimer = null
      if (!enabled || !ambientOn) return
      const at = ctx.currentTime + 0.05
      const gust = 1.5 + Math.random() * 2.5
      ambient.gust(at, gust)
      // The gust reaches the grove a moment later and leans it hard.
      sway(at + 0.5, gust + 2, 0.7 + Math.random() * 0.3)
      let t = at + 0.4 + Math.random() * 0.6
      const strikes = 1 + Math.floor(Math.random() * 4)
      for (let i = 0; i < strikes && mix.windbells > 0; i++) {
        windBell(ctx, bus.windbells, eaveBells()[Math.random() < 0.65 ? 0 : 1], { at: t, level: 0.03 + Math.random() * 0.035, pan: Math.random() * 0.8 - 0.4 })
        // Sometimes the clapper bounces straight back.
        t += Math.random() < 0.3 ? 0.09 + Math.random() * 0.08 : 0.35 + Math.random() * 0.9
      }
      scheduleWind(9000 + Math.random() * 14000)
    }, delay)
  }

  function scheduleTemple(delay) {
    templeTimer = setTimeout(() => {
      templeTimer = null
      if (!enabled || !ambientOn) return
      if (mix.temple > 0) templeBell(ctx, bus.temple, 88 + Math.random() * 6, { at: ctx.currentTime + 0.05, level: 0.03 })
      scheduleTemple(150000 + Math.random() * 90000)
    }, delay)
  }

  return {
    setMix(next) {
      mix = { ...MIX_DEFAULTS, ...next }
      if (!ctx) return
      for (const key of Object.keys(MIX_DEFAULTS)) if (key !== 'music') bus[key].gain.setTargetAtTime(mix[key], ctx.currentTime, 0.15)
      bus.bambooWet.gain.setTargetAtTime(mix.bamboo, ctx.currentTime, 0.15)
      bus.hum.gain.setTargetAtTime(mix.music, ctx.currentTime, 0.15)
      if (enabled && ambientOn) {
        fade(bus.music, musicLevel(), 0.4)
        fade(bus.gather, mix.music, 0.4)
      }
    },
    // A sample of one channel, so a slider can be set by ear.
    preview(channel) {
      if (!enabled || !ctx || ctx.state !== 'running') return
      const at = ctx.currentTime + 0.02
      if (channel === 'waves') ambient?.wave(at, 7, 0.8)
      else if (channel === 'wind') ambient?.gust(at, 3)
      else if (channel === 'birds') birdCall(ctx, bus.birds, { at, level: 0.04, pan: 0 })
      else if (channel === 'crickets') for (let i = 0; i < 4; i++) cricket(ctx, bus.crickets, { at: at + i * 0.45, freq: CRICKETS[0][0], pulses: 3, level: 0.014, pan: 0 })
      else if (channel === 'drops') waterDrop(ctx, bus.drops, SCALE[DROP_FROM + Math.floor(Math.random() * (SCALE.length - DROP_FROM))], { at, level: 0.045, pan: 0 })
      else if (channel === 'windbells') windBell(ctx, bus.windbells, WIND_BELLS[0], { at, level: 0.05, pan: 0 })
      else if (channel === 'temple') templeBell(ctx, bus.temple, 90, { at, level: 0.04 })
      else if (channel === 'alerts') windBell(ctx, bus.alerts, WIND_BELLS[0], { at, level: 0.06, pan: 0 })
      else if (channel === 'music') glassNote(ctx, bus.music, SCALE[MUSIC_VOICES[0][0]], { at, level: 0.03, pan: 0 })
      else if (channel === 'bamboo') {
        grove?.sway(at, 2.5, 0.9)
        ;[0.5, 0.58, 0.71, 0.77].forEach((dt, i) => bambooKnock(ctx, bus.bambooWet, 1150 * (1 + ((i * 37) % 9 - 4) * 0.03), { at: at + dt, level: 0.022, pan: -0.2 }))
      }
    },
    setEnabled(on) {
      enabled = on
      sync()
    },
    // A star being made (key: its folder) has got this far, 0 to 1: its music starts, or
    // follows along.
    gather(key, progress = 0) {
      births.set(key, Math.max(births.get(key) || 0, progress))
      gather()
    },
    // It lit, or failed: once no other star is forming, its music ends that way.
    gathered(key, { failed = false } = {}) {
      if (!births.delete(key) || births.size) return
      ungather(failed)
    },
    // What the sessions are doing ({ working, attention } counts) and the star the camera
    // is with ({ star }), for the music to follow. Pass only what changed.
    setMood(next) {
      const before = mood.attention
      mood = { ...mood, ...next }
      if (mood.attention < before) resolve(mood.attention === 0)
      applyTone()
    },
    setMoodEnabled(on) {
      moodOn = on
      if (!on) tension = null
      applyTone()
    },
    // The star the camera went into ({ warmth, busy, size, seed }), or null on the way out.
    setInside(star) {
      insideStar = star
      syncHum()
    },
    // The sea, the wind and the bells belong to the galaxy view.
    setAmbient(on) {
      ambientOn = on
      sync()
    },
    // Warp: a rush of wind, and a bowl as we drop out. With the music following the
    // sessions, the bowl and a glass note sound the star's own note.
    warp(seconds, star = null) {
      if (!enabled || !ctx || ctx.state !== 'running') return
      const now = Date.now()
      if (now - lastWarp < 700) return
      lastWarp = now
      warpSound(ctx, bus.alerts, ctx.currentTime + 0.02, seconds, moodOn && star ? starNote(star) : null)
    },
    // Gliding within a system, or out to the whole galaxy: a breath of air that passes the
    // way the camera moves (pan: -1 left … 1 right).
    glide(seconds, pan = 0) {
      if (!enabled || !ctx || ctx.state !== 'running') return
      const now = Date.now()
      if (now - lastGlide < 400 || now - lastWarp < 700) return
      lastGlide = now
      glideSound(ctx, bus.alerts, ctx.currentTime + 0.02, seconds, pan)
    },
    // Event sounds ring in every view: a singing bowl when a session asks something,
    // a single wind bell when work finishes, a soft tinkle when search opens.
    // In the galaxy, a closed terminal's planet goes with a faint high bell, and a star
    // that loses its last terminal goes with a low bowl and a bell drifting after it.
    // Births and replies have their own small sounds.
    chime(kind) {
      if (!enabled || !ctx || ctx.state !== 'running') return
      const at = ctx.currentTime + 0.02
      if (kind === 'open') return windBell(ctx, bus.alerts, WIND_BELLS[1], { at, level: 0.022, pan: 0.15 })
      if (kind === 'planet') return windBell(ctx, bus.alerts, WIND_BELLS[1] * 1.5, { at, level: 0.03, pan: -0.2 })
      // A server's probe lifting off: a quick rising pair; dropping back: one low tick.
      if (kind === 'probe-up') {
        windBell(ctx, bus.alerts, WIND_BELLS[0] * 1.5, { at, level: 0.016, pan: 0.2 })
        windBell(ctx, bus.alerts, WIND_BELLS[0] * 2, { at: at + 0.12, level: 0.013, pan: 0.3 })
        return
      }
      if (kind === 'probe-down') return windBell(ctx, bus.alerts, WIND_BELLS[1] * 0.75, { at, level: 0.014, pan: -0.2 })
      // A reply landing on its planet: the faintest tick of a bell.
      if (kind === 'comet') return windBell(ctx, bus.alerts, WIND_BELLS[0] * 2, { at, level: 0.016, pan: 0.3 })
      // Something new: a planet forming gets a soft rising pair, a new star a warm bowl and bells.
      if (kind === 'planet-birth') {
        windBell(ctx, bus.alerts, WIND_BELLS[0], { at, level: 0.022, pan: -0.25 })
        windBell(ctx, bus.alerts, WIND_BELLS[0] * 1.5, { at: at + 0.28, level: 0.02, pan: 0.25 })
        return
      }
      if (kind === 'star-birth') {
        bowl(ctx, bus.alerts, 261.6, { at, level: 0.1 })
        windBell(ctx, bus.alerts, WIND_BELLS[0], { at: at + 0.5, level: 0.025, pan: -0.3 })
        windBell(ctx, bus.alerts, WIND_BELLS[1], { at: at + 0.85, level: 0.022, pan: 0.3 })
        return
      }
      // A pull request merged: D and B♭ fall in on G, over a warm bowl, and a bell after.
      if (kind === 'merge') {
        glassNote(ctx, bus.alerts, 587.33, { at, level: 0.024, pan: -0.3 })
        glassNote(ctx, bus.alerts, 466.16, { at: at + 0.3, level: 0.024, pan: 0.3 })
        bowl(ctx, bus.alerts, 196, { at: at + 0.75, level: 0.07 })
        glassNote(ctx, bus.alerts, 392, { at: at + 0.8, level: 0.03, pan: 0 })
        windBell(ctx, bus.alerts, WIND_BELLS[0], { at: at + 1.5, level: 0.02, pan: 0.2 })
        return
      }
      // Into a star: a low bowl as the light closes round, and a glass fifth opening out.
      if (kind === 'enter') {
        bowl(ctx, bus.alerts, 130.81, { at, level: 0.06 })
        glassNote(ctx, bus.alerts, 392, { at: at + 0.35, level: 0.022, pan: -0.25 })
        glassNote(ctx, bus.alerts, 587.33, { at: at + 0.6, level: 0.02, pan: 0.25 })
        return
      }
      if (kind === 'star') {
        bowl(ctx, bus.alerts, 196, { at, level: 0.08 })
        windBell(ctx, bus.alerts, WIND_BELLS[0], { at: at + 0.9, level: 0.028, pan: 0.25 })
        return
      }
      // Play. A thrown comet leaves with a rising pluck pair; a star swallowing it answers
      // with a warm bowl, the galactic core with a falling run. A caught shooting star
      // sparkles up the scale. A black hole pulls a terminal in with a slow fall of plucks.
      if (kind === 'throw') {
        pluck(ctx, bus.alerts, 784, { at, level: 0.03, pan: -0.15 })
        pluck(ctx, bus.alerts, 1175, { at: at + 0.09, level: 0.022, pan: 0.15 })
        return
      }
      if (kind === 'gulp') {
        bowl(ctx, bus.alerts, 293.7, { at, level: 0.05 })
        pluck(ctx, bus.alerts, 1175, { at: at + 0.05, level: 0.02, pan: 0.2 })
        return
      }
      if (kind === 'core') {
        ;[1568, 1175, 932.3, 784].forEach((f, i) => pluck(ctx, bus.alerts, f, { at: at + i * 0.14, level: 0.026 - i * 0.003, pan: i % 2 ? 0.25 : -0.25 }))
        bowl(ctx, bus.alerts, 196, { at: at + 0.3, level: 0.05 })
        return
      }
      if (kind === 'catch') {
        ;[784, 932.3, 1175, 1397, 1568].forEach((f, i) => pluck(ctx, bus.alerts, f, { at: at + i * 0.055, level: 0.024, pan: -0.4 + i * 0.2 }))
        return
      }
      // A search lit planets up: two quiet glints, a fifth apart.
      if (kind === 'found') {
        pluck(ctx, bus.alerts, 1175, { at, level: 0.016, pan: -0.15 })
        pluck(ctx, bus.alerts, 1760, { at: at + 0.07, level: 0.012, pan: 0.15 })
        return
      }
      if (kind === 'seek') {
        ;[587.3, 784, 1175].forEach((f, i) => pluck(ctx, bus.alerts, f, { at: at + i * 0.06, level: 0.02, pan: -0.2 + i * 0.2 }))
        return
      }
      if (kind === 'grab') return pluck(ctx, bus.alerts, 466.2, { at, level: 0.03 })
      if (kind === 'blackhole') {
        ;[1175, 932.3, 784, 587.3, 466.2, 392].forEach((f, i) => pluck(ctx, bus.alerts, f, { at: at + i * 0.16, level: 0.03 * (1 - i * 0.1), pan: Math.sin(i * 1.7) * 0.4 }))
        bowl(ctx, bus.alerts, 233.1, { at: at + 0.9, level: 0.05 })
        return
      }
      // Far events: a supernova is a soft bowl with a bell after it, a star being born a
      // rising run of plucks.
      if (kind === 'far-nova') {
        bowl(ctx, bus.alerts, 220, { at, level: 0.035 })
        windBell(ctx, bus.alerts, WIND_BELLS[1], { at: at + 0.7, level: 0.016, pan: Math.random() - 0.5 })
        return
      }
      if (kind === 'far-birth') {
        ;[587.3, 784, 1175].forEach((f, i) => pluck(ctx, bus.alerts, f, { at: at + i * 0.2, level: 0.02, pan: -0.3 + i * 0.3 }))
        windBell(ctx, bus.alerts, WIND_BELLS[0], { at: at + 0.7, level: 0.012, pan: 0.2 })
        return
      }
      if (kind === 'aurora') {
        windBell(ctx, bus.alerts, WIND_BELLS[0], { at, level: 0.018, pan: -0.3 })
        windBell(ctx, bus.alerts, WIND_BELLS[1], { at: at + 0.4, level: 0.015, pan: 0.3 })
        return
      }
      // Stardust. A firework far off is a soft low pop and a scatter of high glints; an app
      // passing a token milestone gets a rising arpeggio and bells; a decoration opening up a
      // warm bowl under a slow climb; a new grain of stardust two bright plucks.
      if (kind === 'firework') {
        const pan = Math.random() - 0.5
        tone(ctx, panTo(ctx, bus.alerts, pan), 110 + Math.random() * 30, { at, level: 0.05, attack: 0.005, decay: 0.5 })
        for (let i = 0; i < 4; i++) pluck(ctx, bus.alerts, SCALE[11 + Math.floor(Math.random() * 5)], { at: at + 0.25 + i * (0.05 + Math.random() * 0.08), level: 0.012, pan: pan + (Math.random() - 0.5) * 0.4 })
        return
      }
      if (kind === 'celebrate') {
        ;[392, 587.33, 783.99, 1174.66].forEach((f, i) => pluck(ctx, bus.alerts, f, { at: at + i * 0.09, level: 0.026, pan: -0.3 + i * 0.2 }))
        windBell(ctx, bus.alerts, WIND_BELLS[0], { at: at + 0.5, level: 0.024, pan: -0.2 })
        windBell(ctx, bus.alerts, WIND_BELLS[1], { at: at + 0.75, level: 0.02, pan: 0.25 })
        return
      }
      if (kind === 'unlock') {
        bowl(ctx, bus.alerts, 196, { at, level: 0.07 })
        ;[392, 466.16, 587.33, 783.99, 932.33].forEach((f, i) => glassNote(ctx, bus.alerts, f, { at: at + 0.3 + i * 0.22, level: 0.02, pan: -0.4 + i * 0.2 }))
        return
      }
      if (kind === 'stardust') {
        pluck(ctx, bus.alerts, 1396.91, { at, level: 0.018, pan: -0.15 })
        pluck(ctx, bus.alerts, 1864.7, { at: at + 0.08, level: 0.014, pan: 0.15 })
        return
      }
      const now = Date.now()
      if (now - lastChime < CHIME_GAP_MS) return
      lastChime = now
      if (kind === 'attention') bowl(ctx, bus.alerts, 392, { at, level: 0.13 })
      else windBell(ctx, bus.alerts, WIND_BELLS[0], { at, level: 0.06 })
    }
  }
}

function startAmbient(ctx, seaOut, windOut) {
  // The sea: a soft 'shhh' that swells as each wave rolls in. Everything below the
  // voice range is cut, so it never turns into a hum.
  const sea = ctx.createBufferSource()
  sea.buffer = pinkNoise(ctx, 8)
  sea.loop = true
  const seaLow = ctx.createBiquadFilter()
  seaLow.type = 'highpass'
  seaLow.frequency.value = 300
  seaLow.Q.value = 0.7
  const seaLow2 = ctx.createBiquadFilter()
  seaLow2.type = 'highpass'
  seaLow2.frequency.value = 300
  seaLow2.Q.value = 0.7
  const seaTone = ctx.createBiquadFilter()
  seaTone.type = 'lowpass'
  seaTone.frequency.value = 800
  const seaGain = ctx.createGain()
  seaGain.gain.value = 0.012
  const shore = ctx.createStereoPanner()
  shore.connect(seaOut)
  sea.connect(seaLow).connect(seaLow2).connect(seaTone).connect(seaGain).connect(shore)
  sea.start()
  // Foam: the hiss as a wave breaks, rising in pitch as it draws back over the pebbles.
  const foam = ctx.createBufferSource()
  foam.buffer = noiseBuffer(ctx, 5)
  foam.loop = true
  const foamTone = ctx.createBiquadFilter()
  foamTone.type = 'bandpass'
  foamTone.frequency.value = 3000
  foamTone.Q.value = 0.5
  const foamGain = ctx.createGain()
  foamGain.gain.value = 0
  foam.connect(foamTone).connect(foamGain).connect(shore)
  foam.start()

  // A breeze: airy noise through a slowly wandering band, high enough not to howl.
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer(ctx, 6)
  noise.loop = true
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 1200
  band.Q.value = 0.6
  lfo(ctx, 0.017, 350, band.frequency)
  const wind = ctx.createGain()
  wind.gain.value = 0.02
  noise.connect(band).connect(wind).connect(windOut)
  noise.start()
  return {
    wave(at, seconds, size) {
      const peak = at + seconds * 0.4
      for (const param of [seaGain.gain, seaTone.frequency, foamGain.gain, foamTone.frequency, shore.pan]) param.cancelScheduledValues(at)
      shore.pan.setTargetAtTime((Math.random() - 0.5) * 0.6, at, seconds * 0.2)
      // In: the swell builds and brightens.
      seaGain.gain.setTargetAtTime(0.03 + 0.05 * size, at, seconds * 0.15)
      seaTone.frequency.setTargetAtTime(1500 + 900 * size, at, seconds * 0.15)
      // Break: a burst of foam.
      foamTone.frequency.setTargetAtTime(3000, at, 0.3)
      foamGain.gain.setTargetAtTime(0.018 * size, peak - 0.3, 0.3)
      // Out: the water slides back, darker and quieter, the foam thinning and rising.
      seaGain.gain.setTargetAtTime(0.012, peak + 0.4, seconds * 0.2)
      seaTone.frequency.setTargetAtTime(800, peak + 0.4, seconds * 0.22)
      foamGain.gain.setTargetAtTime(0.008 * size, peak + 0.6, 0.6)
      foamTone.frequency.setTargetAtTime(5500, peak + 0.6, seconds * 0.22)
      foamGain.gain.setTargetAtTime(0, peak + seconds * 0.3, seconds * 0.1)
    },
    gust(at, seconds) {
      wind.gain.cancelScheduledValues(at)
      wind.gain.setValueAtTime(wind.gain.value, at)
      wind.gain.linearRampToValueAtTime(0.05, at + seconds * 0.4)
      wind.gain.linearRampToValueAtTime(0.02, at + seconds * 1.6)
    }
  }
}

// 풍경: a small bronze bell, bright and short, a little different every strike.
function windBell(ctx, out, freq, { at, level, pan = 0 }) {
  const f = freq * (1 + (Math.random() - 0.5) * 0.004)
  const panner = panTo(ctx, out, pan)
  for (const [ratio, amp] of WIND_BELL_PARTIALS) {
    tone(ctx, panner, f * ratio, { at, level: level * amp, attack: 0.002, decay: 3.2 / Math.sqrt(ratio) })
    // A faint twin a hair away gives the shimmer of real metal.
    tone(ctx, panner, f * ratio + 1.3, { at, level: level * amp * 0.35, attack: 0.002, decay: 2.6 / Math.sqrt(ratio) })
  }
}

// 범종: a soft thud, then a deep hum whose partials beat slowly against their twins.
function templeBell(ctx, out, freq, { at, level }) {
  const panner = panTo(ctx, out, 0)
  const thud = ctx.createBufferSource()
  thud.buffer = noiseBuffer(ctx, 0.4)
  const thudFilter = ctx.createBiquadFilter()
  thudFilter.type = 'lowpass'
  thudFilter.frequency.value = 180
  // The strike itself stays soft; the bell should bloom, not boom.
  const thudGain = ctx.createGain()
  thudGain.gain.setValueAtTime(level * 0.8, at)
  thudGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35)
  thud.connect(thudFilter).connect(thudGain).connect(panner)
  thud.start(at)
  for (const [ratio, amp, beat, decay] of TEMPLE_BELL_PARTIALS) {
    tone(ctx, panner, freq * ratio, { at, level: level * amp, attack: 0.03, decay })
    tone(ctx, panner, freq * ratio + beat, { at, level: level * amp * 0.85, attack: 0.03, decay })
  }
}

// A small songbird: a few quick whistles that swoop up or down, some with a trill.
function birdCall(ctx, out, { at, level, pan }) {
  const panner = panTo(ctx, out, pan)
  const base = 2300 + Math.random() * 1900
  const notes = 2 + Math.floor(Math.random() * 5)
  let t = at
  for (let i = 0; i < notes; i++) {
    const dur = 0.05 + Math.random() * 0.13
    const f0 = base * (0.85 + Math.random() * 0.4)
    const osc = ctx.createOscillator()
    osc.frequency.setValueAtTime(f0, t)
    osc.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.35 : 0.72), t + dur)
    if (Math.random() < 0.35) {
      const trill = ctx.createOscillator()
      trill.frequency.value = 26 + Math.random() * 18
      const depth = ctx.createGain()
      depth.gain.value = f0 * 0.06
      trill.connect(depth).connect(osc.frequency)
      trill.start(t)
      trill.stop(t + dur + 0.02)
    }
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(level, t + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(gain).connect(panner)
    osc.start(t)
    osc.stop(t + dur + 0.02)
    t += dur + 0.03 + Math.random() * 0.09
  }
}

// 대나무 숲: thousands of thin, dry leaves. Their rustle is a dense patter of tiny
// flutters rather than a smooth hiss, so it's built from grains, kept high and papery.
// A soft breeze keeps it barely moving; sway() leans the whole grove for a few seconds.
function startGrove(ctx, out) {
  const level = ctx.createGain()
  level.gain.value = 0
  level.connect(out)
  const leaves = ctx.createBufferSource()
  leaves.buffer = rustleBuffer(ctx, 9)
  leaves.loop = true
  const low = ctx.createBiquadFilter()
  low.type = 'highpass'
  low.frequency.value = 1800
  low.Q.value = 0.7
  const air = ctx.createBiquadFilter()
  air.type = 'bandpass'
  air.frequency.value = 4800
  air.Q.value = 0.55
  lfo(ctx, 0.05, 900, air.frequency)
  const body = ctx.createGain()
  body.gain.value = 0.006
  leaves.connect(low).connect(air).connect(body).connect(level)
  leaves.start()
  return {
    level,
    sway(at, seconds, strength) {
      body.gain.cancelScheduledValues(at)
      body.gain.setTargetAtTime(0.006 + 0.032 * strength, at, seconds * 0.22)
      // A stronger push brightens it: more leaf edges turning over at once.
      air.frequency.setTargetAtTime(4800 + 1400 * strength, at, seconds * 0.25)
      body.gain.setTargetAtTime(0.006, at + seconds * 0.55, seconds * 0.3)
      air.frequency.setTargetAtTime(4800, at + seconds * 0.55, seconds * 0.3)
    }
  }
}

// Two stems knocking together: a dry, light 'tak'. Kept high and short with more
// click than ring, since a low round 'tok' is a 목탁 rather than bamboo.
function bambooKnock(ctx, out, freq, { at, level, pan }) {
  const panner = panTo(ctx, out, pan)
  tone(ctx, panner, freq, { at, level: level * 0.55, attack: 0.001, decay: 0.045 })
  tone(ctx, panner, freq * 2.76, { at, level: level * 0.3, attack: 0.001, decay: 0.022 })
  // The wood's own click on contact.
  const click = ctx.createBufferSource()
  click.buffer = noiseBuffer(ctx, 0.02)
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = freq * 2.2
  band.Q.value = 1.4
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(level * 2, at)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.014)
  click.connect(band).connect(gain).connect(panner)
  click.start(at)
  click.stop(at + 0.02)
}

// A cricket's chirp: a few fast pulses of one high tone.
function cricket(ctx, out, { at, freq, pulses, level, pan }) {
  const panner = panTo(ctx, out, pan)
  for (let i = 0; i < pulses; i++) tone(ctx, panner, freq, { at: at + i * 0.045, level, attack: 0.004, decay: 0.03 })
}

// 물방울: a plip whose pitch jumps up as the bubble closes, ringing in the basin.
function waterDrop(ctx, out, freq, { at, level, pan }) {
  const panner = panTo(ctx, out, pan)
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(freq, at)
  osc.frequency.exponentialRampToValueAtTime(freq * 1.8, at + 0.05)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(level, at + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18)
  osc.connect(gain).connect(panner)
  osc.start(at)
  osc.stop(at + 0.2)
  tone(ctx, panner, freq * 1.8, { at: at + 0.04, level: level * 0.25, attack: 0.01, decay: 1.2 })
}

// A soft glassy note: it swells in rather than strikes, and a twin a hair away makes it
// shimmer as it fades.
// glass, 0 to 1: how clear it rings. Higher, the overtones come forward and it swells in
// sooner; lower, it is rounder and slower.
function glassNote(ctx, out, freq, { at, level, pan, glass = 0.5 }) {
  const panner = panTo(ctx, out, pan)
  tone(ctx, panner, freq, { at, level, attack: 0.9 - 0.4 * glass, decay: 10 })
  tone(ctx, panner, freq + 1.1, { at, level: level * 0.5, attack: 1 - 0.4 * glass, decay: 9 })
  tone(ctx, panner, freq * 2, { at, level: level * (0.06 + 0.16 * glass), attack: 0.35, decay: 4 })
  tone(ctx, panner, freq * 3, { at, level: level * (0.01 + 0.06 * glass), attack: 0.2, decay: 2 })
}

// A round, soft note for the music's runs: gentler than a pluck, shorter than glass.
function softNote(ctx, out, freq, { at, level, pan, glass = 0.5 }) {
  const panner = panTo(ctx, out, pan)
  tone(ctx, panner, freq, { at, level, attack: 0.04, decay: 2.6 })
  tone(ctx, panner, freq * 2, { at, level: level * (0.05 + 0.14 * glass), attack: 0.03, decay: 1.2 })
}

// A soft pluck, like a celesta: quick to sound, gone in a second or two.
function pluck(ctx, out, freq, { at, level, pan = 0 }) {
  const panner = panTo(ctx, out, pan)
  tone(ctx, panner, freq, { at, level, attack: 0.004, decay: 1.6 })
  tone(ctx, panner, freq * 2, { at, level: level * 0.25, attack: 0.003, decay: 0.6 })
  tone(ctx, panner, freq * 3.01, { at, level: level * 0.08, attack: 0.002, decay: 0.3 })
}

// 싱잉볼: a warm strike that keeps singing, with a gentle wobble.
function bowl(ctx, out, freq, { at, level }) {
  const panner = panTo(ctx, out, 0)
  for (const [ratio, amp] of BOWL_PARTIALS) {
    const decay = 9 / Math.sqrt(ratio)
    tone(ctx, panner, freq * ratio, { at, level: level * amp, attack: 0.01, decay })
    tone(ctx, panner, freq * ratio * 1.0025, { at, level: level * amp * 0.6, attack: 0.01, decay })
  }
}

// The hum inside a star: its own note brought down below 110 Hz, with a voice a hair
// apart beating slowly against it, a fifth and an octave over it, and its brightness
// breathing.
function humNote(star) {
  let note = starNote(star)
  while (note > 110) note /= 2
  return note
}

function startHum(ctx, out, freq) {
  const level = ctx.createGain()
  level.gain.value = 0
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 380
  tone.Q.value = 0.6
  tone.connect(level).connect(out)
  const voices = [[1, 0.5, 'sine'], [1.004, 0.35, 'sine'], [1.5, 0.18, 'triangle'], [2, 0.12, 'sine']].map(([ratio, amp, type]) => {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq * ratio
    const gain = ctx.createGain()
    gain.gain.value = amp
    osc.connect(gain).connect(tone)
    osc.start()
    return osc
  })
  const breath = lfo(ctx, 0.06, 140, tone.frequency)
  return {
    note: freq,
    level,
    stop() {
      for (const osc of [...voices, breath]) osc.stop()
    }
  }
}

// A star's own note, in its own mode: young blue stars high, old red ones low, and stars
// of one age a step or two apart.
function starNote(star) {
  const notes = SCALES[starMode(star)]
  const top = notes.length - 1
  return notes[Math.min(top, Math.round((1 - star.warmth) * (top - 3)) + (star.seed % 3))]
}

// The mode a star sings in: its age picks the region (young bright, old dark), and its
// seed moves it a step either way, so stars of one age still differ.
export function starMode(star) {
  if (!star) return HOME_MODE
  const at = Math.round(star.warmth * (MODES.length - 1)) + ((star.seed >>> 5) % 3) - 1
  return Math.max(0, Math.min(MODES.length - 1, at))
}

// Three octaves of a mode from G3 to G6: sixteen notes.
export function modeScale(mode) {
  const notes = []
  for (let octave = 0; octave < 3; octave++) for (const step of MODES[mode].steps) notes.push(G3 * 2 ** (octave + step / 12))
  notes.push(G3 * 8)
  return notes
}

function warpSound(ctx, out, at, seconds, note = null) {
  const panner = panTo(ctx, out, 0)
  panner.pan.setValueAtTime(-0.35, at)
  panner.pan.linearRampToValueAtTime(0.35, at + seconds)
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer(ctx, seconds + 0.5)
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 1.1
  band.frequency.setValueAtTime(600, at)
  band.frequency.exponentialRampToValueAtTime(3000, at + seconds * 0.55)
  band.frequency.exponentialRampToValueAtTime(900, at + seconds)
  const rush = ctx.createGain()
  rush.gain.setValueAtTime(0.0001, at)
  rush.gain.exponentialRampToValueAtTime(0.05, at + seconds * 0.5)
  rush.gain.exponentialRampToValueAtTime(0.0001, at + seconds * 1.05)
  noise.connect(band).connect(rush).connect(panner)
  noise.start(at)
  noise.stop(at + seconds + 0.4)
  if (!note) return bowl(ctx, out, 587.33, { at: at + seconds * 0.9, level: 0.06 })
  bowl(ctx, out, note < 290 ? note * 2 : note > 1200 ? note / 2 : note, { at: at + seconds * 0.9, level: 0.05 })
  glassNote(ctx, out, note, { at: at + seconds * 0.9 + 0.2, level: 0.03, pan: 0 })
}

// Air, not wind: soft band-passed noise that swells and lets go, drifting across to pan.
function glideSound(ctx, out, at, seconds, pan) {
  const panner = panTo(ctx, out, 0)
  panner.pan.setValueAtTime(-pan * 0.3, at)
  panner.pan.linearRampToValueAtTime(pan * 0.7, at + seconds)
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer(ctx, seconds + 0.5)
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 0.8
  band.frequency.setValueAtTime(380, at)
  band.frequency.exponentialRampToValueAtTime(1300, at + seconds * 0.45)
  band.frequency.exponentialRampToValueAtTime(520, at + seconds)
  const air = ctx.createGain()
  air.gain.setValueAtTime(0.0001, at)
  air.gain.exponentialRampToValueAtTime(0.022, at + seconds * 0.4)
  air.gain.exponentialRampToValueAtTime(0.0001, at + seconds * 1.1)
  noise.connect(band).connect(air).connect(panner)
  noise.start(at)
  noise.stop(at + seconds + 0.4)
}

function tone(ctx, out, freq, { at, level, attack, decay }) {
  const osc = ctx.createOscillator()
  osc.frequency.value = freq
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(level, at + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  osc.connect(gain).connect(out)
  osc.start(at)
  osc.stop(at + decay + 0.05)
}

function panTo(ctx, out, pan) {
  const panner = ctx.createStereoPanner()
  panner.pan.value = pan
  panner.connect(out)
  return panner
}

function lfo(ctx, rate, depth, param) {
  const osc = ctx.createOscillator()
  osc.frequency.value = rate
  const gain = ctx.createGain()
  gain.gain.value = depth
  osc.connect(gain).connect(param)
  osc.start()
  return osc
}

function fade(node, value, seconds) {
  const now = node.context.currentTime
  node.gain.cancelScheduledValues(now)
  node.gain.setTargetAtTime(value, now, seconds / 3)
}

function noiseBuffer(ctx, seconds) {
  const buffer = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return buffer
}

// Pink noise for the sea, looped without a seam: the tail is faded into the head.
function pinkNoise(ctx, seconds) {
  const length = Math.ceil(ctx.sampleRate * seconds)
  const blend = Math.ceil(ctx.sampleRate * 0.5)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c)
    const tail = new Float32Array(blend)
    let b0 = 0, b1 = 0, b2 = 0
    for (let i = 0; i < length + blend; i++) {
      const white = Math.random() * 2 - 1
      b0 = 0.99765 * b0 + white * 0.099046
      b1 = 0.963 * b1 + white * 0.2965164
      b2 = 0.57 * b2 + white * 1.0526913
      const v = (b0 + b1 + b2 + white * 0.1848) * 0.2
      if (i < length) data[i] = v
      else tail[i - length] = v
    }
    for (let i = 0; i < blend; i++) data[i] = data[i] * (i / blend) + tail[i] * (1 - i / blend)
  }
  return buffer
}

// Leaf rustle: short grains of noise scattered densely, most of them faint and a few
// louder, with a flutter in how thickly they fall. Grains wrap round the end and the
// flutter fits a whole number of cycles, so the loop has no seam.
function rustleBuffer(ctx, seconds) {
  const rate = ctx.sampleRate
  const length = Math.ceil(rate * seconds)
  const buffer = ctx.createBuffer(2, length, rate)
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c)
    const flutter = Math.round(seconds * (3 + Math.random() * 3)) / seconds
    const phase = Math.random() * Math.PI * 2
    for (let g = 0; g < seconds * 1100; g++) {
      const start = Math.floor(Math.random() * length)
      const thick = 0.55 + 0.45 * Math.sin((start / rate) * flutter * Math.PI * 2 + phase)
      if (Math.random() > thick) continue
      const amp = Math.random() ** 2.5
      const span = Math.floor(rate * (0.002 + Math.random() * 0.01))
      for (let i = 0; i < span; i++) data[(start + i) % length] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (span * 0.3))
    }
    let peak = 0
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]))
    for (let i = 0; i < length; i++) data[i] /= peak || 1
  }
  return buffer
}

// Decaying stereo noise used as the reverb impulse.
function impulse(ctx, seconds, decay) {
  const length = ctx.sampleRate * seconds
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
  }
  return buffer
}
