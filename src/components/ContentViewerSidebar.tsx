import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  FileCode,
  FileText,
  Paperclip,
  Code2,
} from 'lucide-react';

export interface ContentViewerItem {
  id: string;
  title: string;
  content: string;
  language?: string;
  fileExtension?: string;
  type: 'attached_file' | 'code_block' | 'long_text';
}

interface ContentViewerSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  item: ContentViewerItem | null;
}

export const ContentViewerSidebar: React.FC<ContentViewerSidebarProps> = ({
  isOpen,
  onClose,
  item,
}) => {
  const [copied, setCopied] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);

  useEffect(() => {
    // Reset narration when item changes or closes
    if (!isOpen && isNarrating) {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setIsNarrating(false);
    }
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(item.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleToggleNarrate = () => {
    if (!('speechSynthesis' in window)) {
      alert('Navegador não suporta síntese de voz (Web Speech API).');
      return;
    }

    if (isNarrating) {
      window.speechSynthesis.cancel();
      setIsNarrating(false);
    } else {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(item.content);
      utterance.lang = 'pt-BR';
      utterance.onend = () => setIsNarrating(false);
      utterance.onerror = () => setIsNarrating(false);
      
      window.speechSynthesis.speak(utterance);
      setIsNarrating(true);
    }
  };

  const lineCount = item.content.split('\n').length;
  const charCount = item.content.length;

  const getItemIcon = () => {
    if (item.type === 'attached_file') {
      return <Paperclip className="w-4 h-4 text-blue-400" />;
    }
    if (item.type === 'code_block') {
      return <Code2 className="w-4 h-4 text-purple-400" />;
    }
    return <FileText className="w-4 h-4 text-emerald-400" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity animate-fadeIn">
      {/* Sidebar Container */}
      <div
        className={`h-full bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl transition-all duration-200 ${
          isMaximized ? 'w-full max-w-5xl' : 'w-80 sm:w-96'
        }`}
      >
        {/* Header */}
        <div className="px-3.5 py-2.5 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            {getItemIcon()}
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-zinc-100 truncate" title={item.title}>
                {item.title}
              </h3>
              <p className="text-[10px] text-zinc-400 font-mono">
                {lineCount} linhas • {charCount} caract. {item.language ? `• ${item.language}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Copy Button */}
            <button
              type="button"
              onClick={handleCopy}
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
              title="Copiar Conteúdo"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Narrate Button */}
            <button
              type="button"
              onClick={handleToggleNarrate}
              className={`p-1.5 rounded transition cursor-pointer ${
                isNarrating
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                  : 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
              title={isNarrating ? 'Parar Narração' : 'Narrar Conteúdo'}
            >
              {isNarrating ? (
                <VolumeX className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Maximize / Minimize Button */}
            <button
              type="button"
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
              title={isMaximized ? 'Restaurar Tamanho' : 'Maximizar Painel'}
            >
              {isMaximized ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
              title="Fechar Aba"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Toolbar / Status Bar */}
        <div className="px-3 py-1 bg-zinc-900/40 border-b border-zinc-800/60 flex items-center justify-between text-[10px] text-zinc-400 font-mono">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Painel Lateral de Visualização
          </span>
          {isNarrating && (
            <span className="text-amber-400 font-semibold animate-pulse">
              🔊 Narrando áudio...
            </span>
          )}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed text-zinc-200 bg-zinc-950 whitespace-pre-wrap select-text">
          <code>{item.content}</code>
        </div>
      </div>
    </div>
  );
};
