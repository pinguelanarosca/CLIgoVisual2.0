import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  Volume2,
  Sliders,
  Sparkles,
  Play,
  Square,
  Copy,
  Trash2,
  Plus,
  Radio,
  ShieldCheck,
  CheckCircle2,
  Settings2,
  FileText,
  UserCheck,
  Zap,
} from 'lucide-react';
import {
  VoiceDirectorConfig,
  DirectorPreset,
  VoiceAccent,
  VoiceStyle,
  VoiceEmotion,
  VoiceRhythm,
} from '../../services/voice/voiceTypes.js';
import {
  VOICE_DIRECTOR_PRESETS,
  GEMINI_30_VOICES,
} from '../../services/voice/voicePresets.js';
import { compileDirectorPrompt } from '../../services/voice/voiceDirector.js';
import {
  getSavedVoiceAgents,
  createVoiceAgent,
  updateVoiceAgent,
  deleteVoiceAgent,
  duplicateVoiceAgent,
  VoiceAgent,
  getSystemVoiceDefaults,
  saveSystemVoiceDefaults,
} from '../../services/voice/voiceAgentsStore.js';
import { AudioSettings } from '../../types.js';
import {
  generateTtsPreviewAudio,
  playAudioFromBase64,
  stopCurrentAudio,
} from '../../services/voice/voiceEngine.js';

import { AudioOutputVisualizer } from './AudioOutputVisualizer.js';

interface VoiceCDJStudioProps {
  audioSettings: AudioSettings;
  onUpdateAudioSettings: (updates: Partial<AudioSettings>) => void;
}

export const VoiceCDJStudio: React.FC<VoiceCDJStudioProps> = ({
  audioSettings,
  onUpdateAudioSettings,
}) => {
  // Configuração Ativa da Mesa CDJ
  const [deckConfig, setDeckConfig] = useState<VoiceDirectorConfig>({
    voiceId: 'Kore',
    baseGeminiVoice: 'Kore',
    model: 'gemini-2.5-flash',
    language: 'pt-BR',
    style: 'Conversacional',
    emotion: 'Amigável',
    tone: 'Acolhedor',
    rhythm: 'Fluído/Natural',
    expressiveness: 'Moderado',
    accent: 'Neutro/Sudoeste (BR)',
    pauseStyle: 'Naturais',
    pitch: 0,
    volume: 100,
    speed: audioSettings.ttsSpeed || 1.0,
    customInstructions: audioSettings.ttsInstructions || '',
  });

  // Texto de Prévia
  const [sampleText, setSampleText] = useState<string>(
    'Olá! Este é o estúdio de direção vocal Gemini. Teste e personalize a entonação, o ritmo e o tom da minha voz!'
  );

  // Estado da Reprodução de Áudio
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [activeAudioBase64, setActiveAudioBase64] = useState<string | null>(null);

  // Agentes de Voz Salvos
  const [agents, setAgents] = useState<VoiceAgent[]>([]);

  // Modal de Criação/Edição Completa de Agente de Voz
  const [showSaveAgentModal, setShowSaveAgentModal] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentNameInput, setAgentNameInput] = useState('');
  const [agentDescInput, setAgentDescInput] = useState('');
  const [agentTypeInput, setAgentTypeInput] = useState<'narrator' | 'transcriber' | 'hybrid'>('narrator');
  const [editingModel, setEditingModel] = useState<string>('gemini-2.5-flash');
  const [editingVoice, setEditingVoice] = useState<string>('Kore');
  const [editingStyle, setEditingStyle] = useState<string>('Conversacional');
  const [editingEmotion, setEditingEmotion] = useState<string>('Amigável');
  const [editingSpeed, setEditingSpeed] = useState<number>(1.0);
  const [editingPrompt, setEditingPrompt] = useState<string>('');
  const [editingSttInstructions, setEditingSttInstructions] = useState<string>('');

  // Prompt compilado dinâmico
  const [editedPrompt, setEditedPrompt] = useState<string>('');

  // Estado de teste de conexão para agentes de voz
  const [testingAgentId, setTestingAgentId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [testErrorModal, setTestErrorModal] = useState<{ agentName: string; error: string } | null>(null);

  const handleTestVoiceAgent = async (agent: VoiceAgent) => {
    setTestingAgentId(agent.id);
    setTestResults((prev) => {
      const updated = { ...prev };
      delete updated[agent.id];
      return updated;
    });

    const isNarratorOrHybrid = agent.type === 'narrator' || agent.type === 'hybrid';
    const testType = isNarratorOrHybrid ? 'voice' : 'programming';

    try {
      const res = await fetch('/api/agents/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: agent.config.model || 'gemini-2.5-flash',
          type: testType,
          voiceName: agent.config.baseGeminiVoice || 'Kore',
          customInstructions: isNarratorOrHybrid ? agent.directorPrompt : agent.sttInstructions,
        }),
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [agent.id]: { success: data.success, message: data.message },
      }));

      if (!data.success) {
        setTestErrorModal({
          agentName: agent.name,
          error: data.message || 'Falha de requisição desconhecida.',
        });
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      setTestResults((prev) => ({
        ...prev,
        [agent.id]: { success: false, message: errMsg },
      }));
      setTestErrorModal({
        agentName: agent.name,
        error: `Falha ao tentar conectar com o servidor: ${errMsg}`,
      });
    } finally {
      setTestingAgentId(null);
    }
  };

  useEffect(() => {
    const compiled = compileDirectorPrompt(deckConfig);
    setEditedPrompt(compiled);
  }, [deckConfig]);

  // Carregar agentes na montagem
  useEffect(() => {
    const loaded = getSavedVoiceAgents();
    setAgents(loaded);
  }, []);

  const refreshAgents = () => {
    setAgents(getSavedVoiceAgents());
  };

  // Aplicar Preset na Mesa
  const handleApplyPreset = (preset: DirectorPreset) => {
    setDeckConfig((prev) => ({
      ...prev,
      ...preset.config,
      presetName: preset.name,
    }));
  };

  // Trocar Voz
  const handleSelectVoice = (voiceId: string) => {
    const found = GEMINI_30_VOICES.find((v) => v.id === voiceId);
    if (found) {
      setDeckConfig((prev) => ({
        ...prev,
        voiceId: found.id,
        baseGeminiVoice: found.baseGeminiVoice,
        accent: (found.accent as VoiceAccent) || prev.accent,
      }));
    }
  };

  // Reproduzir Prévia
  const handlePlayPreview = async () => {
    stopCurrentAudio();
    setIsBuffering(true);
    setIsPlaying(false);

    const result = await generateTtsPreviewAudio(
      sampleText,
      deckConfig,
      audioSettings.audioApiKey,
      audioSettings.audioApiUrl,
      editedPrompt
    );

    setIsBuffering(false);

    if (result.audioBase64) {
      setActiveAudioBase64(result.audioBase64);
      setIsPlaying(true);
      playAudioFromBase64(
        result.audioBase64,
        deckConfig.speed,
        deckConfig.volume,
        () => setIsPlaying(false),
        () => setIsPlaying(false)
      );
    } else {
      setIsPlaying(false);
    }
  };

  const handleStopAudio = () => {
    stopCurrentAudio();
    setIsPlaying(false);
  };

  // ABRIR MODAL PARA CRIAR NOVO AGENTE
  const handleOpenCreateModal = () => {
    setEditingAgentId(null);
    setAgentNameInput('');
    setAgentDescInput('');
    setAgentTypeInput('narrator');
    setEditingModel('gemini-2.5-flash');
    setEditingVoice(deckConfig.baseGeminiVoice || 'Kore');
    setEditingStyle(deckConfig.style || 'Conversacional');
    setEditingEmotion(deckConfig.emotion || 'Amigável');
    setEditingSpeed(deckConfig.speed || 1.0);
    setEditingPrompt(editedPrompt);
    setEditingSttInstructions(audioSettings.sttInstructions || '');
    setShowSaveAgentModal(true);
  };

  // ABRIR MODAL PARA EDITAR AGENTE EXISTENTE
  const handleEditAgent = (agent: VoiceAgent) => {
    setEditingAgentId(agent.id);
    setAgentNameInput(agent.name);
    setAgentDescInput(agent.description);
    setAgentTypeInput(agent.type || 'narrator');
    setEditingModel(agent.config.model || 'gemini-2.5-flash');
    setEditingVoice(agent.config.baseGeminiVoice || 'Kore');
    setEditingStyle(agent.config.style || 'Conversacional');
    setEditingEmotion(agent.config.emotion || 'Amigável');
    setEditingSpeed(agent.config.speed || 1.0);
    setEditingPrompt(agent.directorPrompt || compileDirectorPrompt(agent.config));
    setEditingSttInstructions(agent.sttInstructions || '');
    setShowSaveAgentModal(true);
  };

  // SALVAR OU ATUALIZAR AGENTE DE VOZ COM TODOS OS PARÂMETROS
  const handleSaveCurrentAsAgent = () => {
    if (!agentNameInput.trim()) return;

    const updatedConfig: VoiceDirectorConfig = {
      ...deckConfig,
      baseGeminiVoice: editingVoice as any,
      voiceId: editingVoice,
      model: editingModel,
      style: editingStyle as any,
      emotion: editingEmotion as any,
      speed: editingSpeed,
    };

    if (editingAgentId) {
      updateVoiceAgent(editingAgentId, {
        name: agentNameInput.trim(),
        description: agentDescInput.trim(),
        type: agentTypeInput,
        config: updatedConfig,
        directorPrompt: editingPrompt,
        sttInstructions: editingSttInstructions,
      });
    } else {
      const newAgent = createVoiceAgent(
        agentNameInput.trim(),
        agentDescInput.trim(),
        updatedConfig,
        editingSttInstructions,
        agentTypeInput,
        editingPrompt
      );

      if (agentTypeInput === 'narrator') {
        onUpdateAudioSettings({
          activeTtsAgentId: newAgent.id,
          ttsVoice: newAgent.config.baseGeminiVoice,
          ttsInstructions: newAgent.directorPrompt,
        });
      } else if (agentTypeInput === 'transcriber') {
        onUpdateAudioSettings({
          activeSttAgentId: newAgent.id,
          sttInstructions: newAgent.sttInstructions,
        });
      }
    }

    refreshAgents();
    setShowSaveAgentModal(false);
    setEditingAgentId(null);
  };

  // CARREGAR PARÂMETROS DO AGENTE PARA A MESA CDJ
  const handleLoadAgentToDeck = (agent: VoiceAgent) => {
    setDeckConfig(agent.config);
    if (agent.directorPrompt) {
      setEditedPrompt(agent.directorPrompt);
    }
  };

  const handleDeleteAgentItem = (agentId: string) => {
    deleteVoiceAgent(agentId);
    refreshAgents();
  };

  const handleDuplicateAgentItem = (agentId: string) => {
    duplicateVoiceAgent(agentId);
    refreshAgents();
  };

  // Filtragem estrita de Agentes Narradores (TTS) vs Transcritores (STT)
  const ttsAgents = agents.filter(
    (a) => a.type === 'narrator' || a.type === 'hybrid' || a.config.model?.includes('flash')
  );
  const sttAgents = agents.filter(
    (a) => a.type === 'transcriber' || a.type === 'hybrid' || true
  );

  const activeTtsAgentId = audioSettings.activeTtsAgentId || (ttsAgents[0]?.id || '');
  const backupTtsAgentId = audioSettings.backupTtsAgentId || (ttsAgents[1]?.id || ttsAgents[0]?.id || '');

  const activeSttAgentId = audioSettings.activeSttAgentId || (sttAgents[0]?.id || '');
  const backupSttAgentId = audioSettings.backupSttAgentId || (sttAgents[1]?.id || sttAgents[0]?.id || '');

  return (
    <div className="space-y-6 max-w-5xl">
      {/* PAINEL SUPERIOR DEDICADO: SELEÇÃO DE AGENTE TRANSCRITOR (STT) E NARRADOR (TTS) */}
      <div className="p-4 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 space-y-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Painel de Atribuição de Agentes de Voz Ativos (STT & TTS)
            </h3>
            <p className="text-xs text-zinc-500">
              Escolha quais Agentes de Voz criados no estúdio serão responsáveis pela Transcrição (Ditado) e pela Narração (Texto para Fala).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* SELEÇÃO DO TRANSCRITOR (STT) */}
          <div className="p-3.5 rounded-xl border border-blue-300/80 dark:border-blue-800/80 bg-white dark:bg-zinc-900 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  Agente Transcritor (STT - Ditado)
                </span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold">
                Agente de Entrada
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-zinc-500">Agente Atribuído (Titular):</label>
              <select
                value={activeSttAgentId}
                onChange={(e) => onUpdateAudioSettings({ activeSttAgentId: e.target.value })}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-blue-400 dark:border-blue-700 rounded-lg py-1.5 px-2 text-xs font-bold text-blue-700 dark:text-blue-300 outline-none cursor-pointer"
              >
                {sttAgents.length > 0 ? (
                  sttAgents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      🎤 {ag.name} ({ag.config.baseGeminiVoice})
                    </option>
                  ))
                ) : (
                  <option value="default_stt">🎤 Transcritor Padrão</option>
                )}
              </select>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="block text-[10px] font-bold text-zinc-500">Agente Reserva (Auto-Fallback):</label>
              <select
                value={backupSttAgentId}
                onChange={(e) => onUpdateAudioSettings({ backupSttAgentId: e.target.value })}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-amber-300 dark:border-amber-800 rounded-lg py-1.5 px-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 outline-none cursor-pointer"
              >
                {sttAgents.length > 0 ? (
                  sttAgents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      🛡️ {ag.name} ({ag.config.baseGeminiVoice})
                    </option>
                  ))
                ) : (
                  <option value="backup_stt">🛡️ Transcritor Reserva</option>
                )}
              </select>
            </div>
          </div>

          {/* SELEÇÃO DO NARRADOR (TTS) */}
          <div className="p-3.5 rounded-xl border border-emerald-300/80 dark:border-emerald-800/80 bg-white dark:bg-zinc-900 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  Agente Narrador (TTS - Leitura)
                </span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold">
                Agente de Saída
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-zinc-500">Agente Atribuído (Titular):</label>
              <select
                value={activeTtsAgentId}
                onChange={(e) => onUpdateAudioSettings({ activeTtsAgentId: e.target.value })}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-emerald-400 dark:border-emerald-700 rounded-lg py-1.5 px-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 outline-none cursor-pointer"
              >
                {ttsAgents.length > 0 ? (
                  ttsAgents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      🎭 {ag.name} ({ag.config.baseGeminiVoice})
                    </option>
                  ))
                ) : (
                  <option value="default_tts">🎭 Narrador Padrão (Kore)</option>
                )}
              </select>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="block text-[10px] font-bold text-zinc-500">Agente Reserva (Auto-Fallback):</label>
              <select
                value={backupTtsAgentId}
                onChange={(e) => onUpdateAudioSettings({ backupTtsAgentId: e.target.value })}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-amber-300 dark:border-amber-800 rounded-lg py-1.5 px-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 outline-none cursor-pointer"
              >
                {ttsAgents.length > 0 ? (
                  ttsAgents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      🛡️ {ag.name} ({ag.config.baseGeminiVoice})
                    </option>
                  ))
                ) : (
                  <option value="backup_tts">🛡️ Narrador Reserva (Puck)</option>
                )}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* CABEÇALHO DO ESTÚDIO CDJ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-emerald-500" />
            Estúdio CDJ de Direção Vocal & Agentes de Voz
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Ajuste a entonação, a emoção e o tom vocal para criar novos agentes ou editar os existentes.
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-md"
        >
          <Plus className="w-4 h-4" />
          <span>Criar Novo Agente de Voz</span>
        </button>
      </div>

      {/* PRESETS DE DIREÇÃO VOCAL (QUICK PRESETS) */}
      <div className="space-y-2">
        <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300">
          Presets Rápidos de Direção Vocal (Mesa CDJ)
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {VOICE_DIRECTOR_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleApplyPreset(p)}
              className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                deckConfig.presetName === p.name
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100 font-bold'
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700'
              }`}
            >
              <span className="text-xs">{p.name}</span>
              <span className="text-[10px] text-zinc-500 font-normal mt-1">{p.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* MESA CDJ: KNOBS E PARÂMETROS VOCAIS */}
      <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* VOZ BASE GEMINI */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300">
              Voz Base Gemini
            </label>
            <select
              value={deckConfig.baseGeminiVoice}
              onChange={(e) => handleSelectVoice(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl py-2 px-3 text-xs font-bold text-zinc-900 dark:text-zinc-100 outline-none"
            >
              {GEMINI_30_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.gender})
                </option>
              ))}
            </select>
          </div>

          {/* ESTILO VOCAL */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300">
              Estilo Vocal
            </label>
            <select
              value={deckConfig.style}
              onChange={(e) => setDeckConfig((prev) => ({ ...prev, style: e.target.value as any }))}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl py-2 px-3 text-xs font-bold text-zinc-900 dark:text-zinc-100 outline-none"
            >
              {['Conversacional', 'Jornalístico/Noticioso', 'Narrativo/Podcasting', 'Corporativo', 'Publicitário'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* EMOÇÃO DOMINANTE */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300">
              Emoção Dominante
            </label>
            <select
              value={deckConfig.emotion}
              onChange={(e) => setDeckConfig((prev) => ({ ...prev, emotion: e.target.value as any }))}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl py-2 px-3 text-xs font-bold text-zinc-900 dark:text-zinc-100 outline-none"
            >
              {['Amigável', 'Neutro', 'Alegre', 'Calmo', 'Dramático', 'Urgente', 'Entusiasmado', 'Reflexivo'].map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* VELOCIDADE E PRÉVIA */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 shrink-0">
              Velocidade: {deckConfig.speed}x
            </label>
            <input
              type="range"
              min="0.75"
              max="1.5"
              step="0.05"
              value={deckConfig.speed}
              onChange={(e) => setDeckConfig((prev) => ({ ...prev, speed: parseFloat(e.target.value) }))}
              className="w-32 accent-emerald-500 cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-2">
            {!isPlaying ? (
              <button
                onClick={handlePlayPreview}
                disabled={isBuffering}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-sm disabled:opacity-50"
              >
                <Play className={`w-3.5 h-3.5 ${isBuffering ? 'animate-spin' : ''}`} />
                <span>{isBuffering ? 'Sintetizando Voz...' : 'Ouvir Prévia no CDJ'}</span>
              </button>
            ) : (
              <button
                onClick={handleStopAudio}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-sm"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Parar Áudio</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* BIBLIOTECA DE AGENTES DE VOZ CADASTRADOS */}
      <div className="space-y-3">
        <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center justify-between">
          <span>Biblioteca de Agentes de Voz ({agents.length})</span>
          <span className="text-xs font-normal text-zinc-500">
            Clique em "Editar" para modificar parâmetros ou "Carregar Deck" para testar ao vivo.
          </span>
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {agents.map((ag) => (
            <div
              key={ag.id}
              className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs flex flex-col justify-between space-y-3"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                    {ag.name}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold">
                    {ag.config.baseGeminiVoice}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 line-clamp-2 leading-relaxed">
                  {ag.description || 'Sem descrição cadastrada.'}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
                  <span>Modelo: {ag.config.model || 'gemini-2.5-flash'}</span>
                  <span>•</span>
                  <span>{ag.config.speed}x</span>
                </div>
              </div>

              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleEditAgent(ag)}
                    className="px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-[10px] font-bold transition cursor-pointer"
                  >
                    Editar Agente
                  </button>
                  <button
                    onClick={() => handleLoadAgentToDeck(ag)}
                    className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-zinc-800 dark:text-zinc-200 text-[10px] font-bold transition cursor-pointer"
                    title="Carregar parâmetros deste agente na Mesa de Som CDJ"
                  >
                    Carregar Deck
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleDuplicateAgentItem(ag.id)}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition cursor-pointer"
                    title="Duplicar Agente"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteAgentItem(ag.id)}
                    className="p-1 rounded text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                    title="Excluir Agente"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Botão de Teste Único */}
              <div className="pt-1.5 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between gap-1">
                <button
                  type="button"
                  disabled={testingAgentId !== null}
                  onClick={() => handleTestVoiceAgent(ag)}
                  className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold cursor-pointer transition flex items-center gap-1 disabled:opacity-50"
                >
                  {testingAgentId === ag.id ? 'Testando...' : 'Testar Agente'}
                </button>
                {testResults[ag.id] && (
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      testResults[ag.id].success
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                    }`}
                    title={testResults[ag.id].message}
                  >
                    {testResults[ag.id].success ? '✅ Conectado' : '❌ Falhou'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MODAL COMPLETO DE CRIAÇÃO / EDIÇÃO DE AGENTE DE VOZ */}
      {showSaveAgentModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 max-w-lg w-full space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-500" />
                <span>{editingAgentId ? 'Editar Agente de Voz Completo' : 'Criar Novo Agente de Voz'}</span>
              </h4>
            </div>

            <div className="space-y-3 text-xs">
              {/* NOME E TIPO */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                    Nome do Agente *
                  </label>
                  <input
                    type="text"
                    value={agentNameInput}
                    onChange={(e) => setAgentNameInput(e.target.value)}
                    placeholder="Ex: Narrador Solene Padrão"
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-bold text-zinc-900 dark:text-zinc-100 outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                    Especialidade do Agente
                  </label>
                  <select
                    value={agentTypeInput}
                    onChange={(e) => setAgentTypeInput(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-bold text-blue-600 dark:text-blue-400 outline-none cursor-pointer"
                  >
                    <option value="narrator">Narrador (TTS - Leitura)</option>
                    <option value="transcriber">Transcritor (STT - Ditado)</option>
                    <option value="hybrid">Híbrido (STT & TTS)</option>
                  </select>
                </div>
              </div>

              {/* MODELO BASE E VOZ BASE */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                    Modelo Base do Backend
                  </label>
                  <select
                    value={editingModel}
                    onChange={(e) => setEditingModel(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-bold text-emerald-600 dark:text-emerald-400 outline-none cursor-pointer"
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Oficial Multimodal TTS & STT)</option>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash (Secundário de Áudio)</option>
                    <option value="gemini-3.5-flash">Gemini 3.5 Flash (Transcrição Multimodal Longa)</option>
                    <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (STT Rápido)</option>
                    <option value="browser-native">SpeechSynthesis / Web Speech Nativa (Local)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                    Voz Base Gemini
                  </label>
                  <select
                    value={editingVoice}
                    onChange={(e) => setEditingVoice(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-bold text-zinc-900 dark:text-zinc-100 outline-none cursor-pointer"
                  >
                    {GEMINI_30_VOICES.map((v) => (
                      <option key={v.id} value={v.baseGeminiVoice}>
                        {v.name} ({v.gender})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ESTILO E EMOÇÃO */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                    Estilo Vocal
                  </label>
                  <select
                    value={editingStyle}
                    onChange={(e) => setEditingStyle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-semibold text-zinc-800 dark:text-zinc-200 outline-none"
                  >
                    {['Conversacional', 'Jornalístico/Noticioso', 'Narrativo/Podcasting', 'Corporativo', 'Publicitário'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                    Emoção
                  </label>
                  <select
                    value={editingEmotion}
                    onChange={(e) => setEditingEmotion(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-semibold text-zinc-800 dark:text-zinc-200 outline-none"
                  >
                    {['Amigável', 'Neutro', 'Alegre', 'Calmo', 'Dramático', 'Urgente', 'Entusiasmado', 'Reflexivo'].map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* VELOCIDADE */}
              <div>
                <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                  Velocidade da Narração: {editingSpeed}x
                </label>
                <input
                  type="range"
                  min="0.75"
                  max="1.5"
                  step="0.05"
                  value={editingSpeed}
                  onChange={(e) => setEditingSpeed(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              {/* DESCRIÇÃO */}
              <div>
                <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                  Descrição do Agente
                </label>
                <textarea
                  value={agentDescInput}
                  onChange={(e) => setAgentDescInput(e.target.value)}
                  rows={2}
                  placeholder="Ex: Voz institucional formal para apresentações executivas."
                  className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 outline-none"
                />
              </div>

              {/* INSTRUÇÕES DO NARRADOR (PROMPT DO DIRETOR) */}
              <div>
                <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                  Instruções do Diretor Vocal (Prompt de Narração TTS)
                </label>
                <textarea
                  value={editingPrompt}
                  onChange={(e) => setEditingPrompt(e.target.value)}
                  rows={3}
                  placeholder="[REGRAS DE NARRAÇÃO]: Fale pausadamente, enfatize os termos técnicos..."
                  className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-[11px] outline-none"
                />
              </div>

              {/* INSTRUÇÕES DO TRANSCRITOR (STT) */}
              <div>
                <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                  Instruções Específicas do Transcritor (STT)
                </label>
                <textarea
                  value={editingSttInstructions}
                  onChange={(e) => setEditingSttInstructions(e.target.value)}
                  rows={2}
                  placeholder="[REGRAS DE TRANSCRIÇÃO]: Ignore gagueiras, formate pontuação automaticamente..."
                  className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-[11px] outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => {
                  setShowSaveAgentModal(false);
                  setEditingAgentId(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveCurrentAsAgent}
                disabled={!agentNameInput.trim()}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer shadow-md"
              >
                {editingAgentId ? 'Salvar Alterações do Agente' : 'Confirmar & Criar Agente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Overlay para Notificação de Falha de Conexão Vocal */}
      {testErrorModal && (
        <div className="fixed inset-0 bg-black/65 flex items-center justify-center p-4 z-55 animate-fade-in backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 shrink-0">
                <Mic className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Falha no Teste do Agente de Voz
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  A requisição de verificação única de voz para o agente de voz <strong>{testErrorModal.agentName}</strong> falhou.
                </p>
              </div>
            </div>

            <div className="p-3 bg-rose-50/50 dark:bg-rose-950/15 border border-rose-100 dark:border-rose-900/40 rounded-xl max-h-48 overflow-y-auto text-[11px] font-mono text-rose-700 dark:text-rose-300 whitespace-pre-wrap leading-relaxed">
              {testErrorModal.error}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setTestErrorModal(null)}
                className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold hover:opacity-90 cursor-pointer transition shadow-sm"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
