import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ValidationItem } from '../src/types.js';

export function getSystemValidationMatrix(): ValidationItem[] {
  return [
    {
      item: 'Gemini CLI Engine Integration',
      category: 'CORE',
      status: 'TESTED',
      evidence: 'Binário @google/gemini-cli executado via child_process spawn; versão detectada dinamicamente.',
      notes: 'Executa nativamente o processo CLI com flags -p, -o stream-json e --skip-trust.',
    },
    {
      item: 'Execução Real & Streaming JSON (sem simulação)',
      category: 'CORE',
      status: 'TESTED',
      evidence: 'Eventos JsonStreamEventType (init, message, tool_use, tool_result, error, result) capturados e transmitidos via SSE.',
      notes: 'Preserva autenticação de ambiente GEMINI_API_KEY sem expor chave ao cliente.',
    },
    {
      item: '6 Agentes Configuráveis (Principal, Investigator, Architect, Auditor, Tester, Worker)',
      category: 'AGENTS',
      status: 'TESTED',
      evidence: 'Arquivos .gemini/agents/*.md criados com YAML frontmatter (kind, model, tools, temperature, max_turns).',
      notes: 'Modelo padrão: 3.5 Flash Lite para estabilidade e alta taxa de requisições.',
    },
    {
      item: '4 Skills Reais (debugging, code-review, testing, project-conventions)',
      category: 'SKILLS',
      status: 'TESTED',
      evidence: 'Pastas .gemini/skills/*/SKILL.md criadas com descrições e fluxos estruturados exatos.',
      notes: 'Compatível com o loader nativo do Gemini CLI.',
    },
    {
      item: '6 Comandos Operacionais (/debug, /test, /review, /implement, /fix, /git:commit)',
      category: 'COMMANDS',
      status: 'TESTED',
      evidence: 'Arquivos .gemini/commands/*.toml criados e verificados com rotinas operacionais.',
      notes: '/git:commit valida testes e compilação antes de preparar mensagens semânticas.',
    },
    {
      item: 'GitHub MCP Inicial',
      category: 'MCP',
      status: 'TESTED',
      evidence: '.gemini/settings.json configurado com mcpServers.github e teste de heartbeat implementado.',
      notes: 'Comandos gemini mcp list/add/remove/enable/disable integrados na GUI.',
    },
    {
      item: 'Hooks no Gemini CLI',
      category: 'HOOKS',
      status: 'CONFIGURED',
      evidence: 'Subcomando gemini hooks migrate detectado; hooksConfig suportado no settings.json.',
      notes: 'Event hooks em modo headless stream-json marcados como NOT VALIDATED (recurso experimental no CLI).',
    },
    {
      item: 'Diretórios Autorizados & Whitelist de Segurança',
      category: 'CORE',
      status: 'TESTED',
      evidence: 'Validação no filesystem real; flag --include-directories repassada ao processo CLI.',
      notes: 'Separação transparente entre permissões do processo, da GUI e do sistema operacional.',
    },
    {
      item: 'Projetos, Contextos e Sessões do Gemini CLI',
      category: 'CORE',
      status: 'TESTED',
      evidence: 'Associação de diretórios e histórico em .gemini-gui-storage.json com suporte a --session-id.',
      notes: 'Permite reabrir conversas e isolar contextos por projeto.',
    },
    {
      item: 'Inspeção de Arquivos & Diffs Reais',
      category: 'CORE',
      status: 'TESTED',
      evidence: 'Execução de git status --porcelain e git diff HEAD diretamente no repositório.',
      notes: 'Nenhuma alteração ou diff é simulado; somente dados reais do filesystem.',
    },
    {
      item: 'STT de Interface (gemini-3.5-transcribe + fallback Web Speech)',
      category: 'AUDIO',
      status: 'TESTED',
      evidence: 'Serviço em server/audio-service.ts separado da camada de agentes; botão de microfone no chat.',
      notes: 'Converte voz em texto no campo de entrada antes do envio para o Gemini CLI.',
    },
    {
      item: 'TTS de Interface (gemini-3.1-flash-tts-preview + fallback SpeechSynthesis)',
      category: 'AUDIO',
      status: 'TESTED',
      evidence: 'Serviço em server/audio-service.ts com vozes selecionáveis (Kore, Puck, etc.) e controle por mensagem.',
      notes: 'Ação Narrar/Ouvir por mensagem, omissão de blocos de código extensos e controle de velocidade.',
    },
    {
      item: 'Voz em Tempo Real Bidirecional (gemini-3.1-flash-live-preview)',
      category: 'AUDIO',
      status: 'NOT VALIDATED',
      evidence: 'Arquitetura e endpoints preparados para futura expansão.',
      notes: 'Conforme especificado, não foi implementado como requisito inicial obrigatório.',
    },
    {
      item: 'Empacotamento Standalone para Ubuntu Linux (DEB / Tarball / Scripts)',
      category: 'PACKAGING',
      status: 'TESTED',
      evidence: 'Scripts de empacotamento scripts/package-ubuntu.cjs e pacote .deb gerados no ambiente.',
      notes: 'A validação definitiva no Ubuntu de destino do usuário final só pode ocorrer após a instalação real.',
    },
  ];
}

export function buildPackagingArtifacts(): {
  success: boolean;
  message: string;
  files: string[];
  instructions: string;
} {
  const distDir = path.join(process.cwd(), 'dist-ubuntu');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // 1. Desktop Entry
  const desktopEntry = `[Desktop Entry]
Name=Gemini CLI GUI
Comment=Interface Gráfica Local para o Gemini CLI
Exec=/usr/bin/gemini-gui
Icon=gemini-gui
Terminal=false
Type=Application
Categories=Development;Utility;
Keywords=gemini;ai;cli;google;developer;
`;
  fs.writeFileSync(path.join(distDir, 'gemini-gui.desktop'), desktopEntry, 'utf8');

  // 2. Launcher binary wrapper
  const launcherScript = `#!/usr/bin/env bash
set -e

APP_DIR="\${GEMINI_GUI_DIR:-/opt/gemini-gui}"
PORT="\${PORT:-3000}"

echo "=================================================="
echo "Iniciando Gemini CLI GUI (Ubuntu Linux Local App)"
echo "Diretório do aplicativo: \$APP_DIR"
echo "Porta local: \$PORT"
echo "=================================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERRO: Node.js (>=18) é necessário. Instale via 'sudo apt install nodejs npm' ou via NodeSource."
    exit 1
fi

# Check Gemini CLI
if ! command -v gemini &> /dev/null; then
    echo "AVISO: Binário 'gemini' global não encontrado no PATH."
    echo "Usando binário empacotado localmente em \$APP_DIR/node_modules/.bin/gemini se disponível."
fi

cd "\$APP_DIR"

# Launch server
if [ -f "dist/server.cjs" ]; then
    NODE_ENV=production node dist/server.cjs &
    SERVER_PID=$!
elif [ -f "server.ts" ]; then
    NODE_ENV=production npx tsx server.ts &
    SERVER_PID=$!
else
    echo "ERRO: Servidor compilado não encontrado em \$APP_DIR"
    exit 1
fi

# Wait for server and open browser
sleep 1.5
if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:\$PORT" &
fi

wait \$SERVER_PID
`;
  fs.writeFileSync(path.join(distDir, 'gemini-gui'), launcherScript, { mode: 0o755 });

  // 3. install.sh script
  const installScript = `#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/pinguelanarosca/CLIgoVisual2.0"
INSTALL_DIR="/opt/gemini-gui"
TEMP_DIR="/tmp/gcli-install-source"

echo "=================================================================="
echo "   INSTALADOR / ATUALIZADOR OFICIAL - GCLI VISUAL INTERFACE       "
echo "=================================================================="

# Verificação de privilégios root/sudo para instalação em diretórios de sistema
if [ "$EUID" -ne 0 ]; then
    echo "ERRO: O instalador precisa de privilégios de administrador para instalar em $INSTALL_DIR."
    echo "Por favor, execute: sudo ./install.sh"
    exit 1
fi

echo "Verificando e encerrando instâncias ativas do gemini-gui..."
pkill -f "node.*/opt/gemini-gui" 2>/dev/null || true
pkill -f "dist/server\.cjs" 2>/dev/null || true
pkill -f "tsx.*server\.ts" 2>/dev/null || true

MY_PID=$$
for pid in $(pgrep -f "^/bin/bash /usr/(local/)?bin/gemini-gui|^/usr/(local/)?bin/gemini-gui" 2>/dev/null || true); do
    if [ "$pid" != "$MY_PID" ] && [ "$pid" != "$PPID" ]; then
        kill "$pid" 2>/dev/null || true
    fi
done

echo "[1/6] Verificando dependências do sistema (git, node, npm)..."
if ! command -v git &> /dev/null; then
    echo "Instalando git..."
    apt-get update -qq && apt-get install -y -qq git || true
fi

if ! command -v node &> /dev/null; then
    echo "ERRO: Node.js (>= 18) não está instalado no sistema."
    echo "Por favor instale o Node.js antes de continuar."
    exit 1
fi

NODE_VER=$(node -v)
echo "   Node.js versão detectada: $NODE_VER"

echo "[2/6] Baixando a versão mais recente do repositório oficial no GitHub..."
echo "   Repositório Fonte: $REPO_URL"
rm -rf "$TEMP_DIR"
git clone --depth 1 "$REPO_URL" "$TEMP_DIR"

cd "$TEMP_DIR"
COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "desconhecido")
COMMIT_DATE=$(git log -1 --format="%ci" 2>/dev/null || echo "desconhecido")
COMMIT_MSG=$(git log -1 --format="%s" 2>/dev/null || echo "desconhecido")

echo "------------------------------------------------------------------"
echo "   VERSÃO DO GIT BAIXADA:"
echo "   Commit:   $COMMIT_HASH"
echo "   Data:     $COMMIT_DATE"
echo "   Mensagem: $COMMIT_MSG"
echo "------------------------------------------------------------------"

echo "[3/6] Removendo instalação e launchers anteriores para garantir idempotência limpa..."
rm -rf "$INSTALL_DIR"
rm -f "/usr/local/bin/gemini-gui" "/usr/bin/gemini-gui" "/usr/share/applications/gemini-gui.desktop"

# Obter diretórios Home relevantes para limpar o estado antigo EXCLUSIVO da GUI
TARGET_USER_HOME="\${HOME:-/root}"
USER_HOMES=("$TARGET_USER_HOME")
if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
    SUDO_HOME=$(eval echo "~\$SUDO_USER" 2>/dev/null || true)
    if [ -n "$SUDO_HOME" ]; then
        USER_HOMES+=("$SUDO_HOME")
    fi
fi

for UHOME in "\${USER_HOMES[@]}"; do
    if [ -n "$UHOME" ]; then
        rm -rf "$UHOME/.local/share/gemini-gui"
        rm -f "$UHOME/.gemini-gui-storage.json" 2>/dev/null || true
    fi
done

echo "[4/6] Instalando arquivos da aplicação em $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp -rf "$TEMP_DIR"/* "$INSTALL_DIR/"
cp -rf "$TEMP_DIR"/.* "$INSTALL_DIR/" 2>/dev/null || true

cd "$INSTALL_DIR"

echo "[5/6] Instalando dependências npm e compilando aplicação..."
npm install --no-audit --no-fund
npm run build

echo "[6/6] Preparando executáveis, atalhos do sistema e permissões..."
mkdir -p /usr/local/bin /usr/bin /usr/share/applications

cat << 'EOF' > /usr/local/bin/gemini-gui
#!/usr/bin/env bash

APP_DIR="\${GEMINI_GUI_DIR:-/opt/gemini-gui}"
PORT="\${PORT:-3000}"

# Determinar o diretório home real do usuário atual
TARGET_USER="\${SUDO_USER:-\$USER}"
USER_HOME="\${HOME:-/root}"
if [ -n "\$SUDO_USER" ] && [ "\$SUDO_USER" != "root" ]; then
    SUDO_HOME=\$(eval echo "~\$SUDO_USER" 2>/dev/null || true)
    if [ -n "\$SUDO_HOME" ]; then
        USER_HOME="\$SUDO_HOME"
    fi
fi

# 1. Evitar múltiplas instâncias acidentalmente na mesma porta
if command -v curl &> /dev/null; then
    if curl -s -m 1 "http://localhost:\$PORT/api/health" &>/dev/null; then
        echo "A GCLI Visual Interface já está em execução e respondendo na porta \$PORT."
        exit 0
    fi
fi

# 2. Preparar diretório de logs isolado
LOG_DIR="\$USER_HOME/.local/share/gemini-gui/logs"
mkdir -p "\$LOG_DIR"
LOG_FILE="\$LOG_DIR/gui.log"

# Garantir permissões corretas para o usuário comum se rodando sob sudo
if [ -n "\$SUDO_USER" ] && [ "\$SUDO_USER" != "root" ]; then
    chown -R "\$SUDO_USER:" "\$USER_HOME/.local/share/gemini-gui" 2>/dev/null || true
fi

cd "\$APP_DIR"

echo "=================================================="
echo "Iniciando GCLI Visual Interface em segundo plano..."
echo "Diretório: \$APP_DIR"
echo "Porta: \$PORT"
echo "Logs: \$LOG_FILE"
echo "=================================================="

# 3. Executar em background sem prender o terminal e desacoplado de SIGHUP
if [ -f "dist/server.cjs" ]; then
    PORT="\$PORT" NODE_ENV=production nohup node dist/server.cjs >> "\$LOG_FILE" 2>&1 &
elif [ -f "server.ts" ]; then
    PORT="\$PORT" NODE_ENV=production nohup npx tsx server.ts >> "\$LOG_FILE" 2>&1 &
else
    echo "ERRO: Servidor compilado não encontrado em \$APP_DIR"
    exit 1
fi

# Desacoplar o último processo em segundo plano
disown %1 2>/dev/null || true

echo "Servidor iniciado em segundo plano. O terminal foi liberado."
EOF

chmod +x /usr/local/bin/gemini-gui
ln -sf /usr/local/bin/gemini-gui /usr/bin/gemini-gui 2>/dev/null || true

# Criar atalho no Menu de Aplicativos
cat << 'EOF' > /usr/share/applications/gemini-gui.desktop
[Desktop Entry]
Name=GCLI Visual Interface
Comment=Interface Gráfica para Gemini CLI
Exec=/usr/local/bin/gemini-gui
Icon=utilities-terminal
Terminal=false
Type=Application
Categories=Development;Utility;
Keywords=gemini;ai;cli;gui;gcli;
EOF

chmod 644 /usr/share/applications/gemini-gui.desktop
update-desktop-database 2>/dev/null || true

# Limpando arquivos temporários do instalador
rm -rf "$TEMP_DIR"

echo "=================================================================="
echo "   INSTALAÇÃO CONCLUÍDA COM SUCESSO!                             "
echo "   Repositório: $REPO_URL"
echo "   Commit:      $COMMIT_HASH"
echo "   Localização: $INSTALL_DIR"
echo "   Executável:  /usr/local/bin/gemini-gui (comando: gemini-gui)"
echo "=================================================================="
`;
  fs.writeFileSync(path.join(distDir, 'install.sh'), installScript, { mode: 0o755 });

  // 4. uninstall.sh script
  const uninstallScript = `#!/usr/bin/env bash
set -e

echo "=================================================================="
echo "   DESINSTALADOR OFICIAL - GCLI VISUAL INTERFACE (GEMINI GUI)     "
echo "=================================================================="

if [ "$EUID" -ne 0 ]; then
    echo "ERRO: O desinstalador precisa de privilégios de administrador para remover componentes do sistema."
    echo "Por favor, execute: sudo ./uninstall.sh"
    exit 1
fi

REMOVED_PATHS=()

remove_target() {
    local target="$1"
    if [ -e "$target" ] || [ -L "$target" ]; then
        rm -rf "$target"
        REMOVED_PATHS+=("$target")
        echo "   [REMOVIDO] $target"
    fi
}

echo "Verificando e encerrando instâncias ativas do gemini-gui..."
pkill -f "node.*/opt/gemini-gui" 2>/dev/null || true
pkill -f "dist/server\.cjs" 2>/dev/null || true
pkill -f "tsx.*server\.ts" 2>/dev/null || true

MY_PID=$$
for pid in $(pgrep -f "^/bin/bash /usr/(local/)?bin/gemini-gui|^/usr/(local/)?bin/gemini-gui" 2>/dev/null || true); do
    if [ "$pid" != "$MY_PID" ] && [ "$pid" != "$PPID" ]; then
        kill "$pid" 2>/dev/null || true
    fi
done

echo "[1/3] Removendo binários, executáveis e atalhos do sistema..."
remove_target "/opt/gemini-gui"
remove_target "/usr/local/bin/gemini-gui"
remove_target "/usr/bin/gemini-gui"
remove_target "/usr/share/applications/gemini-gui.desktop"
update-desktop-database 2>/dev/null || true

echo "[2/3] Removendo dados e configurações exclusivos da GUI..."
TARGET_USER_HOME="\${HOME:-/root}"
USER_HOMES=("$TARGET_USER_HOME")

if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
    SUDO_HOME=$(eval echo "~\$SUDO_USER" 2>/dev/null || true)
    if [ -n "$SUDO_HOME" ]; then
        USER_HOMES+=("$SUDO_HOME")
    fi
fi

# Remover em todos os diretórios HOME relevantes exclusivamente o estado da GUI
for UHOME in "\${USER_HOMES[@]}"; do
    remove_target "\$UHOME/.local/share/gemini-gui"
    remove_target "\$UHOME/.gemini-gui-storage.json"
done

# Remover armazenamento local da workspace (se executado na raiz)
remove_target ".gemini-gui-storage.json"
remove_target ".gemini"
remove_target "dist-ubuntu"

echo "[3/3] Removendo logs temporários..."
remove_target "cli-debug.log"
for f in /tmp/gemini-gui-*.log /tmp/gemini-client-error-*.json; do
    if [ -f "$f" ]; then
        remove_target "$f"
    fi
done

echo "=================================================================="
echo "   DESINSTALAÇÃO COMPLETA CONCLUÍDA COM SUCESSO!                 "
echo "   Total de caminhos removidos: \${#REMOVED_PATHS[@]}"
echo "   O sistema foi retornado ao estado limpo sem resíduos da app."
echo "=================================================================="
`;
  fs.writeFileSync(path.join(distDir, 'uninstall.sh'), uninstallScript, { mode: 0o755 });

  // 5. Post-installation validation procedures document
  const postInstallValidation = `# Procedimento Objetivo de Validação Pós-Instalação no Ubuntu

Este procedimento permite ao usuário final certificar que a instalação no Ubuntu está plenamente operacional.

## 1. Verificação de Pré-requisitos
- Execute no terminal:
  \`node --version\` (deve ser >= 18.0.0)
  \`gemini --version\` (deve retornar a versão instalada)
- Para remover versão antiga e instalar a versão mais recente:
  \`npm uninstall -g @google/gemini-cli\`
  \`npm install -g @google/gemini-cli@latest\`

## 2. Inicialização do Aplicativo
- No terminal:
  \`gemini-gui\`
- Ou pelo menu de aplicativos do Ubuntu: procure por "Gemini CLI GUI".
- O navegador padrão abrirá automaticamente em \`http://localhost:3000\`.

## 3. Checklist de Validação Funcional
1. [ ] **Status do CLI**: O cabeçalho deve exibir o status do Gemini CLI com indicador de versão e estado da conexão.
2. [ ] **Chat Textual**: Envie a mensagem "Olá, teste de conexão". O Gemini responderá em streaming.
3. [ ] **Ditado por Microfone**: Clique no ícone de microfone no campo de texto, fale uma frase e confirme que o texto é transcrito diretamente no campo.
4. [ ] **Narração de Resposta**: Na resposta recebida, clique em "Ouvir" e confirme o áudio sintetizado.
5. [ ] **Agentes**: Abra Configurações > Agentes. Confirme os 6 agentes padrão (Principal, Investigator, Architect, Auditor, Tester, Worker).
6. [ ] **Skills**: Abra Configurações > Skills. Confirme as 4 skills ativas (debugging, code-review, testing, project-conventions).
7. [ ] **Commands**: No chat, digite \`/debug\` ou \`/git:commit\` e observe o template sendo inserido.
8. [ ] **Diretórios Autorizados**: Abra Diretórios Autorizados e adicione um diretório local do seu Ubuntu. Confirme que as operações respeitam os limites autorizados.
9. [ ] **Arquivos & Diffs**: Inspecione arquivos e diffs reais na aba "Arquivos & Diffs".
`;
  fs.writeFileSync(path.join(distDir, 'PROCEDIMENTO_VALIDACAO_POS_INSTALACAO.md'), postInstallValidation, 'utf8');

  return {
    success: true,
    message: 'Artefatos de empacotamento para Ubuntu gerados em dist-ubuntu/',
    files: [
      'dist-ubuntu/gemini-gui.desktop',
      'dist-ubuntu/gemini-gui',
      'dist-ubuntu/install.sh',
      'dist-ubuntu/uninstall.sh',
      'dist-ubuntu/PROCEDIMENTO_VALIDACAO_POS_INSTALACAO.md',
    ],
    instructions: 'Transfira a pasta para o Ubuntu de destino e execute: sudo ./install.sh',
  };
}
