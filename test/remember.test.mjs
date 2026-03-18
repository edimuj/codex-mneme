import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  remember,
  listRemembered,
  editRemembered,
  forgetRemembered
} from '../src/lib/remember.mjs';
import { projectPaths } from '../src/lib/paths.mjs';

process.env.CODEX_MNEME_HOME = mkdtempSync(join(tmpdir(), 'codex-mneme-remember-home-'));

function tempProjectDir(prefix) {
  return mkdtempSync(join(tmpdir(), `codex-mneme-${prefix}-`));
}

test('remember stores typed entries and defaults to note', () => {
  const cwd = tempProjectDir('typed');

  const first = remember({
    cwd,
    type: 'decision',
    content: 'Use log.jsonl as source of truth'
  });
  const second = remember({
    cwd,
    content: 'Need better startup context'
  });

  assert.equal(first.entry.type, 'decision');
  assert.equal(second.entry.type, 'note');

  const listed = listRemembered({ cwd });
  assert.equal(listed.entries.length, 2);
  assert.match(listed.entries[0].id, /^[0-9a-f-]{20,}$/);
  assert.match(listed.entries[1].id, /^[0-9a-f-]{20,}$/);
});

test('remember rejects invalid types', () => {
  const cwd = tempProjectDir('invalid-type');
  assert.throws(
    () => remember({ cwd, type: 'random', content: 'bad type' }),
    /invalid remember type/
  );
});

test('editRemembered updates content and type by id prefix', () => {
  const cwd = tempProjectDir('edit');
  const created = remember({
    cwd,
    type: 'note',
    content: 'Original note'
  });

  const updated = editRemembered({
    cwd,
    id: created.entry.id.slice(0, 8),
    type: 'todo',
    content: 'Updated todo'
  });

  assert.equal(updated.entry.type, 'todo');
  assert.equal(updated.entry.content, 'Updated todo');
  assert.ok(updated.entry.updatedAt);
});

test('forgetRemembered removes one entry by id prefix', () => {
  const cwd = tempProjectDir('forget');
  const first = remember({ cwd, content: 'first' });
  const second = remember({ cwd, content: 'second' });

  const removed = forgetRemembered({
    cwd,
    id: first.entry.id.slice(0, 8)
  });

  assert.equal(removed.removed, 1);
  assert.equal(removed.entry.id, first.entry.id);

  const listed = listRemembered({ cwd });
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].id, second.entry.id);
});

test('editRemembered can update only type', () => {
  const cwd = tempProjectDir('edit-type-only');
  const created = remember({
    cwd,
    type: 'note',
    content: 'Keep this content'
  });

  const updated = editRemembered({
    cwd,
    id: created.entry.id.slice(0, 8),
    type: 'constraint'
  });

  assert.equal(updated.entry.type, 'constraint');
  assert.equal(updated.entry.content, 'Keep this content');
  assert.ok(updated.entry.updatedAt);
});

test('listRemembered migrates legacy entries without ids', () => {
  const cwd = tempProjectDir('legacy');
  const paths = projectPaths(cwd);
  mkdirSync(paths.base, { recursive: true });
  writeFileSync(paths.remembered, JSON.stringify([
    {
      type: 'note',
      content: 'legacy remember entry',
      timestamp: '2026-03-18T00:00:00.000Z'
    }
  ], null, 2));

  const listed = listRemembered({ cwd });
  assert.equal(listed.entries.length, 1);
  assert.ok(listed.entries[0].id);
  assert.equal(listed.entries[0].content, 'legacy remember entry');

  const onDisk = JSON.parse(readFileSync(paths.remembered, 'utf8'));
  assert.equal(typeof onDisk[0].id, 'string');
  assert.equal(onDisk[0].type, 'note');
});
