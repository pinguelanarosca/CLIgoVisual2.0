import fs from 'fs';
import path from 'path';
import os from 'os';
import { sysLog } from './logger-service.js';

const LOG_DIR = path.join(os.homedir(), '.local', 'share', 'gemini-gui', 'logs');
const SUBAGENT_JSONL_FILE = path.join(LOG_DIR, 'subagent-executions.jsonl');
const SUBAGENT_TXT_FILE = path.join(LOG_DIR, 'subagent-executions.log');

// Ensure directory exists synchronously at module import
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (e) {
  console.error('[SubagentLogger] Error creating log directory:', e);
}

export interface SubagentExecutionEvent {
  timestamp: string;
  executionId: string;
  eventType: 
    | 'SUBAGENT_INVOKE_START'
    | 'SUBAGENT_TOOL_CALL'
    | 'SUBAGENT_TOOL_RESULT'
    | 'SUBAGENT_FINAL_REQUEST'
    | 'SUBAGENT_COMPLETE'
    | 'SUBAGENT_ERROR'
    | 'SUBAGENT_STDERR'
    | 'SUBAGENT_CRASH'
    | 'AGENT_DISCOVERY'
    | 'AGENT_FLOW_SUMMARY';
  agentName?: string;
  model?: string;
  prompt?: string;
  toolName?: string;
  args?: any;
  result?: any;
  error?: string;
  stderr?: string;
  details?: any;
}

/**
 * Synchronously writes log entries to disk (append-only) for crash resilience.
 * Also broadcasts to sysLog with category 'AGENT' so the UI real-time logs menu receives every event.
 */
export function logSubagentEvent(event: SubagentExecutionEvent): void {
  const timestamp = event.timestamp || new Date().toISOString();
  const entry = { ...event, timestamp };

  // 1. Instant synchronous write to JSONL file (survives process crashes)
  try {
    fs.appendFileSync(SUBAGENT_JSONL_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[SubagentLogger] Failed sync append to JSONL:', err);
  }

  // 2. Instant synchronous write to human-readable log file
  try {
    const formattedLine = `[${timestamp}] [${entry.eventType}] [ID: ${entry.executionId}] ${
      entry.agentName ? `[Agent: ${entry.agentName}] ` : ''
    }${entry.model ? `[Model: ${entry.model}] ` : ''}${entry.toolName ? `[Tool: ${entry.toolName}] ` : ''}${
      entry.error ? `ERROR: ${entry.error} ` : ''
    }${entry.prompt ? `Prompt: "${entry.prompt.slice(0, 100)}" ` : ''}${
      entry.stderr ? `| STDERR: ${entry.stderr.slice(-300)}` : ''
    }\n`;
    fs.appendFileSync(SUBAGENT_TXT_FILE, formattedLine, 'utf8');
  } catch (err) {
    console.error('[SubagentLogger] Failed sync append to LOG:', err);
  }

  // 3. Publish to System Real-time Logs UI with standard AGENT category
  const category = 'AGENT';
  const source = `Agent:${entry.agentName || 'principal'}`;
  const details = {
    executionId: entry.executionId,
    agentName: entry.agentName,
    model: entry.model,
    toolName: entry.toolName,
    args: entry.args,
    result: entry.result,
    error: entry.error,
    stderr: entry.stderr,
    ...entry.details,
  };

  switch (entry.eventType) {
    case 'SUBAGENT_INVOKE_START':
      sysLog.info(
        category,
        `🚀 [DELEGAÇÃO INICIADA] Invocação do subagente [${entry.agentName}] iniciada pelo orquestrador. Tarefa: "${(entry.prompt || '').slice(0, 120)}..."`,
        details,
        source
      );
      break;
    case 'SUBAGENT_TOOL_CALL':
      sysLog.info(
        category,
        `🛠️ [FERRAMENTA EM USO] [${entry.agentName || 'principal'}] acionando ferramenta [${entry.toolName}]`,
        details,
        source
      );
      break;
    case 'SUBAGENT_TOOL_RESULT':
      sysLog.info(
        category,
        `📥 [RETORNO FERRAMENTA] [${entry.agentName || 'principal'}] concluiu a execução da ferramenta [${entry.toolName}]`,
        details,
        source
      );
      break;
    case 'SUBAGENT_FINAL_REQUEST':
      sysLog.info(
        category,
        `📡 [REQUISIÇÃO API] [${entry.agentName || 'principal'}] enviando requisição final ao modelo [${entry.model || 'auto'}]`,
        details,
        source
      );
      break;
    case 'SUBAGENT_COMPLETE':
      sysLog.success(
        category,
        `🎉 [DELEGAÇÃO CONCLUÍDA] Subagente [${entry.agentName}] finalizou com sucesso (Execução: ${entry.executionId})`,
        details,
        source
      );
      break;
    case 'SUBAGENT_ERROR':
    case 'SUBAGENT_CRASH':
      sysLog.error(
        category,
        `❌ [ERRO DE SUBAGENTE] Falha no subagente [${entry.agentName || 'principal'}]: ${entry.error || 'Erro inesperado'}`,
        details,
        source
      );
      break;
    case 'SUBAGENT_STDERR':
      sysLog.warn(
        category,
        `⚠️ [STDERR SUBAGENTE] [${entry.agentName || 'principal'}]: ${entry.stderr}`,
        details,
        source
      );
      break;
    case 'AGENT_DISCOVERY':
      sysLog.info(
        category,
        `🔍 [DESCOBERTA DE AGENTES] Subagentes sincronizados e reconhecidos no sistema.`,
        details,
        source
      );
      break;
    case 'AGENT_FLOW_SUMMARY':
      sysLog.info(
        category,
        `📊 [RESUMO DE EXECUÇÃO] Fluxo de agentes finalizado.`,
        details,
        source
      );
      break;
  }
}

/**
 * Reads all captured subagent execution logs from disk.
 */
export function getSubagentLogs(limit = 200): SubagentExecutionEvent[] {
  try {
    if (!fs.existsSync(SUBAGENT_JSONL_FILE)) return [];
    const content = fs.readFileSync(SUBAGENT_JSONL_FILE, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const parsed: SubagentExecutionEvent[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        parsed.push(JSON.parse(line));
      } catch {}
    }
    return parsed;
  } catch (err) {
    console.error('[SubagentLogger] Error reading subagent logs:', err);
    return [];
  }
}
