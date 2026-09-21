#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/pinguelanarosca/CLIgoVisual"
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
# Encerra processos do servidor compilado ou tsx vinculados a /opt/gemini-gui ou dist/server.cjs
pkill -f "node.*/opt/gemini-gui" 2>/dev/null || true
pkill -f "dist/server\.cjs" 2>/dev/null || true
pkill -f "tsx.*server\.ts" 2>/dev/null || true

# Encerra processos executando especificamente o launcher instalado, sem jamais casar com o script instalador atual
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
if [ -n "$GEMINI_GUI_LOCAL_SOURCE" ] && [ -d "$GEMINI_GUI_LOCAL_SOURCE" ]; then
    echo "   Modo de fonte local ativado: $GEMINI_GUI_LOCAL_SOURCE"
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"
    cp -rf "$GEMINI_GUI_LOCAL_SOURCE"/* "$TEMP_DIR/"
    cp -rf "$GEMINI_GUI_LOCAL_SOURCE"/.* "$TEMP_DIR/" 2>/dev/null || true
else
    echo "   Repositório Fonte: $REPO_URL (branch: main)"
    rm -rf "$TEMP_DIR"
    git clone --depth 1 --branch main "$REPO_URL" "$TEMP_DIR"
fi

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

echo "[4/6] Instalando arquivos da aplicação em $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp -rf "$TEMP_DIR"/* "$INSTALL_DIR/"
cp -rf "$TEMP_DIR"/.* "$INSTALL_DIR/" 2>/dev/null || true

cd "$INSTALL_DIR"

echo "[5/6] Instalando dependências npm e compilando aplicação..."
npm install --no-audit --no-fund
echo "   Compilando aplicação (Vite + esbuild)..."
if ! npm run build; then
    echo "------------------------------------------------------------------"
    echo "ERRO CRÍTICO: Falha na compilação da aplicação (npm run build falhou)."
    echo "A instalação foi cancelada para evitar um estado corrompido."
    echo "------------------------------------------------------------------"
    exit 1
fi

if [ ! -f "$INSTALL_DIR/dist/server.cjs" ]; then
    echo "ERRO CRÍTICO: dist/server.cjs não foi gerado pelo build."
    exit 1
fi

echo "[6/6] Preparando executáveis, atalhos do sistema e permissões..."
mkdir -p /usr/local/bin /usr/bin /usr/share/applications

cat << 'EOF' > /usr/local/bin/gemini-gui
#!/usr/bin/env bash

APP_DIR="${GEMINI_GUI_DIR:-/opt/gemini-gui}"
PORT="${PORT:-3000}"

# Determinar o diretório home real do usuário atual
TARGET_USER="${SUDO_USER:-$USER}"
USER_HOME="${HOME:-/root}"
if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
    SUDO_HOME=$(eval echo "~$SUDO_USER" 2>/dev/null || true)
    if [ -n "$SUDO_HOME" ]; then
        USER_HOME="$SUDO_HOME"
    fi
fi

# 1. Evitar múltiplas instâncias acidentalmente na mesma porta
if command -v curl &> /dev/null; then
    if curl -s -m 1 "http://localhost:$PORT/api/health" &>/dev/null; then
        echo "A GCLI Visual Interface já está em execução e respondendo na porta $PORT."
        exit 0
    fi
fi

# 2. Preparar diretório de logs isolado
LOG_DIR="$USER_HOME/.local/share/gemini-gui/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/gui.log"

# Garantir permissões corretas para o usuário comum se rodando sob sudo
if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
    chown -R "$SUDO_USER:" "$USER_HOME/.local/share/gemini-gui" 2>/dev/null || true
fi

cd "$APP_DIR"

echo "=================================================="
echo "Iniciando GCLI Visual Interface em segundo plano..."
echo "Diretório: $APP_DIR"
echo "Porta: $PORT"
echo "Logs: $LOG_FILE"
echo "=================================================="

# 3. Executar em background sem prender o terminal e desacoplado de SIGHUP
if [ -f "dist/server.cjs" ]; then
    PORT="$PORT" NODE_ENV=production nohup node dist/server.cjs >> "$LOG_FILE" 2>&1 &
elif [ -f "server.ts" ]; then
    PORT="$PORT" NODE_ENV=production nohup npx tsx server.ts >> "$LOG_FILE" 2>&1 &
else
    echo "ERRO: Servidor compilado não encontrado em $APP_DIR"
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

# Ajustar permissões para que arquivos instalados não dependam de escrita pelo usuário comum
chown -R root:root "$INSTALL_DIR" 2>/dev/null || true
find "$INSTALL_DIR" -type d -exec chmod 755 {} \;
find "$INSTALL_DIR" -type f -exec chmod 644 {} \;
find "$INSTALL_DIR/node_modules/.bin" -type f -exec chmod 755 {} \; 2>/dev/null || true

# Limpando arquivos temporários do instalador
rm -rf "$TEMP_DIR"

echo "=================================================================="
echo "   INSTALAÇÃO CONCLUÍDA COM SUCESSO!                             "
echo "   Repositório: $REPO_URL"
echo "   Commit:      $COMMIT_HASH"
echo "   Localização: $INSTALL_DIR"
echo "   Executável:  /usr/local/bin/gemini-gui (comando: gemini-gui)"
echo "=================================================================="

echo "Iniciando a GCLI Visual Interface em segundo plano com nohup + disown..."
if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
    su - "$SUDO_USER" -c "/usr/local/bin/gemini-gui" 2>/dev/null || /usr/local/bin/gemini-gui
else
    /usr/local/bin/gemini-gui
fi
