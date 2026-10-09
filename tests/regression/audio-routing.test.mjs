import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
const root = process.env.CLI_RUNTIME_TEST_ROOT || path.resolve(import.meta.dirname, '../..');
const wait = ms => new Promise(r => setTimeout(r, ms));
const poolSource = fs.readFileSync(path.join(root, 'server/key-pool-service.ts'), 'utf8');
const classifier = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(poolSource.slice(poolSource.indexOf('export function classifyKeyResult('), poolSource.indexOf('let foregroundExecutions')).replace(/\bexport\s+/g, ''), { mode: 'transform' }), classifier);
const classifyKeyResult = classifier.classifyKeyResult;
function fixture(execute, keys = ['K1'], fastDeadline = false) {
  const calls = [], writes = [], logs = [], blocked = new Set();
  const keyFor = id => 'local-secret-' + id;
  const eligible = model => keys.filter(id => !blocked.has(model + ':' + id)).map(keyId => ({ keyId, key: keyFor(keyId) }));
  const c = vm.createContext({ console, Buffer, AbortController, AbortSignal, DOMException, randomUUID: () => crypto.randomUUID(), Modality: { AUDIO: 'AUDIO' },
    setTimeout: (fn, ms) => setTimeout(fn, fastDeadline && ms === 45000 ? 10 : ms), clearTimeout,
    classifyKeyResult, isModelCompatibilityError: classifier.isModelCompatibilityError,
    getBestEligibleKey: model => eligible(model)[0] || null, getEligibleRankedKeys: eligible,
    getModelAvailability: model => ({ eligible: eligible(model).length, configured: keys.length, nextRetryAt: eligible(model).length ? undefined : '2099-01-01T00:00:00.000Z' }),
    recordRuntimeExecutionResult: (model, keyId, result) => { writes.push({ model, keyId, ...result }); if (!result.success) blocked.add(model + ':' + keyId); },
    sysLog: new Proxy({}, { get: (_, level) => (category, event, details) => logs.push({ level, category, event, details }) }),
    GoogleGenAI: class { constructor(config) { this.models = { generateContent: async req => { calls.push({ ...req, key: config.apiKey }); return execute(req, calls.length); } }; } },
  });
  const source = fs.readFileSync(path.join(root, 'server/audio-service.ts'), 'utf8').replace(/^import[\s\S]*?;\s*/gm, '').replace(/\bexport\s+/g, '');
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }), c);
  return { c, calls, writes, logs };
}
const audio = { candidates: [{ content: { parts: [{ inlineData: { data: 'AAABAA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] };
const speech = (f, model = 'gemini-3.1-flash-tts-preview', options = {}, signal, key) => f.c.synthesizeSpeech('texto', 'Puck', model, key, undefined, 'voz calma', signal, options);
const stt = (f, model = 'gemini-3.8-flash', options = {}, signal, key) => f.c.transcribeAudio('AAABAA==', 'audio/wav', model, key, undefined, 'não resumir', signal, options);

test('Áudio: STT preserva ID exato e transmite AbortSignal ao SDK', async () => {
 const f=fixture(async()=>({text:'transcrição'})); const controller=new AbortController();
 const r=await stt(f,'gemini-3.8-flash',{},controller.signal,'local-key');
 assert.equal(f.calls[0].model,'gemini-3.8-flash');assert(f.calls[0].config.abortSignal);assert.equal(r.modality,'stt');assert.equal(r.status,'success');
});
test('Áudio: 404 não troca chave do mesmo modelo; fallback explícito recupera e preserva parâmetros', async () => {
 const f=fixture(async req=>{if(req.model==='gemini-3.1-flash-tts')throw Object.assign(new Error('model not found'),{status:404});return audio;},['K1','K2']);
 const r=await speech(f,'gemini-3.1-flash-tts',{fallbackModels:['gemini-3.1-flash-tts-preview']});
 assert.deepEqual(f.calls.map(c=>c.model),['gemini-3.1-flash-tts','gemini-3.1-flash-tts-preview']);assert.equal(r.configuredModel,'gemini-3.1-flash-tts');assert.equal(r.model,'gemini-3.1-flash-tts-preview');assert.equal(r.fallbackUsed,true);assert.equal(r.status,'success');
 assert.equal(f.calls[1].config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Puck');assert.match(f.calls[1].contents[0].parts[0].text,/voz calma/);assert.equal(r.attempts[0].httpStatus,404);
});
for (const httpStatus of [429,503]) test('Áudio: HTTP '+httpStatus+' troca chave elegível e registra classificação/cooldown', async()=>{
 const f=fixture(async(req,n)=>{if(n===1)throw Object.assign(new Error('HTTP '+httpStatus),{status:httpStatus});return audio;},['K1','K2']);
 const r=await speech(f);assert.equal(r.status,'success');assert.deepEqual(f.calls.map(c=>c.key),['local-secret-K1','local-secret-K2']);assert.equal(f.writes[0].httpStatus,httpStatus);assert.equal(r.attempts[0].errorCode,httpStatus===429?'429_QUOTA':'503_SERVER_ERROR');assert(!JSON.stringify(f.logs).includes('local-secret-'));
});
test('Áudio: orçamento reserva fallback e não repete modelos configurados', async()=>{
 const f=fixture(async req=>{if(req.model==='gemini-2.5-pro-preview-tts')return audio;throw Object.assign(new Error('HTTP 503'),{status:503});},Array.from({length:10},(_,i)=>'K'+i));
 const r=await speech(f,'gemini-3.1-flash-tts-preview',{fallbackModels:['gemini-3.1-flash-tts-preview','gemini-3.8-flash-tts','gemini-3.8-flash-tts','gemini-2.5-pro-preview-tts']});
 assert.equal(r.model,'gemini-2.5-pro-preview-tts');assert(f.calls.length<=6);assert.equal(f.calls.filter(c=>c.model==='gemini-3.1-flash-tts-preview').length,3);assert(f.calls.some(c=>c.model==='gemini-3.8-flash-tts'));
});
test('Áudio: sem chaves elegíveis não chama API; informa próxima tentativa',async()=>{
 const f=fixture(async()=>assert.fail('Sem chave'),[]);const r=await speech(f);assert.equal(f.calls.length,0);assert.equal(r.status,'failed');assert.equal(r.audioBase64,'');assert.equal(r.code,'TTS_OPTIONS_EXHAUSTED');assert.equal(r.effectiveModel,null);assert.equal(r.fallbackUsed,false);
});
test('Áudio: timeout aborta transporte e recupera com fallback sem penalizar chave',async()=>{
 const f=fixture(req=>req.model==='gemini-3.1-flash-tts-preview'?new Promise(()=>{}):Promise.resolve(audio),['K1'],true);
 const r=await speech(f,undefined,{fallbackModels:['gemini-2.5-pro-preview-tts']});assert.equal(r.model,'gemini-2.5-pro-preview-tts');assert(f.calls[0].config.abortSignal.aborted);assert(!f.writes.some(w=>!w.success));assert.equal(r.attempts[0].errorCode,'GUI_REQUEST_TIMEOUT');
});
test('Áudio: fetch failed e OOM não penalizam nem iniciam cascata de modelos/chaves',async()=>{
 for(const message of ['fetch failed','heap out of memory']){const f=fixture(async()=>{throw new Error(message);},['K1','K2']);const r=await speech(f,undefined,{fallbackModels:['gemini-2.5-pro-preview-tts']});assert.equal(r.status,'failed');assert.equal(f.writes.length,0);assert(f.calls.length<=2);assert(f.calls.every(c=>c.model==='gemini-3.1-flash-tts-preview'));}
});
test('Áudio: cancelamento STT/TTS impede retry/fallback e rejeita resposta tardia',async()=>{
 for(const modality of ['tts','stt']){const f=fixture(async()=>{await wait(20);return modality==='tts'?audio:{text:'tardia'};});const controller=new AbortController();const run=modality==='tts'?speech:stt;const p=run(f,undefined,{fallbackModels:['gemini-2.5-pro-preview-tts']},controller.signal,'local-key');await wait(2);controller.abort();const r=await p;assert.equal(r.status,'cancelled');assert.equal(r[modality==='tts'?'audioBase64':'text'],'');assert.equal(f.calls.length,1);assert(f.calls[0].config.abortSignal.aborted);assert.equal(f.writes.length,0);}
});
test('Áudio: 404 e esgotamento são falha terminal com status HTTP não 200',async()=>{
 const f=fixture(async()=>{throw Object.assign(new Error('404 model not found'),{status:404});});const r=await speech(f,undefined,{},undefined,'local-key');assert.equal(r.code,'TTS_FAILED');assert.equal(r.status,'failed');assert.equal(r.httpStatus,404);assert.equal(f.c.audioHttpStatus(r),404);
});
test('Áudio: TTS 3.8 usa schema documentado, STT retorna texto e preserva idioma/parâmetros',async()=>{
 const f=fixture(async req=>req.model.includes('tts')?audio:{text:'dictation'});
 await speech(f,'gemini-3.8-flash-tts',{language:'pt-BR',generationConfig:{temperature:.4}},undefined,'local-key');
 assert.equal(f.calls[0].config.speechConfig.voiceConfig.voice,'Puck');assert.equal(f.calls[0].contents[0].parts[0].text,'texto');assert.match(f.calls[0].contents[0].parts[0].speechMetadata.style,/voz calma/);assert.equal(f.calls[0].config.temperature,.4);
 const r=await stt(f,'gemini-3.8-flash',{language:'en-US',generationConfig:{temperature:.2}},undefined,'local-key');assert.equal(r.text,'dictation');assert.equal(r.modality,'stt');assert.equal(f.calls[1].config.temperature,.2);assert.match(f.calls[1].contents.parts[1].text,/en-US/);
});
test('Áudio: 200 sem conteúdo não é sucesso nem penaliza chave',async()=>{
 for(const run of [speech,stt]){const f=fixture(async()=>({candidates:[]}));const r=await run(f,undefined,{},undefined,'local-key');assert.equal(r.status,'failed');assert.equal(r.httpStatus,200);assert.equal(f.c.audioHttpStatus(r),502);assert.equal(f.writes.length,0);}
});

test('Áudio: esgotamento 503 permanece limitado com várias opções; 401 não repete credencial customizada',async()=>{
 const all=fixture(async()=>{throw Object.assign(new Error('HTTP 503'),{status:503});},['K1','K2','K3','K4']);
 const r=await speech(all,undefined,{fallbackModels:['gemini-3.8-flash-tts','gemini-2.5-pro-preview-tts']});assert.equal(r.status,'failed');assert.equal(all.calls.length,6);assert(all.calls.some(c=>c.model==='gemini-2.5-pro-preview-tts'));assert.equal(r.httpStatus,503);
 const auth=fixture(async()=>{throw Object.assign(new Error('HTTP 401'),{status:401});});await speech(auth,undefined,{fallbackModels:['gemini-2.5-pro-preview-tts']},undefined,'local-key');assert.equal(auth.calls.length,1);assert.equal(auth.writes.length,0);
});
test('Áudio: cancelar STT na espera de retry impede fallback pendente',async()=>{
 const f=fixture(async()=>{throw Object.assign(new Error('HTTP 503'),{status:503});});const controller=new AbortController();
 const pending=stt(f,undefined,{fallbackModels:['gemini-3.1-flash-lite']},controller.signal,'local-key');await wait(10);controller.abort();const r=await pending;assert.equal(r.code,'STT_CANCELLED');assert.equal(f.calls.length,1);assert.equal(f.writes.length,0);
});
function frontend(fetchImpl) {
 const calls=[],readers=[],diagnostics=[],spoken=[];
 const utils=vm.createContext({atob,btoa});vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root,'src/services/voice/ttsUtils.ts'),'utf8').replace(/^import[\s\S]*?;\s*/gm,'').replace(/\bexport\s+/g,''),{mode:'transform'}),utils);
 const c=vm.createContext({console:{info(){}},AbortController,AbortSignal,DOMException,crypto:globalThis.crypto,
  audioSettings:{sttModel:'gemini-3.8-flash',ttsModel:'gemini-3.1-flash-tts-preview',ttsVoice:'Puck'},
  sttControllerRef:{current:null},ttsControllerRef:{current:null},currentAudioRef:{current:null},currentlyNarratingId:null,
  recordAudioResult:(modality,data)=>diagnostics.push(utils.getAudioDiagnostics({...data,modality})),
  getSavedVoiceAgents:()=>[],resolveTtsSelection:utils.resolveTtsSelection,resolveSttSelection:utils.resolveSttSelection,ttsAudioUrl:utils.ttsAudioUrl,
  fetch:(url,options)=>{calls.push({url,...options});return fetchImpl(url,options);},
  FileReader:class{constructor(){readers.push(this);}readAsDataURL(){this.result='data:audio/wav;base64,AAABAA==';queueMicrotask(()=>this.onload?.());}abort(){this.aborted=true;}},
  Audio:class{play(){return Promise.resolve();}pause(){}removeAttribute(){}load(){}},
  window:{speechSynthesis:{cancel(){},speak:utterance=>spoken.push(utterance)}},SpeechSynthesisUtterance:class{},queueMicrotask,
 });c.setCurrentlyNarratingId=id=>c.currentlyNarratingId=id;
 const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8');const source=app.slice(app.indexOf('  const handleTranscribeAudio ='),app.indexOf('  // Projects CRUD handlers'));
 vm.runInContext(stripTypeScriptTypes(source,{mode:'transform'})+'\nglobalThis.stt=handleTranscribeAudio;globalThis.tts=handlePlayTts;globalThis.stop=handleStopTts;',c);
 return {c,calls,diagnostics,readers,spoken,utils};
}
const response=(status,data)=>({ok:status<400,status,headers:new Headers({'Content-Type':'application/json'}),json:async()=>data});
test('Áudio frontend: falha HTTP preserva causa e Payload sem fallback nativo silencioso',async()=>{
 const f=frontend(async()=>response(404,{modality:'tts',status:'failed',code:'TTS_FAILED',httpStatus:404,model:'configured',configuredModel:'configured',provider:'gemini',requestId:'404-fixture',attempts:[{attempt:1,httpStatus:404}]}));
 await f.c.tts('Texto','message');assert.equal(f.spoken.length,0);const last=f.diagnostics.at(-1);assert.equal(last.httpStatus,404);assert.equal(last.attempts.length,1);assert.equal(last.code,'TTS_FAILED');assert.equal(f.c.ttsControllerRef.current,null);
});
test('Áudio frontend: STT abortado antes do envio e respostas tardias não entram no chat',async()=>{
 let deliver;const f=frontend(async()=>({ok:true,json:()=>new Promise(r=>deliver=r)}));
 const before=new AbortController();before.abort();assert.equal(await f.c.stt({type:'audio/wav'},before.signal),'');assert.equal(f.calls.length,0);
 const controller=new AbortController();const pending=f.c.stt({type:'audio/wav'},controller.signal);await wait(1);controller.abort();deliver({text:'tardia',status:'success'});assert.equal(await pending,'');assert(f.calls[0].signal.aborted);assert.equal(f.c.sttControllerRef.current,null);
});
test('Áudio frontend: cancelar TTS não aborta STT paralelo; parâmetros e diagnósticos são independentes',async()=>{
 let resolveStt;const f=frontend(async url=>url.endsWith('/stt')?new Promise(r=>resolveStt=r):response(200,{audioBase64:'AAABAA==',mimeType:'audio/L16;rate=24000',status:'success',model:'gemini-3.1-flash-tts-preview',modality:'tts'}));
 const pending=f.c.stt({type:'audio/wav'});await wait(1);await f.c.tts('Texto','message');f.c.stop();assert(!f.calls.find(call=>call.url.endsWith('/stt')).signal.aborted);
 resolveStt(response(200,{text:'correta',status:'success',modality:'stt',model:'gemini-3.8-flash'}));assert.equal(await pending,'correta');
 assert.equal(JSON.parse(f.calls[0].body).model,'gemini-3.8-flash');assert.equal(f.diagnostics.at(-1).modality,'stt');
 const privateData=f.utils.getAudioDiagnostics({status:'success',modality:'stt',apiKey:'secret',text:'private transcription',audioBase64:'private bytes'});assert(!JSON.stringify(privateData).includes('private'));assert(!JSON.stringify(privateData).includes('secret'));
});
test('Áudio seleção: perfis/fallbacks de STT não alteram TTS e vice-versa',()=>{
 const f=frontend(async()=>{}),settings={sttModel:'gemini-3.1-flash-lite',ttsModel:'gemini-3.1-flash-tts-preview',sttFallbackModels:['gemini-3.8-flash'],ttsFallbackModels:['gemini-2.5-pro-preview-tts']};
 const agents=[{id:'stt',config:{model:'gemini-3.8-flash'},sttInstructions:'stt rules'},{id:'tts',config:{model:'gemini-2.5-pro-preview-tts',baseGeminiVoice:'Puck'},directorPrompt:'tts rules'}];
 const changed=f.utils.updateTtsSettings(settings,{activeSttAgentId:'stt'},agents);assert.equal(changed.ttsModel,settings.ttsModel);assert.equal(changed.sttModel,'gemini-3.8-flash');
 const tts=f.utils.resolveTtsSelection(changed,agents),sttSelection=f.utils.resolveSttSelection(changed,agents);assert.deepEqual(Array.from(tts.fallbackModels),['gemini-2.5-pro-preview-tts']);assert.deepEqual(Array.from(sttSelection.fallbackModels),['gemini-3.8-flash']);
});
test('Áudio frontend: fallback nativo explícito é iniciado uma única vez após falha de reprodução',async()=>{
 const f=frontend(async()=>response(200,{audioBase64:'AAABAA==',mimeType:'audio/L16;rate=24000',status:'success',model:'gemini-3.1-flash-tts-preview'}));
 f.c.audioSettings.ttsFallbackModels=['browser-native'];
 f.c.Audio=class{play(){this.onerror?.();return Promise.reject(new Error('Local codec failure'));}pause(){}removeAttribute(){}load(){}};
 await f.c.tts('Texto','message');assert.equal(f.spoken.length,1);f.c.stop();
});
test('Áudio: deduplicação de prefixo models/ preserva a primeira configuração sem troca silenciosa',async()=>{
 const f=fixture(async()=>{throw Object.assign(new Error('404 model not found'),{status:404});});
 const r=await speech(f,'models/gemini-3.1-flash-tts-preview',{fallbackModels:['gemini-3.1-flash-tts-preview']},undefined,'local-key');
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].model,'models/gemini-3.1-flash-tts-preview');assert.equal(r.fallbackUsed,false);
});
test('Áudio frontend: áudio gerado com autoplay rejeitado não é registrado como reprodução bem-sucedida',async()=>{
 const f=frontend(async()=>response(200,{audioBase64:'AAABAA==',status:'success',model:'gemini-3.1-flash-tts-preview'}));
 f.c.Audio=class{play(){return Promise.reject(new Error('Playback denied'));}pause(){}removeAttribute(){}load(){}};
 await f.c.tts('Texto','message');assert.equal(f.diagnostics.at(-1).status,'failed');assert.equal(f.diagnostics.at(-1).code,'AUDIO_PLAYBACK_ERROR');assert.equal(f.spoken.length,0);
});
test('Áudio UI: catálogo documentado, prioridades separadas e Payload disponível sem mensagem',async()=>{
 const { buildSync }=await import('esbuild');const { createRequire }=await import('node:module');
 const result=buildSync({stdin:{contents:`export { AudioSettingsSection } from './src/components/settings/AudioSettingsSection.tsx'; export { RightSidebar } from './src/components/RightSidebar.tsx';`,resolveDir:root},bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
 const require=createRequire(path.join(root,'package.json')),module={exports:{}};
 vm.runInNewContext(result.outputFiles[0].text,{require,module,exports:module.exports,console});
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const html=renderToStaticMarkup(React.createElement(module.exports.AudioSettingsSection,{audioSettings:{ttsModel:'gemini-3.1-flash-tts-preview',sttModel:'gemini-3.8-flash',ttsFallbackModels:['gemini-2.5-pro-preview-tts'],sttFallbackModels:['gemini-3.1-flash-lite'],ttsVoice:'Puck',ttsSpeed:1,savedVoicePresets:[],audioModelStatus:{ttsAvailable:true,sttAvailable:true,liveAvailable:false}},onUpdateAudioSettings(){},theme:'dark',onChangeTheme(){}}));
 assert(html.includes('gemini-3.1-flash-tts-preview'));assert(!html.includes('value="gemini-3.1-flash-tts"'));assert(html.includes('Fallbacks TTS'));assert(html.includes('Fallbacks STT'));
 const panel=renderToStaticMarkup(React.createElement(module.exports.RightSidebar,{isOpen:true,message:null,onClose(){},audioDiagnostics:{tts:{modality:'tts',configuredModel:'configured',model:'fallback',status:'success',fallbackUsed:true,httpStatus:200,attempt:2},stt:{modality:'stt',status:'failed',httpStatus:429}}}));
 assert(panel.includes('Payload TTS / STT'));assert(panel.includes('fallbackUsed'));assert(panel.includes('429'));
});
