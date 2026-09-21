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
} from './types.js';
import { DEFAULT_AGENTS } from './constants/defaultAgents.js';
import { buildEffectiveSystemPrompt } from './utils/systemPromptUtils.js';

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

  // Live Metrics Logs: RPM, TPM, RPD
  const [requestLog, setRequestLog] = useState<Array<{ timestamp: number; tokenCount: number }>>([
    { timestamp: Date.now() - 5000, tokenCount: 18500 },
  ]);

  // Calculate live rate metrics
  const now = Date.now();
  const lastMinuteLog = requestLog.filter((r) => now - r.timestamp <= 60000);
  const rpm = Math.max(1, lastMinuteLog.length);
  const tpm = lastMinuteLog.reduce((acc, r) => acc + r.tokenCount, 0);
  const rpd = Math.max(
    1,
    requestLog.filter((r) => new Date(r.timestamp).toDateString() === new Date(now).toDateString()).length
  );
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

  // Audio Settings & Narration State
  const [audioSettings, setAudioSettings] = useState<AudioSettings>({
    sttEnabled: true,
    sttModel: 'gemini-3.5-flash-lite',
    ttsEnabled: true,
    ttsModel: 'gemini-3.5-flash-lite',
    ttsVoice: 'Kore',
    ttsSpeed: 1.0,
    autoPlayTts: false,
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
      const res = await fetch(`/api/status?fresh=${forceFresh ? 'true' : 'false'}`);
      const contentType = res.headers.get('content-type');
      if (res.ok && contentType && contentType.includes('application/json')) {
        const data = await res.json();
        setCliStatus(data);
        if (data.approvalMode) setApprovalMode(data.approvalMode);
      } else if (!res.ok) {
        console.warn(`Status check failed with status ${res.status}`);
      }
    } catch (err) {
      console.warn('Failed to get CLI status (network or parsing):', err);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const loadAllData = async () => {
    await refreshStatus(false);

    try {
      // Projects
      const projRes = await fetch('/api/projects');
      if (projRes.ok) {
        const projs: ProjectItem[] = await projRes.json();
        setProjects(projs);
        if (projs.length > 0 && !activeProject) {
          setActiveProject(projs[0]);
        }
      }

      // Authorized Dirs
      const dirsRes = await fetch('/api/directories');
      if (dirsRes.ok) {
        const dirs: AuthorizedDir[] = await dirsRes.json();
        setAuthorizedDirs(dirs);
      }

      // Agents
      const agentsRes = await fetch('/api/agents');
      if (agentsRes.ok) {
        const ags: AgentConfig[] = await agentsRes.json();
        setAgents(ags);
      }

      // Skills
      const skillsRes = await fetch('/api/skills');
      if (skillsRes.ok) {
        const sks: SkillConfig[] = await skillsRes.json();
        setSkills(sks);
      }

      // Commands
      const cmdsRes = await fetch('/api/commands');
      if (cmdsRes.ok) {
        const cmds: CommandConfig[] = await cmdsRes.json();
        setCommands(cmds);
      }

      // MCP
      const mcpRes = await fetch('/api/mcp');
      if (mcpRes.ok) {
        const mcps: McpConfig[] = await mcpRes.json();
        setMcpServers(mcps);
      }

      // Sessions
      const sessRes = await fetch('/api/sessions');
      if (sessRes.ok) {
        const sList: SessionItem[] = await sessRes.json();
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
    const rawPayloadSent = {
      cliExecutable: cliStatus?.cliPath || 'gemini',
      model: currentAgent?.model || 'gemini-3.5-flash-lite',
      agentName: currentAgent?.displayName || 'Principal Orchestrator',
      approvalMode,
      workDir,
      authorizedDirs: authorizedDirs.map((d) => d.path),
      systemInstructions: effectiveSysInst,
      projectContext: activeProject ? `Projeto: ${activeProject.name}` : workDir,
      promptText,
      fullInjectedPrompt: `[SISTEMA - INSTRUÇÕES DO AGENTE]\n${effectiveSysInst}\n\n[CONTEXTO DE TRABALHO]\nWorkDir: ${workDir}\nModo Aprovação: ${approvalMode}\n\n[PROMPT ENVIADO]\n${promptText}`,
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
      const toolCalls: Record<string, any> = {};

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
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: displayContent,
                  toolCalls: currentToolCalls,
                  isStreaming: true,
                  finalApiRequest: capturedFinalApiRequest || m.finalApiRequest,
                  parameterOrigins: capturedParameterOrigins || m.parameterOrigins,
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
        const { value, done } = await reader.read();
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

              // Capture finalApiRequest from backend
              if (eventPayload.type === 'final_api_request' && eventPayload.finalApiRequest) {
                capturedFinalApiRequest = eventPayload.finalApiRequest;
                capturedParameterOrigins = eventPayload.parameterOrigins;
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
                toolCalls[callId] = {
                  id: callId,
                  toolName: eventPayload.tool_name || eventPayload.name || eventPayload.id || eventPayload.tool || 'tool',
                  parameters: eventPayload.parameters || {},
                  status: 'running',
                  timestamp: new Date().toISOString(),
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
                  toolCalls[callId].result = eventPayload.output || '';
                  toolCalls[callId].status = eventPayload.error ? 'failed' : 'completed';
                  if (eventPayload.error) {
                    toolCalls[callId].error = eventPayload.error;
                  }
                }
              } else if (eventPayload.text) {
                const text = eventPayload.text;
                // Check if this is an authentication error from stderr
                if (text.includes('Please set an Auth method') || text.includes('GEMINI_API_KEY')) {
                  hasError = true;
                  errorMessage = 'A variável de ambiente GEMINI_API_KEY não foi encontrada ou não está autorizada no ambiente do sistema.';
                } else {
                  // Filter out cosmetic warnings from terminal
                  const isBenign =
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

      // Compute final message content & token stats
      let finalContent = assistantContent.trim();
      if (hasError && !finalContent) {
        finalContent = `⚠️ **Erro na Execução do Gemini CLI**\n\n${errorMessage || 'O processo do Gemini CLI falhou.'}\n\n💡 **Verificação de Ambiente:**\n- Certifique-se de que a variável de ambiente \`GEMINI_API_KEY\` está definida no ambiente;\n- Você pode testar a conectividade em tempo real abrindo as **Configurações** (ícone de engrenagem) e clicando em **Testar Conexão com a API**.`;
      } else if (!finalContent) {
        finalContent = '⚠️ Nenhuma resposta gerada pelo modelo. Verifique o status da API no painel de Configurações.';
      }

      const durationMs = Date.now() - startTime;
      const inputTokens = Math.ceil((promptText.length + (currentAgent?.systemInstructions?.length || 0)) / 4);
      const outputTokens = Math.ceil(finalContent.length / 4);

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

      // Finalize message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: finalContent,
                toolCalls: Object.values(toolCalls),
                isStreaming: false,
                finalApiRequest: capturedFinalApiRequest || m.finalApiRequest,
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
        toolCalls: Object.values(toolCalls),
        isStreaming: false,
        finalApiRequest: capturedFinalApiRequest || assistantPlaceholder.finalApiRequest,
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
      const sessRes = await fetch('/api/sessions');
      if (sessRes.ok) {
        setSessions(await sessRes.json());
      }

      // Auto-play TTS if configured
      if (audioSettings.autoPlayTts && assistantContent) {
        handlePlayTts(assistantContent, assistantMsgId);
      }
    } catch (err: any) {
      console.error('Execution error:', err);
      const isManualAbort = ctrl.signal.aborted || err.name === 'AbortError' || err.message?.includes('aborted');

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === assistantMsgId) {
            let finalContent = m.content;
            if (isManualAbort) {
              finalContent = assistantContent.trim() || 'Execução cancelada pelo usuário.';
            } else {
              const isStreamAborted = err.message?.includes('BodyStreamBuffer') || err.message?.includes('buffer') || err.message?.includes('aborted');
              const displayErr = isStreamAborted
                ? 'A conexão de transmissão foi interrompida de forma inesperada. Isso pode ocorrer por oscilações de rede ou caso o servidor reinicie.'
                : err.message;
              finalContent = assistantContent.trim()
                ? `${assistantContent.trim()}\n\n⚠️ **Conexão Interrompida:** ${displayErr}`
                : `Erro durante execução do Gemini CLI: ${displayErr}`;
            }

            return {
              ...m,
              content: finalContent,
              isStreaming: false,
              error: isManualAbort ? undefined : err.message,
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
  const handleTranscribeAudio = async (audioBlob: Blob): Promise<string> => {
    // If user prefers browser-native SpeechRecognition or backend is unavailable
    if (audioSettings.sttModel === 'browser-native') {
      return '';
    }

    try {
      const buffer = await audioBlob.arrayBuffer();
      const base64Audio = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      const res = await fetch('/api/audio/stt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    } catch (err) {
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

      if (res.ok) {
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
  const handleSelectSession = (sess: SessionItem) => {
    setCurrentSessionId(sess.id);
    setMessages(sess.messages || []);
    if (sess.projectId) {
      const p = projects.find((x) => x.id === sess.projectId);
      if (p) setActiveProject(p);
    } else {
      setActiveProject(null);
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
      const sessRes = await fetch('/api/sessions');
      if (sessRes.ok) {
        const data = await sessRes.json();
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

  const handleDeriveSession = async (originalSess: SessionItem) => {
    const { compressedMessages } = compressContextMessages(originalSess.messages || [], contextSettings);
    const newSessionId = generateSessionId();
    const derivedSession: SessionItem = {
      id: newSessionId,
      title: `${originalSess.title} (Derivado)`,
      projectId: originalSess.projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: compressedMessages.length,
      messages: compressedMessages,
      statusGrade: 'CONFIGURED',
    };

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(derivedSession),
    });

    if (res.ok) {
      const sessRes = await fetch('/api/sessions');
      if (sessRes.ok) {
        const data = await sessRes.json();
        setSessions(data);
        setCurrentSessionId(newSessionId);
        setMessages(compressedMessages);
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
    const sessRes = await fetch('/api/sessions');
    if (sessRes.ok) {
      setSessions(await sessRes.json());
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
        onOpenDirsModal={() => setIsDirsModalOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenSettings={(tab) => {
          if (tab) setSettingsTab(tab);
          setIsSettingsOpen(true);
        }}
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

      {/* Main Content Area with Left Sidebar */}
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
          onOpenDirsModal={() => setIsDirsModalOpen(true)}
          onOpenHistory={() => setIsHistoryOpen(true)}
          onOpenArchivedChats={() => setIsArchivedChatsOpen(true)}
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
              approvalMode={approvalMode}
              onChangeApprovalMode={setApprovalMode}
              metrics={liveMetrics}
              cliStatus={cliStatus}
              onOpenSettings={handleOpenSettings}
              activeProject={activeProject}
              authorizedDirs={authorizedDirs}
              skills={skills}
              mcpServers={mcpServers}
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
      </main>

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
