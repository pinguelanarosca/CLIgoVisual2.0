import React, { useState, useEffect } from 'react';
import {
  FileText,
  GitBranch,
  RefreshCw,
  Folder,
  FolderGit2,
  FileCode,
  AlertCircle,
  CheckCircle2,
  FilePlus,
  FileMinus,
  FileEdit,
  ArrowUp,
  Search,
  Copy,
  Check,
  ChevronRight,
  Home,
  Layers,
  FolderTree,
  FileQuestion,
} from 'lucide-react';
import { FileDiffItem, FileEntryItem, FilesAndDiffsResult, ProjectItem, AuthorizedDir } from '../types.js';

interface FilesAndDiffsViewProps {
  currentDir: string;
  projects?: ProjectItem[];
  activeProject?: ProjectItem | null;
  authorizedDirs?: AuthorizedDir[];
  onDirectoryChange?: (newDir: string) => void;
}

export const FilesAndDiffsView: React.FC<FilesAndDiffsViewProps> = ({
  currentDir: initialDir,
  projects = [],
  activeProject = null,
  authorizedDirs = [],
  onDirectoryChange,
}) => {
  // Directory state
  const [selectedDir, setSelectedDir] = useState<string>(initialDir || '');
  const [inputDir, setInputDir] = useState<string>(initialDir || '');
  const [parentDir, setParentDir] = useState<string | null>(null);

  // Result state
  const [result, setResult] = useState<FilesAndDiffsResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'diffs' | 'explorer'>('diffs');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [hasCopiedDiff, setHasCopiedDiff] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);

  // Keep local path in sync if parent changes
  useEffect(() => {
    if (initialDir && initialDir !== selectedDir) {
      setSelectedDir(initialDir);
      setInputDir(initialDir);
    }
  }, [initialDir]);

  const fetchFileContent = async (filePath: string) => {
    setIsReadingFile(true);
    setSelectedDiffPath(null); // Clear diff selection
    setSelectedFilePath(filePath);
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedFileContent(data.content);
      } else {
        setSelectedFileContent('Falha ao ler o conteúdo do arquivo.');
      }
    } catch (err) {
      console.error('Error reading file:', err);
      setSelectedFileContent('Erro ao ler o conteúdo do arquivo.');
    } finally {
      setIsReadingFile(false);
    }
  };

  const fetchFilesAndDiffs = async (dirToFetch: string) => {
    setIsLoading(true);
    try {
      const target = dirToFetch || selectedDir || '';
      const res = await fetch(`/api/files?dir=${encodeURIComponent(target)}`);
      if (res.ok) {
        const data: FilesAndDiffsResult = await res.json();
        setResult(data);
        setSelectedDir(data.currentDir);
        setInputDir(data.currentDir);
        setParentDir(data.parentDir || null);

        if (onDirectoryChange && data.currentDir !== initialDir) {
          onDirectoryChange(data.currentDir);
        }

        if (data.diffs && data.diffs.length > 0) {
          if (!selectedDiffPath || !data.diffs.some((d) => d.path === selectedDiffPath)) {
            setSelectedDiffPath(data.diffs[0].path);
          }
        } else {
          setSelectedDiffPath(null);
        }
      }
    } catch (err) {
      console.error('Failed to load files and diffs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFilesAndDiffs(selectedDir);
  }, [selectedDir]);

  const handleNavigateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputDir.trim()) {
      setSelectedDir(inputDir.trim());
    }
  };

  const handleSelectPresetDir = (dir: string) => {
    if (!dir) return;
    setInputDir(dir);
    setSelectedDir(dir);
  };

  const handleNavigateParent = () => {
    if (parentDir) {
      handleSelectPresetDir(parentDir);
    }
  };

  const handleNavigateSubdir = (subpath: string) => {
    handleSelectPresetDir(subpath);
  };

  const handleCopyDiff = () => {
    if (activeDiff?.diff) {
      navigator.clipboard.writeText(activeDiff.diff);
      setHasCopiedDiff(true);
      setTimeout(() => setHasCopiedDiff(false), 2000);
    }
  };

  const diffs = result?.diffs || [];
  const entries = result?.entries || [];
  const files = result?.files || [];

  const filteredDiffs = diffs.filter((d) =>
    d.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredEntries = entries.filter((e) =>
    e.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeDiff = diffs.find((d) => d.path === selectedDiffPath) || diffs[0];

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      
      {/* Top Directory Selection & Path Bar */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2.5 flex flex-col gap-2 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          
          {/* Main Directory Input Form */}
          <form onSubmit={handleNavigateSubmit} className="flex-1 flex items-center gap-2 min-w-[280px]">
            <div className="flex items-center gap-1.5 text-zinc-500 shrink-0">
              <FolderGit2 className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Diretório Local:
              </span>
            </div>

            <div className="relative flex-1">
              <input
                type="text"
                value={inputDir}
                onChange={(e) => setInputDir(e.target.value)}
                placeholder="Ex: /home/user/meu-projeto ou ~/workspace ou ./src"
                className="w-full pl-3 pr-8 py-1.5 text-xs font-mono rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
              {parentDir && (
                <button
                  type="button"
                  onClick={handleNavigateParent}
                  title={`Subir para: ${parentDir}`}
                  className="absolute right-1.5 top-1.5 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition shadow-sm shrink-0"
            >
              Inspecionar
            </button>
          </form>

          {/* Quick Switcher dropdown & Actions */}
          <div className="flex items-center gap-2">
            <select
              value={selectedDir}
              onChange={(e) => handleSelectPresetDir(e.target.value)}
              className="text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-700 dark:text-zinc-300 outline-none max-w-[200px] truncate cursor-pointer"
            >
              <option value="" disabled>
                Projetos & Diretórios Cadastrados...
              </option>
              {projects.map((proj) =>
                proj.associatedDirs.map((d) => (
                  <option key={`${proj.id}_${d}`} value={d}>
                    📁 [{proj.name}] {d}
                  </option>
                ))
              )}
              {authorizedDirs.map((ad) => (
                <option key={ad.path} value={ad.path}>
                  ✓ [Autorizado] {ad.path}
                </option>
              ))}
            </select>

            <button
              onClick={() => fetchFilesAndDiffs(selectedDir)}
              disabled={isLoading}
              title="Atualizar Status do Filesystem e Git"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Atualizar</span>
            </button>
          </div>
        </div>

        {/* Status Indicators Bar */}
        <div className="flex items-center justify-between text-xs pt-1 text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-2 truncate">
            {result?.isGitRepo ? (
              <span className="inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                <GitBranch className="w-3 h-3" />
                {result.branch || 'git'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                <Folder className="w-3 h-3" />
                Filesystem Local
              </span>
            )}
            <span className="truncate">{result?.gitStatus}</span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[11px] font-medium">
              {diffs.length} alteração(ões) • {entries.length || files.length} item(ns)
            </span>
          </div>
        </div>
      </div>

      {/* Main Diff & Explorer Content */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar: Tabs for Changed Files & Explorer */}
        <div className="w-80 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 flex flex-col overflow-hidden shrink-0">
          
          {/* Sidebar Tabs */}
          <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 shrink-0">
            <button
              onClick={() => setActiveTab('diffs')}
              className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition border-b-2 ${
                activeTab === 'diffs'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-zinc-800/40'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Diffs Git ({diffs.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('explorer')}
              className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition border-b-2 ${
                activeTab === 'explorer'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-zinc-800/40'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>Explorador ({entries.length || files.length})</span>
            </button>
          </div>

          {/* Search box */}
          <div className="p-2 border-b border-zinc-200 dark:border-zinc-800">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar arquivos..."
                className="w-full pl-8 pr-2 py-1 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
              />
            </div>
          </div>

          {/* Tab 1: Diffs List */}
          {activeTab === 'diffs' && (
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {result?.exists === false ? (
                <div className="p-4 text-center text-xs text-rose-500">
                  <AlertCircle className="w-6 h-6 mx-auto mb-2 text-rose-500 opacity-80" />
                  Diretório não encontrado no sistema.
                </div>
              ) : filteredDiffs.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-500 space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto opacity-80" />
                  <p className="font-medium text-zinc-700 dark:text-zinc-300">
                    Nenhuma alteração pendente
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    O diretório atual está sincronizado ou não possui modificações git pendentes.
                  </p>
                </div>
              ) : (
                filteredDiffs.map((diff) => {
                  const isSelected = diff.path === selectedDiffPath;
                  return (
                    <button
                      key={diff.path}
                      onClick={() => {
                        setSelectedDiffPath(diff.path);
                        setSelectedFilePath(null);
                        setSelectedFileContent(null);
                      }}
                      className={`w-full text-left p-2 rounded-lg text-xs flex items-center gap-2 transition ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 font-medium'
                          : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {diff.status === 'added' ? (
                        <FilePlus className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : diff.status === 'deleted' ? (
                        <FileMinus className="w-4 h-4 text-rose-500 shrink-0" />
                      ) : (
                        <FileEdit className="w-4 h-4 text-amber-500 shrink-0" />
                      )}
                      <span className="truncate flex-1 font-mono text-[11px]">
                        {diff.path}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Tab 2: Explorer List */}
          {activeTab === 'explorer' && (
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {parentDir && (
                <button
                  onClick={handleNavigateParent}
                  className="w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center gap-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition font-mono"
                >
                  <ArrowUp className="w-3.5 h-3.5 text-zinc-400" />
                  <span>.. (Subir nível)</span>
                </button>
              )}

              {filteredEntries.length > 0
                ? filteredEntries.map((entry) => (
                    <div
                      key={entry.path}
                      onClick={() => {
                        if (entry.isDirectory) {
                          handleNavigateSubdir(entry.path);
                        } else {
                          fetchFileContent(entry.path);
                        }
                      }}
                      className={`px-2 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 transition ${
                        entry.isDirectory
                          ? 'hover:bg-blue-50 dark:hover:bg-blue-950/30 text-blue-600 dark:text-blue-400 cursor-pointer font-medium'
                          : entry.path === selectedFilePath
                          ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 cursor-pointer font-mono text-[11px]'
                          : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer font-mono text-[11px]'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {entry.isDirectory ? (
                          <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        ) : (
                          <FileCode className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        )}
                        <span className="truncate">{entry.name}</span>
                      </div>
                      {entry.size !== undefined && !entry.isDirectory && (
                        <span className="text-[10px] text-zinc-400 shrink-0 font-sans">
                          {(entry.size / 1024).toFixed(1)} KB
                        </span>
                      )}
                    </div>
                  ))
                : files.map((file) => (
                    <div
                      key={file}
                      onClick={() => {
                        if (file.endsWith('/')) {
                          handleNavigateSubdir(`${selectedDir}/${file.slice(0, -1)}`);
                        } else {
                          fetchFileContent(`${selectedDir}/${file}`);
                        }
                      }}
                      className={`px-2 py-1 text-[11px] font-mono rounded flex items-center gap-2 transition cursor-pointer ${
                        (selectedDir + '/' + file) === selectedFilePath
                          ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {file.endsWith('/') ? (
                        <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      ) : (
                        <FileCode className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      )}
                      <span className="truncate">{file}</span>
                    </div>
                  ))}
            </div>
          )}
        </div>

        {/* Right Panel: Unified Diff & File Viewer */}
        <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950 text-zinc-100 font-mono text-xs">
          {activeDiff && !selectedFilePath ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="h-10 px-4 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-200">{activeDiff.path}</span>
                  <span
                    className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                      activeDiff.status === 'added'
                        ? 'bg-emerald-900/60 text-emerald-300'
                        : activeDiff.status === 'deleted'
                        ? 'bg-rose-900/60 text-rose-300'
                        : 'bg-amber-900/60 text-amber-300'
                    }`}
                  >
                    {activeDiff.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyDiff}
                    className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-zinc-800/60 hover:bg-zinc-800 transition"
                  >
                    {hasCopiedDiff ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{hasCopiedDiff ? 'Copiado' : 'Copiar Diff'}</span>
                  </button>
                  <span className="text-[11px] text-zinc-500">Visualização Git</span>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4 leading-relaxed font-mono">
                {activeDiff.diff.split('\n').map((line, idx) => {
                  let lineClass = 'text-zinc-400';
                  if (line.startsWith('+') && !line.startsWith('+++')) {
                    lineClass = 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500 pl-2';
                  } else if (line.startsWith('-') && !line.startsWith('---')) {
                    lineClass = 'bg-rose-950/40 text-rose-300 border-l-2 border-rose-500 pl-2';
                  } else if (line.startsWith('@@')) {
                    lineClass = 'text-blue-400 font-bold bg-blue-950/30 py-0.5 px-1 rounded my-1';
                  }

                  return (
                    <div key={idx} className={`py-0.5 ${lineClass}`}>
                      {line || ' '}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : selectedFilePath ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="h-10 px-4 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 shrink-0">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-zinc-400" />
                  <span className="font-semibold text-zinc-200 truncate max-w-md">
                    {selectedFilePath.split('/').pop()}
                  </span>
                  <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded uppercase">Preview</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (selectedFileContent) {
                        navigator.clipboard.writeText(selectedFileContent);
                        setHasCopiedDiff(true);
                        setTimeout(() => setHasCopiedDiff(false), 2000);
                      }
                    }}
                    className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-zinc-800/60 hover:bg-zinc-800 transition"
                  >
                    {hasCopiedDiff ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{hasCopiedDiff ? 'Copiado' : 'Copiar Tudo'}</span>
                  </button>
                  <span className="text-[11px] text-zinc-500">Conteúdo do Arquivo</span>
                </div>
              </div>
              
              <div className="flex-1 overflow-auto p-4 leading-relaxed font-mono relative">
                {isReadingFile ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/50">
                    <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                  </div>
                ) : (
                  <pre className="text-zinc-300 text-[11px] whitespace-pre-wrap break-all">
                    {selectedFileContent || 'Arquivo vazio.'}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500 space-y-3">
              <FileQuestion className="w-12 h-12 text-zinc-600 opacity-60" />
              <div>
                <p className="text-sm font-semibold text-zinc-400">
                  Selecione um item para visualizar
                </p>
                <p className="text-xs text-zinc-500 max-w-sm mt-1">
                  Clique em um arquivo alterado (Diffs) ou navegue pelo Explorador para ver o conteúdo de qualquer arquivo.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
