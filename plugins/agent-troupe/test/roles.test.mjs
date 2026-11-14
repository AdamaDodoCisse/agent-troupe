import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULT_TEMPLATE, ROLES, ROLE_ORDER, TEMPLATES, activeRoles, agentSpecFor, fold, launchPhrase, matchRole, parseCustomRoles, publicRole } from '../shared/roles.mjs'

describe('catalogue des rôles', () => {
  it('définit les sept rôles, chacun avec responsabilité, livrable, limites et prompt dans les deux langues', () => {
    assert.deepEqual(ROLE_ORDER, ['po', 'ba', 'it-owner', 'tech-lead', 'developpeur', 'reviewer', 'qa'])
    for (const id of ROLE_ORDER) {
      for (const lang of ['fr', 'en']) {
        const role = ROLES[id][lang]
        assert.ok(role.label.length >= 2 && role.long.length >= 4, `${id}.${lang}.label`)
        for (const field of ['decides', 'delivers', 'never', 'description', 'prompt']) {
          assert.ok(role[field] && role[field].length > 8, `${id}.${lang}.${field}`)
        }
      }
      assert.match(ROLES[id].color, /^#[0-9a-f]{6}$/i)
    }
  })

  it('PO est le Product Owner et QA le testeur', () => {
    assert.equal(ROLES.po.fr.long, 'Product Owner')
    assert.equal(ROLES.qa.fr.long, 'Testeur')
    assert.equal(ROLES.qa.en.long, 'Tester')
  })

  it('chaque rôle dit ce qu\'il ne fait pas, et le développeur ne valide pas son propre travail', () => {
    assert.match(ROLES.developpeur.fr.never, /valide pas son propre travail/)
    assert.match(ROLES.reviewer.fr.never, /Ne réécrit pas/)
    assert.match(ROLES.qa.fr.never, /Ne corrige pas/)
  })

  it('les modèles ne référencent que des rôles existants', () => {
    for (const template of Object.values(TEMPLATES)) {
      for (const id of template.roles) assert.ok(ROLES[id], `${template.id} -> ${id}`)
    }
    assert.ok(TEMPLATES[DEFAULT_TEMPLATE])
    assert.equal(TEMPLATES['equipe-complete'].roles.length, 7)
    assert.deepEqual(TEMPLATES.livraison.roles, ['tech-lead', 'developpeur', 'reviewer'])
    assert.deepEqual(TEMPLATES.qualite.roles, ['developpeur', 'reviewer', 'qa'])
    assert.deepEqual(TEMPLATES.cadrage.roles, ['po', 'ba', 'it-owner', 'tech-lead'])
  })
})

describe('agents enregistrés', () => {
  it('les rôles qui ne codent pas ne peuvent pas modifier de fichier', () => {
    for (const id of ['po', 'ba', 'it-owner', 'tech-lead', 'reviewer']) {
      assert.deepEqual(agentSpecFor(ROLES[id]).disallowedTools, ['Edit', 'Write', 'NotebookEdit'], id)
    }
    assert.equal(agentSpecFor(ROLES.developpeur).disallowedTools, undefined)
    assert.equal(agentSpecFor(ROLES.qa).disallowedTools, undefined)
  })

  it('le prompt, le nom et la description sont repris du rôle', () => {
    const spec = agentSpecFor(ROLES.reviewer, 'en')
    assert.equal(spec.name, 'reviewer')
    assert.match(spec.prompt, /You are the team’s Reviewer/)
    assert.match(spec.description, /^Reviewer:/)
  })

  it('la phrase de lancement nomme le type d\'agent', () => {
    assert.match(launchPhrase(ROLES.qa), /agent-troupe:qa/)
    assert.match(launchPhrase(ROLES.qa, 'en'), /Use the agent-troupe:qa agent/)
  })

  it('la page ne reçoit jamais le prompt', () => {
    assert.equal('prompt' in publicRole(ROLES.qa), false)
  })
})

describe('rattachement d\'un agent à un rôle', () => {
  const roles = activeRoles('equipe-complete', '')

  it('le type agent-troupe:<rôle> désigne le rôle sans ambiguïté', () => {
    assert.equal(matchRole({ type: 'agent-troupe:reviewer', description: 'tests de qa' }, roles).id, 'reviewer')
  })
  it('le nom donné à l\'agent prime sur le type et la description', () => {
    assert.equal(matchRole({ name: 'qa', type: 'general-purpose', description: 'review the design' }, roles).id, 'qa')
    assert.equal(matchRole({ name: 'tech-lead', type: 'general-purpose', description: 'run the tests' }, roles).id, 'tech-lead')
  })
  it('reconnaît les noms français et anglais, avec ou sans accent', () => {
    assert.equal(matchRole({ name: 'développeur' }, roles).id, 'developpeur')
    assert.equal(matchRole({ name: 'developer' }, roles).id, 'developpeur')
    assert.equal(matchRole({ name: 'analyste' }, roles).id, 'ba')
    assert.equal(matchRole({ name: 'testeur' }, roles).id, 'qa')
    assert.equal(matchRole({ name: 'product-owner' }, roles).id, 'po')
    assert.equal(matchRole({ name: 'Product Owner' }, roles).id, 'po')
    assert.equal(matchRole({ name: 'it owner' }, roles).id, 'it-owner')
    assert.equal(matchRole({ name: 'business-analyst' }, roles).id, 'ba')
  })
  it('un mot ne compte que s\'il est entier : « portfolio » n\'est pas un PO', () => {
    assert.equal(matchRole({ name: 'portfolio' }, roles), null)
    assert.equal(matchRole({ description: 'Explore the repository' }, roles), null)
  })
  it('un rôle absent de l\'équipe active n\'est pas attribué', () => {
    const delivery = activeRoles('livraison', '')
    assert.equal(matchRole({ name: 'qa' }, delivery), null)
  })
})

describe('modèle personnalisé', () => {
  it('lit « Rôle: mot, mot; Rôle » et garde les définitions des rôles connus', () => {
    const roles = parseCustomRoles('QA: recette, bug; Architecte: archi, schema')
    assert.equal(roles[0].id, 'qa')
    assert.ok(roles[0].keywords.includes('recette'))
    assert.equal(roles[1].custom, true)
    assert.equal(roles[1].fr.label, 'Architecte')
    assert.deepEqual(roles[1].keywords, ['archi', 'schema'])
  })
  it('une valeur vide retombe sur l\'équipe complète', () => {
    assert.equal(activeRoles('custom', '   ').length, 7)
  })
  it('un modèle inconnu retombe sur l\'équipe complète', () => {
    assert.equal(activeRoles('nimporte', '').length, 7)
  })
  it('fold ignore casse et accents', () => {
    assert.equal(fold('Développeur'), 'developpeur')
  })
})
