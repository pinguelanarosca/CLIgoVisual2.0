import React, { useState, useEffect } from 'react';
import { Volume2, Mic, Check, Cpu, Sparkles, Sliders, ShieldCheck, UserCheck } from 'lucide-react';
import { AudioSettings } from '../../types.js';
import { getSavedVoiceAgents, VoiceAgent } from '../../services/voice/voiceAgentsStore.js';

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
  const [savedAgents, setSavedAgents] = useState<VoiceAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(audioSettings.activeTtsAgentId || 'agent_narrador_oficial');

  useEffect(() => {
    const agents = getSavedVoiceAgents();
    setSavedAgents(agents);
  }, []);

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    const target = savedAgents.find((a) => a.id === agentId);
    if (target) {
      onUpdateAudioSettings({
        activeTtsAgentId: target.id,
        ttsVoice: target.config.baseGeminiVoice || 'Kore',
        ttsModel: target.config.model || 'gemini-3.1-flash-tts',
        ttsSpeed: target.config.speed || 1.0,
        ttsInstructions: target.directorPrompt || '',
        sttInstructions: target.sttInstructions || '',
      });
    }
  };

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

      {/* Seção 2: Configuração Geral do Agente de Voz */}
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-500" />
            Configuração do Agente de Voz & Perfil de Fala
          </h4>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
            As opções abaixo configuram as regras, modelos e diretrizes do <strong>Perfil do Agente de Voz</strong>.
            Selecione o agente em edição para customizar sua síntese e transcrição.
          </p>
        </div>

        {/* Seleção do Perfil / Agente de Voz em Edição */}
        <div className="p-4 bg-gradient-to-r from-emerald-500/10 via-blue-500/5 to-transparent dark:from-emerald-950/30 dark:via-blue-950/10 dark:to-transparent rounded-2xl border border-emerald-500/20 dark:border-emerald-500/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-500" />
              <label className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                Perfil / Agente de Voz Ativo
              </label>
            </div>
            <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold">
              Geração de Agente
            </span>
          </div>
          <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
            Escolha qual perfil de voz você está configurando no estúdio. As alterações de modelo e regras aplicam-se a este perfil.
          </p>

          <select
            value={selectedAgentId}
            onChange={(e) => handleSelectAgent(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-emerald-500/30 text-xs font-semibold text-zinc-900 dark:text-zinc-100 shadow-xs outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            {savedAgents.map((ag) => (
              <option key={ag.id} value={ag.id}>
                🎭 {ag.name} — [{ag.config.baseGeminiVoice || 'Kore'}] ({ag.description || 'Perfil de Voz'})
              </option>
            ))}
          </select>
        </div>

        {/* CARD DUPLO INFORMATIVO (ESTILO CATÁLOGO DE MODELOS) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* CARD 1: AGENTE NARRADOR (TTS) */}
          <div className="p-4 rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 via-zinc-50 to-white dark:from-emerald-950/20 dark:via-zinc-900 dark:to-zinc-900 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                  <Volume2 className="w-4 h-4" />
                </div>
                <div>
                  <h5 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    Agente Narrador (TTS)
                  </h5>
                  <span className="text-[10px] text-zinc-500 block">Texto &rarr; Fala Neural</span>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold">
                Saída por Voz
              </span>
            </div>

            <div className="space-y-1.5 text-[11px] pt-1">
              <div className="flex items-center justify-between text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500">Modelo Selecionado:</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {audioSettings.ttsModel}
                </span>
              </div>
              <div className="flex items-center justify-between text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500">Voz e Velocidade:</span>
                <span className="font-mono font-medium">
                  {audioSettings.ttsVoice} ({audioSettings.ttsSpeed || 1.0}x)
                </span>
              </div>
              <div className="text-[10px] text-zinc-500 pt-1.5 border-t border-zinc-200/60 dark:border-zinc-800">
                <strong className="text-zinc-700 dark:text-zinc-300 block mb-0.5">Linha de Fallback (TTS):</strong>
                <div className="font-mono text-[9.5px] text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/80 p-2 rounded-lg leading-relaxed">
                  1. gemini-3.1-flash-tts (Principal)<br />
                  2. gemini-3.5-flash-tts (Backup)<br />
                  3. SpeechSynthesis Nativo (Local)
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 p-2 rounded-xl">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Suporte nativo a voz humana ultra-realista e diretrizes do diretor.</span>
            </div>
          </div>

          {/* CARD 2: AGENTE TRANSCRITOR (STT) */}
          <div className="p-4 rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/5 via-zinc-50 to-white dark:from-blue-950/20 dark:via-zinc-900 dark:to-zinc-900 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
                  <Mic className="w-4 h-4" />
                </div>
                <div>
                  <h5 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    Agente Transcritor (STT)
                  </h5>
                  <span className="text-[10px] text-zinc-500 block">Fala &rarr; Texto Multimodal</span>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold">
                Entrada Multimodal
              </span>
            </div>

            <div className="space-y-1.5 text-[11px] pt-1">
              <div className="flex items-center justify-between text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500">Modelo Selecionado:</span>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                  {audioSettings.sttModel}
                </span>
              </div>
              <div className="flex items-center justify-between text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500">Auto-envio ao gravar:</span>
                <span className="font-mono font-medium">
                  {audioSettings.autoSendVoicePrompt ? 'Ativado (Automático)' : 'Manual'}
                </span>
              </div>
              <div className="text-[10px] text-zinc-500 pt-1.5 border-t border-zinc-200/60 dark:border-zinc-800">
                <strong className="text-zinc-700 dark:text-zinc-300 block mb-0.5">Linha de Fallback (Transcritor):</strong>
                <div className="font-mono text-[9.5px] text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/80 p-2 rounded-lg leading-relaxed">
                  1. gemini-3.1-flash-lite (Principal)<br />
                  2. gemini-3.5-flash-lite (Backup 1)<br />
                  3. gemini-3.5-flash &rarr; gemini-2.5-flash
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-blue-600 dark:text-blue-400 bg-blue-500/10 p-2 rounded-xl">
              <Cpu className="w-3.5 h-3.5 shrink-0" />
              <span>Todos os modelos multimodais Gemini suportam entrada de áudio estática/streaming.</span>
            </div>
          </div>
        </div>

        {/* Narrador (TTS) - Formulário de Configuração do Modelo */}
        <div className="space-y-4 p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200">
              Modelo do Agente Narrador (TTS)
            </label>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
              Síntese de Voz
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">
            Selecione o modelo oficial com suporte nativo a geração de áudio falado.
          </p>

          <select
            value={audioSettings.ttsModel}
            onChange={(e) => onUpdateAudioSettings({ ttsModel: e.target.value })}
            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 font-semibold"
          >
            <option value="gemini-3.1-flash-tts">
              Gemini 3.1 Flash TTS (Modelo Oficial de Síntese Neural Direct Voice — Recomendado)
            </option>
            <option value="gemini-3.5-flash-tts">
              Gemini 3.5 Flash TTS (Modelo Especializado de Narração e Expressividade)
            </option>
            <option value="browser-native">
              SpeechSynthesis Nativo (Execução Local do Navegador - Sem uso de API)
            </option>
          </select>

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
              Diretrizes enviadas no topo de cada requisição de narração para o modelo.
            </p>
          </div>

          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={audioSettings.autoPlayTts}
                onChange={(e) => onUpdateAudioSettings({ autoPlayTts: e.target.checked })}
                className="rounded border-zinc-300 dark:border-zinc-700 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Reproduzir narração automaticamente ao concluir respostas do assistente</span>
            </label>

            <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={audioSettings.filterCodeInTts}
                onChange={(e) => onUpdateAudioSettings({ filterCodeInTts: e.target.checked })}
                className="rounded border-zinc-300 dark:border-zinc-700 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Omitir blocos de código extensos durante a narração falada</span>
            </label>
          </div>
        </div>

        {/* Transcritor (STT) - Formulário de Configuração do Modelo */}
        <div className="space-y-3 p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200">
              Modelo do Agente Transcritor (STT / Entradas por Voz)
            </label>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold">
              Ditado & Transcrição
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">
            Todos os modelos multimodais Gemini aceitam entradas de áudio. Escolha o modelo ideal para seu uso:
          </p>

          <select
            value={audioSettings.sttModel}
            onChange={(e) => onUpdateAudioSettings({ sttModel: e.target.value })}
            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 font-semibold"
          >
            <option value="gemini-3.1-flash-lite">
              Gemini 3.1 Flash Lite (Recomendado — Altíssima Velocidade & Cota Baixa Latência)
            </option>
            <option value="gemini-3.5-flash-lite">
              Gemini 3.5 Flash Lite (Experimental Multimodal)
            </option>
            <option value="gemini-3.5-flash">
              Gemini 3.5 Flash (Forte Raciocínio Multimodal)
            </option>
            <option value="gemini-3.8-flash">
              Gemini 3.8 Flash (Máxima Precisão e Fidelidade)
            </option>
            <option value="gemini-3.6-flash">
              Gemini 3.6 Flash (Alta Densidade)
            </option>
            <option value="gemini-2.5-flash">
              Gemini 2.5 Flash (Padrão Estável - Cota Estendida 1500 req/dia)
            </option>
            <option value="gemini-1.5-flash">
              Gemini 1.5 Flash (Forte Estabilidade - 1500 req/dia)
            </option>
            <option value="browser-native">
              Web Speech API Nativa (Conversão Local no Navegador - Atraso Zero)
            </option>
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
              Enviadas no topo de cada requisição de transcrição para orientar o modelo.
            </p>
          </div>

          <div className="pt-2 border-t border-zinc-200/50 dark:border-zinc-700/50">
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={audioSettings.autoSendVoicePrompt ?? true}
                onChange={(e) => onUpdateAudioSettings({ autoSendVoicePrompt: e.target.checked })}
                className="rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
              />
              <span>Enviar prompt no terminal automaticamente ao concluir a gravação de voz</span>
            </label>
          </div>
        </div>

        {/* Chave de API de Áudio e Endpoint Customizado */}
        <div className="p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80 space-y-3">
          <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">
            Credenciais e Endpoints Customizados de Áudio
          </span>
          <p className="text-[10px] text-zinc-500">
            Caso deseje utilizar uma chave de API ou endpoint de proxy dedicado para áudio.
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
      </div>
    </div>
  );
};
