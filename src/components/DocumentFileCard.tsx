import React, { useState } from 'react';
import { Check, Code2, Copy, Download, File, FileJson, FileText } from 'lucide-react';

interface DocumentFileCardProps {
  name: string;
  content: string;
  extension?: string;
  onOpen: () => void;
}

// Presentation only: attachments and compacted responses retain their own content/transport.
export const DocumentFileCard: React.FC<DocumentFileCardProps> = ({ name, content, extension, onOpen }) => {
  const [copied, setCopied] = useState(false);
  const ext = (extension || (name.includes('.') ? name.slice(name.lastIndexOf('.')) : '.txt')).replace(/^\./, '').toLowerCase();
  const isJson = ['json', 'yaml', 'yml'].includes(ext);
  const isText = ['txt', 'md', 'markdown'].includes(ext);
  const Icon = isJson ? FileJson : isText ? FileText : ['ts', 'tsx', 'js', 'jsx', 'py', 'html', 'css', 'rs', 'go', 'cpp', 'sh'].includes(ext) ? Code2 : File;
  const lines = content ? content.split('\n').length : 0;
  const size = (new TextEncoder().encode(content).length / 1024).toFixed(1);

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const download = () => {
    const mime = ext === 'md' || ext === 'markdown' ? 'text/markdown' : ext === 'json' ? 'application/json' : 'text/plain';
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div data-document-card className="w-36 max-w-full h-32 shrink-0 rounded-xl border border-zinc-700/70 bg-zinc-900/90 hover:border-blue-500/60 transition-colors flex flex-col overflow-hidden select-none">
      <button type="button" onClick={onOpen} title={`Abrir ${name} no painel lateral`} aria-label={`Abrir ${name} no painel lateral`}
        className="flex-1 min-h-0 w-full p-2.5 pb-1 text-left flex flex-col gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400">
        <span className="flex items-center justify-between gap-2 w-full">
          <Icon aria-hidden="true" className={`w-5 h-5 ${isJson ? 'text-amber-400' : isText ? 'text-emerald-400' : 'text-blue-400'}`} />
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-mono uppercase text-zinc-400">{ext}</span>
        </span>
        <span title={name} className="text-[11px] font-medium text-zinc-100 line-clamp-2 break-all leading-tight w-full">{name}</span>
        <span className="mt-auto text-[9px] font-mono text-zinc-500">{lines} linhas · {size} KB</span>
      </button>
      <div className="flex justify-end gap-0.5 px-2 pb-1.5">
        <button type="button" onClick={copy} title="Copiar conteúdo" aria-label={`Copiar ${name}`} className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer">
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
        <button type="button" onClick={download} title="Baixar arquivo" aria-label={`Baixar ${name}`} className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer">
          <Download className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
