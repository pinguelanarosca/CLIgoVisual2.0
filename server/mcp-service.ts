import fs from 'node:fs';
import { sysLog } from './logger-service.js';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { terminateProcessTree } from './process-service.js';
import { McpConfig } from '../src/types.js';
import { getResolvedCliPath } from './gemini-cli-service.js';
import { getGuiDataDir } from './paths-service.js';

const INITIAL_GITHUB_MCP: McpConfig = {
  name: 'github',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: {
    // Preserves standard token lookup without hardcoding or leaking
  },
  enabled: true,
  status: 'stopped',
  statusGrade: 'CONFIGURED',
};

const INITIAL_EXA_MCP: McpConfig = {
  name: 'exa',
  url: 'https://mcp.exa.ai/mcp',
  type: 'http',
  trust: true,
  headers: {
    'x-api-key': '$EXA_API_KEY',
    'Authorization': 'Bearer $EXA_API_KEY',
    'Accept': 'application/json, text/event-stream',
  },
  env: {
    EXA_API_KEY: '$EXA_API_KEY',
  },
  enabled: true,
  status: 'stopped',
  statusGrade: 'CONFIGURED',
};

export function getSettingsFilePath(targetDir?: string): string {
  const base = targetDir || getGuiDataDir();
  return path.join(base, '.gemini', 'settings.json');
}

export function loadMcpSettings(targetDir?: string): McpConfig[] {
  const settingsFile = getSettingsFilePath(targetDir);
  const guiOwnedFile = path.resolve(settingsFile) === path.resolve(getSettingsFilePath());
  let mcpServers: Record<string, any> = {};
  let guiMcpServers: Record<string, any> = {};

  if (fs.existsSync(settingsFile)) {
    try {
      const raw = fs.readFileSync(settingsFile, 'utf8');
      const parsed = JSON.parse(raw);
      mcpServers = parsed.mcpServers || {};
      guiMcpServers = parsed.guiMcpServers || {};
    } catch { throw new Error('settings.json inválido; configurações MCP preservadas.'); }
  }

  let modified = false;

  // Import existing mcpServers into guiMcpServers if guiMcpServers is missing them
  for (const [name, server] of Object.entries<any>(mcpServers)) {
    if (!guiMcpServers[name]) {
      guiMcpServers[name] = {
        ...server,
        enabled: server.enabled !== false,
      };
      modified = true;
    }
  }

  // GitHub MCP default: only initialize if it never existed in either guiMcpServers or mcpServers
  if (guiOwnedFile && !guiMcpServers.github) {
    guiMcpServers.github = {
      command: INITIAL_GITHUB_MCP.command,
      args: INITIAL_GITHUB_MCP.args,
      env: INITIAL_GITHUB_MCP.env,
      enabled: true,
    };
    modified = true;
  }

  // Exa MCP default: only initialize if it never existed in either guiMcpServers or mcpServers
  if (guiOwnedFile && !guiMcpServers.exa) {
    guiMcpServers.exa = {
      url: INITIAL_EXA_MCP.url,
      type: INITIAL_EXA_MCP.type,
      trust: INITIAL_EXA_MCP.trust,
      headers: INITIAL_EXA_MCP.headers,
      env: INITIAL_EXA_MCP.env,
      enabled: true,
    };
    modified = true;
  } else if (guiOwnedFile && guiMcpServers.exa && (!guiMcpServers.exa.headers || !guiMcpServers.exa.headers['Accept'])) {
    // Preserve required headers for SSE Exa support without altering enabled status
    guiMcpServers.exa.headers = {
      ...INITIAL_EXA_MCP.headers,
      ...(guiMcpServers.exa.headers || {}),
    };
    guiMcpServers.exa.trust = true;
    modified = true;
  }

  const list: McpConfig[] = [];
  for (const [name, server] of Object.entries<any>(guiMcpServers)) {
    list.push({
      name,
      command: server.command,
      args: server.args || [],
      httpUrl: server.httpUrl,
      url: server.url,
      type: server.type,
      trust: server.trust,
      headers: server.headers,
      env: server.env || {},
      enabled: server.enabled !== false,
      status: 'stopped',
      statusGrade: 'CONFIGURED',
    });
  }

  if (modified && guiOwnedFile) {
    saveMcpSettings(list, targetDir);
  }

  return list;
}

export function saveMcpSettings(servers: McpConfig[], targetDir?: string) {
  const mcpServers: Record<string, any> = {};
  const guiMcpServers: Record<string, any> = {};

  for (const s of servers) {
    const fullConfig: any = {
      enabled: s.enabled !== false,
      env: s.env || {},
    };
    if (s.command) fullConfig.command = s.command;
    if (s.args && s.args.length > 0) fullConfig.args = s.args;
    if (s.url) fullConfig.url = s.url;
    else if (s.httpUrl) fullConfig.httpUrl = s.httpUrl;
    if (s.type) fullConfig.type = s.type;
    if (s.trust !== undefined) fullConfig.trust = s.trust;
    if (s.headers) fullConfig.headers = s.headers;

    // Preserved for GUI state (including disabled MCPs)
    guiMcpServers[s.name] = fullConfig;

    // Only enabled MCPs enter settings.mcpServers for Gemini CLI runtime
    if (s.enabled !== false) {
      const runtimeConfig: any = {
        env: s.env || {},
      };
      if (s.command) runtimeConfig.command = s.command;
      if (s.args && s.args.length > 0) runtimeConfig.args = s.args;
      if (s.url) runtimeConfig.url = s.url;
      else if (s.httpUrl) runtimeConfig.httpUrl = s.httpUrl;
      if (s.type) runtimeConfig.type = s.type;
      if (s.trust !== undefined) runtimeConfig.trust = s.trust;
      if (s.headers) runtimeConfig.headers = s.headers;

      mcpServers[s.name] = runtimeConfig;
    }
  }

  const targetSettingsFiles = new Set([getSettingsFilePath(targetDir)]);

  for (const settingsFile of targetSettingsFiles) {
    try {
      const dir = path.dirname(settingsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let settings: any = {};
      if (fs.existsSync(settingsFile)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        } catch { throw new Error('settings.json inválido; MCP não foi sobrescrito.'); }
      }

      const owned = new Set(settings.guiManagedMcpNames || []);
      const personal = Object.fromEntries(Object.entries(settings.mcpServers || {}).filter(([name]) => !owned.has(name)));
      settings.mcpServers = { ...mcpServers, ...personal };
      settings.guiMcpServers = guiMcpServers;
      settings.guiManagedMcpNames = Object.keys(guiMcpServers).filter(name => !(name in personal));
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
    } catch (error) {
      sysLog.error('MCP', 'Falha ao gravar configurações MCP', error);
      throw error;
    }
  }
}

const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
function rpcResult(data: any, id: number): any {
  if (!data || data.jsonrpc !== '2.0' || data.id !== id) throw new Error('Resposta JSON-RPC inválida ou ID incorreto.');
  if (data.error) throw new Error(`Erro MCP ${data.error.code}: ${data.error.message || 'sem mensagem'}`);
  if (data.result === undefined) throw new Error('Resposta MCP sem result.');
  return data.result;
}
function validateHandshake(result: any): void {
  if (!MCP_PROTOCOLS.includes(result?.protocolVersion) || !result?.capabilities || typeof result.capabilities !== 'object' || !result?.serverInfo?.name) throw new Error('Handshake MCP inválido ou versão incompatível.');
}
async function readRpcResponse(response: Response, id: number, signal: AbortSignal): Promise<any> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status} no servidor MCP.`); }
  if (!response.body) throw new Error('Resposta MCP vazia.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const isSse = response.headers.get('content-type')?.includes('text/event-stream');
  let buffer = '', size = 0;
  const abort = () => { void reader.cancel(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (value) { size += value.byteLength; buffer += decoder.decode(value, { stream: !done }); }
      if (size > 4 * 1024 * 1024) throw new Error('Resposta MCP excedeu 4 MiB.');
      if (isSse) {
        let split: number;
        buffer = buffer.replace(/\r\n/g, '\n');
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (data) { const parsed = JSON.parse(data); if (parsed.id === id) return rpcResult(parsed, id); }
        }
      }
      if (done) break;
    }
    if (isSse) throw new Error('SSE encerrado sem resposta ao pedido MCP.');
    return rpcResult(JSON.parse(buffer), id);
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function connectLegacySse(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<(method: string, params?: any, notification?: boolean) => Promise<any>> {
  const response = await fetch(url, { headers: { ...headers, Accept: 'text/event-stream' }, signal });
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) { await response.body?.cancel(); throw new Error('Transporte SSE legado indisponível.'); }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let endpoint = '', nextId = 0, terminalError: Error | undefined;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void }>();
  let resolveEndpoint!: () => void, rejectEndpoint!: (error: any) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveEndpoint = resolve; rejectEndpoint = reject; });
  const fail = (error: Error) => { terminalError = error; rejectEndpoint(error); for (const item of pending.values()) item.reject(error); pending.clear(); };
  const abort = () => { fail(new Error('Timeout/encerramento da conexão SSE MCP.')); void reader.cancel(); };
  signal.addEventListener('abort', abort, { once: true });
  void (async () => {
    let buffer = '';
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) throw new Error('Conexão SSE MCP encerrada antes da resposta.');
        buffer += decoder.decode(value, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
        if (buffer.length > 4 * 1024 * 1024) throw new Error('Mensagem SSE MCP excedeu 4 MiB.');
        let split: number;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          const lines = frame.split('\n'), event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (event === 'endpoint') {
            const target = new URL(data, url);
            if (target.origin !== new URL(url).origin) throw new Error('Endpoint SSE MCP mudou a origem.');
            endpoint = target.href; resolveEndpoint();
          } else if (data) {
            const parsed = JSON.parse(data), item = pending.get(parsed.id);
            if (item) { pending.delete(parsed.id); try { item.resolve(rpcResult(parsed, parsed.id)); } catch (error) { item.reject(error); } }
          }
        }
      }
    } catch (error: any) { fail(error); }
    finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  })();
  await ready;
  return async (method, params, notification = false) => {
    if (terminalError || signal.aborted) throw terminalError || new Error('Conexão SSE MCP encerrada.');
    const id = ++nextId;
    const reply = notification ? Promise.resolve(undefined) : new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    // Attach the rejection handler before waiting for POST; the SSE reply can arrive first.
    const post = fetch(endpoint, { method: 'POST', headers, signal, body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }) }).then(async result => {
      if (!result.ok) { await result.body?.cancel(); throw new Error(`HTTP ${result.status} no endpoint SSE MCP.`); }
      await result.body?.cancel();
    });
    try { const [, result] = await Promise.all([post, reply]); return result; }
    catch (error) { pending.delete(id); throw error; }
  };
}

export async function testMcpServer(mcp: McpConfig, timeoutMs = 8000): Promise<{ success: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Timeout do handshake/leitura MCP.')), timeoutMs);
  let child: ReturnType<typeof spawn> | undefined;
  const expand = (text: string) => text.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_, name) => mcp.env?.[name] && !mcp.env[name].includes('$') ? mcp.env[name] : process.env[name] || '');
  try {
    let request: (method: string, params?: any, notification?: boolean) => Promise<any>;
    const initializeParams = { protocolVersion: MCP_PROTOCOLS[0], capabilities: {}, clientInfo: { name: 'gemini-gui-test', version: '2.1.0' } };
    if (mcp.url || mcp.httpUrl) {
      const headers: Record<string, string> = { ...Object.fromEntries(Object.entries(mcp.headers || {}).map(([name, value]) => [name, expand(value)])), Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
      let nextId = 0;
      let legacyRequest: Awaited<ReturnType<typeof connectLegacySse>> | undefined;
      request = async (method, params, notification = false) => {
        if (legacyRequest) return legacyRequest(method, params, notification);
        const id = ++nextId;
        const response = await fetch(mcp.httpUrl || mcp.url!, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }), signal: controller.signal });
        if (method === 'initialize' && [404, 405].includes(response.status)) {
          await response.body?.cancel();
          legacyRequest = await connectLegacySse(mcp.httpUrl || mcp.url!, headers, controller.signal);
          return legacyRequest(method, params, notification);
        }
        const sessionId = response.headers.get('mcp-session-id');
        if (sessionId) headers['Mcp-Session-Id'] = sessionId;
        if (notification) {
          if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status} na notificação MCP.`); }
          await response.body?.cancel(); return;
        }
        const result = await readRpcResponse(response, id, controller.signal);
        if (method === 'initialize') headers['MCP-Protocol-Version'] = result.protocolVersion;
        return result;
      };
    } else {
      if (!mcp.command) throw new Error('Nenhum comando ou URL configurado.');
      child = spawn(mcp.command, mcp.args || [], { env: { ...process.env, ...Object.fromEntries(Object.entries(mcp.env || {}).map(([name, value]) => [name, expand(value)])) }, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      let nextId = 0, buffer = '', stderr = '', terminalError: Error | undefined;
      const pending = new Map<number, { resolve: (result: any) => void; reject: (error: any) => void }>();
      const fail = (error: Error) => { terminalError = error; for (const p of pending.values()) p.reject(error); pending.clear(); };
      controller.signal.addEventListener('abort', () => fail(new Error('Timeout do handshake/leitura MCP.')), { once: true });
      child.on('error', fail);
      child.stdin?.on('error', fail);
      child.on('close', (code, signal) => fail(new Error(`Processo MCP encerrado (status=${code}, signal=${signal || 'nenhum'}). ${stderr}`)));
      child.stderr?.on('data', data => { const text = data.toString(); sysLog.debug('MCP', text); stderr = (stderr + text).slice(-8192); });
      child.stdout?.on('data', chunk => {
        buffer += chunk.toString();
        if (buffer.length > 4 * 1024 * 1024) { fail(new Error('Mensagem MCP excedeu 4 MiB.')); return; }
        let split: number;
        while ((split = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, split).trim(); buffer = buffer.slice(split + 1);
          if (!line) continue;
          try {
            const data = JSON.parse(line); const p = pending.get(data.id);
            if (p) { pending.delete(data.id); try { p.resolve(rpcResult(data, data.id)); } catch (error) { p.reject(error); } }
            else if (data.method === 'ping' && data.id !== undefined) child?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: data.id, result: {} }) + '\n');
          } catch { fail(new Error('stdout do MCP não contém JSON-RPC válido.')); }
        }
      });
      request = (method, params, notification = false) => new Promise((resolve, reject) => {
        if (terminalError || controller.signal.aborted) return reject(terminalError || new Error('Timeout MCP.'));
        const id = ++nextId;
        if (!notification) pending.set(id, { resolve, reject });
        child!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }) + '\n', error => { if (error) fail(error); else if (notification) resolve(undefined); });
      });
    }
    const handshake = await request('initialize', initializeParams);
    validateHandshake(handshake);
    await request('notifications/initialized', undefined, true);
    const result = await request(handshake.capabilities.tools ? 'tools/list' : 'ping', {});
    if (handshake.capabilities.tools && !Array.isArray(result?.tools)) throw new Error('tools/list retornou estrutura inválida.');
    return { success: true, message: `Handshake MCP validado: ${handshake.serverInfo.name} (${handshake.protocolVersion}).` };
  } catch (error: any) { return { success: false, message: error.message || 'Falha no teste MCP.' }; }
  finally { clearTimeout(timer); controller.abort(); if (child) { child.stdin?.end(); terminateProcessTree(child); } }
}

export function resetDefaultMcp(targetDir?: string): McpConfig[] {
  const defaultServers: McpConfig[] = [INITIAL_GITHUB_MCP, INITIAL_EXA_MCP];
  saveMcpSettings(defaultServers, targetDir);
  return defaultServers;
}

export function overwriteMcp(servers: McpConfig[], targetDir?: string): void {
  saveMcpSettings(servers, targetDir);
}
