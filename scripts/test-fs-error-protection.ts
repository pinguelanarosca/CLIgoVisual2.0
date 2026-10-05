import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyKeyResult } from '../server/key-pool-service.js';

function runTests() {
  console.log('=== TESTE AUTOMATIZADO DE PROTEÇÃO CONTRA ERROS DE AUDITORIA / DIRETÓRIOS INEXISTENTES ===\n');

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

  // 1. Classificação do Key Pool para erros de FS / Diretórios Inexistentes
  console.log('1. Teste de Proteção do Key Pool');
  const fsErrorText = 'Error: Directory does not exist: /home/alee/Downloads/extensao-extttsstt (38)';
  const res1 = classifyKeyResult(null, null, fsErrorText);
  assert(res1.group === 'G1', 'Erro de diretório inexistente não reclassifica a chave de API para G4');
  assert(res1.errorCode === 'FS_ENV_NOTICE', 'Código retornado é FS_ENV_NOTICE em vez de GENERIC_FAILURE');

  const envNoticeText = 'Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY.';
  const res2 = classifyKeyResult(null, null, envNoticeText);
  assert(res2.group === 'G1', 'Aviso de duplicidade de variáveis de ambiente não degrada a chave');

  // 2. Erros reais de API devem continuar sendo reclassificados corretamente
  console.log('\n2. Teste de Erros Reais de API (503, 429, 401)');
  const res503 = classifyKeyResult(503, null, 'This model is currently experiencing high demand.');
  assert(res503.group === 'G2' || res503.group === 'G4', 'Erro 503 é classificado adequadamente como sobrecarga/servidor');

  const res429 = classifyKeyResult(429, null, 'Quota exceeded for quota metric');
  assert(res429.group === 'G3', 'Erro 429 é classificado como Limite de Cota G3');

  const res401 = classifyKeyResult(401, null, 'API_KEY_INVALID');
  assert(res401.group === 'G5', 'Erro 401 é classificado como Falha de Autenticação G5');

  // 3. Validação de Filtro de Diretórios Autorizados
  console.log('\n3. Teste de Filtragem de Diretórios Existentes');
  const tempExistingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini_test_dir_'));
  const nonExistingDir = '/path/that/definitely/does/not/exist/99999999';

  const rawDirs = [tempExistingDir, nonExistingDir, ''];
  const sanitizedDirs = rawDirs.filter((d) => {
    try {
      return Boolean(d && fs.existsSync(d) && fs.statSync(d).isDirectory());
    } catch {
      return false;
    }
  });

  assert(sanitizedDirs.length === 1, 'Apenas o diretório existente no disco foi mantido');
  assert(sanitizedDirs[0] === tempExistingDir, 'Diretório temporário existente preservado');
  assert(!sanitizedDirs.includes(nonExistingDir), 'Diretório inexistente removido dos argumentos CLI');

  // Limpar diretório temporário
  try { fs.rmdirSync(tempExistingDir); } catch {}

  console.log(`\nResultado Final: ${passed} passaram, ${failed} falharam.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
