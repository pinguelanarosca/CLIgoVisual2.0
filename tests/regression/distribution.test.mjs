import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const { exportSource, readLauncher } = require('../../scripts/distribution-source.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cligovisual-distribution-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function repo(t) {
  const dir = fixture(t);
  execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'pipe' });
  for (const file of ['package.json', 'server.ts', 'install.sh', 'uninstall.sh', 'scripts/distribution-source.cjs', 'scripts/patch-gemini-cli.cjs']) {
    const output = path.join(dir, file); fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(root, file), output);
  }
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\ndist/\ndist-ubuntu/\n.gemini/\ndistribution-manifest.json\n');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture'], { stdio: 'pipe' });
  return dir;
}
function models(source) {
  return [...source.matchAll(/id: '(principal|investigator|architect|auditor|tester|worker)'[\s\S]*?model: '([^']+)'[\s\S]*?fallbackModel: '([^']+)'/g)].map(m => m.slice(1));
}
test('Catálogos e fallbacks unificados entre frontend e backend com prioridade RPD', () => {
  const expected = [
    ['principal', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
    ['investigator', 'gemini-3.7-flash', 'gemini-3.5-flash'],
    ['architect', 'gemini-3.6-flash', 'gemini-3.7-flash'],
    ['auditor', 'gemini-3.8-flash', 'gemini-3.6-flash'],
    ['tester', 'gemini-3.5-flash', 'gemini-3-flash'],
    ['worker', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  ];
  assert.deepEqual(models(fs.readFileSync(path.join(root, 'server/agents-service.ts'), 'utf8')), expected);
  assert.deepEqual(models(fs.readFileSync(path.join(root, 'src/constants/defaultAgents.ts'), 'utf8')), expected);
});
test('Snapshot preserva fonte atual, exclusões e commit sem incluir artefatos ou configuração Git local', t => {
  const source = repo(t), output = path.join(fixture(t), 'source');
  fs.appendFileSync(path.join(source, 'server.ts'), '\n// alteração local preservada\n');
  fs.rmSync(path.join(source, 'uninstall.sh'));
  for (const file of ['.gemini/oauth_creds.json', '.env', 'backup.json', 'local.log', 'dist/server.cjs']) {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(path.join(source, file), 'PRIVATE_FIXTURE');
  }
  execFileSync('git', ['-C', source, 'config', 'credential.helper', 'fixture-private']);
  const manifest = exportSource(source, output);
  assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(source, 'package.json'))).version);
  assert.equal(manifest.files['server.ts'], hash(fs.readFileSync(path.join(source, 'server.ts'))));
  assert.equal(fs.readFileSync(path.join(output, 'server.ts'), 'utf8'), fs.readFileSync(path.join(source, 'server.ts'), 'utf8'));
  assert.equal(fs.existsSync(path.join(output, 'uninstall.sh')), false);
  for (const file of ['.gemini', '.env', 'backup.json', 'local.log', 'dist']) assert.equal(fs.existsSync(path.join(output, file)), false);
  assert.equal(execFileSync('git', ['-C', output, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), manifest.commit);
  assert.equal(execFileSync('git', ['-C', output, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim(), 'true');
  const config = fs.readFileSync(path.join(output, '.git/config'), 'utf8');
  assert.ok(!config.includes('fixture-private')); assert.ok(config.includes('github.com/pinguelanarosca/CLIgoVisual2.0.git'));
});
test('Snapshot recusa credenciais versionadas e links em vez de exportá-los', t => {
  for (const file of ['.gemini/oauth_creds.json', 'leak.pem', 'link']) {
    const source = repo(t), output = path.join(fixture(t), 'source');
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    if (file === 'link') fs.symlinkSync('/etc/passwd', path.join(source, file));
    else fs.writeFileSync(path.join(source, file), 'PRIVATE_FIXTURE');
    execFileSync('git', ['-C', source, 'add', '-f', file]);
    assert.throws(() => exportSource(source, output), /indevido|não regular/);
    assert.equal(fs.existsSync(output), false);
  }
});
test('Exportação da GUI usa instalador e launcher oficiais e inclui snapshot de fonte atual', t => {
  const dir = repo(t), file = path.join(root, 'server/packaging-service.ts');
  const script = stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import[\s\S]*?;\s*/gm, ''), { mode: 'transform' }).replace(/\bexport\s+(?=function)/g, '');
  const c = vm.createContext({ fs, path, execFileSync, process: { ...process, cwd: () => dir } });
  vm.runInContext(script, c);
  assert.equal(c.buildPackagingArtifacts().success, true);
  for (const name of ['install.sh', 'uninstall.sh']) assert.equal(fs.readFileSync(path.join(dir, 'dist-ubuntu', name), 'utf8'), fs.readFileSync(path.join(dir, name), 'utf8'));
  assert.equal(fs.readFileSync(path.join(dir, 'dist-ubuntu/gemini-gui'), 'utf8'), readLauncher(dir));
  assert.ok(fs.existsSync(path.join(dir, 'dist-ubuntu/source/server.ts')));
});
function runInstaller(t, failBuild, wrongCommit = false) {
  const source = repo(t), box = fixture(t), prefix = path.join(box, 'opt');
  const installed = path.join(prefix, 'gemini-gui'); fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'personal.json'), 'PRESERVE');
  const bins = path.join(box, 'bin'); fs.mkdirSync(bins);
  fs.writeFileSync(path.join(bins, 'npm'), '#!/bin/sh\nif [ "$1" = "run" ]; then\n [ "$FAIL_BUILD" != "1" ] || exit 9\n mkdir -p dist; echo bundle-fixture > dist/server.cjs\nfi\n', { mode: 0o755 });
  let script = fs.readFileSync(path.join(root, 'install.sh'), 'utf8').split('echo "[6/6]')[0];
  script = script.replaceAll('/opt/', prefix + '/').replace('if [ "$EUID" -ne 0 ]; then', 'if false; then');
  script = script.replace('set -e\n', 'set -e\npkill() { return 0; }\npgrep() { return 1; }\n');
  const scriptPath = path.join(box, 'install.sh'); fs.writeFileSync(scriptPath, script);
  const result = spawnSync('bash', [scriptPath], { encoding: 'utf8', env: { ...process.env, PATH: bins + ':' + process.env.PATH,
    GEMINI_GUI_LOCAL_SOURCE: source, GEMINI_GUI_EXPECTED_COMMIT: wrongCommit ? 'wrong-commit' : '', FAIL_BUILD: failBuild ? '1' : '0' } });
  return { result, installed, prefix };
}
test('Instalador: falha de build/commit não substitui nem apaga instalação anterior (npm simulado)', t => {
  for (const [fail, wrongCommit] of [[true, false], [false, true]]) {
    const f = runInstaller(t, fail, wrongCommit); assert.notEqual(f.result.status, 0, f.result.stdout + f.result.stderr);
    assert.equal(fs.readFileSync(path.join(f.installed, 'personal.json'), 'utf8'), 'PRESERVE');
    assert.deepEqual(fs.readdirSync(f.prefix), ['gemini-gui']);
  }
});
test('Instalador: ativa build novo e retém instalação anterior recuperável (npm simulado)', t => {
  const f = runInstaller(t, false); assert.equal(f.result.status, 0, f.result.stdout + f.result.stderr);
  assert.equal(fs.readFileSync(path.join(f.installed, 'dist/server.cjs'), 'utf8'), 'bundle-fixture\n');
  const backup = fs.readdirSync(f.prefix).find(name => name.startsWith('.gemini-gui-backup.'));
  assert.ok(backup); assert.equal(fs.readFileSync(path.join(f.prefix, backup, 'personal.json'), 'utf8'), 'PRESERVE');
});
test('Empacotador gera .deb e arquivo completos, com versão/hash e dependências externas (build simulado)', t => {
  const dir = repo(t), bins = path.join(fixture(t), 'bin'); fs.mkdirSync(bins);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true }); fs.copyFileSync(path.join(root, 'scripts/package-ubuntu.cjs'), path.join(dir, 'scripts/package-ubuntu.cjs'));
  execFileSync('git', ['-C', dir, 'add', 'scripts/package-ubuntu.cjs']);
  fs.mkdirSync(path.join(dir, '.gemini')); fs.writeFileSync(path.join(dir, '.gemini/oauth_creds.json'), 'PRIVATE_FIXTURE');
  fs.writeFileSync(path.join(bins, 'npm'), '#!/bin/sh\nmkdir -p dist\necho bundle-fixture > dist/server.cjs\n', { mode: 0o755 });
  execFileSync(process.execPath, [path.join(dir, 'scripts/package-ubuntu.cjs')], { cwd: dir, env: { ...process.env, PATH: bins + ':' + process.env.PATH }, stdio: 'pipe' });
  const app = path.join(dir, 'dist-ubuntu/deb-root/opt/gemini-gui');
  const manifest = JSON.parse(fs.readFileSync(path.join(app, 'distribution-manifest.json')));
  assert.equal(fs.existsSync(path.join(app, '.gemini')), false);
  for (const file of ['server.ts', 'scripts/distribution-source.cjs', 'scripts/patch-gemini-cli.cjs', 'install.sh']) assert.equal(hash(fs.readFileSync(path.join(app, file))), manifest.files[file]);
  assert.ok(fs.existsSync(path.join(app, '.git')));
  assert.ok(fs.statSync(path.join(app, 'install.sh')).mode & 0o111, 'Instalador embutido deve executar diretamente');
  const control = fs.readFileSync(path.join(dir, 'dist-ubuntu/deb-root/DEBIAN/control'), 'utf8');
  assert.ok(control.includes(`Version: ${manifest.version}+git.${manifest.commit.slice(0, 7)}`));
  assert.ok(control.includes('Depends: nodejs (>= 22.13.0), npm, git'));
  const postinst = fs.readFileSync(path.join(dir, 'dist-ubuntu/deb-root/DEBIAN/postinst'), 'utf8'); assert.ok(postinst.includes('npm install'));
  const listing = execFileSync('tar', ['-tzf', path.join(dir, 'dist-ubuntu/gemini-gui-ubuntu-standalone.tar.gz')], { encoding: 'utf8' });
  assert.ok(listing.includes('gemini-gui/server.ts')); assert.ok(listing.includes('gemini-gui/dist/server.cjs'));
  assert.ok(!listing.includes('oauth_creds'));
});
