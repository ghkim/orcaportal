// A temple above the sea, synthesized with Web Audio (no sound files):
// waves (파도) on the shore below, mountain wind (바람), wind bells (풍경) on the eaves
// when the wind picks up, now and then a great temple bell (범종) with its slow beating
// (맥놀이), and a singing bowl (싱잉볼) when a session needs you. Over it, a little
// generative music in the same key as the bells.
// Browsers only allow audio after a click or key press, so nothing starts before one.

const CHIME_GAP_MS = 1500
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
// The music: one note per voice, each repeating on its own slow loop (seconds), in the
// spirit of Music for Airports. The loops never line up the same way twice. All notes
// are G minor pentatonic, the key the bells and bowls are tuned to.
const MUSIC_VOICES = [
  [587.33, 19.7, 1.5], // D5
  [466.16, 23.3, 6], // B♭4
  [349.23, 29.1, 11], // F4
  [392.0, 31.7, 3.5], // G4
  [523.25, 37.3, 16], // C5
  [293.66, 41.9, 22], // D4
  [698.46, 47.6, 28] // F5
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
  let music = null
  let lastChime = 0
  let lastWarp = 0
  let waiting = false

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
    // The sea and the wind are outdoors: no reverb.
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
    musicBus.connect(limiter)
    musicBus.connect(reverb)
    bus = { ambient: ambientBus, bell: bellBus, music: musicBus }
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
      if (!ambient) ambient = startAmbient(ctx, bus.ambient)
      fade(bus.ambient, 0.3, 5)
      fade(bus.music, 0.22, 10)
      if (!musicTimer) scheduleMusic()
      if (!waveTimer) scheduleWave(500)
      if (!windTimer) scheduleWind(4000 + Math.random() * 6000)
      if (!templeTimer) scheduleTemple(40000 + Math.random() * 20000)
    } else {
      fade(bus.ambient, 0, 2.5)
      fade(bus.music, 0, 2.5)
      stopTimers()
    }
  }

  function stopTimers() {
    clearTimeout(windTimer)
    clearTimeout(waveTimer)
    clearTimeout(templeTimer)
    clearTimeout(musicTimer)
    windTimer = waveTimer = templeTimer = musicTimer = null
    music = null
  }

  // Looks a second and a half ahead and books every note that falls in that window.
  function scheduleMusic() {
    if (!music) {
      music = MUSIC_VOICES.map(([freq, period, offset], i) => ({ freq, period, next: ctx.currentTime + offset, pan: ((i * 0.618) % 1) * 1.2 - 0.6 }))
    }
    musicTimer = setTimeout(() => {
      musicTimer = null
      if (!enabled || !ambientOn) return
      const horizon = ctx.currentTime + 1.5
      for (const voice of music) {
        while (voice.next < horizon) {
          if (voice.next > ctx.currentTime) glassNote(ctx, bus.music, voice.freq, { at: voice.next, level: 0.016 + Math.random() * 0.006, pan: voice.pan })
          voice.next += voice.period
        }
      }
      scheduleMusic()
    }, 1000)
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
      ambient.gust(at, 1.5 + Math.random() * 2.5)
      let t = at + 0.4 + Math.random() * 0.6
      const strikes = 1 + Math.floor(Math.random() * 4)
      for (let i = 0; i < strikes; i++) {
        windBell(ctx, bus.bell, WIND_BELLS[Math.random() < 0.65 ? 0 : 1], { at: t, level: 0.03 + Math.random() * 0.035, pan: Math.random() * 0.8 - 0.4 })
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
      templeBell(ctx, bus.bell, 88 + Math.random() * 6, { at: ctx.currentTime + 0.05, level: 0.03 })
      scheduleTemple(150000 + Math.random() * 90000)
    }, delay)
  }

  return {
    setEnabled(on) {
      enabled = on
      sync()
    },
    // The sea, the wind and the bells belong to the galaxy view.
    setAmbient(on) {
      ambientOn = on
      sync()
    },
    // Warp: a rush of wind, and a bowl as we drop out.
    warp(seconds) {
      if (!enabled || !ctx || ctx.state !== 'running') return
      const now = Date.now()
      if (now - lastWarp < 700) return
      lastWarp = now
      warpSound(ctx, bus.bell, ctx.currentTime + 0.02, seconds)
    },
    // Event sounds ring in every view: a singing bowl when a session asks something,
    // a single wind bell when work finishes, a soft tinkle when search opens.
    // In the galaxy, a closed terminal's planet goes with a faint high bell, and a star
    // that loses its last terminal goes with a low bowl and a bell drifting after it.
    // Births and replies have their own small sounds.
    chime(kind) {
      if (!enabled || !ctx || ctx.state !== 'running') return
      const at = ctx.currentTime + 0.02
      if (kind === 'open') return windBell(ctx, bus.bell, WIND_BELLS[1], { at, level: 0.022, pan: 0.15 })
      if (kind === 'planet') return windBell(ctx, bus.bell, WIND_BELLS[1] * 1.5, { at, level: 0.03, pan: -0.2 })
      // A server's probe lifting off: a quick rising pair; dropping back: one low tick.
      if (kind === 'probe-up') {
        windBell(ctx, bus.bell, WIND_BELLS[0] * 1.5, { at, level: 0.016, pan: 0.2 })
        windBell(ctx, bus.bell, WIND_BELLS[0] * 2, { at: at + 0.12, level: 0.013, pan: 0.3 })
        return
      }
      if (kind === 'probe-down') return windBell(ctx, bus.bell, WIND_BELLS[1] * 0.75, { at, level: 0.014, pan: -0.2 })
      // A reply landing on its planet: the faintest tick of a bell.
      if (kind === 'comet') return windBell(ctx, bus.bell, WIND_BELLS[0] * 2, { at, level: 0.016, pan: 0.3 })
      // Something new: a planet forming gets a soft rising pair, a new star a warm bowl and bells.
      if (kind === 'planet-birth') {
        windBell(ctx, bus.bell, WIND_BELLS[0], { at, level: 0.022, pan: -0.25 })
        windBell(ctx, bus.bell, WIND_BELLS[0] * 1.5, { at: at + 0.28, level: 0.02, pan: 0.25 })
        return
      }
      if (kind === 'star-birth') {
        bowl(ctx, bus.bell, 261.6, { at, level: 0.1 })
        windBell(ctx, bus.bell, WIND_BELLS[0], { at: at + 0.5, level: 0.025, pan: -0.3 })
        windBell(ctx, bus.bell, WIND_BELLS[1], { at: at + 0.85, level: 0.022, pan: 0.3 })
        return
      }
      if (kind === 'star') {
        bowl(ctx, bus.bell, 196, { at, level: 0.08 })
        windBell(ctx, bus.bell, WIND_BELLS[0], { at: at + 0.9, level: 0.028, pan: 0.25 })
        return
      }
      const now = Date.now()
      if (now - lastChime < CHIME_GAP_MS) return
      lastChime = now
      if (kind === 'attention') bowl(ctx, bus.bell, 392, { at, level: 0.13 })
      else windBell(ctx, bus.bell, WIND_BELLS[0], { at, level: 0.06 })
    }
  }
}

function startAmbient(ctx, out) {
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
  shore.connect(out)
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
  noise.connect(band).connect(wind).connect(out)
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

// A soft glassy note: it swells in rather than strikes, and a twin a hair away makes it
// shimmer as it fades.
function glassNote(ctx, out, freq, { at, level, pan }) {
  const panner = panTo(ctx, out, pan)
  tone(ctx, panner, freq, { at, level, attack: 0.7, decay: 10 })
  tone(ctx, panner, freq + 1.1, { at, level: level * 0.5, attack: 0.8, decay: 9 })
  tone(ctx, panner, freq * 2, { at, level: level * 0.14, attack: 0.35, decay: 4 })
  tone(ctx, panner, freq * 3, { at, level: level * 0.04, attack: 0.2, decay: 2 })
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

function warpSound(ctx, out, at, seconds) {
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
  bowl(ctx, out, 587.33, { at: at + seconds * 0.9, level: 0.06 })
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
