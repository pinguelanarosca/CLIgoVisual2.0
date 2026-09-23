import { GoogleGenAI, Modality } from '@google/genai';
import { sysLog } from './logger-service.js';

let geminiClient: GoogleGenAI | null = null;

function getGenAiClient(customApiKey?: string, customApiUrl?: string): GoogleGenAI | null {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    return null;
  }
  
  const config: any = {
    apiKey,
  };

  if (customApiUrl) {
    config.baseUrl = customApiUrl;
  }

  // If custom API values are provided, return a dynamic custom client
  if (customApiKey || customApiUrl) {
    return new GoogleGenAI(config);
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenAI(config);
  }
  return geminiClient;
}

// Fallback Model Chain Mapping: Gemini 2.5 Flash -> Gemini 1.5 Flash -> Gemini 3.5 Flash Lite -> Gemini 3.5 Flash -> Gemini 3.6 Flash
// Production stable models (high limit, 1500 req/day) are 1st and 2nd.
// 20 requests/day preview/experimental models are strictly 3rd and 4th.
const FALLBACK_CHAIN: Record<string, string> = {
  'gemini-2.5-flash': 'gemini-1.5-flash',
  'gemini-1.5-flash': 'gemini-3.5-flash-lite',
  'gemini-3.5-flash-lite': 'gemini-3.5-flash',
  'gemini-3.5-flash': 'gemini-3.6-flash',
  'gemini-3.1-flash-tts': 'gemini-2.5-flash',
  'gemini-3.5-transcribe': 'gemini-2.5-flash',
};

export function normalizeAudioModel(rawModel?: string): string {
  if (!rawModel || rawModel === 'auto') return 'gemini-2.5-flash';
  const m = rawModel.trim().toLowerCase();
  if (m.includes('2.5-flash') || m.includes('2.5')) return 'gemini-2.5-flash';
  if (m.includes('1.5-flash') || m.includes('1.5')) return 'gemini-1.5-flash';
  if (m.includes('3.5-flash-lite')) return 'gemini-3.5-flash-lite';
  if (m.includes('3.5-flash')) return 'gemini-3.5-flash';
  if (m.includes('3.1-flash-tts')) return 'gemini-3.1-flash-tts';
  if (m.includes('3.6-flash')) return 'gemini-3.6-flash';
  return 'gemini-2.5-flash';
}

function isRetryableError(err: any): boolean {
  const status = err.status || err.statusCode || err.status_code || (err.response && err.response.status);
  if (status) {
    return [409, 429, 500, 503].includes(Number(status));
  }
  const msg = String(err.message || err).toLowerCase();
  return msg.includes('409') || msg.includes('429') || msg.includes('500') || msg.includes('503') || msg.includes('resource_exhausted') || msg.includes('rate limit');
}

async function callWithRetryAndFallback<T>(
  ai: GoogleGenAI,
  initialModel: string,
  executeFn: (model: string) => Promise<T>,
  abortSignal?: AbortSignal
): Promise<T> {
  let currentModel = normalizeAudioModel(initialModel);
  
  while (true) {
    if (abortSignal?.aborted) {
      throw new Error('Operação de áudio cancelada pelo usuário.');
    }

    let attempts = 0;
    const maxRetries = 2;
    
    while (attempts <= maxRetries) {
      if (abortSignal?.aborted) {
        throw new Error('Operação de áudio cancelada pelo usuário.');
      }

      try {
        if (attempts > 0) {
          sysLog.warn('AUDIO', `Tentativa de reexecução no modelo ${currentModel} (${attempts}/${maxRetries}) devido a erro de rede/quota transitório.`);
          await new Promise((resolve) => setTimeout(resolve, 500 * attempts));
        }
        
        let timeoutHandle: NodeJS.Timeout | null = null;
        let abortHandler: (() => void) | null = null;

        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`Timeout de 45s excedido na API Gemini (${currentModel})`)), 45000);
          if (abortSignal) {
            abortHandler = () => {
              if (timeoutHandle) clearTimeout(timeoutHandle);
              reject(new Error('Operação de áudio cancelada pelo usuário.'));
            };
            if (abortSignal.aborted) {
              abortHandler();
            } else {
              abortSignal.addEventListener('abort', abortHandler, { once: true });
            }
          }
        });

        try {
          return await Promise.race([executeFn(currentModel), timeoutPromise]);
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (abortSignal && abortHandler) {
            abortSignal.removeEventListener('abort', abortHandler);
          }
        }
      } catch (err: any) {
        if (abortSignal?.aborted || err.message?.includes('cancelada pelo usuário')) {
          throw new Error('Operação de áudio cancelada pelo usuário.');
        }

        const isQuota = String(err.message || err).includes('quota') || String(err.message || err).includes('429') || String(err.message || err).includes('RESOURCE_EXHAUSTED');

        if (isRetryableError(err) && attempts < maxRetries && !isQuota) {
          attempts++;
          continue;
        }
        
        // Look for fallback model
        const fallbackModel = FALLBACK_CHAIN[currentModel] || 'gemini-3.5-flash-lite';
        if (fallbackModel && fallbackModel !== currentModel) {
          if (isQuota) {
            sysLog.warn('AUDIO', `⚠️ [Cota Excedida no Modelo ${currentModel}] A requisição excedeu os limites do Tier Gratuito. Ativando fallback instantâneo para: ${fallbackModel}.`);
          } else {
            sysLog.warn('AUDIO', `Falha no modelo ${currentModel} após ${attempts} tentativas. Trocando para o modelo de fallback: ${fallbackModel}. Erro: ${err.message || err}`);
          }
          currentModel = fallbackModel;
          break; // Try fallback model in outer loop
        } else {
          sysLog.error('AUDIO', `FALHA CRÍTICA: O modelo ${currentModel} falhou. Não há mais fallbacks definidos para áudio. Erro: ${err.message || err}`);
          throw new Error(`Falha crítica de áudio: Modelo ${currentModel} falhou. Detalhes: ${err.message || err}`);
        }
      }
    }
  }
}

export interface AudioServiceStatus {
  sttAvailable: boolean;
  sttModel: string;
  ttsAvailable: boolean;
  ttsModel: string;
  liveAvailable: boolean;
  liveModel: string;
  message: string;
  authConfigured: boolean;
}

export async function checkAudioModelsAvailability(): Promise<AudioServiceStatus> {
  const ai = getGenAiClient();
  const authConfigured = Boolean(ai);

  if (!authConfigured) {
    return {
      sttAvailable: false,
      sttModel: 'gemini-2.5-flash',
      ttsAvailable: false,
      ttsModel: 'gemini-2.5-flash',
      liveAvailable: false,
      liveModel: 'gemini-3.1-flash-live-preview (arquitetura preparada)',
      message: 'Chave GEMINI_API_KEY não configurada no ambiente. Web Speech API nativa do navegador pode ser utilizada.',
      authConfigured: false,
    };
  }

  // Verify models
  return {
    sttAvailable: true,
    sttModel: 'gemini-2.5-flash',
    ttsAvailable: true,
    ttsModel: 'gemini-2.5-flash',
    liveAvailable: false, // Live API voice marked as prepared architecture, not mandatory initial
    liveModel: 'gemini-3.1-flash-live-preview',
    message: 'Modelos de interface configurados: STT (gemini-2.5-flash) e TTS (gemini-2.5-flash).',
    authConfigured: true,
  };
}

export async function transcribeAudio(
  base64Data: string,
  mimeType: string = 'audio/webm',
  modelName: string = 'gemini-3.5-flash-lite',
  customApiKey?: string,
  customApiUrl?: string,
  customInstructions?: string,
  abortSignal?: AbortSignal
): Promise<{ text: string; error?: string }> {
  const ai = getGenAiClient(customApiKey, customApiUrl);
  if (!ai) {
    return { text: '', error: 'Autenticação da API Gemini não configurada para STT.' };
  }

  const selectedModel = normalizeAudioModel(modelName);

  try {
    const result = await callWithRetryAndFallback(ai, selectedModel, async (modelToUse) => {
      const audioPart = {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      };

      const promptText = customInstructions && customInstructions.trim()
        ? `[REGRAS ABSOLUTAS DO TRANSCRITOR - PRIORIDADE MÁXIMA]:\n${customInstructions.trim()}\n\n[INSTRUÇÃO DE TAREFA]: Transcreva com exatidão o áudio fornecido para texto em português ou no idioma falado. Retorne somente a transcrição.`
        : 'Transcreva com exatidão o áudio fornecido para texto em português ou no idioma falado. Retorne somente a transcrição.';

      const config: any = {};
      if (customInstructions && customInstructions.trim()) {
        config.systemInstruction = `[REGRAS ABSOLUTAS DO TRANSCRITOR]: ${customInstructions.trim()}`;
      }

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: {
          parts: [
            audioPart,
            { text: promptText },
          ],
        },
        config,
      });

      const text = response.text?.trim() || '';
      return text;
    }, abortSignal);

    sysLog.success('AUDIO', `Transcrição de áudio concluída (${result.length} caracteres).`, { length: result.length });
    return { text: result };
  } catch (err: any) {
    if (abortSignal?.aborted || err.message?.includes('cancelada pelo usuário')) {
      sysLog.info('AUDIO', 'Transcrição de áudio cancelada pelo usuário.');
      return { text: '', error: 'Transcrição cancelada.' };
    }
    sysLog.error('AUDIO', `Falha na transcrição de áudio após retries e fallbacks: ${err.message || String(err)}`);
    return {
      text: '',
      error: `Erro no transcritor: ${err.message || String(err)}`,
    };
  }
}

export async function synthesizeSpeech(
  text: string,
  voiceName: string = 'Kore',
  modelName: string = 'gemini-3.5-flash-lite',
  customApiKey?: string,
  customApiUrl?: string,
  customInstructions?: string,
  abortSignal?: AbortSignal
): Promise<{ audioBase64: string; error?: string }> {
  const ai = getGenAiClient(customApiKey, customApiUrl);
  if (!ai) {
    return { audioBase64: '', error: 'Autenticação da API Gemini não configurada para TTS.' };
  }

  const selectedModel = normalizeAudioModel(modelName);

  try {
    // Clean code fences or diff blocks if text is too long or purely code
    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' [bloco de código omitido da narração] ')
      .replace(/`([^`]+)`/g, '$1')
      .slice(0, 3000); // Reasonable limit for speech utterance

    const validVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
    const chosenVoice = validVoices.includes(voiceName) ? voiceName : 'Kore';

    const result = await callWithRetryAndFallback(ai, selectedModel, async (modelToUse) => {
      const textToSynthesize = customInstructions && customInstructions.trim()
        ? `[REGRAS ABSOLUTAS DE NARRAÇÃO - PRIORIDADE MÁXIMA]:\n${customInstructions.trim()}\n\n[TEXTO A NARRAR]:\n${cleanText}`
        : cleanText;

      const config: any = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: chosenVoice },
          },
        },
      };

      if (customInstructions && customInstructions.trim()) {
        config.systemInstruction = `[REGRAS ABSOLUTAS DO NARRADOR]: ${customInstructions.trim()}`;
      }

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: [{ parts: [{ text: textToSynthesize }] }],
        config,
      });

      const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioBase64) {
        throw new Error('O modelo não retornou dados de áudio sintetizado.');
      }
      return audioBase64;
    });

    sysLog.success('AUDIO', `Síntese de fala TTS gerada com sucesso [Voz: ${chosenVoice}].`, { voice: chosenVoice });
    return { audioBase64: result };
  } catch (err: any) {
    sysLog.error('AUDIO', `Falha na síntese de voz TTS após retries e fallbacks: ${err.message || String(err)}`);
    return {
      audioBase64: '',
      error: `Erro no modelo de narração: ${err.message || String(err)}`,
    };
  }
}
