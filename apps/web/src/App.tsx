import { useEffect, useState } from "react";

type Job = { id: string; title: string; company: string; location: string | null; source: string; applicationUrl: string; publishedAt: string | null; status: string };
const API = "http://localhost:4000";

export function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (location) params.set("location", location);
      const response = await fetch(`${API}/api/jobs?${params}`);
      if (!response.ok) throw new Error("Could not load jobs. Is the API running?");
      const body = await response.json();
      setJobs(body.data);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setLoading(false); }
  }

  async function sync() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`${API}/api/jobs/sync`, { method: "POST" });
      if (!response.ok) throw new Error("Job sync failed");
      await search();
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void search(); }, []);

  return <main className="shell">
    <header><div className="brand-mark">JA</div><div><h1>AI Job Agent</h1><p>Discover opportunities. Keep every application in your control.</p></div></header>
    <section className="hero"><span className="eyebrow">PHASE 1 · JOB DISCOVERY</span><h2>Find your next opportunity.</h2><p>Search across connected company career boards from one place.</p>
      <div className="search"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void search()} placeholder="Role, skill or company (e.g. Backend Developer)"/><input value={location} onChange={e=>setLocation(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void search()} placeholder="Location"/><button onClick={()=>void search()}>Search jobs</button></div>
    </section>
    <section className="toolbar"><div><h3>Job opportunities</h3><p>{jobs.length} listings currently stored</p></div><button className="secondary" disabled={loading} onClick={()=>void sync()}>{loading?"Working…":"Sync job sources"}</button></section>
    {error && <div className="error">{error}</div>}
    <section className="jobs">{jobs.map(job=><article className="job" key={job.id}><div className="job-top"><span className="source">{job.source}</span><span className="status">{job.status}</span></div><h3>{job.title}</h3><p className="company">{job.company}</p><p className="muted">{job.location || "Location not specified"} · {job.publishedAt ? new Date(job.publishedAt).toLocaleDateString() : "Publication date unavailable"}</p><a href={job.applicationUrl} target="_blank" rel="noreferrer">View original listing ↗</a></article>)}
      {!jobs.length && !loading && <div className="empty"><h3>No jobs yet</h3><p>Configure one or more public job board IDs in the API environment file, then select “Sync job sources”.</p></div>}
    </section>
    <footer>Phase 1 prototype · Listings are not AI-ranked yet · No applications are submitted automatically.</footer>
  </main>;
}
