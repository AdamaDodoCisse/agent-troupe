// Réducteur pur : une suite d'événements du mod donne l'état affiché par la page.
// Aucun accès au DOM ni au réseau : testé sous Node, utilisé tel quel dans le navigateur.

export const MAX_MESSAGES = 200

export function initialState() {
  return {
    team: null,
    roles: {},
    lead: { state: 'idle', tool: null, toolCount: 0, startedAt: null },
    agents: {},
    order: [],
    messages: [],
    flights: [],
    lastSeq: 0,
  }
}

/** Texte d'un message, réduit à une ligne et tronqué. */
export function shorten(text, width) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim()
  return one.length <= width ? one : `${one.slice(0, Math.max(1, width - 1))}…`
}

/** Qui est « id » pour l'affichage : le chef d'orchestre, un agent connu, ou un destinataire seulement nommé. */
export function party(state, id, name) {
  if (id === null || id === undefined || id === 'lead') {
    return name && name !== 'lead' ? { kind: 'name', id: null, label: name, roleId: null } : { kind: 'lead', id: 'lead', label: 'Claude', roleId: null }
  }
  const agent = state.agents[id]
  if (agent) return { kind: 'agent', id, label: agent.name || agent.task || agent.type, roleId: agent.roleId }
  return { kind: 'name', id: null, label: name || 'Agent', roleId: null }
}

export function reduce(state, event) {
  const next = { ...state, lastSeq: Math.max(state.lastSeq, event.seq ?? 0) }
  switch (event.type) {
    case 'team': {
      const roles = {}
      for (const role of event.roles ?? []) roles[role.id] = role
      return { ...next, team: { template: event.template, label: event.label, about: event.about ?? '', roleIds: (event.roles ?? []).map(r => r.id) }, roles }
    }
    case 'lead':
      return {
        ...next,
        lead: {
          state: event.state,
          tool: event.state === 'working' ? (event.tool ?? state.lead.tool) : null,
          toolCount: event.state === 'working' ? (event.reset ? 0 : state.lead.toolCount + (event.tool ? 1 : 0)) : state.lead.toolCount,
          startedAt: event.state === 'working' ? (state.lead.startedAt ?? event.at ?? null) : null,
        },
      }
    case 'agent.start': {
      const agent = {
        id: event.id,
        name: event.name ?? '',
        roleId: event.roleId ?? null,
        type: event.agentType ?? '',
        task: event.task ?? '',
        status: 'working',
        tool: null,
        toolCount: 0,
        startedAt: event.at ?? null,
        endedAt: null,
      }
      const order = state.order.includes(event.id) ? state.order : [...state.order, event.id]
      return { ...next, agents: { ...state.agents, [event.id]: agent }, order }
    }
    case 'agent.tool': {
      const agent = state.agents[event.id]
      if (!agent) return next
      return {
        ...next,
        agents: {
          ...state.agents,
          [event.id]: { ...agent, status: agent.status === 'done' || agent.status === 'failed' ? agent.status : 'working', tool: event.tool ?? null, toolCount: agent.toolCount + (event.tool ? 1 : 0) },
        },
      }
    }
    case 'agent.end': {
      const agent = state.agents[event.id]
      if (!agent) return next
      return { ...next, agents: { ...state.agents, [event.id]: { ...agent, status: event.status === 'failed' ? 'failed' : 'done', tool: null, endedAt: event.at ?? null } } }
    }
    case 'message': {
      const from = party(state, event.fromId, event.fromName)
      const to = party(state, event.toId, event.toName)
      const message = { seq: event.seq ?? state.lastSeq + 1, at: event.at ?? null, from, to, text: event.text ?? '' }
      const messages = [...state.messages, message].slice(-MAX_MESSAGES)
      return { ...next, messages, flights: [...state.flights.slice(-19), { seq: message.seq, from, to }] }
    }
    case 'reset':
      return { ...initialState(), lastSeq: next.lastSeq }
    default:
      return next
  }
}

/** Rejoue une liste d'événements depuis zéro (page qui se connecte en cours de session). */
export function replay(events) {
  return events.reduce(reduce, initialState())
}

/** Les postes à afficher : un par rôle de l'équipe, puis un par agent sans rôle. */
export function desks(state) {
  const byRole = new Map()
  const loose = []
  for (const id of state.order) {
    const agent = state.agents[id]
    if (!agent) continue
    if (agent.roleId && state.roles[agent.roleId]) {
      const list = byRole.get(agent.roleId) ?? []
      list.push(agent)
      byRole.set(agent.roleId, list)
    } else {
      loose.push(agent)
    }
  }
  const rows = (state.team?.roleIds ?? []).map(roleId => ({ kind: 'role', roleId, role: state.roles[roleId], agents: byRole.get(roleId) ?? [] }))
  for (const [roleId, agents] of byRole) {
    if (!rows.some(row => row.roleId === roleId)) rows.push({ kind: 'role', roleId, role: state.roles[roleId], agents })
  }
  for (const agent of loose) rows.push({ kind: 'agent', roleId: null, role: null, agents: [agent] })
  return rows
}

/** Un poste est « actif » si un de ses agents travaille. */
export function deskState(row) {
  if (row.agents.some(a => a.status === 'working')) return 'working'
  if (row.agents.length > 0 && row.agents.every(a => a.status === 'failed')) return 'failed'
  if (row.agents.length > 0 && row.agents.every(a => a.status === 'done' || a.status === 'failed')) return 'done'
  return 'idle'
}
