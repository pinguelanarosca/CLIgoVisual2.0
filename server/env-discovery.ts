import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let hasDiscovered = false;
let lastDiscoveryResult: 'found' | 'not_found' | 'none' = 'none';
let lastDiscoveryTime = 0;
const DISCOVERY_NEGATIVE_TTL_MS = 5 * 60 * 1000; // 5 minutes negative cache TTL

function extractKeyFromString(content: string): string | null {
  if (!content) return null;
  // Match export GEMINI_API_KEY=..., GEMINI_API_KEY=..., GOOGLE_GENAI_API_KEY=..., GOOGLE_API_KEY=...
  const envRegex = /^\s*(?:export\s+)?(?:GEMINI_API_KEY|GOOGLE_GENAI_API_KEY|GOOGLE_API_KEY)\s*=\s*(?:["']?)([0-9A-Za-z-_./]{20,})(?:["']?)\s*$/m;
  const match = content.match(envRegex);
  if (match && match[1]) {
    return match[1].trim();
  }

  // JSON format check
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null) {
      const key = parsed.GEMINI_API_KEY || parsed.geminiApiKey || parsed.apiKey || parsed.GOOGLE_GENAI_API_KEY;
      if (typeof key === 'string' && key.trim().length >= 20) {
        return key.trim();
      }
    }
  } catch {}

  return null;
}

function getCandidateHomeDirs(): string[] {
  const dirs = new Set<string>();

  if (process.env.HOME) dirs.add(process.env.HOME);
  try {
    const homedir = os.homedir();
    if (homedir) dirs.add(homedir);
  } catch {}

  const sudoUser = process.env.SUDO_USER;
  if (sudoUser && sudoUser !== 'root') {
    dirs.add(`/home/${sudoUser}`);
  }

  // Inspect /etc/passwd for regular user homes (/home/*)
  try {
    if (fs.existsSync('/etc/passwd')) {
      const passwd = fs.readFileSync('/etc/passwd', 'utf8');
      for (const line of passwd.split('\n')) {
        const parts = line.split(':');
        if (parts.length >= 6) {
          const home = parts[5];
          const uid = parseInt(parts[2], 10);
          if (uid >= 1000 && home && home.startsWith('/home/')) {
            dirs.add(home);
          }
        }
      }
    }
  } catch {}

  // List /home directly if accessible
  try {
    if (fs.existsSync('/home')) {
      const entries = fs.readdirSync('/home');
      for (const entry of entries) {
        const p = path.join('/home', entry);
        if (fs.statSync(p).isDirectory()) {
          dirs.add(p);
        }
      }
    }
  } catch {}

  return Array.from(dirs);
}

export function discoverApiKeyFromLoginEnv(forceRefresh = false): void {
  if (!forceRefresh) {
    const existingKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
    if (existingKey && existingKey.trim()) {
      hasDiscovered = true;
      lastDiscoveryResult = 'found';
      lastDiscoveryTime = Date.now();
      return;
    }

    const now = Date.now();
    if (lastDiscoveryResult === 'found') return;
    if (lastDiscoveryResult === 'not_found' && (now - lastDiscoveryTime < DISCOVERY_NEGATIVE_TTL_MS)) {
      return;
    }
    if (hasDiscovered) return;
  }

  const candidateHomes = getCandidateHomeDirs();

  // 1. Scan user configuration files directly (fast, reliable, no shell sub-process needed)
  for (const home of candidateHomes) {
    const candidateFiles = [
      path.join(home, '.bashrc'),
      path.join(home, '.profile'),
      path.join(home, '.bash_profile'),
      path.join(home, '.zshrc'),
      path.join(home, '.zprofile'),
      path.join(home, '.bash_login'),
      path.join(home, '.local', 'share', 'gemini-gui', '.env'),
      path.join(home, '.local', 'share', 'gemini-gui', 'env'),
      path.join(home, '.gemini', '.env'),
      path.join(home, '.gemini', 'settings.json'),
      path.join(home, '.gemini', 'config.json'),
    ];

    // Also check ~/.config/environment.d/*.conf
    const envDir = path.join(home, '.config', 'environment.d');
    if (fs.existsSync(envDir)) {
      try {
        const files = fs.readdirSync(envDir);
        for (const f of files) {
          if (f.endsWith('.conf')) {
            candidateFiles.push(path.join(envDir, f));
          }
        }
      } catch {}
    }

    for (const filePath of candidateFiles) {
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const foundKey = extractKeyFromString(content);
          if (foundKey) {
            process.env.GEMINI_API_KEY = foundKey;
            console.log(`[SYSTEM] GEMINI_API_KEY descoberta em: ${filePath}`);
            hasDiscovered = true;
            lastDiscoveryResult = 'found';
            lastDiscoveryTime = Date.now();
            return;
          }
        } catch {}
      }
    }
  }

  // Check system-level files
  const systemFiles = [
    '/etc/environment',
    '/opt/gemini-gui/.env',
    path.join(process.cwd(), '.env'),
  ];
  for (const sysFile of systemFiles) {
    if (fs.existsSync(sysFile)) {
      try {
        const content = fs.readFileSync(sysFile, 'utf8');
        const foundKey = extractKeyFromString(content);
        if (foundKey) {
          process.env.GEMINI_API_KEY = foundKey;
          console.log(`[SYSTEM] GEMINI_API_KEY descoberta em: ${sysFile}`);
          hasDiscovered = true;
          lastDiscoveryResult = 'found';
          lastDiscoveryTime = Date.now();
          return;
        }
      } catch {}
    }
  }

  // 2. Interactive shell discovery as fallback (sources aliases and full interactive profile)
  const targetUser = process.env.SUDO_USER || '';
  const isSudo = targetUser && targetUser !== 'root';

  const commands = [
    // Bash interativo
    isSudo
      ? `sudo -u ${targetUser} bash -i -c 'echo -n "$GEMINI_API_KEY:$GOOGLE_GENAI_API_KEY:$GOOGLE_API_KEY"' 2>/dev/null`
      : `bash -i -c 'echo -n "$GEMINI_API_KEY:$GOOGLE_GENAI_API_KEY:$GOOGLE_API_KEY"' 2>/dev/null`,
    // Bash de login
    isSudo
      ? `sudo -u ${targetUser} bash -l -c 'echo -n "$GEMINI_API_KEY:$GOOGLE_GENAI_API_KEY:$GOOGLE_API_KEY"' 2>/dev/null`
      : `bash -l -c 'echo -n "$GEMINI_API_KEY:$GOOGLE_GENAI_API_KEY:$GOOGLE_API_KEY"' 2>/dev/null`,
    // Zsh interativo
    isSudo
      ? `sudo -u ${targetUser} zsh -i -c 'echo -n "$GEMINI_API_KEY:$GOOGLE_GENAI_API_KEY:$GOOGLE_API_KEY"' 2>/dev/null`
      : `zsh -i -c 'echo -n "$GEMINI_API_KEY:$GOOGLE_GENAI_API_KEY:$GOOGLE_API_KEY"' 2>/dev/null`,
  ];

  for (const cmd of commands) {
    try {
      const output = execSync(cmd, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (output && output !== '::' && output !== ':') {
        const parts = output.split(':');
        const geminiKey = parts[0]?.trim() || parts[1]?.trim() || parts[2]?.trim();
        if (geminiKey && (geminiKey.startsWith('AIza') || geminiKey.length >= 25)) {
          process.env.GEMINI_API_KEY = geminiKey;
          console.log('[SYSTEM] GEMINI_API_KEY descoberta com sucesso via shell interativo.');
          hasDiscovered = true;
          lastDiscoveryResult = 'found';
          lastDiscoveryTime = Date.now();
          return;
        }
      }
    } catch {}
  }

  // Not found in this scan
  hasDiscovered = true;
  lastDiscoveryResult = 'not_found';
  lastDiscoveryTime = Date.now();
}
