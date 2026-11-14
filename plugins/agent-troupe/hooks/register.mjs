// agent-troupe : le module des hooks.
// Écoute les événements des agents, les associe à des rôles, et les envoie au petit serveur local
// qui alimente la page. Rien ne quitte la machine, et une panne du serveur ne gêne jamais la session.
//
// Ce que l'on envoie : le rôle, l'état, le NOM de l'outil en cours, une description courte de la tâche
// et le texte (tronqué) des messages entre agents. Jamais le contenu d'un fichier, jamais les arguments
// d'un outil, jamais le prompt complet d'un sous-agent.

import { DEFAULT_TEMPLATE, TEMPLATES, activeRoles, agentSpecFor, launchPhrase, matchRole, publicRole } from '../shared/roles.mjs'

const SHORT_WIDTH = 140
const MAX_QUEUE = 300
const MAX_FAILURES = 5
/** Le retour d'un sous-agent à celui qui l'a lancé : montré comme un message, pas comme un outil. */
const HANDBACK_TOOL = 'SubagentHandback'

/** Une ligne, tronquée : ce que l'on accepte de montrer d'un message. */
function trimText(text, mode) {
  if (mode === 'none') return ''
  const one = String(text ?? '').replace(/\s+/g, ' ').trim()
  const width = mode === 'full' ? 1000 : SHORT_WIDTH
  return one.length <= width ? one : `${one.slice(0, width - 1)}…`
}

/** État du module : réinitialisé par `register` à chaque chargement ou rechargement. */
const S = {
  lang: 'fr',
  template: DEFAULT_TEMPLATE,
  roles: [],
  textMode: 'short',
  autoOpen: false,
  wantedPort: 0,
  /** @type {{ port: number, token: string } | null} */
  server: null,
  starting: false,
  failures: 0,
  lastProblem: '',
  /** @type {object[]} */
  queue: [],
  /** agentId -> { name, roleId } */
  known: new Map(),
}

function say(fr, en) {
  return S.lang === 'en' ? en : fr
}

function urlOf() {
  return S.server ? `http://127.0.0.1:${S.server.port}/?t=${S.server.token}&lang=${S.lang}` : null
}

function teamEvent() {
  const chosen = TEMPLATES[S.template]
  return {
    type: 'team',
    template: S.template,
    lang: S.lang,
    label: chosen ? chosen[S.lang].label : say('Équipe personnalisée', 'Custom team'),
    about: chosen ? chosen[S.lang].about : '',
    roles: S.roles.map(role => publicRole(role, S.lang)),
  }
}

/** Envoie un événement sans jamais bloquer ni faire échouer la session. */
function send($, event) {
  if (!S.server) {
    S.queue.push(event)
    if (S.queue.length > MAX_QUEUE) S.queue.shift()
    return
  }
  if (S.failures >= MAX_FAILURES) return
  const target = S.server
  void postEvent($, target, event)
}

async function postEvent($, target, event) {
  try {
    const response = await $.http.fetch(`http://127.0.0.1:${target.port}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-troupe-token': target.token },
      body: JSON.stringify({ ...event, at: Date.now() }),
    })
    if (response.ok) S.failures = 0
    else S.failures += 1
  } catch {
    S.failures += 1
    if (S.failures >= MAX_FAILURES) {
      S.lastProblem = say('Le serveur local ne répond plus.', 'The local server no longer answers.')
      $.ui.status(undefined)
    }
  }
}

async function openBrowser($) {
  const url = urlOf()
  if (!url) return false
  for (const argv of [['open', url], ['xdg-open', url], ['cmd', '/c', 'start', '', url]]) {
    try {
      const done = await $.process.run(argv, { timeoutMs: 5000 })
      if (done.exitCode === 0) return true
    } catch {
      /* cette commande n'existe pas sur ce système : on essaie la suivante */
    }
  }
  return false
}

/** Lance le serveur local pour la durée de la session. */
async function startServer($) {
  if (S.server || S.starting) return
  S.starting = true
  S.lastProblem = ''
  let seen = ''
  try {
    const script = `${$.plugin.root}/server/server.mjs`
    const stream = $.process.spawn({ argv: ['node', script, '--port', String(S.wantedPort)] })
    for await (const chunk of stream) {
      if (!('stream' in chunk)) continue
      if (chunk.stream === 'stderr') {
        S.lastProblem = chunk.text.trim().slice(0, 200)
        continue
      }
      seen += chunk.text
      const ready = S.server ? null : /READY (\{.*\})/.exec(seen)
      if (!ready) continue
      const info = JSON.parse(ready[1])
      S.server = { port: info.port, token: info.token }
      S.failures = 0
      $.ui.status(`Troupe : ${urlOf()}`)
      send($, teamEvent())
      for (const event of S.queue.splice(0)) send($, event)
      if (S.autoOpen) void openBrowser($)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    S.lastProblem = say(
      `Le serveur local n’a pas démarré (Node.js 18 ou plus est requis) : ${reason}`,
      `The local server did not start (Node.js 18 or later is required): ${reason}`,
    )
  } finally {
    S.server = null
    S.starting = false
    $.ui.status(undefined)
  }
}

/** Retrouve un agent que l'on n'a pas vu naître (équipier, agent lancé par un autre mod). */
async function ensureAgent($, agentId) {
  if (S.known.has(agentId)) return S.known.get(agentId)
  const placeholder = { name: '', roleId: null }
  S.known.set(agentId, placeholder)
  try {
    const info = (await $.agent.list()).find(one => one.id === agentId)
    if (info) {
      const role = matchRole({ name: info.name, type: info.type, description: info.description }, S.roles)
      const entry = { name: info.name ?? '', roleId: role?.id ?? null }
      S.known.set(agentId, entry)
      send($, { type: 'agent.start', id: agentId, name: entry.name, roleId: entry.roleId ?? undefined, agentType: info.type, task: info.description })
      return entry
    }
  } catch {
    /* la liste n'est pas disponible : l'agent restera anonyme */
  }
  return placeholder
}

/** Qui est le destinataire d'un message : un agent connu, ou seulement un nom. */
async function resolveRecipient($, to) {
  // « main » désigne la conversation principale, c'est-à-dire Claude, le chef d'orchestre.
  if (to === 'main') return { id: null, name: '' }
  if (S.known.has(to)) return { id: to, name: S.known.get(to)?.name ?? '' }
  try {
    const found = (await $.agent.list()).find(one => one.id === to || one.name === to || one.teammateId === to)
    if (found) {
      await ensureAgent($, found.id)
      return { id: found.id, name: found.name ?? to }
    }
  } catch {
    /* sans liste d'agents, le destinataire reste un simple nom */
  }
  return { id: null, name: to }
}

/** Enregistre un type d'agent par rôle : on peut ensuite déléguer à `agent-troupe:<rôle>`. */
async function registerAgents($) {
  for (const role of S.roles) {
    if (!role[S.lang]?.prompt) continue
    try {
      await $.agent.register(agentSpecFor(role, S.lang))
    } catch {
      /* un rôle qui ne s'enregistre pas ne doit pas empêcher les autres */
    }
  }
  try {
    await $.command.register({
      name: 'troupe',
      description: say('Page en direct de votre équipe d’agents (« open » l’ouvre dans le navigateur)', 'Live page of your agent team (“open” opens it in the browser)'),
    })
  } catch {
    /* la commande est un confort : sans elle, l'URL reste dans la ligne d'état */
  }
}

async function troupeCommand($, rawArgs) {
  const args = String(rawArgs ?? '').trim().toLowerCase()
  if (!S.server && !S.starting) await startServer($).catch(() => undefined)
  const url = urlOf()
  const lines = []
  if (!url) {
    lines.push(say('La page n’est pas disponible.', 'The page is not available.'))
    if (S.lastProblem) lines.push(S.lastProblem)
    lines.push(say('Node.js 18 ou plus doit être installé.', 'Node.js 18 or later must be installed.'))
    return { text: lines.join('\n') }
  }
  let opened = false
  if (args === 'open' || S.autoOpen) opened = await openBrowser($)
  lines.push(say('Agent Troupe : page en direct', 'Agent Troupe: live page'))
  lines.push(`URL : ${url}`)
  if (args === 'open') lines.push(opened ? say('Ouverte dans votre navigateur.', 'Opened in your browser.') : say('Ouvrez l’adresse ci-dessus dans votre navigateur.', 'Open the address above in your browser.'))
  const chosen = TEMPLATES[S.template]
  lines.push(say(`Équipe : ${chosen ? chosen.fr.label : 'personnalisée'} (${S.roles.length} rôles)`, `Team: ${chosen ? chosen.en.label : 'custom'} (${S.roles.length} roles)`))
  lines.push(say('Pour confier une tâche à un rôle, copiez la phrase correspondante :', 'To hand a task to a role, copy the matching sentence:'))
  for (const role of S.roles) {
    if (!role[S.lang]?.prompt) continue
    lines.push(`- ${role[S.lang].label} : ${launchPhrase(role, S.lang)}…`)
  }
  return { text: lines.join('\n') }
}

async function observeMessage($, e) {
  try {
    const from = e.agentId ? await ensureAgent($, e.agentId) : null
    const to = await resolveRecipient($, e.to)
    send($, {
      type: 'message',
      fromId: e.agentId ?? null,
      fromName: from?.name ?? '',
      toId: to.id,
      toName: to.name,
      text: trimText(e.text, S.textMode),
    })
  } catch {
    /* observer un message ne doit jamais empêcher son envoi */
  }
}

function announceAgent($, e, started) {
  const info = { name: e.name ?? '', type: e.subagentType ?? '', description: e.description ?? '' }
  const role = matchRole(info, S.roles)
  S.known.set(started.agentId, { name: info.name, roleId: role?.id ?? null })
  send($, { type: 'agent.start', id: started.agentId, name: info.name, roleId: role?.id ?? undefined, agentType: info.type, task: info.description })
  // La délégation apparaît dans le fil : Claude confie une tâche au rôle (description courte, jamais le prompt).
  if (info.description !== '') {
    send($, { type: 'message', fromId: null, toId: started.agentId, toName: info.name, text: trimText(info.description, S.textMode) })
  }
}

async function resumeAgent($, e, agentId) {
  await ensureAgent($, agentId)
  send($, { type: 'agent.resume', id: agentId })
}

function announceEnd($, e, done) {
  const entry = S.known.get(e.agentId)
  const failed = e.reason === 'error' || e.reason === 'aborted'
  send($, { type: 'agent.end', id: e.agentId, status: failed ? 'failed' : 'done' })
  // Le retour d'un sous-agent est un message vers celui qui l'a lancé.
  const answer = trimText(done?.text, S.textMode)
  if (!failed && (answer !== '' || S.textMode === 'none')) {
    send($, { type: 'message', fromId: e.agentId, fromName: entry?.name ?? '', toId: null, text: answer })
  }
}

export const register = (on, options) => {
  S.lang = String(options?.language) === 'en' ? 'en' : 'fr'
  S.template = String(options?.template || DEFAULT_TEMPLATE)
  S.roles = activeRoles(S.template, String(options?.roles ?? ''), S.lang)
  S.textMode = ['full', 'short', 'none'].includes(String(options?.messageText)) ? String(options?.messageText) : 'short'
  S.autoOpen = String(options?.autoOpen) === 'true'
  S.wantedPort = Number.parseInt(String(options?.port ?? '0'), 10) || 0
  S.known = new Map()
  S.queue = []

  on('session.start', async ($, e, next) => {
    // Les types d'agents sont enregistrés avant le premier tour : on peut déléguer à `agent-troupe:<rôle>` tout de suite.
    await registerAgents($)
    void startServer($)
    return next(e)
  })

  on('command.run', { command: 'troupe' }, ($, e) => troupeCommand($, e.args))

  // Le chef d'orchestre : la boucle principale.
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) send($, { type: 'lead', state: 'working', reset: true })
    else void ensureAgent($, e.agentId)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) send($, { type: 'lead', state: 'idle' })
    else announceEnd($, e, done)
    return done
  })

  // Un sous-agent entre en scène.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started && started.deny === undefined && started.agentId) {
      // Un agent relancé par un message (SendMessage) reprend son poste : ce n'est ni un nouveau départ ni une délégation.
      if (e.resume) void resumeAgent($, e, started.agentId)
      else announceAgent($, e, started)
    }
    return started
  })

  // Ce que chacun fait : le nom de l'outil, rien d'autre.
  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) {
      send($, { type: 'lead', state: 'working', tool: e.tool })
    } else {
      void ensureAgent($, e.agentId)
      if (e.tool !== HANDBACK_TOOL) send($, { type: 'agent.tool', id: e.agentId, tool: e.tool })
    }
    const ran = await next(e)
    if (e.agentId === undefined) send($, { type: 'lead', state: 'working', tool: '' })
    else if (e.tool !== HANDBACK_TOOL) send($, { type: 'agent.tool', id: e.agentId, tool: '' })
    return ran
  })

  // Les communications entre agents.
  on('session.send', async ($, e, next) => {
    const queued = await next(e)
    await observeMessage($, e)
    return queued
  })
}
