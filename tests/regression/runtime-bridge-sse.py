"""Actual compiled Express/SQLite/SSE with a local CLI fixture; no provider calls."""
import json, os, pathlib, shutil, socket, subprocess, tempfile, time, urllib.request

ROOT = pathlib.Path(os.environ.get('CLI_RUNTIME_TEST_ROOT', pathlib.Path(__file__).resolve().parents[2]))
with tempfile.TemporaryDirectory(prefix='runtime-bridge-sse-') as temporary:
    base = pathlib.Path(temporary)
    home, workspace, data = [base / name for name in ('home', 'workspace', 'data')]
    for directory in (home, workspace, data): directory.mkdir()
    native = home / '.gemini'; native.mkdir()
    (native / 'settings.json').write_text(json.dumps({'security': {'auth': {'selectedType': 'oauth-personal'}}}))
    (native / 'oauth_creds.json').write_text(json.dumps({'refresh_token': 'local-fixture-never-real'}))
    cli = base / 'gemini'
    cli.write_text('''#!/usr/bin/python3
import sys,json
if '--version' in sys.argv: print('0.59.5');sys.exit(0)
prompt=sys.argv[sys.argv.index('-p')+1]
event='RUNTIME_BRIDGE_FAILURE' if 'BRIDGE' in prompt else 'API_FAILURE'
code='GUI_RUNTIME_UNAVAILABLE' if 'BRIDGE' in prompt else 'GUI_REQUEST_TIMEOUT'
cause={'code':code,'agentId':'investigator','model':'gemini-3.7-flash','requestId':'current-request','invocationId':'current-invocation','affectsKey':False}
cause.update({'bridgeAction':'result','bridgeHttpStatus':500} if 'BRIDGE' in prompt else {'abortedBy':'request_timeout','timeoutMs':30000})
def emit(data):print(json.dumps(data),flush=True)
emit({'type':'tool_use','tool_id':'required','tool_name':'invoke_agent','parameters':{'agent_name':'investigator'}})
if 'FALLBACK' in prompt:
 old={'agentId':'investigator','model':'gemini-3.7-flash','keyId':'K3','requestId':'primary-request','invocationId':'current-invocation','httpStatus':503,'errorCode':'503_OVERLOAD','group':'G2'}
 emit({'type':'runtime_event','event':'API_FAILURE','tool_call_id':'required',**old})
 transition={'agentId':'investigator','invocationId':'current-invocation','fromModel':'gemini-3.7-flash','toModel':'gemini-3.6-flash','model':'gemini-3.6-flash','reason':'PRIMARY_RETRY_LIMIT','previousKeyId':'K3','keyId':'K1','previousRequestId':'primary-request','requestId':'fallback-request','cause':old}
 emit({'type':'runtime_event','event':'MODEL_FALLBACK','tool_call_id':'required',**transition})
 ok='SUCCESS' in prompt
 terminal={'agentId':'investigator','model':'gemini-3.6-flash','requestId':'fallback-request','keyId':'K1','invocationId':'current-invocation'}
 emit({'type':'runtime_event','event':'SUCCESS' if ok else 'API_FAILURE','tool_call_id':'required',**terminal,**({} if ok else {'httpStatus':503,'errorCode':'503_OVERLOAD','message':'fallback indisponível'})})
 emit({'type':'tool_result','tool_id':'required','tool_name':'invoke_agent','status':'success' if ok else 'failed','output':'arquivo preservado' if ok else 'fallback indisponível','error':None if ok else 'fallback indisponível',**terminal})
 emit({'type':'tool_result','tool_id':'required','status':'success','requestId':'wrong-request','model':'wrong-model','output':'duplicate'})
 if ok or 'PARTIAL' in prompt:emit({'type':'message','role':'assistant','content':'Resultado controlado.'})
 emit({'type':'result','status':'success'})
 sys.exit(0)
emit({'type':'runtime_event','event':event,'tool_call_id':'required','message':code,**cause})
emit({'type':'tool_result','tool_id':'required','tool_name':'invoke_agent','status':'failed','error':code,'cause':cause,**cause})
emit({'type':'tool_result','tool_id':'required','status':'success','requestId':'wrong-request','model':'wrong-model','output':'duplicate'})
if 'PARTIAL' in prompt:emit({'type':'message','role':'assistant','content':'Resultado parcial local.'})
emit({'type':'result','status':'success'})
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
            for name, expected in [('TIMEOUT', 'failed'), ('TIMEOUT_PARTIAL', 'partial'), ('BRIDGE', 'failed')]:
                with request('/api/cli/execute', {'prompt':name,'executionId':'sse-'+name,'workDir':str(workspace),'resume':False}) as response: stream = response.read().decode()
                events = [json.loads(line[6:]) for line in stream.splitlines() if line.startswith('data: ')]
                terminals = [e for e in events if e.get('type') == 'tool_result' and e.get('tool_call_id') == 'required']
                assert len(terminals) >= 2
                assert all(e['status'] == 'failed' and e['lastRequestId'] == 'current-request' and e['subagentModel'] == 'gemini-3.7-flash' and e['invocationId'] == 'current-invocation' for e in terminals)
                assert terminals[0]['cause']['code'] == ('GUI_RUNTIME_UNAVAILABLE' if name == 'BRIDGE' else 'GUI_REQUEST_TIMEOUT')
                assert next(e for e in events if e['type'] == 'execution_outcome')['status'] == expected
                assert next(e for e in events if e['type'] == 'done')['exitCode'] == 1
                pathlib.Path('/tmp/bridge-' + name.lower() + '.sse').write_text(stream)
            for name, expected in [('FALLBACK_SUCCESS', 'success'), ('FALLBACK_FAILED', 'failed'), ('FALLBACK_PARTIAL', 'partial')]:
                with request('/api/cli/execute', {'prompt':name,'executionId':'sse-'+name,'workDir':str(workspace),'resume':False}) as response: stream = response.read().decode()
                events = [json.loads(line[6:]) for line in stream.splitlines() if line.startswith('data: ')]
                pathlib.Path('/tmp/fallback-' + name.lower() + '.sse').write_text(stream)
                changes = [e for e in events if e.get('type') == 'runtime_event' and e.get('event') == 'MODEL_FALLBACK']
                assert len(changes) == 1
                change = changes[0]
                assert change['fromModel'] == 'gemini-3.7-flash' and change['toModel'] == 'gemini-3.6-flash'
                assert change['requestId'] == 'fallback-request' and change['previousRequestId'] == 'primary-request' and change['keyId'] == 'K1' and change['cause']['httpStatus'] == 503
                terminals = [e for e in events if e.get('type') == 'tool_result' and e.get('tool_call_id') == 'required']
                assert terminals and all(e['lastRequestId'] == 'fallback-request' and e['subagentModel'] == 'gemini-3.6-flash' and e['status'] == ('completed' if expected == 'success' else 'failed') for e in terminals)
                assert next(e for e in events if e['type'] == 'execution_outcome')['status'] == expected
                assert next(e for e in events if e['type'] == 'done')['exitCode'] == (0 if expected == 'success' else 1)
                diagnostics = list((data / 'request-diagnostics').glob('sse-' + name + '*.jsonl'))
                captured = [json.loads(line) for line in diagnostics[0].read_text().splitlines()]
                assert next(e for e in captured if e.get('event') == 'MODEL_FALLBACK')['requestId'] == change['requestId']
                pathlib.Path('/tmp/fallback-' + name.lower() + '.sse').write_text(stream)
            log = (home / '.local/share/gemini-gui/logs/system-logs.log').read_text()
            assert 'PRIMARY_RETRY_LIMIT' in log and 'primary-request' in log and 'fallback-request' in log and 'gemini-3.6-flash' in log
            records = [json.loads(line) for line in (home / '.local/share/gemini-gui/logs/subagent-executions.jsonl').read_text().splitlines()]
            failures = [r for r in records if r.get('agentName') == 'investigator' and r['eventType'] == 'SUBAGENT_ERROR' and not r.get('executionId','').startswith('sse-FALLBACK')]
            assert len(failures) == 3
            assert all(r['model'] == 'gemini-3.7-flash' and r['details']['requestId'] == 'current-request' and r['details']['cause']['affectsKey'] is False for r in failures)
            print('VERIFICADO: Express/SSE/logs preservam causa, agente, modelo, requestId, invocationId e failed/partial; duplicatas não sobrescrevem o terminal. Transições de fallback preservadas em SSE, diagnósticos/Payload e logs, com success/partial/failed. Nenhuma API externa.')
        finally:
            try: os.killpg(server.pid, 15); server.wait(timeout=2)
            except subprocess.TimeoutExpired: os.killpg(server.pid, 9); server.wait()
            except ProcessLookupError: pass
