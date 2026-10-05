"""Real Express/SQLite/file smoke test; Gemini is a local protocol fixture, with no API calls."""
import json, os, pathlib, shutil, socket, subprocess, tempfile, time, urllib.request, urllib.error
ROOT = pathlib.Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='cligovisual-smoke-') as temporary:
    base = pathlib.Path(temporary)
    workspace, home, data = [base / name for name in ('workspace', 'home', 'data')]
    for directory in (workspace, home, data): directory.mkdir()
    executable = base / 'fixture-cli'
    executable.write_text('''#!/usr/bin/python3
import os,sys,json,time,pathlib,subprocess
args=sys.argv
prompt=args[args.index('-p')+1] if '-p' in args else sys.stdin.read()
if prompt.endswith('HANG'):
 child=subprocess.Popen(['/bin/sleep','30'])
 pathlib.Path('child-pid.txt').write_text(str(child.pid))
 print(json.dumps({'type':'message','role':'assistant','content':'started'}),flush=True)
 time.sleep(30)
else:
 pathlib.Path('created.txt').write_text('created by protocol fixture')
 print(json.dumps({'type':'message','role':'assistant','content':'fixture response'}),flush=True)
 print(json.dumps({'type':'result','status':'success'}),flush=True)
''')
    executable.chmod(0o700)
    with socket.socket() as sock: sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    env = {k: v for k, v in os.environ.items() if k not in ('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY', 'EXA_API_KEY', 'NODE_OPTIONS', 'GEMINI_GUI_PERSISTENT')}
    env.update(HOME=str(home), GEMINI_GUI_DATA_DIR=str(data), NODE_ENV='production', PORT=str(port), HOST='127.0.0.1')
    log_path = base / 'server.log'
    with log_path.open('w') as log:
        server = subprocess.Popen([shutil.which('node'), str(ROOT / 'dist/server.cjs')], cwd=workspace, env=env, stdout=log, stderr=log, start_new_session=True)
        url = f'http://127.0.0.1:{port}'
        def request(endpoint, payload=None, method=None):
            body = json.dumps(payload).encode() if payload is not None else None
            req = urllib.request.Request(url + endpoint, body, {'Content-Type': 'application/json'}, method=method)
            with urllib.request.urlopen(req, timeout=10) as response: return json.load(response)
        try:
            for _ in range(100):
                if server.poll() is not None: raise RuntimeError('Servidor terminou durante inicialização: ' + log_path.read_text()[-2000:])
                try:
                    if request('/api/health')['status'] == 'ok': break
                except (OSError, urllib.error.URLError): time.sleep(0.05)
            else: raise RuntimeError('Servidor não iniciou em 5 segundos.')
            session = {'id': '00000000-0000-4000-8000-000000000001', 'title': 'Original', 'messages': [{'id': 'm1', 'role': 'assistant', 'content': 'Preservar', 'activities': [{'title': 'full diagnostic'}]}]}
            request('/api/sessions', session)
            request('/api/sessions/' + session['id'], {'title': 'Renomeado', 'isArchived': True}, 'PATCH')
            full = request('/api/sessions/' + session['id']); assert full['messages'][0]['activities'][0]['title'] == 'full diagnostic'
            request('/api/sessions/' + session['id'] + '/messages', {'messages': session['messages'], 'cliSessionId': 'fixture-id'}, 'PUT')
            full = request('/api/sessions/' + session['id']); assert full['title'] == 'Renomeado' and full['isArchived']
            invalid = dict(session, messages=[{'id': 'm1', 'role': 'assistant', 'content': 'invalid', 'model': {}}])
            try: request('/api/sessions', invalid); raise AssertionError('Payload inválido aceito')
            except urllib.error.HTTPError as error: assert error.code == 400
            assert request('/api/sessions/' + session['id'])['title'] == 'Renomeado'
            backup = request('/api/system/backup/export?sections=sessions'); assert backup['sessions'][0]['messages'][0]['content'] == 'Preservar'
            request('/api/sessions/' + session['id'], method='DELETE')
            assert request('/api/system/backup/restore', {'backupData': backup, 'selectedSections': {'sessions': True}})['success']
            assert request('/api/sessions/' + session['id'])['messages'][0]['activities'][0]['title'] == 'full diagnostic'
            request('/api/cli/config', {'cliPath': str(executable)})
            request('/api/config/api-key', {'apiKey': 'fixture-key-not-real-00000000000', 'exaApiKey': ''})
            payload = {'executionId': 'smoke-execution', 'sessionId': session['id'], 'prompt': 'RUN', 'workDir': str(workspace), 'resume': False, 'sharedMemory': 'fixture memory', 'contextMessages': [{'role': 'user', 'content': 'branch context'}], 'resetContext': True}
            req = urllib.request.Request(url + '/api/cli/execute', json.dumps(payload).encode(), {'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=10) as response: stream = response.read().decode()
            events = []
            event_name = ''
            for line in stream.splitlines():
                if line.startswith('event: '): event_name = line[7:]
                if line.startswith('data: '):
                    event = json.loads(line[6:]); event.setdefault('type', event_name); events.append(event)
            assert any(event['type'] == 'done' and event['exitCode'] == 0 for event in events), stream
            assert any(event['type'] == 'version_created' for event in events), stream
            changed = next(event for event in events if event['type'] == 'session_changed'); assert changed['sessionId'] != session['id']
            config = next(event for event in events if event['type'] == 'gui_configuration')
            assert 'fixture memory' in config['guiConfiguration']['systemPrompt']; assert 'branch context' in ' '.join(config['cliInvocation']['args'])
            versions = request('/api/versions?workspaceDir=' + urllib.parse.quote(str(workspace)))
            before = next(version for version in versions if version['isBackup']); assert before['manifest']['created.txt']['exists'] is False
            result = request('/api/versions/' + before['id'] + '/restore', {'workspaceDir': str(workspace)})
            assert result['success'] and not (workspace / 'created.txt').exists()
            payload.update(executionId='disconnect-smoke', prompt='HANG', resetContext=False)
            req = urllib.request.Request(url + '/api/cli/execute', json.dumps(payload).encode(), {'Content-Type': 'application/json'})
            response = urllib.request.urlopen(req, timeout=10)
            for _ in range(100):
                if (workspace / 'child-pid.txt').exists(): break
                time.sleep(0.02)
            else: raise AssertionError('Processo filho da fixture não iniciou')
            child_pid = int((workspace / 'child-pid.txt').read_text()); response.close()
            for _ in range(100):
                stat = pathlib.Path(f'/proc/{child_pid}/stat')
                if not stat.exists() or stat.read_text().split()[2] == 'Z': break
                time.sleep(0.02)
            else:
                os.kill(child_pid, 9); raise AssertionError('Filho continuou executando após desconexão SSE')
            print('PASSOU: inicialização HTTP real, sessões/rollback/exportação/restauração SQLite, snapshots e cancelamento de filho por desconexão.')
            print('Gemini: protocolo emulado por script local; nenhuma chamada a provedores.')
        finally:
            try: os.killpg(server.pid, 15)
            except ProcessLookupError: pass
            try: server.wait(timeout=3)
            except subprocess.TimeoutExpired: os.killpg(server.pid, 9); server.wait()
