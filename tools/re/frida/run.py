"""Hote Frida : s'attache au jeu, charge ue.js + un agent, et affiche les evenements.

Usage :
    python tools/re/frida/run.py                      # agent probe.js, jusqu'a Ctrl+C
    python tools/re/frida/run.py --duration 120       # detache apres 120 s
    python tools/re/frida/run.py --agent autre.js

Les hooks se resolvent au runtime par nom decore exporte (cf. ue.js) : aucune table d'adresses.
"""
import argparse
import json
import pathlib
import sys
import time

import frida

PROCESS = 'FactoryGameSteam-Win64-Shipping.exe'
HERE = pathlib.Path(__file__).resolve().parent


def on_message(message, _data):
    if message['type'] == 'send':
        print(json.dumps(message['payload'], ensure_ascii=False), flush=True)
    elif message['type'] == 'error':
        print('[agent error]', message.get('stack') or message.get('description'), file=sys.stderr, flush=True)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--agent', default='probe.js')
    parser.add_argument('--duration', type=float, default=0, help='secondes avant detach (0 = Ctrl+C)')
    args = parser.parse_args()

    source = (HERE / 'ue.js').read_text(encoding='utf-8') + '\n' + (HERE / args.agent).read_text(encoding='utf-8')
    session = frida.attach(PROCESS)
    script = session.create_script(source)
    script.on('message', on_message)
    script.load()

    api = script.exports_sync
    print('modules:', json.dumps(api.info()), flush=True)
    print('hooks:', json.dumps(api.start()), flush=True)

    try:
        deadline = time.time() + args.duration if args.duration else None
        while deadline is None or time.time() < deadline:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        session.detach()
        print('detache', flush=True)


if __name__ == '__main__':
    main()
