import React, { useState, useEffect } from 'react';
import {
  Brain,
  X,
  Save,
  RotateCcw,
  Sparkles,
  History,
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle,
  Plus,
  Trash2,
  Edit3,
  Bot,
  User,
  Shield,
  FileText,
  ListTodo,
  Layers,
} from 'lucide-react';
import { SharedMemoryItem, SharedMemoryVersion } from '../types.js';

interface MemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  onNotification?: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export const MemoryModal: React.FC<MemoryModalProps> = ({
  isOpen,
  onClose,
  projectId,
  onNotification,
}) => {
  const [memories, setMemories] = useState<SharedMemoryItem[]>([]);
  const [selectedMemory, setSelectedMemory] = useState<SharedMemoryItem | null>(null);
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'steps' | 'agent' | 'versions'>('editor');

  // Memory Agent states
  const [agentPrompt, setAgentPrompt] = useState('');
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  // Versions history states (loaded on-demand)
  const [versions, setVersions] = useState<SharedMemoryVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [selectedVersionForCompare, setSelectedVersionForCompare] = useState<SharedMemoryVersion | null>(null);

  // New Memory creation state
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newMemoryName, setNewMemoryName] = useState('');

  const fetchMemories = async () => {
    try {
      const url = projectId ? `/api/memory?projectId=${projectId}` : '/api/memory';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setMemories(list);
        if (list.length > 0) {
          const current = selectedMemory ? list.find((m) => m.id === selectedMemory.id) || list[0] : list[0];
          setSelectedMemory(current);
          setContent(current.content);
        }
      }
    } catch {
      onNotification?.('Erro ao carregar memórias compartilhadas.', 'error');
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMemories();
    }
  }, [isOpen, projectId]);

  const handleSelectMemory = (mem: SharedMemoryItem) => {
    setSelectedMemory(mem);
    setContent(mem.content);
    setSelectedVersionForCompare(null);
    if (activeTab === 'versions') {
      fetchVersionsForMemory(mem.id);
    }
  };

  const fetchVersionsForMemory = async (memId: string) => {
    setLoadingVersions(true);
    try {
      const res = await fetch(`/api/memory/${memId}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(Array.isArray(data) ? data : []);
      }
    } catch {
      onNotification?.('Erro ao carregar histórico de versões da memória.', 'error');
    } finally {
      setLoadingVersions(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'versions' && selectedMemory) {
      fetchVersionsForMemory(selectedMemory.id);
    }
  }, [activeTab, selectedMemory?.id]);

  const handleSaveContent = async () => {
    if (!selectedMemory || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/memory/${selectedMemory.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          author: 'user',
          summary: 'Edição direta na interface',
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedMemory(updated);
        setContent(updated.content);
        onNotification?.('Memória salva com sucesso! Nova versão arquivada.', 'success');
        fetchMemories();
      } else {
        onNotification?.('Erro ao salvar memória.', 'error');
      }
    } catch {
      onNotification?.('Erro ao salvar alterações da memória.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunMemoryAgent = async () => {
    if (!selectedMemory || !agentPrompt.trim() || isAgentRunning) return;
    setIsAgentRunning(true);
    try {
      const res = await fetch('/api/memory/agent/refactor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memoryId: selectedMemory.id,
          instruction: agentPrompt.trim(),
          customContent: content,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.memory) {
        setSelectedMemory(data.memory);
        setContent(data.memory.content);
        setAgentPrompt('');
        onNotification?.('Agente da Memória refatorou e atualizou a memória com sucesso!', 'success');
        setActiveTab('editor');
        fetchMemories();
      } else {
        onNotification?.(data.error || 'Falha ao executar o Agente da Memória.', 'error');
      }
    } catch {
      onNotification?.('Erro de conexão com o Agente da Memória.', 'error');
    } finally {
      setIsAgentRunning(false);
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!selectedMemory) return;
    try {
      const res = await fetch(`/api/memory/${selectedMemory.id}/restore-version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedMemory(updated);
        setContent(updated.content);
        onNotification?.('Versão restaurada com sucesso como nova versão.', 'success');
        fetchMemories();
        fetchVersionsForMemory(selectedMemory.id);
      }
    } catch {
      onNotification?.('Erro ao restaurar versão da memória.', 'error');
    }
  };

  const handleToggleStep = async (stepNum: number, currentState: string) => {
    if (!selectedMemory) return;
    const nextStateMap: Record<string, '○' | '→' | '✓' | '✕'> = {
      '○': '→',
      '→': '✓',
      '✓': '✕',
      '✕': '○',
    };
    const nextState = nextStateMap[currentState] || '○';

    try {
      const res = await fetch(`/api/memory/${selectedMemory.id}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepPattern: stepNum,
          newState: nextState,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedMemory(updated);
        setContent(updated.content);
        fetchMemories();
      }
    } catch {
      onNotification?.('Erro ao atualizar etapa na memória.', 'error');
    }
  };

  const handleCreateNewMemory = async () => {
    if (!newMemoryName.trim()) return;
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newMemoryName.trim(),
          projectId,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setIsCreatingNew(false);
        setNewMemoryName('');
        onNotification?.(`Memória "${created.name}" criada com sucesso!`, 'success');
        fetchMemories();
        setSelectedMemory(created);
        setContent(created.content);
      }
    } catch {
      onNotification?.('Erro ao criar nova memória.', 'error');
    }
  };

  // Parse workflow steps from memory content
  const workflowSteps = React.useMemo(() => {
    if (!content) return [];
    const lines = content.split('\n');
    const steps: { state: string; number: number; text: string; full: string }[] = [];
    for (const line of lines) {
      const match = line.match(/^([○→✓✕])\s+(\d+)\.\s+(.*)$/);
      if (match) {
        steps.push({
          state: match[1],
          number: parseInt(match[2], 10),
          text: match[3],
          full: line,
        });
      }
    }
    return steps;
  }, [content]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-5xl h-[88vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="h-14 px-5 border-b border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400">
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white tracking-tight">Memória Compartilhada Viva</h2>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-teal-300 border border-teal-500/20">
                  Persistente & Versionada
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Estado persistente compartilhado entre o humano e os agentes para rastrear pipelines e evitar abordagens falhas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCreatingNew(!isCreatingNew)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nova Memória</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Create new memory bar */}
        {isCreatingNew && (
          <div className="px-5 py-2.5 bg-zinc-800/80 border-b border-zinc-700 flex items-center gap-2 shrink-0 animate-in slide-in-from-top-1">
            <input
              type="text"
              placeholder="Nome da nova memória compartilhada (ex: Projeto Alpha - Arquitetura)..."
              value={newMemoryName}
              onChange={(e) => setNewMemoryName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateNewMemory()}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1 text-xs text-white placeholder-zinc-500 focus:outline-hidden focus:border-teal-500"
            />
            <button
              onClick={handleCreateNewMemory}
              disabled={!newMemoryName.trim()}
              className="px-3 py-1 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition cursor-pointer"
            >
              Criar
            </button>
          </div>
        )}

        {/* Memory Selector Tabs Bar */}
        <div className="px-5 py-2 bg-zinc-950/60 border-b border-zinc-800/80 flex items-center justify-between gap-4 shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            {memories.map((m) => {
              const isSelected = selectedMemory?.id === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => handleSelectMemory(m)}
                  className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-teal-950/60 text-teal-300 border border-teal-500/40 shadow-xs'
                      : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                  }`}
                >
                  <Brain className="w-3 h-3 text-teal-400" />
                  <span>{m.name}</span>
                </button>
              );
            })}
          </div>

          {/* Sub-view Navigation */}
          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 shrink-0">
            <button
              onClick={() => setActiveTab('editor')}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition cursor-pointer flex items-center gap-1 ${
                activeTab === 'editor'
                  ? 'bg-zinc-800 text-white shadow-2xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileText className="w-3 h-3" />
              <span>Editor</span>
            </button>
            <button
              onClick={() => setActiveTab('steps')}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition cursor-pointer flex items-center gap-1 ${
                activeTab === 'steps'
                  ? 'bg-zinc-800 text-white shadow-2xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <ListTodo className="w-3 h-3" />
              <span>Fluxo ({workflowSteps.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('agent')}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition cursor-pointer flex items-center gap-1 ${
                activeTab === 'agent'
                  ? 'bg-teal-900/50 text-teal-300 border border-teal-500/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sparkles className="w-3 h-3 text-teal-400" />
              <span>Agente da Memória</span>
            </button>
            <button
              onClick={() => setActiveTab('versions')}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition cursor-pointer flex items-center gap-1 ${
                activeTab === 'versions'
                  ? 'bg-zinc-800 text-white shadow-2xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <History className="w-3 h-3" />
              <span>Histórico</span>
            </button>
          </div>
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950/30">
          {/* TAB 1: Live Editor */}
          {activeTab === 'editor' && (
            <div className="flex-1 flex flex-col p-4 overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-400">
                  Edição livre da memória. Toda alteração salva gera uma nova versão auditável.
                </span>
                <button
                  onClick={handleSaveContent}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition cursor-pointer shadow-xs"
                >
                  <Save className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
                  <span>{isSaving ? 'Salvando...' : 'Salvar Alterações'}</span>
                </button>
              </div>

              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Insira notas do projeto, fluxo de trabalho e registro de tentativas..."
                className="flex-1 w-full bg-zinc-900/90 border border-zinc-800 rounded-lg p-4 font-mono text-xs text-zinc-200 leading-relaxed resize-none focus:outline-hidden focus:border-teal-500 select-text"
              />
            </div>
          )}

          {/* TAB 2: Interactive Workflow Steps & Attempts */}
          {activeTab === 'steps' && (
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Etapas do Fluxo de Trabalho</h3>
                    <p className="text-xs text-zinc-400">
                      Clique no ícone de cada etapa para alternar o estado: Pendente (○) → Em Andamento (→) → Concluído (✓) → Falhou (✕)
                    </p>
                  </div>
                </div>

                {workflowSteps.length === 0 ? (
                  <div className="p-6 bg-zinc-900/60 border border-zinc-800 rounded-lg text-center text-xs text-zinc-500">
                    Nenhuma etapa numerada no formato "○ 1. Descrição" foi identificada no conteúdo. Você pode adicionar etapas no editor ou usar o Agente da Memória para gerá-las.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {workflowSteps.map((step) => {
                      const isDone = step.state === '✓';
                      const isRunning = step.state === '→';
                      const isFailed = step.state === '✕';

                      return (
                        <div
                          key={step.number}
                          className={`p-3 rounded-lg border flex items-center justify-between gap-3 transition ${
                            isDone
                              ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200'
                              : isRunning
                              ? 'bg-blue-950/20 border-blue-800/40 text-blue-200'
                              : isFailed
                              ? 'bg-rose-950/20 border-rose-800/40 text-rose-200'
                              : 'bg-zinc-900/80 border-zinc-800 text-zinc-300'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleToggleStep(step.number, step.state)}
                              title="Clique para alternar status"
                              className={`w-7 h-7 rounded-md flex items-center justify-center font-bold text-xs transition cursor-pointer shrink-0 ${
                                isDone
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                  : isRunning
                                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40 animate-pulse'
                                  : isFailed
                                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                              }`}
                            >
                              {step.state}
                            </button>
                            <span className="text-xs font-medium">
                              {step.number}. {step.text}
                            </span>
                          </div>

                          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-950/60 text-zinc-400 border border-zinc-800">
                            {isDone ? 'Concluído' : isRunning ? 'Em Andamento' : isFailed ? 'Falhou' : 'Pendente'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Memory Overview Card */}
              <div className="p-4 bg-zinc-900/70 border border-zinc-800 rounded-lg">
                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                  Diretrizes de Operação Ativa
                </h4>
                <ul className="text-xs text-zinc-400 space-y-1.5 list-disc list-inside">
                  <li>O Agente Operacional consulta esta memória antes de propor soluções técnicas.</li>
                  <li>Abordagens marcadas como falhas não são repetidas.</li>
                  <li>Etapas concluídas (✓) são preservadas para evitar retrabalho.</li>
                </ul>
              </div>
            </div>
          )}

          {/* TAB 3: Agente da Memória (Dedicated Isolated Assistant) */}
          {activeTab === 'agent' && (
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="p-4 bg-teal-950/30 border border-teal-800/40 rounded-xl flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-teal-300">
                    Agente da Memória (Totalmente Isolado)
                  </h3>
                  <p className="text-xs text-teal-200/80 leading-relaxed mt-1">
                    Este agente <strong>NÃO</strong> possui ferramentas de sistema, comandos de terminal ou acesso a arquivos externos. Ele é dedicado exclusivamente a organizar, sumarizar, padronizar e refatorar o texto da memória viva com precisão em tempo real.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">
                  Instrução para refatorar ou organizar a memória:
                </label>
                <div className="space-y-3">
                  <textarea
                    rows={4}
                    value={agentPrompt}
                    onChange={(e) => setAgentPrompt(e.target.value)}
                    placeholder="Ex: 'Estruturar o fluxo de trabalho em 5 etapas claras', 'Sintetizar as tentativas falhas para evitar repetição', 'Limpar notas antigas mantendo as decisões técnicas'..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs text-white placeholder-zinc-500 focus:outline-hidden focus:border-teal-500"
                  />

                  {/* Suggestion Chips */}
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'Organizar etapas do fluxo de trabalho',
                      'Sintetizar diagnósticos e registrar falhas',
                      'Limpar notas redundantes',
                      'Formatar para padrão de pipeline operacional',
                    ].map((chip) => (
                      <button
                        key={chip}
                        onClick={() => setAgentPrompt(chip)}
                        className="px-2.5 py-1 text-[11px] bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-md border border-zinc-700/80 transition cursor-pointer"
                      >
                        + {chip}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleRunMemoryAgent}
                    disabled={!agentPrompt.trim() || isAgentRunning}
                    className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition cursor-pointer shadow-xs"
                  >
                    <Sparkles className={`w-4 h-4 ${isAgentRunning ? 'animate-spin' : ''}`} />
                    <span>{isAgentRunning ? 'Agente da Memória processando...' : 'Executar Agente da Memória'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Versions History (Loaded On Demand) */}
          {activeTab === 'versions' && (
            <div className="flex-1 flex overflow-hidden">
              {/* Version List */}
              <div className="w-80 border-r border-zinc-800 flex flex-col shrink-0 bg-zinc-950/40">
                <div className="p-3 border-b border-zinc-800 text-xs text-zinc-400 flex items-center justify-between">
                  <span>Versões Arquivadas</span>
                  <button
                    onClick={() => selectedMemory && fetchVersionsForMemory(selectedMemory.id)}
                    className="text-[11px] text-teal-400 hover:underline cursor-pointer"
                  >
                    Recarregar
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {loadingVersions ? (
                    <div className="py-8 text-center text-xs text-zinc-500">Carregando histórico...</div>
                  ) : versions.length === 0 ? (
                    <div className="py-8 text-center text-xs text-zinc-500">Nenhuma versão anterior registrada.</div>
                  ) : (
                    versions.map((v) => {
                      const isSelected = selectedVersionForCompare?.id === v.id;
                      return (
                        <div
                          key={v.id}
                          onClick={() => setSelectedVersionForCompare(v)}
                          className={`p-3 rounded-lg border transition cursor-pointer ${
                            isSelected
                              ? 'bg-teal-950/30 border-teal-500/50 shadow-xs'
                              : 'bg-zinc-900 border-zinc-800/80 hover:bg-zinc-800/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/30">
                              v{v.versionNumber}
                            </span>
                            <span className="text-[10px] text-zinc-500">
                              {new Date(v.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <p className="text-xs text-zinc-300 line-clamp-2 leading-relaxed">
                            {v.summary || 'Edição registrada'}
                          </p>

                          <div className="mt-2 pt-1 border-t border-zinc-800/60 flex items-center justify-between text-[10px] text-zinc-500">
                            <span className="flex items-center gap-1">
                              {v.author === 'memory-agent' ? (
                                <Bot className="w-3 h-3 text-teal-400" />
                              ) : v.author === 'agent' ? (
                                <Bot className="w-3 h-3 text-blue-400" />
                              ) : (
                                <User className="w-3 h-3 text-zinc-400" />
                              )}
                              {v.author}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Version Preview */}
              <div className="flex-1 flex flex-col overflow-hidden bg-zinc-900/30">
                {selectedVersionForCompare ? (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="p-3 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between shrink-0">
                      <div>
                        <h4 className="text-xs font-semibold text-white">
                          Versão #{selectedVersionForCompare.versionNumber} ({new Date(selectedVersionForCompare.timestamp).toLocaleString()})
                        </h4>
                        <span className="text-[11px] text-zinc-400">
                          Autor: {selectedVersionForCompare.author} • {selectedVersionForCompare.summary}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRestoreVersion(selectedVersionForCompare.id)}
                        className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-xs font-semibold shadow-xs transition cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restaurar Esta Versão</span>
                      </button>
                    </div>

                    <pre className="flex-1 p-4 font-mono text-xs text-zinc-300 overflow-y-auto leading-relaxed whitespace-pre-wrap select-text">
                      {selectedVersionForCompare.content}
                    </pre>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500">
                    <History className="w-10 h-10 text-zinc-700 mb-2" />
                    <p className="text-xs text-zinc-400">
                      Selecione uma versão anterior à esquerda para comparar o conteúdo e restaurar se necessário.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
