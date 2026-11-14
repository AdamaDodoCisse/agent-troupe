import { expect, test } from 'claude-code/testing'

const READY = 'READY {"port":4567,"token":"jeton-de-test"}\n'
const tick = () => new Promise(resolve => setTimeout(resolve, 30))

/** Branche ce que le moteur ferait sous le mod : serveur simulé, enregistrement des agents, réseau. */
function engine(on: any, posted: any[], registered: string[], commands: string[] = [], failFetch = false) {
  on('agent.register', (_: unknown, e: any) => {
    registered.push(e.name)
    return { value: { agent: `agent-troupe:${e.name}` } }
  })
  on('command.register', (_: unknown, e: any) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: READY }
    await new Promise(resolve => setTimeout(resolve, 1000))
    return { code: 0 }
  })
  on('http.fetch', (_: unknown, e: any) => {
    if (failFetch) throw new Error('connexion refusée')
    posted.push({ url: e.url, headers: e.init?.headers ?? {}, body: JSON.parse(e.init?.body ?? 'null') })
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
}

test('au démarrage : un type d\'agent par rôle, la commande /troupe et l\'équipe envoyée au serveur', async ($, on) => {
  const posted: any[] = []
  const registered: string[] = []
  const commands: string[] = []
  engine(on, posted, registered, commands)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await tick()

  expect(registered).toEqual(['po', 'ba', 'it-owner', 'tech-lead', 'developpeur', 'reviewer', 'qa'])
  expect(commands).toEqual(['troupe'])
  const team = posted.find(p => p.body.type === 'team')
  expect(team.url).toBe('http://127.0.0.1:4567/event')
  expect(team.headers['x-troupe-token']).toBe('jeton-de-test')
  expect(team.body.roles.map((r: any) => r.id)).toHaveLength(7)
  // La page ne reçoit jamais le prompt d'un rôle.
  expect(JSON.stringify(team.body)).not.toContain('Tu es le')
})

test('un sous-agent de type agent-troupe:qa arrive au poste QA, sans son prompt', async ($, on) => {
  const posted: any[] = []
  engine(on, posted, [])
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'agent-1' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'SECRET : ne jamais afficher ce prompt', description: 'Tester le panier', subagentType: 'agent-troupe:qa', name: 'qa' })
  await tick()

  const started = posted.find(p => p.body.type === 'agent.start')
  expect(started.body).toMatchObject({ id: 'agent-1', roleId: 'qa', name: 'qa', task: 'Tester le panier' })
  expect(JSON.stringify(posted)).not.toContain('SECRET')
})

test('un appel d\'outil n\'envoie que le nom de l\'outil, jamais ses arguments', async ($, on) => {
  const posted: any[] = []
  engine(on, posted, [])
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'echo mot-de-passe-secret' })
  await tick()

  const tools = posted.filter(p => p.body.type === 'lead' && p.body.tool).map(p => p.body.tool)
  expect(tools).toContain('Bash')
  expect(JSON.stringify(posted)).not.toContain('mot-de-passe-secret')
})

test('un message entre agents est tronqué à 140 caractères par défaut', async ($, on) => {
  const posted: any[] = []
  engine(on, posted, [])
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.send', () => ({ isDelivered: true }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.send({ to: 'qa', text: 'x'.repeat(500) })
  await tick()

  const message = posted.find(p => p.body.type === 'message')
  expect(message.body.toName).toBe('qa')
  expect(message.body.text.length).toBe(140)
})

test('avec messageText = none, le texte des messages n\'est jamais envoyé', { options: { messageText: 'none' } }, async ($, on) => {
  const posted: any[] = []
  engine(on, posted, [])
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.send', () => ({ isDelivered: true }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.send({ to: 'qa', text: 'texte confidentiel' })
  await tick()

  const message = posted.find(p => p.body.type === 'message')
  expect(message.body.text).toBe('')
  expect(JSON.stringify(posted)).not.toContain('confidentiel')
})

test('un serveur qui ne répond plus ne gêne jamais la session', async ($, on) => {
  const registered: string[] = []
  engine(on, [], registered, [], true)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { ok: true } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Read', file_path: '/x' })
  await tick()

  expect(ran).toBeDefined()
  expect(registered.length).toBeGreaterThan(0)
})

test('/troupe donne l\'adresse de la page et une phrase de lancement par rôle', async ($, on) => {
  engine(on, [], [])
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await tick()
  const out = await $.command.run({ command: 'troupe', args: '' })

  expect(out.text).toContain('http://127.0.0.1:4567/?t=jeton-de-test')
  expect(out.text).toContain('agent-troupe:developpeur')
  expect(out.text).toContain('agent-troupe:ba')
})

test('le modèle custom enregistre seulement les rôles connus et affiche les autres', { options: { template: 'custom', roles: 'QA: recette; Architecte: archi' } }, async ($, on) => {
  const posted: any[] = []
  const registered: string[] = []
  engine(on, posted, registered)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await tick()

  expect(registered).toEqual(['qa'])
  const team = posted.find(p => p.body.type === 'team')
  expect(team.body.roles.map((r: any) => r.label)).toEqual(['QA', 'Architecte'])
})

test('un rôle anglais utilise les textes anglais', { options: { language: 'en', template: 'livraison' } }, async ($, on) => {
  const posted: any[] = []
  engine(on, posted, [])
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await tick()

  const team = posted.find(p => p.body.type === 'team')
  expect(team.body.label).toBe('Delivery')
  expect(team.body.roles.map((r: any) => r.label)).toEqual(['Tech Lead', 'Developer', 'Reviewer'])
})
