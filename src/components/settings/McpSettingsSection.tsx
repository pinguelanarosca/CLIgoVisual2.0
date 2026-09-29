import React, { useState } from 'react';
import { Plus, Play, Sliders, Trash2, CheckCircle2, AlertTriangle, X, GitBranch, Search, ToggleLeft, ToggleRight, Layers, Sparkles } from 'lucide-react';
import { McpConfig } from '../../types.js';

interface McpSettingsSectionProps {
  mcpServers: McpConfig[];
  onSaveMcpServers: (servers: McpConfig[]) => Promise<void>;
  onTestMcp: (mcp: McpConfig) => Promise<{ success: boolean; message: string }>;
}

interface PresetMcpTool {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

const DEFAULT_GIT_TOOLS: PresetMcpTool[] = [
  { id: 'git_status', name: 'git_status', description: 'Obtém o estado atual dos arquivos modificados no repositório.', enabled: true },
  { id: 'git_log', name: 'git_log', description: 'Exibe os últimos commits com autores, hashes e mensagens.', enabled: true },
  { id: 'git_diff', name: 'git_diff', description: 'Mostra as alterações pendentes nos arquivos antes do commit.', enabled: true },
  { id: 'git_commit', name: 'git_commit', description: 'Cria um novo commit com mensagem no repositório local.', enabled: true },
  { id: 'git_checkout', name: 'git_checkout', description: 'Alterna entre branches ou restaura arquivos no repositório.', enabled: false },
  { id: 'git_branch', name: 'git_branch', description: 'Lista e gerencia branches locais e remotas.', enabled: true },
];

const DEFAULT_EXA_TOOLS: PresetMcpTool[] = [
  { id: 'web_search_exa', name: 'web_search_exa', description: 'Realiza buscas neurais e semânticas avançadas na web via Exa.ai.', enabled: true },
  { id: 'web_fetch_exa', name: 'web_fetch_exa', description: 'Extrai conteúdo limpo em Markdown diretamente de URLs da web.', enabled: true },
  { id: 'web_search_advanced_exa', name: 'web_search_advanced_exa', description: 'Busca neural avançada com filtragem de domínios e parâmetros customizados.', enabled: true },
];

export const McpSettingsSection: React.FC<McpSettingsSectionProps> = ({
  mcpServers,
  onSaveMcpServers,
  onTestMcp,
}) => {
  const [editingMcp, setEditingMcp] = useState<McpConfig | null>(null);
  const [isNewMcp, setIsNewMcp] = useState(false);
  const [mcpTestResult, setMcpTestResult] = useState<
    Record<string, { loading: boolean; message: string; success?: boolean }>
  >({});

  // Preset Tools State (Git and Exa)
  const [gitTools, setGitTools] = useState<PresetMcpTool[]>(() => {
    try {
      const saved = localStorage.getItem('mcp_preset_git_tools');
      return saved ? JSON.parse(saved) : DEFAULT_GIT_TOOLS;
    } catch {
      return DEFAULT_GIT_TOOLS;
    }
  });

  const [exaTools, setExaTools] = useState<PresetMcpTool[]>(() => {
    try {
      const saved = localStorage.getItem('mcp_preset_exa_tools');
      return saved ? JSON.parse(saved) : DEFAULT_EXA_TOOLS;
    } catch {
      return DEFAULT_EXA_TOOLS;
    }
  });

  const toggleGitTool = (id: string) => {
    setGitTools((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t));
      try { localStorage.setItem('mcp_preset_git_tools', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const toggleExaTool = (id: string) => {
    setExaTools((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t));
      try { localStorage.setItem('mcp_preset_exa_tools', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const testMcp = async (mcp: McpConfig) => {
    setMcpTestResult((prev) => ({ ...prev, [mcp.name]: { loading: true, message: 'Testando processo...' } }));
    try {
      const res = await onTestMcp(mcp);
      setMcpTestResult((prev) => ({
        ...prev,
        [mcp.name]: { loading: false, message: res.message, success: res.success },
      }));
    } catch (err: any) {
      setMcpTestResult((prev) => ({
        ...prev,
        [mcp.name]: { loading: false, message: err.message, success: false },
      }));
    }
  };

  return (
    <div className="space-y-5 max-w-3xl text-xs">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-blue-500" />
            <span>Servidores e Ferramentas MCP (Model Context Protocol)</span>
          </h4>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Gerencie integrações ativas de ferramentas externas do Gemini CLI.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingMcp({ name: '', command: '', args: [], enabled: true });
            setIsNewMcp(true);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 cursor-pointer shadow-2xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Nova MCP</span>
        </button>
      </div>

      {/* 1. Ferramentas Fornecidas pelo Git */}
      <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <GitBranch className="w-4 h-4" />
            </div>
            <div>
              <h5 className="font-bold text-xs text-zinc-900 dark:text-zinc-100">
                Ferramentas MCP Fornecidas pelo Git (@modelcontextprotocol/server-git)
              </h5>
              <p className="text-[10px] text-zinc-500">
                Ative ou desative ferramentas operacionais de controle de versão Git.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
            {gitTools.filter((t) => t.enabled).length}/{gitTools.length} Ativas
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
          {gitTools.map((tool) => (
            <div
              key={tool.id}
              onClick={() => toggleGitTool(tool.id)}
              className={`p-2 rounded-lg border transition cursor-pointer flex items-start justify-between gap-2 select-none ${
                tool.enabled
                  ? 'border-blue-300 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/20'
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 opacity-60'
              }`}
            >
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-[11px] text-zinc-800 dark:text-zinc-200">
                    {tool.name}
                  </span>
                </div>
                <p className="text-[10px] text-zinc-500 leading-tight">
                  {tool.description}
                </p>
              </div>

              <div className="shrink-0 pt-0.5">
                {tool.enabled ? (
                  <ToggleRight className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                ) : (
                  <ToggleLeft className="w-5 h-5 text-zinc-400" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Ferramentas Fornecidas pelo EXA MCP (Exa.ai Busca Neural) */}
      <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h5 className="font-bold text-xs text-zinc-900 dark:text-zinc-100">
                Ferramentas MCP Fornecidas pelo EXA (Exa Neural Search MCP)
              </h5>
              <p className="text-[10px] text-zinc-500">
                Ative ou desative capacidades de busca e extração neural na web via Exa.ai.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
            {exaTools.filter((t) => t.enabled).length}/{exaTools.length} Ativas
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
          {exaTools.map((tool) => (
            <div
              key={tool.id}
              onClick={() => toggleExaTool(tool.id)}
              className={`p-2 rounded-lg border transition cursor-pointer flex items-start justify-between gap-2 select-none ${
                tool.enabled
                  ? 'border-purple-300 dark:border-purple-900/60 bg-purple-50/30 dark:bg-purple-950/20'
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 opacity-60'
              }`}
            >
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-[11px] text-zinc-800 dark:text-zinc-200">
                    {tool.name}
                  </span>
                </div>
                <p className="text-[10px] text-zinc-500 leading-tight">
                  {tool.description}
                </p>
              </div>

              <div className="shrink-0 pt-0.5">
                {tool.enabled ? (
                  <ToggleRight className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                ) : (
                  <ToggleLeft className="w-5 h-5 text-zinc-400" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Lista de Servidores MCP Configurados */}
      <div className="space-y-2">
        <h5 className="font-bold text-xs text-zinc-800 dark:text-zinc-200">
          Servidores MCP Adicionais
        </h5>
        {mcpServers.map((server) => {
          const testState = mcpTestResult[server.name];
          return (
            <div
              key={server.name}
              className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs text-zinc-900 dark:text-zinc-100">
                    {server.name}
                  </span>
                  <span
                    className={`text-[9px] uppercase font-semibold px-1.5 py-0.2 rounded ${
                      server.enabled
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400'
                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500'
                    }`}
                  >
                    {server.enabled ? 'Ativo' : 'Desativado'}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => testMcp(server)}
                    disabled={testState?.loading}
                    className="flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-medium rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition cursor-pointer"
                  >
                    <Play className="w-2.5 h-2.5" />
                    <span>{testState?.loading ? 'Testando...' : 'Testar'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMcp({ ...server });
                      setIsNewMcp(false);
                    }}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (confirm(`Deseja remover o servidor MCP ${server.name}?`)) {
                        await onSaveMcpServers(mcpServers.filter((m) => m.name !== server.name));
                      }
                    }}
                    className="p-1 rounded text-rose-400 hover:text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="text-[10px] font-mono bg-zinc-50 dark:bg-zinc-950 p-2 rounded border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 truncate">
                {server.command ? (
                  <span>{server.command} {server.args?.join(' ')}</span>
                ) : server.httpUrl ? (
                  <span className="text-blue-600 dark:text-blue-400">HTTP: {server.httpUrl}</span>
                ) : server.url ? (
                  <span className="text-emerald-600 dark:text-emerald-400">SSE: {server.url}</span>
                ) : (
                  <span className="text-zinc-400 italic">Sem configuração</span>
                )}
              </div>

              {testState && (
                <div
                  className={`text-[10px] p-2 rounded flex items-center gap-1.5 ${
                    testState.success
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {testState.success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <div className="flex-1 font-mono text-[9.5px] truncate">
                    {testState.message}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit MCP Modal */}
      {editingMcp && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-md p-5 space-y-3 shadow-xl text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
              <h4 className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                {isNewMcp ? 'Adicionar Servidor MCP' : `Editar MCP: ${editingMcp.name}`}
              </h4>
              <button
                type="button"
                onClick={() => setEditingMcp(null)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-[11px]">
              <div>
                <label className="block text-zinc-500 mb-0.5">Nome do Servidor</label>
                <input
                  type="text"
                  disabled={!isNewMcp}
                  value={editingMcp.name}
                  onChange={(e) => setEditingMcp({ ...editingMcp, name: e.target.value })}
                  className="w-full px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-zinc-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-zinc-500 mb-0.5">Comando Binário / Pacote</label>
                <input
                  type="text"
                  placeholder="ex: npx ou node"
                  value={editingMcp.command || ''}
                  onChange={(e) => setEditingMcp({ ...editingMcp, command: e.target.value })}
                  className="w-full px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-zinc-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-zinc-500 mb-0.5">Argumentos (separados por espaço)</label>
                <input
                  type="text"
                  placeholder="ex: -y @modelcontextprotocol/server-git"
                  value={editingMcp.args ? editingMcp.args.join(' ') : ''}
                  onChange={(e) =>
                    setEditingMcp({
                      ...editingMcp,
                      args: e.target.value.split(' ').filter(Boolean),
                    })
                  }
                  className="w-full px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-zinc-900 dark:text-zinc-100"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="mcp-enabled"
                  checked={editingMcp.enabled}
                  onChange={(e) => setEditingMcp({ ...editingMcp, enabled: e.target.checked })}
                  className="rounded text-blue-600 cursor-pointer"
                />
                <label htmlFor="mcp-enabled" className="text-zinc-700 dark:text-zinc-300 font-medium cursor-pointer">
                  Servidor Habilitado
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setEditingMcp(null)}
                className="px-2.5 py-1 text-zinc-500 cursor-pointer text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  const existingIndex = mcpServers.findIndex((m) => m.name === editingMcp.name);
                  let updated: McpConfig[];
                  if (existingIndex >= 0) {
                    updated = [...mcpServers];
                    updated[existingIndex] = editingMcp;
                  } else {
                    updated = [...mcpServers, editingMcp];
                  }
                  await onSaveMcpServers(updated);
                  setEditingMcp(null);
                }}
                className="px-3 py-1 text-xs font-semibold rounded bg-blue-600 text-white cursor-pointer hover:bg-blue-700 transition"
              >
                Salvar Servidor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
