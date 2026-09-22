import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { ProjectItem, AuthorizedDir, SessionItem, FileDiffItem, FilesAndDiffsResult, FileEntryItem } from '../src/types.js';
import { sysLog } from './logger-service.js';
import { getGuiDataDir } from './paths-service.js';
import {
  migrateSessionsFromStore,
  getSessionsSqlite,
  getSessionByIdSqlite,
  saveSessionSqlite,
  deleteSessionSqlite,
  clearAllSessionsSqlite,
} from './session-sqlite-service.js';

function getStorageFilePath(): string {
  const dataDir = getGuiDataDir();
  const primaryFile = path.join(dataDir, 'storage.json');
  if (fs.existsSync(primaryFile)) {
    return primaryFile;
  }
  const legacyDataFile = path.join(dataDir, '.gemini-gui-storage.json');
  if (fs.existsSync(legacyDataFile)) {
    return legacyDataFile;
  }
  const legacyCwdFile = path.join(process.cwd(), '.gemini-gui-storage.json');
  if (fs.existsSync(legacyCwdFile)) {
    try {
      fs.copyFileSync(legacyCwdFile, primaryFile);
      return primaryFile;
    } catch {
      // Ignore if legacy CWD file is not accessible
    }
  }
  return primaryFile;
}

interface AppDataStore {
  projects: ProjectItem[];
  authorizedDirs: string[];
  activeProjectId?: string;
  sessions: SessionItem[];
}

export function resolveLocalPath(inputPath?: string): string {
  if (!inputPath || !inputPath.trim()) {
    return getGuiDataDir();
  }
  let p = inputPath.trim();
  if (p.startsWith('~')) {
    p = path.join(os.homedir(), p.slice(1));
  }
  if (!path.isAbsolute(p)) {
    p = path.resolve(os.homedir(), p);
  }
  return path.normalize(p);
}

let cachedStore: AppDataStore | null = null;
let saveTimer: NodeJS.Timeout | null = null;

function loadStore(): AppDataStore {
  if (cachedStore) {
    return cachedStore;
  }

  const storageFile = getStorageFilePath();
  if (fs.existsSync(storageFile)) {
    try {
      const raw = fs.readFileSync(storageFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.projects)) {
        // Sanitize projects to guarantee valid directories
        parsed.projects = parsed.projects.map((proj: ProjectItem) => {
          const validDirs = (proj.associatedDirs || [])
            .map((d: string) => resolveLocalPath(d))
            .filter((d: string) => fs.existsSync(d));

          if (validDirs.length === 0) {
            validDirs.push(os.homedir());
          }
          return {
            ...proj,
            associatedDirs: validDirs,
          };
        });

        // Sanitize authorizedDirs
        const validAuthDirs = (parsed.authorizedDirs || [])
          .map((d: string) => resolveLocalPath(d))
          .filter((d: string) => fs.existsSync(d));

        if (validAuthDirs.length === 0) {
          validAuthDirs.push(os.homedir());
        }
        parsed.authorizedDirs = validAuthDirs;

        // Migrate sessions if present
        if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
          migrateSessionsFromStore(parsed.sessions);
          parsed.sessions = []; // Clear in json store as sessions are now in SQLite
        }

        cachedStore = parsed;
        return cachedStore!;
      }
    } catch {
      // Fall through to initial store
    }
  }

  const initialWorkspace = os.homedir();
  const initialProject: ProjectItem = {
    id: 'proj_default',
    name: 'Projeto Principal',
    description: 'Workspace principal do Gemini CLI',
    associatedDirs: [initialWorkspace],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const store: AppDataStore = {
    projects: [initialProject],
    authorizedDirs: [initialWorkspace],
    activeProjectId: initialProject.id,
    sessions: [],
  };

  cachedStore = store;
  saveStore(store, true);
  return store;
}

function saveStore(store: AppDataStore, immediate = false) {
  cachedStore = store;

  if (immediate) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      const storageFile = getStorageFilePath();
      fs.writeFileSync(storageFile, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save store:', err);
    }
    return;
  }

  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const storageFile = getStorageFilePath();
      fs.promises.writeFile(storageFile, JSON.stringify(cachedStore || store, null, 2), 'utf8').catch((err) => {
        console.error('Failed to save store async:', err);
      });
    } catch (err) {
      console.error('Failed to schedule store save:', err);
    }
  }, 300);
}

process.on('exit', () => {
  if (cachedStore) {
    try {
      const storageFile = getStorageFilePath();
      fs.writeFileSync(storageFile, JSON.stringify(cachedStore, null, 2), 'utf8');
    } catch {}
  }
});

// Authorized Directories API
export function getAuthorizedDirs(): AuthorizedDir[] {
  const store = loadStore();
  const list: AuthorizedDir[] = [];

  for (const dirPath of store.authorizedDirs) {
    const resolved = resolveLocalPath(dirPath);
    const exists = fs.existsSync(resolved);
    let isWritable = false;
    if (exists) {
      try {
        fs.accessSync(resolved, fs.constants.W_OK);
        isWritable = true;
      } catch {
        isWritable = false;
      }
    }
    list.push({
      path: resolved,
      exists,
      isWritable,
      addedAt: new Date().toISOString(),
    });
  }

  return list;
}

export function addAuthorizedDir(dirPath: string): { success: boolean; message: string; dirs: AuthorizedDir[] } {
  const resolved = resolveLocalPath(dirPath);
  if (!fs.existsSync(resolved)) {
    // Check if parent directory exists and offer to create or report
    return { success: false, message: `Diretório '${resolved}' não existe no filesystem.`, dirs: getAuthorizedDirs() };
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return { success: false, message: `O caminho especificado '${resolved}' não é um diretório.`, dirs: getAuthorizedDirs() };
    }
  } catch (err: any) {
    return { success: false, message: `Erro ao acessar diretório: ${err.message}`, dirs: getAuthorizedDirs() };
  }

  const store = loadStore();
  if (!store.authorizedDirs.some((d) => resolveLocalPath(d) === resolved)) {
    store.authorizedDirs.push(resolved);
    saveStore(store);
    sysLog.info('SYSTEM', `Novo diretório local autorizado: ${resolved}`);
  }

  return { success: true, message: `Diretório '${resolved}' autorizado com sucesso.`, dirs: getAuthorizedDirs() };
}

export function removeAuthorizedDir(dirPath: string): { success: boolean; dirs: AuthorizedDir[] } {
  const store = loadStore();
  const resolved = resolveLocalPath(dirPath);
  store.authorizedDirs = store.authorizedDirs.filter((d) => resolveLocalPath(d) !== resolved);
  saveStore(store);
  return { success: true, dirs: getAuthorizedDirs() };
}

export function isPathAuthorized(targetPath: string): boolean {
  const store = loadStore();
  const resolved = resolveLocalPath(targetPath);
  return store.authorizedDirs.some((authDir) => {
    const resolvedAuth = resolveLocalPath(authDir);
    return resolved === resolvedAuth || resolved.startsWith(resolvedAuth + path.sep);
  });
}

// Projects API
export function getProjects(): ProjectItem[] {
  const store = loadStore();
  return store.projects;
}

export function createProject(name: string, description: string, associatedDirs?: string[], guidelines?: string): ProjectItem {
  const store = loadStore();
  const id = `proj_${Date.now()}`;
  
  const rawDirs = associatedDirs && associatedDirs.length > 0 ? associatedDirs : [os.homedir()];
  const resolvedDirs: string[] = [];

  for (const raw of rawDirs) {
    const res = resolveLocalPath(raw);
    if (!resolvedDirs.includes(res)) {
      resolvedDirs.push(res);
      // Auto-authorize if exists
      if (fs.existsSync(res) && !store.authorizedDirs.some((d) => resolveLocalPath(d) === res)) {
        store.authorizedDirs.push(res);
      }
    }
  }

  const project: ProjectItem = {
    id,
    name: name.trim() || 'Novo Projeto',
    description: description.trim() || '',
    associatedDirs: resolvedDirs.length > 0 ? resolvedDirs : [os.homedir()],
    guidelines: guidelines || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Sync with physical gemini.md if guidelines provided and directory exists
  if (project.guidelines && project.associatedDirs.length > 0) {
    try {
      const firstDir = project.associatedDirs[0];
      if (fs.existsSync(firstDir)) {
        const geminiMdPath = path.join(firstDir, 'gemini.md');
        fs.writeFileSync(geminiMdPath, project.guidelines);
        sysLog.info('PROJECT', `Diretrizes salvas em ${geminiMdPath}`);
      }
    } catch (err) {
      sysLog.error('PROJECT', 'Falha ao salvar gemini.md físico', err);
    }
  }

  store.projects.push(project);
  store.activeProjectId = id;
  saveStore(store);

  sysLog.info('PROJECT', `Projeto '${project.name}' criado com ${project.associatedDirs.length} diretório(s) associado(s)`, {
    id: project.id,
    dirs: project.associatedDirs,
  });

  return project;
}

export function updateProject(id: string, updates: Partial<ProjectItem>): ProjectItem | null {
  const store = loadStore();
  const idx = store.projects.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  let resolvedDirs = store.projects[idx].associatedDirs;
  if (updates.associatedDirs) {
    resolvedDirs = updates.associatedDirs.map((d) => resolveLocalPath(d));
    // Auto authorize any newly specified existing directories
    for (const d of resolvedDirs) {
      if (fs.existsSync(d) && !store.authorizedDirs.some((auth) => resolveLocalPath(auth) === d)) {
        store.authorizedDirs.push(d);
      }
    }
  }

  store.projects[idx] = {
    ...store.projects[idx],
    ...updates,
    associatedDirs: resolvedDirs,
    updatedAt: new Date().toISOString(),
  };

  // Sync physical gemini.md if guidelines changed
  if (updates.guidelines !== undefined && store.projects[idx].associatedDirs.length > 0) {
    try {
      const firstDir = store.projects[idx].associatedDirs[0];
      if (fs.existsSync(firstDir)) {
        const geminiMdPath = path.join(firstDir, 'gemini.md');
        fs.writeFileSync(geminiMdPath, updates.guidelines || '');
        sysLog.info('PROJECT', `Diretrizes atualizadas em ${geminiMdPath}`);
      }
    } catch (err) {
      sysLog.error('PROJECT', 'Falha ao atualizar gemini.md físico', err);
    }
  }

  saveStore(store);
  sysLog.info('PROJECT', `Projeto '${store.projects[idx].name}' atualizado`, { id, dirs: resolvedDirs });
  return store.projects[idx];
}

export function deleteProject(id: string): boolean {
  const store = loadStore();
  store.projects = store.projects.filter((p) => p.id !== id);
  store.sessions = store.sessions.filter((s) => s.projectId !== id);
  if (store.activeProjectId === id) {
    store.activeProjectId = store.projects[0]?.id;
  }
  saveStore(store);
  return true;
}

// Sessions & History API (backed by SQLite)
export function getSessions(projectId?: string): SessionItem[] {
  return getSessionsSqlite(projectId);
}

export function getSessionById(id: string): SessionItem | null {
  return getSessionByIdSqlite(id);
}

export function saveSession(session: SessionItem): SessionItem {
  return saveSessionSqlite(session);
}

export function deleteSession(id: string): boolean {
  return deleteSessionSqlite(id);
}

// Files and Diffs API
export function inspectFilesAndDiffs(dirPath?: string): FilesAndDiffsResult {
  const store = loadStore();
  
  // Resolve target directory requested by user or fall back to default
  const defaultDir = store.projects[0]?.associatedDirs[0] || store.authorizedDirs[0] || os.homedir();
  const targetDir = dirPath && dirPath.trim() ? resolveLocalPath(dirPath) : resolveLocalPath(defaultDir);

  const parentDir = path.dirname(targetDir) !== targetDir ? path.dirname(targetDir) : null;

  if (!isPathAuthorized(targetDir)) {
    return {
      currentDir: targetDir,
      parentDir,
      exists: fs.existsSync(targetDir),
      isGitRepo: false,
      gitStatus: `Acesso negado: O diretório '${targetDir}' não está na lista de diretórios autorizados.`,
      files: [],
      entries: [],
      diffs: [],
      authorizedDirs: store.authorizedDirs,
      error: `Acesso negado: O diretório '${targetDir}' não possui permissão de leitura. Adicione-o na lista de diretórios autorizados.`,
    };
  }

  if (!fs.existsSync(targetDir)) {
    return {
      currentDir: targetDir,
      parentDir,
      exists: false,
      isGitRepo: false,
      gitStatus: `Diretório não existe no filesystem: ${targetDir}`,
      files: [],
      entries: [],
      diffs: [],
      authorizedDirs: store.authorizedDirs,
      error: `O caminho '${targetDir}' não foi encontrado no sistema de arquivos local.`,
    };
  }

  const files: string[] = [];
  const entries: FileEntryItem[] = [];

  try {
    const dirEntries = fs.readdirSync(targetDir, { withFileTypes: true });
    // Sort directories first, then alphabetically
    const sorted = [...dirEntries].sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const e of sorted) {
      if (!e.name.startsWith('.git') && !e.name.startsWith('node_modules')) {
        const fullChildPath = path.join(targetDir, e.name);
        let size: number | undefined;
        let modifiedAt: string | undefined;

        try {
          const stat = fs.statSync(fullChildPath);
          size = stat.size;
          modifiedAt = stat.mtime.toISOString();
        } catch {}

        const isDir = e.isDirectory();
        files.push(e.name + (isDir ? '/' : ''));
        entries.push({
          name: e.name,
          path: fullChildPath,
          isDirectory: isDir,
          size,
          modifiedAt,
        });
      }
    }
  } catch (err: any) {
    console.error('Error reading directory:', err);
  }

  // Check Git diffs and status in target directory
  const diffs: FileDiffItem[] = [];
  let isGitRepo = false;
  let branch: string | undefined;
  let gitStatus = 'Diretório local comum (sem versionamento Git).';

  try {
    // Check if git work tree
    const isGit = execSync('git rev-parse --is-inside-work-tree', {
      cwd: targetDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).trim();

    if (isGit === 'true') {
      isGitRepo = true;
      try {
        branch = execSync('git branch --show-current', {
          cwd: targetDir,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 2000,
        }).trim();
      } catch {}

      const statusOutput = execSync('git status --porcelain', {
        cwd: targetDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 4000,
      });

      if (statusOutput.trim()) {
        gitStatus = `Git (${branch || 'ativo'}): Alterações detectadas`;
        const lines = statusOutput.trim().split('\n');

        // Fetch all diffs at once in a single git execution
        let fullDiff = '';
        try {
          fullDiff = execSync('git diff HEAD', {
            cwd: targetDir,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 4000,
          });
        } catch {}

        const diffMap = new Map<string, string>();
        if (fullDiff) {
          const chunks = fullDiff.split(/^diff --git a\//m);
          for (const chunk of chunks) {
            if (!chunk.trim()) continue;
            const firstLineEnd = chunk.indexOf('\n');
            const headerLine = firstLineEnd !== -1 ? chunk.substring(0, firstLineEnd) : chunk;
            const match = headerLine.match(/^(.*?)\s+b\/(.*)$/);
            if (match) {
              const fileKey = match[2].trim();
              diffMap.set(fileKey, 'diff --git a/' + chunk);
            }
          }
        }

        for (const line of lines) {
          const flag = line.substring(0, 2).trim();
          const filePath = line.substring(3).trim();

          let status: 'modified' | 'added' | 'deleted' | 'untracked' = 'modified';
          if (flag === '??') status = 'untracked';
          else if (flag.includes('A')) status = 'added';
          else if (flag.includes('D')) status = 'deleted';

          let diff = diffMap.get(filePath) || '';

          // If it's a new file (untracked or added) and diff is empty, try to show content as added lines
          if (!diff && (status === 'added' || status === 'untracked')) {
            try {
              const fullPath = path.join(targetDir, filePath);
              if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                const content = fs.readFileSync(fullPath, 'utf8');
                diff = content.split('\n').map(l => '+' + l).join('\n');
              }
            } catch (err) {
              diff = `Arquivo novo: ${filePath} (não foi possível ler o conteúdo)`;
            }
          }

          diffs.push({
            path: filePath,
            status,
            diff: diff || `Alteração em: ${filePath} (${flag})`,
          });
        }
      } else {
        gitStatus = `Git (${branch || 'ativo'}): Working tree limpa (sem alterações).`;
      }
    }
  } catch {
    // Not a git repository, fallback gitStatus
    gitStatus = 'Diretório local (sem repositório Git).';
  }

  return {
    currentDir: targetDir,
    parentDir,
    exists: true,
    isGitRepo,
    branch,
    gitStatus,
    files,
    entries,
    diffs,
    authorizedDirs: store.authorizedDirs,
  };
}

export async function readFileContentAsync(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
  const resolved = resolveLocalPath(filePath);
  if (!isPathAuthorized(resolved)) {
    return { success: false, error: 'Acesso negado. O diretório não está autorizado.' };
  }

  try {
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) {
      return { success: false, error: 'O caminho especificado não é um arquivo.' };
    }

    // Limit size for safety (e.g. 5MB)
    if (stat.size > 5 * 1024 * 1024) {
      return { success: false, error: 'O arquivo é muito grande para visualização direta (limite 5MB).' };
    }

    const content = await fs.promises.readFile(resolved, 'utf8');
    return { success: true, content };
  } catch (err: any) {
    return { success: false, error: `Erro ao ler arquivo: ${err.message}` };
  }
}

export function readFileContent(filePath: string): { success: boolean; content?: string; error?: string } {
  const resolved = resolveLocalPath(filePath);
  if (!isPathAuthorized(resolved)) {
    return { success: false, error: 'Acesso negado. O diretório não está autorizado.' };
  }

  if (!fs.existsSync(resolved)) {
    return { success: false, error: 'Arquivo não encontrado.' };
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return { success: false, error: 'O caminho especificado não é um arquivo.' };
    }

    // Limit size for safety (e.g. 5MB)
    if (stat.size > 5 * 1024 * 1024) {
      return { success: false, error: 'O arquivo é muito grande para visualização direta (limite 5MB).' };
    }

    const content = fs.readFileSync(resolved, 'utf8');
    return { success: true, content };
  } catch (err: any) {
    return { success: false, error: `Erro ao ler arquivo: ${err.message}` };
  }
}

export function overwriteProjects(projects: ProjectItem[]): void {
  const store = loadStore();
  store.projects = projects;
  if (!store.projects.some((p) => p.id === store.activeProjectId)) {
    store.activeProjectId = store.projects[0]?.id;
  }
  saveStore(store);
  sysLog.info('PROJECT', `Projetos sobrescritos via restauração de backup (${projects.length} projetos)`);
}

export function overwriteSessions(sessions: SessionItem[]): void {
  const store = loadStore();
  store.sessions = sessions;
  saveStore(store);
  sysLog.info('PROJECT', `Sessões e histórico de chat sobrescritos via restauração de backup (${sessions.length} sessões)`);
}

export function overwriteAuthorizedDirs(dirs: string[]): void {
  const store = loadStore();
  store.authorizedDirs = dirs.map((d) => resolveLocalPath(d)).filter((d) => fs.existsSync(d));
  if (store.authorizedDirs.length === 0) {
    store.authorizedDirs.push(os.homedir());
  }
  saveStore(store);
  sysLog.info('PROJECT', `Diretórios autorizados sobrescritos via restauração (${store.authorizedDirs.length} diretórios)`);
}

export function resetProjectsAndSessions(): void {
  const initialWorkspace = os.homedir();
  const initialProject: ProjectItem = {
    id: 'proj_default',
    name: 'Projeto Principal',
    description: 'Workspace principal do Gemini CLI',
    associatedDirs: [initialWorkspace],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const store: AppDataStore = {
    projects: [initialProject],
    authorizedDirs: [initialWorkspace],
    activeProjectId: initialProject.id,
    sessions: [],
  };

  try {
    clearAllSessionsSqlite();
  } catch (err) {
    sysLog.warn('SYSTEM', 'Aviso ao limpar SQLite de sessões durante reset:', err);
  }

  saveStore(store);
  sysLog.warn('SYSTEM', 'Projetos e histórico de sessões redefinidos para os padrões de fábrica.');
}
