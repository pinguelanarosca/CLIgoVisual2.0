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
import {
  ContextSettings,
  DEFAULT_CONTEXT_SETTINGS,
  estimateTokens,
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

export function App() {
  // Theme
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Core CLI Status
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [approvalMode, setApprovalMode] = useState<'default' | 'auto_edit' | 'yolo' | 'plan'>('default');

  // Left Sidebar State
  const [isSidebarExpanded, setIsSidebarExpanded] = useState<boolean>(true);

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
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(generateSessionId);
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

  // Right Panel System (Area 3: Docked Sidebars - Payload, Versions, Memory, Logs, History, Dirs, Context, Archived, Files)
  const [rightPanelMode, setRightPanelMode] = useState<
    'payload' | 'versions' | 'memory' | 'logs' | 'history' | 'dirs' | 'context' | 'archived' | 'files' | null
  >(null);
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() =>
    Math.max(280, Math.min(320, typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.20) : 300))
  );
  const [isResizingRightPanel, setIsResizingRightPanel] = useState<boolean>(false);
  const [inspectionMessage, setInspectionMessage] = useState<ChatMessage | null>(null);
  const [contextTargetSession, setContextTargetSession] = useState<SessionItem | null>(null);

  // Versions Snapshot Modal (legacy fallback if needed)
  const [isVersionsModalOpen, setIsVersionsModalOpen] = useState(false);

  // Shared Memory State (Project-wide or session-isolated)
  const [activeMemory, setActiveMemory] = useState<SharedMemoryItem | null>(null);
  const [activeMemoryVersion, setActiveMemoryVersion] = useState(1);

  // Drag-to-resize listener for the right panel
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRightPanel) return;
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= 260 && newWidth <= Math.min(950, window.innerWidth - 280)) {
        setRightPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingRightPanel(false);
    };

    if (isResizingRightPanel) {
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
  }, [isResizingRightPanel]);

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
    ttsModel: 'gemini-3.1-flash-tts',
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

  // Initial Data Fetching & Sync
  const refreshStatus = async (forceFresh = true) => {
    setIsCheckingStatus(true);
    try {
      const data = await fetchJsonSafely<CliStatus>(`/api/status?fresh=${forceFresh ? 'true' : 'false'}`);
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
      }
    } catch (err) {
      console.error('Failed to load initial configurations:', err);
    }
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
    // Track request metric (RPM, TPM, RPD)
    const promptTokens = estimateTokens(promptText);
    setRequestLog((prev) => [...prev, { timestamp: Date.now(), tokenCount: promptTokens }]);

    // Auto context compression check
    let activeBaseMessages = messages;
    if (contextSettings.autoCompress) {
      const currentStats = calculateSessionTokens(messages);
      if (currentStats.totalTokens >= contextSettings.compressionThresholdTokens) {
        const { compressedMessages } = compressContextMessages(messages, contextSettings);
        activeBaseMessages = compressedMessages;
      }
    }

    const currentAgent =
      (agents && agents.length > 0 ? (agents.find((a) => a.id === selectedAgentId) || agents[0]) : null) ||
      DEFAULT_AGENTS[0];

    const startTime = Date.now();
    const workDir = activeProject?.associatedDirs[0] || authorizedDirs[0]?.path || '/workspace';
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

    const updatedMessages = [...activeBaseMessages, userMsg, assistantPlaceholder];
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
          model: currentAgent?.model,
          approvalMode,
          authorizedDirs: authorizedDirs.map((d) => d.path),
          sessionId: currentSessionId,
          resume: messages.length > 0,
          workDir,
          agentId: currentAgent?.id || currentAgent?.name,
          backupAgentId: currentAgent?.backupAgentId,
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

      let updateScheduled = false;
      let lastFlushTime = 0;
      const flushStreamUpdate = () => {
        updateScheduled = false;
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
          agentName: currentAgent?.displayName || currentAgent?.name,
          model: currentAgent?.model || 'gemini-3.5-flash-lite',
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
          const elapsed = Date.now() - lastFlushTime;
          if (elapsed >= 50) {
            requestAnimationFrame(flushStreamUpdate);
          } else {
            setTimeout(() => {
              requestAnimationFrame(flushStreamUpdate);
            }, 50 - elapsed);
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
              rawEventsList.push(eventPayload);

              // Capture finalApiRequest from backend (Exclusivamente o request real capturado)
              if (eventPayload.type === 'final_api_request') {
                const reqObj = eventPayload.finalApiRequest || eventPayload.data?.finalApiRequest;
                if (reqObj) {
                  capturedFinalApiRequest = reqObj;
                }
                const origins = eventPayload.parameterOrigins || eventPayload.data?.parameterOrigins;
                if (origins) {
                  capturedParameterOrigins = origins;
                }
                const allReqs = eventPayload.allRealRequests || eventPayload.data?.allRealRequests;
                if (allReqs && Array.isArray(allReqs) && allReqs.length > 0) {
                  capturedAllRealRequests = allReqs;
                }
              }

              // Inspect Gemini CLI JSON stream event
              if (
                eventPayload.type === 'process_error' ||
                eventPayload.type === 'error' ||
                (eventPayload.exitCode !== undefined && eventPayload.exitCode !== 0)
              ) {
                hasError = true;
                errorMessage = eventPayload.message || eventPayload.text || errorMessage || `Código de saída: ${eventPayload.exitCode}`;
              } else if (eventPayload.type === 'result' && eventPayload.status === 'error') {
                hasError = true;
                errorMessage = eventPayload.error?.message || errorMessage || 'Erro retornado pela API do Gemini.';
              } else if (eventPayload.type === 'message') {
                if (eventPayload.role === 'assistant' && eventPayload.content) {
                  assistantContent += eventPayload.content;
                }
              } else if (eventPayload.type === 'tool_use') {
                const callId = eventPayload.tool_call_id || eventPayload.tool_id || `tool_${Date.now()}`;
                const now = Date.now();
                toolCalls[callId] = {
                  id: callId,
                  toolName: eventPayload.tool_name || eventPayload.name || eventPayload.id || eventPayload.tool || 'tool',
                  parameters: eventPayload.parameters || {},
                  status: 'running',
                  timestamp: eventPayload.timestamp || new Date().toISOString(),
                  startedAt: now,
                  description: eventPayload.description,
                  schema: eventPayload.schema || eventPayload.definition,
                  componentRegister: eventPayload.componentRegister || eventPayload.registered_by,
                  componentExecutor: eventPayload.componentExecutor || eventPayload.executed_by,
                  origin: eventPayload.origin || eventPayload.source,
                  wrapperRelation: eventPayload.wrapperRelation || eventPayload.wrapper,
                };
              } else if (eventPayload.type === 'tool_result') {
                const callId = eventPayload.tool_call_id || eventPayload.tool_id;
                if (callId && toolCalls[callId]) {
                  const now = Date.now();
                  toolCalls[callId].completedAt = now;
                  if (toolCalls[callId].startedAt) {
                    toolCalls[callId].durationMs = now - toolCalls[callId].startedAt!;
                  }
                  toolCalls[callId].result = typeof eventPayload.output === 'string' ? eventPayload.output : JSON.stringify(eventPayload.output || '');
                  toolCalls[callId].status = eventPayload.error ? 'failed' : 'completed';
                  if (eventPayload.error) {
                    toolCalls[callId].error = typeof eventPayload.error === 'string' ? eventPayload.error : JSON.stringify(eventPayload.error);
                  }
                }
              } else if (eventPayload.text) {
                const text = eventPayload.text;
                // Check if this is a genuine authentication error from stderr
                const isAuthNotice = text.includes('Both GOOGLE_API_KEY and GEMINI_API_KEY are set');
                const isAuthError = !isAuthNotice && (
                  text.includes('Please set an Auth method') ||
                  (text.includes('GEMINI_API_KEY') && (
                    text.includes('não foi encontrada') ||
                    text.includes('not set') ||
                    text.includes('missing') ||
                    text.includes('invalid') ||
                    text.includes('unauthorized') ||
                    text.includes('required')
                  ))
                );

                if (isAuthError) {
                  hasError = true;
                  errorMessage = 'A variável de ambiente GEMINI_API_KEY não foi encontrada ou não está autorizada no ambiente do sistema.';
                } else {
                  // Filter out cosmetic warnings from terminal
                  const isBenign =
                    isAuthNotice ||
                    text.includes('256-color support not detected') ||
                    text.includes('Ripgrep is not available') ||
                    text.includes('Falling back to GrepTool') ||
                    text.includes('[MCP]') ||
                    text.includes('MCP Exa');
                  if (!isBenign && !text.startsWith('{')) {
                    assistantContent += (assistantContent ? '\n' : '') + text;
                  }
                }
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

      // Compute final message content & token stats
      let finalContent = assistantContent.trim();
      if (hasError && !finalContent) {
        const errLower = (errorMessage || '').toLowerCase();
        if (errLower.includes('503') || errLower.includes('high demand') || errLower.includes('unavailable') || errLower.includes('overloaded')) {
          finalContent = `⚠️ **API Gemini Temporariamente Sobrecarregada (Erro 503 - High Demand)**\n\n${errorMessage || 'O modelo está enfrentando um pico de demanda temporário nos servidores do Google.'}\n\n💡 **Recomendações:**\n- Alterne para um modelo com maior taxa de disponibilidade como o **Gemini 3.5 Flash Lite** ou **Gemini 2.5 Flash**;\n- Aguarde alguns instantes e tente novamente.`;
        } else if (errLower.includes('429') || errLower.includes('quota') || errLower.includes('resource_exhausted')) {
          finalContent = `⚠️ **Limite de Cota Atingido na API (Erro 429 - Quota Exceeded)**\n\n${errorMessage || 'A cota de requisições por minuto ou limite diário foi atingida para este modelo.'}\n\n💡 **Recomendações:**\n- Aguarde a renovação da cota de requisições;\n- Alterne para outro modelo disponível com limites maiores (ex: Flash Lite).`;
        } else if (
          (errLower.includes('gemini_api_key') && (errLower.includes('missing') || errLower.includes('not set') || errLower.includes('não foi encontrada') || errLower.includes('invalid') || errLower.includes('required'))) ||
          errLower.includes('unauthorized') ||
          errLower.includes('invalid api key') ||
          errLower.includes('api_key_invalid') ||
          errLower.includes('authentication failed') ||
          errLower.includes('401')
        ) {
          finalContent = `⚠️ **Falha de Autenticação da Chave API**\n\n${errorMessage || 'A chave de API do Gemini não foi encontrada ou não possui permissão.'}\n\n💡 **Verificação:**\n- Verifique se a variável \`GEMINI_API_KEY\` está definida no ambiente;\n- Teste a conectividade em tempo real em **Configurações ⚙️ > Testar Conexão com a API**.`;
        } else {
          finalContent = `⚠️ **Falha na Execução do Gemini CLI**\n\n${errorMessage || 'O processo do Gemini CLI foi encerrado com falha.'}`;
        }
      } else if (!finalContent) {
        finalContent = '⚠️ Nenhuma resposta gerada pelo modelo. Verifique o status da API no painel de Configurações.';
      }

      const durationMs = Date.now() - startTime;
      const inputTokens = Math.ceil((promptText.length + (currentAgent?.systemInstructions?.length || 0)) / 4);
      const outputTokens = Math.ceil(finalContent.length / 4);

      // Record output tokens in live rate metrics
      if (outputTokens > 0) {
        setRequestLog((prev) => [...prev, { timestamp: Date.now(), tokenCount: outputTokens }]);
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
        if (tc.status === 'running') {
          const now = Date.now();
          return {
            ...tc,
            status: hasError ? 'failed' : 'completed',
            completedAt: now,
            durationMs: tc.startedAt ? now - tc.startedAt : undefined,
            result: tc.result || (hasError ? 'Execução interrompida com erro' : 'Execução concluída com sucesso'),
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
                finalApiRequest: capturedFinalApiRequest || m.finalApiRequest,
                allFinalApiRequests: capturedAllRealRequests.length > 0 ? capturedAllRealRequests : m.allFinalApiRequests,
                parameterOrigins: capturedParameterOrigins || m.parameterOrigins,
                rawPayloadReceived,
              }
            : m
        )
      );

      // Save session
      const finalAssistantMsg: ChatMessage = {
        ...assistantPlaceholder,
        content: finalContent,
        toolCalls: finalToolCalls,
        activities: finalActivities,
        isStreaming: false,
        finalApiRequest: capturedFinalApiRequest || assistantPlaceholder.finalApiRequest,
        allFinalApiRequests: capturedAllRealRequests.length > 0 ? capturedAllRealRequests : assistantPlaceholder.allFinalApiRequests,
        parameterOrigins: capturedParameterOrigins || assistantPlaceholder.parameterOrigins,
        rawPayloadReceived,
      };

      const finalMsgList = activeBaseMessages.concat([userMsg, finalAssistantMsg]);

      const title =
        promptText.length > 40 ? promptText.slice(0, 40) + '...' : promptText;

      const existingSess = sessions.find((s) => s.id === currentSessionId);
      const effectiveProjectId = existingSess !== undefined ? existingSess.projectId : activeProject?.id;

      const savedSession: SessionItem = {
        id: currentSessionId,
        title: existingSess?.title || title,
        projectId: effectiveProjectId,
        isArchived: existingSess?.isArchived || false,
        createdAt: existingSess?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: finalMsgList.length,
        messages: finalMsgList,
        statusGrade: 'CONFIGURED',
      };

      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savedSession),
      });

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
  const handleTranscribeAudio = async (audioBlob: Blob, signal?: AbortSignal): Promise<string> => {
    // If user prefers browser-native SpeechRecognition or backend is unavailable
    if (audioSettings.sttModel === 'browser-native') {
      return '';
    }

    try {
      const base64Audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = (reader.result as string) || '';
          const base64 = res.includes(',') ? res.split(',')[1] : res;
          resolve(base64);
        };
        reader.onerror = () => reject(new Error('Falha ao processar arquivo de áudio.'));
        reader.readAsDataURL(audioBlob);
      });

      const res = await fetch('/api/audio/stt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          audioBase64: base64Audio,
          mimeType: audioBlob.type || 'audio/webm',
          model: audioSettings.sttModel,
          apiKey: audioSettings.audioApiKey,
          apiUrl: audioSettings.audioApiUrl,
          instructions: audioSettings.sttInstructions,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return data.text || '';
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Transcrição de áudio cancelada pelo usuário.');
        return '';
      }
      console.error('Transcription request failed:', err);
    }
    return '';
  };

  // Audio TTS Handler (synthesizes assistant text to audio)
  const handlePlayTts = async (text: string, messageId: string) => {
    if (currentlyNarratingId === messageId) {
      handleStopTts();
      return;
    }

    handleStopTts();
    setCurrentlyNarratingId(messageId);

    // If browser native fallback
    if (audioSettings.ttsModel === 'browser-native' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = audioSettings.ttsSpeed || 1.0;
      utterance.onend = () => setCurrentlyNarratingId(null);
      utterance.onerror = () => setCurrentlyNarratingId(null);
      window.speechSynthesis.speak(utterance);
      return;
    }

    // Call server Gemini 3.1 Flash TTS Preview
    try {
      const res = await fetch('/api/audio/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: audioSettings.ttsVoice || 'Kore',
          apiKey: audioSettings.audioApiKey,
          apiUrl: audioSettings.audioApiUrl,
          model: audioSettings.ttsModel,
          instructions: audioSettings.ttsInstructions,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.audioBase64) {
          const audio = new Audio(`data:audio/mp3;base64,${data.audioBase64}`);
          currentAudioRef.current = audio;
          audio.playbackRate = audioSettings.ttsSpeed || 1.0;
          audio.onended = () => setCurrentlyNarratingId(null);
          audio.onerror = () => {
            // Fallback to Web Speech API
            if ('speechSynthesis' in window) {
              const utterance = new SpeechSynthesisUtterance(text);
              window.speechSynthesis.speak(utterance);
            }
            setCurrentlyNarratingId(null);
          };
          audio.play();
          return;
        }
      }
    } catch (err) {
      console.error('TTS request failed, attempting local Web Speech API:', err);
    }

    // Fallback if network or model failed
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = audioSettings.ttsSpeed || 1.0;
      utterance.onend = () => setCurrentlyNarratingId(null);
      utterance.onerror = () => setCurrentlyNarratingId(null);
      window.speechSynthesis.speak(utterance);
    } else {
      setCurrentlyNarratingId(null);
    }
  };

  const handleStopTts = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
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
  const handleSelectSession = async (sess: SessionItem) => {
    setCurrentSessionId(sess.id);
    if (sess.projectId) {
      const p = projects.find((x) => x.id === sess.projectId);
      if (p) setActiveProject(p);
    } else {
      setActiveProject(null);
    }

    if (sess.messages && sess.messages.length > 0) {
      setMessages(sess.messages);
    } else {
      try {
        const fullSess = await fetchJsonSafely<SessionItem>(`/api/sessions/${sess.id}`);
        setMessages(fullSess?.messages || []);
      } catch (err) {
        console.error('Erro ao carregar mensagens da sessão:', err);
        setMessages([]);
      }
    }
  };

  const handleNewSession = (projectId?: string | null) => {
    setCurrentSessionId(generateSessionId());
    setMessages([]);
    if (projectId) {
      const p = projects.find((x) => x.id === projectId);
      if (p) {
        setActiveProject(p);
        return;
      }
    }
    setActiveProject(null);
  };

  const handleDeleteSession = async (id: string) => {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSessionId === id) {
      handleNewSession();
    }
  };

  const handleUpdateSession = async (id: string, updates: Partial<SessionItem>) => {
    const sess = sessions.find((s) => s.id === id);
    if (!sess) return;
    const updatedSess = { ...sess, ...updates };

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedSess),
    });
    if (res.ok) {
      const data = await fetchJsonSafely<SessionItem[]>('/api/sessions');
      if (data) {
        setSessions(data);

        if (id === currentSessionId) {
          setMessages(updatedSess.messages || []);
          if (updates.projectId) {
            const p = projects.find((x) => x.id === updates.projectId);
            if (p) setActiveProject(p);
          }
        }
      }
    }
  };

  const handleUpdateSessionMessages = async (sessionId: string, newMessages: ChatMessage[]) => {
    await handleUpdateSession(sessionId, { messages: newMessages });
  };

  const handleDeriveSession = async (originalSess: SessionItem) => {
    const { compressedMessages } = compressContextMessages(originalSess.messages || [], contextSettings);
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
        setCurrentSessionId(newSessionId);
        setMessages(freshMessages);
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
        setCurrentSessionId(newSessionId);
        setMessages([singleMsg]);
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
        setCurrentSessionId(newSessionId);
        setMessages(sliced);
      }
    }
  };

  const handleDeleteMultipleSessions = async (ids: string[]) => {
    for (const id of ids) {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    }
    setSessions((prev) => prev.filter((s) => !ids.includes(s.id)));
    if (ids.includes(currentSessionId)) {
      handleNewSession();
    }
  };

  const handleArchiveMultipleSessions = async (ids: string[]) => {
    for (const id of ids) {
      const sess = sessions.find((s) => s.id === id);
      if (sess) {
        const updatedSess = { ...sess, isArchived: true };
        await fetch('/api/sessions', {
          method: 'POST',
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
      handleNewSession();
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
    const updated = { ...sess, isArchived: false };
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
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

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
                onClose={() => setRightPanelMode(null)}
                message={inspectionMessage || (messages.length > 0 ? messages[messages.length - 1] : null)}
                agent={agents.find((a) => a.id === selectedAgentId) || agents[0] || DEFAULT_AGENTS[0]}
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
                onUpdateMessages={(newMsgs) => setMessages(newMsgs)}
                agent={agents.find((a) => a.id === selectedAgentId) || agents[0]}
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
        onUpdateAudioSettings={(updates) =>
          setAudioSettings((prev) => ({ ...prev, ...updates }))
        }
        approvalMode={approvalMode}
        onChangeApprovalMode={setApprovalMode}
        onRefreshStatus={refreshStatus}
        onResetDefaultAgentsConfig={handleResetDefaultAgents}
        messages={messages}
        onUpdateMessages={(newMsgs) => setMessages(newMsgs)}
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
