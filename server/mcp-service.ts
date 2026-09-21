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

  if (fs.existsSync(settingsFile)) {
    try {
      const raw = fs.readFileSync(settingsFile, 'utf8');
      const parsed = JSON.parse(raw);
      mcpServers = parsed.mcpServers || {};
    } catch {
      mcpServers = {};
    }
  }

  let modified = false;

  if (!mcpServers.github) {
    mcpServers.github = {
      command: INITIAL_GITHUB_MCP.command,
      args: INITIAL_GITHUB_MCP.args,
      env: INITIAL_GITHUB_MCP.env,
    };
    modified = true;
  }

  if (!mcpServers.exa || !mcpServers.exa.trust || !mcpServers.exa.headers) {
    mcpServers.exa = {
      url: INITIAL_EXA_MCP.url,
      type: INITIAL_EXA_MCP.type,
      trust: INITIAL_EXA_MCP.trust,
      headers: INITIAL_EXA_MCP.headers,
      env: INITIAL_EXA_MCP.env,
    };
    modified = true;
  }

  const list: McpConfig[] = [];
  for (const [name, server] of Object.entries<any>(mcpServers)) {
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
  const settingsFile = getSettingsFilePath(targetDir);
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

  const mcpServers: Record<string, any> = {};
  for (const s of servers) {
    if (s.enabled !== false) {
      const serverConfig: any = {
        env: s.env || {},
      };

      if (s.command) serverConfig.command = s.command;
      if (s.args && s.args.length > 0) serverConfig.args = s.args;
      if (s.url) {
        serverConfig.url = s.url;
      } else if (s.httpUrl) {
        serverConfig.httpUrl = s.httpUrl;
      }
      if (s.type) serverConfig.type = s.type;
      if (s.trust !== undefined) serverConfig.trust = s.trust;
      if (s.headers) serverConfig.headers = s.headers;

      mcpServers[s.name] = serverConfig;
    }
  }

  settings.mcpServers = mcpServers;
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
}

export async function testMcpServer(mcp: McpConfig): Promise<{ success: boolean; message: string }> {
  // Case 1: URL / httpUrl (Remote SSE or HTTP MCP)
  if (mcp.httpUrl || mcp.url) {
    const targetUrl = mcp.httpUrl || mcp.url;
    try {
      // Heartbeat test com headers MCP aceitos
      const res = await fetch(targetUrl!, {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      });
      if (res.ok || res.status === 405 || res.status === 406 || res.status === 404 || res.status === 200) {
        return {
          success: true,
          message: `Servidor MCP remoto conectado com sucesso em ${targetUrl} (Status HTTP ${res.status}).`,
        };
      }
      return {
        success: false,
        message: `Servidor MCP remoto retornou status ${res.status} em ${targetUrl}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Falha ao conectar no servidor MCP remoto em ${targetUrl}: ${err.message}`,
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

