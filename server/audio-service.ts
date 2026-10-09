import { GoogleGenAI, Modality } from '@google/genai';
import { sysLog } from './logger-service.js';
import { classifyKeyResult, getBestEligibleKey, getEligibleRankedKeys, getModelAvailability, recordRuntimeExecutionResult } from './key-pool-service.js';
import { randomUUID } from 'node:crypto';

type AudioModality = 'tts' | 'stt';
export interface AudioRequestOptions {
  requestId?: string;
  fallbackModels?: string[]; // Explicit priority: first entry is fallback 1.
  fallback?: { model: string; voice?: string; instructions?: string }; // Existing GUI contract.
  language?: string;
  generationConfig?: Record<string, any>;
}
export type TtsRequestOptions = AudioRequestOptions;
interface AudioAttempt {
  modality: AudioModality; configuredModel: string; primaryModel: string; model: string;
  effectiveModel: string; provider: string; requestId: string; keyId: string;
  attempt: number; modelAttempt: number; httpStatus: number | null;
  status: string; errorCode?: string; reason?: string; fallbackUsed: boolean;
}
interface AudioOutcome {
  modality: AudioModality; model: string; effectiveModel: string | null; configuredModel: string; primaryModel: string;
  provider: string; requestId: string; status: 'success' | 'failed' | 'cancelled';
  fallbackUsed: boolean; fallbackReason?: string; code?: string; error?: string; errorCode?: string;
  httpStatus: number | null; attempt: number; attempts: AudioAttempt[]; nextRetryAt?: string; nextProvider?: string;
}
// Match the agents' per-invocation allowance, without changing agent/Key Pool policy.
const AUDIO_ATTEMPT_LIMIT = 6, AUDIO_MODEL_ATTEMPT_LIMIT = 3, AUDIO_TIMEOUT_MS = 45000;

// Retained export for callers; configured provider IDs are never rewritten.
export function normalizeAudioModel(rawModel?: string): string { return rawModel?.trim() || ''; }
function httpStatusOf(error: any): number | null {
  const value = Number(error?.status || error?.statusCode || error?.response?.status || error?.code);
  if (value >= 400 && value <= 599) return value;
  try { const parsed = JSON.parse(error?.message || '{}'); const code = Number(parsed.error?.code); if (code >= 400 && code <= 599) return code; } catch {}
  return null;
}
function audioDelay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancelled); };
    const cancelled = () => { cleanup(); reject(signal!.reason); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal?.addEventListener('abort', cancelled, { once: true });
    if (signal?.aborted) cancelled();
  });
}
export function audioHttpStatus(result: AudioOutcome): number {
  if (result.status === 'success') return 200;
  if (result.status === 'cancelled') return 499;
  if (result.code?.endsWith('REQUEST_TIMEOUT')) return 504;
  if (result.httpStatus && result.httpStatus >= 400) return result.httpStatus;
  if (result.code?.endsWith('OPTIONS_EXHAUSTED')) return 503;
  if (result.code?.endsWith('INVALID_MODEL')) return 400;
  return 502;
}

async function executeAudio<T>(
  modality: AudioModality, primaryModel: string, customApiKey: string | undefined, customApiUrl: string | undefined,
  signal: AbortSignal | undefined, options: AudioRequestOptions,
  build: (model: string, signal: AbortSignal, backup?: AudioRequestOptions['fallback']) => any,
  read: (response: any) => T | undefined
): Promise<AudioOutcome & { value?: T }> {
  const configuredModel = normalizeAudioModel(primaryModel);
  const requestId = options.requestId || randomUUID(), attempts: AudioAttempt[] = [];
  const models: string[] = [], seen = new Set<string>();
  for (const candidate of [configuredModel, ...(Array.isArray(options.fallbackModels) ? options.fallbackModels : []), options.fallback?.model || '']) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const identity = candidate.trim().replace(/^models\//, '');
    if (!seen.has(identity)) { seen.add(identity); models.push(candidate.trim()); }
  }
  let model = configuredModel, fallbackReason: string | undefined, nextRetryAt: string | undefined;
  let lastStatus: number | null = null, lastErrorCode: string | undefined, lastMessage = 'Nenhuma opção elegível está disponível.';
  let terminalCode = `${modality.toUpperCase()}_OPTIONS_EXHAUSTED`;
  const invalidKeys = new Set<string>(), secrets = new Set<string>(customApiKey ? [customApiKey] : []);
  const redact = (value: unknown) => { let text = String(value); for (const key of secrets) text = text.split(key).join('[REDACTED]'); return text.replace(/([?&](?:key|api_key|token)=)[^&\s"']+/gi, '$1[REDACTED]'); };
  const metadata = (): AudioOutcome => ({ modality, configuredModel, primaryModel: configuredModel, model: attempts.at(-1)?.model || configuredModel, effectiveModel: attempts.at(-1)?.model || null, provider: 'gemini', requestId,
    status: 'failed', fallbackUsed: attempts.some(attempt => attempt.fallbackUsed), fallbackReason, httpStatus: lastStatus, attempt: attempts.length, attempts, nextRetryAt });
  const event = (name: string, details: any, level: 'info' | 'warn' | 'success' | 'error' = 'info') => sysLog[level]('AUDIO', `${modality.toUpperCase()}_${name}`, details);
  try {
    signal?.throwIfAborted();
    if (!configuredModel || configuredModel === 'auto' || configuredModel === 'browser-native') {
      terminalCode = `${modality.toUpperCase()}_INVALID_MODEL`; throw new Error('Selecione um modelo explícito; browser-native é executado no navegador.');
    }
    modelLoop: for (let index = 0; index < models.length && attempts.length < AUDIO_ATTEMPT_LIMIT; index++) {
      signal?.throwIfAborted(); model = models[index];
      if (model === 'browser-native') {
        model = models[Math.max(0, index - 1)];
        event('PROVIDER_FALLBACK', { ...metadata(), nextProvider: 'browser-native', reason: lastMessage }, 'warn');
        return { ...metadata(), nextProvider: 'browser-native', code: `${modality.toUpperCase()}_FALLBACK_REQUIRED`, error: lastMessage };
      }
      if (index) { fallbackReason ||= lastMessage; event('MODEL_FALLBACK', { ...metadata(), fromModel: models[index - 1], toModel: model, reason: lastMessage, httpStatus: lastStatus }, 'warn'); }
      const usedKeys = new Set<string>(); let networkRetries = 0;
      // Reserve at least one attempt for each remaining configured fallback.
      const modelLimit = Math.min(AUDIO_MODEL_ATTEMPT_LIMIT, Math.max(1, AUDIO_ATTEMPT_LIMIT - attempts.length - (models.length - index - 1)));
      for (let modelAttempt = 1; modelAttempt <= modelLimit; modelAttempt++) {
        signal?.throwIfAborted();
        const candidate = customApiKey ? { keyId: 'custom', key: customApiKey } : getEligibleRankedKeys(model).find(key => !usedKeys.has(key.keyId) && !invalidKeys.has(key.keyId));
        if (!candidate) {
          const available = getModelAvailability(model);
          if (available.nextRetryAt && (!nextRetryAt || available.nextRetryAt < nextRetryAt)) nextRetryAt = available.nextRetryAt;
          event('MODEL_UNAVAILABLE', { ...metadata(), model, reason: lastMessage, availability: available }, 'warn'); break;
        }
        secrets.add(candidate.key);
        if (modelAttempt > 1 && customApiKey && !networkRetries) await audioDelay(500 * (modelAttempt - 1), signal);
        signal?.throwIfAborted();
        const started = Date.now(), deadline = new AbortController();
        const requestSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
        const timer = setTimeout(() => deadline.abort(Object.assign(new Error(`GUI_REQUEST_TIMEOUT: requisição ${modality.toUpperCase()} atingiu 45s.`), { code: 'GUI_REQUEST_TIMEOUT' })), AUDIO_TIMEOUT_MS);
        const attempt: AudioAttempt = { modality, configuredModel, primaryModel: configuredModel, model, effectiveModel: model, provider: 'gemini', requestId,
          keyId: candidate.keyId, attempt: attempts.length + 1, modelAttempt, status: 'running', httpStatus: null, fallbackUsed: index > 0 };
        attempts.push(attempt);
        let aborted: () => void = () => {};
        try {
          requestSignal.throwIfAborted();
          event(modelAttempt > 1 && !customApiKey ? 'KEY_FAILOVER' : 'ATTEMPT', { ...attempt, fallbackReason });
          const ai = new GoogleGenAI({ apiKey: candidate.key, ...(customApiUrl ? { httpOptions: { baseUrl: customApiUrl } } : {}) });
          const backup = options.fallback?.model?.trim() === model ? options.fallback : undefined;
          const request = build(model, requestSignal, backup);
          request.config = { ...request.config, abortSignal: requestSignal, httpOptions: { ...request.config?.httpOptions, timeout: AUDIO_TIMEOUT_MS, retryOptions: { attempts: 1 } } };
          const cancelled = new Promise<never>((_, reject) => { aborted = () => reject(requestSignal.reason); requestSignal.addEventListener('abort', aborted, { once: true }); if (requestSignal.aborted) aborted(); });
          const response = await Promise.race([ai.models.generateContent(request), cancelled]);
          requestSignal.throwIfAborted(); lastStatus = 200;
          const value = read(response);
          if (value === undefined) throw Object.assign(new Error('Resposta HTTP 200 sem conteúdo válido da modalidade.'), { code: 'AUDIO_EMPTY_RESPONSE' });
          attempt.status = 'success'; attempt.httpStatus = 200;
          if (!customApiKey) recordRuntimeExecutionResult(model, candidate.keyId, { success: true, latencyMs: Date.now() - started, httpStatus: 200, requestId, endpoint: 'generateContent', apiVersion: 'v1beta' });
          event('SUCCESS', { ...metadata(), ...attempt, status: 'success', fallbackReason }, 'success');
          return { ...metadata(), status: 'success', value };
        } catch (caught: any) {
          if (signal?.aborted) { attempt.status = 'cancelled'; attempt.errorCode = 'GUI_EXECUTION_CANCELLED'; throw signal.reason; }
          const error = deadline.signal.aborted ? deadline.signal.reason : caught;
          lastStatus = httpStatusOf(error); lastMessage = redact(error?.message || error);
          const localCode = error?.code === 'AUDIO_EMPTY_RESPONSE' ? 'GUI_RESPONSE_LIMIT' : error?.name === 'AbortError' ? 'GUI_REQUEST_ABORTED' : error?.code;
          const classified = classifyKeyResult(lastStatus, localCode, lastMessage);
          if (error?.code === 'AUDIO_EMPTY_RESPONSE') lastStatus = 200;
          lastErrorCode = classified.errorCode; terminalCode = deadline.signal.aborted ? `${modality.toUpperCase()}_REQUEST_TIMEOUT` : `${modality.toUpperCase()}_FAILED`;
          Object.assign(attempt, { status: 'failed', httpStatus: lastStatus, errorCode: classified.errorCode, reason: lastMessage });
          event('API_FAILURE', { ...attempt, ...classified, reason: lastMessage }, 'warn');
          if (!customApiKey && classified.affectsKey !== false) recordRuntimeExecutionResult(model, candidate.keyId, { success: false, latencyMs: Date.now() - started, httpStatus: lastStatus, errorText: lastMessage, requestId, endpoint: 'generateContent', apiVersion: 'v1beta' });
          fallbackReason = lastMessage;
          if (classified.errorCode === 'NETWORK_FAILURE' && networkRetries++ === 0 && modelAttempt < modelLimit) { await audioDelay(250, signal); continue; }
          if (deadline.signal.aborted) break; // Local timeout: abort transport, then configured fallback; no key penalty.
          if (classified.affectsKey === false) break modelLoop;
          if (lastStatus === 404 || classified.errorCode === 'MODEL_NOT_FOUND') break; // Another key cannot repair an unknown model ID.
          if (classified.group === 'G6') break modelLoop;
          if (classified.group === 'G5') { if (customApiKey) break modelLoop; invalidKeys.add(candidate.keyId); }
          if (!['G2', 'G3', 'G4', 'G5'].includes(classified.group)) break modelLoop;
          if (!customApiKey) usedKeys.add(candidate.keyId);
          else if (classified.group === 'G3') break; // No immediate retry of the same quota-limited credential.
        } finally { clearTimeout(timer); requestSignal.removeEventListener('abort', aborted); }
      }
    }
  } catch (error: any) {
    if (signal?.aborted) {
      const result = { ...metadata(), status: 'cancelled' as const, code: `${modality.toUpperCase()}_CANCELLED`, error: 'Operação de áudio cancelada.' };
      event('CANCELLED', result); return result;
    }
    lastMessage = redact(error?.message || error);
  }
  const result = { ...metadata(), code: terminalCode, errorCode: lastErrorCode, error: lastMessage };
  event('FAILED', result, 'error'); return result;
}

export interface AudioServiceStatus { sttAvailable: boolean; sttModel: string; ttsAvailable: boolean; ttsModel: string; liveAvailable: boolean; liveModel: string; message: string; authConfigured: boolean; verified?: boolean; }
export async function checkAudioModelsAvailability(): Promise<AudioServiceStatus> {
  const sttModel = 'gemini-3.1-flash-lite', ttsModel = 'gemini-3.1-flash-tts-preview';
  const sttAvailable = Boolean(getBestEligibleKey(sttModel)), ttsAvailable = Boolean(getBestEligibleKey(ttsModel));
  return { sttAvailable, sttModel, ttsAvailable, ttsModel, liveAvailable: false, liveModel: 'gemini-3.1-flash-live-preview', authConfigured: Boolean(getModelAvailability(sttModel).configured || getModelAvailability(ttsModel).configured), verified: false,
    message: 'Elegibilidade local das chaves; disponibilidade do provedor não verificada. Modelos e fallbacks são definidos separadamente para TTS e STT.' };
}
export async function transcribeAudio(base64Data: string, mimeType = 'audio/webm', modelName = 'gemini-3.5-flash-lite', customApiKey?: string, customApiUrl?: string, customInstructions?: string, abortSignal?: AbortSignal, options: AudioRequestOptions = {}) {
  const result = await executeAudio('stt', modelName, customApiKey, customApiUrl, abortSignal, options, (model, signal, backup) => {
    const instructions = backup?.instructions ?? customInstructions;
    return { model,
      contents: { parts: [{ inlineData: { mimeType, data: base64Data } }, { text: `${instructions?.trim() ? `[REGRAS ABSOLUTAS DO TRANSCRITOR]:\n${instructions.trim()}\n\n` : ''}Transcreva com exatidão o áudio para texto em ${options.language || 'português ou no idioma falado'}. Retorne somente a transcrição.` }] },
      config: { ...options.generationConfig, abortSignal: signal, ...(instructions?.trim() ? { systemInstruction: `[REGRAS ABSOLUTAS DO TRANSCRITOR]: ${instructions.trim()}` } : {}) },
    };
  }, response => { const text = response.text?.trim(); return text || undefined; });
  const { value, ...metadata } = result; return { text: value || '', ...metadata };
}
export async function synthesizeSpeech(text: string, voiceName = 'Kore', modelName = 'gemini-3.1-flash-tts-preview', customApiKey?: string, customApiUrl?: string, customInstructions?: string, abortSignal?: AbortSignal, options: TtsRequestOptions = {}) {
  const cleanText = text.replace(/```[\s\S]*?```/g, ' [bloco de código omitido da narração] ').replace(/`([^`]+)`/g, '$1').slice(0, 3000);
  const result = await executeAudio('tts', modelName, customApiKey, customApiUrl, abortSignal, options, (model, signal, backup) => {
    const instructions = backup?.instructions ?? customInstructions, voice = backup?.voice || voiceName;
    const modern = /^gemini-3\.8-flash(?:-lite)?-tts$/.test(model.replace(/^models\//, ''));
    const part: any = { text: modern || !instructions?.trim() ? cleanText : `[REGRAS ABSOLUTAS DE NARRAÇÃO]:\n${instructions.trim()}\n\n[TEXTO A NARRAR]:\n${cleanText}` };
    if (modern && instructions?.trim()) part.speechMetadata = { style: instructions.trim() };
    return { model, contents: [{ parts: [part] }], config: { ...options.generationConfig, abortSignal: signal, responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: modern ? { voice } : { prebuiltVoiceConfig: { voiceName: voice } }, ...(options.language ? { languageCode: options.language } : {}) },
      ...(!modern && instructions?.trim() ? { systemInstruction: `[REGRAS ABSOLUTAS DO NARRADOR]: ${instructions.trim()}` } : {}),
    } };
  }, response => { const audio = response.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData?.data && (!part.inlineData.mimeType || part.inlineData.mimeType.startsWith('audio/')))?.inlineData; return audio?.data ? { audioBase64: audio.data, mimeType: audio.mimeType || 'audio/mp3' } : undefined; });
  const { value, ...metadata } = result; return { audioBase64: '', ...value, ...metadata };
}
