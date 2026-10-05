import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getBestEligibleKey, loadConfiguredKeys } from './key-pool-service.js';
import { getGuiDataDir } from './paths-service.js';

export type CliAuthMode = 'oauth' | 'api-key' | 'native' | 'none';
export interface CliAuthentication {
  mode: CliAuthMode;
  selectedType?: string;
  configured: boolean;
  state: 'authenticated' | 'configured' | 'unauthenticated';
  message: string;
  nativeHome?: string;
  cliPath?: string;
}

// Gemini CLI accepts JSON with comments in its native settings files.
function readSettings(file: string): any {
  if (!fs.existsSync(file)) return {};
  const source = fs.readFileSync(file, 'utf8');
  let output = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      output += char;
      if (char === '\\') output += source[++i] || '';
      else if (char === '"') quoted = false;
    } else if (char === '"') { quoted = true; output += char; }
    else if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      output += '\n';
    } else if (char === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++; output += ' ';
    } else output += char;
  }
  const settings = JSON.parse(output);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Configuração nativa do Gemini CLI inválida.');
  return settings;
}

function nativeCliHome(env: NodeJS.ProcessEnv, cliPath = 'gemini'): string {
  if (env.GEMINI_CLI_HOME) return env.GEMINI_CLI_HOME;
  const home = os.homedir();
  const executable = path.isAbsolute(cliPath) ? cliPath : (env.PATH || '').split(path.delimiter)
    .concat(['/snap/bin'])
    .map(directory => path.join(directory, cliPath)).find(file => fs.existsSync(file));
  if (executable && (path.dirname(executable) === '/snap/bin' || executable.includes('/snap/'))) {
    try {
      // The installed Snap launcher changes HOME. Resolve its alias/package,
      // otherwise a logged-in Snap looks unauthenticated to a host GUI.
      let launcher = path.basename(executable);
      try {
        launcher = path.basename(fs.readlinkSync(executable));
      } catch {
        // Not a symlink or unreadable link, retain executable basename
      }
      const candidates = [
        path.basename(executable).split('.')[0],
        'gemini-cli',
        'gemini'
      ];
      if (launcher !== 'snap' && launcher !== 'gemini') {
        candidates.unshift(launcher.split('.')[0]);
      }
      for (const snapName of candidates) {
        if (/^[a-z0-9-]+$/.test(snapName)) {
          const snapYamlPath = `/snap/${snapName}/current/meta/snap.yaml`;
          if (fs.existsSync(snapYamlPath)) {
            const metadata = fs.readFileSync(snapYamlPath, 'utf8');
            if (/^\s+HOME:\s+\$SNAP_USER_COMMON\s*$/m.test(metadata)) return path.join(home, 'snap', snapName, 'common');
            if (/^\s+HOME:\s+\$SNAP_USER_DATA\s*$/m.test(metadata)) return path.join(home, 'snap', snapName, 'current');
          }
          const candidateCommon = path.join(home, 'snap', snapName, 'common');
          if (fs.existsSync(candidateCommon)) return candidateCommon;
        }
      }
      const defaultSnapCommon = path.join(home, 'snap', 'gemini-cli', 'common');
      if (fs.existsSync(defaultSnapCommon)) {
        return defaultSnapCommon;
      }
    } catch { /* Unknown launchers retain the regular native HOME. */ }
  }
  return home;
}

export function resolveCliAuthentication(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env, cliPath?: string): CliAuthentication {
  const home = nativeCliHome(env, cliPath);
  const systemPath = env.GEMINI_CLI_SYSTEM_SETTINGS_PATH || (process.platform === 'win32'
    ? 'C:\\ProgramData\\gemini-cli\\settings.json' : process.platform === 'darwin'
      ? '/Library/Application Support/GeminiCli/settings.json' : '/etc/gemini-cli/settings.json');
  const guiDataDir = typeof getGuiDataDir === 'function' ? getGuiDataDir() : path.join(home, '.local', 'share', 'gemini-gui');
  const guiSettings = path.join(guiDataDir, '.gemini', 'settings.json');
  const files = [
    env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH || path.join(path.dirname(systemPath), 'system-defaults.json'),
    path.join(home, '.gemini', 'settings.json'),
    ...(path.resolve(guiSettings) !== path.resolve(path.join(home, '.gemini', 'settings.json')) ? [guiSettings] : []),
    ...(path.resolve(cwd) !== path.resolve(home) && path.resolve(cwd) !== path.resolve(guiDataDir) ? [path.join(cwd, '.gemini', 'settings.json')] : []),
    systemPath
  ];
  let selectedType: string | undefined, enforcedType: string | undefined;
  for (const file of files) {
    const auth = readSettings(file).security?.auth;
    if (typeof auth?.selectedType === 'string') selectedType = auth.selectedType.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match: string, a: string | undefined, b: string | undefined) => env[a || b || ''] || '');
    if (typeof auth?.enforcedType === 'string') enforcedType = auth.enforcedType;
  }
  // A GUI-bundled CLI must not hide the terminal's configured Snap OAuth
  // profile. Forward the native snap launcher as cliPath so execution can
  // consume the snap credentials directly, and forward the native HOME.
  const snapLauncher = (env.PATH || '').split(path.delimiter).map(dir => path.join(dir, 'gemini'))
    .concat(['/snap/bin/gemini'])
    .find(file => (path.dirname(file) === '/snap/bin' || file.includes('/snap/')) && fs.existsSync(file));
  if (!selectedType && snapLauncher && !env.GEMINI_CLI_HOME && (cliPath?.split(path.sep).includes('node_modules') || !cliPath)) {
    const snapHome = nativeCliHome(env, snapLauncher);
    if (snapHome !== home && readSettings(path.join(snapHome, '.gemini', 'settings.json')).security?.auth?.selectedType) {
      const snapAuthentication = resolveCliAuthentication(cwd, env, snapLauncher);
      if (snapAuthentication.mode === 'oauth') {
        snapAuthentication.cliPath = snapLauncher;
        return snapAuthentication;
      }
    }
  }
  if (!selectedType) {
    if (env.GOOGLE_GENAI_USE_GCA === 'true') selectedType = 'oauth-personal';
    else if (env.GOOGLE_GENAI_USE_VERTEXAI === 'true') selectedType = 'vertex-ai';
    else if (env.GOOGLE_GEMINI_BASE_URL) selectedType = 'gateway';
    else if (env.GEMINI_API_KEY) selectedType = 'gemini-api-key';
    else if (env.CLOUD_SHELL === 'true' || env.GEMINI_CLI_USE_COMPUTE_ADC === 'true') selectedType = 'compute-default-credentials';
    else if (env.GOOGLE_API_KEY || env.GOOGLE_GENAI_API_KEY) selectedType = 'gemini-api-key';
  }
  if (enforcedType && selectedType !== enforcedType) throw new Error('O método de autenticação selecionado não corresponde ao método exigido pela configuração nativa do Gemini CLI.');
  if (!selectedType) return { mode: 'none', configured: false, state: 'unauthenticated', message: 'Gemini CLI não autenticado. Faça login no Gemini CLI e selecione o método de autenticação desejado.' };
  if (selectedType === 'oauth-personal') {
    // If running in OAuth mode, ensure snap profile and launcher are preferred over bundled node_modules CLI
    let effectiveHome = home;
    if (snapLauncher && (cliPath?.split(path.sep).includes('node_modules') || !cliPath) && !env.GEMINI_CLI_HOME) {
      const snapHome = nativeCliHome(env, snapLauncher);
      if (snapHome && (fs.existsSync(path.join(snapHome, '.gemini', 'oauth_creds.json')) || fs.existsSync(path.join(snapHome, '.gemini', 'gemini-credentials.json')) || readSettings(path.join(snapHome, '.gemini', 'settings.json')).security?.auth?.selectedType === 'oauth-personal')) {
        effectiveHome = snapHome;
      }
    }
    const effectiveCli = (cliPath && !cliPath.includes('node_modules'))
      ? cliPath
      : (effectiveHome.includes('/snap/') || snapLauncher ? (snapLauncher || '/snap/bin/gemini') : cliPath);

    // Do not refresh, rewrite or migrate native credentials. Encrypted/keychain
    // credentials remain the CLI's responsibility and must never require a pool.
    let cached = false;
    if (env.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE !== 'true') {
      const credentialsPath = path.join(effectiveHome, '.gemini', 'oauth_creds.json');
      try {
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        cached = Boolean(credentials.refresh_token || (credentials.access_token && Number(credentials.expiry_date) > Date.now()));
      } catch { /* Native CLI reports invalid or unavailable credentials itself. */ }
    }
    if (!cached && fs.existsSync(path.join(effectiveHome, '.gemini', 'gemini-credentials.json'))) {
      cached = true;
    }
    return {
      mode: 'oauth',
      selectedType,
      nativeHome: effectiveHome,
      cliPath: effectiveCli,
      configured: true,
      state: cached ? 'authenticated' : 'configured',
      message: cached ? 'Google/OAuth autenticado no Gemini CLI (credenciais nativas em cache).' : 'Google/OAuth configurado no Gemini CLI; as credenciais nativas serão verificadas pelo executor.'
    };
  }
  if (selectedType === 'gemini-api-key') return { mode: 'api-key', selectedType, nativeHome: home, cliPath, configured: true, state: 'configured', message: 'Autenticação por API key configurada; Key Pool e credenciais nativas de API key são respeitados.' };
  return { mode: 'native', selectedType, nativeHome: home, cliPath, configured: true, state: 'configured', message: `Autenticação nativa do Gemini CLI configurada (${selectedType}).` };
}

export function resolveExecutionAuthentication(model: string, cwd?: string, excludedKeys: string[] = [], cliPath?: string) {
  const authentication = resolveCliAuthentication(cwd, process.env, cliPath);
  if (!authentication.configured) throw Object.assign(new Error(authentication.message), { code: 'AUTH_NOT_CONFIGURED' });
  const configuredPoolKeys = authentication.mode === 'api-key' ? loadConfiguredKeys() : {};
  const hasPoolKeys = Object.keys(configuredPoolKeys).length > 0;
  const candidate = authentication.mode === 'api-key' ? getBestEligibleKey(model, excludedKeys) : null;
  const apiKey = authentication.mode === 'api-key'
    ? (candidate?.key || (hasPoolKeys ? undefined : (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY)))
    : undefined;
  return { authentication, apiKey, keyId: candidate?.keyId };
}

export function buildCliAuthEnvironment(authentication: CliAuthentication, apiKey?: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...inherited };
  if (authentication.mode === 'oauth') {
    if (authentication.nativeHome) env.GEMINI_CLI_HOME = authentication.nativeHome;
    delete env.GEMINI_API_KEY;
    delete env.GOOGLE_API_KEY;
    delete env.GOOGLE_GENAI_API_KEY;
    delete env.GOOGLE_GENAI_USE_VERTEXAI;
    delete env.GEMINI_CLI_USE_COMPUTE_ADC;
    env.GOOGLE_GENAI_USE_GCA = 'true';
    env.NO_BROWSER = 'true';
    if (authentication.nativeHome && fs.existsSync(path.join(authentication.nativeHome, '.gemini', 'gemini-credentials.json'))) {
      env.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE = 'true';
    }
  } else if (authentication.mode === 'api-key') {
    delete env.GOOGLE_GENAI_USE_GCA;
    delete env.GOOGLE_GENAI_USE_VERTEXAI;
    delete env.GEMINI_CLI_USE_COMPUTE_ADC;
    delete env.GOOGLE_API_KEY;
    delete env.GOOGLE_GENAI_API_KEY;
    if (apiKey) {
      env.GEMINI_API_KEY = apiKey;
    }
  }
  return env;
}
