import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';
import { applyMigrations, openPartition } from './sqlite-runtime.mjs';
import { startStage } from './staging-fixture.mjs';

test('Projects workspace performs live project and Task mutations through the shared worker', async t => {
  const part = openPartition(':memory:');
  t.after(() => part.sqlite.close());
  applyMigrations(part.sqlite);
  part.sqlite.prepare('INSERT INTO application_partition VALUES (1, ?, ?, ?)').run('aetherwake', 'synthetic/observatory', 'engineering');
  const dist = new URL('../dist/', import.meta.url);
  const assets = { '/': { type: 'text/html', content: await readFile(new URL('index.html', dist), 'utf8') } };
  for (const file of await readdir(new URL('assets/', dist))) {
    assets['/assets/' + file] = { type: file.endsWith('.css') ? 'text/css' : 'text/javascript',
      content: await readFile(new URL('assets/' + file, dist), 'utf8') };
  }
  const stage = await startStage(part, { assets });
  t.after(() => stage.close());
  const browser = await chromium.launch({ headless: true, executablePath: process.env.OBSERVATORY_BROWSER_EXECUTABLE });
  t.after(() => browser.close());
  const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1080, height: 780 },
    extraHTTPHeaders: { authorization: 'Bearer ' + stage.proof } });
  page.setDefaultTimeout(7000);
  await page.goto(stage.origin);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Synthetic browser project');
  await page.getByLabel('Objective', { exact: true }).fill('Prove a Project owns its newly registered Tasks');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('heading', { name: 'Synthetic browser project', exact: true }).waitFor();
  const projectHash = new URL(page.url()).hash;
  const result = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  assert.equal((await result).status(), 200);
  await page.getByRole('button', { name: 'New milestone', exact: true }).click();
  await page.getByLabel('Milestone name').fill('Synthetic acceptance milestone');
  await page.getByLabel('Acceptance evidence required').fill('A real browser submission receipt');
  const milestoneReceipt = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add milestone', exact: true }).click();
  const milestoneResponse = await milestoneReceipt;
  assert.equal(milestoneResponse.status(), 201, await milestoneResponse.text());
  await page.locator('summary').filter({ hasText: 'Synthetic acceptance milestone' }).waitFor();
  await page.getByRole('button', { name: 'New project task', exact: true }).click();
  await page.getByLabel('Task title').fill('Synthetic browser task');
  await page.getByLabel('Tangible objective').fill('Prove linked Task creation using the existing workspace');
  await page.getByLabel('Acceptance criteria').fill('A Task registration is visible within its Project');
  await page.getByRole('button', { name: 'Create Task', exact: true }).click();
  await page.waitForURL(/#tasks\/task_/, { timeout: 7000 });
  await page.goto(stage.origin + '/' + projectHash);
  await page.getByRole('link', { name: 'Synthetic browser task', exact: true }).waitFor();
  assert.equal(part.sqlite.prepare("SELECT count(*) AS count FROM proposals WHERE project_id IS NOT NULL").get().count, 1);
});
