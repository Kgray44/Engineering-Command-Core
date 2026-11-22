import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
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

export function MergeSourcePicker({ group, number, onSelect, source, reload, runs, onRun, defaultState }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState(defaultState === 'all' ? '' : defaultState ?? 'open');
  const [oldest, setOldest] = useState(false);
  const reduced = useReducedMotion();
  const pulls = searchActivity('pulls', group?.items ?? [], { query, state, oldest });
  const detail = source?.detail;
  const matchingRuns = runs.filter(run => run.pr_number === number);
  return <div className="merge-discovery">
    <div className="merge-discovery-filters">
      <label>Search pull requests<input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <label>State<select value={state} onChange={event => setState(event.target.value)}>
        <option value="open">Open</option><option value="merged">Merged</option><option value="closed">Closed</option><option value="">All states</option>
      </select></label>
      <label>Sort<select value={oldest ? 'oldest' : 'newest'} onChange={event => setOldest(event.target.value === 'oldest')}>
        <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
      </select></label>
    </div>
    {group?.status && group.status !== 'available' && <p role="status">Pull request feed {group.status}. {group.reason}</p>}
    <ul className="merge-source-list">
      {pulls.map(pull => {
        const id = activityId('pulls', pull);
        if (!id) return null;
        const run = runs.find(item => item.pr_number === id);
        return <li key={id}><button type="button" className="quiet-button" aria-pressed={id === number} onClick={() => onSelect(id)}>
          <strong>#{id} {pull.title}</strong><small>{activityState('pulls', pull)}{run && ' · Integration ' + run.state.replaceAll('_', ' ')}</small>
        </button></li>;
      })}
    </ul>
    {!pulls.length && <p>No pull requests match the current view.</p>}
    {number && <motion.section key={number} className="merge-source-detail"
      initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .18 }}>
      <h3>#{number} {detail?.title ?? 'Pull request'}</h3>
      <p role="status">{!source ? 'Reading GitHub source…' : source.reason || source.error ||
        (source.observed_at ? 'GitHub observed ' + new Date(source.observed_at).toLocaleString() : 'GitHub observation unavailable')}</p>
      <div className="integration-actions">
        <a href={activityHref('pulls', number)}>Pull request details</a>
        {detail?.url && <a href={detail.url}>Open on GitHub</a>}
        <button type="button" className="quiet-button" onClick={reload}>Refresh GitHub source</button>
      </div>
      {detail && <>
        <p>{detail.author ?? 'Unknown author'} · {detail.merged ? 'Merged' : detail.draft ? 'Draft' : detail.state}</p>
        {detail.body && <details><summary>Description</summary><p className="objective">{detail.body}</p></details>}
        <dl className="integration-revisions">
          <div><dt>Source · {detail.head?.ref}</dt><dd><code>{detail.head?.sha}</code></dd></div>
          <div><dt>Target · {detail.base?.ref}</dt><dd><code>{detail.base?.sha}</code></dd></div>
        </dl>
        <p>{detail.changed_files ?? 'Unknown'} files · +{detail.additions ?? '?'} / −{detail.deletions ?? '?'}</p>
        {detail.requested_reviewers?.length > 0 && <p>Requested reviewers {detail.requested_reviewers.join(', ')}</p>}
        {detail.files?.length > 0 && <details><summary>Changed files</summary><ul>{detail.files.map(file => <li key={file.path}>{file.path}</li>)}</ul></details>}
      </>}
      {matchingRuns.length > 0 && <ul className="merge-source-list">{matchingRuns.map(run => <li key={run.id}>
        <button type="button" className="quiet-button" onClick={() => onRun(run.id)}>{run.state.replaceAll('_', ' ')} · {run.head_sha.slice(0, 12)}</button>
      </li>)}</ul>}
    </motion.section>}
  </div>;
}
