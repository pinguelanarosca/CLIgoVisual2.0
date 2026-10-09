import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { GoogleGenAI } from '@google/genai';

const root = path.resolve(import.meta.dirname, '../..');
function load(file, globals) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/^import[\s\S]*?;\s*/gm, '').replace(/\bexport\s+/g, '');
  const context = vm.createContext({ process, fs, os, path, http, crypto, Buffer, console, ...globals });
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }), context);
  return context;
}
async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-lifecycle-'));
  const runtimeFile = process.env.CLI_RUNTIME_TEST_ROOT
    ? path.join(process.env.CLI_RUNTIME_TEST_ROOT, 'dist/cli-runtime.mjs') : path.join(dir, 'runtime.mjs');
  if (!process.env.CLI_RUNTIME_TEST_ROOT) buildSync({ entryPoints: [path.join(root, 'server/cli-runtime.ts')], outfile: runtimeFile, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
  const runtime = await import(pathToFileURL(runtimeFile).href + '?' + crypto.randomUUID());
  const events = [], records = [], calls = [];
  const classifier = load('server/key-pool-service.ts', { os: { ...os, homedir: () => dir }, sysLog: { info() {}, warn() {} } });
  const ranked = Array.from({ length: options.keys || 2 }, (_, i) => ({ keyId: 'K' + (i + 1), key: ['fixture-key-one', 'fixture-key-two'][i] || 'fixture-key-' + (i + 1) }));
  if (options.pool) { classifier.saveConfiguredKeys(Object.fromEntries(ranked.map(k => [k.keyId, k.key]))); options.preparePool?.(classifier); }
  let plans = 0, resultDropped = false;
  const serverHttp = options.dropResult ? { ...http, createServer(handler) {
    return http.createServer((req, res) => {
      const end = res.end.bind(res);
      res.end = function (...args) {
        if (!resultDropped && records.length) { resultDropped = true; res.destroy(); return res; }
        return end(...args);
      };
      handler(req, res);
    });
  } } : http;
  const bridgeContext = load('server/runtime-bridge.ts', {
    http: serverHttp, classifyKeyResult: classifier.classifyKeyResult,
    getRankedKeys: model => options.pool ? classifier.getRankedKeys(model) : ranked, getEligibleRankedKeys: model => {
      if (options.failPlanAlways || options.failPlanOnce && ++plans === 1) throw Error('controlled plan failure');
      return options.pool ? classifier.getEligibleRankedKeys(model) : options.eligible ? options.eligible(model, ranked) : ranked;
    }, getModelAvailability: model => options.pool ? classifier.getModelAvailability(model) : ({ configured: ranked.length, eligible: ranked.length }),
    recordRuntimeExecutionResult: (...args) => { records.push(args); if (options.pool) classifier.recordRuntimeExecutionResult(...args); if (options.failRecord) throw Error('controlled ambiguous commit'); }, loadConfiguredKeys: () => ({}),
  });
  const channel = await bridgeContext.createRuntimeBridge({ executionId: 'lifecycle-fixture', agents: [{ name: 'investigator', model: 'gemini-3.7-flash', fallbackModel: options.fallback }], agentId: 'principal', mode: 'api-key', onEvent: e => events.push(e.data) });
  let requestStarted;
  const providerRequested = new Promise(resolve => { requestStarted = resolve; });
  const provider = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ key: req.headers['x-goog-api-key'], body: JSON.parse(body), url: req.url });
    requestStarted();
    const status = options.respond?.(calls.at(-1), calls) || (options.recover503 && calls.length === 1 ? 503 : 200);
    if (status !== 200) {
      res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: status, message: status === 503 ? 'high demand' : 'quota exhausted', status: status === 503 ? 'UNAVAILABLE' : 'RESOURCE_EXHAUSTED' } })); return;
    }
    const finish = () => {
      if (res.destroyed) return;
      const payload = { candidates: [{ content: { role: 'model', parts: [{ text: 'RECOVERED_RESULT' }] }, finishReason: 'STOP' }] };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: ' + JSON.stringify(payload) + '\n\n');
    };
    if (options.slow) setTimeout(finish, 180).unref(); else finish();
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${provider.address().port}`;
  const originalEnv = { ...process.env };
  Object.assign(process.env, { GEMINI_GUI_RUNTIME_URL: channel.url, GEMINI_GUI_RUNTIME_TOKEN: channel.token, GEMINI_GUI_AGENT_ID: 'principal' });
  const writes = [], write = process.stdout.write;
  process.stdout.write = function (chunk, ...args) {
    if (String(chunk).startsWith('{"type":')) { for (const line of String(chunk).trim().split('\n')) try { writes.push(JSON.parse(line)); } catch {} return true; }
    return write.call(this, chunk, ...args);
  };
  t.after(() => {
    process.stdout.write = write;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv); channel.close(); provider.closeAllConnections(); provider.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const factory = key => options.localError ? { generateContentStream: async () => { calls.push({ key, local: true }); throw options.localError; } } : new GoogleGenAI({ apiKey: key, httpOptions: { baseUrl: endpoint } }).models;
  const models = runtime.wrapModels(factory('fixture-key-one'), factory, endpoint);
  const run = async (signal = new AbortController().signal, timeout = 1000) => runtime.runDelegation('investigator', 'fixture-invocation', {}, signal, async () => {
    let result = '';
    for (let turn = 0; turn < (options.turns || 1); turn++) {
      const response = await runtime.runWithAgent('investigator', 'fixture-invocation', () => models.generateContentStream({ model: 'gemini-3.7-flash', contents: options.contents || 'fixture', config: { ...options.config, abortSignal: signal, httpOptions: { timeout } } }));
      for await (const chunk of response) result += chunk.text;
    }
    return { terminate_reason: 'GOAL', result };
  }, 'fixture-parent-call');
  return { channel, runtime, events, records, calls, writes, run, classifier, providerRequested, create: () => bridgeContext.createRuntimeBridge({ executionId: 'next-execution', agents: [{ name: 'investigator', model: 'gemini-3.7-flash', fallbackModel: options.fallback }], agentId: 'principal', mode: 'api-key', onEvent: e => events.push(e.data) }) };
}

test('Bridge: SDK real identifica timeout, sem penalizar chave nem disparar failover', async t => {
  const f = await fixture(t, { slow: true });
  await assert.rejects(f.run(undefined, 45), error => error.code === 'GUI_REQUEST_TIMEOUT');
  assert.equal(f.calls.length, 1); assert.equal(f.records.length, 0);
  const failure = f.writes.find(e => e.event === 'API_FAILURE');
  assert.equal(failure.abortedBy, 'request_timeout'); assert.equal(failure.timeoutMs, 45);
  assert.equal(failure.affectsKey, false); assert(failure.requestId);
  const terminal = f.writes.find(e => e.tool_id === 'fixture-parent-call');
  assert.equal(terminal.status, 'failed'); assert.equal(terminal.requestId, failure.requestId);
  assert.equal(terminal.model, 'gemini-3.7-flash');
});

test('Bridge: cancelamento do chamador preserva causa e estado cancelled', async t => {
  const f = await fixture(t, { slow: true }); const controller = new AbortController();
  const pending = f.run(controller.signal);
  // Cancel during the request, not at an assumed IPC/network scheduling time.
  await Promise.race([f.providerRequested, pending.then(() => { throw new Error('Provider completed before controlled cancellation'); })]);
  controller.abort(new Error('cancelamento controlado pelo usuário'));
  await assert.rejects(pending, error => error.code === 'GUI_EXECUTION_CANCELLED');
  assert.equal(f.records.length, 0); assert.equal(f.calls.length, 1);
  const failure = f.writes.find(e => e.event === 'API_FAILURE'); assert.equal(failure.abortedBy, 'caller');
  assert.equal(f.writes.find(e => e.tool_id === 'fixture-parent-call').status, 'cancelled');
});

test('Bridge: 503 real preservado e recuperação entrega resultado terminal válido', async t => {
  const f = await fixture(t, { recover503: true }); const result = await f.run();
  assert.equal(result.result, 'RECOVERED_RESULT'); assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls.map(c => c.key), ['fixture-key-one', 'fixture-key-two']);
  const failure = f.writes.find(e => e.event === 'API_FAILURE'); assert.equal(failure.httpStatus, 503);
  assert.equal(failure.errorCode, '503_OVERLOAD');
  const success = f.writes.find(e => e.event === 'SUCCESS'); assert(success.requestId);
  const terminal = f.writes.find(e => e.tool_id === 'fixture-parent-call');
  assert.equal(terminal.status, 'success'); assert.equal(terminal.requestId, success.requestId);
});

test('Bridge: falha transitória de IPC recupera sem repetir chamada do provedor', async t => {
  const f = await fixture(t, { failPlanOnce: true }); assert.equal((await f.run()).result, 'RECOVERED_RESULT');
  assert.equal(f.calls.length, 1); assert(f.events.some(e => e.event === 'RUNTIME_BRIDGE_ERROR'));
  assert(f.writes.some(e => e.event === 'RUNTIME_BRIDGE_RETRY'));
});

test('Bridge: resposta IPC perdida após commit não duplica registro ou orçamento', async t => {
  const f = await fixture(t, { dropResult: true }); assert.equal((await f.run()).result, 'RECOVERED_RESULT');
  assert.equal(f.calls.length, 1); assert.equal(f.records.length, 1);
});

test('Bridge: protocolo antigo falha antes do provedor com ação e versão claras', async t => {
  const f = await fixture(t);
  const old = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ keys: [], mode: 'api-key' })); });
  await new Promise(resolve => old.listen(0, '127.0.0.1', resolve));
  t.after(() => { old.closeAllConnections(); old.close(); });
  process.env.GEMINI_GUI_RUNTIME_URL = `http://127.0.0.1:${old.address().port}`;
  await assert.rejects(f.run(), error => error.code === 'GUI_RUNTIME_PROTOCOL' && error.bridgeAction === 'plan' && error.runtimeDetails.expectedProtocolVersion === 1 && /reinicie o backend/.test(error.message));
  assert.equal(f.calls.length, 0); assert.equal(f.records.length, 0);
});

test('Bridge: falha persistente encerra após uma recuperação IPC, sem chamada ao provedor', async t => {
  const f = await fixture(t, { failPlanAlways: true });
  await assert.rejects(f.run(), error => error.code === 'GUI_RUNTIME_UNAVAILABLE' && error.runtimeDetails.bridgeHttpStatus === 500);
  assert.equal(f.calls.length, 0); assert.equal(f.records.length, 0);
  assert.equal(f.writes.filter(e => e.event === 'RUNTIME_BRIDGE_RETRY').length, 1);
  const terminal = f.writes.find(e => e.tool_id === 'fixture-parent-call');
  assert.equal(terminal.status, 'failed'); assert.equal(terminal.bridgeAction, 'plan'); assert.equal(terminal.model, 'gemini-3.7-flash');
});

test('Bridge: fechamento libera leases e canal novo inicia sem herdar reservas', async t => {
  const f = await fixture(t);
  const call = input => fetch(f.channel.url, { method: 'POST', headers: { Authorization: `Bearer ${f.channel.token}` }, body: JSON.stringify(input) }).then(r => r.json());
  assert.equal((await call({ action: 'acquire', model: 'gemini-3.7-flash', keyId: 'K1', requestId: 'held' })).acquired, true);
  f.channel.close(); f.channel.close();
  await assert.rejects(call({ action: 'plan', model: 'gemini-3.7-flash' }));
  assert(f.events.some(e => e.event === 'RUNTIME_BRIDGE_CLOSED'));
  // A new execution uses an independent socket/token and starts successfully.
  const next = await f.create(); t.after(() => next.close());
  Object.assign(process.env, { GEMINI_GUI_RUNTIME_URL: next.url, GEMINI_GUI_RUNTIME_TOKEN: next.token });
  assert.equal((await f.run()).result, 'RECOVERED_RESULT');
});

test('Bridge: commit ambíguo não repete escrita no Key Pool nem chamada do provedor', async t => {
  const f = await fixture(t, { failRecord: true });
  await assert.rejects(f.run(), error => error.code === 'GUI_RUNTIME_UNAVAILABLE');
  assert.equal(f.calls.length, 1); assert.equal(f.records.length, 1);
  assert(!f.writes.some(e => e.event === 'API_FAILURE'), 'HTTP 500 do IPC não é erro HTTP do provedor');
});

test('Bridge: replay de attempt/result não duplica reservas, cooldown ou orçamento', async t => {
  const f = await fixture(t);
  const call = input => fetch(f.channel.url, { method: 'POST', headers: { Authorization: `Bearer ${f.channel.token}` }, body: JSON.stringify(input) }).then(r => r.json());
  for (let i = 0; i < 6; i++) assert.equal((await call({ action: 'attempt', invocationId: 'same-invocation', requestId: 'attempt-' + i })).allowed, true);
  assert.equal((await call({ action: 'attempt', invocationId: 'same-invocation', requestId: 'attempt-0' })).allowed, true);
  const failure = { action: 'result', invocationId: 'same-invocation', requestId: 'attempt-0', model: 'gemini-3.7-flash', keyId: 'K1', status: 503, success: false, message: 'high demand' };
  const first = await call(failure), second = await call(failure);
  assert.deepEqual(first, second); assert.equal(f.records.length, 1);
  const budget = await call({ action: 'attempt', invocationId: 'same-invocation', requestId: 'attempt-7' });
  assert.equal(budget.allowed, false); assert.equal(budget.failures, 1);
});

test('Bridge: IPC sem resposta respeita o limite original de 10s e informa origem local', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const hanging = http.createServer(() => {});
  await new Promise(resolve => hanging.listen(0, '127.0.0.1', resolve));
  t.after(() => { hanging.closeAllConnections(); hanging.close(); });
  process.env.GEMINI_GUI_RUNTIME_URL = `http://127.0.0.1:${hanging.address().port}`;
  const start = performance.now();
  await assert.rejects(f.run(), error => error.code === 'GUI_RUNTIME_TIMEOUT' && error.runtimeDetails.abortedBy === 'bridge_timeout');
  assert(performance.now() - start < 12000); assert.equal(f.calls.length, 0); assert.equal(f.records.length, 0);
  assert(!f.writes.some(e => e.event === 'RUNTIME_BRIDGE_RETRY'));
});

test('Fallback: muitas chaves não consomem o orçamento inteiro no titular após 503', async t => {
  const f = await fixture(t, { keys: 9, fallback: 'gemini-3.6-flash', respond: call => call.url.includes('gemini-3.7-flash') ? 503 : 200 });
  assert.equal((await f.run()).result, 'RECOVERED_RESULT');
  assert.deepEqual(f.calls.map(c => c.url.match(/models\/([^:]+):/)[1]), ['gemini-3.7-flash', 'gemini-3.7-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']);
  const change = f.writes.find(e => e.event === 'MODEL_FALLBACK');
  assert.equal(change.fromModel, 'gemini-3.7-flash'); assert.equal(change.toModel, 'gemini-3.6-flash');
  assert.equal(change.reason, 'PRIMARY_RETRY_LIMIT'); assert.equal(change.keyId, 'K1');
  assert.equal(change.previousRequestId, f.writes.filter(e => e.event === 'API_FAILURE').at(-1).requestId);
  assert.equal(change.requestId, f.writes.find(e => e.event === 'SUCCESS').requestId);
  assert.equal(change.invocationId, 'fixture-invocation'); assert.equal(change.agentId, 'investigator');
  assert.equal(change.cause.httpStatus, 503); assert.equal(change.cause.errorCode, '503_OVERLOAD');
  assert.equal(f.writes.find(e => e.tool_id === 'fixture-parent-call').status, 'success');
});

test('Fallback: seis falhas totais encerram em 3 titular + 3 fallback, sem tentativa fictícia', async t => {
  const f = await fixture(t, { keys: 9, fallback: 'gemini-3.6-flash', respond: () => 503 });
  await assert.rejects(f.run(), error => error.code === 'GUI_RETRY_BUDGET' && error.runtimeDetails.model === 'gemini-3.6-flash');
  assert.deepEqual(f.calls.map(c => c.url.match(/models\/([^:]+):/)[1]), [...Array(3).fill('gemini-3.7-flash'), ...Array(3).fill('gemini-3.6-flash')]);
  const attempts = f.writes.filter(e => ['ATTEMPT', 'KEY_FAILOVER'].includes(e.event));
  assert.equal(attempts.length, 6); assert.equal(new Set(attempts.map(e => e.requestId)).size, 6);
  assert.equal(f.writes.filter(e => e.event === 'MODEL_FALLBACK').length, 1);
  assert.equal(f.records.length, 6);
  const terminal = f.writes.find(e => e.tool_id === 'fixture-parent-call');
  assert.equal(terminal.status, 'failed'); assert.equal(terminal.model, 'gemini-3.6-flash');
  assert.equal(terminal.requestId, f.writes.filter(e => e.event === 'API_FAILURE').at(-1).requestId);
});

test('Fallback: falhas acumulam entre ferramentas; modelo não retorna ao titular após recuperação', async t => {
  const sequence = [503, 200, 503, 200, 503];
  const contents = [{ role: 'user', parts: [{ text: 'contexto delegado intacto' }] }];
  const config = { systemInstruction: 'identidade Investigator preservada', tools: [{ functionDeclarations: [{ name: 'fixture_tool', description: 'permissão mantida', parameters: { type: 'OBJECT', properties: {} } }] }], temperature: 0.2 };
  const f = await fixture(t, { keys: 9, fallback: 'gemini-3.6-flash', turns: 4, contents, config, respond: (call, calls) => call.url.includes('gemini-3.7-flash') ? sequence[calls.length - 1] || 200 : 200 });
  assert.equal((await f.run()).result, 'RECOVERED_RESULT'.repeat(4));
  const order = f.calls.map(c => c.url.match(/models\/([^:]+):/)[1]);
  assert.deepEqual(order, [...Array(5).fill('gemini-3.7-flash'), ...Array(2).fill('gemini-3.6-flash')]);
  assert.equal(f.writes.filter(e => e.event === 'MODEL_FALLBACK').length, 1);
  for (const call of f.calls) assert.deepEqual(call.body, f.calls[0].body, 'contexto, parâmetros, instruções e ferramentas não mudam no failover');
  const terminal = f.writes.find(e => e.tool_id === 'fixture-parent-call');
  assert.equal(terminal.status, 'success'); assert.equal(terminal.model, 'gemini-3.6-flash'); assert.equal(terminal.agentId, 'investigator');
});

test('Fallback: HTTP 429 usa a mesma ordem; fallback real configurado pode ser 3.5', async t => {
  const f = await fixture(t, { keys: 9, fallback: 'gemini-3.5-flash', respond: call => call.url.includes('gemini-3.7-flash') ? 429 : 200 });
  assert.equal((await f.run()).result, 'RECOVERED_RESULT');
  assert(f.calls.at(-1).url.includes('gemini-3.5-flash'));
  assert(f.writes.filter(e => e.event === 'API_FAILURE').every(e => e.group === 'G3' && e.httpStatus === 429));
  assert.equal(f.writes.find(e => e.event === 'MODEL_FALLBACK').toModel, 'gemini-3.5-flash');
});

test('Fallback: ranking e cooldown reais são independentes por modelo', async t => {
  const f = await fixture(t, { keys: 9, fallback: 'gemini-3.6-flash', pool: true,
    preparePool(pool) {
      pool.recordRuntimeExecutionResult('gemini-3.7-flash', 'K9', { success: true, latencyMs: 5 });
      pool.recordRuntimeExecutionResult('gemini-3.6-flash', 'K2', { success: false, httpStatus: 429, errorText: 'quota; retry in 1h' });
      pool.recordRuntimeExecutionResult('gemini-3.6-flash', 'K8', { success: true, latencyMs: 3 });
    }, respond: call => call.url.includes('gemini-3.7-flash') ? 503 : 200 });
  assert.equal((await f.run()).result, 'RECOVERED_RESULT');
  assert.deepEqual(f.calls.map(c => c.key), ['fixture-key-9', 'fixture-key-one', 'fixture-key-two', 'fixture-key-8']);
  const state = f.classifier.loadKeyPoolState();
  for (const keyId of ['K9', 'K1', 'K2']) { assert.equal(state.items['gemini-3.7-flash:' + keyId].currentGroup, 'G2'); assert(state.items['gemini-3.7-flash:' + keyId].cooldownUntil); }
  assert.equal(state.items['gemini-3.6-flash:K8'].currentGroup, 'G1');
  assert.equal(state.items['gemini-3.6-flash:K2'].currentGroup, 'G3');
});

for (const [label, localError, expectedCalls] of [['OOM', new Error('JavaScript heap out of memory'), 1], ['rede', new TypeError('fetch failed'), 2]]) {
  test('Fallback: erro local de ' + label + ' não troca modelos nem penaliza chaves', async t => {
    const f = await fixture(t, { keys: 9, fallback: 'gemini-3.6-flash', localError });
    await assert.rejects(f.run()); assert.equal(f.calls.length, expectedCalls); assert.equal(f.records.length, 0);
    assert.equal(f.writes.filter(e => e.event === 'MODEL_FALLBACK').length, 0);
    assert(f.writes.filter(e => e.event === 'API_FAILURE').every(e => e.affectsKey === false));
  });
}

test('Fallback: sem titular elegível tenta fallback diretamente, sem esperar cooldown', async t => {
  const f = await fixture(t, { keys: 9, fallback: 'gemini-3.6-flash', eligible: (model, keys) => model === 'gemini-3.7-flash' ? [] : keys });
  assert.equal((await f.run()).result, 'RECOVERED_RESULT'); assert.equal(f.calls.length, 1);
  assert(f.calls[0].url.includes('gemini-3.6-flash'));
  assert.equal(f.writes.find(e => e.event === 'MODEL_FALLBACK').reason, 'MODEL_OPTIONS_EXHAUSTED');
});

test('Fallback: modelo igual ao titular não cria ciclo nem transição', async t => {
  const f = await fixture(t, { keys: 9, fallback: 'gemini-3.7-flash', respond: () => 503 });
  await assert.rejects(f.run(), error => error.code === 'GUI_RETRY_BUDGET');
  assert.equal(f.calls.length, 6); assert.equal(f.writes.filter(e => e.event === 'MODEL_FALLBACK').length, 0);
});

test('Fallback: abortos e timeout locais não acionam fallback configurado', async t => {
  const f = await fixture(t, { keys: 9, fallback: 'gemini-3.6-flash', slow: true });
  await assert.rejects(f.run(undefined, 45), error => error.code === 'GUI_REQUEST_TIMEOUT');
  assert.equal(f.calls.length, 1); assert.equal(f.records.length, 0);
  assert.equal(f.writes.filter(e => e.event === 'MODEL_FALLBACK').length, 0);
});

test('Fallback: última unidade do orçamento global pertence ao fallback, sem aumentar limite', async t => {
  const f = await fixture(t, { keys: 9, fallback: 'gemini-3.6-flash', respond: () => 503 });
  const call = input => fetch(f.channel.url, { method: 'POST', headers: { Authorization: `Bearer ${f.channel.token}` }, body: JSON.stringify(input) }).then(r => r.json());
  for (let i = 0; i < 11; i++) {
    const invocationId = 'prior-agent-' + Math.floor(i / 6);
    assert.equal((await call({ action: 'attempt', invocationId, requestId: 'prior-' + i })).allowed, true);
    await call({ action: 'result', success: false, status: 503, message: 'high demand', model: 'other-model', invocationId, requestId: 'prior-' + i });
  }
  await assert.rejects(f.run(), error => error.code === 'GUI_RETRY_BUDGET');
  assert.equal(f.calls.length, 1); assert(f.calls[0].url.includes('gemini-3.6-flash'));
  assert.equal(f.writes.find(e => e.event === 'MODEL_FALLBACK').reason, 'GLOBAL_BUDGET_RESERVED');
  assert.equal((await call({ action: 'attempt', invocationId: 'new-agent', requestId: 'beyond-12' })).allowed, false);
});

test('Fallback: configuração atual 3.7 → 3.5 recupera após HTTP 503', async t => {
  const f = await fixture(t, { keys: 9, fallback: 'gemini-3.5-flash', respond: call => call.url.includes('gemini-3.7-flash') ? 503 : 200 });
  assert.equal((await f.run()).result, 'RECOVERED_RESULT');
  assert.deepEqual(f.calls.map(c => c.url.match(/models\/([^:]+):/)[1]), [...Array(3).fill('gemini-3.7-flash'), 'gemini-3.5-flash']);
  assert.equal(f.writes.find(e => e.event === 'MODEL_FALLBACK').toModel, 'gemini-3.5-flash');
});

test('Fallback: reservas simultâneas limitam titular e não repetem requestId', async t => {
  const f = await fixture(t, { keys: 9, fallback: 'gemini-3.6-flash' });
  const call = input => fetch(f.channel.url, { method: 'POST', headers: { Authorization: `Bearer ${f.channel.token}` }, body: JSON.stringify(input) }).then(r => r.json());
  const input = { action: 'attempt', agentId: 'investigator', invocationId: 'concurrent', model: 'gemini-3.7-flash', primaryModel: 'gemini-3.7-flash' };
  const reservations = await Promise.all(Array.from({ length: 4 }, (_, i) => call({ ...input, requestId: 'same-phase-' + i })));
  assert.equal(reservations.filter(r => r.allowed).length, 3);
  assert.equal(reservations[3].nextModel, 'gemini-3.6-flash');
  const replay = await call({ ...input, requestId: 'same-phase-0' }); assert.equal(replay.allowed, true); assert.equal(replay.remaining, 3);
  await call({ action: 'release', attemptRequestIds: ['same-phase-0', 'same-phase-1', 'same-phase-2'] });
  const next = await call({ ...input, model: 'gemini-3.6-flash', requestId: 'fallback-reserved' }); assert.equal(next.allowed, true);
  assert.equal((await call({ ...input, requestId: 'primary-loop' })).reason, 'FALLBACK_ACTIVE');
  assert.equal(f.calls.length, 0); assert.equal(f.records.length, 0);
});
