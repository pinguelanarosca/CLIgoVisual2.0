import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import * as childProcess from 'node:child_process';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root = path.resolve(import.meta.dirname, '../..');
const log = new Proxy({}, { get: () => () => {} });
export function load(file, globals = {}) {
  let source = fs.readFileSync(path.join(root, file), 'utf8').replace(/^import[\s\S]*?;\s*/gm, '').replace(/^export\s*\{[^}]*\};?\s*/gm, '');
  source = stripTypeScriptTypes(source, { mode: 'transform' }).replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let|var))/g, '');
  const telemetry = file === 'src/utils/activityTraceUtils.ts' ? load('src/utils/telemetry.ts') : {};
  const classification = file === 'server/gemini-cli-service.ts' ? load('server/key-pool-service.ts') : {};
  const context = vm.createContext({ nativeCliHome: () => (globals.os || os).homedir(), getEquivalentAgentAliases: () => ({}), getModelAvailability: () => ({ eligible: 0, configured: 0 }), loadConfiguredKeys: () => ({}), unwrapTelemetry: telemetry.unwrapTelemetry, classifyKeyResult: classification.classifyKeyResult, beginForegroundExecution: () => () => {}, pathToFileURL, createRuntimeBridge: async () => ({ url: 'http://127.0.0.1:1', token: 'fixture', close() {} }), console, Buffer, URL, AbortController, AbortSignal, TextDecoder, TextEncoder, setTimeout, clearTimeout, setInterval, clearInterval, process, fs, path, os, crypto, ...childProcess, sysLog: log, logSubagentEvent: () => {}, performance, ...globals });
  vm.runInContext(source, context, { filename: file });
  return context;
}
function fixture(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cligovisual-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
const session = () => ({ id: 's', title: 'Título', createdAt: '2026-01-01', messages: [{ id: 'm', role: 'assistant', content: 'Completo', model: 'model', activities: [{ title: 'diagnóstico' }], allFinalApiRequests: [{ request: 1 }] }] });

test('SQLite: metadados preservam mensagens completas, payload inválido e falha SQL fazem rollback', t => {
  const dir = fixture(t); const c = load('server/session-sqlite-service.ts', { DatabaseSync, getGuiDataDir: () => dir });
  c.saveSessionSqlite(session());
  c.updateSessionMetadataSqlite('s', { title: 'Renomeada', isArchived: true });
  assert.deepEqual(plain(c.getSessionByIdSqlite('s').messages), session().messages.map(m => ({ ...m, timestamp: c.getSessionByIdSqlite('s').messages[0].timestamp })));
  c.replaceSessionMessagesSqlite('s', { messages: session().messages, cliSessionId: 'updated-cli-id' });
  assert.equal(c.getSessionByIdSqlite('s').title, 'Renomeada');
  assert.equal(c.getSessionByIdSqlite('s').isArchived, true);
  assert.throws(() => c.replaceSessionMessagesSqlite('s', { messages: [], title: 'stale title' }));
  c.updateSessionMetadataSqlite('s', { projectId: 'project' });
  c.updateSessionMetadataSqlite('s', { projectId: null, isArchived: false });
  assert.equal(c.getSessionByIdSqlite('s').projectId, undefined); assert.equal(c.getSessionByIdSqlite('s').messages.length, 1);
  const before = plain(c.getSessionByIdSqlite('s'));
  assert.throws(() => c.saveSessionSqlite({ ...session(), messages: [{ ...session().messages[0], model: {} }] }));
  assert.deepEqual(plain(c.getSessionByIdSqlite('s')), before);
  const db = vm.runInContext('getDb()', c);
  db.exec("CREATE TRIGGER reject_bad BEFORE INSERT ON messages WHEN NEW.content = 'bad' BEGIN SELECT RAISE(ABORT, 'injected disk/constraint failure'); END;");
  assert.throws(() => c.saveSessionSqlite({ ...session(), title: 'Não gravar', messages: [{ ...session().messages[0], content: 'bad' }] }));
  assert.deepEqual(plain(c.getSessionByIdSqlite('s')), before);
  db.close();
});
test('Backup: exporta payloads completos e restaura diretamente para SQLite, atomicamente', t => {
  const dir = fixture(t); const c = load('server/session-sqlite-service.ts', { DatabaseSync, getGuiDataDir: () => dir });
  c.saveSessionSqlite(session());
  const backup = c.exportSessionsSqlite();
  c.deleteSessionSqlite('s'); c.importSessionsSqlite(backup);
  assert.equal(c.getSessionByIdSqlite('s').messages[0].allFinalApiRequests[0].request, 1);
  const before = plain(c.exportSessionsSqlite());
  assert.throws(() => c.importSessionsSqlite([session(), { id: 'invalid', messages: null }]));
  assert.deepEqual(plain(c.exportSessionsSqlite()), before);
  const backupFile = path.join(dir, 'backups', fs.readdirSync(path.join(dir, 'backups'))[0]);
  const savedDb = new DatabaseSync(backupFile, { readOnly: true });
  assert.equal(savedDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); savedDb.close();
  vm.runInContext('getDb().close()', c);
});
test('SQLite legado: migração salva backup consistente antes de alterar o esquema', t => {
  const dir = fixture(t), legacy = new DatabaseSync(path.join(dir, 'sessions.db'));
  legacy.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE sessions(id TEXT PRIMARY KEY, projectId TEXT, title TEXT, isArchived INTEGER, createdAt TEXT, updatedAt TEXT, messageCount INTEGER, statusGrade TEXT);
    CREATE TABLE messages(id TEXT PRIMARY KEY, sessionId TEXT, role TEXT, content TEXT, timestamp TEXT, model TEXT, agentName TEXT, sequence INTEGER, payloadJson TEXT);
    INSERT INTO sessions VALUES('s',NULL,'Legado',0,'before','before',1,'VALIDATED');`);
  legacy.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)').run('m', 's', 'assistant', 'histórico WAL', 'before', 'fixture', null, 0, JSON.stringify({ id: 'm', activities: [{ title: 'preservado' }] }));
  const c = load('server/session-sqlite-service.ts', { DatabaseSync, getGuiDataDir: () => dir });
  assert.equal(c.getSessionByIdSqlite('s').messages[0].activities[0].title, 'preservado');
  const backup = new DatabaseSync(path.join(dir, 'backups', fs.readdirSync(path.join(dir, 'backups'))[0]), { readOnly: true });
  assert.equal(backup.prepare('SELECT content FROM messages').get().content, 'histórico WAL');
  assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(backup.prepare('PRAGMA table_info(sessions)').all().some(column => column.name === 'payloadJson'), false);
  backup.close(); legacy.close(); vm.runInContext('getDb().close()', c);
});

test('Sincronização de agentes preserva arquivos pessoais e configurações MCP', t => {
  const dir = fixture(t), home = path.join(dir, 'home'), gui = path.join(dir, 'gui'), workspace = path.join(dir, 'workspace');
  for (const base of [home, gui, workspace]) fs.mkdirSync(path.join(base, '.gemini', 'agents'), { recursive: true });
  const personal = path.join(home, '.gemini', 'agents', 'personal.md'); fs.writeFileSync(personal, 'Meu agente');
  const conflict = path.join(home, '.gemini', 'agents', 'principal.md'); fs.writeFileSync(conflict, 'Agente pessoal com mesmo nome');
  const projectAgent = path.join(workspace, '.gemini', 'agents', 'project.md'); fs.writeFileSync(projectAgent, 'Agente do projeto');
  fs.mkdirSync(path.join(home, '.gemini', 'acknowledgments'));
  const acknowledgments = path.join(home, '.gemini', 'acknowledgments', 'agents.json');
  fs.writeFileSync(acknowledgments, JSON.stringify({ [home]: { principal: 'personal-hash' }, [workspace]: { principal: 'project-hash' } }));
  fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), '{"personal":true,"mcpServers":{"personal":{"command":"mine"}}}');
  fs.writeFileSync(path.join(gui, '.gemini', 'settings.json'), '{"personal":true,"mcpServers":{"personal":{"command":"mine"}},"modelConfigs":{"customAliases":{"mine":{"model":"personal"}},"overrides":[]}}');
  const c = load('server/agents-service.ts', { getGuiDataDir: () => gui, os: { ...os, homedir: () => home }, buildEffectiveSystemPrompt: () => 'GUI', process: { ...process, cwd: () => workspace } });
  c.loadAgents = () => [{ id: 'principal', name: 'principal', model: 'gui-model', description: '', tools: ['*'] }]; c.loadMetadata = () => ({});
  c.ensureAllAgentsSynchronizedAndAcknowledged(workspace);
  assert.equal(fs.readFileSync(personal, 'utf8'), 'Meu agente'); assert.equal(fs.readFileSync(conflict, 'utf8'), 'Agente pessoal com mesmo nome'); assert.equal(fs.readFileSync(projectAgent, 'utf8'), 'Agente do projeto');
  const ack = JSON.parse(fs.readFileSync(acknowledgments)); assert.equal(ack[home].principal, 'personal-hash'); assert.equal(ack[workspace].principal, 'project-hash');
  c.syncAgentsToSettings(workspace);
  const user = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'settings.json'))), settings = JSON.parse(fs.readFileSync(path.join(gui, '.gemini', 'settings.json')));
  assert.equal(user.personal, true); assert.equal(settings.mcpServers.personal.command, 'mine'); assert.equal(settings.modelConfigs.customAliases.mine.model, 'personal');
  fs.writeFileSync(acknowledgments, '{invalid'); assert.throws(() => c.ensureAllAgentsSynchronizedAndAcknowledged(workspace)); assert.equal(fs.readFileSync(acknowledgments, 'utf8'), '{invalid');
});
test('MCP: desativação só remove configuração pertencente à GUI', t => {
  const dir = fixture(t), settingsPath = path.join(dir, '.gemini', 'settings.json'); fs.mkdirSync(path.dirname(settingsPath));
  fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: { personal: { command: 'mine' }, gui: { command: 'ours' } }, guiManagedMcpNames: ['gui'], personal: true }));
  const c = load('server/mcp-service.ts', { getGuiDataDir: () => dir });
  c.saveMcpSettings([{ name: 'gui', enabled: false, command: 'ours' }]);
  const settings = JSON.parse(fs.readFileSync(settingsPath)); assert.equal(settings.personal, true); assert.equal(settings.mcpServers.personal.command, 'mine'); assert.equal(settings.mcpServers.gui, undefined);
});
test('MCP: leitura de projeto é imutável e configuração temporária preserva servidores pessoais', async t => {
  const dir = fixture(t), gui = path.join(dir, 'gui'), project = path.join(dir, 'project');
  for (const base of [gui, project]) fs.mkdirSync(path.join(base, '.gemini'), { recursive: true });
  const settings = { mcpServers: { personal: { command: 'mine' } }, guiMcpServers: { personal: { command: 'ours', enabled: false } } };
  const projectFile = path.join(project, '.gemini', 'settings.json'), guiFile = path.join(gui, '.gemini', 'settings.json');
  fs.writeFileSync(projectFile, JSON.stringify(settings)); fs.writeFileSync(guiFile, JSON.stringify(settings));
  const original = fs.readFileSync(projectFile, 'utf8');
  const mcp = load('server/mcp-service.ts', { getGuiDataDir: () => gui });
  mcp.loadMcpSettings(project); assert.equal(fs.readFileSync(projectFile, 'utf8'), original);
  const cli = load('server/gemini-cli-service.ts', { getGuiDataDir: () => gui, loadMcpSettings: mcp.loadMcpSettings, loadAgents: () => [], resolveCliAuthentication: () => ({ mode: 'none', configured: false }) });
  const runtime = JSON.parse(fs.readFileSync(await cli.resolveEffectiveCliConfig(project, 'fixture-runtime'), 'utf8'));
  assert.equal(runtime.mcpServers.personal.command, 'mine'); assert.equal(runtime.guiManagedMcpNames, undefined);
  fs.writeFileSync(projectFile, '{invalid'); assert.throws(() => mcp.loadMcpSettings(project)); assert.equal(fs.readFileSync(projectFile, 'utf8'), '{invalid');
});
test('Recuperação global, classificação de sinal/erro estruturado e replay de contexto', () => {
  const c = load('server/execution-policy.ts'); const state = {};
  assert.equal(c.consumeSessionRecovery(state), true); assert.equal(c.consumeSessionRecovery(state), true); assert.equal(c.consumeSessionRecovery(state), false);
  assert.equal(c.executionFailed(0, null, 'quota 429'), true); assert.equal(c.executionFailed(null, 'SIGTERM', ''), true); assert.equal(c.executionFailed(0, null, ''), false);
  assert.throws(() => c.validateExecutionContext({}, [])); assert.throws(() => c.validateExecutionContext('', [{ role: 'assistant', content: 2 }]));
  const prompt = c.buildExecutionPrompt({ prompt: 'continue', resume: false, contextMessages: [{ role: 'user', content: 'histórico ramificado' }] }); assert.match(prompt, /histórico ramificado/); assert.match(prompt, /continue/);
  assert.equal(c.buildExecutionPrompt({ prompt: 'continue', resume: true, contextMessages: [{ role: 'user', content: 'duplicado' }] }), 'continue');
});
test('Capturas: retenção bounded sem prefixos quadráticos', () => {
  const c = load('src/utils/diagnosticRetention.ts'); const list = [];
  for (let i = 0; i < 100; i++) c.retainDiagnostics(list, { i, payload: 'x'.repeat(1024) }, 20, 8000);
  assert.ok(list.length < 5); assert.equal(list.at(-1).i, 99);
});
test('MCP HTTP valida handshake, ID, erros JSON-RPC e deadline durante o corpo', async () => {
  const base = { url: 'https://fixture.invalid/mcp' }; let sent = [];
  const c = load('server/mcp-service.ts', { fetch: async (_, options) => {
    const rpc = JSON.parse(options.body); sent.push(rpc);
    const result = rpc.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } : { tools: [] };
    return rpc.id ? new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'fixture' } }) : new Response(null, { status: 202 });
  } });
  assert.equal((await c.testMcpServer(base, 100)).success, true); assert.deepEqual(sent.map(x => x.method), ['initialize', 'notifications/initialized', 'tools/list']);
  c.fetch = async () => new Response('{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"rejeitado"}}');
  assert.equal((await c.testMcpServer(base, 100)).success, false);
  c.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } }), { headers: { 'content-type': 'application/json' } });
  const started = Date.now(); assert.equal((await c.testMcpServer(base, 30)).success, false); assert.ok(Date.now() - started < 500);
});
test('MCP SSE legado: handshake completo e timeout ao esperar endpoint', async () => {
  let controller; const methods = [];
  const c = load('server/mcp-service.ts', { fetch: async (url, options) => {
    if (!options.method) return new Response(new ReadableStream({ start(stream) { controller = stream; stream.enqueue(new TextEncoder().encode('event: endpoint\ndata: /messages\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } });
    if (new URL(url).pathname === '/sse') return new Response(null, { status: 405 });
    const rpc = JSON.parse(options.body); methods.push(rpc.method);
    if (rpc.id) {
      const result = rpc.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'legacy', version: '1' } } : { tools: [] };
      controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result })}\n\n`));
    }
    return new Response(null, { status: 202 });
  } });
  assert.equal((await c.testMcpServer({ url: 'https://fixture.invalid/sse' }, 300)).success, true);
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list']);
  c.fetch = async (_, options) => options.method ? new Response(null, { status: 405 }) : new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/event-stream' } });
  assert.equal((await c.testMcpServer({ url: 'https://fixture.invalid/sse' }, 30)).success, false);
});
test('MCP stdio real: initialize/initialized/tools/list e falso --help rejeitado', async () => {
  const processService = load('server/process-service.ts');
  const c = load('server/mcp-service.ts', { terminateProcessTree: processService.terminateProcessTree });
  const python = `import sys,json\nfor line in sys.stdin:\n r=json.loads(line)\n if 'id' in r:\n  result={'protocolVersion':'2025-06-18','capabilities':{'tools':{}},'serverInfo':{'name':'fixture','version':'1'}} if r['method']=='initialize' else {'tools':[]}\n  print(json.dumps({'jsonrpc':'2.0','id':r['id'],'result':result}),flush=True)\n`;
  assert.equal((await c.testMcpServer({ command: '/usr/bin/python3', args: ['-u', '-c', python] }, 1500)).success, true);
  assert.equal((await c.testMcpServer({ command: '/bin/sh', args: ['-c', 'echo usage; exit 2'] }, 500)).success, false);
});
test('Versões: snapshots automáticos de criação/edição/exclusão e restauração da ausência', async t => {
  const dir = fixture(t), workspace = path.join(dir, 'project'), data = path.join(dir, 'data'); fs.mkdirSync(workspace); fs.mkdirSync(data);
  const c = load('server/versions-service.ts', { getGuiGeminiDir: () => data });
  fs.writeFileSync(path.join(workspace, 'edited.txt'), 'antes'); fs.writeFileSync(path.join(workspace, 'deleted.txt'), 'existia');
  const tracker = await c.beginAutomaticSnapshot({ prompt: 'edições', model: 'fixture', agentName: 'fixture', executionId: 'fixture', workspaceDir: workspace });
  fs.writeFileSync(path.join(workspace, 'edited.txt'), 'depois'); fs.unlinkSync(path.join(workspace, 'deleted.txt')); fs.writeFileSync(path.join(workspace, 'new.txt'), 'novo');
  const version = await tracker.finish(), before = c.listVersions().find(v => v.isBackup);
  assert.equal(version.manifest['deleted.txt'].exists, false); assert.equal(before.manifest['new.txt'].exists, false);
  assert.equal((await c.restoreVersion(before.id, workspace)).success, true);
  assert.equal(fs.readFileSync(path.join(workspace, 'edited.txt'), 'utf8'), 'antes'); assert.equal(fs.existsSync(path.join(workspace, 'new.txt')), false); assert.equal(fs.readFileSync(path.join(workspace, 'deleted.txt'), 'utf8'), 'existia');
  assert.equal((await c.restoreVersion(version.id, workspace)).success, true); assert.equal(fs.existsSync(path.join(workspace, 'deleted.txt')), false); assert.equal(fs.readFileSync(path.join(workspace, 'new.txt'), 'utf8'), 'novo');
  assert.equal((await c.restoreVersion(version.id, dir)).success, false);
});
test('ACP: invalida configuração, serializa inicialização e limita retenção', async t => {
  const dir = fixture(t); const c = load('server/acp-client.ts', { getGuiDataDir: () => dir, getResolvedCliPath: () => 'fixture', resolveExecutionAuthentication: () => ({ authentication: { mode: 'api-key', selectedType: 'gemini-api-key', configured: true }, apiKey: 'not-real' }), process: { ...process, once() {} } });
  const Session = vm.runInContext('AcpSession', c), manager = vm.runInContext('new AcpSessionManager()', c);
  let initialized = 0; Session.prototype.initializeSession = async function () { initialized++; await new Promise(r => setTimeout(r, 5)); this.isReady = true; };
  Session.prototype.cleanup = function () { this.isClosed = true; };
  const params = { model: 'A', workDir: dir };
  const [a, b] = await Promise.all([manager.getOrCreateSession('same', params), manager.getOrCreateSession('same', params)]); assert.equal(a, b); assert.equal(initialized, 1);
  const changed = await manager.getOrCreateSession('same', { ...params, model: 'B' }); assert.notEqual(changed, a); assert.equal(a.isClosed, true);
  for (let i = 0; i < 8; i++) await manager.getOrCreateSession(`s${i}`, params);
  assert.ok(manager.sessions.size <= 4);
});

test('Git: atualização normal interrompe diante de alterações locais ou divergência sem reset', async () => {
  const commands = [];
  const c = load('server/git-updater-service.ts', { runProcess: async (command, args) => { commands.push([command, ...args]); if (args[0] === 'merge') throw new Error('divergência'); return ''; } });
  c.getGitStatus = async () => ({ isGitRepo: true, hasUncommittedChanges: true });
  assert.equal((await c.performGitUpdate({ installDependencies: false, runBuild: false })).success, false);
  assert.equal(commands.some(c => c.includes('fetch') || c.includes('reset')), false);
  commands.length = 0; c.getGitStatus = async () => ({ isGitRepo: true, hasUncommittedChanges: false });
  assert.equal((await c.performGitUpdate({ installDependencies: false, runBuild: false })).success, false);
  assert.ok(commands.some(c => c.includes('--ff-only'))); assert.equal(commands.some(c => c.includes('reset')), false);
});
test('Git real em repositórios temporários: fast-forward, alteração local e divergência', async t => {
  const dir = fixture(t), remote = path.join(dir, 'remote.git'), workspace = path.join(dir, 'workspace'), publisher = path.join(dir, 'publisher');
  const env = { ...process.env, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (cwd, ...args) => childProcess.execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(dir, 'init', '--bare', '--initial-branch=main', remote); git(dir, 'clone', remote, workspace);
  const commit = (cwd, message) => { git(cwd, 'add', '.'); git(cwd, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', message); };
  fs.writeFileSync(path.join(workspace, 'file.txt'), 'initial'); commit(workspace, 'initial'); git(workspace, 'push', 'origin', 'main'); git(dir, 'clone', remote, publisher);
  fs.writeFileSync(path.join(publisher, 'file.txt'), 'remote update'); commit(publisher, 'remote update'); git(publisher, 'push', 'origin', 'main');
  const processes = load('server/process-service.ts', { spawn: (command, args, options) => childProcess.spawn(command, args, { ...options, env }) });
  const updater = load('server/git-updater-service.ts', { runProcess: processes.runProcess, process: { ...process, cwd: () => workspace } });
  const options = { repoUrl: remote, branch: 'main', installDependencies: false, runBuild: false, restartServer: false };
  assert.equal((await updater.performGitUpdate(options)).success, true); assert.equal(fs.readFileSync(path.join(workspace, 'file.txt'), 'utf8'), 'remote update');
  fs.writeFileSync(path.join(workspace, 'file.txt'), 'local uncommitted'); const head = git(workspace, 'rev-parse', 'HEAD');
  assert.equal((await updater.performGitUpdate(options)).success, false); assert.equal(fs.readFileSync(path.join(workspace, 'file.txt'), 'utf8'), 'local uncommitted'); assert.equal(git(workspace, 'rev-parse', 'HEAD'), head);
  commit(workspace, 'local commit'); fs.writeFileSync(path.join(publisher, 'remote.txt'), 'diverged'); commit(publisher, 'diverged'); git(publisher, 'push', 'origin', 'main');
  const divergentHead = git(workspace, 'rev-parse', 'HEAD'); assert.equal((await updater.performGitUpdate(options)).success, false); assert.equal(git(workspace, 'rev-parse', 'HEAD'), divergentHead); assert.equal(fs.existsSync(path.join(workspace, 'remote.txt')), false);
});
test('Processos reais: timeout é falha, não bloqueia o event loop e encerra o grupo', async () => {
  const c = load('server/process-service.ts'); let ticked = false;
  const timer = setTimeout(() => { ticked = true; }, 5);
  await assert.rejects(c.runProcess('/bin/sh', ['-c', 'sleep 30'], root, 30), /Timeout/);
  clearTimeout(timer); assert.equal(ticked, true);
  await assert.rejects(c.runProcess('/bin/sh', ['-c', 'kill -TERM $$'], root, 500), /signal=SIGTERM/);
  await assert.rejects(c.runProcess('/not-an-executable', [], root, 500));
});
test('Consulta real de versão: timeout encerra também o filho do wrapper', async t => {
  const dir = fixture(t), executable = path.join(dir, 'version-fixture'), pidFile = path.join(dir, 'child.pid');
  fs.writeFileSync(executable, `#!/bin/sh\nsleep 30 &\necho "$!" > "${pidFile}"\nwait\n`, { mode: 0o700 });
  const processes = load('server/process-service.ts');
  const cli = load('server/gemini-cli-service.ts', { terminateProcessTree: processes.terminateProcessTree, setTimeout: (callback, duration) => setTimeout(callback, Math.min(duration, 100)) });
  assert.equal(await cli.queryBinaryVersion(executable), '');
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  const alive = () => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2] !== 'Z'; } catch { return false; } };
  t.after(() => { if (alive()) process.kill(pid, 'SIGKILL'); });
  for (let i = 0; i < 30 && alive(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(alive(), false);
});
test('JSON: commit atômico preserva arquivo anterior em falha e último estado no debounce', async t => {
  const dir = fixture(t), file = path.join(dir, 'storage.json'); fs.writeFileSync(file, '{"previous":true}');
  const source = fs.readFileSync(path.join(root, 'server/projects-and-dirs-service.ts'), 'utf8');
  const segment = source.slice(source.indexOf('function commitStore'), source.indexOf('// Authorized Directories API'));
  const telemetry = file === 'src/utils/activityTraceUtils.ts' ? load('src/utils/telemetry.ts') : {};
  const classification = file === 'server/gemini-cli-service.ts' ? load('server/key-pool-service.ts') : {};
  const context = vm.createContext({ nativeCliHome: () => (globals.os || os).homedir(), getEquivalentAgentAliases: () => ({}), getModelAvailability: () => ({ eligible: 0, configured: 0 }), loadConfiguredKeys: () => ({}), unwrapTelemetry: telemetry.unwrapTelemetry, classifyKeyResult: classification.classifyKeyResult, beginForegroundExecution: () => () => {}, pathToFileURL, createRuntimeBridge: async () => ({ url: 'http://127.0.0.1:1', token: 'fixture', close() {} }), fs, process: { pid: process.pid, on() {} }, console, setTimeout, clearTimeout, sysLog: log, getStorageFilePath: () => file });
  vm.runInContext('let cachedStore = null; let saveTimer = null;' + stripTypeScriptTypes(segment, { mode: 'transform' }), context);
  context.fs = { ...fs, renameSync() { throw new Error('injected failure'); } };
  assert.throws(() => context.commitStore({ new: true })); assert.equal(JSON.parse(fs.readFileSync(file)).previous, true);
  context.fs = fs; context.saveStore({ revision: 1 }); context.saveStore({ revision: 2 });
  await new Promise(resolve => setTimeout(resolve, 350)); assert.equal(JSON.parse(fs.readFileSync(file)).revision, 2); assert.equal(fs.readdirSync(dir).length, 1);
});
test('ACP: erro durante prompt não encerra SSE antes do executor decidir fallback; cancelamento conclui uma vez', async () => {
  const c = load('server/acp-client.ts', { terminateProcessTree: () => {}, buildEffectiveSystemPrompt: () => '', buildExecutionPrompt: () => 'prompt', process: { ...process, once() {} } });
  const Session = vm.runInContext('AcpSession', c), session = new Session('s', root, 'm');
  session.child = { stdin: { write() {} }, kill() {} }; session.isReady = true; session.acpSessionId = 'acp';
  let errors = 0, done = 0;
  const params = { prompt: 'p', executionId: 'x', onEvent() {}, onError() { errors++; }, onDone() { done++; } };
  session.callMethod = async () => { throw new Error('prompt falhou'); };
  await assert.rejects(session.executePrompt(params), error => error.promptStarted === true); assert.equal(errors, 0); assert.equal(done, 0);
  let resolveRpc; session.callMethod = () => new Promise(resolve => { resolveRpc = resolve; });
  const pending = session.executePrompt(params); await session.cancelExecution('x'); resolveRpc({}); await pending; assert.equal(done, 1);
});
test('Compressão mantém resultados das ferramentas no contexto e retira payloads de auditoria', () => {
  const c = load('src/utils/executionContext.ts');
  const history = [{ id: 'm', role: 'assistant', content: 'resposta', rawPayloadReceived: { veryLarge: true }, toolCalls: [{ toolName: 'read_file', parameters: { path: 'a' }, result: 'resultado necessário', status: 'completed' }] }];
  const compact = c.compactExecutionHistory(history); assert.equal(compact[0].rawPayloadReceived, undefined); assert.match(c.toExecutorContext(compact)[0].content, /resultado necessário/); assert.equal(history[0].rawPayloadReceived.veryLarge, true);
});
test('Interface: carga inicial usa projetos novos, ignora seleção atrasada e bloqueia diretório indefinido', async () => {
  const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8'), project = { id: 'project', associatedDirs: ['/correct'] };
  const candidate = { id: 'saved', projectId: 'project', messages: [{ id: 'm', role: 'user', content: 'history' }] }, changes = {};
  const globals = { console: { log() {}, warn() {}, error() {} }, projects: [], sessions: [candidate], currentSessionId: 'saved', selectionRevision: { current: 0 }, currentSessionIdRef: { current: 'saved' }, localStorage: { setItem() {}, removeItem() {} }, refreshStatus() {}, handleNewSession() {}, switchToMostRecentValidSession() {}, fetchJsonSafely: async url => url === '/api/projects' ? [project] : url === '/api/sessions' ? [candidate] : url.startsWith('/api/sessions/') ? { ...candidate, id: url.split('/').at(-1) } : [] };
  for (const name of ['Projects', 'AuthorizedDirs', 'Agents', 'Skills', 'Commands', 'McpServers', 'Sessions', 'SessionLoading', 'ActiveProject', 'CurrentSessionId', 'Messages', 'CliSessionId', 'ExecutionContext']) globals[`set${name}`] = value => { changes[name] = value; };
  const context = vm.createContext(globals);
  const handlers = source.slice(source.indexOf('  const switchToMostRecentValidSession'), source.indexOf('  useEffect(() => {\n    loadAllData();'));
  vm.runInContext(stripTypeScriptTypes(handlers, { mode: 'transform' }), context);
  await vm.runInContext('loadAllData()', context); assert.equal(changes.ActiveProject, project); assert.equal(changes.SessionLoading, false);
  context.getMostRecentValidSession = (pool, excluded) => pool.find(session => session.id !== excluded);
  context.fetchJsonSafely = async url => url === '/api/projects' ? [project] : url === '/api/sessions' ? [{ ...candidate, messages: [] }, { ...candidate, id: 'fallback', messages: [] }] : url === '/api/sessions/saved' ? null : url === '/api/sessions/fallback' ? { ...candidate, id: 'fallback' } : [];
  await vm.runInContext('loadAllData()', context); assert.equal(changes.CurrentSessionId, 'fallback'); assert.equal(changes.ActiveProject, project);
  let finishOld; context.fetchJsonSafely = url => url.endsWith('/old') ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ ...candidate, id: 'new' });
  const old = vm.runInContext('handleSelectSession({id:"old", projectId:"project"}, [{id:"project",associatedDirs:["/correct"]}])', context);
  await vm.runInContext('handleSelectSession({id:"new", projectId:"project"}, [{id:"project",associatedDirs:["/correct"]}])', context);
  finishOld({ ...candidate, id: 'old' }); await old; assert.equal(changes.CurrentSessionId, 'new');
  const guard = source.slice(source.indexOf('  const handleSendMessage'), source.indexOf('    const promptTokens', source.indexOf('  const handleSendMessage'))) + 'return "ready"; };';
  Object.assign(context, { sessionLoading: true, isStreaming: false, activeProject: project, authorizedDirs: [], sessions: [candidate] });
  vm.runInContext(stripTypeScriptTypes(guard, { mode: 'transform' }), context);
  assert.equal(await vm.runInContext('handleSendMessage("prompt")', context), undefined);
  context.sessionLoading = false; context.activeProject = null; assert.equal(await vm.runInContext('handleSendMessage("prompt")', context), undefined);
  context.activeProject = project; assert.equal(await vm.runInContext('handleSendMessage("prompt")', context), 'ready');
});

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
function authenticationFixture(dir, options = {}) {
  const home = path.join(dir, 'native-home'); fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  const env = { GEMINI_CLI_HOME: home, GEMINI_CLI_SYSTEM_SETTINGS_PATH: path.join(dir, 'system.json'), GEMINI_CLI_SYSTEM_DEFAULTS_PATH: path.join(dir, 'defaults.json'), ...options.env };
  if (options.selectedType) fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: options.selectedType } } }));
  if (options.cachedOAuth) fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), JSON.stringify({ refresh_token: 'oauth-fixture-never-real' }));
  const keys = options.keys || { K1: 'fixture-not-real' };
  let poolCalls = 0;
  const bestKey = (_, excluded = []) => { poolCalls++; const entry = Object.entries(keys).find(([id]) => !excluded.includes(id)); return entry ? { keyId: entry[0], key: entry[1], latencyRank: 'L1' } : null; };
  const fakeProcess = { ...process, env, cwd: () => dir, once() {} };
  const c = load('server/cli-auth-service.ts', { loadConfiguredKeys: () => keys, getBestEligibleKey: bestKey, process: fakeProcess });
  return { c, process: fakeProcess, bestKey, home, env, get poolCalls() { return poolCalls; },
    globals: Object.fromEntries(['resolveCliAuthentication', 'resolveExecutionAuthentication', 'buildCliAuthEnvironment'].map(name => [name, c[name]])) };
}
function cliFixture(t, scenario, options = {}) {
  const dir = fixture(t), policy = load('server/execution-policy.ts'), retention = load('src/utils/diagnosticRetention.ts');
  const children = [], invocations = [], results = [], events = [];
  const auth = authenticationFixture(dir, { selectedType: 'gemini-api-key', ...options });
  class Tracker { constructor() { return new Proxy(this, { get: () => () => {} }); } }
  const c = load('server/gemini-cli-service.ts', {
    ...auth.globals, process: auth.process, ...(options.fastTimers ? { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)) } : {}), console: { ...console, log() {} }, getGuiDataDir: () => dir, AgentExecutionTracker: options.Tracker || Tracker, ...Object.fromEntries(['buildExecutionPrompt', 'consumeSessionRecovery', 'executionFailed', 'summarizeExecution', 'validateExecutionContext'].map(name => [name, policy[name]])), retainDiagnostics: retention.retainDiagnostics,
    acpManager: { cancelExecution() { return false; } }, terminateProcessTree(child) { if (child.closed || child.killed) return; child.killed = true; setTimeout(() => child.emit('close', null, 'SIGKILL'), 0); }, recordRuntimeExecutionResult: (...args) => results.push(args),
    getBestEligibleKey: auth.bestKey, maskApiKey: () => '***',
    spawn(command, args, options) {
      invocations.push({ command, args, options, system: options.env.GEMINI_SYSTEM_MD ? fs.readFileSync(options.env.GEMINI_SYSTEM_MD, 'utf8') : '' });
      const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
      child.prependOnceListener('close', () => { child.closed = true; }); children.push(child); setTimeout(() => scenario(child, children.length), 0); return child;
    },
  });
  c.getExaAuditTools = () => ({ tools: [], discoverySource: 'fixture' }); c.getResolvedCliPath = () => '/bin/sh'; c.isExistingSession = () => false;
  c.loadAgents = () => options.agents || [{ id: 'principal', name: 'principal', model: 'fixture-model' }]; c.syncAgentsToSettings = () => {}; c.syncPoliciesToSettings = () => {}; c.ensureAllAgentsSynchronizedAndAcknowledged = () => ({ acknowledgedCount: 0 }); c.buildEffectiveSystemPrompt = () => 'instruções';
  c.resolveEffectiveCliConfig = async () => { const file = path.join(dir, `config-${crypto.randomUUID()}.json`); fs.writeFileSync(file, '{}'); return file; };
  const execute = (overrides = {}) => new Promise((resolve, reject) => c.executeGeminiCli({ prompt: 'continue', sessionId: crypto.randomUUID(), workDir: dir, resume: false, sharedMemory: 'memória validada', contextMessages: [{ role: 'user', content: 'histórico anterior' }], onEvent: event => events.push(plain(event)), onError: error => resolve({ error }), onDone: (code, signal) => resolve({ code, signal }), ...overrides }, false, { retryCount: 3, fallbackChain: [] }));
  return { c, execute, events, children, invocations, results, auth, dir };
}
test('Executor real com subprocesso simulado: limita recuperação de sessão e propaga UUID/contexto/memória', async t => {
  const f = cliFixture(t, child => { child.stderr.write('Invalid session identifier'); child.emit('close', 42, null); });
  const outcome = await f.execute(); assert.match(outcome.error.message, /Recuperação de sessão esgotada/); assert.equal(f.children.length, 3);
  assert.equal(new Set(f.events.filter(event => event.type === 'session_changed').map(event => event.data.sessionId)).size, 3);
  assert.match(f.invocations[0].args.join(' '), /histórico anterior/); assert.match(f.invocations[0].system, /memória validada/);
});
test('Executor real com subprocesso simulado: quota estruturada com exit 0 e signal/null não viram sucesso', async t => {
  const quota = cliFixture(t, child => { child.stdout.write(JSON.stringify({ type: 'result', status: 'error', error: { message: 'RESOURCE_EXHAUSTED quota 429' } }) + '\n'); child.emit('close', 0, null); });
  assert.equal((await quota.execute()).code, 1); assert.ok(quota.results.every(result => result[2].success === false));
  const signal = cliFixture(t, child => child.emit('close', null, 'SIGTERM'));
  assert.equal((await signal.execute()).code, 1); assert.ok(signal.results.every(result => result[2].success === false));
});
test('Executor real com subprocesso simulado: envia cada captura uma vez e cancela processo desconectado', async t => {
  const f = cliFixture(t, child => {
    for (let i = 0; i < 100; i++) child.stdout.write(JSON.stringify({ type: 'final_api_request', requestId: `r${i}`, finalApiRequest: { model: 'fixture', contents: 'x'.repeat(1024) } }) + '\n');
    child.stdout.end(); child.stdout.once('end', () => child.emit('close', 0, null));
  });
  assert.equal((await f.execute()).code, 0);
  const captures = f.events.filter(e => e.type === 'final_api_request'); assert.equal(captures.length, 100); assert.ok(captures.every(e => !e.data.allRealRequests)); assert.ok(JSON.stringify(captures).length < 250000);
  const cancelled = cliFixture(t, () => {}); const id = `exec-${crypto.randomUUID()}`; const execution = cancelled.execute({ executionId: id });
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(cancelled.c.cancelExecutionById(id), true); assert.equal((await execution).signal, 'SIGKILL'); assert.equal(cancelled.children[0].killed, true);
});
test('Executor: ID duplicado e sessão ACP ocupada preservam a execução anterior', async t => {
  const f = cliFixture(t, () => {}), id = `exec-${crypto.randomUUID()}`;
  const first = f.execute({ executionId: id }); await new Promise(resolve => setTimeout(resolve, 5));
  let duplicateError;
  f.c.executeGeminiCli({ executionId: id, onError: error => { duplicateError = error; } });
  assert.match(duplicateError.message, /Já existe/); assert.equal(f.children[0].killed, undefined);
  f.c.cancelExecutionById(id); await first;
  const legacyId = `legacy-${crypto.randomUUID()}`, normalizedExecution = f.execute({ executionId: legacyId, sessionId: 'legacy-session' });
  await new Promise(resolve => setTimeout(resolve, 5));
  const cliId = f.events.filter(event => event.type === 'session_changed').at(-1).data.sessionId;
  assert.equal(f.c.isValidUUID(cliId), true); assert.ok(f.invocations.at(-1).args.includes(cliId));
  f.c.cancelExecutionById(legacyId); await normalizedExecution;
  let removed = 0;
  f.c.process = { ...process, env: { ...process.env, GEMINI_GUI_PERSISTENT: '1' } };
  f.c.acpManager = { async getOrCreateSession() { throw Object.assign(new Error('Sessão ACP ocupada.'), { promptStarted: true }); }, removeSession() { removed++; } };
  const outcome = await f.execute({ executionId: crypto.randomUUID() }); assert.match(outcome.error.message, /ocupada/); assert.equal(removed, 0);
});

test('OAuth: principal e subagente executam com pool vazio e sem variáveis de API key; invoke_agent é preservado', async t => {
  for (const agentId of ['principal', 'worker']) {
    const f = cliFixture(t, child => {
      for (const event of [{ type: 'tool_use', tool_name: 'invoke_agent', tool_id: 'invoke-1', parameters: { agent_name: 'worker', prompt: 'fixture' } },
        { type: 'tool_result', tool_name: 'invoke_agent', tool_id: 'invoke-1', status: 'success', output: 'fixture result' },
        { type: 'message', role: 'assistant', content: 'OK' }, { type: 'result', status: 'success' }]) child.stdout.write(JSON.stringify(event) + '\n');
      child.emit('close', 0, null);
    }, { selectedType: 'oauth-personal', cachedOAuth: true, keys: {}, env: { GEMINI_API_KEY: 'residual-1', GOOGLE_API_KEY: 'residual-2', GOOGLE_GENAI_API_KEY: 'residual-3' },
      agents: [{ id: 'principal', name: 'principal', model: 'main-model' }, { id: 'worker', name: 'worker', model: 'worker-model' }] });
    const before = fs.readFileSync(path.join(f.auth.home, '.gemini', 'oauth_creds.json'));
    assert.equal((await f.execute({ agentId })).code, 0);
    assert.equal(f.auth.poolCalls, 0); assert.equal(f.results.length, 0);
    const env = f.invocations[0].options.env;
    for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY']) assert.equal(Object.hasOwn(env, key), false);
    assert.equal(env.GOOGLE_GENAI_USE_GCA, 'true'); assert.equal(f.auth.env.GEMINI_API_KEY, 'residual-1');
    assert.ok(f.events.some(event => event.type === 'stream_event' && event.data.tool_name === 'invoke_agent'));
    assert.deepEqual(fs.readFileSync(path.join(f.auth.home, '.gemini', 'oauth_creds.json')), before);
    if (agentId === 'principal') assert.match(f.invocations[0].system, /invoke_agent/);
  }
});

test('API key: pool, ranking e failover K1→K2 continuam funcionando para principal e subagente', async t => {
  for (const agentId of ['principal', 'worker']) {
    const f = cliFixture(t, (child, attempt) => {
      child.stdout.write(JSON.stringify(attempt === 1 ? { type: 'result', status: 'error', error: { message: 'RESOURCE_EXHAUSTED quota 429' } } : { type: 'result', status: 'success' }) + '\n');
      child.emit('close', attempt === 1 ? 1 : 0, null);
    }, { selectedType: 'gemini-api-key', keys: { K1: 'fixture-k1', K2: 'fixture-k2' }, fastTimers: true });
    assert.equal((await f.execute({ agentId })).code, 0);
    assert.equal(f.invocations.length, 2);
    for (const key of ['GEMINI_API_KEY']) {
      assert.equal(f.invocations[0].options.env[key], 'fixture-k1'); assert.equal(f.invocations[1].options.env[key], 'fixture-k2');
    }
    assert.equal(f.results[0][1], 'K1'); assert.equal(f.results[0][2].success, false);
    assert.equal(f.results.at(-1)[1], 'K2'); assert.equal(f.results.at(-1)[2].success, true);
    assert.ok(f.events.some(event => event.type === 'runtime_event' && event.data?.event === 'KEY_FAILOVER'));
  }
});

const dualKeyNotice = 'Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY.';
test('Aviso de duas variáveis sozinho não transforma sucesso em falha de autenticação', async t => {
  const f = cliFixture(t, child => { child.stderr.write(dualKeyNotice); child.emit('close', 0, null); },
    { selectedType: 'gemini-api-key', keys: { K1: 'fixture-k1' } });
  assert.equal((await f.execute()).code, 0);
  assert.equal(f.invocations.length, 1); assert.equal(f.results[0][2].success, true);
});
test('Aviso não mascara API_KEY_INVALID, chave inválida, 401 ou 403 no mesmo stderr/resultado', async t => {
  for (const [message, structured] of [['API_KEY_INVALID: API key not valid (400)', false], ['invalid api key (400)', false], ['HTTP 401 unauthenticated', false], ['HTTP 403 unauthorized', false], ['API_KEY_INVALID: API key not valid (400)', true]]) {
    const f = cliFixture(t, child => {
      child.stderr.write(dualKeyNotice + (structured ? '' : ' ' + message));
      if (structured) child.stdout.write(JSON.stringify({ type: 'result', status: 'error', error: { message } }) + '\n');
      child.emit('close', 1, null);
    }, { selectedType: 'gemini-api-key', keys: { K1: 'fixture-k1' }, fastTimers: true });
    const result = await f.execute({ fallbackModel: 'fallback-model' });
    assert.equal(result.code, 1);
    assert.match(f.events.filter(event => event.type === 'process_error').at(-1).data.message, /autenticação/i, message);
    assert.equal(f.invocations.length, 1); // Auth inválida não ganha um novo fallback de modelo.
  }
});
test('API_KEY_INVALID com aviso aciona K1→K2 para principal e subagente sem perder invoke_agent', async t => {
  for (const agentId of ['principal', 'worker']) {
    const f = cliFixture(t, (child, attempt) => {
      child.stderr.write(dualKeyNotice);
      for (const event of attempt === 1 ? [{ type: 'result', status: 'error', error: { message: 'API_KEY_INVALID: API key not valid (400)' } }]
        : [{ type: 'tool_use', tool_name: 'invoke_agent', tool_id: 'invoke-auth', parameters: { agent_name: 'worker' } },
          { type: 'tool_result', tool_name: 'invoke_agent', tool_id: 'invoke-auth', status: 'success', output: 'OK' }, { type: 'result', status: 'success' }]) child.stdout.write(JSON.stringify(event) + '\n');
      child.emit('close', attempt === 1 ? 1 : 0, null);
    }, { selectedType: 'gemini-api-key', keys: { K1: 'fixture-k1', K2: 'fixture-k2' }, fastTimers: true });
    assert.equal((await f.execute({ agentId, fallbackModel: 'fallback-model' })).code, 0);
    assert.deepEqual(f.invocations.map(call => call.options.env.GEMINI_API_KEY), ['fixture-k1', 'fixture-k2']);
    assert.ok(f.events.some(event => event.type === 'runtime_event' && event.data?.event === 'KEY_FAILOVER'));
    assert.ok(f.events.some(event => event.data?.tool_name === 'invoke_agent'));
    assert.ok(!f.events.some(event => event.type === 'runtime_event' && event.data?.event === 'MODEL_FALLBACK'));
  }
});
test('Modelo de fallback só entra após esgotar chaves do modelo original, preservando identidade e contexto', async t => {
  const f = cliFixture(t, (child, attempt) => {
    child.stderr.write(dualKeyNotice);
    child.stdout.write(JSON.stringify(attempt < 3 ? { type: 'result', status: 'error', error: { message: attempt === 1 ? 'API_KEY_INVALID: API key not valid (400)' : 'RESOURCE_EXHAUSTED quota 429' } } : { type: 'result', status: 'success' }) + '\n');
    child.emit('close', attempt < 3 ? 1 : 0, null);
  }, { selectedType: 'gemini-api-key', keys: { K1: 'fixture-k1', K2: 'fixture-k2' }, fastTimers: true });
  assert.equal((await f.execute({ agentId: 'principal', fallbackModel: 'fallback-model' })).code, 0);
  assert.deepEqual(f.invocations.map(call => call.options.env.GEMINI_API_KEY), ['fixture-k1', 'fixture-k2', 'fixture-k1']);
  assert.ok(f.invocations.slice(0, 2).every(call => !call.args.includes('fallback-model')));
  assert.ok(f.invocations[2].args.includes('fallback-model')); assert.match(f.invocations[2].system, /memória validada/);
  const messages = f.events.filter(event => event.type === 'runtime_event').map(event => event.data.event);
  assert.ok(messages.indexOf('KEY_FAILOVER') < messages.indexOf('MODEL_FALLBACK'));
});

test('OAuth: fallback de modelo mantém método, contexto e identidade sem consultar Key Pool', async t => {
  const f = cliFixture(t, (child, attempt) => {
    child.stdout.write(JSON.stringify(attempt === 1 ? { type: 'result', status: 'error', error: { message: 'RESOURCE_EXHAUSTED quota 429' } } : { type: 'result', status: 'success' }) + '\n');
    child.emit('close', attempt === 1 ? 1 : 0, null);
  }, { selectedType: 'oauth-personal', cachedOAuth: true, keys: {}, fastTimers: true });
  assert.equal((await f.execute({ agentId: 'principal', fallbackModel: 'fallback-model' })).code, 0);
  assert.equal(f.invocations.length, 2); assert.equal(f.auth.poolCalls, 0); assert.equal(f.results.length, 0);
  assert.ok(f.invocations[1].args.includes('fallback-model')); assert.match(f.invocations[1].system, /memória validada/);
  assert.ok(f.events.some(event => event.type === 'runtime_event' && event.data?.event === 'MODEL_FALLBACK'));
});

test('Sem autenticação real: erro específico, nenhum subprocesso e liberação da execução', async t => {
  const f = cliFixture(t, () => assert.fail('Não deveria executar'), { selectedType: undefined, keys: {} });
  const outcome = await f.execute({ executionId: 'unauthenticated' });
  assert.equal(outcome.error.code, 'AUTH_NOT_CONFIGURED'); assert.match(outcome.error.message, /não autenticado/);
  assert.equal(f.invocations.length, 0); assert.equal(f.c.getExecutionState('unauthenticated'), undefined);
  assert.equal(f.events.find(event => event.type === 'error').data.code, 'AUTH_NOT_CONFIGURED');
});

test('Status e validação distinguem OAuth, API key e ausência de autenticação sem sondar API no OAuth', async t => {
  for (const mode of ['oauth', 'api-key', 'none']) {
    const f = cliFixture(t, () => {}, { selectedType: mode === 'oauth' ? 'oauth-personal' : mode === 'api-key' ? 'gemini-api-key' : undefined,
      cachedOAuth: mode === 'oauth', keys: mode === 'api-key' ? { K1: 'fixture-k1' } : {} });
    let networkCalls = 0; f.c.fetch = async () => { networkCalls++; return { ok: true }; };
    f.c.getResolvedCliPath = f.c.getLocalCliPath = () => '/fixture/node_modules/.bin/gemini'; f.c.getGlobalCliPath = () => '/fixture/global/gemini';
    f.c.queryBinaryVersion = async () => '0.60.0';
    const status = await f.c.detectCliStatus(); const validation = await f.c.validateCliAuthentication();
    assert.equal(status.authMode, mode); assert.equal(status.authConfigured, mode !== 'none'); assert.equal(validation.valid, mode !== 'none');
    if (mode === 'oauth') { assert.equal(status.authState, 'authenticated'); assert.equal(status.apiValid, undefined); assert.equal(status.maskedApiKey, undefined); assert.equal(validation.checked, false); }
    if (mode === 'api-key') { assert.equal(status.apiValid, undefined); assert.equal(status.maskedApiKey, '***'); assert.equal(validation.checked, false); }
    assert.equal(networkCalls, 0, 'status passivo não sonda provedor');
    const explicit = await f.c.validateCliAuthentication(true);
    if (mode === 'api-key') assert.equal(explicit.checked, true);
    assert.equal(networkCalls, mode === 'api-key' ? 1 : 0);
  }
});

test('Configuração nativa: JSON com comentários, precedência, ambiente OAuth e configurações efêmeras', async t => {
  const dir = fixture(t), auth = authenticationFixture(dir, { selectedType: 'oauth-personal', keys: { K1: 'residual-pool' }, env: { GEMINI_API_KEY: 'residual-env' } });
  const settings = path.join(auth.home, '.gemini', 'settings.json');
  fs.writeFileSync(settings, '// native preference\n{"security":{"auth":{"selectedType":"oauth-personal"}},"url":"https://example.test"}');
  assert.equal(auth.c.resolveCliAuthentication(dir).mode, 'oauth'); assert.equal(auth.poolCalls, 0);
  const cli = load('server/gemini-cli-service.ts', { ...auth.globals, process: auth.process, getResolvedCliPath: () => 'fixture', getGuiDataDir: () => path.join(dir, 'gui'), loadMcpSettings() {}, loadAgents: () => [] });
  const before = fs.readFileSync(settings);
  const runtime = await cli.resolveEffectiveCliConfig(dir, 'oauth-config');
  assert.equal(JSON.parse(fs.readFileSync(runtime)).security.auth.selectedType, 'oauth-personal'); assert.deepEqual(fs.readFileSync(settings), before);
  fs.writeFileSync(auth.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, '{"security":{"auth":{"selectedType":"gemini-api-key"}}}');
  assert.equal(auth.c.resolveCliAuthentication(dir).mode, 'api-key');
  fs.writeFileSync(settings, '{invalid'); assert.throws(() => auth.c.resolveCliAuthentication(dir));
  const envAuth = authenticationFixture(fixture(t), { keys: {}, env: { GOOGLE_GENAI_USE_GCA: 'true', GEMINI_API_KEY: 'residual' } });
  assert.equal(envAuth.c.resolveCliAuthentication().mode, 'oauth');
  const adcAuth = authenticationFixture(fixture(t), { keys: { K1: 'unused-pool' }, env: { GEMINI_CLI_USE_COMPUTE_ADC: 'true' } });
  assert.equal(adcAuth.c.resolveExecutionAuthentication('fixture').authentication.selectedType, 'compute-default-credentials');
  assert.equal(adcAuth.poolCalls, 0);
});

test('ACP: OAuth não herda API keys, API key usa pool e troca do método invalida a sessão', async t => {
  for (const mode of ['oauth-personal', 'gemini-api-key']) {
    const dir = fixture(t), auth = authenticationFixture(dir, { selectedType: mode, keys: { K1: 'fixture-k1' }, env: { GEMINI_API_KEY: 'residual' } });
    let environment;
    const c = load('server/acp-client.ts', { ...auth.globals, process: auth.process, console: { ...console, log() {} }, readline: await import('node:readline'),
      getGuiDataDir: () => dir, getResolvedCliPath: () => 'fixture', syncAgentsToSettings() {}, syncPoliciesToSettings() {}, ensureAllAgentsSynchronizedAndAcknowledged() {},
      resolveEffectiveCliConfig: async () => { const file = path.join(dir, 'runtime.json'); fs.writeFileSync(file, '{}'); return file; },
      terminateProcessTree() {}, spawn(_, args, options) { environment = options.env; const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.stderr = new PassThrough(); return child; } });
    const Session = vm.runInContext('AcpSession', c), manager = vm.runInContext('new AcpSessionManager()', c);
    Session.prototype.callMethod = async method => method === 'session/new' ? { sessionId: 'fixture-acp' } : {};
    const session = await manager.getOrCreateSession('session', { workDir: dir, model: 'fixture-model' });
    if (mode === 'oauth-personal') {
      for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY']) assert.equal(Object.hasOwn(environment, key), false);
      assert.equal(auth.poolCalls, 0);
      fs.writeFileSync(path.join(auth.home, '.gemini', 'settings.json'), '{"security":{"auth":{"selectedType":"gemini-api-key"}}}');
      const replaced = await manager.getOrCreateSession('session', { workDir: dir, model: 'fixture-model' });
      assert.notEqual(replaced, session); assert.equal(session.isClosed, true); assert.equal(environment.GEMINI_API_KEY, 'fixture-k1');
    } else assert.equal(environment.GEMINI_API_KEY, 'fixture-k1');
    manager.removeSession('session');
  }
});

test('Teste de agente usa o executor CLI com OAuth e sem pool', async t => {
  const f = cliFixture(t, child => { child.stdout.write('{"type":"message","role":"assistant","content":"OK"}\n'); child.emit('close', 0, null); }, { selectedType: 'oauth-personal', cachedOAuth: true, keys: {} });
  const result = await f.c.testCliAgentConnection({ model: 'fixture-model', workDir: f.dir });
  assert.equal(result.text, 'OK'); assert.equal(f.auth.poolCalls, 0); assert.equal(f.invocations.length, 1);
});

test('Rota de teste de agentes: OAuth via CLI, API key via pool e ausência real de autenticação', async t => {
  const source = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
  const snippet = source.slice(source.indexOf("  app.post('/api/agents/test'"), source.indexOf("  app.post('/api/agents/reset-defaults'"))
    .replace("await import('@google/genai')", 'await sdkFactory()');
  for (const mode of ['oauth', 'api-key', 'none']) {
    const dir = fixture(t), auth = authenticationFixture(dir, { keys: mode === 'api-key' ? { K1: 'route-fixture-key' } : {},
      selectedType: mode === 'oauth' ? 'oauth-personal' : mode === 'api-key' ? 'gemini-api-key' : undefined });
    let handler, cliCalls = 0, sdkKey;
    const context = vm.createContext({  console: { ...console, error() {} }, process: auth.process, AbortController, ...auth.globals,
      getResolvedCliPath: () => 'fixture', app: { post(route, callback) { assert.equal(route, '/api/agents/test'); handler = callback; } },
      testCliAgentConnection: async () => { cliCalls++; return { text: 'OK', latencyMs: 1 }; },
      sdkFactory: async () => ({ Modality: { AUDIO: 'AUDIO' }, GoogleGenAI: class { constructor(options) { sdkKey = options.apiKey; this.models = { generateContent: async () => ({ text: 'OK' }) }; } } }) });
    vm.runInContext(stripTypeScriptTypes(snippet, { mode: 'transform' }), context);
    const response = new EventEmitter(); response.statusCode = 200;
    response.status = code => { response.statusCode = code; return response; }; response.json = data => { response.body = data; response.writableEnded = true; return response; };
    await handler({ body: { model: 'fixture-model', workDir: dir } }, response);
    assert.equal(response.statusCode, mode === 'none' ? 400 : 200); assert.equal(response.body.success, mode !== 'none');
    assert.equal(cliCalls, mode === 'oauth' ? 1 : 0); assert.equal(sdkKey, mode === 'api-key' ? 'route-fixture-key' : undefined);
    if (mode === 'none') assert.equal(response.body.code, 'AUTH_NOT_CONFIGURED');
    assert.equal(Object.hasOwn(auth.env, 'GEMINI_API_KEY'), false);
    if (mode === 'oauth') {
      await handler({ body: { model: 'voice-model', type: 'voice', workDir: dir } }, response);
      assert.equal(response.statusCode, 422); assert.equal(response.body.code, 'AUTH_CAPABILITY_UNSUPPORTED');
    }
  }
});

test('CLI Snap: seleção lê o HOME do launcher e respeita override GEMINI_CLI_HOME', t => {
  const dir = fixture(t), native = path.join(dir, 'snap', 'gemini-cli', 'common', '.gemini'); fs.mkdirSync(native, { recursive: true });
  fs.writeFileSync(path.join(native, 'settings.json'), '{"security":{"auth":{"selectedType":"oauth-personal"}}}');
  fs.writeFileSync(path.join(native, 'oauth_creds.json'), '{"refresh_token":"snap-fixture-never-real"}');
  const c = load('server/cli-auth-service.ts', { os: { ...os, homedir: () => dir }, getBestEligibleKey: () => assert.fail('Pool não deve ser consultado no OAuth'), loadConfiguredKeys: () => ({}),
    fs: { ...fs, readlinkSync: () => 'gemini-cli.gemini', existsSync: file => file === '/snap/bin/gemini' || fs.existsSync(file),
      readFileSync: (file, ...args) => file === '/snap/gemini-cli/current/meta/snap.yaml' ? 'apps:\n  gemini:\n    environment:\n      HOME: $SNAP_USER_COMMON\n' : fs.readFileSync(file, ...args) } });
  const env = { PATH: '/snap/bin', GEMINI_CLI_SYSTEM_SETTINGS_PATH: path.join(dir, 'system.json'), GEMINI_CLI_SYSTEM_DEFAULTS_PATH: path.join(dir, 'defaults.json') };
  const auth = c.resolveCliAuthentication(dir, env, 'gemini'); assert.equal(auth.mode, 'oauth'); assert.equal(auth.state, 'authenticated');
  assert.equal(c.resolveCliAuthentication(dir, { ...env, GEMINI_CLI_HOME: path.join(dir, 'override') }, 'gemini').mode, 'none');
});

test('Pool preenchido sem método nativo não seleciona API key nem é consultado para escolher autenticação', t => {
  const dir = fixture(t), home = path.join(dir, 'home'); fs.mkdirSync(home);
  const c = load('server/cli-auth-service.ts', { os: { ...os, homedir: () => home },
    loadConfiguredKeys: () => assert.fail('Pool não escolhe autenticação'), getBestEligibleKey: () => assert.fail('Pool não deve ser consultado sem modo API key') });
  const env = { GEMINI_CLI_HOME: home, GEMINI_CLI_SYSTEM_SETTINGS_PATH: path.join(dir, 'system.json'), GEMINI_CLI_SYSTEM_DEFAULTS_PATH: path.join(dir, 'defaults.json') };
  c.process = { ...process, env, cwd: () => dir };
  assert.equal(c.resolveCliAuthentication(dir).mode, 'none');
  assert.throws(() => c.resolveExecutionAuthentication('fixture', dir), { code: 'AUTH_NOT_CONFIGURED' });
});
test('Perfil OAuth Snap com launcher emulado é respeitado pelo CLI local com pool preenchido e chaves residuais', t => {
  const dir = fixture(t), home = path.join(dir, 'home'), gui = path.join(dir, 'gui'), workspace = path.join(dir, 'workspace');
  const snapHome = path.join(home, 'snap', 'gemini-cli', 'common'), native = path.join(snapHome, '.gemini');
  for (const p of [native, gui, workspace]) fs.mkdirSync(p, { recursive: true });
  const settings = path.join(native, 'settings.json'), credentials = path.join(native, 'oauth_creds.json');
  fs.writeFileSync(settings, '{"security":{"auth":{"selectedType":"oauth-personal"}},"mcpServers":{"personal":{"command":"mine"}}}');
  fs.writeFileSync(credentials, '{"refresh_token":"snap-fixture-not-real"}');
  const before = [settings, credentials].map(p => fs.readFileSync(p));
  const local = path.join(gui, 'node_modules', '.bin', 'gemini'); let poolCalls = 0;
  const env = { PATH: `${path.dirname(local)}:/snap/bin`, GEMINI_CLI_SYSTEM_SETTINGS_PATH: path.join(dir, 'system.json'), GEMINI_CLI_SYSTEM_DEFAULTS_PATH: path.join(dir, 'defaults.json'), GEMINI_API_KEY: 'residual', GOOGLE_API_KEY: 'residual', GOOGLE_GENAI_API_KEY: 'residual' };
  const fakeFs = { ...fs, readlinkSync: p => p === '/snap/bin/gemini' ? 'gemini-cli.gemini' : fs.readlinkSync(p),
    existsSync: p => p === '/snap/bin/gemini' || p === local || fs.existsSync(p),
    readFileSync: (p, ...args) => p === '/snap/gemini-cli/current/meta/snap.yaml' ? 'apps:\n  gemini:\n    environment:\n      HOME: $SNAP_USER_COMMON\n' : fs.readFileSync(p, ...args),
    realpathSync: p => { if (p === '/snap/bin/gemini') assert.fail('Não resolver a identidade Snap para /usr/bin/snap'); return fs.realpathSync(p); } };
  const fakeProcess = { ...process, env, cwd: () => gui };
  const auth = load('server/cli-auth-service.ts', { fs: fakeFs, os: { ...os, homedir: () => home }, process: fakeProcess,
    loadConfiguredKeys: () => ({ K1: 'filled-pool-fixture' }), getBestEligibleKey: () => { poolCalls++; return { key: 'filled-pool-fixture', keyId: 'K1' }; } });
  const selection = auth.resolveExecutionAuthentication('fixture', workspace, [], local);
  assert.equal(selection.authentication.mode, 'oauth'); assert.equal(selection.authentication.nativeHome, snapHome);
  assert.equal(selection.apiKey, undefined); assert.equal(poolCalls, 0);
  const childEnv = auth.buildCliAuthEnvironment(selection.authentication, selection.apiKey);
  assert.equal(childEnv.GEMINI_CLI_HOME, snapHome);
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY']) assert.equal(Object.hasOwn(childEnv, key), false);
  const childAuth = auth.resolveCliAuthentication(workspace, childEnv, local);
  assert.equal(childAuth.mode, 'oauth'); assert.equal(childAuth.nativeHome, snapHome);
  const cli = load('server/gemini-cli-service.ts', { fs: fakeFs, process: fakeProcess });
  assert.equal(cli.getResolvedCliPath(), local); // Preserva os patches e o executor atual.
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), '{"security":{"auth":{"selectedType":"gemini-api-key"}}}');
  assert.equal(auth.resolveExecutionAuthentication('fixture', workspace, [], local).authentication.nativeHome, snapHome);
  assert.equal(poolCalls, 0); // Configuração do host não muda o perfil Snap.
  assert.equal(auth.resolveCliAuthentication(workspace, { ...env, GEMINI_CLI_HOME: home }, local).mode, 'api-key');
  assert.deepEqual([settings, credentials].map(p => fs.readFileSync(p)), before);
});

test('Agentes do perfil Snap: sincroniza somente arquivos da GUI no HOME nativo e preserva agentes/credenciais pessoais', t => {
  const dir = fixture(t), host = path.join(dir, 'host'), snap = path.join(dir, 'snap'), gui = path.join(dir, 'gui'), workspace = path.join(dir, 'workspace');
  for (const home of [host, snap]) fs.mkdirSync(path.join(home, '.gemini', 'agents'), { recursive: true });
  fs.mkdirSync(gui); fs.mkdirSync(workspace);
  const hostAgent = path.join(host, '.gemini', 'agents', 'personal.md'), snapAgent = path.join(snap, '.gemini', 'agents', 'worker.md');
  const settings = path.join(snap, '.gemini', 'settings.json'), credentials = path.join(snap, '.gemini', 'oauth_creds.json');
  fs.writeFileSync(hostAgent, 'Personal host agent'); fs.writeFileSync(snapAgent, 'Personal Snap worker');
  fs.writeFileSync(settings, '{"security":{"auth":{"selectedType":"oauth-personal"}},"mcpServers":{"mine":{"command":"personal"}}}');
  fs.writeFileSync(credentials, '{"refresh_token":"fixture-never-real"}');
  const before = [hostAgent, snapAgent, settings, credentials].map(p => fs.readFileSync(p));
  const agents = load('server/agents-service.ts', { os: { ...os, homedir: () => host }, getGuiDataDir: () => gui, buildEffectiveSystemPrompt: () => 'GUI prompt' });
  agents.loadAgents = () => [{ id: 'principal', name: 'principal' }, { id: 'worker', name: 'worker' }]; agents.loadMetadata = () => ({});
  const result = agents.ensureAllAgentsSynchronizedAndAcknowledged(workspace, snap);
  assert.ok(result.directories.includes(path.join(snap, '.gemini', 'agents')));
  assert.equal(fs.existsSync(path.join(host, '.gemini', 'agents', 'principal.md')), false);
  const principal = path.join(snap, '.gemini', 'agents', 'principal.md');
  assert.match(fs.readFileSync(principal, 'utf8'), /GUI prompt/);
  const ack = JSON.parse(fs.readFileSync(path.join(snap, '.gemini', 'acknowledgments', 'agents.json')));
  assert.equal(ack[principal], crypto.createHash('sha256').update(fs.readFileSync(principal)).digest('hex'));
  assert.deepEqual([hostAgent, snapAgent, settings, credentials].map(p => fs.readFileSync(p)), before);
});
test('Principal e subagente recebem o HOME OAuth nativo, sem chaves do pool e com invoke_agent intacto', async t => {
  for (const agentId of ['principal', 'worker']) {
    const f = cliFixture(t, child => {
      child.stdout.write('{"type":"tool_use","tool_name":"invoke_agent","tool_id":"native-invoke","parameters":{"agent_name":"worker"}}\n');
      child.stdout.write('{"type":"tool_result","tool_name":"invoke_agent","tool_id":"native-invoke","status":"success","output":"OK"}\n');
      child.emit('close', 0, null);
    }, { selectedType: 'oauth-personal', keys: { K1: 'must-not-be-injected' } });
    const snap = path.join(f.dir, 'snap-home'); fs.mkdirSync(path.join(snap, '.gemini'), { recursive: true });
    fs.writeFileSync(path.join(snap, '.gemini', 'settings.json'), '{"security":{"auth":{"selectedType":"oauth-personal"}}}');
    f.auth.env.GEMINI_CLI_HOME = snap;
    let syncedHome; f.c.ensureAllAgentsSynchronizedAndAcknowledged = (_cwd, home) => { syncedHome = home; return { acknowledgedCount: 0 }; };
    assert.equal((await f.execute({ agentId })).code, 0);
    assert.equal(syncedHome, snap); assert.equal(f.invocations[0].options.env.GEMINI_CLI_HOME, snap);
    for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY']) assert.equal(Object.hasOwn(f.invocations[0].options.env, key), false);
    assert.equal(f.auth.poolCalls, 0); assert.ok(f.events.some(event => event.data?.tool_name === 'invoke_agent'));
  }
});
test('ACP invalida sessões quando o HOME OAuth ou as configurações do perfil nativo mudam', async t => {
  const dir = fixture(t), auth = authenticationFixture(dir, { selectedType: 'oauth-personal', keys: { K1: 'unused-pool-key' } });
  const otherHome = path.join(dir, 'snap-home'); fs.mkdirSync(path.join(otherHome, '.gemini'), { recursive: true });
  const settings = path.join(otherHome, '.gemini', 'settings.json');
  fs.writeFileSync(settings, '{"security":{"auth":{"selectedType":"oauth-personal"}}}');
  const c = load('server/acp-client.ts', { ...auth.globals, process: auth.process, getGuiDataDir: () => dir, getResolvedCliPath: () => '/fixture/node_modules/.bin/gemini' });
  const Session = vm.runInContext('AcpSession', c), manager = vm.runInContext('new AcpSessionManager()', c);
  Session.prototype.initializeSession = async function () { this.isReady = true; };
  Session.prototype.cleanup = function () { this.isClosed = true; };
  const params = { workDir: dir, model: 'fixture' }, first = await manager.getOrCreateSession('same', params);
  auth.env.GEMINI_CLI_HOME = otherHome;
  const second = await manager.getOrCreateSession('same', params); assert.notEqual(first, second); assert.equal(first.isClosed, true);
  fs.writeFileSync(settings, '{"security":{"auth":{"selectedType":"oauth-personal"}},"mcpServers":{"native":{"command":"changed"}}}');
  const third = await manager.getOrCreateSession('same', params); assert.notEqual(second, third); assert.equal(second.isClosed, true);
  assert.equal(auth.poolCalls, 0); manager.removeSession('same');
});

test('Permite evocar todos os agentes simultaneamente em paralelo via invoke_agent', async t => {
  const subagents = ['investigator', 'architect', 'auditor', 'tester', 'worker'];
  const f = cliFixture(t, child => {
    // Simula a evocação simultânea de todos os subagentes em paralelo pelo orquestrador
    for (let i = 0; i < subagents.length; i++) {
      child.stdout.write(JSON.stringify({
        type: 'tool_use',
        tool_name: 'invoke_agent',
        tool_id: `invoke-${subagents[i]}`,
        parameters: { agent_name: subagents[i], prompt: `Analise sob a ótica de ${subagents[i]}` }
      }) + '\n');
    }
    for (let i = 0; i < subagents.length; i++) {
      child.stdout.write(JSON.stringify({
        type: 'tool_result',
        tool_name: 'invoke_agent',
        tool_id: `invoke-${subagents[i]}`,
        status: 'success',
        output: `Resultado de ${subagents[i]}`
      }) + '\n');
    }
    child.stdout.write('{"type":"message","role":"assistant","content":"Relatório consolidado de todos os agentes."}\n');
    child.stdout.write('{"type":"result","status":"success"}\n');
    child.emit('close', 0, null);
  }, {
    selectedType: 'oauth-personal',
    keys: {},
    agents: [{ id: 'principal', name: 'principal' }, ...subagents.map(name => ({ id: name, name }))]
  });

  const outcome = await f.execute({ agentId: 'all', prompt: 'Evocar todos os agentes simultaneamente para análise completa' });
  assert.equal(outcome.code, 0);
  assert.ok(f.invocations[0].system.includes('invoke_agent'));
  assert.ok(f.invocations[0].system.includes('EVOCAÇÃO SIMULTÂNEA'));
  assert.equal(f.invocations[0].system.includes('ESTRITAMENTE PROIBIDO'), false);
  const toolUses = f.events.filter(e => e.type === 'stream_event' && e.data?.type === 'tool_use' && e.data?.tool_name === 'invoke_agent');
  assert.equal(toolUses.length, 5);
});


test('A/B: CLI empacotado com selectedType definido mantém Snap em OAuth → API key → OAuth', t => {
  const dir = fixture(t), home = path.join(dir, 'host'), snap = path.join(home, 'snap/gemini-cli/common'), gui = path.join(dir, 'gui');
  for (const base of [home, snap, gui]) fs.mkdirSync(path.join(base, '.gemini'), { recursive: true });
  const env = { PATH: '/snap/bin', GEMINI_CLI_SYSTEM_SETTINGS_PATH: path.join(dir, 'system.json'), GEMINI_CLI_SYSTEM_DEFAULTS_PATH: path.join(dir, 'defaults.json') };
  const c = load('server/cli-auth-service.ts', { getGuiDataDir: () => gui, os: { ...os, homedir: () => home }, fs: { ...fs,
    existsSync: file => file === '/snap/bin/gemini' || fs.existsSync(file), readlinkSync: file => file === '/snap/bin/gemini' ? 'gemini-cli.gemini' : fs.readlinkSync(file),
    readFileSync: (file, ...args) => file === '/snap/gemini-cli/current/meta/snap.yaml' ? '    HOME: $SNAP_USER_COMMON\n' : fs.readFileSync(file, ...args) } });
  for (const selectedType of ['oauth-personal', 'gemini-api-key', 'oauth-personal']) {
    fs.writeFileSync(path.join(gui, '.gemini/settings.json'), JSON.stringify({ security: { auth: { selectedType } } }));
    const auth = c.resolveCliAuthentication(dir, env, '/opt/gemini-gui/node_modules/@google/gemini-cli/bundle/gemini.js');
    assert.equal(auth.selectedType, selectedType); assert.equal(auth.nativeHome, snap);
    assert.equal(c.buildCliAuthEnvironment(auth, 'fixture', {}).GEMINI_CLI_HOME, snap);
  }
  assert.equal(c.resolveCliAuthentication(dir, { ...env, GEMINI_CLI_HOME: home }, '/opt/gemini-gui/node_modules/.bin/gemini').nativeHome, home);
});

test('C: sincronização e nova leitura não recriam canônicos no host; SHA alterado e aliases preservados', t => {
  const dir = fixture(t), host = path.join(dir, 'host'), snap = path.join(dir, 'snap'), gui = path.join(dir, 'gui');
  for (const base of [host, snap, gui]) fs.mkdirSync(path.join(base, '.gemini/agents'), { recursive: true });
  const c = load('server/agents-service.ts', { getGuiDataDir: () => gui, buildEffectiveSystemPrompt: load('src/utils/systemPromptUtils.ts').buildEffectiveSystemPrompt, nativeCliHome: () => snap, os: { ...os, homedir: () => host } });
  c.ensureAgentsSeeded(snap);
  const native = path.join(snap, '.gemini/agents'), old = path.join(host, '.gemini/agents');
  const owned = {};
  for (const name of ['principal', 'worker', 'architect', 'auditor', 'investigator', 'tester']) {
    const bytes = fs.readFileSync(path.join(native, name + '.md'));
    fs.writeFileSync(path.join(old, name + '.md'), bytes); owned[name + '.md'] = crypto.createHash('sha256').update(bytes).digest('hex');
  }
  fs.appendFileSync(path.join(old, 'tester.md'), '\nCUSTOM USER EDIT');
  fs.writeFileSync(path.join(old, 'software_architect.md'), 'alias original');
  fs.writeFileSync(path.join(old, '.gui-owned-agents.json'), JSON.stringify(owned));
  c.ensureAllAgentsSynchronizedAndAcknowledged(dir, snap); c.loadAgents(); c.ensureAllAgentsSynchronizedAndAcknowledged(dir, snap);
  for (const name of ['principal', 'worker', 'architect', 'auditor', 'investigator']) assert.equal(fs.existsSync(path.join(old, name + '.md')), false);
  assert.match(fs.readFileSync(path.join(old, 'tester.md'), 'utf8'), /CUSTOM USER EDIT/);
  assert.equal(fs.readFileSync(path.join(old, 'software_architect.md'), 'utf8'), 'alias original');
  assert.equal(c.loadAgents().find(a => a.name === 'architect').fallbackModel, 'gemini-3.7-flash');
});

test('G/H: erros não relacionados a modelo não são MODEL_NOT_FOUND; saúde G6 não contamina outras chaves', async t => {
  const dir = fixture(t), c = load('server/key-pool-service.ts', { os: { ...os, homedir: () => dir } });
  for (const text of ['session not found', 'file not found', 'tool not found', 'unsupported tool', 'Subagent architect not found']) {
    assert.notEqual(c.classifyKeyResult(undefined, null, text).errorCode, 'MODEL_NOT_FOUND');
  }
  assert.equal(c.classifyKeyResult(404, null, 'models/gemini-3.6-flash is not found for API version v1beta').errorCode, 'MODEL_NOT_FOUND');
  c.recordRuntimeExecutionResult('model', 'K1', { success: false, httpStatus: 404, errorText: 'model not found' });
  const state = c.loadKeyPoolState(); assert.equal(state.items['model:K1'].consecutiveErrors, 0);
  for (let n = 2; n <= 9; n++) assert.equal(state.items[`model:K${n}`], undefined);
  const requests = [];
  c.GoogleGenAI = class { constructor({ apiKey }) { this.models = { generateContent: async ({ model }) => {
    requests.push([model, apiKey]); if (apiKey === 'fixture-1') throw Object.assign(new Error('model not found'), { status: 404 }); return { text: 'OK' };
  } }; } };
  c.loadConfiguredKeys = () => ({ K1: 'fixture-1', K2: 'fixture-2' });
  const battery = await c.runDailyTestBattery(true);
  assert.equal(battery.totalTested, requests.length);
  assert.ok(battery.results.filter(r => r.keyId === 'K2').every(r => r.currentGroup === 'G1'));
  assert.ok(battery.results.filter(r => r.keyId === 'K1').every(r => r.currentGroup === 'G6' && r.consecutiveErrors === 0));
});

test('Bateria em voo é abortada pela execução ativa e não publica resultado de chave não testada', async t => {
  const dir = fixture(t); let started, signal; const ready = new Promise(resolve => started = resolve);
  const c = load('server/key-pool-service.ts', { os: { ...os, homedir: () => dir }, GoogleGenAI: class {
    models = { generateContent: ({ config }) => new Promise((resolve, reject) => { signal = config.abortSignal; signal.addEventListener('abort', () => reject(new Error('aborted'))); started(); }) };
  } });
  c.loadConfiguredKeys = () => ({ K1: 'fixture-1', K2: 'fixture-2' });
  const battery = c.runDailyTestBattery(true); await ready; const release = c.beginForegroundExecution();
  assert.equal(signal.aborted, true); assert.equal((await battery).totalTested, 0);
  assert.equal((await c.runDailyTestBattery(true)).totalTested, 0);
  assert.deepEqual(plain(c.loadKeyPoolState().items), {}); release();
});

test('J: eventos de runtime, usuário, ferramentas e stderr nunca entram no conteúdo do assistente', () => {
  const telemetry = load('src/utils/telemetry.ts'), trace = load('src/utils/activityTraceUtils.ts');
  const events = [
    { type: 'message', role: 'user', content: 'prompt original' },
    { type: 'runtime_event', data: { event: 'KEY_FAILOVER', agentId: 'architect', keyId: 'K2', group: 'G3', model: 'configured', timestamp: '2026-01-01T00:00:00Z', content: 'não exibir' } },
    { type: 'tool_result', output: 'tool telemetry' }, { type: 'stderr', text: 'stderr' },
    { type: 'stream_event', data: { type: 'message', role: 'assistant', content: 'Resposta limpa' } },
  ];
  assert.equal(events.map(telemetry.assistantText).join(''), 'Resposta limpa');
  const activities = trace.normalizeActivities({ rawEvents: events });
  assert.equal(activities.filter(a => a.type === 'runtime_event').length, 0, 'telemetria técnica fica somente em Logs/Payload');
});

test('K: no-op preserva bytes/mtime; alteração legítima usa rename 0600; falha mantém original', t => {
  const dir = fixture(t), c = load('server/key-pool-service.ts', { os: { ...os, homedir: () => dir } });
  const file = c.getApiKeysEnvPath(), original = '# preserve comment\nOTHER_SETTING=keep\nGEMINI_API_KEY_1="fixture-old"\n';
  fs.writeFileSync(file, original, { mode: 0o600 });
  const before = fs.statSync(file).mtimeMs;
  c.saveConfiguredKeys({}); assert.equal(fs.statSync(file).mtimeMs, before); assert.equal(fs.readFileSync(file, 'utf8'), original);
  let renamed = false;
  c.fs = { ...fs, renameSync(source, destination) { assert.equal(destination, file); assert.equal(fs.statSync(source).mode & 0o777, 0o600); renamed = true; fs.renameSync(source, destination); } };
  c.saveConfiguredKeys({ K2: 'fixture-new' }); assert.equal(renamed, true);
  const committed = fs.readFileSync(file, 'utf8'); assert.match(committed, /OTHER_SETTING=keep/); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  c.fs = { ...fs, renameSync() { throw new Error('injected rename failure'); } };
  assert.throws(() => c.saveConfiguredKeys({ K2: 'fixture-other' }), /injected/);
  assert.equal(fs.readFileSync(file, 'utf8'), committed); assert.deepEqual(fs.readdirSync(path.dirname(file)), ['api-keys.env']);
});

test('L: watchdog OAuth fica null em close, error, cancelamento e falha síncrona de spawn', async t => {
  for (const ending of ['close', 'error', 'cancel']) {
    let state;
    const f = cliFixture(t, child => {
      state = f.c.getExecutionState('watchdog-' + ending); assert.ok(state.watchdog);
      if (ending === 'close') child.emit('close', 0, null);
      else if (ending === 'error') child.emit('error', Object.assign(new Error('spawn failure'), { code: 'ENOENT' }));
      else f.c.cancelExecutionById('watchdog-' + ending);
    }, { selectedType: 'oauth-personal', cachedOAuth: true });
    await f.execute({ executionId: 'watchdog-' + ending });
    assert.equal(state.watchdog, null);
  }
  const f = cliFixture(t, () => {}, { selectedType: 'oauth-personal', cachedOAuth: true });
  f.c.spawn = () => { throw new Error('sync spawn failure'); };
  assert.match((await f.execute({ executionId: 'spawn-sync' })).error.message, /sync spawn failure/);
  assert.equal(f.c.getExecutionState('spawn-sync'), undefined);
});

test('Busca recuperada: 429 em stderr seguido de Exa e resultado estruturado de sucesso não vira erro terminal', async t => {
  const f = cliFixture(t, child => {
    child.stderr.write('API Error 429 RESOURCE_EXHAUSTED quota exhausted');
    for (const event of [{ type: 'runtime_event', event: 'WEB_SUCCESS', tool: 'mcp_exa_web_search_exa' }, { type: 'message', role: 'assistant', content: 'Resposta final' }, { type: 'result', status: 'success' }]) child.stdout.write(JSON.stringify(event) + '\n');
    child.emit('close', 0, null);
  });
  assert.equal((await f.execute()).code, 0);
  assert.equal(f.events.some(event => event.type === 'process_error'), false);
  assert.equal(f.invocations.length, 1);
});


test('Patch web: migra catch legado inválido, preserva argumentos nativos e é idempotente', async () => {
  const { patchWebSearch } = (await import('../../scripts/patch-gemini-cli.cjs')).default;
  const prefix = `var WebSearchToolInvocation = class {
  async execute({ abortSignal: signal }) {
    const geminiClient = this.context.geminiClient;
    try {
      const response = await geminiClient.generateContent(
        { model: "web-search" }, [{ role: "user", parts: [{ text: this.params.query }] }], signal, "utility_tool"
      );`;
  const suffix = `
      const responseText = getResponseText(response);
      return { llmContent: responseText };
    } catch (error) { return { error }; }
  }
};
var WebSearchTool = class {};`;
  const legacy = prefix + `
      // __WEB_SEARCH_CATCH_APPLIED__
      } catch (_searchErr) { return { llmContent: "fake success" }; }
` + suffix;
  assert.throws(() => new vm.Script(legacy), { name: 'SyntaxError' });
  for (const input of [prefix + suffix, legacy]) {
    const patched = patchWebSearch(input);
    assert.doesNotThrow(() => new vm.Script(patched));
    assert.equal(patchWebSearch(patched), patched);
    assert(!patched.includes('fake success'));
    assert(patched.includes('runtime.fallbackWebSearch(this.context, this.params.query, signal, _searchErr)'));
    assert(patched.includes('{ model: "web-search" }, [{ role: "user", parts: [{ text: this.params.query }] }], signal, "utility_tool"'));
  }
});

test('Aliases: igualdade completa elimina clones; prompts e parâmetros personalizados continuam selecionáveis', t => {
  const dir = fixture(t), native = path.join(dir, 'native'), workspace = path.join(dir, 'workspace'), gui = path.join(dir, 'gui');
  for (const base of [native, workspace, gui]) fs.mkdirSync(path.join(base, '.gemini', 'agents'), { recursive: true });
  const markdown = name => `---\nname: ${name}\nmodel: configured-model\ndescription: same\ntools: ["*"]\ntemperature: 0.2\n---\nPreserve my instructions`;
  for (const name of ['principal', 'architect', 'architect_agent', 'software_architect', 'orchestrator']) fs.writeFileSync(path.join(native, '.gemini', 'agents', name + '.md'), markdown(name));
  fs.writeFileSync(path.join(workspace, '.gemini', 'agents', 'architect_agent.md'), markdown('architect_agent') + '\nCustom project prompt');
  fs.writeFileSync(path.join(native, '.gemini', 'agents', '.metadata.json'), JSON.stringify({ software_architect: { temperature: 0.9 }, architect: { temperature: 0.2 } }));
  const c = load('server/agents-service.ts', { nativeCliHome: () => native, getGuiDataDir: () => gui, buildEffectiveSystemPrompt: (base, system) => [base, system].filter(Boolean).join('\n') });
  assert.deepEqual(plain(c.getEquivalentAgentAliases(workspace)), { orchestrator: 'principal' });
  const agents = c.loadAgents(workspace);
  assert(agents.some(a => a.name === 'architect_agent'));
  assert(agents.some(a => a.name === 'software_architect'));
  assert(!agents.some(a => a.name === 'orchestrator'));
  assert.equal(fs.readFileSync(path.join(workspace, '.gemini', 'agents', 'architect_agent.md'), 'utf8'), markdown('architect_agent') + '\nCustom project prompt');
  fs.writeFileSync(path.join(native, '.gemini', 'agents', 'orchestrator.md'), markdown('orchestrator').replace('temperature: 0.2', '  temperature: 0.2'));
  assert(!c.getEquivalentAgentAliases(workspace).orchestrator, 'indentação de configuração diferente não é equivalência');
  fs.writeFileSync(path.join(native, '.gemini', 'agents', 'orchestrator.md'), markdown('orchestrator'));
  fs.writeFileSync(path.join(native, '.gemini', 'agents', '.metadata.json'), JSON.stringify({ orchestrator: { role: 'Custom task scope' } }));
  assert(!c.getEquivalentAgentAliases(workspace).orchestrator, 'papel personalizado preservado');
});

test('Sessões: só reconhece sessionId completo no registro do workspace e nativeHome efetivo', t => {
  const dir = fixture(t), native = path.join(dir, 'snap'), workspace = path.join(dir, 'workspace');
  const chats = path.join(native, '.gemini', 'tmp', 'workspace', 'chats'); fs.mkdirSync(chats, { recursive: true });
  fs.writeFileSync(path.join(native, '.gemini', 'projects.json'), JSON.stringify({ projects: { [workspace]: 'workspace' } }));
  const id = '12345678-1234-4123-a123-123456789abc';
  const c = load('server/gemini-cli-service.ts', { nativeCliHome: () => native }); c.getResolvedCliPath = () => 'gemini';
  assert.equal(c.isExistingSession(id, workspace), false);
  fs.writeFileSync(path.join(chats, 'session-12345678.json'), JSON.stringify({ sessionId: id }));
  assert.equal(c.isExistingSession(id, workspace), true);
  assert.equal(c.isExistingSession('12345678-9999-4999-a999-999999999999', workspace), false);
  assert.equal(c.isExistingSession(id, path.join(dir, 'other')), false);
});

test('Elegibilidade: 503 não vira quota; Retry-After composto e cooldown não alteram ranking nem chaves não testadas', t => {
  const dir = fixture(t); const warnings = [];
  const c = load('server/key-pool-service.ts', { os: { ...os, homedir: () => dir }, sysLog: { ...log, warn: (...args) => warnings.push(args) } });
  c.saveConfiguredKeys({ K1: 'fixture-one', K2: 'fixture-two' });
  const before = fs.readFileSync(c.getApiKeysEnvPath());
  c.recordRuntimeExecutionResult('model', 'K1', { success: false, httpStatus: 503, errorText: 'Service unavailable', executionId: 'e', agentId: 'architect', requestId: 'r' });
  assert.equal(c.getRankedKeys('model').find(k => k.keyId === 'K1').group, 'G4');
  assert.deepEqual(c.getEligibleRankedKeys('model').map(k => k.keyId), vm.runInContext('["K2"]', c));
  assert.equal(c.getRankedKeys('model').find(k => k.keyId === 'K2').isTested, false);
  c.recordRuntimeExecutionResult('model', 'K2', { success: false, httpStatus: 429, errorText: 'Quota exceeded. Please retry in 3h8m10.346s.' });
  const until = Date.parse(c.getRankedKeys('model').find(k => k.keyId === 'K2').status.cooldownUntil);
  assert(Math.abs(until - Date.now() - 11290346) < 1000);
  assert.equal(c.getBestEligibleKey('model'), null);
  assert.equal(c.getRankedKeys('model').length, 2);
  assert.equal(warnings[0][2].executionId, 'e'); assert.equal(warnings[0][2].requestId, 'r');
  assert.deepEqual(fs.readFileSync(c.getApiKeysEnvPath()), before);
});

test('Andamento: agrupa IDs, mantém resumos públicos e retornos; 500 eventos técnicos ficam apenas no payload', () => {
  const c = load('src/utils/activityTraceUtils.ts');
  const events = Array.from({ length: 500 }, (_, i) => ({ type: 'runtime_event', event: 'API_FAILURE', keyId: 'K' + i, group: 'G2' }));
  events.push({ type: 'tool_use', tool_id: 'call', tool_name: 'invoke_agent', parameters: { agent_name: 'architect' } }, { type: 'tool_use', tool_call_id: 'call', tool_name: 'invoke_agent', parameters: { agent_name: 'architect' } }, { type: 'tool_result', tool_id: 'call', status: 'success', output: 'Architect output' });
  events.push({ type: 'analysis_summary', activityId: 'analysis', agentId: 'architect', summary: 'Verificando o escopo solicitado.' });
  events.push({ type: 'runtime_event', event: 'EXECUTION_BLOCKED', id: 'blocked', message: 'Opções temporariamente indisponíveis.' });
  const before = JSON.stringify(events), activities = c.normalizeActivities({ rawEvents: events, isStreaming: false });
  assert.equal(activities.length, 3); assert.equal(activities.find(a => a.type === 'invoke_agent').targetAgent, 'architect');
  assert.equal(activities.find(a => a.type === 'invoke_agent').result, 'Architect output');
  assert.equal(activities.find(a => a.type === 'thinking').result, 'Verificando o escopo solicitado.');
  assert(!JSON.stringify(activities).includes('API_FAILURE'));
  assert.equal(JSON.stringify(events), before);
});

test('Glob nativo: lista grande reproduz RangeError legado e passa após patch sem aumentar timeout', async () => {
  const { patchLocalTools } = (await import('../../scripts/patch-gemini-cli.cjs')).default;
  const bundle = fs.readFileSync(path.join(root, 'node_modules/@google/gemini-cli/bundle/chunk-YSBB75DZ.js'), 'utf8');
  const start = bundle.indexOf('var GlobToolInvocation = class');
  const end = bundle.indexOf('var GlobTool = ', start);
  const patched = bundle.slice(start, end);
  const old = patched.replace('for (const entry of entries) allEntries.push(entry);', 'allEntries.push(...entries);');
  const entries = Array.from({ length: 150000 }, (_, i) => ({ fullpath: () => '/scope/file' + i, mtimeMs: 0 }));
  const run = async source => {
    const context = vm.createContext({ BaseToolInvocation: class { constructor(params) { this.params = params; } }, process: { env: {} }, path54: path, fs45: { existsSync: () => false }, resolveToRealPath: v => v, glob: async () => entries, sortFileEntries: v => v, debugLogger: log, getErrorMessage: e => e.message, ToolErrorType: { GLOB_EXECUTION_ERROR: 'glob' }, DEFAULT_FILE_FILTERING_OPTIONS: {}, makeRelative: () => '', shortenPath: v => v });
    vm.runInContext(source, context);
    const config = { getWorkspaceContext: () => ({ getDirectories: () => ['/scope'] }), getTargetDir: () => '/scope', getFileExclusions: () => ({ getGlobExcludes: () => [] }), getFileService: () => ({ filterFilesWithReport: () => ({ filteredPaths: ['file0'], ignoredCount: 149999 }) }), getFileFilteringOptions: () => ({}) };
    return new context.GlobToolInvocation(config, { pattern: '**/*' }).execute({ abortSignal: new AbortController().signal });
  };
  assert.match((await run(old)).error.message, /Maximum call stack size/);
  assert.equal((await run(patched)).error, undefined);
  assert.equal(patchLocalTools(bundle), bundle, 'patch idempotente');
});

test('Bridge/runtime reais: opções esgotadas retornam em menos de 1s sem API; concorrência respeita cooldown e cancelamento', async t => {
  const dir = fixture(t), { buildSync } = await import('esbuild'), http = await import('node:http');
  const runtimeFile = path.join(dir, 'runtime.mjs');
  buildSync({ entryPoints: [path.join(root, 'server/cli-runtime.ts')], outfile: runtimeFile, bundle: true, platform: 'node', format: 'esm' });
  const pool = load('server/key-pool-service.ts', { os: { ...os, homedir: () => dir } });
  pool.saveConfiguredKeys({ K1: 'fixture-one', K2: 'fixture-two' });
  for (const model of ['primary', 'fallback']) for (const keyId of ['K1', 'K2']) pool.recordRuntimeExecutionResult(model, keyId, { success: false, httpStatus: 429, errorText: 'daily quota exhausted; retry in 2h.' });
  const b = load('server/runtime-bridge.ts', { http, ...Object.fromEntries(['classifyKeyResult', 'getRankedKeys', 'getEligibleRankedKeys', 'getModelAvailability', 'recordRuntimeExecutionResult', 'loadConfiguredKeys'].map(name => [name, pool[name]])) });
  const service = await b.createRuntimeBridge({ executionId: 'controlled', agents: [{ name: 'principal', model: 'primary', fallbackModel: 'fallback' }], agentId: 'principal', mode: 'api-key', apiKey: 'fixture-one', onEvent() {} });
  t.after(service.close);
  const names = ['GEMINI_GUI_RUNTIME_URL','GEMINI_GUI_RUNTIME_TOKEN','GEMINI_GUI_AGENT_ID','GEMINI_GUI_INVOKE_ALL'];
  const previous = Object.fromEntries(names.map(n => [n, process.env[n]]));
  Object.assign(process.env, { GEMINI_GUI_RUNTIME_URL: service.url, GEMINI_GUI_RUNTIME_TOKEN: service.token, GEMINI_GUI_AGENT_ID: 'principal', GEMINI_GUI_INVOKE_ALL: '1' });
  t.after(() => { for (const n of names) previous[n] === undefined ? delete process.env[n] : process.env[n] = previous[n]; });
  const runtime = await import(pathToFileURL(runtimeFile).href);
  let apiCalls = 0;
  const sdk = runtime.wrapModels({}, () => ({ generateContent: async () => { apiCalls++; return {}; } }));
  const start = performance.now();
  await assert.rejects(sdk.generateContent({ model: 'primary' }), /Opções disponíveis esgotadas/);
  assert.equal(apiCalls, 0); assert(performance.now() - start < 1000);
  // Make K2 unavailable so the second execution waits for K1, then cancels.
  pool.recordRuntimeExecutionResult('fresh', 'K2', { success: false, httpStatus: 429, errorText: 'quota; retry in 1h.' });
  let releases;
  const blocker = new Promise(resolve => { releases = resolve; });
  const pending = runtime.wrapModels({}, () => ({ generateContent: async () => { apiCalls++; await blocker; throw Object.assign(new Error('Service unavailable'), { status: 503 }); } }));
  const first = pending.generateContent({ model: 'fresh', config: { abortSignal: new AbortController().signal } }).catch(e => e);
  while (!apiCalls) await new Promise(resolve => setTimeout(resolve, 10));
  const controller = new AbortController();
  const second = pending.generateContent({ model: 'fresh', config: { abortSignal: controller.signal } });
  const rejection = assert.rejects(second, /abort/i); setTimeout(() => controller.abort(), 50); await rejection;
  releases(); await first;
  assert.equal(apiCalls, 1, 'concorrente cancelada e chave em cooldown não chamam SDK');
  assert.equal(pool.getRankedKeys('fresh').find(k => k.keyId === 'K1').status.consecutiveErrors, 1);
  let runs = 0;
  const run = async () => { runs++; await new Promise(resolve => setTimeout(resolve, 10)); return 'output'; };
  const delegated = await Promise.all([runtime.runDelegation('architect', '1', { prompt: 'a' }, new AbortController().signal, run), runtime.runDelegation('architect', '2', { prompt: 'b' }, new AbortController().signal, run)]);
  assert.deepEqual(delegated, ['output', 'output']); assert.equal(runs, 1);
  await assert.rejects(runtime.runDelegation('principal', '3', {}, new AbortController().signal, run), /cíclica/);
});

test('Recuperação de sessão existente: sessão inicialmente nova passa a ser retomada com o mesmo UUID', async t => {
  let firstId;
  const f = cliFixture(t, (child, attempt) => {
    if (attempt === 1) { firstId = f.invocations[0].args.at(-1); child.stderr.write('Error starting session: Session ID already exists. Use --resume to resume it'); child.emit('close', 1, null); }
    else { child.stdout.write(JSON.stringify({ type: 'result', status: 'success' }) + '\n'); child.emit('close', 0, null); }
  });
  const outcome = await f.execute({ resume: false });
  assert.equal(outcome.code,0);assert.equal(f.invocations.length,2);
  const first=f.invocations[0].args,second=f.invocations[1].args;
  assert(first.includes('--session-id'));assert(second.includes('-r'));
  assert.equal(first[first.indexOf('--session-id')+1],second[second.indexOf('-r')+1]);
});

test('Falha local de ferramenta não reclassifica nem penaliza a chave', async t => {
  const f = cliFixture(t, child => { child.stderr.write('GlobLogic execute Error RangeError: Maximum call stack size exceeded'); child.emit('close', 1, null); });
  const outcome=await f.execute();assert.equal(outcome.code,1);assert.equal(f.results.length,0);assert.equal(f.invocations.length,1);
});


test('ACP: modo simultâneo usa Principal e não inicializa CLI sem opção elegível', async t => {
  const dir = fixture(t), agents = [{ id: 'principal', name: 'principal', model: 'primary' }, { id: 'worker', name: 'worker', model: 'secondary' }];
  let environment, initialized = 0;
  const c = load('server/acp-client.ts', { readline: await import('node:readline'), loadAgents: () => agents,
    getGuiDataDir: () => dir, getResolvedCliPath: () => 'fixture', syncAgentsToSettings() { initialized++; }, syncPoliciesToSettings() {}, ensureAllAgentsSynchronizedAndAcknowledged() {},
    resolveExecutionAuthentication: () => ({ authentication: { mode: 'api-key' }, apiKey: c.blocked ? undefined : 'fixture' }),
    buildCliAuthEnvironment: () => ({}), loadConfiguredKeys: () => ({ K1: 'fixture' }), getBestEligibleKey: () => null,
    resolveEffectiveCliConfig: async () => { const file = path.join(dir, 'runtime.json'); fs.writeFileSync(file, '{}'); return file; },
    spawn(_, args, options) { environment = options.env; const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.stderr = new PassThrough(); return child; } });
  const Session = vm.runInContext('AcpSession', c);
  Session.prototype.callMethod = async method => method === 'session/new' ? { sessionId: 'fixture-acp' } : {};
  const session = new Session('s', dir, 'primary');
  await session.initializeSession({ agentId: 'all', workDir: dir });
  assert.equal(session.model, 'primary'); assert.equal(environment.GEMINI_GUI_INVOKE_ALL, '1');
  assert.deepEqual(JSON.parse(environment.GEMINI_GUI_ALLOWED_AGENTS), ['worker']);
  session.cleanup(); c.blocked = true;
  await assert.rejects(new Session('blocked', dir, 'primary').initializeSession({ agentId: 'all', workDir: dir }), /Nenhuma opção elegível/);
  assert.equal(initialized, 1, 'bloqueio precede sincronização e spawn');
});


test('Andamento: terminar SSE com exitCode zero não inventa sucesso de ferramenta sem retorno', () => {
  const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const start = source.indexOf('      const finalToolCalls = Object.values(toolCalls).map');
  const end = source.indexOf('      const finalActivities', start);
  const toolCalls = { unresolved: { id: 'unresolved', toolName: 'Grep', status: 'running' }, returned: { id: 'returned', toolName: 'Glob', status: 'completed', result: 'actual result' } };
  const context = vm.createContext({ toolCalls, hasError: false, Date });
  const final = vm.runInContext(source.slice(start, end) + '\nfinalToolCalls;', context);
  assert.equal(final[0].status, 'failed');assert.match(final[0].result,/sem retorno terminal/);
  assert.equal(final[1].status,'completed');assert.equal(final[1].result,'actual result');
  const activities = load('src/utils/activityTraceUtils.ts').normalizeActivities({ toolCalls: [{ id: 'pending', toolName: 'Grep', status: 'pending' }], isStreaming: false });
  assert.equal(activities[0].status, 'failed');
});


test('Validação explícita: cooldown impede API; 503 encerra após um catálogo sem bateria SDK', async t => {
  const f = cliFixture(t, () => {}, { selectedType: 'gemini-api-key', keys: { K1: 'fixture-k1' } });
  let calls = 0, sdkCalls = 0;
  f.c.fetch = async () => { calls++; return { ok: false, status: 503, json: async () => ({ error: { message: 'high demand; fixture-k1' } }) }; };
  f.c.GoogleGenAI = class { constructor() { sdkCalls++; throw new Error('SDK battery forbidden'); } };
  f.c.loadConfiguredKeys = () => ({ K1: 'fixture-k1' });
  const explicit = await f.c.validateCliAuthentication(true);
  assert.equal(explicit.valid, false);assert.match(explicit.message,/HTTP 503/);assert(!explicit.message.includes('cota'));
  assert.equal(calls,1);assert.equal(sdkCalls,0);
  f.c.getBestEligibleKey = () => null;
  f.c.getModelAvailability = () => ({ configured: 1, eligible: 0, nextRetryAt: '2026-10-07T11:00:00Z' });
  const blocked = await f.c.validateCliAuthentication(true);
  assert.equal(blocked.checked,false);assert.match(blocked.message,/2026-10-07T11:00:00Z/);assert.equal(calls,1);
});

test('08/10: delegação pendente com exit zero falha e preserva a causa API no terminal', async t => {
  const f = cliFixture(t, child => {
    const events = [
      { type: 'tool_use', tool_id: 'inv-required', tool_name: 'invoke_agent', parameters: { agent_name: 'investigator', prompt: 'busca' } },
      { type: 'runtime_event', event: 'API_FAILURE', agentId: 'investigator', invocationId: 'agent-run', requestId: 'provider-request', httpStatus: 503, message: 'Service unavailable: high demand' },
      { type: 'result', status: 'success' },
    ];
    for (const event of events) child.stdout.write(JSON.stringify(event) + '\n');
    child.emit('close', 0, null);
  });
  assert.equal((await f.execute()).code, 1);
  const terminal = f.events.find(e => e.data?.tool_id === 'inv-required' && e.data.status === 'failed');
  assert.match(terminal.data.error, /high demand/);
  assert.equal(terminal.data.lastRequestId, 'provider-request');
  assert.equal(terminal.data.cause.httpStatus, 503);
  assert.equal(f.events.find(e => e.type === 'execution_outcome').data.status, 'failed');
  assert.equal(f.results.length, 0, 'Erro de delegação não penaliza chave do Principal');
});
test('08/10: resultados parciais não viram sucesso e retornos repetidos não sobrescrevem falha', async t => {
  const f = cliFixture(t, child => {
    for (const event of [
      { type: 'tool_use', tool_id: 'good', tool_name: 'invoke_agent', parameters: { agent_name: 'worker' } },
      { type: 'tool_result', tool_id: 'good', status: 'success', output: 'Entregue' },
      { type: 'tool_use', tool_id: 'bad', tool_name: 'invoke_agent', parameters: { agent_name: 'investigator' } },
      { type: 'tool_result', tool_id: 'bad', status: 'failed', error: 'fetch failed' },
      { type: 'tool_result', tool_id: 'bad', status: 'success', output: 'Error as text' },
      { type: 'message', role: 'assistant', content: 'Resultados disponíveis do worker.' },
      { type: 'result', status: 'success' },
    ]) child.stdout.write(JSON.stringify(event) + '\n');
    child.emit('close', 0, null);
  });
  assert.equal((await f.execute()).code, 1);
  assert.equal(f.events.find(e => e.type === 'execution_outcome').data.status, 'partial');
  assert(f.events.filter(e => e.type === 'tool_result' && e.data.tool_call_id === 'bad').every(e => e.data.status === 'failed'));
  assert.equal(f.children.length, 1);
});
test('08/10: OOM e falha de rede não reclassificam chaves nem reiniciam subprocessos', async t => {
  for (const failure of ['FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory', 'TypeError: fetch failed sending request']) {
    const f = cliFixture(t, child => { child.stderr.write(failure); child.emit('close', 134, null); });
    assert.equal((await f.execute()).code, 134);
    assert.equal(f.children.length, 1); assert.equal(f.results.length, 0);
  }
});
test('08/10: telemetria contabiliza apenas invoke_agent e deduplica terminais', t => {
  const dir = fixture(t), policy = load('server/execution-policy.ts');
  const c = load('server/agent-execution-tracker.ts', { os: { ...os, homedir: () => dir }, summarizeExecution: policy.summarizeExecution });
  const tracker = new (vm.runInContext('AgentExecutionTracker', c))('fixture', 'principal', 'fixture-model');
  tracker.trackSubagentInvocation('inv', 'investigator', 'busca');
  tracker.trackSubagentResult('exa', 'busca Exa', 'success');
  tracker.trackSubagentResult('inv', 'falha', 'failed', '503');
  tracker.trackSubagentResult('inv', 'erro com etiqueta success', 'success');
  tracker.trackFlowSummary(0);
  const records = fs.readFileSync(path.join(dir, '.local/share/gemini-gui/logs/subagent-executions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(records.filter(e => e.eventType === 'SUBAGENT_RESULT_RECEIVED').length, 0);
  assert.equal(records.filter(e => e.eventType === 'SUBAGENT_DELEGATION_FAILED').length, 1);
  assert.equal(records.at(-1).status, 'failed');
});
test('08/10: snapshots rejeitam raiz home antes de varrer e limitam árvores de diretórios', async t => {
  const dir = fixture(t), home = path.join(dir, 'home'), workspace = path.join(dir, 'workspace');
  fs.mkdirSync(home); fs.mkdirSync(workspace);
  const c = load('server/versions-service.ts', { os: { ...os, homedir: () => home }, getGuiGeminiDir: () => path.join(dir, 'data') });
  const scan = vm.runInContext('scanWorkspace', c);
  await assert.rejects(scan(home), /diretório de projeto/);
  for (let i = 0; i < 4097; i++) fs.mkdirSync(path.join(workspace, String(i)));
  await assert.rejects(scan(workspace), /diretórios/);
});

test('08/10: bridge limita falhas por execução e reserva orçamento na concorrência', async t => {
  const recorded = [], classifier = load('server/key-pool-service.ts');
  const c = load('server/runtime-bridge.ts', { http: await import('node:http'), classifyKeyResult: classifier.classifyKeyResult, recordRuntimeExecutionResult: (...args) => recorded.push(args), getRankedKeys: () => [], getEligibleRankedKeys: () => [], loadConfiguredKeys: () => ({}) });
  const channel = await c.createRuntimeBridge({ agents: [], executionId: 'budget-fixture', agentId: 'principal', mode: 'api-key', onEvent() {} });
  t.after(() => channel.close());
  const call = body => fetch(channel.url, { method: 'POST', headers: { Authorization: `Bearer ${channel.token}` }, body: JSON.stringify(body) }).then(r => r.json());
  const first = await Promise.all(Array.from({ length: 7 }, (_, i) => call({ action: 'attempt', invocationId: 'agent-a', requestId: `a-${i}` })));
  assert.equal(first.filter(r => r.allowed).length, 6);
  for (let i = 0; i < 6; i++) await call({ action: 'result', success: false, status: 503, message: 'Service unavailable', model: 'fixture-model', keyId: 'fixture-key', invocationId: 'agent-a', requestId: `a-${i}` });
  assert.equal((await call({ action: 'attempt', invocationId: 'agent-a', requestId: 'a-7' })).allowed, false);
  const second = await Promise.all(Array.from({ length: 7 }, (_, i) => call({ action: 'attempt', invocationId: 'agent-b', requestId: `b-${i}` })));
  assert.equal(second.filter(r => r.allowed).length, 6);
  assert.equal((await call({ action: 'attempt', invocationId: 'agent-c', requestId: 'c-1' })).allowed, false, 'Execução inteira limitada, inclusive em paralelo');
  await call({ action: 'release', attemptRequestIds: ['b-0', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5'] });
  assert.equal((await call({ action: 'attempt', invocationId: 'agent-c', requestId: 'c-2' })).allowed, true, 'Cancelamento libera reservas');
  const previous = recorded.length;
  await call({ action: 'result', success: false, message: 'TypeError: fetch failed', keyId: 'fixture-key', requestId: 'c-2' });
  assert.equal(recorded.length, previous, 'Rede não altera estado de chave');
});
test('08/10: classificação de OOM, rede e erro genérico não escreve no Key Pool', () => {
  const c = load('server/key-pool-service.ts');
  c.loadKeyPoolState = () => { throw Error('Estado não deveria ser lido/modificado'); };
  for (const errorText of ['heap out of memory', 'fetch failed', 'Error executing tool: timeout', 'GUI_RETRY_BUDGET', 'unexpected local error']) {
    assert.equal(c.classifyKeyResult(null, null, errorText).affectsKey, false);
    assert.doesNotThrow(() => c.recordRuntimeExecutionResult('fixture-model', 'fixture-key', { success: false, errorText }));
  }
  assert.equal(c.classifyKeyResult(503, null, 'high demand').errorCode, '503_OVERLOAD');
  assert.equal(c.classifyKeyResult(503, null, 'service unavailable, quota mencionada no contexto').group, 'G4');
  assert.equal(c.classifyKeyResult(429, null, 'RESOURCE_EXHAUSTED').group, 'G3');
});

test('08/10: OOM fatal com wrapper exit zero não registra sucesso', async t => {
  const f = cliFixture(t, child => { child.stderr.write('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory'); child.emit('close', 0, null); });
  assert.equal((await f.execute()).code, 1);assert.equal(f.results.length, 0);assert.equal(f.children.length, 1);
});

test('08/10: timeout mantém causa, modelo e requestId no terminal, logs e SSE apesar de evento duplicado', async t => {
  const cause = { code: 'GUI_REQUEST_TIMEOUT', abortedBy: 'request_timeout', timeoutMs: 30000 };
  const records = [];
  const f = cliFixture(t, child => {
    for (const event of [
      { type: 'tool_use', tool_id: 'timeout-invoke', tool_name: 'invoke_agent', parameters: { agent_name: 'investigator' } },
      { type: 'runtime_event', event: 'API_FAILURE', tool_call_id: 'timeout-invoke', agentId: 'investigator', model: 'actual-model', requestId: 'actual-request', invocationId: 'actual-invocation', ...cause, message: 'GUI_REQUEST_TIMEOUT: 30000 ms' },
      { type: 'tool_result', tool_id: 'timeout-invoke', tool_name: 'invoke_agent', agentId: 'investigator', model: 'actual-model', requestId: 'actual-request', invocationId: 'actual-invocation', cause, status: 'failed', error: 'GUI_REQUEST_TIMEOUT: 30000 ms' },
      { type: 'tool_result', tool_id: 'timeout-invoke', status: 'success', model: 'wrong-model', requestId: 'wrong-request', output: 'duplicate' },
      { type: 'message', role: 'assistant', content: 'Resultado parcial.' },
      { type: 'result', status: 'success' },
    ]) child.stdout.write(JSON.stringify(event) + '\n');
    child.emit('close', 0, null);
  });
  f.c.logSubagentEvent = entry => records.push(entry);
  assert.equal((await f.execute()).code, 1);
  const terminals = f.events.filter(e => e.type === 'tool_result' && e.data.tool_call_id === 'timeout-invoke');
  assert(terminals.length >= 2);
  assert(terminals.every(e => e.data.status === 'failed' && e.data.lastRequestId === 'actual-request' && e.data.subagentModel === 'actual-model'));
  assert.equal(terminals[0].data.cause.abortedBy, 'request_timeout');
  const recorded = records.find(e => e.agentName === 'investigator' && e.eventType === 'SUBAGENT_ERROR');
  assert.equal(recorded.details.requestId, 'actual-request'); assert.equal(recorded.details.invocationId, 'actual-invocation');
  assert.equal(f.events.find(e => e.type === 'execution_outcome').data.status, 'partial');
  assert.equal(f.results.length, 0);
});

test('Delegação concorrente: SSE/Logs/atividades mantêm autoria, fallback e primeiro terminal', async t => {
  const names = ['architect', 'auditor', 'investigator', 'tester', 'worker'], records = [], tracked = [];
  class Tracker { constructor() { return new Proxy(this, { get: (_, name) => name === 'trackNestedToolCall' ? (...args) => tracked.push(args) : () => {} }); } }
  const f = cliFixture(t, child => {
    const emit = data => child.stdout.write(JSON.stringify(data) + '\n');
    for (const name of names) emit({ type: 'tool_use', tool_id: 'delegate-' + name, tool_name: 'invoke_agent', parameters: { agent_name: name } });
    for (const name of names) {
      emit({ type: 'runtime_event', event: 'SUCCESS', tool_call_id: 'delegate-' + name, agentId: name, invocationId: 'inv-' + name, requestId: 'request-' + name, model: 'fallback-shared' });
      emit({ type: 'tool_use', tool_id: 'inv-' + name + ':shared-tool', tool_name: 'mcp_exa_web_search_exa', agentId: name, invocationId: 'inv-' + name, parentToolCallId: 'delegate-' + name, requestId: 'request-' + name, model: 'fallback-shared', parameters: { query: name } });
    }
    // An ambiguous capture must not hijack the first pending delegation.
    emit({ type: 'final_api_request', role: 'subagent', requestId: 'ambiguous', model: 'fallback-shared', finalApiRequest: { model: 'fallback-shared' } });
    for (const name of [...names].reverse()) {
      emit({ type: 'tool_result', tool_id: 'inv-' + name + ':shared-tool', agentId: name, invocationId: 'inv-' + name, requestId: 'request-' + name, model: 'fallback-shared', status: 'success', output: 'TOOL:' + name });
      const failed = name === 'auditor';
      emit({ type: 'tool_result', tool_id: 'delegate-' + name, agentId: name, invocationId: 'inv-' + name, requestId: 'request-' + name, model: 'fallback-shared', status: failed ? 'failed' : 'success', output: 'RESULT:' + name, error: failed ? 'LOCAL_FAILURE' : undefined });
      emit({ type: 'tool_result', tool_id: 'delegate-' + name, status: 'success', output: 'duplicate' });
      emit({ type: 'tool_use', tool_id: 'delegate-' + name, tool_name: 'invoke_agent', parameters: { agent_name: name } });
    }
    emit({ type: 'message', role: 'assistant', content: 'Resultado parcial controlado' }); emit({ type: 'result', status: 'success' }); child.emit('close', 0, null);
  }, { Tracker });
  f.c.logSubagentEvent = e => records.push(plain(e));
  assert.equal((await f.execute({ executionId: 'isolated-parallel', agentId: 'principal' })).code, 1);
  const outcome = f.events.find(e => e.type === 'execution_outcome').data;
  assert.equal(outcome.status, 'partial'); assert.equal(outcome.completedDelegations, 4); assert.equal(outcome.failedDelegations, 1);
  assert.equal(tracked.length, 5, JSON.stringify(tracked));
  for (const name of names) {
    const correlation = tracked.find(args => args[3].agentId === name)[3];
    assert.equal(correlation.parentToolCallId, 'delegate-' + name); assert.equal(correlation.requestId, 'request-' + name); assert.equal(correlation.model, 'fallback-shared');
    const record = records.find(e => e.eventType === 'SUBAGENT_TOOL_RESULT' && e.agentName === name);
    assert.equal(record.result, 'TOOL:' + name); assert.equal(record.details.invocationId, 'inv-' + name); assert.equal(record.details.requestId, 'request-' + name);
  }
  assert.equal(records.filter(e => e.eventType === 'SUBAGENT_INVOKE_START' && names.includes(e.agentName)).length, 5);
  assert.equal(records.find(e => e.eventType === 'SUBAGENT_FINAL_REQUEST').details.callId, undefined);
  const reducer = load('src/utils/toolCallEvents.ts'), calls = {};
  for (const event of f.events) if (['tool_use', 'tool_result'].includes(event.type)) reducer.applyToolCallEvent(calls, event.type, event.data);
  assert.equal(Object.keys(calls).length, 10);
  const normalized = load('src/utils/activityTraceUtils.ts').normalizeActivities({ toolCalls: Object.values(calls), rawEvents: f.events, agentName: 'principal', model: 'principal-model' });
  for (const name of names) {
    const activity = normalized.find(e => e.id === 'inv-' + name + ':shared-tool');
    assert.equal(activity.agentName, name); assert.equal(activity.model, 'fallback-shared'); assert.equal(activity.requestId, 'request-' + name);
    assert.equal(activity.invocationId, 'inv-' + name); assert.equal(activity.parentToolCallId, 'delegate-' + name); assert.equal(activity.result, 'TOOL:' + name);
    assert.equal(calls['delegate-' + name].result, 'RESULT:' + name); assert.equal(calls['delegate-' + name].status, name === 'auditor' ? 'failed' : 'completed');
  }
  assert.equal(f.results.length, 0);
});

test('Tracker concorrente real: autoria por ID e nenhuma inferência pelo primeiro agente pendente', t => {
  const dir = fixture(t), policy = load('server/execution-policy.ts');
  const c = load('server/agent-execution-tracker.ts', { os: { ...os, homedir: () => dir }, summarizeExecution: policy.summarizeExecution });
  const tracker = new (vm.runInContext('AgentExecutionTracker', c))('concurrent', 'principal', 'parent');
  for (const name of ['architect','auditor','investigator','tester','worker']) tracker.trackSubagentInvocation(name, name, 'context:' + name);
  tracker.trackNestedToolCall('read_file', 'worker-read', {}, { agentId: 'worker', parentToolCallId: 'worker', invocationId: 'worker-inv', requestId: 'worker-req', model: 'worker-model' });
  tracker.trackNestedToolCall('read_file', 'unknown-read', {});
  const records = fs.readFileSync(path.join(dir, '.local/share/gemini-gui/logs/subagent-executions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(r => r.eventType === 'SUBAGENT_TOOL_CALL');
  assert.equal(records[0].targetAgent, 'worker'); assert.equal(records[0].details.invocationId, 'worker-inv'); assert.equal(records[1].targetAgent, undefined);
});

test('Interface: resultado órfão não encerra outra ferramenta e eventos duplicados não reabrem terminal', () => {
  const reducer = load('src/utils/toolCallEvents.ts'), calls = {};
  reducer.applyToolCallEvent(calls, 'tool_use', { tool_id: 'A', agentId: 'worker', invocationId: 'IA', tool_name: 'read_file', requestId: 'RA', model: 'MA' }, 10);
  reducer.applyToolCallEvent(calls, 'tool_result', { tool_id: 'unknown', output: 'WRONG' }, 15); assert.equal(calls.A.status, 'running');
  reducer.applyToolCallEvent(calls, 'tool_result', { invocationId: 'IB', output: 'WRONG' }, 15); assert.equal(calls.A.status, 'running');
  reducer.applyToolCallEvent(calls, 'tool_result', { tool_id: 'A', status: 'failed', error: 'cancelled', requestId: 'RA' }, 20);
  reducer.applyToolCallEvent(calls, 'tool_result', { tool_id: 'A', status: 'success', output: 'WRONG', agentId: 'architect', requestId: 'WRONG' }, 30);
  reducer.applyToolCallEvent(calls, 'tool_use', { tool_id: 'A', agentId: 'architect', model: 'WRONG' }, 40);
  assert.equal(calls.A.status, 'failed'); assert.equal(calls.A.componentExecutor, 'worker'); assert.equal(calls.A.requestId, 'RA'); assert.equal(calls.A.agentModel, 'MA'); assert.equal(calls.A.durationMs, 10);
});

test('Runtime: cancelamento individual e modo de aprovação isolados sob concorrência', async t => {
  const dir = fixture(t), { buildSync } = await import('esbuild');
  const file = path.join(dir, 'isolated-runtime.mjs');
  buildSync({ entryPoints: [path.join(root, 'server/cli-runtime.ts')], outfile: file, bundle: true, platform: 'node', format: 'esm' });
  const runtime = await import(pathToFileURL(file).href);
  let principalMutations = 0;
  const engine = { approvalMode: 'yolo', getApprovalMode() { return this.approvalMode; }, setApprovalMode(mode) { this.approvalMode = mode; } };
  const config = { getPolicyEngine: () => engine, getApprovalMode: () => engine.getApprovalMode(), isTrustedFolder: () => true, setApprovalMode(mode) { principalMutations++; engine.setApprovalMode(mode); } };
  const own = new AbortController(), sibling = new AbortController(); let planReady;
  const ready = new Promise(resolve => { planReady = resolve; });
  const first = runtime.runDelegation('tester', 'cancelled-child', { prompt: 'own-context' }, own.signal, async () => {
    config.setApprovalMode('plan'); assert.equal(engine.approvalMode, 'plan'); planReady();
    await new Promise((resolve, reject) => own.signal.addEventListener('abort', () => reject(Object.assign(new Error('own cancellation'), { code: 'GUI_EXECUTION_CANCELLED' })), { once: true }));
  }, 'tester-parent', config);
  const rejected = assert.rejects(first, /own cancellation/);
  await ready;
  const second = runtime.runDelegation('worker', 'independent-child', { prompt: 'sibling-context' }, sibling.signal, async () => {
    assert.equal(config.getApprovalMode(), 'yolo'); own.abort(); await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(sibling.signal.aborted, false); assert.equal(engine.approvalMode, 'yolo'); return { terminate_reason: 'GOAL', result: 'WORKER_RESULT' };
  }, 'worker-parent', config);
  assert.equal((await second).result, 'WORKER_RESULT'); await rejected;
  assert.equal(engine.approvalMode, 'yolo'); assert.equal(principalMutations, 0);
  config.setApprovalMode('plan'); assert.equal(principalMutations, 1); assert.equal(engine.approvalMode, 'plan');
});

test('Patch de delegação: atualização V1/V2 e idempotência no bundle real', async () => {
  const { patchRuntime } = (await import('../../scripts/patch-gemini-cli.cjs')).default;
  const bundle = fs.readFileSync(path.join(root, 'node_modules/@google/gemini-cli/bundle/chunk-YSBB75DZ.js'), 'utf8');
  assert.equal(patchRuntime(bundle), bundle);
  assert.equal((bundle.match(/__GUI_SUBAGENT_ACTIVITIES_V2__/g) || []).length, 1);
  assert.match(bundle, /this\.parentCallId, this\.context\.config\)/);
});

test('SDK/Bridge concorrentes reais: cancelar um subagente não aborta os demais nem penaliza chaves', async t => {
  const dir = fixture(t), http = await import('node:http'), { buildSync } = await import('esbuild');
  const pool = load('server/key-pool-service.ts', { os: { ...os, homedir: () => dir } });
  pool.saveConfiguredKeys({ K1: 'local-test-key', K2: 'local-test-key-two' });
  const b = load('server/runtime-bridge.ts', { http, ...Object.fromEntries(['classifyKeyResult','getRankedKeys','getEligibleRankedKeys','getModelAvailability','recordRuntimeExecutionResult','loadConfiguredKeys'].map(name => [name, pool[name]])) });
  const names = ['architect','auditor','investigator','tester','worker'];
  const bridge = await b.createRuntimeBridge({ executionId: 'cancel-isolation', agents: names.map(name => ({ name, model: 'local-model-' + name })), agentId: 'principal', mode: 'api-key', onEvent() {} });
  t.after(bridge.close);
  const env = ['GEMINI_GUI_RUNTIME_URL','GEMINI_GUI_RUNTIME_TOKEN','GEMINI_GUI_AGENT_ID','GEMINI_GUI_INVOKE_ALL'];
  const previous = Object.fromEntries(env.map(name => [name, process.env[name]]));
  Object.assign(process.env, { GEMINI_GUI_RUNTIME_URL: bridge.url, GEMINI_GUI_RUNTIME_TOKEN: bridge.token, GEMINI_GUI_AGENT_ID: 'principal', GEMINI_GUI_INVOKE_ALL: '1' });
  t.after(() => { for (const name of env) previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name]; });
  const file = path.join(dir, 'concurrent-sdk.mjs');
  buildSync({ entryPoints: [path.join(root, 'server/cli-runtime.ts')], outfile: file, bundle: true, platform: 'node', format: 'esm' });
  const runtime = await import(pathToFileURL(file).href), calls = [], controllers = Object.fromEntries(names.map(name => [name, new AbortController()]));
  let allStarted; const started = new Promise(resolve => { allStarted = resolve; });
  const sdk = runtime.wrapModels({}, () => ({ generateContent: async request => {
    const owner = request.contents;
    assert.equal(request.model, 'local-model-' + owner);
    calls.push({ owner, signal: request.config.abortSignal });
    if (calls.length === 5) allStarted();
    await started;
    request.config.abortSignal.throwIfAborted();
    if (owner === 'tester') return new Promise((resolve, reject) => request.config.abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })), { once: true }));
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(request.config.abortSignal.aborted, false); return { owner };
  } }));
  const pending = names.map(name => runtime.runDelegation(name, 'inv-' + name, { prompt: 'context-' + name }, controllers[name].signal, async () => {
    const response = await sdk.generateContent({ model: 'local-model-' + name, contents: name, config: { abortSignal: controllers[name].signal } });
    return { terminate_reason: 'GOAL', result: 'RESULT:' + response.owner };
  }, 'parent-' + name));
  const finished = Promise.allSettled(pending);
  await started; controllers.tester.abort();
  const results = await finished;
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 4);
  assert.equal(results[3].reason.code, 'GUI_EXECUTION_CANCELLED');
  assert.equal(calls.length, 5);
  for (const name of names) {
    assert.equal(pool.getRankedKeys('local-model-' + name).find(k => k.keyId === 'K1').status.consecutiveErrors, 0);
    if (name !== 'tester') assert.equal(results[names.indexOf(name)].value.result, 'RESULT:' + name);
  }
});

test('Delegação: cancelamento ocorrido durante conclusão nunca publica sucesso', async t => {
  const dir = fixture(t), { buildSync } = await import('esbuild'), file = path.join(dir, 'cancel-terminal.mjs');
  buildSync({ entryPoints: [path.join(root, 'server/cli-runtime.ts')], outfile: file, bundle: true, platform: 'node', format: 'esm' });
  const runtime = await import(pathToFileURL(file).href), controller = new AbortController();
  await assert.rejects(runtime.runDelegation('worker', 'cancel-terminal', { prompt: 'finish-race' }, controller.signal, async () => { controller.abort(); return { terminate_reason: 'GOAL', result: 'too late' }; }), { name: 'AbortError' });
});
