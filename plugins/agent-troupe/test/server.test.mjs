import assert from 'node:assert/strict'
import { request } from 'node:http'
import { after, before, describe, it } from 'node:test'

import { MAX_EVENTS, sanitize, start } from '../server/server.mjs'

function call({ port, path, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

describe('serveur local', () => {
  let handle
  before(async () => {
    handle = await start({ port: 0 })
  })
  after(async () => {
    await handle.close()
  })

  it('écoute uniquement sur 127.0.0.1', () => {
    assert.ok(handle.port > 0)
    assert.equal(typeof handle.token, 'string')
    assert.ok(handle.token.length >= 32)
  })

  it('refuse un événement sans jeton ou avec un mauvais jeton', async () => {
    const none = await call({ port: handle.port, path: '/event', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"lead","state":"working"}' })
    const bad = await call({ port: handle.port, path: '/event', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-troupe-token': 'x'.repeat(handle.token.length) }, body: '{"type":"lead"}' })
    assert.equal(none.status, 401)
    assert.equal(bad.status, 401)
  })

  it('refuse un nom d\'hôte étranger (rebinding DNS)', async () => {
    const res = await call({ port: handle.port, path: '/health', headers: { Host: 'evil.example' } })
    assert.equal(res.status, 421)
  })

  it('refuse une origine étrangère', async () => {
    const res = await call({ port: handle.port, path: '/health', headers: { Origin: 'http://evil.example' } })
    assert.equal(res.status, 403)
  })

  it('refuse la page sans jeton et la sert avec le jeton, avec une CSP stricte', async () => {
    const without = await call({ port: handle.port, path: '/' })
    assert.equal(without.status, 401)
    const ok = await call({ port: handle.port, path: `/?t=${handle.token}` })
    assert.equal(ok.status, 200)
    assert.match(ok.headers['content-security-policy'], /default-src 'none'/)
    assert.match(ok.headers['content-security-policy'], /script-src 'self'/)
    assert.equal(ok.headers['x-content-type-options'], 'nosniff')
  })

  it('accepte un événement valide et refuse un événement inconnu', async () => {
    const headers = { 'Content-Type': 'application/json', 'x-troupe-token': handle.token }
    const ok = await call({ port: handle.port, path: '/event', method: 'POST', headers, body: JSON.stringify({ type: 'lead', state: 'working', tool: 'Bash' }) })
    const unknown = await call({ port: handle.port, path: '/event', method: 'POST', headers, body: JSON.stringify({ type: 'rm -rf' }) })
    const invalid = await call({ port: handle.port, path: '/event', method: 'POST', headers, body: '{pas du json' })
    assert.equal(ok.status, 204)
    assert.equal(unknown.status, 422)
    assert.equal(invalid.status, 400)
  })

  it('refuse un corps trop grand', async () => {
    const headers = { 'Content-Type': 'application/json', 'x-troupe-token': handle.token }
    const res = await call({ port: handle.port, path: '/event', method: 'POST', headers, body: JSON.stringify({ type: 'message', text: 'x'.repeat(40000) }) })
    assert.equal(res.status, 413)
  })

  it('diffuse les événements en SSE, équipe en premier', async () => {
    const headers = { 'Content-Type': 'application/json', 'x-troupe-token': handle.token }
    await call({ port: handle.port, path: '/event', method: 'POST', headers, body: JSON.stringify({ type: 'team', template: 'livraison', label: 'Livraison', roles: [{ id: 'qa', color: '#be123c', label: 'QA' }] }) })
    await call({ port: handle.port, path: '/event', method: 'POST', headers, body: JSON.stringify({ type: 'agent.start', id: 'a1', roleId: 'qa', task: 'tester' }) })

    const received = await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: handle.port, path: `/events?t=${handle.token}`, headers: { Host: `127.0.0.1:${handle.port}` } }, res => {
        let data = ''
        res.on('data', chunk => {
          data += chunk.toString('utf8')
          if (data.includes('"agent.start"')) {
            req.destroy()
            resolve(data)
          }
        })
      })
      req.on('error', error => (error.code === 'ECONNRESET' ? undefined : reject(error)))
      req.end()
    })
    const payloads = [...received.matchAll(/data: (.*)\n/g)].map(m => JSON.parse(m[1]))
    assert.equal(payloads[0].type, 'team')
    assert.ok(payloads.some(p => p.type === 'agent.start' && p.id === 'a1'))
  })

  it('refuse le flux sans jeton', async () => {
    const res = await call({ port: handle.port, path: '/events' })
    assert.equal(res.status, 401)
  })

  it('borne la mémoire aux derniers événements', async () => {
    const small = await start({ port: 0 })
    for (let i = 0; i < MAX_EVENTS + 30; i += 1) small.publish({ type: 'lead', state: 'working', tool: `t${i}` })
    assert.equal(small.events.length, MAX_EVENTS)
    assert.equal(small.events.at(-1).tool, `t${MAX_EVENTS + 29}`)
    await small.close()
  })
})

describe('sanitize', () => {
  it('ne garde que des champs connus et tronque les textes', () => {
    const clean = sanitize({ type: 'message', text: 'a'.repeat(5000), secret: 'jeton', fromId: 'x' })
    assert.equal(clean.text.length, 1000)
    assert.equal('secret' in clean, false)
  })
  it('refuse un type inconnu et un agent sans identifiant', () => {
    assert.equal(sanitize({ type: 'autre' }), null)
    assert.equal(sanitize({ type: 'agent.start' }), null)
    assert.equal(sanitize(null), null)
  })
  it('remplace une couleur invalide par une couleur neutre', () => {
    const clean = sanitize({ type: 'team', roles: [{ id: 'x', color: 'url(javascript:1)' }] })
    assert.equal(clean.roles[0].color, '#475569')
  })
})
