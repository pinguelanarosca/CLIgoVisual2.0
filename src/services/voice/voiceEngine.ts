import { VoiceDirectorConfig, AudioPlaybackState } from './voiceTypes.js';
import { compileDirectorPrompt } from './voiceDirector.js';
import { ttsAudioUrl } from './ttsUtils.js';

let currentAudioElement: HTMLAudioElement | null = null;

let pendingPreview: AbortController | null = null;

export async function generateTtsPreviewAudio(
  sampleText: string,
  config: VoiceDirectorConfig,
  apiKey?: string,
  apiUrl?: string,
  customCompiledPrompt?: string,
  abortSignal?: AbortSignal,
  options: { fallbackModels?: string[]; fallback?: { model: string; voice?: string; instructions?: string } } = {}
): Promise<{ audioUrl?: string; audioBase64?: string; mimeType?: string; error?: string; cancelled?: boolean }> {
  pendingPreview?.abort();
  const controller = new AbortController();
  pendingPreview = controller;
  const signal = abortSignal ? AbortSignal.any([abortSignal, controller.signal]) : controller.signal;
  const compiledDirectorPrompt = customCompiledPrompt !== undefined ? customCompiledPrompt : compileDirectorPrompt(config);
  const requestId = crypto.randomUUID();
  let fallbackReason = 'TTS_FAILED';
  try {
    if (signal.aborted) return { cancelled: true };
    if (config.model !== 'browser-native') {
      try {
        const response = await fetch('/api/audio/tts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ text: sampleText || 'Testando narração do estúdio de voz Gemini.', voice: config.baseGeminiVoice || 'Kore', model: config.model || 'gemini-3.1-flash-tts-preview', instructions: compiledDirectorPrompt, apiKey, apiUrl, requestId, fallbackModels: options.fallbackModels, fallback: options.fallback, language: config.language }),
        });
        if (signal.aborted) return { cancelled: true };
        if ((response.headers.get('content-type') || '').includes('application/json')) {
          const data = await response.json();
          if (signal.aborted) return { cancelled: true };
          if (response.ok && data.audioBase64) {
            console.info('TTS_PROVIDER', { requestId, model: data.model, provider: data.provider, fallbackReason: data.fallbackReason });
            return { audioUrl: ttsAudioUrl(data.audioBase64, data.mimeType), audioBase64: data.audioBase64, mimeType: data.mimeType };
          }
          fallbackReason = data.error || data.code || fallbackReason;
        } else fallbackReason = 'TTS_HTTP_' + response.status;
      } catch (error: any) {
        if (signal.aborted || error.name === 'AbortError') return { cancelled: true };
        fallbackReason = error.message || 'TTS_NETWORK_ERROR';
      }
    }
    if (signal.aborted) return { cancelled: true };
    if (config.model !== 'browser-native' && !options.fallbackModels?.includes('browser-native') && options.fallback?.model !== 'browser-native') return { error: fallbackReason };
    console.info('TTS_PROVIDER', { requestId, configuredModel: config.model, model: 'browser-native', provider: 'speech-synthesis', fallbackReason: config.model === 'browser-native' ? undefined : fallbackReason });
    if ('speechSynthesis' in window) {
      return await new Promise(resolve => {
        const utterance = new SpeechSynthesisUtterance(sampleText || 'Testando voz local.');
        utterance.rate = config.speed || 1;
        const finish = (result: { error?: string; cancelled?: boolean }) => { signal.removeEventListener('abort', cancelled); resolve(result); };
        const cancelled = () => { window.speechSynthesis.cancel(); finish({ cancelled: true }); };
        signal.addEventListener('abort', cancelled, { once: true });
        utterance.onend = () => finish({ error: 'Preview executado via Web Speech API local.' });
        utterance.onerror = () => finish(signal.aborted ? { cancelled: true } : { error: 'Falha na reprodução local.' });
        if (signal.aborted) cancelled(); else window.speechSynthesis.speak(utterance);
      });
    }
    return { error: 'Serviço de voz indisponível no momento.' };
  } finally { if (pendingPreview === controller) pendingPreview = null; }
}

export function stopCurrentAudio(): void {
  pendingPreview?.abort();
  pendingPreview = null;
  if (currentAudioElement) {
    currentAudioElement.onended = null; currentAudioElement.onerror = null;
    currentAudioElement.pause();
    currentAudioElement.currentTime = 0;
    currentAudioElement.removeAttribute('src'); currentAudioElement.load();
    currentAudioElement = null;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function playAudioFromBase64(
  audioBase64: string,
  playbackRate: number = 1.0,
  volume: number = 100,
  onEnd?: () => void,
  onError?: (err: any) => void,
  mimeType?: string
): HTMLAudioElement {
  stopCurrentAudio();

  const audio = new Audio(ttsAudioUrl(audioBase64, mimeType));
  audio.playbackRate = playbackRate;
  audio.volume = Math.max(0, Math.min(1, volume / 100));

  audio.onended = () => {
    if (currentAudioElement !== audio) return;
    currentAudioElement = null;
    if (onEnd) onEnd();
  };

  audio.onerror = (e) => {
    if (currentAudioElement !== audio) return;
    currentAudioElement = null;
    if (onError) onError(e);
  };

  currentAudioElement = audio;
  audio.play().catch((err) => {
    console.warn('Auto-play impedido pelo navegador:', err);
  });

  return audio;
}
