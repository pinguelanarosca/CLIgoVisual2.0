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
    | 'SUBAGENT_CRASH';
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
 * Also broadcasts to sysLog so the UI real-time logs menu receives every event.
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

  // 3. Publish to System Real-time Logs UI
  const category = 'AGENTS';
  const source = `Subagent:${entry.agentName || 'unknown'}`;
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
      sysLog.info(category, `🚀 Início de invocação do subagente [${entry.agentName}] (ID: ${entry.executionId})`, details, source);
      break;
    case 'SUBAGENT_TOOL_CALL':
      sysLog.info(category, `🛠️ Subagente [${entry.agentName || 'CLI'}] executando ferramenta: ${entry.toolName}`, details, source);
      break;
    case 'SUBAGENT_TOOL_RESULT':
      sysLog.info(category, `✅ Subagente [${entry.agentName || 'CLI'}] concluiu ferramenta: ${entry.toolName}`, details, source);
      break;
    case 'SUBAGENT_FINAL_REQUEST':
      sysLog.info(category, `📡 Subagente [${entry.agentName || 'CLI'}] enviando requisição final ao modelo ${entry.model}`, details, source);
      break;
    case 'SUBAGENT_COMPLETE':
      sysLog.success(category, `🎉 Subagente [${entry.agentName}] finalizou com sucesso (ID: ${entry.executionId})`, details, source);
      break;
    case 'SUBAGENT_ERROR':
    case 'SUBAGENT_CRASH':
      sysLog.error(category, `❌ Erro no subagente [${entry.agentName || 'CLI'}] (ID: ${entry.executionId}): ${entry.error || 'Falha desconhecida'}`, details, source);
      break;
    case 'SUBAGENT_STDERR':
      sysLog.warn(category, `⚠️ STDERR do subagente [${entry.agentName || 'CLI'}]: ${entry.stderr}`, details, source);
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
