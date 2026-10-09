import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { getGuiGeminiDir } from './paths-service.js';

export interface SnapshotEntry { exists: boolean; mode?: number; sha256?: string; }
export interface VersionItem {
  id: string; versionNumber: number; createdAt: string; prompt: string; agentName: string;
  model: string; executionId: string; projectId?: string; workspaceDir: string;
  changedFiles: string[]; snapshotDirName: string; isBackup?: boolean;
  manifest?: Record<string, SnapshotEntry>;
}
export interface FileDiffResult { filePath: string; status: 'added' | 'modified' | 'deleted'; originalContent: string; versionContent: string; }
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.cache', 'build', 'coverage', '.turbo', 'tmp', '.audit-recovery', '.gemini', '.local', '.config', '.ssh', '.aws', '.codex']);
const getVersionsFile = () => path.join(getGuiGeminiDir(), 'versions.json');
const getSnapshotsBaseDir = () => path.join(getGuiGeminiDir(), 'snapshots');
function atomicJson(file: string, value: any): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export function loadVersions(): VersionItem[] {
  if (!fs.existsSync(getVersionsFile())) return [];
  const data = JSON.parse(fs.readFileSync(getVersionsFile(), 'utf8'));
  if (!Array.isArray(data)) throw new Error('Índice de versões inválido; arquivo preservado.');
  return data;
}
function safeFile(base: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error(`Caminho inválido no snapshot: ${relative}`);
  const resolvedBase = path.resolve(base), target = path.resolve(base, relative);
  if (!target.startsWith(resolvedBase + path.sep)) throw new Error('Arquivo fora do workspace.');
  // Refuse symlinks in every component, including missing leaf files with a symlink parent.
  let current = resolvedBase;
  if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Workspace simbólico não suportado.');
  for (const segment of path.relative(resolvedBase, target).split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Link simbólico não suportado: ${relative}`);
  }
  return target;
}
function snapshotDirectory(version: VersionItem): string {
  return safeFile(getSnapshotsBaseDir(), version.snapshotDirName);
}
type SnapshotParams = { prompt: string; agentName: string; model: string; executionId: string; workspaceDir: string; projectId?: string; changedFiles: string[]; isBackup?: boolean; sourceDir?: string };
export async function createVersionSnapshot(params: SnapshotParams): Promise<VersionItem | null> {
  if (!Array.isArray(params.changedFiles)) throw new Error('Lista de arquivos inválida.');
  const files = [...new Set(params.changedFiles)].filter(file => !IGNORED_DIRS.has(file.split(/[\\/]/)[0]));
  if (!files.length) return null;
  const id = `ver_${Date.now()}_${crypto.randomUUID()}`;
  const snapshotDirName = `snapshot_${id}`, directory = path.join(getSnapshotsBaseDir(), snapshotDirName);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const manifest: Record<string, SnapshotEntry> = {};
  try {
    for (const relative of files) {
      safeFile(params.workspaceDir, relative);
      const source = safeFile(params.sourceDir || params.workspaceDir, relative);
      if (!fs.existsSync(source)) { manifest[relative] = { exists: false }; continue; }
      const stat = fs.statSync(source);
      if (!stat.isFile()) throw new Error(`Snapshot aceita somente arquivos: ${relative}`);
      const destination = safeFile(directory, relative);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.copyFile(source, destination);
      manifest[relative] = { exists: true, mode: stat.mode & 0o777, sha256: await fileHash(destination) };
    }
    // Read the latest index only after all asynchronous I/O, avoiding lost concurrent additions.
    const versions = loadVersions();
    const versionNumber = Math.max(0, ...versions.filter(v => v.workspaceDir === params.workspaceDir).map(v => v.versionNumber)) + 1;
    const version: VersionItem = { id, versionNumber, createdAt: new Date().toISOString(), prompt: params.prompt || 'Snapshot automático', agentName: params.agentName || 'Agente', model: params.model || 'gemini', executionId: params.executionId || id, projectId: params.projectId, workspaceDir: path.resolve(params.workspaceDir), changedFiles: Object.keys(manifest), snapshotDirName, isBackup: Boolean(params.isBackup), manifest };
    atomicJson(path.join(directory, 'manifest.json'), manifest);
    atomicJson(getVersionsFile(), [version, ...versions]);
    return version;
  } catch (error) { await fs.promises.rm(directory, { recursive: true, force: true }); throw error; }
}
export function listVersions(projectId?: string, workspaceDir?: string): VersionItem[] { return loadVersions().filter(v => projectId ? v.projectId === projectId : workspaceDir ? v.workspaceDir === path.resolve(workspaceDir) : true); }
export function getVersion(id: string): VersionItem | null { return loadVersions().find(v => v.id === id) || null; }
export function deleteVersion(id: string): boolean {
  const versions = loadVersions(), target = versions.find(v => v.id === id);
  if (!target) return false;
  atomicJson(getVersionsFile(), versions.filter(v => v.id !== id));
  fs.rmSync(snapshotDirectory(target), { recursive: true, force: true }); return true;
}
function entries(version: VersionItem): Record<string, SnapshotEntry> {
  // Legacy snapshots had no absence information; preserve their existing copy-only semantics.
  return version.manifest || Object.fromEntries(version.changedFiles.map(file => [file, { exists: true }]));
}
async function applySnapshot(version: VersionItem, workspaceDir: string): Promise<void> {
  const directory = snapshotDirectory(version);
  for (const [relative, state] of Object.entries(entries(version))) {
    const target = safeFile(workspaceDir, relative);
    if (!state.exists) { await fs.promises.rm(target, { force: true }); continue; }
    const source = safeFile(directory, relative);
    if (state.sha256 && await fileHash(source) !== state.sha256) throw new Error(`Snapshot corrompido: ${relative}`);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.gui-restore-${crypto.randomUUID()}`;
    try { await fs.promises.copyFile(source, temporary); if (state.mode !== undefined) await fs.promises.chmod(temporary, state.mode); await fs.promises.rename(temporary, target); }
    finally { await fs.promises.rm(temporary, { force: true }); }
  }
}
const restoring = new Set<string>();
export async function restoreVersion(id: string, workspaceDir: string): Promise<{ success: boolean; backupVersionId?: string; message: string }> {
  const target = getVersion(id), workspace = path.resolve(workspaceDir);
  if (!target || target.workspaceDir !== workspace) return { success: false, message: 'Versão não pertence a este workspace.' };
  if (restoring.has(workspace)) return { success: false, message: 'Restauração já em andamento.' };
  restoring.add(workspace);
  let backup: VersionItem | null = null;
  try {
    // Verify all paths/content before altering the workspace.
    const directory = snapshotDirectory(target);
    for (const [relative, state] of Object.entries(entries(target))) {
      safeFile(workspace, relative);
      if (state.exists) { const source = safeFile(directory, relative); if (!fs.existsSync(source) || state.sha256 && await fileHash(source) !== state.sha256) throw new Error(`Snapshot ausente/corrompido: ${relative}`); }
    }
    backup = await createVersionSnapshot({ prompt: `Backup pré-restauração v${target.versionNumber}`, agentName: 'Sistema', model: 'local', executionId: `restore_${Date.now()}`, workspaceDir: workspace, projectId: target.projectId, changedFiles: target.changedFiles, isBackup: true });
    if (!backup) throw new Error('Não foi possível criar backup de recuperação.');
    await applySnapshot(target, workspace);
    return { success: true, backupVersionId: backup.id, message: `Versão v${target.versionNumber} restaurada com backup.` };
  } catch (error: any) {
    let rollback = '';
    if (backup) { try { await applySnapshot(backup, workspace); rollback = ' Estado anterior recuperado.'; } catch (recovery: any) { rollback = ` Recuperação pendente: ${recovery.message}; backup ${backup.id}.`; } }
    return { success: false, backupVersionId: backup?.id, message: error.message + rollback };
  } finally { restoring.delete(workspace); }
}
export function getVersionDiff(id: string, workspaceDir: string): FileDiffResult[] {
  const version = getVersion(id); if (!version || version.workspaceDir !== path.resolve(workspaceDir)) return [];
  return Object.entries(entries(version)).map(([file, state]) => {
    const current = safeFile(workspaceDir, file), source = safeFile(snapshotDirectory(version), file);
    return { filePath: file, status: !fs.existsSync(current) && state.exists ? 'added' : fs.existsSync(current) && !state.exists ? 'deleted' : 'modified', originalContent: fs.existsSync(current) ? fs.readFileSync(current, 'utf8') : '', versionContent: state.exists ? fs.readFileSync(source, 'utf8') : '' };
  });
}
async function fileHash(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function scanWorkspace(workspace: string): Promise<Map<string, { hash: string; size: number }>> {
  workspace = path.resolve(workspace);
  if (workspace === os.homedir() || workspace === path.parse(workspace).root) throw new Error('Snapshot automático requer um diretório de projeto; a raiz do usuário/sistema é ampla demais.');
  const files = new Map<string, { hash: string; size: number }>();
  let bytes = 0, visited = 0, directories = 0;
  const started = Date.now();
  const scan = async (directory: string, depth = 0) => {
    if (++directories > 4096 || depth > 32) throw new Error('Workspace excedeu limite de diretórios/profundidade de snapshots automáticos.');
    const iterator = await fs.promises.opendir(directory);
    for await (const entry of iterator) {
      if (++visited > 20000 || Date.now() - started > 5000) throw new Error('Workspace excedeu limite de varredura de snapshots automáticos (20 mil entradas/5 segundos).');
      if (IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(file, depth + 1);
      else if (entry.isFile()) {
        const stat = await fs.promises.stat(file); bytes += stat.size;
        if (files.size >= 10000 || bytes > 256 * 1024 * 1024) throw new Error('Workspace excedeu limite de snapshots automáticos (10 mil arquivos/256 MiB).');
        files.set(path.relative(workspace, file), { hash: await fileHash(file), size: stat.size });
      }
    }
  };
  await scan(workspace); return files;
}
/** A disk baseline preserves overwritten/deleted content without retaining file bodies in RAM. */
export async function beginAutomaticSnapshot(params: Omit<SnapshotParams, 'changedFiles'>): Promise<{ finish: () => Promise<VersionItem | null>; dispose: () => Promise<void> }> {
  const stage = path.join(getSnapshotsBaseDir(), `.pending-${crypto.randomUUID()}`);
  await fs.promises.mkdir(stage, { recursive: true, mode: 0o700 });
  try {
    const before = await scanWorkspace(params.workspaceDir);
    for (const [relative, state] of before) {
      const source = safeFile(params.workspaceDir, relative), destination = safeFile(stage, relative);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_FICLONE);
      if (await fileHash(destination) !== state.hash) throw new Error('Workspace mudou durante a captura inicial; snapshot interrompido.');
    }
    let finished = false;
    return {
      dispose: () => fs.promises.rm(stage, { recursive: true, force: true }),
      finish: async () => {
        if (finished) return null; finished = true;
        try {
          const after = await scanWorkspace(params.workspaceDir);
          const changedFiles = [...new Set([...before.keys(), ...after.keys()])].filter(file => before.get(file)?.hash !== after.get(file)?.hash);
          if (!changedFiles.length) return null;
          await createVersionSnapshot({ ...params, prompt: `[Antes da execução] ${params.prompt}`, sourceDir: stage, changedFiles, isBackup: true });
          return await createVersionSnapshot({ ...params, changedFiles });
        } finally { await fs.promises.rm(stage, { recursive: true, force: true }); }
      },
    };
  } catch (error) { await fs.promises.rm(stage, { recursive: true, force: true }); throw error; }
}
