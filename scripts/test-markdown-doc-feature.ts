import { isLongMarkdownText, extractDocumentTitle, getMarkdownStats, LONG_TEXT_THRESHOLD_CHARS, LONG_TEXT_THRESHOLD_WORDS } from '../src/utils/markdownDocUtils.js';

function runTests() {
  console.log('=== TESTE AUTOMATIZADO DE DOCUMENTOS MARKDOWN (.MD) NO CHAT ===\n');

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

  // 1. Detecção de Textos Longos (Threshold)
  console.log('1. Detecção de Textos Curtos vs Textos Longos');
  const shortText = 'Esta é uma resposta curta e direta do assistente.';
  assert(!isLongMarkdownText(shortText), 'Texto curto não é classificado como longo');
  assert(!isLongMarkdownText(null), 'Texto nulo retorna false');
  assert(!isLongMarkdownText(''), 'Texto vazio retorna false');

  const longTextByChars = 'A'.repeat(LONG_TEXT_THRESHOLD_CHARS + 50);
  assert(isLongMarkdownText(longTextByChars), 'Texto acima do limite de caracteres é classificado como longo');

  const mediumText = Array(450).fill('resposta comum').join(' ');
  assert(!isLongMarkdownText(mediumText), 'Resposta média de 900 palavras permanece no chat');
  assert(!isLongMarkdownText(Array(40).fill('Item').join('\n')), 'Linhas curtas não forçam compactação');
  assert(isLongMarkdownText(Array(LONG_TEXT_THRESHOLD_WORDS).fill('x').join(' ')), 'Limiar de palavras compacta texto realmente longo');

  // 2. Extração de Título do Documento
  console.log('\n2. Extração Inteligente do Título do Documento .md');
  const docWithH1 = '# Relatório de Análise da Extensão\n\nEste documento contém a investigação técnica detalhada.';
  assert(
    extractDocumentTitle(docWithH1) === 'relatorio_de_analise_da_extensao.md',
    'Extrai título limpo a partir de cabeçalho H1 (# Título)'
  );

  const docWithH2 = '## Auditoria de Segurança e Vulnerabilidades\n\nVerificamos os arquivos.';
  assert(
    extractDocumentTitle(docWithH2) === 'auditoria_de_seguranca_e_vulnerabilidades.md',
    'Extrai título limpo a partir de cabeçalho H2 (## Subtítulo)'
  );

  const docWithBold = '**Plano de Arquitetura e Refatoração**\n\n1. Passo 1\n2. Passo 2';
  assert(
    extractDocumentTitle(docWithBold) === 'plano_de_arquitetura_e_refatoracao.md',
    'Extrai título a partir de negrito inicial (**Título**)'
  );

  const docWithoutHeader = 'Este é um documento de texto longo sem cabeçalho específico.\nLinha 2\nLinha 3';
  const extractedPlain = extractDocumentTitle(docWithoutHeader);
  assert(
    extractedPlain.endsWith('.md') && extractedPlain.length > 5,
    'Gera título válido com extensão .md para documento sem cabeçalho explícito'
  );

  // 3. Cálculo de Estatísticas do Documento Markdown
  console.log('\n3. Métricas e Estatísticas do Documento');
  const sampleDoc = `# Guia de Desenvolvimento\n\nEste é um parágrafo explicativo com várias palavras para teste de estatísticas.\n\n\`\`\`ts\nconst x = 10;\n\`\`\`\n`;
  const stats = getMarkdownStats(sampleDoc);

  assert(stats.chars > 50, 'Contagem de caracteres positiva');
  assert(stats.words > 10, 'Contagem de palavras calculada');
  assert(stats.lines >= 6, 'Contagem de linhas confere');
  assert(stats.kb.includes('KB'), 'Formato de tamanho em KB presente');
  assert(stats.readTimeMin >= 1, 'Tempo estimado de leitura calculado');

  // 4. Simulação do Caso Real do Usuário (Relatório do Subagente Investigator / Auditor)
  console.log('\n4. Simulação do Cenário Real (Relatório Extenso de Subagente)');
  const realReport = `# Análise Técnica da Extensão do Chrome

## 1. Visão Geral e Arquitetura
A extensão opera no formato Manifest V3 e possui os seguintes módulos principais:
- **background.js**: Gerencia eventos de ciclo de vida e requisições externas.
- **content.js**: Injeta lógica de automação e manipulação de DOM na página ativa.
- **popup.js**: Fornece a interface visual de interação do usuário.
- **options.js**: Permite personalização das configurações.

## 2. Diagnóstico de Segurança
1. Não foram detectadas chaves de API expostas em texto puro nos arquivos inspecionados.
2. Tratamento assíncrono necessita de encapsulamento com try/catch nos listeners do background.
3. Content Security Policy (CSP) em conformidade com as regras da Chrome Web Store.

## 3. Recomendações Técnicas
- Modularizar funções utilitárias em arquivos dedicados.
- Implementar debounce nos eventos de scroll e digitação no content.js.
`;

  assert(!isLongMarkdownText(realReport), 'Relatório de poucas centenas de palavras permanece no chat');
  const realTitle = extractDocumentTitle(realReport);
  assert(realTitle === 'analise_tecnica_da_extensao_do_chrome.md', 'Título do relatório extraído perfeitamente');

  console.log(`\nResultado Final: ${passed} passaram, ${failed} falharam.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
