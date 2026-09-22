import React from 'react';
import { Volume2, AlertTriangle, AlertCircle, Check } from 'lucide-react';
import { AudioSettings } from '../../types.js';

interface AudioSettingsSectionProps {
  audioSettings: AudioSettings;
  onUpdateAudioSettings: (updates: Partial<AudioSettings>) => void;
  theme: 'dark' | 'light';
  onChangeTheme: (theme: 'dark' | 'light') => void;
}

export const AudioSettingsSection: React.FC<AudioSettingsSectionProps> = ({
  audioSettings,
  onUpdateAudioSettings,
  theme,
  onChangeTheme,
}) => {
  return (
    <div className="space-y-6">
      {/* Seção 1: Tema & Interface */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase font-mono tracking-wider text-zinc-700 dark:text-zinc-300">
          Aparência do Workspace
        </h4>
        <div className="p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">
              Tema Visual do Aplicativo
            </span>
            <span className="text-[10px] text-zinc-500 block">
              Alterne instantaneamente entre o modo Dark Escuro e Light Claro.
            </span>
          </div>
          <div className="flex items-center gap-1.5 p-1 bg-zinc-200/60 dark:bg-zinc-900 rounded-xl">
            <button
              onClick={() => onChangeTheme('dark')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                theme === 'dark'
                  ? 'bg-zinc-800 text-white shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              🌙 Dark
            </button>
            <button
              onClick={() => onChangeTheme('light')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                theme === 'light'
                  ? 'bg-white text-zinc-900 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              ☀️ Light
            </button>
          </div>
        </div>
      </div>

      <hr className="border-zinc-200 dark:border-zinc-800" />

      {/* Seção 2: Configurações do Agente Multimodal de Áudio */}
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-emerald-500" />
            Configuração do Agente Multimodal de Áudio & Voz (STT/TTS)
          </h4>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
            Ajuste os modelos de fala (Gemini Transcribe), sintetização neural de áudio e atalhos de voz do sistema.
          </p>
        </div>

        {/* Chave de API de Áudio e Endpoint */}
        <div className="p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80 space-y-3">
          <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">
            Credenciais e Endpoints de Áudio
          </span>
          <p className="text-[10px] text-zinc-500">
            Caso deseje utilizar uma chave de API ou endpoint de proxy dedicado para geração e transcrição de áudio.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Chave de API de Áudio (Gemini API Key)
              </label>
              <input
                type="password"
                value={audioSettings.audioApiKey || ''}
                onChange={(e) => onUpdateAudioSettings({ audioApiKey: e.target.value })}
                placeholder="Opcional (Usa padrão se vazio)"
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 transition"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Endpoint Customizado (Base URL)
              </label>
              <input
                type="text"
                value={audioSettings.audioApiUrl || ''}
                onChange={(e) => onUpdateAudioSettings({ audioApiUrl: e.target.value })}
                placeholder="Opcional (Ex: https://api.proxy...)"
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 transition font-mono"
              />
            </div>
          </div>
        </div>

        {/* Transcritor (STT) */}
        <div className="space-y-2 p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200">
              Agente de Transcrição / Ditado (STT)
            </label>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
              Entrada por Voz
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">
            Converte a sua gravação de voz em texto em tempo real para ser enviado ao terminal.
          </p>
          <select
            value={audioSettings.sttModel}
            onChange={(e) => onUpdateAudioSettings({ sttModel: e.target.value })}
            className="w-full mt-1.5 px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="gemini-2.5-flash">Gemini 2.5 Flash (Padrão de Alta Estabilidade - 1500 req/dia)</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Forte Estabilidade - 1500 req/dia)</option>
            <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (Experimental - Limite 20 req/dia)</option>
            <option value="gemini-3.5-flash">Gemini 3.5 Flash (Experimental - Limite 20 req/dia)</option>
            <option value="browser-native">Web Speech API (Conversão local do navegador - Instantânea)</option>
          </select>

          <div className="mt-2">
            <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Instruções Absolutas do Transcritor
            </label>
            <textarea
              value={audioSettings.sttInstructions || ''}
              onChange={(e) => onUpdateAudioSettings({ sttInstructions: e.target.value })}
              placeholder="Ex: Mantenha termos técnicos em inglês, formate como tópicos limpos e aplique pontuação estrita."
              rows={2}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Enviadas no topo de cada requisição de transcrição como regras absolutas.
            </p>
          </div>

          {(audioSettings.sttModel === 'gemini-2.5-flash' || audioSettings.sttModel === 'gemini-1.5-flash') && (
            <div className="mt-2 text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 p-2.5 rounded-lg flex gap-1.5 leading-normal">
              <Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500" />
              <div>
                <strong>Fallback Inteligente Ativo:</strong> Se o modelo principal esgotar sua cota de Tier Gratuito (1500 req/dia), o sistema acionará automaticamente a linha de fallback: <strong>Gemini 1.5 Flash</strong> &rarr; <strong>Gemini 3.5 Flash Lite</strong> (3º) &rarr; <strong>Gemini 3.5 Flash</strong> (4º).
              </div>
            </div>
          )}
        </div>

        {/* Narrador (TTS) */}
        <div className="space-y-4 p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200">
              Agente de Narração / Leitura (TTS)
            </label>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              Saída por Voz
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">
            Lê em voz alta as respostas completadas pelo assistente de IA ou relatórios.
          </p>
          <select
            value={audioSettings.ttsModel}
            onChange={(e) => onUpdateAudioSettings({ ttsModel: e.target.value })}
            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="gemini-2.5-flash">Gemini 2.5 Flash (Padrão de Alta Estabilidade - 1500 req/dia)</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Forte Estabilidade - 1500 req/dia)</option>
            <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (Experimental - Limite 20 req/dia)</option>
            <option value="gemini-3.5-flash">Gemini 3.5 Flash (Experimental - Limite 20 req/dia)</option>
            <option value="browser-native">SpeechSynthesis Nativo (Instantâneo - Resposta imediata sem rede)</option>
          </select>

          <div className="mt-2">
            <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Instruções Absolutas do Narrador
            </label>
            <textarea
              value={audioSettings.ttsInstructions || ''}
              onChange={(e) => onUpdateAudioSettings({ ttsInstructions: e.target.value })}
              placeholder="Ex: Fale pausadamente, adote tom amigável e profissional, leia acrônimos letra por letra."
              rows={2}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Enviadas no topo de cada requisição de narração como regras absolutas.
            </p>
          </div>

          {audioSettings.ttsModel !== 'browser-native' && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Voz Neural Gemini
                </label>
                <select
                  value={audioSettings.ttsVoice}
                  onChange={(e) => onUpdateAudioSettings({ ttsVoice: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 font-mono"
                >
                  {['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Velocidade de Fala
                </label>
                <select
                  value={audioSettings.ttsSpeed || 1.0}
                  onChange={(e) => onUpdateAudioSettings({ ttsSpeed: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
                >
                  <option value="0.75">Lento (0.75x)</option>
                  <option value="1.0">Normal (1.0x)</option>
                  <option value="1.2">Rápido (1.2x)</option>
                  <option value="1.5">Muito Rápido (1.5x)</option>
                </select>
              </div>
            </div>
          )}

          {audioSettings.ttsModel !== 'browser-native' && (
            <div className="text-[10px] bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 p-2.5 rounded-lg flex gap-1.5 leading-normal">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                <strong>Nota sobre Latência:</strong> A voz neural premium da API Gemini gera áudio com entonação humana ultra-realista, mas possui um pequeno tempo de processamento de rede para ser gerado. Se preferir fala imediata (atraso zero), altere o modelo acima para <strong>SpeechSynthesis Nativo</strong>.
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={audioSettings.autoPlayTts}
                onChange={(e) => onUpdateAudioSettings({ autoPlayTts: e.target.checked })}
                className="rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
              />
              <span>Reproduzir narração automaticamente ao concluir respostas</span>
            </label>

            <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={audioSettings.filterCodeInTts}
                onChange={(e) => onUpdateAudioSettings({ filterCodeInTts: e.target.checked })}
                className="rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
              />
              <span>Omitir blocos de código extensos durante a leitura falada</span>
            </label>
          </div>
        </div>
      </div>

      <hr className="border-zinc-200 dark:border-zinc-800" />

      {/* Seção 3: Outras Opções Gráficas */}
      <div className="space-y-3">
        <h5 className="text-xs font-bold uppercase font-mono tracking-wider text-zinc-700 dark:text-zinc-300">
          Opções Gráficas Adicionais
        </h5>
        <div className="p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">Efeitos Visuais e Transições</span>
              <span className="text-[10px] text-zinc-500 block">Controla as animações de mudança de página e carregamento do terminal</span>
            </div>
            <select
              defaultValue="normal"
              className="px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
            >
              <option value="normal">Animações Suaves (Padrão)</option>
              <option value="compact">Reduzido (Para menor uso de CPU)</option>
            </select>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-zinc-200 dark:border-zinc-800">
            <div>
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">Densidade de Informação do Layout</span>
              <span className="text-[10px] text-zinc-500 block">Ajusta o espaçamento interno das listas de arquivos e logs</span>
            </div>
            <select
              defaultValue="comfort"
              className="px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
            >
              <option value="comfort">Confortável (Espaçamento amplo)</option>
              <option value="compact">Compacto (Maximiza espaço em tela)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
