const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { exportSource, readLauncher } = require('./distribution-source.cjs');

console.log('=== Empacotador Ubuntu Linux para Gemini CLI GUI ===');
const rootDir = process.cwd();
const outputDir = path.join(rootDir, 'dist-ubuntu');
fs.mkdirSync(outputDir, { recursive: true });

// Refuse stale bundles: compilation must succeed before any package is created.
execFileSync('npm', ['run', 'build'], { stdio: 'inherit', cwd: rootDir });
if (!fs.existsSync(path.join(rootDir, 'dist/server.cjs'))) throw new Error('Build não gerou dist/server.cjs.');

const debRoot = path.join(outputDir, 'deb-root');
fs.rmSync(debRoot, { recursive: true, force: true });
const appDir = path.join(debRoot, 'opt/gemini-gui');
fs.mkdirSync(path.dirname(appDir), { recursive: true });
const manifest = exportSource(rootDir, appDir);
fs.cpSync(path.join(rootDir, 'dist'), path.join(appDir, 'dist'), { recursive: true });
const sourceHash = crypto.createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex').slice(0, 8);
const revision = `${manifest.version}+git.${manifest.commit.slice(0, 7)}.${sourceHash}`;
const metaDir = path.join(debRoot, 'DEBIAN');
const binDir = path.join(debRoot, 'usr/bin');
const desktopDir = path.join(debRoot, 'usr/share/applications');
for (const directory of [metaDir, binDir, desktopDir]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(binDir, 'gemini-gui'), readLauncher(rootDir), { mode: 0o755 });
fs.writeFileSync(path.join(desktopDir, 'gemini-gui.desktop'), `[Desktop Entry]
Name=Gemini CLI GUI
Comment=Interface Gráfica Local para o Gemini CLI
Exec=/usr/bin/gemini-gui
Icon=terminal
Terminal=false
Type=Application
Categories=Development;Utility;
`);
fs.writeFileSync(path.join(metaDir, 'control'), `Package: gemini-gui
Version: ${revision}
Section: devel
Priority: optional
Architecture: all
Depends: nodejs (>= 22.13.0), npm, git
Maintainer: Gemini CLI GUI Developer <developer@local>
Description: Interface grafica local para o Gemini CLI.
 Inclui fonte versionada, build e suporte a atualizacao Git.
`);
// server.cjs has external dependencies. Install them and run the existing CLI
// patch from the included source; never ship credentials or borrowed node_modules.
fs.writeFileSync(path.join(metaDir, 'postinst'), `#!/bin/sh
set -e
cd /opt/gemini-gui
npm install --include=dev --package-lock=false --no-audit --no-fund
chmod +x /usr/bin/gemini-gui
update-desktop-database 2>/dev/null || true
echo "Gemini CLI GUI ${revision} instalado. Digite gemini-gui para iniciar."
`, { mode: 0o755 });

const dpkg = spawnSync('dpkg-deb', ['--version'], { encoding: 'utf8' });
if (dpkg.error?.code === 'ENOENT') {
  console.warn('dpkg-deb indisponível; somente o arquivo de instalação será gerado.');
} else {
  if (dpkg.error) throw dpkg.error;
  if (dpkg.status !== 0 || dpkg.signal) throw new Error('dpkg-deb não terminou normalmente.');
  const debFile = path.join(outputDir, `gemini-gui_${revision}_all.deb`);
  execFileSync('dpkg-deb', ['--build', '--root-owner-group', debRoot, debFile], { stdio: 'inherit' });
  console.log(`Pacote Debian criado: ${debFile}`);
}

// A complete, exact source snapshot; npm dependencies require network access.
// The official installer detects the embedded manifest and does not clone main.
const tarFile = path.join(outputDir, 'gemini-gui-ubuntu-standalone.tar.gz');
execFileSync('tar', ['-czf', tarFile, '-C', path.dirname(appDir), 'gemini-gui'], { stdio: 'inherit' });
console.log(`Arquivo de instalação criado: ${tarFile}`);
console.log('Extraia e execute sudo ./gemini-gui/install.sh. Dependências npm requerem acesso à rede.');
