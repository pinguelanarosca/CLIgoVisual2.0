import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SystemLogEntry, SystemLogLevel, SystemLogCategory } from '../src/types.js';

const MAX_LOGS = 2500;
const LOG_DIR = path.join(os.homedir(), '.local', 'share', 'gemini-gui', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'system-logs.json');

// Ensure log directory exists
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (e) {
  console.error('Erro ao criar diretório de logs:', e);
}

// Load initial logs from disk if available
function loadLogsFromDisk(): SystemLogEntry[] {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const data = fs.readFileSync(LOG_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.slice(-MAX_LOGS);
      }
    }
  } catch (err) {
    console.error('Erro ao carregar logs persistentes do disco:', err);
  }
  return [];
}

const logsBuffer: SystemLogEntry[] = loadLogsFromDisk();
let logIdCounter = logsBuffer.length + 1;

// Throttle saving to disk to prevent excessive IO
let saveTimeout: NodeJS.Timeout | null = null;
function scheduleSaveToDisk() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    try {
      fs.writeFileSync(LOG_FILE, JSON.stringify(logsBuffer, null, 2), 'utf8');
    } catch (err) {
      console.error('Erro ao salvar logs em disco:', err);
    }
  }, 1000);
}

// Active SSE subscribers
const sseClients = new Set<Response>();

function formatDateTime(d = new Date()): string {
  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  const ms = pad(d.getMilliseconds(), 3);
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}.${ms}`;
}

export function addLog(
  level: SystemLogLevel,
  category: SystemLogCategory,
  message: string,
  details?: Record<string, any> | string,
  source?: string
): SystemLogEntry {
  const now = new Date();
  const entry: SystemLogEntry = {
    id: `log-${Date.now()}-${logIdCounter++}`,
    timestamp: now.toISOString(),
    formattedDateTime: formatDateTime(now),
    level,
    category,
    message,
    details,
    source,
  };

  logsBuffer.push(entry);
  if (logsBuffer.length > MAX_LOGS) {
    logsBuffer.shift();
  }

  scheduleSaveToDisk();

  // Broadcast to all active SSE subscribers
  if (sseClients.size > 0) {
    const data = `data: ${JSON.stringify(entry)}\n\n`;
    sseClients.forEach((client) => {
      try {
        client.write(data);
      } catch {
        sseClients.delete(client);
      }
    });
  }

  return entry;
}

export const sysLog = {
  info: (cat: SystemLogCategory, msg: string, det?: any, src?: string) => addLog('info', cat, msg, det, src),
  success: (cat: SystemLogCategory, msg: string, det?: any, src?: string) => addLog('success', cat, msg, det, src),
  warn: (cat: SystemLogCategory, msg: string, det?: any, src?: string) => addLog('warn', cat, msg, det, src),
  error: (cat: SystemLogCategory, msg: string, det?: any, src?: string) => addLog('error', cat, msg, det, src),
  debug: (cat: SystemLogCategory, msg: string, det?: any, src?: string) => addLog('debug', cat, msg, det, src),
};

export function getLogs(options?: {
  limit?: number;
  level?: string;
  category?: string;
  search?: string;
}): SystemLogEntry[] {
  let list = [...logsBuffer];

  if (options?.level && options.level !== 'ALL') {
    list = list.filter((l) => l.level.toLowerCase() === options.level?.toLowerCase());
  }

  if (options?.category && options.category !== 'ALL') {
    list = list.filter((l) => l.category.toUpperCase() === options.category?.toUpperCase());
  }

  if (options?.search) {
    const q = options.search.toLowerCase();
    list = list.filter(
      (l) =>
        l.message.toLowerCase().includes(q) ||
        l.formattedDateTime.includes(q) ||
        l.category.toLowerCase().includes(q) ||
        (l.source && l.source.toLowerCase().includes(q))
    );
  }

  const limit = options?.limit || 500;
  return list.slice(-limit);
}

export function clearLogs(): void {
  logsBuffer.length = 0;
  addLog('info', 'SYSTEM', 'Buffer de logs limpo pelo usuário.');
  scheduleSaveToDisk();
}

export function exportLogsText(): string {
  return logsBuffer
    .map((l) => {
      const detailsStr = l.details ? ` | Detalhes: ${typeof l.details === 'object' ? JSON.stringify(l.details) : l.details}` : '';
      const srcStr = l.source ? ` [Origem: ${l.source}]` : '';
      return `[${l.formattedDateTime}] [${l.level.toUpperCase().padEnd(7)}] [${l.category.padEnd(8)}]${srcStr} ${l.message}${detailsStr}`;
    })
    .join('\n');
}

export function registerSseClient(res: Response): () => void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sseClients.add(res);

  // Send keep-alive heartbeat every 15s
  const interval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(interval);
      sseClients.delete(res);
    }
  }, 15000);

  const cleanup = () => {
    clearInterval(interval);
    sseClients.delete(res);
  };

  res.on('close', cleanup);
  return cleanup;
}

// Initial system startup log
sysLog.success('SYSTEM', 'Serviço de Logs em Tempo Real inicializado com sucesso.');
