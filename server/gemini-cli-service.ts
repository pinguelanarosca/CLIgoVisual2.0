import { resolveCliAuthentication, resolveExecutionAuthentication, buildCliAuthEnvironment } from './cli-auth-service.js';
import { spawn, execSync, ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { terminateProcessTree } from './process-service.js';
import { buildExecutionPrompt, consumeSessionRecovery, executionFailed, validateExecutionContext, ContextMessage } from './execution-policy.js';
import { retainDiagnostics } from '../src/utils/diagnosticRetention.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { GoogleGenAI } from '@google/genai';
import { CliStatus } from '../src/types.js';
import { sysLog } from './logger-service.js';
import { logSubagentEvent, getSubagentLogs } from './subagent-logger.js';
import { AgentExecutionTracker } from './agent-execution-tracker.js';
import { syncAgentsToSettings, loadAgents, buildEffectiveSystemPrompt, ensureAllAgentsSynchronizedAndAcknowledged } from './agents-service.js';
import { syncPoliciesToSettings } from './policies-service.js';
import { getGuiDataDir } from './paths-service.js';
import { loadMcpSettings } from './mcp-service.js';
import { acpManager } from './acp-client.js';
import {
  getBestEligibleKey,
  loadConfiguredKeys,
  maskApiKey,
  recordRuntimeExecutionResult,
  runDailyTestBattery,
} from './key-pool-service.js';

const persistentProcesses = new Map<string, ChildProcess>();

export interface ExecutionState {
  executionId: string;
  childProcess: ChildProcess | null;
  retryTimeout: NodeJS.Timeout | null;
  cancelled: boolean;
  sessionId?: string;
  workDir?: string;
  sessionRecoveries?: number;
  attempts?: number;
  finished?: boolean;
  finish?: (code: number | null, signal: string | null) => void;
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
        detached: process.platform !== 'win32',
      });
      let stdout = '';
      const timer = setTimeout(() => {
        terminateProcessTree(child);
        resolve(stdout.trim() || '');
      }, 3000);

      child.stdout?.on('data', (d) => { stdout += d.toString(); });
      child.on('close', (code) => {
        clearTimeout(timer);
        terminateProcessTree(child, true);
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
  const candidate = getBestEligibleKey(targetModel);
  const apiKey = candidate?.key || process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      configured: false,
      valid: false,
      message: 'Nenhuma chave Gemini cadastrada no Key Pool. Configure as chaves K1..K9 na aba Key Pool.',
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
    const fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'GeminiGUI-Validator/1.0',
      'x-goog-api-key': apiKey,
    };

    const resFast = await fetch(fetchUrl, {
      method: 'GET',
      headers: fetchHeaders,
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
      const res = {
        configured: true,
        valid: false,
        message: `Chave presente no ambiente, mas rejeitada pelo Google Gemini API (${resFast.status}). Erro: ${errDetail}`,
      };
      // Não salvar em cache validações com falha para permitir novas tentativas limpas
      sysLog.warn('API', `Chave GEMINI_API_KEY rejeitada (${resFast.status}): ${errDetail}`);
      return res;
    }
  } catch (fastErr: any) {
    sysLog.warn('API', `Validação REST direta falhou ou sofreu timeout, tentando SDK: ${fastErr.message || fastErr}`);
  }

  const startTime = Date.now();
  const validationModels = Array.from(new Set([
    targetModel || 'gemini-3.5-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
    'gemini-1.5-flash',
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
    const errMsg = lastError?.message || String(lastError);
    const res = {
      configured: true,
      valid: false,
      message: `Chave GEMINI_API_KEY presente no ambiente, mas a validação falhou: ${errMsg}`,
    };
    // Não salvar falhas no cache para permitir retentativas imediatas
    sysLog.warn('API', `Validação da GEMINI_API_KEY falhou: ${errMsg}`);
    return res;
  }
}

/** Checks the selected CLI authentication without turning OAuth into an API-key probe. */
export async function validateCliAuthentication(forceFresh = false, targetModel = 'gemini-3.1-flash-lite', cwd = process.cwd()) {
  const authentication = resolveCliAuthentication(cwd, process.env, getResolvedCliPath());
  if (authentication.mode === 'api-key') {
    const result = await validateGeminiApiKey(forceFresh, targetModel);
    if (result.configured) return { ...result, checked: true, authMode: authentication.mode, authState: result.valid ? 'authenticated' as const : 'configured' as const };
    // CLI versions with secure native API-key storage resolve that credential themselves.
  }
  return { configured: authentication.configured, valid: authentication.configured,
    message: authentication.message, checked: false, authMode: authentication.mode, authState: authentication.state,
    modelTested: undefined as string | undefined, latencyMs: undefined as number | undefined };
}

export function testCliAgentConnection(params: { model: string; workDir?: string; agentId?: string; systemInstructions?: string }, signal?: AbortSignal): Promise<{ text: string; latencyMs: number }> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let text = '', settled = false;
    let execution: ReturnType<typeof executeGeminiCli> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve({ text: text.trim(), latencyMs: Math.round(performance.now() - started) });
    };
    const abort = () => { execution?.cancel(); finish(new Error('Teste do agente cancelado.')); };
    const timer = setTimeout(() => { execution?.cancel(); finish(new Error('Timeout do teste do agente (30s).')); }, 30000);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    execution = executeGeminiCli({
      ...params, workDir: params.workDir || process.cwd(), resume: false,
      prompt: 'Responda apenas "OK" para teste de conexão.',
      onEvent(event) {
        const message = event.data;
        if ((event.type === 'stream_event' || event.type === 'message') && message?.role === 'assistant' && typeof message.content === 'string') text = (text + message.content).slice(-2048);
      },
      onError: finish,
      onDone(code, exitSignal) { finish(code === 0 && !exitSignal ? undefined : new Error(`O teste do agente falhou (${exitSignal || code}).`)); },
    });
  });
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

    if (workspaceDir) {
      candidateDirs.push(path.join(workspaceDir, '.gemini', 'tmp'));
      const wsName = path.basename(workspaceDir);
      const sanitizedWsName = wsName.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      candidateDirs.push(path.join(os.homedir(), '.gemini', 'tmp', wsName, 'chats'));
      candidateDirs.push(path.join(os.homedir(), '.gemini', 'tmp', sanitizedWsName, 'chats'));
      candidateDirs.push(path.join(getGuiDataDir(), '.gemini', 'tmp', wsName, 'chats'));
      candidateDirs.push(path.join(getGuiDataDir(), '.gemini', 'tmp', sanitizedWsName, 'chats'));
    }

    const shortId = normalizedId.slice(0, 8).toLowerCase();
    const origShortId = sessionId.slice(0, 8).toLowerCase();

    const checkDirShallow = (dir: string, depth = 0): boolean => {
      if (depth > 3) return false;
      if (!fs.existsSync(dir)) return false;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (checkDirShallow(fullPath, depth + 1)) return true;
          } else if (entry.isFile()) {
            const n = entry.name.toLowerCase();
            if (
              n.includes(shortId) ||
              n.includes(origShortId) ||
              n.includes(normalizedId.toLowerCase()) ||
              n.includes(sessionId.toLowerCase())
            ) {
              return true;
            }
          }
        }
      } catch {}
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
  targetModel = 'gemini-3.1-flash-lite',
  cwd = process.cwd()
): Promise<CliStatus> {
  const cliPath = getResolvedCliPath();
  const localCliPath = getLocalCliPath();
  const globalCliPath = getGlobalCliPath();

  const authentication = resolveCliAuthentication(cwd, process.env, getResolvedCliPath());
  const authConfigured = authentication.configured;
  const bestCandidate = authentication.mode === 'api-key' ? getBestEligibleKey(targetModel) : null;
  const maskedApiKey = bestCandidate ? maskApiKey(bestCandidate.key) : undefined;

  const rawExaKey = process.env.EXA_API_KEY || '';
  const exaConfigured = Boolean(rawExaKey);
  let maskedExaKey = undefined;
  if (rawExaKey) {
    if (rawExaKey.length > 8) {
      maskedExaKey = `${rawExaKey.substring(0, 4)}...${rawExaKey.substring(rawExaKey.length - 4)}`;
    } else {
      maskedExaKey = '***';
    }
  }

  const [localVersion, globalVersion, apiCheck] = await Promise.all([
    queryBinaryVersion(localCliPath),
    queryBinaryVersion(globalCliPath),
    validateCliAuthentication(forceFresh, targetModel, cwd),
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
      authMode: authentication.mode,
      authState: apiCheck.authState,
      authMessage: apiCheck.message,
      authWorkDir: cwd,
      maskedApiKey,
      maskedExaKey,
      exaConfigured,
      apiValid: authentication.mode === 'api-key' && apiCheck.checked ? apiCheck.valid : undefined,
      apiChecked: authentication.mode === 'api-key' && apiCheck.checked,
      apiError: authentication.mode === 'api-key' && !apiCheck.valid ? apiCheck.message : undefined,
      latencyMs: apiCheck.latencyMs,
      modelTested: apiCheck.modelTested,
      approvalMode: 'default',
      errorMessage: !authConfigured ? authentication.message : undefined,
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
        detached: process.platform !== 'win32',
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        terminateProcessTree(child);
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
          authMode: authentication.mode,
          authState: apiCheck.authState,
          authMessage: apiCheck.message,
          authWorkDir: cwd,
          maskedApiKey,
          maskedExaKey,
          exaConfigured,
          apiValid: authentication.mode === 'api-key' && apiCheck.checked ? apiCheck.valid : undefined,
          apiChecked: authentication.mode === 'api-key' && apiCheck.checked,
          apiError: authentication.mode === 'api-key' && !apiCheck.valid ? apiCheck.message : undefined,
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
          authMode: authentication.mode,
          authState: apiCheck.authState,
          authMessage: apiCheck.message,
          authWorkDir: cwd,
          maskedApiKey,
          maskedExaKey,
          exaConfigured,
          apiValid: authentication.mode === 'api-key' && apiCheck.checked ? apiCheck.valid : undefined,
          apiChecked: authentication.mode === 'api-key' && apiCheck.checked,
          apiError: authentication.mode === 'api-key' && !apiCheck.valid ? apiCheck.message : undefined,
          latencyMs: apiCheck.latencyMs,
          modelTested: apiCheck.modelTested,
          approvalMode: 'default',
          errorMessage: `Erro ao executar binário: ${err.message}`,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        terminateProcessTree(child, true);
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
            authMode: authentication.mode,
            authState: apiCheck.authState,
            authMessage: apiCheck.message,
            authWorkDir: cwd,
            maskedApiKey,
            maskedExaKey,
            exaConfigured,
            apiValid: authentication.mode === 'api-key' && apiCheck.checked ? apiCheck.valid : undefined,
            apiChecked: authentication.mode === 'api-key' && apiCheck.checked,
            apiError: authentication.mode === 'api-key' && !apiCheck.valid ? apiCheck.message : undefined,
            latencyMs: apiCheck.latencyMs,
            modelTested: apiCheck.modelTested,
            approvalMode: 'default',
            errorMessage: !authConfigured ? authentication.message : undefined,
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
            authMode: authentication.mode,
            authState: apiCheck.authState,
            authMessage: apiCheck.message,
            authWorkDir: cwd,
            maskedApiKey,
            maskedExaKey,
            exaConfigured,
            apiValid: authentication.mode === 'api-key' && apiCheck.checked ? apiCheck.valid : undefined,
            apiChecked: authentication.mode === 'api-key' && apiCheck.checked,
            apiError: authentication.mode === 'api-key' && !apiCheck.valid ? apiCheck.message : undefined,
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
        authMode: authentication.mode,
        authState: apiCheck.authState,
        authMessage: apiCheck.message,
        authWorkDir: cwd,
        maskedApiKey,
        apiValid: authentication.mode === 'api-key' && apiCheck.checked ? apiCheck.valid : undefined,
        apiChecked: authentication.mode === 'api-key' && apiCheck.checked,
        apiError: authentication.mode === 'api-key' && !apiCheck.valid ? apiCheck.message : undefined,
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
  fallbackModel?: string;
  isFallbackExecution?: boolean;
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
  contextMessages?: ContextMessage[];
  resetContext?: boolean;
  tools?: string[];
  onEvent: (event: { type: string; data: any }) => void;
  onDone: (exitCode: number | null, signal: string | null) => void;
  onError: (error: Error) => void;
}

export const AGENT_FALLBACK_CHAINS: Record<string, string[]> = {
  principal: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
  worker: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  auditor: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'],
  investigator: ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'],
  architect: ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite'],
  tester: ['gemini-3.5-flash', 'gemini-3-flash', 'gemini-3.5-flash-lite'],
};

export function normalizeCliModelName(rawModel?: string): string {
  if (!rawModel || rawModel === 'auto' || !rawModel.trim()) return 'gemini-3.5-flash-lite';
  return rawModel.trim();
}

export function getApiErrorCode(code: number | null, stderrText: string, reportedErrorText: string): number | null {
  const combined = (stderrText + ' ' + reportedErrorText).toLowerCase();
  
  // High priority: literal status codes like "status: 429", "status code 429", "[429]", "Error 404", "HTTP 503"
  const statusMatch = combined.match(/(?:status code|status|http status|error code)\s*[:=\[]?\s*([45][0-9]{2})/i) || combined.match(/\[([45][0-9]{2})\]/);
  if (statusMatch) {
    return parseInt(statusMatch[1], 10);
  }

  if (
    combined.includes('invalid argument') ||
    combined.includes('invalid_argument') ||
    combined.includes('_thinking_level')
  ) {
    return 400;
  }
  if (combined.includes('terminalquotaerror') || combined.includes('resource_exhausted') || combined.includes('quota exceeded') || combined.includes('rate limit exceeded')) {
    return 429;
  }
  if (combined.includes('internal server error') || combined.includes('internal error')) {
    return 500;
  }
  if (combined.includes('service unavailable') || combined.includes('model overloaded') || combined.includes('temporarily overloaded')) {
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
      terminateProcessTree(execState.childProcess, true);
    } catch {}
  }

  if (!execState.childProcess) execState.finish?.(null, 'SIGINT');
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
  loadMcpSettings(base);
  
  // 1. Ler o settings.json original da GUI se existir
  const guiSettingsPath = path.join(base, '.gemini', 'settings.json');
  let settings: any = {};
  if (fs.existsSync(guiSettingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(guiSettingsPath, 'utf8'));
    } catch { throw new Error('Configuração da GUI inválida; execução interrompida.'); }
  }

  // The ephemeral system settings must preserve the CLI's native auth selection.
  // This also prevents .env API-key leftovers from changing an OAuth execution.
  const authentication = resolveCliAuthentication(cwd, process.env, getResolvedCliPath());
  if (authentication.selectedType) {
    settings.security ??= {};
    settings.security.auth ??= {};
    settings.security.auth.selectedType = authentication.selectedType;
  }

  // Remove GUI-specific persistence metadata so runtime config complies with strict Gemini CLI schema
  delete settings.guiMcpServers;
  delete settings.guiManagedMcpNames;
  delete settings.guiManagedAgentAliases;
  delete settings.guiManagedAgentScopes;

  // 2. Garantir mcpServers corretos e habilitados
  if (!settings.mcpServers) {
    settings.mcpServers = {};
  }
  
  // saveMcpSettings already merges GUI-owned runtime entries with personal MCPs.
  // Rebuilding this from GUI display state would override those ownership rules.

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
  settings.modelConfigs.overrides = [...settings.modelConfigs.overrides.filter((item: any) => !newOverrides.some(next => next.match.overrideScope === item.match?.overrideScope)), ...newOverrides];

  // 5. Resolver as políticas (policyPaths e adminPolicyPaths)
  const globalPoliciesDir = path.join(base, '.gemini', 'policies');
  const policyPaths: string[] = [globalPoliciesDir];
  if (cwd && cwd !== os.homedir() && cwd !== base) {
    const wsPoliciesDir = path.join(cwd, '.gemini', 'policies');
    if (fs.existsSync(wsPoliciesDir)) {
      policyPaths.push(wsPoliciesDir);
    }
  }
  settings.policyPaths = [...new Set([...(settings.policyPaths || []), ...policyPaths])];
  settings.adminPolicyPaths = [...new Set([...(settings.adminPolicyPaths || []), ...policyPaths])];

  // 6. Gravar o arquivo temporário exclusivo
  const systemPromptDir = path.join(base, 'tmp');
  if (!fs.existsSync(systemPromptDir)) {
    fs.mkdirSync(systemPromptDir, { recursive: true });
  }
  const tempSettingsFile = path.join(systemPromptDir, `settings-runtime-${executionId}.json`);
  fs.writeFileSync(tempSettingsFile, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });

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
    triedKeyIds?: string[];
  }
): { cancel: () => void; executionId: string } {
  const t0 = performance.now();
  const executionId =
    params.executionId ||
    state?.executionId ||
    `exec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  console.log(`[PERF] [${executionId}] request_received`);

  let execState = executions.get(executionId);
  if (execState && !state && !isRetry) {
    params.onError(new Error('Já existe uma execução com este executionId.'));
    return { executionId, cancel: () => {} };
  }
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
  }

  if (!execState.finish) {
    const onDone = params.onDone, onError = params.onError;
    execState.finish = (code, signal) => { if (execState.finished) return; execState.finished = true; onDone(code, signal); };
    const finishError = (error: Error) => { if (execState.finished) return; execState.finished = true; executions.delete(executionId); onError(error); };
    params = { ...params, onDone: execState.finish, onError: finishError };
  }
  execState.attempts = (execState.attempts || 0) + 1;
  if (execState.attempts > 30) { params.onError(new Error('Limite global de tentativas da execução atingido.')); return { executionId, cancel: () => cancelExecutionById(executionId) }; }
  try { validateExecutionContext(params.sharedMemory, params.contextMessages); }
  catch (error: any) { params.onError(error); return { executionId, cancel: () => cancelExecutionById(executionId) }; }
  if (params.resetContext && !state) params = { ...params, sessionId: crypto.randomUUID(), resume: false, resetContext: false };
  params = { ...params, sessionId: ensureValidUUID(params.sessionId) || crypto.randomUUID() };
  execState.sessionId = params.sessionId;
  params.onEvent({ type: 'session_changed', data: { sessionId: params.sessionId, recovery: execState.sessionRecoveries || 0 } });

  if (execState.cancelled) {
    sysLog.warn('CLI', `Execução [${executionId}] ignorada pois o estado atual é cancelado.`);
    executions.delete(executionId);
    return { cancel: () => cancelExecutionById(executionId), executionId };
  }

  let cwd = params.workDir || (params.authorizedDirs && params.authorizedDirs[0]) || getGuiDataDir();
  if (!cwd || !fs.existsSync(cwd)) {
    params.onError(new Error('Diretório de execução inexistente; selecione o projeto correto.'));
    return { executionId, cancel: () => cancelExecutionById(executionId) };
  }

  const effectiveSessionId = ensureValidUUID(params.sessionId);
  const isAcpPersistentMode = process.env.GEMINI_GUI_PERSISTENT === '1' && Boolean(effectiveSessionId);

  const runAsyncFlow = async () => {
    let tempSettingsFile: string | null = null;
    let systemPromptFile: string | null = null;
    
    try {
      if (execState.cancelled) return;

      // 1. Auditoria MCP Exa (em background / cache não-bloqueante)
      const { tools: mcpTools, discoverySource } = getExaAuditTools();
      const tExa = performance.now();
      console.log(`[PERF] [${executionId}] exa_done=${(tExa - t0).toFixed(1)}ms (source: ${discoverySource})`);

      if (execState.cancelled) return;

      let cliPath = getResolvedCliPath();

      // 4. Decisão de sessão sem varredura pesada síncrona no disco
      const effectiveSessionId = ensureValidUUID(params.sessionId);
      const shouldResume = Boolean(effectiveSessionId && params.resume !== false);
      const tResume = performance.now();
      console.log(`[PERF] [${executionId}] resume_decision_done=${(tResume - t0).toFixed(1)}ms (resume: ${shouldResume})`);
      const finalPrompt = buildExecutionPrompt({ ...params, resume: params.resume !== false && isExistingSession(effectiveSessionId || '', cwd) });

      // Workspace context header
      const workspaceHeader = `[CONTEXTO DO PROJETO E WORKSPACE]\nVocê está executando dentro do diretório do projeto: "${cwd}".\nDiretórios autorizados do projeto: ${params.authorizedDirs && params.authorizedDirs.length > 0 ? params.authorizedDirs.join(', ') : cwd}.\nSempre inspecione e responda com base nos arquivos localizados neste diretório.\n---\n`;

      // Resolve agent and factual configured model from disk
      let rawAgentId = (params.agentId || '').toLowerCase().trim();
      const isInvokeAll = rawAgentId === 'all';
      let agentId = isInvokeAll ? 'principal' : rawAgentId;
      const allDiscoveredAgents = loadAgents(cwd);
      const configuredAgent = allDiscoveredAgents.find(
        (a) => a.id.toLowerCase() === agentId || a.name.toLowerCase() === agentId
      );

      // Determine model:
      // When retrying/falling back within this execution, respect state.currentModel.
      // Otherwise, the agent strictly uses its factual configured model from settings/disk, or params.model as fallback.
      let requestedModel = state?.currentModel || configuredAgent?.model || params.model || 'gemini-3.5-flash-lite';
      const chosenModel = normalizeCliModelName(requestedModel);
      const { authentication, apiKey: activeApiKey, keyId: activeKeyId } = resolveExecutionAuthentication(chosenModel, cwd, state?.triedKeyIds || [], cliPath);

      // Infer agentId if not explicitly provided
      if (!agentId && requestedModel) {
        if (requestedModel.includes('auditor') || requestedModel.includes('3.8')) agentId = 'auditor';
        else if (requestedModel.includes('investigator') || requestedModel.includes('3.7')) agentId = 'investigator';
        else if (requestedModel.includes('principal') || requestedModel.includes('3.5-flash-lite')) agentId = 'principal';
        else if (requestedModel.includes('worker') || requestedModel.includes('3.1-flash-lite')) agentId = 'worker';
        else if (requestedModel.includes('tester') || requestedModel.includes('3-flash')) agentId = 'tester';
      }

      // 5. Rastreamento e Sincronização Robusta dos Agentes no Sistema
      const tracker = new AgentExecutionTracker(executionId, agentId || 'principal', chosenModel);
      let syncResult = { synchronizedCount: 0, acknowledgedCount: 0, directories: [] as string[] };
      try {
        syncResult = ensureAllAgentsSynchronizedAndAcknowledged(cwd, authentication.nativeHome);
      } catch (syncErr) {
        sysLog.warn('AGENT', `Aviso durante sincronização de agentes: ${syncErr}`);
      }

      const availableSubagents = allDiscoveredAgents.filter(
        (a) => a.name.toLowerCase() !== (agentId || 'principal').toLowerCase()
      );
      tracker.setAvailableSubagents(availableSubagents.map((a) => a.name));
      tracker.trackPreflight(cwd, availableSubagents.map((a) => a.name), syncResult.acknowledgedCount);
      tracker.trackFlowStart(cwd, params.prompt);

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

      tempSettingsFile = await resolveEffectiveCliConfig(cwd, executionId);
      console.log(`[PERF] [${executionId}] config_done=${(performance.now() - t0).toFixed(1)}ms`);
      if (execState.cancelled) { try { fs.unlinkSync(tempSettingsFile); } catch {} return; }
      const isDebug = process.env.GEMINI_GUI_DEBUG === '1';
      // Se o prompt for muito grande (>8KB ou com anexos), enviar via stdin para evitar ARG_MAX / E2BIG do sistema operacional
      const isPromptLarge = finalPrompt.length > 8192;
      const args: string[] = [
        ...(isDebug ? ['--debug'] : []),
        ...(isPromptLarge ? [] : ['-p', finalPrompt]),
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
      args.push('--skip-trust');

      if (params.approvalMode) {
        args.push('--approval-mode', params.approvalMode);
      }

      if (params.authorizedDirs && params.authorizedDirs.length > 0) {
        args.push('--include-directories', params.authorizedDirs.join(','));
      }

      if (effectiveSessionId) {
        const sessionExists = isExistingSession(effectiveSessionId, cwd);
        // Só passa flag -r (--resume) se a sessão REALMENTE existir no disco em chats/
        // Se o arquivo da sessão não existir no disco, passa --session-id para criá-la
        const shouldPassResumeFlag = Boolean(params.resume !== false && sessionExists);

        if (shouldPassResumeFlag) {
          args.push('-r', effectiveSessionId);
        } else {
          args.push('--session-id', effectiveSessionId);
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

      // Injetar contexto de workspace no system prompt de forma limpa
      if (workspaceHeader && !params.overrideBasePrompt) {
        effectiveSystemPrompt = workspaceHeader + (effectiveSystemPrompt ? '\n\n' + effectiveSystemPrompt : '');
      }

      // Injetar Protocolo de Delegação de Subagentes para o Agente Principal / Orquestrador
      const isOrchestrator = !agentId || agentId === 'principal' || agentId.includes('orchestrator') || isInvokeAll;
      const promptRequestsAllAgents = Boolean(
        params.prompt &&
        (/(evoc|cham|execut|consult|dispar).*todos.*agente/i.test(params.prompt) ||
        /@todos\b/i.test(params.prompt || '') ||
        /\/todos\b/i.test(params.prompt || ''))
      );

      if (isOrchestrator && availableSubagents.length > 0) {
        const subagentsList = availableSubagents
          .map((a) => `  * ${a.name}: ${a.role || a.description}`)
          .join('\n');

        const invokeAllDirectives = (isInvokeAll || promptRequestsAllAgents)
          ? `\n[MODO ATIVO: EVOCAÇÃO SIMULTÂNEA DE TODOS OS AGENTES]
O usuário solicitou expressamente a evocação simultânea de todos os agentes.
Você DEVE emitir chamadas da ferramenta 'invoke_agent' SIMULTANEAMENTE em paralelo para TODOS os ${availableSubagents.length} subagentes especializados disponíveis:
${availableSubagents.map((a) => `  - invoke_agent(agent_name='${a.name}', prompt='Instrução clara adaptada ao papel de ${a.name} para analisar e contribuir com a solicitação do usuário')`).join('\n')}
Emita TODAS as chamadas em paralelo nesta mesma resposta. Ao receber as respostas de todos os subagentes em paralelo, sintetize um relatório técnico estruturado e unificado consolidando as análises de cada um.\n`
          : '';

        const delegationProtocol = `\n\n[PROTOCOLO DE ATENDIMENTO E DELEGAÇÃO DE SUBAGENTES]
Você é o orquestrador principal do Gemini CLI.
DIRETRIZES DE ATENDIMENTO E DELEGAÇÃO:
1. RESPONDA DIRETAMENTE ao usuário sempre que possível para perguntas gerais, conversas e solicitações simples.
2. DELEGAÇÃO ESPECIALIZADA: Se o usuário solicitar uma análise técnica aprofundada (arquitetura, auditoria, testes, investigação ou tarefas práticas), acione a ferramenta 'invoke_agent' para o(s) subagente(s) adequado(s).
3. EVOCAÇÃO SIMULTÂNEA: É TOTALMENTE PERMITIDO e SUPORTADO evocar subagentes simultaneamente em paralelo (emitindo múltiplas chamadas 'invoke_agent' na mesma rodada) sempre que a solicitação demandar visões multidisciplinares conjuntas (ex: arquiteto + auditor + tester) ou quando o usuário solicitar evocar/consultar todos os agentes ao mesmo tempo.
4. Quando solicitado evocar todos os agentes simultaneamente, acione em paralelo todos os subagentes disponíveis (${availableSubagents.map((a) => a.name).join(', ')}), aguarde os retornos e consolide as conclusões em um parecer final unificado.${invokeAllDirectives}
Subagentes disponíveis no sistema:
${subagentsList}
---
`;
        effectiveSystemPrompt = (effectiveSystemPrompt ? effectiveSystemPrompt + delegationProtocol : delegationProtocol);
        tracker.trackProtocolCompiled(['invoke_agent'], availableSubagents.length);
      }

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

      sysLog.info('CLI', `Autenticação da execução: ${authentication.selectedType} (${activeKeyId ? `Key Pool ${activeKeyId}` : 'credenciais nativas'}).`);

      const env: NodeJS.ProcessEnv = {
        ...buildCliAuthEnvironment(authentication, activeApiKey),
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        NODE_OPTIONS: '--no-warnings',
        GEMINI_CLI_TRUST_WORKSPACE: 'true',
        GEMINI_MAX_RETRIES: '0',
        MAX_RETRIES: '0',
        GEMINI_CLI_NO_RELAUNCH: '1',
      };

      // CLI 0.59 supports an explicit runtime settings path without modifying user/workspace settings.
      if (tempSettingsFile) env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = tempSettingsFile;

      if (systemPromptFile) {
        env.GEMINI_SYSTEM_MD = systemPromptFile;
      }

      // Configuração da GUI e Invocação da CLI (Conceitos separados do Final Model Request)
      const guiConfiguration = {
        model: chosenModel,
        authMode: authentication.mode,
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

      let capturedRequestCount = 0;
      const diagnosticDir = path.join(getGuiDataDir(), 'request-diagnostics');
      fs.mkdirSync(diagnosticDir, { recursive: true, mode: 0o700 });
      const diagnosticPath = path.join(diagnosticDir, `${executionId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}.jsonl`);
      const diagnosticStream = fs.createWriteStream(diagnosticPath, { flags: 'a', mode: 0o600 });
      diagnosticStream.on('error', error => { sysLog.error('CLI', `Falha ao salvar diagnóstico completo: ${diagnosticPath}`, error); execState.childProcess?.stdout?.resume(); });
      const retainRequest = (request: any) => {
        if (!diagnosticStream.destroyed && !diagnosticStream.write(JSON.stringify(request) + '\n')) { child.stdout?.pause(); diagnosticStream.once('drain', () => child.stdout?.resume()); }
        retainDiagnostics(capturedRealRequests, request, 20, 8 * 1024 * 1024);
      };
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
        detached: process.platform !== 'win32',
      });
      const executionTimer = setTimeout(() => terminateProcessTree(child), 300000);
      child.stdin?.on('error', (error) => { if (!execState.cancelled) { terminateProcessTree(child); params.onError(error); } });

      if (child.stdin) {
        if (isPromptLarge) {
          try {
            child.stdin.write(finalPrompt);
          } catch (stdinErr) {
            sysLog.error('CLI', `Erro ao escrever prompt grande no stdin: ${stdinErr}`, { executionId });
          }
        }
        try {
          child.stdin.end();
        } catch {}
      }

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

                if (tName === 'invoke_agent') {
                  const targetAgent = tParams.agent_name || tParams.agent || tParams.name || 'investigator';
                  tracker.trackSubagentInvocation(callId, targetAgent, tParams.prompt || '');
                  logSubagentEvent({
                    timestamp: new Date().toISOString(),
                    executionId,
                    eventType: 'SUBAGENT_INVOKE_START',
                    agentName: targetAgent,
                    toolName: tName,
                    prompt: tParams.prompt,
                    args: tParams,
                  });
                } else {
                  tracker.trackNestedToolCall(tName, callId, tParams);
                  logSubagentEvent({
                    timestamp: new Date().toISOString(),
                    executionId,
                    eventType: 'SUBAGENT_TOOL_CALL',
                    agentName: agentId || 'principal',
                    toolName: tName,
                    args: tParams,
                  });
                }

                params.onEvent({
                  type: 'tool_use',
                  data: {
                    tool_call_id: callId,
                    tool_name: tName,
                    name: tName,
                    parameters: tParams,
                    timestamp: new Date().toISOString(),
                  },
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

                let prevCall = callId ? activeToolCalls.get(callId) : undefined;
                if (!prevCall && !callId && activeToolCalls.size === 1) {
                  const entry = activeToolCalls.entries().next().value;
                  if (entry) {
                    prevCall = entry[1];
                    activeToolCalls.delete(entry[0]);
                  }
                } else if (callId) {
                  activeToolCalls.delete(callId);
                }

                const resultData = parsed.result || parsed.data?.result || parsed.content;
                const isFail = parsed.status === 'failed' || Boolean(parsed.error);

                if (prevCall?.toolName === 'invoke_agent') {
                  tracker.trackSubagentResult(callId || 'unknown', resultData, isFail ? 'failed' : 'success', parsed.error);
                  logSubagentEvent({
                    timestamp: new Date().toISOString(),
                    executionId,
                    eventType: isFail ? 'SUBAGENT_ERROR' : 'SUBAGENT_COMPLETE',
                    agentName: prevCall.parameters?.agent_name || 'subagent',
                    result: resultData,
                    error: parsed.error,
                  });
                } else {
                  tracker.trackSubagentResult(callId || 'unknown', resultData, isFail ? 'failed' : 'success', parsed.error);
                  logSubagentEvent({
                    timestamp: new Date().toISOString(),
                    executionId,
                    eventType: 'SUBAGENT_TOOL_RESULT',
                    agentName: agentId || 'principal',
                    toolName: prevCall?.toolName,
                    result: resultData,
                  });
                }

                params.onEvent({
                  type: 'tool_result',
                  data: {
                    tool_call_id: callId || prevCall?.toolId || 'tool',
                    tool_name: prevCall?.toolName || 'tool',
                    output: resultData,
                    status: isFail ? 'failed' : 'completed',
                    error: parsed.error,
                  },
                });
              }

              if (parsed.type === 'final_api_request') {
                const finalReq = parsed.finalApiRequest || parsed.data?.finalApiRequest;
                if (finalReq) {
                  const reqItem = {
                    requestId: parsed.requestId || parsed.promptId || `req_${Date.now()}_${capturedRequestCount + 1}`,
                    promptId: parsed.promptId,
                    sessionId: parsed.sessionId || effectiveSessionId || params.sessionId,
                    model: parsed.model || finalReq.model,
                    role: parsed.role,
                    timestamp: parsed.timestamp || new Date().toISOString(),
                    finalApiRequest: finalReq,
                    callIndex: ++capturedRequestCount,
                  };
                  retainRequest(reqItem);

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
                      finalApiRequest: JSON.stringify(finalReq).length <= 512 * 1024 ? finalReq : { model: finalReq.model, diagnosticPath, truncated: true, contents: [] },
                      diagnosticPath,
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

        // Rastrear linhas de erro/aviso em tempo real para diagnóstico imediato
        const lines = raw.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          tracker.trackStderrLine(trimmed);
          if (
            !trimmed.includes('Both GOOGLE_API_KEY and GEMINI_API_KEY') &&
            !trimmed.startsWith('\x1b')
          ) {
            sysLog.debug('CLI', `[STDERR] ${trimmed}`, { executionId });
          }
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

      child.once('close', async (code, signal) => {
        clearTimeout(executionTimer);
        terminateProcessTree(child, true);
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
        if (capturedRequestCount === 0 && fs.existsSync(requestDumpDir)) {
          try {
            const dumpedFiles = fs.readdirSync(requestDumpDir).filter(f => f.endsWith('.json')).sort();
            for (const df of dumpedFiles) {
              const fullFp = path.join(requestDumpDir, df);
              const content = fs.readFileSync(fullFp, 'utf8');
              const parsedDump = JSON.parse(content);
              const finalReq = parsedDump.finalApiRequest || parsedDump.data?.finalApiRequest;
              if (finalReq) {
                const reqItem = {
                  requestId: parsedDump.requestId || parsedDump.promptId || `req_${Date.now()}_${capturedRequestCount + 1}`,
                  promptId: parsedDump.promptId,
                  sessionId: parsedDump.sessionId || effectiveSessionId || params.sessionId,
                  model: parsedDump.model || finalReq.model,
                  role: parsedDump.role,
                  timestamp: parsedDump.timestamp || new Date().toISOString(),
                  finalApiRequest: finalReq,
                  callIndex: ++capturedRequestCount,
                };
                retainRequest(reqItem);
                params.onEvent({
                  type: 'final_api_request',
                  data: {
                    finalApiRequest: JSON.stringify(finalReq).length <= 512 * 1024 ? finalReq : { model: finalReq.model, diagnosticPath, truncated: true, contents: [] },
                    diagnosticPath,
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
        await new Promise<void>(resolve => {
          if (diagnosticStream.destroyed || diagnosticStream.writableFinished) return resolve();
          diagnosticStream.once('finish', resolve); diagnosticStream.once('error', () => resolve()); diagnosticStream.end();
        });
        try { fs.rmSync(requestDumpDir, { recursive: true, force: true }); } catch {}
        if (code !== 0 && (stderrText.includes("No previous sessions found") || stderrText.includes("Invalid session identifier"))) {
          sysLog.warn('CLI', `Sessão ${params.sessionId} não encontrada, limpando cache.`);
          if (params.sessionId) knownSessions.delete(params.sessionId);
          if (effectiveSessionId) knownSessions.delete(effectiveSessionId);
        } else if (code === 0 && effectiveSessionId) {
          knownSessions.add(effectiveSessionId);
          if (params.sessionId) knownSessions.add(params.sessionId);
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

        if (execState.finished) return;

        // Se o Gemini CLI acusar que a sessão já existe e tentamos sem resume
        const isSessionAlreadyExistsError =
          stderrText.includes('already exists. Use --resume to resume it') ||
          stderrText.includes('already exists') ||
          reportedErrorText.includes('already exists. Use --resume to resume it') ||
          reportedErrorText.includes('already exists');

        // Se o Gemini CLI falhar ao retomar a sessão
        const isSessionResumeError =
          stderrText.includes('Error resuming session') ||
          stderrText.includes('Invalid session identifier') ||
          stderrText.includes('No previous sessions found') ||
          stderrText.includes('no previous session') ||
          stderrText.includes('Searched for sessions in') ||
          stderrText.includes('Erro ao retomar a sessão') ||
          reportedErrorText.includes('Error resuming session') ||
          reportedErrorText.includes('Invalid session identifier');

        if ((isSessionResumeError || isSessionAlreadyExistsError || code === 42) && !consumeSessionRecovery(execState)) {
          params.onError(new Error('Recuperação de sessão esgotada após duas tentativas. O histórico da GUI foi preservado.'));
          return;
        }
        // 1. Se falhou ao retomar OU se a sessão está inacessível/corrompida
        if (isSessionResumeError || (isSessionAlreadyExistsError && params.resume)) {
          const freshSessionId = crypto.randomUUID();
          sysLog.warn('CLI', `Sessão anterior inacessível ou corrompida (${params.sessionId || effectiveSessionId}). Criando nova sessão com --session-id: ${freshSessionId}...`);
          if (params.sessionId) knownSessions.delete(params.sessionId);
          if (effectiveSessionId) knownSessions.delete(effectiveSessionId);
          executeGeminiCli({ ...params, executionId, sessionId: freshSessionId, resume: false }, false, { ...state, executionId });
          return;
        }

        // 2. Se a sessão existe legitimamente e ainda não usamos -r (--resume)
        if (isSessionAlreadyExistsError && !params.resume) {
          sysLog.warn('CLI', `Sessão já existe no disco (${params.sessionId || effectiveSessionId}). Retomando com -r (--resume)...`);
          executeGeminiCli({ ...params, executionId, sessionId: effectiveSessionId || params.sessionId, resume: true }, true, { ...state, executionId });
          return;
        }

        if (code === 42 && (params.sessionId || effectiveSessionId) && !isRetry) {
          const freshSessionId = crypto.randomUUID();
          sysLog.warn('CLI', `Código 42 detectado (${params.sessionId || effectiveSessionId}). Reiniciando em nova sessão limpa: ${freshSessionId}...`);
          if (params.sessionId) knownSessions.delete(params.sessionId);
          if (effectiveSessionId) knownSessions.delete(effectiveSessionId);
          executeGeminiCli({ ...params, executionId, sessionId: freshSessionId, resume: false }, false, { ...state, executionId });
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

        // Ignore only the CLI's informational notice, including when a real
        // error follows it on the same line. Keep the original stderr in logs.
        const authStderrText = stderrText.replace(/Both GOOGLE_API_KEY and GEMINI_API_KEY are set(?:\. Using GOOGLE_API_KEY\.)?/g, '');
        const authErrorText = (authStderrText + ' ' + reportedErrorText).toLowerCase();
        const isAuthError = (
          authStderrText.includes('Please set an Auth method') ||
          authErrorText.includes('api_key_invalid') ||
          authErrorText.includes('api key not valid') ||
          authErrorText.includes('invalid api key') ||
          authErrorText.includes('key not valid') ||
          authErrorText.includes('unauthenticated') ||
          authErrorText.includes('401') ||
          authErrorText.includes('403') ||
          (authStderrText.includes('GEMINI_API_KEY') && (
            authStderrText.includes('not set') ||
            authStderrText.includes('missing') ||
            authStderrText.includes('unauthorized') ||
            authStderrText.includes('invalid') ||
            authStderrText.includes('required') ||
            authStderrText.includes('não foi encontrada')
          ))
        );

        const isBadRequestError = !isAuthError && (
          apiErrCode === 400 ||
          combinedErrText.includes('400') ||
          combinedErrText.includes('invalid argument') ||
          combinedErrText.includes('invalid_argument') ||
          combinedErrText.includes('bad request') ||
          combinedErrText.includes('cannot set') ||
          combinedErrText.includes('oneof field') ||
          combinedErrText.includes('_thinking_level')
        );

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

        const hasUnresolvedToolCalls = activeToolCalls.size > 0;
        const isProcessExitFailure = code !== 0 || Boolean(signal);
        const hasFailed = executionFailed(code, signal, reportedErrorText, isQuotaError || isFetchFailed || isOverloadedError || isAuthError || isBadRequestError);

        // Se houver chamadas de ferramentas/subagentes pendentes sem fechamento formal, emitir tool_result terminal
        if (hasUnresolvedToolCalls) {
          for (const unres of activeToolCalls.values()) {
            let toolFailureReason = reportedErrorText;
            if (!toolFailureReason && authStderrText.trim()) {
              toolFailureReason = authStderrText.trim();
            }
            if (isQuotaError) {
              toolFailureReason = 'Cota de requisições excedida na API Gemini (Erro 429 / Quota Exceeded / RESOURCE_EXHAUSTED) durante a execução do subagente.';
            } else if (isFetchFailed) {
              toolFailureReason = 'Falha de transporte de rede com a API Gemini (Fetch failed sending request) durante a execução do subagente.';
            } else if (isOverloadedError) {
              toolFailureReason = 'Serviço da API Gemini temporariamente sobrecarregado (Erro 503 / Model Overloaded) durante a execução do subagente.';
            } else if (isAuthError) {
              toolFailureReason = `Falha de autenticação (${authentication.selectedType}) durante a execução do subagente.`;
            }

            const isSuccess = code === 0 && !isProcessExitFailure && !reportedErrorText && !isQuotaError && !isFetchFailed && !isOverloadedError && !isAuthError;
            if (!isSuccess && !toolFailureReason) {
              toolFailureReason = `Execução do subagente/ferramenta finalizada sem retorno terminal formal (exitCode: ${code ?? 0}).`;
            }

            params.onEvent({
              type: 'stream_event',
              data: {
                type: 'tool_result',
                tool_call_id: unres.toolId,
                tool_id: unres.toolId,
                tool_name: unres.toolName,
                status: isSuccess ? 'completed' : 'failed',
                error: isSuccess ? undefined : toolFailureReason,
                output: isSuccess ? 'Execução concluída com sucesso.' : toolFailureReason,
                result: isSuccess ? 'Execução concluída com sucesso.' : toolFailureReason,
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
          // Registrar resultado no Key Pool para o modelo e chave atuais
          if (activeKeyId) recordRuntimeExecutionResult(chosenModel, activeKeyId, {
            success: false,
            httpStatus: apiErrCode,
            errorText: stderrText || reportedErrorText,
          });

          // 1. Tentar próxima chave elegível no Key Pool para o MESMO modelo
          const triedKeys = activeKeyId ? [...(state?.triedKeyIds || []), activeKeyId] : [];
          const nextKey = authentication.mode === 'api-key' && activeKeyId ? getBestEligibleKey(chosenModel, triedKeys) : null;

          if (nextKey && !execState.cancelled && !isBadRequestError) {
            params.onEvent({
              type: 'stream_event',
              data: {
                type: 'message',
                role: 'assistant',
                content: `\n🔑 **[Key Pool Failover]** Chave **${activeKeyId}** encontrou restrição no modelo \`${chosenModel}\` (${apiErrCode || 'Erro'}). Alternando para a próxima chave do ranking: **${nextKey.keyId}** (${nextKey.latencyRank})...\n\n`,
              },
            });

            sysLog.info(
              'KPOOL',
              `[KPOOL] chave ${activeKeyId} falhou no modelo ${chosenModel} (${apiErrCode || 'erro'}). Próxima chave → ${nextKey.keyId}`
            );

            execState.retryTimeout = setTimeout(() => {
              if (execState) execState.retryTimeout = null;
              if (!execState?.cancelled) {
                executeGeminiCli(
                  params,
                  true,
                  {
                    ...state,
                    executionId,
                    currentModel: chosenModel,
                    triedKeyIds: triedKeys,
                  }
                );
              } else {
                executions.delete(executionId);
              }
            }, 800);
            return;
          }

          // 2. Se todas as chaves do Key Pool para este modelo falharam: Verificação do Modelo de Fallback do Agente
          if (!isBadRequestError && (isQuotaError || isOverloadedError || apiErrCode === 429 || apiErrCode === 503 || apiErrCode === 500) && !params.isFallbackExecution && !params.isBackupExecution && !execState.cancelled) {
            try {
              const allAgents = loadAgents(cwd);
              const currentAgentObj = allAgents.find(
                (a) => a.id.toLowerCase() === (agentId || '').toLowerCase() || a.name.toLowerCase() === (agentId || '').toLowerCase()
              );
              
              const configuredFallbackModel = params.fallbackModel || currentAgentObj?.fallbackModel;
              const fallbackModelToUse = configuredFallbackModel ? normalizeCliModelName(configuredFallbackModel) : null;

              if (fallbackModelToUse && fallbackModelToUse !== chosenModel) {
                const reasonText = isQuotaError || apiErrCode === 429
                  ? 'Cotas de requisição esgotadas (Erro 429 / Quota Exceeded)'
                  : 'Servidor sobrecarregado / Alta demanda (Erro 503/500 / High Demand)';
                const agentDisplayName = currentAgentObj?.displayName || currentAgentObj?.name || agentId || 'Agente';

                params.onEvent({
                  type: 'stream_event',
                  data: {
                    type: 'message',
                    role: 'assistant',
                    content: `\n🛡️ **[Modelo de Fallback Acionado]**\nO agente titular **${agentDisplayName}** encontrou uma restrição no modelo \`${chosenModel}\`: *${reasonText}*.\n\n🔄 **Alternando automaticamente para o Modelo de Fallback: \`${fallbackModelToUse}\`** mantendo todas as instruções, contexto e identidade do agente intactos...\n\n`,
                  },
                });

                sysLog.warn(
                  'CLI',
                  `Agente ${agentDisplayName} encontrou ${reasonText} no modelo ${chosenModel}. Alternando para o Modelo de Fallback configurado: ${fallbackModelToUse}.`
                );

                execState.retryTimeout = setTimeout(() => {
                  if (execState) execState.retryTimeout = null;
                  if (!execState?.cancelled) {
                    executeGeminiCli(
                      {
                        ...params,
                        executionId,
                        agentId: params.agentId, // PRESERVA IDENTIDADE DO AGENTE
                        model: fallbackModelToUse, // APENAS O MODELO MUDA
                        fallbackModel: undefined, // não recursivo
                        isFallbackExecution: true,
                        systemInstructions: params.systemInstructions,
                        baseInstructions: params.baseInstructions,
                        overrideBasePrompt: params.overrideBasePrompt,
                        temperature: params.temperature,
                        topP: params.topP,
                        topK: params.topK,
                        maxOutputTokens: params.maxOutputTokens,
                        thinking: params.thinking,
                        resume: true,
                      },
                      true,
                      { executionId, currentModel: fallbackModelToUse }
                    );
                  } else {
                    executions.delete(executionId);
                  }
                }, 1200);
                return;
              }
            } catch (err: any) {
              sysLog.warn('CLI', `Falha ao tentar acionar modelo de fallback: ${err.message}`);
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
            finalMessage = authentication.mode === 'oauth'
              ? 'A autenticação Google/OAuth do Gemini CLI falhou. Verifique o login nativo no Gemini CLI.'
              : authentication.mode === 'api-key' ? 'A autenticação por API key falhou. Verifique a credencial utilizada pelo Gemini CLI ou pelo Key Pool.'
              : 'A autenticação nativa do Gemini CLI falhou. Verifique o método selecionado no CLI.';
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
          tracker.trackFlowSummary(code || 1, finalMessage);
        } else {
          // Gravar sucesso no Key Pool para o modelo e chave atuais
          if (activeKeyId) recordRuntimeExecutionResult(chosenModel, activeKeyId, {
            success: true,
            latencyMs: Math.round(performance.now() - tSpawn),
          });

          logSubagentEvent({
            timestamp: new Date().toISOString(),
            executionId,
            eventType: 'SUBAGENT_COMPLETE',
            agentName: agentId || 'principal',
            model: chosenModel,
          });
          tracker.trackFlowSummary(0);
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
        params.onDone(hasFailed ? code || 1 : 0, signal);
      });

    } catch (err: any) {
      if (systemPromptFile && fs.existsSync(systemPromptFile)) {
        try { fs.unlinkSync(systemPromptFile); } catch {}
      }
      if (tempSettingsFile && fs.existsSync(tempSettingsFile)) {
        try { fs.unlinkSync(tempSettingsFile); } catch {}
      }
      if (execState.childProcess?.exitCode === null && execState.childProcess?.signalCode === null) terminateProcessTree(execState.childProcess, true);
      executions.delete(executionId);
      if (err.code) params.onEvent({ type: 'error', data: { message: err.message, code: err.code } });
      params.onError(err);
    }
  };

  if (isAcpPersistentMode && !isRetry && effectiveSessionId) {
    const runAcpFlow = async () => {
      let acquiredSession = false;
      try {
        const session = await acpManager.getOrCreateSession(effectiveSessionId, params);
        acquiredSession = true;
        if (execState.cancelled) { acpManager.removeSession(effectiveSessionId); return; }
        await session.executePrompt({ ...params, executionId, sessionId: effectiveSessionId });
        executions.delete(executionId);
      } catch (err: any) {
        sysLog.warn('CLI', `Sessão ACP falhou ou foi desconectada. Realizando fallback transparente para execução one-shot: ${err?.message || err}`);
        if (acquiredSession) acpManager.removeSession(effectiveSessionId);
        if (!execState.cancelled) {
          if (err?.promptStarted) params.onError(err);
          else runAsyncFlow();
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
