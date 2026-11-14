import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MAX_MESSAGES, desks, deskState, initialState, reduce, replay, shorten } from '../shared/state.mjs'

const roles = [
  { id: 'qa', label: 'QA', color: '#be123c' },
  { id: 'developpeur', label: 'Développeur', color: '#15803d' },
]
const team = { type: 'team', template: 'qualite', label: 'Qualité', roles, seq: 1 }

describe('réducteur', () => {
  it('construit l\'équipe et un poste par rôle, même sans agent', () => {
    const state = reduce(initialState(), team)
    const rows = desks(state)
    assert.deepEqual(rows.map(r => r.roleId), ['qa', 'developpeur'])
    assert.equal(deskState(rows[0]), 'idle')
  })

  it('suit la vie d\'un agent : travail, outil, fin', () => {
    let state = replay([team, { type: 'agent.start', id: 'a1', roleId: 'qa', task: 'tester', seq: 2 }])
    assert.equal(deskState(desks(state)[0]), 'working')
    state = reduce(state, { type: 'agent.tool', id: 'a1', tool: 'Bash', seq: 3 })
    assert.equal(state.agents.a1.tool, 'Bash')
    assert.equal(state.agents.a1.toolCount, 1)
    state = reduce(state, { type: 'agent.end', id: 'a1', status: 'done', seq: 4 })
    assert.equal(deskState(desks(state)[0]), 'done')
    assert.equal(state.agents.a1.tool, null)
  })

  it('un agent relancé reprend son poste sans repartir de zéro', () => {
    const state = replay([team, { type: 'agent.start', id: 'a1', roleId: 'qa', name: 'qa', seq: 2 }, { type: 'agent.tool', id: 'a1', tool: 'Bash' }, { type: 'agent.end', id: 'a1', status: 'done' }, { type: 'agent.resume', id: 'a1' }])
    assert.equal(state.agents.a1.status, 'working')
    assert.equal(state.agents.a1.toolCount, 1)
    assert.equal(state.agents.a1.roleId, 'qa')
    assert.equal(state.order.length, 1)
  })

  it('reprendre un agent inconnu ne crée rien', () => {
    const state = replay([team, { type: 'agent.resume', id: 'fantome' }])
    assert.deepEqual(state.order, [])
  })

  it('un agent en échec rend le poste « failed »', () => {
    const state = replay([team, { type: 'agent.start', id: 'a1', roleId: 'qa' }, { type: 'agent.end', id: 'a1', status: 'failed' }])
    assert.equal(deskState(desks(state)[0]), 'failed')
  })

  it('un outil reçu après la fin d\'un agent ne le ressuscite pas', () => {
    const state = replay([team, { type: 'agent.start', id: 'a1', roleId: 'qa' }, { type: 'agent.end', id: 'a1', status: 'done' }, { type: 'agent.tool', id: 'a1', tool: 'Read' }])
    assert.equal(state.agents.a1.status, 'done')
  })

  it('un agent sans rôle apparaît comme poste générique après les rôles', () => {
    const state = replay([team, { type: 'agent.start', id: 'x', name: 'explorateur', task: 'chercher' }])
    const rows = desks(state)
    assert.equal(rows.at(-1).kind, 'agent')
    assert.equal(rows.at(-1).agents[0].name, 'explorateur')
  })

  it('plusieurs agents sur un même rôle partagent le poste', () => {
    const state = replay([team, { type: 'agent.start', id: 'a', roleId: 'qa' }, { type: 'agent.start', id: 'b', roleId: 'qa' }])
    assert.equal(desks(state)[0].agents.length, 2)
  })

  it('résout expéditeur et destinataire d\'un message', () => {
    const state = replay([
      team,
      { type: 'agent.start', id: 'a1', roleId: 'qa', name: 'qa' },
      { type: 'agent.start', id: 'a2', roleId: 'developpeur', name: 'dev' },
      { type: 'message', fromId: 'a1', toId: 'a2', text: 'bug', seq: 5 },
      { type: 'message', fromId: null, toId: 'a1', text: 'ok', seq: 6 },
      { type: 'message', fromId: 'a2', toId: null, toName: 'inconnu', text: 'hello', seq: 7 },
    ])
    assert.equal(state.messages[0].from.roleId, 'qa')
    assert.equal(state.messages[0].to.roleId, 'developpeur')
    assert.equal(state.messages[1].from.kind, 'lead')
    assert.equal(state.messages[2].to.label, 'inconnu')
    assert.equal(state.flights.length, 3)
  })

  it('borne le nombre de messages gardés', () => {
    let state = reduce(initialState(), team)
    for (let i = 0; i < MAX_MESSAGES + 25; i += 1) state = reduce(state, { type: 'message', text: `m${i}`, seq: 10 + i })
    assert.equal(state.messages.length, MAX_MESSAGES)
    assert.equal(state.messages.at(-1).text, `m${MAX_MESSAGES + 24}`)
  })

  it('le chef d\'orchestre travaille puis se repose', () => {
    let state = reduce(initialState(), { type: 'lead', state: 'working', tool: 'Bash', at: 1000 })
    assert.equal(state.lead.state, 'working')
    assert.equal(state.lead.tool, 'Bash')
    state = reduce(state, { type: 'lead', state: 'idle' })
    assert.equal(state.lead.state, 'idle')
    assert.equal(state.lead.tool, null)
  })

  it('reset vide la scène mais garde le dernier numéro', () => {
    const state = replay([team, { type: 'agent.start', id: 'a', roleId: 'qa', seq: 2 }, { type: 'reset', seq: 3 }])
    assert.deepEqual(state.order, [])
    assert.equal(state.lastSeq, 3)
  })

  it('shorten réduit à une ligne et tronque', () => {
    assert.equal(shorten('a\n  b', 10), 'a b')
    assert.equal(shorten('x'.repeat(50), 10).length, 10)
  })
})
