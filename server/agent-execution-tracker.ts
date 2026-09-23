import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { sysLog } from './logger-service.js';
import { getGuiDataDir } from './paths-service.js';

const LOG_DIR = path.join(os.homedir(), '.local', 'share', 'gemini-gui', 'logs');
const SUBAGENT_JSONL_FILE = path.join(LOG_DIR, 'subagent-executions.jsonl');
const SUBAGENT_TXT_FILE = path.join(LOG_DIR, 'subagent-executions.log');

try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (e) {
  console.error('[AgentExecutionTracker] Erro ao criar diretório de logs:', e);
}

export type AgentEventType =
  | 'AGENT_FLOW_START'
  | 'AGENT_PREFLIGHT_CHECK'
  | 'AGENT_PROTOCOL_COMPILED'
  | 'AGENT_PROCESS_SPAWNED'
  | 'SUBAGENT_INVOCATION_REQUESTED'
  | 'SUBAGENT_VALIDATION'
  | 'SUBAGENT_EXECUTION_PROGRESS'
  | 'SUBAGENT_TOOL_CALL'
  | 'SUBAGENT_TOOL_RESULT'
  | 'SUBAGENT_RESULT_RECEIVED'
  | 'SUBAGENT_DELEGATION_FAILED'
  | 'SUBAGENT_FINAL_REQUEST'
  | 'SUBAGENT_COMPLETE'
  | 'SUBAGENT_ERROR'
  | 'SUBAGENT_STDERR'
  | 'AGENT_DIRECT_RESPONSE'
  | 'AGENT_FLOW_SUMMARY';

export interface AgentTrackerEvent {
  timestamp: string;
  executionId: string;
  eventType: AgentEventType;
  callerAgent?: string;
  targetAgent?: string;
  model?: string;
  toolName?: string;
  toolCallId?: string;
  promptSnippet?: string;
  durationMs?: number;
  status?: 'running' | 'success' | 'failed' | 'cancelled';
  details?: Record<string, any>;
  resultSnippet?: string;
  error?: string;
  stderr?: string;
}

export interface SubagentInvocationRecord {
  callId: string;
  targetAgent: string;
  prompt: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  nestedTools: Array<{ name: string; timestamp: number }>;
}

export class AgentExecutionTracker {
  public readonly executionId: string;
  public readonly orchestratorAgent: string;
  public readonly orchestratorModel: string;
  public readonly startTime: number;
  public invocations: Map<string, SubagentInvocationRecord> = new Map();
  public availableSubagents: string[] = [];

  constructor(executionId: string, orchestratorAgent = 'principal', orchestratorModel = 'gemini-3.5-flash-lite') {
    this.executionId = executionId;
    this.orchestratorAgent = orchestratorAgent;
    this.orchestratorModel = orchestratorModel;
    this.startTime = Date.now();
  }

  public setAvailableSubagents(subagents: string[]) {
    this.availableSubagents = subagents;
  }

  public trackPreflight(cwd: string, knownAgents: string[], acknowledgedCount: number) {
    this.recordEvent({
      eventType: 'AGENT_PREFLIGHT_CHECK',
      callerAgent: this.orchestratorAgent,
      model: this.orchestratorModel,
      details: {
        cwd,
        availableSubagents: knownAgents,
        acknowledgedCount,
        trackerReady: true,
      },
    });
  }

  public trackFlowStart(workDir: string, promptPreview: string) {
    this.recordEvent({
      eventType: 'AGENT_FLOW_START',
      callerAgent: this.orchestratorAgent,
      model: this.orchestratorModel,
      promptSnippet: promptPreview.slice(0, 150),
      details: {
        workDir,
        orchestrator: this.orchestratorAgent,
        model: this.orchestratorModel,
        availableSubagents: this.availableSubagents,
      },
    });
  }

  public trackProtocolCompiled(injectedTools: string[], subagentCount: number) {
    this.recordEvent({
      eventType: 'AGENT_PROTOCOL_COMPILED',
      callerAgent: this.orchestratorAgent,
      details: {
        injectedTools,
        subagentCount,
        instruction: 'invoke_agent protocol active in system prompt',
      },
    });
  }

  public trackProcessSpawned(cliPath: string, args: string[], envSummary: Record<string, any>) {
    this.recordEvent({
      eventType: 'AGENT_PROCESS_SPAWNED',
      callerAgent: this.orchestratorAgent,
      details: {
        cliPath,
        argsSummary: args.filter(a => a !== '-p').slice(0, 8),
        envSummary,
      },
    });
  }

  public trackSubagentInvocation(callId: string, targetAgent: string, prompt: string): boolean {
    const isKnown = this.availableSubagents.length === 0 || this.availableSubagents.some(
      a => a.toLowerCase() === targetAgent.toLowerCase()
    );

    const record: SubagentInvocationRecord = {
      callId,
      targetAgent,
      prompt,
      startTime: Date.now(),
      status: 'running',
      nestedTools: [],
    };
    this.invocations.set(callId, record);

    this.recordEvent({
      eventType: 'SUBAGENT_INVOCATION_REQUESTED',
      callerAgent: this.orchestratorAgent,
      targetAgent,
      toolName: 'invoke_agent',
      toolCallId: callId,
      promptSnippet: prompt ? prompt.slice(0, 200) : '',
      status: 'running',
      details: {
        isKnownSubagent: isKnown,
        availableSubagents: this.availableSubagents,
        fullPromptLength: prompt ? prompt.length : 0,
      },
    });

    if (!isKnown) {
      this.recordEvent({
        eventType: 'SUBAGENT_VALIDATION',
        callerAgent: this.orchestratorAgent,
        targetAgent,
        status: 'failed',
        error: `Subagente "${targetAgent}" não está registrado na lista de subagentes disponíveis: [${this.availableSubagents.join(', ')}]`,
      });
    }

    return isKnown;
  }

  public trackNestedToolCall(toolName: string, callId: string, params: any) {
    // Check if this tool is inside an active subagent call
    let activeSubagent: SubagentInvocationRecord | undefined;
    for (const inv of this.invocations.values()) {
      if (inv.status === 'running') {
        activeSubagent = inv;
        break;
      }
    }

    if (activeSubagent) {
      activeSubagent.nestedTools.push({ name: toolName, timestamp: Date.now() });
      this.recordEvent({
        eventType: 'SUBAGENT_TOOL_CALL',
        callerAgent: this.orchestratorAgent,
        targetAgent: activeSubagent.targetAgent,
        toolName,
        toolCallId: callId,
        details: { paramsSummary: typeof params === 'object' ? Object.keys(params) : undefined },
      });
    } else {
      this.recordEvent({
        eventType: 'SUBAGENT_TOOL_CALL',
        callerAgent: this.orchestratorAgent,
        toolName,
        toolCallId: callId,
        details: { paramsSummary: typeof params === 'object' ? Object.keys(params) : undefined },
      });
    }
  }

  public trackSubagentResult(callId: string, result: any, status: 'success' | 'failed' | 'error', errorMsg?: string) {
    const inv = this.invocations.get(callId);
    const durationMs = inv ? Date.now() - inv.startTime : undefined;

    const resultStr = typeof result === 'string' ? result : JSON.stringify(result || '');
    const isSuccess = status === 'success' && !errorMsg;

    if (inv) {
      inv.endTime = Date.now();
      inv.durationMs = durationMs;
      inv.status = isSuccess ? 'completed' : 'failed';
      inv.result = resultStr;
      inv.error = errorMsg;
    }

    if (isSuccess) {
      this.recordEvent({
        eventType: 'SUBAGENT_RESULT_RECEIVED',
        callerAgent: this.orchestratorAgent,
        targetAgent: inv?.targetAgent || 'subagent',
        toolName: 'invoke_agent',
        toolCallId: callId,
        durationMs,
        status: 'success',
        resultSnippet: resultStr.slice(0, 200),
        details: {
          fullResultLength: resultStr.length,
          nestedToolsExecuted: inv?.nestedTools.length || 0,
        },
      });
    } else {
      this.recordEvent({
        eventType: 'SUBAGENT_DELEGATION_FAILED',
        callerAgent: this.orchestratorAgent,
        targetAgent: inv?.targetAgent || 'subagent',
        toolName: 'invoke_agent',
        toolCallId: callId,
        durationMs,
        status: 'failed',
        error: errorMsg || 'Falha na execução do subagente',
        details: {
          rawResult: resultStr.slice(0, 200),
        },
      });
    }
  }

  public trackStderrLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.includes('Subagent') && trimmed.includes('not found')) {
      this.recordEvent({
        eventType: 'SUBAGENT_ERROR',
        callerAgent: this.orchestratorAgent,
        error: trimmed,
        stderr: trimmed,
        details: { diagnosis: 'Subagente não registrado ou não reconhecido no AgentRegistry do Gemini CLI.' },
      });
    } else if (trimmed.includes('TerminalQuotaError') || trimmed.includes('Quota exceeded') || trimmed.includes('429')) {
      this.recordEvent({
        eventType: 'SUBAGENT_ERROR',
        callerAgent: this.orchestratorAgent,
        error: 'Cota de requisições da API Gemini excedida (429 RESOURCE_EXHAUSTED).',
        stderr: trimmed,
        details: { diagnosis: 'Atingido limite de requisições por minuto/dia para o modelo configurado.' },
      });
    } else if (trimmed.includes('Duplicate agent name')) {
      this.recordEvent({
        eventType: 'AGENT_PREFLIGHT_CHECK',
        callerAgent: this.orchestratorAgent,
        details: { notice: trimmed },
      });
    } else if (trimmed.includes('Error when talking to Gemini API')) {
      this.recordEvent({
        eventType: 'SUBAGENT_ERROR',
        callerAgent: this.orchestratorAgent,
        error: 'Erro de comunicação direta com a API do Gemini.',
        stderr: trimmed,
      });
    }
  }

  public trackFlowSummary(exitCode: number, errorMsg?: string) {
    const totalDuration = Date.now() - this.startTime;
    const invList = Array.from(this.invocations.values());
    const totalInv = invList.length;
    const completedInv = invList.filter(i => i.status === 'completed').length;
    const failedInv = invList.filter(i => i.status === 'failed').length;

    this.recordEvent({
      eventType: 'AGENT_FLOW_SUMMARY',
      callerAgent: this.orchestratorAgent,
      model: this.orchestratorModel,
      durationMs: totalDuration,
      status: exitCode === 0 && !errorMsg ? 'success' : 'failed',
      error: errorMsg,
      details: {
        exitCode,
        totalInvocations: totalInv,
        completedInvocations: completedInv,
        failedInvocations: failedInv,
        invokedSubagents: invList.map(i => ({
          agent: i.targetAgent,
          status: i.status,
          durationMs: i.durationMs,
        })),
      },
    });
  }

  private recordEvent(event: Omit<AgentTrackerEvent, 'timestamp' | 'executionId'>) {
    const fullEvent: AgentTrackerEvent = {
      ...event,
      timestamp: new Date().toISOString(),
      executionId: this.executionId,
    };

    // 1. Write to append-only JSONL
    try {
      fs.appendFileSync(SUBAGENT_JSONL_FILE, JSON.stringify(fullEvent) + '\n', 'utf8');
    } catch {}

    // 2. Write to formatted log file
    try {
      const line = `[${fullEvent.timestamp}] [${fullEvent.eventType}] [ID: ${this.executionId}] ${
        fullEvent.callerAgent ? `[Caller: ${fullEvent.callerAgent}] ` : ''
      }${fullEvent.targetAgent ? `[Target: ${fullEvent.targetAgent}] ` : ''}${
        fullEvent.toolName ? `[Tool: ${fullEvent.toolName}] ` : ''
      }${fullEvent.durationMs !== undefined ? `[${fullEvent.durationMs}ms] ` : ''}${
        fullEvent.error ? `ERROR: ${fullEvent.error} ` : ''
      }${fullEvent.promptSnippet ? `Prompt: "${fullEvent.promptSnippet}" ` : ''}\n`;
      fs.appendFileSync(SUBAGENT_TXT_FILE, line, 'utf8');
    } catch {}

    // 3. Emit real-time log to sysLog (Category: AGENT)
    this.broadcastToSysLog(fullEvent);
  }

  private broadcastToSysLog(event: AgentTrackerEvent) {
    const category = 'AGENT';
    const source = event.targetAgent ? `Agent:${event.targetAgent}` : `Agent:${event.callerAgent || 'principal'}`;
    const det = {
      executionId: event.executionId,
      callerAgent: event.callerAgent,
      targetAgent: event.targetAgent,
      model: event.model,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      durationMs: event.durationMs,
      status: event.status,
      error: event.error,
      stderr: event.stderr,
      ...event.details,
    };

    switch (event.eventType) {
      case 'AGENT_PREFLIGHT_CHECK':
        sysLog.info(
          category,
          `🔍 [PRÉ-VOO AGENTES] Verificação de subagentes concluída. Total reconhecido: ${event.details?.availableSubagents?.length || 0}.`,
          det,
          source
        );
        break;

      case 'AGENT_FLOW_START':
        sysLog.info(
          category,
          `🎬 [FLUXO INICIADO] Agente [${event.callerAgent || 'principal'}] em execução com modelo [${event.model || 'auto'}]. Subagentes prontos: [${(this.availableSubagents || []).join(', ')}]`,
          det,
          source
        );
        break;

      case 'AGENT_PROTOCOL_COMPILED':
        sysLog.info(
          category,
          `📋 [PROTOCOLO DE DELEGAÇÃO] Protocolo ativo com a ferramenta invoke_agent pronta para delegar tarefas.`,
          det,
          source
        );
        break;

      case 'AGENT_PROCESS_SPAWNED':
        sysLog.debug(
          category,
          `⚙️ [PROCESSO CLI] Gemini CLI iniciado para execução do agente [${event.callerAgent}]`,
          det,
          source
        );
        break;

      case 'SUBAGENT_INVOCATION_REQUESTED':
        sysLog.info(
          category,
          `🚀 [DELEGAÇÃO INICIADA] O Agente [${event.callerAgent || 'principal'}] invocou o subagente [${event.targetAgent}]! Tarefa: "${event.promptSnippet}..."`,
          det,
          source
        );
        break;

      case 'SUBAGENT_VALIDATION':
        if (event.status === 'failed') {
          sysLog.warn(
            category,
            `⚠️ [AVISO DE VALIDAÇÃO] ${event.error}`,
            det,
            source
          );
        }
        break;

      case 'SUBAGENT_TOOL_CALL':
        sysLog.info(
          category,
          `🛠️ [FERRAMENTA EM USO] [${event.targetAgent || event.callerAgent || 'agente'}] executando ferramenta [${event.toolName}]`,
          det,
          source
        );
        break;

      case 'SUBAGENT_TOOL_RESULT':
        sysLog.info(
          category,
          `📥 [RETORNO FERRAMENTA] Ferramenta [${event.toolName}] retornou resultado para [${event.targetAgent || event.callerAgent}].`,
          det,
          source
        );
        break;

      case 'SUBAGENT_RESULT_RECEIVED':
        sysLog.success(
          category,
          `✅ [DELEGAÇÃO CONCLUÍDA] Subagente [${event.targetAgent}] concluiu sua tarefa com sucesso em ${event.durationMs ?? 0}ms!`,
          det,
          source
        );
        break;

      case 'SUBAGENT_DELEGATION_FAILED':
        sysLog.error(
          category,
          `❌ [FALHA NA DELEGAÇÃO] O subagente [${event.targetAgent}] falhou após ${event.durationMs ?? 0}ms: ${event.error}`,
          det,
          source
        );
        break;

      case 'SUBAGENT_ERROR':
        sysLog.error(
          category,
          `🚨 [ERRO DE AGENTE] [${event.targetAgent || event.callerAgent || 'principal'}]: ${event.error}`,
          det,
          source
        );
        break;

      case 'AGENT_DIRECT_RESPONSE':
        sysLog.info(
          category,
          `💬 [RESPOSTA DIRETA] Agente [${event.callerAgent || 'principal'}] respondeu diretamente ao usuário.`,
          det,
          source
        );
        break;

      case 'AGENT_FLOW_SUMMARY':
        if (event.status === 'success') {
          sysLog.success(
            category,
            `📊 [RESUMO DO FLUXO] Agente [${event.callerAgent}] concluiu em ${event.durationMs}ms. Subagentes chamados: ${event.details?.totalInvocations || 0} (${event.details?.completedInvocations || 0} com sucesso).`,
            det,
            source
          );
        } else {
          sysLog.error(
            category,
            `📊 [RESUMO DO FLUXO COM FALHA] Agente [${event.callerAgent}] finalizou com erro em ${event.durationMs}ms: ${event.error || 'Código ' + event.details?.exitCode}`,
            det,
            source
          );
        }
        break;

      default:
        sysLog.info(category, `[AGENTE] ${event.eventType}`, det, source);
        break;
    }
  }
}
