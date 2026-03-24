# Satisfactory Toolkit

Node.js toolkit for Satisfactory 1.0 save editing, blueprint manipulation, logistics optimization, and 3D visualization.

## Features

- **3D Entity Viewer** - Three.js browser-based viewer for saves, blueprints, and CBP files
- **Save Editing** - Programmatic building creation (belts, pipes, producers, foundations, railways...)
- **Blueprint System** - Export/import blueprints, place them interactively in the viewer
- **Sink Points Optimizer** - LP solver (HiGHS) to maximize sink points/min with power/resource constraints
- **Port Visualization** - See belt/pipe connection points, directions, and connection state
- **Entity Operations** - Select, inspect, delete, and export entities from the viewer

## Quick Start

```bash
# Install dependencies
npm install

# Launch the 3D viewer
node viewer/server.js
# Open http://localhost:3000
```

Drop a `.sav`, `.cbp`, or `.sbp` file into the viewer to visualize it.

## 3D Entity Viewer

### Controls

| Action | Control |
|--------|---------|
| Rotate camera | Left click + drag |
| Inspect entity | Left click |
| Select entity | Ctrl + click |
| Box select | Shift + drag |
| Pan | Right click + drag |
| Close properties | Right click |
| Zoom | Mouse wheel |

### Blueprint Placement

Load a `.sbp` file to enter placement mode:

| Key | Action |
|-----|--------|
| Q / D | Move X |
| Z / S | Move Y |
| R / F | Move Z |
| A / E | Rotate |
| Enter | Inject into save |
| Escape | Cancel |

Hold **Shift** for fine movement (10u / 1deg), **Ctrl** for grid snap (800u / 90deg).

### Menus

- **File** - Open, Refresh, Merge CBP, Download Save
- **Layers** - Toggle categories, terrain, grid, ports, CBP
- **Camera** - Zoom/Pan/Rot sensitivity, grid spacing, GridBox alignment

### Panels

- **Properties (left)** - Entity details, ports, Copy JSON, GridBox toggle
- **Selection (right)** - Export Blueprint, Delete, Clear, grouped class list

## Project Structure

```
satisfactory-toolkit/
+-- satisfactoryLib.js          # Core library (entity/component creators, spline, wiring)
+-- data/
|   +-- clearanceData.json      # Bounding boxes for 495 buildings
|   +-- gameData.json           # Items, recipes, buildings
|   +-- mapObjects.json         # Resource nodes, wells, slugs positions
|   +-- resourceConfig.json     # Miner/extractor config for LP solver
+-- lib/
|   +-- shared/                 # Vector3D, Quaternion, Transform, FlowPort
|   +-- extractors/             # Miner, WaterExtractor, OilPump, Fracking
|   +-- logistic/               # ConveyorBelt/Pole/Merger, Pipe/Support/Junction
|   +-- producers/              # Constructor, Smelter, Manufacturer, etc.
|   +-- railway/                # BeltStation, TrainStation, Locomotive
|   +-- structural/             # Foundation (lightweight buildables)
|   +-- Blueprint.js            # Blueprint composite (create + fromFile)
|   +-- Registry.js             # TypePath -> Builder mapping
+-- viewer/
|   +-- server.js               # Express routes
|   +-- lib/                    # Server modules (spline, entityData, saveLoader, merge)
|   +-- public/                 # Client (Three.js, ES modules)
+-- tools/                      # Editing & optimization scripts
+-- inspect/                    # Save exploration scripts
+-- test/                       # Tests
```

## Save Editing

Scripts use `@etothepii/satisfactory-file-parser` to manipulate save files. The shared library is `satisfactoryLib.js`.

```js
const { initSession, makeEntity, ref, FlowPort } = require('./satisfactoryLib');
const Smelter = require('./lib/producers/Smelter');
const ConveyorBelt = require('./lib/logistic/ConveyorBelt');

const sessionId = initSession();

// Create a smelter
const smelter = Smelter.create(x, y, z, rotation);

// Create a belt connecting two ports
const belt = ConveyorBelt.create(startPort, endPort, 3); // tier 3
```

Always save to a `_edit` suffixed file, never overwrite the original.

## Sink Points Optimization

```bash
node tools/analyzeSinkPoints.js
```

LP solver maximizing sink points/min with power and resource constraints. Outputs `.xlsx` spreadsheet and `.graphml` graph (for yEd).

See [SINK_OPTIMIZATION.md](SINK_OPTIMIZATION.md) for details.

## Tech Stack

- **Runtime**: Node.js
- **Save Parser**: [@etothepii/satisfactory-file-parser](https://github.com/etothepii/satisfactory-file-parser)
- **3D Rendering**: [Three.js](https://threejs.org/) (via CDN)
- **Icons**: [Lucide](https://lucide.dev/) (via CDN)
- **LP Solver**: [HiGHS](https://highs.dev/) (for sink optimization)
- **Server**: Express

## License

Private project.