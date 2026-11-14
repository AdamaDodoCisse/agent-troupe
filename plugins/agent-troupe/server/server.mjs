// Serveur local d'agent-troupe : reçoit les événements du mod et les diffuse à la page par SSE.
// Sans dépendance (Node 18 ou plus). N'écoute que sur 127.0.0.1, exige un jeton, vérifie Host et Origin.
//
//   node server.mjs [--port 0]
//   -> écrit une ligne « READY {"port":N,"token":"…"} » sur la sortie standard, puis sert.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFile, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROLE_ORDER, ROLES, TEMPLATES, publicRole } from '../shared/roles.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

export const MAX_EVENTS = 500
export const MAX_BODY = 16 * 1024
export const MAX_TEXT = 1000
const EVENT_TYPES = new Set(['team', 'lead', 'agent.start', 'agent.resume', 'agent.tool', 'agent.end', 'message', 'reset'])

const STATIC = {
  '/app.js': { file: join(ROOT, 'web', 'app.js'), type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: join(ROOT, 'web', 'style.css'), type: 'text/css; charset=utf-8' },
  '/characters.js': { file: join(ROOT, 'web', 'characters.js'), type: 'text/javascript; charset=utf-8' },
  '/state.mjs': { file: join(ROOT, 'shared', 'state.mjs'), type: 'text/javascript; charset=utf-8' },
  '/favicon.svg': { file: join(ROOT, 'web', 'favicon.svg'), type: 'image/svg+xml' },
}

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

/** Garde les chaînes courtes et ne laisse passer que des champs connus : le serveur ne relaie pas n'importe quoi. */
export function sanitize(input) {
  if (typeof input !== 'object' || input === null || !EVENT_TYPES.has(input.type)) return null
  const text = (value, width = MAX_TEXT) => (typeof value === 'string' ? value.slice(0, width) : undefined)
  const bool = value => (typeof value === 'boolean' ? value : undefined)
  const num = value => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  const event = { type: input.type }
  switch (input.type) {
    case 'team':
      event.template = text(input.template, 60)
      event.label = text(input.label, 120)
      event.about = text(input.about, 240)
      event.lang = text(input.lang, 5)
      event.roles = Array.isArray(input.roles)
        ? input.roles.slice(0, 20).map(role => ({
            id: text(role?.id, 60) ?? '',
            color: /^#[0-9a-f]{6}$/i.test(String(role?.color)) ? role.color : '#475569',
            accessory: text(role?.accessory, 30) ?? 'badge',
            label: text(role?.label, 60) ?? '',
            long: text(role?.long, 120) ?? '',
            decides: text(role?.decides, 300) ?? '',
            delivers: text(role?.delivers, 300) ?? '',
            never: text(role?.never, 300) ?? '',
          }))
        : []
      break
    case 'lead':
      event.state = input.state === 'working' ? 'working' : 'idle'
      event.tool = text(input.tool, 80)
      event.reset = bool(input.reset)
      break
    case 'agent.start':
      event.id = text(input.id, 120)
      event.name = text(input.name, 120)
      event.roleId = text(input.roleId, 60)
      event.agentType = text(input.agentType, 120)
      event.task = text(input.task, 300)
      if (!event.id) return null
      break
    case 'agent.resume':
      event.id = text(input.id, 120)
      if (!event.id) return null
      break
    case 'agent.tool':
      event.id = text(input.id, 120)
      event.tool = text(input.tool, 80)
      if (!event.id) return null
      break
    case 'agent.end':
      event.id = text(input.id, 120)
      event.status = input.status === 'failed' ? 'failed' : 'done'
      if (!event.id) return null
      break
    case 'message':
      event.fromId = text(input.fromId, 120)
      event.fromName = text(input.fromName, 120)
      event.toId = text(input.toId, 120)
      event.toName = text(input.toName, 120)
      event.text = text(input.text, MAX_TEXT) ?? ''
      break
    default:
      break
  }
  const at = num(input.at)
  if (at !== undefined) event.at = at
  return event
}

function sameToken(given, expected) {
  if (typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Démarre le serveur. Renvoie { port, token, close, events } une fois qu'il écoute.
 * `options.port` : 0 pour un port libre choisi par le système.
 */
export async function start(options = {}) {
  const token = options.token ?? randomBytes(18).toString('hex')
  const events = []
  let teamEvent = null
  let seq = 0
  const clients = new Set()
  let port = 0

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  const sameOrigin = origin => origin === undefined || [...allowedHosts()].some(host => origin === `http://${host}`)

  function reply(res, status, body = '', headers = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...headers })
    res.end(body)
  }

  function publish(event) {
    seq += 1
    const stamped = { ...event, seq, at: event.at ?? Date.now() }
    if (stamped.type === 'team') {
      teamEvent = stamped
    } else if (stamped.type === 'reset') {
      events.length = 0
    } else {
      events.push(stamped)
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
    }
    const line = `id: ${stamped.seq}\ndata: ${JSON.stringify(stamped)}\n\n`
    for (const client of clients) client.write(line)
    // Journal de debug facultatif : seulement si TROUPE_DUMP désigne un fichier.
    if (process.env.TROUPE_DUMP) void appendFile(process.env.TROUPE_DUMP, `${JSON.stringify(stamped)}\n`).catch(() => undefined)
    return stamped
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      // Protection contre le rebinding DNS : seul notre propre nom d'hôte est accepté.
      if (!allowedHosts().has(String(req.headers.host))) return reply(res, 421, 'Hôte non autorisé')
      if (!sameOrigin(req.headers.origin)) return reply(res, 403, 'Origine non autorisée')

      if (req.method === 'GET' && url.pathname === '/health') {
        return reply(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' })
      }

      if (req.method === 'GET' && url.pathname === '/roles.json') {
        const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fr'
        const body = {
          lang,
          roles: ROLE_ORDER.map(id => publicRole(ROLES[id], lang)),
          templates: Object.values(TEMPLATES).map(t => ({ id: t.id, roles: t.roles, label: t[lang].label, about: t[lang].about })),
        }
        return reply(res, 200, JSON.stringify(body), { 'Content-Type': 'application/json; charset=utf-8' })
      }

      if (req.method === 'GET' && STATIC[url.pathname]) {
        const asset = STATIC[url.pathname]
        return reply(res, 200, await readFile(asset.file), { 'Content-Type': asset.type })
      }

      if (req.method === 'GET' && url.pathname === '/') {
        if (!sameToken(url.searchParams.get('t'), token)) return reply(res, 401, 'Lien incomplet : ouvrez l’adresse affichée par /troupe.')
        return reply(res, 200, await readFile(join(ROOT, 'web', 'index.html')), { 'Content-Type': 'text/html; charset=utf-8' })
      }

      if (req.method === 'GET' && url.pathname === '/events') {
        if (!sameToken(url.searchParams.get('t'), token)) return reply(res, 401, 'Jeton invalide')
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' })
        res.write('retry: 2000\n\n')
        const last = Number(req.headers['last-event-id'] ?? 0)
        // L'équipe est toujours renvoyée en premier ; le reste, depuis le dernier événement vu.
        if (teamEvent) res.write(`id: ${teamEvent.seq}\ndata: ${JSON.stringify(teamEvent)}\n\n`)
        for (const event of events) if (event.seq > last) res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)
        clients.add(res)
        const beat = setInterval(() => res.write(': battement\n\n'), 15000)
        req.on('close', () => {
          clearInterval(beat)
          clients.delete(res)
        })
        return
      }

      if (req.method === 'POST' && url.pathname === '/event') {
        if (!sameToken(req.headers['x-troupe-token'], token)) return reply(res, 401, 'Jeton invalide')
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return reply(res, 415, 'JSON attendu')
        const chunks = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > MAX_BODY) return reply(res, 413, 'Corps trop grand')
          chunks.push(chunk)
        }
        let parsed
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          return reply(res, 400, 'JSON invalide')
        }
        const batch = Array.isArray(parsed) ? parsed.slice(0, 50) : [parsed]
        let accepted = 0
        for (const item of batch) {
          const clean = sanitize(item)
          if (clean) {
            publish(clean)
            accepted += 1
          }
        }
        return reply(res, accepted > 0 ? 204 : 422, accepted > 0 ? '' : 'Événement inconnu')
      }

      return reply(res, 404, 'Introuvable')
    } catch (error) {
      reply(res, 500, 'Erreur interne')
      process.stderr.write(`erreur: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', resolve)
  })
  port = server.address().port

  return {
    port,
    token,
    events,
    publish,
    close: () =>
      new Promise(resolve => {
        for (const client of clients) client.end()
        server.close(() => resolve())
        server.closeAllConnections?.()
      }),
  }
}

// Lancement en ligne de commande.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const portIndex = process.argv.indexOf('--port')
  const wanted = portIndex > -1 ? Number(process.argv[portIndex + 1]) : 0
  start({ port: Number.isInteger(wanted) && wanted >= 0 && wanted < 65536 ? wanted : 0 })
    .then(handle => {
      process.stdout.write(`READY ${JSON.stringify({ port: handle.port, token: handle.token })}\n`)
      const stop = () => handle.close().then(() => process.exit(0))
      process.on('SIGTERM', stop)
      process.on('SIGINT', stop)
    })
    .catch(error => {
      process.stderr.write(`Impossible de démarrer : ${error.message}\n`)
      process.exit(1)
    })
}
