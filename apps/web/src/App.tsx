import { useCallback, useEffect, useState } from "react";

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
const API = "http://localhost:4000";

export function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);

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

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

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
      <article className="metric"><span>Visible listings</span><strong>{jobs.length}</strong><small>Up to 100 per search</small></article>
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
      {!jobs.length && !loading && <div className="empty"><h3>No matching jobs</h3><p>Configure public board IDs in the API environment file, then sync job sources. You can also adjust your search filters.</p></div>}
      {loading && <div className="empty loading-state">Loading job opportunities…</div>}
    </section>

    <footer>AI Job Agent · Public job discovery · Applications always remain under your control.</footer>
  </main>;
}
