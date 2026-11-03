import { useCallback, useEffect, useState } from "react";

type Bucket = "OVERDUE" | "TODAY" | "UPCOMING" | "ALL";
type FollowUpItem = {
  id: string;
  jobId: string;
  status: string;
  notes: string;
  followUpAt: string;
  job: { id: string; title: string; company: string; location: string | null; applicationUrl: string };
};

const API = "http://localhost:4000";
const BUCKETS: Array<{ value: Bucket; label: string }> = [
  { value: "OVERDUE", label: "Overdue" },
  { value: "TODAY", label: "Today" },
  { value: "UPCOMING", label: "Upcoming" },
  { value: "ALL", label: "All" }
];

function localDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

export function FollowUpQueue() {
  const [bucket, setBucket] = useState<Bucket>("OVERDUE");
  const [items, setItems] = useState<FollowUpItem[]>([]);
  const [counts, setCounts] = useState<Record<Bucket, number>>({ OVERDUE: 0, TODAY: 0, UPCOMING: 0, ALL: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (selected: Bucket) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ bucket: selected, today: localDateKey() });
      const response = await fetch(API + "/api/applications/follow-ups?" + params.toString());
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.data)) throw new Error(body.error || "Could not load follow-ups");
      setItems(body.data);
      setCounts(body.counts ?? { OVERDUE: 0, TODAY: 0, UPCOMING: 0, ALL: body.count });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load follow-ups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(bucket); }, [bucket, load]);

  return <section className="follow-up-queue">
    <div className="section-heading">
      <div><span className="eyebrow-dark">FOLLOW-UP REMINDERS</span><h3>What needs your attention?</h3><p>Review your own follow-up dates. No messages are sent automatically.</p></div>
      <button className="secondary" type="button" disabled={loading} onClick={() => void load(bucket)}>Refresh reminders</button>
    </div>
    <div className="follow-up-tabs" role="group" aria-label="Filter follow-up reminders">
      {BUCKETS.map(option => <button key={option.value} type="button" className={bucket === option.value ? "active" : "secondary"} aria-pressed={bucket === option.value} onClick={() => setBucket(option.value)}>
        {option.label} <span>{counts[option.value]}</span>
      </button>)}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {loading && <p className="empty loading-state">Loading follow-up reminders…</p>}
    {!loading && !error && !items.length && <div className="empty"><h3>Nothing due in this view</h3><p>Set a follow-up date in an application's tracking section to see it here.</p></div>}
    {!loading && !!items.length && <div className="follow-up-list">
      {items.map(item => <article key={item.id} className="follow-up-item">
        <div className="follow-up-item-main">
          <strong>{item.job.title}</strong><span>{item.job.company}{item.job.location ? " · " + item.job.location : ""}</span>
          {item.notes && <p>{item.notes}</p>}
        </div>
        <div className="follow-up-item-meta">
          <span className={"follow-up-due follow-up-" + (item.followUpAt < localDateKey() ? "overdue" : item.followUpAt === localDateKey() ? "today" : "upcoming")}>{new Date(item.followUpAt + "T00:00:00").toLocaleDateString()}</span>
          <span className="tracker-status">{item.status.replaceAll("_", " ")}</span>
          <a href={item.job.applicationUrl} target="_blank" rel="noreferrer">Open listing ↗</a>
        </div>
      </article>)}
    </div>}
  </section>;
}
