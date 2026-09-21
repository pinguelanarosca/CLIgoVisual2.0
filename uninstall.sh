#!/usr/bin/env bash
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
TARGET_USER_HOME="${HOME:-/root}"
USER_HOMES=("$TARGET_USER_HOME")

if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
    SUDO_HOME=$(eval echo "~$SUDO_USER" 2>/dev/null || true)
    if [ -n "$SUDO_HOME" ]; then
        USER_HOMES+=("$SUDO_HOME")
    fi
fi

# Remover em todos os diretórios HOME relevantes exclusivamente o estado da GUI
for UHOME in "${USER_HOMES[@]}"; do
    remove_target "$UHOME/.local/share/gemini-gui"
    remove_target "$UHOME/.gemini-gui-storage.json"
done

# Remover armazenamento local da workspace (se executado na raiz)
remove_target ".gemini-gui-storage.json"
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
echo "   Total de caminhos removidos: ${#REMOVED_PATHS[@]}"
echo "   O sistema foi retornado ao estado limpo sem resíduos da app."
echo "=================================================================="
