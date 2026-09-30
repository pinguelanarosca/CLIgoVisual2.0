import { SystemLogEntry } from '../types.js';

export type LogExportFormat = 'txt' | 'log' | 'json' | 'csv' | 'md';
export type LogExportScope = 'all' | 'filtered' | 'errors_warnings';

export interface FormattedLogExport {
  content: string;
  mimeType: string;
  extension: string;
  filename: string;
  totalLogs: number;
}

export function filterLogsByScope(
  allLogs: SystemLogEntry[],
  filteredLogs: SystemLogEntry[],
  scope: LogExportScope
): SystemLogEntry[] {
  switch (scope) {
    case 'filtered':
      return filteredLogs;
    case 'errors_warnings':
      return allLogs.filter((l) => l.level === 'error' || l.level === 'warn');
    case 'all':
    default:
      return allLogs;
  }
}

export function formatLogsForExport(
  logs: SystemLogEntry[],
  format: LogExportFormat = 'txt',
  options?: {
    includeDetails?: boolean;
    customFilename?: string;
  }
): FormattedLogExport {
  const includeDetails = options?.includeDetails !== false;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  if (format === 'json') {
    const data = includeDetails
      ? logs
      : logs.map(({ details, ...rest }) => rest);

    const ext = 'json';
    const filename = options?.customFilename?.trim()
      ? (options.customFilename.endsWith('.json') ? options.customFilename : `${options.customFilename}.json`)
      : `gemini_gui_logs_${timestamp}.json`;

    return {
      content: JSON.stringify(data, null, 2),
      mimeType: 'application/json; charset=utf-8',
      extension: ext,
      filename,
      totalLogs: logs.length,
    };
  }

  if (format === 'csv') {
    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      return `"${str.replace(/"/g, '""')}"`;
    };

    const header = ['"ID"', '"Data/Hora"', '"Timestamp_ISO"', '"Nível"', '"Categoria"', '"Origem"', '"Mensagem"', '"Detalhes"'].join(',');
    const rows = logs.map((l) => [
      escapeCsv(l.id),
      escapeCsv(l.formattedDateTime),
      escapeCsv(l.timestamp),
      escapeCsv(l.level.toUpperCase()),
      escapeCsv(l.category),
      escapeCsv(l.source || ''),
      escapeCsv(l.message),
      escapeCsv(includeDetails ? l.details || '' : ''),
    ].join(','));

    const ext = 'csv';
    const filename = options?.customFilename?.trim()
      ? (options.customFilename.endsWith('.csv') ? options.customFilename : `${options.customFilename}.csv`)
      : `gemini_gui_logs_${timestamp}.csv`;

    return {
      content: [header, ...rows].join('\n'),
      mimeType: 'text/csv; charset=utf-8',
      extension: ext,
      filename,
      totalLogs: logs.length,
    };
  }

  if (format === 'md') {
    const countsByLevel: Record<string, number> = {};
    for (const l of logs) {
      countsByLevel[l.level] = (countsByLevel[l.level] || 0) + 1;
    }

    const summaryRows = Object.entries(countsByLevel)
      .map(([lvl, cnt]) => `| ${lvl.toUpperCase()} | ${cnt} |`)
      .join('\n');

    const logItems = logs
      .map((l) => {
        const detailsMd =
          includeDetails && l.details
            ? `\n\`\`\`json\n${typeof l.details === 'object' ? JSON.stringify(l.details, null, 2) : l.details}\n\`\`\``
            : '';
        return `### [${l.formattedDateTime}] [${l.level.toUpperCase()}] \`${l.category}\`${l.source ? ` (${l.source})` : ''}\n**Mensagem:** ${l.message}${detailsMd}\n`;
      })
      .join('\n---\n\n');

    const mdContent = `# Relatório de Logs do Sistema (CLIgoVisual2.0)
**Gerado em:** ${new Date().toLocaleString('pt-BR')}  
**Total de Registros:** ${logs.length}

## Resumo por Nível
| Nível | Contagem |
|---|---|
${summaryRows || '| Nenhum | 0 |'}

## Detalhamento dos Registros
${logItems || '_Nenhum registro encontrado._'}
`;

    const ext = 'md';
    const filename = options?.customFilename?.trim()
      ? (options.customFilename.endsWith('.md') ? options.customFilename : `${options.customFilename}.md`)
      : `gemini_gui_logs_${timestamp}.md`;

    return {
      content: mdContent,
      mimeType: 'text/markdown; charset=utf-8',
      extension: ext,
      filename,
      totalLogs: logs.length,
    };
  }

  // Fallback: Formato de Texto Plano (.log ou .txt)
  const ext = format === 'log' ? 'log' : 'txt';
  const text = logs
    .map((l) => {
      const detailsStr =
        includeDetails && l.details
          ? ` | Detalhes: ${typeof l.details === 'object' ? JSON.stringify(l.details) : l.details}`
          : '';
      const srcStr = l.source ? ` [Origem: ${l.source}]` : '';
      return `[${l.formattedDateTime}] [${l.level.toUpperCase().padEnd(7)}] [${l.category.padEnd(8)}]${srcStr} ${l.message}${detailsStr}`;
    })
    .join('\n');

  const filename = options?.customFilename?.trim()
    ? (options.customFilename.endsWith(`.${ext}`) ? options.customFilename : `${options.customFilename}.${ext}`)
    : `gemini_gui_logs_${timestamp}.${ext}`;

  return {
    content: text,
    mimeType: 'text/plain; charset=utf-8',
    extension: ext,
    filename,
    totalLogs: logs.length,
  };
}

export function downloadLogsAsFile(
  content: string,
  filename: string,
  mimeType: string = 'text/plain; charset=utf-8'
): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
