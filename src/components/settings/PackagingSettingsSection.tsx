import React from 'react';
import { Package, CheckCircle2 } from 'lucide-react';
import { ValidationItem } from '../../types.js';

interface PackagingSettingsSectionProps {
  isBuildingPackage: boolean;
  handleBuildPackage: () => Promise<void>;
  packagingOutput: { files: string[]; message: string; instructions: string } | null;
  matrix: ValidationItem[];
}

export const PackagingSettingsSection: React.FC<PackagingSettingsSectionProps> = ({
  isBuildingPackage,
  handleBuildPackage,
  packagingOutput,
  matrix,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Empacotamento Standalone para Ubuntu Linux & Matriz de Validação
        </h4>
        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
          Gera pacote .deb e tarball independente para instalação direta em qualquer Ubuntu Linux.
        </p>
      </div>

      {/* Build Package Button */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/30 flex items-center justify-between">
        <div>
          <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 block">
            Gerar Pacote de Distribuição (.deb & standalone tarball)
          </span>
          <span className="text-[11px] text-zinc-500">
            Inclui binário wrapper /usr/bin/gemini-gui, atalho desktop e instalador autônomo.
          </span>
        </div>
        <button
          onClick={handleBuildPackage}
          disabled={isBuildingPackage}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition"
        >
          <Package className="w-4 h-4" />
          <span>{isBuildingPackage ? 'Compilando...' : 'Gerar Pacote Ubuntu'}</span>
        </button>
      </div>

      {packagingOutput && (
        <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20 text-xs space-y-2">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            <span>{packagingOutput.message}</span>
          </div>
          <ul className="list-disc list-inside text-zinc-600 dark:text-zinc-400 font-mono text-[11px]">
            {packagingOutput.files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <div className="mt-2 text-zinc-700 dark:text-zinc-300 font-semibold">
            Instruções: {packagingOutput.instructions}
          </div>
        </div>
      )}

      {/* Validation Matrix Table */}
      <div>
        <h5 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
          Matriz de Validação e Distinção Obrigatória de Estados
        </h5>
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 font-semibold text-[11px] uppercase border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="p-3">Recurso / Componente</th>
                <th className="p-3">Categoria</th>
                <th className="p-3">Estado Formal</th>
                <th className="p-3">Evidência / Observação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {matrix.map((row, idx) => (
                <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="p-3 font-medium text-zinc-800 dark:text-zinc-200">{row.item}</td>
                  <td className="p-3 font-mono text-[11px] text-zinc-500">{row.category}</td>
                  <td className="p-3">
                    <span
                      className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded ${
                        row.status === 'TESTED'
                          ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                          : row.status === 'CONFIGURED'
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                          : row.status === 'VALIDATED'
                          ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                          : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="p-3 text-[11px] text-zinc-500 leading-relaxed">
                    {row.evidence}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
