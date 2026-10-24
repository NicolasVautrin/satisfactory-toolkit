// File d'attente executee sur le THREAD DU JEU (meme principe que tacticus-tools runtime/queue.ts + main-pump.ts).
// Un RPC Frida tourne sur le thread de Frida : creer ou modifier un acteur Unreal depuis ce thread fait planter
// le jeu. Les commandes sont donc mises en file et executees par une pompe posee sur
// AFGBuildableSubsystem::TickFactory, appele a chaque frame sur le thread du jeu (cf. FGBuildableSubsystem.h :
// avant la simulation parallele de l'usine, lire/ecrire un batiment est sans risque).
// Limite connue : TickFactory ne tourne pas jeu en pause (menu ouvert) ; les commandes expirent alors sans
// avoir ete executees.
'use strict';

const TICK_FACTORY = '?TickFactory@AFGBuildableSubsystem@@QEAAXMW4ELevelTick@@@Z';
const SLOW_COMMAND_MS = 50;

const pump = {
  installed: false,
  ticks: 0,
  tid: null,
  subsystem: NULL,
  executed: 0,
  queue: [],
  // Taches executees a chaque tick du jeu, apres la file (ex. fantome qui suit la visee du joueur) : fn(subsystem) ;
  // une tache qui leve une erreur est retiree
  tickHooks: new Map(),
};

// Execute fn(subsystem) au prochain tick. Le timeout n'annule qu'une commande pas encore demarree :
// une commande en cours va toujours au bout (un faux timeout laisserait une modification a moitie faite).
function onGameThread(label, fn, timeoutMs = 15000) {
  if (!pump.installed) return Promise.reject(new Error('pompe non installee'));
  return new Promise((resolve, reject) => {
    const item = { label, fn, resolve, reject, state: 'queued' };
    item.timer = setTimeout(() => {
      if (item.state === 'queued') {
        item.state = 'cancelled';
        reject(new Error('timeout : "' + label + '" non execute (jeu en pause ou partie non chargee ?)'));
      }
    }, timeoutMs);
    pump.queue.push(item);
  });
}

function drainQueue(subsystem) {
  pump.subsystem = subsystem;
  while (pump.queue.length > 0) {
    const item = pump.queue.shift();
    if (item.state !== 'queued') continue;
    item.state = 'running';
    clearTimeout(item.timer);
    const t0 = Date.now();
    try {
      item.resolve(item.fn(subsystem));
    } catch (e) {
      item.reject(e);
    }
    pump.executed++;
    // Le jeu est fige pendant toute la commande : signaler ce qui depasse quelques frames
    const ms = Date.now() - t0;
    if (ms > SLOW_COMMAND_MS) send({ event: 'pump.slow', label: item.label, ms });
  }
}

function installPump() {
  if (pump.installed) return;
  const address = hookableGameExport(TICK_FACTORY);
  // exceptions: 'propagate' : le code du jeu garde sa propre gestion d'exceptions (lecon tacticus-tools)
  const original = new NativeFunction(address, 'void', ['pointer', 'float', 'int'], { exceptions: 'propagate' });
  Interceptor.replace(address, new NativeCallback(function (self, dt, tickType) {
    pump.ticks++;
    if (pump.tid === null) pump.tid = Process.getCurrentThreadId();
    try {
      if (pump.queue.length > 0) drainQueue(self);
    } catch (e) {
      send({ event: 'pump.error', message: e.message, stack: e.stack });
    }
    for (const [name, hook] of pump.tickHooks) {
      try {
        hook(self);
      } catch (e) {
        pump.tickHooks.delete(name);
        send({ event: 'pump.hook.error', name, message: e.message, stack: e.stack });
      }
    }
    // Appel de l'original INCONDITIONNEL : une erreur de notre cote ne doit jamais sauter un tick du jeu
    original(self, dt, tickType);
  }, 'void', ['pointer', 'float', 'int']));
  pump.installed = true;
}

function pumpStatus() {
  return {
    installed: pump.installed,
    ticks: pump.ticks,
    tid: pump.tid,
    executed: pump.executed,
    queued: pump.queue.filter((i) => i.state === 'queued').length,
  };
}
