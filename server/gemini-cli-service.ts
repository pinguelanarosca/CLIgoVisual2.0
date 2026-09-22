import { spawn, execSync, ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { discoverApiKeyFromLoginEnv } from './env-discovery.js';
discoverApiKeyFromLoginEnv();
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { GoogleGenAI } from '@google/genai';
import { CliStatus } from '../src/types.js';
import { sysLog } from './logger-service.js';
import { logSubagentEvent, getSubagentLogs } from './subagent-logger.js';
import { syncAgentsToSettings, loadAgents, buildEffectiveSystemPrompt } from './agents-service.js';
import { syncPoliciesToSettings } from './policies-service.js';
import { getGuiDataDir } from './paths-service.js';
import { loadMcpSettings } from './mcp-service.js';
import { acpManager } from './acp-client.js';

const persistentProcesses = new Map<string, ChildProcess>();

export interface ExecutionState {
  executionId: string;
  childProcess: ChildProcess | null;
  retryTimeout: NodeJS.Timeout | null;
  cancelled: boolean;
  sessionId?: string;
  workDir?: string;
}

const executions = new Map<string, ExecutionState>();
let currentCustomCliPath: string = '';

export function getExecutionState(executionId: string): ExecutionState | undefined {
  return executions.get(executionId);
}

export function getLocalCliPath(): string {
  const localBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'gemini');
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return '';
}

export function getGlobalCliPath(): string {
  try {
    const whichOut = execSync('which gemini', { encoding: 'utf-8' }).trim();
    if (whichOut && fs.existsSync(whichOut) && !whichOut.includes('node_modules')) {
      return whichOut;
    }
  } catch {}

  const commonPaths = ['/usr/local/bin/gemini', '/usr/bin/gemini', '/bin/gemini'];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return 'gemini';
}

export function queryBinaryVersion(binPath: string): Promise<string> {
  return new Promise((resolve) => {
    if (!binPath) {
      resolve('');
      return;
    }

    // Fast-path: if binPath points to local node_modules gemini, read package.json directly
    if (binPath.includes('node_modules') && binPath.includes('gemini')) {
      try {
        const pkgJsonPath = path.resolve(process.cwd(), 'node_modules', '@google', 'gemini-cli', 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
          if (pkg.version) {
            resolve(pkg.version);
            return;
          }
        }
      } catch {}
    }

    try {
      const child = spawn(binPath, ['--version'], {
        env: { ...process.env, NO_COLOR: '1', GEMINI_CLI_NO_RELAUNCH: '1' },
      });
      let stdout = '';
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve(stdout.trim() || '');
      }, 3000);

      child.stdout?.on('data', (d) => { stdout += d.toString(); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          resolve('');
        }
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve('');
      });
    } catch {
      resolve('');
    }
  });
}

let lastValidationCache: {
  timestamp: number;
  model: string;
  apiKey: string;
  result: {
    configured: boolean;
    valid: boolean;
    message: string;
    modelTested?: string;
    latencyMs?: number;
  };
} | null = null;

export async function validateGeminiApiKey(
  forceFresh = false,
  targetModel = 'gemini-3.1-flash-lite'
): Promise<{
  configured: boolean;
  valid: boolean;
  message: string;
  modelTested?: string;
  latencyMs?: number;
}> {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENAI_API_KEY && !process.env.GOOGLE_API_KEY) {
    discoverApiKeyFromLoginEnv(true);
  }
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      configured: false,
      valid: false,
      message: 'A variável de ambiente GEMINI_API_KEY não foi encontrada.',
    };
  }

  // Se já foi validado uma vez ao entrar, reutilizar o cache permanentemente a menos que forceFresh=true ou a chave/modelo tenha mudado
  const now = Date.now();
  if (
    !forceFresh &&
    lastValidationCache &&
    lastValidationCache.apiKey === apiKey &&
    lastValidationCache.model === targetModel
  ) {
    return lastValidationCache.result;
  }

  // Fast-path: Validação instantânea via REST endpoint do Google Generative Language API
  try {
    const startTimeFast = Date.now();
    const resFast = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
      method: 'GET',
      headers: { 'User-Agent': 'GeminiGUI-Validator/1.0' },
      signal: AbortSignal.timeout(4000),
    });

    if (resFast.ok) {
      const latencyMs = Date.now() - startTimeFast;
      const res = {
        configured: true,
        valid: true,
        message: `Chave GEMINI_API_KEY ativa e autenticada com sucesso no Google Gemini API (${latencyMs}ms).`,
        modelTested: targetModel || 'gemini-3.5-flash-lite',
        latencyMs,
      };
      lastValidationCache = { timestamp: now, model: targetModel, apiKey, result: res };
      sysLog.success('API', `Validação REST da GEMINI_API_KEY bem-sucedida (${latencyMs}ms)`);
      return res;
    } else if (resFast.status === 400 || resFast.status === 401 || resFast.status === 403) {
      const errJson: any = await resFast.json().catch(() => ({}));
      const errDetail = errJson.error?.message || `HTTP ${resFast.status}`;
      const latencyMs = Date.now() - startTimeFast;
      const res = {
        configured: true,
        valid: false,
        message: `Chave presente no ambiente, mas rejeitada pelo Google Gemini API (${resFast.status}). Erro: ${errDetail}`,
        modelTested: targetModel || 'gemini-3.5-flash-lite',
        latencyMs,
      };
      lastValidationCache = { timestamp: now, model: targetModel, apiKey, result: res };
      sysLog.warn('API', `Chave GEMINI_API_KEY rejeitada (${resFast.status}): ${errDetail}`);
      return res;
    }
  } catch (fastErr: any) {
    sysLog.warn('API', `Validação REST direta falhou ou sofreu timeout, tentando SDK: ${fastErr.message || fastErr}`);
  }

  const startTime = Date.now();
  const validationModels = Array.from(new Set([
    targetModel && targetModel !== 'gemini-3.1-flash-lite' ? targetModel : 'gemini-2.5-flash',
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash',
  ]));

  let lastError: any = null;
  let validatedModel = '';

  for (const model of validationModels) {
    let timer: NodeJS.Timeout | null = null;
    try {
      const ai = new GoogleGenAI({ apiKey });

      const requestPromise = (async () => {
        if (model.includes('antigravity') || model.includes('deep-research')) {
          await ai.interactions.create({
            agent: model,
            input: 'ping',
            environment: 'remote',
          });
        } else {
          // Tentar primeiro generateContent tradicional com maxOutputTokens minimalista (rápido e direto)
          try {
            await ai.models.generateContent({
              model,
              contents: 'ping',
              config: {
                maxOutputTokens: 2,
                temperature: 0,
              },
            });
          } catch (genErr: any) {
            // Se falhar no generateContent, tentar com Interactions API
            try {
              await ai.interactions.create({
                model,
                input: 'ping',
              });
            } catch (intErr: any) {
              throw genErr; // Lançar o erro original do generateContent para análise detalhada
            }
          }
        }
      })();

      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timeout de validação (10s)')), 10000);
      });

      await Promise.race([requestPromise, timeoutPromise]);

      validatedModel = model;
      break; // Success!
    } catch (err: any) {
      lastError = err;
      const status = err.status || err.response?.status;
      const msg = (err.message || '').toLowerCase();
      
      if (status === 429 || status === 503 || msg.includes('429') || msg.includes('503') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource_exhausted') || msg.includes('unavailable')) {
        sysLog.warn('API', `Validação do modelo ${model} retornou indisponibilidade temporária (${status || 'n/a'}): ${err.message || err}`);
        validatedModel = `${model} (temporariamente indisponível)`;
        break; // Connectivity successful!
      }
      
      sysLog.warn('API', `Falha ao validar modelo ${model}: ${err.message || err}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  if (validatedModel) {
    const latencyMs = Date.now() - startTime;
    const isUnavailable = validatedModel.includes('(temporariamente indisponível)');
    const message = isUnavailable
      ? `API conectada — recurso temporariamente indisponível (${validatedModel.replace(' (temporariamente indisponível)', '')}).`
      : `Chave GEMINI_API_KEY ativa e validada com sucesso no Google Gemini API (${validatedModel}).`;
    
    const res = {
      configured: true,
      valid: true,
      message,
      modelTested: validatedModel,
      latencyMs,
    };
    lastValidationCache = { timestamp: now, model: targetModel, apiKey, result: res };
    sysLog.success('API', `Validação da GEMINI_API_KEY bem-sucedida (${latencyMs}ms)`, { model: res.modelTested });
    return res;
  } else {
    const latencyMs = Date.now() - startTime;
    const errMsg = lastError?.message || String(lastError);
    const res = {
      configured: true,
      valid: false,
      message: `Chave presente no ambiente, mas a validação falhou em todos os modelos testados (${validationModels.join(', ')}). Último erro: ${errMsg}`,
      modelTested: targetModel,
      latencyMs,
    };
    lastValidationCache = { timestamp: now, model: targetModel, apiKey, result: res };
    sysLog.warn('API', `Validação da GEMINI_API_KEY falhou em todos os modelos: ${errMsg}`, { latencyMs });
    return res;
  }
}

const knownSessions = new Set<string>();

export function isValidUUID(id?: string): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export function ensureValidUUID(id?: string): string | undefined {
  if (!id) return undefined;
  if (isValidUUID(id)) return id;
  // Convert any non-UUID session format into a deterministic valid UUID v4
  const hash = crypto.createHash('md5').update(id).digest('hex');
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-a${hash.substring(17, 20)}-${hash.substring(20, 32)}`;
}

export function isExistingSession(sessionId?: string, workspaceDir?: string): boolean {
  if (!sessionId) return false;
  const normalizedId = ensureValidUUID(sessionId) || sessionId;
  if (knownSessions.has(normalizedId) || knownSessions.has(sessionId)) return true;

  try {
    const candidateDirs: string[] = [
      path.join(getGuiDataDir(), 'tmp'),
      path.join(getGuiDataDir(), '.gemini', 'tmp'),
      path.join(os.homedir(), '.gemini', 'tmp'),
    ];

    try {
      const username = os.userInfo()?.username;
      if (username) {
        candidateDirs.push(path.join(os.homedir(), '.gemini', 'tmp', username));
        candidateDirs.push(path.join(os.homedir(), '.gemini', 'tmp', username, 'chats'));
      }
    } catch {}

    if (workspaceDir && workspaceDir !== os.homedir() && workspaceDir !== getGuiDataDir()) {
      const wsTmp = path.join(workspaceDir, '.gemini', 'tmp');
      candidateDirs.push(wsTmp);
    }

    // Direct shallow checks first
    for (const cDir of candidateDirs) {
      if (fs.existsSync(cDir)) {
        if (
          fs.existsSync(path.join(cDir, `${normalizedId}.jsonl`)) ||
          fs.existsSync(path.join(cDir, `${normalizedId}.json`)) ||
          (sessionId && (fs.existsSync(path.join(cDir, `${sessionId}.jsonl`)) || fs.existsSync(path.join(cDir, `${sessionId}.json`))))
        ) {
          knownSessions.add(normalizedId);
          if (sessionId) knownSessions.add(sessionId);
          return true;
        }
      }
    }

    const checkDirShallow = (dir: string, depth = 0): boolean => {
      if (depth > 2) return false;
      if (!fs.existsSync(dir)) return false;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (checkDirShallow(fullPath, depth + 1)) return true;
        } else if (entry.isFile()) {
          if (entry.name.startsWith(normalizedId) || (sessionId && entry.name.startsWith(sessionId))) {
            knownSessions.add(normalizedId);
            if (sessionId) knownSessions.add(sessionId);
            return true;
          }
        }
      }
      return false;
    };

    for (const cDir of candidateDirs) {
      if (fs.existsSync(cDir)) {
        if (checkDirShallow(cDir)) return true;
      }
    }
  } catch {
    // Ignore error
  }
  return false;
}

export function getResolvedCliPath(): string {
  if (currentCustomCliPath && fs.existsSync(currentCustomCliPath)) {
    return currentCustomCliPath;
  }
  // Try local node_modules/.bin/gemini
  const localBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'gemini');
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  // Fallback to system 'gemini'
  return 'gemini';
}

export function setCustomCliPath(newPath: string) {
  currentCustomCliPath = newPath;
}

export async function detectCliStatus(
  forceFresh = false,
  targetModel = 'gemini-3.1-flash-lite'
): Promise<CliStatus> {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENAI_API_KEY && !process.env.GOOGLE_API_KEY) {
    discoverApiKeyFromLoginEnv(true);
  }

  const cliPath = getResolvedCliPath();
  const localCliPath = getLocalCliPath();
  const globalCliPath = getGlobalCliPath();

  const rawApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const authConfigured = Boolean(rawApiKey);
  let maskedApiKey = undefined;
  if (rawApiKey) {
    if (rawApiKey.length > 8) {
      maskedApiKey = `${rawApiKey.substring(0, 4)}...${rawApiKey.substring(rawApiKey.length - 4)}`;
    } else {
      maskedApiKey = '***';
    }
  }

  const [localVersion, globalVersion, apiCheck] = await Promise.all([
    queryBinaryVersion(localCliPath),
    queryBinaryVersion(globalCliPath),
    authConfigured ? validateGeminiApiKey(forceFresh, targetModel) : Promise.resolve<{
      configured: boolean;
      valid: boolean;
      message: string;
      modelTested?: string;
      latencyMs?: number;
    }>({
      configured: false,
      valid: false,
      message: 'Nenhuma GEMINI_API_KEY configurada no ambiente.',
      latencyMs: undefined,
      modelTested: undefined,
    }),
  ]);

  // Fast-path: if local CLI version was already discovered and cliPath matches local bin, resolve directly
  if (localVersion && (cliPath === localCliPath || cliPath.includes('node_modules'))) {
    return {
      available: true,
      version: localVersion,
      cliPath,
      localCliPath,
      localVersion,
      globalCliPath,
      globalVersion: globalVersion || undefined,
      connectionState: 'connected',
      authConfigured,
      maskedApiKey,
      apiValid: apiCheck.valid,
      apiChecked: true,
      apiError: !apiCheck.valid ? apiCheck.message : undefined,
      latencyMs: apiCheck.latencyMs,
      modelTested: apiCheck.modelTested,
      approvalMode: 'default',
      errorMessage: !authConfigured ? 'Atenção: Nenhuma GEMINI_API_KEY detectada no ambiente.' : undefined,
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    const safeResolve = (val: CliStatus) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };

    try {
      const child = spawn(cliPath, ['--version'], {
        env: { ...process.env, NO_COLOR: '1' },
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        safeResolve({
          available: Boolean(localVersion || globalVersion),
          version: localVersion || globalVersion || 'Timeout',
          cliPath,
          localCliPath,
          localVersion: localVersion || undefined,
          globalCliPath,
          globalVersion: globalVersion || undefined,
          connectionState: localVersion || globalVersion ? 'connected' : 'error',
          authConfigured,
          maskedApiKey,
          apiValid: apiCheck.valid,
          apiChecked: true,
          apiError: !apiCheck.valid ? apiCheck.message : undefined,
          latencyMs: apiCheck.latencyMs,
          modelTested: apiCheck.modelTested,
          approvalMode: 'default',
          errorMessage: stderr.trim() || undefined,
        });
      }, 3500);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        safeResolve({
          available: false,
          version: 'Não detectado',
          cliPath,
          localCliPath,
          localVersion: localVersion || undefined,
          globalCliPath,
          globalVersion: globalVersion || undefined,
          connectionState: 'not_detected',
          authConfigured,
          maskedApiKey,
          apiValid: apiCheck.valid,
          apiChecked: true,
          apiError: !apiCheck.valid ? apiCheck.message : undefined,
          latencyMs: apiCheck.latencyMs,
          modelTested: apiCheck.modelTested,
          approvalMode: 'default',
          errorMessage: `Erro ao executar binário: ${err.message}`,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && stdout.trim()) {
          safeResolve({
            available: true,
            version: stdout.trim(),
            cliPath,
            localCliPath,
            localVersion: localVersion || undefined,
            globalCliPath,
            globalVersion: globalVersion || undefined,
            connectionState: 'connected',
            authConfigured,
            maskedApiKey,
            apiValid: apiCheck.valid,
            apiChecked: true,
            apiError: !apiCheck.valid ? apiCheck.message : undefined,
            latencyMs: apiCheck.latencyMs,
            modelTested: apiCheck.modelTested,
            approvalMode: 'default',
            errorMessage: !authConfigured ? 'Atenção: Nenhuma GEMINI_API_KEY detectada no ambiente.' : undefined,
          });
        } else {
          safeResolve({
            available: Boolean(localVersion),
            version: localVersion || 'Indisponível',
            cliPath,
            localCliPath,
            localVersion: localVersion || undefined,
            globalCliPath,
            globalVersion: globalVersion || undefined,
            connectionState: localVersion ? 'connected' : 'error',
            authConfigured,
            maskedApiKey,
            apiValid: apiCheck.valid,
            apiChecked: true,
            apiError: !apiCheck.valid ? apiCheck.message : undefined,
            latencyMs: apiCheck.latencyMs,
            modelTested: apiCheck.modelTested,
            approvalMode: 'default',
            errorMessage: stderr.trim() || `Processo saiu com código ${code}`,
          });
        }
      });
    } catch (err: any) {
      safeResolve({
        available: false,
        version: 'Falha',
        cliPath,
        localCliPath,
        localVersion: localVersion || undefined,
        globalCliPath,
        globalVersion: globalVersion || undefined,
        connectionState: 'error',
        authConfigured,
        maskedApiKey,
        apiValid: apiCheck.valid,
        apiChecked: true,
        apiError: !apiCheck.valid ? apiCheck.message : undefined,
        latencyMs: apiCheck.latencyMs,
        modelTested: apiCheck.modelTested,
        approvalMode: 'default',
        errorMessage: err.message,
      });
    }
  });
}

export interface CliExecutionParams {
  executionId?: string;
  prompt: string;
  model?: string;
  approvalMode?: 'default' | 'auto_edit' | 'yolo' | 'plan';
  authorizedDirs?: string[];
  sessionId?: string;
  resume?: boolean;
  workDir?: string;
  agentId?: string;
  backupAgentId?: string;
  isBackupExecution?: boolean;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  thinking?: boolean;
  thinkingLevel?: 'low' | 'medium' | 'high';
  thinking_level?: 'low' | 'medium' | 'high';
  systemInstructions?: string;
  overrideBasePrompt?: boolean;
  baseInstructions?: string;
  sharedMemory?: string;
  tools?: string[];
  onEvent: (event: { type: string; data: any }) => void;
  onDone: (exitCode: number | null, signal: string | null) => void;
  onError: (error: Error) => void;
}

export const AGENT_FALLBACK_CHAINS: Record<string, string[]> = {
  architect: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  auditor: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  investigator: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  principal: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash'],
  tester: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  worker: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'],
};

export function normalizeCliModelName(rawModel?: string): string {
  if (!rawModel || rawModel === 'auto') return 'gemini-3.5-flash-lite';
  const m = rawModel.trim().toLowerCase();
  
  // Map UI catalog aliases or deprecated models to active, production-stable models with high quota limits
  if (m.includes('3.8') || m.includes('3.7') || m === 'gemini-3-flash') return 'gemini-3.6-flash';
  if (m === 'gemini-3.5-flash' || m.includes('2.5') || m.includes('transcribe') || m.includes('tts')) return 'gemini-3.5-flash-lite';
  if (m.includes('3.1-flash-lite')) return 'gemini-3.1-flash-lite';
  if (m.includes('3.5-flash-lite')) return 'gemini-3.5-flash-lite';
  if (m.includes('3.6-flash')) return 'gemini-3.6-flash';
  
  return 'gemini-3.5-flash-lite';
}

export function getApiErrorCode(code: number, stderrText: string, reportedErrorText: string): number | null {
  const combined = (stderrText + ' ' + reportedErrorText).toLowerCase();
  
  // High priority: literal status codes
  const statusMatch = combined.match(/status (?:code )?([0-9]{3})/i) || combined.match(/\[([0-9]{3})\]/);
  if (statusMatch) {
    return parseInt(statusMatch[1], 10);
  }

  if (
    combined.includes('400') ||
    combined.includes('invalid argument') ||
    combined.includes('invalid_argument') ||
    combined.includes('bad request') ||
    combined.includes('cannot set') ||
    combined.includes('oneof field') ||
    combined.includes('_thinking_level')
  ) {
    return 400;
  }
  if (combined.includes('409') || combined.includes('conflict') || combined.includes('already_exists')) {
    return 409;
  }
  if (combined.includes('429') || combined.includes('quota') || combined.includes('rate limit') || combined.includes('terminalquotaerror') || combined.includes('resource_exhausted')) {
    return 429;
  }
  if (combined.includes('500') || combined.includes('internal error') || combined.includes('internal server error')) {
    return 500;
  }
  if (combined.includes('503') || combined.includes('unavailable') || combined.includes('service unavailable') || combined.includes('experiencing high demand')) {
    return 503;
  }
  return null;
}

function parseQuotaDetails(stderr: string, reported: string): { origin: string, retryAfter?: number } {
  const combined = stderr + ' ' + reported;
  let origin = 'API do Google Gemini';
  let retryAfter: number | undefined;

  if (combined.includes('project')) origin = 'Cota do Projeto (GCP)';
  else if (combined.includes('model')) origin = 'Limite do Modelo';
  else if (combined.includes('tool')) origin = 'Ferramenta Externo';

  const retryMatch = combined.match(/retry in ([0-9.]+)(s|ms)?/i);
  if (retryMatch) {
    const val = parseFloat(retryMatch[1]);
    const unit = retryMatch[2] || 's';
    retryAfter = unit === 'ms' ? val : val * 1000;
  }

  return { origin, retryAfter };
}

export function cancelExecutionById(executionId?: string): boolean {
  if (!executionId) {
    if (executions.size === 0) return false;
    let anyCancelled = false;
    for (const id of Array.from(executions.keys())) {
      if (cancelExecutionById(id)) {
        anyCancelled = true;
      }
    }
    return anyCancelled;
  }

  // Tentar cancelar na sessão persistente ACP se aplicável
  try {
    acpManager.cancelExecution(executionId);
  } catch {}

  const execState = executions.get(executionId);
  if (!execState) {
    return false;
  }

  execState.cancelled = true;

  if (execState.retryTimeout) {
    clearTimeout(execState.retryTimeout);
    execState.retryTimeout = null;
    sysLog.warn('CLI', `Timeout de retry pendente cancelado pelo usuário (ExecutionID: ${executionId}).`);
  }

  if (execState.childProcess && !execState.childProcess.killed) {
    sysLog.warn('CLI', `Execução ativa do Gemini CLI cancelada pelo usuário (ExecutionID: ${executionId}, SIGKILL).`);
    try {
      execState.childProcess.kill('SIGKILL');
    } catch {}
    execState.childProcess = null;
  }

  executions.delete(executionId);
  return true;
}

export function cancelActiveExecution(): boolean {
  return cancelExecutionById();
}

export const EXA_FALLBACK_TOOLS = [
  {
    name: 'web_search_exa',
    description: 'Perform a neural search of the web using Exa\'s API.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query to execute.' },
        numResults: { type: 'number', description: 'Number of results to return (default: 5).' }
      },
      required: ['query']
    }
  },
  {
    name: 'web_fetch_exa',
    description: 'Fetch the text content of web pages. Returns clean markdown contents.',
    inputSchema: {
      type: 'object',
      properties: {
        urls: { type: 'array', items: { type: 'string' }, description: 'The URLs to fetch.' }
      },
      required: ['urls']
    }
  },
  {
    name: 'web_search_advanced_exa',
    description: 'Advanced neural search with filtering capabilities.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        includeDomains: { type: 'array', items: { type: 'string' }, description: 'Domains to include.' },
        excludeDomains: { type: 'array', items: { type: 'string' }, description: 'Domains to exclude.' }
      },
      required: ['query']
    }
  }
];

interface ExaDiscoveryCache {
  tools: any[];
  timestamp: number;
  source: 'live' | 'fallback-cache';
}

let exaCache: ExaDiscoveryCache | null = null;
let exaDiscoveryInFlight: Promise<any[]> | null = null;
const EXA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function triggerBackgroundExaDiscovery(exaMcp: any, apiKey: string): void {
  if (exaDiscoveryInFlight) return; // No máximo uma execução simultânea

  exaDiscoveryInFlight = (async () => {
    const targetUrl = exaMcp.url || exaMcp.httpUrl || 'https://mcp.exa.ai/mcp';
    const controller = new AbortController();
    // Timeout de 2500ms cobrindo TODO o ciclo: fetch + leitura do corpo + parsing
    const timer = setTimeout(() => controller.abort(), 2500);

    try {
      sysLog.info('MCP', '[MCP] background exa discovery starting');
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          params: {},
          id: 'exa-handshake',
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}`);
      }

      const text = await res.text();
      let data: any = null;

      if (text.includes('data: ')) {
        const match = text.match(/data:\s*({.*})/);
        if (match) {
          try {
            data = JSON.parse(match[1]);
          } catch {}
        }
      } else {
        try {
          data = JSON.parse(text);
        } catch {}
      }

      const tools = data?.result?.tools || [];
      const resolvedTools = tools.length > 0 ? tools : EXA_FALLBACK_TOOLS;
      exaCache = {
        tools: resolvedTools,
        timestamp: Date.now(),
        source: 'live',
      };
      sysLog.info('MCP', `[MCP] exa background discovery complete: ${resolvedTools.length} tools`);
      return resolvedTools;
    } catch (err: any) {
      const msg = err.name === 'AbortError' ? 'Timeout' : (err.message || 'Erro de conexão');
      sysLog.warn('MCP', `[MCP] exa background discovery falhou (${msg}), utilizando fallback-cache`);
      exaCache = {
        tools: EXA_FALLBACK_TOOLS,
        timestamp: Date.now(),
        source: 'fallback-cache',
      };
      return EXA_FALLBACK_TOOLS;
    } finally {
      clearTimeout(timer);
      exaDiscoveryInFlight = null;
    }
  })();
}

export function getExaAuditTools(): { tools: any[]; discoverySource: 'live' | 'fallback-cache' } {
  const base = getGuiDataDir();
  const mcpConfigs = loadMcpSettings(base);
  const exaMcp = mcpConfigs.find(m => m.name === 'exa');

  if (!exaMcp || exaMcp.enabled === false) {
    return { tools: [], discoverySource: 'fallback-cache' };
  }

  const apiKey = process.env.EXA_API_KEY || '';
  if (!apiKey) {
    return { tools: [], discoverySource: 'fallback-cache' };
  }

  const now = Date.now();
  if (exaCache && (now - exaCache.timestamp < EXA_CACHE_TTL_MS)) {
    return { tools: exaCache.tools, discoverySource: exaCache.source };
  }

  // Dispara descoberta em background de forma não-bloqueante
  triggerBackgroundExaDiscovery(exaMcp, apiKey);

  // Retorna imediatamente para auditoria (schema fallback resiliente ou último cache)
  return {
    tools: exaCache ? exaCache.tools : EXA_FALLBACK_TOOLS,
    discoverySource: exaCache ? exaCache.source : 'fallback-cache',
  };
}

export async function runExaHandshakeAndDiscovery(params?: CliExecutionParams): Promise<any[]> {
  const audit = getExaAuditTools();
  return audit.tools;
}

export async function resolveEffectiveCliConfig(cwd: string, executionId: string): Promise<string> {
  const base = getGuiDataDir();
  
  // 1. Ler o settings.json original da GUI se existir
  const guiSettingsPath = path.join(base, '.gemini', 'settings.json');
  let settings: any = {};
  if (fs.existsSync(guiSettingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(guiSettingsPath, 'utf8'));
    } catch {
      settings = {};
    }
  }

  // Remove GUI-specific persistence metadata so runtime config complies with strict Gemini CLI schema
  delete settings.guiMcpServers;

  // 2. Garantir mcpServers corretos e habilitados
  if (!settings.mcpServers) {
    settings.mcpServers = {};
  }
  
  const guiMcps = loadMcpSettings(base);
  for (const mcp of guiMcps) {
    if (mcp.enabled !== false) {
      const serverConfig: any = {
        env: mcp.env || {}
      };
      if (mcp.command) serverConfig.command = mcp.command;
      if (mcp.args && mcp.args.length > 0) serverConfig.args = mcp.args;
      if (mcp.url) {
        serverConfig.url = mcp.url;
      } else if (mcp.httpUrl) {
        serverConfig.httpUrl = mcp.httpUrl;
      }
      if (mcp.type) serverConfig.type = mcp.type;
      if (mcp.trust !== undefined) serverConfig.trust = mcp.trust;
      if (mcp.headers) serverConfig.headers = mcp.headers;

      settings.mcpServers[mcp.name] = serverConfig;
    } else {
      delete settings.mcpServers[mcp.name];
    }
  }

  // 3. Substituir as variáveis de ambiente reais no settings.json temporário de execução
  if (settings.mcpServers && settings.mcpServers.exa) {
    const exa = settings.mcpServers.exa;
    const exaApiKey = process.env.EXA_API_KEY || '';
    
    if (exa.headers) {
      for (const [k, v] of Object.entries(exa.headers)) {
        if (typeof v === 'string' && v.includes('$EXA_API_KEY')) {
          exa.headers[k] = v.replace('$EXA_API_KEY', exaApiKey);
        }
      }
    }
    if (exa.env) {
      for (const [k, v] of Object.entries(exa.env)) {
        if (typeof v === 'string' && v.includes('$EXA_API_KEY')) {
          exa.env[k] = v.replace('$EXA_API_KEY', exaApiKey);
        }
      }
    }
  }

  // 4. Carregar agentes e sincronizar as configurações dos modelos
  const allAgents = loadAgents(cwd);
  if (!settings.modelConfigs) settings.modelConfigs = {};
  if (!settings.modelConfigs.customAliases) settings.modelConfigs.customAliases = {};
  if (!settings.modelConfigs.overrides) settings.modelConfigs.overrides = [];

  const buildGenConfig = (cfg: any) => {
    const genConfig: any = {};
    if (typeof cfg.temperature === 'number') genConfig.temperature = cfg.temperature;
    if (typeof cfg.topP === 'number') genConfig.topP = cfg.topP;
    if (typeof cfg.topK === 'number') genConfig.topK = cfg.topK;
    if (typeof cfg.maxOutputTokens === 'number') genConfig.maxOutputTokens = cfg.maxOutputTokens;
    if (cfg.thinking !== false) {
      const modelLower = (cfg.model || '').toLowerCase();
      const isThinkingSupported = 
        modelLower.includes('pro') || 
        modelLower.includes('thinking') || 
        modelLower.includes('gemini-3.7') || 
        modelLower.includes('gemini-3.8');

      if (isThinkingSupported) {
        const thinkingLevel = cfg.thinkingLevel || cfg.thinking_level || 'medium';
        const isGemini3 = modelLower.includes('gemini-3');
        if (isGemini3) {
          genConfig.thinkingConfig = {
            includeThoughts: true,
            thinkingLevel: thinkingLevel,
          };
        } else {
          genConfig.thinkingConfig = {
            includeThoughts: true,
            thinkingBudget: -1,
          };
        }
      }
    }
    return genConfig;
  };

  const newAliases: Record<string, any> = {};
  const newOverrides: any[] = [];

  for (const agentData of allAgents) {
    const genConfig = buildGenConfig(agentData);
    const agentModel = agentData.model || 'gemini-3.5-flash-lite';

    newAliases[agentData.name] = {
      modelConfig: {
        model: agentModel,
        generateContentConfig: genConfig,
      },
    };

    if (!newAliases[agentModel]) {
      newAliases[agentModel] = {
        modelConfig: {
          model: agentModel,
          generateContentConfig: genConfig,
        },
      };
    }

    newOverrides.push({
      match: { overrideScope: agentData.name },
      modelConfig: {
        model: agentModel,
        generateContentConfig: genConfig,
      },
    });

    if (agentData.id && agentData.id !== agentData.name) {
      newOverrides.push({
        match: { overrideScope: agentData.id },
        modelConfig: {
          model: agentModel,
          generateContentConfig: genConfig,
        },
      });
    }
  }

  settings.modelConfigs.customAliases = { ...settings.modelConfigs.customAliases, ...newAliases };
  settings.modelConfigs.overrides = newOverrides;

  // 5. Resolver as políticas (policyPaths e adminPolicyPaths)
  const globalPoliciesDir = path.join(base, '.gemini', 'policies');
  const policyPaths: string[] = [globalPoliciesDir];
  if (cwd && cwd !== os.homedir() && cwd !== base) {
    const wsPoliciesDir = path.join(cwd, '.gemini', 'policies');
    if (fs.existsSync(wsPoliciesDir)) {
      policyPaths.push(wsPoliciesDir);
    }
  }
  settings.policyPaths = policyPaths;
  settings.adminPolicyPaths = policyPaths;

  // 6. Gravar o arquivo temporário exclusivo
  const systemPromptDir = path.join(base, 'tmp');
  if (!fs.existsSync(systemPromptDir)) {
    fs.mkdirSync(systemPromptDir, { recursive: true });
  }
  const tempSettingsFile = path.join(systemPromptDir, `settings-runtime-${executionId}.json`);
  fs.writeFileSync(tempSettingsFile, JSON.stringify(settings, null, 2), 'utf8');

  return tempSettingsFile;
}

export function executeGeminiCli(
  params: CliExecutionParams,
  isRetry = false,
  state?: {
    currentModel?: string;
    retryCount?: number;
    fallbackIndex?: number;
    fallbackChain?: string[];
    executionId?: string;
  }
): { cancel: () => void; executionId: string } {
  const t0 = performance.now();
  const executionId =
    params.executionId ||
    state?.executionId ||
    `exec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  console.log(`[PERF] [${executionId}] request_received`);

  let execState = executions.get(executionId);
  if (!execState) {
    execState = {
      executionId,
      childProcess: null,
      retryTimeout: null,
      cancelled: false,
      sessionId: params.sessionId,
      workDir: params.workDir,
    };
    executions.set(executionId, execState);
  } else if (!isRetry) {
    execState.cancelled = false;
    execState.childProcess = null;
    if (execState.retryTimeout) {
      clearTimeout(execState.retryTimeout);
      execState.retryTimeout = null;
    }
  }

  if (execState.cancelled) {
    sysLog.warn('CLI', `Execução [${executionId}] ignorada pois o estado atual é cancelado.`);
    executions.delete(executionId);
    return { cancel: () => cancelExecutionById(executionId), executionId };
  }

  let cwd = params.workDir || (params.authorizedDirs && params.authorizedDirs[0]) || getGuiDataDir();
  if (!cwd || !fs.existsSync(cwd)) {
    cwd = getGuiDataDir();
  }

  const effectiveSessionId = ensureValidUUID(params.sessionId);
  const isAcpPersistentMode = process.env.GEMINI_GUI_PERSISTENT === '1' && Boolean(effectiveSessionId);

  const runAsyncFlow = async () => {
    let tempSettingsFile: string | null = null;
    let systemPromptFile: string | null = null;
    
    try {
      if (execState.cancelled) return;

      // 1. API key discovery (usando cache / verificação não-bloqueante)
      if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENAI_API_KEY && !process.env.GOOGLE_API_KEY) {
        discoverApiKeyFromLoginEnv(false);
      }
      const tApiKey = performance.now();
      console.log(`[PERF] [${executionId}] api_key_discovery_done=${(tApiKey - t0).toFixed(1)}ms`);

      // 2. Handshake e auditoria MCP Exa (em background / cache não-bloqueante)
      const { tools: mcpTools, discoverySource } = getExaAuditTools();
      const tExa = performance.now();
      console.log(`[PERF] [${executionId}] exa_done=${(tExa - t0).toFixed(1)}ms (source: ${discoverySource})`);

      if (execState.cancelled) return;

      // 3. Resolver a configuração efetiva e salvar no settings temporário exclusivo
      tempSettingsFile = await resolveEffectiveCliConfig(cwd, executionId);
      const tConfig = performance.now();
      console.log(`[PERF] [${executionId}] config_done=${(tConfig - t0).toFixed(1)}ms`);

      if (execState.cancelled) {
        try { fs.unlinkSync(tempSettingsFile); } catch {}
        return;
      }

      let cliPath = getResolvedCliPath();

      // 4. Decisão de sessão sem varredura pesada síncrona no disco
      const effectiveSessionId = ensureValidUUID(params.sessionId);
      const shouldResume = Boolean(effectiveSessionId && params.resume !== false);
      const tResume = performance.now();
      console.log(`[PERF] [${executionId}] resume_decision_done=${(tResume - t0).toFixed(1)}ms (resume: ${shouldResume})`);
      let finalPrompt = params.prompt;

      // For new sessions, prepend explicit workspace and directory context so the model knows its working directory
      if (!shouldResume) {
        const workspaceHeader = `[CONTEXTO DO PROJETO E WORKSPACE]\nVocê está executando dentro do diretório do projeto: "${cwd}".\nDiretórios autorizados do projeto: ${params.authorizedDirs && params.authorizedDirs.length > 0 ? params.authorizedDirs.join(', ') : cwd}.\nSempre inspecione e responda com base nos arquivos localizados neste diretório.\n---\n\n`;
        finalPrompt = workspaceHeader + params.prompt;
      }

      // Determine model: respect the configured model for the agent/execution, default to 'gemini-3.5-flash-lite'
      let requestedModel = state?.currentModel || params.model;
      const chosenModel = normalizeCliModelName(requestedModel);

      // Infer agentId if not explicitly provided
      let agentId = params.agentId?.toLowerCase() || '';
      if (!agentId && requestedModel) {
        if (requestedModel.includes('auditor') || requestedModel.includes('3.8')) agentId = 'auditor';
        else if (requestedModel.includes('investigator') || requestedModel.includes('3.7')) agentId = 'investigator';
        else if (requestedModel.includes('principal') || requestedModel.includes('3.5-flash-lite')) agentId = 'principal';
        else if (requestedModel.includes('worker') || requestedModel.includes('3.1-flash-lite')) agentId = 'worker';
        else if (requestedModel.includes('tester') || requestedModel.includes('3-flash')) agentId = 'tester';
      }

      // Sincronizar dinamicamente parâmetros do modelo (temperature, topP, topK, maxOutputTokens, thinking, thinkingLevel) no settings.json
      try {
        syncAgentsToSettings(cwd, agentId || 'principal', {
          model: chosenModel,
          temperature: params.temperature,
          topP: params.topP,
          topK: params.topK,
          maxOutputTokens: params.maxOutputTokens,
          thinking: params.thinking,
          thinkingLevel: params.thinkingLevel || params.thinking_level,
        });
      } catch (err) {
        sysLog.warn('CLI', `Aviso ao sincronizar agentes no settings.json: ${err}`);
      }

      // Sincronizar diretórios e arquivos de políticas
      try {
        syncPoliciesToSettings(cwd);
      } catch (err) {
        sysLog.warn('CLI', `Aviso ao sincronizar políticas no settings.json: ${err}`);
      }

      const isDebug = process.env.GEMINI_GUI_DEBUG === '1';
      const args: string[] = [
        ...(isDebug ? ['--debug'] : []),
        '-p', finalPrompt,
        '-o', 'stream-json',
        '--skip-trust',
      ];

      // Carregar políticas de segurança da GUI (onde deny-google-search.toml reside no escopo da GUI)
      const guiPoliciesDir = path.join(getGuiDataDir(), '.gemini', 'policies');
      const policyDirs: string[] = [];
      if (fs.existsSync(guiPoliciesDir)) {
        policyDirs.push(guiPoliciesDir);
      }

      // Workspace .gemini/policies só pode ser usado quando explicitamente presente e fora do escopo global
      if (cwd && cwd !== os.homedir() && cwd !== getGuiDataDir()) {
        const wsPolicyDir = path.join(cwd, '.gemini', 'policies');
        if (fs.existsSync(wsPolicyDir)) {
          policyDirs.push(wsPolicyDir);
        }
      }

      // Adicionar diretórios de políticas
      for (const pDir of policyDirs) {
        args.push('--policy', pDir);
        args.push('--admin-policy', pDir);
      }

      // Política base de ambiente web-preview (prioridade 5 para permitir tools básicas sem bloquear regras do usuário)
      const customPolicyPath = path.join(getGuiDataDir(), '.gemini', 'web-preview-policy.toml');
      if (fs.existsSync(customPolicyPath)) {
        args.push('--policy', customPolicyPath);
      }

      const fallbackChain = state?.fallbackChain || (AGENT_FALLBACK_CHAINS[agentId] || []);
      const retryCount = state?.retryCount || 1;
      const fallbackIndex = state?.fallbackIndex !== undefined 
        ? state.fallbackIndex 
        : (fallbackChain.indexOf(requestedModel) !== -1 ? fallbackChain.indexOf(requestedModel) : -1);

      args.push('-m', chosenModel);

      if (params.approvalMode) {
        args.push('--approval-mode', params.approvalMode);
      }

      if (params.authorizedDirs && params.authorizedDirs.length > 0) {
        args.push('--include-directories', params.authorizedDirs.join(','));
      }

      if (effectiveSessionId) {
        const sessionExists = isExistingSession(effectiveSessionId, cwd);
        if (shouldResume || sessionExists) {
          args.push('-r', effectiveSessionId);
          knownSessions.add(effectiveSessionId);
          if (params.sessionId) knownSessions.add(params.sessionId);
        } else {
          args.push('--session-id', effectiveSessionId);
          knownSessions.add(effectiveSessionId);
          if (params.sessionId) knownSessions.add(params.sessionId);
        }
      }

      if (!cliPath || (cliPath !== 'gemini' && !fs.existsSync(cliPath))) {
        cliPath = getLocalCliPath() || getGlobalCliPath() || 'gemini';
      }

      // Construir o prompt de sistema efetivo preservando a arquitetura base + override sem duplicidade
      let effectiveSystemPrompt = buildEffectiveSystemPrompt(
        params.baseInstructions,
        params.systemInstructions,
        params.overrideBasePrompt
      );

      // Injetar Memória Persistente Compartilhada no contexto do modelo se fornecida
      if (params.sharedMemory && params.sharedMemory.trim()) {
        const memBlock = `\n\n[MEMÓRIA PERSISTENTE COMPARTILHADA]\n${params.sharedMemory.trim()}\n---\n(Esta memória é compartilhada persistentemente. Consulte e mantenha o alinhamento com os pipelines, tarefas e histórico de resoluções contidos neste documento.)\n`;
        effectiveSystemPrompt = (effectiveSystemPrompt ? effectiveSystemPrompt + memBlock : memBlock);
      }

      if (effectiveSystemPrompt && effectiveSystemPrompt.trim()) {
        try {
          const systemPromptDir = path.join(getGuiDataDir(), 'tmp');
          if (!fs.existsSync(systemPromptDir)) {
            fs.mkdirSync(systemPromptDir, { recursive: true });
          }
          systemPromptFile = path.join(systemPromptDir, `active-system-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`);
          fs.writeFileSync(systemPromptFile, effectiveSystemPrompt.trim(), 'utf8');
        } catch (err) {
          sysLog.warn('CLI', `Não foi possível gerar system prompt customizado: ${err}`);
        }
      }

      const activeApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        GEMINI_CLI_TRUST_WORKSPACE: 'true',
        GEMINI_MAX_RETRIES: '0',
        MAX_RETRIES: '0',
        GEMINI_CLI_NO_RELAUNCH: '1',
        GEMINI_CLI_SYSTEM_SETTINGS_PATH: tempSettingsFile,
        ...(activeApiKey ? {
          GEMINI_API_KEY: activeApiKey,
          GOOGLE_GENAI_API_KEY: activeApiKey,
          GOOGLE_API_KEY: activeApiKey,
        } : {}),
      };

      if (systemPromptFile) {
        env.GEMINI_SYSTEM_MD = systemPromptFile;
      }

      // Configuração da GUI e Invocação da CLI (Conceitos separados do Final Model Request)
      const guiConfiguration = {
        model: chosenModel,
        agentId: agentId || 'principal',
        temperature: typeof params.temperature === 'number' ? params.temperature : undefined,
        topP: typeof params.topP === 'number' ? params.topP : undefined,
        topK: typeof params.topK === 'number' ? params.topK : undefined,
        maxOutputTokens: typeof params.maxOutputTokens === 'number' ? params.maxOutputTokens : undefined,
        thinkingLevel: params.thinkingLevel || params.thinking_level || 'medium',
        thinkingActive: params.thinking !== false,
        systemPrompt: effectiveSystemPrompt || undefined,
        mcpToolsCount: mcpTools?.length || 0,
        requestedTools: params.tools || [],
      };

      const cliInvocation = {
        executable: cliPath,
        args,
        cwd,
        envSummary: {
          NODE_ENV: env.NODE_ENV,
          GEMINI_CLI_TRUST_WORKSPACE: env.GEMINI_CLI_TRUST_WORKSPACE,
        },
        timestamp: new Date().toISOString(),
      };

      // Notificar cliente sobre a configuração inicial da GUI e chamada CLI (NÃO é o Final Model Request)
      try {
        params.onEvent({
          type: 'gui_configuration',
          data: {
            guiConfiguration,
            cliInvocation,
          },
        });
      } catch {}

      // Preparar diretório isolado para dump de requisições reais capturadas
      const requestDumpDir = path.join(os.tmpdir(), `gcli-reqs-${executionId}`);
      try { fs.mkdirSync(requestDumpDir, { recursive: true }); } catch {}
      env.GEMINI_CLI_REQUEST_DUMP_DIR = requestDumpDir;

      const capturedRealRequests: Array<{
        requestId?: string;
        promptId?: string;
        sessionId?: string;
        model: string;
        role?: string;
        timestamp: string;
        finalApiRequest: any;
        callIndex: number;
      }> = [];

      const isCwdHome = cwd === os.homedir();
      const authDirs = params.authorizedDirs || [];
      const containsHome = authDirs.some(d => d === os.homedir() || d === path.resolve(os.homedir()));
      sysLog.info('CLI', `[WORKSPACE] cwd: "${cwd}" (isHome: ${isCwdHome}), authorizedDirs: [${authDirs.join(', ')}] (containsHome: ${containsHome})`);

      const tSpawn = performance.now();
      console.log(`[PERF] [${executionId}] spawn_start=${(tSpawn - t0).toFixed(1)}ms (model: ${chosenModel}, thinking: ${params.thinkingLevel || 'medium'}, thinkingActive: ${params.thinking !== false})`);

      const child = spawn(cliPath, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 300000,
      });

      execState.childProcess = child;
      logSubagentEvent({
        timestamp: new Date().toISOString(),
        executionId,
        eventType: 'SUBAGENT_INVOKE_START',
        agentName: agentId || 'principal',
        model: chosenModel,
        prompt: params.prompt,
        details: { sessionId: params.sessionId, cwd, retryCount },
      });

      let buffer = '';
      const MAX_STDERR_MEMORY = 64 * 1024; // Limite de 64 KB na memória para evitar memory bloat
      let stderrText = '';
      let reportedErrorText = '';
      let hasReceivedFirstStdout = false;
      let hasReceivedFirstAssistantEvent = false;
      let tFirstStdout = 0;

      // Rastreamento estruturado de tool_calls / subagentes em voo
      const activeToolCalls = new Map<string, {
        toolId: string;
        toolName: string;
        parameters: any;
        timestamp: number;
      }>();
      let lastSubagentRequestId: string | undefined;
      let lastSubagentSessionId: string | undefined;
      let lastSubagentModel: string | undefined;

      child.stdout?.on('data', (chunk) => {
        if (!hasReceivedFirstStdout) {
          hasReceivedFirstStdout = true;
          tFirstStdout = performance.now();
          console.log(`[PERF] [${executionId}] first_stdout=${(tFirstStdout - t0).toFixed(1)}ms (+${(tFirstStdout - tSpawn).toFixed(1)}ms from spawn)`);
        }

        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const parsed = JSON.parse(trimmed);

              if (!hasReceivedFirstAssistantEvent) {
                if (
                  parsed.type === 'message' ||
                  parsed.type === 'stream_event' ||
                  parsed.type === 'tool_use' ||
                  parsed.type === 'content' ||
                  parsed.candidates ||
                  parsed.role === 'assistant'
                ) {
                  hasReceivedFirstAssistantEvent = true;
                  const tFirstAssistant = performance.now();
                  console.log(`[PERF] [${executionId}] first_assistant_event=${(tFirstAssistant - t0).toFixed(1)}ms (+${(tFirstAssistant - tSpawn).toFixed(1)}ms from spawn, +${(tFirstAssistant - tFirstStdout).toFixed(1)}ms from stdout)`);
                }
              }

              // Rastrear chamadas de ferramentas e subagentes
              const isToolCall =
                parsed.type === 'tool_use' ||
                parsed.type === 'tool_call' ||
                (parsed.type === 'stream_event' && (parsed.data?.type === 'tool_use' || parsed.data?.type === 'tool_call'));

              if (isToolCall) {
                const callId =
                  parsed.tool_call_id ||
                  parsed.tool_id ||
                  parsed.callId ||
                  parsed.id ||
                  parsed.data?.tool_call_id ||
                  parsed.data?.tool_id ||
                  parsed.data?.id ||
                  `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                const tName =
                  parsed.tool_name ||
                  parsed.name ||
                  parsed.tool ||
                  parsed.data?.tool_name ||
                  parsed.data?.name ||
                  'tool';
                const tParams = parsed.parameters || parsed.args || parsed.data?.parameters || parsed.data?.args || {};

                activeToolCalls.set(callId, {
                  toolId: callId,
                  toolName: tName,
                  parameters: tParams,
                  timestamp: Date.now(),
                });

                const targetAgent = tParams.agent_name || tParams.agent || tParams.name || (tName === 'invoke_agent' ? 'subagent' : undefined);
                logSubagentEvent({
                  timestamp: new Date().toISOString(),
                  executionId,
                  eventType: 'SUBAGENT_TOOL_CALL',
                  agentName: targetAgent || agentId || 'principal',
                  toolName: tName,
                  args: tParams,
                });
              }

              const isToolResult =
                parsed.type === 'tool_result' ||
                (parsed.type === 'stream_event' && parsed.data?.type === 'tool_result');

              if (isToolResult) {
                const callId =
                  parsed.tool_call_id ||
                  parsed.tool_id ||
                  parsed.callId ||
                  parsed.id ||
                  parsed.data?.tool_call_id ||
                  parsed.data?.tool_id ||
                  parsed.data?.id;
                if (callId) {
                  activeToolCalls.delete(callId);
                }
                logSubagentEvent({
                  timestamp: new Date().toISOString(),
                  executionId,
                  eventType: 'SUBAGENT_TOOL_RESULT',
                  agentName: agentId || 'principal',
                  result: parsed.result || parsed.data?.result || parsed.content,
                });
              }

              if (parsed.type === 'final_api_request') {
                const finalReq = parsed.finalApiRequest || parsed.data?.finalApiRequest;
                if (finalReq) {
                  const reqItem = {
                    requestId: parsed.requestId || parsed.promptId || `req_${Date.now()}_${capturedRealRequests.length + 1}`,
                    promptId: parsed.promptId,
                    sessionId: parsed.sessionId || effectiveSessionId || params.sessionId,
                    model: parsed.model || finalReq.model,
                    role: parsed.role,
                    timestamp: parsed.timestamp || new Date().toISOString(),
                    finalApiRequest: finalReq,
                    callIndex: capturedRealRequests.length + 1,
                  };
                  capturedRealRequests.push(reqItem);

                  if (reqItem.role === 'subagent' || parsed.role === 'subagent') {
                    lastSubagentRequestId = reqItem.requestId;
                    lastSubagentSessionId = reqItem.sessionId;
                    lastSubagentModel = reqItem.model;
                  }

                  logSubagentEvent({
                    timestamp: reqItem.timestamp,
                    executionId,
                    eventType: 'SUBAGENT_FINAL_REQUEST',
                    agentName: reqItem.role === 'subagent' ? (lastSubagentRequestId || 'subagent') : agentId,
                    model: reqItem.model,
                    details: { requestId: reqItem.requestId, role: reqItem.role },
                  });

                  params.onEvent({
                    type: 'final_api_request',
                    data: {
                      finalApiRequest: finalReq,
                      allRealRequests: capturedRealRequests,
                      requestId: reqItem.requestId,
                      promptId: reqItem.promptId,
                      sessionId: reqItem.sessionId,
                      model: reqItem.model,
                      timestamp: reqItem.timestamp,
                      callIndex: reqItem.callIndex,
                      role: reqItem.role,
                    },
                  });
                }
                continue;
              }
              if (parsed.type === 'result' && parsed.status === 'error') {
                reportedErrorText = parsed.error?.message || 'Erro de execução reportado pelo Gemini CLI.';
                params.onEvent({
                  type: 'process_error',
                  data: {
                    message: reportedErrorText,
                    error: parsed.error,
                  },
                });
              }
              params.onEvent({ type: 'stream_event', data: parsed });
              continue;
            } catch {
              // Fall through to raw chunk if not valid JSON
            }
          }
          const isResumeErrorLine = 
            trimmed.includes('Error resuming session') ||
            trimmed.includes('Invalid session identifier') ||
            trimmed.includes('Searched for sessions in') ||
            trimmed.includes('Use --list-sessions') ||
            trimmed.includes('--resume') ||
            trimmed.includes('no previous session') ||
            trimmed.includes('Erro ao retomar a sessão');

          if (!isResumeErrorLine) {
            params.onEvent({ type: 'stdout_raw', data: { text: trimmed } });
          }
        }
      });

      // Gravação em arquivo de log opcional apenas quando debug ativado
      let debugLogPath: string | undefined;
      let logStream: fs.WriteStream | null = null;
      if (isDebug) {
        const logsDir = path.join(getGuiDataDir(), '.gemini', 'logs');
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }
        debugLogPath = path.join(logsDir, 'cli-debug.log');
        logStream = fs.createWriteStream(debugLogPath, { flags: 'w' });
      }

      child.stderr?.on('data', (chunk) => {
        const raw = chunk.toString();
        if (stderrText.length + raw.length > MAX_STDERR_MEMORY) {
          stderrText = (stderrText + raw).slice(-MAX_STDERR_MEMORY);
        } else {
          stderrText += raw;
        }
        if (logStream) {
          logStream.write(raw);
        }
      });

      child.on('error', (err: any) => {
        if (execState.childProcess === child) {
          execState.childProcess = null;
        }
        executions.delete(executionId);

        const isEnoent = err?.code === 'ENOENT' || err?.errno === -2;
        const errMsg = isEnoent
          ? `O executável do Gemini CLI ou o diretório de trabalho não foi encontrado no sistema (Caminho: ${cliPath}).`
          : (err?.message || 'Erro ao iniciar o processo do Gemini CLI.');

        params.onEvent({
          type: 'process_error',
          data: {
            type: 'process_error',
            exitCode: err?.errno || -2,
            stderr: err?.message || '',
            message: errMsg,
          },
        });
        params.onError(err);
      });

      child.on('close', (code, signal) => {
        const tDone = performance.now();
        console.log(`[PERF] [${executionId}] process_done=${(tDone - t0).toFixed(1)}ms (code: ${code ?? 0})`);

        if (logStream) {
          logStream.end();
        }
        if (systemPromptFile && fs.existsSync(systemPromptFile)) {
          try { fs.unlinkSync(systemPromptFile); } catch {}
        }
        if (tempSettingsFile && fs.existsSync(tempSettingsFile)) {
          try { fs.unlinkSync(tempSettingsFile); } catch {}
        }

        // Se o evento final_api_request não foi capturado do stream de stdout, inspecionar o diretório de dump em disco
        if (capturedRealRequests.length === 0 && fs.existsSync(requestDumpDir)) {
          try {
            const dumpedFiles = fs.readdirSync(requestDumpDir).filter(f => f.endsWith('.json')).sort();
            for (const df of dumpedFiles) {
              const fullFp = path.join(requestDumpDir, df);
              const content = fs.readFileSync(fullFp, 'utf8');
              const parsedDump = JSON.parse(content);
              const finalReq = parsedDump.finalApiRequest || parsedDump.data?.finalApiRequest;
              if (finalReq) {
                const reqItem = {
                  requestId: parsedDump.requestId || parsedDump.promptId || `req_${Date.now()}_${capturedRealRequests.length + 1}`,
                  promptId: parsedDump.promptId,
                  sessionId: parsedDump.sessionId || effectiveSessionId || params.sessionId,
                  model: parsedDump.model || finalReq.model,
                  role: parsedDump.role,
                  timestamp: parsedDump.timestamp || new Date().toISOString(),
                  finalApiRequest: finalReq,
                  callIndex: capturedRealRequests.length + 1,
                };
                capturedRealRequests.push(reqItem);
                params.onEvent({
                  type: 'final_api_request',
                  data: {
                    finalApiRequest: finalReq,
                    allRealRequests: capturedRealRequests,
                    requestId: reqItem.requestId,
                    promptId: reqItem.promptId,
                    sessionId: reqItem.sessionId,
                    model: reqItem.model,
                    timestamp: reqItem.timestamp,
                    callIndex: reqItem.callIndex,
                    role: reqItem.role,
                  },
                });
              }
            }
          } catch {}
        }
        try { fs.rmSync(requestDumpDir, { recursive: true, force: true }); } catch {}
        if (code !== 0 && stderrText.includes("No previous sessions found")) {
          sysLog.warn('CLI', `Sessão ${params.sessionId} não encontrada, limpando cache.`);
          if (params.sessionId) knownSessions.delete(params.sessionId);
        }
        params.onEvent({ 
          type: 'stderr_debug_complete', 
          data: { 
            text: stderrText, 
            logFile: isDebug ? debugLogPath : undefined 
          } 
        });

        if (execState.childProcess === child) {
          execState.childProcess = null;
        }

        if (execState.cancelled) {
          sysLog.warn('CLI', `Processo encerrado (ExecutionID: ${executionId}), mas a execução já foi cancelada pelo usuário. Ignorando processamento de saída.`);
          executions.delete(executionId);
          params.onDone(code || 0, signal || 'SIGINT');
          return;
        }

        // Se o Gemini CLI falhar ao retomar a sessão, auto-recuperar iniciando sessão limpa
        const isSessionResumeError =
          stderrText.includes('Error resuming session') ||
          stderrText.includes('Invalid session identifier') ||
          stderrText.includes('No previous sessions found') ||
          stderrText.includes('no previous session') ||
          stderrText.includes('Searched for sessions in') ||
          stderrText.includes('Erro ao retomar a sessão') ||
          reportedErrorText.includes('Error resuming session') ||
          reportedErrorText.includes('Invalid session identifier');

        if (isSessionResumeError && (params.sessionId || effectiveSessionId) && !isRetry) {
          sysLog.warn('CLI', `Sessão anterior não encontrada no disco ou inválida (${params.sessionId || effectiveSessionId}). Reiniciando automaticamente em uma nova sessão...`);
          if (params.sessionId) knownSessions.delete(params.sessionId);
          if (effectiveSessionId) knownSessions.delete(effectiveSessionId);
          executeGeminiCli({ ...params, executionId, sessionId: effectiveSessionId || params.sessionId, resume: false }, true, { executionId });
          return;
        }

        if (code === 42 && (params.sessionId || effectiveSessionId) && !isRetry) {
          if (params.sessionId) knownSessions.delete(params.sessionId);
          if (effectiveSessionId) knownSessions.delete(effectiveSessionId);
          executeGeminiCli({ ...params, executionId, sessionId: effectiveSessionId || params.sessionId, resume: false }, true, { executionId });
          return;
        }

        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer.trim());
            if (parsed.type === 'result' && parsed.status === 'error') {
              reportedErrorText = parsed.error?.message || reportedErrorText;
            }
            params.onEvent({ type: 'stream_event', data: parsed });
          } catch {
            params.onEvent({ type: 'stdout_raw', data: { text: buffer.trim() } });
          }
        }

        const combinedErrText = (stderrText + ' ' + reportedErrorText).toLowerCase();
        const apiErrCode = getApiErrorCode(code, stderrText, reportedErrorText);

        const isBadRequestError =
          apiErrCode === 400 ||
          combinedErrText.includes('400') ||
          combinedErrText.includes('invalid argument') ||
          combinedErrText.includes('invalid_argument') ||
          combinedErrText.includes('bad request') ||
          combinedErrText.includes('cannot set') ||
          combinedErrText.includes('oneof field') ||
          combinedErrText.includes('_thinking_level');

        const isQuotaError = !isBadRequestError && (
          stderrText.includes('TerminalQuotaError') ||
          stderrText.includes('Quota exceeded') ||
          stderrText.includes('429') ||
          stderrText.includes('RESOURCE_EXHAUSTED') ||
          reportedErrorText.toLowerCase().includes('quota') ||
          reportedErrorText.includes('429') ||
          reportedErrorText.includes('RESOURCE_EXHAUSTED') ||
          combinedErrText.includes('quota exceeded') ||
          combinedErrText.includes('resource_exhausted')
        );

        const isFetchFailed =
          combinedErrText.includes('fetch failed') ||
          combinedErrText.includes('typeerror: fetch failed') ||
          combinedErrText.includes('fetcherror') ||
          combinedErrText.includes('econnreset') ||
          combinedErrText.includes('etimedout');

        const isOverloadedError = !isBadRequestError && (
          stderrText.toLowerCase().includes('503') ||
          stderrText.toLowerCase().includes('unavailable') ||
          stderrText.toLowerCase().includes('high demand') ||
          stderrText.toLowerCase().includes('overloaded') ||
          stderrText.toLowerCase().includes('service unavailable') ||
          reportedErrorText.toLowerCase().includes('503') ||
          reportedErrorText.toLowerCase().includes('high demand') ||
          reportedErrorText.toLowerCase().includes('overloaded') ||
          reportedErrorText.toLowerCase().includes('service unavailable')
        );

        const isAuthNotice = stderrText.includes('Both GOOGLE_API_KEY and GEMINI_API_KEY are set');
        const isAuthError = !isAuthNotice && (
          stderrText.includes('Please set an Auth method') ||
          (stderrText.includes('GEMINI_API_KEY') && (
            stderrText.includes('not set') ||
            stderrText.includes('missing') ||
            stderrText.includes('unauthorized') ||
            stderrText.includes('invalid') ||
            stderrText.includes('required') ||
            stderrText.includes('não foi encontrada')
          ))
        );

        const hasUnresolvedToolCalls = activeToolCalls.size > 0;
        const hasFailed =
          (code !== 0 && code !== null) ||
          isQuotaError ||
          isFetchFailed ||
          isOverloadedError ||
          isAuthError ||
          hasUnresolvedToolCalls ||
          Boolean(reportedErrorText);

        // Se houver chamadas de ferramentas/subagentes pendentes sem fechamento formal, emitir tool_result terminal
        if (hasUnresolvedToolCalls) {
          for (const unres of activeToolCalls.values()) {
            let toolFailureReason = reportedErrorText;
            if (!toolFailureReason && stderrText.trim() && !isAuthNotice) {
              toolFailureReason = stderrText.trim();
            }
            if (isQuotaError) {
              toolFailureReason = 'Cota de requisições excedida na API Gemini (Erro 429 / Quota Exceeded / RESOURCE_EXHAUSTED) durante a execução do subagente.';
            } else if (isFetchFailed) {
              toolFailureReason = 'Falha de transporte de rede com a API Gemini (Fetch failed sending request) durante a execução do subagente.';
            } else if (isOverloadedError) {
              toolFailureReason = 'Serviço da API Gemini temporariamente sobrecarregado (Erro 503 / Model Overloaded) durante a execução do subagente.';
            } else if (isAuthError) {
              toolFailureReason = 'Falha de autenticação da chave de API (GEMINI_API_KEY) durante a execução do subagente.';
            } else if (!toolFailureReason) {
              toolFailureReason = `Execução do subagente/ferramenta finalizada sem retorno terminal formal (exitCode: ${code ?? 0}).`;
            }

            params.onEvent({
              type: 'stream_event',
              data: {
                type: 'tool_result',
                tool_call_id: unres.toolId,
                tool_id: unres.toolId,
                tool_name: unres.toolName,
                status: 'failed',
                error: toolFailureReason,
                output: toolFailureReason,
                executionId,
                subagentSessionId: lastSubagentSessionId || effectiveSessionId || params.sessionId,
                lastRequestId: lastSubagentRequestId,
                subagentModel: lastSubagentModel,
              },
            });
          }
          activeToolCalls.clear();
        }

        if (hasFailed) {
          // Verificação do Agente Reserva (Fallback por Cotas ou Servidor Sobrecarregado)
          if (!isBadRequestError && (isQuotaError || isOverloadedError || apiErrCode === 429 || apiErrCode === 503 || apiErrCode === 500) && !params.isBackupExecution && !execState.cancelled) {
            try {
              const allAgents = loadAgents(cwd);
              const currentAgentObj = allAgents.find(
                (a) => a.id.toLowerCase() === (agentId || '').toLowerCase() || a.name.toLowerCase() === (agentId || '').toLowerCase()
              );
              const targetBackupId = params.backupAgentId || currentAgentObj?.backupAgentId;
              const backupAgent = targetBackupId
                ? allAgents.find(
                    (a) => a.id.toLowerCase() === targetBackupId.toLowerCase() || a.name.toLowerCase() === targetBackupId.toLowerCase()
                  )
                : null;

              if (backupAgent && backupAgent.id !== currentAgentObj?.id) {
                const reasonText = isQuotaError || apiErrCode === 429
                  ? 'Cotas de requisição esgotadas (Erro 429 / Quota Exceeded)'
                  : 'Servidor sobrecarregado / Alta demanda (Erro 503/500 / High Demand)';
                const primaryName = currentAgentObj?.displayName || currentAgentObj?.name || agentId || 'Agente Titular';
                const backupName = backupAgent.displayName || backupAgent.name;

                params.onEvent({
                  type: 'stream_event',
                  data: {
                    type: 'message',
                    role: 'assistant',
                    content: `\n🛡️ **[Agente Reserva Acionado]**\nO agente titular **${primaryName}** encontrou uma restrição de API: *${reasonText}*.\n\n🔄 **Acionando automaticamente o Agente Reserva: ${backupName}** (Modelo: \`${backupAgent.model}\`) para concluir sua solicitação com resiliência...\n\n`,
                  },
                });

                sysLog.warn(
                  'CLI',
                  `Agente titular ${agentId} encontrou ${reasonText}. Acionando agente reserva ${backupAgent.name} (Modelo: ${backupAgent.model}).`
                );

                execState.retryTimeout = setTimeout(() => {
                  if (execState) execState.retryTimeout = null;
                  if (!execState?.cancelled) {
                    executeGeminiCli(
                      {
                        ...params,
                        executionId,
                        agentId: backupAgent.id || backupAgent.name,
                        model: backupAgent.model,
                        backupAgentId: undefined, // não recursivo
                        isBackupExecution: true,
                        systemInstructions: backupAgent.systemInstructions,
                        baseInstructions: backupAgent.baseInstructions,
                        overrideBasePrompt: backupAgent.overrideBasePrompt,
                        temperature: backupAgent.temperature,
                        topP: backupAgent.topP,
                        topK: backupAgent.topK,
                        maxOutputTokens: backupAgent.maxOutputTokens,
                        thinking: backupAgent.thinking,
                        resume: true,
                      },
                      true,
                      { executionId }
                    );
                  } else {
                    executions.delete(executionId);
                  }
                }, 1200);
                return;
              }
            } catch (err: any) {
              sysLog.warn('CLI', `Falha ao tentar acionar agente reserva: ${err.message}`);
            }
          }

          if (apiErrCode !== null && !isBadRequestError) {
            // Only retry if not a "Hard Quota" or if explicitly allowed
            const { origin, retryAfter } = parseQuotaDetails(stderrText, reportedErrorText);
            const isTransient = apiErrCode === 500 || apiErrCode === 503 || (apiErrCode === 429 && !stderrText.includes('Hard Limit'));

            if (isTransient && retryCount < 3) {
              const nextRetry = retryCount + 1;
              const backoffDelay = retryAfter || (Math.pow(2, retryCount) * 1000 + Math.random() * 500);
              
              params.onEvent({
                type: 'stream_event',
                data: {
                  type: 'message',
                  role: 'assistant',
                  content: `\n⚠️ *[Tentativa ${retryCount}/3] Falha temporária (${apiErrCode}) em ${origin}. Retentando no modelo ${chosenModel} em ${Math.round(backoffDelay / 100) / 10}s...*\n\n`,
                },
              });
              
              sysLog.warn('CLI', `Falha temporária (${apiErrCode}) em ${origin} [Modelo: ${chosenModel}]. Tentativa ${nextRetry}/3 em ${Math.round(backoffDelay)}ms.`, {
                retryAfter,
                origin,
                apiErrCode
              });

              execState.retryTimeout = setTimeout(() => {
                if (execState) execState.retryTimeout = null;
                if (!execState?.cancelled) {
                  executeGeminiCli(params, true, {
                    currentModel: chosenModel,
                    retryCount: nextRetry,
                    fallbackIndex,
                    fallbackChain,
                    executionId,
                  });
                } else {
                  executions.delete(executionId);
                }
              }, backoffDelay);
              return;
            } else {
              // 3 attempts have failed OR non-transient error. Time for fallback!
              if (fallbackChain && fallbackChain.length > 0 && !execState.cancelled) {
                const nextIdx = fallbackIndex + 1;
                if (nextIdx < fallbackChain.length) {
                  const nextModel = fallbackChain[nextIdx];
                  params.onEvent({
                    type: 'stream_event',
                    data: {
                      type: 'message',
                      role: 'assistant',
                      content: `\n⚠️ *[Fallback de Modelo] 3 tentativas falharam no modelo ${chosenModel} (Erro ${apiErrCode}). Alternando para o modelo de fallback do agente: ${nextModel}...*\n\n`,
                    },
                  });
                  sysLog.warn('CLI', `3 tentativas falharam no modelo ${chosenModel}. Alternando para o fallback ${nextModel} do agente ${agentId}.`);
                  
                  execState.retryTimeout = setTimeout(() => {
                    if (execState) execState.retryTimeout = null;
                    if (!execState?.cancelled) {
                      executeGeminiCli(params, true, {
                        currentModel: nextModel,
                        retryCount: 1,
                        fallbackIndex: nextIdx,
                        fallbackChain,
                        executionId,
                      });
                    } else {
                      executions.delete(executionId);
                    }
                  }, 2000);
                  return;
                }
              }
              // Exhausted all retries and fallbacks
              sysLog.error('CLI', `Todos os modelos de fallback falharam para o agente ${agentId}. Interrompendo tarefa (Erro: ${apiErrCode}, Origem: ${origin}).`);
              params.onEvent({
                type: 'stream_event',
                data: {
                  type: 'message',
                  role: 'assistant',
                  content: `\n❌ *[Erro Crítico] Todos os modelos de fallback falharam para o agente ${agentId}.*\n\n**Causa:** ${origin} (Status ${apiErrCode})\n**Detalhes:** ${reportedErrorText || 'Indisponibilidade persistente do serviço.'}\n\n`,
                },
              });
            }
          }

          // Default fallback catch-all if quota was exceeded on another model
          if (isQuotaError && !isRetry && chosenModel !== 'gemini-3.5-flash-lite' && !execState.cancelled) {
            params.onEvent({
              type: 'stream_event',
              data: {
                type: 'message',
                role: 'assistant',
                content: '⚠️ *Limite gratuito do modelo atingido. Alternando automaticamente para Gemini 3.5 Flash-Lite para continuar sua solicitação...*\n\n',
              },
            });
            executeGeminiCli({ ...params, executionId, model: 'gemini-3.5-flash-lite', resume: true }, true, { executionId });
            return;
          }

          let finalMessage = reportedErrorText || stderrText.trim();
          if (code === -2 || stderrText.includes('ENOENT')) {
            finalMessage = `O executável do Gemini CLI (${cliPath}) ou o diretório de trabalho (${cwd}) não foi localizado no sistema (Erro -2 / ENOENT).`;
          } else if (isAuthError) {
            finalMessage = 'A chave de API do Gemini (GEMINI_API_KEY) não está configurada no seu ambiente. Configure-a no menu de Configurações da GUI ou exporte a variável no terminal.';
          } else if (isBadRequestError) {
            finalMessage = `⚠️ Requisição Inválida / Parâmetros Incompatíveis (Erro 400): ${reportedErrorText || stderrText.trim()}`;
          } else if (isQuotaError) {
            const { origin, retryAfter } = parseQuotaDetails(stderrText, reportedErrorText);
            const retryTime = retryAfter ? ` em aproximadamente ${Math.round(retryAfter / 1000)}s` : ' em alguns instantes';
            finalMessage = `⚠️ Cota Excedida (Erro 429 / Quota Exceeded) em: ${origin}
Você atingiu o limite de requisições.
• Tente novamente${retryTime}.
• Recomendação: utilize o modelo "Gemini 3.5 Flash-Lite" para maiores limites.
• Verifique se há processos em segundo plano consumindo sua cota.`;
          } else if (isFetchFailed) {
            finalMessage = `⚠️ Falha na Comunicação de Rede com a API Gemini (Fetch failed sending request): ${reportedErrorText || stderrText.trim()}`;
          } else if (!finalMessage) {
            finalMessage = `O Gemini CLI encerrou com código de erro ${code ?? 0}.`;
          }

          params.onEvent({
            type: 'process_error',
            data: {
              type: 'process_error',
              exitCode: code ?? 1,
              stderr: stderrText,
              message: finalMessage,
              executionId,
              subagentSessionId: lastSubagentSessionId,
              lastRequestId: lastSubagentRequestId,
            },
          });
          logSubagentEvent({
            timestamp: new Date().toISOString(),
            executionId,
            eventType: 'SUBAGENT_ERROR',
            agentName: agentId || 'principal',
            model: chosenModel,
            error: finalMessage,
            stderr: stderrText,
          });
        } else {
          logSubagentEvent({
            timestamp: new Date().toISOString(),
            executionId,
            eventType: 'SUBAGENT_COMPLETE',
            agentName: agentId || 'principal',
            model: chosenModel,
          });
        }

        if (systemPromptFile && fs.existsSync(systemPromptFile)) {
          try {
            fs.unlinkSync(systemPromptFile);
          } catch {
            // Ignorar se já removido
          }
        }
        if (tempSettingsFile && fs.existsSync(tempSettingsFile)) {
          try {
            fs.unlinkSync(tempSettingsFile);
          } catch {
            // Ignorar se já removido
          }
        }

        executions.delete(executionId);
        params.onDone(code, signal);
      });

    } catch (err: any) {
      if (systemPromptFile && fs.existsSync(systemPromptFile)) {
        try { fs.unlinkSync(systemPromptFile); } catch {}
      }
      if (tempSettingsFile && fs.existsSync(tempSettingsFile)) {
        try { fs.unlinkSync(tempSettingsFile); } catch {}
      }
      params.onError(err);
    }
  };

  if (isAcpPersistentMode && !isRetry && effectiveSessionId) {
    const runAcpFlow = async () => {
      try {
        const session = await acpManager.getOrCreateSession(effectiveSessionId, params);
        if (execState.cancelled) return;
        await session.executePrompt({ ...params, executionId, sessionId: effectiveSessionId });
        executions.delete(executionId);
      } catch (err: any) {
        sysLog.warn('CLI', `Sessão ACP falhou ou foi desconectada. Realizando fallback transparente para execução one-shot: ${err?.message || err}`);
        acpManager.removeSession(effectiveSessionId);
        if (!execState.cancelled) {
          runAsyncFlow();
        }
      }
    };
    runAcpFlow();
  } else {
    runAsyncFlow();
  }

  return {
    executionId,
    cancel: () => {
      cancelExecutionById(executionId);
    },
  };
}
