import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Mic,
  Volume2,
  Sparkles,
  Info,
  RotateCcw,
  CheckCircle2,
  ShieldCheck,
  Radio,
  Bot,
} from 'lucide-react';
import { MODELS_CATALOG } from '../constants/modelsCatalog.js';
import { AgentConfig, AudioSettings } from '../types.js';
import { getSavedVoiceAgents, VoiceAgent } from '../services/voice/voiceAgentsStore.js';

interface ModelCatalogViewProps {
  agents: AgentConfig[];
  selectedAgentId?: string;
  onSelectAgent?: (id: string) => void;
  onResetDefaultAgentsConfig: () => Promise<void>;
  onSaveAgent?: (agent: AgentConfig) => Promise<void>;
  isResetting?: boolean;
  audioSettings?: AudioSettings;
  onUpdateAudioSettings?: (updates: Partial<AudioSettings>) => void;
}

export const ModelCatalogView: React.FC<ModelCatalogViewProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onResetDefaultAgentsConfig,
  onSaveAgent,
  isResetting = false,
  audioSettings,
  onUpdateAudioSettings,
}) => {
  const [activeCategoryTab, setActiveCategoryTab] = useState<string>('all');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [savedAgentId, setSavedAgentId] = useState<string | null>(null);
  const [voiceAgents, setVoiceAgents] = useState<VoiceAgent[]>([]);
  const [testingAgentId, setTestingAgentId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [testErrorModal, setTestErrorModal] = useState<{ agentName: string; error: string } | null>(null);

  useEffect(() => {
    const loaded = getSavedVoiceAgents();
    setVoiceAgents(loaded);
  }, []);

  const handleTestAgent = async (agentId: string, model: string, type: 'programming' | 'voice', voiceName?: string, customInstructions?: string) => {
    setTestingAgentId(agentId);
    setTestResults((prev) => {
      const updated = { ...prev };
      delete updated[agentId];
      return updated;
    });

    try {
      const res = await fetch('/api/agents/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, type, voiceName, customInstructions }),
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [agentId]: { success: data.success, message: data.message },
      }));

      if (!data.success) {
        setTestErrorModal({
          agentName: agentId,
          error: data.message || 'Falha de requisição desconhecida.',
        });
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      setTestResults((prev) => ({
        ...prev,
        [agentId]: { success: false, message: errMsg },
      }));
      setTestErrorModal({
        agentName: agentId,
        error: `Falha ao tentar conectar com o servidor: ${errMsg}`,
      });
    } finally {
      setTestingAgentId(null);
    }
  };

  const defaultProgrammingPairs = [
    {
      role: 'Principal / Orchestrator',
      id: 'principal',
      primaryModel: 'gemini-3.5-flash-lite',
      quota: '1.5k RPM / 500 RPD',
      defaultBackupId: 'worker',
    },
    {
      role: 'Investigator',
      id: 'investigator',
      primaryModel: 'gemini-3.7-flash',
      quota: '50 RPM / 20 RPD',
      defaultBackupId: 'architect',
    },
    {
      role: 'Architect',
      id: 'architect',
      primaryModel: 'gemini-3.6-flash',
      quota: '50 RPM / 20 RPD',
      defaultBackupId: 'investigator',
    },
    {
      role: 'Auditor',
      id: 'auditor',
      primaryModel: 'gemini-3.8-flash',
      quota: '50 RPM / 20 RPD',
      defaultBackupId: 'architect',
    },
    {
      role: 'Tester',
      id: 'tester',
      primaryModel: 'gemini-3-flash',
      quota: '50 RPM / 20 RPD',
      defaultBackupId: 'worker',
    },
    {
      role: 'Worker',
      id: 'worker',
      primaryModel: 'gemini-3.1-flash-lite',
      quota: '150 RPM / 500 RPD',
      defaultBackupId: 'principal',
    },
  ];

  const handleBackupChange = async (agentId: string, newBackupId: string) => {
    const targetAgent = agents.find((a) => a.id.toLowerCase() === agentId.toLowerCase());
    if (targetAgent && onSaveAgent) {
      await onSaveAgent({
        ...targetAgent,
        backupAgentId: newBackupId,
      });
      setSavedAgentId(agentId);
      setTimeout(() => setSavedAgentId(null), 2500);
    }
  };

  const handleSelectPrimary = (agentId: string) => {
    if (onSelectAgent) {
      const match = agents.find((a) => a.id.toLowerCase() === agentId.toLowerCase());
      if (match) {
        onSelectAgent(match.id);
      } else {
        onSelectAgent(agentId);
      }
    }
  };

  const handleReset = async () => {
    await onResetDefaultAgentsConfig();
    setResetSuccess(true);
    setTimeout(() => setResetSuccess(false), 3000);
  };

  const sections = [
    {
      group: 'stable',
      title: '1. Texto, Chat e Raciocínio',
      icon: Cpu,
      priorityNote: 'Prioridade prática de uso: Gemini 3.8 Flash → 3.7 → 3.6 → 3.5 → 3 → 3.1 Flash Lite → 2.5 Flash → 2.5 Flash Lite → 3.5 Flash Lite.',
    },
    {
      group: 'audio',
      title: '2. Voz, Transcrição, Tradução e Áudio em Tempo Real',
      icon: Mic,
    },
  ];

  const activeSttAgentId = audioSettings?.activeSttAgentId || (voiceAgents[0]?.id || 'agent_narrador_oficial');
  const backupSttAgentId = audioSettings?.backupSttAgentId || (voiceAgents[1]?.id || voiceAgents[0]?.id || '');

  // Strict rule: Only agents created with valid TTS models (gemini-2.5-flash, gemini-2.0-flash, browser-native) appear in the TTS Narrador dropdown
  const ttsOnlyVoiceAgents = voiceAgents.filter((agent) => {
    const model = (agent.config?.model || '').toLowerCase();
    return agent.type === 'narrator' || agent.type === 'hybrid' || model.includes('2.5-flash') || model.includes('2.0-flash') || model.includes('browser-native');
  });
  const displayTtsAgents = ttsOnlyVoiceAgents.length > 0 ? ttsOnlyVoiceAgents : voiceAgents;

  const activeTtsAgentId = audioSettings?.activeTtsAgentId || (displayTtsAgents[0]?.id || 'agent_narrador_oficial');
  const backupTtsAgentId = audioSettings?.backupTtsAgentId || (displayTtsAgents[1]?.id || displayTtsAgents[0]?.id || '');

  return (
    <div className="space-y-6">
      {/* Painel Superior: Atribuição de Agentes Titulares e Reservas */}
      <div className="p-4 rounded-2xl border border-blue-200/80 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 space-y-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-blue-900 dark:text-blue-200">
                Mapeamento de Agentes Titulares & Reservas (Programação e Voz)
              </h4>
              <p className="text-[11px] text-blue-700/80 dark:text-blue-300/70">
                Selecione os agentes responsáveis e seus respectivos backups para cada função do sistema.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleReset}
            disabled={isResetting}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 transition shrink-0 cursor-pointer shadow-xs disabled:opacity-50 self-start sm:self-auto"
          >
            <RotateCcw className={`w-3 h-3 ${isResetting ? 'animate-spin' : ''}`} />
            <span>{isResetting ? 'Restaurando...' : 'Restaurar Padrão'}</span>
          </button>
        </div>

        {resetSuccess && (
          <div className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Configurações dos agentes restauradas com sucesso!</span>
          </div>
        )}

        {/* 8 Cards Padronizados de Agentes (6 Programação + 2 Voz) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 6 Cards de Agentes de Programação */}
          {defaultProgrammingPairs.map((item) => {
            const currentAgent = agents.find(
              (a) => a.id.toLowerCase() === item.id.toLowerCase() || a.name.toLowerCase() === item.id.toLowerCase()
            );
            const activeBackupId = currentAgent?.backupAgentId || item.defaultBackupId;
            const isCurrentActive =
              selectedAgentId?.toLowerCase() === item.id.toLowerCase() ||
              selectedAgentId?.toLowerCase() === currentAgent?.id?.toLowerCase();

            // Find dynamic quota from catalog in real-time
            const matchedModel = MODELS_CATALOG.find(
              (m) => m.id === currentAgent?.model || m.id === item.primaryModel
            );
            const dynamicQuota = matchedModel
              ? `${matchedModel.rpm} RPM / ${matchedModel.rpd} RPD`
              : item.quota;

            return (
              <div
                key={item.role}
                className={`p-3.5 rounded-xl transition-all border shadow-2xs flex flex-col justify-between space-y-3 relative ${
                  isCurrentActive
                    ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-400 dark:border-blue-600 ring-1 ring-blue-500/30'
                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                {savedAgentId === item.id && (
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-[9px] font-bold flex items-center gap-1 shadow-2xs z-10">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    <span>Salvo</span>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => handleSelectPrimary(item.id)}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer shrink-0 ${
                          isCurrentActive
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : 'bg-zinc-100 hover:bg-blue-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-blue-900/40 dark:hover:text-blue-200'
                        }`}
                      >
                        <Radio className={`w-2.5 h-2.5 ${isCurrentActive ? 'text-white' : 'text-zinc-400'}`} />
                        <span>{isCurrentActive ? 'Ativo' : 'Usar'}</span>
                      </button>
                      <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100 truncate">{item.role}</span>
                    </div>

                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 shrink-0 font-bold border border-blue-200/50 dark:border-blue-800/50">
                      {dynamicQuota}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-zinc-500 dark:text-zinc-400 font-semibold">Agente Atribuído:</span>
                    </div>

                    <select
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg py-1.5 px-2 text-[11px] font-semibold text-blue-700 dark:text-blue-300 outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                      value={currentAgent?.id || item.id}
                      onChange={(e) => {
                        const targetId = e.target.value;
                        handleSelectPrimary(targetId);
                      }}
                    >
                      {agents.map((ag) => (
                        <option key={ag.id} value={ag.id}>
                          {ag.displayName || ag.name} ({ag.model})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-amber-50/40 dark:bg-amber-950/25 border border-amber-200/50 dark:border-amber-900/30 space-y-1">
                  <div className="flex items-center gap-1 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                    <ShieldCheck className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>Agente Reserva (Auto-Fallback)</span>
                  </div>

                  <select
                    className="w-full bg-white dark:bg-zinc-900 border border-amber-300/60 dark:border-amber-800/50 rounded-md py-1 px-1.5 text-[10px] font-medium text-zinc-800 dark:text-zinc-200 outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
                    value={activeBackupId}
                    onChange={(e) => handleBackupChange(item.id, e.target.value)}
                  >
                    {agents
                      .filter((ag) => ag.id.toLowerCase() !== item.id.toLowerCase())
                      .map((ag) => (
                        <option key={ag.id} value={ag.id}>
                          {ag.displayName || ag.name} ({ag.model})
                        </option>
                      ))}
                  </select>
                </div>

                {/* Botão de Teste Único de Chamada de API */}
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-1">
                  <button
                    type="button"
                    disabled={testingAgentId !== null}
                    onClick={() =>
                      handleTestAgent(
                        item.role,
                        currentAgent?.model || item.primaryModel,
                        'programming'
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold cursor-pointer transition flex items-center gap-1 disabled:opacity-50"
                  >
                    {testingAgentId === item.role ? 'Testando...' : 'Testar Conexão'}
                  </button>

                  {testResults[item.role] && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        testResults[item.role].success
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                      }`}
                      title={testResults[item.role].message}
                    >
                      {testResults[item.role].success ? '✅ Conectado' : '❌ Falhou'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* CARD 7: AGENTE TRANSCRITOR (STT) - PADRONIZADO */}
          {(() => {
            const assignedSttAgent = voiceAgents.find(v => v.id === activeSttAgentId) || voiceAgents[0];
            const sttMatchedModel = MODELS_CATALOG.find(m => m.id === assignedSttAgent?.config?.model);
            const sttDynamicQuota = sttMatchedModel ? `${sttMatchedModel.rpm} RPM / ${sttMatchedModel.rpd} RPD` : '150 RPM / 500 RPD';

            return (
              <div className="p-3.5 rounded-xl transition-all border border-blue-500/40 bg-gradient-to-br from-blue-500/10 via-zinc-50 to-white dark:from-blue-950/30 dark:via-zinc-900 dark:to-zinc-900 shadow-2xs flex flex-col justify-between space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="p-1 rounded bg-blue-500/10 text-blue-500">
                        <Mic className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100">Transcritor (STT)</span>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-700 dark:text-blue-300 font-bold">
                      {sttDynamicQuota}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-zinc-500 dark:text-zinc-400 font-semibold">Agente Atribuído:</span>
                    </div>

                    <select
                      value={activeSttAgentId}
                      onChange={(e) => onUpdateAudioSettings && onUpdateAudioSettings({ activeSttAgentId: e.target.value })}
                      className="w-full bg-white dark:bg-zinc-900 border border-blue-400 dark:border-blue-700 rounded-lg py-1.5 px-2 text-[11px] font-bold text-blue-700 dark:text-blue-300 outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      {voiceAgents.length > 0 ? (
                        voiceAgents.map((v) => (
                          <option key={v.id} value={v.id}>
                            🎤 {v.name} ({v.config.baseGeminiVoice || 'Kore'})
                          </option>
                        ))
                      ) : (
                        <option value="agent_narrador_oficial">🎤 Narrador Oficial (Kore)</option>
                      )}
                    </select>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/40 space-y-1">
                  <div className="flex items-center gap-1 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                    <ShieldCheck className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>Agente Reserva (Auto-Fallback)</span>
                  </div>

                  <select
                    value={backupSttAgentId}
                    onChange={(e) => onUpdateAudioSettings && onUpdateAudioSettings({ backupSttAgentId: e.target.value })}
                    className="w-full bg-white dark:bg-zinc-900 border border-amber-300/80 dark:border-amber-800/60 rounded-md py-1 px-1.5 text-[10px] font-medium text-zinc-800 dark:text-zinc-200 outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
                  >
                    {voiceAgents.length > 0 ? (
                      voiceAgents.map((v) => (
                        <option key={v.id} value={v.id}>
                          🎤 {v.name} ({v.config.baseGeminiVoice || 'Kore'})
                        </option>
                      ))
                    ) : (
                      <option value="agent_narrador_oficial">🎤 Narrador Oficial (Kore)</option>
                    )}
                  </select>
                </div>

                {/* Botão de Teste Único */}
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/85 flex items-center justify-between gap-1">
                  <button
                    type="button"
                    disabled={testingAgentId !== null}
                    onClick={() =>
                      handleTestAgent(
                        'Transcritor (STT)',
                        assignedSttAgent?.config?.model || 'gemini-3.5-flash',
                        'programming',
                        assignedSttAgent?.config?.baseGeminiVoice,
                        assignedSttAgent?.config?.promptStt
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] font-bold cursor-pointer transition flex items-center gap-1 disabled:opacity-50"
                  >
                    {testingAgentId === 'Transcritor (STT)' ? 'Testando...' : 'Testar STT'}
                  </button>

                  {testResults['Transcritor (STT)'] && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        testResults['Transcritor (STT)'].success
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                      }`}
                      title={testResults['Transcritor (STT)'].message}
                    >
                      {testResults['Transcritor (STT)'].success ? '✅ OK' : '❌ Falhou'}
                    </span>
                  )}
                </div>
              </div>
            );
          })()}

          {/* CARD 8: AGENTE NARRADOR (TTS) - PADRONIZADO */}
          {(() => {
            const assignedTtsAgent = displayTtsAgents.find(v => v.id === activeTtsAgentId) || displayTtsAgents[0] || voiceAgents[0];
            const ttsMatchedModel = MODELS_CATALOG.find(m => m.id === assignedTtsAgent?.config?.model);
            const ttsDynamicQuota = ttsMatchedModel ? `${ttsMatchedModel.rpm} RPM / ${ttsMatchedModel.rpd} RPD` : '30 RPM / 106 RPD';

            return (
              <div className="p-3.5 rounded-xl transition-all border border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-zinc-50 to-white dark:from-emerald-950/30 dark:via-zinc-900 dark:to-zinc-900 shadow-2xs flex flex-col justify-between space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="p-1 rounded bg-emerald-500/10 text-emerald-500">
                        <Volume2 className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100">Narrador (TTS)</span>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold">
                      {ttsDynamicQuota}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-zinc-500 dark:text-zinc-400 font-semibold">Agente Atribuído:</span>
                    </div>

                    <select
                      value={activeTtsAgentId}
                      onChange={(e) => onUpdateAudioSettings && onUpdateAudioSettings({ activeTtsAgentId: e.target.value })}
                      className="w-full bg-white dark:bg-zinc-900 border border-emerald-400 dark:border-emerald-700 rounded-lg py-1.5 px-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                    >
                      {displayTtsAgents.length > 0 ? (
                        displayTtsAgents.map((v) => (
                          <option key={v.id} value={v.id}>
                            🎭 {v.name} ({v.config.baseGeminiVoice || 'Kore'})
                          </option>
                        ))
                      ) : (
                        <option value="agent_narrador_oficial">🎭 Narrador Oficial (Kore)</option>
                      )}
                    </select>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/40 space-y-1">
                  <div className="flex items-center gap-1 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                    <ShieldCheck className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>Agente Reserva (Auto-Fallback)</span>
                  </div>

                  <select
                    value={backupTtsAgentId}
                    onChange={(e) => onUpdateAudioSettings && onUpdateAudioSettings({ backupTtsAgentId: e.target.value })}
                    className="w-full bg-white dark:bg-zinc-900 border border-amber-300/80 dark:border-amber-800/60 rounded-md py-1 px-1.5 text-[10px] font-medium text-zinc-800 dark:text-zinc-200 outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
                  >
                    {displayTtsAgents.length > 0 ? (
                      displayTtsAgents.map((v) => (
                        <option key={v.id} value={v.id}>
                          🎭 {v.name} ({v.config.baseGeminiVoice || 'Kore'})
                        </option>
                      ))
                    ) : (
                      <option value="agent_narrador_oficial">🎭 Narrador Oficial (Kore)</option>
                    )}
                  </select>
                </div>

                {/* Botão de Teste Único */}
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/85 flex items-center justify-between gap-1">
                  <button
                    type="button"
                    disabled={testingAgentId !== null}
                    onClick={() =>
                      handleTestAgent(
                        'Narrador (TTS)',
                        assignedTtsAgent?.config?.model || 'gemini-2.5-flash',
                        'voice',
                        assignedTtsAgent?.config?.baseGeminiVoice || 'Kore',
                        assignedTtsAgent?.config?.promptTts
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold cursor-pointer transition flex items-center gap-1 disabled:opacity-50"
                  >
                    {testingAgentId === 'Narrador (TTS)' ? 'Testando...' : 'Testar TTS'}
                  </button>

                  {testResults['Narrador (TTS)'] && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        testResults['Narrador (TTS)'].success
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                      }`}
                      title={testResults['Narrador (TTS)'].message}
                    >
                      {testResults['Narrador (TTS)'].success ? '✅ OK' : '❌ Falhou'}
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Abas de Categoria */}
      <div className="flex gap-1 overflow-x-auto pb-1 border-b border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setActiveCategoryTab('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeCategoryTab === 'all'
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          Todos os Modelos ({MODELS_CATALOG.length})
        </button>
        {sections.map((sec) => (
          <button
            key={sec.group}
            onClick={() => setActiveCategoryTab(sec.group)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition cursor-pointer ${
              activeCategoryTab === sec.group
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {sec.title}
          </button>
        ))}
      </div>

      {/* Tabelas de Modelos */}
      {sections
        .filter((sec) => activeCategoryTab === 'all' || activeCategoryTab === sec.group)
        .map((sec) => {
          const sectionModels = MODELS_CATALOG.filter((m) => m.group === sec.group);
          const Icon = sec.icon;
          return (
            <div
              key={sec.group}
              className="border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 shadow-2xs"
            >
              <div className="px-4 py-3 bg-zinc-50/80 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <h5 className="font-bold text-xs text-zinc-900 dark:text-zinc-100">
                    {sec.title}
                  </h5>
                </div>
                <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold">
                  {sectionModels.length} modelos
                </span>
              </div>

              {sec.priorityNote && (
                <div className="bg-amber-50/80 dark:bg-amber-950/30 border-b border-amber-200/60 dark:border-amber-900/40 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2 font-medium">
                  <Info className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{sec.priorityNote}</span>
                </div>
              )}

              {/* Tabela de Modelos */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-zinc-100/60 dark:bg-zinc-800/40 text-zinc-600 dark:text-zinc-400 font-bold border-b border-zinc-200 dark:border-zinc-800 text-[11px]">
                      <th className="py-2.5 px-3 text-center w-12">#</th>
                      <th className="py-2.5 px-3">Modelo</th>
                      <th className="py-2.5 px-3 text-center w-24">RPM</th>
                      <th className="py-2.5 px-3 text-center w-24">TPM</th>
                      <th className="py-2.5 px-3 text-center w-24">RPD</th>
                      <th className="py-2.5 px-3 text-center w-28">Categoria</th>
                      <th className="py-2.5 px-3">Descrição</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                    {sectionModels.map((item) => (
                      <tr
                        key={item.id}
                        className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30 transition text-[11px]"
                      >
                        <td className="py-2.5 px-3 text-center font-mono text-zinc-400 font-bold">
                          {item.order}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col">
                            <span className="font-bold text-zinc-900 dark:text-zinc-100">
                              {item.name}
                            </span>
                            <span className="font-mono text-[10px] text-zinc-400">
                              {item.id}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono text-[10px] text-zinc-700 dark:text-zinc-300 font-semibold">
                          {item.rpm}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono text-[10px] text-zinc-700 dark:text-zinc-300 font-semibold">
                          {item.tpm}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono text-[10px] text-zinc-700 dark:text-zinc-300 font-semibold">
                          {item.rpd}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              item.category === 'Txt Out'
                                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                                : item.category === 'API Live'
                                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                : item.category === 'Multimod'
                                ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                            }`}
                          >
                            {item.category}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-300 leading-relaxed">
                          {item.recommendedRole && (
                            <span className="text-blue-600 dark:text-blue-400 font-bold mr-1.5">
                              [Padrão: {item.recommendedRole}]
                            </span>
                          )}
                          {item.subFunction && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold mr-1.5">
                              [{item.subFunction}]
                            </span>
                          )}
                          {item.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

      {/* Modal Overlay para Notificação de Falha de Conexão */}
      {testErrorModal && (
        <div className="fixed inset-0 bg-black/65 flex items-center justify-center p-4 z-55 animate-fade-in backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 shrink-0">
                <Info className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Falha no Teste do Agente
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  A requisição de verificação de conexão única para o modelo do agente <strong>{testErrorModal.agentName}</strong> falhou.
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
