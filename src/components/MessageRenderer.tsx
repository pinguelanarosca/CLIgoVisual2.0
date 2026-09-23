import React, { useState, useMemo } from 'react';
import {
  Copy,
  Check,
  FileCode,
  Paperclip,
  ExternalLink,
  Code2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ContentViewerItem } from './ContentViewerSidebar';

interface MessageRendererProps {
  content: string;
  isStreaming?: boolean;
  onOpenViewer?: (item: ContentViewerItem) => void;
}

// Helper to strip out internal system prompt/context preambles from user-facing view
function cleanRawMessage(raw: string): string {
  if (!raw) return '';
  let cleaned = raw;

  // Remove [CONTEXTO DO PROJETO E WORKSPACE] ... --- headers
  if (cleaned.includes('[CONTEXTO DO PROJETO E WORKSPACE]')) {
    cleaned = cleaned.replace(/\[CONTEXTO DO PROJETO E WORKSPACE\][\s\S]*?---\s*\n?/g, '');
  }

  // Remove [PROTOCOLO DE DELEGAÇÃO ...] ... --- headers
  if (cleaned.includes('[PROTOCOLO DE DELEGAÇÃO')) {
    cleaned = cleaned.replace(/\[PROTOCOLO DE DELEGAÇÃO[\s\S]*?---\s*\n?/g, '');
  }

  // Remove trailing prompt repetition if present
  return cleaned.trim();
}

// Render formatted inline markdown (bold, italic, inline code)
const renderInlineMarkdown = (text: string): React.ReactNode => {
  if (!text) return null;

  // Regex tokens: `code`, **bold**, *italic*
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={index}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-zinc-800/90 text-blue-300 font-mono text-[11px] border border-zinc-700/60"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={index} className="font-semibold text-zinc-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={index} className="italic text-zinc-200">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
};

// Render structured markdown blocks (paragraphs, headers, lists, quotes, dividers)
const MarkdownTextBlock: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushList = () => {
    if (!currentList) return;
    if (currentList.type === 'ul') {
      elements.push(
        <ul key={`list_${elements.length}`} className="my-1 space-y-0.5 pl-4 list-disc marker:text-blue-400/70 text-zinc-300">
          {currentList.items.map((it, i) => (
            <li key={i} className="leading-snug pl-0.5">
              {renderInlineMarkdown(it)}
            </li>
          ))}
        </ul>
      );
    } else {
      elements.push(
        <ol key={`list_${elements.length}`} className="my-1 space-y-0.5 pl-4 list-decimal marker:text-emerald-400/80 font-mono text-xs text-zinc-300">
          {currentList.items.map((it, i) => (
            <li key={i} className="leading-snug font-sans text-zinc-300 pl-0.5">
              {renderInlineMarkdown(it)}
            </li>
          ))}
        </ol>
      );
    }
    currentList = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Dividers
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      flushList();
      elements.push(<hr key={`hr_${elements.length}`} className="my-2 border-zinc-800" />);
      continue;
    }

    // Headings
    if (trimmed.startsWith('#### ')) {
      flushList();
      elements.push(
        <h4 key={`h4_${elements.length}`} className="text-xs font-bold text-zinc-200 mt-2 mb-0.5 tracking-wide">
          {renderInlineMarkdown(trimmed.slice(5))}
        </h4>
      );
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={`h3_${elements.length}`} className="text-[12.5px] font-bold text-zinc-100 mt-2 mb-1 text-blue-400/90 flex items-center gap-1.5">
          {renderInlineMarkdown(trimmed.slice(4))}
        </h3>
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={`h2_${elements.length}`} className="text-[13.5px] font-bold text-zinc-100 mt-2.5 mb-1 pb-0.5 border-b border-zinc-800 flex items-center gap-2">
          {renderInlineMarkdown(trimmed.slice(3))}
        </h2>
      );
      continue;
    }
    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <h1 key={`h1_${elements.length}`} className="text-sm font-bold text-white mt-3 mb-1.5 pb-1 border-b border-zinc-700">
          {renderInlineMarkdown(trimmed.slice(2))}
        </h1>
      );
      continue;
    }

    // Blockquotes
    if (trimmed.startsWith('> ')) {
      flushList();
      elements.push(
        <blockquote
          key={`quote_${elements.length}`}
          className="my-1 pl-2.5 py-0.5 border-l-2 border-blue-500/50 bg-blue-500/5 rounded-r text-zinc-300 text-xs italic leading-snug"
        >
          {renderInlineMarkdown(trimmed.slice(2))}
        </blockquote>
      );
      continue;
    }

    // Unordered list (* item, - item)
    const ulMatch = line.match(/^(\s*)([-*•])\s+(.*)$/);
    if (ulMatch) {
      const itemContent = ulMatch[3];
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(itemContent);
      continue;
    }

    // Ordered list (1. item)
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (olMatch) {
      const itemContent = olMatch[3];
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(itemContent);
      continue;
    }

    // Regular paragraph line with compact leading
    flushList();
    elements.push(
      <p key={`p_${elements.length}`} className="my-1 leading-snug text-zinc-200">
        {renderInlineMarkdown(line)}
      </p>
    );
  }

  flushList();

  return <div className="space-y-0.5">{elements}</div>;
};

// Code block component with expand/collapse and copy toolbar
const CodeBlockItem: React.FC<{
  language: string;
  content: string;
  idx: number;
  copiedIndex: number | null;
  onCopy: (e: React.MouseEvent, code: string, index: number) => void;
  onOpenViewer?: (item: ContentViewerItem) => void;
}> = ({ language, content, idx, copiedIndex, onCopy, onOpenViewer }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const lines = content.split('\n');
  const lineCount = lines.length;
  const isLargeBlock = lineCount > 25;

  return (
    <div className="my-2 rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden font-mono text-[11px] shadow-sm group/code">
      {/* Code Toolbar */}
      <div className="px-3 py-1.5 bg-zinc-900/90 border-b border-zinc-800/80 flex items-center justify-between text-zinc-400 select-none">
        <div className="flex items-center gap-2">
          <FileCode className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-200">
            {language || 'código'}
          </span>
          <span className="text-[10px] text-zinc-500 font-normal">
            ({lineCount} {lineCount === 1 ? 'linha' : 'linhas'})
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {onOpenViewer && (
            <button
              type="button"
              onClick={() =>
                onOpenViewer({
                  id: `code_${idx}_${Date.now()}`,
                  title: `Código (${language || 'bloco'})`,
                  content,
                  language,
                  type: 'code_block',
                })
              }
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
              title="Abrir no Painel Lateral"
            >
              <ExternalLink className="w-3 h-3 text-zinc-400" />
              <span>Painel</span>
            </button>
          )}

          <button
            type="button"
            onClick={(e) => onCopy(e, content, idx)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
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

      {/* Code Viewport */}
      <div
        className={`p-3 overflow-x-auto text-zinc-200 transition-all ${
          isLargeBlock && !isExpanded ? 'max-h-[380px] overflow-y-hidden relative' : ''
        }`}
      >
        <pre className="leading-relaxed font-mono">
          <code>{content}</code>
        </pre>

        {isLargeBlock && !isExpanded && (
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-zinc-950 to-transparent flex items-end justify-center pb-2 pointer-events-none" />
        )}
      </div>

      {/* Expand/Collapse Toggle for Large Blocks */}
      {isLargeBlock && (
        <div className="px-3 py-1 bg-zinc-900/60 border-t border-zinc-800/60 text-center">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline-flex items-center gap-1 text-[10.5px] text-blue-400 hover:text-blue-300 font-medium cursor-pointer transition py-0.5"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3 h-3" />
                <span>Recolher visualização</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                <span>Expandir todas as {lineCount} linhas</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

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

  // 1. Clean message and extract attached files
  const { mainCleanText, attachedFileItems } = useMemo(() => {
    const raw = content || '';
    const ATTACHMENT_HEADER = '[ARQUIVOS ANEXADOS]:';
    let text = raw;
    let attachedFilesContent = '';

    if (text.includes(ATTACHMENT_HEADER)) {
      const splitIndex = text.indexOf(ATTACHMENT_HEADER);
      attachedFilesContent = text.substring(splitIndex + ATTACHMENT_HEADER.length).trim();
      text = text.substring(0, splitIndex).trim();
    }

    const files: Array<{ fileName: string; fileContent: string; extension: string }> = [];
    if (attachedFilesContent) {
      const fileMatches = Array.from(
        attachedFilesContent.matchAll(
          /--- INÍCIO DO ARQUIVO ANEXADO:\s*(.*?)\s*---\n([\s\S]*?)(?=--- FIM DO ARQUIVO ANEXADO ---|$)/g
        )
      );

      fileMatches.forEach((m) => {
        const fileName = m[1]?.trim() || 'arquivo.txt';
        const fileContent = m[2]?.trim() || '';
        const extension = fileName.includes('.')
          ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
          : '.txt';

        files.push({ fileName, fileContent, extension });
      });
    }

    return {
      mainCleanText: cleanRawMessage(text),
      attachedFileItems: files,
    };
  }, [content]);

  // 2. Parse code blocks vs regular markdown text parts
  const parts = useMemo(() => {
    const codeBlockRegex = /```([a-zA-Z0-9_\-\.]*)\n([\s\S]*?)```/g;
    const result: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(mainCleanText)) !== null) {
      if (match.index > lastIndex) {
        result.push({
          type: 'text',
          content: mainCleanText.substring(lastIndex, match.index),
        });
      }
      result.push({
        type: 'code',
        language: match[1] || 'code',
        content: match[2],
      });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < mainCleanText.length) {
      result.push({
        type: 'text',
        content: mainCleanText.substring(lastIndex),
      });
    }

    return result;
  }, [mainCleanText]);

  return (
    <div className="space-y-2 text-xs sm:text-[13px] leading-relaxed select-text font-sans text-zinc-200">
      {/* Markdown and Code Parts */}
      {parts.map((part, idx) => {
        if (part.type === 'text') {
          return <MarkdownTextBlock key={idx} text={part.content} />;
        }

        return (
          <CodeBlockItem
            key={idx}
            idx={idx}
            language={part.language || 'código'}
            content={part.content}
            copiedIndex={copiedIndex}
            onCopy={handleCopyCode}
            onOpenViewer={onOpenViewer}
          />
        );
      })}

      {/* Attached Files Section - Compact Square Grid */}
      {attachedFileItems.length > 0 && (
        <div className="my-2 pt-1.5 border-t border-zinc-800/80 space-y-1.5">
          <div className="text-[10.5px] font-semibold text-zinc-400 flex items-center gap-1.5">
            <Paperclip className="w-3 h-3 text-blue-400" />
            <span>Arquivos Anexados ({attachedFileItems.length}):</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {attachedFileItems.map((file, fileIdx) => {
              const isJson = file.extension === '.json' || file.extension === '.yaml' || file.extension === '.yml';
              const isMd = file.extension === '.md' || file.extension === '.markdown' || file.extension === '.txt';
              const isCode = ['.ts', '.tsx', '.js', '.jsx', '.py', '.html', '.css', '.rs', '.go', '.cpp'].includes(
                file.extension
              );
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
                  title={`${file.fileName} (${lineCount} linhas) • Clique para ver no painel`}
                  className="w-24 h-24 sm:w-28 sm:h-28 p-2 rounded-xl bg-zinc-900/90 border border-zinc-800 hover:border-blue-500/80 hover:bg-zinc-850 transition cursor-pointer flex flex-col items-center justify-between text-center group shadow-xs select-none shrink-0"
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform ${
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
                      <Code2 className="w-3.5 h-3.5" />
                    ) : isMd ? (
                      <FileCode className="w-3.5 h-3.5" />
                    ) : (
                      <Paperclip className="w-3.5 h-3.5" />
                    )}
                  </div>

                  <span className="text-[10px] font-semibold text-zinc-200 group-hover:text-blue-400 transition-colors line-clamp-2 w-full break-all px-0.5" title={file.fileName}>
                    {file.fileName}
                  </span>

                  <span className="text-[9px] text-zinc-500 font-mono">
                    {lineCount}L • {Math.round(file.fileContent.length / 1024 * 10) / 10}KB
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
