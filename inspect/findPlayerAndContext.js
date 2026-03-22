const path = require('path');
const { Parser } = require('@etothepii/satisfactory-file-parser');
const { readFileAsArrayBuffer, Vector3D } = require('../satisfactoryLib');

const GAME_SAVES = path.join(process.env.LOCALAPPDATA, 'FactoryGame/Saved/SaveGames/76561198036887614');
const INPUT_SAV = `${GAME_SAVES}/TEST.sav`;

const buf  = readFileAsArrayBuffer(INPUT_SAV);
const save = Parser.ParseSave('TEST.sav', buf);

const allObjects = Object.values(save.levels).flatMap(l => l.objects);
console.log(`Total objects: ${allObjects.length}`);

// 1. Find player position
const playerEntity = allObjects.find(o =>
  o.typePath?.includes('Char_Player') && o.transform?.translation
);
if (!playerEntity) {
  console.log('Player not found via Char_Player, trying BP_PlayerState...');
  const ps = allObjects.find(o => o.typePath?.includes('BP_PlayerState'));
  console.log('PlayerState:', ps?.typePath);
} else {
  const p = playerEntity.transform.translation;
  console.log(`\nPlayer position: (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`);
  console.log(`Player rotation:`, JSON.stringify(playerEntity.transform.rotation));

  // 2. Find map markers nearby
  const mapMgr = allObjects.find(o => o.typePath?.includes('FGMapManager'));
  if (mapMgr) {
    const markers = mapMgr.properties.mMapMarkers?.values || [];
    console.log(`\n=== Map Markers (${markers.length} total) ===`);
    const playerPos = new Vector3D(p);
    for (const m of markers) {
      const props = m.value?.properties || {};
      const loc   = props.Location?.value?.properties;
      if (!loc) continue;
      const name  = props.Name?.value || '';
      const icon  = props.IconID?.value;
      const x = loc.X.value, y = loc.Y.value, z = loc.Z.value;
      const dist = new Vector3D(x, y, z).sub(playerPos).length / 100;
      console.log(`  ${dist.toFixed(0)}m - (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}) icon=${icon} "${name}"`);
    }
  }

  // 3. Find nearby buildings (within 100m)
  const RADIUS = 100 * 100;
  const playerPos = new Vector3D(p);
  const nearby = allObjects.filter(o => {
    if (!o.transform?.translation || !o.typePath?.includes('Build_')) return false;
    return new Vector3D(o.transform.translation).sub(playerPos).length <= RADIUS;
  });

  const typeCounts = {};
  for (const o of nearby) {
    const shortType = o.typePath.split('.').pop();
    typeCounts[shortType] = (typeCounts[shortType] || 0) + 1;
  }
  console.log(`\n=== Nearby buildings (within 100m): ${nearby.length} ===`);
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // 4. Find nearby foundations (lightweight)
  const lwSub = allObjects.find(o => o.typePath?.includes('LightweightBuildable'));
  if (lwSub && lwSub.specialProperties?.buildables) {
    let nearbyFoundations = 0;
    const fTypes = {};
    for (const b of lwSub.specialProperties.buildables) {
      const typeName = b.typeReference.pathName.split('.').pop();
      for (const inst of b.instances) {
        const pos = inst.transform.translation;
        const dist = new Vector3D(pos).sub(playerPos).length;
        if (dist <= RADIUS) {
          nearbyFoundations++;
          fTypes[typeName] = (fTypes[typeName] || 0) + 1;
        }
      }
    }
    console.log(`\n=== Nearby lightweight buildables (within 100m): ${nearbyFoundations} ===`);
    for (const [type, count] of Object.entries(fTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
  }

  // 5. Find nearby resource nodes from mapData
  const mapData = require('../data/mapObjects.json');
  function findMarkers(obj, depth = 0) {
    if (depth > 5) return [];
    if (obj.markers) return obj.markers;
    if (obj.options) return obj.options.flatMap(o => findMarkers(o, depth + 1));
    return [];
  }
  const resTab = mapData.options.find(t => t.tabId === 'resource_nodes');
  const allNodes = findMarkers(resTab);
  const nearbyNodes = allNodes.filter(n => {
    const dist = new Vector3D(n.x, n.y, n.z).sub(playerPos).length / 100;
    return dist <= 500; // 500m radius
  }).map(n => ({
    ...n,
    dist: (new Vector3D(n.x, n.y, n.z).sub(playerPos).length / 100).toFixed(0)
  })).sort((a, b) => a.dist - b.dist);

  console.log(`\n=== Resource nodes within 500m: ${nearbyNodes.length} ===`);
  for (const n of nearbyNodes) {
    const type = n.type.replace('Desc_', '').replace('_C', '');
    console.log(`  ${n.dist}m - ${type} (${n.purity}) at (${Math.round(n.x)}, ${Math.round(n.y)}, ${Math.round(n.z)})`);
  }
}