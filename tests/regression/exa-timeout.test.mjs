import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const root = process.env.CLI_RUNTIME_TEST_ROOT || path.resolve(import.meta.dirname, '../..');
const rateMessage = "You've hit Exa's free MCP rate limit. To continue using without limits, create your own Exa API key.";
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-timeout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'runtime.mjs');
  if (process.env.CLI_RUNTIME_TEST_ROOT) fs.copyFileSync(path.join(root, 'dist/cli-runtime.mjs'), file);
  else buildSync({ entryPoints: [path.join(root, 'server/cli-runtime.ts')], outfile: file, bundle: true, platform: 'node', format: 'esm' });
  const envNames = ['GEMINI_GUI_RUNTIME_MODULE', 'GEMINI_GUI_RUNTIME_URL', 'GEMINI_GUI_RUNTIME_TOKEN', 'GEMINI_GUI_AGENT_ID'];
  const saved = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  process.env.GEMINI_GUI_RUNTIME_MODULE = pathToFileURL(file).href;
  process.env.GEMINI_GUI_AGENT_ID = 'principal';
  process.env.GEMINI_GUI_RUNTIME_TOKEN = 'local-only-fixture';
  t.after(() => { for (const name of envNames) saved[name] === undefined ? delete process.env[name] : process.env[name] = saved[name]; });
  const actions = [], events = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const data = JSON.parse(raw); actions.push(data);
    res.setHeader('Content-Type', 'application/json');
    if (data.action === 'plan') res.end(JSON.stringify({ protocolVersion: 1, executionId: 'local-exa-timeout', configuredModel: data.model, mode: 'api-key', keys: [{ keyId: 'K1', key: 'local-sdk-fixture' }] }));
    else if (data.action === 'attempt') res.end('{"allowed":true}');
    else if (data.action === 'acquire') res.end('{"acquired":true,"eligible":true}');
    else res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.GEMINI_GUI_RUNTIME_URL = 'http://127.0.0.1:' + server.address().port;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const write = process.stdout.write;
  process.stdout.write = function(chunk, ...rest) {
    if (typeof chunk === 'string') {
      try { const event = JSON.parse(chunk); if (event.type === 'runtime_event' || event.type === 'tool_result') { events.push(event); return true; } } catch {}
    }
    return write.call(this, chunk, ...rest);
  };
  t.after(() => { process.stdout.write = write; });
  const runtime = await import(pathToFileURL(file).href);
  const { DiscoveredMCPToolInvocation } = await import(pathToFileURL(path.join(root, 'node_modules/@google/gemini-cli/bundle/chunk-YSBB75DZ.js')).href);
  const mcp = (text, response = {}, serverName = 'exa', toolName = 'web_search_exa') => new DiscoveredMCPToolInvocation({
    callTool: async () => [{ functionResponse: { name: toolName, response: { content: [{ type: 'text', text }], ...response } } }],
  }, serverName, toolName, 'local Exa', {}, true, { query: 'local fixture' });
  return { runtime, actions, events, mcp };
}

test('Exa: aviso gratuito sem isError deve ser falha real, preservando o texto bruto', async t => {
  const f = await fixture(t);
  const result = await f.mcp(rateMessage).execute({ abortSignal: new AbortController().signal });
  assert.equal(result.error?.type, 'mcp_tool_error');
  assert.match(result.error.message, /EXA_MCP_RATE_LIMIT/);
  assert.match(String(result.llmContent), /free MCP rate limit/);
  assert.equal(f.actions.length, 0, 'Falha MCP não chega ao Key Pool');
});

test('Exa: resultados válidos, citações da mensagem e outros MCPs não são rate limit', async t => {
  const f = await fixture(t);
  for (const text of ['Title: local result\nURL: https://example.test\nText: valid research', 'Title: rate limit documentation\nText: ' + rateMessage]) {
    const result = await f.mcp(text).execute({ abortSignal: new AbortController().signal });
    assert.equal(result.error, undefined);
    assert(JSON.stringify(result.llmContent).includes(text.split('\n')[0]));
  }
  const other = await f.mcp(rateMessage, {}, 'personal', 'custom_search').execute({ abortSignal: new AbortController().signal });
  assert.equal(other.error, undefined);
});

test('Exa: isError e erro HTTP 429 já tratados pelo CLI continuam falhas', async t => {
  const f = await fixture(t);
  for (const response of [{ isError: true }, { isError: true, error: { message: 'HTTP 429 local fixture' } }]) {
    const result = await f.mcp(rateMessage, response).execute({ abortSignal: new AbortController().signal });
    assert(result.error); assert.match(result.error.message, /free MCP rate limit/);
  }
  assert.equal(f.actions.length, 0);
});

test('Exa: configuração efetiva usa header documentado quando a variável chega ao backend', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.gemini'));
  const settings = { mcpServers: { exa: { url: 'http://127.0.0.1/mcp', headers: { 'x-api-key': '$EXA_API_KEY', Authorization: 'Bearer $EXA_API_KEY' }, env: { EXA_API_KEY: '$EXA_API_KEY' } } } };
  const settingsPath = path.join(dir, '.gemini/settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
  const original = fs.readFileSync(settingsPath);
  const source = fs.readFileSync(path.join(root, 'server/gemini-cli-service.ts'), 'utf8');
  const fn = source.slice(source.indexOf('export async function resolveEffectiveCliConfig('), source.indexOf('export function executeGeminiCli(')).replace('export ', '');
  for (const key of ['', 'local-exa-fixture-key']) {
    const context = vm.createContext({ fs, path, os, process: { env: { EXA_API_KEY: key } }, getGuiDataDir: () => dir, loadMcpSettings() {}, resolveCliAuthentication: () => ({ selectedType: 'gemini-api-key' }), getResolvedCliPath: () => '', loadAgents: () => [] });
    vm.runInContext(stripTypeScriptTypes(fn, { mode: 'transform' }), context);
    const effective = await context.resolveEffectiveCliConfig(dir, 'local-config');
    const config = JSON.parse(fs.readFileSync(effective)).mcpServers.exa;
    assert.equal(config.headers['x-api-key'], key);
    assert.equal(config.headers.Authorization, 'Bearer ' + key);
    assert.equal(new URL(config.url).search, '');
    assert.equal(fs.statSync(effective).mode & 0o777, 0o600);
    assert.deepEqual(fs.readFileSync(settingsPath), original, 'Resolução não altera configuração pessoal');
  }
});

test('Exa: patch do resultado MCP é idempotente nos três bundles instaláveis', async () => {
  const { patchMcpErrors } = (await import(pathToFileURL(path.join(root, 'scripts/patch-gemini-cli.cjs')).href)).default;
  for (const name of ['YSBB75DZ', 'S4PJ76PA', 'SM627E5R']) {
    const patched = fs.readFileSync(path.join(root, 'node_modules/@google/gemini-cli/bundle/chunk-' + name + '.js'), 'utf8');
    assert.equal(patchMcpErrors(patched), patched);
    const original = patched.replace(/    \/\/ __GUI_EXA_MCP_ERROR_V1__[\s\S]*?(?=    if \(this.isMCPToolError)/, '');
    assert.equal(patchMcpErrors(original), patched);
  }
});

test('Timeout: SDK que entrega resposta após o prazo não pode registrar sucesso', async t => {
  const f = await fixture(t);
  const sdk = f.runtime.wrapModels({}, () => ({ generateContent: async () => { await new Promise(resolve => setTimeout(resolve, 70)); return { text: 'late result' }; } }));
  await assert.rejects(sdk.generateContent({ model: 'gemini-3.7-flash', config: { httpOptions: { timeout: 25 } } }), error => error.code === 'GUI_REQUEST_TIMEOUT');
  assert.equal(f.actions.filter(action => action.action === 'result' && action.success).length, 0);
  assert.equal(f.events.find(event => event.event === 'API_FAILURE').affectsKey, false);
});

test('Timeout: espera por resposta e stream interrompido têm fases e contadores distintos', async t => {
  const f = await fixture(t);
  for (const partial of [false, true]) {
    const abort = signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted sending request'), { name: 'AbortError' })), { once: true }));
    const sdk = f.runtime.wrapModels({}, () => ({ generateContentStream: async request => {
      if (!partial) { await abort(request.config.abortSignal); return; }
      return (async function* () { yield { text: 'local chunk' }; await abort(request.config.abortSignal); })();
    } }));
    const run = () => sdk.generateContentStream({ model: 'gemini-3.7-flash', config: { httpOptions: { timeout: 35 } } });
    await assert.rejects(f.runtime.runDelegation('investigator', 'inv-' + partial, { prompt: 'local-' + partial }, new AbortController().signal, run, 'parent-' + partial), error => {
      assert.equal(error.code, 'GUI_REQUEST_TIMEOUT');
      assert.equal(error.runtimeDetails.requestPhase, partial ? 'streaming' : 'awaiting_response');
      assert.equal(error.runtimeDetails.responseChunks, partial ? 1 : 0);
      assert.equal(error.runtimeDetails.affectsKey, false);
      // Timers and Date.now() have independent millisecond rounding: 35 ms
      // can legitimately be reported as 34 ms. Verify the deadline contract.
      assert.equal(error.runtimeDetails.timeoutMs, 35);
      assert.equal(error.runtimeDetails.abortedBy, 'request_timeout');
      assert(Number.isFinite(error.runtimeDetails.elapsedMs));
      assert(error.runtimeDetails.elapsedMs >= 0);
      return true;
    });
    const terminal = f.events.find(event => event.type === 'tool_result' && event.tool_id === 'parent-' + partial);
    assert.equal(terminal.agentId, 'investigator'); assert.equal(terminal.status, 'failed'); assert(terminal.requestId);
    assert.equal(terminal.cause.requestPhase, partial ? 'streaming' : 'awaiting_response');
  }
  assert(!f.events.some(event => ['KEY_FAILOVER', 'MODEL_FALLBACK', 'RUNTIME_BRIDGE_FAILURE'].includes(event.event)));
});

test('Timeout: ferramentas anteriores e timer de requisição concluída não abortam a próxima', async t => {
  const f = await fixture(t), signals = [];
  const sdk = f.runtime.wrapModels({}, () => ({ generateContentStream: async request => {
    signals.push(request.config.abortSignal);
    return (async function* () { yield { text: 'normal local completion' }; })();
  } }));
  await new Promise(resolve => setTimeout(resolve, 50)); // Ferramenta anterior, fora do deadline do SDK.
  for (let i = 0; i < 2; i++) {
    const stream = await sdk.generateContentStream({ model: 'gemini-3.7-flash', config: { httpOptions: { timeout: 25 } } });
    assert.equal((await Array.fromAsync(stream)).length, 1);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(signals.at(-1).aborted, false, 'Deadline encerrado com a resposta');
  }
  assert.notEqual(signals[0], signals[1]);
  assert.equal(f.actions.filter(action => action.action === 'result' && action.success).length, 2);
});

test('Timeout: cancelamento do chamador conserva causa distinta do deadline', async t => {
  const f = await fixture(t), controller = new AbortController();
  const sdk = f.runtime.wrapModels({}, () => ({ generateContent: async request => {
    controller.abort(); request.config.abortSignal.throwIfAborted();
  } }));
  await assert.rejects(sdk.generateContent({ model: 'gemini-3.7-flash', config: { abortSignal: controller.signal, httpOptions: { timeout: 100 } } }), error => error.code === 'GUI_EXECUTION_CANCELLED' && error.runtimeDetails.abortedBy === 'caller');
  assert.equal(f.actions.filter(action => action.action === 'result' && action.success).length, 0);
});
