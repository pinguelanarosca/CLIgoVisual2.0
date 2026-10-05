# Correções da auditoria — CLIgoVisual

Os 16 achados foram confirmados no código e corrigidos. As verificações abaixo distinguem execução local real de simulação dos serviços externos.

| Item | Causa confirmada e correção aplicada | Código principal |
| --- | --- | --- |
| 1 · P1 | Atualizações de metadados podiam substituir mensagens vazias. PATCH altera metadados; PUT substitui mensagens sem sobrescrever título, arquivamento ou projeto alterados durante a execução. UPSERT substitui o REPLACE destrutivo. | [SQLite](server/session-sqlite-service.ts#L110), [interface](src/App.tsx#L1393) |
| 2 · P1 | Inserções inválidas deixavam gravações parciais. Validação precede a gravação; a sessão e suas mensagens são gravadas em transação, com rollback e erro propagado. | [Validação e transações](server/session-sqlite-service.ts#L60) |
| 3 · P1 | Backup continha resumos e a restauração escrevia no armazenamento antigo. Exportação inclui mensagens e diagnósticos completos; importação é diretamente no SQLite, com validação integral, transação e backup consistente prévio. | [Exportação/importação](server/session-sqlite-service.ts#L107) |
| 4 · P1 | Sincronização apagava agentes e sobrescrevia configurações pessoais. Manifesto de propriedade e hashes restringem alterações; leitura de projetos não grava defaults; MCPs, políticas e acknowledgments pessoais são preservados. JSON inválido interrompe a gravação. | [Agentes](server/agents-service.ts#L983), [MCP](server/mcp-service.ts#L131) |
| 5 · P1 | Falha de merge acionava reset automático. Atualização normal exige árvore limpa e fast-forward; reset exige escolha explícita de descarte na interface. | [Git](server/git-updater-service.ts#L273) |
| 6 · P1 | Carga inicial e fallback consultavam listas antigas e podiam executar em outro diretório. Seleção recebe projetos/sessões recém-carregados, ignora respostas atrasadas e bloqueia execução sem diretório correspondente. Backend também valida projeto e diretório. | [Seleção](src/App.tsx#L392), [execução](server.ts#L455) |
| 7 · P1 | Recuperações recursivas não tinham limite global, UUID divergia da GUI e desconexão não cancelava o CLI. Recuperação tem orçamento global, UUID normalizado é comunicado e persistido separadamente; desconexão encerra a execução. IDs duplicados são rejeitados. | [Executor](server/gemini-cli-service.ts#L1086), [SSE](server.ts#L549) |
| 8 · P1 | Instaladores aceitavam Node sem o suporte atual a node:sqlite. Engines, pacote Debian, instaladores e launchers exigem Node ≥22.13.0 e verificam o módulo antes de prosseguir. | [Engine](package.json#L42), [Debian](scripts/package-ubuntu.cjs#L142) |
| 9 · P2 | A rota descartava sharedMemory. A memória é validada, encaminhada e incluída no contexto do executor e do ACP. | [Rota](server.ts#L450), [validação](server/execution-policy.ts#L2) |
| 10 · P2 | Ramificação/compressão alteravam somente a GUI, e derivação usava resumos vazios. Derivação lê a sessão completa; contexto separado é reproduzido em uma nova sessão CLI, incluindo resultados de ferramentas e preservando o histórico original. | [Contexto](src/utils/executionContext.ts#L1), [interface](src/App.tsx#L1419) |
| 11 · P2 | Erros estruturados com exit 0 e encerramento por sinal podiam parecer sucesso. Classificação considera erro estruturado, falha de API, sinal e código; Key Pool e interface recebem o resultado correto. | [Classificação](server/execution-policy.ts#L13) |
| 12 · P2 | Cada captura reenviava todo o prefixo e acumulava payloads. Streaming envia somente a nova captura; memória tem limites por quantidade/tamanho. Capturas completas permanecem em arquivos JSONL privados, com backpressure e referência nos eventos. | [Retenção](src/utils/diagnosticRetention.ts#L1), [diagnósticos](server/gemini-cli-service.ts#L1435) |
| 13 · P2 | Git/build síncronos bloqueavam o servidor e timeout podia virar sucesso. Subprocessos são assíncronos, manutenção é serializada e timeout/error/signal/status interrompem o fluxo. Saídas stdout/stderr continuam registradas. | [Processos](server/process-service.ts#L1), [build](server/git-updater-service.ts#L256) |
| 14 · P2 | --help/HTTP 200 eram aceitos como teste MCP; prazo terminava antes do corpo. Teste faz initialize → initialized → tools/list ou ping, valida JSON-RPC e mantém deadline durante conexão e leitura, incluindo SSE legado. | [Handshake MCP](server/mcp-service.ts#L292) |
| 15 · P2 | Snapshots automáticos não eram criados e ausência de arquivos não era registrada. Execução captura estados anterior/posterior; manifesto registra existência, hash e modo. Restauração recupera exclusões, cria backup e tenta rollback em falhas. | [Versões](server/versions-service.ts#L104), [captura automática](server/versions-service.ts#L157) |
| 16 · P2 | ACP reutilizava configurações incompatíveis, acumulava sessões e encerrava SSE antes do fallback. Fingerprint invalida configurações, inicialização é compartilhada, retenção limita quatro sessões e remove inativas. Fallback ocorre antes do prompt; erros posteriores não repetem trabalho. Sessão ocupada não é encerrada pela execução concorrente. | [ACP](server/acp-client.ts#L541), [fallback](server/gemini-cli-service.ts#L2347) |

**Hipóteses investigadas**

- Processos órfãos: confirmado com shell/sleep reais; matar apenas o pai deixava o filho ativo. CLI, consultas de versão, ACP, MCP stdio e manutenção agora usam grupos de processos POSIX. Cancelamento por desconexão e timeout foram verificados com filhos reais. A garantia de grupo se aplica ao Linux/POSIX; Windows não foi validado.
- Gravações JSON sobrepostas: confirmado simulando writeFile mais lento que o debounce original. O commit de storage.json agora é único e atômico, com fsync e rename; teste em disco verificou preservação do arquivo anterior diante de falha e persistência do último estado. Não foi observada corrupção de dados pessoais nem investigada escrita por múltiplas instâncias externas.

**Recuperação e preservação**

Backup de código e dados anteriores às mudanças preservado localmente, fora do conteúdo publicado, com arquivos privados em modo 0600. Não havia SQLite pessoal neste ambiente. A migração de um banco legado e a restauração criam backups SQLite com VACUUM INTO, incluindo WAL; um banco temporário validou conteúdo e integrity_check. Os cinco arquivos preexistentes de configuração do projeto mantiveram exatamente os bytes arquivados.

**Verificações executadas**

- [25 regressões](tests/regression/audit-fixes.test.mjs): todas passaram. SQLite, arquivos, grupos de processos, servidor MCP stdio e Git em repositórios temporários são reais; subprocessos Gemini, inicialização ACP, HTTP MCP e estado React são simulados. Incluem rollback por payload e trigger SQL, backup legado/WAL, rename/archive concorrentes, contexto/memória, retries, classificação e retenção.
- [Smoke HTTP](tests/regression/smoke-server.py): Express e SQLite reais, dados temporários, exportação/restauração, snapshots de criação/ausência e cancelamento de filho por desconexão SSE. O Gemini é um script Python local que emula seu protocolo; nenhuma chamada a provedores.
- Checks existentes: sessões 12/12; atividades 34/34; documentos Markdown 16/16; exportação/gravação de logs 25/25. Total: 87 asserções aprovadas.
- Build Vite + esbuild e inicialização de produção HTTP passaram. bash -n install.sh e node --check scripts/package-ubuntu.cjs passaram; instalador/empacotamento destrutivo não foram executados.
- Lint: 28 diagnósticos preexistentes; baseline tinha 30, com o mesmo compilador. Nenhum diagnóstico novo na comparação por arquivo/mensagem. Teste unitário do Key Pool falha na exigência de pelo menos oito modelos: código original e atual contêm seis. O logger faz esse script terminar com código zero apesar da falha; ele não foi contabilizado como aprovado.

**Limitações**

Node disponível: 22.23.3. Dependências já presentes no ambiente foram usadas temporariamente, sem instalação; Vite 8.3.2 e TypeScript 7.0.2 diferem das versões declaradas. Os vínculos temporários foram removidos; não existe instalação completa do Gemini CLI neste checkout. Não foram realizados testes pagos, uso real de provedores, ACP com Gemini real, MCP remoto ou atualização do repositório oficial. O checkout de auditoria não tinha metadados Git utilizáveis; fast-forward, árvore suja e divergência foram verificados em repositórios locais temporários.

Snapshots antigos sem manifesto não permitem inferir ausências anteriores. Captura automática ignora caches/diretórios privados, links simbólicos e interrompe com diagnóstico acima de 10 mil arquivos ou 256 MiB. O build emitiu avisos de bundle grande e compatibilidade da configuração com a versão de Vite disponível. Não houve teste visual no navegador.
