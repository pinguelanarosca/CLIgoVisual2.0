import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Brain,
  Check,
  RotateCcw,
  Sparkles,
  History,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Copy,
  Bot,
} from 'lucide-react';
import { SharedMemoryItem, ProjectItem, AgentConfig } from '../types.js';

interface SharedMemorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeProject?: ProjectItem | null;
  currentSessionId?: string;
  agents?: AgentConfig[];
  onMemoryChanged?: (memory: SharedMemoryItem) => void;
}

export const SharedMemorySidebar: React.FC<SharedMemorySidebarProps> = ({
  isOpen,
  onClose,
  activeProject,
  currentSessionId,
  agents = [],
  onMemoryChanged,
}) => {
  const [currentMemory, setCurrentMemory] = useState<SharedMemoryItem | null>(null);
  const [editContent, setEditContent] = useState('');
  const [agentInstruction, setAgentInstruction] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('principal');
  const [isAgentProcessing, setIsAgentProcessing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Keep a ref to the latest editContent to prevent stale closures during unmount/close auto-save
  const editContentRef = useRef(editContent);
  const currentMemoryRef = useRef(currentMemory);

  useEffect(() => {
    editContentRef.current = editContent;
  }, [editContent]);

  useEffect(() => {
    currentMemoryRef.current = currentMemory;
  }, [currentMemory]);

  const fetchMemory = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (activeProject?.id) {
        params.set('projectId', activeProject.id);
        params.set('projectName', activeProject.name);
      } else if (currentSessionId) {
        params.set('sessionId', currentSessionId);
      }

      const res = await fetch(`/api/memories?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const effectiveMem: SharedMemoryItem | undefined = data.effective;
        
        if (effectiveMem) {
          setCurrentMemory(effectiveMem);
          setEditContent(effectiveMem.content);
          if (effectiveMem.agentConfig?.agentId) {
            setSelectedAgentId(effectiveMem.agentConfig.agentId);
          }
          if (onMemoryChanged) onMemoryChanged(effectiveMem);
        }
      }
    } catch (err: any) {
      console.error('Falha ao carregar memória compartilhada:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMemory();
      setShowHistory(false);
      setFeedback(null);
    }
  }, [isOpen, activeProject?.id, currentSessionId]);

  // Handle auto-saving on blur or close
  const handleSaveEdit = async (contentToSave: string) => {
    const mem = currentMemoryRef.current;
    if (!mem) return;
    if (contentToSave === mem.content) return; // No changes to save

    try {
      setIsSaving(true);
      const res = await fetch(`/api/memories/${mem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: contentToSave,
          author: 'user',
          versionDescription: 'Edição manual do usuário',
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setCurrentMemory(updated);
        if (onMemoryChanged) onMemoryChanged(updated);
        setFeedback({ type: 'success', message: 'Memória salva automaticamente!' });
        setTimeout(() => setFeedback(null), 2500);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao salvar edições' });
    } finally {
      setIsSaving(false);
    }
  };

  // Safe Close Handler
  const handleClose = async () => {
    const latestContent = editContentRef.current;
    const mem = currentMemoryRef.current;
    if (mem && latestContent !== mem.content) {
      await handleSaveEdit(latestContent);
    }
    onClose();
  };

  const handleRunAgentRefactor = async () => {
    if (!currentMemory || !agentInstruction.trim()) return;
    try {
      setIsAgentProcessing(true);
      setFeedback(null);

      const targetAgent = agents.find((a) => a.id === selectedAgentId);

      const res = await fetch(`/api/memories/${currentMemory.id}/refactor-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: agentInstruction,
          agentId: selectedAgentId,
          model: targetAgent?.model,
        }),
      });

      const data = await res.json();
      if (data.success && data.memory) {
        setCurrentMemory(data.memory);
        setEditContent(data.memory.content);
        setAgentInstruction('');
        if (onMemoryChanged) onMemoryChanged(data.memory);
        setFeedback({
          type: 'success',
          message: `O operador (${targetAgent?.displayName || selectedAgentId}) refinou a memória com sucesso!`,
        });
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setFeedback({
          type: 'error',
          message: data.error || 'Falha ao acionar refinamento pelo Operador',
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
        setCurrentMemory(updated);
        setEditContent(updated.content);
        setShowHistory(false);
        if (onMemoryChanged) onMemoryChanged(updated);
        setFeedback({ type: 'success', message: `Versão v${verNum} restaurada com sucesso!` });
        setTimeout(() => setFeedback(null), 3000);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao restaurar versão' });
    } finally {
      setLoading(false);
    }
  };

  const handleInsertSymbol = (symbol: string) => {
    const textarea = document.getElementById('shared-memory-textarea') as HTMLTextAreaElement;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      const before = text.substring(0, start);
      const after = text.substring(end, text.length);
      const newContent = before + symbol + after;
      setEditContent(newContent);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + symbol.length, start + symbol.length);
      }, 0);
    } else {
      setEditContent((prev) => `${prev}\n${symbol} `);
    }
  };

  const handleCopyContent = () => {
    if (!editContent) return;
    navigator.clipboard.writeText(editContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  const isProjectScoped = Boolean(currentMemory?.projectId || activeProject?.id);

  return (
    <div className="h-full w-full flex flex-col bg-[#0c0c0e]/98 text-zinc-100 select-text overflow-hidden">
      {/* Header */}
      <div className="h-10 px-2.5 border-b border-purple-500/20 flex items-center justify-between shrink-0 bg-zinc-950/90 gap-1.5 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <Brain className="w-4 h-4 text-purple-400 shrink-0" />
          <span className="text-[11px] font-mono font-bold uppercase tracking-tight text-purple-400 truncate">
            MEMÓRIA COMPARTILHADA
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span
            className={`px-1.5 py-0.5 rounded-full border font-mono text-[9.5px] font-semibold flex items-center gap-1 max-w-[140px] truncate ${
              isProjectScoped
                ? 'bg-purple-950/50 border-purple-800/60 text-purple-300'
                : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-300'
            }`}
            title={
              isProjectScoped
                ? `Projeto: ${activeProject?.name || 'Ativo'}`
                : 'Conversa Individual'
            }
          >
            <Layers className="w-2.5 h-2.5 text-purple-400 shrink-0" />
            <span className="truncate">{isProjectScoped ? `${activeProject?.name || 'Projeto'}` : 'Sessão Individual'}</span>
          </span>

          <button
            onClick={handleClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition cursor-pointer shrink-0"
            title="Fechar painel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Feedback & Saving State Alert */}
      {feedback && (
        <div
          className={`px-3 py-1 text-[11px] flex items-center gap-2 border-b shrink-0 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800/40 text-rose-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-3 h-3 shrink-0" />
          ) : (
            <AlertTriangle className="w-3 h-3 shrink-0" />
          )}
          <span className="truncate">{feedback.message}</span>
        </div>
      )}

      {/* Memory Toolbar - Compact, Modern */}
      <div className="px-2.5 py-1.5 border-b border-zinc-800/80 bg-zinc-950/60 flex items-center justify-between gap-1.5 shrink-0">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <span className="text-xs text-zinc-400 truncate">
            {isProjectScoped ? 'Memória Unificada do Projeto' : 'Memória Isolada do Chat'}
          </span>
          {isSaving && (
            <span className="text-[10px] text-purple-400 font-mono animate-pulse flex items-center gap-1 shrink-0 ml-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500 inline-block" />
              Salvando...
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopyContent}
            className="p-1 rounded bg-zinc-850 hover:bg-zinc-750 text-zinc-300 transition cursor-pointer text-xs shrink-0 flex items-center gap-1 px-2 border border-zinc-850/40"
            title="Copiar texto da memória"
          >
            {copied ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
            <span className="text-[10.5px]">Copiar</span>
          </button>

          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`p-1 px-2 rounded text-xs font-medium transition cursor-pointer flex items-center gap-1 shrink-0 border ${
              showHistory
                ? 'bg-purple-600/30 text-purple-300 border-purple-500/40'
                : 'bg-zinc-850 hover:bg-zinc-750 text-zinc-300 border-zinc-850/40'
            }`}
            title="Histórico de alterações"
          >
            <History className="w-3 h-3" />
            <span className="text-[10.5px]">Histórico</span>
          </button>
        </div>
      </div>

      {/* Quick Status Markers - Always Available */}
      <div className="px-3 py-1 bg-zinc-950/30 border-b border-zinc-800 flex items-center gap-1.5 text-xs overflow-x-auto shrink-0 select-none">
        <span className="text-[10px] text-zinc-500 shrink-0 uppercase font-mono tracking-wider">Pipeline:</span>
        <button
          type="button"
          onClick={() => handleInsertSymbol('○')}
          className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer font-mono text-[10.5px] shrink-0"
          title="○ Pendente"
        >
          ○ Pendente
        </button>
        <button
          type="button"
          onClick={() => handleInsertSymbol('→')}
          className="px-1.5 py-0.5 rounded bg-blue-950/60 border border-blue-900/40 text-blue-300 hover:bg-blue-900 cursor-pointer font-mono text-[10.5px] shrink-0"
          title="→ Em andamento"
        >
          → Em andamento
        </button>
        <button
          type="button"
          onClick={() => handleInsertSymbol('✓')}
          className="px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-900/40 text-emerald-300 hover:bg-emerald-900 cursor-pointer font-mono text-[10.5px] shrink-0"
          title="✓ Concluído"
        >
          ✓ Concluído
        </button>
        <button
          type="button"
          onClick={() => handleInsertSymbol('✕')}
          className="px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-900/40 text-rose-300 hover:bg-rose-900 cursor-pointer font-mono text-[10.5px] shrink-0"
          title="✕ Falhou"
        >
          ✕ Falhou
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Editor (Textarea is always active and ready) */}
        <div className="flex-1 p-3 overflow-y-auto flex flex-col">
          <textarea
            id="shared-memory-textarea"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onBlur={() => handleSaveEdit(editContent)}
            className="w-full flex-1 min-h-[180px] bg-zinc-950/20 border border-zinc-800/90 rounded-lg p-3 font-mono text-xs text-zinc-200 outline-hidden focus:border-purple-500/50 resize-none leading-relaxed focus:bg-zinc-900/20"
            placeholder="Sua memória de trabalho. Digite pipelines, status de tarefas (○, →, ✓, ✕), decisões técnicas ou notas de progresso. É salvo automaticamente ao fechar ou clicar fora."
          />
        </div>

        {/* Memory Agent Section */}
        <div className="p-3 border-t border-zinc-800/80 bg-zinc-950/90 flex flex-col gap-2.5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
              <Bot className="w-3.5 h-3.5 text-purple-400" />
              <span>Operador de Memória</span>
            </div>
          </div>

          {/* Agent/Operator Selector */}
          <div className="flex items-center gap-1.5">
            <label className="text-[11px] text-zinc-400 shrink-0 font-mono">
              OPERADOR:
            </label>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-xs text-zinc-200 outline-hidden cursor-pointer truncate font-mono text-[11px]"
            >
              {(agents && agents.length > 0 ? agents : [
                { id: 'principal', name: 'Principal Orchestrator' },
                { id: 'architect', name: 'Software Architect' },
                { id: 'investigator', name: 'Code Investigator' },
                { id: 'auditor', name: 'Security Auditor' },
                { id: 'worker', name: 'Task Worker' },
              ]).map((a: any) => (
                <option key={a.id} value={a.id} className="bg-zinc-950 text-zinc-200">
                  {a.displayName || a.name} ({a.model || 'Gemini'})
                </option>
              ))}
            </select>
          </div>

          {/* Refactor Instruction Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-zinc-400 font-mono uppercase tracking-wider">
              Instruções de Refatoração:
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={agentInstruction}
                onChange={(e) => setAgentInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (agentInstruction.trim() && !isAgentProcessing) {
                      handleRunAgentRefactor();
                    }
                  }
                }}
                disabled={isAgentProcessing}
                placeholder="Ex: Organize as tarefas concluídas, resuma as decisões..."
                className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 outline-hidden focus:border-purple-500/60 truncate"
              />

              <button
                onClick={handleRunAgentRefactor}
                disabled={isAgentProcessing || !agentInstruction.trim()}
                className="px-3.5 py-1.5 rounded text-xs font-semibold bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white transition cursor-pointer flex items-center gap-1 shrink-0 font-mono uppercase tracking-tight"
                title="Executar refatoração com operador selecionado"
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

        {/* Versions History Drawer */}
        {showHistory && (
          <div className="border-t border-zinc-800 bg-zinc-950 p-3 max-h-52 overflow-y-auto space-y-2 text-xs shrink-0 select-none">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-zinc-300">
                Histórico de Alterações da Memória
              </span>
              <button
                onClick={() => setShowHistory(false)}
                className="text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                Fechar
              </button>
            </div>

            {currentMemory?.versions && currentMemory.versions.length > 0 ? (
              currentMemory.versions.map((ver) => (
                <div
                  key={ver.version}
                  className="p-2 rounded bg-zinc-900/60 border border-zinc-800/80 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-purple-400 text-xs">
                      v{ver.version}
                    </span>
                    <button
                      onClick={() => handleRestoreVersion(ver.version)}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-750 transition cursor-pointer flex items-center gap-1 border border-zinc-850"
                      title="Restaurar esta versão"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>Restaurar</span>
                    </button>
                  </div>

                  <p className="text-[10.5px] text-zinc-400 line-clamp-2 font-mono">
                    {ver.description || (ver.author === 'agent' ? 'Operador de Memória' : 'Edição Manual')}
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
              ))
            ) : (
              <p className="text-[11px] text-zinc-500 font-mono text-center py-4">Nenhuma versão anterior gravada.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
