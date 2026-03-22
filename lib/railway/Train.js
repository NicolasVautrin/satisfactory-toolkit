const {
  ref, makeEntity, nextId, findComp,
} = require('../../satisfactoryLib');

const TYPE_TRAIN     = '/Game/FactoryGame/Buildable/Vehicle/Train/-Shared/BP_Train.BP_Train_C';
const TYPE_TIMETABLE = '/Script/FactoryGame.FGRailroadTimeTable';

class Train {
  /**
   * @param trainEntity    BP_Train entity (logical grouping)
   * @param vehicles       Array of Locomotive/FreightWagon instances, in order
   * @param timeTable      FGRailroadTimeTable entity (or null)
   */
  constructor(trainEntity, vehicles, timeTable) {
    this.entity    = trainEntity;
    this.inst      = trainEntity.instanceName;
    this.vehicles  = vehicles;
    this.timeTable = timeTable;
  }

  allObjects() {
    const objs = [this.entity];
    for (const v of this.vehicles) objs.push(...v.allObjects());
    if (this.timeTable) objs.push(this.timeTable);
    return objs;
  }

  /**
   * Create a train from a list of vehicles (Locomotive/FreightWagon).
   * Links vehicleInFront/vehicleBehind chains and creates the BP_Train entity.
   * @param vehicles   Array of Locomotive/FreightWagon instances (first = front)
   * @param stops      Array of TrainStation instanceNames for the timetable (optional)
   */
  static create(vehicles, stops = []) {
    if (!vehicles || vehicles.length === 0) {
      throw new Error('Train requires at least one vehicle');
    }

    const id = nextId();

    // Link vehicle chain: vehicleInFront / vehicleBehind
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const prev = i > 0 ? vehicles[i - 1] : null;
      const next = i < vehicles.length - 1 ? vehicles[i + 1] : null;

      v.entity.specialProperties = {
        type:           'VehicleSpecialProperties',
        objects:        [],
        vehicleInFront: prev ? ref(prev.inst) : ref('', ''),
        vehicleBehind:  next ? ref(next.inst) : ref('', ''),
      };
    }

    // Create BP_Train entity
    const trainInst = `Persistent_Level:PersistentLevel.BP_Train_C_${id}`;
    const trainEntity = makeEntity(TYPE_TRAIN, trainInst);
    trainEntity.needTransform = false;
    trainEntity.parentObject  = ref('', '');

    trainEntity.properties = {
      mSimulationData: {
        type:    'StructProperty',
        ueType:  'StructProperty',
        name:    'mSimulationData',
        value:   { type: 'TrainSimulationData', properties: {} },
        subtype: 'TrainSimulationData',
      },
      FirstVehicle: {
        type: 'ObjectProperty', ueType: 'ObjectProperty',
        name: 'FirstVehicle', value: ref(vehicles[0].inst),
      },
      LastVehicle: {
        type: 'ObjectProperty', ueType: 'ObjectProperty',
        name: 'LastVehicle', value: ref(vehicles[vehicles.length - 1].inst),
      },
    };

    // Create timetable if stops provided
    let timeTable = null;
    if (stops.length > 0) {
      timeTable = Train._createTimeTable(id, stops);
      trainEntity.properties.TimeTable = {
        type: 'ObjectProperty', ueType: 'ObjectProperty',
        name: 'TimeTable', value: ref(timeTable.instanceName),
      };
    }

    return new Train(trainEntity, vehicles, timeTable);
  }

  /**
   * Add or replace the timetable.
   * @param stationIdentifiers  Array of FGTrainStationIdentifier instanceNames
   */
  setTimeTable(stationIdentifiers) {
    const id = nextId();
    this.timeTable = Train._createTimeTable(id, stationIdentifiers);
    this.entity.properties.TimeTable = {
      type: 'ObjectProperty', ueType: 'ObjectProperty',
      name: 'TimeTable', value: ref(this.timeTable.instanceName),
    };
  }

  static _createTimeTable(id, stationIdentifiers) {
    const ttInst = `Persistent_Level:PersistentLevel.FGRailroadTimeTable_${id}`;
    const tt     = makeEntity(TYPE_TIMETABLE, ttInst);
    tt.needTransform = false;
    tt.parentObject  = ref('', '');

    tt.properties = {
      mStops: {
        type:              'StructArrayProperty',
        ueType:            'ArrayProperty',
        name:              'mStops',
        structValueFields: { allStructType: 'TimeTableStop' },
        subtype:           'StructProperty',
        values:            stationIdentifiers.map(stIdName => ({
          type:    'StructProperty',
          ueType:  'StructProperty',
          name:    '',
          subtype: 'TimeTableStop',
          value:   {
            type:       'TimeTableStop',
            properties: {
              Station: {
                type: 'ObjectProperty', ueType: 'ObjectProperty',
                name: 'Station', value: ref(stIdName),
              },
            },
          },
        })),
      },
      mCurrentStop: {
        type: 'Int32Property', ueType: 'IntProperty',
        name: 'mCurrentStop', value: 0,
      },
    };

    return tt;
  }

  static fromSave(trainEntity, saveObjects) {
    // Build index for fast lookup
    const byName = new Map();
    for (const o of saveObjects) {
      if (o.instanceName) byName.set(o.instanceName, o);
    }

    // Walk the vehicle chain
    const vehicles = [];
    const visited  = new Set();
    const Locomotive   = require('./Locomotive');
    const FreightWagon = require('./FreightWagon');

    let currentRef = trainEntity.properties?.FirstVehicle?.value?.pathName;
    while (currentRef && currentRef !== '') {
      if (visited.has(currentRef)) break;
      visited.add(currentRef);
      const vEntity = byName.get(currentRef);
      if (!vEntity) break;
      if (vEntity.typePath === Locomotive.TYPE_PATH) {
        vehicles.push(Locomotive.fromSave(vEntity, saveObjects));
      } else if (vEntity.typePath === FreightWagon.TYPE_PATH) {
        vehicles.push(FreightWagon.fromSave(vEntity, saveObjects));
      }
      currentRef = vEntity.specialProperties?.vehicleBehind?.pathName;
    }

    // TimeTable
    const ttRef = trainEntity.properties?.TimeTable?.value?.pathName;
    const timeTable = ttRef ? byName.get(ttRef) || null : null;

    return new Train(trainEntity, vehicles, timeTable);
  }
}

Train.TYPE_TRAIN     = TYPE_TRAIN;
Train.TYPE_TIMETABLE = TYPE_TIMETABLE;

module.exports = Train;
