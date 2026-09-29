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
  FolderTree,
  FileQuestion,
  Sparkles,
  Layers,
} from 'lucide-react';
import { FileDiffItem, FileEntryItem, FilesAndDiffsResult, ProjectItem, AuthorizedDir } from '../types.js';
import { fetchJsonSafely } from '../utils/apiUtils.js';

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
      const data = await fetchJsonSafely<{ content: string }>(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      if (data && typeof data.content === 'string') {
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
      const data = await fetchJsonSafely<FilesAndDiffsResult>(`/api/files?dir=${encodeURIComponent(target)}`);
      if (data) {
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

  const filteredDiffs = React.useMemo(() => {
    if (!searchQuery.trim()) return diffs;
    const q = searchQuery.toLowerCase();
    return diffs.filter((d) => d.path.toLowerCase().includes(q));
  }, [diffs, searchQuery]);

  const filteredEntries = React.useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, searchQuery]);

  const activeDiff = diffs.find((d) => d.path === selectedDiffPath) || diffs[0];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0a0c] text-zinc-100 p-2 sm:p-3.5 overflow-hidden gap-2.5">
      {/* Outer Translucent Header Card */}
      <div className="bg-zinc-900/40 backdrop-blur-md border border-zinc-800/80 rounded-2xl p-3 shadow-xl shrink-0 flex flex-col gap-2.5">
        {/* Title & Description without raw directory suffix or static numbers */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/60 pb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
              <FolderGit2 className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-zinc-100 text-sm tracking-tight flex flex-wrap items-center gap-2">
                <span>Edições & Modificações do Projeto</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-semibold border border-amber-500/20 shrink-0">
                  Diffs Git
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                Inspecione o estado do repositório, visualize diffs em tempo real e explore o filesystem.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs shrink-0 self-start sm:self-center">
            {result?.isGitRepo ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium shrink-0">
                <GitBranch className="w-3.5 h-3.5 text-blue-400" />
                {result.branch || 'main'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-xl bg-zinc-800/80 text-zinc-400 border border-zinc-700/60 font-medium shrink-0">
                <Folder className="w-3.5 h-3.5 text-amber-400" />
                Filesystem Local
              </span>
            )}
            <span className="text-[11px] font-mono text-zinc-400 bg-zinc-800/60 px-2.5 py-1 rounded-xl border border-zinc-800 shrink-0">
              {diffs.length} alteração(ões)
            </span>
          </div>
        </div>

        {/* Directory Switcher Toolbar Card (Stable Portrait Layout) */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 bg-zinc-800/30 backdrop-blur-xs border border-zinc-700/40 rounded-xl p-2">
          <form onSubmit={handleNavigateSubmit} className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-amber-400 shrink-0 font-mono hidden xs:flex items-center gap-1">
              <Folder className="w-3.5 h-3.5 text-amber-400" />
              Diretório:
            </span>

            <div className="relative flex-1 min-w-0">
              <input
                type="text"
                value={inputDir}
                onChange={(e) => setInputDir(e.target.value)}
                placeholder="Ex: /home/user/projeto ou ~/workspace"
                className="w-full pl-3 pr-8 py-1.5 text-xs font-mono rounded-lg bg-zinc-950/80 border border-zinc-700/60 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition truncate"
              />
              {parentDir && (
                <button
                  type="button"
                  onClick={handleNavigateParent}
                  title={`Subir para: ${parentDir}`}
                  className="absolute right-1.5 top-1.5 p-1 text-zinc-400 hover:text-amber-300 rounded hover:bg-zinc-800 transition cursor-pointer"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition shadow-2xs shrink-0 cursor-pointer"
            >
              Inspecionar
            </button>
          </form>

          <div className="flex items-center gap-2 shrink-0">
            <select
              value={selectedDir}
              onChange={(e) => handleSelectPresetDir(e.target.value)}
              className="text-xs bg-zinc-950/80 border border-zinc-700/60 rounded-lg px-2 py-1.5 text-zinc-200 outline-none max-w-[160px] sm:max-w-[200px] truncate cursor-pointer focus:border-blue-500 flex-1 sm:flex-none"
            >
              <option value="" disabled>
                Atalhos...
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
              title="Atualizar Status do Git e Filesystem"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/50 transition cursor-pointer shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden xs:inline">Atualizar</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Diff & Explorer Content - Large Translucent Outer Box with Responsive Vertical Portrait Layout */}
      <div className="flex-1 bg-zinc-900/40 backdrop-blur-md border border-zinc-800/80 rounded-2xl overflow-hidden flex flex-col md:flex-row shadow-xl min-h-0">
        {/* Left/Top Subpanel: Diffs & Files Explorer */}
        <div className="w-full md:w-64 lg:w-72 h-52 md:h-auto border-b md:border-b-0 md:border-r border-zinc-800/80 bg-zinc-950/50 flex flex-col overflow-hidden shrink-0">
          {/* Subpanel Navigation Tabs */}
          <div className="flex border-b border-zinc-800/80 bg-zinc-900/40 shrink-0">
            <button
              onClick={() => setActiveTab('diffs')}
              className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition border-b-2 cursor-pointer ${
                activeTab === 'diffs'
                  ? 'border-blue-500 text-blue-400 bg-blue-500/10'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Diffs Git ({diffs.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('explorer')}
              className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition border-b-2 cursor-pointer ${
                activeTab === 'explorer'
                  ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>Explorador ({entries.length || files.length})</span>
            </button>
          </div>

          {/* Search Box */}
          <div className="p-2 border-b border-zinc-800/80">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar arquivos..."
                className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Tab 1: Diffs List */}
          {activeTab === 'diffs' && (
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {result?.exists === false ? (
                <div className="p-4 text-center text-xs text-rose-400 bg-rose-500/10 rounded-xl border border-rose-500/20 my-2">
                  <AlertCircle className="w-6 h-6 mx-auto mb-2 text-rose-400" />
                  Diretório não encontrado no sistema.
                </div>
              ) : filteredDiffs.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-400 space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto opacity-80" />
                  <p className="font-semibold text-zinc-200">
                    Nenhuma alteração pendente
                  </p>
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    O diretório atual está limpo e sincronizado no Git.
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
                      className={`w-full text-left p-2 rounded-xl text-xs flex items-center gap-2 transition cursor-pointer border ${
                        isSelected
                          ? 'bg-blue-500/15 text-blue-300 border-blue-500/40 font-semibold'
                          : 'text-zinc-300 border-transparent hover:bg-zinc-800/60'
                      }`}
                    >
                      {diff.status === 'added' ? (
                        <FilePlus className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : diff.status === 'deleted' ? (
                        <FileMinus className="w-4 h-4 text-rose-400 shrink-0" />
                      ) : (
                        <FileEdit className="w-4 h-4 text-amber-400 shrink-0" />
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
                  className="w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center gap-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition font-mono cursor-pointer"
                >
                  <ArrowUp className="w-3.5 h-3.5 text-amber-400" />
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
                      className={`px-2 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 transition border ${
                        entry.isDirectory
                          ? 'hover:bg-amber-500/10 text-amber-300 border-transparent cursor-pointer font-medium'
                          : entry.path === selectedFilePath
                          ? 'bg-zinc-800 text-white border-zinc-700 cursor-pointer font-mono text-[11px]'
                          : 'text-zinc-300 border-transparent hover:bg-zinc-800/50 cursor-pointer font-mono text-[11px]'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {entry.isDirectory ? (
                          <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : (
                          <FileCode className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        )}
                        <span className="truncate">{entry.name}</span>
                      </div>
                      {entry.size !== undefined && !entry.isDirectory && (
                        <span className="text-[10px] text-zinc-500 shrink-0 font-sans">
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
                      className={`px-2 py-1 text-[11px] font-mono rounded-lg flex items-center gap-2 transition cursor-pointer ${
                        (selectedDir + '/' + file) === selectedFilePath
                          ? 'bg-zinc-800 text-white'
                          : 'text-zinc-400 hover:bg-zinc-800/50'
                      }`}
                    >
                      {file.endsWith('/') ? (
                        <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      ) : (
                        <FileCode className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      )}
                      <span className="truncate">{file}</span>
                    </div>
                  ))}
            </div>
          )}
        </div>

        {/* Right Subpanel: Unified Diff & Code Inspector */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0c0c0e] text-zinc-100 font-mono text-xs">
          {activeDiff && !selectedFilePath ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="h-10 px-4 flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-200">{activeDiff.path}</span>
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                      activeDiff.status === 'added'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : activeDiff.status === 'deleted'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {activeDiff.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyDiff}
                    className="flex items-center gap-1 text-[11px] text-zinc-300 hover:text-white px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition cursor-pointer border border-zinc-700/60"
                  >
                    {hasCopiedDiff ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-blue-400" />}
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
              <div className="h-10 px-4 flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 shrink-0">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-amber-400" />
                  <span className="font-semibold text-zinc-200 truncate max-w-md">
                    {selectedFilePath.split('/').pop()}
                  </span>
                  <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full uppercase border border-amber-500/20 font-bold">
                    Preview
                  </span>
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
                    className="flex items-center gap-1 text-[11px] text-zinc-300 hover:text-white px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition cursor-pointer border border-zinc-700/60"
                  >
                    {hasCopiedDiff ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-amber-400" />}
                    <span>{hasCopiedDiff ? 'Copiado' : 'Copiar Conteúdo'}</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4 leading-relaxed font-mono relative">
                {isReadingFile ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70">
                    <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
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
              <FileQuestion className="w-12 h-12 text-amber-500/60 opacity-80" />
              <div>
                <p className="text-sm font-semibold text-zinc-300">
                  Selecione um arquivo para inspecionar
                </p>
                <p className="text-xs text-zinc-500 max-w-sm mt-1 leading-relaxed">
                  Escolha uma modificação em "Diffs Git" ou navegue pela estrutura do projeto em "Explorador".
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
