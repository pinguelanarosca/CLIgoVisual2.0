/**
 * Type definitions for Gemini CLI GUI (Ubuntu Linux Local App)
 */

export type StatusGrade = 'IMPLEMENTED' | 'CONFIGURED' | 'TESTED' | 'VALIDATED' | 'NOT VALIDATED';

export interface CliStatus {
  available: boolean;
  version: string;
  cliPath: string;
  localCliPath?: string;
  localVersion?: string;
  globalCliPath?: string;
  globalVersion?: string;
  globalUpdateNotice?: string;
  connectionState: 'connected' | 'error' | 'not_detected';
  authConfigured: boolean;
  maskedApiKey?: string;
  apiValid?: boolean;
  apiChecked?: boolean;
  apiError?: string;
  latencyMs?: number;
  modelTested?: string;
  activeSessionId?: string;
  errorMessage?: string;
  approvalMode: 'default' | 'auto_edit' | 'yolo' | 'plan';
}

export type ThinkingLevel = 'low' | 'medium' | 'high';

export interface AgentConfig {
  id: string;
  name: string;
  displayName: string;
  role: string;
  model: string;
  backupAgentId?: string;
  description: string;
  baseInstructions?: string;
  systemInstructions: string;
  overrideBasePrompt?: boolean;
  enabled: boolean;
  kind: 'local' | 'remote';
  tools: string[];
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  thinking?: boolean;
  thinkingLevel?: ThinkingLevel;
  conceptualProfile?: string;
  maxTurns?: number;
  statusGrade: StatusGrade;
}

export interface SkillConfig {
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  statusGrade: StatusGrade;
}

export interface CommandConfig {
  name: string; // e.g., "/debug"
  description: string;
  promptTemplate: string;
  enabled: boolean;
  statusGrade: StatusGrade;
}

export interface PolicyConfig {
  filename: string;
  content: string;
}

export interface McpConfig {
  name: string;
  command?: string;
  args?: string[];
  httpUrl?: string;
  url?: string;
  type?: string;
  trust?: boolean;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled: boolean;
  status: 'connected' | 'stopped' | 'error' | 'unknown';
  statusGrade: StatusGrade;
}

export interface HookConfig {
  id: string;
  name: string;
  event: 'pre-tool' | 'post-tool' | 'session-start' | 'session-end';
  command: string;
  enabled: boolean;
  supportedInCliVersion: boolean;
  statusGrade: StatusGrade;
}

export interface ProjectItem {
  id: string;
  name: string;
  description: string;
  associatedDirs: string[];
  createdAt: string;
  updatedAt: string;
  activeSessionId?: string;
  guidelines?: string;
}

export interface AuthorizedDir {
  path: string;
  exists: boolean;
  isWritable: boolean;
  alias?: string;
  addedAt: string;
}

export interface ToolCallStep {
  id: string;
  toolName: string;
  parameters: Record<string, any>;
  result?: string;
  error?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'requires_approval';
  timestamp: string;
  description?: string;
  schema?: any;
  componentRegister?: string;
  componentExecutor?: string;
  origin?: string;
  wrapperRelation?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export type ActivityType =
  | 'thinking'
  | 'command'
  | 'file_read'
  | 'file_edit'
  | 'file_create'
  | 'web_search'
  | 'mcp_tool'
  | 'invoke_agent'
  | 'tool'
  | 'validation'
  | 'error'
  | 'cancelled'
  | 'completed';

export type ActivityStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface NormalizedActivity {
  id: string;
  sequence: number;
  type: ActivityType;
  status: ActivityStatus;
  title: string;
  timestamp: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;

  // Origin & correlation identifiers
  toolCallId?: string;
  eventId?: string;
  requestId?: string;

  // Real data for detail layer (Layer 3)
  toolName?: string;
  command?: string;
  filePath?: string;
  searchQuery?: string;
  targetAgent?: string;
  agentName?: string;
  model?: string;
  arguments?: Record<string, any>;
  result?: string;
  error?: string;
  metadata?: Record<string, any>;
  rawEvent?: any;
}

export interface FinalApiRequest {
  model: string;
  contents: Array<{ role: string; parts: Array<{ text?: string; [key: string]: any }> }>;
  systemInstruction?: { parts: Array<{ text: string }> } | string | null;
  generationConfig: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    thinkingConfig?: { includeThoughts: boolean; thinkingLevel: ThinkingLevel };
    [key: string]: any;
  };
  tools?: any[];
  safetySettings?: any[];
  [key: string]: any;
}

export interface ParameterOrigin {
  value: any;
  source: string;
  category?: string;
}

export interface CapturedRealRequest {
  requestId?: string;
  promptId?: string;
  sessionId?: string;
  model: string;
  role?: string;
  timestamp: string;
  finalApiRequest: FinalApiRequest;
  callIndex?: number;
}

export interface ParameterOrigins {
  [paramName: string]: ParameterOrigin;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  model?: string;
  agentName?: string;
  toolCalls?: ToolCallStep[];
  activities?: NormalizedActivity[];
  isStreaming?: boolean;
  error?: string;
  audioUrl?: string;
  isNarrating?: boolean;
  finalApiRequest?: FinalApiRequest;
  allFinalApiRequests?: CapturedRealRequest[];
  parameterOrigins?: ParameterOrigins;
  rawPayloadSent?: {
    cliExecutable?: string;
    model?: string;
    agentName?: string;
    approvalMode?: string;
    workDir?: string;
    authorizedDirs?: string[];
    systemInstructions?: string;
    projectContext?: string;
    promptText?: string;
    fullInjectedPrompt?: string;
    skills?: string[];
    mcpServers?: string[];
    timestamp?: string;
    finalApiRequest?: FinalApiRequest;
    parameterOrigins?: ParameterOrigins;
  };
  rawPayloadReceived?: {
    rawEvents?: any[];
    rawTextStream?: string;
    tokenStats?: { inputTokens: number; outputTokens: number; totalTokens: number };
    durationMs?: number;
    completedAt?: string;
  };
}

export interface SessionItem {
  id: string;
  title: string;
  projectId?: string;
  isArchived?: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  messages: ChatMessage[];
  statusGrade: StatusGrade;
}

export interface FileDiffItem {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
  diff: string;
  binary?: boolean;
}

export interface FileEntryItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
}

export interface FilesAndDiffsResult {
  currentDir: string;
  parentDir?: string | null;
  exists: boolean;
  isGitRepo: boolean;
  branch?: string;
  gitStatus: string;
  files: string[];
  entries: FileEntryItem[];
  diffs: FileDiffItem[];
  authorizedDirs?: string[];
  error?: string;
}

export interface VoicePreset {
  id: string;
  name: string;
  voiceName: string; // 'Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'
  customInstructions: string;
}

export interface AudioSettings {
  sttEnabled: boolean;
  sttModel: string; // 'gemini-3.5-transcribe' or 'browser-native'
  ttsEnabled: boolean;
  ttsModel: string; // 'gemini-3.1-flash-tts-preview' or 'browser-native'
  ttsVoice: string; // 'Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'
  ttsSpeed: number; // 0.75 - 1.5
  autoPlayTts: boolean;
  filterCodeInTts: boolean;
  filterDiffsInTts: boolean;
  micStatus: 'ready' | 'recording' | 'transcribing' | 'error';
  audioApiKey?: string;
  audioApiUrl?: string;
  sttInstructions?: string;
  ttsInstructions?: string;
  savedVoicePresets: VoicePreset[];
  activeTtsAgentId?: string;
  activeSttAgentId?: string;
  directorConfig?: any;
  audioModelStatus: {
    sttAvailable: boolean;
    ttsAvailable: boolean;
    liveAvailable: boolean;
    message?: string;
  };
}

export interface AppSettings {
  cliPath: string;
  approvalMode: 'default' | 'auto_edit' | 'yolo' | 'plan';
  defaultModel: string;
  streamOutput: boolean;
  permissions: {
    allowShellCommands: boolean;
    allowFileWrites: boolean;
    allowGitOperations: boolean;
    allowMcpExecution: boolean;
    allowDestructiveActions: boolean;
  };
  audio: AudioSettings;
  theme: 'dark' | 'light' | 'system';
}

export interface ModelCatalogItem {
  order: number;
  id: string;
  name: string;
  rpm: string;
  tpm: string;
  rpd: string;
  category: string;
  group: 'stable' | 'preview' | 'audio' | 'embeddings' | 'agents' | 'gemma' | 'text' | 'robotics';
  groupName: string;
  subFunction?: string;
  description?: string;
  recommendedRole?: string;
}

export interface ValidationItem {
  item: string;
  category: 'CORE' | 'AGENTS' | 'SKILLS' | 'COMMANDS' | 'MCP' | 'HOOKS' | 'AUDIO' | 'PACKAGING';
  status: StatusGrade;
  evidence: string;
  notes: string;
}

export interface GitCommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  url?: string;
}

export interface GitAppStatus {
  isGitRepo: boolean;
  repoUrl: string;
  branch: string;
  currentCommit?: string;
  currentCommitShort?: string;
  commitMessage?: string;
  commitDate?: string;
  hasUncommittedChanges: boolean;
  uncommittedFilesCount: number;
  remoteUrl?: string;
  gitAvailable: boolean;
  gitVersion?: string;
}

export interface GitUpdateCheckResult {
  hasUpdate: boolean;
  localCommit?: string;
  remoteCommit?: string;
  remoteCommitShort?: string;
  remoteCommitInfo?: GitCommitInfo;
  branch: string;
  repoUrl: string;
  message: string;
  error?: string;
}

export interface GitUpdateResult {
  success: boolean;
  message: string;
  updatedCommit?: string;
  logs: string[];
  requiresRestart?: boolean;
  restarting?: boolean;
  rebuilt?: boolean;
  installedDeps?: boolean;
  error?: string;
}

export interface SystemRebuildResult {
  success: boolean;
  message: string;
  logs: string[];
  error?: string;
}

export interface SystemRestartResult {
  success: boolean;
  message: string;
  delayMs?: number;
}

export type SystemLogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug';
export type SystemLogCategory =
  | 'CLI'
  | 'SERVER'
  | 'API'
  | 'GIT'
  | 'PROJECT'
  | 'AGENT'
  | 'AGENTS'
  | 'SKILL'
  | 'COMMAND'
  | 'MCP'
  | 'AUDIO'
  | 'PACKAGE'
  | 'CONFIG'
  | 'AUTH'
  | 'SQLITE'
  | 'SYSTEM';

export interface SystemLogEntry {
  id: string;
  timestamp: string; // ISO 8601
  formattedDateTime: string; // e.g., '10/09/2026 14:52:30.123'
  level: SystemLogLevel;
  category: SystemLogCategory;
  message: string;
  source?: string;
  details?: Record<string, any> | string;
}

export interface BackupSectionOptions {
  generalSettings: boolean;
  agents: boolean;
  chatHistory: boolean;
  skills: boolean;
  commands: boolean;
  mcpServers: boolean;
  policies: boolean;
  projects: boolean;
  authorizedDirs: boolean;
}

export interface BackupExportData {
  version: string;
  appName: string;
  createdAt: string;
  metadata: {
    totalSessions: number;
    totalAgents: number;
    totalSkills: number;
    totalCommands: number;
    totalMcpServers: number;
    totalPolicies: number;
    totalProjects: number;
    exportedSections: string[];
  };
  generalSettings?: {
    theme?: 'dark' | 'light';
    approvalMode?: string;
    cliPath?: string;
    modelConfigs?: Record<string, any>;
  };
  agents?: AgentConfig[];
  sessions?: SessionItem[];
  skills?: SkillConfig[];
  commands?: CommandConfig[];
  mcpServers?: McpConfig[];
  policies?: PolicyConfig[];
  projects?: ProjectItem[];
  authorizedDirs?: string[];
  audioSettings?: any;
  contextSettings?: any;
}

export interface RestoreBackupResult {
  success: boolean;
  message: string;
  restoredSections: string[];
  error?: string;
}

export interface FactoryResetResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface AppVersionItem {
  id: string;
  versionNumber: number;
  createdAt: string;
  prompt: string;
  agentName: string;
  model: string;
  executionId: string;
  projectId?: string;
  workspaceDir: string;
  changedFiles: string[];
  snapshotDirName: string;
  isBackup?: boolean;
}

export interface VersionDiffItem {
  filePath: string;
  status: 'added' | 'modified' | 'deleted';
  originalContent: string;
  versionContent: string;
}

export interface MemoryVersionEntry {
  version: number;
  content: string;
  timestamp: string;
  author: 'user' | 'agent';
  description?: string;
}

export interface MemoryAgentConfig {
  name: string;
  model: string;
  agentId?: string;
  systemInstructions: string;
  temperature?: number;
}

export interface SharedMemoryItem {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  sessionId?: string;
  scope?: 'project' | 'session' | 'global';
  agentConfig?: MemoryAgentConfig;
  versions: MemoryVersionEntry[];
}

