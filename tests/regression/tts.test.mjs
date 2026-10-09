import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const root = process.env.CLI_RUNTIME_TEST_ROOT || path.resolve(import.meta.dirname, '../..');
const classifier = vm.createContext({});
const poolSource = fs.readFileSync(path.join(root, 'server/key-pool-service.ts'), 'utf8');
vm.runInContext(stripTypeScriptTypes(poolSource.slice(poolSource.indexOf('export function classifyKeyResult('), poolSource.indexOf('let foregroundExecutions')).replace(/\bexport\s+/g, ''), { mode: 'transform' }), classifier);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function load(file, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/^import[\s\S]*?;\s*/gm, '').replace(/\bexport\s+/g, '');
  const context = vm.createContext({ classifyKeyResult: classifier.classifyKeyResult, getEligibleRankedKeys: () => [], getModelAvailability: () => ({ eligible: 0, configured: 0 }), recordRuntimeExecutionResult() {}, console, Buffer, AbortController, AbortSignal, DOMException, setTimeout, clearTimeout, crypto: globalThis.crypto, randomUUID: () => globalThis.crypto.randomUUID(), ...globals });
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }), context);
  return context;
}
function backend(execute) {
  const calls = [], constructors = [], logs = [];
  const c = load('server/audio-service.ts', {
    Modality: { AUDIO: 'AUDIO' }, getBestEligibleKey: () => ({ key: 'local-tts-fixture' }),
    sysLog: new Proxy({}, { get: (_, level) => (...args) => logs.push({ level, args }) }),
    GoogleGenAI: class { constructor(config) { constructors.push(config); this.models = { generateContent: async req => { calls.push(req); return execute(req, calls.length); } }; } },
  });
  return { c, calls, constructors, logs };
}
const audioResponse = { candidates: [{ content: { parts: [{ inlineData: { data: 'YXVkaW8=', mimeType: 'audio/mp3' } }] } }] };

test('TTS modelo: ID selecionado chega intacto ao SDK, com voz/instruções e metadados', async () => {
  const f = backend(async () => audioResponse);
  const result = await f.c.synthesizeSpeech('Texto local', 'Puck', 'gemini-3.1-flash-tts', 'local-key', 'http://127.0.0.1:9876', 'voz calma');
  assert.equal(f.calls[0].model, 'gemini-3.1-flash-tts');
  assert.equal(f.calls[0].config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
  assert.match(f.calls[0].contents[0].parts[0].text, /voz calma/);
  assert.equal(f.constructors[0].httpOptions.baseUrl, 'http://127.0.0.1:9876');
  assert.equal(result.model, 'gemini-3.1-flash-tts'); assert.equal(result.provider, 'gemini'); assert(result.requestId);
  assert(f.logs.some(entry => JSON.stringify(entry).includes('gemini-3.1-flash-tts')));
});

test('TTS cancelamento: sinal chega ao SDK, respostas tardias não são aceitas', async () => {
  const controller = new AbortController();
  const f = backend(async req => { await wait(40); return audioResponse; });
  const promise = f.c.synthesizeSpeech('Texto local', 'Kore', 'selected-tts', 'local-key', undefined, undefined, controller.signal);
  await wait(5); controller.abort();
  const result = await promise;
  assert.equal(result.audioBase64, ''); assert.equal(result.code, 'TTS_CANCELLED');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].config.abortSignal.aborted, true);
});

test('TTS fallback: somente o backup configurado, sem ciclos e com motivo registrado', async () => {
  const f = backend(async (req, count) => {
    if (count > 6) throw new Error('Operação de áudio cancelada pelo usuário.'); // Limita a reprodução do ciclo legado.
    throw Object.assign(new Error('HTTP 404 local fixture'), { status: 404 });
  });
  const result = await f.c.synthesizeSpeech('Texto', 'Kore', 'selected-tts', 'local-key', undefined, undefined, undefined,
    { requestId: 'fallback-fixture', fallback: { model: 'backup-tts', voice: 'Puck', instructions: 'backup instructions' } });
  assert.deepEqual(f.calls.map(req => req.model), ['selected-tts', 'backup-tts']);
  assert.equal(result.audioBase64, ''); assert.equal(result.model, 'backup-tts');
  assert(result.fallbackReason); assert(f.logs.some(entry => JSON.stringify(entry).includes('TTS_MODEL_FALLBACK')));
  assert.equal(f.calls[1].config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
});

test('TTS quota: 429 não repete o titular e recuperação usa backup explícito', async () => {
  const f = backend(async req => { if (req.model === 'selected-tts') throw Object.assign(new Error('quota local fixture'), { status: 429 }); return audioResponse; });
  const result = await f.c.synthesizeSpeech('Texto', 'Kore', 'selected-tts', 'local-key', undefined, undefined, undefined, { fallback: { model: 'backup-tts' } });
  assert.deepEqual(f.calls.map(req => req.model), ['selected-tts', 'backup-tts']);
  assert.equal(result.model, 'backup-tts'); assert.equal(result.configuredModel, 'selected-tts'); assert(result.fallbackReason);
});

function frontend(fetchImpl) {
  const calls = [], played = [], native = [];
  const speech = { cancelCount: 0, cancel() { this.cancelCount++; }, speak(utterance) { native.push(utterance); } };
  const settings = { ttsModel: 'selected-tts', ttsVoice: 'Puck', ttsSpeed: 1.2, ttsInstructions: 'selected instructions' };
  const context = vm.createContext({ console, AbortController, DOMException, crypto: globalThis.crypto,
    recordAudioResult() {}, audioSettings: settings, currentlyNarratingId: null, currentAudioRef: { current: null }, ttsControllerRef: { current: null },
    window: { speechSynthesis: speech }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    Audio: class { constructor(src) { this.src = src; played.push(this); } play() { this.playing = true; return Promise.resolve(); } pause() { this.playing = false; } removeAttribute() { this.src = ''; } load() {} },
    fetch: (url, options) => { calls.push(options); return fetchImpl(options, calls.length); },
    getSavedVoiceAgents: () => [], resolveTtsSelection: s => ({ model: s.ttsModel, voice: s.ttsVoice, speed: s.ttsSpeed, instructions: s.ttsInstructions }),
    ttsAudioUrl: (data, mime = 'audio/mp3') => 'data:' + mime + ';base64,' + data,
  });
  context.setCurrentlyNarratingId = value => context.currentlyNarratingId = value;
  const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const handlers = source.slice(source.indexOf('  const handlePlayTts ='), source.indexOf('  // Projects CRUD handlers'));
  vm.runInContext(stripTypeScriptTypes(handlers, { mode: 'transform' }) + '\nglobalThis.play=handlePlayTts;globalThis.stop=handleStopTts;', context);
  return { context, calls, played, native, settings, speech };
}
const response = data => ({ ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), json: async () => data });

test('TTS frontend: parar antes da resposta aborta fetch e ignora resposta tardia', async () => {
  let deliver;
  const f = frontend(() => new Promise(resolve => { deliver = resolve; }));
  const pending = f.context.play('Texto', 'first');
  f.context.stop();
  assert.equal(f.calls[0].signal?.aborted, true);
  deliver(response({ audioBase64: 'late-audio' })); await pending;
  assert.equal(f.played.length, 0); assert.equal(f.native.length, 0); assert.equal(f.context.currentlyNarratingId, null);
});

test('TTS frontend: cancelar enquanto JSON/chunk é recebido não reproduz nem faz fallback', async () => {
  let jsonReady;
  const f = frontend(async () => ({ ...response({}), json: () => new Promise(resolve => { jsonReady = resolve; }) }));
  const pending = f.context.play('Texto', 'first'); await wait(0);
  f.context.stop(); jsonReady({ audioBase64: 'late-chunk' }); await pending;
  assert.equal(f.played.length, 0); assert.equal(f.native.length, 0);
});

test('TTS frontend: parar durante reprodução e iniciar novamente isola callbacks antigos', async () => {
  const f = frontend(async () => response({ audioBase64: 'audio' }));
  await f.context.play('First', 'one'); const first = f.played[0], oldEnd = first.onended;
  f.context.stop(); assert.equal(first.playing, false); assert.equal(f.context.currentAudioRef.current, null);
  await f.context.play('Second', 'two'); oldEnd?.();
  assert.equal(f.context.currentlyNarratingId, 'two'); assert.equal(f.played[1].playing, true);
  f.context.stop(); assert(f.calls.every(call => call.signal.aborted));
});

test('TTS frontend: ciclos iniciar/parar/iniciar não deixam gerações antigas nem novas chamadas', async () => {
  const pending = [];
  const f = frontend(() => new Promise(resolve => pending.push(resolve)));
  for (let i = 0; i < 5; i++) {
    const request = f.context.play('Cycle ' + i, 'id-' + i); f.context.stop();
    pending[i](response({ audioBase64: 'old-' + i })); await request;
  }
  assert.equal(f.calls.length, 5); assert(f.calls.every(call => call.signal.aborted));
  assert.equal(f.played.length, 0); assert.equal(f.native.length, 0); assert.equal(f.context.ttsControllerRef.current, null);
  assert.equal(f.context.currentAudioRef.current, null);
});

test('TTS frontend: modelo browser-native não faz fetch e cancelar limpa SpeechSynthesis', async () => {
  const f = frontend(() => { throw new Error('Não deve chamar API'); }); f.settings.ttsModel = 'browser-native';
  await f.context.play('Texto local', 'native'); assert.equal(f.calls.length, 0); assert.equal(f.native.length, 1);
  f.context.stop(); assert.equal(f.context.currentlyNarratingId, null); assert(f.speech.cancelCount > 0);
});

test('TTS seleção: perfil ativo e backup determinam payload sem alterar agentes salvos', async () => {
  const utils = load('src/services/voice/ttsUtils.ts');
  const agents = [{ id: 'selected', config: { model: 'exact-tts-id', baseGeminiVoice: 'Zephyr', speed: 1.4 }, directorPrompt: 'primary prompt' },
    { id: 'backup', config: { model: 'backup-tts-id', baseGeminiVoice: 'Puck' }, directorPrompt: 'backup prompt' }];
  const before = JSON.stringify(agents);
  const f = frontend(async () => response({ audioBase64: 'audio' }));
  Object.assign(f.settings, utils.updateTtsSettings(f.settings, { activeTtsAgentId: 'selected', backupTtsAgentId: 'backup' }, agents));
  f.context.resolveTtsSelection = utils.resolveTtsSelection; f.context.getSavedVoiceAgents = () => agents;
  await f.context.play('Texto', 'selected');
  const payload = JSON.parse(f.calls[0].body);
  assert.equal(payload.model, 'exact-tts-id'); assert.equal(payload.voice, 'Zephyr'); assert.equal(payload.instructions, 'primary prompt');
  assert.deepEqual(payload.fallback, { model: 'backup-tts-id', voice: 'Puck', instructions: 'backup prompt' });
  assert.equal(JSON.stringify(agents), before); f.context.stop();
});

test('TTS mídia: MIME preservado; PCM tem WAV válido, sem rotular tudo como MP3', () => {
  const utils = load('src/services/voice/ttsUtils.ts', { atob, btoa });
  assert.equal(utils.ttsAudioUrl('YXVkaW8=', 'audio/wav'), 'data:audio/wav;base64,YXVkaW8=');
  const bytes = Buffer.from(utils.ttsAudioUrl('AAABAA==', 'audio/L16;codec=pcm;rate=24000').split(',')[1], 'base64');
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF'); assert.equal(bytes.readUInt32LE(24), 24000);
  assert.equal(bytes.readUInt32LE(40), 4); assert.deepEqual(bytes.subarray(44), Buffer.from('AAABAA==', 'base64'));
});

test('TTS seleção manual: mudar modelo/voz após selecionar perfil respeita a interface', async () => {
  const utils = load('src/services/voice/ttsUtils.ts');
  const f = frontend(async () => response({ audioBase64: 'audio' }));
  f.settings.activeTtsAgentId = 'selected'; f.settings.ttsModel = 'manual-tts'; f.settings.ttsVoice = 'Charon';
  f.context.resolveTtsSelection = utils.resolveTtsSelection;
  f.context.getSavedVoiceAgents = () => [{ id: 'selected', config: { model: 'profile-tts', baseGeminiVoice: 'Puck' } }];
  await f.context.play('Texto', 'selected');
  assert.equal(JSON.parse(f.calls[0].body).model, 'manual-tts'); assert.equal(JSON.parse(f.calls[0].body).voice, 'Charon');
  f.context.stop();
});

test('TTS cancelamento: antes da chamada e durante espera de retry não inicia nova geração', async () => {
  const already = new AbortController(); already.abort();
  const f = backend(async () => audioResponse);
  assert.equal((await f.c.synthesizeSpeech('Texto', 'Kore', 'selected', 'local-key', undefined, undefined, already.signal)).code, 'TTS_CANCELLED');
  assert.equal(f.calls.length, 0);
  const retry = backend(async () => { throw Object.assign(new Error('local 503'), { status: 503 }); });
  const controller = new AbortController();
  const pending = retry.c.synthesizeSpeech('Texto', 'Kore', 'selected', 'local-key', undefined, undefined, controller.signal);
  await wait(15); controller.abort();
  assert.equal((await pending).code, 'TTS_CANCELLED'); assert.equal(retry.calls.length, 1);
});

test('TTS geração: deadline aborta o transporte; erro não inicia fallback implícito', async () => {
  const timers = new Set(), signals = [];
  const c = load('server/audio-service.ts', { Modality: { AUDIO: 'AUDIO' }, getBestEligibleKey: () => null,
    sysLog: new Proxy({}, { get: () => () => {} }),
    setTimeout(fn, ms) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms === 45000 ? 25 : ms); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    GoogleGenAI: class { constructor() { this.models = { generateContent: req => { signals.push(req.config.abortSignal); return new Promise(() => {}); } }; } },
  });
  const result = await c.synthesizeSpeech('Texto', 'Kore', 'selected', 'local-key');
  assert.equal(result.code, 'TTS_REQUEST_TIMEOUT'); assert.equal(result.audioBase64, '');
  assert.equal(signals.length, 1); assert.equal(signals[0].aborted, true); assert.equal(timers.size, 0);
});

test('TTS preview: parar aborta fetch e não aceita áudio/retorno local tardio', async () => {
  let deliver, request;
  const spoken = [];
  const c = load('src/services/voice/voiceEngine.ts', { compileDirectorPrompt: () => 'prompt', ttsAudioUrl: data => 'data:' + data,
    window: { speechSynthesis: { cancel() {}, speak: utterance => spoken.push(utterance) } }, SpeechSynthesisUtterance: class {},
    fetch: (url, options) => { request = options; return new Promise(resolve => { deliver = resolve; }); },
  });
  const pending = c.generateTtsPreviewAudio('Texto', { model: 'preview-selected', baseGeminiVoice: 'Puck' });
  c.stopCurrentAudio(); assert.equal(request.signal.aborted, true);
  deliver(response({ audioBase64: 'late' })); const result = await pending;
  assert.equal(result.cancelled, true); assert.equal(result.audioBase64, undefined); assert.equal(spoken.length, 0);
});

test('TTS preview: sessões repetidas isoladas e preview local cancelado resolve sem fila pendente', async () => {
  const spoken = [];
  const c = load('src/services/voice/voiceEngine.ts', { compileDirectorPrompt: () => 'prompt', ttsAudioUrl: data => 'data:' + data,
    window: { speechSynthesis: { cancel() {}, speak: utterance => spoken.push(utterance) } }, SpeechSynthesisUtterance: class {},
    fetch: async () => response({ audioBase64: 'local', model: 'preview-selected', provider: 'gemini' }),
  });
  for (let i = 0; i < 3; i++) { const result = await c.generateTtsPreviewAudio('Texto', { model: 'preview-selected' }); assert.equal(result.audioBase64, 'local'); c.stopCurrentAudio(); }
  const local = c.generateTtsPreviewAudio('Texto', { model: 'browser-native' }); assert.equal(spoken.length, 1);
  c.stopCurrentAudio(); assert.equal((await local).cancelled, true);
});
