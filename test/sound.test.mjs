import test from 'node:test'
import assert from 'node:assert/strict'
import { MODES, HOME_MODE, modeScale, starMode } from '../public/sound.js'

test('the home key is still G minor pentatonic, note for note', () => {
  const before = [196, 233.08, 261.63, 293.66, 349.23, 392, 466.16, 523.25, 587.33, 698.46, 783.99, 932.33, 1046.5, 1174.66, 1396.91, 1567.98]
  const home = modeScale(HOME_MODE)
  assert.equal(home.length, before.length)
  home.forEach((note, i) => assert.ok(Math.abs(note - before[i]) < 0.02, `${i}: ${note} vs ${before[i]}`))
  assert.equal(MODES[HOME_MODE].name, '단조')
})

test('every mode climbs G3 to G6 and keeps G in each octave', () => {
  for (let mode = 0; mode < MODES.length; mode++) {
    const notes = modeScale(mode)
    assert.equal(notes.length, 16)
    for (let i = 1; i < notes.length; i++) assert.ok(notes[i] > notes[i - 1], `${MODES[mode].name} climbs`)
    for (const [i, g] of [[0, 196], [5, 392], [10, 784], [15, 1568]]) assert.ok(Math.abs(notes[i] - g) < 0.01, `${MODES[mode].name} has G at ${i}`)
  }
})

test('a star sings in a mode of its own: young bright, old dark, the same one every time', () => {
  assert.equal(starMode(null), HOME_MODE)
  const seeds = Array.from({ length: 40 }, (_, i) => (i * 2654435761) >>> 0)
  const young = seeds.map((seed) => starMode({ warmth: 0, seed }))
  const old = seeds.map((seed) => starMode({ warmth: 1, seed }))
  assert.ok(young.every((m) => m <= 1))
  assert.ok(old.every((m) => m >= MODES.length - 2))
  // Stars of one age still spread over more than one mode.
  assert.ok(new Set(seeds.map((seed) => starMode({ warmth: 0.5, seed }))).size >= 2)
  assert.equal(starMode({ warmth: 0.4, seed: 12345 }), starMode({ warmth: 0.4, seed: 12345 }))
})
