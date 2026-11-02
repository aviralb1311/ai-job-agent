import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

type Job = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  source: string;
  applicationUrl: string;
  publishedAt: string | null;
  status: string;
  employmentType?: string;
};
type SyncSummary = {
  fetched: number;
  inserted: number;
  updated: number;
  duplicatesSkipped: number;
  errors: string[];
};
type Provider = "GREENHOUSE" | "LEVER" | "ASHBY";
type JobSource = {
  id: string;
  provider: Provider;
  boardId: string;
  displayName: string | null;
  enabled: boolean;
  createdAt: string;
};
type SourcePreview = {
  success: boolean;
  provider: Provider;
  boardId: string;
  jobCount: number;
  sample: Array<{ title: string; location: string | null; url: string }>;
  error?: string;
  detail?: string;
};
const API = "http://localhost:4000";

export function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<JobSource[]>([]);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [savingSource, setSavingSource] = useState(false);
  const [error, setError] = useState("");
  const [sourceMessage, setSourceMessage] = useState("");
  const [total, setTotal] = useState(0);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [provider, setProvider] = useState<Provider>("GREENHOUSE");
  const [boardId, setBoardId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [preview, setPreview] = useState<SourcePreview | null>(null);

  const loadJobs = useCallback(async (filters = { query, location, source }) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filters.query.trim()) params.set("q", filters.query.trim());
      if (filters.location.trim()) params.set("location", filters.location.trim());
      if (filters.source) params.set("source", filters.source);
      params.set("limit", "100");
      const response = await fetch(`${API}/api/jobs?${params.toString()}`);
      if (!response.ok) throw new Error("Could not load jobs. Check that the API and database are running.");
      const body = await response.json() as { data: Job[]; total: number };
      setJobs(body.data);
      setTotal(body.total ?? body.data.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [query, location, source]);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const response = await fetch(`${API}/api/sources`);
      const body = await response.json() as { data?: JobSource[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load configured sources");
      setSources(body.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load configured sources");
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  async function sync() {
    setSyncing(true);
    setError("");
    setSyncSummary(null);
    try {
      const response = await fetch(`${API}/api/jobs/sync`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || body.error || "Job sync failed");
      setSyncSummary(body as SyncSummary);
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function addAndValidateSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingSource(true);
    setSourceMessage("");
    setPreview(null);
    setError("");
    try {
      const response = await fetch(`${API}/api/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, boardId: boardId.trim(), displayName: displayName.trim() })
      });
      const body = await response.json() as { data?: JobSource; error?: string; detail?: string };
      if (!response.ok || !body.data) throw new Error(body.detail || body.error || "Could not add source");

      const saved = body.data;
      setSources(current => [saved, ...current]);
      setBoardId("");
      setDisplayName("");

      const testResponse = await fetch(`${API}/api/sources/${saved.id}/test`, { method: "POST" });
      const testBody = await testResponse.json() as SourcePreview;
      if (!testResponse.ok || !testBody.success) {
        setSourceMessage(`Source saved, but validation failed: ${testBody.detail || testBody.error || "Provider did not respond successfully"}`);
      } else {
        setPreview(testBody);
        setSourceMessage(`Connected successfully. Found ${testBody.jobCount} public job postings.`);
      }
    } catch (e) {
      setSourceMessage(e instanceof Error ? e.message : "Could not add source");
    } finally {
      setSavingSource(false);
    }
  }

  async function toggleSource(item: JobSource) {
    setError("");
    try {
      const response = await fetch(`${API}/api/sources/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !item.enabled })
      });
      const body = await response.json() as { data?: JobSource; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error || "Could not update source");
      setSources(current => current.map(sourceItem => sourceItem.id === item.id ? body.data! : sourceItem));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update source");
    }
  }

  async function removeSource(item: JobSource) {
    if (!window.confirm(`Remove ${item.displayName || item.boardId} from configured sources?`)) return;
    setError("");
    try {
      const response = await fetch(`${API}/api/sources/${item.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error || "Could not remove source");
      }
      setSources(current => current.filter(sourceItem => sourceItem.id !== item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove source");
    }
  }

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const sourceCount = new Set(jobs.map(job => job.source)).size;

  return <main className="shell">
    <header>
      <div className="brand-mark">JA</div>
      <div><h1>AI Job Agent</h1><p>Discover opportunities. Keep every application in your control.</p></div>
      <span className="header-pill"><span className="live-dot" /> Discovery workspace</span>
    </header>

    <section className="hero">
      <span className="eyebrow">PHASE 1 · JOB DISCOVERY</span>
      <h2>Your next opportunity starts here.</h2>
      <p>Search public company career boards from one place. Compare listings and open the original application.</p>
      <div className="search">
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && void loadJobs()} placeholder="Role, skill or company" aria-label="Search jobs" />
        <input value={location} onChange={e => setLocation(e.target.value)} onKeyDown={e => e.key === "Enter" && void loadJobs()} placeholder="Location" aria-label="Filter by location" />
        <button onClick={() => void loadJobs()}>Search jobs</button>
      </div>
    </section>

    <section className="metrics" aria-label="Job discovery metrics">
      <article className="metric"><span>Total matching jobs</span><strong>{total}</strong><small>Across connected boards</small></article>
      <article className="metric"><span>Sources represented</span><strong>{sourceCount}</strong><small>In the current result set</small></article>
      <article className="metric"><span>Configured boards</span><strong>{sources.length}</strong><small>{sources.filter(item => item.enabled).length} enabled</small></article>
    </section>

    <section className="source-manager">
      <div className="section-heading">
        <div><span className="eyebrow-dark">SOURCE MANAGEMENT</span><h3>Company career boards</h3><p>Add public job boards and validate the connection before syncing.</p></div>
        <button className="secondary" disabled={sourcesLoading} onClick={() => void loadSources()}>{sourcesLoading ? "Loading…" : "Refresh sources"}</button>
      </div>
      <form className="source-form" onSubmit={addAndValidateSource}>
        <label>Provider
          <select value={provider} onChange={e => setProvider(e.target.value as Provider)}>
            <option value="GREENHOUSE">Greenhouse</option>
            <option value="LEVER">Lever</option>
            <option value="ASHBY">Ashby</option>
          </select>
        </label>
        <label>Board ID
          <input required minLength={1} maxLength={120} pattern="[a-zA-Z0-9._-]+" value={boardId} onChange={e => setBoardId(e.target.value)} placeholder="e.g. stripe" />
        </label>
        <label>Company display name
          <input maxLength={120} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Stripe (optional)" />
        </label>
        <button type="submit" disabled={savingSource || !boardId.trim()}>{savingSource ? "Adding & testing…" : "Add & validate board"}</button>
      </form>
      <p className="form-hint">Use the provider's public board identifier, not a company name or a private careers URL. The source is saved even if its validation request fails, so you can correct or remove it.</p>

      {sourceMessage && <div className={`source-message ${preview ? "success-message" : "warning-message"}`} role="status">{sourceMessage}</div>}
      {preview && <div className="preview-panel">
        <strong>Sample listings</strong>
        {preview.sample.length ? preview.sample.map((item, index) => <div className="preview-row" key={index}><span>{item.title}</span><small>{item.location || "Location not specified"}</small></div>) : <small>The board is reachable but currently returned no jobs.</small>}
      </div>}

      <div className="source-list">
        {sources.map(item => <article className="source-item" key={item.id}>
          <div className="source-identity"><span className={`source source-${item.provider.toLowerCase()}`}>{item.provider}</span><strong>{item.displayName || item.boardId}</strong><small>Board ID: {item.boardId}</small></div>
          <span className={item.enabled ? "enabled-label" : "disabled-label"}>{item.enabled ? "Enabled" : "Disabled"}</span>
          <button className="small-action secondary" onClick={() => void toggleSource(item)}>{item.enabled ? "Disable" : "Enable"}</button>
          <button className="small-action danger-action" onClick={() => void removeSource(item)}>Remove</button>
        </article>)}
        {!sources.length && !sourcesLoading && <div className="source-empty">No database-managed boards yet. Add your first public career board above.</div>}
      </div>
    </section>

    <section className="toolbar">
      <div><h3>Job opportunities</h3><p>Browse and filter normalized public job listings.</p></div>
      <div className="toolbar-actions">
        <select value={source} onChange={e => setSource(e.target.value)} aria-label="Filter by source">
          <option value="">All sources</option>
          <option value="GREENHOUSE">Greenhouse</option>
          <option value="LEVER">Lever</option>
          <option value="ASHBY">Ashby</option>
        </select>
        <button className="secondary" disabled={loading || syncing} onClick={() => void loadJobs()}>Refresh</button>
        <button disabled={syncing} onClick={() => void sync()}>{syncing ? "Syncing sources…" : "↻ Sync job sources"}</button>
      </div>
    </section>

    {syncSummary && <section className="sync-result" aria-live="polite">
      <div><strong>Sync completed</strong><span> {syncSummary.fetched} fetched</span></div>
      <div className="sync-stats"><span><b>{syncSummary.inserted}</b> new</span><span><b>{syncSummary.updated}</b> updated</span><span><b>{syncSummary.duplicatesSkipped}</b> duplicates skipped</span><span><b>{syncSummary.errors.length}</b> errors</span></div>
      {syncSummary.errors.length > 0 && <details><summary>View source errors</summary><ul>{syncSummary.errors.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    </section>}

    {error && <div className="error" role="alert">{error}</div>}

    <section className="jobs" aria-live="polite">
      {jobs.map(job => <article className="job" key={job.id}>
        <div className="job-top"><span className={`source source-${job.source.toLowerCase()}`}>{job.source}</span><span className="status">{job.status}</span></div>
        <h3>{job.title}</h3>
        <p className="company">{job.company}</p>
        <p className="muted">{job.location || "Location not specified"} · {job.publishedAt ? new Date(job.publishedAt).toLocaleDateString() : "Publication date unavailable"}</p>
        <a href={job.applicationUrl} target="_blank" rel="noreferrer">View original listing ↗</a>
      </article>)}
      {!jobs.length && !loading && <div className="empty"><h3>No matching jobs</h3><p>Add public board IDs in Source Management, then sync job sources. You can also adjust your search filters.</p></div>}
      {loading && <div className="empty loading-state">Loading job opportunities…</div>}
    </section>

    <footer>AI Job Agent · Public job discovery · Applications always remain under your control.</footer>
  </main>;
}
