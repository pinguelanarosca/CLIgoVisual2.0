import type { AudioSettings } from '../../types.js';
import type { VoiceAgent } from './voiceTypes.js';

export function resolveTtsSelection(settings: AudioSettings, agents: VoiceAgent[]) {
  const backup = agents.find(item => item.id === settings.backupTtsAgentId);
  return {
    model: settings.ttsModel,
    voice: settings.ttsVoice || 'Kore',
    speed: settings.ttsSpeed || 1,
    instructions: settings.ttsInstructions,
    fallbackModels: settings.ttsFallbackModels || [],
    language: settings.ttsLanguage, generationConfig: settings.ttsGenerationConfig,
    fallback: backup ? { model: backup.config.model, voice: backup.config.baseGeminiVoice, instructions: backup.directorPrompt } : undefined,
  };
}

export function updateTtsSettings(settings: AudioSettings, updates: Partial<AudioSettings>, agents: VoiceAgent[]): AudioSettings {
  let next = { ...settings, ...updates };
  const sttAgent = agents.find(item => item.id === updates.activeSttAgentId);
  if (sttAgent) next = { ...next, sttModel: sttAgent.config.model || next.sttModel, sttInstructions: sttAgent.sttInstructions ?? next.sttInstructions };
  const agent = agents.find(item => item.id === updates.activeTtsAgentId);
  if (!agent) return next;
  return { ...next, ttsModel: agent.config.model || next.ttsModel, ttsVoice: agent.config.baseGeminiVoice || next.ttsVoice,
    ttsSpeed: agent.config.speed || next.ttsSpeed, ttsInstructions: agent.directorPrompt ?? next.ttsInstructions };
}

export function ttsAudioUrl(base64: string, mimeType = 'audio/mp3') {
  // Legacy Gemini TTS returns raw PCM; the browser requires a WAV container.
  if (!/^audio\/(?:L16|pcm)(?:;|$)/i.test(mimeType)) return `data:${mimeType};base64,${base64}`;
  const pcm = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const channels = Number(mimeType.match(/channels=(\d+)/i)?.[1] || 1);
  const rate = Number(mimeType.match(/rate=(\d+)/i)?.[1] || 24000);
  const wav = new Uint8Array(44 + pcm.length), view = new DataView(wav.buffer);
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i); };
  write(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, pcm.length, true); wav.set(pcm, 44);
  let binary = ''; for (const byte of wav) binary += String.fromCharCode(byte);
  return 'data:audio/wav;base64,' + btoa(binary);
}

export function resolveSttSelection(settings: AudioSettings, agents: VoiceAgent[]) {
  const backup = agents.find(item => item.id === settings.backupSttAgentId);
  return { model: settings.sttModel, instructions: settings.sttInstructions,
    fallbackModels: settings.sttFallbackModels || [], language: settings.sttLanguage,
    generationConfig: settings.sttGenerationConfig,
    fallback: backup ? { model: backup.config.model, instructions: backup.sttInstructions ?? settings.sttInstructions } : undefined };
}

export const TTS_DOCUMENTED_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-2.5-pro-preview-tts'];
export function getAudioDiagnostics(data: any) {
  const keys = ['modality', 'configuredModel', 'primaryModel', 'model', 'effectiveModel', 'provider', 'requestId', 'status', 'fallbackUsed', 'fallbackReason', 'nextProvider', 'httpStatus', 'attempt', 'attempts', 'code', 'errorCode', 'error', 'nextRetryAt'];
  return Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
}
