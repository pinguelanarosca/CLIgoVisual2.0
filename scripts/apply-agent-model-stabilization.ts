import { resetAllAgentsToDefault, ensureAllAgentsSynchronizedAndAcknowledged, loadAgents } from '../server/agents-service.js';

function run() {
  console.log('=== APLICANDO ALOCAÇÃO DE MODELOS COM PRIORIDADE RPD (RPD 500: PRINCIPAL & WORKER) ===\n');

  // 1. Resetar para defaults estáveis
  const updated = resetAllAgentsToDefault();
  console.log(`✅ Agentes redefinidos para os modelos oficiais estáveis: ${updated.length} agentes.`);

  // 2. Forçar sincronização global e hashes SHA-256
  const syncResult = ensureAllAgentsSynchronizedAndAcknowledged();
  console.log(`✅ Sincronizados ${syncResult.synchronizedCount} arquivos em ${syncResult.directories.length} diretórios.`);

  // 3. Listar agentes e modelos configurados
  const loaded = loadAgents();
  console.log('\nLista de Agentes e Modelos Ativos:');
  for (const ag of loaded) {
    console.log(`  - [${ag.name}] -> Model: ${ag.model} (Fallback: ${ag.fallbackModel})`);
  }
}

run();
