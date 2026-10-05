import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { load } from './audit-fixes.test.mjs';

test('Alias nativo codebase_investigator: comportamento de ownership e remoção', t => {
  const { saveAgentToFile, ensureAllAgentsSynchronizedAndAcknowledged } = load('server/agents-service.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-ownership-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const agentsDir = path.join(dir, '.gemini/agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  const test_ownershipPath = path.join(agentsDir, '.gui-owned-agents.json');

  const agent = { name: 'investigator', id: 'investigator' };
  const aliasFile = path.join(agentsDir, 'codebase_investigator.md');

  // 1. GUI-owned native alias (same hash) -> removed
  fs.writeFileSync(aliasFile, 'GUI-CONTENT');
  const hash = crypto.createHash('sha256').update('GUI-CONTENT').digest('hex');
  fs.writeFileSync(test_ownershipPath, JSON.stringify({ 'codebase_investigator.md': hash }));
  saveAgentToFile(agent, dir, true);
  assert.equal(fs.existsSync(aliasFile), false, '1. GUI-owned alias (same hash) should be removed');

  // 2. User-owned native alias (different hash, no ownership) -> preserved
  fs.writeFileSync(aliasFile, 'USER-CONTENT');
  saveAgentToFile(agent, dir, true);
  assert.equal(fs.existsSync(aliasFile), true, '2. User-owned alias should be preserved');

  // 3. Native alias inexistente -> not created
  fs.unlinkSync(aliasFile);
  saveAgentToFile(agent, dir, true);
  assert.equal(fs.existsSync(aliasFile), false, '3. Native alias should not be recreated');

  // 4 & 5. Canonical agent (not alias) -> should not be removed
  const canonicalFile = path.join(agentsDir, 'investigator.md');
  fs.writeFileSync(canonicalFile, 'CANONICAL-CONTENT');
  const canonicalHash = crypto.createHash('sha256').update('CANONICAL-CONTENT').digest('hex');
  fs.writeFileSync(test_ownershipPath, JSON.stringify({ 'investigator.md': canonicalHash }));
  
  // 4. GUI-owned canonical (same hash) -> Not removed by cleanup because it's canonical
  // 5. Canonical modified by user -> still skipped
  fs.writeFileSync(canonicalFile, 'MODIFIED-CONTENT');
  
  // Run cleanup
  ensureAllAgentsSynchronizedAndAcknowledged(dir, dir);
  assert.equal(fs.existsSync(canonicalFile), true, '4&5. Canonical agent should be preserved');

  // 6 & 7. Obsolete agent (GUI-owned)
  const obsoleteFile = path.join(agentsDir, 'obsolete.md');
  const obsoleteHash = 'hash-obsolete';
  fs.writeFileSync(obsoleteFile, 'OBSOLETE-CONTENT');
  fs.writeFileSync(test_ownershipPath, JSON.stringify({ 'obsolete.md': obsoleteHash })); // Set initial hash
  
  // Update hash to match for test 6
  const actualHash = crypto.createHash('sha256').update('OBSOLETE-CONTENT').digest('hex');
  fs.writeFileSync(test_ownershipPath, JSON.stringify({ 'obsolete.md': actualHash }));
  ensureAllAgentsSynchronizedAndAcknowledged(dir, dir);
  assert.equal(fs.existsSync(obsoleteFile), false, '6. Obsolete agent (same hash) should be removed');

  // 7. Obsolete agent (diff hash) -> preserved
  fs.writeFileSync(obsoleteFile, 'OBSOLETE-CONTENT-MODIFIED');
  fs.writeFileSync(test_ownershipPath, JSON.stringify({ 'obsolete.md': actualHash })); // hash mismatch!
  ensureAllAgentsSynchronizedAndAcknowledged(dir, dir);
  assert.equal(fs.existsSync(obsoleteFile), true, '7. Obsolete agent (diff hash) should be preserved');
});
