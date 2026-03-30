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

// ── Generate entity pages ─────────────────────────────────────────
const index = {};

for (const [alias, className] of Object.entries(aliases)) {
  let typePath;
  try { typePath = resolveTypePath(alias); } catch { continue; }

  const Builder = registry.get(className);
  const clearance = clearanceData[className]?.boxes || null;

  // Ports from PORT_LAYOUT or virtual (spline/lift)
  let ports = null;
  let portsVirtual = false;
  if (Builder?.PORT_LAYOUT) {
    ports = Object.entries(Builder.PORT_LAYOUT).map(([name, p]) => ({
      name,
      offset: p.offset,
      dir: p.dir,
      flow: p.flow,
      type: p.type,
    }));
  } else if (Builder?.getPorts && Builder.getPorts !== require('../lib/shared/Builder').getPorts) {
    // Builder has a custom getPorts override (spline or lift) — ports are virtual
    portsVirtual = true;
  }

  // Build summary for index
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
  const summary = portCounts.length > 0
    ? `${portCounts.join(', ')} — ${dims}`
    : `${dims}`;

  const page = {
    alias,
    className,
    typePath,
    clearance,
    ports: portsVirtual ? 'virtual' : ports,
    snapBehavior: Builder?.SNAP_BEHAVIOR || 'Position fixe.',
  };
  if (portsVirtual) {
    page.portsDescription = 'Ports virtuels calculés depuis les données d\'instance (spline ou mTopTransform). Utiliser GET /api/game/entity/:index pour obtenir les positions world-space.';
  }

  // Write page
  fs.writeFileSync(
    path.join(WIKI_DIR, `${alias}.json`),
    JSON.stringify(page, null, 2) + '\n'
  );
  index[alias] = summary;
}

// ── System pages ──────────────────────────────────────────────────

// _general
const general = {
  description: 'Règles générales de positionnement et connexion des entités',
  rules: [
    'Les offsets et directions des ports sont en espace local de l\'entité',
    'Les rotations se font uniquement autour de l\'axe Z (yaw)',
    'La rotation Z transforme les offsets et directions des ports dans le plan XY, le Z ne change jamais',
    'La clearance box suit la rotation de l\'entité',
    'Deux ports connectés doivent être en opposition (dot product des directions < 0)',
    'Un port belt ne peut se connecter qu\'à un port belt, un port pipe qu\'à un port pipe',
    'Un port input se connecte à un port output (pas input↔input ni output↔output)',
    'Les connexions sont bidirectionnelles (si A→B alors B→A)',
    'Les positions des ports power n\'ont pas de direction (null) — seul le câblage compte',
    'Unités : 100 UU = 1 mètre. Une fondation 8m = 800 UU',
  ],
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
      add: 'id (ref locale pour connections), type (alias wiki), position {x,y,z} relative anchor, rotation (yaw degrés, optionnel), properties (optionnel)',
      update: 'index (dans items[]), position/rotation/properties à modifier',
      delete: 'index + deleted:true',
    },
    connections: {
      format: 'from/to au format "id:portName". Le portName doit correspondre à un port du wiki de l\'entité.',
      belt: 'Ajouter belt:tier (1-6) pour auto-créer un belt entre les deux ports au lieu d\'une connexion directe.',
    },
  },
  behavior: {
    positions: 'Les positions des entités sont relatives à l\'anchor. La rotation globale tourne les positions dans le plan XY autour de l\'anchor.',
    rotations: 'Rotation individuelle composée avec la rotation globale. Toujours autour de Z.',
    connections_attach: 'Sans belt: appelle attach() qui snap + wire les ports. Peut repositionner l\'entité (ex: lift se déplace pour aligner son port).',
    connections_belt: 'Avec belt:tier: crée automatiquement un belt entre les deux ports avec spline auto-générée.',
    rollback: 'Si une connexion échoue, toutes les entités ajoutées sont supprimées (rollback atomique).',
    delete: 'Soft delete : le slot items[index] devient null, les indices restent stables.',
    no_save_required: 'Fonctionne sans save chargée (crée un état minimal en mémoire).',
  },
  limitations: {
    no_belt_split: 'Insérer un splitter/merger sur un belt existant (couper le belt en deux) n\'est pas supporté via l\'API edit.',
    lift_cardinal_only: 'Les lifts se snappent uniquement en directions cardinales (±X, ±Y).',
  },
  examples: {
    create_2_stacked_constructors: {
      anchor: { fromCamera: 5000 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 0, y: 0, z: 800 } },
      ],
    },
    connect_splitter_to_constructor_with_belt: {
      anchor: { fromCamera: 5000 },
      entities: [
        { id: 's1', type: 'splitter', position: { x: 0, y: 0, z: 0 } },
        { id: 'c1', type: 'constructor', position: { x: 200, y: 0, z: 0 } },
      ],
      connections: [
        { from: 's1:Output1', to: 'c1:Input0', belt: 6 },
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
