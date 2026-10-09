import { applyToolCallEvent } from './utils/toolCallEvents.js';
import { assistantText, telemetryChannel, unwrapTelemetry } from './utils/telemetry.js';
import { compactExecutionHistory, toExecutorContext } from './utils/executionContext.js';
import { retainDiagnostics } from './utils/diagnosticRetention.js';
import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header.js';
import { ChatView } from './components/ChatView.js';
import { FilesAndDiffsView } from './components/FilesAndDiffsView.js';
import { AuthorizedDirsModal } from './components/AuthorizedDirsModal.js';
import { ProjectsModal } from './components/ProjectsModal.js';
import { HistoryDrawer } from './components/HistoryDrawer.js';
import { SettingsModal } from './components/SettingsModal.js';
import { LeftSidebar } from './components/LeftSidebar.js';
import { ArchivedChatsModal } from './components/ArchivedChatsModal.js';
import { RightSidebar } from './components/RightSidebar.js';
import { VersionsSidebar } from './components/VersionsSidebar.js';
import { VersionsModal } from './components/VersionsModal.js';
import { SharedMemorySidebar } from './components/SharedMemorySidebar.js';
import { LogsSidebar } from './components/LogsSidebar.js';
import { HistorySidebar } from './components/HistorySidebar.js';
import { AuthorizedDirsSidebar } from './components/AuthorizedDirsSidebar.js';
import { ContextSidebar } from './components/ContextSidebar.js';
import { ArchivedChatsSidebar } from './components/ArchivedChatsSidebar.js';
import { FilesAndDiffsSidebar } from './components/FilesAndDiffsSidebar.js';
import { MarkdownDocViewerSidebar } from './components/MarkdownDocViewerSidebar.js';
import {
  ContextSettings,
  DEFAULT_CONTEXT_SETTINGS,
  estimateTokens,
  estimateParamsLength,
  calculateSessionTokens,
  compressContextMessages,
} from './utils/tokenUtils.js';
import {
  CliStatus,
  ProjectItem,
  AuthorizedDir,
  AgentConfig,
  SkillConfig,
  CommandConfig,
  McpConfig,
  SessionItem,
  ChatMessage,
  AudioSettings,
  ThinkingLevel,
  SharedMemoryItem,
} from './types.js';
import { DEFAULT_AGENTS } from './constants/defaultAgents.js';
import { buildEffectiveSystemPrompt } from './utils/systemPromptUtils.js';
import { fetchJsonSafely } from './utils/apiUtils.js';
import { normalizeActivities } from './utils/activityTraceUtils.js';
import { getMostRecentValidSession } from './utils/sessionUtils.js';
import { getSavedVoiceAgents } from './services/voice/voiceAgentsStore.js';
import { resolveTtsSelection, resolveSttSelection, getAudioDiagnostics, ttsAudioUrl, updateTtsSettings } from './services/voice/ttsUtils.js';

export function App() {
  // Theme
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Core CLI Status
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [approvalMode, setApprovalMode] = useState<'default' | 'auto_edit' | 'yolo' | 'plan'>('default');

  // Left Sidebar State & Resizing
  const [isSidebarExpanded, setIsSidebarExpanded] = useState<boolean>(true);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('gemini_gui_left_sidebar_width');
        if (saved) {
          const num = parseInt(saved, 10);
          if (!isNaN(num) && num >= 180 && num <= 500) return num;
        }
      } catch {}
    }
    return 224; // Default width (~224px)
  });
  const [isResizingLeftSidebar, setIsResizingLeftSidebar] = useState<boolean>(false);

  // Context & Token Compression Settings
  const [contextSettings, setContextSettings] = useState<ContextSettings>(DEFAULT_CONTEXT_SETTINGS);

  // Live Metrics Logs: RPM, TPM, RPD (persisted in localStorage)
  const [requestLog, setRequestLog] = useState<Array<{ timestamp: number; tokenCount: number }>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('gemini_cli_request_log');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {
        // fallback
      }
    }
    return [];
  });

  const [now, setNow] = useState<number>(Date.now());

  // Dynamic 1-second ticker to decay TPM/RPM and detect Pacific Midnight RPD reset in real time
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Save requestLog to localStorage (clean entries older than 48h)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const cutoff = Date.now() - 48 * 3600 * 1000;
        const cleanLogs = requestLog.filter((r) => r.timestamp > cutoff);
        localStorage.setItem('gemini_cli_request_log', JSON.stringify(cleanLogs));
      } catch {
        // ignore
      }
    }
  }, [requestLog]);

  // Helper for Pacific Date String ("M/D/YYYY" in America/Los_Angeles timezone)
  const getPacificDateStr = (tsMs: number) => {
    return new Date(tsMs).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
  };

  // Calculate live rate metrics (100% factual, sliding 60s window for TPM/RPM, Pacific Midnight reset for RPD)
  const lastMinuteLog = requestLog.filter((r) => now - r.timestamp <= 60000);
  const rpm = lastMinuteLog.length;
  const tpm = lastMinuteLog.reduce((acc, r) => acc + r.tokenCount, 0);

  const currentPacificDate = getPacificDateStr(now);
  const todayPacificLogs = requestLog.filter((r) => getPacificDateStr(r.timestamp) === currentPacificDate);
  const rpd = todayPacificLogs.length;

  const liveMetrics = { rpm, tpm, rpd };

  // Navigation views
  const [activeView, setActiveView] = useState<'chat' | 'diffs'>('chat');

  // Projects & Authorized Directories
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectItem | null>(null);
  const [authorizedDirs, setAuthorizedDirs] = useState<AuthorizedDir[]>([]);
  const [filesViewDir, setFilesViewDir] = useState<string>('');

  // Agents, Skills, Commands, MCP
  const [agents, setAgents] = useState<AgentConfig[]>(DEFAULT_AGENTS);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('principal');
  const [skills, setSkills] = useState<SkillConfig[]>([]);
  const [commands, setCommands] = useState<CommandConfig[]>([]);
  const [mcpServers, setMcpServers] = useState<McpConfig[]>([]);

  // Sessions & Messages (Gemini CLI requires standard UUID v4 for --session-id and --resume)
  const generateSessionId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };
  const [versionRevision, setVersionRevision] = useState(0);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [cliSessionId, setCliSessionId] = useState<string | undefined>();
  const [executionContext, setExecutionContext] = useState<ChatMessage[] | undefined>();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('gemini_gui_current_session_id');
        if (saved && saved.trim()) return saved.trim();
      } catch {}
    }
    return generateSessionId();
  });
  const selectionRevision = useRef(0);
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentExecutionIdRef = useRef<string | null>(null);

  // Thinker Control State (low | medium | high)
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gemini_gui_thinking_level');
      if (saved === 'low' || saved === 'medium' || saved === 'high') {
        return saved;
      }
    }
    return 'medium';
  });

  const handleSelectThinkingLevel = (level: ThinkingLevel) => {
    setThinkingLevel(level);
    if (typeof window !== 'undefined') {
      localStorage.setItem('gemini_gui_thinking_level', level);
    }
  };

  // Modals state
  const [isDirsModalOpen, setIsDirsModalOpen] = useState(false);
  const [isProjectsModalOpen, setIsProjectsModalOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string>('cli');
  const [isArchivedChatsOpen, setIsArchivedChatsOpen] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);

  // Right Panel System (Area 3: Docked Sidebars - Payload, Versions, Memory, Logs, History, Dirs, Context, Archived, Files, Markdown)
  const [rightPanelMode, setRightPanelMode] = useState<
    'payload' | 'versions' | 'memory' | 'logs' | 'history' | 'dirs' | 'context' | 'archived' | 'files' | 'markdown' | null
  >(null);
  const [activeMarkdownDoc, setActiveMarkdownDoc] = useState<{ title: string; content: string } | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() =>
    Math.max(280, Math.min(320, typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.20) : 300))
  );
  const [isResizingRightPanel, setIsResizingRightPanel] = useState<boolean>(false);
  const [inspectionMessage, setInspectionMessage] = useState<ChatMessage | null>(null);
  const [contextTargetSession, setContextTargetSession] = useState<SessionItem | null>(null);

  const handleOpenMarkdownDoc = (title: string, content: string) => {
    setActiveMarkdownDoc({ title, content });
    setRightPanelMode('markdown');
    setRightPanelWidth((prev) => Math.max(prev, 460));
  };

  // Versions Snapshot Modal (legacy fallback if needed)
  const [isVersionsModalOpen, setIsVersionsModalOpen] = useState(false);

  // Shared Memory State (Project-wide or session-isolated)
  const [activeMemory, setActiveMemory] = useState<SharedMemoryItem | null>(null);
  const [activeMemoryVersion, setActiveMemoryVersion] = useState(1);

  // Drag-to-resize listener for Left Sidebar and Right Panel
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeftSidebar) {
        const minW = 180;
        const maxW = Math.min(520, window.innerWidth - 320);
        const newWidth = Math.max(minW, Math.min(maxW, e.clientX));
        setLeftSidebarWidth(newWidth);
        try {
          localStorage.setItem('gemini_gui_left_sidebar_width', newWidth.toString());
        } catch {}
      }

      if (isResizingRightPanel) {
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth >= 260 && newWidth <= Math.min(950, window.innerWidth - 280)) {
          setRightPanelWidth(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeftSidebar(false);
      setIsResizingRightPanel(false);
    };

    if (isResizingLeftSidebar || isResizingRightPanel) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingLeftSidebar, isResizingRightPanel]);

  // Load effective memory for current project / session scope
  const fetchEffectiveMemory = async () => {
    try {
      const params = new URLSearchParams();
      if (activeProject?.id) {
        params.append('projectId', activeProject.id);
        params.append('projectName', activeProject.name);
      } else if (currentSessionId) {
        params.append('sessionId', currentSessionId);
        const currentSession = sessions.find((s) => s.id === currentSessionId);
        params.append('sessionTitle', currentSession?.title || 'Conversa Isolada');
      }
      const mem = await fetchJsonSafely<SharedMemoryItem>(`/api/memories/effective?${params.toString()}`);
      if (mem) {
        setActiveMemory(mem);
        setActiveMemoryVersion(mem.versions?.length || 1);
      }
    } catch (err) {
      console.error('Failed to fetch effective memory:', err);
    }
  };

  useEffect(() => {
    fetchEffectiveMemory();
  }, [activeProject?.id, currentSessionId]);

  // Audio Settings & Narration State
  const [audioSettings, setAudioSettings] = useState<AudioSettings>({
    sttEnabled: true,
    sttModel: 'gemini-3.1-flash-lite',
    ttsEnabled: true,
    ttsModel: 'gemini-3.1-flash-tts-preview',
    ttsVoice: 'Kore',
    ttsSpeed: 1.0,
    autoPlayTts: false,
    autoSendVoicePrompt: true,
    filterCodeInTts: true,
    filterDiffsInTts: true,
    micStatus: 'ready',
    audioApiKey: '',
    audioApiUrl: '',
    sttInstructions: '',
    ttsInstructions: '',
    audioModelStatus: {
      sttAvailable: true,
      ttsAvailable: true,
      liveAvailable: false,
    },
    savedVoicePresets: [],
  });

  const [currentlyNarratingId, setCurrentlyNarratingId] = useState<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsControllerRef = useRef<AbortController | null>(null);
  const sttControllerRef = useRef<AbortController | null>(null);
  const [audioDiagnostics, setAudioDiagnostics] = useState<Record<string, any>>({});
  const recordAudioResult = (modality: 'tts' | 'stt', data: any) => {
    const diagnostic = getAudioDiagnostics({ ...data, modality });
    setAudioDiagnostics(prev => ({ ...prev, [modality]: diagnostic }));
    console.info('AUDIO_OPERATION', diagnostic);
  };
  useEffect(() => () => {
    ttsControllerRef.current?.abort();
    sttControllerRef.current?.abort();
    currentAudioRef.current?.pause();
    window.speechSynthesis?.cancel();
  }, []);

  // Initial Data Fetching & Sync
  const refreshStatus = async (forceFresh = true) => {
    setIsCheckingStatus(true);
    try {
      const workDir = activeProject?.associatedDirs[0] || authorizedDirs[0]?.path;
      const data = await fetchJsonSafely<CliStatus>(`/api/status?fresh=${forceFresh ? 'true' : 'false'}${workDir ? `&workDir=${encodeURIComponent(workDir)}` : ''}`);
      if (data) {
        setCliStatus(data);
        if (data.approvalMode) setApprovalMode(data.approvalMode);
      }
    } catch (err) {
      console.warn('Failed to get CLI status (network or parsing):', err);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  // Sessions Handlers & Resilient Loading Logic
  const handleNewSession = (projectId?: string | null) => {
    const newId = generateSessionId();
    selectionRevision.current++;
    currentSessionIdRef.current = newId;
    setCurrentSessionId(newId);
    setMessages([]);
    setCliSessionId(undefined);
    setExecutionContext(undefined);
    setSessionLoading(false);
    try {
      localStorage.setItem('gemini_gui_current_session_id', newId);
    } catch {}
    if (projectId) {
      const p = projects.find((x) => x.id === projectId);
      if (p) {
        setActiveProject(p);
        return;
      }
    }
    setActiveProject(null);
  };

  const switchToMostRecentValidSession = async (
    invalidId?: string,
    sessionPool?: SessionItem[],
    projectPool = projects
  ) => {
    const pool = sessionPool || sessions;
    const mostRecent = getMostRecentValidSession(pool, invalidId || currentSessionId);

    if (mostRecent) {
      console.warn(
        `[Session] Alternando automaticamente do identificador inválido "${invalidId || currentSessionId}" para a sessão válida mais recente: "${mostRecent.id}" (${mostRecent.title || 'Conversa'}).`
      );
      await handleSelectSession(mostRecent, projectPool, pool);
    } else {
      console.warn(
        `[Session] Nenhuma sessão alternativa válida encontrada no pool. Criando nova conversa limpa.`
      );
      handleNewSession();
    }
  };

  const handleSelectSession = async (sess: SessionItem, projectPool = projects, sessionPool = sessions) => {
    if (!sess || !sess.id) {
      console.warn('[Session] Tentativa de selecionar sessão nula ou inválida. Alternando para a sessão válida mais recente.');
      await switchToMostRecentValidSession(undefined, sessionPool, projectPool);
      return;
    }

    const revision = ++selectionRevision.current;
    setSessionLoading(true);
    try {
      if (sess.projectId) {
        const p = projectPool.find((x) => x.id === sess.projectId);
        setActiveProject(p || null);
      } else {
        setActiveProject(null);
      }

      if (sess.messages && sess.messages.length > 0) {
        currentSessionIdRef.current = sess.id;
        setCurrentSessionId(sess.id);
        setMessages(sess.messages);
        setCliSessionId(sess.cliSessionId);
        setExecutionContext(sess.executionContext);
        try {
          localStorage.setItem('gemini_gui_current_session_id', sess.id);
        } catch {}
      } else {
        const fullSess = await fetchJsonSafely<SessionItem>(`/api/sessions/${sess.id}`);
        if (revision !== selectionRevision.current) return;
        if (!fullSess || !fullSess.id) {
          console.warn(`[Session] Sessão "${sess.id}" não encontrada no servidor (identificador inválido ou 404). Alternando automaticamente para a sessão mais recente.`);
          const remaining = sessionPool.filter((s) => s.id !== sess.id);
          setSessions(remaining);
          try {
            localStorage.removeItem('gemini_gui_current_session_id');
          } catch {}
          await switchToMostRecentValidSession(sess.id, remaining, projectPool);
          return;
        }

        currentSessionIdRef.current = fullSess.id;
        setCurrentSessionId(fullSess.id);
        setMessages(fullSess.messages || []);
        setCliSessionId(fullSess.cliSessionId);
        setExecutionContext(fullSess.executionContext);
        setActiveProject(projectPool.find(p => p.id === fullSess.projectId) || null);
        try {
          localStorage.setItem('gemini_gui_current_session_id', fullSess.id);
        } catch {}
      }
    } catch (err) {
      if (revision !== selectionRevision.current) return;
      console.error(`[Session] Erro ao carregar mensagens da sessão "${sess?.id}":`, err);
      const remaining = sessionPool.filter((s) => s.id !== sess?.id);
      setSessions(remaining);
      try {
        localStorage.removeItem('gemini_gui_current_session_id');
      } catch {}
      await switchToMostRecentValidSession(sess?.id, remaining, projectPool);
    } finally { if (revision === selectionRevision.current) setSessionLoading(false); }
  };

  const loadAllData = async () => {
    // Refresh status non-blockingly so it doesn't hold up data loading
    refreshStatus(false);

    try {
      const [projs, dirs, ags, sks, cmds, mcps, sList] = await Promise.all([
        fetchJsonSafely<ProjectItem[]>('/api/projects'),
        fetchJsonSafely<AuthorizedDir[]>('/api/directories'),
        fetchJsonSafely<AgentConfig[]>('/api/agents'),
        fetchJsonSafely<SkillConfig[]>('/api/skills'),
        fetchJsonSafely<CommandConfig[]>('/api/commands'),
        fetchJsonSafely<McpConfig[]>('/api/mcp'),
        fetchJsonSafely<SessionItem[]>('/api/sessions'),
      ]);

      if (projs && Array.isArray(projs)) {
        setProjects(projs);
      }

      if (dirs && Array.isArray(dirs)) {
        setAuthorizedDirs(dirs);
      }

      if (ags && Array.isArray(ags) && ags.length > 0) {
        setAgents(ags);
      }

      if (sks && Array.isArray(sks)) {
        setSkills(sks);
      }

      if (cmds && Array.isArray(cmds)) {
        setCommands(cmds);
      }

      if (mcps && Array.isArray(mcps)) {
        setMcpServers(mcps);
      }

      if (sList && Array.isArray(sList)) {
        setSessions(sList);

        // Validação e recuperação automática da sessão na carga inicial
        let targetId = currentSessionId;
        if (typeof window !== 'undefined') {
          try {
            const saved = localStorage.getItem('gemini_gui_current_session_id');
            if (saved && saved.trim()) targetId = saved.trim();
          } catch {}
        }

        const candidate = sList.find((s) => s.id === targetId);
        if (candidate && !candidate.isArchived) {
          await handleSelectSession(candidate, projs || [], sList);
        } else if (sList.length > 0) {
          // Identificador inválido, ausente ou arquivado:
          // Alternar automaticamente para a sessão válida mais recente
          const mostRecent = getMostRecentValidSession(sList, candidate ? undefined : targetId);
          if (mostRecent) {
            console.log(
              `[Session] Identificador inicial "${targetId}" inválido ou ausente. Alternando para a sessão válida mais recente: "${mostRecent.id}"`
            );
            await handleSelectSession(mostRecent, projs || [], sList);
          } else {
            handleNewSession();
          }
        }
      }
    } catch (err) {
      console.error('Failed to load initial configurations:', err);
    } finally { setSessionLoading(false); }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Theme change
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const handleOpenSettings = (tab?: string) => {
    if (tab) setSettingsTab(tab);
    setIsSettingsOpen(true);
  };

  // Handle execution of real Gemini CLI via SSE
  const handleSendMessage = async (promptText: string) => {
    const sessionProjectId = sessions.find(s => s.id === currentSessionId)?.projectId;
    if (sessionLoading || isStreaming || (sessionProjectId && activeProject?.id !== sessionProjectId) || (activeProject ? !activeProject.associatedDirs[0] : !authorizedDirs[0]?.path)) {
      console.warn('Execução bloqueada: aguarde a resolução do projeto e do diretório.');
      return;
    }
    // Track request metric (RPM, TPM, RPD)
    const promptTokens = estimateTokens(promptText);
    setRequestLog((prev) => [...prev, { timestamp: Date.now(), tokenCount: promptTokens }]);

    // Auto context compression check
    let activeBaseMessages = executionContext || messages;
    let contextCompressed = false;
    let resolvedCliSessionId = cliSessionId || currentSessionId;
    if (contextSettings.autoCompress) {
      const currentStats = calculateSessionTokens(activeBaseMessages);
      if (currentStats.totalTokens >= contextSettings.compressionThresholdTokens) {
        const { compressedMessages } = compressContextMessages(activeBaseMessages, contextSettings);
        contextCompressed = compressedMessages !== activeBaseMessages;
        activeBaseMessages = compressedMessages;
      }
    }

    const currentAgent =
      (agents && agents.length > 0
        ? (agents.find(
            (a) =>
              a.id.toLowerCase() === selectedAgentId.toLowerCase() ||
              a.name.toLowerCase() === selectedAgentId.toLowerCase()
          ) || agents[0])
        : null) || DEFAULT_AGENTS[0];

    const startTime = Date.now();
    const workDir = activeProject ? activeProject.associatedDirs[0] : authorizedDirs[0]?.path;
    const effectiveSysInst = buildEffectiveSystemPrompt(
      currentAgent?.baseInstructions,
      currentAgent?.systemInstructions,
      currentAgent?.overrideBasePrompt
    );

    const memoryContent = activeMemory?.content || '';
    const memoryScopeDesc = activeProject
      ? `Projeto: ${activeProject.name} (Compartilhado entre todos os chats deste projeto)`
      : `Conversa Isolada (${currentSessionId})`;

    const rawPayloadSent = {
      cliExecutable: cliStatus?.cliPath || 'gemini',
      model: currentAgent?.model || 'gemini-3.5-flash-lite',
      agentName: currentAgent?.displayName || 'Principal Orchestrator',
      approvalMode,
      workDir,
      authorizedDirs: authorizedDirs.map((d) => d.path),
      systemInstructions: effectiveSysInst,
      sharedMemory: memoryContent,
      sharedMemoryScope: memoryScopeDesc,
      sharedMemoryVersion: activeMemory?.versions?.length || 1,
      projectContext: activeProject ? `Projeto: ${activeProject.name}` : workDir,
      promptText,
      fullInjectedPrompt: `[SISTEMA - INSTRUÇÕES DO AGENTE]\n${effectiveSysInst}\n\n[MEMÓRIA PERSISTENTE COMPARTILHADA]\nEscopo: ${memoryScopeDesc}\n${memoryContent}\n\n[CONTEXTO DE TRABALHO]\nWorkDir: ${workDir}\nModo Aprovação: ${approvalMode}\n\n[PROMPT ENVIADO]\n${promptText}`,
      skills: skills.filter((s) => s.enabled).map((s) => s.name),
      mcpServers: mcpServers.filter((m) => m.enabled).map((m) => m.name),
      timestamp: new Date().toISOString(),
    };

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: promptText,
      timestamp: new Date().toISOString(),
      rawPayloadSent,
    };

    const assistantMsgId = `asst_${Date.now() + 1}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      model: currentAgent?.model || 'gemini-3.5-flash-lite',
      agentName: currentAgent?.displayName || 'Principal Orchestrator',
      toolCalls: [],
      isStreaming: true,
      rawPayloadSent,
    };

    const updatedMessages = [...messages, userMsg, assistantPlaceholder];
    setMessages(updatedMessages);
    setIsStreaming(true);

    const rawEventsList: any[] = [];
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;
    let assistantContent = '';
    const toolCalls: Record<string, any> = {};

    try {
      // Execute CLI
      const execId = 'exec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      currentExecutionIdRef.current = execId;

      const response = await fetch('/api/cli/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          executionId: execId,
          prompt: promptText,
          model: selectedAgentId === 'all' ? 'gemini-3.1-flash-lite' : currentAgent?.model,
          approvalMode,
          authorizedDirs: authorizedDirs.map((d) => d.path),
          sessionId: resolvedCliSessionId,
          projectId: activeProject?.id,
          resume: messages.length > 0 && !contextCompressed && Boolean(cliSessionId),
          resetContext: contextCompressed || (!cliSessionId && messages.length > 0),
          contextMessages: toExecutorContext(activeBaseMessages),
          workDir,
          agentId: selectedAgentId === 'all' ? 'all' : (currentAgent?.id || currentAgent?.name),
          fallbackModel: selectedAgentId === 'all' ? 'gemini-3.5-flash-lite' : currentAgent?.fallbackModel,
          temperature: currentAgent?.temperature,
          topP: currentAgent?.topP,
          topK: currentAgent?.topK,
          maxOutputTokens: currentAgent?.maxOutputTokens,
          thinking: thinkingLevel !== 'off',
          thinkingLevel,
          thinking_level: thinkingLevel,
          systemInstructions: currentAgent?.systemInstructions,
          overrideBasePrompt: currentAgent?.overrideBasePrompt,
          baseInstructions: currentAgent?.baseInstructions,
          sharedMemory: memoryContent,
        }),
      });

      if (!response.ok) { const error = await response.json(); throw new Error(error.error || `HTTP ${response.status}`); }
      if (!response.body) {
        throw new Error('Nenhum fluxo de resposta retornado.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let hasError = false;
      let errorMessage = '';
      let capturedFinalApiRequest: any = null;
      let capturedParameterOrigins: any = null;
      let capturedAllRealRequests: any[] = [];

      let streamFinished = false;
      let updateScheduled = false;
      let lastFlushTime = 0;
      const flushStreamUpdate = () => {
        updateScheduled = false;
        if (streamFinished) return;
        lastFlushTime = Date.now();
        const displayContent =
          assistantContent ||
          (hasError
            ? `⚠️ **Erro no Gemini CLI:** ${errorMessage}`
            : '');

        const currentToolCalls = Object.values(toolCalls);
        const currentActivities = normalizeActivities({
          rawEvents: rawEventsList,
          toolCalls: currentToolCalls,
          isStreaming: true,
          agentName: selectedAgentId === 'all'
            ? 'Todos os Agentes (Simultâneo)'
            : (currentAgent?.displayName || currentAgent?.name),
          model: selectedAgentId === 'all' ? 'gemini-3.1-flash-lite' : (currentAgent?.model || 'gemini-3.5-flash-lite'),
          error: hasError ? errorMessage : undefined,
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: displayContent,
                  toolCalls: currentToolCalls,
                  activities: currentActivities,
                  isStreaming: true,
                  finalApiRequest: capturedFinalApiRequest || m.finalApiRequest,
                  allFinalApiRequests: capturedAllRealRequests.length > 0 ? capturedAllRealRequests : m.allFinalApiRequests,
                  parameterOrigins: capturedParameterOrigins || m.parameterOrigins,
                  rawPayloadReceived: {
                    rawEvents: [...rawEventsList],
                    rawTextStream: assistantContent,
                  },
                }
              : m
          )
        );
      };

      const scheduleStreamUpdate = () => {
        if (!updateScheduled) {
          updateScheduled = true;
          // Render first tokens immediately for instant TTFT (Time To First Token)
          if (lastFlushTime === 0) {
            flushStreamUpdate();
          } else {
            requestAnimationFrame(flushStreamUpdate);
          }
        }
      };

      while (true) {
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await reader.read();
        } catch (streamReadErr: any) {
          const isAbort =
            ctrl.signal.aborted ||
            streamReadErr?.name === 'AbortError' ||
            streamReadErr?.message?.includes('BodyStreamBuffer') ||
            streamReadErr?.message?.includes('aborted');
          if (isAbort) {
            // Gracefully exit the loop without throwing fatal exception if stream was closed
            break;
          }
          throw streamReadErr;
        }

        const { value, done } = readResult;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const rawData = line.slice(6).trim();
            if (!rawData) continue;

            try {
              const eventPayload = JSON.parse(rawData);
              if (eventPayload.type === 'session_changed' && eventPayload.sessionId) {
                resolvedCliSessionId = eventPayload.sessionId;
                if (currentSessionIdRef.current === currentSessionId) setCliSessionId(resolvedCliSessionId);
                hasError = false; errorMessage = '';
              }
              if (eventPayload.type === 'version_created') setVersionRevision(value => value + 1);
              // Unpack nested stream_event or inner data payload if present
              const innerPayload =
                eventPayload.data && typeof eventPayload.data === 'object' && !Array.isArray(eventPayload.data)
                  ? { ...eventPayload.data, type: eventPayload.data.type || eventPayload.type }
                  : eventPayload;
              const evtType = innerPayload.type || eventPayload.type;

              if (eventPayload.type === 'done' || evtType === 'done') {
                hasError = hasError || eventPayload.exitCode !== 0 || Boolean(eventPayload.signal);
                if (hasError && !errorMessage) errorMessage = `Processo encerrado (código ${eventPayload.exitCode}, sinal ${eventPayload.signal || 'nenhum'}).`;
                // Finalize any dangling running tool calls
                const now = Date.now();
                Object.values(toolCalls).forEach((tc) => {
                  if (tc.status === 'running') {
                    tc.status = 'failed';
                    tc.error = 'Ferramenta encerrada sem resultado terminal.';
                    tc.completedAt = now;
                    if (tc.startedAt) tc.durationMs = now - tc.startedAt;
                  }
                });
              }
              rawEventsList.push(eventPayload);

              // Capture finalApiRequest from backend (Exclusivamente o request real capturado)
              if (eventPayload.type === 'final_api_request' || evtType === 'final_api_request') {
                const reqObj = eventPayload.finalApiRequest || eventPayload.data?.finalApiRequest || innerPayload.finalApiRequest;
                if (reqObj) {
                  capturedFinalApiRequest = reqObj;
                  retainDiagnostics(capturedAllRealRequests, { ...eventPayload, finalApiRequest: reqObj }, 20, 8 * 1024 * 1024);
                }
                const origins = eventPayload.parameterOrigins || eventPayload.data?.parameterOrigins || innerPayload.parameterOrigins;
                if (origins) {
                  capturedParameterOrigins = origins;
                }
                const allReqs = eventPayload.allRealRequests || eventPayload.data?.allRealRequests || innerPayload.allRealRequests;
                if (allReqs && Array.isArray(allReqs) && allReqs.length > 0) {
                  capturedAllRealRequests = allReqs;
                }
              }

              if (evtType === 'execution_outcome' && innerPayload.status !== 'success') {
                hasError = true;
                errorMessage = innerPayload.status === 'partial' ? 'Execução parcial: há delegações que não foram concluídas. Consulte Logs/Payload.' : 'Execução falhou: tarefa não concluída. Consulte Logs/Payload.';
              }
              // Inspect Gemini CLI JSON stream event
              if (
                evtType === 'process_error' ||
                evtType === 'error' ||
                (eventPayload.exitCode !== undefined && eventPayload.exitCode !== 0)
              ) {
                hasError = true;
                errorMessage = innerPayload.message || innerPayload.text || errorMessage || `Código de saída: ${eventPayload.exitCode}`;
              } else if (evtType === 'result' && (innerPayload.status === 'error' || innerPayload.error)) {
                hasError = true;
                errorMessage = innerPayload.error?.message || errorMessage || 'Erro retornado pela API do Gemini.';
              } else if (telemetryChannel(eventPayload) === 'assistant_content') {
                assistantContent += assistantText(eventPayload);
              } else if (evtType === 'tool_use' || evtType === 'tool_call' || evtType === 'tool_result') {
                applyToolCallEvent(toolCalls, evtType, innerPayload);
              }

              // Schedule batched UI message state update
              scheduleStreamUpdate();
            } catch {
              // Ignore non-JSON lines
            }
          }
        }
      }

      // Finalizar quaisquer tool calls pendentes que nunca receberam tool_result
      for (const callId of Object.keys(toolCalls)) {
        if (toolCalls[callId].status === 'running') {
          const now = Date.now();
          toolCalls[callId].status = 'failed';
          toolCalls[callId].completedAt = now;
          if (toolCalls[callId].startedAt) {
            toolCalls[callId].durationMs = now - toolCalls[callId].startedAt;
          }
          const failReason = errorMessage || 'Execução de ferramenta/subagente encerrada sem retorno terminal.';
          toolCalls[callId].error = failReason;
          toolCalls[callId].result = failReason;
          hasError = true;
        }
      }

      streamFinished = true;
      // Compute final message content & token stats
      let finalContent = assistantContent.trim();
      const blocked = [...rawEventsList].reverse().map(unwrapTelemetry).find(event => event.type === 'runtime_event' && event.event === 'EXECUTION_BLOCKED');
      if (hasError && !finalContent) {
        if (blocked) {
          const retry = blocked.nextRetryAt ? ` Próxima tentativa a partir de ${new Date(blocked.nextRetryAt).toLocaleString('pt-BR')}.` : '';
          finalContent = `⚠️ ${blocked.message || 'Execução indisponível no momento.'}${retry} Consulte Logs/Payload para detalhes.`;
        } else {
          finalContent = '⚠️ Execução interrompida. Consulte Logs/Payload para detalhes.';
        }
      } else if (hasError && finalContent) {
        finalContent += '\n\n⚠️ Execução incompleta. Consulte o andamento e Logs/Payload.';
      } else if (!finalContent) {
        finalContent = '⚠️ Nenhuma resposta gerada pelo modelo. Consulte Logs/Payload.';
      }

      const durationMs = Date.now() - startTime;
      
      // Calculate realistic input & output tokens for rate metrics (TPM / RPM / RPD)
      let totalInputCharLength = promptText.length + (currentAgent?.systemInstructions?.length || 0);
      let totalOutputCharLength = finalContent.length;

      for (const tc of Object.values(toolCalls)) {
        totalInputCharLength += (tc.toolName?.length || 0) + estimateParamsLength(tc.parameters);
        totalOutputCharLength += (tc.result?.length || 0) + (tc.error?.length || 0);
      }

      const inputTokens = Math.ceil(totalInputCharLength / 3.8);
      const outputTokens = Math.ceil(totalOutputCharLength / 3.8);
      const totalRequestTokens = inputTokens + outputTokens;

      // Record request and total tokens in live rate metrics (TPM / RPM / RPD)
      if (totalRequestTokens > 0) {
        setRequestLog((prev) => [...prev, { timestamp: Date.now(), tokenCount: totalRequestTokens }]);
      }

      const rawPayloadReceived = {
        rawEvents: rawEventsList,
        rawTextStream: finalContent,
        toolCalls: Object.values(toolCalls),
        tokenStats: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        durationMs,
        completedAt: new Date().toISOString(),
      };

      const finalToolCalls = Object.values(toolCalls).map((tc) => {
        if (tc.status === 'running' || tc.status === 'pending' || tc.status === 'requires_approval') {
          const now = Date.now();
          return {
            ...tc,
            status: 'failed',
            completedAt: now,
            durationMs: tc.startedAt ? now - tc.startedAt : undefined,
            result: tc.result || 'Atividade encerrada sem retorno terminal. Consulte Logs/Payload.',
          };
        }
        return tc;
      });

      const finalActivities = normalizeActivities({
        rawEvents: rawEventsList,
        toolCalls: finalToolCalls,
        isStreaming: false,
        agentName: currentAgent?.displayName || currentAgent?.name,
        model: currentAgent?.model || 'gemini-3.5-flash-lite',
        error: hasError ? errorMessage : undefined,
      });

      // Finalize message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: finalContent,
                toolCalls: finalToolCalls,
                activities: finalActivities,
                isStreaming: false,
                error: hasError ? errorMessage : undefined,
                finalApiRequest: capturedFinalApiRequest || m.finalApiRequest,
                allFinalApiRequests: capturedAllRealRequests.length > 0 ? capturedAllRealRequests : m.allFinalApiRequests,
                parameterOrigins: capturedParameterOrigins || m.parameterOrigins,
                rawPayloadReceived,
              }
            : m
        )
      );

      // Persist the completed execution, including errors and recovered sessions.
      const finalAssistantMsg: ChatMessage = {
        ...assistantPlaceholder,
        content: finalContent,
        toolCalls: finalToolCalls,
        activities: finalActivities,
        isStreaming: false,
        error: hasError ? errorMessage : undefined,
        finalApiRequest: capturedFinalApiRequest || assistantPlaceholder.finalApiRequest,
        allFinalApiRequests: capturedAllRealRequests.length > 0 ? capturedAllRealRequests : assistantPlaceholder.allFinalApiRequests,
        parameterOrigins: capturedParameterOrigins || assistantPlaceholder.parameterOrigins,
        rawPayloadReceived,
      };

      const finalMsgList = messages.concat([userMsg, finalAssistantMsg]);
      const nextExecutionContext = executionContext || contextCompressed ? compactExecutionHistory(activeBaseMessages.concat([userMsg, finalAssistantMsg])) : undefined;
      if (currentSessionIdRef.current === currentSessionId) setExecutionContext(nextExecutionContext);

      const title =
        promptText.length > 40 ? promptText.slice(0, 40) + '...' : promptText;

      const existingSess = sessions.find((s) => s.id === currentSessionId);
      const effectiveProjectId = existingSess !== undefined ? existingSess.projectId : activeProject?.id;

      const savedSession: SessionItem = {
        id: currentSessionId,
        cliSessionId: resolvedCliSessionId,
        executionContext: nextExecutionContext,
        title: existingSess?.title || title,
        projectId: effectiveProjectId,
        isArchived: existingSess?.isArchived || false,
        createdAt: existingSess?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: finalMsgList.length,
        messages: finalMsgList,
        statusGrade: 'CONFIGURED',
      };

      const saveResponse = await fetch(existingSess ? `/api/sessions/${currentSessionId}/messages` : '/api/sessions', {
        method: existingSess ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existingSess ? { messages: finalMsgList, cliSessionId: resolvedCliSessionId, executionContext: nextExecutionContext } : savedSession),
      });
      if (!saveResponse.ok) throw new Error('Não foi possível salvar o histórico; as mensagens permanecem na interface.');

      // Reload sessions list
      const sessList = await fetchJsonSafely<SessionItem[]>('/api/sessions');
      if (sessList) {
        setSessions(sessList);
      }

      // Auto-play TTS if configured
      if (audioSettings.autoPlayTts && assistantContent) {
        handlePlayTts(assistantContent, assistantMsgId);
      }
    } catch (err: any) {
      const isManualAbort =
        ctrl.signal.aborted ||
        err?.name === 'AbortError' ||
        err?.message?.includes('BodyStreamBuffer') ||
        err?.message?.includes('aborted');

      if (!isManualAbort) {
        console.error('Execution error:', err);
      }

      const terminatedToolCalls = Object.values(toolCalls).map((tc) => {
        if (tc.status === 'running') {
          const now = Date.now();
          return {
            ...tc,
            status: 'failed',
            completedAt: now,
            durationMs: tc.startedAt ? now - tc.startedAt : undefined,
            error: isManualAbort ? 'Cancelado pelo usuário.' : (err?.message || 'Falha na execução'),
            result: isManualAbort ? 'Cancelado pelo usuário.' : (err?.message || 'Falha na execução'),
          };
        }
        return tc;
      });

      const catchActivities = normalizeActivities({
        rawEvents: rawEventsList,
        toolCalls: terminatedToolCalls,
        isStreaming: false,
        agentName: currentAgent?.displayName || currentAgent?.name,
        model: currentAgent?.model || 'gemini-3.5-flash-lite',
        error: isManualAbort ? undefined : err?.message,
      });

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === assistantMsgId) {
            let finalContent = m.content;
            if (isManualAbort) {
              finalContent = assistantContent.trim() || 'Execução cancelada pelo usuário.';
            } else {
              const isStreamAborted = err?.message?.includes('BodyStreamBuffer') || err?.message?.includes('buffer') || err?.message?.includes('aborted');
              const displayErr = isStreamAborted
                ? 'A conexão de transmissão foi interrompida de forma inesperada.'
                : err?.message;
              finalContent = assistantContent.trim()
                ? `${assistantContent.trim()}`
                : `Erro durante execução do Gemini CLI: ${displayErr}`;
            }

            return {
              ...m,
              content: finalContent,
              toolCalls: terminatedToolCalls,
              activities: catchActivities,
              isStreaming: false,
              error: isManualAbort || assistantContent.trim() ? undefined : err?.message,
            };
          }
          return m;
        })
      );
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelExecution = async () => {
    // 1. Immediately abort the client-side fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // 2. Reset UI state instantly
    setIsStreaming(false);

    // 3. Mark the streaming message as finished in the UI
    setMessages((prev) => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
        return prev.map((m, idx) =>
          idx === prev.length - 1 ? { ...m, isStreaming: false } : m
        );
      }
      return prev;
    });

    try {
      // 4. Notify backend to kill the process
      const execIdToCancel = currentExecutionIdRef.current;
      currentExecutionIdRef.current = null;
      await fetch('/api/cli/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId: execIdToCancel }),
      });
    } catch (err) {
      console.error('Failed to cancel CLI execution:', err);
    }
  };

  // Audio STT Handler (converts voice recording to text)
  const handleTranscribeAudio = async (audioBlob: Blob, callerSignal?: AbortSignal): Promise<string> => {
    if (audioSettings.sttModel === 'browser-native') return '';
    sttControllerRef.current?.abort();
    const controller = new AbortController();
    sttControllerRef.current = controller;
    const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
    const active = () => !signal.aborted && sttControllerRef.current === controller;
    const selection = resolveSttSelection(audioSettings, getSavedVoiceAgents()), requestId = crypto.randomUUID();
    try {
      signal.throwIfAborted();
      const base64Audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        const cleanup = () => signal.removeEventListener('abort', cancelled);
        const cancelled = () => { reader.abort(); cleanup(); reject(signal.reason); };
        reader.onload = () => { cleanup(); const result = String(reader.result || ''); resolve(result.includes(',') ? result.split(',')[1] : result); };
        reader.onerror = () => { cleanup(); reject(new Error('Falha ao processar arquivo de áudio.')); };
        signal.addEventListener('abort', cancelled, { once: true });
        if (signal.aborted) cancelled(); else reader.readAsDataURL(audioBlob);
      });
      signal.throwIfAborted();
      const res = await fetch('/api/audio/stt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ audioBase64: base64Audio, mimeType: audioBlob.type || 'audio/webm', model: selection.model,
          apiKey: audioSettings.audioApiKey, apiUrl: audioSettings.audioApiUrl, instructions: selection.instructions,
          fallback: selection.fallback, fallbackModels: selection.fallbackModels, language: selection.language, generationConfig: selection.generationConfig, requestId }),
      });
      if (!active()) return '';
      const data = await res.json();
      if (!active()) return '';
      recordAudioResult('stt', data);
      return res.ok && data.status !== 'failed' ? data.text || '' : '';
    } catch (error: any) {
      if (sttControllerRef.current === controller) recordAudioResult('stt', { requestId, configuredModel: selection.model, model: selection.model, provider: 'gemini',
        status: signal.aborted ? 'cancelled' : 'failed', code: signal.aborted ? 'STT_CANCELLED' : 'STT_FAILED', error: signal.aborted ? 'Transcrição cancelada.' : String(error?.message || error) });
      return '';
    } finally { if (sttControllerRef.current === controller) sttControllerRef.current = null; }
  };

  // Audio TTS Handler (synthesizes assistant text to audio)
  const handlePlayTts = async (text: string, messageId: string) => {
    if (currentlyNarratingId === messageId) { handleStopTts(); return; }
    handleStopTts();
    const controller = new AbortController();
    ttsControllerRef.current = controller;
    const active = () => !controller.signal.aborted && ttsControllerRef.current === controller;
    const selection = resolveTtsSelection(audioSettings, getSavedVoiceAgents());
    const requestId = crypto.randomUUID();
    (controller as any).audioMetadata = { requestId, configuredModel: selection.model, model: selection.model, provider: 'gemini' };
    recordAudioResult('tts', { ...(controller as any).audioMetadata, status: 'running' });
    setCurrentlyNarratingId(messageId);
    const finish = () => {
      if (!active()) return;
      currentAudioRef.current = null;
      ttsControllerRef.current = null;
      setCurrentlyNarratingId(null);
    };
    let localStarted = false;
    const local = (reason?: string) => {
      if (!active() || localStarted) return;
      localStarted = true;
      recordAudioResult('tts', { requestId, configuredModel: selection.model, model: 'browser-native', effectiveModel: 'browser-native', provider: 'speech-synthesis', fallbackUsed: selection.model !== 'browser-native', fallbackReason: reason, status: 'success' });
      if (!('speechSynthesis' in window)) { finish(); return; }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = selection.speed;
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    };
    if (selection.model === 'browser-native') { local(); return; }
    let fallbackReason = 'TTS_FAILED';
    let failureData: any;
    try {
      const res = await fetch('/api/audio/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ text, voice: selection.voice, apiKey: audioSettings.audioApiKey,
          apiUrl: audioSettings.audioApiUrl, model: selection.model, instructions: selection.instructions,
          fallback: selection.fallback, fallbackModels: selection.fallbackModels, language: selection.language, generationConfig: selection.generationConfig, requestId }),
      });
      if (!active()) return;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!active()) return;
        recordAudioResult('tts', data);
        failureData = data;
        fallbackReason = data.error || data.code || fallbackReason;
        if (res.ok && data.audioBase64) {
          console.info('TTS_PROVIDER', { requestId, model: data.model, provider: data.provider, fallbackReason: data.fallbackReason });
          const audio = new Audio(ttsAudioUrl(data.audioBase64, data.mimeType));
          currentAudioRef.current = audio;
          audio.playbackRate = selection.speed;
          audio.onended = finish;
          audio.onerror = () => { if (active()) { currentAudioRef.current = null; if (selection.fallbackModels?.includes('browser-native') || selection.fallback?.model === 'browser-native') local('AUDIO_PLAYBACK_ERROR'); else { recordAudioResult('tts', { requestId, model: data.model, provider: data.provider, status: 'failed', code: 'AUDIO_PLAYBACK_ERROR' }); finish(); } } };
          await audio.play();
          return;
        }
      } else fallbackReason = 'TTS_HTTP_' + res.status;
    } catch (error: any) {
      if (!active() || error.name === 'AbortError') return;
      fallbackReason = error.message || 'TTS_NETWORK_ERROR';
      if (failureData?.audioBase64) failureData = { ...failureData, status: 'failed', code: 'AUDIO_PLAYBACK_ERROR', error: fallbackReason };
    }
    if (selection.fallbackModels?.includes('browser-native') || selection.fallback?.model === 'browser-native') local(fallbackReason);
    else { recordAudioResult('tts', failureData || { requestId, configuredModel: selection.model, model: selection.model, provider: 'gemini', status: 'failed', code: 'TTS_FAILED', error: fallbackReason }); finish(); }
  };

  const handleStopTts = () => {
    if (ttsControllerRef.current) recordAudioResult('tts', { ...(ttsControllerRef.current as any).audioMetadata, status: 'cancelled', code: 'TTS_CANCELLED' });
    ttsControllerRef.current?.abort();
    ttsControllerRef.current = null;
    const audio = currentAudioRef.current;
    currentAudioRef.current = null;
    if (audio) {
      audio.onended = null; audio.onerror = null;
      audio.pause(); audio.currentTime = 0;
      audio.removeAttribute('src'); audio.load();
    }
    window.speechSynthesis?.cancel();
    setCurrentlyNarratingId(null);
  };

  // Projects CRUD handlers
  const handleCreateProject = async (name: string, description: string, dirs: string[], guidelines?: string) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, associatedDirs: dirs, guidelines }),
    });
    if (res.ok) {
      const newProj = await res.json();
      setProjects((prev) => [...prev, newProj]);
      setActiveProject(newProj);
    }
  };

  const handleUpdateProject = async (id: string, updates: Partial<ProjectItem>) => {
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const updated = await res.json();
      setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
      if (activeProject?.id === id) setActiveProject(updated);
    }
  };

  const handleDeleteProject = async (id: string) => {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (activeProject?.id === id) {
        setActiveProject(projects.find((p) => p.id !== id) || null);
      }
    }
  };

  // Authorized Dirs handlers
  const handleAddDir = async (dirPath: string) => {
    const res = await fetch('/api/directories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dirPath }),
    });
    const data = await res.json();
    if (data.dirs) setAuthorizedDirs(data.dirs);
    return data;
  };

  const handleRemoveDir = async (dirPath: string) => {
    const res = await fetch('/api/directories', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dirPath }),
    });
    const data = await res.json();
    if (data.dirs) setAuthorizedDirs(data.dirs);
    return data;
  };

  // Sessions handlers
  const handleDeleteSession = async (id: string) => {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (currentSessionId === id) {
      const mostRecent = getMostRecentValidSession(remaining);
      if (mostRecent) {
        await handleSelectSession(mostRecent);
      } else {
        handleNewSession();
      }
    }
  };

  const handleUpdateSession = async (id: string, updates: Partial<SessionItem>) => {
    const sess = sessions.find((s) => s.id === id);
    if (!sess) return;
    const updatedSess = { ...sess, ...updates };

    const replacingMessages = Array.isArray(updates.messages);
    const res = await fetch(replacingMessages ? `/api/sessions/${id}/messages` : `/api/sessions/${id}`, {
      method: replacingMessages ? 'PUT' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(replacingMessages ? { messages: updates.messages, cliSessionId: updates.cliSessionId, executionContext: updates.executionContext } : { ...updates, ...('projectId' in updates ? { projectId: updates.projectId || null } : {}) }),
    });
    if (res.ok) {
      const data = await fetchJsonSafely<SessionItem[]>('/api/sessions');
      if (data) {
        setSessions(data);

        if (id === currentSessionId) {
          if (replacingMessages) setMessages(updatedSess.messages || []);
          if ('projectId' in updates) {
            const p = projects.find((x) => x.id === updates.projectId);
            setActiveProject(p || null);
          }
        }
      }
    }
  };

  const handleUpdateSessionMessages = async (sessionId: string, newMessages: ChatMessage[]) => {
    if (isStreaming) return;
    const context = compactExecutionHistory(newMessages);
    const response = await fetch(`/api/sessions/${sessionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ executionContext: context, cliSessionId: '' }) });
    if (!response.ok) throw new Error('Não foi possível salvar a compressão do contexto.');
    if (sessionId === currentSessionId) { setExecutionContext(context); setCliSessionId(undefined); }
    const list = await fetchJsonSafely<SessionItem[]>('/api/sessions'); if (list) setSessions(list);
  };

  const handleDeriveSession = async (originalSess: SessionItem) => {
    const fullOriginal = await fetchJsonSafely<SessionItem>(`/api/sessions/${originalSess.id}`);
    if (!fullOriginal) return;
    const { compressedMessages } = compressContextMessages(fullOriginal.messages || [], contextSettings);
    const newSessionId = generateSessionId();
    const freshMessages = compressedMessages.map((m, idx) => ({
      ...m,
      id: `msg-${newSessionId}-${idx}-${Date.now()}`,
    }));
    const derivedSession: SessionItem = {
      id: newSessionId,
      title: `${originalSess.title} (Derivado)`,
      projectId: originalSess.projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: freshMessages.length,
      messages: freshMessages,
      executionContext: compactExecutionHistory(freshMessages),
      statusGrade: 'CONFIGURED',
    };

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(derivedSession),
    });

    if (res.ok) {
      const data = await fetchJsonSafely<SessionItem[]>('/api/sessions');
      if (data) {
        setSessions(data);
        await handleSelectSession(derivedSession);
      }
    }
  };

  const handleDeriveMessage = async (msg: ChatMessage) => {
    const newSessionId = generateSessionId();
    const newTitle = `Derivado: ${msg.content.slice(0, 30)}...`;
    const singleMsg: ChatMessage = {
      id: `msg-${newSessionId}-0-${Date.now()}`,
      role: msg.role,
      content: msg.content,
      timestamp: new Date().toISOString(),
      agentName: msg.agentName,
      model: msg.model,
    };
    const derivedSession: SessionItem = {
      id: newSessionId,
      title: newTitle,
      projectId: activeProject?.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 1,
      messages: [singleMsg],
      executionContext: compactExecutionHistory([singleMsg]),
      statusGrade: 'CONFIGURED',
    };

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(derivedSession),
    });

    if (res.ok) {
      const data = await fetchJsonSafely<SessionItem[]>('/api/sessions');
      if (data) {
        setSessions(data);
        await handleSelectSession(derivedSession);
      }
    }
  };

  const handleDeriveChat = async (messageIndex: number) => {
    const newSessionId = generateSessionId();
    const targetMsg = messages[messageIndex];
    const newTitle = `Ramo: ${targetMsg?.content.slice(0, 25) || 'Histórico'}...`;
    const sliced = messages.slice(0, messageIndex + 1).map((m, idx) => ({
      ...m,
      id: `msg-${newSessionId}-${idx}-${Date.now()}`,
    }));
    const derivedSession: SessionItem = {
      id: newSessionId,
      title: newTitle,
      projectId: activeProject?.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: sliced.length,
      messages: sliced,
      executionContext: compactExecutionHistory(sliced),
      statusGrade: 'CONFIGURED',
    };

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(derivedSession),
    });

    if (res.ok) {
      const data = await fetchJsonSafely<SessionItem[]>('/api/sessions');
      if (data) {
        setSessions(data);
        await handleSelectSession(derivedSession);
      }
    }
  };

  const handleDeleteMultipleSessions = async (ids: string[]) => {
    for (const id of ids) {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    }
    const remaining = sessions.filter((s) => !ids.includes(s.id));
    setSessions(remaining);
    if (ids.includes(currentSessionId)) {
      const mostRecent = getMostRecentValidSession(remaining);
      if (mostRecent) {
        await handleSelectSession(mostRecent);
      } else {
        handleNewSession();
      }
    }
  };

  const handleArchiveMultipleSessions = async (ids: string[]) => {
    for (const id of ids) {
      const sess = sessions.find((s) => s.id === id);
      if (sess) {
        const updatedSess = { isArchived: true };
        await fetch(`/api/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedSess),
        });
      }
    }
    const data = await fetchJsonSafely<SessionItem[]>('/api/sessions');
    if (data) {
      setSessions(data);
    }
    if (ids.includes(currentSessionId)) {
      const remaining = (data || sessions).filter((s) => !ids.includes(s.id) && !s.isArchived);
      const mostRecent = getMostRecentValidSession(remaining);
      if (mostRecent) {
        await handleSelectSession(mostRecent);
      } else {
        handleNewSession();
      }
    }
  };

  // Configuration saves
  const handleSaveAgent = async (agent: AgentConfig) => {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agent),
    });
    if (res.ok) {
      const data = await res.json();
      setAgents(data.agents);
    }
  };

  const handleDeleteAgent = async (id: string) => {
    const res = await fetch(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      setAgents(data.agents);
    }
  };

  const handleResetDefaultAgents = async () => {
    try {
      const res = await fetch('/api/agents/reset-defaults', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents);
      }
    } catch (err) {
      console.error('Failed to reset default agents:', err);
    }
  };

  const handleSaveSkill = async (skill: SkillConfig) => {
    const res = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skill),
    });
    if (res.ok) {
      const data = await res.json();
      setSkills(data.skills);
    }
  };

  const handleDeleteSkill = async (name: string) => {
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      setSkills(data.skills);
    }
  };

  const handleSaveCommand = async (cmd: CommandConfig) => {
    const res = await fetch('/api/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    if (res.ok) {
      const data = await res.json();
      setCommands(data.commands);
    }
  };

  const handleDeleteCommand = async (name: string) => {
    const res = await fetch(`/api/commands/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      setCommands(data.commands);
    }
  };

  const handleSaveMcpServers = async (servers: McpConfig[]) => {
    const res = await fetch('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(servers),
    });
    if (res.ok) {
      const data = await res.json();
      setMcpServers(data.servers);
    }
  };

  const handleTestMcp = async (mcp: McpConfig) => {
    const res = await fetch('/api/mcp/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mcp),
    });
    return await res.json();
  };

  const handleUnarchiveSession = async (id: string) => {
    const sess = sessions.find((s) => s.id === id);
    if (!sess) return;
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: false }),
    });
    if (res.ok) {
      const sessRes = await fetch('/api/sessions');
      if (sessRes.ok) {
        setSessions(await sessRes.json());
      }
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 antialiased font-sans">
      {/* App Header */}
      <Header
        cliStatus={cliStatus}
        projects={projects}
        activeProject={activeProject}
        onSelectProject={setActiveProject}
        onOpenProjectsModal={() => setIsProjectsModalOpen(true)}
        agents={agents}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
        activeView={activeView}
        onSelectView={setActiveView}
        onOpenDirsModal={() => setRightPanelMode((prev) => (prev === 'dirs' ? null : 'dirs'))}
        onOpenHistory={() => setRightPanelMode((prev) => (prev === 'history' ? null : 'history'))}
        onOpenLogs={() => setRightPanelMode((prev) => (prev === 'logs' ? null : 'logs'))}
        activeRightPanelMode={rightPanelMode}
        onOpenSettings={(tab) => {
          if (tab === 'context') {
            setRightPanelMode((prev) => (prev === 'context' ? null : 'context'));
          } else if (tab === 'logs') {
            setRightPanelMode((prev) => (prev === 'logs' ? null : 'logs'));
          } else {
            if (tab) setSettingsTab(tab);
            setIsSettingsOpen(true);
          }
        }}
        onOpenVersions={() =>
          setRightPanelMode((prev) => (prev === 'versions' ? null : 'versions'))
        }
        onOpenSharedMemory={() =>
          setRightPanelMode((prev) => (prev === 'memory' ? null : 'memory'))
        }
        onToggleRightSidebar={() =>
          setRightPanelMode((prev) => (prev === 'payload' ? null : 'payload'))
        }
        isRightSidebarOpen={rightPanelMode === 'payload'}
        autoPlayTts={audioSettings.autoPlayTts}
        onToggleAutoPlayTts={() =>
          setAudioSettings((prev) => ({ ...prev, autoPlayTts: !prev.autoPlayTts }))
        }
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onRefreshStatus={refreshStatus}
        isCheckingStatus={isCheckingStatus}
        messages={messages}
        isStreaming={isStreaming}
        onCancelExecution={handleCancelExecution}
        authorizedDirs={authorizedDirs}
        skills={skills}
        mcpServers={mcpServers}
        metrics={liveMetrics}
      />

      {/* Main Content Area: 3-Area System (Left Sidebar | Center Workspace | Resizable Right Panel) */}
      <main className="flex-1 flex overflow-hidden relative">
        <LeftSidebar
          width={leftSidebarWidth}
          isExpanded={isSidebarExpanded}
          onToggleExpand={() => setIsSidebarExpanded(!isSidebarExpanded)}
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          projects={projects}
          activeProject={activeProject}
          onSelectProject={(p) => {
            setActiveProject(p);
            if (p.associatedDirs[0]) {
              setFilesViewDir(p.associatedDirs[0]);
            }
          }}
          onOpenProjectsModal={() => setIsProjectsModalOpen(true)}
          onOpenSettings={handleOpenSettings}
          onOpenFiles={() => setRightPanelMode((prev) => (prev === 'files' ? null : 'files'))}
          onOpenDirsModal={() => setRightPanelMode((prev) => (prev === 'dirs' ? null : 'dirs'))}
          onOpenHistory={() => setRightPanelMode((prev) => (prev === 'history' ? null : 'history'))}
          onOpenArchivedChats={() => setRightPanelMode((prev) => (prev === 'archived' ? null : 'archived'))}
          onOpenContext={() => {
            setContextTargetSession(null);
            setRightPanelMode((prev) => (prev === 'context' ? null : 'context'));
          }}
          onOpenChatContext={(sess) => {
            setContextTargetSession(sess);
            setRightPanelMode('context');
          }}
          onOpenLogs={() => setRightPanelMode((prev) => (prev === 'logs' ? null : 'logs'))}
          activeRightPanelMode={rightPanelMode}
          onUpdateSession={handleUpdateSession}
          onDeriveSession={handleDeriveSession}
          selectedSessionIds={selectedSessionIds}
          setSelectedSessionIds={setSelectedSessionIds}
          onDeleteMultipleSessions={handleDeleteMultipleSessions}
          onArchiveMultipleSessions={handleArchiveMultipleSessions}
        />

        {/* Resizable Divider Handle for Left Sidebar */}
        {isSidebarExpanded && (
          <div
            onMouseDown={() => setIsResizingLeftSidebar(true)}
            onDoubleClick={() => setLeftSidebarWidth(224)}
            className="w-1.5 hover:w-2 bg-zinc-800/80 hover:bg-blue-500/50 active:bg-blue-500 cursor-col-resize shrink-0 z-30 transition-colors flex items-center justify-center select-none group"
            title="Arraste para redimensionar a barra lateral esquerda (Duplo clique para 224px)"
          >
            <div className="w-0.5 h-6 rounded bg-zinc-700 group-hover:bg-blue-300 transition-colors" />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {Object.entries<any>(audioDiagnostics).filter(([, data]) => data.status === 'failed' || (data.status === 'success' && data.fallbackUsed)).map(([modality, data]) => (
            <div key={modality} role="status" className="px-4 py-2 text-xs text-zinc-400 border-b border-zinc-800">
              {modality.toUpperCase()}: {data.status === 'failed' ? 'falha definitiva' : `recuperado por fallback (${data.model})`}.
              {data.code ? ` ${data.code}.` : ''} <button className="underline" onClick={() => setRightPanelMode('payload')}>Detalhes no Payload</button>
            </div>
          ))}
          {activeView === 'chat' ? (
            <ChatView
              messages={messages}
              isStreaming={isStreaming}
              onSendMessage={handleSendMessage}
              onCancelExecution={handleCancelExecution}
              commands={commands}
              agents={agents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
              thinkingLevel={thinkingLevel}
              onSelectThinkingLevel={handleSelectThinkingLevel}
              onPlayTts={handlePlayTts}
              currentlyNarratingId={currentlyNarratingId}
              onStopTts={handleStopTts}
              onTranscribeAudio={handleTranscribeAudio}
              autoSendVoicePrompt={audioSettings.autoSendVoicePrompt ?? true}
              approvalMode={approvalMode}
              onChangeApprovalMode={setApprovalMode}
              metrics={liveMetrics}
              cliStatus={cliStatus}
              onOpenSettings={handleOpenSettings}
              activeProject={activeProject}
              authorizedDirs={authorizedDirs}
              skills={skills}
              mcpServers={mcpServers}
              onOpenSources={(msg) => {
                setInspectionMessage(msg);
                setRightPanelMode('payload');
              }}
              onDeriveMessage={handleDeriveMessage}
              onDeriveChat={handleDeriveChat}
              onOpenSharedMemory={() => setRightPanelMode((prev) => (prev === 'memory' ? null : 'memory'))}
              activeMemoryVersion={activeMemoryVersion}
              onUpdateMessages={(newMsgs) => { if (!isStreaming) { setExecutionContext(compactExecutionHistory(newMsgs)); setCliSessionId(undefined); void handleUpdateSessionMessages(currentSessionId, newMsgs); } }}
              onOpenMarkdownDoc={handleOpenMarkdownDoc}
            />
          ) : (
            <FilesAndDiffsView
              currentDir={filesViewDir || activeProject?.associatedDirs[0] || authorizedDirs[0]?.path || ''}
              projects={projects}
              activeProject={activeProject}
              authorizedDirs={authorizedDirs}
              onDirectoryChange={(newDir) => setFilesViewDir(newDir)}
            />
          )}
        </div>

        {/* Resizable Divider between Workspace and Right Panel */}
        {rightPanelMode && (
          <div
            onMouseDown={() => setIsResizingRightPanel(true)}
            onDoubleClick={() => setRightPanelWidth(560)}
            className="w-1.5 hover:w-2 bg-zinc-800/80 hover:bg-amber-500/50 active:bg-amber-500 cursor-col-resize shrink-0 z-30 transition-colors flex items-center justify-center select-none group"
            title="Arraste para redimensionar o painel lateral (Duplo clique para 560px)"
          >
            <div className="w-0.5 h-6 rounded bg-zinc-600 group-hover:bg-amber-300" />
          </div>
        )}

        {/* Right Docked Panel */}
        {rightPanelMode && (
          <div
            style={{ width: `${rightPanelWidth}px` }}
            className="shrink-0 h-full border-l border-zinc-800 bg-[#0c0c0e] flex flex-col overflow-hidden relative shadow-2xl"
          >
            {rightPanelMode === 'payload' && (
              <RightSidebar
                isOpen={true}
                audioDiagnostics={audioDiagnostics}
                onClose={() => setRightPanelMode(null)}
                message={inspectionMessage || (messages.length > 0 ? messages[messages.length - 1] : null)}
                agent={
                  agents.find(
                    (a) =>
                      a.id.toLowerCase() === selectedAgentId.toLowerCase() ||
                      a.name.toLowerCase() === selectedAgentId.toLowerCase()
                  ) || agents[0] || DEFAULT_AGENTS[0]
                }
                project={activeProject}
                authorizedDirs={authorizedDirs}
                skills={skills}
                mcpServers={mcpServers}
                approvalMode={approvalMode}
                onOpenSettings={handleOpenSettings}
              />
            )}

            {rightPanelMode === 'versions' && (
              <VersionsSidebar
                refreshKey={versionRevision}
                isOpen={true}
                onClose={() => setRightPanelMode(null)}
                activeProject={activeProject}
                authorizedDirs={authorizedDirs}
                onVersionRestored={() => loadAllData()}
              />
            )}

            {rightPanelMode === 'memory' && (
              <SharedMemorySidebar
                isOpen={true}
                onClose={() => setRightPanelMode(null)}
                activeProject={activeProject}
                currentSessionId={currentSessionId}
                agents={agents}
                onMemoryChanged={(mem) => {
                  setActiveMemory(mem);
                  setActiveMemoryVersion(mem.versions?.length || 1);
                }}
              />
            )}

            {rightPanelMode === 'files' && (
              <FilesAndDiffsSidebar
                isOpen={true}
                onClose={() => setRightPanelMode(null)}
                currentDir={filesViewDir || activeProject?.associatedDirs[0] || authorizedDirs[0]?.path || ''}
                projects={projects}
                activeProject={activeProject}
                authorizedDirs={authorizedDirs}
                onDirectoryChange={(newDir) => setFilesViewDir(newDir)}
              />
            )}

            {rightPanelMode === 'dirs' && (
              <AuthorizedDirsSidebar
                isOpen={true}
                onClose={() => setRightPanelMode(null)}
                authorizedDirs={authorizedDirs}
                onAddDir={handleAddDir}
                onRemoveDir={handleRemoveDir}
              />
            )}

            {rightPanelMode === 'history' && (
              <HistorySidebar
                isOpen={true}
                onClose={() => setRightPanelMode(null)}
                sessions={sessions}
                activeSessionId={currentSessionId}
                onSelectSession={(sess) => {
                  handleSelectSession(sess);
                  setRightPanelMode(null);
                }}
                onNewSession={(projId) => {
                  handleNewSession(projId);
                  setRightPanelMode(null);
                }}
                onDeleteSession={handleDeleteSession}
                projects={projects}
              />
            )}

            {rightPanelMode === 'context' && (
              <ContextSidebar
                isOpen={true}
                onClose={() => {
                  setRightPanelMode(null);
                  setContextTargetSession(null);
                }}
                targetSession={contextTargetSession}
                sessions={sessions}
                currentSessionId={currentSessionId}
                onUpdateSessionMessages={handleUpdateSessionMessages}
                messages={messages}
                onUpdateMessages={(newMsgs) => { if (!isStreaming) { setExecutionContext(compactExecutionHistory(newMsgs)); setCliSessionId(undefined); void handleUpdateSessionMessages(currentSessionId, newMsgs); } }}
                agent={
                  agents.find(
                    (a) =>
                      a.id.toLowerCase() === selectedAgentId.toLowerCase() ||
                      a.name.toLowerCase() === selectedAgentId.toLowerCase()
                  ) || agents[0] || DEFAULT_AGENTS[0]
                }
                activeProject={activeProject}
                projects={projects}
                authorizedDirs={authorizedDirs}
                skills={skills}
                mcpServers={mcpServers}
                contextSettings={contextSettings}
                onUpdateContextSettings={(updates) => setContextSettings((prev) => ({ ...prev, ...updates }))}
              />
            )}

            {rightPanelMode === 'logs' && (
              <LogsSidebar
                isOpen={true}
                onClose={() => setRightPanelMode(null)}
              />
            )}

            {rightPanelMode === 'archived' && (
              <ArchivedChatsSidebar
                isOpen={true}
                onClose={() => setRightPanelMode(null)}
                sessions={sessions}
                onSelectSession={(sess) => {
                  handleSelectSession(sess);
                  setRightPanelMode(null);
                }}
                onUnarchiveSession={handleUnarchiveSession}
                onDeleteSession={handleDeleteSession}
              />
            )}

            {rightPanelMode === 'markdown' && (
              <MarkdownDocViewerSidebar
                isOpen={true}
                onClose={() => setRightPanelMode(null)}
                document={activeMarkdownDoc}
              />
            )}
          </div>
        )}
      </main>

      {/* Snapshots & Versions Modal */}
      <VersionsModal
        isOpen={isVersionsModalOpen}
        onClose={() => setIsVersionsModalOpen(false)}
        activeProject={activeProject}
        authorizedDirs={authorizedDirs}
        onRollbackComplete={() => {
          loadAllData();
        }}
      />

      {/* Authorized Directories Modal */}
      <AuthorizedDirsModal
        isOpen={isDirsModalOpen}
        onClose={() => setIsDirsModalOpen(false)}
        authorizedDirs={authorizedDirs}
        onAddDir={handleAddDir}
        onRemoveDir={handleRemoveDir}
      />

      {/* Projects Modal */}
      <ProjectsModal
        isOpen={isProjectsModalOpen}
        onClose={() => setIsProjectsModalOpen(false)}
        projects={projects}
        activeProject={activeProject}
        onSelectProject={(p) => {
          setActiveProject(p);
          if (p.associatedDirs[0]) {
            setFilesViewDir(p.associatedDirs[0]);
          }
        }}
        onCreateProject={handleCreateProject}
        onUpdateProject={handleUpdateProject}
        onDeleteProject={handleDeleteProject}
        authorizedDirs={authorizedDirs}
        onInspectProjectDirs={(dir) => {
          setFilesViewDir(dir);
          setActiveView('diffs');
        }}
      />

      {/* History Drawer */}
      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        sessions={sessions}
        activeSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        projects={projects}
      />

      {/* Archived Chats Modal */}
      <ArchivedChatsModal
        isOpen={isArchivedChatsOpen}
        onClose={() => setIsArchivedChatsOpen(false)}
        sessions={sessions}
        onSelectSession={handleSelectSession}
        onUnarchiveSession={(id) => handleUpdateSession(id, { isArchived: false })}
        onDeleteSession={handleDeleteSession}
      />

      {/* Multi-Tab Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsTab}
        cliStatus={cliStatus}
        agents={agents}
        onSaveAgent={handleSaveAgent}
        onDeleteAgent={handleDeleteAgent}
        skills={skills}
        onSaveSkill={handleSaveSkill}
        onDeleteSkill={handleDeleteSkill}
        commands={commands}
        onSaveCommand={handleSaveCommand}
        onDeleteCommand={handleDeleteCommand}
        mcpServers={mcpServers}
        onSaveMcpServers={handleSaveMcpServers}
        onTestMcp={handleTestMcp}
        audioSettings={audioSettings}
        onUpdateAudioSettings={(updates) => setAudioSettings((prev) => updateTtsSettings(prev, updates, getSavedVoiceAgents()))}
        approvalMode={approvalMode}
        onChangeApprovalMode={setApprovalMode}
        onRefreshStatus={refreshStatus}
        onResetDefaultAgentsConfig={handleResetDefaultAgents}
        messages={messages}
        onUpdateMessages={(newMsgs) => { if (!isStreaming) { setExecutionContext(compactExecutionHistory(newMsgs)); setCliSessionId(undefined); void handleUpdateSessionMessages(currentSessionId, newMsgs); } }}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onUpdateSessionMessages={handleUpdateSessionMessages}
        activeProject={activeProject}
        authorizedDirs={authorizedDirs}
        contextSettings={contextSettings}
        onUpdateContextSettings={(updates) =>
          setContextSettings((prev) => ({ ...prev, ...updates }))
        }
        projects={projects}
        theme={theme}
        onChangeTheme={setTheme}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
      />
    </div>
  );
}

export default App;
