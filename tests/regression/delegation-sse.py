"""Compiled Express + SQLite + SSE: replay actual local CLI delegation fixtures. No APIs."""
import json, os, pathlib, shutil, socket, subprocess, tempfile, time, urllib.request

ROOT = pathlib.Path(os.environ.get('CLI_RUNTIME_TEST_ROOT', pathlib.Path(__file__).resolve().parents[2]))
SCENARIOS = ['individual', 'parallel', 'collision', 'simultaneous', 'plan-isolation', 'partial', 'fallback-bridge', 'timeout']
with tempfile.TemporaryDirectory(prefix='delegation-sse-') as temporary:
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
fixture=json.load(open('/tmp/cligovisual-delegation-'+scenario+'.json'))
for event in fixture['events']:print(json.dumps(event),flush=True)
''')
    cli.chmod(0o700)
    env = {key: value for key, value in os.environ.items() if not key.startswith(('GEMINI_', 'GOOGLE_', 'EXA_')) and key not in ('NODE_OPTIONS', 'CLOUD_SHELL')}
    with socket.socket() as sock: sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    env.update(HOME=str(home), GEMINI_GUI_DATA_DIR=str(data), NODE_ENV='production', HOST='127.0.0.1', PORT=str(port), PATH=str(base) + ':/usr/bin:/bin')
    with (base / 'server.log').open('w') as log:
        server = subprocess.Popen([shutil.which('node'), str(ROOT / 'dist/server.cjs')], cwd=workspace, env=env, stdout=log, stderr=log, start_new_session=True)
        def request(route, body=None):
            req = urllib.request.Request(f'http://127.0.0.1:{port}' + route, json.dumps(body).encode() if body else None, {'Content-Type':'application/json'})
            return urllib.request.urlopen(req, timeout=10)
        try:
            for _ in range(100):
                try:
                    with request('/api/health') as response: assert json.load(response)['status'] == 'ok'
                    break
                except OSError: time.sleep(.05)
            else: raise RuntimeError('Servidor local não iniciou')
            with request('/api/cli/config', {'cliPath':str(cli)}) as response: json.load(response)
            for scenario in SCENARIOS:
                fixture = json.loads(pathlib.Path('/tmp/cligovisual-delegation-' + scenario + '.json').read_text())
                with request('/api/cli/execute', {'prompt':scenario,'agentId':'principal','executionId':'controlled-'+scenario,'workDir':str(workspace),'resume':False}) as response: stream = response.read().decode()
                events = [json.loads(line[6:]) for line in stream.splitlines() if line.startswith('data: ')]
                pathlib.Path('/tmp/delegation-' + scenario + '.sse').write_text(stream)
                expected = 'partial' if scenario in ['partial','timeout'] else 'success'
                assert next(e for e in events if e['type'] == 'execution_outcome')['status'] == expected
                assert next(e for e in events if e['type'] == 'done')['exitCode'] == (1 if expected == 'partial' else 0)
                starts = [e for e in fixture['events'] if e.get('type') == 'tool_use' and e.get('invocationId')]
                for start in starts:
                    canonical = [e for e in events if e.get('type') == 'tool_use' and e.get('tool_call_id') == start['tool_id']]
                    assert canonical and all(e['agentName'] == start['agentId'] and e['invocationId'] == start['invocationId'] and e['requestId'] == start['requestId'] and e['subagentModel'] == start['model'] and e['parentToolCallId'] == start['parentToolCallId'] for e in canonical)
                    terminal = [e for e in events if e.get('type') == 'tool_result' and e.get('tool_call_id') == start['tool_id']]
                    assert terminal and all(e['agentName'] == start['agentId'] for e in terminal)
                records = [json.loads(line) for line in (home / '.local/share/gemini-gui/logs/subagent-executions.jsonl').read_text().splitlines()]
                records = [r for r in records if r.get('executionId') == 'controlled-'+scenario]
                for start in starts:
                    traced = [r for r in records if r.get('toolCallId') == start['tool_id'] and r['eventType'] == 'SUBAGENT_TOOL_CALL']
                    assert len(traced) == 1 and traced[0]['targetAgent'] == start['agentId'] and traced[0]['details']['invocationId'] == start['invocationId']
                    written = [r for r in records if r.get('details',{}).get('toolCallId') == start['tool_id'] and r['eventType'] == 'SUBAGENT_TOOL_RESULT']
                    assert len(written) == 1 and written[0]['agentName'] == start['agentId'] and written[0]['details']['requestId'] == start['requestId']
                diagnostics = list((data / 'request-diagnostics').glob('controlled-' + scenario + '*.jsonl'))
                captured = [json.loads(line) for line in diagnostics[0].read_text().splitlines()]
                for start in starts:
                    assert any(e.get('tool_id') == start['tool_id'] and e.get('agentId') == start['agentId'] and e.get('requestId') == start['requestId'] for e in captured)
                if scenario == 'collision': assert len({e.get('tool_call_id') or e.get('tool_id') for e in events if e.get('type') == 'tool_use' and e.get('invocationId')}) == 15
            print('VERIFICADO: 8 cenários do CLI local reproduzidos no Express compilado; autoria, IDs, modelos, resultados, success/partial e diagnósticos/Payload preservados em SSE/logs. Nenhuma API externa.')
        finally:
            try: os.killpg(server.pid, 15); server.wait(timeout=2)
            except subprocess.TimeoutExpired: os.killpg(server.pid, 9); server.wait()
            except ProcessLookupError: pass
