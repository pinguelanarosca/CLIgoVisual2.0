const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const repository = 'https://github.com/pinguelanarosca/CLIgoVisual2.0.git';
const manifestName = 'distribution-manifest.json';
const excluded = /(^|\/)(\.gemini|\.audit-recovery|node_modules|dist|dist-ubuntu|logs|tmp|backups?)(\/|$)|(^|\/)\.env(?!\.example$)|\.(log|db|sqlite3?|pem|key|p12|bak)$/i;

// Export tracked source or an explicit source allowlist for local archives.
// Never copy local Git configuration, credentials,
// generated bundles or user data. A shallow repository keeps the exact HEAD
// for the updater without packing historical personal configuration blobs.
function exportSource(source, destination) {
  source = fs.realpathSync(source);
  destination = path.resolve(destination);
  if (source === destination || source.startsWith(destination + path.sep)) {
    throw new Error('O destino não pode conter o repositório fonte.');
  }
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' });
  let files, commit = null;
  try {
    files = git('ls-files', '-z').split('\0').filter(Boolean);
    commit = git('rev-parse', 'HEAD').trim();
  } catch (error) {
    if (fs.existsSync(path.join(source, '.git'))) throw error;
    // A local source archive has no Git metadata. Export only app source paths,
    // never arbitrary root files, personal settings or generated artifacts.
    files = ['package.json', 'package-lock.json', 'server.ts', 'index.html', 'vite.config.ts', 'tsconfig.json', 'install.sh', 'uninstall.sh', 'reset.sh', 'README.md'].filter(file => fs.existsSync(path.join(source, file)));
    const walk = directory => {
      if (!fs.existsSync(path.join(source, directory))) return;
      for (const entry of fs.readdirSync(path.join(source, directory), { withFileTypes: true })) {
        const file = directory + '/' + entry.name;
        if (excluded.test(file) || entry.name === '.git') continue;
        if (entry.isDirectory()) walk(file);
        else files.push(file);
      }
    };
    for (const directory of ['server', 'src', 'scripts', 'tests', 'public']) walk(directory);
  }
  if (!files.includes('package.json') || !files.includes('server.ts')) throw new Error('Fonte local incompleta.');
  const entries = [];
  for (const file of files) {
    if (excluded.test(file)) throw new Error(`Arquivo local indevido versionado: ${file}`);
    const input = path.join(source, file);
    if (!fs.existsSync(input)) continue; // Preserve tracked deletions in working tree.
    const stat = fs.lstatSync(input);
    if (!stat.isFile()) throw new Error(`Arquivo fonte não regular: ${file}`);
    if (!fs.realpathSync(input).startsWith(source + path.sep)) throw new Error(`Arquivo fora da fonte: ${file}`);
    const bytes = fs.readFileSync(input);
    entries.push({ file, bytes, mode: stat.mode, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  if (commit) {
    execFileSync('git', ['clone', '--no-local', '--depth', '1', '--single-branch', '--no-tags', source, destination], { stdio: 'pipe' });
    execFileSync('git', ['-C', destination, 'remote', 'set-url', 'origin', repository]);
    for (const file of execFileSync('git', ['-C', destination, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)) fs.rmSync(path.join(destination, file), { force: true });
  } else {
    if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw new Error('Destino da exportação local deve estar vazio.');
    fs.mkdirSync(destination, { recursive: true });
  }
  for (const entry of entries) {
    const output = path.join(destination, entry.file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, entry.bytes, { mode: entry.mode & 0o777 });
  }
  const manifest = {
    version: JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8')).version,
    commit,
    files: Object.fromEntries(entries.map(entry => [entry.file, entry.sha256])),
  };
  fs.writeFileSync(path.join(destination, manifestName), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function readLauncher(source) {
  const installer = fs.readFileSync(path.join(source, 'install.sh'), 'utf8');
  const launcher = installer.match(/cat << 'EOF' > \/usr\/local\/bin\/gemini-gui\n([\s\S]*?)\nEOF/);
  if (!launcher) throw new Error('Launcher oficial não encontrado no instalador.');
  return launcher[1] + '\n';
}

module.exports = { exportSource, readLauncher };
if (require.main === module) exportSource(process.argv[2], process.argv[3]);
