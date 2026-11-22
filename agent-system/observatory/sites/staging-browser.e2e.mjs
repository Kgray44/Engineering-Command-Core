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
  let stage;
  let browser;
  t.after(async () => {
    try {
      await browser?.close();
    } finally {
      try { await stage?.close(); } finally { part.sqlite.close(); }
    }
  });
  applyMigrations(part.sqlite);
  part.sqlite.prepare('INSERT INTO application_partition VALUES (1, ?, ?, ?)')
    .run(options.applicationId ?? 'aetherwake', options.applicationRepository ?? 'synthetic/observatory', 'engineering');
  const dist = new URL('../dist/', import.meta.url);
  const assets = { '/': { type: 'text/html', content: await readFile(new URL('index.html', dist), 'utf8') } };
  for (const file of await readdir(new URL('assets/', dist))) {
    assets['/assets/' + file] = { type: file.endsWith('.css') ? 'text/css' : 'text/javascript',
      content: await readFile(new URL('assets/' + file, dist), 'utf8') };
  }
  stage = await startStage(part, { assets, ...options });
  browser = await chromium.launch({ headless: true, executablePath: process.env.OBSERVATORY_BROWSER_EXECUTABLE });
  const page = await browser.newPage({ reducedMotion: 'no-preference', viewport: { width: 1080, height: 780 }, ...options.browser,
    extraHTTPHeaders: { authorization: 'Bearer ' + stage.proof } });
  page.setDefaultTimeout(7000);
  return { stage, page, part };
}

test('Projects workspace performs live project and Task mutations through the shared worker', { timeout: 90_000 }, async t => {
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
  const gridLayer = await page.locator('.scan-grid').evaluate(node => {
    const mask = getComputedStyle(node);
    const grid = getComputedStyle(node, '::before');
    return { mask: mask.maskImage, animation: grid.animationName, period: grid.animationDuration, tile: grid.backgroundSize,
      gradients: (grid.backgroundImage.match(/linear-gradient\(/g) ?? []).length,
      keyframes: node.getAnimations({ subtree: true }).flatMap(animation => animation.effect.getKeyframes()) };
  });
  assert.match(gridLayer.mask, /linear-gradient/);
  assert.equal(gridLayer.animation, 'grid-travel');
  assert.equal(gridLayer.period, '40s');
  // Chromium versions may serialize repeated background sizes as a single value.
  assert.equal(gridLayer.gradients, 2);
  assert.match(gridLayer.tile, /^58px 58px(?:,\s*58px 58px)?$/);
  assert.ok(gridLayer.keyframes.some(keyframe => keyframe.transform?.replaceAll(' ', '') === 'translate(58px,58px)'));
  assert.ok(gridLayer.keyframes.every(keyframe => !('backgroundPosition' in keyframe)));
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
  await page.getByRole('link', { name: 'Synthetic browser task', exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Execution controls for Synthetic browser task' }).click();
  await page.getByRole('navigation', { name: 'Task actions' }).waitFor();
  await page.getByRole('button', { name: 'Close execution controls' }).click();
  await page.getByRole('combobox', { name: 'Focus on a Task' }).waitFor();
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
  const secondHash = new URL(page.url()).hash;
  await page.goto(stage.origin + '/' + projectHash);
  await page.getByText('Move a Task to another Project', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Task to move' }).selectOption({ label: 'Synthetic browser task' });
  await page.getByRole('combobox', { name: 'Destination Project' }).selectOption({ label: 'Second synthetic project' });
  const moved = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST' &&
    response.request().postDataJSON().op === 'move_task');
  await page.getByRole('button', { name: 'Move Task', exact: true }).click();
  assert.equal((await moved).status(), 200);
  await page.goto(stage.origin + '/' + secondHash);
  await page.getByRole('link', { name: 'Synthetic browser task', exact: true }).first().waitFor();
  await page.getByRole('link', { name: 'All projects' }).click();

  const titles = page.locator('.project-card-name');
  const firstNames = ['Second synthetic project', 'Synthetic browser project'];
  await titles.first().waitFor();
  assert.deepEqual(await titles.allTextContents(), firstNames);
  const handle = page.getByRole('button', { name: 'Reorder Second synthetic project' });
  await page.setViewportSize({ width: 1240, height: 1160 });
  await handle.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.view')).transform === 'none');
  async function moveWithKeyboard() {
    await handle.press('Space');
    await page.locator('[data-dragging][data-drag-over]').waitFor();
    await handle.press('ArrowRight');
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
  await page.locator('.project-card-grid').scrollIntoViewIfNeeded();
  await capture(page, 'aetherwake-project-library.png');
  assert.equal(part.sqlite.prepare("SELECT count(*) AS count FROM proposals WHERE project_id IS NOT NULL").get().count, 1);
});

test('Voyagewright mobile Settings and Merge discovery use the shared scoped API', { timeout: 60_000 }, async t => {
  const repository = 'synthetic/voyagewright';
  const head = 'b'.repeat(40);
  const base = 'a'.repeat(40);
  const branch = (ref, sha) => ({ ref, sha, repo: { full_name: repository } });
  const pull = {
    number: 7, title: 'Synthetic proposal for staging', body: 'Review the exact source revision.',
    user: { login: 'synthetic-author' }, state: 'open', changed_files: 1, additions: 5, deletions: 2,
    head: branch('codex/synthetic', head), base: branch('main', base),
    requested_reviewers: [{ login: 'synthetic-reviewer' }], requested_teams: [],
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
  const projectId = crypto.randomUUID();
  const project = await stage.run('/api/projects', { op: 'create', id: projectId,
    fields: { name: 'Release project', objective: 'Trace the pull request to its Project' } });
  assert.equal(project.status, 201);
  const linkedTask = await stage.run('/api/projects', { op: 'register_task', id: projectId, operation_id: crypto.randomUUID(),
    fields: { title: 'Release review', objective: 'Review the exact source', primary: 'backend', profile_id: 'backend', criteria: ['Verify the diff'] } });
  assert.equal(linkedTask.status, 201);
  const taskId = linkedTask.body.task.id;
  assert.equal((await stage.run('/api/task-engine/v1', { op: 'command', task_id: taskId,
    expected_version: linkedTask.body.version, operation_id: crypto.randomUUID(),
    action: { type: 'associate', reference: { kind: 'pull_request', uri: pull.html_url, revision: 'c'.repeat(40) } } })).status, 200);
  const waiting = await stage.run('/api/projects', { op: 'register_task', id: projectId, operation_id: crypto.randomUUID(),
    fields: { title: 'Release follow-up', objective: 'Wait for source review', primary: 'backend', profile_id: 'backend',
      dependencies: [taskId], criteria: ['Wait for prerequisite acceptance'] } });
  assert.equal(waiting.status, 201);
  assert.equal((await stage.run('/api/task-engine/v1', { op: 'command', task_id: waiting.body.task.id,
    expected_version: waiting.body.version, operation_id: crypto.randomUUID(), action: { type: 'admit', executor: 'codex' } })).status, 200);
  await page.goto(stage.origin + '/#settings');
  const shell = page.locator('.app-shell[data-application="voyagewright"]');
  await shell.waitFor();
  assert.equal(await shell.evaluate(node => getComputedStyle(node).getPropertyValue('--accent').trim()), '#c9a95f');
  assert.equal(await page.locator('.settings-card').count(), 10);
  assert.equal(await page.locator('.scan-grid').evaluate(node => getComputedStyle(node, '::before').animationName), 'none');
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
  const panel = name => page.locator('section.panel').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await panel('Project changes').getByRole('link', { name: 'Release project' }).first().waitFor();
  await panel('Waiting on prerequisites').getByRole('link', { name: 'Release follow-up' }).waitFor();
  await panel('Waiting on prerequisites').getByText('Release review', { exact: true }).waitFor();
  await panel('Pull requests awaiting review').getByRole('link', { name: 'Synthetic proposal for staging' }).waitFor();
  await page.getByRole('button', { name: 'Recent work', exact: true }).click();
  await page.getByRole('heading', { name: 'Project changes', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Waiting on prerequisites', exact: true }).count(), 0);
  await page.goto(stage.origin + '/#merge?pr=7');
  await page.getByRole('heading', { name: '#7 Synthetic proposal for staging' }).waitFor();
  const linkedWork = page.getByRole('region', { name: 'Linked engineering work' });
  await linkedWork.getByText('Earlier revision referenced').waitFor();
  assert.equal(await linkedWork.getByRole('link', { name: 'Release project' }).getAttribute('href'), '#projects/' + projectId);
  assert.equal(await linkedWork.getByRole('link', { name: 'Release review' }).getAttribute('href'), '#tasks/' + taskId);
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
  assert.equal(receipt.status(), 201);
  const run = (await receipt.json()).run;
  assert.equal(run.head_sha, head);
  assert.equal(receipt.request().postDataJSON().head_sha, head);
  assert.equal(receipt.request().postDataJSON().pr_number, 7);
  await page.goto(stage.origin + '/#merge?run=' + run.id + '&pr=7');
  await page.locator('#integration-detail-title').waitFor();
});

test('touch reorders Project cards across mobile grid rows and reloads the order', { timeout: 60_000 }, async t => {
  const { stage, page } = await browserStage(t, {
    browser: { viewport: { width: 390, height: 1100 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true },
  });
  for (const name of ['Touch project one', 'Touch project two']) {
    const receipt = await stage.run('/api/projects', { op: 'create', id: crypto.randomUUID(),
      fields: { name, objective: 'Verify touch reordering through the worker' } });
    assert.equal(receipt.status, 201);
  }
  await page.goto(stage.origin + '/#projects');
  const grid = page.locator('.project-card-grid');
  await grid.scrollIntoViewIfNeeded();
  const titles = page.locator('.project-card-name');
  const before = await titles.allTextContents();
  assert.equal(before.length, 2);
  const handle = await page.getByRole('button', { name: 'Reorder ' + before[0] }).boundingBox();
  const first = await page.locator('.project-card').first().boundingBox();
  const second = await page.locator('.project-card').last().boundingBox();
  assert.ok(second.y > first.y);
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  const client = await page.context().newCDPSession(page);
  const touch = (type, touchPoints) => client.send('Input.dispatchTouchEvent', { type, touchPoints });
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), { x, y });
  assert.equal(hit, 'Reorder ' + before[0], JSON.stringify({ handle, first, second, hit }));
  await touch('touchStart', [{ x, y }]);
  await touch('touchMove', [{ x, y: y + 12 }]);
  await page.locator('[data-dragging][data-drag-over]').waitFor();
  for (let step = 1; step <= 10; step++) {
    await touch('touchMove', [{ x, y: y + (second.y - first.y) * step / 10 }]);
  }
  await page.locator('[data-insertion]').waitFor();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/projects') &&
    response.request().method() === 'POST' && response.request().postDataJSON().op === 'reorder');
  await touch('touchEnd', []);
  assert.equal((await saved).status(), 200);
  await page.reload();
  await titles.first().waitFor();
  assert.deepEqual(await titles.allTextContents(), [...before].reverse());
});
