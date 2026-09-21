# Gemini CLI GUI & Workspace

Interface gráfica e ambiente de trabalho profissional para o **Gemini CLI (v0.58.0+)**, projetada para desenvolvedores e equipes que utilizam inteligência artificial diretamente em projetos locais.

---

## 🚀 Funcionalidades Principais

- **Execução Real do Gemini CLI**: Interage diretamente com o processo CLI via terminal local e backend Node/Express (`server.ts`).
- **Sistema Multi-Agente Integrado**:
  - **Principal / Orchestrator** (`gemini-3.5-flash-lite`): Coordenação de fluxos e consolidação de respostas.
  - **Investigator** (`gemini-3.7-flash`): Análise de bugs, rastreamento de causas e diagnóstico empírico.
  - **Architect** (`gemini-3.6-flash`): Decisões arquiteturais, modularidade e padrões de projeto.
  - **Auditor** (`gemini-3.8-flash`): Auditoria rigorosa de segurança, performance e regressões.
  - **Tester** (`gemini-3-flash`): Criação de suítes de testes e validação empírica.
  - **Worker** (`gemini-3.1-flash-lite`): Tarefas repetitivas, transformações em lote e boilerplate.
- **Git & Diff Viewer**: Visualizador unificado de alterações de código e histórico de arquivos modificados com destaque de sintaxe.
- **Ditado por Voz com Reconhecimento Local**: Web Speech API com modo hands-free e feedback em tempo real.
- **Gestão de Projetos e Diretórios Autorizados**: Alternância rápida de contexto e restrição de diretórios de execução.
- **Suporte a MCP (Model Context Protocol)** e **Skills Customizadas**.
- **Empacotador para Ubuntu Linux**: Geração de pacotes `.deb` e tarball standalone para desktop.

---

## 📦 Instalação, Atualização, Reset e Desinstalação

### 1. Instalação / Atualização Oficial (`install.sh`)
O instalador oficial baixa/clona automaticamente a versão mais recente do repositório GitHub (`https://github.com/pinguelanarosca/CLIgoVisual`), instala todas as dependências, compila o aplicativo e registra os executáveis e atalhos do sistema. É **idempotente** e pode ser executado para instalar do zero ou atualizar uma versão existente.

```bash
sudo ./install.sh
```

### 2. Reset para Estado Recém-Instalado (`reset.sh` ou `npm run reset`)
Restaura o ambiente do aplicativo ao estado limpo original de uma instalação nova, limpando dados locais, histórico de conversas, logs, políticas customizadas e agentes criados, sem apagar arquivos pessoais do usuário.

```bash
./reset.sh
# ou
npm run reset
```

### 3. Desinstalação Completa (`uninstall.sh`)
Remove completamente a aplicação, seus binários de sistema, atalhos do menu de aplicativos, políticas de sistema e diretórios de dados/configurações e logs criados pela aplicação.

```bash
sudo ./uninstall.sh
```

---

## 🗂️ Inventário de Diretórios e Arquivos Pertencentes à Aplicação

Os seguintes caminhos e artefatos são de propriedade e uso exclusivo da aplicação **GCLI Visual Interface**:

* **Instalação do Sistema**:
  * `/opt/gemini-gui` (Diretório principal de instalação do aplicativo)
  * `/usr/local/bin/gemini-gui` e `/usr/bin/gemini-gui` (Executáveis / Atalhos CLI)
  * `/usr/share/applications/gemini-gui.desktop` (Atalho do menu de aplicativos do Ubuntu/Linux)

* **Armazenamento e Estado do Usuário Exclusivos da GUI (`~/.local/share/gemini-gui/`)**:
  * `~/.local/share/gemini-gui/.gemini/policies/` (Políticas exclusivas da interface GUI, como o `deny-google-search.toml`)
  * `~/.local/share/gemini-gui/.gemini/settings.json` (Configurações internas de políticas e modelos da interface GUI)
  * `~/.local/share/gemini-gui/logs/gui.log` (Arquivo de logs de execução do servidor em segundo plano)

* **Workspace Local e Cache**:
  * `.gemini-gui-storage.json` (Banco de dados de persistência local da interface GUI)
  * `.gemini/` (Configurações, agentes, skills e logs do projeto na workspace local)
  * `/tmp/gemini-gui-*.log`, `/tmp/gemini-client-error-*.json` e `cli-debug.log` (Logs temporários)
  * `dist-ubuntu/` (Artefatos de empacotamento gerados)

---

## 🛠️ Como Executar em Desenvolvimento

### Pré-requisitos
- Node.js 18+ ou 20+
- Gemini CLI instalado localmente (`gemini --version`) ou chave `GEMINI_API_KEY`

### Instalação e Desenvolvimento
```bash
# Instalar dependências
npm install

# Iniciar o servidor de desenvolvimento
npm run dev
```
Acesse a aplicação em: `http://localhost:3000`

### Build para Produção
```bash
npm run build
npm start
```

### Empacotar para Ubuntu Linux (.deb)
```bash
npm run build:ubuntu
```
Os arquivos gerados serão salvos em `dist-ubuntu/`:
- `gemini-gui_1.0.0_all.deb`
- `gemini-gui-ubuntu-standalone.tar.gz`

---

---

## 📂 Estrutura do Projeto

```
.
├── server/                 # Serviços de backend (CLI executor, agentes, git diff, MCP)
├── src/                    # Frontend React + Tailwind CSS
│   ├── components/         # Componentes de interface (Chat, Diffs, Header, Modais)
│   ├── constants/          # Constantes e definições de agentes padrão
│   └── types.ts            # Tipagens globais da aplicação
├── scripts/                # Scripts utilitários de empacotamento Debian/Ubuntu
├── server.ts               # Servidor Express com integração Vite
└── package.json            # Dependências e scripts do projeto
```

---

## 🔍 Soluções de Problemas Comuns

### 1. Erro `run_shell_command não encontrada` (Diretório Não Confiável)
Por motivos de segurança, o Gemini CLI desabilita ferramentas de execução de shell (`run_shell_command`) se o diretório do projeto não for expressamente confiável no seu ambiente local.
- **Como corrigir permanentemente**:
  Defina a variável de ambiente no seu terminal ou arquivo `.env`:
  ```bash
  export GEMINI_CLI_TRUST_WORKSPACE=true
  ```
  Ou execute o Gemini CLI uma vez interativamente no terminal e digite `yes` para confiar no diretório:
  ```bash
  npx gemini
  ```

### 2. Erro de Sessão / Código `42` (`Erro ao retomar a sessão`)
Isso ocorre quando a interface tenta retomar uma sessão existente no histórico, mas os arquivos temporários correspondentes foram limpos ou não existem no ambiente local atual.
- **Como corrigir**:
  Nossa interface possui tratamento automático para este caso. Se ocorrer erro de sessão inexistente (Código `42`), o sistema automaticamente reinicia um novo ID de sessão limpo e transparente sem travar seu chat.

---

## 📄 Licença
Distribuído sob a licença MIT.
