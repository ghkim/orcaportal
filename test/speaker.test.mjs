import test from 'node:test'
import assert from 'node:assert/strict'
import { Speaker } from '../src/speaker.mjs'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('the first page plays; a second one waits until it is touched', () => {
  const speaker = new Speaker()
  const heard = []
  speaker.on('speaker', ({ id }) => heard.push(id))
  speaker.join('orca-tab')
  speaker.join('chrome')
  assert.equal(speaker.current, 'orca-tab')
  assert.equal(speaker.update('chrome', { touched: true }), true)
  assert.equal(speaker.current, 'chrome')
  speaker.update('orca-tab', { touched: true })
  assert.deepEqual(heard, ['orca-tab', 'chrome', 'orca-tab'])
  speaker.stop()
})

test('a page on screen plays before one that was hidden', () => {
  const speaker = new Speaker()
  speaker.join('a')
  speaker.join('b')
  speaker.update('b', { touched: true })
  speaker.update('b', { visible: false })
  assert.equal(speaker.current, 'a')
  speaker.update('a', { visible: false })
  assert.equal(speaker.current, 'b', 'with nothing on screen, the one touched last')
  speaker.stop()
})

test('a closed page hands over after the grace; a reload keeps its turn', async () => {
  const speaker = new Speaker({ graceMs: 20 })
  speaker.join('a')
  speaker.join('b')
  speaker.update('b', { touched: true })
  speaker.leave('b')
  speaker.join('b')
  await wait(40)
  assert.equal(speaker.current, 'b')
  speaker.leave('b')
  await wait(40)
  assert.equal(speaker.current, 'a')
  assert.equal(speaker.update('b', { touched: true }), false, 'a page that left is gone')
  speaker.stop()
})
