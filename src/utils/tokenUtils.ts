/**
 * Token Estimation, Rate Metrics, and Context Compression Utilities
 */

import { ChatMessage, AgentConfig, ProjectItem, AuthorizedDir, SkillConfig, McpConfig } from '../types.js';

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

export function calculateSessionTokens(messages: ChatMessage[]) {
  let inputTokens = 0;
  let outputTokens = 0;

  for (const msg of messages) {
    const textTokens = estimateTokens(msg.content);
    let toolTokens = 0;
    if (msg.toolCalls) {
      for (const call of msg.toolCalls) {
        toolTokens +=
          estimateTokens(call.toolName) +
          estimateTokens(JSON.stringify(call.parameters || {})) +
          estimateTokens(call.result || '');
      }
    }

    if (msg.role === 'user' || msg.role === 'system') {
      inputTokens += textTokens + toolTokens;
    } else {
      outputTokens += textTokens + toolTokens;
    }
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
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
  // 1. System instructions
  const systemText = agent?.systemInstructions || 'You are an AI coding assistant powered by Gemini CLI.';
  const systemInstructionsTokens = estimateTokens(systemText);

  // 2. Project context & authorized dirs
  let projectText = activeProject ? `Projeto: ${activeProject.name}\nDescrição: ${activeProject.description}\n` : '';
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

  // 3. Active Messages
  const sessionStats = calculateSessionTokens(messages);
  const messagesTokens = sessionStats.totalTokens;

  // 4. Tools & MCPs
  let toolsText = '';
  if (skills?.length) {
    toolsText += skills.map((s) => `${s.name}: ${s.description}`).join('\n');
  }
  if (mcpServers?.length) {
    toolsText += mcpServers.map((m) => `${m.name}: ${m.command}`).join('\n');
  }
  const toolsAndMcpTokens = estimateTokens(toolsText) + 1200; // base tool definitions

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
    messageCount: messages.length,
  };
}

/**
 * Context Compression Logic
 * Compresses context according to user strategy
 */
export function compressContextMessages(
  messages: ChatMessage[],
  settings: ContextSettings
): { compressedMessages: ChatMessage[]; tokensSaved: number; originalTokens: number; newTokens: number } {
  if (messages.length === 0) {
    return { compressedMessages: [], tokensSaved: 0, originalTokens: 0, newTokens: 0 };
  }

  const originalStats = calculateSessionTokens(messages);
  const originalTokens = originalStats.totalTokens;

  const keepCount = Math.max(2, settings.recentMessagesToKeep);
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

  if (settings.strategy === 'keep_recent_only') {
    compressedMessages = [
      {
        id: `sys_comp_${Date.now()}`,
        role: 'system',
        content: `ℹ️ [COMPRESSÃO DE CONTEXTO]: ${oldMessages.length} mensagens antigas foram descartadas para economizar contexto.`,
        timestamp: new Date().toISOString(),
      },
      ...recentMessages,
    ];
  } else if (settings.strategy === 'truncate_tools') {
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
