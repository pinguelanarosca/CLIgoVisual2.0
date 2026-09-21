import React, { useState } from 'react';
import {
  Cpu,
  Mic,
  Bot,
  Boxes,
  Database,
  Binary,
  Sparkles,
  Info,
  RotateCcw,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  Zap,
  Check,
  Radio,
} from 'lucide-react';
import { MODELS_CATALOG } from '../constants/modelsCatalog.js';
import { AgentConfig } from '../types.js';

interface ModelCatalogViewProps {
  agents: AgentConfig[];
  selectedAgentId?: string;
  onSelectAgent?: (id: string) => void;
  onResetDefaultAgentsConfig: () => Promise<void>;
  onSaveAgent?: (agent: AgentConfig) => Promise<void>;
  isResetting?: boolean;
}

export const ModelCatalogView: React.FC<ModelCatalogViewProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onResetDefaultAgentsConfig,
  onSaveAgent,
  isResetting = false,
}) => {
  const [activeCategoryTab, setActiveCategoryTab] = useState<string>('all');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [savedAgentId, setSavedAgentId] = useState<string | null>(null);

  const defaultAgentPairs = [
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

  const handleModelChange = async (agentId: string, newModel: string) => {
    const targetAgent = agents.find((a) => a.id.toLowerCase() === agentId.toLowerCase());
    if (targetAgent && onSaveAgent) {
      await onSaveAgent({
        ...targetAgent,
        model: newModel,
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

  const sections = [
    {
      group: 'stable',
      title: '1. Modelos Estáveis (Produção)',
      icon: Cpu,
      desc: 'Modelos de produção estáveis para geração de texto, raciocínio, auditoria e tarefas do sistema.',
      priorityNote: 'Prioridade recomendada: 3.8 Flash → 3.7 → 3.6 → 3.5 → 3 → 3.1 Flash Lite → 2.5 Flash → 2.5 Flash Lite → 3.5 Flash Lite.',
    },
    {
      group: 'preview',
      title: '2. Modelos Preview & Especializados',
      icon: Boxes,
      desc: 'Modelos preview de raciocínio avançado, geração e edição de imagens, geração de vídeos, geração musical e robótica.',
      subdivisions: [
        { label: 'Raciocínio & STEM', chain: 'gemini-3.1-pro-preview' },
        { label: 'Geração de Imagens', chain: 'gemini-3.1-flash-image (Nano Banana 2) → gemini-3.1-flash-lite-image → gemini-3-pro-image' },
        { label: 'Geração de Vídeo', chain: 'veo-3.1-generate-preview (4K) → veo-3.1-lite-generate-preview (1080p)' },
        { label: 'Geração Musical', chain: 'lyria-3-clip-preview (30s) → lyria-3-pro-preview (completo)' },
        { label: 'Embodied AI / Robótica', chain: 'gemini-robotics-er-2-preview' },
      ],
    },
    {
      group: 'audio',
      title: '3. Áudio, Voz e API Live',
      icon: Mic,
      desc: 'Modelos oficiais para transcrição STT, síntese TTS e sessões contínuas via Live API.',
      subdivisions: [
        { label: 'Transcrição STT', chain: 'gemini-3.5-transcribe (estático) → gemini-3.5-transcribe-live (ao vivo)' },
        { label: 'Síntese de Voz TTS', chain: 'gemini-3.1-flash-tts-preview (Kore, Puck, Charon, Fenrir, Zephyr)' },
        { label: 'Live API em Tempo Real', chain: 'gemini-3.8-live → gemini-3.8-live-extended-thinking' },
        { label: 'Tradução Simultânea', chain: 'gemini-3.5-transcribe-live (Live API)' },
      ],
    },
    {
      group: 'embeddings',
      title: '4. Embeddings & Busca Semântica',
      icon: Database,
      desc: 'Representação vetorial densa para indexação de código, RAG e busca semântica.',
      priorityNote: 'Ordem de preferência: gemini-embedding-2-preview → text-embedding-004',
    },
    {
      group: 'agents',
      title: '5. Agentes & Automação',
      icon: Bot,
      desc: 'Motores nativos dedicados para agentes autônomos e fluxos contínuos de desenvolvimento e pesquisa.',
      subdivisions: [
        { label: 'Automação & Orquestração', chain: 'antigravity (motor autônomo nativo)' },
        { label: 'Pesquisa Analítica', chain: 'deep-research (investigações aprofundadas multi-fonte)' },
      ],
    },
    {
      group: 'gemma',
      title: '6. Modelos Abertos (Gemma)',
      icon: Binary,
      desc: 'Pesos abertos para inferência local de alto desempenho e auditoria descentralizada.',
      subdivisions: [
        { label: 'Alta Densidade', chain: 'gemma-4-31b' },
        { label: 'Balanceado', chain: 'gemma-4-26b' },
      ],
    },
  ];

  const handleReset = async () => {
    await onResetDefaultAgentsConfig();
    setResetSuccess(true);
    setTimeout(() => setResetSuccess(false), 3000);
  };

  return (
    <div className="space-y-4">
      {/* Top Banner: Compact Agent & Failover Manager */}
      <div className="p-3 sm:p-4 rounded-xl border border-blue-200/80 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 space-y-3 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-blue-900 dark:text-blue-200">
                Agentes Titulares & Auto-Fallback Reserva
              </h4>
              <p className="text-[11px] text-blue-700/80 dark:text-blue-300/70">
                Selecione o agente principal e configure o agente reserva para failover em erros 429/500/503.
              </p>
            </div>
          </div>
        </div>

        {/* Top Control Bar: Active Titular Agent Selector & Reset Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1 pb-2 border-b border-blue-100 dark:border-blue-900/40">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <Bot className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 shrink-0">
              Agente Titular:
            </span>
            <select
              value={selectedAgentId || 'principal'}
              onChange={(e) => handleSelectPrimary(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-blue-300 dark:border-blue-700/80 rounded-lg py-1 px-2 text-xs font-semibold text-blue-700 dark:text-blue-300 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs"
            >
              {(agents && agents.length > 0 ? agents : defaultAgentPairs.map(d => ({ id: d.id, name: d.id, displayName: d.role, model: d.primaryModel }))).map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.displayName || ag.name} — Modelo: {ag.model}
                </option>
              ))}
            </select>
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
          <div className="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Configurações e agentes reservas salvos com sucesso (.gemini/agents/*.md)!</span>
          </div>
        )}

        {/* 6 Compact Agent Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-0.5">
          {defaultAgentPairs.map((item) => {
            const currentAgent = agents.find(
              (a) => a.id.toLowerCase() === item.id.toLowerCase() || a.name.toLowerCase() === item.id.toLowerCase()
            );
            const activeBackupId = currentAgent?.backupAgentId || item.defaultBackupId;
            const isCurrentActive =
              selectedAgentId?.toLowerCase() === item.id.toLowerCase() ||
              selectedAgentId?.toLowerCase() === currentAgent?.id?.toLowerCase();

            return (
              <div
                key={item.role}
                className={`p-3 rounded-lg transition-all border shadow-2xs flex flex-col justify-between space-y-2 relative group ${
                  isCurrentActive
                    ? 'bg-blue-50/60 dark:bg-blue-950/30 border-blue-400 dark:border-blue-600 ring-1 ring-blue-500/30'
                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                {savedAgentId === item.id && (
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-[9px] font-bold flex items-center gap-1 shadow-2xs z-10">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    <span>Salvo</span>
                  </div>
                )}

                {/* Header & Primary Action */}
                <div className="space-y-1.5">
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
                      <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate">{item.role}</span>
                    </div>

                    <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 shrink-0">
                      {item.id}
                    </span>
                  </div>

                  {/* Assigned Agent Select */}
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-zinc-500 dark:text-zinc-400">Agente Atribuído:</span>
                      <span className="text-zinc-400 font-mono text-[9px]">{currentAgent?.model || item.primaryModel}</span>
                    </div>

                    <select
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md py-1 px-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-300 outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
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

                {/* Backup / Fallback Box */}
                <div className="p-2 rounded-md bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/30 space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1 text-amber-800 dark:text-amber-300 font-semibold">
                      <ShieldCheck className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>Agente Reserva</span>
                    </div>
                    <span className="text-[8px] font-medium px-1 rounded bg-amber-200/50 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200">
                      Auto-Fallback
                    </span>
                  </div>

                  <select
                    className="w-full bg-white dark:bg-zinc-900 border border-amber-300/80 dark:border-amber-800/60 rounded py-0.5 px-1.5 text-[10px] font-medium text-zinc-800 dark:text-zinc-200 outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
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
              </div>
            );
          })}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 border-b border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setActiveCategoryTab('all')}
          className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition cursor-pointer ${
            activeCategoryTab === 'all'
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          Todos ({MODELS_CATALOG.length})
        </button>
        {sections.map((sec) => (
          <button
            key={sec.group}
            onClick={() => setActiveCategoryTab(sec.group)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition cursor-pointer ${
              activeCategoryTab === sec.group
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {sec.title}
          </button>
        ))}
      </div>

      {/* Sections Table View */}
      {sections
        .filter((sec) => activeCategoryTab === 'all' || activeCategoryTab === sec.group)
        .map((sec) => {
          const sectionModels = MODELS_CATALOG.filter((m) => m.group === sec.group);
          const Icon = sec.icon;
          return (
            <div
              key={sec.group}
              className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900 shadow-2xs"
            >
              <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                  <h5 className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                    {sec.title}
                  </h5>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                  {sectionModels.length} modelos
                </span>
              </div>

              {sec.priorityNote && (
                <div className="bg-amber-50/60 dark:bg-amber-950/20 border-b border-amber-200/40 dark:border-amber-900/40 px-3 py-1.5 text-[11px] text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                  <Info className="w-3 h-3 text-amber-600 shrink-0" />
                  <span>{sec.priorityNote}</span>
                </div>
              )}

              {sec.subdivisions && (
                <div className="bg-emerald-50/40 dark:bg-emerald-950/15 border-b border-emerald-200/40 dark:border-emerald-900/40 p-2 text-xs grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {sec.subdivisions.map((sub, idx) => (
                    <div key={idx} className="bg-white/80 dark:bg-zinc-800/80 px-2 py-1 rounded border border-emerald-200/30 dark:border-emerald-800/30 text-[11px]">
                      <span className="font-medium text-emerald-800 dark:text-emerald-300">{sub.label}: </span>
                      <span className="font-mono text-zinc-600 dark:text-zinc-400">{sub.chain}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-zinc-100/40 dark:bg-zinc-800/30 text-zinc-600 dark:text-zinc-400 font-semibold border-b border-zinc-200 dark:border-zinc-800 text-[11px]">
                      <th className="py-1.5 px-2.5 text-center w-12">#</th>
                      <th className="py-1.5 px-2.5">Modelo</th>
                      <th className="py-1.5 px-2.5 text-center w-20">RPM</th>
                      <th className="py-1.5 px-2.5 text-center w-20">TPM</th>
                      <th className="py-1.5 px-2.5 text-center w-20">RPD</th>
                      <th className="py-1.5 px-2.5 text-center w-20">Tipo</th>
                      <th className="py-1.5 px-2.5">Descrição</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                    {sectionModels.map((item) => (
                      <tr
                        key={item.id}
                        className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30 transition text-[11px]"
                      >
                        <td className="py-1.5 px-2.5 text-center font-mono text-zinc-400">
                          {item.order}
                        </td>
                        <td className="py-1.5 px-2.5">
                          <div className="flex flex-col">
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {item.name}
                            </span>
                            <span className="font-mono text-[10px] text-zinc-400">
                              {item.id}
                            </span>
                          </div>
                        </td>
                        <td className="py-1.5 px-2.5 text-center font-mono text-[10px] text-zinc-600 dark:text-zinc-400">
                          {item.rpm}
                        </td>
                        <td className="py-1.5 px-2.5 text-center font-mono text-[10px] text-zinc-600 dark:text-zinc-400">
                          {item.tpm}
                        </td>
                        <td className="py-1.5 px-2.5 text-center font-mono text-[10px] text-zinc-600 dark:text-zinc-400">
                          {item.rpd}
                        </td>
                        <td className="py-1.5 px-2.5 text-center">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-medium ${
                              item.category === 'Estável'
                                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                                : item.category === 'Preview'
                                ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'
                                : item.category === 'API Live'
                                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                : item.category === 'Áudio'
                                ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300'
                                : item.category === 'Embeddings'
                                ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300'
                                : item.category === 'Agents'
                                ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                                : item.category === 'Gemma'
                                ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                            }`}
                          >
                            {item.category}
                          </span>
                        </td>
                        <td className="py-1.5 px-2.5 text-zinc-500 dark:text-zinc-400">
                          {item.recommendedRole && (
                            <span className="text-blue-600 dark:text-blue-400 font-medium mr-1.5">
                              [Padrão: {item.recommendedRole}]
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
    </div>
  );
};
