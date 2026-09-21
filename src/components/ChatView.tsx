import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Play,
  Pause,
  RotateCcw,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Terminal,
  FileCode,
  Sparkles,
  Bot,
  Brain,
  Cpu,
  AlertTriangle,
  Loader2,
  Sliders,
  Eye,
  EyeOff,
} from 'lucide-react';
import { ChatMessage, ToolCallStep, CommandConfig, AgentConfig, ProjectItem, AuthorizedDir, SkillConfig, McpConfig, ThinkingLevel } from '../types.js';
import { DEFAULT_AGENTS } from '../constants/defaultAgents.js';
import { RawPayloadViewer } from './RawPayloadViewer.js';
import { getRawInspectionData } from '../utils/rawPayloadUtils.js';
import { TokenMonitorBar } from './TokenMonitorBar.js';

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
  onTranscribeAudio: (audioBlob: Blob) => Promise<string>;
  approvalMode: 'default' | 'auto_edit' | 'yolo' | 'plan';
  onChangeApprovalMode?: (mode: 'default' | 'auto_edit' | 'yolo' | 'plan') => void;
  metrics?: { rpm: number; tpm: number; rpd: number };
  cliStatus?: import('../types.js').CliStatus | null;
  onOpenSettings?: (tab?: string) => void;
  activeProject?: ProjectItem | null;
  authorizedDirs?: AuthorizedDir[];
  skills?: SkillConfig[];
  mcpServers?: McpConfig[];
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
}) => {
  const [inputText, setInputText] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [expandedToolCalls, setExpandedToolCalls] = useState<Record<string, boolean>>({});
  const [showCommandsPopup, setShowCommandsPopup] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  // Raw Payload Inspection State ("Mostrar Oculto / Olho")
  const [showRawPayloadGlobal, setShowRawPayloadGlobal] = useState<boolean>(false);
  const [expandedRawMessageIds, setExpandedRawMessageIds] = useState<Record<string, boolean>>({});

  // Audio Recording State for STT
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userIsScrolledUpRef = useRef<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastScrollTimeRef = useRef<number>(0);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 60;
    userIsScrolledUpRef.current = !isNearBottom;
  };

  // Optimized Auto-scroll to bottom on new messages without jarring when user scrolled up
  useEffect(() => {
    if (!messagesEndRef.current) return;
    if (isStreaming) {
      if (!userIsScrolledUpRef.current) {
        const now = Date.now();
        if (now - lastScrollTimeRef.current > 120) {
          lastScrollTimeRef.current = now;
          messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
        }
      }
    } else {
      if (!userIsScrolledUpRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages, isStreaming]);

  // Adjust textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [inputText]);

  // Handle command autocomplete filtering
  const matchingCommands = commands.filter((c) =>
    inputText.startsWith('/') && c.name.toLowerCase().startsWith(inputText.split(' ')[0].toLowerCase())
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);

    if (val.startsWith('/') && !val.includes(' ')) {
      setShowCommandsPopup(true);
      setSelectedCommandIndex(0);
    } else {
      setShowCommandsPopup(false);
    }
  };

  const selectCommand = (cmd: CommandConfig) => {
    setInputText(cmd.name + ' ');
    setShowCommandsPopup(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandsPopup && matchingCommands.length > 0) {
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
        selectCommand(matchingCommands[selectedCommandIndex]);
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

  const handleSend = () => {
    if (!inputText.trim() || isStreaming) return;
    onSendMessage(inputText.trim());
    setInputText('');
    setShowCommandsPopup(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(id);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  const toggleToolCall = (id: string) => {
    setExpandedToolCalls((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Microphone recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());

        setIsTranscribing(true);
        try {
          const transcribedText = await onTranscribeAudio(audioBlob);
          if (transcribedText) {
            setInputText((prev) => (prev ? `${prev} ${transcribedText}` : transcribedText));
          }
        } catch (err) {
          console.error('Transcription error:', err);
        } finally {
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
      alert(`Permissão de microfone não concedida ou dispositivo inacessível: ${err.message}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
  };

  const currentAgent =
    (agents && agents.length > 0 ? (agents.find((a) => a.id === selectedAgentId) || agents[0]) : null) ||
    DEFAULT_AGENTS[0];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-zinc-50/50 dark:bg-zinc-950/40 relative">
      {/* Top Controls Bar with Centered Token Monitor */}
      <div className="px-3 py-1.5 bg-white/90 dark:bg-zinc-900/90 border-b border-zinc-200/80 dark:border-zinc-800 flex items-center justify-center text-xs shrink-0 shadow-2xs z-10">
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

      {/* Missing or Invalid API Key Alert Banner */}
      {cliStatus && (!cliStatus.authConfigured || cliStatus.apiValid === false) && (
        <div className="mx-3 md:mx-6 mt-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2 text-xs text-amber-800 dark:text-amber-200 shadow-2xs shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-[11px]">
              {!cliStatus.authConfigured ? (
                <>
                  <strong>GEMINI_API_KEY ausente:</strong> Configure a chave no ambiente para requisições.
                </>
              ) : (
                <>
                  <strong>Alerta de API:</strong> {cliStatus.apiError || 'Erro na validação da chave.'}
                </>
              )}
            </span>
          </div>
          {onOpenSettings && (
            <button
              onClick={() => onOpenSettings('cli')}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-medium rounded-md transition whitespace-nowrap cursor-pointer shadow-2xs"
            >
              Configurar
            </button>
          )}
        </div>
      )}

      {/* Messages Scroll Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-4"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto py-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600/15 to-indigo-500/15 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-3 shadow-2xs">
              <Bot className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight">
              Gemini CLI Workspace
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm">
              Envie instruções, utilize comandos rápidos com '/' ou ative o microfone para ditado por voz.
            </p>

            {/* Quick Operational Shortcuts */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-5 w-full">
              {commands.slice(0, 6).map((cmd) => (
                <button
                  key={cmd.name}
                  onClick={() => selectCommand(cmd)}
                  className="flex flex-col items-start p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-blue-500/50 dark:hover:border-blue-500/50 transition text-left group shadow-2xs cursor-pointer"
                >
                  <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 group-hover:underline">
                    {cmd.name}
                  </span>
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate w-full mt-0.5">
                    {cmd.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            const isNarrating = currentlyNarratingId === msg.id;
            const isRawExpanded = showRawPayloadGlobal || expandedRawMessageIds[msg.id];
            const inspectionData = isRawExpanded
              ? getRawInspectionData(
                  msg,
                  currentAgent,
                  activeProject,
                  authorizedDirs,
                  skills,
                  mcpServers,
                  approvalMode
                )
              : null;

            return (
              <div
                key={msg.id}
                className={`flex gap-2 max-w-4xl mx-auto ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                )}

                <div
                  className={`flex-1 rounded-xl p-3 transition ${
                    isUser
                      ? 'bg-blue-600 text-white max-w-xl ml-auto rounded-tr-none shadow-2xs'
                      : 'bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-tl-none shadow-2xs text-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  {/* Message Header Info */}
                  <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/80 pb-1.5 mb-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-semibold text-xs ${isUser ? 'text-blue-100' : 'text-zinc-900 dark:text-zinc-100'}`}>
                        {isUser ? 'Você' : msg.agentName || currentAgent?.displayName || 'Agente'}
                      </span>
                      {!isUser && (
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border border-zinc-200/60 dark:border-zinc-700/60">
                          {msg.model || currentAgent?.model || 'gemini-3.5-flash-lite'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Individual Message Eye Button (Mostrar Oculto) */}
                      <button
                        onClick={() =>
                          setExpandedRawMessageIds((prev) => ({
                            ...prev,
                            [msg.id]: !prev[msg.id],
                          }))
                        }
                        title={
                          isRawExpanded
                            ? 'Ocultar payload bruto'
                            : 'Inspecionar payload bruto (Eye)'
                        }
                        className={`p-1 rounded transition cursor-pointer ${
                          isRawExpanded
                            ? 'bg-amber-500/20 text-amber-500 dark:text-amber-300 font-bold'
                            : isUser
                            ? 'text-blue-200 hover:text-white hover:bg-blue-500/50'
                            : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {isRawExpanded ? <Eye className="w-3 h-3 text-amber-500" /> : <EyeOff className="w-3 h-3" />}
                      </button>

                      {/* TTS Audio Narration Action */}
                      {!isUser && (
                        <button
                          onClick={() => {
                            if (isNarrating) {
                              onStopTts();
                            } else {
                              onPlayTts(msg.content, msg.id);
                            }
                          }}
                          title={isNarrating ? 'Pausar narração' : 'Ouvir resposta (TTS)'}
                          className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition cursor-pointer ${
                            isNarrating
                              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300'
                              : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                          }`}
                        >
                          {isNarrating ? <Pause className="w-3 h-3 animate-pulse" /> : <Volume2 className="w-3 h-3" />}
                          <span>{isNarrating ? 'Pausa' : 'Ouvir'}</span>
                        </button>
                      )}

                      {/* Copy text */}
                      <button
                        onClick={() => handleCopy(msg.content, msg.id)}
                        title="Copiar texto"
                        className={`p-1 rounded transition cursor-pointer ${
                          isUser ? 'text-blue-200 hover:text-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'
                        }`}
                      >
                        {copiedMessageId === msg.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Tool Invocations Accordion */}
                  {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mb-2 space-y-1.5">
                      {msg.toolCalls.map((tc) => {
                        const isExpanded = expandedToolCalls[tc.id];
                        return (
                          <div
                            key={tc.id}
                            className="rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 overflow-hidden text-xs"
                          >
                              <button
                                onClick={() => toggleToolCall(tc.id)}
                                className="w-full px-2.5 py-1.5 flex items-center justify-between text-left hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40 transition cursor-pointer"
                              >
                                <div className="flex items-center gap-1.5">
                                  <div className="group relative flex items-center gap-1.5">
                                    <Terminal className="w-3 h-3 text-blue-500" />
                                    <span className="font-mono font-medium text-xs text-zinc-800 dark:text-zinc-200 underline decoration-dotted decoration-zinc-300 dark:decoration-zinc-700 underline-offset-2">
                                      {tc.toolName}
                                    </span>
                                    
                                    <span
                                      className={`text-[9px] px-1 py-0.2 rounded uppercase font-semibold ${
                                        tc.status === 'completed'
                                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                                          : tc.status === 'running'
                                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 animate-pulse'
                                          : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                                      }`}
                                    >
                                      {tc.status}
                                    </span>
                                  </div>
                                </div>
                                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              </button>

                            {isExpanded && (
                              <div className="p-2.5 border-t border-zinc-200/80 dark:border-zinc-800 font-mono text-[10px] bg-zinc-900 text-zinc-100 space-y-1.5 overflow-x-auto">
                                <div>
                                  <span className="text-zinc-400 block mb-0.5">Parâmetros:</span>
                                  <pre className="p-1.5 rounded bg-black/40 text-emerald-400 whitespace-pre-wrap break-all">
                                    {JSON.stringify(tc.parameters, null, 2)}
                                  </pre>
                                </div>
                                {tc.result && (
                                  <div>
                                    <span className="text-zinc-400 block mb-0.5">Resultado:</span>
                                    <pre className="p-1.5 rounded bg-black/40 text-zinc-300 max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
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

                  {/* Main Message Content */}
                  <div className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-sans">
                    {msg.content}
                    {msg.isStreaming && (
                      <span className="inline-block w-1.5 h-3.5 ml-1 bg-blue-500 animate-pulse align-middle" />
                    )}
                  </div>

                  {/* Timestamp */}
                  <div
                    className={`text-[9px] mt-1.5 font-mono ${
                      isUser ? 'text-blue-100 text-right' : 'text-zinc-400 text-left'
                    }`}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>

                  {/* Raw Payload Inspection Viewer ("Mostrar Oculto / Olho") */}
                  {isRawExpanded && inspectionData && (
                    <RawPayloadViewer data={inspectionData} isUserMessage={isUser} />
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating Cancel Button when running */}
      {isStreaming && (
        <div className="absolute top-3 right-4 z-10">
          <button
            onClick={onCancelExecution}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-md transition animate-pulse cursor-pointer"
          >
            <Square className="w-3 h-3 fill-current" />
            <span>Parar</span>
          </button>
        </div>
      )}

      {/* Input Bar Area */}
      <div className="border-t border-zinc-200/80 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md p-2.5 sm:p-3 shrink-0 relative">
        {/* Commands Autocomplete Popup */}
        {showCommandsPopup && matchingCommands.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 md:left-6 md:right-6 mb-1.5 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto z-30">
            <div className="px-2.5 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-100 dark:border-zinc-800">
              Comandos Rápidos
            </div>
            {matchingCommands.map((cmd, idx) => (
              <button
                key={cmd.name}
                onClick={() => selectCommand(cmd)}
                className={`w-full px-2.5 py-1.5 text-left flex items-center justify-between text-xs transition cursor-pointer ${
                  idx === selectedCommandIndex
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300'
                    : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold">{cmd.name}</span>
                  <span className="text-zinc-500 text-[10px] truncate">{cmd.description}</span>
                </div>
                <span className="text-[9px] text-zinc-400 font-mono">Tab/Enter</span>
              </button>
            ))}
          </div>
        )}

        <div className="max-w-4xl mx-auto flex flex-col gap-1.5">
          {/* Input Box */}
          <div className="flex items-end gap-1.5 bg-zinc-100 dark:bg-zinc-800/80 rounded-xl p-1.5 border border-zinc-200 dark:border-zinc-700/60 focus-within:border-blue-500/80 focus-within:ring-1 focus-within:ring-blue-500/20 transition">
            {/* Microphone Button (STT) */}
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isTranscribing}
              title={isRecording ? 'Parar gravação' : 'Ditado por voz'}
              className={`p-2 rounded-lg transition shrink-0 cursor-pointer ${
                isRecording
                  ? 'bg-rose-600 text-white animate-pulse shadow-2xs'
                  : isTranscribing
                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              {isRecording ? (
                <Square className="w-3.5 h-3.5 fill-current" />
              ) : isTranscribing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Mic className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Recording Feedback Banner */}
            {isRecording ? (
              <div className="flex-1 flex items-center justify-between px-2 py-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-600 animate-ping" />
                  <span>Gravando ({recordingSeconds}s)...</span>
                </div>
                <span className="text-[10px] text-zinc-500">Clique para enviar</span>
              </div>
            ) : isTranscribing ? (
              <div className="flex-1 flex items-center gap-1.5 px-2 py-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Transcrevendo áudio...</span>
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Digite sua instrução... (use '/' para comandos rápidos)"
                rows={1}
                className="flex-1 bg-transparent border-0 outline-none resize-none text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 px-1.5 py-1 max-h-36"
              />
            )}

            {/* Send / Stop Button */}
            {isStreaming ? (
              <button
                type="button"
                onClick={onCancelExecution}
                title="Interromper execução"
                className="p-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition shrink-0 shadow-2xs cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputText.trim() || isRecording || isTranscribing}
                title="Enviar (Enter)"
                className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 transition shrink-0 shadow-2xs cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Active Context & Settings Row (Below Input Box) */}
          <div className="flex flex-wrap items-center justify-between text-xs text-zinc-500 px-0.5 gap-2">
            {/* Left side: Agent select and Thinker Button */}
            <div className="flex items-center flex-wrap gap-2">
              {/* Agent selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-zinc-400">Agente:</span>
                <div className="flex items-center gap-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 px-2 py-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 transition">
                  <Bot className="w-3 h-3 text-blue-500 shrink-0" />
                  <select
                    value={selectedAgentId}
                    onChange={(e) => onSelectAgent(e.target.value)}
                    className="bg-transparent text-[10px] font-bold text-zinc-800 dark:text-zinc-200 outline-none pr-1 cursor-pointer"
                  >
                    {(agents && agents.length > 0 ? agents : DEFAULT_AGENTS).map((agent) => (
                      <option key={agent.id} value={agent.id} className="bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200">
                        {agent.displayName || agent.name} ({agent.model})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Thinker Button and Level Selector */}
              {(() => {
                const supportsThinking = isThinkingSupported(currentAgent?.model);
                const currentLevel: ThinkingLevel = (thinkingLevel === 'low' || thinkingLevel === 'high' || thinkingLevel === 'medium') ? thinkingLevel : 'medium';
                return (
                  <div className="flex items-center gap-1.5" id="thinker-control-container">
                    <div
                      id="thinker-button-wrapper"
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border transition text-[10px] font-semibold ${
                        !supportsThinking
                          ? 'bg-zinc-100 dark:bg-zinc-800/40 text-zinc-400 dark:text-zinc-600 border-zinc-200 dark:border-zinc-800/50 cursor-not-allowed opacity-60'
                          : currentLevel === 'high'
                          ? 'bg-purple-50/90 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200/80 dark:border-purple-800/60 shadow-2xs'
                          : currentLevel === 'low'
                          ? 'bg-blue-50/90 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/60 shadow-2xs'
                          : 'bg-indigo-50/90 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60 shadow-2xs'
                      }`}
                      title={
                        !supportsThinking
                          ? `O modelo (${currentAgent?.model || 'atual'}) não suporta controle de thinkingLevel`
                          : `Thinker: ${currentLevel.toUpperCase()} (Nível de Raciocínio Explícito)`
                      }
                    >
                      <Brain
                        className={`w-3.5 h-3.5 shrink-0 ${
                          !supportsThinking
                            ? 'text-zinc-400'
                            : currentLevel === 'high'
                            ? 'text-purple-600 dark:text-purple-400'
                            : currentLevel === 'low'
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-indigo-600 dark:text-indigo-400'
                        }`}
                      />
                      <span className="font-bold tracking-tight">Thinker:</span>
                      <select
                        id="thinker-level-select"
                        disabled={!supportsThinking}
                        value={currentLevel}
                        onChange={(e) => {
                          if (onSelectThinkingLevel) {
                            onSelectThinkingLevel(e.target.value as ThinkingLevel);
                          }
                        }}
                        className="bg-transparent font-bold outline-none cursor-pointer text-[10px] pr-0.5"
                      >
                        <option value="low" className="bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200">
                          Low (Rápido)
                        </option>
                        <option value="medium" className="bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200">
                          Medium (Balanceado)
                        </option>
                        <option value="high" className="bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200">
                          High (Profundo)
                        </option>
                      </select>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Right side: Clickable Approval Mode Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-zinc-400">Aprovação:</span>
              <div className="flex items-center gap-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 px-2 py-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 transition">
                <Sliders className="w-3 h-3 text-amber-500 shrink-0" />
                <select
                  value={approvalMode}
                  onChange={(e) => {
                    if (onChangeApprovalMode) {
                      onChangeApprovalMode(e.target.value as any);
                    }
                  }}
                  className="bg-transparent text-[10px] font-bold text-zinc-800 dark:text-zinc-200 outline-none pr-1 cursor-pointer"
                >
                  <option value="default" className="bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200">
                    Padrão (Confirmar)
                  </option>
                  <option value="auto_edit" className="bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200">
                    Auto-Editar
                  </option>
                  <option value="yolo" className="bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200">
                    YOLO (Direto)
                  </option>
                  <option value="plan" className="bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200">
                    Planejar
                  </option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
