"""Hote Frida longue duree : agent de jeu (ue.js + pump.js + game.js) + API HTTP locale.

Usage :
    python tools/re/frida/host.py [--port 8766]

API (127.0.0.1 uniquement) :
    GET  /status                         etat de la pompe (sans passer par le thread du jeu)
    POST /call  {"fn": "...", "args": [...]}
         fn = ping | player | teleport | ground | scan | build | buildInFront | dismantle | status
    POST /shutdown                       detache l'agent (les hooks sont retires) et arrete l'hote

Les evenements et erreurs de l'agent sont ecrits sur la sortie standard, une ligne JSON par evenement.
Les appels sont serialises (un seul a la fois) : une commande qui modifie la partie n'est jamais
concurrente d'une autre.
"""
import argparse
import json
import pathlib
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import frida

PROCESS = 'FactoryGameSteam-Win64-Shipping.exe'
HERE = pathlib.Path(__file__).resolve().parent
AGENT_FILES = ['ue.js', 'pump.js', 'game.js']
ALLOWED = {'status', 'ping', 'enums', 'trains', 'trainTimetable', 'trainSelfDriving', 'stations', 'trainName', 'stationReleaseDock', 'trainRerail', 'trainRecorder', 'trainRecorderGet', 'trainRecorderStop', 'lineRegulatorStatus', 'lineRegulatorStart', 'lineRegulatorStop', 'stationHoldDock', 'switchControl', 'switchPosition', 'railRebuild', 'player', 'teleport', 'ground', 'rays', 'scan', 'build', 'buildAim', 'check', 'buildInFront', 'wire', 'power', 'circuit', 'resetFuse', 'connections', 'pose', 'bounds', 'recipe', 'recipes', 'props', 'layout', 'pickup', 'fields', 'dump', 'world', 'rails', 'railEnds', 'rail', 'signal', 'platformLoadMode', 'belt', 'connect', 'machine', 'setRecipe', 'setClock', 'addShards', 'pause', 'machines', 'pauseMany', 'upstream', 'addItems', 'dismantle', 'dismantleMany', 'bubble', 'outline', 'powerLinks', 'sphere', 'sphereRemove', 'stackSize', 'lightweight', 'lightweightRemove', 'powerReach', 'smartRules', 'removeMapMarkers', 'addMapMarkers', 'saveGame', 'railLink', 'sweeps', 'overlaps', 'relief', 'renameStation', 'tags', 'saveGameFlag', 'removeItems', 'exportsMatching', 'flushPipeNetwork', 'flushIntegrant', 'fluidContent', 'generateStationName', 'ghost', 'ghostSet', 'ghostGet', 'ghostRemove', 'blueprintFromActors', 'blueprintRefresh', 'blueprintDimensions', 'blueprintPlacement', 'streamingSourceAdd', 'streamingSources', 'streamingSourceRemove', 'reliefPoints'}


def log(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


class Agent:
    def __init__(self):
        source = '\n'.join((HERE / f).read_text(encoding='utf-8') for f in AGENT_FILES)
        self.session = frida.attach(PROCESS)
        self.session.on('detached', lambda reason, crash: log({'event': 'detached', 'reason': reason, 'crash': str(crash)}))
        self.script = self.session.create_script(source)
        self.script.on('message', self._on_message)
        self.script.load()
        self.lock = threading.Lock()
        log({'event': 'pump', 'status': self.script.exports_sync.install()})

    @staticmethod
    def _on_message(message, _data):
        if message['type'] == 'send':
            log(message['payload'])
        elif message['type'] == 'error':
            log({'event': 'agent.error', 'stack': message.get('stack') or message.get('description')})

    def call(self, fn, args):
        if fn not in ALLOWED:
            raise ValueError('fonction inconnue : ' + fn)
        # frida-python attend le nom en snake_case et le reconvertit en camelCase (buildInFront <- build_in_front)
        py_name = re.sub(r'[A-Z]', lambda m: '_' + m.group(0).lower(), fn)
        with self.lock:
            return getattr(self.script.exports_sync, py_name)(*args)

    def detach(self):
        self.session.detach()


def make_handler(agent, server_ref):
    class Handler(BaseHTTPRequestHandler):
        def _reply(self, code, payload):
            body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            pass

        def do_GET(self):
            if self.path == '/status':
                try:
                    self._reply(200, {'ok': True, 'result': agent.call('status', [])})
                except Exception as e:
                    self._reply(500, {'ok': False, 'error': str(e)})
            else:
                self._reply(404, {'ok': False, 'error': 'route inconnue'})

        def do_POST(self):
            if self.path == '/shutdown':
                self._reply(200, {'ok': True})
                threading.Thread(target=server_ref['server'].shutdown, daemon=True).start()
                return
            if self.path != '/call':
                self._reply(404, {'ok': False, 'error': 'route inconnue'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                req = json.loads(self.rfile.read(length) or b'{}')
                fn = req.get('fn', '')
                args = req.get('args', [])
                log({'event': 'call', 'fn': fn, 'args': args})
                result = agent.call(fn, args)
                log({'event': 'result', 'fn': fn, 'result': result})
                self._reply(200, {'ok': True, 'result': result})
            except Exception as e:
                log({'event': 'call.error', 'error': str(e)})
                self._reply(500, {'ok': False, 'error': str(e)})

    return Handler


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()

    agent = Agent()
    server_ref = {}
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(agent, server_ref))
    server_ref['server'] = server
    log({'event': 'ready', 'url': 'http://127.0.0.1:%d' % args.port})
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        agent.detach()
        log({'event': 'stopped'})


if __name__ == '__main__':
    main()
