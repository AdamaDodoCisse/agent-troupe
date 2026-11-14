import { characterSVG, conductorSVG, envelopeSVG } from '/characters.js'
import { desks, deskState, initialState, reduce } from '/state.mjs'

// ---------------------------------------------------------------- textes
const T = {
  fr: {
    title: 'Agent Troupe',
    team: 'Équipe',
    live: 'En direct',
    demoOn: 'Démonstration',
    wait: 'Connexion…',
    offline: 'Reconnexion…',
    demoBtn: 'Démonstration',
    demoStop: 'Quitter la démo',
    pause: 'Figer le fil',
    resume: 'Reprendre',
    feed: 'Communications',
    feedEmpty: 'Aucun message pour l’instant. Les échanges entre agents apparaissent ici.',
    empty: 'En attente des agents. Lancez un sous-agent ou cliquez sur « Démonstration ».',
    idle: 'Au repos',
    working: 'Au travail',
    done: 'Terminé',
    failed: 'En échec',
    sheet: 'Fiche du rôle',
    decides: 'Décide',
    delivers: 'Livre',
    never: 'Ne fait pas',
    lead: 'Chef d’orchestre',
    leadIdle: 'Attend votre prochaine demande',
    leadWork: 'Orchestre le travail',
    agents: n => `${n} agents`,
    hidden: '(texte masqué)',
    to: 'vers',
    stale: 'Le serveur s’est arrêté ou a redémarré (rechargement du mod, fin de session). Tapez /troupe dans Claude Code pour obtenir la nouvelle adresse.',
  },
  en: {
    title: 'Agent Troupe',
    team: 'Team',
    live: 'Live',
    demoOn: 'Demo',
    wait: 'Connecting…',
    offline: 'Reconnecting…',
    demoBtn: 'Demo',
    demoStop: 'Leave demo',
    pause: 'Freeze feed',
    resume: 'Resume',
    feed: 'Communications',
    feedEmpty: 'No message yet. Exchanges between agents show up here.',
    empty: 'Waiting for agents. Start a subagent or click “Demo”.',
    idle: 'Idle',
    working: 'Working',
    done: 'Done',
    failed: 'Failed',
    sheet: 'Role sheet',
    decides: 'Decides',
    delivers: 'Delivers',
    never: 'Does not',
    lead: 'Conductor',
    leadIdle: 'Waiting for your next request',
    leadWork: 'Orchestrating the work',
    agents: n => `${n} agents`,
    hidden: '(text hidden)',
    to: 'to',
    stale: 'The server stopped or restarted (mod reload, end of session). Type /troupe in Claude Code to get the new address.',
  },
}

const params = new URLSearchParams(location.search)
const token = params.get('t') ?? ''
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)')

let lang = (() => {
  const saved = (() => { try { return localStorage.getItem('troupe-lang') } catch { return null } })()
  const wanted = params.get('lang') ?? saved ?? navigator.language ?? 'fr'
  return String(wanted).toLowerCase().startsWith('en') ? 'en' : 'fr'
})()
let state = initialState()
let mode = 'wait' // wait | live | demo
let source = null
let demoTimers = []
let paused = false
let failures = 0
let pending = []
const rendered = new Set()
const seenFlights = new Set()
const speakTimers = new Map()

const $ = id => document.getElementById(id)
const els = { desks: $('desks'), scene: $('scene'), flights: $('flights'), feed: $('feed'), empty: $('empty'), feedEmpty: $('feed-empty'), team: $('team'), conn: $('conn'), connText: $('conn-text'), demo: $('demo'), pause: $('pause'), lang: $('lang') }
const t = () => T[lang]

// ---------------------------------------------------------------- utilitaires
function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
function timeLabel(at) {
  if (!at) return ''
  return new Date(at).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ---------------------------------------------------------------- postes
const deskEls = new Map()

function makeDesk(key, row) {
  const section = el('section', 'desk')
  section.dataset.key = key
  section.tabIndex = 0
  const stage = el('div', 'stage')
  const role = row?.role ?? { id: key, color: '#475569', accessory: 'badge' }
  stage.innerHTML = key === 'lead' ? conductorSVG() : characterSVG(role)
  const bubble = el('div', 'bubble')
  bubble.setAttribute('aria-hidden', 'true')
  const who = el('div', 'who')
  const name = el('p', 'role-name')
  name.append(el('span', 'pill'), el('span', 'rn'), el('span', 'role-long'))
  const status = el('p', 'status')
  const task = el('p', 'task')
  const sheet = el('details', 'sheet')
  sheet.append(el('summary'), el('dl'))
  who.append(name, status, task, sheet)
  section.append(stage, who, bubble)
  if (key === 'lead') section.classList.add('lead')
  els.desks.append(section)
  deskEls.set(key, section)
  return section
}

function setStatus(section, word, tool, extra) {
  const status = section.querySelector('.status')
  status.textContent = ''
  status.append(document.createTextNode(word))
  if (tool) {
    status.append(document.createTextNode(' · '))
    status.append(el('span', 'tool', tool))
  }
  if (extra) status.append(document.createTextNode(` · ${extra}`))
}

function fillSheet(section, role) {
  const sheet = section.querySelector('.sheet')
  const dl = sheet.querySelector('dl')
  sheet.hidden = !role || (!role.decides && !role.delivers && !role.never)
  if (sheet.hidden) return
  sheet.querySelector('summary').textContent = t().sheet
  dl.textContent = ''
  for (const [label, value] of [[t().decides, role.decides], [t().delivers, role.delivers], [t().never, role.never]]) {
    if (!value) continue
    dl.append(el('dt', '', label), el('dd', '', value))
  }
}

function renderLead() {
  const section = deskEls.get('lead') ?? makeDesk('lead')
  const working = state.lead.state === 'working'
  section.dataset.state = working ? 'working' : 'idle'
  section.style.setProperty('--role', '#d97757')
  section.querySelector('.rn').textContent = 'Claude'
  section.querySelector('.role-long').textContent = t().lead
  setStatus(section, working ? t().leadWork : t().leadIdle, working ? state.lead.tool : null)
  section.querySelector('.task').textContent = ''
  section.querySelector('.sheet').hidden = true
  section.setAttribute('aria-label', `Claude, ${working ? t().leadWork : t().leadIdle}`)
}

function renderDesks() {
  const rows = desks(state)
  const keep = new Set(['lead'])
  for (const row of rows) {
    const key = row.kind === 'role' ? `role:${row.roleId}` : `agent:${row.agents[0].id}`
    keep.add(key)
    const section = deskEls.get(key) ?? makeDesk(key, row)
    const status = deskState(row)
    section.dataset.state = status
    section.style.setProperty('--role', row.role?.color ?? '#475569')
    const label = row.role?.label ?? row.agents[0]?.name ?? row.agents[0]?.type ?? '?'
    section.querySelector('.rn').textContent = label
    section.querySelector('.role-long').textContent = row.role && row.role.long !== label ? row.role.long : ''
    const active = row.agents.filter(a => a.status === 'working')
    const current = active.at(-1) ?? row.agents.at(-1)
    const word = { idle: t().idle, working: t().working, done: t().done, failed: t().failed }[status]
    setStatus(section, word, status === 'working' ? current?.tool : null, row.agents.length > 1 ? t().agents(row.agents.length) : null)
    section.querySelector('.task').textContent = current?.task ?? ''
    fillSheet(section, row.role)
    section.setAttribute('aria-label', `${label}, ${word}${current?.tool && status === 'working' ? `, ${current.tool}` : ''}`)
  }
  // Un poste qui n'existe plus (changement d'équipe) est retiré.
  for (const [key, section] of deskEls) {
    if (!keep.has(key)) {
      section.remove()
      deskEls.delete(key)
    }
  }
  // Le chef d'orchestre reste en tête.
  const lead = deskEls.get('lead')
  if (lead && els.desks.firstChild !== lead) els.desks.prepend(lead)
}

// ---------------------------------------------------------------- fil
function partyKey(p) {
  if (p.kind === 'lead') return 'lead'
  if (p.kind === 'agent') return p.roleId && deskEls.has(`role:${p.roleId}`) ? `role:${p.roleId}` : `agent:${p.id}`
  // Destinataire seulement nommé : on cherche un poste dont le nom ou le rôle correspond.
  const wanted = fold(p.label)
  for (const [key, section] of deskEls) {
    if (key === 'lead') continue
    if (fold(section.querySelector('.rn')?.textContent) === wanted) return key
  }
  for (const id of state.order) {
    const agent = state.agents[id]
    if (agent && fold(agent.name) === wanted) return agent.roleId && deskEls.has(`role:${agent.roleId}`) ? `role:${agent.roleId}` : `agent:${id}`
  }
  return null
}

function partyLabel(p) {
  if (p.kind === 'agent' && p.roleId && state.roles[p.roleId]) return state.roles[p.roleId].label
  return p.label
}

function appendMessage(message) {
  if (rendered.has(message.seq)) return
  rendered.add(message.seq)
  const item = el('li', 'msg')
  const color = (message.from.roleId && state.roles[message.from.roleId]?.color) || (message.from.kind === 'lead' ? '#d97757' : '#94a3b8')
  item.style.setProperty('--role', color)
  const head = el('div', 'msg-head')
  head.append(el('time', '', timeLabel(message.at)), el('strong', '', partyLabel(message.from)), el('span', 'arrow', `${t().to}`), el('strong', '', partyLabel(message.to)))
  const body = el('p', message.text ? 'msg-text' : 'msg-text hidden', message.text || t().hidden)
  item.append(head, body)
  els.feed.append(item)
  els.feedEmpty.hidden = true
  if (!paused) els.feed.scrollTop = els.feed.scrollHeight
}

function renderFeed() {
  for (const message of state.messages) {
    if (rendered.has(message.seq)) continue
    if (paused) {
      if (!pending.includes(message)) pending.push(message)
    } else {
      appendMessage(message)
    }
  }
  els.pause.textContent = paused && pending.length > 0 ? `${t().resume} (${pending.length})` : paused ? t().resume : t().pause
}

// ---------------------------------------------------------------- bulles et enveloppes
function speak(key, text) {
  const section = deskEls.get(key)
  if (!section) return
  section.querySelector('.bubble').textContent = text.length > 110 ? `${text.slice(0, 109)}…` : text
  section.classList.add('speaking')
  clearTimeout(speakTimers.get(key))
  speakTimers.set(key, setTimeout(() => section.classList.remove('speaking'), 4200))
}

function centerOf(section) {
  const scene = els.scene.getBoundingClientRect()
  const stage = section.querySelector('.stage').getBoundingClientRect()
  return { x: stage.left - scene.left + stage.width / 2 - 16, y: stage.top - scene.top + stage.height / 2 - 12 }
}

function fly(flight) {
  const fromKey = partyKey(flight.from)
  const toKey = partyKey(flight.to)
  const text = state.messages.find(m => m.seq === flight.seq)?.text ?? ''
  if (fromKey && text) speak(fromKey, text)
  const target = toKey ? deskEls.get(toKey) : null
  if (target) {
    target.classList.add('receiving')
    setTimeout(() => target.classList.remove('receiving'), 1100)
  }
  const source = fromKey ? deskEls.get(fromKey) : null
  if (!source || !target || source === target || REDUCED.matches) return
  const a = centerOf(source)
  const b = centerOf(target)
  const envelope = el('div', 'envelope')
  envelope.innerHTML = envelopeSVG()
  els.flights.append(envelope)
  const lift = Math.min(90, 30 + Math.hypot(b.x - a.x, b.y - a.y) / 4)
  const animation = envelope.animate(
    [
      { transform: `translate(${a.x}px, ${a.y}px) scale(.6) rotate(-8deg)`, opacity: 0 },
      { transform: `translate(${a.x}px, ${a.y - 10}px) scale(1) rotate(-4deg)`, opacity: 1, offset: 0.12 },
      { transform: `translate(${(a.x + b.x) / 2}px, ${(a.y + b.y) / 2 - lift}px) scale(1.15) rotate(4deg)`, offset: 0.55 },
      { transform: `translate(${b.x}px, ${b.y - 6}px) scale(1) rotate(0deg)`, opacity: 1, offset: 0.92 },
      { transform: `translate(${b.x}px, ${b.y}px) scale(.5)`, opacity: 0 },
    ],
    { duration: 1100, easing: 'ease-in-out' },
  )
  animation.onfinish = () => envelope.remove()
}

function playFlights() {
  for (const flight of state.flights) {
    if (seenFlights.has(flight.seq)) continue
    seenFlights.add(flight.seq)
    fly(flight)
  }
}

// ---------------------------------------------------------------- rendu global
let frame = 0
function render() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    els.team.textContent = state.team ? `${t().team} : ${state.team.label}${state.team.about ? ` · ${state.team.about}` : ''}` : ''
    renderLead()
    renderDesks()
    renderFeed()
    playFlights()
    els.empty.hidden = Boolean(state.team) || state.order.length > 0
    els.empty.textContent = t().empty
    els.feedEmpty.hidden = state.messages.length > 0
    els.feedEmpty.textContent = t().feedEmpty
  })
}

function chrome() {
  document.documentElement.lang = lang
  document.title = lang === 'en' ? 'Agent Troupe: live' : 'Agent Troupe : en direct'
  $('feed-title').textContent = t().feed
  els.demo.textContent = mode === 'demo' ? t().demoStop : t().demoBtn
  els.lang.textContent = lang === 'fr' ? 'EN' : 'FR'
  els.lang.setAttribute('aria-label', lang === 'fr' ? 'EN : switch to English' : 'FR : passer en français')
  els.conn.dataset.state = mode
  els.connText.textContent = mode === 'live' ? t().live : mode === 'demo' ? t().demoOn : t().wait
  renderFeed()
}

function apply(event) {
  if (event.type !== 'team' && event.seq !== undefined && event.seq <= state.lastSeq) return
  state = reduce(state, event)
  render()
}

// ---------------------------------------------------------------- connexion en direct
function connect() {
  if (token === '') {
    els.connText.textContent = lang === 'fr' ? 'Lien incomplet : ouvrez l’adresse donnée par /troupe' : 'Incomplete link: open the address shown by /troupe'
    return
  }
  source?.close()
  source = new EventSource(`/events?t=${encodeURIComponent(token)}`)
  source.onopen = () => {
    failures = 0
    if (mode !== 'demo') {
      mode = 'live'
      chrome()
    }
  }
  source.onmessage = message => {
    if (mode === 'demo') return
    try {
      apply(JSON.parse(message.data))
    } catch {
      /* un événement illisible est ignoré */
    }
  }
  source.onerror = () => {
    failures += 1
    if (mode !== 'demo') {
      mode = 'wait'
      chrome()
      // Après quelques échecs d'affilée, le serveur n'est plus là : on le dit au lieu de « Reconnexion… » sans fin.
      els.connText.textContent = failures >= 3 ? t().stale : t().offline
    }
  }
}

// ---------------------------------------------------------------- démonstration
const DEMO_TEXT = {
  fr: {
    po: 'Story : « payer en un clic ». Critères : total affiché, reçu envoyé, refus géré.',
    ba: 'Règles : 12 cas limites listés (carte expirée, double clic, devise). 2 questions ouvertes pour le PO.',
    tl: 'Plan en 3 tâches : service de paiement, écran, tests. Pas de nouvelle dépendance.',
    it: 'Contrainte : aucune donnée de carte stockée chez nous. Go sous réserve du journal sans donnée sensible.',
    dev: 'Service de paiement et tests unitaires prêts. 14 tests verts.',
    rev: '2 remarques : erreur avalée ligne 42, nom de fonction trompeur. Le reste est propre.',
    dev2: 'Corrigé : l’erreur remonte à l’appelant, fonction renommée.',
    rev2: 'Approuvé. Un détail de style en option.',
    qa: 'Plan de test exécuté : 11 réussis, 1 échoué (double clic, 2 paiements).',
    dev3: 'Double clic corrigé : bouton verrouillé pendant l’appel. Test ajouté.',
    qa2: 'Re-test : 12 sur 12 réussis. Critères d’acceptation satisfaits.',
    done: 'Livrable prêt : paiement en un clic.',
  },
  en: {
    po: 'Story: “pay in one click”. Criteria: total shown, receipt sent, refusal handled.',
    ba: 'Rules: 12 edge cases listed (expired card, double click, currency). 2 open questions for the PO.',
    tl: 'Plan in 3 tasks: payment service, screen, tests. No new dependency.',
    it: 'Constraint: no card data stored on our side. Go, provided the log holds no sensitive data.',
    dev: 'Payment service and unit tests ready. 14 tests green.',
    rev: '2 remarks: swallowed error line 42, misleading function name. The rest is clean.',
    dev2: 'Fixed: the error propagates to the caller, function renamed.',
    rev2: 'Approved. One optional style nit.',
    qa: 'Test plan run: 11 passed, 1 failed (double click, 2 payments).',
    dev3: 'Double click fixed: button locked during the call. Test added.',
    qa2: 'Re-test: 12 of 12 passed. Acceptance criteria met.',
    done: 'Deliverable ready: one-click payment.',
  },
}

async function demoEvents() {
  const response = await fetch(`/roles.json?lang=${lang}`)
  const data = await response.json()
  const template = data.templates.find(x => x.id === 'equipe-complete')
  const roles = template.roles.map(id => data.roles.find(r => r.id === id))
  const x = DEMO_TEXT[lang]
  const agent = (id, roleId, task) => ({ type: 'agent.start', id, roleId, name: roleId, task, agentType: 'general-purpose' })
  const msg = (fromId, toId, text) => ({ type: 'message', fromId, toId, text })
  return [
    [0, { type: 'team', template: 'equipe-complete', label: template.label, about: template.about, roles }],
    [300, { type: 'lead', state: 'working', tool: 'Agent', reset: true }],
    [900, agent('d-po', 'po', lang === 'fr' ? 'Cadrer le besoin' : 'Frame the need')],
    [1600, { type: 'agent.tool', id: 'd-po', tool: 'Read' }],
    [2300, agent('d-ba', 'ba', lang === 'fr' ? 'Spécifier les règles' : 'Specify the rules')],
    [2800, msg('d-po', 'd-ba', x.po)],
    [3300, { type: 'agent.end', id: 'd-po' }],
    [4600, { type: 'agent.tool', id: 'd-ba', tool: 'Grep' }],
    [5300, agent('d-tl', 'tech-lead', lang === 'fr' ? 'Concevoir le plan technique' : 'Design the technical plan')],
    [5800, msg('d-ba', 'd-tl', x.ba)],
    [6200, { type: 'agent.end', id: 'd-ba' }],
    [7000, { type: 'agent.tool', id: 'd-tl', tool: 'Glob' }],
    [7600, agent('d-it', 'it-owner', lang === 'fr' ? 'Vérifier les contraintes SI' : 'Check IS constraints')],
    [8100, msg('d-tl', 'd-it', x.tl)],
    [9800, msg('d-it', 'd-tl', x.it)],
    [10600, { type: 'agent.end', id: 'd-it' }],
    [10700, agent('d-dev', 'developpeur', lang === 'fr' ? 'Implémenter le paiement' : 'Implement payment')],
    [11100, msg('d-tl', 'd-dev', x.tl)],
    [11500, { type: 'agent.end', id: 'd-tl' }],
    [12300, { type: 'agent.tool', id: 'd-dev', tool: 'Edit' }],
    [13300, { type: 'agent.tool', id: 'd-dev', tool: 'Bash' }],
    [14200, agent('d-rev', 'reviewer', lang === 'fr' ? 'Relire le changement' : 'Review the change')],
    [14600, msg('d-dev', 'd-rev', x.dev)],
    [15800, { type: 'agent.tool', id: 'd-rev', tool: 'Read' }],
    [17200, msg('d-rev', 'd-dev', x.rev)],
    [18200, { type: 'agent.tool', id: 'd-dev', tool: 'Edit' }],
    [19400, msg('d-dev', 'd-rev', x.dev2)],
    [20400, agent('d-qa', 'qa', lang === 'fr' ? 'Tester le résultat' : 'Test the result')],
    [20800, msg('d-rev', 'd-qa', x.rev2)],
    [21100, { type: 'agent.end', id: 'd-rev' }],
    [22200, { type: 'agent.tool', id: 'd-qa', tool: 'Bash' }],
    [24000, msg('d-qa', 'd-dev', x.qa)],
    [25200, { type: 'agent.tool', id: 'd-dev', tool: 'Edit' }],
    [26600, msg('d-dev', 'd-qa', x.dev3)],
    [26900, { type: 'agent.end', id: 'd-dev' }],
    [28000, { type: 'agent.tool', id: 'd-qa', tool: 'Bash' }],
    [29600, msg('d-qa', 'd-po', x.qa2)],
    [30000, { type: 'agent.end', id: 'd-qa' }],
    [31000, msg('lead', 'd-po', x.done)],
    [31400, { type: 'lead', state: 'idle' }],
  ]
}

function stopDemo() {
  for (const timer of demoTimers) clearTimeout(timer)
  demoTimers = []
}

function resetView() {
  state = initialState()
  rendered.clear()
  seenFlights.clear()
  pending = []
  els.feed.textContent = ''
  for (const section of deskEls.values()) section.remove()
  deskEls.clear()
}

async function startDemo() {
  stopDemo()
  resetView()
  mode = 'demo'
  chrome()
  let seq = 1000
  for (const [delay, event] of await demoEvents()) {
    demoTimers.push(setTimeout(() => apply({ ...event, seq: ++seq, at: Date.now() }), delay))
  }
}

function leaveDemo() {
  stopDemo()
  resetView()
  mode = 'wait'
  chrome()
  render()
  connect()
}

// ---------------------------------------------------------------- commandes
els.demo.addEventListener('click', () => (mode === 'demo' ? leaveDemo() : startDemo()))
els.pause.addEventListener('click', () => {
  paused = !paused
  els.pause.setAttribute('aria-pressed', String(paused))
  if (!paused) {
    for (const message of pending) appendMessage(message)
    pending = []
  }
  renderFeed()
})
els.lang.addEventListener('click', () => {
  lang = lang === 'fr' ? 'en' : 'fr'
  try { localStorage.setItem('troupe-lang', lang) } catch { /* sans stockage : la langue reste celle de la session */ }
  chrome()
  render()
})

chrome()
render()
connect()
