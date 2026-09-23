import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
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
  let mcpServers: Record<string, any> = {};
  let guiMcpServers: Record<string, any> = {};

  if (fs.existsSync(settingsFile)) {
    try {
      const raw = fs.readFileSync(settingsFile, 'utf8');
      const parsed = JSON.parse(raw);
      mcpServers = parsed.mcpServers || {};
      guiMcpServers = parsed.guiMcpServers || {};
    } catch {
      mcpServers = {};
      guiMcpServers = {};
    }
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
  if (!guiMcpServers.github) {
    guiMcpServers.github = {
      command: INITIAL_GITHUB_MCP.command,
      args: INITIAL_GITHUB_MCP.args,
      env: INITIAL_GITHUB_MCP.env,
      enabled: true,
    };
    modified = true;
  }

  // Exa MCP default: only initialize if it never existed in either guiMcpServers or mcpServers
  if (!guiMcpServers.exa) {
    guiMcpServers.exa = {
      url: INITIAL_EXA_MCP.url,
      type: INITIAL_EXA_MCP.type,
      trust: INITIAL_EXA_MCP.trust,
      headers: INITIAL_EXA_MCP.headers,
      env: INITIAL_EXA_MCP.env,
      enabled: true,
    };
    modified = true;
  } else if (!guiMcpServers.exa.headers || !guiMcpServers.exa.headers['Accept']) {
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

  if (modified) {
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

  const targetSettingsFiles = new Set<string>();
  targetSettingsFiles.add(getSettingsFilePath(targetDir));
  targetSettingsFiles.add(path.join(getGuiDataDir(), '.gemini', 'settings.json'));
  targetSettingsFiles.add(path.join(os.homedir(), '.gemini', 'settings.json'));
  if (targetDir) {
    targetSettingsFiles.add(path.join(targetDir, '.gemini', 'settings.json'));
  }

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
        } catch {
          settings = {};
        }
      }

      settings.mcpServers = mcpServers;
      settings.guiMcpServers = guiMcpServers;
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
    } catch {
      // Ignorar erros em diretórios não graváveis
    }
  }
}

export async function testMcpServer(mcp: McpConfig): Promise<{ success: boolean; message: string }> {
  // Case 1: URL / httpUrl (Remote SSE or HTTP MCP)
  if (mcp.httpUrl || mcp.url) {
    const targetUrl = mcp.httpUrl || mcp.url;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const headers: Record<string, string> = {
        'Accept': 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      };
      if (mcp.headers && typeof mcp.headers === 'object') {
        for (const [k, v] of Object.entries(mcp.headers)) {
          if (typeof v === 'string') {
            headers[k] = v;
          }
        }
      }

      let res: Response;
      try {
        res = await fetch(targetUrl!, {
          method: 'POST',
          headers,
          body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 401 || res.status === 403) {
        return {
          success: false,
          message: `MCP rejeitou autenticação em ${targetUrl} (Status HTTP ${res.status}). Verifique as credenciais ou headers configurados.`,
        };
      }

      if (res.status === 404) {
        return {
          success: false,
          message: `MCP não encontrado em ${targetUrl} (Status HTTP 404 - Endpoint inexistente).`,
        };
      }

      if (res.status === 405) {
        return {
          success: false,
          message: `MCP não aceita esse método em ${targetUrl} (Status HTTP 405 - Método não permitido).`,
        };
      }

      if (res.status === 406) {
        return {
          success: false,
          message: `Resposta incompatível em ${targetUrl} (Status HTTP 406 - Not Acceptable).`,
        };
      }

      if (res.status >= 500) {
        return {
          success: false,
          message: `Servidor MCP indisponível em ${targetUrl} (Status HTTP ${res.status}).`,
        };
      }

      if (res.status >= 200 && res.status < 300) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream')) {
          return {
            success: true,
            message: `Servidor MCP remoto conectado com sucesso em ${targetUrl} (SSE Event Stream - Status HTTP ${res.status}).`,
          };
        }

        const text = await res.text();
        try {
          const parsed = JSON.parse(text);
          if (parsed && (parsed.jsonrpc === '2.0' || parsed.result !== undefined || parsed.id !== undefined || parsed.error !== undefined)) {
            return {
              success: true,
              message: `Servidor MCP remoto conectado com sucesso em ${targetUrl} (JSON-RPC MCP - Status HTTP ${res.status}).`,
            };
          }
        } catch {
          // não é JSON
        }

        if (text.length > 0 || contentType.includes('application/json')) {
          return {
            success: true,
            message: `Servidor MCP remoto conectado com sucesso em ${targetUrl} (Status HTTP ${res.status}).`,
          };
        }

        return {
          success: false,
          message: `Resposta inválida do servidor MCP em ${targetUrl} (Status HTTP ${res.status} - Corpo sem estrutura MCP).`,
        };
      }

      return {
        success: false,
        message: `Servidor MCP remoto retornou status ${res.status} em ${targetUrl}`,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return {
          success: false,
          message: `Timeout ao tentar conectar no servidor MCP remoto em ${targetUrl}.`,
        };
      }
      return {
        success: false,
        message: `Erro de conexão ao tentar acessar servidor MCP remoto em ${targetUrl}: ${err.message}`,
      };
    }
  }

  // Case 2: Standard Command (Stdio MCP)
  if (!mcp.command) {
    return { success: false, message: 'Nenhum comando ou URL configurado para este MCP.' };
  }

  return new Promise((resolve) => {
    try {
      // Test running the binary / command with a timeout
      const child = spawn(mcp.command!, [...(mcp.args || []), '--help'], {
        env: { ...process.env, ...mcp.env },
      });

      let output = '';
      let errorOutput = '';

      child.stdout?.on('data', (d) => {
        output += d.toString();
      });
      child.stderr?.on('data', (d) => {
        errorOutput += d.toString();
      });

      const timer = setTimeout(() => {
        child.kill();
        resolve({
          success: true,
          message: `Processo MCP iniciou corretamente.\n\nSaída:\n${output}\n${errorOutput}`.trim(),
        });
      }, 5000);

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          message: `Falha ao executar ${mcp.command}: ${err.message}\n\nErro:\n${errorOutput}`.trim(),
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || output.length > 0) {
          resolve({
            success: true,
            message: `Servidor MCP respondeu com êxito (código ${code}).\n\nSaída:\n${output}\n${errorOutput}`.trim(),
          });
        } else {
          resolve({
            success: false,
            message: `Servidor MCP encerrou com código de saída ${code}.\n\nErro:\n${errorOutput}`,
          });
        }
      });
    } catch (err: any) {
      resolve({
        success: false,
        message: `Exceção durante teste: ${err.message}`,
      });
    }
  });
}

export function resetDefaultMcp(targetDir?: string): McpConfig[] {
  const defaultServers: McpConfig[] = [INITIAL_GITHUB_MCP, INITIAL_EXA_MCP];
  saveMcpSettings(defaultServers, targetDir);
  return defaultServers;
}

export function overwriteMcp(servers: McpConfig[], targetDir?: string): void {
  saveMcpSettings(servers, targetDir);
}

