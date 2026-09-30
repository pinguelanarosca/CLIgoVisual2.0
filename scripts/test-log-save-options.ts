import fs from 'node:fs';
import path from 'node:path';
import {
  formatLogsForExport,
  filterLogsByScope,
} from '../src/utils/logExportUtils.js';
import { SystemLogEntry } from '../src/types.js';
import {
  exportLogsFormatted,
  saveLogsSnapshotToDisk,
  listSavedLogFiles,
  addLog,
} from '../server/logger-service.js';

async function runTests() {
  console.log('=== TESTE AUTOMATIZADO DAS OPÇÕES PARA SALVAR LOGS ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  }

  const sampleLogs: SystemLogEntry[] = [
    {
      id: 'log-1',
      timestamp: '2026-09-30T10:00:00.000Z',
      formattedDateTime: '30/09/2026 10:00:00.000',
      level: 'info',
      category: 'SYSTEM',
      message: 'Sistema inicializado.',
      source: 'Backend',
    },
    {
      id: 'log-2',
      timestamp: '2026-09-30T10:01:00.000Z',
      formattedDateTime: '30/09/2026 10:01:00.000',
      level: 'warn',
      category: 'CLI',
      message: 'Alerta: alta latência detectada.',
      details: { latencyMs: 1450, threshold: 1000 },
      source: 'CLI',
    },
    {
      id: 'log-3',
      timestamp: '2026-09-30T10:02:00.000Z',
      formattedDateTime: '30/09/2026 10:02:00.000',
      level: 'error',
      category: 'API',
      message: 'Erro na chamada com aspas "teste" e nova linha.',
      details: 'Error 500: Internal Server Error',
      source: 'GeminiService',
    },
  ];

  // 1. Testes de Filtro de Escopo
  console.log('1. Escopo de Exportação');
  const allResult = filterLogsByScope(sampleLogs, [sampleLogs[1]], 'all');
  assert(allResult.length === 3, 'Escopo "all" inclui todos os 3 logs');

  const filteredResult = filterLogsByScope(sampleLogs, [sampleLogs[1]], 'filtered');
  assert(filteredResult.length === 1 && filteredResult[0].id === 'log-2', 'Escopo "filtered" inclui apenas os logs filtrados');

  const errorsWarnings = filterLogsByScope(sampleLogs, [sampleLogs[0]], 'errors_warnings');
  assert(errorsWarnings.length === 2, 'Escopo "errors_warnings" inclui apenas warn e error');
  assert(errorsWarnings.every((l) => l.level === 'warn' || l.level === 'error'), 'Todos os logs em errors_warnings são válidos');

  // 2. Formato Texto (.log / .txt)
  console.log('\n2. Formato Texto (.log / .txt)');
  const txtExport = formatLogsForExport(sampleLogs, 'txt');
  assert(txtExport.extension === 'txt', 'Extensão correta .txt');
  assert(txtExport.mimeType.includes('text/plain'), 'Mime type text/plain');
  assert(txtExport.content.includes('[INFO   ] [SYSTEM  ]'), 'Linha formatada de log presente');
  assert(txtExport.totalLogs === 3, 'Contador de logs confere');

  // 3. Formato JSON (.json)
  console.log('\n3. Formato JSON (.json)');
  const jsonExport = formatLogsForExport(sampleLogs, 'json');
  assert(jsonExport.extension === 'json', 'Extensão correta .json');
  assert(jsonExport.mimeType.includes('application/json'), 'Mime type application/json');
  const parsedJson = JSON.parse(jsonExport.content);
  assert(Array.isArray(parsedJson) && parsedJson.length === 3, 'JSON parseável com 3 registros');
  assert(parsedJson[1].details.latencyMs === 1450, 'Detalhes estruturados preservados no JSON');

  // 4. Formato CSV (.csv)
  console.log('\n4. Formato CSV (.csv)');
  const csvExport = formatLogsForExport(sampleLogs, 'csv');
  assert(csvExport.extension === 'csv', 'Extensão correta .csv');
  assert(csvExport.mimeType.includes('text/csv'), 'Mime type text/csv');
  assert(csvExport.content.startsWith('"ID","Data/Hora"'), 'Cabeçalho CSV padrão gerado');
  assert(csvExport.content.includes('""teste""'), 'Aspas duplas escapadas corretamente no CSV');

  // 5. Formato Markdown (.md)
  console.log('\n5. Formato Markdown (.md)');
  const mdExport = formatLogsForExport(sampleLogs, 'md');
  assert(mdExport.extension === 'md', 'Extensão correta .md');
  assert(mdExport.mimeType.includes('text/markdown'), 'Mime type text/markdown');
  assert(mdExport.content.includes('# Relatório de Logs do Sistema'), 'Título do relatório Markdown gerado');
  assert(mdExport.content.includes('## Resumo por Nível'), 'Tabela de resumo presente no Markdown');

  // 6. Testes Backend de Gravação em Disco (Server Side)
  console.log('\n6. Gravação e Listagem de Snapshots no Disco do Servidor');
  addLog('info', 'SYSTEM', 'Log de teste para gravação em disco.');

  const testFilename = `test_snapshot_${Date.now()}.log`;
  const saveResult = saveLogsSnapshotToDisk({
    format: 'log',
    customFilename: testFilename,
  });

  assert(saveResult.success === true, 'saveLogsSnapshotToDisk retornou sucesso');
  assert(fs.existsSync(saveResult.filePath), `Arquivo gravado existe no caminho: ${saveResult.filePath}`);
  assert(saveResult.sizeBytes > 0, `Arquivo gravado possui tamanho positivo (${saveResult.sizeBytes} bytes)`);

  const savedList = listSavedLogFiles();
  assert(savedList.length > 0, 'listSavedLogFiles retornou pelo menos um arquivo');
  assert(savedList.some((f) => f.name === testFilename), `Arquivo ${testFilename} encontrado na listagem`);

  // Limpeza do arquivo de teste
  try {
    fs.unlinkSync(saveResult.filePath);
    console.log(`  🧹 Arquivo temporário de teste ${testFilename} limpo com sucesso.`);
  } catch {}

  console.log(`\nResultado Final: ${passed} passaram, ${failed} falharam.`);
  if (failed > 0) process.exit(1);
}

runTests();
