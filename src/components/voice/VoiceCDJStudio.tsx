import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  Volume2,
  Sliders,
  Sparkles,
  Plus,
  Trash2,
  Copy,
  Download,
  Upload,
  CheckCircle2,
  Play,
  Square,
  Radio,
  BookOpen,
  Film,
  Zap,
  Newspaper,
  GraduationCap,
  Feather,
  Flame,
  Ghost,
  Wifi,
  Smile,
  Pause,
  Layers,
  ArrowRightLeft,
  Settings,
  HelpCircle,
  FileText,
  VolumeX,
} from 'lucide-react';

import {
  AudioSettings,
  VoicePreset,
} from '../../types.js';

import {
  VoiceOption,
  VoiceDirectorConfig,
  VoiceAgent,
  DirectorPreset,
  VoiceStyle,
  VoiceEmotion,
  VoiceTone,
  VoiceRhythm,
  VoiceExpressiveness,
  VoiceAccent,
  VoicePauseStyle,
} from '../../services/voice/voiceTypes.js';

import {
  GEMINI_30_VOICES,
  VOICE_DIRECTOR_PRESETS,
  PERFORMANCE_MARKUP_TAGS,
} from '../../services/voice/voicePresets.js';

import {
  compileDirectorPrompt,
  injectMarkupTag,
} from '../../services/voice/voiceDirector.js';

import {
  getSavedVoiceAgents,
  saveVoiceAgents,
  getSystemVoiceDefaults,
  saveSystemVoiceDefaults,
  createVoiceAgent,
  updateVoiceAgent,
  duplicateVoiceAgent,
  deleteVoiceAgent,
  exportVoiceAgentsToJson,
  importVoiceAgentsFromJson,
  setSystemDefaultTtsAgent,
  setSystemDefaultSttAgent,
} from '../../services/voice/voiceAgentsStore.js';

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
  // Active Deck Configuration
  const [deckConfig, setDeckConfig] = useState<VoiceDirectorConfig>({
    voiceId: 'Kore',
    baseGeminiVoice: 'Kore',
    model: audioSettings.ttsModel || 'gemini-3.5-flash-lite',
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

  // Sample text for preview & performance tags
  const [sampleText, setSampleText] = useState<string>(
    'Olá! Este é o estúdio de direção vocal Gemini. [pausa curta] Teste e personalize a entonação, o ritmo e o tom da minha voz!'
  );
  const sampleTextRef = useRef<HTMLTextAreaElement | null>(null);

  // Audio Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [activeAudioBase64, setActiveAudioBase64] = useState<string | null>(null);

  // Saved Voice Agents
  const [agents, setAgents] = useState<VoiceAgent[]>([]);
  const [systemDefaults, setSystemDefaults] = useState(getSystemVoiceDefaults());

  // Agent Creator Modal state
  const [showSaveAgentModal, setShowSaveAgentModal] = useState(false);
  const [agentNameInput, setAgentNameInput] = useState('');
  const [agentDescInput, setAgentDescInput] = useState('');

  // AB Comparison state
  const [abMode, setAbMode] = useState(false);
  const [deckA, setDeckA] = useState<VoiceDirectorConfig | null>(null);
  const [deckB, setDeckB] = useState<VoiceDirectorConfig | null>(null);
  const [activeAbDeck, setActiveAbDeck] = useState<'A' | 'B'>('A');

  // Load saved agents on mount
  useEffect(() => {
    const loaded = getSavedVoiceAgents();
    setAgents(loaded);
  }, []);

  // Update deck config when preset is clicked
  const handleApplyPreset = (preset: DirectorPreset) => {
    setDeckConfig((prev) => ({
      ...prev,
      ...preset.config,
      presetName: preset.name,
    }));
  };

  // Change voice
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

  // Generate & Play Preview Audio
  const handlePlayPreview = async () => {
    stopCurrentAudio();
    setIsBuffering(true);
    setIsPlaying(false);

    const result = await generateTtsPreviewAudio(
      sampleText,
      deckConfig,
      audioSettings.audioApiKey,
      audioSettings.audioApiUrl
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

  const handleStopPreview = () => {
    stopCurrentAudio();
    setIsPlaying(false);
    setIsBuffering(false);
  };

  // Insert Performance Tag into textarea
  const handleInsertTag = (tag: string) => {
    const textarea = sampleTextRef.current;
    if (!textarea) {
      setSampleText((prev) => `${prev} ${tag}`);
      return;
    }
    const start = textarea.selectionStart || sampleText.length;
    const end = textarea.selectionEnd || sampleText.length;
    const { newText, newCursorPos } = injectMarkupTag(sampleText, tag, start, end);
    setSampleText(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 50);
  };

  // Save current CDJ config as a new Voice Agent
  const handleSaveCurrentAsAgent = () => {
    if (!agentNameInput.trim()) return;
    const newAgent = createVoiceAgent(
      agentNameInput.trim(),
      agentDescInput.trim(),
      deckConfig,
      audioSettings.sttInstructions
    );
    setAgents(getSavedVoiceAgents());
    setShowSaveAgentModal(false);
    setAgentNameInput('');
    setAgentDescInput('');

    // Also sync to audioSettings
    onUpdateAudioSettings({
      ttsVoice: newAgent.config.baseGeminiVoice,
      ttsInstructions: newAgent.directorPrompt,
    });
  };

  // Load Voice Agent into CDJ Deck
  const handleLoadAgentToDeck = (agent: VoiceAgent) => {
    setDeckConfig(agent.config);
    if (agent.directorPrompt) {
      onUpdateAudioSettings({
        ttsVoice: agent.config.baseGeminiVoice,
        ttsInstructions: agent.directorPrompt,
      });
    }
  };

  // Assign Agent as Default Narrator (TTS)
  const handleSetDefaultTts = (agent: VoiceAgent) => {
    setSystemDefaultTtsAgent(agent.id);
    setSystemDefaults(getSystemVoiceDefaults());
    setAgents(getSavedVoiceAgents());
    onUpdateAudioSettings({
      ttsVoice: agent.config.baseGeminiVoice,
      ttsInstructions: agent.directorPrompt,
      activeTtsAgentId: agent.id,
    });
  };

  // Assign Agent as Default Transcriber (STT)
  const handleSetDefaultStt = (agent: VoiceAgent) => {
    setSystemDefaultSttAgent(agent.id);
    setSystemDefaults(getSystemVoiceDefaults());
    setAgents(getSavedVoiceAgents());
    onUpdateAudioSettings({
      sttInstructions: agent.sttInstructions || '',
      activeSttAgentId: agent.id,
    });
  };

  // Delete Agent
  const handleDeleteAgentItem = (id: string) => {
    deleteVoiceAgent(id);
    setAgents(getSavedVoiceAgents());
  };

  // Duplicate Agent
  const handleDuplicateAgentItem = (id: string) => {
    duplicateVoiceAgent(id);
    setAgents(getSavedVoiceAgents());
  };

  // Export JSON
  const handleExportAgents = () => {
    const jsonStr = exportVoiceAgentsToJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemini-voice-agents-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import JSON
  const handleImportAgents = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (content) {
        const res = importVoiceAgentsFromJson(content);
        if (res.importedCount > 0) {
          setAgents(getSavedVoiceAgents());
        }
      }
    };
    reader.readAsText(file);
  };

  const compiledPromptPreview = compileDirectorPrompt(deckConfig);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Studio Header & Mode Toggles */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h3 className="text-base font-black text-zinc-900 dark:text-zinc-100 flex items-center gap-2 font-mono">
            <Radio className="w-5 h-5 text-emerald-500 animate-pulse" />
            CDJ ESTÚDIO DE DIREÇÃO VOCAL
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Mesa de modulação e direção de narração neural Gemini de nível de estúdio.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAbMode(!abMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
              abMode
                ? 'bg-blue-600 border-blue-500 text-white shadow-md'
                : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            Comparação A/B {abMode ? 'Ativa' : ''}
          </button>

          <button
            onClick={() => setShowSaveAgentModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Salvar Agente
          </button>
        </div>
      </div>

      {/* Main Studio Deck Visualizer */}
      <AudioOutputVisualizer
        isPlaying={isPlaying}
        isBuffering={isBuffering}
        onPlay={handlePlayPreview}
        onStop={handleStopPreview}
        title={`Voz Ativa: ${deckConfig.voiceId} (${deckConfig.style})`}
        subtitle={`Modelo: ${deckConfig.model} | Tom: ${deckConfig.tone}`}
        volume={deckConfig.volume}
        onVolumeChange={(v) => setDeckConfig((prev) => ({ ...prev, volume: v }))}
        speed={deckConfig.speed}
        onSpeedChange={(s) => {
          setDeckConfig((prev) => ({ ...prev, speed: s }));
          onUpdateAudioSettings({ ttsSpeed: s });
        }}
        pitch={deckConfig.pitch}
        onPitchChange={(p) => setDeckConfig((prev) => ({ ...prev, pitch: p }))}
      />

      {/* Diretor de Voz - Presets Rápidos */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase font-mono tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-500" />
            Diretor de Voz: Presets de Narração
          </h4>
          <span className="text-[10px] text-zinc-500">14 Direções Profissionais</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {VOICE_DIRECTOR_PRESETS.map((preset) => {
            const isSelected = deckConfig.presetName === preset.name;
            return (
              <button
                key={preset.id}
                onClick={() => handleApplyPreset(preset)}
                className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between h-20 cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold shadow-sm'
                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                <div className="text-[11px] font-semibold line-clamp-1">{preset.name}</div>
                <div className="text-[9px] text-zinc-500 line-clamp-2">{preset.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Deck / Controle Principal de Knobs e Seleção */}
      <div className="p-4 bg-zinc-50/50 dark:bg-zinc-900/50 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 space-y-4">
        <h4 className="text-xs font-bold uppercase font-mono tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          <Sliders className="w-4 h-4 text-blue-500" />
          Controle do Deck Principal (30 Vozes & Parâmetros)
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Seleção das 30 Vozes */}
          <div>
            <label className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 mb-1">
              Voz Ativa do Catálogo (30 Opções)
            </label>
            <select
              value={deckConfig.voiceId}
              onChange={(e) => handleSelectVoice(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-900 dark:text-zinc-100 font-mono"
            >
              {GEMINI_30_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.gender} • {v.recommendedStyles[0]})
                </option>
              ))}
            </select>
            <p className="text-[10px] text-zinc-500 mt-1">
              {GEMINI_30_VOICES.find((v) => v.id === deckConfig.voiceId)?.description}
            </p>
          </div>

          {/* Modelo TTS */}
          <div>
            <label className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 mb-1">
              Modelo Neural de Narração (TTS)
            </label>
            <select
              value={deckConfig.model}
              onChange={(e) => {
                setDeckConfig((prev) => ({ ...prev, model: e.target.value }));
                onUpdateAudioSettings({ ttsModel: e.target.value });
              }}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
            >
              <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (Recomendado do Sistema)</option>
              <option value="gemini-3.1-flash-tts">Gemini 3.1 Flash TTS</option>
              <option value="gemini-2.5-flash-tts">Gemini 2.5 Flash TTS</option>
              <option value="browser-native">SpeechSynthesis Nativo Local</option>
            </select>
          </div>

          {/* Idioma */}
          <div>
            <label className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 mb-1">
              Idioma do Narrador
            </label>
            <select
              value={deckConfig.language}
              onChange={(e) => setDeckConfig((prev) => ({ ...prev, language: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
            >
              <option value="pt-BR">Português (Brasil)</option>
              <option value="en-US">Inglês (Estados Unidos)</option>
              <option value="es-ES">Espanhol (Espanha)</option>
              <option value="fr-FR">Francês (França)</option>
              <option value="de-DE">Alemão (Alemanha)</option>
              <option value="it-IT">Italiano (Itália)</option>
              <option value="ja-JP">Japonês (Japão)</option>
            </select>
          </div>
        </div>

        {/* Matrix de Parâmetros Técnicos & Direção Vocal */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-2">
          {/* Estilo */}
          <div>
            <label className="block text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
              Estilo
            </label>
            <select
              value={deckConfig.style}
              onChange={(e) => setDeckConfig((prev) => ({ ...prev, style: e.target.value as VoiceStyle }))}
              className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
            >
              {[
                'Conversacional',
                'Formal',
                'Dramático',
                'Neutro',
                'Épico',
                'Entusiasmado',
                'Calmo',
                'Sensacionalista',
                'Educativo',
                'Íntimo/ASMR',
                'Urgente/Notícias',
              ].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Emoção */}
          <div>
            <label className="block text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
              Emoção
            </label>
            <select
              value={deckConfig.emotion}
              onChange={(e) => setDeckConfig((prev) => ({ ...prev, emotion: e.target.value as VoiceEmotion }))}
              className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
            >
              {[
                'Alegre',
                'Triste',
                'Bravo/Autoritário',
                'Misterioso',
                'Amigável',
                'Sério',
                'Empático',
                'Confiante',
                'Curioso',
                'Irônico/Sarcástico',
                'Neutro',
              ].map((em) => (
                <option key={em} value={em}>
                  {em}
                </option>
              ))}
            </select>
          </div>

          {/* Tom / Atitude */}
          <div>
            <label className="block text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
              Tom / Atitude
            </label>
            <select
              value={deckConfig.tone}
              onChange={(e) => setDeckConfig((prev) => ({ ...prev, tone: e.target.value as VoiceTone }))}
              className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
            >
              {['Grave', 'Médio', 'Agudo', 'Acolhedor', 'Impositivo', 'Provocativo', 'Corporativo', 'Suave'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Ritmo / Cadência */}
          <div>
            <label className="block text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
              Ritmo / Cadência
            </label>
            <select
              value={deckConfig.rhythm}
              onChange={(e) => setDeckConfig((prev) => ({ ...prev, rhythm: e.target.value as VoiceRhythm }))}
              className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
            >
              {[
                'Pausado/Lento',
                'Fluído/Natural',
                'Acelerado/Dinâmico',
                'Poético',
                'Rítmico',
                'Telejornalístico',
              ].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Intensidade */}
          <div>
            <label className="block text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
              Expressividade
            </label>
            <select
              value={deckConfig.expressiveness}
              onChange={(e) =>
                setDeckConfig((prev) => ({ ...prev, expressiveness: e.target.value as VoiceExpressiveness }))
              }
              className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
            >
              {['Sutil', 'Moderado', 'Intenso', 'Exagerado'].map((ex) => (
                <option key={ex} value={ex}>
                  {ex}
                </option>
              ))}
            </select>
          </div>

          {/* Sotaque */}
          <div>
            <label className="block text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
              Sotaque Regional
            </label>
            <select
              value={deckConfig.accent}
              onChange={(e) => setDeckConfig((prev) => ({ ...prev, accent: e.target.value as VoiceAccent }))}
              className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
            >
              {[
                'Neutro/Sudoeste (BR)',
                'Nordestino (BR)',
                'Sulista (BR)',
                'Carioca (BR)',
                'Português (PT)',
                'Americano (US)',
                'Britânico (UK)',
                'Espanhol (ES)',
              ].map((ac) => (
                <option key={ac} value={ac}>
                  {ac}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Editor de Texto de Amostra & Tags de Performance Localizada */}
      <div className="p-4 bg-zinc-50/50 dark:bg-zinc-900/50 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-bold uppercase font-mono tracking-wider text-zinc-700 dark:text-zinc-300">
            Editor de Amostra & Tags de Performance Localizada
          </label>
          <span className="text-[10px] text-zinc-500">Clique para inserir marcações no texto</span>
        </div>

        {/* Chips de Tags */}
        <div className="flex flex-wrap gap-1.5">
          {PERFORMANCE_MARKUP_TAGS.map((t) => (
            <button
              key={t.label}
              onClick={() => handleInsertTag(t.tag)}
              title={t.desc}
              className="px-2.5 py-1 rounded-lg bg-zinc-200/80 dark:bg-zinc-800 hover:bg-emerald-500/20 hover:text-emerald-600 dark:hover:text-emerald-400 text-zinc-800 dark:text-zinc-200 text-[10px] font-mono font-bold transition cursor-pointer"
            >
              + {t.label}
            </button>
          ))}
        </div>

        <textarea
          ref={sampleTextRef}
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          rows={3}
          placeholder="Digite ou cole o texto para testar a narração com as tags [pausa curta], [sussurrando], etc."
          className="w-full p-3 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 font-sans focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        />

        {/* Visualização Transparente do Director Prompt Compilado */}
        <div className="p-3 bg-zinc-900 text-zinc-300 rounded-xl border border-zinc-800 font-mono text-[10px] leading-relaxed space-y-1">
          <div className="text-zinc-400 font-bold flex items-center justify-between">
            <span>PROMPT DO DIRETOR GEMINI COMPILADO (TRANSPARÊNCIA TOTAL API):</span>
            <span className="text-emerald-400">STATUS: REGRA ABSOLUTA</span>
          </div>
          <pre className="whitespace-pre-wrap text-zinc-300 font-mono text-[10px]">
            {compiledPromptPreview}
          </pre>
        </div>
      </div>

      {/* Biblioteca de Agentes de Voz Personalizados */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-500" />
              Biblioteca de Agentes de Voz
            </h4>
            <p className="text-xs text-zinc-500 mt-0.5">
              Agentes configurados para atuar como o Narrador Padrão do Sistema (TTS) ou Transcritor (STT).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportAgents}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> Exportar JSON
            </button>
            <label className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold transition cursor-pointer">
              <Upload className="w-3.5 h-3.5" /> Importar JSON
              <input type="file" accept=".json" onChange={handleImportAgents} className="hidden" />
            </label>
          </div>
        </div>

        {/* Cards de Agentes */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {agents.map((agent) => {
            const isSystemTts = systemDefaults.ttsAgentId === agent.id || agent.isSystemDefaultTts;
            const isSystemStt = systemDefaults.sttAgentId === agent.id || agent.isSystemDefaultStt;

            return (
              <div
                key={agent.id}
                className={`p-4 rounded-2xl border transition flex flex-col justify-between space-y-3 ${
                  isSystemTts
                    ? 'bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/50 shadow-xs'
                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h5 className="text-xs font-black text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                      {agent.name}
                    </h5>
                    <div className="flex items-center gap-1">
                      {isSystemTts && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                          NARRADOR PADRÃO
                        </span>
                      )}
                      {isSystemStt && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-600 dark:text-blue-400">
                          TRANSCRITOR PADRÃO
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-500 mt-1 line-clamp-2">{agent.description}</p>

                  <div className="mt-3 flex flex-wrap gap-1 text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
                    <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded">
                      Voz: {agent.config.voiceId}
                    </span>
                    <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded">
                      Estilo: {agent.config.style}
                    </span>
                    <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded">
                      Tom: {agent.config.tone}
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleLoadAgentToDeck(agent)}
                      className="px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[10px] font-bold cursor-pointer transition"
                    >
                      Carregar Deck
                    </button>

                    <button
                      onClick={() => handleSetDefaultTts(agent)}
                      disabled={isSystemTts}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer transition ${
                        isSystemTts
                          ? 'bg-emerald-500 text-white cursor-default'
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                      }`}
                    >
                      {isSystemTts ? 'Padrão TTS' : 'Usar no TTS'}
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDuplicateAgentItem(agent.id)}
                      title="Duplicar Agente"
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleDeleteAgentItem(agent.id)}
                      title="Excluir Agente"
                      className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal para Salvar Novo Agente */}
      {showSaveAgentModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-500" />
              Salvar Configuração Atual do CDJ como Agente de Voz
            </h4>
            <p className="text-xs text-zinc-500">
              Transforme seus knobs, estilo e tom selecionados em um perfil reuso permanente na biblioteca.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                  Nome do Agente
                </label>
                <input
                  type="text"
                  value={agentNameInput}
                  onChange={(e) => setAgentNameInput(e.target.value)}
                  placeholder="Ex: Meu Narrador Corporativo"
                  className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                  Descrição do Agente
                </label>
                <textarea
                  value={agentDescInput}
                  onChange={(e) => setAgentDescInput(e.target.value)}
                  rows={2}
                  placeholder="Ex: Voz limpa, pausada e solene para tutoriais e apresentações de clientes."
                  className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowSaveAgentModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveCurrentAsAgent}
                disabled={!agentNameInput.trim()}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer"
              >
                Confirmar & Salvar Agente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
