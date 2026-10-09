import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
const root = path.resolve(import.meta.dirname, '../..');

for (const scenario of ['D-429', 'V-503', 'E-404-repair', 'F-404-fallback', 'I-web-exa', 'I-exa-rate', 'I-web-exa-rate', 'I-investigator-exa-timeout', 'S-all', 'T-local-tools', 'O-oi', 'U-unavailable', 'J-503-exhausted', 'N-network', 'X-terminal', 'R-503-recovered', 'A-timeout', 'B-503-budget', 'B-503-budget-failed']) test(`CLI real ${scenario}: Principal e ferramentas reais com API/MCP locais controlados`, { timeout: 60000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoke-real-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runtimeFile = path.join(dir, 'cli-runtime.mjs');
  buildSync({ entryPoints: [path.join(root, 'server/cli-runtime.ts')], outfile: runtimeFile, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
  const classifierSource = fs.readFileSync(path.join(root, 'server/key-pool-service.ts'), 'utf8').replace(/^import[\s\S]*?;\s*/gm, '').replace(/\bexport\s+/g, '');
  const classifier = vm.createContext({ process, fs, os, path });
  vm.runInContext(stripTypeScriptTypes(classifierSource, { mode: 'transform' }), classifier);
  const calls = [], results = [];
  const budgetScenario = scenario.startsWith('B-503-budget');
  const investigatorTimeout = scenario === 'I-investigator-exa-timeout';
  const exaScenario = scenario.startsWith('I-');
  const delegatedAgent = budgetScenario || investigatorTimeout ? 'investigator' : 'architect';
  let exaCalls = 0;
  const agentModels = { architect: 'gemini-3.6-flash', auditor: 'gemini-3.8-flash', investigator: 'gemini-3.7-flash', tester: 'gemini-3.5-flash', worker: 'gemini-3.5-flash-lite' };
  let activeSubagents = 0, maxActiveSubagents = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const data = raw ? JSON.parse(raw) : {};
    fs.appendFileSync('/tmp/cligovisual-test-http.log', scenario + ' ' + req.method + ' ' + req.url + ' ' + (data.method || data.action || '') + '\n');
    if (req.url === '/mcp') {
      assert.equal(req.headers['x-api-key'], 'local-exa-fixture-key', 'Header efetivo do MCP contém somente a credencial local do fixture');
      assert(!req.url.includes('ApiKey'), 'Credencial não é colocada na URL');
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      res.setHeader('Content-Type', 'application/json');
      if (data.id === undefined) { res.writeHead(202).end(); return; }
      let result;
      if (data.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'exa-fixture', version: '1' } };
      else if (data.method === 'tools/list') result = { tools: [{ name: 'web_search_exa', description: 'Local controlled Exa MCP', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] };
      else if (data.method === 'tools/call') { exaCalls++; assert.equal(data.params.name, 'web_search_exa'); result = { content: [{ type: 'text', text: scenario.endsWith('-rate') ? "You've hit Exa's free MCP rate limit. To continue using without limits, create your own Exa API key." : 'EXA_ACTUAL_RESULT' }] }; }
      else result = {};
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: data.id, result }));
    }
    if (req.url === '/bridge') {
      res.setHeader('Content-Type', 'application/json');
      if (data.action === 'acquire') return res.end(JSON.stringify({ acquired: true, eligible: true, busy: false }));
      if (data.action === 'release') return res.end('{}');
      if (data.action === 'attempt') return res.end('{"allowed":true}');
      if (data.action === 'plan' && scenario === 'U-unavailable') return res.end(JSON.stringify({ protocolVersion: 1, agentId: data.agentId, configuredModel: data.model, mode: 'api-key', keys: [], availability: { quota: true, nextRetryAt: '2026-10-07T11:00:00Z' } }));
      if (data.action === 'plan') return res.end(JSON.stringify({ protocolVersion: 1, agentId: data.agentId, configuredModel: agentModels[data.agentId] || data.model, fallbackModel: data.agentId === 'architect' && scenario !== 'J-503-exhausted' ? 'gemini-3.7-flash' : undefined, mode: 'api-key', keys: [{ keyId: 'K1', key: 'fixture-k1' }, { keyId: 'K2', key: 'fixture-k2' }] }));
      results.push(data);
      return res.end(JSON.stringify(classifier.classifyKeyResult(data.success ? 200 : data.status, data.code, data.message)));
    }
    if (req.method === 'GET' && req.url.startsWith('/v1beta/models')) {
      results.push({ action: 'catalog', key: req.headers['x-goog-api-key'] });
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ models: scenario === 'E-404-repair' ? [{ name: 'models/gemini-3.6-flash-001', baseModelId: 'gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }] : [] }));
    }
    if (req.url.includes('countTokens')) return res.end(JSON.stringify({ totalTokens: 50 }));
    const match = req.url.match(/models\/([^:]+):/), model = match?.[1];
    calls.push({ model, key: req.headers['x-goog-api-key'], data, startedAt: Date.now() });
    if (investigatorTimeout && model === 'gemini-3.7-flash' && JSON.stringify(data.contents).includes('EXA_ACTUAL_RESULT')) return;
    if (budgetScenario && (model === 'gemini-3.7-flash' || scenario.endsWith('-failed') && model === 'gemini-3.6-flash')) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'high demand; bounded fallback fixture' } })); return; }
    if (model === 'gemini-3.6-flash' && scenario === 'A-timeout') return; // Real installed SDK's existing 30s deadline, no provider traffic.
    if (model === 'gemini-3.6-flash' && scenario === 'R-503-recovered' && calls.filter(call => call.model === model).length === 1) {
      res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'high demand; transient local fixture' } })); return;
    }
    if (model === 'gemini-3.6-flash' && scenario === 'N-network') { res.destroy(); return; }
    if ((model === 'gemini-3.6-flash' && ['D-429', 'V-503', 'E-404-repair', 'F-404-fallback', 'J-503-exhausted'].includes(scenario)) || (scenario.startsWith('I-web-exa') && data.tools?.some(tool => tool.googleSearch))) {
      const status = scenario.startsWith('E') || scenario.startsWith('F') ? 404 : ['V-503', 'J-503-exhausted'].includes(scenario) ? 503 : 429;
      res.writeHead(status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: status, status: status === 404 ? 'NOT_FOUND' : status === 503 ? 'UNAVAILABLE' : 'RESOURCE_EXHAUSTED', message: status === 404 ? 'models/gemini-3.6-flash is not found for API version v1beta' : status === 503 ? 'Service unavailable fixture' : 'quota exhausted fixture' } }));
    }
    const hasInvocation = JSON.stringify(data.contents || []).includes('functionResponse');
    const isPrincipal = model === 'gemini-3.1-flash-lite';
    const hasToolResult = hasInvocation;
    let parts = model === 'gemini-3.1-flash-lite' && !hasInvocation
      ? [{ functionCall: scenario.startsWith('I-web-exa') ? { name: 'google_web_search', args: { query: 'fixture search' } } : { name: 'invoke_agent', args: { agent_name: delegatedAgent, prompt: 'fixture architecture context retained' } } }]
      : [{ text: model === 'gemini-3.7-flash' || model === 'gemini-3.6-flash-001' || model === 'gemini-3.6-flash' ? 'ARCHITECT_SUCCESS' : 'PRINCIPAL_SUCCESS' }];
    if (!hasToolResult && (scenario === 'I-exa-rate' || investigatorTimeout && !isPrincipal)) {
      const tool = data.tools?.flatMap(tool => tool.functionDeclarations || []).find(tool => /web_search_exa$/.test(tool.name));
      assert(tool, 'Exa está disponível nas ferramentas reais do agente');
      parts = [{ functionCall: { name: tool.name, args: { query: 'local fixture' } } }];
    }
    if (scenario === 'S-all') {
      if (isPrincipal && !hasToolResult) parts = [...Object.keys(agentModels), 'software_architect', 'principal'].map((name, i) => ({ functionCall: { id: 'delegation-' + i, name: 'invoke_agent', args: { agent_name: name, prompt: 'fixture architecture context retained' } } }));
      else parts = [{ text: isPrincipal ? 'PRINCIPAL_SUCCESS' : 'SUBAGENT_SUCCESS' }];
      if (!isPrincipal) {
        activeSubagents++; maxActiveSubagents = Math.max(maxActiveSubagents, activeSubagents);
        await new Promise(resolve => setTimeout(resolve, 120)); activeSubagents--;
      }
    }
    if (scenario === 'T-local-tools') {
      const text = JSON.stringify(data.contents);
      if (!hasToolResult) parts = [{ functionCall: { id: 'grep-wide', name: 'grep_search', args: { pattern: 'NEEDLE' } } }, { functionCall: { id: 'glob-wide', name: 'glob', args: { pattern: '**/*' } } }];
      else if (!data.contents.some(content => content.parts?.some(part => part.functionResponse?.id === 'grep-scoped'))) parts = [{ functionCall: { id: 'grep-scoped', name: 'grep_search', args: { pattern: 'NEEDLE', dir_path: 'samples' } } }, { functionCall: { id: 'glob-scoped', name: 'glob', args: { pattern: '*.txt', dir_path: 'samples' } } }];
      else parts = [{ text: 'LOCAL_TOOLS_SUCCESS' }];
    }
    if (scenario === 'X-terminal' && !isPrincipal) parts = [{ functionCall: { name: 'nonexistent_tool', args: {} } }];
    if (scenario === 'O-oi') parts = [{ text: 'OI_CONTROLADO' }];
    const payload = { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } };
    if (req.url.includes('streamGenerateContent')) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: ' + JSON.stringify(payload) + '\n\n'); }
    else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  let nativeBridge;
  if (budgetScenario) {
    const ranked = Array.from({ length: 9 }, (_, i) => ({ keyId: 'K' + (i + 1), key: 'fixture-k' + (i + 1) }));
    const bridge = vm.createContext({ process, Buffer, http, crypto, classifyKeyResult: classifier.classifyKeyResult,
      getRankedKeys: () => ranked, getEligibleRankedKeys: () => ranked, getModelAvailability: () => ({ configured: 9, eligible: 9 }),
      loadConfiguredKeys: () => ({}), recordRuntimeExecutionResult: (model, keyId, result) => results.push({ model, keyId, ...result }),
    });
    const source = fs.readFileSync(path.join(process.env.CLI_RUNTIME_TEST_ROOT || root, 'server/runtime-bridge.ts'), 'utf8').replace(/^import[\s\S]*?;\s*/gm, '').replace(/\bexport\s+/g, '');
    vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }), bridge);
    nativeBridge = await bridge.createRuntimeBridge({ executionId: 'native-' + scenario, agents: [{ name: 'principal', model: 'gemini-3.1-flash-lite' }, { name: 'investigator', model: 'gemini-3.7-flash', fallbackModel: 'gemini-3.6-flash' }], agentId: 'principal', mode: 'api-key', onEvent() {} });
    t.after(() => nativeBridge.close());
  }
  fs.mkdirSync(path.join(dir, '.gemini', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.gemini', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } }, advanced: { autoConfigureMemory: false }, general: { enableAutoUpdate: false }, telemetry: { enabled: false }, mcpServers: exaScenario ? { exa: { httpUrl: endpoint + '/mcp', trust: true, headers: { 'x-api-key': '$EXA_API_KEY' }, env: { EXA_API_KEY: '$EXA_API_KEY' } } } : {} }));
  let effectiveSettings;
  if (exaScenario) {
    const service = fs.readFileSync(path.join(process.env.CLI_RUNTIME_TEST_ROOT || root, 'server/gemini-cli-service.ts'), 'utf8');
    const source = service.slice(service.indexOf('export async function resolveEffectiveCliConfig('), service.indexOf('export function executeGeminiCli(')).replace('export ', '');
    const config = vm.createContext({ fs, path, os, process: { env: { EXA_API_KEY: 'local-exa-fixture-key' } }, getGuiDataDir: () => dir, loadMcpSettings() {}, resolveCliAuthentication: () => ({ selectedType: 'gemini-api-key' }), getResolvedCliPath: () => '', loadAgents: () => [] });
    vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }), config);
    effectiveSettings = await config.resolveEffectiveCliConfig(dir, 'local-exa');
    assert.equal(fs.statSync(effectiveSettings).mode & 0o777, 0o600);
  }
  fs.writeFileSync(path.join(dir, '.gemini', 'agents', 'architect.md'), '---\nname: architect\ndescription: Fixture architect\nkind: local\nmodel: gemini-3.6-flash\ntools: []\nmax_turns: 3\n---\nPreserve fixture identity and context. Return the result.');
  if (budgetScenario) fs.writeFileSync(path.join(dir, '.gemini', 'agents', 'investigator.md'), '---\nname: investigator\ndescription: Fixture Investigator identity\nkind: local\nmodel: gemini-3.7-flash\ntools: []\nmax_turns: 3\n---\nPreserve fixture identity and context. Return the result.');
  if (investigatorTimeout) fs.writeFileSync(path.join(dir, '.gemini', 'agents', 'investigator.md'), '---\nname: investigator\ndescription: Fixture Investigator identity\nkind: local\nmodel: gemini-3.7-flash\ntools: [mcp_exa_web_search_exa]\nmax_turns: 3\n---\nPreserve fixture identity and context. Search using Exa then return the result.');
  if (scenario === 'S-all') {
    for (const [name, model] of Object.entries({ ...agentModels, principal: 'gemini-3.1-flash-lite', software_architect: 'gemini-3.6-flash' })) fs.writeFileSync(path.join(dir, '.gemini', 'agents', name + '.md'), `---\nname: ${name}\ndescription: Fixture\nkind: local\nmodel: ${model}\ntools: []\nmax_turns: 3\n---\nReturn the requested result.`);
  }
  if (scenario === 'T-local-tools') { fs.mkdirSync(path.join(dir, 'samples')); fs.writeFileSync(path.join(dir, 'samples', 'file.txt'), 'NEEDLE local fixture'); }
  const startedAt = performance.now();
  const child = spawn(process.execPath, [path.join(process.env.CLI_RUNTIME_TEST_ROOT || root, 'node_modules/@google/gemini-cli/bundle/gemini.js'), '-p', scenario === 'O-oi' ? 'oi' : 'Invoke architect.', '-m', 'gemini-3.1-flash-lite', '--output-format', 'stream-json', '--approval-mode', 'yolo', '--skip-trust'], { cwd: dir, detached: true, env: { PATH: process.env.PATH, HOME: dir, GEMINI_CLI_HOME: dir, GEMINI_API_KEY: 'fixture-k1', ...(effectiveSettings ? { GEMINI_CLI_SYSTEM_SETTINGS_PATH: effectiveSettings } : {}), GOOGLE_GEMINI_BASE_URL: endpoint, GEMINI_GUI_RUNTIME_URL: nativeBridge?.url || endpoint + '/bridge', GEMINI_GUI_RUNTIME_TOKEN: nativeBridge?.token || 'fixture', GEMINI_GUI_RUNTIME_MODULE: pathToFileURL(process.env.CLI_RUNTIME_TEST_ROOT ? path.join(process.env.CLI_RUNTIME_TEST_ROOT, 'dist/cli-runtime.mjs') : runtimeFile).href, GEMINI_GUI_AGENT_ID: 'principal', ...(scenario === 'S-all' ? { GEMINI_GUI_INVOKE_ALL: '1', GEMINI_GUI_ALLOWED_AGENTS: JSON.stringify(Object.keys(agentModels)), GEMINI_GUI_AGENT_ALIASES: JSON.stringify({ software_architect: 'architect' }) } : {}), GEMINI_CLI_NO_RELAUNCH: '1', NO_COLOR: '1' } });
  let stdout = '', stderr = ''; child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => { stderr += chunk; fs.appendFileSync('/tmp/cligovisual-test-stderr.log', chunk); });
  const timeout = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 45000); t.after(() => { clearTimeout(timeout); try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
  const code = await new Promise(resolve => child.once('close', resolve));
  fs.writeFileSync('/tmp/cligovisual-invoke-debug.json', JSON.stringify({ code, calls, results, stdout, stderr }, null, 2));
  if (scenario === 'U-unavailable') {
    assert.notEqual(code, 0);
    assert.equal(calls.length, 0, 'CLI não chama API quando nenhuma opção é elegível');
    assert.equal((stdout.match(/"event":"EXECUTION_BLOCKED"/g) || []).length, 1);
    assert.match(stdout, /2026-10-07T11:00:00Z/);
    assert(performance.now() - startedAt < 8000, 'encerra sem ciclos nativos de retry');
    return;
  }
  if (scenario === 'O-oi') {
    assert.equal(code, 0); assert.equal(calls.length, 1); assert.match(stdout, /OI_CONTROLADO/);
    assert(!stdout.includes('"tool_name":"invoke_agent"'));
    assert(performance.now() - startedAt < 8000);
    return;
  }
  assert.equal(code, 0, stderr.slice(-3000));
  if (budgetScenario) {
    const subcalls = calls.filter(call => call.model !== 'gemini-3.1-flash-lite');
    const events = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    assert.deepEqual(subcalls.map(call => call.model), [...Array(3).fill('gemini-3.7-flash'), ...Array(scenario.endsWith('-failed') ? 3 : 1).fill('gemini-3.6-flash')]);
    const transitions = events.filter(e => e.event === 'MODEL_FALLBACK');
    assert.equal(transitions.length, 1); assert.equal(transitions[0].fromModel, 'gemini-3.7-flash'); assert.equal(transitions[0].toModel, 'gemini-3.6-flash');
    assert.equal(transitions[0].reason, 'PRIMARY_RETRY_LIMIT'); assert(transitions[0].requestId); assert(transitions[0].previousRequestId); assert(transitions[0].invocationId);
    for (const call of subcalls) assert.deepEqual(call.data, subcalls[0].data, 'Identidade, contexto, ferramentas e parâmetros preservados no CLI real');
    const terminal = events.find(e => e.type === 'tool_result' && e.tool_name === 'invoke_agent');
    assert.equal(terminal.status, scenario.endsWith('-failed') ? 'failed' : 'success'); assert.equal(terminal.agentId, 'investigator'); assert.equal(terminal.model, 'gemini-3.6-flash');
    assert(calls.some(call => call.model === 'gemini-3.1-flash-lite' && JSON.stringify(call.data.contents).includes(scenario.endsWith('-failed') ? 'GUI_RETRY_BUDGET' : 'ARCHITECT_SUCCESS')));
    assert.equal(events.filter(e => ['ATTEMPT', 'KEY_FAILOVER'].includes(e.event) && e.agentId === 'investigator').length, subcalls.length);
    fs.writeFileSync('/tmp/fallback-native-' + scenario + '.json', JSON.stringify({ code, calls, results, events }, null, 2));
    return;
  }
  if (scenario === 'S-all') {
    const subcalls = calls.filter(call => call.model !== 'gemini-3.1-flash-lite');
    assert.equal(subcalls.length, 5, 'cinco execuções efetivas para seis agentes contando o Principal');
    assert.deepEqual(new Set(subcalls.map(call => call.model)), new Set(Object.values(agentModels)));
    assert(maxActiveSubagents > 1, 'modo simultâneo preservado');
    assert.match(stdout, /DELEGATION_REUSED/);
    return;
  }
  if (scenario === 'T-local-tools') {
    assert.match(stdout, /LOCAL_TOOLS_SUCCESS/);
    assert(calls.some(call => JSON.stringify(call.data.contents).includes('dir_path específico')));
    assert(calls.some(call => JSON.stringify(call.data.contents).includes('NEEDLE local fixture')));
    assert(!stderr.includes('Ripgrep is not available'));
    assert(!stderr.includes('Maximum call stack size'));
    assert(!stderr.includes('timed out'));
    return;
  }
  if (scenario.endsWith('-rate') || investigatorTimeout) {
    const events = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    assert.equal(exaCalls, 1);
    if (investigatorTimeout) {
      const terminal = events.find(event => event.type === 'tool_result' && event.tool_name === 'invoke_agent' && event.agentId === 'investigator');
      assert.equal(terminal.status, 'failed'); assert.equal(terminal.code, 'GUI_REQUEST_TIMEOUT');
      assert.equal(terminal.timeoutMs, 30000); assert.equal(terminal.requestPhase, 'awaiting_response'); assert.equal(terminal.responseChunks, 0);
      assert.equal(terminal.cause.requestPhase, 'awaiting_response'); assert.equal(terminal.affectsKey, false);
      assert(terminal.requestId); assert(terminal.invocationId);
      assert.equal(calls.filter(call => call.model === 'gemini-3.7-flash').length, 2, 'Uma geração para buscar; outra expira após a ferramenta, sem retry');
      assert(calls.some(call => call.model === 'gemini-3.1-flash-lite' && JSON.stringify(call.data.contents).includes('GUI_REQUEST_TIMEOUT')));
      assert(!events.some(event => event.event === 'KEY_FAILOVER' || event.event === 'MODEL_FALLBACK' || event.event === 'RUNTIME_BRIDGE_FAILURE'));
    } else {
      const failure = events.find(event => event.type === 'tool_result' && event.status !== 'success' && JSON.stringify(event).includes('EXA_MCP_RATE_LIMIT'));
      assert(failure, 'Limite gratuito é uma falha de ferramenta no stream nativo');
      assert(calls.some(call => JSON.stringify(call.data.contents).includes('EXA_MCP_RATE_LIMIT')), 'Causa real volta ao modelo');
      assert(!events.some(event => event.event === 'WEB_SUCCESS'));
      assert(results.filter(result => result.action === 'result').every(result => result.success), 'Falha da ferramenta não penaliza chamadas Gemini bem-sucedidas');
    }
    fs.writeFileSync('/tmp/cligovisual-exa-' + scenario + '.json', JSON.stringify({ code, calls, results, events }, null, 2));
    return;
  }
  if (scenario === 'I-web-exa') {
    assert.equal(exaCalls, 1, 'Exa deve ser chamado pelo executor, sem decisão adicional do LLM');
    assert.ok(calls.some(call => JSON.stringify(call.data.contents).includes('EXA_ACTUAL_RESULT')), 'resultado MCP volta ao contexto');
    assert.match(stdout, /WEB_SUCCESS/);
    const events = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    fs.writeFileSync('/tmp/cligovisual-exa-' + scenario + '.json', JSON.stringify({ code, calls, results, events }, null, 2));
    return;
  }
  if (['J-503-exhausted', 'N-network', 'X-terminal', 'A-timeout'].includes(scenario)) {
    const events = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const terminal = events.find(e => e.type === 'tool_result' && e.tool_name === 'invoke_agent' && e.status === 'failed');
    assert(terminal, 'Falha terminal emitida com o ID da delegação');
    assert(terminal.tool_id);
    assert(calls.some(call => call.model === 'gemini-3.1-flash-lite' && JSON.stringify(call.data.contents).includes(terminal.error)), 'Falha real retorna ao contexto do Principal');
    if (scenario === 'N-network') {
      const subcalls = calls.filter(call => call.model !== 'gemini-3.1-flash-lite');
      assert.equal(subcalls.length, 2, 'Uma repetição de rede no mesmo modelo/chave');
      assert(subcalls.every(call => call.key === 'fixture-k1'));
      assert(!stdout.includes('KEY_FAILOVER'));
      assert.match(stdout, /NETWORK_FAILURE/);
      const attemptIds = events.filter(e => e.event === 'ATTEMPT' && e.agentId === 'architect').map(e => e.requestId);
      assert.equal(new Set(attemptIds).size, 2, 'Cada chamada física possui ID próprio');
    }
    if (scenario === 'J-503-exhausted') assert.equal(calls.filter(call => call.model !== 'gemini-3.1-flash-lite').length, 2);
    if (scenario === 'X-terminal') assert.match(terminal.error, /MAX_TURNS|não concluiu/);
    if (scenario === 'A-timeout') {
      assert.equal(calls.filter(call => call.model === 'gemini-3.6-flash').length, 1);
      assert.equal(terminal.code, 'GUI_REQUEST_TIMEOUT'); assert.equal(terminal.abortedBy, 'request_timeout'); assert.equal(terminal.timeoutMs, 30000);
      assert(terminal.requestId); assert.equal(terminal.model, 'gemini-3.6-flash'); assert(!stdout.includes('KEY_FAILOVER'));
      assert(results.filter(result => result.action === 'result' && !result.success).every(result => classifier.classifyKeyResult(result.status, result.code, result.message).affectsKey === false));
    }
    return;
  }
  assert.match(stdout, /"tool_name":"invoke_agent"/);
  assert.ok(calls.some(call => JSON.stringify(call.data.contents).includes('ARCHITECT_SUCCESS')), 'Resultado Architect retorna ao contexto do Principal');
  const expected = scenario === 'R-503-recovered'
    ? [['gemini-3.6-flash', 'fixture-k1'], ['gemini-3.6-flash', 'fixture-k2']]
    : scenario === 'E-404-repair'
    ? [['gemini-3.6-flash', 'fixture-k1'], ['gemini-3.6-flash-001', 'fixture-k1']]
    : [['gemini-3.6-flash', 'fixture-k1'], ['gemini-3.6-flash', 'fixture-k2'], ['gemini-3.7-flash', 'fixture-k1']];
  const subcalls = calls.filter(call => call.model !== 'gemini-3.1-flash-lite');
  assert.deepEqual(subcalls.map(({ model, key }) => [model, key]), expected);
  assert.ok(subcalls.at(-1).data.contents.some(c => JSON.stringify(c).includes('fixture architecture context retained')));
  if (scenario === 'R-503-recovered') {
    const events = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const success = events.find(e => e.event === 'SUCCESS' && e.agentId === 'architect');
    const terminal = events.find(e => e.type === 'tool_result' && e.tool_name === 'invoke_agent' && e.status === 'success');
    assert.equal(terminal.requestId, success.requestId); assert.equal(terminal.model, 'gemini-3.6-flash');
  }
  if (scenario === 'V-503') { assert.match(stdout, /\"group\":\"G4\"/); assert(!stdout.includes('\"group\":\"G3\"')); }
  if (scenario.startsWith('E') || scenario.startsWith('F')) {
    assert.match(stdout, /"group":"G6"/);
    assert.equal(results.find(result => result.action === 'catalog').key, 'fixture-k1');
  }
});
