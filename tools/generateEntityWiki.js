/**
 * Generate entity wiki JSON files in data/wiki/ from:
 * - viewer/lib/typeAliases.js (alias → className mapping)
 * - lib/Registry.js (PORT_LAYOUT per Builder)
 * - data/clearanceData.json (bounding boxes)
 *
 * Usage: node tools/generateEntityWiki.js
 */

const path = require('path');
const fs = require('fs');
const { getAliases, resolveTypePath } = require('../viewer/lib/typeAliases');
const Registry = require('../lib/Registry');
const clearanceData = require('../data/clearanceData.json');

const WIKI_DIR = path.join(__dirname, '..', 'data', 'wiki');
const registry = Registry.default();
const aliases = getAliases();

// ── Group tiered aliases (belt-1..belt-6 → belt, lift-1..lift-6 → lift, etc.) ──
// Detect pattern: base alias "foo" with tiered aliases "foo-N"
const tieredGroups = {}; // baseName → [{alias, tier, className, typePath}]
const standalone = [];   // aliases that are not part of a tiered group

for (const [alias, className] of Object.entries(aliases)) {
  let typePath;
  try { typePath = resolveTypePath(alias); } catch { continue; }
  const match = alias.match(/^(.+)-(\d+)$/);
  if (match) {
    const [, baseName, tier] = match;
    if (!tieredGroups[baseName]) tieredGroups[baseName] = [];
    tieredGroups[baseName].push({ alias, tier: Number(tier), className, typePath });
  } else {
    // Check if this is the default alias for a tiered group (e.g. "belt" = "belt-6")
    const hasNumbered = Object.keys(aliases).some(a => a.startsWith(alias + '-'));
    if (hasNumbered) {
      // Skip — will be included as "default" in the tiered group
    } else {
      standalone.push({ alias, className, typePath });
    }
  }
}

// ── Helper: build page data for a className ──────────────────────
function buildPageData(className) {
  const Builder = registry.get(className);
  const clearance = clearanceData[className]?.boxes || null;

  let ports = null;
  let portsVirtual = false;
  if (Builder?.PORT_LAYOUT) {
    ports = Object.entries(Builder.PORT_LAYOUT).map(([name, p]) => ({
      name, offset: p.offset, dir: p.dir, flow: p.flow, type: p.type,
    }));
  } else if (Builder?.getPorts && Builder.getPorts !== require('../lib/shared/Builder').getPorts) {
    portsVirtual = true;
  }

  const dims = clearance?.[0]
    ? `${Math.round(clearance[0].max.x - clearance[0].min.x)}x${Math.round(clearance[0].max.y - clearance[0].min.y)}x${Math.round(clearance[0].max.z - clearance[0].min.z)}`
    : '?';
  const portCounts = [];
  if (portsVirtual) {
    portCounts.push('virtual');
  } else if (ports) {
    const belts = ports.filter(p => p.type === 'belt').length;
    const pipes = ports.filter(p => p.type === 'pipe').length;
    const power = ports.filter(p => p.type === 'power').length;
    if (belts) portCounts.push(`${belts} belt`);
    if (pipes) portCounts.push(`${pipes} pipe`);
    if (power) portCounts.push(`${power} power`);
  }
  const summary = portCounts.length > 0 ? `${portCounts.join(', ')} — ${dims}` : `${dims}`;

  return { Builder, clearance, ports, portsVirtual, summary };
}

function addVirtualPortInfo(page, className, Builder) {
  if (Builder?.Ports) {
    page.portNames = Object.entries(Builder.Ports).map(([, name]) => name);
    page.portsDescription = 'Ports virtuels calculés depuis les données d\'instance (spline ou mTopTransform). Utiliser GET /api/game/entity/:index pour obtenir les positions world-space.';
    if (className.includes('ConveyorLift')) {
      page.portType = 'belt';
      page.polarization = {
        description: 'Les ports bottom/top sont bidirectionnels à la création (flowType = null). La première connexion à un port polarisé fixe la direction du flux.',
        rules: [
          'Connecté à un Output (ou ConveyorAny1) → ce port devient INPUT, l\'autre OUTPUT',
          'Connecté à un Input (ou ConveyorAny0) → ce port devient OUTPUT, l\'autre INPUT',
          'Deux lifts top↔top ne peuvent se connecter que si leurs polarités sont opposées',
        ],
      };
    }
  }
}

// ── Generate entity pages ─────────────────────────────────────────
const index = {};

// Standalone aliases (no tiers)
for (const { alias, className, typePath } of standalone) {
  const { Builder, clearance, ports, portsVirtual, summary } = buildPageData(className);
  const page = {
    alias, className, typePath, clearance,
    ports: portsVirtual ? 'virtual' : ports,
    snapBehavior: Builder?.SNAP_BEHAVIOR || 'Position fixe.',
  };
  if (portsVirtual) addVirtualPortInfo(page, className, Builder);
  fs.writeFileSync(path.join(WIKI_DIR, `${alias}.json`), JSON.stringify(page, null, 2) + '\n');
  index[alias] = summary;
}

// Tiered groups → one page per group
for (const [baseName, tiers] of Object.entries(tieredGroups)) {
  tiers.sort((a, b) => a.tier - b.tier);
  // Use the highest tier for ports/clearance (they're all the same)
  const representative = tiers[tiers.length - 1];
  const { Builder, clearance, ports, portsVirtual, summary } = buildPageData(representative.className);
  // Find default alias if it exists (e.g. "belt" → "belt-6")
  const defaultAlias = aliases[baseName];
  const defaultTier = defaultAlias ? tiers.find(t => t.className === defaultAlias)?.tier : null;
  const page = {
    alias: baseName,
    tiers: tiers.map(t => ({
      tier: t.tier,
      alias: t.alias,
      className: t.className,
      typePath: t.typePath,
      ...(t.tier === defaultTier ? { default: true } : {}),
    })),
    clearance,
    ports: portsVirtual ? 'virtual' : ports,
    snapBehavior: Builder?.SNAP_BEHAVIOR || 'Position fixe.',
  };
  if (portsVirtual) addVirtualPortInfo(page, representative.className, Builder);
  fs.writeFileSync(path.join(WIKI_DIR, `${baseName}.json`), JSON.stringify(page, null, 2) + '\n');
  index[baseName] = `${tiers.length} tiers — ${summary}`;
}

// Clean up old per-tier files
for (const [baseName, tiers] of Object.entries(tieredGroups)) {
  for (const t of tiers) {
    const oldFile = path.join(WIKI_DIR, `${t.alias}.json`);
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
  }
}

// ── System pages ──────────────────────────────────────────────────

// _general
const general = {
  description: 'Règles générales de positionnement et connexion des entités',
  rules: [
    'Les offsets et directions des ports sont en espace local de l\'entité',
    'Le positionnement via l\'API edit utilise des rotations Z (yaw). Les entités insérées sur une spline en pente (splitter/merger/pump sur belt/pipe) obtiennent une rotation 3D complète.',
    'La clearance box suit la rotation de l\'entité',
    'Deux ports connectés doivent être en opposition (dot product des directions < 0)',
    'Un port belt ne peut se connecter qu\'à un port belt, un port pipe qu\'à un port pipe',
    'Un port input se connecte à un port output (pas input↔input ni output↔output)',
    'Les connexions sont bidirectionnelles (si A→B alors B→A)',
    'Les positions des ports power n\'ont pas de direction (null) — seul le câblage compte',
    'Unités : 100 UU = 1 mètre. Une fondation 8m = 800 UU',
  ],
  snap: {
    description: 'Règles de snap (repositionnement automatique lors de la connexion)',
    rules: [
      'belt/pipe/lift/track : peuvent snapper sur n\'importe quel port compatible (recalculent leur spline)',
      'splitter/merger (vierges) : snappent uniquement sur endpoints de belt ou lift — pas sur un producer, pole, ou autre entité fixe',
      'junction/pump (vierges) : snappent uniquement sur endpoints de pipe — pas sur un producer ou support',
      'producers/extracteurs : ports fixes, ne peuvent pas snapper — utiliser un belt/pipe/lift entre deux entités fixes',
      'Après sa première connexion, un splitter/merger/junction/pump devient fixe (ne peut plus se repositionner)',
      'attachBelt(belt, position) : insère un splitter/merger au milieu d\'un belt existant — coupe le belt en deux',
      'attachPipe(pipe, position) : insère une junction/pump au milieu d\'un pipe existant — coupe le pipe en deux',
    ],
  },
};
fs.writeFileSync(path.join(WIKI_DIR, '_general.json'), JSON.stringify(general, null, 2) + '\n');
index._general = 'Règles de positionnement, rotation, connexion de ports';

// _edit
const edit = {
  description: 'API POST /api/game/edit — créer, modifier, supprimer des entités et les connecter',
  endpoint: 'POST /api/game/edit',
  request: {
    anchor: 'Position absolue {x,y,z} ou relative caméra {fromCamera: distance_uu}. Toutes les positions d\'entités sont relatives à l\'anchor.',
    rotation: 'Yaw global en degrés (optionnel). Tourne toutes les positions relatives autour de l\'anchor et s\'ajoute aux rotations individuelles.',
    entities: {
      add: '{id, type, position} — crée une entité. id = alias local réutilisable dans connections. type = alias wiki. position relative à l\'anchor.',
      alias: '{id, index} — crée un alias sur une entité existante sans la modifier. Permet de la référencer dans connections.',
      modify: '{index, position?, rotation?, properties?} — modifie une entité existante.',
      delete: '{index, deleted:true} — soft delete (le slot devient null, indices stables).',
    },
    connections: {
      ids: 'IMPORTANT : from, to, on utilisent exclusivement les id déclarés dans entities[]. Pour cibler une entité existante, la déclarer d\'abord comme alias : {id:"belt1", index:42}.',
      direct: '{from:"id:port", to:"id:port"} — connexion directe. Le port "from" snappe sur "to". "from" doit être mobile (belt/pipe/lift ou splitter/merger/junction/pump vierge sur endpoint spline).',
      belt: '{from:"id:port", to:"id:port", belt:tier} — auto-crée un belt (tier 1-6) entre les deux ports. Les deux ports peuvent être fixes.',
      pipe: '{from:"id:port", to:"id:port", pipe:tier} — auto-crée un pipe (tier 1-2) entre les deux ports pipe. Les deux ports peuvent être fixes.',
      insertion: '{from:"id", on:"id", position:{x,y,z}} — insère l\'entité "from" (splitter/merger/junction/pump vierge) sur le belt/pipe "on", coupe la spline en deux. position = point de coupure projeté sur la spline.',
      portNames_fixed: 'Noms de ports des entités fixes : voir la page wiki de chaque entité (ex: Input0, Output0 pour un constructor).',
      portNames_virtual: 'Noms de ports des entités virtuelles : belt=ConveyorAny0(input)/ConveyorAny1(output), pipe=PipelineConnection0/PipelineConnection1, lift=bottom/top (polarisés par la première connexion — voir page wiki lift).',
    },
  },
  snap_rules: [
    'belt/pipe/lift/track : peuvent snapper sur n\'importe quel port compatible',
    'splitter/merger (vierges) : snappent uniquement sur endpoints de belt ou lift',
    'junction/pump (vierges) : snappent uniquement sur endpoints de pipe',
    'producers/extracteurs : ports fixes — utiliser belt:tier ou pipe:tier pour connecter deux entités fixes',
    'Après sa première connexion, un splitter/merger/junction/pump devient fixe',
  ],
  behavior: {
    positions: 'Les positions des entités sont relatives à l\'anchor. La rotation globale tourne les positions dans le plan XY autour de l\'anchor.',
    rotations: 'Rotation individuelle composée avec la rotation globale. Toujours autour de Z.',
    rollback: 'Si une connexion échoue, toutes les entités ajoutées dans ce batch sont supprimées (rollback atomique).',
    no_save_required: 'Fonctionne sans save chargée (crée un état minimal en mémoire).',
  },
  limitations: {
    lift_cardinal_only: 'Les lifts se snappent uniquement en directions cardinales (±X, ±Y).',
  },
  examples: {
    create_2_constructors_with_belt: {
      anchor: { fromCamera: 5000 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 1000, y: 0, z: 0 } },
      ],
      connections: [
        { from: 'c1:Output0', to: 'c2:Input0', belt: 6 },
      ],
    },
    connect_to_existing_entity: {
      description: 'Connecter une nouvelle entité à une entité existante (index 42) via un belt',
      entities: [
        { id: 'existing', index: 42 },
        { id: 'c1', type: 'constructor', position: { x: 1000, y: 0, z: 0 } },
      ],
      connections: [
        { from: 'existing:Output0', to: 'c1:Input0', belt: 6 },
      ],
    },
    insert_splitter_on_belt: {
      description: 'Insérer un splitter au milieu d\'un belt existant (index 42)',
      entities: [
        { id: 'belt1', index: 42 },
        { id: 's1', type: 'splitter' },
      ],
      connections: [
        { from: 's1', on: 'belt1', position: { x: 1000, y: 2000, z: 500 } },
      ],
    },
    insert_junction_on_pipe: {
      description: 'Insérer une junction au milieu d\'un pipe existant (index 55)',
      entities: [
        { id: 'pipe1', index: 55 },
        { id: 'j1', type: 'pipe-junction' },
      ],
      connections: [
        { from: 'j1', on: 'pipe1', position: { x: 2000, y: 500, z: 375 } },
      ],
    },
    delete_entity: {
      entities: [{ index: 42, deleted: true }],
    },
    move_existing_entity: {
      anchor: { x: 1000, y: 2000, z: 500 },
      entities: [{ index: 42, position: { x: 0, y: 0, z: 0 } }],
    },
  },
};
fs.writeFileSync(path.join(WIKI_DIR, '_edit.json'), JSON.stringify(edit, null, 2) + '\n');
index._edit = 'API POST /api/game/edit — créer, modifier, supprimer, connecter';

// _query
const query = {
  description: 'API pour inspecter les entités existantes sur la map',
  endpoints: {
    'GET /api/game/entity/:index': {
      description: 'Retourne le détail d\'une entité existante',
      response: {
        instanceName: 'Nom unique de l\'entité',
        typePath: 'Chemin UE complet du blueprint',
        className: 'Nom court de la classe (ex: Build_ConstructorMk1_C)',
        transform: 'Position {translation: {x,y,z}} et rotation {rotation: {x,y,z,w}}',
        clearance: 'Bounding boxes [{min:{x,y,z}, max:{x,y,z}}] ou null',
        ports: 'Ports world-space [{name, pos, dir, flow, type}] ou null (calculés depuis PORT_LAYOUT ou spline/mTopTransform)',
        splineLength: 'Longueur de la spline en UU (belt, pipe, rail uniquement) ou absent',
        properties: 'Propriétés de l\'entité (recette, inventaire, etc.)',
        components: 'Composants enfants avec leurs propriétés (connexions, etc.)',
      },
    },
    'GET /api/viewer/camera': {
      description: 'Position et orientation de la caméra du viewer',
      response: {
        position: '{x, y, z} en coordonnées Unreal',
        yaw: 'Angle horizontal en degrés',
        pitch: 'Angle vertical en degrés',
      },
    },
  },
};
fs.writeFileSync(path.join(WIKI_DIR, '_query.json'), JSON.stringify(query, null, 2) + '\n');
index._query = 'API GET /api/game/entity/:index — inspecter une entité existante';

// ── Write index (system pages first, then entities sorted) ────────
const sortedIndex = {};
for (const key of ['_general', '_edit', '_query']) {
  sortedIndex[key] = index[key];
}
for (const key of Object.keys(index).filter(k => !k.startsWith('_')).sort()) {
  sortedIndex[key] = index[key];
}
fs.writeFileSync(
  path.join(WIKI_DIR, '_index.json'),
  JSON.stringify({ pages: sortedIndex }, null, 2) + '\n'
);

console.log(`Generated ${Object.keys(index).length} wiki pages in data/wiki/`);
