import React, { useState } from 'react';
import { Plus, Sparkles, Trash2, Cpu, Radio, Bot, X, Sliders, ShieldAlert, ShieldCheck, Save } from 'lucide-react';
import { AgentConfig } from '../../types.js';

interface AgentsSettingsSectionProps {
  agents: AgentConfig[];
  selectedAgentId?: string;
  onSelectAgent?: (id: string) => void;
  onSaveAgent: (agent: AgentConfig) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
  onResetDefaultAgentsConfig?: () => Promise<void>;
  onOpenModelSelectorForAgent?: (agent: AgentConfig) => void;
}

export const AgentsSettingsSection: React.FC<AgentsSettingsSectionProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onSaveAgent,
  onDeleteAgent,
  onResetDefaultAgentsConfig,
  onOpenModelSelectorForAgent,
}) => {
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [isNewAgent, setIsNewAgent] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Agentes Especializados do Gemini CLI (.gemini/agents/*.md)
          </h4>
          <p className="text-xs text-zinc-500 mt-1">
            Cada agente possui arquivo Markdown com YAML frontmatter reconhecido pelo Gemini CLI.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEditingAgent({
                id: '',
                name: '',
                displayName: '',
                role: '',
                model: 'gemini-3.5-flash-lite',
                description: '',
                baseInstructions: '',
                systemInstructions: '',
                overrideBasePrompt: false,
                enabled: true,
                kind: 'local',
                tools: ['*'],
                temperature: 0.2,
                topP: 0.95,
                topK: 40,
                maxOutputTokens: undefined,
                thinking: false,
                conceptualProfile: '',
                maxTurns: 25,
                statusGrade: 'CONFIGURED',
              });
              setIsNewAgent(true);
            }}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Novo Agente</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              if (onResetDefaultAgentsConfig) {
                await onResetDefaultAgentsConfig();
              }
            }}
            className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Restaurar Padrões</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex flex-col justify-between group relative"
          >
            {!['principal', 'investigator', 'architect', 'auditor', 'tester', 'worker'].includes(agent.id.toLowerCase()) && (
              <button
                onClick={async () => {
                  if (confirm(`Deseja realmente remover o agente "${agent.displayName || agent.name}"?`)) {
                    await onDeleteAgent(agent.id);
                  }
                }}
                className="absolute top-2 right-2 p-1.5 text-zinc-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <div>
              <div className="flex items-center justify-between pr-8">
                <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                  {agent.displayName || agent.name}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenModelSelectorForAgent && onOpenModelSelectorForAgent(agent)}
                  title="Clique para trocar de modelo pelo catálogo"
                  className="font-mono text-[11px] px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/60 transition cursor-pointer flex items-center gap-1"
                >
                  <Cpu className="w-3 h-3" />
                  <span>{agent.model}</span>
                </button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 line-clamp-2">
                {agent.description}
              </p>
            </div>

            <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700/60 flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-zinc-400 font-mono">
                  tools: {agent.tools.join(', ')} | max: {agent.maxTurns}
                </span>
                {agent.thinking && (
                  <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-tighter">Thinking Enabled</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {onSelectAgent && (
                  <button
                    type="button"
                    onClick={() => onSelectAgent(agent.id)}
                    className={`px-2 py-1 text-xs font-medium rounded-lg transition cursor-pointer flex items-center gap-1 ${
                      selectedAgentId?.toLowerCase() === agent.id.toLowerCase()
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-zinc-100 dark:bg-zinc-700/60 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                    }`}
                    title={
                      selectedAgentId?.toLowerCase() === agent.id.toLowerCase()
                        ? 'Agente Principal Ativo no Chat'
                        : 'Definir como Agente Principal do Chat'
                    }
                  >
                    <Radio className="w-3 h-3" />
                    <span>
                      {selectedAgentId?.toLowerCase() === agent.id.toLowerCase()
                        ? 'Principal Ativo'
                        : 'Tornar Principal'}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenModelSelectorForAgent && onOpenModelSelectorForAgent(agent)}
                  className="px-2 py-1 text-xs font-medium rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition cursor-pointer"
                >
                  Modelo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingAgent({ ...agent });
                    setIsNewAgent(false);
                  }}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition cursor-pointer"
                >
                  Editar Agente
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Agent Modal Subview */}
      {editingAgent && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-4xl p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-blue-500" />
                <h4 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
                  {isNewAgent ? 'Criar Novo Agente Personalizado' : `Editar Agente: ${editingAgent.displayName || editingAgent.name}`}
                </h4>
              </div>
              <button onClick={() => setEditingAgent(null)} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Left Column: Identificação */}
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-3">1. Identificação</label>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">Nome Interno (ID)</label>
                        <input
                          type="text"
                          disabled={!isNewAgent}
                          value={editingAgent.name}
                          onChange={(e) => setEditingAgent({ ...editingAgent, name: e.target.value, id: e.target.value })}
                          placeholder="ex: meu_agente"
                          className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs disabled:opacity-50 font-mono text-zinc-900 dark:text-zinc-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">Nome de Exibição</label>
                        <input
                          type="text"
                          value={editingAgent.displayName || ''}
                          onChange={(e) => setEditingAgent({ ...editingAgent, displayName: e.target.value })}
                          placeholder="ex: Especialista em React"
                          className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Perfil Conceitual</label>
                      <input
                        type="text"
                        value={editingAgent.conceptualProfile || ''}
                        onChange={(e) => setEditingAgent({ ...editingAgent, conceptualProfile: e.target.value })}
                        placeholder="ex: Minimalista, Técnico, Poético..."
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Breve Descrição (Metadados)</label>
                      <textarea
                        rows={2}
                        value={editingAgent.description}
                        onChange={(e) => setEditingAgent({ ...editingAgent, description: e.target.value })}
                        placeholder="Descreva a especialidade deste agente para fins de roteamento..."
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs resize-none text-zinc-900 dark:text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-blue-600 dark:text-blue-400 font-bold mb-1 uppercase tracking-tighter">Instruções Básicas (Prompt Principal)</label>
                      <textarea
                        rows={12}
                        value={editingAgent.baseInstructions || ''}
                        onChange={(e) => setEditingAgent({ ...editingAgent, baseInstructions: e.target.value })}
                        placeholder="Defina as instruções fundamentais e permanentes do agente..."
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-[11px] font-mono focus:ring-2 focus:ring-blue-500/20 outline-none leading-relaxed text-zinc-900 dark:text-zinc-100"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Model & Advanced & Override */}
              <div className="space-y-4">
                {/* 2. Configuração de Modelo */}
                <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60">
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-500">2. Configuração de Modelo</label>
                    <button
                      type="button"
                      onClick={() => onOpenModelSelectorForAgent && onOpenModelSelectorForAgent(editingAgent)}
                      className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Cpu className="w-3 h-3" />
                      Abrir Catálogo
                    </button>
                  </div>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editingAgent.model}
                      onChange={(e) => setEditingAgent({ ...editingAgent, model: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 font-mono text-xs text-blue-600 dark:text-blue-400 font-bold"
                      placeholder="ex: gemini-3.7-flash"
                    />
                  </div>
                </div>

                {/* 3. Configurações Avançadas */}
                <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60">
                  <div className="flex items-center gap-2 mb-3">
                    <Sliders className="w-4 h-4 text-blue-500" />
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-500">3. Configurações Avançadas</label>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div className="space-y-1">
                      <label className="block text-[10px] text-zinc-500">Temperature ({editingAgent.temperature})</label>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={editingAgent.temperature || 0}
                        onChange={(e) => setEditingAgent({ ...editingAgent, temperature: parseFloat(e.target.value) })}
                        className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] text-zinc-500">Top P ({editingAgent.topP || 0.95})</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={editingAgent.topP || 0.95}
                        onChange={(e) => setEditingAgent({ ...editingAgent, topP: parseFloat(e.target.value) })}
                        className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] text-zinc-500">Top K</label>
                      <input
                        type="number"
                        value={editingAgent.topK ?? 40}
                        onChange={(e) => setEditingAgent({ ...editingAgent, topK: parseInt(e.target.value) })}
                        className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] text-zinc-500">Max Tokens</label>
                      <input
                        type="number"
                        value={editingAgent.maxOutputTokens ?? ''}
                        placeholder="Padrão"
                        onChange={(e) => {
                          const val = e.target.value === '' ? undefined : parseInt(e.target.value);
                          setEditingAgent({ ...editingAgent, maxOutputTokens: val });
                        }}
                        className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] text-zinc-500">Max Turns</label>
                      <input
                        type="number"
                        value={editingAgent.maxTurns || 25}
                        onChange={(e) => setEditingAgent({ ...editingAgent, maxTurns: parseInt(e.target.value) })}
                        className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100"
                      />
                    </div>
                    <div className="flex items-center justify-between col-span-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-zinc-700 dark:text-zinc-300">Modo Thinking</span>
                        <span className="text-[9px] text-zinc-500">Ativa raciocínio em cadeia</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingAgent({ ...editingAgent, thinking: !editingAgent.thinking })}
                        className={`w-9 h-4.5 rounded-full transition-colors relative flex items-center px-0.5 cursor-pointer ${
                          editingAgent.thinking ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
                        }`}
                      >
                        <div className={`w-3.5 h-3.5 bg-white rounded-full transition-transform ${editingAgent.thinking ? 'translate-x-4.5' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* 4. SYSTEM PROMPT OVERRIDE */}
                <div className="p-4 rounded-2xl bg-amber-50/40 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-amber-600" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">4. System Prompt Override</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold text-zinc-500 uppercase">Sobrescrever base</span>
                      <button
                        type="button"
                        onClick={() => setEditingAgent({ ...editingAgent, overrideBasePrompt: !editingAgent.overrideBasePrompt })}
                        className={`w-8 h-4 rounded-full transition-colors relative flex items-center px-0.5 cursor-pointer ${
                          editingAgent.overrideBasePrompt ? 'bg-amber-500' : 'bg-zinc-300 dark:bg-zinc-600'
                        }`}
                      >
                        <div className={`w-3 h-3 bg-white rounded-full transition-transform ${editingAgent.overrideBasePrompt ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80 mb-2 leading-relaxed">
                    {editingAgent.overrideBasePrompt 
                      ? '⚠️ MODO SUBSTITUIÇÃO: Este prompt IGNORARÁ as Instruções Básicas.' 
                      : '✨ MODO COMPLEMENTAR: Este prompt será anexado às Instruções Básicas.'}
                  </p>
                  <textarea
                    rows={6}
                    value={editingAgent.systemInstructions}
                    onChange={(e) => setEditingAgent({ ...editingAgent, systemInstructions: e.target.value })}
                    placeholder="Adicione instruções contextuais ou específicas para esta camada..."
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-800/50 font-mono text-[11px] text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-amber-500/20 outline-none leading-relaxed"
                  />
                </div>

                {/* 5. AGENTE RESERVA (FALLBACK POR COTAS OU SOBRECARGA) */}
                <div className="p-4 rounded-2xl bg-blue-50/40 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-900/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-blue-900 dark:text-blue-300">
                        5. Agente Reserva (Fallback por Cotas / Sobrecarga)
                      </span>
                    </div>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      Auto-Failover
                    </span>
                  </div>
                  <p className="text-[10px] text-blue-700/80 dark:text-blue-400/80 mb-2 leading-relaxed">
                    Agente que assumirá automaticamente a solicitação em caso de erro 429 (Cotas Esgotadas) ou 500/503 (Servidor Sobrecarregado).
                  </p>
                  <select
                    value={editingAgent.backupAgentId || ''}
                    onChange={(e) => setEditingAgent({ ...editingAgent, backupAgentId: e.target.value || undefined })}
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-blue-200 dark:border-blue-800/50 text-xs text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer"
                  >
                    <option value="">Nenhum (usar padrão do sistema)</option>
                    {agents
                      .filter((ag) => ag.id.toLowerCase() !== editingAgent.id?.toLowerCase() && ag.name.toLowerCase() !== editingAgent.name?.toLowerCase())
                      .map((ag) => (
                        <option key={ag.id} value={ag.id}>
                          {ag.displayName || ag.name} ({ag.model})
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-6 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => setEditingAgent(null)}
                className="px-4 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (isNewAgent && !editingAgent.name) {
                    alert('O nome interno do agente é obrigatório.');
                    return;
                  }
                  await onSaveAgent(editingAgent);
                  setEditingAgent(null);
                }}
                className="px-6 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/20 transition-all flex items-center gap-2 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{isNewAgent ? 'Criar Agente' : 'Salvar Alterações'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
