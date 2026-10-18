// Client de l'hote Frida (tools/re/frida/host.py) : un appel = une commande executee sur le thread du jeu.
'use strict';

const HOST = process.env.FRIDA_HOST || 'http://127.0.0.1:8766';

async function call(fn, ...args) {
  const res = await fetch(HOST + '/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn, args }),
  });
  const r = await res.json();
  if (!r.ok) throw new Error(fn + ': ' + String(r.error).split('\n')[0]);
  return r.result;
}

// Nom court d'un chemin d'acteur (Build_ConstructorMk1_C_2147401583)
const short = (p) => (typeof p === 'string' ? p.split('.').pop() : p);

module.exports = { call, short };
