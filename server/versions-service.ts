import path from 'node:path';
import fs from 'node:fs';
import { getGuiGeminiDir } from './paths-service.js';

export interface VersionItem {
  id: string;
  versionNumber: number;
  createdAt: string;
  prompt: string;
  agentName: string;
  model: string;
  executionId: string;
  projectId?: string;
  workspaceDir: string;
  changedFiles: string[];
  snapshotDirName: string;
  isBackup?: boolean;
}

export interface FileDiffResult {
  filePath: string;
  status: 'added' | 'modified' | 'deleted';
  originalContent: string;
  versionContent: string;
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '.cache',
  'build',
  'coverage',
  '.turbo',
  'tmp',
]);

const getVersionsFile = () => path.join(getGuiGeminiDir(), 'versions.json');
const getSnapshotsBaseDir = () => {
  const dir = path.join(getGuiGeminiDir(), 'snapshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

export function loadVersions(): VersionItem[] {
  const file = getVersionsFile();
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Erro ao ler versions.json:', err);
    return [];
  }
}

function saveVersions(versions: VersionItem[]): void {
  const file = getVersionsFile();
  try {
    fs.writeFileSync(file, JSON.stringify(versions, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar versions.json:', err);
  }
}

/**
 * Normaliza e valida caminhos para prevenir directory traversal.
 */
function isPathSafe(baseDir: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase);
}

/**
 * Cria snapshot incremental dos arquivos informados.
 */
export async function createVersionSnapshot(params: {
  prompt: string;
  agentName: string;
  model: string;
  executionId: string;
  workspaceDir: string;
  projectId?: string;
  changedFiles: string[];
  isBackup?: boolean;
}): Promise<VersionItem | null> {
  const { prompt, agentName, model, executionId, workspaceDir, projectId, changedFiles, isBackup } = params;

  if (!changedFiles || changedFiles.length === 0) {
    return null;
  }

  const versions = loadVersions();
  const projectVersions = versions.filter(
    (v) => (projectId && v.projectId === projectId) || v.workspaceDir === workspaceDir
  );
  const versionNumber = projectVersions.length + 1;

  const versionId = `ver_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const snapshotDirName = `snapshot_${versionId}`;
  const targetSnapshotDir = path.join(getSnapshotsBaseDir(), snapshotDirName);
  fs.mkdirSync(targetSnapshotDir, { recursive: true });

  const recordedFiles: string[] = [];

  for (const relPath of changedFiles) {
    const cleanRel = relPath.replace(/^\/+/, '');
    const firstSegment = cleanRel.split('/')[0];
    if (IGNORED_DIRS.has(firstSegment)) continue;

    const sourcePath = path.join(workspaceDir, cleanRel);
    if (!isPathSafe(workspaceDir, sourcePath)) continue;

    if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()) {
      const destPath = path.join(targetSnapshotDir, cleanRel);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(sourcePath, destPath);
      recordedFiles.push(cleanRel);
    }
  }

  if (recordedFiles.length === 0 && !isBackup) {
    try {
      fs.rmSync(targetSnapshotDir, { recursive: true, force: true });
    } catch {}
    return null;
  }

  const newVersion: VersionItem = {
    id: versionId,
    versionNumber,
    createdAt: new Date().toISOString(),
    prompt: prompt || 'Snapshot automático de execução',
    agentName: agentName || 'Agente',
    model: model || 'gemini',
    executionId: executionId || versionId,
    projectId,
    workspaceDir,
    changedFiles: recordedFiles,
    snapshotDirName,
    isBackup: Boolean(isBackup),
  };

  versions.unshift(newVersion);
  saveVersions(versions);
  return newVersion;
}

/**
 * Lista versões filtrando por workspace/projeto.
 */
export function listVersions(projectId?: string, workspaceDir?: string): VersionItem[] {
  const versions = loadVersions();
  if (projectId) {
    return versions.filter((v) => v.projectId === projectId);
  }
  if (workspaceDir) {
    return versions.filter((v) => v.workspaceDir === workspaceDir);
  }
  return versions;
}

/**
 * Obtém detalhes de uma versão específica.
 */
export function getVersion(id: string): VersionItem | null {
  const versions = loadVersions();
  return versions.find((v) => v.id === id) || null;
}

/**
 * Deleta versão e diretório de snapshot.
 */
export function deleteVersion(id: string): boolean {
  const versions = loadVersions();
  const target = versions.find((v) => v.id === id);
  if (!target) return false;

  const snapshotDir = path.join(getSnapshotsBaseDir(), target.snapshotDirName);
  if (fs.existsSync(snapshotDir)) {
    try {
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Falha ao remover snapshot:', err);
    }
  }

  const filtered = versions.filter((v) => v.id !== id);
  saveVersions(filtered);
  return true;
}

/**
 * Restaura arquivos de uma versão criando antes um backup automático do estado corrente.
 */
export async function restoreVersion(id: string, workspaceDir: string): Promise<{ success: boolean; backupVersionId?: string; message: string }> {
  const target = getVersion(id);
  if (!target) {
    return { success: false, message: 'Versão não encontrada' };
  }

  if (!isPathSafe(workspaceDir, workspaceDir)) {
    return { success: false, message: 'Diretório de workspace inválido' };
  }

  const snapshotDir = path.join(getSnapshotsBaseDir(), target.snapshotDirName);
  if (!fs.existsSync(snapshotDir)) {
    return { success: false, message: 'Arquivos do snapshot não encontrados no disco' };
  }

  // 1. Criar backup automático pré-restauração dos arquivos que serão modificados
  const backup = await createVersionSnapshot({
    prompt: `[Backup Automático] Pré-restauração da v${target.versionNumber}`,
    agentName: 'Sistema',
    model: 'local',
    executionId: `restore_backup_${Date.now()}`,
    workspaceDir,
    projectId: target.projectId,
    changedFiles: target.changedFiles,
    isBackup: true,
  });

  // 2. Copiar arquivos do snapshot para o workspace de forma segura
  for (const relFile of target.changedFiles) {
    const src = path.join(snapshotDir, relFile);
    const dest = path.join(workspaceDir, relFile);

    if (!isPathSafe(workspaceDir, dest)) continue;

    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  return {
    success: true,
    backupVersionId: backup?.id,
    message: `Versão v${target.versionNumber} restaurada com sucesso. Backup automático criado.`,
  };
}

/**
 * Gera diff legível entre arquivos do snapshot e o workspace atual.
 */
export function getVersionDiff(id: string, workspaceDir: string): FileDiffResult[] {
  const target = getVersion(id);
  if (!target) return [];

  const snapshotDir = path.join(getSnapshotsBaseDir(), target.snapshotDirName);
  const results: FileDiffResult[] = [];

  for (const relFile of target.changedFiles) {
    const snapshotFile = path.join(snapshotDir, relFile);
    const currentFile = path.join(workspaceDir, relFile);

    const versionContent = fs.existsSync(snapshotFile) ? fs.readFileSync(snapshotFile, 'utf-8') : '';
    const originalContent = fs.existsSync(currentFile) ? fs.readFileSync(currentFile, 'utf-8') : '';

    let status: 'added' | 'modified' | 'deleted' = 'modified';
    if (!fs.existsSync(currentFile) && fs.existsSync(snapshotFile)) {
      status = 'added';
    } else if (fs.existsSync(currentFile) && !fs.existsSync(snapshotFile)) {
      status = 'deleted';
    }

    results.push({
      filePath: relFile,
      status,
      originalContent,
      versionContent,
    });
  }

  return results;
}
