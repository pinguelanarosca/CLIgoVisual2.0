import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const root = path.resolve(import.meta.dirname, '../..');
const runtimeRoot = process.env.CLI_RUNTIME_TEST_ROOT || root;
const agents = { architect: 'gemini-3.6-flash', auditor: 'gemini-3.8-flash', investigator: 'gemini-3.7-flash', tester: 'gemini-3.5-flash', worker: 'gemini-3.5-flash-lite' };
const scenarios = process.env.DELEGATION_SCENARIOS?.split(',') || ['individual', 'parallel', 'collision', 'simultaneous', 'plan-isolation', 'partial', 'fallback-bridge', 'timeout'];

for (const scenario of scenarios) test(`Delegação nativa concorrente: ${scenario} (somente HTTP/MCP locais)`, { timeout: 60000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-concurrency-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runtime = path.join(dir, 'cli-runtime.mjs');
  buildSync({ entryPoints: [path.join(runtimeRoot, 'server/cli-runtime.ts')], outfile: runtime, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
  const names = scenario === 'individual' ? ['investigator'] : Object.keys(agents);
  const calls = [], bridgeCalls = [], toolCalls = [], completions = [], shellResponses = [], planDeniedResponses = [];
  const load = (file, globals) => {
    const context = vm.createContext({ process, Buffer, fs, os: { ...os, homedir: () => dir }, path, http, crypto, sysLog: new Proxy({}, { get: () => () => {} }), ...globals });
    const source = fs.readFileSync(path.join(runtimeRoot, file), 'utf8').replace(/^import[\s\S]*?;\s*/gm, '').replace(/\bexport\s+/g, '');
    vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }), context);
    return context;
  };
  const pool = load('server/key-pool-service.ts');
  pool.saveConfiguredKeys(Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['K' + (i + 1), 'local-only-key-' + (i + 1)])));
  const b = load('server/runtime-bridge.ts', Object.fromEntries(['classifyKeyResult', 'getRankedKeys', 'getEligibleRankedKeys', 'getModelAvailability', 'recordRuntimeExecutionResult', 'loadConfiguredKeys'].map(name => [name, pool[name]])));
  const nativeBridge = await b.createRuntimeBridge({ executionId: 'controlled-' + scenario, agents: [{ name: 'principal', model: 'gemini-3.1-flash-lite' }, ...Object.entries(agents).map(([name, model]) => ({ name, model, fallbackModel: name === 'architect' ? 'gemini-3.7-flash' : undefined }))], agentId: 'principal', mode: 'api-key', onEvent() {} });
  t.after(nativeBridge.close);
  let finishTogether;
  const allComplete = new Promise(resolve => { finishTogether = resolve; });
  let planEntered = false, bridgeFault = false, activeTools = 0, maxActiveTools = 0, activeProviders = 0, maxActiveProviders = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const data = raw ? JSON.parse(raw) : {};
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/bridge') {
      bridgeCalls.push(data);
      if (scenario === 'fallback-bridge' && data.action === 'plan' && data.agentId === 'architect' && !bridgeFault) { bridgeFault = true; res.writeHead(503); return res.end('{}'); }
      const forwarded = await fetch(nativeBridge.url, { method: 'POST', headers: { authorization: 'Bearer ' + nativeBridge.token, 'content-type': 'application/json' }, body: raw });
      res.writeHead(forwarded.status); return res.end(await forwarded.text());
    }
    if (req.url === '/mcp') {
      if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
      if (data.id === undefined) { res.writeHead(202); return res.end(); }
      let result;
      if (data.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
      else if (data.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Controlled parallel identity probe', inputSchema: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'] } }] };
      else if (data.method === 'tools/call') {
        const owner = data.params.arguments.owner; toolCalls.push(owner);
        activeTools++; maxActiveTools = Math.max(maxActiveTools, activeTools);
        await new Promise(resolve => setTimeout(resolve, 100)); activeTools--;
        result = { content: [{ type: 'text', text: 'TOOL_OWNER:' + owner }] };
      } else result = {};
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: data.id, result }));
    }
    if (req.url.includes('countTokens')) return res.end('{"totalTokens":50}');
    const model = req.url.match(/models\/([^:]+):/)?.[1];
    const owner = data.systemInstruction?.parts?.map(p => p.text || '').join('\n').match(/IDENTITY:(\w+)/)?.[1] || 'principal';
    const responses = (data.contents || []).flatMap(c => c.parts || []).filter(p => p.functionResponse).map(p => p.functionResponse);
    calls.push({ owner, model, data });
    let parts;
    if (owner === 'principal') {
      if (!responses.length) parts = names.map(name => ({ functionCall: { id: 'delegate-' + name, name: 'invoke_agent', args: { agent_name: name, prompt: 'CONTEXT:' + name + ' Return RESULT:' + name } } }));
      else {
        for (const name of names) {
          const response = responses.find(r => r.id === 'delegate-' + name);
          assert(response, 'Principal recebe resultado de ' + name);
          const output = JSON.stringify(response.response);
          if ((scenario === 'partial' || scenario === 'timeout') && name === 'auditor') assert.match(output, /failed|GUI_|error/i);
          else assert.match(output, new RegExp('RESULT:' + name));
        }
        parts = [{ text: 'PRINCIPAL_CONTROLLED_COMPLETE' }];
      }
    } else {
      assert(names.includes(owner), 'Identidade real preservada');
      assert.match(JSON.stringify(data.contents), new RegExp('CONTEXT:' + owner));
      for (const response of responses) {
        assert.match(response.id, scenario === 'collision' ? /shared-/ : new RegExp(owner));
        assert(!Object.keys(agents).some(other => other !== owner && JSON.stringify(response).includes('TOOL_OWNER:' + other)), 'Resposta não mistura ferramentas de outro agente');
      }
      if (scenario === 'fallback-bridge' && owner === 'architect' && model === agents.architect) { res.writeHead(503); return res.end('{"error":{"code":503,"status":"UNAVAILABLE","message":"high demand local fixture"}}'); }
      if (scenario === 'partial' && owner === 'auditor') { res.destroy(); return; }
      if (scenario === 'timeout' && owner === 'auditor') return;
      if (scenario === 'plan-isolation' && owner === 'tester' && !responses.length) parts = [{ functionCall: { id: owner + '-plan', name: 'enter_plan_mode', args: { reason: 'Isolated child plan' } } }];
      else if (scenario === 'plan-isolation' && owner === 'auditor' && !responses.length) {
        while (!planEntered) await new Promise(resolve => setTimeout(resolve, 10));
        parts = [{ functionCall: { id: owner + '-shell', name: 'run_shell_command', args: { command: 'printf AUDITOR_ONLY', description: 'Local isolation probe' } } }];
      } else if (!responses.length) parts = [{ functionCall: { id: (scenario === 'collision' ? 'shared' : owner) + '-read', name: 'read_file', args: { file_path: path.join(dir, owner + '.txt') } } }, { functionCall: { id: (scenario === 'collision' ? 'shared' : owner) + '-echo', name: 'mcp_fixture_echo', args: { owner } } }];
      else if (scenario === 'plan-isolation' && owner === 'tester' && !responses.some(r => r.name === 'run_shell_command')) {
        planEntered = true;
        parts = [{ functionCall: { id: owner + '-shell', name: 'run_shell_command', args: { command: 'printf TESTER_UNAUTHORIZED' } } }];
      }
      else {
        if (owner === 'tester' && scenario === 'plan-isolation') planDeniedResponses.push(JSON.stringify(responses));
        if (owner === 'auditor' && scenario === 'plan-isolation') shellResponses.push(JSON.stringify(responses));
        completions.push(owner);
        if (scenario === 'simultaneous') { if (completions.length === names.length) finishTogether(); await allComplete; }
        parts = [{ functionCall: { id: (scenario === 'collision' ? 'shared' : owner) + '-complete', name: 'complete_task', args: { result: 'RESULT:' + owner } } }];
      }
      activeProviders++; maxActiveProviders = Math.max(maxActiveProviders, activeProviders);
      const delays = scenario === 'parallel' ? { architect: 110, auditor: 90, investigator: 70, tester: 40, worker: 0 } : {};
      await new Promise(resolve => setTimeout(resolve, responses.length ? 0 : (delays[owner] || 0))); activeProviders--;
    }
    const payload = { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } };
    if (req.url.includes('streamGenerateContent')) { res.setHeader('Content-Type', 'text/event-stream'); return res.end('data: ' + JSON.stringify(payload) + '\n\n'); }
    res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  fs.mkdirSync(path.join(dir, '.gemini', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.gemini', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } }, advanced: { autoConfigureMemory: false }, general: { enableAutoUpdate: false }, telemetry: { enabled: false }, mcpServers: { fixture: { httpUrl: endpoint + '/mcp', trust: true } } }));
  for (const name of names) {
    fs.writeFileSync(path.join(dir, name + '.txt'), 'FILE_OWNER:' + name);
    fs.writeFileSync(path.join(dir, '.gemini', 'agents', name + '.md'), `---\nname: ${name}\ndescription: Local ${name}\nkind: local\nmodel: ${agents[name]}\ntools: [read_file, run_shell_command, enter_plan_mode, mcp_fixture_echo]\nmax_turns: 4\n---\nIDENTITY:${name}\nKeep your private context. Use complete_task to return your own result.`);
  }
  const child = spawn(process.execPath, [path.join(runtimeRoot, 'node_modules/@google/gemini-cli/bundle/gemini.js'), '-p', 'Invoke selected agents concurrently.', '-m', 'gemini-3.1-flash-lite', '--output-format', 'stream-json', '--approval-mode', 'yolo', '--skip-trust'], { cwd: dir, detached: true, env: { PATH: process.env.PATH, HOME: dir, GEMINI_CLI_HOME: dir, GEMINI_API_KEY: 'local-only-key', GOOGLE_GEMINI_BASE_URL: endpoint, GEMINI_GUI_RUNTIME_URL: endpoint + '/bridge', GEMINI_GUI_RUNTIME_TOKEN: 'fixture', GEMINI_GUI_RUNTIME_MODULE: pathToFileURL(runtime).href, GEMINI_GUI_AGENT_ID: 'principal', GEMINI_GUI_INVOKE_ALL: names.length === 5 ? '1' : '0', GEMINI_GUI_ALLOWED_AGENTS: JSON.stringify(names), GEMINI_CLI_NO_RELAUNCH: '1', NO_COLOR: '1' } });
  let stdout = '', stderr = ''; child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  const timeout = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 45000);
  t.after(() => { clearTimeout(timeout); try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
  const code = await new Promise(resolve => child.once('close', resolve));
  const events = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  fs.writeFileSync('/tmp/cligovisual-delegation-' + scenario + '.json', JSON.stringify({ code, calls, bridgeCalls, toolCalls, completions, events, stderr }, null, 2));
  assert.equal(code, 0, stderr.slice(-3000));
  assert.match(stdout, /PRINCIPAL_CONTROLLED_COMPLETE/);
  const terminals = events.filter(e => e.type === 'tool_result' && e.tool_name === 'invoke_agent' && e.invocationId);
  assert.equal(terminals.length, names.length);
  assert.equal(new Set(terminals.map(e => e.invocationId)).size, names.length);
  for (const name of names) {
    const terminal = terminals.find(e => e.agentId === name);
    assert.equal(terminal.tool_id, 'invoke_agent__delegate-' + name);
    assert(terminal.requestId);
    assert.equal(terminal.status, (scenario === 'partial' || scenario === 'timeout') && name === 'auditor' ? 'failed' : 'success');
    if (terminal.status === 'success') assert.equal(terminal.output, 'RESULT:' + name);
    for (const event of events.filter(e => e.agentId === name && e.tool_name !== 'invoke_agent' && ['tool_use', 'tool_result'].includes(e.type))) {
      assert.match(event.nativeToolCallId, scenario === 'collision' ? /shared-/ : new RegExp(name));
      assert.equal(event.tool_id, event.invocationId + ':' + event.nativeToolCallId);
      assert.equal(event.invocationId, terminal.invocationId);
      assert.equal(event.parentToolCallId, terminal.tool_id); assert(event.requestId); assert(event.model); assert.equal(event.executionId, 'controlled-' + scenario);
    }
    const ownerCalls = calls.filter(c => c.owner === name);
    assert(ownerCalls.every(c => c.model === agents[name] || (name === 'architect' && scenario === 'fallback-bridge' && c.model === agents.investigator)));
  }
  if (scenario === 'parallel') {
    assert(maxActiveProviders > 1); assert(maxActiveTools > 1);
    assert.notDeepEqual(completions, names, 'Conclusões fora da ordem de início');
    assert.equal(toolCalls.length, 5);
  }
  if (scenario === 'fallback-bridge') { assert(bridgeFault); assert(events.some(e => e.event === 'RUNTIME_BRIDGE_RETRY')); assert(events.some(e => e.event === 'MODEL_FALLBACK' && e.agentId === 'architect')); }
  if (scenario === 'plan-isolation') {
    assert.match(shellResponses.join('\n'), /AUDITOR_ONLY/, 'Planejamento do Tester não bloqueia shell do Auditor');
    assert.match(planDeniedResponses.join('\n'), /Unauthorized|confirmation/, 'O próprio Tester continua restrito em planejamento');
    assert(calls.filter(c => c.owner === 'principal').every(c => c.data.tools.some(tool => tool.functionDeclarations?.some(f => f.name === 'run_shell_command'))), 'Ferramentas do Principal preservadas');
  }
  if (scenario === 'timeout') assert(events.some(e => e.agentId === 'auditor' && e.code === 'GUI_REQUEST_TIMEOUT'));
  const toolStarts = events.filter(e => e.type === 'tool_use' && e.invocationId);
  assert.equal(new Set(toolStarts.map(e => e.tool_id)).size, toolStarts.length, 'IDs de atividades são únicos entre invocações');
  assert.equal(new Set(bridgeCalls.filter(c => c.action === 'attempt').map(c => c.requestId)).size, bridgeCalls.filter(c => c.action === 'attempt').length, 'Não repete tentativa física');
  if (['partial', 'timeout'].includes(scenario)) assert.equal(pool.getRankedKeys(agents.auditor).find(k => k.keyId === 'K1').status.consecutiveErrors, 0, 'Falhas locais não penalizam chaves');
  assert.equal(calls.filter(c => c.owner === 'principal').length, 2, 'Principal só retoma após todos os retornos');
});
