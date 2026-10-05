/**
 * Token Estimation, Rate Metrics, and Context Compression Utilities
 */

import { ChatMessage, AgentConfig, ProjectItem, AuthorizedDir, SkillConfig, McpConfig } from '../types.js';
import { buildEffectiveSystemPrompt } from './systemPromptUtils.js';

export interface ContextSettings {
  autoCompress: boolean;
  compressionThresholdPercent: number; // e.g. 75 (%)
  compressionThresholdTokens: number; // e.g. 100000
  strategy: 'summarize_old' | 'truncate_tools' | 'keep_recent_only';
  maxContextWindow: number; // e.g. 1000000
  preserveSystemPrompt: boolean;
  preserveProjectContext: boolean;
  recentMessagesToKeep: number; // e.g. 10
}

export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = {
  autoCompress: true,
  compressionThresholdPercent: 75,
  compressionThresholdTokens: 100000,
  strategy: 'summarize_old',
  maxContextWindow: 1000000,
  preserveSystemPrompt: true,
  preserveProjectContext: true,
  recentMessagesToKeep: 10,
};

// Estimate tokens from text (roughly ~3.8 characters per token for PT/EN code & text)
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

export function formatTokenCount(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k';
  }
  return num.toLocaleString('pt-BR');
}

export function estimateParamsLength(params: any): number {
  if (!params) return 0;
  if (typeof params === 'string') return params.length;
  if (typeof params === 'object') {
    let len = 0;
    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        len += key.length + 3;
        const val = params[key];
        if (typeof val === 'string') len += val.length;
        else if (typeof val === 'number' || typeof val === 'boolean') len += 8;
        else if (val && typeof val === 'object') len += 20;
      }
    }
    return len;
  }
  return 0;
}

export function calculateSessionTokens(messages: ChatMessage[]) {
  if (!messages || messages.length === 0) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const msg of messages) {
    // 1. Calculate length from content and prompt sent
    let inputCharLength = 0;
    let outputCharLength = 0;

    if (msg.role === 'user' || msg.role === 'system') {
      inputCharLength += (msg.content || '').length;
      if (msg.rawPayloadSent?.fullInjectedPrompt) {
        inputCharLength = Math.max(inputCharLength, msg.rawPayloadSent.fullInjectedPrompt.length);
      } else if (msg.rawPayloadSent?.promptText) {
        inputCharLength = Math.max(inputCharLength, msg.rawPayloadSent.promptText.length);
      }
    } else {
      outputCharLength += (msg.content || '').length;
      if (msg.rawPayloadReceived?.rawTextStream) {
        outputCharLength = Math.max(outputCharLength, msg.rawPayloadReceived.rawTextStream.length);
      }
    }

    // 2. Include tool calls (parameters + results + errors)
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const call of msg.toolCalls) {
        const nameLen = (call.toolName || '').length;
        const paramsLen = estimateParamsLength(call.parameters);
        const resultLen = (call.result || '').length + (call.error || '').length;

        // Tool invocations & parameters count as input/orchestration; results count as tool outputs
        inputCharLength += nameLen + paramsLen;
        outputCharLength += resultLen;
      }
    }

    // 3. Include activities
    if (msg.activities && msg.activities.length > 0) {
      for (const act of msg.activities) {
        const actText = (act.command || '') + (act.result || '') + (act.filePath || '') + (act.error || '');
        if (act.type === 'command' || act.type === 'file_edit' || act.type === 'file_read') {
          outputCharLength += actText.length;
        }
      }
    }

    let msgInputTokens = Math.ceil(inputCharLength / 3.8);
    let msgOutputTokens = Math.ceil(outputCharLength / 3.8);

    // 4. Check if rawPayloadReceived tokenStats gives a higher reported count
    if (msg.rawPayloadReceived?.tokenStats) {
      const stats = msg.rawPayloadReceived.tokenStats;
      if (stats.inputTokens && stats.inputTokens > msgInputTokens) {
        msgInputTokens = stats.inputTokens;
      }
      if (stats.outputTokens && stats.outputTokens > msgOutputTokens) {
        msgOutputTokens = stats.outputTokens;
      }
    }

    totalInputTokens += msgInputTokens;
    totalOutputTokens += msgOutputTokens;
  }

  return {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
}

export interface ContextBreakdown {
  systemInstructionsTokens: number;
  projectContextTokens: number;
  messagesTokens: number;
  toolsAndMcpTokens: number;
  totalActiveTokens: number;
  maxContextWindow: number;
  utilizationPercent: number;
  messageCount: number;
}

export function calculateContextBreakdown(
  messages: ChatMessage[],
  agent?: AgentConfig | null,
  activeProject?: ProjectItem | null,
  authorizedDirs?: AuthorizedDir[],
  skills?: SkillConfig[],
  mcpServers?: McpConfig[],
  maxContextWindow = 1000000
): ContextBreakdown {
  // 1. System instructions (incorporates baseInstructions and systemInstructions)
  let systemText = '';
  if (agent) {
    systemText = buildEffectiveSystemPrompt(
      agent.baseInstructions,
      agent.systemInstructions,
      agent.overrideBasePrompt
    );
  }
  if (!systemText.trim()) {
    systemText = 'Você é o assistente virtual inteligente do Gemini CLI Orchestrator.';
  }
  const systemInstructionsTokens = estimateTokens(systemText);

  // 2. Project context & authorized dirs
  let projectText = activeProject ? `Projeto: ${activeProject.name}\nDescrição: ${activeProject.description || 'Sem descrição'}\n` : '';
  if (activeProject?.associatedDirs?.length) {
    projectText += `Diretórios do Projeto: ${activeProject.associatedDirs.join(', ')}\n`;
  }
  if (activeProject?.guidelines) {
    projectText += `Diretrizes do Projeto (gemini.md):\n${activeProject.guidelines}\n`;
  }
  if (authorizedDirs?.length) {
    projectText += `Diretórios Autorizados: ${authorizedDirs.map((d) => d.path).join(', ')}\n`;
  }
  const projectContextTokens = estimateTokens(projectText);

  // 3. Active Messages Tokens (accurately calculated using full contents, attachments & tools)
  const sessionStats = calculateSessionTokens(messages || []);
  const messagesTokens = sessionStats.totalTokens;

  // 4. Tools & MCPs (Includes base tool schemas definition overhead ~3,500 tokens + skills + MCPs)
  let toolsText = 'Base System Tools Schemas (view_file, edit_file, create_file, run_command, list_dir, search, compile_applet, lint_applet, manage_task, schedule)\n';
  // Standard tool JSON schema definition overhead is roughly ~13,000 characters (~3,400 tokens)
  let baseToolsSchemaOverheadTokens = 3400;

  const activeSkills = skills?.filter((s) => s.enabled !== false) || [];
  if (activeSkills.length > 0) {
    toolsText += activeSkills.map((s) => `Skill [${s.name}]: ${s.description}\n${s.content || ''}`).join('\n');
  }
  const activeMcp = mcpServers?.filter((m) => m.enabled !== false) || [];
  if (activeMcp.length > 0) {
    toolsText += activeMcp.map((m) => `MCP [${m.name}]: ${m.command || m.httpUrl || ''}`).join('\n');
  }
  const toolsAndMcpTokens = baseToolsSchemaOverheadTokens + estimateTokens(toolsText);

  const totalActiveTokens =
    systemInstructionsTokens + projectContextTokens + messagesTokens + toolsAndMcpTokens;
  const utilizationPercent = Math.min(100, Math.round((totalActiveTokens / maxContextWindow) * 100 * 10) / 10);

  return {
    systemInstructionsTokens,
    projectContextTokens,
    messagesTokens,
    toolsAndMcpTokens,
    totalActiveTokens,
    maxContextWindow,
    utilizationPercent,
    messageCount: messages ? messages.length : 0,
  };
}

/**
 * Context Compression Logic
 * Compresses context according to user strategy
 */
export function compressContextMessages(
  messages: ChatMessage[],
  settings?: Partial<ContextSettings>
): { compressedMessages: ChatMessage[]; tokensSaved: number; originalTokens: number; newTokens: number } {
  const effectiveSettings: ContextSettings = {
    ...DEFAULT_CONTEXT_SETTINGS,
    ...(settings || {}),
  };
  if (messages.length === 0) {
    return { compressedMessages: [], tokensSaved: 0, originalTokens: 0, newTokens: 0 };
  }

  const originalStats = calculateSessionTokens(messages);
  const originalTokens = originalStats.totalTokens;

  const keepCount = Math.max(2, effectiveSettings.recentMessagesToKeep);
  if (messages.length <= keepCount) {
    return {
      compressedMessages: messages,
      tokensSaved: 0,
      originalTokens,
      newTokens: originalTokens,
    };
  }

  const oldMessages = messages.slice(0, messages.length - keepCount);
  const recentMessages = messages.slice(messages.length - keepCount);

  let compressedMessages: ChatMessage[] = [];

  if (effectiveSettings.strategy === 'keep_recent_only') {
    compressedMessages = [
      {
        id: `sys_comp_${Date.now()}`,
        role: 'system',
        content: `ℹ️ [COMPRESSÃO DE CONTEXTO]: ${oldMessages.length} mensagens antigas foram descartadas para economizar contexto.`,
        timestamp: new Date().toISOString(),
      },
      ...recentMessages,
    ];
  } else if (effectiveSettings.strategy === 'truncate_tools') {
    // Truncate long tool responses and long message contents in old messages
    const truncatedOld = oldMessages.map((msg) => {
      let content = msg.content;
      if (content.length > 300) {
        content = content.slice(0, 150) + '\n...[conteúdo resumido]...\n' + content.slice(-150);
      }
      const toolCalls = msg.toolCalls?.map((tc) => ({
        ...tc,
        result: tc.result && tc.result.length > 200 ? tc.result.slice(0, 100) + '... [saída truncada]' : tc.result,
      }));
      return { ...msg, content, toolCalls };
    });

    compressedMessages = [...truncatedOld, ...recentMessages];
  } else {
    // Strategy 'summarize_old' (default)
    const oldUserTopics = oldMessages
      .filter((m) => m.role === 'user')
      .map((m) => m.content.slice(0, 60))
      .join('; ');

    const summaryContent = `📝 [RESUMO COMPACTADO DE CONTEXTO ANTIGO]:\nHistórico anterior (${oldMessages.length} mensagens) resumido. Principais tópicos tratados: ${oldUserTopics || 'Discussões de código e comandos'}.`;

    const summaryMsg: ChatMessage = {
      id: `sys_summary_${Date.now()}`,
      role: 'system',
      content: summaryContent,
      timestamp: new Date().toISOString(),
    };

    compressedMessages = [summaryMsg, ...recentMessages];
  }

  const newStats = calculateSessionTokens(compressedMessages);
  const newTokens = newStats.totalTokens;
  const tokensSaved = Math.max(0, originalTokens - newTokens);

  return {
    compressedMessages,
    tokensSaved,
    originalTokens,
    newTokens,
  };
}
