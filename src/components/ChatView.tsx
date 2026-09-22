import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Mic,
  Volume2,
  VolumeX,
  Pause,
  Copy,
  Check,
  Brain,
  Sliders,
  Eye,
  Code2,
  GitFork,
  MessageSquareShare,
  Sparkles,
  Plus,
  Loader2,
  AlertTriangle,
  Bot,
  Paperclip,
  GitBranch,
  FileEdit,
  FolderOpen,
  Terminal,
  Cpu,
  ScrollText,
  FileText,
  FileJson,
  File,
  X,
  Globe,
} from 'lucide-react';
import { LiveAudioWaveform } from './LiveAudioWaveform.js';
import {
  ChatMessage,
  CommandConfig,
  AgentConfig,
  ProjectItem,
  AuthorizedDir,
  SkillConfig,
  McpConfig,
  ThinkingLevel,
  CliStatus,
} from '../types.js';
import { DEFAULT_AGENTS } from '../constants/defaultAgents.js';
import { TokenMonitorBar } from './TokenMonitorBar.js';
import { MessageRenderer } from './MessageRenderer.js';
import { AgentProcessAccordion } from './AgentProcessAccordion.js';
import { ContentViewerSidebar, ContentViewerItem } from './ContentViewerSidebar.js';
import { classifyToolActivity, generateActivityTitle } from '../utils/activityTraceUtils.js';

export const isThinkingSupported = (model?: string): boolean => {
  if (!model) return true;
  const m = model.toLowerCase();
  if (
    m.includes('embedding') ||
    m.includes('tts') ||
    m.includes('veo') ||
    m.includes('lyria') ||
    (m.includes('transcribe') && !m.includes('extended-thinking'))
  ) {
    return false;
  }
  return true;
};

interface ChatViewProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onCancelExecution: () => void;
  commands: CommandConfig[];
  agents: AgentConfig[];
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  thinkingLevel?: ThinkingLevel;
  onSelectThinkingLevel?: (level: ThinkingLevel) => void;
  onPlayTts: (text: string, messageId: string) => void;
  currentlyNarratingId: string | null;
  onStopTts: () => void;
  onTranscribeAudio: (audioBlob: Blob, signal?: AbortSignal) => Promise<string>;
  approvalMode: 'default' | 'auto_edit' | 'yolo' | 'plan';
  onChangeApprovalMode?: (mode: 'default' | 'auto_edit' | 'yolo' | 'plan') => void;
  metrics?: { rpm: number; tpm: number; rpd: number };
  cliStatus?: CliStatus | null;
  onOpenSettings?: (tab?: string) => void;
  activeProject?: ProjectItem | null;
  authorizedDirs?: AuthorizedDir[];
  skills?: SkillConfig[];
  mcpServers?: McpConfig[];
  onOpenSources?: (message: ChatMessage) => void;
  onDeriveMessage?: (message: ChatMessage) => void;
  onDeriveChat?: (messageIndex: number) => void;
  onOpenSharedMemory?: () => void;
  activeMemoryVersion?: number;
}

export interface AttachedFileItem {
  id: string;
  name: string;
  size: number;
  extension: string;
  content: string;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  isStreaming,
  onSendMessage,
  onCancelExecution,
  commands,
  agents,
  selectedAgentId,
  onSelectAgent,
  thinkingLevel = 'medium',
  onSelectThinkingLevel,
  onPlayTts,
  currentlyNarratingId,
  onStopTts,
  onTranscribeAudio,
  approvalMode,
  onChangeApprovalMode,
  metrics,
  cliStatus,
  onOpenSettings,
  activeProject = null,
  authorizedDirs = [],
  skills = [],
  mcpServers = [],
  onOpenSources,
  onDeriveMessage,
  onDeriveChat,
  onOpenSharedMemory,
  activeMemoryVersion = 1,
}) => {
  const [inputText, setInputText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileItem[]>([]);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);

  // Content Viewer Side-Panel State
  const [viewerItem, setViewerItem] = useState<ContentViewerItem | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  // Audio Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Autocomplete popup for "/"
  const [showCommandsPopup, setShowCommandsPopup] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [commandFilter, setCommandFilter] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const autoScrollRef = useRef(true);
  const thinkingMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (thinkingMenuRef.current && !thinkingMenuRef.current.contains(event.target as Node)) {
        setShowThinkingMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const scrollToBottom = () => {
    if (autoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), 1800);
    });
  };

  const handleSend = () => {
    const text = inputText.trim();
    if ((!text && attachedFiles.length === 0) || isStreaming) return;

    let fullPrompt = text;
    if (attachedFiles.length > 0) {
      const attachmentsPayload = attachedFiles
        .map(
          (f) =>
            `--- INÍCIO DO ARQUIVO ANEXADO: ${f.name} ---\n${f.content}\n--- FIM DO ARQUIVO ANEXADO: ${f.name} ---`
        )
        .join('\n\n');

      fullPrompt = text
        ? `${text}\n\n[ARQUIVOS ANEXADOS]:\n${attachmentsPayload}`
        : `[ARQUIVOS ANEXADOS]:\n${attachmentsPayload}`;
    }

    onSendMessage(fullPrompt);
    setInputText('');
    setAttachedFiles([]);
    setShowCommandsPopup(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandsPopup) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex((prev) => (prev + 1) % matchingCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex((prev) => (prev - 1 + matchingCommands.length) % matchingCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (matchingCommands[selectedCommandIndex]) {
          selectCommand(matchingCommands[selectedCommandIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        setShowCommandsPopup(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);

    if (val.startsWith('/')) {
      setShowCommandsPopup(true);
      setCommandFilter(val.slice(1).toLowerCase());
      setSelectedCommandIndex(0);
    } else {
      setShowCommandsPopup(false);
    }

    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const matchingCommands = commands.filter((c) =>
    c.name.toLowerCase().includes(commandFilter) || c.description.toLowerCase().includes(commandFilter)
  );

  const selectCommand = (cmd: CommandConfig) => {
    setInputText(`/${cmd.name} `);
    setShowCommandsPopup(false);
    textareaRef.current?.focus();
  };

  // Audio Recording (STT)
  const sttAbortControllerRef = useRef<AbortController | null>(null);

  const cancelTranscription = () => {
    if (sttAbortControllerRef.current) {
      sttAbortControllerRef.current.abort();
      sttAbortControllerRef.current = null;
    }
    setIsTranscribing(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setRecordingStream(stream);
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        setRecordingStream(null);
        setIsTranscribing(true);

        const controller = new AbortController();
        sttAbortControllerRef.current = controller;

        try {
          const transcribedText = await onTranscribeAudio(audioBlob, controller.signal);
          if (transcribedText) {
            setInputText((prev) => (prev ? `${prev} ${transcribedText}` : transcribedText));
          }
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            console.error('Falha na transcrição:', err);
          }
        } finally {
          sttAbortControllerRef.current = null;
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (err: any) {
      alert(`Microfone inacessível: ${err.message}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingStream) {
      recordingStream.getTracks().forEach((track) => track.stop());
      setRecordingStream(null);
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file: File) => {
        const reader = new FileReader();
        const extension = file.name.includes('.')
          ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
          : '';

        reader.onload = (event) => {
          const content = (event.target?.result as string) || '';
          setAttachedFiles((prev) => [
            ...prev,
            {
              id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              name: file.name,
              size: file.size,
              extension,
              content,
            },
          ]);
        };
        reader.readAsText(file);
      });
    }
    if (e.target) e.target.value = '';
    setShowPlusMenu(false);
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const currentAgent =
    (agents && agents.length > 0 ? (agents.find((a) => a.id === selectedAgentId) || agents[0]) : null) ||
    DEFAULT_AGENTS[0];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#09090b] text-zinc-200 relative select-text">
      {/* Top Token Bar */}
      <div className="px-2 py-0.5 bg-zinc-950/80 border-b border-zinc-900 flex items-center justify-center text-xs shrink-0 z-10 backdrop-blur-md">
        <TokenMonitorBar
          messages={messages}
          isStreaming={isStreaming}
          agent={currentAgent}
          activeProject={activeProject}
          authorizedDirs={authorizedDirs}
          skills={skills}
          mcpServers={mcpServers}
          metrics={metrics || { rpm: 1, tpm: 0, rpd: 1 }}
          onOpenContextSettings={() => onOpenSettings?.('context')}
        />
      </div>

      {/* Missing API Key Warning */}
      {cliStatus && (!cliStatus.authConfigured || cliStatus.apiValid === false) && (
        <div className="mx-2 mt-1 p-1.5 rounded bg-amber-500/10 border border-amber-500/20 flex items-center justify-between text-xs text-amber-200 shrink-0">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[10.5px]">
              {!cliStatus.authConfigured
                ? 'GEMINI_API_KEY ausente: defina a chave para habilitar requisições.'
                : cliStatus.apiError || 'Erro na validação da chave API.'}
            </span>
          </div>
          {onOpenSettings && (
            <button
              onClick={() => onOpenSettings('cli')}
              className="px-1.5 py-0.5 bg-amber-600 hover:bg-amber-500 text-white text-[10.5px] font-medium rounded transition cursor-pointer"
            >
              Ajustes
            </button>
          )}
        </div>
      )}

      {/* Messages Scroll Area — ZERO CAIXAS & MARGENS MÍNIMAS */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-1 sm:px-2 py-0.5 space-y-1 font-sans"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto py-4">
            <div className="w-7 h-7 rounded bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-1.5">
              <Bot className="w-4 h-4" />
            </div>
            <h2 className="text-xs font-semibold text-zinc-200 tracking-tight">
              CLIgoVisual 2.0
            </h2>
            <p className="text-[10.5px] text-zinc-400 mt-0.5 max-w-sm leading-tight">
              Terminal visual e ambiente de desenvolvimento Gemini CLI. Envie instruções ou use '/' para comandos.
            </p>

            {/* Quick shortcuts */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 mt-3 w-full">
              {commands.slice(0, 6).map((cmd) => (
                <button
                  key={cmd.name}
                  onClick={() => selectCommand(cmd)}
                  className="flex flex-col items-start p-1 rounded bg-zinc-900/40 border border-zinc-800/60 hover:border-zinc-700 transition text-left cursor-pointer group"
                >
                  <span className="font-mono text-[11px] font-semibold text-blue-400 group-hover:underline">
                    {cmd.name}
                  </span>
                  <span className="text-[9.5px] text-zinc-500 truncate w-full mt-0.5">
                    {cmd.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            const isNarrating = currentlyNarratingId === msg.id;

            // Interactive activity state indicator for Gemini assistant
            const getActivityState = () => {
              if (msg.isStreaming) {
                const runningTool = msg.toolCalls?.find((t) => t.status === 'running');
                if (runningTool) {
                  const { type, isWebSearch } = classifyToolActivity(runningTool.toolName, runningTool.parameters);
                  const title = generateActivityTitle(type, 'running', runningTool.toolName, runningTool.parameters);

                  if (isWebSearch) {
                    return {
                      icon: <Globe className="w-3 h-3 text-cyan-400 animate-pulse" />,
                      label: title,
                      color: 'text-cyan-400',
                    };
                  }
                  if (type === 'file_edit' || type === 'file_create') {
                    return {
                      icon: <FileEdit className="w-3 h-3 text-blue-400 animate-pulse" />,
                      label: title,
                      color: 'text-blue-400',
                    };
                  }
                  if (type === 'file_read') {
                    return {
                      icon: <FolderOpen className="w-3 h-3 text-amber-400 animate-pulse" />,
                      label: title,
                      color: 'text-amber-400',
                    };
                  }
                  if (type === 'command') {
                    return {
                      icon: <Terminal className="w-3 h-3 text-emerald-400 animate-pulse" />,
                      label: title,
                      color: 'text-emerald-400',
                    };
                  }
                  if (type === 'invoke_agent') {
                    return {
                      icon: <Bot className="w-3 h-3 text-violet-400 animate-pulse" />,
                      label: title,
                      color: 'text-violet-400',
                    };
                  }
                  return {
                    icon: <Cpu className="w-3 h-3 text-purple-400 animate-pulse" />,
                    label: title,
                    color: 'text-purple-400',
                  };
                }
                return {
                  icon: <Sparkles className="w-3 h-3 text-amber-400 animate-spin" />,
                  label: 'Pensando e gerando resposta...',
                  color: 'text-amber-400',
                };
              }

              // Finished state
              if (msg.toolCalls && msg.toolCalls.length > 0) {
                const hasEdits = msg.toolCalls.some((t) => {
                  const { type } = classifyToolActivity(t.toolName, t.parameters);
                  return type === 'file_edit' || type === 'file_create';
                });
                const hasCmds = msg.toolCalls.some((t) => {
                  const { type } = classifyToolActivity(t.toolName, t.parameters);
                  return type === 'command';
                });
                const hasSearch = msg.toolCalls.some((t) => {
                  const { isWebSearch } = classifyToolActivity(t.toolName, t.parameters);
                  return isWebSearch;
                });

                if (hasSearch) {
                  return {
                    icon: <Globe className="w-3 h-3 text-cyan-400" />,
                    label: 'Concluído: Pesquisa web realizada',
                    color: 'text-cyan-400',
                  };
                }
                if (hasEdits) {
                  return {
                    icon: <FileEdit className="w-3 h-3 text-blue-400" />,
                    label: 'Concluído: Arquivos e código modificados',
                    color: 'text-blue-400',
                  };
                }
                if (hasCmds) {
                  return {
                    icon: <Terminal className="w-3 h-3 text-emerald-400" />,
                    label: 'Concluído: Comandos de terminal executados',
                    color: 'text-emerald-400',
                  };
                }
              }

              return {
                icon: <Sparkles className="w-3 h-3 text-indigo-400" />,
                label: 'Google Gemini AI',
                color: 'text-indigo-400',
              };
            };

            const activity = getActivityState();

            return (
              <div
                key={msg.id}
                className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`group relative py-0.5 select-text ${
                    isUser
                      ? 'ml-auto w-fit max-w-[88%] sm:max-w-[78%] md:max-w-2xl flex flex-col items-end'
                      : 'mr-auto w-full max-w-4xl flex flex-col items-start'
                  }`}
                >
                  {/* Header da Mensagem: Autor + Data + Interactive Gemini Icon + Model Badge */}
                  <div className={`flex items-center gap-1.5 mb-0.5 text-xs w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <span
                      className={`font-semibold text-xs tracking-tight ${
                        isUser ? 'text-zinc-200 font-mono' : 'text-blue-400'
                      }`}
                    >
                      {isUser ? 'Você' : msg.agentName || currentAgent?.displayName || 'Agente'}
                    </span>

                    <span className="text-[10px] text-zinc-500 font-mono">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>

                    {!isUser && (
                      <div
                        className="flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.2 rounded bg-zinc-900/90 text-zinc-400 border border-zinc-800/90 hover:border-zinc-700 transition cursor-help select-none"
                        title={activity.label}
                      >
                        {activity.icon}
                        <span className="text-zinc-300 font-medium">
                          {msg.model || 'gemini'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Tool Invocations Accordion & Activity Trace */}
                  {!isUser && (
                    (msg.activities && msg.activities.length > 0) ||
                    (msg.toolCalls && msg.toolCalls.length > 0) ||
                    (msg.rawPayloadReceived?.rawEvents && msg.rawPayloadReceived.rawEvents.length > 0)
                  ) && (
                    <div className="w-full">
                      <AgentProcessAccordion
                        toolCalls={msg.toolCalls}
                        activities={msg.activities}
                        rawEvents={msg.rawPayloadReceived?.rawEvents}
                        isStreaming={msg.isStreaming}
                        agentName={msg.agentName}
                        model={msg.model}
                        error={msg.error}
                      />
                    </div>
                  )}

                  {/* Conteúdo da Mensagem — Flutua Livremente sem caixas ou contornos */}
                  <div className={`w-fit max-w-full ${isUser ? 'text-zinc-100 font-medium text-left' : 'text-zinc-300 font-normal text-left'} leading-tight`}>
                    <MessageRenderer
                      content={msg.content}
                      isStreaming={msg.isStreaming}
                      onOpenViewer={(item) => {
                        setViewerItem(item);
                        setIsViewerOpen(true);
                      }}
                    />
                  </div>

                  {/* Barra de Ações Compacta: Alinhada e ajustada sem excesso de separação */}
                  <div className="flex items-center justify-start gap-0.5 mt-0.5 pt-0.5 text-[9.5px] text-zinc-500 opacity-60 group-hover:opacity-100 transition-opacity w-full flex-wrap">
                    {/* Copiar */}
                    <button
                      type="button"
                      onClick={() => handleCopy(msg.content, msg.id)}
                      title="Copiar mensagem"
                      className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition cursor-pointer leading-none"
                    >
                      {copiedMessageId === msg.id ? (
                        <>
                          <Check className="w-2.5 h-2.5 text-emerald-400" />
                          <span className="text-emerald-400 font-medium">Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-2.5 h-2.5" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>

                    {/* Narrar (Ler em voz alta) */}
                    <button
                      type="button"
                      onClick={() => {
                        if (isNarrating) {
                          onStopTts();
                        } else {
                          onPlayTts(msg.content, msg.id);
                        }
                      }}
                      title={isNarrating ? 'Pausar narração' : 'Ler em voz alta (TTS)'}
                      className={`inline-flex items-center gap-0.5 px-1 py-0.2 rounded transition cursor-pointer leading-none ${
                        isNarrating
                          ? 'text-blue-400 bg-blue-500/10'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80'
                      }`}
                    >
                      {isNarrating ? (
                        <>
                          <div className="flex items-end gap-0.5 h-2">
                            <span className="w-0.5 bg-blue-400 rounded-full animate-equalizer-1 h-2" />
                            <span className="w-0.5 bg-blue-400 rounded-full animate-equalizer-2 h-2" />
                            <span className="w-0.5 bg-blue-400 rounded-full animate-equalizer-3 h-2" />
                          </div>
                          <span>Narrando</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-2.5 h-2.5" />
                          <span>Narrar</span>
                        </>
                      )}
                    </button>

                    {/* Payload / Fontes */}
                    {onOpenSources && (
                      <button
                        type="button"
                        onClick={() => onOpenSources(msg)}
                        title="Auditoria e Payload da API"
                        className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-zinc-400 hover:text-amber-400 hover:bg-zinc-800/80 transition cursor-pointer leading-none"
                      >
                        <Code2 className="w-2.5 h-2.5 text-amber-400" />
                        <span>Payload</span>
                      </button>
                    )}

                    {/* Bifurcar Chat (Histórico até esta mensagem) */}
                    {onDeriveChat && (
                      <button
                        type="button"
                        onClick={() => onDeriveChat(index)}
                        title="Bifurcar Chat: Criar nova conversa preservando o histórico acumulado até esta mensagem"
                        className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800/80 transition cursor-pointer leading-none"
                      >
                        <GitFork className="w-2.5 h-2.5 text-emerald-400" />
                        <span>Bifurcar Chat</span>
                      </button>
                    )}

                    {/* Bifurcar Mensagem (Somente esta mensagem) */}
                    {onDeriveMessage && (
                      <button
                        type="button"
                        onClick={() => onDeriveMessage(msg)}
                        title="Bifurcar Mensagem: Criar nova conversa transportando apenas esta mensagem"
                        className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-zinc-400 hover:text-purple-400 hover:bg-zinc-800/80 transition cursor-pointer leading-none"
                      >
                        <MessageSquareShare className="w-2.5 h-2.5 text-purple-400" />
                        <span>Bifurcar Mensagem</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Consolidated Input Bar (Google AI Studio / Codex Style) */}
      <div className="p-1.5 sm:p-2 bg-[#09090b]/95 border-t border-zinc-900 shrink-0 relative">
        {/* Commands Autocomplete Popup */}
        {showCommandsPopup && matchingCommands.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 md:left-4 md:right-4 mb-1.5 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden max-h-52 overflow-y-auto z-30">
            <div className="px-2.5 py-1 text-[9.5px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-900">
              Comandos Rápidos
            </div>
            {matchingCommands.map((cmd, idx) => (
              <button
                key={cmd.name}
                onClick={() => selectCommand(cmd)}
                className={`w-full px-2.5 py-1 text-left flex items-center justify-between text-xs transition cursor-pointer ${
                  idx === selectedCommandIndex
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'text-zinc-300 hover:bg-zinc-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-blue-400">/{cmd.name}</span>
                  <span className="text-zinc-500 text-[10px] truncate">{cmd.description}</span>
                </div>
                <span className="text-[9px] text-zinc-500 font-mono">Tab/Enter</span>
              </button>
            ))}
          </div>
        )}

        <div className="max-w-4xl mx-auto flex flex-col gap-1 pr-1.5">
          {/* Attached Files Chips Grid */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 p-1.5 bg-zinc-950/90 rounded-lg border border-zinc-800/80 mb-0.5">
              {attachedFiles.map((file) => {
                const ext = file.extension || '.txt';
                const isJson = ext === '.json' || ext === '.yaml' || ext === '.yml';
                const isMd = ext === '.md' || ext === '.markdown' || ext === '.txt';
                const isCode = ['.ts', '.tsx', '.js', '.jsx', '.py', '.html', '.css', '.rs', '.go', '.cpp', '.c', '.java', '.sh'].includes(ext);

                return (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 bg-zinc-900 border border-zinc-700/80 rounded-lg text-xs shadow-xs hover:border-zinc-600 transition"
                  >
                    {/* File Extension Icon */}
                    <div
                      className={`p-1 rounded flex items-center justify-center shrink-0 ${
                        isJson
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : isMd
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : isCode
                          ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                          : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                      }`}
                    >
                      {isJson ? (
                        <FileJson className="w-3.5 h-3.5" />
                      ) : isMd ? (
                        <FileText className="w-3.5 h-3.5" />
                      ) : isCode ? (
                        <Code2 className="w-3.5 h-3.5" />
                      ) : (
                        <File className="w-3.5 h-3.5" />
                      )}
                    </div>

                    {/* File Name & Details */}
                    <div className="flex flex-col min-w-0 pr-1">
                      <span className="text-xs font-semibold text-zinc-200 truncate max-w-[150px]" title={file.name}>
                        {file.name}
                      </span>
                      <span className="text-[9.5px] font-mono text-zinc-400 flex items-center gap-1">
                        <span className="uppercase font-bold text-[8.5px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-300">
                          {ext.replace('.', '') || 'FILE'}
                        </span>
                        <span>•</span>
                        <span>{(file.size / 1024).toFixed(1)} KB</span>
                      </span>
                    </div>

                    {/* Close / Remove Attachment Button */}
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(file.id)}
                      title="Cancelar envio do anexo"
                      className="p-1 rounded-full text-zinc-400 hover:text-rose-400 hover:bg-rose-950/50 transition cursor-pointer shrink-0 ml-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Main Integrated Input Container */}
          <div className="relative flex items-end gap-1 bg-zinc-900/90 rounded-lg p-1 border border-zinc-800 focus-within:border-zinc-700 transition">
            {/* Botão + (Anexar arquivo / fontes externas) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowPlusMenu(!showPlusMenu)}
                title="Adicionar arquivos e conexões"
                className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>

              {showPlusMenu && (
                <div className="absolute bottom-full left-0 mb-1.5 w-48 rounded-lg bg-zinc-950 border border-zinc-800 shadow-2xl p-1 text-xs z-30 space-y-0.5">
                  <label className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-900 text-zinc-300 cursor-pointer text-xs">
                    <Paperclip className="w-3.5 h-3.5 text-blue-400" />
                    <span>Anexar Arquivo</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>

                  {onOpenSharedMemory && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowPlusMenu(false);
                        onOpenSharedMemory();
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-900 text-zinc-300 cursor-pointer text-left text-xs"
                    >
                      <ScrollText className="w-3.5 h-3.5 text-purple-400" />
                      <span>Memória Compartilhada</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Live Recording Waveform replaces Textarea when active */}
            {isRecording ? (
              <LiveAudioWaveform stream={recordingStream} isRecording={isRecording} />
            ) : isTranscribing ? (
              <div className="flex-1 flex items-center justify-between gap-2 px-2 py-1 text-xs text-amber-400 font-mono">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Transcrevendo fala com IA...</span>
                </div>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={cancelTranscription}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  className="px-2 py-0.5 text-xs rounded bg-red-950/80 hover:bg-red-900 border border-red-800/80 text-red-300 transition flex items-center gap-1 cursor-pointer font-sans"
                  title="Cancelar transcrição"
                >
                  <X className="w-3 h-3" />
                  <span>Cancelar</span>
                </button>
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Instrução para o Gemini CLI... (digite '/' para comandos)"
                rows={1}
                className="flex-1 bg-transparent border-0 outline-hidden resize-none text-xs sm:text-sm text-zinc-100 placeholder-zinc-500 px-1.5 py-0.5 max-h-36 font-sans leading-tight"
              />
            )}

            {/* Right-hand Action Group (From Left to Right: 1. Mic, 2. Memory, 3. Brain/Thinking, 4. Send) */}
            <div className="flex items-center gap-1 shrink-0">
              {/* 1. Microfone / Esfera Gemini Live (Senta-se imediatamente ao lado do waveform) */}
              {isRecording ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  title="Concluir gravação"
                  className="relative p-1 rounded-full flex items-center justify-center transition shrink-0 cursor-pointer group -ml-3.5 z-10"
                >
                  {/* Concentric Aura Ripples */}
                  <span className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-400 opacity-60 animate-ping" />
                  <span className="absolute -inset-1 rounded-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-purple-500 opacity-40 blur-xs animate-pulse" />
                  {/* Glowing 3D Glassy Sphere */}
                  <div className="relative w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-600 via-purple-500 to-cyan-300 shadow-[0_0_12px_rgba(129,140,248,0.8)] border border-white/40 flex items-center justify-center overflow-hidden transition-transform group-hover:scale-105">
                    <div className="absolute top-0.5 left-1 w-2 h-1.5 rounded-full bg-white/70 blur-[0.5px]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-white/90 shadow-sm animate-pulse" />
                  </div>
                </button>
              ) : isTranscribing ? (
                <div
                  title="Transcrevendo..."
                  className="p-1.5 rounded text-zinc-500 opacity-40 shrink-0 pointer-events-none select-none"
                >
                  <Mic className="w-3.5 h-3.5" />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  title="Ditado por voz"
                  className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition shrink-0 cursor-pointer"
                >
                  <Mic className="w-3.5 h-3.5" />
                </button>
              )}

              {/* 2. Memória persistente compartilhada (Ícone ScrollText com badge de versão) */}
              {onOpenSharedMemory && (
                <button
                  type="button"
                  onClick={onOpenSharedMemory}
                  title="Abrir Memória Persistente Compartilhada"
                  className="p-1.5 rounded text-purple-400 hover:text-purple-300 hover:bg-purple-950/50 transition cursor-pointer flex items-center gap-0.5"
                >
                  <ScrollText className="w-3.5 h-3.5" />
                  {activeMemoryVersion > 0 && (
                    <span className="text-[9px] font-mono px-1 rounded bg-purple-950 text-purple-300 border border-purple-800/50">
                      v{activeMemoryVersion}
                    </span>
                  )}
                </button>
              )}

              {/* 3. Nível de pensamento (Cérebro) */}
              <div ref={thinkingMenuRef} className="relative">
                {(() => {
                  const supportsThinking = isThinkingSupported(currentAgent?.model);
                  const currentLevel: ThinkingLevel =
                    thinkingLevel === 'low' || thinkingLevel === 'high' || thinkingLevel === 'medium'
                      ? thinkingLevel
                      : 'medium';

                  return (
                    <>
                      <button
                        type="button"
                        disabled={!supportsThinking}
                        onClick={() => setShowThinkingMenu(!showThinkingMenu)}
                        title={
                          !supportsThinking
                            ? 'Este modelo não suporta nível de pensamento ajustável'
                            : `Nível de Pensamento: ${currentLevel.toUpperCase()} (Clique para alterar)`
                        }
                        className={`p-1.5 rounded transition cursor-pointer flex items-center gap-0.5 ${
                          !supportsThinking
                            ? 'text-zinc-600 cursor-not-allowed'
                            : currentLevel === 'high'
                            ? 'text-purple-300 bg-purple-950/50'
                            : currentLevel === 'low'
                            ? 'text-blue-300 bg-blue-950/50'
                            : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                        }`}
                      >
                        <Brain className="w-3.5 h-3.5" />
                        <span className="text-[9px] font-mono font-bold uppercase opacity-80">
                          {currentLevel[0]}
                        </span>
                      </button>

                      {showThinkingMenu && supportsThinking && (
                        <div className="absolute bottom-full right-0 mb-1.5 w-28 rounded-lg bg-zinc-950 border border-zinc-800 shadow-2xl p-1 text-xs z-30 space-y-0.5">
                          {(['low', 'medium', 'high'] as ThinkingLevel[]).map((lvl) => (
                            <button
                              key={lvl}
                              type="button"
                              onClick={() => {
                                if (onSelectThinkingLevel) onSelectThinkingLevel(lvl);
                                setShowThinkingMenu(false);
                              }}
                              className={`w-full px-2 py-1 rounded text-left text-xs flex items-center justify-between cursor-pointer transition ${
                                currentLevel === lvl
                                  ? 'bg-purple-950 text-purple-300 font-semibold'
                                  : 'text-zinc-300 hover:bg-zinc-900'
                              }`}
                            >
                              <span className="capitalize">{lvl}</span>
                              {currentLevel === lvl && <Check className="w-3 h-3 text-purple-400" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* 4. Enviar / Parar texto (Extrema direita) */}
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onCancelExecution}
                  title="Parar execução"
                  className="p-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white transition shrink-0 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={(!inputText.trim() && attachedFiles.length === 0) || isRecording || isTranscribing}
                  title="Enviar mensagem (Enter)"
                  className="p-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 text-white transition shrink-0 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Bottom Bar: Clean Labels, No Tech Suffixes, Integrated Controls */}
          <div className="flex flex-wrap items-center justify-between text-xs text-zinc-400 px-0.5 gap-1.5">
            <div className="flex items-center flex-wrap gap-1.5">
              {/* Agent Selector (Clean, no excessive suffixes) */}
              <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5">
                <Bot className="w-3 h-3 text-blue-400 shrink-0" />
                <select
                  value={selectedAgentId}
                  onChange={(e) => onSelectAgent(e.target.value)}
                  className="bg-transparent text-[10.5px] font-medium text-zinc-200 outline-hidden cursor-pointer"
                >
                  {(agents && agents.length > 0 ? agents : DEFAULT_AGENTS).map((agent) => (
                    <option key={agent.id} value={agent.id} className="bg-zinc-950 text-zinc-200">
                      {agent.displayName || agent.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Approval Mode (Clean Labels) */}
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5">
              <Sliders className="w-3 h-3 text-amber-400 shrink-0" />
              <select
                value={approvalMode}
                onChange={(e) => {
                  if (onChangeApprovalMode) {
                    onChangeApprovalMode(e.target.value as any);
                  }
                }}
                className="bg-transparent text-[10.5px] font-medium text-zinc-200 outline-hidden cursor-pointer"
              >
                <option value="default" className="bg-zinc-950 text-zinc-200">
                  Padrão
                </option>
                <option value="auto_edit" className="bg-zinc-950 text-zinc-200">
                  Auto-Editar
                </option>
                <option value="yolo" className="bg-zinc-950 text-zinc-200">
                  YOLO
                </option>
                <option value="plan" className="bg-zinc-950 text-zinc-200">
                  Planejar
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Side-Panel Drawer for Content Viewing (Attached Files & Long Outputs) */}
      <ContentViewerSidebar
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        item={viewerItem}
      />
    </div>
  );
};
