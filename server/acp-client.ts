import { spawn, ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { sysLog } from './logger-service.js';
import { getGuiDataDir } from './paths-service.js';
import { syncAgentsToSettings } from './agents-service.js';
import { syncPoliciesToSettings } from './policies-service.js';
import {
  CliExecutionParams,
  resolveEffectiveCliConfig,
  getResolvedCliPath,
  getExaAuditTools
} from './gemini-cli-service.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
}

interface ActiveExecutionInfo {
  executionId: string;
  params: CliExecutionParams;
  tPromptSent: number;
  firstResponseEmitted: boolean;
  resolvePrompt?: (value: any) => void;
  rejectPrompt?: (reason: any) => void;
}

export class AcpSession {
  public readonly sessionId: string;
  public acpSessionId: string | null = null;
  public cwd: string;
  public model: string;
  public child: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();
  public activeExecution: ActiveExecutionInfo | null = null;
  public isReady = false;
  public isClosed = false;
  public lastUsedAt = Date.now();
  private tempSettingsFile: string | null = null;

  constructor(sessionId: string, cwd: string, model: string) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.model = model;
  }

  public async initializeSession(params: CliExecutionParams): Promise<void> {
    const t0 = performance.now();
    console.log(`[PERF] [${this.sessionId}] acp_spawn`);

    const executionId = params.executionId || `init_${Date.now()}`;
    let cwd = params.workDir || (params.authorizedDirs && params.authorizedDirs[0]) || getGuiDataDir();
    if (!cwd || !fs.existsSync(cwd)) {
      cwd = getGuiDataDir();
    }
    this.cwd = cwd;

    // Configurar o settings e MCPs uma única vez para este processo persistente
    this.tempSettingsFile = await resolveEffectiveCliConfig(cwd, executionId);
    
    let requestedModel = params.model || 'gemini-3.5-flash-lite';
    if (requestedModel === 'auto') requestedModel = 'gemini-3.5-flash-lite';
    this.model = requestedModel;

    let agentId = params.agentId?.toLowerCase() || '';
    if (!agentId && requestedModel) {
      if (requestedModel.includes('3.8')) agentId = 'auditor';
      else if (requestedModel.includes('3.7')) agentId = 'investigator';
      else if (requestedModel.includes('3.5-flash-lite')) agentId = 'principal';
      else if (requestedModel.includes('3.1-flash-lite')) agentId = 'worker';
      else if (requestedModel === 'gemini-3-flash') agentId = 'tester';
    }

    try {
      syncAgentsToSettings(cwd, agentId || 'principal', {
        model: requestedModel,
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        maxOutputTokens: params.maxOutputTokens,
        thinking: params.thinking,
        thinkingLevel: params.thinkingLevel || params.thinking_level,
      });
    } catch (err) {
      sysLog.warn('CLI', `[ACP] Aviso ao sincronizar agentes no settings: ${err}`);
    }

    try {
      syncPoliciesToSettings(cwd);
    } catch (err) {
      sysLog.warn('CLI', `[ACP] Aviso ao sincronizar políticas: ${err}`);
    }

    const args: string[] = [
      '--acp',
      '--skip-trust',
      '-m', requestedModel,
    ];

    if (params.approvalMode) {
      args.push('--approval-mode', params.approvalMode);
    }

    if (params.authorizedDirs && params.authorizedDirs.length > 0) {
      args.push('--include-directories', params.authorizedDirs.join(','));
    }

    // Políticas de segurança
    const guiPoliciesDir = path.join(getGuiDataDir(), '.gemini', 'policies');
    if (fs.existsSync(guiPoliciesDir)) {
      args.push('--policy', guiPoliciesDir);
      args.push('--admin-policy', guiPoliciesDir);
    }

    if (cwd && cwd !== os.homedir() && cwd !== getGuiDataDir()) {
      const wsPolicyDir = path.join(cwd, '.gemini', 'policies');
      if (fs.existsSync(wsPolicyDir)) {
        args.push('--policy', wsPolicyDir);
      }
    }

    const customPolicyPath = path.join(getGuiDataDir(), '.gemini', 'web-preview-policy.toml');
    if (fs.existsSync(customPolicyPath)) {
      args.push('--policy', customPolicyPath);
    }

    const cliPath = getResolvedCliPath();
    const activeApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      GEMINI_CLI_TRUST_WORKSPACE: 'true',
      GEMINI_CLI_NO_RELAUNCH: '1',
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: this.tempSettingsFile,
      ...(activeApiKey ? {
        GEMINI_API_KEY: activeApiKey,
        GOOGLE_GENAI_API_KEY: activeApiKey,
        GOOGLE_API_KEY: activeApiKey,
      } : {}),
    };

    this.child = spawn(cliPath, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!this.child.stdout || !this.child.stdin) {
      throw new Error('Falha ao inicializar canais de stdio do processo ACP.');
    }

    this.rl = readline.createInterface({ input: this.child.stdout });

    this.rl.on('line', (line) => {
      this.handleIncomingLine(line);
    });

    this.child.stderr?.on('data', (data) => {
      const text = data.toString();
      sysLog.debug('CLI', `[ACP_STDERR] ${text}`);
    });

    this.child.on('error', (err) => {
      sysLog.error('CLI', `[ACP] Erro no processo persistente da sessão ${this.sessionId}: ${err.message}`);
      this.cleanup();
    });

    this.child.on('close', (code, signal) => {
      sysLog.info('CLI', `[ACP] Processo persistente da sessão ${this.sessionId} encerrado (code: ${code}, signal: ${signal})`);
      this.cleanup();
    });

    console.log(`[PERF] [${this.sessionId}] acp_initialize`);

    // 1. Enviar handshake de inicialização
    await this.callMethod('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'gemini-gui-acp', version: '2.0.0' },
      clientCapabilities: {
        auth: { terminal: false },
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    }, 15000);

    // 2. Criar a sessão no ACP
    const newSessionResult = await this.callMethod('session/new', {
      cwd,
      mcpServers: [],
    }, 30000);

    if (!newSessionResult?.sessionId) {
      throw new Error(`Sessão ACP não retornou sessionId válido: ${JSON.stringify(newSessionResult)}`);
    }

    this.acpSessionId = newSessionResult.sessionId;
    this.isReady = true;
    this.lastUsedAt = Date.now();

    const tReady = performance.now();
    console.log(`[PERF] [${this.sessionId}] acp_session_ready=${(tReady - t0).toFixed(1)}ms (acpSessionId: ${this.acpSessionId})`);
    sysLog.info('CLI', `[ACP] Sessão ACP inicializada com sucesso para ${this.sessionId} (acpId: ${this.acpSessionId})`);
  }

  public async executePrompt(params: CliExecutionParams): Promise<void> {
    if (!this.child || !this.child.stdin || !this.isReady || !this.acpSessionId) {
      throw new Error(`Sessão ACP não está pronta para executar prompt.`);
    }

    const executionId = params.executionId || `exec_${Date.now()}`;
    const tPromptSent = performance.now();
    console.log(`[PERF] [${executionId}] acp_prompt_sent`);

    this.activeExecution = {
      executionId,
      params,
      tPromptSent,
      firstResponseEmitted: false,
    };
    this.lastUsedAt = Date.now();

    // Notificar payload inicial simulado para compatibilidade com auditoria da GUI
    try {
      const { tools: mcpTools, discoverySource } = getExaAuditTools();
      params.onEvent({
        type: 'final_api_request',
        data: {
          finalApiRequest: {
            model: this.model,
            contents: params.prompt,
            tools: mcpTools,
          },
          parameterOrigins: {
            model: { value: this.model, source: 'Sessão Persistente ACP', category: 'Model Selection' },
            contents: { value: `${params.prompt.length} caracteres`, source: 'Prompt da Mensagem ACP', category: 'Context & Prompt' },
          },
        },
      });
    } catch {}

    let promptText = params.prompt;
    // Se for o primeiro prompt da sessão e houver cabeçalho de workspace, aplicar contexto
    if (params.resume === false) {
      const workspaceHeader = `[CONTEXTO DO PROJETO E WORKSPACE]\nVocê está executando dentro do diretório do projeto: "${this.cwd}".\nDiretórios autorizados do projeto: ${params.authorizedDirs && params.authorizedDirs.length > 0 ? params.authorizedDirs.join(', ') : this.cwd}.\nSempre inspecione e responda com base nos arquivos localizados neste diretório.\n---\n\n`;
      promptText = workspaceHeader + params.prompt;
    }

    return new Promise<void>((resolve, reject) => {
      if (!this.activeExecution) {
        return reject(new Error('Nenhuma execução ativa encontrada.'));
      }

      this.activeExecution.resolvePrompt = resolve;
      this.activeExecution.rejectPrompt = reject;

      this.callMethod('session/prompt', {
        sessionId: this.acpSessionId,
        prompt: [{ type: 'text', text: promptText }],
      }, 300000)
        .then(() => {
          const tDone = performance.now();
          console.log(`[PERF] [${executionId}] completed=${(tDone - tPromptSent).toFixed(1)}ms`);

          if (this.activeExecution?.executionId === executionId) {
            this.activeExecution = null;
          }

          params.onDone(0, undefined);
          resolve();
        })
        .catch((err) => {
          sysLog.error('CLI', `[ACP] Erro ao processar session/prompt na execução [${executionId}]: ${err.message}`);
          if (this.activeExecution?.executionId === executionId) {
            this.activeExecution = null;
          }
          params.onError(err);
          reject(err);
        });
    });
  }

  public async cancelExecution(executionId: string): Promise<boolean> {
    if (!this.activeExecution || this.activeExecution.executionId !== executionId) {
      return false;
    }

    sysLog.warn('CLI', `[ACP] Cancelando execução ativa [${executionId}] na sessão ACP ${this.sessionId}`);

    try {
      if (this.acpSessionId) {
        this.sendNotification('session/cancel', {
          sessionId: this.acpSessionId,
        });
      }
    } catch (err) {
      sysLog.warn('CLI', `[ACP] Falha ao enviar session/cancel: ${err}`);
    }

    if (this.activeExecution.resolvePrompt) {
      this.activeExecution.resolvePrompt(null);
    }
    this.activeExecution.params.onDone(0, 'SIGINT');
    this.activeExecution = null;
    return true;
  }

  private handleIncomingLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let data: any;
    try {
      data = JSON.parse(trimmed);
    } catch {
      return;
    }

    // 1. Resposta a uma chamada enviada por nós
    if (data.id !== undefined && (data.result !== undefined || data.error !== undefined)) {
      const pending = this.pendingRequests.get(data.id);
      if (pending) {
        this.pendingRequests.delete(data.id);
        clearTimeout(pending.timer);
        if (data.error) {
          pending.reject(new Error(data.error.message || `Erro RPC ${data.error.code}`));
        } else {
          pending.resolve(data.result);
        }
      }
      return;
    }

    // 2. Pedido de permissão do agente para o cliente
    if (data.method === 'session/request_permission') {
      const permResponse = {
        jsonrpc: '2.0',
        id: data.id,
        result: {
          outcome: {
            outcome: 'selected',
            optionId: data.params?.options?.[0]?.optionId || 'allow_always',
          },
        },
      };
      this.sendRaw(permResponse);
      return;
    }

    // 3. Notificação session/update
    if (data.method === 'session/update' && data.params?.update) {
      const update = data.params.update;
      const active = this.activeExecution;
      if (!active) return;

      if (!active.firstResponseEmitted) {
        active.firstResponseEmitted = true;
        const tFirstResp = performance.now();
        console.log(`[PERF] [${active.executionId}] first_response=${(tFirstResp - active.tPromptSent).toFixed(1)}ms`);
      }

      if (update.sessionUpdate === 'agent_message_chunk' && update.content?.text) {
        active.params.onEvent({
          type: 'message',
          data: {
            role: 'assistant',
            content: update.content.text,
          },
        });
      } else if (update.sessionUpdate === 'tool_call') {
        active.params.onEvent({
          type: 'tool_use',
          data: {
            tool_call_id: update.toolCallId || `tool_${Date.now()}`,
            tool_name: update.title || update.kind || 'tool',
            parameters: {},
            description: update.title,
            status: 'running',
            timestamp: new Date().toISOString(),
          },
        });
      } else if (update.sessionUpdate === 'tool_call_update') {
        let contentText = '';
        if (Array.isArray(update.content)) {
          contentText = update.content
            .map((c: any) => c?.content?.text || (typeof c === 'string' ? c : JSON.stringify(c)))
            .join('\n');
        } else if (typeof update.content === 'string') {
          contentText = update.content;
        }

        active.params.onEvent({
          type: 'tool_result',
          data: {
            tool_call_id: update.toolCallId,
            output: contentText,
            status: update.status === 'completed' ? 'completed' : 'failed',
          },
        });
      } else {
        active.params.onEvent({
          type: 'stream_event',
          data: update,
        });
      }
    }
  }

  public callMethod(method: string, params?: any, timeoutMs = 60000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.child || !this.child.stdin || this.isClosed) {
        return reject(new Error('Processo ACP não está acessível.'));
      }

      const id = this.nextRequestId++;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timeout na chamada ACP do método "${method}" (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const payload: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.sendRaw(payload);
    });
  }

  public sendNotification(method: string, params?: any): void {
    if (!this.child || !this.child.stdin || this.isClosed) return;
    const payload: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.sendRaw(payload);
  }

  private sendRaw(obj: any): void {
    if (!this.child || !this.child.stdin || this.isClosed) return;
    try {
      this.child.stdin.write(JSON.stringify(obj) + '\n');
    } catch (err) {
      sysLog.error('CLI', `[ACP] Falha ao escrever no stdin do processo ACP: ${err}`);
    }
  }

  public cleanup(): void {
    this.isClosed = true;
    this.isReady = false;

    for (const [, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Sessão ACP encerrada.'));
    }
    this.pendingRequests.clear();

    if (this.activeExecution && this.activeExecution.rejectPrompt) {
      this.activeExecution.rejectPrompt(new Error('Sessão ACP finalizada abruptamente.'));
      this.activeExecution = null;
    }

    if (this.rl) {
      try { this.rl.close(); } catch {}
      this.rl = null;
    }

    if (this.child) {
      try { this.child.kill('SIGTERM'); } catch {}
      this.child = null;
    }

    if (this.tempSettingsFile && fs.existsSync(this.tempSettingsFile)) {
      try { fs.unlinkSync(this.tempSettingsFile); } catch {}
    }
  }
}

export class AcpSessionManager {
  private static instance: AcpSessionManager;
  private sessions = new Map<string, AcpSession>();

  private constructor() {}

  public static getInstance(): AcpSessionManager {
    if (!AcpSessionManager.instance) {
      AcpSessionManager.instance = new AcpSessionManager();
    }
    return AcpSessionManager.instance;
  }

  public isPersistentEnabled(): boolean {
    return process.env.GEMINI_GUI_PERSISTENT === '1';
  }

  public hasSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return Boolean(session && session.isReady && !session.isClosed);
  }

  public async getOrCreateSession(sessionId: string, params: CliExecutionParams): Promise<AcpSession> {
    let session = this.sessions.get(sessionId);

    if (session && session.isReady && !session.isClosed) {
      sysLog.info('CLI', `[ACP] Reutilizando processo ACP persistente para a sessão: ${sessionId}`);
      return session;
    }

    if (session) {
      session.cleanup();
      this.sessions.delete(sessionId);
    }

    let cwd = params.workDir || (params.authorizedDirs && params.authorizedDirs[0]) || getGuiDataDir();
    const model = params.model || 'gemini-3.5-flash-lite';

    session = new AcpSession(sessionId, cwd, model);
    this.sessions.set(sessionId, session);

    try {
      await session.initializeSession(params);
      return session;
    } catch (err) {
      sysLog.error('CLI', `[ACP] Falha na inicialização da sessão ACP (${sessionId}): ${err}`);
      session.cleanup();
      this.sessions.delete(sessionId);
      throw err;
    }
  }

  public cancelExecution(executionId: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.activeExecution?.executionId === executionId) {
        session.cancelExecution(executionId);
        return true;
      }
    }
    return false;
  }

  public removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.cleanup();
      this.sessions.delete(sessionId);
    }
  }
}

export const acpManager = AcpSessionManager.getInstance();
