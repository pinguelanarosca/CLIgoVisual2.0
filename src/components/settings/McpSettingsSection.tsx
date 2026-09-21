import React, { useState } from 'react';
import { Plus, Play, Sliders, Trash2, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { McpConfig } from '../../types.js';

interface McpSettingsSectionProps {
  mcpServers: McpConfig[];
  onSaveMcpServers: (servers: McpConfig[]) => Promise<void>;
  onTestMcp: (mcp: McpConfig) => Promise<{ success: boolean; message: string }>;
}

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Model Context Protocol (MCP) no Gemini CLI
          </h4>
          <p className="text-xs text-zinc-500 mt-1">
            Configuração de servidores MCP em <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">.gemini/settings.json</code>.
          </p>
        </div>
        <button
          onClick={() => {
            setEditingMcp({ name: '', command: '', args: [], enabled: true });
            setIsNewMcp(true);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Nova MCP</span>
        </button>
      </div>

      <div className="space-y-3">
        {mcpServers.map((server) => {
          const testState = mcpTestResult[server.name];
          return (
            <div
              key={server.name}
              className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs text-zinc-900 dark:text-zinc-100">
                    {server.name}
                  </span>
                  <span
                    className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                      server.enabled
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400'
                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500'
                    }`}
                  >
                    {server.enabled ? 'Ativo' : 'Desativado'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => testMcp(server)}
                    disabled={testState?.loading}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    <span>{testState?.loading ? 'Testando...' : 'Testar Conexão'}</span>
                  </button>
                  <button
                    onClick={() => {
                      setEditingMcp({ ...server });
                      setIsNewMcp(false);
                    }}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    <Sliders className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm(`Deseja remover o servidor MCP ${server.name}?`)) {
                        await onSaveMcpServers(mcpServers.filter((m) => m.name !== server.name));
                      }
                    }}
                    className="p-1.5 rounded-lg text-rose-400 hover:text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="text-xs font-mono bg-white dark:bg-zinc-900 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300">
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
                  className={`text-xs p-2.5 rounded-lg flex items-center gap-2 ${
                    testState.success
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {testState.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 overflow-auto max-h-48 whitespace-pre-wrap font-mono text-[10px]">
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
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                {isNewMcp ? 'Adicionar Novo Servidor MCP' : `Editar MCP: ${editingMcp.name}`}
              </h4>
              <button onClick={() => setEditingMcp(null)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-zinc-500 mb-1 font-semibold">Identificador (ID)</label>
                <input
                  type="text"
                  disabled={!isNewMcp}
                  value={editingMcp.name}
                  onChange={(e) => setEditingMcp({ ...editingMcp, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-zinc-900 dark:text-zinc-100 disabled:opacity-50"
                  placeholder="ex: github-mcp"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-1 font-semibold">Comando Executável (Stdio)</label>
                <input
                  type="text"
                  value={editingMcp.command || ''}
                  onChange={(e) => setEditingMcp({ ...editingMcp, command: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-zinc-900 dark:text-zinc-100"
                  placeholder="ex: npx, node, python3"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-1 font-semibold">Argumentos (Um por linha)</label>
                <textarea
                  rows={2}
                  value={editingMcp.args?.join('\n') || ''}
                  onChange={(e) => setEditingMcp({ ...editingMcp, args: e.target.value.split('\n') })}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-zinc-900 dark:text-zinc-100"
                  placeholder="-y&#10;@modelcontextprotocol/server-github"
                />
              </div>
              <div className="pt-1 border-t border-zinc-100 dark:border-zinc-800">
                <label className="block text-zinc-500 mb-1 font-semibold">HTTP URL (Streamable HTTP)</label>
                <input
                  type="text"
                  value={editingMcp.httpUrl || ''}
                  onChange={(e) => setEditingMcp({ ...editingMcp, httpUrl: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-zinc-900 dark:text-zinc-100"
                  placeholder="http://localhost:3001/mcp"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-1 font-semibold">SSE URL (Server-Sent Events)</label>
                <input
                  type="text"
                  value={editingMcp.url || ''}
                  onChange={(e) => setEditingMcp({ ...editingMcp, url: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-zinc-900 dark:text-zinc-100"
                  placeholder="http://localhost:3000/sse"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="mcp-enabled"
                  checked={editingMcp.enabled}
                  onChange={(e) => setEditingMcp({ ...editingMcp, enabled: e.target.checked })}
                  className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="mcp-enabled" className="text-zinc-700 dark:text-zinc-300 font-semibold cursor-pointer">
                  Servidor Ativado
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditingMcp(null)} className="px-3 py-1.5 text-xs text-zinc-500 cursor-pointer">
                Cancelar
              </button>
              <button
                disabled={!editingMcp.name || (!editingMcp.command && !editingMcp.httpUrl && !editingMcp.url)}
                onClick={async () => {
                  let newList: McpConfig[];
                  if (isNewMcp) {
                    newList = [...mcpServers, editingMcp];
                  } else {
                    newList = mcpServers.map((m) => (m.name === editingMcp.name ? editingMcp : m));
                  }
                  await onSaveMcpServers(newList);
                  setEditingMcp(null);
                }}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-50 cursor-pointer hover:bg-blue-700 transition"
              >
                Salvar Servidor MCP
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
