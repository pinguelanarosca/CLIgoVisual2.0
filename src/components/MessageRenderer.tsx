import React, { useState } from 'react';
import {
  Copy,
  Check,
  FileCode,
  Paperclip,
  ExternalLink,
  Code2,
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ContentViewerItem } from './ContentViewerSidebar';

interface MessageRendererProps {
  content: string;
  isStreaming?: boolean;
  onOpenViewer?: (item: ContentViewerItem) => void;
}

export const MessageRenderer: React.FC<MessageRendererProps> = ({
  content,
  isStreaming,
  onOpenViewer,
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopyCode = (e: React.MouseEvent, code: string, index: number) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1800);
    });
  };

  // Separate Attached Files if present in prompt
  const ATTACHMENT_HEADER = '[ARQUIVOS ANEXADOS]:';
  let mainContent = content || '';
  let attachedFilesContent = '';

  if (mainContent.includes(ATTACHMENT_HEADER)) {
    const splitIndex = mainContent.indexOf(ATTACHMENT_HEADER);
    attachedFilesContent = mainContent.substring(splitIndex + ATTACHMENT_HEADER.length).trim();
    mainContent = mainContent.substring(0, splitIndex).trim();
  }

  // Parse attached file blocks
  const attachedFileItems: Array<{ fileName: string; fileContent: string; extension: string }> = [];
  if (attachedFilesContent) {
    const fileMatches = Array.from(
      attachedFilesContent.matchAll(/--- INÍCIO DO ARQUIVO ANEXADO:\s*(.*?)\s*---\n([\s\S]*?)(?=--- FIM DO ARQUIVO ANEXADO ---|$)/g)
    );

    fileMatches.forEach((m) => {
      const fileName = m[1]?.trim() || 'arquivo.txt';
      const fileContent = m[2]?.trim() || '';
      const extension = fileName.includes('.')
        ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
        : '.txt';

      attachedFileItems.push({ fileName, fileContent, extension });
    });
  }

  // Parse code blocks in main content
  const codeBlockRegex = /```([a-zA-Z0-9_\-\.]*)\n([\s\S]*?)```/g;
  const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(mainContent)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: mainContent.substring(lastIndex, match.index),
      });
    }
    parts.push({
      type: 'code',
      language: match[1] || 'code',
      content: match[2],
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < mainContent.length) {
    parts.push({
      type: 'text',
      content: mainContent.substring(lastIndex),
    });
  }

  return (
    <div className="space-y-2 text-xs sm:text-[13px] leading-snug select-text font-sans">
      {/* User Message Text / Main Content Parts */}
      {parts.map((part, idx) => {
        if (part.type === 'text') {
          const isLongText = part.content.length > 700 && !isStreaming;

          if (isLongText && onOpenViewer) {
            const previewText = part.content.slice(0, 200) + '...';
            return (
              <div key={idx} className="my-1.5">
                <p className="text-zinc-300 leading-relaxed mb-1.5">{previewText}</p>

                {/* Square Card button for Long Text */}
                <button
                  type="button"
                  onClick={() =>
                    onOpenViewer({
                      id: `text_${idx}_${Date.now()}`,
                      title: 'Saída de Texto Extensa',
                      content: part.content,
                      type: 'long_text',
                    })
                  }
                  className="w-full max-w-sm p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 hover:border-blue-500/70 hover:bg-zinc-850 transition cursor-pointer flex items-center justify-between group shadow-sm text-left"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0 text-emerald-400 group-hover:scale-105 transition-transform">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-zinc-200 group-hover:text-blue-400 transition-colors block truncate">
                        Texto Completo ({part.content.length} caracteres)
                      </span>
                      <span className="text-[10px] text-zinc-400">Clique para abrir na aba lateral</span>
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-500 group-hover:text-blue-400 shrink-0" />
                </button>
              </div>
            );
          }

          return (
            <div key={idx} className="whitespace-pre-wrap leading-relaxed text-zinc-300">
              {part.content}
            </div>
          );
        }

        // Code Block
        const lines = part.content.split('\n');
        const lineCount = lines.length;
        const isLongCode = lineCount > 10 || part.content.length > 350;

        if (isLongCode && onOpenViewer && !isStreaming) {
          // Render as a clean square card that opens in right side-drawer
          const snippet = lines.slice(0, 3).join('\n');
          return (
            <div key={idx} className="my-2">
              <button
                type="button"
                onClick={() =>
                  onOpenViewer({
                    id: `code_${idx}_${Date.now()}`,
                    title: `Bloco de Código (${part.language || 'código'})`,
                    content: part.content,
                    language: part.language,
                    type: 'code_block',
                  })
                }
                className="w-full max-w-md p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 hover:border-purple-500/70 hover:bg-zinc-850 transition cursor-pointer flex flex-col gap-2 group shadow-sm text-left"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center shrink-0 text-purple-400 group-hover:scale-105 transition-transform">
                      <Code2 className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-zinc-200 group-hover:text-purple-300 transition-colors truncate">
                      {part.language || 'código'} • {lineCount} linhas
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-purple-400 font-mono bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                      Abrir no Painel
                    </span>
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-400 group-hover:text-purple-300 shrink-0" />
                  </div>
                </div>

                {/* Snippet Preview */}
                <div className="p-2 rounded bg-zinc-950 font-mono text-[10.5px] text-zinc-400 border border-zinc-800/80 overflow-hidden line-clamp-2">
                  <code>{snippet}</code>
                </div>
              </button>
            </div>
          );
        }

        // Standard short code block
        return (
          <div
            key={idx}
            className="my-1.5 rounded-lg bg-zinc-900/80 border border-zinc-800 overflow-hidden font-mono text-[11px] relative group/code"
          >
            <div className="px-2.5 py-1 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between text-zinc-400">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-blue-400" />
                {part.language}
                <span className="text-zinc-500 font-normal">({lineCount} linhas)</span>
              </span>

              <div className="flex items-center gap-1">
                {onOpenViewer && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenViewer({
                        id: `code_${idx}_${Date.now()}`,
                        title: `Bloco de Código (${part.language || 'código'})`,
                        content: part.content,
                        language: part.language,
                        type: 'code_block',
                      })
                    }
                    className="p-1 rounded text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition cursor-pointer"
                    title="Abrir no Painel Lateral"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={(e) => handleCopyCode(e, part.content, idx)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition cursor-pointer"
                  title="Copiar código"
                >
                  {copiedIndex === idx ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400 font-medium">Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="p-2.5 overflow-x-auto">
              <pre className="text-zinc-200 leading-normal">
                <code>{part.content}</code>
              </pre>
            </div>
          </div>
        );
      })}

      {/* Attached Files Section - Rendered as Square Cards */}
      {attachedFileItems.length > 0 && (
        <div className="my-2 space-y-1.5">
          <div className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
            <Paperclip className="w-3.5 h-3.5 text-blue-400" />
            <span>Arquivos Anexados na Mensagem ({attachedFileItems.length}):</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {attachedFileItems.map((file, fileIdx) => {
              const isJson = file.extension === '.json' || file.extension === '.yaml' || file.extension === '.yml';
              const isMd = file.extension === '.md' || file.extension === '.markdown' || file.extension === '.txt';
              const isCode = ['.ts', '.tsx', '.js', '.jsx', '.py', '.html', '.css', '.rs', '.go', '.cpp'].includes(file.extension);

              const lineCount = file.fileContent.split('\n').length;

              return (
                <button
                  key={fileIdx}
                  type="button"
                  onClick={() =>
                    onOpenViewer &&
                    onOpenViewer({
                      id: `att_${fileIdx}_${Date.now()}`,
                      title: file.fileName,
                      content: file.fileContent,
                      fileExtension: file.extension,
                      type: 'attached_file',
                    })
                  }
                  className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 hover:border-blue-500/80 hover:bg-zinc-850 transition cursor-pointer flex flex-col justify-between text-left group shadow-xs"
                >
                  <div className="flex items-center gap-2.5 mb-2">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform ${
                        isJson
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : isMd
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : isCode
                          ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                          : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                      }`}
                    >
                      {isCode ? (
                        <Code2 className="w-4 h-4" />
                      ) : isMd ? (
                        <FileText className="w-4 h-4" />
                      ) : (
                        <Paperclip className="w-4 h-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-semibold text-zinc-100 group-hover:text-blue-400 transition-colors block truncate" title={file.fileName}>
                        {file.fileName}
                      </span>
                      <span className="text-[10px] text-zinc-400 font-mono">
                        {lineCount} linhas • {file.fileContent.length} chars
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60 text-[10px] text-zinc-400 font-mono">
                    <span className="text-blue-400 group-hover:underline">Visualizar no Painel</span>
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-500 group-hover:text-blue-400" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 ml-1 bg-blue-500 animate-pulse align-middle" />
      )}
    </div>
  );
};
