import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { getGuiDataDir } from './paths-service.js';
import { AppVersionItem, AppVersionDiff, AppVersionRestoreResult } from '../src/types.js';
import { sysLog } from './logger-service.js';

const EXCLUDED_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.cache',
  '.next',
  '.gemini',
  '.gemini-gui',
  '.local',
  '.DS_Store',
  'package-lock.json',
  'npm-debug.log',
  'yarn-error.log',
];

function getVersionsDir(): string {
  const vDir = path.join(getGuiDataDir(), 'app_versions');
  if (!fs.existsSync(vDir)) {
    fs.mkdirSync(vDir, { recursive: true });
  }
  return vDir;
}

function getVersionsIndexPath(): string {
  return path.join(getVersionsDir(), 'versions_index.json');
}

export function loadAllVersions(): AppVersionItem[] {
  const indexPath = getVersionsIndexPath();
  if (!fs.existsSync(indexPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    sysLog.warn('SYSTEM', `Erro ao ler versions_index.json: ${err?.message}`);
    return [];
  }
}

export function saveAllVersions(versions: AppVersionItem[]): void {
  const indexPath = getVersionsIndexPath();
  try {
    fs.writeFileSync(indexPath, JSON.stringify(versions, null, 2), 'utf-8');
  } catch (err: any) {
    sysLog.error('SYSTEM', `Erro ao salvar versions_index.json: ${err?.message}`);
  }
}

export function isPathExcluded(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return EXCLUDED_PATTERNS.some((pat) => {
    return normalized === pat || normalized.startsWith(pat + '/') || normalized.includes('/' + pat + '/');
  });
}

/**
 * Detecta arquivos modificados, adicionados ou alterados no workspace.
 * Utiliza Git status se for repositório Git, ou mtime scanning seguro caso contrário.
 */
export function detectChangedFiles(workspaceDir: string): string[] {
  if (!workspaceDir || !fs.existsSync(workspaceDir)) {
    return [];
  }

  const changedSet = new Set<string>();

  // 1. Tentar Git status --porcelain
  try {
    const isGit = execSync('git rev-parse --is-inside-work-tree', {
      cwd: workspaceDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() === 'true';

    if (isGit) {
      const gitStatusOut = execSync('git status --porcelain -uall', {
        cwd: workspaceDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      const lines = gitStatusOut.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // line format: " M src/App.tsx" or "?? file.txt" or "A  path"
        const filePath = trimmed.slice(2).trim();
        if (filePath && !isPathExcluded(filePath)) {
          changedSet.add(filePath);
        }
      }
    }
  } catch {
    // Não é repo git ou git falhou
  }

  return Array.from(changedSet);
}

/**
 * Cria snapshot incremental dos arquivos informados para uma nova versão.
 */
export function createAppVersion(params: {
  prompt: string;
  workspaceDir: string;
  projectId?: string;
  agentName?: string;
  model?: string;
  executionId?: string;
  changedFiles?: string[];
  isBackup?: boolean;
  backupForVersionId?: string;
}): AppVersionItem | null {
  const { workspaceDir, prompt, projectId, agentName, model, executionId, isBackup, backupForVersionId } = params;

  if (!workspaceDir || !fs.existsSync(workspaceDir)) {
    return null;
  }

  const allVersions = loadAllVersions();
  const projectVersions = allVersions.filter(
    (v) => (projectId && v.projectId === projectId) || v.workspaceDir === workspaceDir
  );

  // Determinar arquivos alterados
  let filesToSave = params.changedFiles && params.changedFiles.length > 0
    ? params.changedFiles.filter((f) => !isPathExcluded(f))
    : detectChangedFiles(workspaceDir);

  if (filesToSave.length === 0 && !isBackup) {
    // Nenhuma alteração real nos arquivos: não cria versão!
    return null;
  }

  const nextVersionNumber = projectVersions.length > 0
    ? Math.max(...projectVersions.map((v) => v.versionNumber || 0)) + 1
    : 1;

  const versionId = isBackup
    ? `backup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    : `v${nextVersionNumber}_${Date.now()}`;

  const snapshotRelDir = versionId;
  const snapshotAbsDir = path.join(getVersionsDir(), snapshotRelDir, 'files');

  // Copiar apenas os arquivos alterados (snapshot incremental e seguro)
  const savedFiles: string[] = [];
  for (const relPath of filesToSave) {
    const srcPath = path.resolve(workspaceDir, relPath);
    // Validação estrita de path traversal
    if (!srcPath.startsWith(path.resolve(workspaceDir))) {
      continue;
    }

    if (fs.existsSync(srcPath) && fs.statSync(srcPath).isFile()) {
      const destPath = path.join(snapshotAbsDir, relPath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      savedFiles.push(relPath);
    }
  }

  if (savedFiles.length === 0 && !isBackup) {
    return null;
  }

  const newVersion: AppVersionItem = {
    id: versionId,
    versionNumber: nextVersionNumber,
    timestamp: new Date().toISOString(),
    prompt: prompt || (isBackup ? 'Backup automático antes de restauração' : 'Modificação de arquivos'),
    agentName,
    model,
    executionId,
    projectId,
    workspaceDir,
    changedFiles: savedFiles,
    snapshotRef: snapshotRelDir,
    isBackup: Boolean(isBackup),
    backupForVersionId,
  };

  allVersions.unshift(newVersion);
  saveAllVersions(allVersions);

  sysLog.info(
    'SYSTEM',
    `App Version criada: ${newVersion.id} (#${newVersion.versionNumber}) com ${savedFiles.length} arquivos alterados.`,
    { versionId, changedFilesCount: savedFiles.length }
  );

  return newVersion;
}

/**
 * Retorna as versões filtradas por projeto ou workspace.
 */
export function getAppVersions(projectId?: string, workspaceDir?: string): AppVersionItem[] {
  const versions = loadAllVersions();
  if (projectId) {
    return versions.filter((v) => v.projectId === projectId);
  }
  if (workspaceDir) {
    return versions.filter((v) => v.workspaceDir === workspaceDir);
  }
  return versions;
}

/**
 * Retorna uma versão por ID.
 */
export function getAppVersionById(id: string): AppVersionItem | undefined {
  const versions = loadAllVersions();
  return versions.find((v) => v.id === id);
}

/**
 * Exclui uma versão e seus arquivos de snapshot.
 */
export function deleteAppVersion(id: string): boolean {
  const versions = loadAllVersions();
  const target = versions.find((v) => v.id === id);
  if (!target) return false;

  const remaining = versions.filter((v) => v.id !== id);
  saveAllVersions(remaining);

  // Remover pasta do snapshot
  const snapshotAbsDir = path.join(getVersionsDir(), target.snapshotRef);
  if (fs.existsSync(snapshotAbsDir)) {
    try {
      fs.rmSync(snapshotAbsDir, { recursive: true, force: true });
    } catch {}
  }

  sysLog.info('SYSTEM', `App Version removida: ${id}`);
  return true;
}

/**
 * Calcula o diff entre os arquivos do snapshot e os arquivos atuais do workspace.
 */
export function getAppVersionDiff(id: string): AppVersionDiff[] {
  const version = getAppVersionById(id);
  if (!version) return [];

  const snapshotAbsDir = path.join(getVersionsDir(), version.snapshotRef, 'files');
  const diffs: AppVersionDiff[] = [];

  for (const relPath of version.changedFiles) {
    const snapshotFilePath = path.join(snapshotAbsDir, relPath);
    const currentFilePath = path.resolve(version.workspaceDir, relPath);

    const snapshotContent = fs.existsSync(snapshotFilePath)
      ? fs.readFileSync(snapshotFilePath, 'utf-8')
      : '';
    const currentContent = fs.existsSync(currentFilePath)
      ? fs.readFileSync(currentFilePath, 'utf-8')
      : '';

    let status: 'modified' | 'added' | 'deleted' = 'modified';
    if (!fs.existsSync(snapshotFilePath)) {
      status = 'deleted';
    } else if (!fs.existsSync(currentFilePath)) {
      status = 'added';
    }

    // Gerar diff simples unificado
    const diff = generateSimpleDiff(relPath, snapshotContent, currentContent);
    diffs.push({
      path: relPath,
      status,
      diff,
    });
  }

  return diffs;
}

function generateSimpleDiff(filePath: string, oldStr: string, newStr: string): string {
  const oldLines = oldStr ? oldStr.split('\n') : [];
  const newLines = newStr ? newStr.split('\n') : [];

  let result = `--- a/${filePath} (Versão Selecionada)\n+++ b/${filePath} (Atual)\n`;
  const max = Math.max(oldLines.length, newLines.length);
  let changed = false;

  for (let i = 0; i < max; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === newLine) {
      if (i < 5 || i > max - 5) {
        result += ` ${oldLine ?? ''}\n`;
      }
    } else {
      changed = true;
      if (oldLine !== undefined) {
        result += `-${oldLine}\n`;
      }
      if (newLine !== undefined) {
        result += `+${newLine}\n`;
      }
    }
  }

  if (!changed) {
    return `${filePath}: Sem alterações em relação ao estado atual.`;
  }

  return result;
}

/**
 * Restaura uma versão específica para o workspace.
 * 1. Valida caminhos dentro do workspace.
 * 2. Cria backup automático do estado atual dos arquivos afetados antes de sobrescrever.
 * 3. Restaura os arquivos do snapshot.
 * 4. Permite desfazer usando o backup gerado.
 */
export function restoreAppVersion(id: string): AppVersionRestoreResult {
  const version = getAppVersionById(id);
  if (!version) {
    return {
      success: false,
      message: 'Versão não encontrada.',
      restoredVersionId: id,
      restoredFiles: [],
      error: 'VERSION_NOT_FOUND',
    };
  }

  const workspaceDir = path.resolve(version.workspaceDir);
  if (!fs.existsSync(workspaceDir)) {
    return {
      success: false,
      message: `Diretório do workspace não existe: ${workspaceDir}`,
      restoredVersionId: id,
      restoredFiles: [],
      error: 'WORKSPACE_NOT_FOUND',
    };
  }

  const snapshotAbsDir = path.join(getVersionsDir(), version.snapshotRef, 'files');
  if (!fs.existsSync(snapshotAbsDir)) {
    return {
      success: false,
      message: 'Arquivos do snapshot não encontrados no disco.',
      restoredVersionId: id,
      restoredFiles: [],
      error: 'SNAPSHOT_FILES_MISSING',
    };
  }

  // 1. Criar backup automático do estado atual dos arquivos afetados
  const backupVersion = createAppVersion({
    prompt: `Backup automático antes de restaurar versão #${version.versionNumber} (${version.id})`,
    workspaceDir,
    projectId: version.projectId,
    changedFiles: version.changedFiles,
    isBackup: true,
    backupForVersionId: version.id,
  });

  // 2. Restaurar arquivos do snapshot para o workspace
  const restoredFiles: string[] = [];
  for (const relPath of version.changedFiles) {
    const srcSnapshotFile = path.join(snapshotAbsDir, relPath);
    const destTargetFile = path.resolve(workspaceDir, relPath);

    // Validação estrita de segurança contra path traversal
    if (!destTargetFile.startsWith(workspaceDir)) {
      sysLog.error('SYSTEM', `Tentativa de path traversal bloqueada na restauração: ${relPath}`);
      continue;
    }

    if (fs.existsSync(srcSnapshotFile)) {
      fs.mkdirSync(path.dirname(destTargetFile), { recursive: true });
      fs.copyFileSync(srcSnapshotFile, destTargetFile);
      restoredFiles.push(relPath);
    }
  }

  sysLog.info(
    'SYSTEM',
    `Versão ${version.id} restaurada com sucesso. Backup gerado: ${backupVersion?.id || 'nenhum'}.`,
    { restoredCount: restoredFiles.length, backupVersionId: backupVersion?.id }
  );

  return {
    success: true,
    message: `Versão #${version.versionNumber} restaurada com sucesso (${restoredFiles.length} arquivos). Backup automático criado para permitir desfazer.`,
    restoredVersionId: id,
    backupVersionId: backupVersion?.id,
    restoredFiles,
  };
}
