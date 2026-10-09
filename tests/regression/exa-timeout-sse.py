"""Replay current local-provider CLI results through compiled Express/Payload/SSE."""
import json, os, pathlib, shutil, socket, subprocess, tempfile, time, urllib.request

ROOT = pathlib.Path(os.environ.get('CLI_RUNTIME_TEST_ROOT', pathlib.Path(__file__).resolve().parents[2]))
SCENARIOS = ['I-web-exa', 'I-exa-rate', 'I-web-exa-rate', 'I-investigator-exa-timeout']
with tempfile.TemporaryDirectory(prefix='exa-timeout-sse-') as temporary:
    base = pathlib.Path(temporary)
    home, workspace, data = [base / name for name in ('home', 'workspace', 'data')]
    for directory in (home, workspace, data): directory.mkdir()
    native = home / '.gemini'; native.mkdir()
    (native / 'settings.json').write_text(json.dumps({'security': {'auth': {'selectedType': 'oauth-personal'}}}))
    (native / 'oauth_creds.json').write_text(json.dumps({'refresh_token': 'local-fixture-never-real'}))
    cli = base / 'gemini'
    cli.write_text('''#!/usr/bin/python3
import sys,json
if '--version' in sys.argv:print('0.59.5');sys.exit()
if '--list-sessions' in sys.argv:print('No sessions');sys.exit()
scenario=sys.argv[sys.argv.index('-p')+1]
fixture=json.load(open('/tmp/cligovisual-exa-'+scenario+'.json'))
for event in fixture['events']:print(json.dumps(event),flush=True)
''')
    cli.chmod(0o700)
    env = {key: value for key, value in os.environ.items() if not key.startswith(('GEMINI_', 'GOOGLE_', 'EXA_')) and key not in ('NODE_OPTIONS', 'CLOUD_SHELL')}
    with socket.socket() as sock: sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    env.update(HOME=str(home), GEMINI_GUI_DATA_DIR=str(data), NODE_ENV='production', HOST='127.0.0.1', PORT=str(port), PATH=str(base) + ':/usr/bin:/bin')
    with (base / 'server.log').open('w') as log:
        server = subprocess.Popen([shutil.which('node'), str(ROOT / 'dist/server.cjs')], cwd=workspace, env=env, stdout=log, stderr=log, start_new_session=True)
        def request(route, body=None):
            req = urllib.request.Request(f'http://127.0.0.1:{port}' + route, json.dumps(body).encode() if body else None, {'Content-Type': 'application/json'})
            return urllib.request.urlopen(req, timeout=10)
        try:
            for _ in range(100):
                try:
                    with request('/api/health') as response: assert json.load(response)['status'] == 'ok'
                    break
                except OSError: time.sleep(.05)
            else: raise RuntimeError('Servidor local não iniciou')
            with request('/api/cli/config', {'cliPath': str(cli)}) as response: json.load(response)
            for scenario in SCENARIOS:
                fixture = json.loads(pathlib.Path('/tmp/cligovisual-exa-' + scenario + '.json').read_text())
                with request('/api/cli/execute', {'prompt': scenario, 'executionId': 'current-' + scenario, 'workDir': str(workspace), 'resume': False}) as response: stream = response.read().decode()
                events = [json.loads(line[6:]) for line in stream.splitlines() if line.startswith('data: ')]
                diagnostic = next((data / 'request-diagnostics').glob('current-' + scenario + '*.jsonl'))
                raw = [json.loads(line) for line in diagnostic.read_text().splitlines()]
                if scenario.endswith('-rate'):
                    native_error = next(event for event in fixture['events'] if event.get('type') == 'tool_result' and event.get('status') != 'success' and 'EXA_MCP_RATE_LIMIT' in json.dumps(event))
                    terminal = [event for event in events if event.get('type') == 'tool_result' and event.get('tool_call_id') == native_error['tool_id']]
                    assert terminal and all(event['status'] == 'failed' for event in terminal)
                    assert 'EXA_MCP_RATE_LIMIT' in stream and 'free MCP rate limit' in diagnostic.read_text()
                    assert not any(event.get('event') == 'WEB_SUCCESS' for event in raw)
                elif scenario.endswith('-timeout'):
                    failure = next(event for event in raw if event.get('event') == 'API_FAILURE' and event.get('code') == 'GUI_REQUEST_TIMEOUT')
                    assert failure['agentId'] == 'investigator' and failure['model'] == 'gemini-3.7-flash'
                    assert failure['requestPhase'] == 'awaiting_response' and failure['responseChunks'] == 0 and failure['elapsedMs'] >= 30000
                    native_terminal = next(event for event in fixture['events'] if event.get('tool_name') == 'invoke_agent' and event.get('type') == 'tool_result')
                    terminal = next(event for event in events if event.get('type') == 'tool_result' and event.get('tool_call_id') == native_terminal['tool_id'])
                    assert terminal['status'] == 'failed' and terminal['cause']['requestPhase'] == 'awaiting_response'
                    assert terminal['cause']['requestId'] == failure['requestId'] and terminal['cause']['affectsKey'] is False
                    assert next(event for event in events if event['type'] == 'execution_outcome')['status'] == 'partial'
                    system_log = (home / '.local/share/gemini-gui/logs/system-logs.log').read_text()
                    assert 'awaiting_response' in system_log and failure['requestId'] in system_log
                else:
                    assert any(event.get('event') == 'WEB_SUCCESS' for event in raw)
                    assert 'EXA_ACTUAL_RESULT' in diagnostic.read_text()
                pathlib.Path('/tmp/exa-current-' + scenario + '.sse').write_text(stream)
            print('VERIFICADO: 4 replays atuais de provedores locais no Express compilado; pesquisa válida, falhas Exa, causa de timeout, autoria e IDs preservados em SSE/Payload/logs. Sem API externa.')
        finally:
            try: os.killpg(server.pid, 15); server.wait(timeout=2)
            except subprocess.TimeoutExpired: os.killpg(server.pid, 9); server.wait()
            except ProcessLookupError: pass
