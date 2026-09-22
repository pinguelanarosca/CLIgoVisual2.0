import React, { useState, useEffect } from 'react';
import {
  X,
  Brain,
  Edit3,
  Check,
  RotateCcw,
  Sparkles,
  History,
  Plus,
  Trash2,
  Save,
  Loader2,
  ListTodo,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { SharedMemoryItem, MemoryVersionEntry } from '../types.js';
import { fetchJsonSafely } from '../utils/apiUtils.js';

interface SharedMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeMemoryId?: string;
  onSelectMemory?: (id: string) => void;
}

export const SharedMemoryModal: React.FC<SharedMemoryModalProps> = ({
  isOpen,
  onClose,
  activeMemoryId,
  onSelectMemory,
}) => {
  const [memories, setMemories] = useState<SharedMemoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [agentInstruction, setAgentInstruction] = useState('');
  const [isAgentProcessing, setIsAgentProcessing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchMemories = async () => {
    try {
      setLoading(true);
      const data = await fetchJsonSafely<SharedMemoryItem[]>('/api/memories', undefined, []);
      if (data && Array.isArray(data)) {
        setMemories(data);
        if (data.length > 0) {
          const current = activeMemoryId && data.find((m: any) => m.id === activeMemoryId) ? activeMemoryId : data[0].id;
          setSelectedId(current);
          const currentMem = data.find((m: any) => m.id === current);
          if (currentMem) {
            setEditContent(currentMem.content);
          }
        }
      }
    } catch (err: any) {
      console.error('Falha ao obter memórias:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMemories();
      setIsEditing(false);
      setShowHistory(false);
      setFeedback(null);
    }
  }, [isOpen, activeMemoryId]);

  const currentMemory = memories.find((m) => m.id === selectedId);

  const handleSelectMemory = (id: string) => {
    setSelectedId(id);
    const target = memories.find((m) => m.id === id);
    if (target) {
      setEditContent(target.content);
    }
    setIsEditing(false);
    setShowHistory(false);
    if (onSelectMemory) onSelectMemory(id);
  };

  const handleSaveEdit = async () => {
    if (!currentMemory) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/memories/${currentMemory.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: editContent,
          author: 'user',
          versionDescription: 'Edição manual do usuário',
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setMemories((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        setIsEditing(false);
        setFeedback({ type: 'success', message: 'Memória salva com nova versão gerada!' });
        setTimeout(() => setFeedback(null), 3000);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao salvar edição' });
    } finally {
      setLoading(false);
    }
  };

  const handleRunAgentRefactor = async () => {
    if (!currentMemory || !agentInstruction.trim()) return;
    try {
      setIsAgentProcessing(true);
      setFeedback(null);

      const res = await fetch(`/api/memories/${currentMemory.id}/refactor-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: agentInstruction }),
      });

      const data = await res.json();
      if (data.success && data.memory) {
        setMemories((prev) => prev.map((m) => (m.id === data.memory.id ? data.memory : m)));
        setEditContent(data.memory.content);
        setAgentInstruction('');
        setFeedback({
          type: 'success',
          message: 'Agente da Memória refatorou e atualizou a memória com sucesso!',
        });
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setFeedback({
          type: 'error',
          message: data.error || 'Falha ao acionar Agente da Memória',
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Erro na requisição' });
    } finally {
      setIsAgentProcessing(false);
    }
  };

  const handleRestoreVersion = async (verNum: number) => {
    if (!currentMemory) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/memories/${currentMemory.id}/restore-version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: verNum }),
      });

      if (res.ok) {
        const updated = await res.json();
        setMemories((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        setEditContent(updated.content);
        setShowHistory(false);
        setFeedback({ type: 'success', message: `Versão v${verNum} restaurada como nova versão!` });
        setTimeout(() => setFeedback(null), 3000);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao restaurar versão' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNewMemory = async () => {
    const name = prompt('Nome da nova memória compartilhada:');
    if (!name || !name.trim()) return;

    try {
      setLoading(true);
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (res.ok) {
        const created = await res.json();
        setMemories((prev) => [...prev, created]);
        handleSelectMemory(created.id);
      }
    } catch (err: any) {
      console.error('Falha ao criar memória:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInsertSymbol = (symbol: string) => {
    setEditContent((prev) => `${prev}\n${symbol} `);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 select-text">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-900/70">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Memória Compartilhada Persistente
            </h2>
            {currentMemory && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/50">
                v{currentMemory.versions.length}
              </span>
            )}
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`px-4 py-1.5 text-xs flex items-center gap-2 border-b shrink-0 ${
              feedback.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Top Controls: Selector & Actions */}
        <div className="px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between gap-2 overflow-x-auto shrink-0">
          <div className="flex items-center gap-2">
            <select
              value={selectedId}
              onChange={(e) => handleSelectMemory(e.target.value)}
              className="bg-zinc-900 border border-zinc-700/80 rounded px-2.5 py-1 text-xs text-zinc-200 outline-hidden font-medium cursor-pointer"
            >
              {memories.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (v{m.versions.length})
                </option>
              ))}
            </select>

            <button
              onClick={handleCreateNewMemory}
              className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition cursor-pointer text-xs flex items-center gap-1 px-2"
              title="Criar nova memória"
            >
              <Plus className="w-3 h-3" />
              <span>Nova</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {isEditing ? (
              <>
                <button
                  onClick={handleSaveEdit}
                  disabled={loading}
                  className="px-2.5 py-1 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer flex items-center gap-1"
                >
                  <Save className="w-3 h-3" />
                  <span>Salvar</span>
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    if (currentMemory) setEditContent(currentMemory.content);
                  }}
                  className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="px-2.5 py-1 rounded text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition cursor-pointer flex items-center gap-1"
                title="Editar texto diretamente"
              >
                <Edit3 className="w-3 h-3" />
                <span>Editar</span>
              </button>
            )}

            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer flex items-center gap-1 ${
                showHistory
                  ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
              }`}
            >
              <History className="w-3 h-3" />
              <span>Histórico (v{currentMemory?.versions.length || 1})</span>
            </button>
          </div>
        </div>

        {/* Quick Symbols Bar for Pipeline States */}
        {isEditing && (
          <div className="px-3 py-1 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2 text-xs">
            <span className="text-[10px] text-zinc-500">Marcadores de Status:</span>
            <button
              type="button"
              onClick={() => handleInsertSymbol('○')}
              className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 cursor-pointer font-mono"
              title="○ Pendente"
            >
              ○ Pendente
            </button>
            <button
              type="button"
              onClick={() => handleInsertSymbol('→')}
              className="px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 hover:bg-blue-900 cursor-pointer font-mono"
              title="→ Em andamento"
            >
              → Em andamento
            </button>
            <button
              type="button"
              onClick={() => handleInsertSymbol('✓')}
              className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 hover:bg-emerald-900 cursor-pointer font-mono"
              title="✓ Concluído"
            >
              ✓ Concluído
            </button>
            <button
              type="button"
              onClick={() => handleInsertSymbol('✕')}
              className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 hover:bg-rose-900 cursor-pointer font-mono"
              title="✕ Falhou"
            >
              ✕ Falhou
            </button>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Editor / Viewer */}
          <div className="flex-1 flex flex-col p-3 overflow-y-auto">
            {isEditing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full flex-1 min-h-[220px] bg-zinc-900/80 border border-zinc-800 rounded p-2.5 font-mono text-xs text-zinc-200 outline-hidden focus:border-purple-500/60 resize-none leading-relaxed"
                placeholder="Insira o contexto, pipeline de tarefas ou decisões..."
              />
            ) : (
              <div className="flex-1 min-h-[220px] p-2.5 rounded bg-zinc-900/40 border border-zinc-800/80 overflow-y-auto font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {currentMemory?.content || 'Nenhum conteúdo registrado nesta memória.'}
              </div>
            )}

            {/* Instruction for Memory Agent (Agente Recluso) */}
            <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  Agente da Memória (Agente Recluso)
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">
                  Isolado do SO • Refatora e organiza em tempo real
                </span>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={agentInstruction}
                  onChange={(e) => setAgentInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleRunAgentRefactor();
                    }
                  }}
                  disabled={isAgentProcessing}
                  placeholder="Ex: Organize o fluxo em tarefas e destaque o erro atual..."
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 outline-hidden focus:border-purple-500/60"
                />

                <button
                  onClick={handleRunAgentRefactor}
                  disabled={isAgentProcessing || !agentInstruction.trim()}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white transition cursor-pointer flex items-center gap-1.5 shrink-0"
                >
                  {isAgentProcessing ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Processando...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3" />
                      <span>Refatorar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Versions History Sidebar */}
          {showHistory && (
            <div className="w-64 border-l border-zinc-800/80 bg-zinc-900/60 p-3 overflow-y-auto space-y-2 text-xs">
              <span className="text-xs font-semibold text-zinc-200 block mb-2">
                Histórico de Versões
              </span>

              {currentMemory?.versions.map((ver) => (
                <div
                  key={ver.version}
                  className="p-2 rounded bg-zinc-900 border border-zinc-800/80 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-purple-400">
                      v{ver.version}
                    </span>
                    <button
                      onClick={() => handleRestoreVersion(ver.version)}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 transition cursor-pointer flex items-center gap-1"
                      title="Restaurar esta versão"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>Restaurar</span>
                    </button>
                  </div>

                  <p className="text-[10px] text-zinc-400 line-clamp-2">
                    {ver.description || (ver.author === 'agent' ? 'Refatoração Agente' : 'Edição Manual')}
                  </p>

                  <span className="text-[9px] text-zinc-500 block">
                    {new Date(ver.timestamp).toLocaleString([], {
                      month: 'short',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
