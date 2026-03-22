
const {
  FlowPort, PortType, findComp, PORT_TANGENT,
} = require('../../satisfactoryLib');

const PORTS = {
  FGPipeConnectionFactory: { offset: { x: 0, y: 2065, z: 575 }, dir: { x: 0, y: PORT_TANGENT, z: 0 }, flow: 'input', type: PortType.PIPE },
  PowerConnection:         { offset: { x: 0, y: 0, z: 0 },      dir: null,                            flow: 'output', type: PortType.POWER },
};

class NukePlant {
  constructor(entity, pipeConn, powerConnComp) {
    this.entity = entity;
    this.inst = entity.instanceName;
    const componentMap = { FGPipeConnectionFactory: pipeConn, PowerConnection: powerConnComp };
    this._ports = FlowPort.fromLayout(componentMap, entity.transform, PORTS);
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`NukePlant ${this.inst}: unknown port "${name}"`);
    return p;
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    return new NukePlant(entity,
      findComp(saveObjects, `${inst}.FGPipeConnectionFactory`),
      findComp(saveObjects, `${inst}.PowerConnection`),
    );
  }
}

NukePlant.Ports = { PIPE: 'FGPipeConnectionFactory', POWER: 'PowerConnection' };

module.exports = NukePlant;