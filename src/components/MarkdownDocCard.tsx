import React, { useState } from 'react';
import {
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Download,
  FileCode,
  Eye,
  SidebarClose,
} from 'lucide-react';
import { extractDocumentTitle, getMarkdownStats } from '../utils/markdownDocUtils.js';

interface MarkdownDocCardProps {
  content: string;
  isStreaming?: boolean;
  onOpenRightPanel: (title: string, content: string) => void;
  renderInlineContent?: () => React.ReactNode;
}

export const MarkdownDocCard: React.FC<MarkdownDocCardProps> = ({
  content,
  isStreaming = false,
  onOpenRightPanel,
  renderInlineContent,
}) => {
  const [isInlineExpanded, setIsInlineExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const docTitle = extractDocumentTitle(content);
  const stats = getMarkdownStats(content);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = docTitle.endsWith('.md') ? docTitle : `${docTitle}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Se estiver em streaming contínuo inicial com menos de 200 caracteres, renderiza normalmente inline
  if (isStreaming && content.length < 300 && renderInlineContent) {
    return <>{renderInlineContent()}</>;
  }

  // Obter um snippet das 2 primeiras linhas para prévia
  const lines = content.trim().split('\n').filter(l => !l.startsWith('#') && l.trim().length > 0);
  const previewText = lines.slice(0, 2).join(' ').slice(0, 140) + '...';

  return (
    <div className="w-full my-1.5 rounded-xl border border-zinc-700/70 bg-gradient-to-br from-zinc-900/95 via-zinc-900/90 to-zinc-950/95 shadow-md overflow-hidden transition-all hover:border-blue-500/50 group select-none">
      {/* Top Banner & Header */}
      <div className="p-3 sm:p-3.5 flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2.5">
          {/* File Icon & Info */}
          <div
            onClick={() => onOpenRightPanel(docTitle, content)}
            className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1"
            title="Clique para abrir o documento completo no painel lateral à direita"
          >
            <div className="relative shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 group-hover:scale-105 group-hover:bg-blue-500/20 transition-all shadow-inner">
              <FileCode className="w-5 h-5 text-blue-400" />
              <span className="absolute -bottom-1 -right-1 px-1 py-0.2 rounded bg-blue-600 text-[8px] font-mono font-bold text-white uppercase shadow-xs">
                .md
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs sm:text-[13px] font-semibold text-zinc-100 group-hover:text-blue-400 transition-colors truncate font-mono">
                  {docTitle}
                </span>
                <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700/50 font-mono">
                  Documento Markdown
                </span>
              </div>

              <div className="flex items-center gap-2 mt-0.5 text-[10px] sm:text-[10.5px] text-zinc-400 font-mono flex-wrap">
                <span>{stats.kb}</span>
                <span>•</span>
                <span>{stats.lines} linhas</span>
                <span>•</span>
                <span>{stats.words} palavras</span>
                <span>•</span>
                <span className="text-zinc-500">~{stats.readTimeMin} min de leitura</span>
              </div>
            </div>
          </div>

          {/* Action Buttons Top */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="p-1.5 rounded-md bg-zinc-800/70 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700/50 transition cursor-pointer"
              title="Copiar texto Markdown"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="p-1.5 rounded-md bg-zinc-800/70 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700/50 transition cursor-pointer"
              title="Baixar arquivo .md"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Sneak Preview Text */}
        {!isInlineExpanded && previewText && (
          <div
            onClick={() => onOpenRightPanel(docTitle, content)}
            className="text-[11.5px] text-zinc-400 bg-zinc-950/60 p-2 rounded-lg border border-zinc-800/60 font-sans leading-relaxed cursor-pointer hover:bg-zinc-950/80 transition-colors"
          >
            <span className="text-zinc-500 font-mono text-[10px] mr-1.5">PRÉVIA:</span>
            <span className="text-zinc-300 italic">{previewText}</span>
          </div>
        )}

        {/* Primary Call-to-Action Bar */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/60 flex-wrap">
          <button
            type="button"
            onClick={() => onOpenRightPanel(docTitle, content)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-sm transition-all cursor-pointer hover:shadow-blue-500/20 hover:scale-[1.01] active:scale-[0.99]"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Abrir na Aba à Direita 📑</span>
          </button>

          {renderInlineContent && (
            <button
              type="button"
              onClick={() => setIsInlineExpanded(!isInlineExpanded)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 text-xs font-medium border border-zinc-700/50 transition cursor-pointer"
            >
              {isInlineExpanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Ocultar no Chat</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Ver Conteúdo no Chat</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Expanded Inline Content (se o usuário clicar para ver no chat) */}
      {isInlineExpanded && renderInlineContent && (
        <div className="p-3.5 bg-zinc-950/90 border-t border-zinc-800/80 animate-fadeIn text-xs sm:text-[13px] leading-relaxed text-zinc-200 select-text">
          {renderInlineContent()}
        </div>
      )}
    </div>
  );
};
