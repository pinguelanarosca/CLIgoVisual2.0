# Changelog

## v2.2 — 08/10/2026

Esta versão reúne os 19 commits de `main` posteriores à v2.1 e as correções locais verificadas no checkout de publicação. O histórico remoto é preservado; configurações pessoais e credenciais não integram a distribuição.

### Execução, agentes e delegação

- `invoke_agent` mantém contexto, identidade, modelo, ferramentas, resultado e cancelamento separados em invocações concorrentes. O modo **Usar Todos** preserva a execução simultânea dos cinco subagentes.
- Eventos correlacionam `executionId`, `invocationId`, `toolCallId` e `requestId`; autoria das ferramentas e retornos de `complete_task` é preservada mesmo com IDs repetidos e conclusões fora de ordem.
- Erros de delegação obrigatória chegam ao Principal e ao encerramento da execução. Resultados completos, parciais e falhas são distinguidos, sem transformar falha de um subagente em sucesso total.
- Invocações redundantes e ciclos são contidos, preservando agentes personalizados. Identidade e configuração dos aliases são comparadas antes de considerar equivalência.
- Runtime Bridge usa canal local autenticado por execução, protocolo explícito, recuperação limitada de IPC, liberação de reservas no encerramento e registros idempotentes. Falhas de comunicação preservam sua causa local.

### Key Pool, fallback e ferramentas

- Classificação distingue HTTP 429, sobrecarga HTTP 503, falhas de rede, OOM, abortos, timeout e erros locais de ferramentas. HTTP 503 não é tratado automaticamente como quota.
- Ranking, cooldown e reservas permanecem por chave/modelo; falhas locais não penalizam chaves nem desencadeiam cascatas de troca.
- Orçamento de tentativas reserva oportunidade para o fallback configurado: titular com tentativas limitadas, fallback elegível e encerramento terminal. Não há ciclos de retorno ao titular após ativar fallback.
- Ausência de opções elegíveis encerra com causa e próxima disponibilidade quando conhecida, sem manter tentativas automáticas aguardando reset de quota.
- Buscas locais recebem ripgrep nativo por patch/instalador; correções de Grep/Glob evitam varreduras e recursão indevidas. Snap e autenticação OAuth nativa continuam suportados.
- Snapshots automáticos recusam a raiz do sistema e o diretório home inteiro, com limites de profundidade, entradas, tempo, arquivos e bytes.
- Timeout de requisição distingue espera pela resposta, streaming, aborto do chamador e falha do SDK, preservando contadores e causa. Timers de requisições concluídas não abortam a próxima.
- Exa identifica avisos de limite gratuito como erro de ferramenta, preservando o resultado bruto. A configuração efetiva resolve a variável existente em headers sem gravar credenciais nas configurações pessoais.

### Diagnósticos e documentos

- Payload, SSE e logs conservam os eventos brutos, falhas, transições de modelo e estados terminais. Ferramentas Exa não contam como subagentes concluídos.
- Área de andamento agrupa atividades por identidade; retries, trocas de chave, HTTP e stack traces permanecem nos diagnósticos próprios.
- Arquivos e textos realmente longos usam card compacto compartilhado e o painel lateral existente. Respostas curtas/médias, prompts junto aos anexos, Markdown, cópia, download e persistência entre chats são preservados.

### TTS e STT

- Modelo TTS selecionado é enviado sem substituição silenciosa. O catálogo de TTS usa IDs documentados; configurações pessoais existentes não são remapeadas.
- TTS e STT têm modelos titulares e fallbacks ordenados independentes, reaproveitando classificação, seleção de chaves e cooldown quando aplicáveis, com limites de tentativas e deduplicação.
- Erros de geração deixam de retornar sucesso HTTP 200; o contrato mantém o corpo de erro e metadados, com status HTTP adequado.
- Cancelamento alcança reprodução, fila, fetch e transporte do SDK; interrompe retries/fallbacks e descarta respostas tardias, sem cancelar o chat ou os agentes.
- Diagnósticos registram modalidade, titular, modelo efetivo, provedor, motivo do fallback, HTTP, tentativa e requestId, sem credenciais nem conteúdo de áudio completo.
- Voz, idioma, instruções e parâmetros são preservados; eventual narração nativa exige fallback explicitamente configurado.

### Distribuição e verificação

- Versão 2.2.0 alinhada em pacote/lockfile, metadados ACP/MCP e exportação de backup.
- Instalador e empacotador usam a fonte atual, recompilam e incluem o patch do CLI e Runtime Bridge. Manifesto associa arquivos e hashes ao commit da release; atualização da instalação ocorre após build bem-sucedido.
- Arquivos pessoais, `.env`, credenciais, backups, logs, caches e temporários ficam fora da árvore e dos pacotes. O antigo `agent_list.txt`, um log versionado, foi removido desta árvore sem reescrever commits antigos.
- A suíte padrão inclui as regressões de ciclo de vida do Bridge e roteamento de fallback. A asserção temporal instável foi corrigida: um timer de 35 ms pode ser medido como 34 ms por arredondamento; verifica-se a causa e o prazo configurado, sem aumentar timeouts, retries ou heap. O teste de cancelamento sincroniza com o início real da requisição, e a fixture legada de ownership respeita a preservação atual de aliases.

### Validações desta publicação

- Dependências instaladas com `npm ci` a partir do lockfile; Node 22.23.3, Gemini CLI 0.59.0, SDK GenAI 2.27.0, Vite 6.4.3 e TypeScript 5.8.3.
- `npm run lint` e `npm run build`: aprovados; permanece o aviso de tamanho de bundle.
- `npm run test:regression`: **180/180** testes aprovados na execução final.
- `npm run test:distribution`: **8/8** aprovados; rollback do instalador, snapshot de fonte, launcher e exclusão de dados privados.
- Verificação adicional de ownership/aliases: **1/1** aprovada após corrigir a fixture legada.
- Express/SQLite reais em ambientes temporários: histórico, rollback, exportação/restauração, snapshots, OAuth/API key simulados e cancelamento de processo filho por desconexão.
- Integração SSE com build compilado: oito cenários atuais de delegação, quatro de Exa/timeout e cenários de Runtime Bridge/fallback, preservando autoria, IDs, Payload, logs e estados terminais.
- Conferência da fonte: 149 arquivos, sem caminhos privados ou symlinks. As correções locais foram preservadas; novos ajustes da preparação restringem-se a versões, documentação, exclusões de distribuição e fixtures de teste.
- `git diff --cached --check` e sintaxe Bash de instalação/desinstalação/reset: aprovados.

### Limitações conhecidas

- Provedores Gemini/Exa reais, disponibilidade de modelos por conta e qualidade de áudio não foram validados nesta publicação; os testes usam provedores HTTP/MCP locais simulados e credenciais fictícias, sem consumo de cotas reais.
- Exa autenticado depende de `EXA_API_KEY` realmente chegar ao backend e de autenticação remota configurada. A release não cria, persiste ou altera credenciais pessoais.
- O build Vite mantém o aviso de bundle frontend acima de 500 kB. Isso não foi mascarado alterando o limite.
- Pacotes exigem Linux/Ubuntu, Node >= 22.13.0, npm, Git e ripgrep. A instalação de dependências pelo npm exige rede; não são pacotes offline. Windows e microfone/reprodução no navegador real não foram validados.
- As verificações históricas em `AUDIT_FIXES.md` pertencem às versões anteriores; os resultados atuais são registrados na GitHub Release v2.2.
