import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileEdit,
  FolderOpen,
  Cpu,
  CheckCircle2,
  Loader2,
  AlertCircle,
  FilePlus,
  Eye,
  Check,
} from 'lucide-react';
import { ToolCallStep } from '../types.js';

interface AgentProcessAccordionProps {
  toolCalls: ToolCallStep[];
}

export const AgentProcessAccordion: React.FC<AgentProcessAccordionProps> = ({ toolCalls }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  if (!toolCalls || toolCalls.length === 0) return null;

  const toggleItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const completedCount = toolCalls.filter((t) => t.status === 'completed').length;
  const runningCount = toolCalls.filter((t) => t.status === 'running').length;
  const errorCount = toolCalls.filter((t) => t.status === 'error').length;

  const getToolIcon = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('bash') || n.includes('command') || n.includes('exec')) {
      return <Terminal className="w-3 h-3 text-emerald-400 shrink-0" />;
    }
    if (n.includes('edit') || n.includes('replace') || n.includes('write')) {
      return <FileEdit className="w-3 h-3 text-blue-400 shrink-0" />;
    }
    if (n.includes('create') || n.includes('new')) {
      return <FilePlus className="w-3 h-3 text-indigo-400 shrink-0" />;
    }
    if (n.includes('read') || n.includes('file') || n.includes('dir') || n.includes('view')) {
      return <FolderOpen className="w-3 h-3 text-amber-400 shrink-0" />;
    }
    return <Cpu className="w-3 h-3 text-purple-400 shrink-0" />;
  };

  const getActionText = (tc: ToolCallStep, isRunning: boolean) => {
    const name = tc.toolName.toLowerCase();
    const path =
      tc.parameters?.path ||
      tc.parameters?.TargetFile ||
      tc.parameters?.filePath ||
      tc.parameters?.file ||
      '';
    const filename = path ? path.split('/').filter(Boolean).pop() || path : '';
    const cmd = tc.parameters?.CommandLine || tc.parameters?.command || '';
    const shortCmd = cmd ? (cmd.length > 32 ? cmd.substring(0, 29) + '...' : cmd) : '';

    if (name.includes('edit') || name.includes('replace') || name.includes('write')) {
      if (isRunning) return `Editando arquivo ${filename ? `'${filename}'` : ''}...`;
      return `Editou arquivo ${filename ? `'${filename}'` : ''}`;
    }
    if (name.includes('create') || name.includes('new')) {
      if (isRunning) return `Criando arquivo ${filename ? `'${filename}'` : ''}...`;
      return `Criou arquivo ${filename ? `'${filename}'` : ''}`;
    }
    if (name.includes('read') || name.includes('view') || name.includes('fetch')) {
      if (isRunning) return `Lendo arquivo ${filename ? `'${filename}'` : ''}...`;
      return `Leste arquivo ${filename ? `'${filename}'` : ''}`;
    }
    if (name.includes('list') || name.includes('dir') || name.includes('search') || name.includes('grep')) {
      if (isRunning) return `Analisando diretório ${filename ? `'${filename}'` : ''}...`;
      return `Analisou estrutura do projeto`;
    }
    if (name.includes('bash') || name.includes('command') || name.includes('exec') || name.includes('run')) {
      if (isRunning) return `Executando comando ${shortCmd ? `'${shortCmd}'` : 'no terminal'}...`;
      return `Executou comando ${shortCmd ? `'${shortCmd}'` : 'no terminal'}`;
    }
    if (name.includes('compile') || name.includes('lint') || name.includes('test')) {
      if (isRunning) return `Verificando compilação do código...`;
      return `Código compilado e verificado`;
    }

    if (isRunning) return `Executando ${tc.toolName}...`;
    return `Executou ${tc.toolName}`;
  };

  const activeRunningTool = toolCalls.find((t) => t.status === 'running');
  const lastExecutedTool = toolCalls[toolCalls.length - 1];

  return (
    <div className="my-1 select-text">
      {/* Linha discreta colapsada com indicador dinâmico */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-[11px] text-zinc-300 hover:text-zinc-100 transition cursor-pointer py-1 px-1.5 rounded bg-zinc-900/40 hover:bg-zinc-800/60 border border-zinc-800/50 group"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-zinc-400 group-hover:text-zinc-200 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-zinc-400 group-hover:text-zinc-200 shrink-0" />
        )}

        <div className="flex items-center gap-1.5 min-w-0">
          {activeRunningTool ? (
            <Loader2 className="w-3 h-3 animate-spin text-amber-400 shrink-0" />
          ) : errorCount > 0 ? (
            <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
          )}

          <span className="font-mono text-[11px] font-medium text-zinc-200 truncate">
            {activeRunningTool
              ? getActionText(activeRunningTool, true)
              : lastExecutedTool
              ? getActionText(lastExecutedTool, false)
              : `${toolCalls.length} ações executadas`}
          </span>

          {toolCalls.length > 1 && (
            <span className="text-[10px] text-zinc-500 font-mono shrink-0">
              ({toolCalls.length} ações)
            </span>
          )}
        </div>
      </button>

      {/* Expansão com detalhes da ação */}
      {isExpanded && (
        <div className="mt-1 pl-3 border-l border-zinc-800 space-y-1 text-xs">
          {toolCalls.map((tc) => {
            const isItemOpen = expandedItems[tc.id];
            return (
              <div key={tc.id} className="py-0.5">
                <div
                  onClick={(e) => toggleItem(tc.id, e)}
                  className="flex items-center justify-between gap-2 py-0.5 cursor-pointer hover:bg-white/[0.03] rounded px-1 group/item"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {getToolIcon(tc.toolName)}
                    <span className="font-mono font-medium text-[11px] text-zinc-200 truncate">
                      {getActionText(tc, tc.status === 'running')}
                    </span>
                    <span
                      className={`text-[8.5px] px-1 py-0.1 rounded uppercase font-semibold font-mono ${
                        tc.status === 'completed'
                          ? 'text-emerald-400 bg-emerald-500/10'
                          : tc.status === 'running'
                          ? 'text-amber-400 bg-amber-500/10 animate-pulse'
                          : 'text-rose-400 bg-rose-500/10'
                      }`}
                    >
                      {tc.status}
                    </span>
                  </div>

                  <span className="text-[9.5px] text-zinc-500 font-mono shrink-0">
                    {isItemOpen ? 'ocultar' : 'detalhes'}
                  </span>
                </div>

                {isItemOpen && (
                  <div className="mt-1 pl-4 space-y-1 font-mono text-[10px] text-zinc-400">
                    {tc.parameters && (
                      <div className="p-1.5 rounded bg-zinc-950/80 text-zinc-300 overflow-x-auto max-h-36 border border-zinc-800/60">
                        <pre className="whitespace-pre-wrap break-all">
                          {JSON.stringify(tc.parameters, null, 2)}
                        </pre>
                      </div>
                    )}
                    {tc.result && (
                      <div className="p-1.5 rounded bg-zinc-950/80 text-zinc-400 overflow-x-auto max-h-40 border border-zinc-800/60">
                        <pre className="whitespace-pre-wrap break-all">
                          {tc.result}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
