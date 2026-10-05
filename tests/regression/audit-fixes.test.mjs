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
const root = path.resolve(import.meta.dirname, '../..');
const log = new Proxy({}, { get: () => () => {} });
export function load(file, globals = {}) {
  let source = fs.readFileSync(path.join(root, file), 'utf8').replace(/^import[\s\S]*?;\s*/gm, '').replace(/^export\s*\{[^}]*\};?\s*/gm, '');
  source = stripTypeScriptTypes(source, { mode: 'transform' }).replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let|var))/g, '');
  const context = vm.createContext({ console, Buffer, URL, AbortController, AbortSignal, TextDecoder, TextEncoder, setTimeout, clearTimeout, setInterval, clearInterval, process, fs, path, os, crypto, ...childProcess, sysLog: log, logSubagentEvent: () => {}, performance, ...globals });
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
  const context = vm.createContext({ fs, process: { pid: process.pid, on() {} }, console, setTimeout, clearTimeout, sysLog: log, getStorageFilePath: () => file });
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
  const auth = authenticationFixture(dir, options);
  class Tracker { constructor() { return new Proxy(this, { get: () => () => {} }); } }
  const c = load('server/gemini-cli-service.ts', {
    ...auth.globals, process: auth.process, ...(options.fastTimers ? { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)) } : {}), console: { ...console, log() {} }, getGuiDataDir: () => dir, AgentExecutionTracker: Tracker, ...Object.fromEntries(['buildExecutionPrompt', 'consumeSessionRecovery', 'executionFailed', 'validateExecutionContext'].map(name => [name, policy[name]])), retainDiagnostics: retention.retainDiagnostics,
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
    for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY']) {
      assert.equal(f.invocations[0].options.env[key], 'fixture-k1'); assert.equal(f.invocations[1].options.env[key], 'fixture-k2');
    }
    assert.equal(f.results[0][1], 'K1'); assert.equal(f.results[0][2].success, false);
    assert.equal(f.results.at(-1)[1], 'K2'); assert.equal(f.results.at(-1)[2].success, true);
    assert.ok(f.events.some(event => event.data?.content?.includes('Key Pool Failover')));
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
    assert.ok(f.events.some(event => event.data?.content?.includes('Key Pool Failover')));
    assert.ok(f.events.some(event => event.data?.tool_name === 'invoke_agent'));
    assert.ok(!f.events.some(event => event.data?.content?.includes('Modelo de Fallback Acionado')));
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
  const messages = f.events.filter(event => event.data?.content).map(event => event.data.content);
  assert.ok(messages.findIndex(text => text.includes('Key Pool Failover')) < messages.findIndex(text => text.includes('Modelo de Fallback Acionado')));
});

test('OAuth: fallback de modelo mantém método, contexto e identidade sem consultar Key Pool', async t => {
  const f = cliFixture(t, (child, attempt) => {
    child.stdout.write(JSON.stringify(attempt === 1 ? { type: 'result', status: 'error', error: { message: 'RESOURCE_EXHAUSTED quota 429' } } : { type: 'result', status: 'success' }) + '\n');
    child.emit('close', attempt === 1 ? 1 : 0, null);
  }, { selectedType: 'oauth-personal', cachedOAuth: true, keys: {}, fastTimers: true });
  assert.equal((await f.execute({ agentId: 'principal', fallbackModel: 'fallback-model' })).code, 0);
  assert.equal(f.invocations.length, 2); assert.equal(f.auth.poolCalls, 0); assert.equal(f.results.length, 0);
  assert.ok(f.invocations[1].args.includes('fallback-model')); assert.match(f.invocations[1].system, /memória validada/);
  assert.ok(f.events.some(event => event.data?.content?.includes('Modelo de Fallback Acionado')));
});

test('Sem autenticação real: erro específico, nenhum subprocesso e liberação da execução', async t => {
  const f = cliFixture(t, () => assert.fail('Não deveria executar'), { keys: {} });
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
    if (mode === 'api-key') { assert.equal(status.apiValid, true); assert.equal(status.maskedApiKey, '***'); assert.equal(validation.checked, true); }
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
      getGuiDataDir: () => dir, getResolvedCliPath: () => 'fixture', syncAgentsToSettings() {}, syncPoliciesToSettings() {},
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
    const context = vm.createContext({ console: { ...console, error() {} }, process: auth.process, AbortController, ...auth.globals,
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
