import React, { useState } from 'react';
import {
  MessageSquare,
  Plus,
  Search,
  Trash2,
  FolderGit2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Zap,
  Sparkles,
  Terminal,
  MoreVertical,
  Archive,
  History,
  FolderCheck,
  CheckSquare,
  Square,
  X,
  FileCheck2,
  Folder,
  FolderOpen,
  Files,
  Activity,
} from 'lucide-react';
import { SessionItem, ProjectItem } from '../types.js';
import { calculateSessionTokens, formatTokenCount } from '../utils/tokenUtils.js';

interface LeftSidebarProps {
  isExpanded: boolean;
  onToggleExpand: () => void;
  sessions: SessionItem[];
  currentSessionId: string;
  onSelectSession: (session: SessionItem) => void;
  onNewSession: (projectId?: string | null) => void;
  onDeleteSession: (id: string) => void;
  projects: ProjectItem[];
  activeProject: ProjectItem | null;
  onSelectProject: (proj: ProjectItem) => void;
  onOpenProjectsModal: () => void;
  onOpenSettings: (tab?: string) => void;

  // Docked panels
  onOpenFiles?: () => void;
  onOpenDirsModal: () => void;
  onOpenHistory: () => void;
  onOpenArchivedChats: () => void;
  onOpenContext?: () => void;
  onOpenChatContext?: (session: SessionItem) => void;
  onOpenLogs?: () => void;
  activeRightPanelMode?: string | null;
  onUpdateSession: (id: string, updates: Partial<SessionItem>) => void;
  onDeriveSession: (sess: SessionItem) => void;
  selectedSessionIds: string[];
  setSelectedSessionIds: React.Dispatch<React.SetStateAction<string[]>>;
  onDeleteMultipleSessions: (ids: string[]) => void;
  onArchiveMultipleSessions: (ids: string[]) => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  isExpanded,
  onToggleExpand,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  projects,
  activeProject,
  onSelectProject,
  onOpenProjectsModal,
  onOpenSettings,

  onOpenFiles,
  onOpenDirsModal,
  onOpenHistory,
  onOpenArchivedChats,
  onOpenContext,
  onOpenChatContext,
  onOpenLogs,
  activeRightPanelMode,
  onUpdateSession,
  onDeriveSession,
  selectedSessionIds,
  setSelectedSessionIds,
  onDeleteMultipleSessions,
  onArchiveMultipleSessions,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [activeMenuSessionId, setActiveMenuSessionId] = useState<string | null>(null);
  const [showProjMenuId, setShowProjMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  const handleOpenMenu = (sessId: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (activeMenuSessionId === sessId) {
      setActiveMenuSessionId(null);
      setMenuPos(null);
      setConfirmDeleteId(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 220;

    setActiveMenuSessionId(sessId);
    setShowProjMenuId(null);
    setConfirmDeleteId(null);

    if (openUp) {
      setMenuPos({
        bottom: window.innerHeight - rect.top + 4,
        left: Math.max(10, Math.min(window.innerWidth - 188, rect.right - 176)),
      });
    } else {
      setMenuPos({
        top: rect.bottom + 4,
        left: Math.max(10, Math.min(window.innerWidth - 188, rect.right - 176)),
      });
    }
  };

  const toggleProjectExpand = (projId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projId]: prev[projId] === false ? true : false,
    }));
  };

  // 1. Filtered non-archived sessions
  const nonArchivedSessions = sessions.filter((s) => s.isArchived !== true);
  const archivedSessionsCount = sessions.filter((s) => s.isArchived === true).length;

  const matchesSearch = (s: SessionItem) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const titleMatch = (s.title || '').toLowerCase().includes(term);
    const msgMatch = s.messages?.some((m) => m.content.toLowerCase().includes(term));
    return titleMatch || msgMatch;
  };

  const filteredSessions = nonArchivedSessions.filter(matchesSearch);

  // 2. Separate into Free Chats vs Project Chats
  const freeSessions = filteredSessions.filter((s) => !s.projectId || !projects.some((p) => p.id === s.projectId));
  const getProjectSessions = (projId: string) => filteredSessions.filter((s) => s.projectId === projId);

  const toggleSelectSession = (sessId: string) => {
    setSelectedSessionIds((prev) =>
      prev.includes(sessId) ? prev.filter((id) => id !== sessId) : [...prev, sessId]
    );
  };

  const handleBatchDelete = () => {
    if (confirm(`Deseja realmente excluir as ${selectedSessionIds.length} conversas selecionadas?`)) {
      onDeleteMultipleSessions(selectedSessionIds);
      setSelectedSessionIds([]);
      setIsSelectionMode(false);
    }
  };

  const handleBatchArchive = () => {
    onArchiveMultipleSessions(selectedSessionIds);
    setSelectedSessionIds([]);
    setIsSelectionMode(false);
  };

  const renderChatItem = (sess: SessionItem, isProjectChat: boolean) => {
    const isActive = sess.id === currentSessionId;
    const tokenStats = calculateSessionTokens(sess.messages || []);
    const totalTokens = tokenStats.totalTokens;
    const isSelected = selectedSessionIds.includes(sess.id);

    if (!isExpanded) {
      return (
        <button
          key={sess.id}
          onClick={() => {
            if (isSelectionMode) {
              toggleSelectSession(sess.id);
            } else {
              onSelectSession(sess);
            }
          }}
          title={`${sess.title || 'Conversa'} (${formatTokenCount(totalTokens)} tokens)`}
          className={`w-8 h-8 mx-auto rounded-md flex items-center justify-center relative transition cursor-pointer ${
            isSelected
              ? 'bg-blue-600 text-white shadow-2xs'
              : isActive
              ? 'bg-blue-900/50 text-white border border-blue-500/40'
              : 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          {isSelected && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 rounded-full border border-zinc-900" />
          )}
        </button>
      );
    }

    return (
      <div
        key={sess.id}
        className={`group relative flex items-center justify-between px-1.5 py-1 rounded-md transition cursor-pointer border ${
          isActive
            ? 'bg-blue-900/30 border-blue-500/40 text-white'
            : 'bg-transparent border-transparent hover:bg-zinc-800/60 text-zinc-300'
        }`}
        onClick={() => {
          if (isSelectionMode) {
            toggleSelectSession(sess.id);
          } else {
            onSelectSession(sess);
          }
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
          {/* Selection Checkbox */}
          {isSelectionMode ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSelectSession(sess.id);
              }}
              className="shrink-0 text-blue-400 hover:text-blue-300"
            >
              {isSelected ? (
                <CheckSquare className="w-3.5 h-3.5" />
              ) : (
                <Square className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-400" />
              )}
            </button>
          ) : (
            <MessageSquare
              className={`w-3.5 h-3.5 shrink-0 ${
                isActive ? 'text-blue-400' : 'text-zinc-500'
              }`}
            />
          )}

          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-medium truncate leading-tight">
              {sess.title || 'Nova Conversa'}
            </div>

            <div className="flex items-center gap-1 text-[9.5px] text-zinc-500 font-mono leading-tight">
              <span>{sess.messages?.length || 0} msgs</span>
              <span>•</span>
              <span className="flex items-center text-amber-400 font-semibold">
                <Zap className="w-2.5 h-2.5 mr-0.5" />
                {formatTokenCount(totalTokens)}
              </span>
            </div>
          </div>
        </div>

        {/* Individual Chat Options Trigger Button */}
        {!isSelectionMode && (
          <div className="shrink-0">
            <button
              onClick={(e) => handleOpenMenu(sess.id, e)}
              title="Opções"
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
            >
              <MoreVertical className="w-3 h-3" />
            </button>

            {/* Options Dropdown Menu (Fixed Positioning to prevent overflow clipping) */}
            {activeMenuSessionId === sess.id && menuPos && (
              <div
                className="fixed w-44 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl p-1 shadow-2xl z-50 text-xs animate-in fade-in duration-100"
                style={{
                  top: menuPos.top !== undefined ? `${menuPos.top}px` : undefined,
                  bottom: menuPos.bottom !== undefined ? `${menuPos.bottom}px` : undefined,
                  left: `${menuPos.left}px`,
                }}
              >
                {/* Option: Contexto & Tokens */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onOpenChatContext) {
                      onOpenChatContext(sess);
                    } else if (onOpenContext) {
                      onOpenContext();
                    }
                    setActiveMenuSessionId(null);
                  }}
                  className="w-full text-left px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white flex items-center gap-1.5 transition cursor-pointer text-xs"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Contexto & Tokens</span>
                </button>

                {/* Option: Derivar Chat */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeriveSession(sess);
                    setActiveMenuSessionId(null);
                  }}
                  className="w-full text-left px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white flex items-center gap-1.5 transition cursor-pointer text-xs"
                >
                  <FileCheck2 className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                  <span>Derivar Chat</span>
                </button>

                {/* Option: Mover / Adicionar a Projeto... */}
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowProjMenuId(showProjMenuId === sess.id ? null : sess.id);
                    }}
                    className="w-full text-left px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white flex items-center justify-between gap-1.5 transition cursor-pointer text-xs"
                  >
                    <span className="flex items-center gap-1.5">
                      <FolderGit2 className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                      <span>{isProjectChat ? 'Mover...' : 'Adicionar...'}</span>
                    </span>
                    <ChevronRight className="w-3 h-3 text-zinc-500" />
                  </button>

                  {/* Submenu Projects */}
                  {showProjMenuId === sess.id && (
                    <div className="absolute left-full ml-1 top-0 w-36 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl p-1 shadow-2xl z-50 text-[11px]">
                      {isProjectChat && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onUpdateSession(sess.id, { projectId: undefined });
                            setActiveMenuSessionId(null);
                            setShowProjMenuId(null);
                          }}
                          className="w-full text-left px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-amber-600 dark:text-amber-300 truncate transition cursor-pointer font-medium mb-0.5 border-b border-zinc-200 dark:border-zinc-700"
                        >
                          🌐 Chat Livre
                        </button>
                      )}
                      {projects.map((proj) => (
                        <button
                          key={proj.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onUpdateSession(sess.id, { projectId: proj.id });
                            setActiveMenuSessionId(null);
                            setShowProjMenuId(null);
                          }}
                          className="w-full text-left px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white truncate transition cursor-pointer"
                        >
                          📁 {proj.name}
                        </button>
                      ))}
                      {projects.length === 0 && (
                        <div className="p-1 text-zinc-500 text-center text-[10px]">Sem projetos</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Option: Arquivar */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateSession(sess.id, { isArchived: true });
                    setActiveMenuSessionId(null);
                  }}
                  className="w-full text-left px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white flex items-center gap-1.5 transition cursor-pointer text-xs"
                >
                  <Archive className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Arquivar</span>
                </button>

                <div className="h-px bg-zinc-200 dark:bg-zinc-700 my-0.5" />

                {/* Option: Remover / Confirmar Exclusão */}
                {confirmDeleteId === sess.id ? (
                  <div className="p-1.5 bg-rose-500/10 dark:bg-rose-950/40 rounded border border-rose-500/30 text-xs space-y-1 my-0.5">
                    <p className="text-[10px] font-medium text-rose-600 dark:text-rose-300">Excluir conversa?</p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(sess.id);
                          setActiveMenuSessionId(null);
                          setConfirmDeleteId(null);
                        }}
                        className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold transition cursor-pointer"
                      >
                        Excluir
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                        }}
                        className="px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[10px] transition cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(sess.id);
                    }}
                    className="w-full text-left px-2 py-1 hover:bg-rose-50 dark:hover:bg-rose-900/40 rounded text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 flex items-center gap-1.5 transition cursor-pointer text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                    <span>Remover</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      className={`h-full bg-zinc-900 border-r border-zinc-800 flex flex-col transition-all duration-300 z-20 shrink-0 text-zinc-300 select-none ${
        isExpanded ? 'w-56' : 'w-12'
      }`}
    >
      {/* Sidebar Header & Brand */}
      <div className="p-1.5 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
        {isExpanded ? (
          <div className="flex items-center gap-1.5 overflow-hidden">
            <div className="w-6 h-6 rounded bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-2xs shrink-0">
              <Terminal className="w-3 h-3" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-zinc-100 text-xs tracking-tight truncate">
                Gemini Code
              </span>
            </div>
          </div>
        ) : (
          <div className="w-6 h-6 mx-auto rounded bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-2xs shrink-0">
            <Terminal className="w-3 h-3" />
          </div>
        )}

        <button
          onClick={onToggleExpand}
          title={isExpanded ? 'Recolher Barra Lateral' : 'Expandir Barra Lateral'}
          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
        >
          {isExpanded ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
      </div>

      {/* Primary Action: Novo Chat Livre */}
      <div className="p-1.5 shrink-0">
        <button
          onClick={() => onNewSession(null)}
          title="Novo Chat Livre"
          className={`w-full flex items-center justify-center gap-1 py-1.5 px-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-2xs transition active:scale-98 cursor-pointer ${
            !isExpanded ? 'px-0' : ''
          }`}
        >
          <Plus className="w-3.5 h-3.5 shrink-0" />
          {isExpanded && <span>Novo Chat</span>}
        </button>
      </div>

      {/* Controls Bar: Search & Multi-select */}
      {isExpanded && (
        <div className="px-1.5 pb-1.5 space-y-1 border-b border-zinc-800/60 shrink-0">
          <div className="flex items-center justify-between text-[9.5px] uppercase font-mono text-zinc-400 font-semibold tracking-wider">
            <span>Chats</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setIsSelectionMode(!isSelectionMode);
                  setSelectedSessionIds([]);
                }}
                title={isSelectionMode ? 'Cancelar seleção' : 'Selecionar vários'}
                className={`p-0.5 rounded transition cursor-pointer ${
                  isSelectionMode ? 'bg-blue-600/30 text-blue-400' : 'hover:bg-zinc-800 text-zinc-400'
                }`}
              >
                <CheckSquare className="w-3 h-3" />
              </button>
              <span className="bg-zinc-800 text-zinc-400 px-1 py-0.2 rounded text-[9px] font-sans">
                {nonArchivedSessions.length}
              </span>
            </div>
          </div>

          {/* Batch actions bar in selection mode */}
          {isSelectionMode && selectedSessionIds.length > 0 && (
            <div className="flex items-center justify-between p-1 rounded bg-zinc-800/80 border border-zinc-700/60 text-xs gap-1">
              <span className="font-medium text-[10.5px] text-zinc-300">
                {selectedSessionIds.length} sel.
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={handleBatchArchive}
                  title="Arquivar selecionados"
                  className="p-1 hover:bg-zinc-700 rounded text-blue-400 hover:text-blue-300 transition cursor-pointer"
                >
                  <Archive className="w-3 h-3" />
                </button>
                <button
                  onClick={handleBatchDelete}
                  title="Excluir selecionados"
                  className="p-1 hover:bg-zinc-700 rounded text-rose-400 hover:text-rose-300 transition cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                <button
                  onClick={() => {
                    setIsSelectionMode(false);
                    setSelectedSessionIds([]);
                  }}
                  title="Fechar seleção"
                  className="p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1.5 text-zinc-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar..."
              className="w-full bg-zinc-800/80 text-xs text-zinc-200 pl-6 pr-2 py-0.5 rounded border border-zinc-700/60 placeholder-zinc-500 outline-none focus:border-blue-500 transition"
            />
          </div>
        </div>
      )}

      {/* Main Categories Container */}
      <div className="flex-1 overflow-y-auto px-1 py-1 space-y-2">
        {/* Category: CHATS DO PROJETO */}
        {isExpanded && (
          <div className="space-y-0.5">
            <div className="flex items-center justify-between px-1 text-[9.5px] uppercase font-mono text-zinc-400 font-semibold tracking-wider">
              <span className="flex items-center gap-1">
                <FolderGit2 className="w-3 h-3 text-blue-400" />
                Projetos
              </span>
              <button
                onClick={onOpenProjectsModal}
                title="Gerenciar Projetos"
                className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer text-[9.5px] font-sans font-medium"
              >
                + Gerenciar
              </button>
            </div>

            {projects.length === 0 ? (
              <div className="p-1.5 bg-zinc-800/30 border border-dashed border-zinc-800 rounded text-center">
                <p className="text-[9.5px] text-zinc-500 mb-0.5">Sem projetos.</p>
                <button
                  onClick={onOpenProjectsModal}
                  className="text-[9.5px] text-blue-400 hover:text-blue-300 font-medium hover:underline cursor-pointer"
                >
                  + Criar Projeto
                </button>
              </div>
            ) : (
              projects.map((proj) => {
                const projChats = getProjectSessions(proj.id);
                const isSelectedProj = activeProject?.id === proj.id;
                const isExpandedProj = expandedProjects[proj.id] !== false;

                return (
                  <div
                    key={proj.id}
                    className={`rounded border transition overflow-hidden ${
                      isSelectedProj
                        ? 'bg-zinc-800/90 border-blue-500/40'
                        : 'bg-zinc-900/60 border-zinc-800/80 hover:border-zinc-700/80'
                    }`}
                  >
                    {/* Project Header Row */}
                    <div
                      onClick={() => {
                        onSelectProject(proj);
                        toggleProjectExpand(proj.id);
                      }}
                      className="p-1 flex items-center justify-between gap-1 cursor-pointer hover:bg-zinc-800/50 transition"
                    >
                      <div className="flex items-center gap-1 min-w-0 flex-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleProjectExpand(proj.id);
                          }}
                          className="p-0.5 text-zinc-400 hover:text-zinc-200"
                        >
                          {isExpandedProj ? (
                            <ChevronDown className="w-3 h-3 text-zinc-400" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-zinc-400" />
                          )}
                        </button>
                        {isExpandedProj ? (
                          <FolderOpen className="w-3 h-3 text-blue-400 shrink-0" />
                        ) : (
                          <Folder className="w-3 h-3 text-zinc-400 shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-zinc-200 truncate">
                          {proj.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-zinc-800 text-zinc-400">
                          {projChats.length}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectProject(proj);
                            onNewSession(proj.id);
                          }}
                          title={`Novo chat em '${proj.name}'`}
                          className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 hover:text-white text-[9px] font-medium transition cursor-pointer"
                        >
                          <Plus className="w-2.5 h-2.5" />
                          <span>Chat</span>
                        </button>
                      </div>
                    </div>

                    {/* Project Chats Nested List */}
                    {isExpandedProj && (
                      <div className="pl-1.5 pr-0.5 pb-0.5 space-y-0.5 border-t border-zinc-800/40 pt-0.5">
                        {projChats.length === 0 ? (
                          <button
                            onClick={() => {
                              onSelectProject(proj);
                              onNewSession(proj.id);
                            }}
                            className="w-full text-left p-1 rounded bg-zinc-800/20 hover:bg-zinc-800/50 text-[9.5px] text-zinc-400 hover:text-blue-300 transition flex items-center gap-1 cursor-pointer border border-dashed border-zinc-800"
                          >
                            <Plus className="w-2.5 h-2.5 text-blue-400" />
                            <span>Iniciar conversa</span>
                          </button>
                        ) : (
                          projChats.map((sess) => renderChatItem(sess, true))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Category: CONVERSAS LIVRES (Chat Livre) */}
        <div className="space-y-0.5">
          {isExpanded && (
            <div className="flex items-center justify-between px-1 text-[9.5px] uppercase font-mono text-zinc-400 font-semibold tracking-wider">
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3 text-emerald-400" />
                Conversas
              </span>
              <span className="bg-zinc-800 text-zinc-400 px-1 py-0.2 rounded text-[9px] font-sans">
                {freeSessions.length}
              </span>
            </div>
          )}

          {freeSessions.length === 0 ? (
            isExpanded ? (
              <div className="text-center py-2 text-zinc-500 text-xs bg-zinc-900/40 rounded border border-zinc-800/60 p-1">
                <p className="text-[9.5px]">Nenhuma conversa.</p>
              </div>
            ) : null
          ) : (
            freeSessions.map((sess) => renderChatItem(sess, false))
          )}
        </div>
      </div>

      {/* Sidebar Footer */}
      <div className="p-1 border-t border-zinc-800 shrink-0 space-y-0.5">
        {/* Arquivos & Diffs */}
        <button
          onClick={onOpenFiles}
          title="Arquivos & Diffs do Projeto"
          className={`w-full flex items-center justify-start gap-1.5 py-1 px-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
            activeRightPanelMode === 'files'
              ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
          } ${!isExpanded ? 'justify-center px-0' : ''}`}
        >
          <Files className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          {isExpanded && <span>Arquivos & Diffs</span>}
        </button>

        {/* Diretórios Autorizados */}
        <button
          onClick={onOpenDirsModal}
          title="Diretórios Autorizados"
          className={`w-full flex items-center justify-start gap-1.5 py-1 px-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
            activeRightPanelMode === 'dirs'
              ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
          } ${!isExpanded ? 'justify-center px-0' : ''}`}
        >
          <FolderCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          {isExpanded && <span>Diretórios</span>}
        </button>

        {/* Histórico */}
        <button
          onClick={onOpenHistory}
          title="Histórico de Conversas"
          className={`w-full flex items-center justify-start gap-1.5 py-1 px-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
            activeRightPanelMode === 'history'
              ? 'bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
          } ${!isExpanded ? 'justify-center px-0' : ''}`}
        >
          <History className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          {isExpanded && <span>Histórico</span>}
        </button>

        {/* Logs em Tempo Real */}
        <button
          onClick={onOpenLogs || (() => onOpenSettings('logs'))}
          title="Logs em Tempo Real"
          className={`w-full flex items-center justify-start gap-1.5 py-1 px-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
            activeRightPanelMode === 'logs'
              ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
          } ${!isExpanded ? 'justify-center px-0' : ''}`}
        >
          <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse shrink-0" />
          {isExpanded && <span>Logs</span>}
        </button>

        {/* Chats Arquivados */}
        <button
          onClick={onOpenArchivedChats}
          title="Chats Arquivados"
          className={`w-full flex items-center justify-between py-1 px-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
            activeRightPanelMode === 'archived'
              ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
          } ${!isExpanded ? 'justify-center px-0' : ''}`}
        >
          <div className="flex items-center gap-1.5">
            <Archive className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            {isExpanded && <span>Chats Arquivados</span>}
          </div>
          {isExpanded && archivedSessionsCount > 0 && (
            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
              {archivedSessionsCount}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
};
