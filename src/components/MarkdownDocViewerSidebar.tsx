import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  Volume2,
  VolumeX,
  FileCode,
  FileText,
  Search,
  Code2,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import { getMarkdownStats } from '../utils/markdownDocUtils.js';

interface MarkdownDocViewerSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  document: {
    title: string;
    content: string;
  } | null;
}

export const MarkdownDocViewerSidebar: React.FC<MarkdownDocViewerSidebarProps> = ({
  isOpen,
  onClose,
  document: doc,
}) => {
  const [activeTab, setActiveTab] = useState<'rendered' | 'source'>('rendered');
  const [copied, setCopied] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!isOpen && isNarrating) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setIsNarrating(false);
    }
  }, [isOpen, doc]);

  if (!isOpen || !doc) return null;

  const stats = getMarkdownStats(doc.content);

  const handleCopy = () => {
    navigator.clipboard.writeText(doc.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const blob = new Blob([doc.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.title.endsWith('.md') ? doc.title : `${doc.title}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleToggleNarrate = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    if (isNarrating) {
      window.speechSynthesis.cancel();
      setIsNarrating(false);
    } else {
      window.speechSynthesis.cancel();
      const cleanText = doc.content
        .replace(/```[\s\S]*?```/g, 'Bloco de código omitido da narração.')
        .replace(/[#*_`]/g, '');
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'pt-BR';
      utterance.onend = () => setIsNarrating(false);
      utterance.onerror = () => setIsNarrating(false);
      window.speechSynthesis.speak(utterance);
      setIsNarrating(true);
    }
  };

  return (
    <div className="h-full w-full bg-[#0c0c0e] text-zinc-100 flex flex-col overflow-hidden border-l border-zinc-800 animate-fadeIn">
      {/* Top Header */}
      <div className="px-3.5 py-2.5 bg-zinc-900/90 border-b border-zinc-800/80 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
            <FileCode className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xs sm:text-[13px] font-semibold text-zinc-100 truncate font-mono" title={doc.title}>
              {doc.title}
            </h3>
            <p className="text-[10px] text-zinc-400 font-mono">
              {stats.kb} • {stats.lines} linhas • {stats.words} palavras
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
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
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
            title="Baixar arquivo .md"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleToggleNarrate}
            className={`p-1.5 rounded-md transition cursor-pointer ${
              isNarrating
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                : 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
            title={isNarrating ? 'Parar Narração' : 'Ler em voz alta (TTS)'}
          >
            {isNarrating ? (
              <VolumeX className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition cursor-pointer ml-1"
            title="Fechar Visualizador"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs and Search Bar */}
      <div className="px-3 py-1.5 bg-zinc-950/80 border-b border-zinc-800/60 flex items-center justify-between gap-2 shrink-0 flex-wrap">
        {/* Rendered vs Source Tabs */}
        <div className="flex items-center gap-1 bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab('rendered')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'rendered'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <BookOpen className="w-3 h-3" />
            <span>Renderizado</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('source')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'source'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Code2 className="w-3 h-3" />
            <span>Código Fonte .md</span>
          </button>
        </div>

        {/* Quick Search */}
        <div className="relative flex-1 min-w-[120px] max-w-[200px]">
          <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Localizar no texto..."
            className="w-full bg-zinc-900/90 border border-zinc-800 rounded-md pl-6 pr-2 py-0.5 text-[11px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-4 select-text bg-[#09090b]">
        {activeTab === 'rendered' ? (
          <div className="space-y-3 font-sans text-xs sm:text-[13px] leading-relaxed text-zinc-200 max-w-full">
            {renderRichMarkdownView(doc.content, searchQuery)}
          </div>
        ) : (
          <div className="font-mono text-xs leading-relaxed text-zinc-300 bg-zinc-950 p-3 rounded-lg border border-zinc-800/80 whitespace-pre-wrap overflow-x-auto">
            {doc.content}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="px-3 py-1.5 bg-zinc-950 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-500 font-mono shrink-0">
        <span>Aba lateral de documentos .md</span>
        <span>{stats.chars} caracteres</span>
      </div>
    </div>
  );
};

// Renderizador simplificado e elegante de Markdown no painel lateral
function renderRichMarkdownView(content: string, searchFilter = ''): React.ReactNode {
  if (!content) return null;

  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        nodes.push(
          <div key={`code_${i}`} className="my-2 rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
            {codeLang && (
              <div className="px-3 py-1 bg-zinc-900/80 border-b border-zinc-800 text-[10px] font-mono text-zinc-400">
                {codeLang}
              </div>
            )}
            <pre className="p-3 text-[11.5px] font-mono text-zinc-300 overflow-x-auto whitespace-pre">
              {codeBuffer.join('\n')}
            </pre>
          </div>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        // Start code block
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      nodes.push(
        <h3 key={`h3_${i}`} className="text-sm font-bold text-zinc-100 mt-3 mb-1 border-b border-zinc-800/40 pb-0.5">
          {line.replace('### ', '')}
        </h3>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      nodes.push(
        <h2 key={`h2_${i}`} className="text-base font-bold text-blue-400 mt-4 mb-1.5 border-b border-zinc-800/60 pb-1">
          {line.replace('## ', '')}
        </h2>
      );
      continue;
    }
    if (line.startsWith('# ')) {
      nodes.push(
        <h1 key={`h1_${i}`} className="text-lg font-bold text-zinc-100 mt-2 mb-2 pb-1 border-b border-zinc-700/80">
          {line.replace('# ', '')}
        </h1>
      );
      continue;
    }

    // List items
    if (line.startsWith('- ') || line.startsWith('* ')) {
      nodes.push(
        <li key={`li_${i}`} className="ml-4 list-disc marker:text-blue-400 text-zinc-300 pl-1 my-0.5">
          {line.slice(2)}
        </li>
      );
      continue;
    }

    // Divider
    if (line.trim() === '---' || line.trim() === '***') {
      nodes.push(<hr key={`hr_${i}`} className="my-3 border-zinc-800" />);
      continue;
    }

    // Regular paragraph
    if (line.trim().length > 0) {
      nodes.push(
        <p key={`p_${i}`} className="my-1 text-zinc-300 leading-relaxed">
          {line}
        </p>
      );
    }
  }

  return nodes;
}
