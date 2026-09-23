import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PolicyConfig } from '../src/types.js';
import { getGuiDataDir } from './paths-service.js';

export function getUserPoliciesDirectory(): string {
  return path.join(getGuiDataDir(), '.gemini', 'policies');
}

export function getPoliciesDirectory(targetDir?: string): string {
  const base = targetDir || getGuiDataDir();
  return path.join(base, '.gemini', 'policies');
}

export const DEFAULT_DENY_GOOGLE_SEARCH_TOML = `# User Policy: Global Denial of Google Web Search
# Enforces Policy Engine restriction on google_web_search and routes search requests to Exa (web_search_exa)

[[rule]]
name = "Deny Google Web Search"
toolName = "google_web_search"
decision = "deny"
priority = 999
denyMessage = "google_web_search está desativado globalmente pela Política de Segurança. Utilize a ferramenta web_search_exa do MCP Exa."
modes = ["default", "autoEdit", "yolo", "plan"]
`;

export const DEFAULT_ALLOW_MCP_TOML = `# User Policy: Allow MCP and Essential Subagent Tools
# Ensures MCP tools (e.g. Exa search) are permitted in headless and subagent executions

[[rule]]
name = "Allow All MCP Tools"
toolName = "mcp_*"
decision = "allow"
priority = 90

[[rule]]
name = "Allow All MCP Servers"
toolName = "*"
mcpName = "*"
decision = "allow"
priority = 90

[[rule]]
name = "Allow Essential Development Tools"
toolName = "*"
decision = "allow"
priority = 90
`;

export function ensureDefaultUserPolicies(): void {
  const wsDir = getPoliciesDirectory();
  try {
    if (!fs.existsSync(wsDir)) {
      fs.mkdirSync(wsDir, { recursive: true });
    }

    const policyPath = path.join(wsDir, 'deny-google-search.toml');
    if (!fs.existsSync(policyPath)) {
      fs.writeFileSync(policyPath, DEFAULT_DENY_GOOGLE_SEARCH_TOML, 'utf8');
    }

    const mcpPolicyPath = path.join(wsDir, 'allow-mcp.toml');
    fs.writeFileSync(mcpPolicyPath, DEFAULT_ALLOW_MCP_TOML, 'utf8');
  } catch (err) {
    // ignore write errors
  }
}

export function loadPolicies(targetDir?: string): PolicyConfig[] {
  ensureDefaultUserPolicies();

  const wsDir = getPoliciesDirectory(targetDir);
  const loadedMap = new Map<string, PolicyConfig>();

  if (fs.existsSync(wsDir)) {
    try {
      const files = fs.readdirSync(wsDir).filter((f) => f.endsWith('.toml'));
      for (const file of files) {
        if (!loadedMap.has(file)) {
          const filePath = path.join(wsDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          loadedMap.set(file, {
            filename: file,
            content,
          });
        }
      }
    } catch (err) {
      console.error(`Erro ao carregar políticas do diretório ${wsDir}:`, err);
    }
  }

  return Array.from(loadedMap.values());
}

export function syncPoliciesToSettings(targetDir?: string): void {
  try {
    ensureDefaultUserPolicies();

    const base = targetDir || getGuiDataDir();
    const wsDir = path.join(base, '.gemini', 'policies');

    if (!fs.existsSync(wsDir)) {
      fs.mkdirSync(wsDir, { recursive: true });
    }

    const settingsPath = path.join(base, '.gemini', 'settings.json');
    let settings: any = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {
        settings = {};
      }
    }

    const allPaths: string[] = [wsDir];

    settings.policyPaths = allPaths;
    settings.adminPolicyPaths = allPaths;

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

  } catch (err) {
    console.error('Erro ao sincronizar políticas no settings.json:', err);
  }
}

export function savePolicy(filename: string, content: string, targetDir?: string): boolean {
  try {
    let finalFilename = filename;
    if (!finalFilename.endsWith('.toml')) {
      finalFilename += '.toml';
    }

    const wsDir = getPoliciesDirectory(targetDir);
    if (!fs.existsSync(wsDir)) {
      fs.mkdirSync(wsDir, { recursive: true });
    }
    fs.writeFileSync(path.join(wsDir, finalFilename), content, 'utf8');

    syncPoliciesToSettings(targetDir);
    return true;
  } catch (err) {
    console.error('Erro ao salvar política:', err);
    return false;
  }
}

export function deletePolicy(filename: string, targetDir?: string): boolean {
  try {
    const wsDir = getPoliciesDirectory(targetDir);
    const wsPath = path.join(wsDir, filename);
    if (fs.existsSync(wsPath)) {
      fs.unlinkSync(wsPath);
    }

    syncPoliciesToSettings(targetDir);
    return true;
  } catch (err) {
    console.error('Erro ao deletar política:', err);
    return false;
  }
}

export function renamePolicy(oldFilename: string, newFilename: string, targetDir?: string): boolean {
  try {
    let finalNewFilename = newFilename;
    if (!finalNewFilename.endsWith('.toml')) {
      finalNewFilename += '.toml';
    }

    const wsDir = getPoliciesDirectory(targetDir);
    const oldWsPath = path.join(wsDir, oldFilename);
    const newWsPath = path.join(wsDir, finalNewFilename);
    if (fs.existsSync(oldWsPath)) {
      fs.renameSync(oldWsPath, newWsPath);
    }

    syncPoliciesToSettings(targetDir);
    return true;
  } catch (err) {
    console.error('Erro ao renomear política:', err);
    return false;
  }
}

export function resetDefaultPolicies(targetDir?: string): PolicyConfig[] {
  const wsDir = getPoliciesDirectory(targetDir);
  if (fs.existsSync(wsDir)) {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(wsDir, { recursive: true });
  const defaultFile = path.join(wsDir, 'deny-google-search.toml');
  fs.writeFileSync(defaultFile, DEFAULT_DENY_GOOGLE_SEARCH_TOML, 'utf8');
  syncPoliciesToSettings(targetDir);
  return [{ filename: 'deny-google-search.toml', content: DEFAULT_DENY_GOOGLE_SEARCH_TOML }];
}

export function overwritePolicies(policies: PolicyConfig[], targetDir?: string): void {
  const wsDir = getPoliciesDirectory(targetDir);
  if (fs.existsSync(wsDir)) {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(wsDir, { recursive: true });
  for (const pol of policies) {
    let fname = pol.filename;
    if (!fname.endsWith('.toml')) fname += '.toml';
    fs.writeFileSync(path.join(wsDir, fname), pol.content, 'utf8');
  }
  syncPoliciesToSettings(targetDir);
}

