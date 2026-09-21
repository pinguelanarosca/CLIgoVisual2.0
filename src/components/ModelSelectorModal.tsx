import React, { useState } from 'react';
import { X, Search, Check, Sparkles, Cpu, Mic, Bot, Boxes, Database, Binary, Info } from 'lucide-react';
import { ModelCatalogItem } from '../types.js';
import { MODELS_CATALOG } from '../constants/modelsCatalog.js';

interface ModelSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentModel: string;
  agentName?: string;
  onSelectModel: (modelId: string) => void;
}

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
  isOpen,
  onClose,
  currentModel,
  agentName,
  onSelectModel,
}) => {
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  if (!isOpen) return null;

  const groups = [
    { id: 'all', label: 'Todos os Modelos', icon: Cpu },
    { id: 'text', label: '1. Texto Geral (Txt Out)', icon: Cpu },
    { id: 'audio', label: '2. Voz & Áudio Live', icon: Mic },
    { id: 'agents', label: '3. Agentes & Automação', icon: Bot },
    { id: 'robotics', label: '4. Robótica', icon: Boxes },
    { id: 'embeddings', label: '5. Embeddings', icon: Database },
    { id: 'gemma', label: '6. Família Gemma', icon: Binary },
  ];

  const filteredModels = MODELS_CATALOG.filter((item) => {
    const matchesGroup = selectedGroup === 'all' || item.group === selectedGroup;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      item.name.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      (item.subFunction && item.subFunction.toLowerCase().includes(q)) ||
      (item.description && item.description.toLowerCase().includes(q));
    return matchesGroup && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/80 dark:bg-zinc-900/80 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
                <Cpu className="w-4 h-4" />
              </span>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-base">
                Catálogo & Seletor Oficial de Modelos
              </h3>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              {agentName ? (
                <span>
                  Selecione o modelo operacional para o agente <strong>{agentName}</strong>
                </span>
              ) : (
                'Catálogo oficial de modelos, cotas de requisição (RPM / TPM / RPD) e categorias de aplicação.'
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Priority Banner for Text Models */}
        <div className="bg-blue-50/80 dark:bg-blue-950/40 border-b border-blue-200/60 dark:border-blue-900/60 px-4 sm:px-5 py-2.5 flex items-start sm:items-center gap-2.5 text-xs text-blue-900 dark:text-blue-200 shrink-0">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5 sm:mt-0" />
          <div className="leading-snug">
            <span className="font-semibold">Prioridade prática para uso geral de texto: </span>
            <span className="font-mono text-[11px] text-blue-800 dark:text-blue-300">
              Gemini 3.8 Flash → 3.7 → 3.6 → 3.5 → 3 → 3.1 Flash Lite → 2.5 Flash → 2.5 Flash Lite → 3.5 Flash Lite
            </span>
          </div>
        </div>

        {/* Search and Category Filter Toolbar */}
        <div className="p-3 sm:p-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shrink-0">
          <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-thin">
            {groups.map((grp) => {
              const Icon = grp.icon;
              const active = selectedGroup === grp.id;
              return (
                <button
                  key={grp.id}
                  onClick={() => setSelectedGroup(grp.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{grp.label}</span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar modelo, cota ou tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Table View */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xs">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-100/80 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300 font-semibold border-b border-zinc-200 dark:border-zinc-700">
                  <th className="py-2.5 px-3 text-center w-14">Ordem</th>
                  <th className="py-2.5 px-3">Modelo</th>
                  <th className="py-2.5 px-3 text-center w-24">RPM</th>
                  <th className="py-2.5 px-3 text-center w-20">TPM</th>
                  <th className="py-2.5 px-3 text-center w-24">RPD</th>
                  <th className="py-2.5 px-3 text-center w-24">Categoria</th>
                  <th className="py-2.5 px-3">Finalidade / Papel Recomendado</th>
                  <th className="py-2.5 px-3 text-right w-28">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
                {filteredModels.map((item) => {
                  const isCurrent = currentModel === item.id;
                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition ${
                        isCurrent ? 'bg-blue-50/40 dark:bg-blue-900/10 font-medium' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center font-bold text-zinc-500 dark:text-zinc-400">
                        {item.order}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-col">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                            {item.name}
                            {isCurrent && (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                                Ativo
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                            {item.id}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                          {item.rpm}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                          {item.tpm}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                          {item.rpd}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            item.category === 'Txt Out'
                              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                              : item.category === 'API Live'
                              ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                              : item.category === 'Multimod'
                              ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                              : item.category === 'Agents'
                              ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                          }`}
                        >
                          {item.category}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-col">
                          {item.recommendedRole && (
                            <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                              <Sparkles className="w-3 h-3" />
                              Padrão para: {item.recommendedRole}
                            </span>
                          )}
                          {item.subFunction && (
                            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                              {item.subFunction}
                            </span>
                          )}
                          <span className="text-zinc-500 dark:text-zinc-400 text-[11px] line-clamp-1">
                            {item.description}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectModel(item.id);
                            onClose();
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                            isCurrent
                              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                              : 'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                        >
                          {isCurrent ? 'Selecionado' : 'Selecionar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/80 flex items-center justify-between shrink-0">
          <div className="text-xs text-zinc-500">
            Total de modelos no catálogo: <strong>{MODELS_CATALOG.length}</strong>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
