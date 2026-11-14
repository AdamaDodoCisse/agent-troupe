// Les personnages : du SVG en texte, sans image externe. Les poses viennent du CSS (style.css),
// qui lit l'attribut data-state du poste : le dessin n'est donc jamais recréé et l'animation ne saute pas.

const SKINS = ['#f2c9a5', '#d9a07a', '#a96f4b', '#7a4a32', '#f6d7b8']
const HAIRS = ['#2b2118', '#6b3f1d', '#c9a227', '#1f2937', '#8a8d91']

function hash(text) {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

const ACCESSORIES = {
  // Pile de post-it : le backlog du PO.
  backlog: `
    <g class="acc acc-backlog" transform="translate(70 94)">
      <rect class="note n1" x="0" y="8" width="20" height="20" rx="2" fill="#fde68a" stroke="#1f2a2e" stroke-width="1.4" transform="rotate(-6 10 18)"/>
      <rect class="note n2" x="6" y="4" width="20" height="20" rx="2" fill="#fbcfe8" stroke="#1f2a2e" stroke-width="1.4" transform="rotate(5 16 14)"/>
      <rect class="note n3" x="10" y="0" width="20" height="20" rx="2" fill="#bbf7d0" stroke="#1f2a2e" stroke-width="1.4"/>
      <path d="M14 7h12M14 12h9" stroke="#1f2a2e" stroke-width="1.4" stroke-linecap="round"/>
    </g>`,
  // Petit schéma de flux : l'analyste métier.
  flow: `
    <g class="acc acc-flow" transform="translate(68 92)" stroke="#1f2a2e" stroke-width="1.5" fill="#fff8e1">
      <rect class="node a" x="0" y="0" width="14" height="9" rx="2"/>
      <path class="edge" d="M7 9v6" fill="none"/>
      <path class="node b" d="M7 15l9 7-9 7-9-7z" transform="translate(7 0)"/>
      <path class="edge" d="M23 22h8" fill="none"/>
      <rect class="node c" x="31" y="17" width="14" height="9" rx="2"/>
    </g>`,
  // Écran de pilotage : l'IT Owner.
  dashboard: `
    <g class="acc acc-dashboard" transform="translate(68 88)">
      <rect x="0" y="0" width="36" height="26" rx="3" fill="#0f172a" stroke="#1f2a2e" stroke-width="1.5"/>
      <rect class="bar b1" x="5" y="14" width="5" height="8" fill="#34d399"/>
      <rect class="bar b2" x="13" y="9" width="5" height="13" fill="#fbbf24"/>
      <rect class="bar b3" x="21" y="12" width="5" height="10" fill="#34d399"/>
      <circle class="led" cx="31" cy="5" r="2" fill="#34d399"/>
      <path d="M18 26v5M12 31h12" stroke="#1f2a2e" stroke-width="2" stroke-linecap="round"/>
    </g>`,
  // Schéma d'architecture : le Tech Lead.
  diagram: `
    <g class="acc acc-diagram" transform="translate(66 90)" stroke="#1f2a2e" stroke-width="1.5" fill="#dbeafe">
      <rect class="box a" x="0" y="0" width="16" height="10" rx="2"/>
      <rect class="box b" x="24" y="0" width="16" height="10" rx="2"/>
      <rect class="box c" x="12" y="20" width="16" height="10" rx="2"/>
      <path class="edge" d="M16 5h8M8 10l8 10M32 10l-8 10" fill="none"/>
    </g>`,
  // Ordinateur portable : le développeur.
  laptop: `
    <g class="acc acc-laptop" transform="translate(66 92)">
      <rect x="3" y="0" width="34" height="22" rx="3" fill="#0f172a" stroke="#1f2a2e" stroke-width="1.5"/>
      <path class="code c1" d="M8 6h14" stroke="#4ade80" stroke-width="2" stroke-linecap="round"/>
      <path class="code c2" d="M8 11h22" stroke="#93c5fd" stroke-width="2" stroke-linecap="round"/>
      <path class="code c3" d="M8 16h10" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/>
      <path d="M0 24h40l-3 5H3z" fill="#cbd5e1" stroke="#1f2a2e" stroke-width="1.5" stroke-linejoin="round"/>
    </g>`,
  // Loupe : le reviewer.
  magnifier: `
    <g class="acc acc-magnifier" transform="translate(74 90)">
      <g class="lens">
        <circle cx="12" cy="12" r="10" fill="#f3e8ff" fill-opacity=".7" stroke="#1f2a2e" stroke-width="2"/>
        <path d="M19 19l11 11" stroke="#1f2a2e" stroke-width="4" stroke-linecap="round"/>
        <path d="M7 9a7 7 0 0 1 6-3" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/>
      </g>
    </g>`,
  // Presse-papier à cocher : le testeur.
  checklist: `
    <g class="acc acc-checklist" transform="translate(70 88)">
      <rect x="0" y="0" width="26" height="32" rx="3" fill="#fff" stroke="#1f2a2e" stroke-width="1.5"/>
      <rect x="8" y="-3" width="10" height="6" rx="2" fill="#94a3b8" stroke="#1f2a2e" stroke-width="1.2"/>
      <path d="M5 11h5M5 18h5M5 25h5" stroke="#1f2a2e" stroke-width="1.5" stroke-linecap="round"/>
      <path class="tick t1" d="M12 11h9" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
      <path class="tick t2" d="M12 18h9" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
      <path class="tick t3" d="M12 25h9" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
    </g>`,
  // Badge : rôle personnalisé.
  badge: `
    <g class="acc acc-badge" transform="translate(76 92)">
      <path d="M14 0l4 9 10 1-7.5 6.500 2.500 10L14 21l-9 5.500 2.500-10L0 10l10-1z" fill="#fde68a" stroke="#1f2a2e" stroke-width="1.5" stroke-linejoin="round"/>
    </g>`,
}

const FACES = `
  <g class="face">
    <g class="eyes">
      <ellipse class="eye eye-l" cx="51" cy="40" rx="2.800" ry="3.200" fill="#1f2a2e"/>
      <ellipse class="eye eye-r" cx="69" cy="40" rx="2.800" ry="3.200" fill="#1f2a2e"/>
    </g>
    <g class="eyes-happy"><path d="M47.500 41q3.500-5 7 0M65.500 41q3.500-5 7 0" stroke="#1f2a2e" stroke-width="2.200" fill="none" stroke-linecap="round"/></g>
    <g class="eyes-failed"><path d="M47.500 37l7 7M54.500 37l-7 7M65.500 37l7 7M72.500 37l-7 7" stroke="#1f2a2e" stroke-width="2.200" stroke-linecap="round"/></g>
    <path class="mouth mouth-idle" d="M54 51q6 3.500 12 0" stroke="#1f2a2e" stroke-width="2.200" fill="none" stroke-linecap="round"/>
    <ellipse class="mouth mouth-work" cx="60" cy="52" rx="3.500" ry="2.500" fill="#1f2a2e"/>
    <path class="mouth mouth-happy" d="M52 50q8 10 16 0z" fill="#1f2a2e"/>
    <path class="mouth mouth-sad" d="M54 54q6-5 12 0" stroke="#1f2a2e" stroke-width="2.200" fill="none" stroke-linecap="round"/>
  </g>`

function hairFor(style, color) {
  if (style === 0) return `<path d="M38 38c0-17 10-24 22-24s22 7 22 24c-5-9-12-12-22-12s-17 3-22 12z" fill="${color}"/>`
  if (style === 1) return `<circle cx="60" cy="12" r="9" fill="${color}"/><path d="M38 38c0-16 10-22 22-22s22 6 22 22c-6-8-12-10-22-10s-16 2-22 10z" fill="${color}"/>`
  return `<path d="M36 44c-2-22 8-32 24-32s26 10 24 32c-2-8-4-14-6-16-6 2-12 3-18 3s-12-1-18-3c-2 2-4 8-6 16z" fill="${color}"/>`
}

/** Le personnage d'un rôle. `role` : { id, color, accessory }. */
export function characterSVG(role) {
  const h = hash(role.id)
  const skin = SKINS[h % SKINS.length]
  const hair = HAIRS[(h >>> 3) % HAIRS.length]
  const style = (h >>> 6) % 3
  const accessory = ACCESSORIES[role.accessory] ?? ACCESSORIES.badge
  return `
<svg class="char" viewBox="0 0 120 150" aria-hidden="true" focusable="false">
  <ellipse class="shadow" cx="60" cy="141" rx="34" ry="5" fill="#1f2a2e" opacity=".14"/>
  <g class="figure">
    <g class="legs"><rect x="47" y="108" width="10" height="28" rx="4" fill="#334155"/><rect x="63" y="108" width="10" height="28" rx="4" fill="#334155"/></g>
    <g class="arm arm-l"><path d="M42 70q-12 14-10 30" stroke="${role.color}" stroke-width="11" stroke-linecap="round" fill="none"/><circle cx="32" cy="101" r="5.500" fill="${skin}"/></g>
    <rect class="torso" x="38" y="62" width="44" height="52" rx="14" fill="${role.color}"/>
    <path class="collar" d="M52 62l8 9 8-9" fill="#fff" fill-opacity=".85"/>
    <g class="arm arm-r"><path d="M78 70q12 14 10 30" stroke="${role.color}" stroke-width="11" stroke-linecap="round" fill="none"/><circle cx="88" cy="101" r="5.500" fill="${skin}"/></g>
    <g class="head">
      <circle cx="60" cy="40" r="22" fill="${skin}"/>
      ${hairFor(style, hair)}
      ${FACES}
    </g>
  </g>
  ${accessory}
</svg>`
}

/** Claude, le chef d'orchestre : un petit personnage rond au pinceau-baguette, qui dort quand il attend. */
export function conductorSVG() {
  return `
<svg class="char char-lead" viewBox="0 0 120 150" aria-hidden="true" focusable="false">
  <ellipse class="shadow" cx="60" cy="141" rx="34" ry="5" fill="#1f2a2e" opacity=".14"/>
  <g class="figure">
    <g class="legs lead-leg"><rect x="47" y="112" width="10" height="24" rx="4"/><rect x="63" y="112" width="10" height="24" rx="4"/></g>
    <g class="arm arm-l"><path d="M42 72q-12 12-12 28" stroke="#d97757" stroke-width="11" stroke-linecap="round" fill="none"/><circle cx="30" cy="101" r="5.500" fill="#f6d7b8"/></g>
    <path class="torso" d="M36 70c0-8 10-12 24-12s24 4 24 12v40c0 4-4 6-8 6H44c-4 0-8-2-8-6z" fill="#d97757"/>
    <g class="arm arm-r baton"><path d="M78 72q12 12 12 28" stroke="#d97757" stroke-width="11" stroke-linecap="round" fill="none"/><circle cx="90" cy="101" r="5.500" fill="#f6d7b8"/><path class="stick lead-ink" d="M90 101l16-26" stroke-width="3" stroke-linecap="round"/></g>
    <g class="head">
      <path d="M60 14l5 8h-10z" fill="#d97757"/><path class="lead-ink" d="M60 8v8" stroke-width="2.500" stroke-linecap="round"/><circle cx="60" cy="7" r="3.500" fill="#d97757" class="antenna"/>
      <circle cx="60" cy="40" r="23" fill="#fff8f0" stroke="#1f2a2e" stroke-width="2.500"/>
      ${FACES}
    </g>
  </g>
  <g class="zzz" fill="#1f2a2e" font-family="system-ui,sans-serif" font-weight="700"><text x="88" y="24" font-size="14">z</text><text x="98" y="14" font-size="11">z</text><text x="106" y="6" font-size="9">z</text></g>
</svg>`
}

/** L'enveloppe qui voyage entre deux postes. */
export function envelopeSVG() {
  return `<svg viewBox="0 0 32 24" width="32" height="24" aria-hidden="true" focusable="false"><rect x="1.500" y="2.500" width="29" height="19" rx="3" fill="#fffdf7" stroke="#1f2a2e" stroke-width="2"/><path d="M3 5l13 9 13-9" fill="none" stroke="#1f2a2e" stroke-width="2" stroke-linejoin="round"/></svg>`
}
