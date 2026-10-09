import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { buildSync } from 'esbuild';

const root = process.env.CLI_RUNTIME_TEST_ROOT || path.resolve(import.meta.dirname, '../..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition) { for (let i = 0; i < 200; i++) { if (condition()) return; await wait(10); } assert.fail('Condição local não foi atingida em 2 segundos'); }

test('TTS HTTP real: modelo exato, cancelamento no transporte, chunks, reinício e chat independente', { timeout: 20000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-http-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home'), dataDir = path.join(dir, 'data'), workspace = path.join(dir, 'workspace');
  for (const p of [home, dataDir, workspace, path.join(home, '.gemini')]) fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini/settings.json'), JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }));
  fs.writeFileSync(path.join(home, '.gemini/oauth_creds.json'), JSON.stringify({ refresh_token: 'local-only-fixture' }));
  const cli = path.join(dir, 'gemini');
  fs.writeFileSync(cli, `#!/usr/bin/python3
import sys,time,json
if '--version' in sys.argv:print('0.59.5');sys.exit()
if '--list-sessions' in sys.argv:print('No sessions');sys.exit()
time.sleep(.4)
print(json.dumps({'type':'message','role':'assistant','content':'CHAT_INDEPENDENT_LOCAL'}),flush=True)
print(json.dumps({'type':'result','status':'success'}),flush=True)
`); fs.chmodSync(cli, 0o700);
  const calls = [], closed = [];
  let active = 0;
  const provider = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const text = body.contents[0].parts.find(part => part.text)?.text || '';
    const isStt = body.contents[0].parts.some(part => part.inlineData);
    const model = decodeURIComponent(req.url.match(/models\/([^:]+):/)[1]);
    assert(['local-tts-key', 'local-pool-K1-fixture', 'local-pool-K2-fixture'].includes(req.headers['x-goog-api-key']));
    calls.push({ model, text, body }); active++;
    const call = calls.at(-1);
    res.once('close', () => { active--; closed.push({ call, interrupted: !res.writableEnded }); });
    if (text.includes('pool-key-rotation') && req.headers['x-goog-api-key'] === 'local-pool-K1-fixture') { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 503, message: 'Local pool overload fixture', status: 'UNAVAILABLE' } })); return; }
    if (['gemini-3.1-flash-tts', 'gemini-1.5-flash'].includes(model)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 404, message: 'models/' + model + ' is not found for API version v1beta, or is not supported for generateContent.', status: 'NOT_FOUND' } })); return; }
    if (text.includes('empty-payload')) { res.setHeader('Content-Type', 'application/json'); res.end('{"candidates":[]}'); return; }
    if (text.includes('transient-503') && calls.filter(call => call.text.includes('transient-503')).length < 3) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 503, message: 'Local service unavailable', status: 'UNAVAILABLE' } })); return; }
    if (text.includes('stt-quota') && model === 'gemini-3.1-flash-lite') { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 429, message: 'local quota', status: 'RESOURCE_EXHAUSTED' } })); return; }
    if (text.includes('cancel-chunks')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"candidates":[{"content":{"parts":['); return; }
    if (text.includes('cancel-generation')) return;
    if (text.includes('fallback') && model === 'gemini-3.1-flash-tts-preview') { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 429, message: 'local quota fixture', status: 'RESOURCE_EXHAUSTED' } })); return; }
    res.setHeader('Content-Type', 'application/json');
    if (isStt) { res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'LOCAL_STT_TRANSCRIPT' }] } }] })); return; }
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: 'AAABAA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => { provider.closeAllConnections(); provider.close(); });
  const providerUrl = 'http://127.0.0.1:' + provider.address().port;
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const processLog = path.join(dir, 'backend.log');
  const logFd = fs.openSync(processLog, 'w');
  let backendFile = path.join(root, 'dist/server.cjs');
  if (!process.env.CLI_RUNTIME_TEST_ROOT) { backendFile = path.join(dir, 'server.cjs'); buildSync({ entryPoints: [path.join(root, 'server.ts')], outfile: backendFile, bundle: true, platform: 'node', format: 'cjs', packages: 'external' }); }
  const backend = spawn(process.execPath, [backendFile], { cwd: workspace, detached: true, stdio: ['ignore', logFd, logFd],
    env: { PATH: dir + ':/usr/bin:/bin', HOME: home, USER: 'local-test', GEMINI_GUI_DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production', NODE_PATH: path.join(root, 'node_modules') } });
  fs.closeSync(logFd);
  t.after(async () => { try { process.kill(-backend.pid, 'SIGTERM'); await wait(30); process.kill(-backend.pid, 'SIGKILL'); } catch {} });
  const endpoint = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(endpoint + '/api/health')).ok) break; } catch {} await wait(25); }
  const post = (route, body, signal) => fetch(endpoint + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  assert((await post('/api/cli/config', { cliPath: cli })).ok);
  const synth = (text, signal, extra = {}) => post('/api/audio/tts', { text, model: 'gemini-3.1-flash-tts-preview', voice: 'Puck', apiKey: 'local-tts-key', apiUrl: providerUrl, ...extra }, signal);

  const success = await (await synth('selected model fixture', undefined, { requestId: 'exact-model' })).json();
  assert.equal(success.model, 'gemini-3.1-flash-tts-preview'); assert.equal(success.provider, 'gemini'); assert.equal(success.requestId, 'exact-model');
  assert.equal(calls[0].model, 'gemini-3.1-flash-tts-preview'); assert.equal(calls[0].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
  await until(() => active === 0);
  const noRequest = new AbortController(); noRequest.abort();
  const before = calls.length;
  await assert.rejects(synth('cancel-before', noRequest.signal), error => error.name === 'AbortError'); assert.equal(calls.length, before);

  const chat = post('/api/cli/execute', { prompt: 'local chat', executionId: 'tts-independent-chat', agentId: 'principal', workDir: workspace, resume: false }).then(response => response.text());
  for (const scenario of ['cancel-generation', 'cancel-chunks']) {
    const controller = new AbortController(), start = calls.length;
    const pending = synth(scenario, controller.signal, { requestId: scenario });
    const cancelled = assert.rejects(pending, error => error.name === 'AbortError');
    await until(() => calls.length > start); controller.abort(); await cancelled;
    await until(() => active === 0);
    assert(closed.some(item => item.call.text.includes(scenario) && item.interrupted));
    assert.equal(calls.length, start + 1, 'Cancelamento não inicia retry nem fallback');
  }
  assert.match(await chat, /CHAT_INDEPENDENT_LOCAL/, 'Cancelar TTS não cancela SSE/chat');
  // Actual App handlers, fetch, Express and SDK form one cancellation chain.
  const players = [], frontRequests = [];
  const utils = vm.createContext({ atob, btoa });
  vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/services/voice/ttsUtils.ts'), 'utf8').replace(/^import[\s\S]*?;\s*/gm, '').replace(/\bexport\s+/g, ''), { mode: 'transform' }), utils);
  const frontend = vm.createContext({ console: { info() {} }, crypto: globalThis.crypto, AbortController, DOMException,
    recordAudioResult() {}, audioSettings: { ttsModel: 'gemini-3.1-flash-tts-preview', ttsVoice: 'Puck', audioApiKey: 'local-tts-key', audioApiUrl: providerUrl },
    currentlyNarratingId: null, currentAudioRef: { current: null }, ttsControllerRef: { current: null }, getSavedVoiceAgents: () => [],
    resolveTtsSelection: utils.resolveTtsSelection, ttsAudioUrl: utils.ttsAudioUrl,
    fetch: (url, options) => { frontRequests.push(JSON.parse(options.body)); return fetch(endpoint + url, options); },
    window: { speechSynthesis: { cancel() {}, speak() { assert.fail('Não deve iniciar fallback local após cancelamento'); } } },
    Audio: class { constructor(src) { this.src = src; players.push(this); } play() { this.playing = true; return Promise.resolve(); } pause() { this.playing = false; } removeAttribute() { this.src = ''; } load() {} },
  });
  frontend.setCurrentlyNarratingId = value => frontend.currentlyNarratingId = value;
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const handlers = app.slice(app.indexOf('  const handlePlayTts ='), app.indexOf('  // Projects CRUD handlers'));
  vm.runInContext(stripTypeScriptTypes(handlers, { mode: 'transform' }) + '\nglobalThis.play=handlePlayTts;globalThis.stop=handleStopTts;', frontend);
  const beforeFront = calls.length;
  const frontPending = frontend.play('cancel-generation-frontend', 'frontend-cancel');
  await until(() => calls.length > beforeFront); frontend.stop(); await frontPending; await until(() => active === 0);
  assert.equal(frontend.currentAudioRef.current, null); assert.equal(frontend.ttsControllerRef.current, null); assert.equal(players.length, 0);
  await frontend.play('frontend restart', 'frontend-restart');
  assert.equal(frontRequests.at(-1).model, 'gemini-3.1-flash-tts-preview'); assert.equal(players.length, 1);
  assert(players[0].src.startsWith('data:audio/wav;base64,')); assert.equal(players[0].playing, true);
  frontend.stop(); assert.equal(players[0].playing, false); await until(() => active === 0);
  for (let i = 0; i < 3; i++) {
    const controller = new AbortController(), start = calls.length;
    const pending = synth('cancel-generation-' + i, controller.signal, { requestId: 'cycle-' + i });
    const cancelled = assert.rejects(pending, error => error.name === 'AbortError');
    await until(() => calls.length > start); controller.abort(); await cancelled; await until(() => active === 0);
    const next = await (await synth('restarted-' + i)).json(); assert.equal(next.audioBase64, 'AAABAA==');
    assert.equal(next.model, 'gemini-3.1-flash-tts-preview'); await until(() => active === 0);
  }
  const fallbackStart = calls.length;
  const fallback = await (await synth('fallback fixture', undefined, { requestId: 'explicit-fallback', fallback: { model: 'gemini-3.8-flash-tts', voice: 'Zephyr' } })).json();
  assert.deepEqual(calls.slice(fallbackStart).map(call => call.model), ['gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-tts']);
  assert.equal(fallback.model, 'gemini-3.8-flash-tts'); assert.equal(fallback.configuredModel, 'gemini-3.1-flash-tts-preview'); assert(fallback.fallbackReason);
  await until(() => active === 0);
  const missing = await synth('404 fixture', undefined, { model: 'gemini-3.1-flash-tts' });
  assert.equal(missing.status, 404); const failed404 = await missing.json();
  assert.equal(failed404.code, 'TTS_FAILED'); assert.equal(failed404.httpStatus, 404); assert.equal(failed404.status, 'failed');
  const repaired = await (await synth('404 recovery', undefined, { model: 'gemini-3.1-flash-tts', fallbackModels: ['gemini-3.1-flash-tts-preview'], requestId: 'tts-404-recovery' })).json();
  assert.equal(repaired.model, 'gemini-3.1-flash-tts-preview'); assert.equal(repaired.configuredModel, 'gemini-3.1-flash-tts'); assert.equal(repaired.fallbackUsed, true);
  const empty = await synth('empty-payload'); assert.equal(empty.status, 502); assert.equal((await empty.json()).httpStatus, 200);
  const transient = await (await synth('transient-503')).json(); assert.equal(transient.status, 'success'); assert.equal(transient.attempts.length, 3);
  assert.deepEqual(transient.attempts.map(attempt => attempt.httpStatus), [503, 503, 200]);
  const transcribe = (signal, extra = {}) => post('/api/audio/stt', { audioBase64: 'AAABAA==', mimeType: 'audio/wav', model: 'gemini-3.8-flash', apiKey: 'local-tts-key', apiUrl: providerUrl, requestId: 'stt-local-fixture', ...extra }, signal);
  const transcript = await (await transcribe(undefined, { language: 'en-US', generationConfig: { temperature: 0.2 } })).json();
  assert.equal(transcript.text, 'LOCAL_STT_TRANSCRIPT'); assert.equal(transcript.modality, 'stt'); assert.equal(transcript.model, 'gemini-3.8-flash');
  assert.equal(calls.at(-1).body.generationConfig.temperature, 0.2);
  const sttMissing = await transcribe(undefined, { model: 'gemini-1.5-flash' }); assert.equal(sttMissing.status, 404);
  const sttRecovered = await (await transcribe(undefined, { model: 'gemini-1.5-flash', fallbackModels: ['gemini-3.8-flash'] })).json();
  assert.equal(sttRecovered.status, 'success'); assert.equal(sttRecovered.fallbackUsed, true); assert.equal(sttRecovered.text, 'LOCAL_STT_TRANSCRIPT');
  const sttQuota = await (await transcribe(undefined, { model: 'gemini-3.1-flash-lite', instructions: 'stt-quota', fallbackModels: ['gemini-3.8-flash'] })).json();
  assert.deepEqual(sttQuota.attempts.map(attempt => attempt.httpStatus), [429, 200]);
  const sttAborter = new AbortController(), sttStart = calls.length;
  const sttPending = transcribe(sttAborter.signal, { instructions: 'cancel-generation STT', requestId: 'stt-transport-cancel' });
  const rejectedStt = assert.rejects(sttPending, error => error.name === 'AbortError');
  await until(() => calls.length > sttStart); sttAborter.abort(); await rejectedStt; await until(() => active === 0);
  assert.equal(calls.length, sttStart + 1);
  // Real Key Pool selection, ranking and persistence, isolated under the fixture HOME.
  assert((await post('/api/key-pool/keys', { keys: { K1: 'local-pool-K1-fixture', K2: 'local-pool-K2-fixture' } })).ok);
  const poolStart = calls.length;
  const poolResult = await (await synth('pool-key-rotation', undefined, { apiKey: undefined, requestId: 'pool-key-rotation' })).json();
  assert.equal(poolResult.status, 'success'); assert.deepEqual(poolResult.attempts.map(attempt => attempt.keyId), ['K1', 'K2']);
  assert.equal(calls.length, poolStart + 2);
  const poolState = JSON.parse(fs.readFileSync(path.join(home, '.config/gemini-gui/key-pool-state.json')));
  const unavailable = poolState.items['gemini-3.1-flash-tts-preview:K1'];
  assert.equal(unavailable.httpStatus, 503); assert.equal(unavailable.currentGroup, 'G4'); assert(Date.parse(unavailable.cooldownUntil) > Date.now());
  const reuse = await (await synth('pool-key-rotation-next', undefined, { apiKey: undefined })).json();
  assert.equal(reuse.attempts[0].keyId, 'K2'); assert.equal(reuse.attempts.length, 1, 'Não usa K1 em cooldown');
  const audioLogs = path.join(home, '.local/share/gemini-gui/logs/system-logs.log');
  await until(() => fs.existsSync(audioLogs) && fs.readFileSync(audioLogs, 'utf8').includes('TTS_MODEL_FALLBACK'));
  const logs = fs.readFileSync(audioLogs, 'utf8');
  assert(logs.includes('TTS_CANCELLED') && logs.includes('cancel-generation') && logs.includes('cancel-chunks'));
  assert(logs.includes('explicit-fallback') && logs.includes('gemini-3.8-flash-tts'));
  assert(!logs.includes('local-pool-K1-fixture') && !logs.includes('local-pool-K2-fixture'));
  assert(!logs.includes('local-tts-key'), 'Credencial de teste também não é registrada');
  assert((await fetch(endpoint + '/api/health')).ok); assert.equal(active, 0);
  fs.writeFileSync('/tmp/cligovisual-tts-http-' + (process.env.CLI_RUNTIME_TEST_ROOT ? 'installed' : 'source') + '.json', JSON.stringify({ sttVerified: true, keyPoolRotationAndCooldownVerified: true, failureHttpStatusVerified: true, models: calls.map(call => call.model), requestCount: calls.length, cancelledTransports: closed.filter(item => item.interrupted).length, activeRequests: active, chatIndependent: true, frontendToSdk: true, externalCalls: 0 }, null, 2));
});
