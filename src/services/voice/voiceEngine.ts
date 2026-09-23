import { VoiceDirectorConfig, AudioPlaybackState } from './voiceTypes.js';
import { compileDirectorPrompt } from './voiceDirector.js';

let currentAudioElement: HTMLAudioElement | null = null;

export async function generateTtsPreviewAudio(
  sampleText: string,
  config: VoiceDirectorConfig,
  apiKey?: string,
  apiUrl?: string,
  customCompiledPrompt?: string
): Promise<{ audioUrl?: string; audioBase64?: string; error?: string }> {
  const compiledDirectorPrompt = customCompiledPrompt !== undefined ? customCompiledPrompt : compileDirectorPrompt(config);

  try {
    const response = await fetch('/api/audio/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: sampleText || 'Testando narração do estúdio de voz Gemini.',
        voice: config.baseGeminiVoice || 'Kore',
        model: config.model || 'gemini-3.5-flash-lite',
        instructions: compiledDirectorPrompt,
        apiKey,
        apiUrl,
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('application/json')) {
      const data = await response.json();
      if (data.audioBase64) {
        const audioUrl = `data:audio/mp3;base64,${data.audioBase64}`;
        return { audioUrl, audioBase64: data.audioBase64 };
      }
      if (data.error) {
        console.warn('Servidor TTS retornou mensagem:', data.error);
      }
    } else {
      console.warn(`Resposta do servidor TTS não foi JSON válido (${response.status} ${response.statusText}). Utilizando síntese local.`);
    }
  } catch (err: any) {
    console.error('Erro na geração de preview TTS:', err);
  }

  // Local fallback using Web Speech API if server TTS is unreachable
  if ('speechSynthesis' in window) {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(sampleText || 'Testando voz local.');
      utterance.rate = config.speed || 1.0;
      utterance.onend = () => resolve({ error: 'Preview executado via Web Speech API local.' });
      utterance.onerror = () => resolve({ error: 'Falha na reprodução local.' });
      window.speechSynthesis.speak(utterance);
    });
  }

  return { error: 'Serviço de voz indisponível no momento.' };
}

export function stopCurrentAudio(): void {
  if (currentAudioElement) {
    currentAudioElement.pause();
    currentAudioElement.currentTime = 0;
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
  onError?: (err: any) => void
): HTMLAudioElement {
  stopCurrentAudio();

  const audio = new Audio(`data:audio/mp3;base64,${audioBase64}`);
  audio.playbackRate = playbackRate;
  audio.volume = Math.max(0, Math.min(1, volume / 100));

  audio.onended = () => {
    currentAudioElement = null;
    if (onEnd) onEnd();
  };

  audio.onerror = (e) => {
    currentAudioElement = null;
    if (onError) onError(e);
  };

  currentAudioElement = audio;
  audio.play().catch((err) => {
    console.warn('Auto-play impedido pelo navegador:', err);
  });

  return audio;
}
