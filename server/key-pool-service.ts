import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GoogleGenAI } from '@google/genai';
import { sysLog } from './logger-service.js';

export type KeyGroup = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';

export interface KeyModelStatus {
  model: string;
  keyId: string; // 'K1'..'K9'
  dailyGroup: KeyGroup;
  dailyLatency: number;
  currentGroup: KeyGroup;
  currentLatency: number;
  latencyRank?: string; // 'L1', 'L2', 'L3'...
  overallRank?: number;
  lastError?: string;
  lastErrorAt?: string;
  lastSuccessAt?: string;
  consecutiveErrors: number;
  lastTestAt?: string;
  cycleDate: string; // 'YYYY-MM-DD'
  httpStatus?: number | null;
  errorCode?: string;
  errorType?: string;
}

export interface KeyPoolState {
  lastCycleDate: string;
  isTesting: boolean;
  items: Record<string, KeyModelStatus>; // Key: `${model}:${keyId}`
}

export interface ConfiguredKeyInfo {
  keyId: string;
  maskedKey: string;
  configured: boolean;
  lastSavedAt?: string;
}

export const OFFICIAL_POOL_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-3-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

const GROUP_PRIORITY: Record<KeyGroup, number> = {
  G1: 1, // Execução bem-sucedida
  G2: 2, // Indisponibilidade temporária / sobrecarga / 529
  G3: 3, // Rate limit / quota / demanda / 429
  G4: 4, // Erro temporário de serviço / outros 5xx
  G5: 5, // Autenticação, credencial, permissão / 4xx permanente
  G6: 6, // Modelo incompatível, erro estrutural ou configuração inválida
};

// Obter diretório padrão ~/.config/gemini-gui
export function getKeyPoolConfigDir(): string {
  const primary = path.join(os.homedir(), '.config', 'gemini-gui');
  if (!fs.existsSync(primary)) {
    try {
      fs.mkdirSync(primary, { recursive: true, mode: 0o700 });
    } catch {}
  }
  return primary;
}

export function getApiKeysEnvPath(): string {
  return path.join(getKeyPoolConfigDir(), 'api-keys.env');
}

export function getKeyPoolStatePath(): string {
  return path.join(getKeyPoolConfigDir(), 'key-pool-state.json');
}

// Utilitário de máscara estrita: nunca expõe a chave completa
export function maskApiKey(key?: string | null): string {
  if (!key || typeof key !== 'string' || !key.trim()) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '********';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-3)}`;
}

// 1. Armazenamento seguro de chaves K1..K9 em ~/.config/gemini-gui/api-keys.env (chmod 600)
export function loadConfiguredKeys(): Record<string, string> {
  const envPath = getApiKeysEnvPath();
  const keys: Record<string, string> = {};

  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^GEMINI_API_KEY_([1-9])\s*=\s*["']?(.*?)["']?$/);
        if (match) {
          const keyNum = match[1];
          const val = match[2]?.trim();
          if (val) {
            keys[`K${keyNum}`] = val;
          }
        }
      }
    } catch (err) {
      sysLog.warn('KPOOL', `Erro ao ler api-keys.env: ${err}`);
    }
  }

  // O Key Pool é a ÚNICA fonte de autenticação. Nenhum fallback para process.env.
  return keys;
}

export function saveConfiguredKeys(newKeys: Record<string, string | null | undefined>): { success: boolean; count: number } {
  const current = loadConfiguredKeys();
  const updated: Record<string, string> = { ...current };

  for (let i = 1; i <= 9; i++) {
    const keyId = `K${i}`;
    if (newKeys[keyId] !== undefined) {
      const val = newKeys[keyId]?.trim();
      if (!val) {
        delete updated[keyId];
      } else {
        updated[keyId] = val;
      }
    }
  }

  const envPath = getApiKeysEnvPath();
  const lines: string[] = [
    '# Gemini GUI - Key Pool Storage',
    '# Arquivo seguro gerado automaticamente (chmod 600)',
    '# Não compartilhe este arquivo.',
    '',
  ];

  for (let i = 1; i <= 9; i++) {
    const keyId = `K${i}`;
    if (updated[keyId]) {
      lines.push(`GEMINI_API_KEY_${i}="${updated[keyId]}"`);
    }
  }

  lines.push('');

  try {
    fs.writeFileSync(envPath, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(envPath, 0o600);
    } catch {}

    sysLog.info('KPOOL', `Chaves do Key Pool salvas com segurança em api-keys.env (${Object.keys(updated).length} chaves ativas).`);
    return { success: true, count: Object.keys(updated).length };
  } catch (err: any) {
    sysLog.error('KPOOL', `Falha ao salvar api-keys.env: ${err.message}`);
    throw err;
  }
}

export interface ExternalKeyDetection {
  hasExternalKey: boolean;
  source?: string;
  maskedKey?: string;
  rawKey?: string;
}

export interface ExternalKeyPublicStatus {
  hasExternalKey: boolean;
  source?: string;
  maskedKey?: string;
  isMigrated: boolean;
}

// Inspecionar se existe alguma chave externa configurada em arquivos ou process.env
export function detectExternalApiKey(): ExternalKeyDetection {
  const currentPoolKeys = loadConfiguredKeys();
  const envVarKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;

  if (envVarKey && envVarKey.trim().length >= 20) {
    return {
      hasExternalKey: true,
      source: 'Variável de Ambiente (process.env)',
      maskedKey: maskApiKey(envVarKey),
      rawKey: envVarKey.trim(),
    };
  }

  const candidateFiles = [
    path.join(process.cwd(), '.env'),
    path.join(os.homedir(), '.local', 'share', 'gemini-gui', '.env'),
    path.join(os.homedir(), '.local', 'share', 'gemini-gui', 'env'),
    path.join(os.homedir(), '.gemini', '.env'),
    path.join(os.homedir(), '.bashrc'),
    path.join(os.homedir(), '.profile'),
    path.join(os.homedir(), '.bash_profile'),
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.zprofile'),
    '/opt/gemini-gui/.env',
  ];

  const envRegex = /^\s*(?:export\s+)?(?:GEMINI_API_KEY|GOOGLE_GENAI_API_KEY|GOOGLE_API_KEY)\s*=\s*(?:["']?)([0-9A-Za-z-_./]{20,})(?:["']?)\s*$/m;

  for (const filePath of candidateFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const match = content.match(envRegex);
        if (match && match[1]) {
          const key = match[1].trim();
          return {
            hasExternalKey: true,
            source: filePath,
            maskedKey: maskApiKey(key),
            rawKey: key,
          };
        }
      } catch {}
    }
  }

  return { hasExternalKey: false };
}

export function getPublicExternalKeyStatus(): ExternalKeyPublicStatus {
  const detection = detectExternalApiKey();
  const poolKeys = loadConfiguredKeys();
  const isMigrated = !detection.hasExternalKey && Object.keys(poolKeys).length > 0;

  return {
    hasExternalKey: detection.hasExternalKey,
    source: detection.source,
    maskedKey: detection.maskedKey,
    isMigrated,
  };
}

export function migrateExternalApiKeyToK1(): {
  success: boolean;
  migratedKeyMasked: string;
  sourcesCleaned: string[];
} {
  const detection = detectExternalApiKey();
  const rawKeyToMigrate = detection.rawKey;

  if (!rawKeyToMigrate) {
    throw new Error('Nenhuma chave GEMINI_API_KEY externa detectada para migração.');
  }

  // 1. Salvar no Key Pool como K1 em ~/.config/gemini-gui/api-keys.env (chmod 600)
  const currentKeys = loadConfiguredKeys();
  currentKeys['K1'] = rawKeyToMigrate;
  saveConfiguredKeys(currentKeys);

  // 2. Limpar referências externas e persistentes
  const sourcesCleaned: string[] = [];

  const candidateFiles = [
    path.join(process.cwd(), '.env'),
    path.join(os.homedir(), '.local', 'share', 'gemini-gui', '.env'),
    path.join(os.homedir(), '.local', 'share', 'gemini-gui', 'env'),
    path.join(os.homedir(), '.gemini', '.env'),
    path.join(os.homedir(), '.bashrc'),
    path.join(os.homedir(), '.profile'),
    path.join(os.homedir(), '.bash_profile'),
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.zprofile'),
    '/opt/gemini-gui/.env',
  ];

  const envLineRegex = /^\s*(?:export\s+)?(?:GEMINI_API_KEY|GOOGLE_GENAI_API_KEY|GOOGLE_API_KEY)\s*=.*$/gm;

  for (const filePath of candidateFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (envLineRegex.test(content)) {
          const cleaned = content.replace(envLineRegex, '').trim();
          fs.writeFileSync(filePath, cleaned ? cleaned + '\n' : '', 'utf8');
          sourcesCleaned.push(filePath);
        }
      } catch {}
    }
  }

  // 3. Remover do ambiente global do processo Node.js
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_GENAI_API_KEY;
  delete process.env.GOOGLE_API_KEY;

  sysLog.info(
    'KPOOL',
    `Migração de GEMINI_API_KEY para K1 concluída com sucesso. Origens limpas: ${sourcesCleaned.join(', ') || 'process.env'}.`
  );

  return {
    success: true,
    migratedKeyMasked: maskApiKey(rawKeyToMigrate),
    sourcesCleaned,
  };
}

export function getConfiguredKeysPublicInfo(): Record<string, ConfiguredKeyInfo> {
  const keys = loadConfiguredKeys();
  const result: Record<string, ConfiguredKeyInfo> = {};

  for (let i = 1; i <= 9; i++) {
    const keyId = `K${i}`;
    const rawVal = keys[keyId];
    result[keyId] = {
      keyId,
      configured: !!rawVal && rawVal.length > 0,
      maskedKey: maskApiKey(rawVal),
    };
  }

  return result;
}

// 2. Normalização e Classificação Central de Erros (G1..G6)
export function classifyKeyResult(
  httpStatus: number | null | undefined,
  errorCode: string | null | undefined,
  errorText = ''
): { group: KeyGroup; errorCode: string; errorType: string } {
  const text = (errorText || '').toLowerCase();
  const status = httpStatus || null;

  // 0. Execução bem-sucedida -> G1
  if (status === 200 || (!status && (!text || text === 'ok' || text === '200_ok' || text === 'success'))) {
    return { group: 'G1', errorCode: '200_OK', errorType: 'Operacional' };
  }

  // 1. Verificação de Sobrecarga / 529 / Alta Demanda -> G2
  if (
    status === 529 ||
    text.includes('529') ||
    text.includes('model overloaded') ||
    text.includes('temporarily overloaded') ||
    text.includes('overloaded') ||
    text.includes('high demand') ||
    text.includes('service unavailable') && text.includes('overload')
  ) {
    return { group: 'G2', errorCode: '529_OVERLOAD', errorType: 'Sobrecarga Temporária' };
  }

  // 2. Verificação de Rate Limit / Quota / 429 -> G3
  if (
    status === 429 ||
    text.includes('429') ||
    text.includes('rate limit') ||
    text.includes('quota exceeded') ||
    text.includes('resource_exhausted') ||
    text.includes('terminalquotaerror') ||
    text.includes('tokens_per_model') ||
    text.includes('requests_per_minute')
  ) {
    return { group: 'G3', errorCode: '429_QUOTA', errorType: 'Limite de Cota / Rate Limit' };
  }

  // 3. Verificação de Erro Temporário de Serviço / 5xx -> G4
  if (
    (status && status >= 500 && status <= 599) ||
    text.includes('500') ||
    text.includes('502') ||
    text.includes('503') ||
    text.includes('504') ||
    text.includes('internal server error') ||
    text.includes('bad gateway') ||
    text.includes('service unavailable')
  ) {
    return { group: 'G4', errorCode: status ? `${status}_SERVER_ERROR` : '5XX_SERVER_ERROR', errorType: 'Erro de Servidor (5xx)' };
  }

  // 4. Verificação de Autenticação / Permissão / 401 / 403 / API_KEY_INVALID -> G5
  if (
    status === 401 ||
    status === 403 ||
    text.includes('401') ||
    text.includes('403') ||
    text.includes('api_key_invalid') ||
    text.includes('api key not valid') ||
    text.includes('invalid api key') ||
    text.includes('key not valid') ||
    text.includes('unauthenticated') ||
    text.includes('permission_denied') ||
    text.includes('forbidden') ||
    text.includes('credential')
  ) {
    return { group: 'G5', errorCode: status ? `${status}_AUTH` : 'AUTH_ERROR', errorType: 'Falha de Autenticação / Permissão' };
  }

  // 5. Modelo Incompatível / Parâmetros Inválidos / 400 -> G6
  if (
    status === 400 ||
    status === 404 ||
    text.includes('400') ||
    text.includes('invalid_argument') ||
    text.includes('invalid argument') ||
    text.includes('not found') ||
    text.includes('unsupported') ||
    text.includes('not supported')
  ) {
    return { group: 'G6', errorCode: status ? `${status}_INCOMPATIBLE` : 'INCOMPATIBLE_CONFIG', errorType: 'Modelo ou Configuração Incompatível' };
  }

  // Se houver algum erro não categorizado
  if (text.length > 0) {
    return { group: 'G4', errorCode: 'GENERIC_FAILURE', errorType: 'Falha Operacional Genérica' };
  }

  return { group: 'G1', errorCode: '200_OK', errorType: 'Operacional' };
}

// 3. Persistência do Estado do Ranking (key-pool-state.json)
let inMemoryState: KeyPoolState | null = null;
let isBatteryTesting = false;

export function loadKeyPoolState(): KeyPoolState {
  if (inMemoryState) return inMemoryState;
  const statePath = getKeyPoolStatePath();

  if (fs.existsSync(statePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      inMemoryState = {
        lastCycleDate: data.lastCycleDate || '',
        isTesting: false,
        items: data.items || {},
      };
      return inMemoryState;
    } catch (err) {
      sysLog.warn('KPOOL', `Erro ao ler key-pool-state.json: ${err}`);
    }
  }

  inMemoryState = {
    lastCycleDate: '',
    isTesting: false,
    items: {},
  };
  return inMemoryState;
}

export function saveKeyPoolState(state: KeyPoolState) {
  inMemoryState = state;
  const statePath = getKeyPoolStatePath();
  const tmpPath = `${statePath}.tmp.${Date.now()}`;

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, statePath);
  } catch (err) {
    try {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
    } catch {}
  }
}

// 4. Teste Real de Chave × Modelo
async function testSingleKeyModel(
  model: string,
  keyId: string,
  rawKey: string,
  cycleDate: string
): Promise<KeyModelStatus> {
  const start = Date.now();
  sysLog.info('KPOOL', `[KPOOL_TEST] model=${model} key=${keyId} START`);
  let latencyMs = 0;
  let httpStatus: number | null = 200;
  let errorText = '';
  let errorCode = '200_OK';
  let errorType = 'Operacional';
  let group: KeyGroup = 'G1';

  try {
    const ai = new GoogleGenAI({
      apiKey: rawKey,
      httpOptions: {
        timeout: 15000,
        headers: {
          'User-Agent': 'gemini-gui-keypool/2.0',
        },
      },
    });

    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: 'ping' }] }],
      config: {
        maxOutputTokens: 2,
        temperature: 0.1,
      },
    });

    latencyMs = Date.now() - start;
    const text = response.text || '';
    if (!text && !response.candidates?.[0]) {
      throw new Error('Resposta vazia da API do Gemini.');
    }

    group = 'G1';
    sysLog.info('KPOOL', `[KPOOL_TEST] model=${model} key=${keyId} RESULT status=200 group=G1 latency=${latencyMs}ms`);
  } catch (err: any) {
    latencyMs = Date.now() - start;
    errorText = err.message || String(err);
    httpStatus = err.status || err.httpStatus || (errorText.match(/status:?\s*(\d{3})/i) ? parseInt(errorText.match(/status:?\s*(\d{3})/i)![1], 10) : null);

    const classified = classifyKeyResult(httpStatus, null, errorText);
    group = classified.group;
    errorCode = classified.errorCode;
    errorType = classified.errorType;

    sysLog.warn('KPOOL', `[KPOOL_TEST] model=${model} key=${keyId} RESULT status=${httpStatus || errorCode} group=${group} latency=${latencyMs}ms error="${errorText.slice(0, 100)}"`);
  }

  const now = new Date().toISOString();

  return {
    model,
    keyId,
    dailyGroup: group,
    dailyLatency: latencyMs,
    currentGroup: group,
    currentLatency: latencyMs,
    lastTestAt: now,
    lastSuccessAt: group === 'G1' ? now : undefined,
    lastError: group !== 'G1' ? errorText : undefined,
    lastErrorAt: group !== 'G1' ? now : undefined,
    consecutiveErrors: group !== 'G1' ? 1 : 0,
    cycleDate,
    httpStatus,
    errorCode,
    errorType,
  };
}

// 5. Execução da Bateria de Testes Diária
export async function runDailyTestBattery(forceRefresh = false): Promise<{
  success: boolean;
  cycleDate: string;
  totalTested: number;
  results: KeyModelStatus[];
}> {
  if (isBatteryTesting) {
    sysLog.warn('KPOOL', '[KPOOL] Bateria de testes já em andamento. Aguardando...');
    const state = loadKeyPoolState();
    return {
      success: true,
      cycleDate: state.lastCycleDate,
      totalTested: Object.keys(state.items).length,
      results: Object.values(state.items),
    };
  }

  isBatteryTesting = true;
  const state = loadKeyPoolState();
  const todayStr = new Date().toISOString().split('T')[0];

  if (!forceRefresh && state.lastCycleDate === todayStr && Object.keys(state.items).length > 0) {
    isBatteryTesting = false;
    return {
      success: true,
      cycleDate: state.lastCycleDate,
      totalTested: Object.keys(state.items).length,
      results: Object.values(state.items),
    };
  }

  sysLog.info('KPOOL', `[KPOOL] Ciclo diário iniciado (${todayStr})`);
  const configuredKeys = loadConfiguredKeys();
  const activeKeyIds = Object.keys(configuredKeys).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  if (activeKeyIds.length === 0) {
    isBatteryTesting = false;
    state.lastCycleDate = todayStr;
    saveKeyPoolState(state);
    return { success: true, cycleDate: todayStr, totalTested: 0, results: [] };
  }

  const testResults: KeyModelStatus[] = [];

  for (const model of OFFICIAL_POOL_MODELS) {
    for (const keyId of activeKeyIds) {
      const rawKey = configuredKeys[keyId];
      if (!rawKey) continue;

      const itemKey = `${model}:${keyId}`;
      const status = await testSingleKeyModel(model, keyId, rawKey, todayStr);
      state.items[itemKey] = status;
      testResults.push(status);
    }
  }

  state.lastCycleDate = todayStr;
  state.isTesting = false;
  isBatteryTesting = false;
  saveKeyPoolState(state);

  sysLog.info('KPOOL', `[KPOOL] Ciclo diário concluído com sucesso (${testResults.length} combinações testadas).`);
  return {
    success: true,
    cycleDate: todayStr,
    totalTested: testResults.length,
    results: testResults,
  };
}

// 6. Obtenção do Ranking Ordenado por Modelo (getRankedKeys)
export function getRankedKeys(model: string): Array<{
  keyId: string;
  key: string;
  group: KeyGroup;
  latency: number | null;
  latencyRank: string;
  overallRank: number;
  status: KeyModelStatus;
  isTested: boolean;
}> {
  const configuredKeys = loadConfiguredKeys();
  const state = loadKeyPoolState();
  const activeKeyIds = Object.keys(configuredKeys).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  const candidates: Array<{
    keyId: string;
    key: string;
    group: KeyGroup;
    latency: number | null;
    isTested: boolean;
    status: KeyModelStatus;
  }> = [];

  for (const keyId of activeKeyIds) {
    const rawKey = configuredKeys[keyId];
    if (!rawKey) continue;

    const itemKey = `${model}:${keyId}`;
    const savedStatus = state.items[itemKey];
    const isTested = Boolean(savedStatus && savedStatus.lastTestAt);

    if (savedStatus && isTested) {
      candidates.push({
        keyId,
        key: rawKey,
        group: savedStatus.currentGroup || savedStatus.dailyGroup || 'G1',
        latency: savedStatus.currentLatency ?? savedStatus.dailyLatency ?? null,
        isTested: true,
        status: savedStatus,
      });
    } else {
      const unclassifiedStatus: KeyModelStatus = {
        model,
        keyId,
        dailyGroup: 'G1',
        dailyLatency: 0,
        currentGroup: 'G1',
        currentLatency: 0,
        consecutiveErrors: 0,
        cycleDate: state.lastCycleDate || new Date().toISOString().split('T')[0],
      };
      candidates.push({
        keyId,
        key: rawKey,
        group: 'G1',
        latency: null,
        isTested: false,
        status: unclassifiedStatus,
      });
    }
  }

  // Ordenação Estrita (Regras 7, 8, 9):
  // 1. Chaves testadas com G1 vêm primeiro.
  // 2. Chaves não-testadas (sem classificação) vêm em seguida, antes de chaves com erro (G2..G6).
  // 3. Chaves com erro (G2..G6) são ordenadas por prioridade do grupo (G2 < G3 < G4 < G5 < G6).
  // 4. Dentro do mesmo grupo testado (ex: G1 com G1): ordena por latência real em ms (ascendente).
  // 5. Desempate / Ordem de não-testadas: Ordem numérica do slot K1 < K2 < K3 < ... < K9.
  candidates.sort((a, b) => {
    const priority = (item: typeof a) => {
      if (!item.isTested) return 1.5; // Fica entre G1 (1.0) e G2 (2.0)
      return GROUP_PRIORITY[item.group] ?? 99;
    };

    const pA = priority(a);
    const pB = priority(b);
    if (pA !== pB) return pA - pB;

    if (a.isTested && b.isTested && a.latency !== null && b.latency !== null) {
      if (a.latency !== b.latency) return a.latency - b.latency;
    }

    return a.keyId.localeCompare(b.keyId, undefined, { numeric: true });
  });

  const groupCounts: Record<string, number> = {};
  return candidates.map((item, index) => {
    if (item.isTested) {
      groupCounts[item.group] = (groupCounts[item.group] || 0) + 1;
      item.status.latencyRank = `L${groupCounts[item.group]}`;
    } else {
      item.status.latencyRank = '-';
    }
    item.status.overallRank = index + 1;

    return {
      keyId: item.keyId,
      key: item.key,
      group: item.group,
      latency: item.latency,
      latencyRank: item.status.latencyRank,
      overallRank: index + 1,
      status: item.status,
      isTested: item.isTested,
    };
  });
}

// 7. Seleção da Melhor Chave Elegível (Key Pool)
export function getBestEligibleKey(
  model: string,
  excludedKeyIds: string[] = []
): {
  keyId: string;
  key: string;
  group: KeyGroup;
  latencyRank: string;
  status: KeyModelStatus;
} | null {
  const ranked = getRankedKeys(model);
  const eligible = ranked.filter((k) => !excludedKeyIds.includes(k.keyId));

  if (eligible.length === 0) return null;
  return eligible[0];
}

// 8. Atualização Operacional Após Execução Real
export function recordRuntimeExecutionResult(
  model: string,
  keyId: string,
  result: {
    success: boolean;
    latencyMs?: number;
    httpStatus?: number | null;
    errorText?: string;
  }
) {
  const state = loadKeyPoolState();
  const itemKey = `${model}:${keyId}`;
  const now = new Date().toISOString();

  let current = state.items[itemKey];
  if (!current) {
    current = {
      model,
      keyId,
      dailyGroup: 'G1',
      dailyLatency: result.latencyMs || 500,
      currentGroup: 'G1',
      currentLatency: result.latencyMs || 500,
      consecutiveErrors: 0,
      cycleDate: state.lastCycleDate || now.split('T')[0],
    };
  }

  if (result.success) {
    current.currentGroup = 'G1';
    current.consecutiveErrors = 0;
    current.lastSuccessAt = now;
    if (result.latencyMs) current.currentLatency = result.latencyMs;
    current.httpStatus = 200;
  } else {
    const classified = classifyKeyResult(result.httpStatus, null, result.errorText);
    current.currentGroup = classified.group;
    current.consecutiveErrors = (current.consecutiveErrors || 0) + 1;
    current.lastError = result.errorText || classified.errorType;
    current.lastErrorAt = now;
    current.httpStatus = result.httpStatus;
    current.errorCode = classified.errorCode;
    current.errorType = classified.errorType;

    sysLog.warn(
      'KPOOL',
      `[KPOOL] execução real ${model} / ${keyId} → ${result.httpStatus || classified.errorCode} / reclassificado ${classified.group}`
    );
  }

  state.items[itemKey] = current;
  saveKeyPoolState(state);
}
