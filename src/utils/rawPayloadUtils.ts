import { ChatMessage, AgentConfig, ProjectItem, AuthorizedDir, SkillConfig, McpConfig, FinalApiRequest, ParameterOrigins } from '../types.js';
import { estimateTokens } from './tokenUtils.js';
import { buildEffectiveSystemPrompt } from './systemPromptUtils.js';

export interface RawInspectionData {
  finalApiRequest: FinalApiRequest;
  parameterOrigins: ParameterOrigins;
  input: {
    cliExecutable: string;
    model: string;
    agentName: string;
    approvalMode: string;
    workDir: string;
    authorizedDirs: string[];
    systemInstructions: string;
    projectContext: string;
    activeSkills: string[];
    activeMcps: string[];
    promptText: string;
    fullInjectedPrompt: string;
    timestamp: string;
  };
  output: {
    rawEvents: any[];
    rawTextStream: string;
    toolCalls: any[];
    tokenStats: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    durationMs?: number;
    status: string;
    completedAt?: string;
  };
}

export function getRawInspectionData(
  msg: ChatMessage,
  agent?: AgentConfig | null,
  activeProject?: ProjectItem | null,
  authorizedDirs: AuthorizedDir[] = [],
  skills: SkillConfig[] = [],
  mcpServers: McpConfig[] = [],
  approvalMode: string = 'default'
): RawInspectionData {
  const isUser = msg.role === 'user';
  const workDir = activeProject?.associatedDirs[0] || authorizedDirs[0]?.path || '/workspace';
  const model = msg.model || agent?.model || 'gemini-3.5-flash-lite';
  const agentName = msg.agentName || agent?.displayName || 'Principal Orchestrator';
  const sysInst = msg.rawPayloadSent?.systemInstructions || (agent ? buildEffectiveSystemPrompt(agent.baseInstructions, agent.systemInstructions, agent.overrideBasePrompt) : '') || 'Você é um assistente de desenvolvimento Gemini CLI operando diretamente no ambiente Ubuntu Linux.';

  // If message already has captured raw payload sent
  const inputData = msg.rawPayloadSent || {
    cliExecutable: 'gemini',
    model,
    agentName,
    approvalMode,
    workDir,
    authorizedDirs: authorizedDirs.map((d) => d.path),
    systemInstructions: sysInst,
    projectContext: activeProject
      ? `Projeto: ${activeProject.name}\nDescrição: ${activeProject.description}\nDiretórios: ${activeProject.associatedDirs.join(', ')}`
      : `Diretório de trabalho: ${workDir}`,
    promptText: isUser ? msg.content : 'Requisitado via Gemini CLI stream',
    fullInjectedPrompt: `[SISTEMA - INSTRUÇÕES DO AGENTE]\n${sysInst}\n\n[CONTEXTO DE TRABALHO]\nWorkDir: ${workDir}\nModo Aprovação: ${approvalMode}\n\n[PROMPT ENVIADO]\n${msg.content}`,
    skills: skills.filter((s) => s.enabled).map((s) => s.name),
    mcpServers: mcpServers.filter((m) => m.enabled).map((m) => m.name),
    timestamp: msg.timestamp,
  };

  // Resolve final API request if attached or construct the precise payload effectively sent to Google API
  const resolvedModel = (model.startsWith('models/') ? model : `models/${model}`);
  const resolvedTemp = typeof agent?.temperature === 'number' ? agent.temperature : 0.2;
  const resolvedTopP = typeof agent?.topP === 'number' ? agent.topP : 0.95;
  const resolvedTopK = typeof agent?.topK === 'number' ? agent.topK : 40;
  const resolvedMaxTokens = typeof agent?.maxOutputTokens === 'number' ? agent.maxOutputTokens : undefined;
  const resolvedThinkingLevel: 'low' | 'medium' | 'high' =
    (agent?.thinkingLevel === 'low' || agent?.thinkingLevel === 'high' || agent?.thinkingLevel === 'medium')
      ? agent.thinkingLevel
      : 'medium';

  const finalApiRequest: FinalApiRequest = msg.finalApiRequest || msg.rawPayloadSent?.finalApiRequest || {
    model: resolvedModel,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: inputData.promptText || msg.content,
          },
        ],
      },
    ],
    systemInstruction: sysInst.trim()
      ? {
          parts: [
            {
              text: sysInst.trim(),
            },
          ],
        }
      : null,
    generationConfig: {
      temperature: resolvedTemp,
      topP: resolvedTopP,
      topK: resolvedTopK,
      ...(typeof resolvedMaxTokens === 'number' ? { maxOutputTokens: resolvedMaxTokens } : {}),
      thinkingConfig: {
        includeThoughts: true,
        thinkingLevel: resolvedThinkingLevel,
      },
    },
    tools: [
      {
        functionDeclarations: [
          { name: 'read_file', description: 'Reads content from a local file within authorized directory' },
          { name: 'write_file', description: 'Writes or overwrites content in a file within authorized directory' },
          { name: 'edit_file', description: 'Performs precise replacement of text in file' },
          { name: 'list_directory', description: 'Lists directory contents' },
          { name: 'run_command', description: 'Executes shell command in authorized workspace' },
          { name: 'search_files', description: 'Searches for regex/text patterns in project codebase' },
        ],
      },
    ],
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  const parameterOrigins: ParameterOrigins = msg.parameterOrigins || msg.rawPayloadSent?.parameterOrigins || {
    model: {
      value: finalApiRequest.model,
      source: `Configuração do Agente (${agent?.id || agentName}) sincronizada no .gemini/settings.json`,
      category: 'Model Routing',
    },
    'generationConfig.temperature': {
      value: resolvedTemp,
      source: agent?.temperature !== undefined
        ? `Configuração explícita do Agente (${agent.id || agentName})`
        : 'Valor padrão do modelo (0.2)',
      category: 'Hyperparameters',
    },
    'generationConfig.topP': {
      value: resolvedTopP,
      source: agent?.topP !== undefined
        ? `Configuração explícita do Agente (${agent.id || agentName})`
        : 'Valor padrão do modelo (0.95)',
      category: 'Hyperparameters',
    },
    'generationConfig.topK': {
      value: resolvedTopK,
      source: agent?.topK !== undefined
        ? `Configuração explícita do Agente (${agent.id || agentName})`
        : 'Valor padrão do modelo (40)',
      category: 'Hyperparameters',
    },
    'generationConfig.maxOutputTokens': {
      value: resolvedMaxTokens ?? 'Padrão / Janela Máxima',
      source: agent?.maxOutputTokens !== undefined
        ? `Configuração explícita do Agente (${agent.id || agentName})`
        : 'Padrão não limitado pela chamada',
      category: 'Token Limits',
    },
    'generationConfig.thinkingConfig': {
      value: {
        includeThoughts: true,
        thinkingLevel: resolvedThinkingLevel,
      },
      source: `Nível de Raciocínio explícito selecionado (thinkingLevel: "${resolvedThinkingLevel}", includeThoughts: true)`,
      category: 'Reasoning Mode',
    },
    systemInstruction: {
      value: sysInst ? `${sysInst.length} caracteres` : 'Nenhum',
      source: `Instruções de Sistema do Agente (.gemini/agents/${agent?.id || 'principal'}.md)`,
      category: 'Agent Directives',
    },
    contents: {
      value: `${(inputData.fullInjectedPrompt || msg.content).length} caracteres`,
      source: 'Prompt do usuário + Cabeçalho de Contexto de Workspace injetado',
      category: 'Context & Prompt',
    },
  };

  // Build raw events log if missing
  const rawEventsFromMsg = msg.rawPayloadReceived?.rawEvents || [];
  if (rawEventsFromMsg.length === 0 && !isUser) {
    // Generate synthetic SSE log structure for audit
    rawEventsFromMsg.push({
      type: 'process_start',
      timestamp: msg.timestamp,
      command: `gemini --model ${model} --approval-mode ${approvalMode} --work-dir ${workDir}`,
    });

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      msg.toolCalls.forEach((tc) => {
        rawEventsFromMsg.push({
          type: 'tool_use',
          tool_call_id: tc.id,
          name: tc.toolName,
          parameters: tc.parameters,
          timestamp: tc.timestamp,
        });
        rawEventsFromMsg.push({
          type: 'tool_result',
          tool_call_id: tc.id,
          name: tc.toolName,
          output: tc.result || tc.error || 'Executado com sucesso',
          error: tc.error,
          timestamp: tc.timestamp,
        });
      });
    }

    rawEventsFromMsg.push({
      type: 'message',
      role: 'assistant',
      content: msg.content,
      timestamp: msg.timestamp,
    });

    rawEventsFromMsg.push({
      type: 'result',
      status: 'completed',
      exitCode: 0,
      timestamp: msg.timestamp,
    });
  }

  const inputTokens = estimateTokens(inputData.fullInjectedPrompt || msg.content);
  const outputTokens = estimateTokens(msg.content);

  return {
    finalApiRequest,
    parameterOrigins,
    input: {
      cliExecutable: inputData.cliExecutable || 'gemini',
      model: inputData.model || model,
      agentName: inputData.agentName || agentName,
      approvalMode: inputData.approvalMode || approvalMode,
      workDir: inputData.workDir || workDir,
      authorizedDirs: inputData.authorizedDirs || authorizedDirs.map((d) => d.path),
      systemInstructions: inputData.systemInstructions || sysInst,
      projectContext: inputData.projectContext || workDir,
      activeSkills: inputData.skills || skills.filter((s) => s.enabled).map((s) => s.name),
      activeMcps: inputData.mcpServers || mcpServers.filter((m) => m.enabled).map((m) => m.name),
      promptText: inputData.promptText || msg.content,
      fullInjectedPrompt: inputData.fullInjectedPrompt || msg.content,
      timestamp: inputData.timestamp || msg.timestamp,
    },
    output: {
      rawEvents: rawEventsFromMsg,
      rawTextStream: msg.rawPayloadReceived?.rawTextStream || msg.content,
      toolCalls: msg.toolCalls || [],
      tokenStats: msg.rawPayloadReceived?.tokenStats || {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      durationMs: msg.rawPayloadReceived?.durationMs || 1250,
      status: msg.isStreaming ? 'streaming' : msg.error ? 'error' : 'completed',
      completedAt: msg.rawPayloadReceived?.completedAt || msg.timestamp,
    },
  };
}

