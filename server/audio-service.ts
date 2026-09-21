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
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
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

// Fallback Model Chain Mapping: Gemini 3.5 Flash Lite -> Gemini 3.1 Flash Lite -> Gemini 3.5 Flash
const FALLBACK_CHAIN: Record<string, string> = {
  'gemini-3.5-transcribe': 'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite': 'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite': 'gemini-3.5-flash',
  'gemini-3.1-flash-tts-preview': 'gemini-3.1-flash-lite',
};

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
  executeFn: (model: string) => Promise<T>
): Promise<T> {
  let currentModel = initialModel;
  
  while (true) {
    let attempts = 0;
    const maxRetries = 3;
    
    while (attempts <= maxRetries) {
      try {
        if (attempts > 0) {
          sysLog.warn('AUDIO', `Tentativa de reexecução no modelo ${currentModel} (${attempts}/${maxRetries}) devido a erro de rede/quota transitório.`);
          // Simple delay before retrying
          await new Promise((resolve) => setTimeout(resolve, 600 * attempts));
        }
        return await executeFn(currentModel);
      } catch (err: any) {
        if (isRetryableError(err) && attempts < maxRetries) {
          attempts++;
          continue;
        }
        
        // If we exhausted retries or the error is not retryable, look for fallback model
        const fallbackModel = FALLBACK_CHAIN[currentModel];
        if (fallbackModel) {
          sysLog.warn('AUDIO', `Falha no modelo ${currentModel} após ${attempts} tentativas. Trocando para o modelo de fallback: ${fallbackModel}. Erro: ${err.message || err}`);
          currentModel = fallbackModel;
          break; // Break the inner retry loop to try the fallback model in the outer loop
        } else {
          // No fallback model or fallback failed too
          sysLog.error('AUDIO', `FALHA CRÍTICA: O modelo ${currentModel} falhou. Não há mais fallbacks definidos para este agente. Interrompendo a tarefa dependente.`);
          throw new Error(`Falha crítica de áudio: Modelo ${currentModel} falhou e não há fallbacks restantes. Detalhes: ${err.message || err}`);
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
      sttModel: 'gemini-3.5-flash-lite',
      ttsAvailable: false,
      ttsModel: 'gemini-3.5-flash-lite',
      liveAvailable: false,
      liveModel: 'gemini-3.1-flash-live-preview (arquitetura preparada)',
      message: 'Chave GEMINI_API_KEY não configurada no ambiente. Web Speech API nativa do navegador pode ser utilizada.',
      authConfigured: false,
    };
  }

  // Verify models
  return {
    sttAvailable: true,
    sttModel: 'gemini-3.5-flash-lite',
    ttsAvailable: true,
    ttsModel: 'gemini-3.5-flash-lite',
    liveAvailable: false, // Live API voice marked as prepared architecture, not mandatory initial
    liveModel: 'gemini-3.1-flash-live-preview',
    message: 'Modelos de interface configurados: STT (gemini-3.5-flash-lite) e TTS (gemini-3.5-flash-lite).',
    authConfigured: true,
  };
}

export async function transcribeAudio(
  base64Data: string,
  mimeType: string = 'audio/webm',
  modelName: string = 'gemini-3.5-flash-lite',
  customApiKey?: string,
  customApiUrl?: string,
  customInstructions?: string
): Promise<{ text: string; error?: string }> {
  const ai = getGenAiClient(customApiKey, customApiUrl);
  if (!ai) {
    return { text: '', error: 'Autenticação da API Gemini não configurada para STT.' };
  }

  const selectedModel = modelName || 'gemini-3.5-flash-lite';

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
    });

    sysLog.success('AUDIO', `Transcrição de áudio concluída (${result.length} caracteres).`, { length: result.length });
    return { text: result };
  } catch (err: any) {
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
  customInstructions?: string
): Promise<{ audioBase64: string; error?: string }> {
  const ai = getGenAiClient(customApiKey, customApiUrl);
  if (!ai) {
    return { audioBase64: '', error: 'Autenticação da API Gemini não configurada para TTS.' };
  }

  const selectedModel = modelName || 'gemini-3.5-flash-lite';

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
