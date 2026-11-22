import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { preferenceFields } from './workspace-preferences.mjs';
import { taskHref } from './task-workspace.mjs';
import { activityHref, activityId, activityState, searchActivity } from './github-activity.mjs';

export function useMergeSource(number, headers) {
  const [result, setResult] = useState(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!number) return;
    const controller = new AbortController();
    fetch('/api/github/pulls/' + number, { headers, signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!controller.signal.aborted) setResult({ number, generation, ...data });
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ number, generation, reason: 'GitHub source is unavailable.' });
      });
    return () => controller.abort();
  }, [number, generation, headers]);
  return {
    source: result?.number === number && result.generation === generation ? result : null,
    reload: () => setGeneration(value => value + 1),
  };
}

export function useMergeSourceContext(number, headers, runs) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!number) return;
    const controller = new AbortController();
    fetch('/api/integrations/v1?pr_number=' + number, { headers, signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!controller.signal.aborted) setResult({ number, data: response.ok && data.associations ? data : null });
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ number, data: null });
      });
    return () => controller.abort();
  }, [number, headers, runs]);
  return result?.number === number ? result : null;
}

function pullReadiness(pull, runs, group, main) {
  const number = activityId('pulls', pull);
  const state = activityState('pulls', pull);
  if (state === 'merged') return ['merged', 'Merged on GitHub'];
  if (group?.status === 'available' && pull.draft) return ['blocked', 'Draft pull request'];
  if (group?.status === 'available' && state === 'closed') return ['blocked', 'Closed pull request'];
  const run = runs.find(item => item.pr_number === number && item.head_sha === pull.revision);
  if (!run) return runs.some(item => item.pr_number === number) ? ['stale', 'Different revision inspected'] : ['unknown', 'Awaiting inspection'];
  if (group?.status !== 'available' || (run.evidence?.base_sha &&
      (main?.status !== 'available' || run.evidence.base_sha !== main.revision))) return ['stale', 'Refresh required'];
  if (run.state === 'merge_ready' && !run.evidence?.base_sha) return ['unknown', 'Base evidence missing'];
  const labels = { merge_ready: 'Checks passed at last inspection', blocked: 'Blocked', checking: 'Checking',
    repairing: 'Repairing', merged: 'Verified merge', deployed: 'Deployed' };
  return [run.state, labels[run.state] ?? 'Awaiting inspection'];
}

const reviewLabels = new Map([
  ['APPROVED', 'Approved'], ['CHANGES_REQUESTED', 'Changes requested'], ['COMMENTED', 'Commented'],
  ['DISMISSED', 'Dismissed'], ['PENDING', 'Pending'],
]);

function PullReviews({ detail, sourceStatus }) {
  const stale = sourceStatus === 'stale' || detail.reviews_status === 'stale';
  const reviews = detail.reviews ?? [];
  return <section aria-label="Submitted reviews">
    <h4>Submitted reviews</h4>
    {stale && <p>Showing last observed reviews.</p>}
    {detail.reviews_truncated && <p>Review list is limited. Open the pull request on GitHub to see all reviews.</p>}
    {detail.reviews_reason && <p>{detail.reviews_reason}</p>}
    {!reviews.length && <p>{detail.reviews_status === 'available' && !stale
      ? 'No submitted reviews were returned.' : 'Submitted reviews are unavailable.'}</p>}
    {reviews.length > 0 && <ul className="integration-evidence">{reviews.map(review => {
      const author = review.author ?? 'Unknown reviewer';
      const relationship = !review.revision ? 'Reviewed commit unavailable'
        : review.revision === detail.head?.sha ? 'Matches displayed head' : 'Different reviewed commit';
      return <li key={review.id}>
        <span>{detail.url ? <a href={detail.url + '#pullrequestreview-' + review.id} aria-label={'Review by ' + author}>{author}</a> : author}
          {review.submitted_at && <small><time dateTime={review.submitted_at}>{new Date(review.submitted_at).toLocaleString()}</time></small>}
        </span>
        <span><strong>{reviewLabels.get(review.state) ?? 'Unknown review state'}</strong><small>{relationship}
          {review.revision && <> <code title={review.revision}>{review.revision.slice(0, 12)}</code></>}
        </small></span>
      </li>;
    })}</ul>}
    <p>Open the pull request on GitHub to see its review requirements.</p>
  </section>;
}

function PullCheckPreview({ number, head, headers }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  const read = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch('/api/integrations/v1?' + new URLSearchParams({ pr_number: number, head_sha: head }),
        { headers, signal: controller.signal, cache: 'no-store' });
      const body = await response.json();
      if (!controller.signal.aborted) setResult(response.ok ? body : { detail: body.error });
    } catch {
      if (!controller.signal.aborted) setResult({ detail: 'GitHub check preview is unavailable.' });
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setLoading(false);
      }
    }
  };
  return <section aria-label="Pull request check preview">
    <h4>Exact-head check preview</h4>
    <button type="button" className="quiet-button" disabled={loading} onClick={read}>Preview required checks</button>
    {loading && <p role="status">Reading GitHub checks…</p>}
    {result && <>
      <p>Selected head <code>{head.slice(0, 12)}</code></p>
      {result.detail && <p role="status">{result.detail}</p>}
      {result.check_error && <p>{result.check_error}</p>}
      {result.checks?.length ? <ul className="integration-evidence">{result.checks.map(check => <li key={JSON.stringify([check.context, check.app, check.source])}>
        <span>{check.context}</span><strong>{check.state}</strong>
      </li>)}</ul> : <p>No required check evidence available for this head.</p>}
      {!!result.jobs?.length && <ul className="integration-evidence">{result.jobs.map(job => <li key={job.job_id}>
        <a href={job.url}>{job.name ?? 'Failed job ' + job.job_id}</a><strong>{job.conclusion}</strong>
      </li>)}</ul>}
    </>}
  </section>;
}

export function MergeSourcePicker({ group, main, number, onSelect, source, context, reload, runs, onRun, preferences, headers }) {
  const [query, setQuery] = useState('');
  const [stateOverride, setState] = useState(null);
  const [sortOverride, setSort] = useState(null);
  const [readinessOverride, setReadiness] = useState(null);
  const state = stateOverride ?? preferences.merge_state;
  const sort = sortOverride ?? preferences.merge_sort;
  const readiness = readinessOverride ?? preferences.merge_readiness;
  const reduced = useReducedMotion();
  const pulls = searchActivity('pulls', group?.items ?? [], { query, state: state === 'all' ? '' : state, oldest: sort === 'oldest' })
    .filter(pull => readiness === 'all' || pullReadiness(pull, runs, group, main)[0] === readiness);
  if (sort === 'updated') pulls.sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0));
  const detail = source?.detail;
  const summary = detail ? null : group?.items?.find(pull => activityId('pulls', pull) === number);
  const githubUrl = detail?.url ?? summary?.url;
  const matchingRuns = context?.data?.runs ?? runs.filter(run => run.pr_number === number);
  return <div className="merge-discovery">
    <div className="merge-discovery-filters">
      <label>Search pull requests<input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <label>State<select value={state} onChange={event => setState(event.target.value)}>
        {Object.entries(preferenceFields.merge_state.choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Integration evidence<select value={readiness} onChange={event => setReadiness(event.target.value)}>
        {Object.entries(preferenceFields.merge_readiness.choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Sort<select value={sort} onChange={event => setSort(event.target.value)}>
        {Object.entries(preferenceFields.merge_sort.choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    {group?.status && group.status !== 'available' && <p role="status">Pull request feed {group.status}. {group.reason}</p>}
    <ul className="merge-source-list">
      {pulls.map(pull => {
        const id = activityId('pulls', pull);
        if (!id) return null;
        const [, evidence] = pullReadiness(pull, runs, group, main);
        return <li key={id}><button type="button" className="quiet-button" aria-pressed={id === number} onClick={() => onSelect(id)}>
          <strong>#{id} {pull.title}</strong><small>{activityState('pulls', pull)}{' · ' + evidence}</small>
        </button></li>;
      })}
    </ul>
    {!pulls.length && <p>No pull requests match the current view.</p>}
    {number && <motion.section key={number} className="merge-source-detail"
      initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .18 }}>
      <h3>#{number} {detail?.title ?? summary?.title ?? 'Pull request'}</h3>
      <p role="status">{!source ? 'Reading GitHub source…' : source.reason || source.error ||
        (source.observed_at ? 'GitHub observed ' + new Date(source.observed_at).toLocaleString() : 'GitHub observation unavailable')}</p>
      <div className="integration-actions">
        <a href={activityHref('pulls', number)}>Pull request details</a>
        {githubUrl && <a href={githubUrl}>Open on GitHub</a>}
        {source && source.status !== 'available' && <a href="#settings/connections">GitHub connection settings</a>}
        <button type="button" className="quiet-button" onClick={reload}>Refresh GitHub source</button>
      </div>
      {summary && <>
        <p>Last observed repository feed{group.observed_at ? ' · ' + new Date(group.observed_at).toLocaleString() : ''}</p>
        <p>{summary.author ?? 'Unknown author'} · {summary.merged ? 'Merged' : summary.draft ? 'Draft' : summary.state}</p>
        <dl className="integration-revisions">
          <div><dt>Observed source branch</dt><dd>{summary.head_ref ?? 'Unavailable'}</dd></div>
          <div><dt>Observed target branch</dt><dd>{summary.base_ref ?? 'Unavailable'}</dd></div>
          <div><dt>Observed head</dt><dd><code>{summary.revision ?? 'Unavailable'}</code></dd></div>
        </dl>
      </>}
      {detail && <>
        <p>{detail.author ?? 'Unknown author'} · {detail.merged ? 'Merged' : detail.draft ? 'Draft' : detail.state}</p>
        {detail.body && <details><summary>Description</summary><p className="objective">{detail.body}</p></details>}
        <dl className="integration-revisions">
          <div><dt>Source · {detail.head?.ref}</dt><dd><code>{detail.head?.sha}</code></dd></div>
          <div><dt>Target · {detail.base?.ref}</dt><dd><code>{detail.base?.sha}</code></dd></div>
        </dl>
        <p>{detail.changed_files ?? 'Unknown'} files · +{detail.additions ?? '?'} / −{detail.deletions ?? '?'}</p>
        {detail.requested_reviewers?.length > 0 && <p>Requested reviewers {detail.requested_reviewers.join(', ')}</p>}
        <PullReviews detail={detail} sourceStatus={source.status}/>
        {detail.files?.length > 0 && <details><summary>Changed files</summary><ul>{detail.files.map(file => <li key={file.path}>{file.path}</li>)}</ul></details>}
        {source.status === 'available' && detail.state === 'open' && /^[0-9a-f]{40}$/.test(detail.head?.sha ?? '') &&
          <PullCheckPreview key={detail.head.sha} number={number} head={detail.head.sha} headers={headers}/>}
      </>}
      {context && <section aria-label="Linked engineering work">
        <h4>Linked engineering work</h4>
        {!context.data && <p>Task and Project associations are unavailable.</p>}
        {context.data?.associations.length === 0 && <p>No Task or Project is linked to this pull request.</p>}
        {context.data?.truncated && <p>Showing the first 50 records.</p>}
        {context.data?.associations.length > 0 && <ul className="integration-evidence">{context.data.associations.map(item => <li key={item.task.id}>
          <span><a href={taskHref(item.task.id)}>{item.task.title}</a>
            {item.project && <small><a href={'#projects/' + item.project.id}>{item.project.name}</a></small>}</span>
          <small>{!detail?.head?.sha ? 'PR association recorded' : item.references.some(ref => ref.revision === detail.head.sha)
            ? 'Current head referenced' : 'Earlier revision referenced'}</small>
        </li>)}</ul>}
      </section>}
      {matchingRuns.length > 0 && <ul className="merge-source-list">{matchingRuns.map(run => <li key={run.id}>
        <button type="button" className="quiet-button" onClick={() => onRun(run.id)}>{run.state.replaceAll('_', ' ')} · {run.head_sha.slice(0, 12)}
          {run.updated_at && <small>{new Date(run.updated_at).toLocaleString()}</small>}
        </button>
      </li>)}</ul>}
    </motion.section>}
  </div>;
}
