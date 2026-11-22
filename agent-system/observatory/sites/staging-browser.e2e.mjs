import assert from 'node:assert/strict';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { applyMigrations, openPartition } from './sqlite-runtime.mjs';
import { startStage } from './staging-fixture.mjs';

async function capture(page, file) {
  const directory = process.env.COMMAND_CORE_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, file), animations: 'disabled' });
}

async function browserStage(t, options = {}) {
  const part = openPartition(':memory:');
  t.after(() => part.sqlite.close());
  applyMigrations(part.sqlite);
  part.sqlite.prepare('INSERT INTO application_partition VALUES (1, ?, ?, ?)')
    .run(options.applicationId ?? 'aetherwake', options.applicationRepository ?? 'synthetic/observatory', 'engineering');
  const dist = new URL('../dist/', import.meta.url);
  const assets = { '/': { type: 'text/html', content: await readFile(new URL('index.html', dist), 'utf8') } };
  for (const file of await readdir(new URL('assets/', dist))) {
    assets['/assets/' + file] = { type: file.endsWith('.css') ? 'text/css' : 'text/javascript',
      content: await readFile(new URL('assets/' + file, dist), 'utf8') };
  }
  const stage = await startStage(part, { assets, ...options });
  t.after(() => stage.close());
  const browser = await chromium.launch({ headless: true, executablePath: process.env.OBSERVATORY_BROWSER_EXECUTABLE });
  t.after(() => browser.close());
  const page = await browser.newPage({ reducedMotion: 'no-preference', viewport: { width: 1080, height: 780 }, ...options.browser,
    extraHTTPHeaders: { authorization: 'Bearer ' + stage.proof } });
  page.setDefaultTimeout(7000);
  return { stage, page, part };
}

test('Projects workspace performs live project and Task mutations through the shared worker', async t => {
  const { stage, page, part } = await browserStage(t);
  await page.goto(stage.origin);
  const enteredWithBlur = page.waitForFunction(() => {
    const card = document.querySelector('.project-portfolio .metric');
    return card && getComputedStyle(card).filter.startsWith('blur(');
  });
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await enteredWithBlur;
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.project-portfolio .metric')).filter === 'none');
  assert.equal(await page.locator('.sidebar').evaluate(node => getComputedStyle(node).backdropFilter), 'blur(22px)');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Synthetic browser project');
  await page.getByLabel('Objective', { exact: true }).fill('Prove a Project owns its newly registered Tasks');
  await page.getByText('Project appearance', { exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find a project icon' }).fill('rocket');
  await page.getByRole('button', { name: 'rocket', exact: true }).click();
  await page.getByLabel('Accent color').selectOption('violet');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('heading', { name: 'Synthetic browser project', exact: true }).waitFor();
  const projectHash = new URL(page.url()).hash;
  const sectionNav = page.getByRole('navigation', { name: 'Jump to Project section' });
  const historyHeading = page.locator('#project-history h2');
  assert.equal(await historyHeading.count(), 1, 'Below-fold content mounts before scrolling');
  const projectRequests = [];
  const collectRequests = request => {
    if (new URL(request.url()).pathname.startsWith('/api/projects')) projectRequests.push(request.url());
  };
  page.on('request', collectRequests);
  await sectionNav.getByRole('button', { name: 'History' }).click();
  await page.waitForFunction(() => document.activeElement === document.querySelector('#project-history h2') && window.scrollY > 0);
  page.off('request', collectRequests);
  assert.equal(projectRequests.length, 0, 'Scrolling does not fetch additional Project data');
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
  await page.getByText('0 of 1 Tasks complete · 0 running · 0 blocked · 0 verifying', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'All projects' }).click();
  await page.getByText('0/1 Tasks complete · 0 running · 0 blocked · 0/1 milestones accepted', { exact: true }).waitFor();
  const explorer = page.getByRole('navigation', { name: 'Project activity views' });
  const search = page.getByRole('searchbox', { name: 'Search projects' });
  await explorer.getByRole('button', { name: /Archived/ }).click();
  await page.getByText('No Projects match these filters.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await search.fill('wrong name');
  await page.getByText('No Projects match these filters.', { exact: true }).waitFor();
  await search.fill('synthetic');
  await page.locator('.project-card[data-accent="violet"]').filter({ hasText: 'Synthetic browser project' }).waitFor();
  const refresh = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Refresh records' }).click();
  assert.equal((await refresh).status(), 200);
  assert.equal(await search.inputValue(), 'synthetic');
  await search.clear();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Second synthetic project');
  await page.getByLabel('Objective', { exact: true }).fill('Prove order persistence across reloads');
  await page.getByLabel('Project template').selectOption('research');
  assert.match(await page.getByLabel('Suggested milestones').inputValue(), /Define the question/);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('heading', { name: 'Second synthetic project', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Draft Define the question' }).click();
  assert.equal(await page.getByLabel('Milestone name').inputValue(), 'Define the question');
  await page.getByRole('link', { name: 'All projects' }).click();

  const titles = page.locator('.project-card-name');
  const firstNames = ['Second synthetic project', 'Synthetic browser project'];
  await titles.first().waitFor();
  assert.deepEqual(await titles.allTextContents(), firstNames);
  const handle = page.getByRole('button', { name: 'Reorder Second synthetic project' });
  const cards = page.locator('.project-card');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.view')).transform === 'none');
  const initial = await cards.first().boundingBox();
  const target = await cards.last().boundingBox();
  const direction = target.y > initial.y + 20 ? 'ArrowDown' : 'ArrowRight';
  async function moveWithKeyboard() {
    await handle.press('Space');
    await page.waitForFunction(() => document.querySelector('[data-dragging]'));
    await page.keyboard.press(direction);
    await page.locator('[data-insertion]').waitFor();
  }
  await moveWithKeyboard();
  await page.keyboard.press('Escape');
  await page.getByText('Reordering canceled', { exact: true }).waitFor({ state: 'attached' });
  assert.deepEqual(await titles.allTextContents(), firstNames);
  const reorderReceipt = () => page.waitForResponse(response => response.url().endsWith('/api/projects') &&
    response.request().method() === 'POST' && response.request().postDataJSON().op === 'reorder');
  const keyboardReceipt = reorderReceipt();
  await moveWithKeyboard();
  await page.keyboard.press('Space');
  assert.equal((await keyboardReceipt).status(), 200);
  await page.reload();
  await titles.first().waitFor();
  assert.deepEqual(await titles.allTextContents(), [...firstNames].reverse());
  await search.fill('Second');
  assert.equal(await page.getByRole('button', { name: /Reorder / }).count(), 0);
  await search.clear();

  await handle.scrollIntoViewIfNeeded();
  const mouseReceipt = reorderReceipt();
  const from = await handle.boundingBox();
  const to = await page.locator('.project-card').first().boundingBox();
  const card = await page.locator('.project-card').last().boundingBox();
  const fromX = from.x + from.width / 2;
  const fromY = from.y + from.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + to.x - card.x, fromY + to.y - card.y, { steps: 16 });
  await page.mouse.up();
  assert.equal((await mouseReceipt).status(), 200);
  await page.reload();
  await titles.first().waitFor();
  assert.deepEqual(await titles.allTextContents(), firstNames);
  await capture(page, 'aetherwake-project-library.png');
  assert.equal(part.sqlite.prepare("SELECT count(*) AS count FROM proposals WHERE project_id IS NOT NULL").get().count, 1);
});

test('Voyagewright mobile Settings and Merge discovery use the shared scoped API', async t => {
  const repository = 'synthetic/voyagewright';
  const head = 'b'.repeat(40);
  const base = 'a'.repeat(40);
  const branch = (ref, sha) => ({ ref, sha, repo: { full_name: repository } });
  const pull = {
    number: 7, title: 'Synthetic proposal for staging', body: 'Review the exact source revision.',
    user: { login: 'synthetic-author' }, state: 'open', changed_files: 1, additions: 5, deletions: 2,
    head: branch('codex/synthetic', head), base: branch('main', base),
    html_url: 'https://github.com/' + repository + '/pull/7', created_at: '2026-11-20T00:00:00Z',
  };
  const { stage, page } = await browserStage(t, {
    applicationId: 'voyagewright', applicationRepository: repository, githubToken: 'synthetic-read-token',
    browser: { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true },
    fetcher: async input => {
      const url = new URL(input);
      if (!url.pathname.startsWith('/repos/' + repository + '/')) return Response.json({}, { status: 404 });
      if (url.pathname.endsWith('/pulls/7')) return Response.json(pull);
      if (url.pathname.endsWith('/pulls')) return Response.json([pull]);
      if (url.pathname.endsWith('/files')) return Response.json([{ filename: 'guide.md', status: 'modified', additions: 5, deletions: 2 }]);
      if (url.pathname.endsWith('/reviews') || url.pathname.endsWith('/commits')) return Response.json([]);
      if (url.pathname.endsWith('/git/ref/heads/main')) return Response.json({ ref: 'refs/heads/main', object: { sha: base } });
      return Response.json({}, { status: 404 });
    },
  });
  await page.goto(stage.origin + '/#settings');
  const shell = page.locator('.app-shell[data-application="voyagewright"]');
  await shell.waitFor();
  assert.equal(await shell.evaluate(node => getComputedStyle(node).getPropertyValue('--accent').trim()), '#c9a95f');
  assert.equal(await page.locator('.settings-card').count(), 10);
  await capture(page, 'voyagewright-settings-mobile.png');
  await page.getByRole('link', { name: /General Landing page/ }).click();
  await page.getByLabel('Panel density').selectOption('compact');
  await page.getByLabel('Landing page').selectOption('projects');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Settings saved.', { exact: true }).waitFor();
  assert.equal(await shell.getAttribute('data-density'), 'compact');
  await page.goto(stage.origin);
  await page.waitForURL(/#projects$/);
  await page.goto(stage.origin + '/#settings/general');
  assert.equal(await page.getByLabel('Panel density').inputValue(), 'compact');
  await page.getByRole('button', { name: 'Restore defaults' }).click();
  await page.getByText('Category defaults restored.', { exact: true }).waitFor();
  assert.equal(await shell.getAttribute('data-density'), 'comfortable');
  await page.goto(stage.origin + '/#settings/security');
  await page.getByText('Settings audit', { exact: true }).click();
  await page.getByText(/Revision 2/).waitFor();
  await page.goto(stage.origin + '/#activity');
  await page.getByRole('heading', { name: 'Activity and attention' }).waitFor();
  await page.goto(stage.origin + '/#merge?pr=7');
  await page.getByRole('heading', { name: '#7 Synthetic proposal for staging' }).waitFor();
  await page.getByText(head, { exact: true }).waitFor();
  await page.getByText('Changed files', { exact: true }).click();
  await page.getByText('guide.md', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Open on GitHub' }).getAttribute('href'), pull.html_url);
  assert.equal(await page.getByRole('button', { name: 'Inspect source' }).isEnabled(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 1250, height: 930 });
  await capture(page, 'voyagewright-merge-source.png');
  const inspection = page.waitForResponse(response => response.url().endsWith('/api/integrations/v1') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Inspect source' }).click();
  const receipt = await inspection;
  assert.equal(receipt.request().postDataJSON().head_sha, head);
  assert.equal(receipt.request().postDataJSON().pr_number, 7);
});
