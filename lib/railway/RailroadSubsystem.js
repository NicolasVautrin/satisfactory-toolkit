const { ref } = require('../../satisfactoryLib');

const SUBSYSTEM_TYPE = '/Game/FactoryGame/-Shared/Blueprint/BP_RailroadSubsystem.BP_RailroadSubsystem_C';

/**
 * Helper for the RailroadSubsystem singleton.
 * Manages registration of train station identifiers and trains.
 */
class RailroadSubsystem {
  constructor(entity) {
    this.entity = entity;
  }

  /**
   * Find the RailroadSubsystem in the save objects.
   * @param allObjects  Array of all SaveEntity/SaveComponent from the save
   * @returns RailroadSubsystem instance
   */
  static find(allObjects) {
    const entity = allObjects.find(o => o.typePath === SUBSYSTEM_TYPE);
    if (!entity) throw new Error('RailroadSubsystem not found in save — is there existing rail infrastructure?');
    return new RailroadSubsystem(entity);
  }

  /**
   * Register a TrainStation's identifier in the subsystem.
   * Required for the station to be recognized by the game (avoids "Invalid Train Station Identifier").
   * @param station  TrainStation instance (must have .stationId)
   */
  registerStation(station) {
    if (!station.stationId) throw new Error('TrainStation has no stationId');
    const props = this.entity.properties;

    if (!props.mTrainStationIdentifiers) {
      props.mTrainStationIdentifiers = {
        type:    'ObjectArrayProperty',
        ueType:  'ArrayProperty',
        name:    'mTrainStationIdentifiers',
        subtype: 'ObjectProperty',
        values:  [],
      };
    }

    props.mTrainStationIdentifiers.values.push(ref(station.stationId.instanceName));
  }

  /**
   * Register a Train in the subsystem.
   * Required for the train to be managed by the railroad system.
   * @param train  Train instance (must have .entity)
   */
  registerTrain(train) {
    const props = this.entity.properties;

    if (!props.mTrains) {
      props.mTrains = {
        type:    'ObjectArrayProperty',
        ueType:  'ArrayProperty',
        name:    'mTrains',
        subtype: 'ObjectProperty',
        values:  [],
      };
    }

    props.mTrains.values.push(ref(train.entity.instanceName));
  }
}

RailroadSubsystem.TYPE_PATH = SUBSYSTEM_TYPE;

module.exports = RailroadSubsystem;