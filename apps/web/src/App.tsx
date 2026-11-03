import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

type Job = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  source: string;
  applicationUrl: string;
  description: string;
  publishedAt: string | null;
  discoveredAt?: string;
  lastVerifiedAt?: string;
  employmentType?: string;
  status: string;
  isSaved?: boolean;
  savedAt?: string;
  category?: string;
  skills?: string[];
  match?: { score: number | null; matchedSkills: string[]; missingSkills: string[]; reasons: string[] };
  workMode?: "REMOTE" | "HYBRID" | "ONSITE" | "UNKNOWN";
};
type SavedSearchFilters = { query: string; location: string; company: string; source: string; employmentType: string; workMode: string; sort: string; skills: string[] };
type SavedSearch = { id: string; name: string; filters: SavedSearchFilters; createdAt: string; lastCheckedAt: string };
type SearchAlertJob = { id: string; title: string; company: string; location: string | null; applicationUrl: string; discoveredAt: string };
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
type SourceCatalogEntry = { id: string; provider: Provider; boardId: string; displayName: string; description: string; careersUrl: string; focus: string };
type SourcePreview = {
  success: boolean;
  provider: Provider;
  boardId: string;
  jobCount: number;
  sample: Array<{ title: string; location: string | null; url: string }>;
  error?: string;
  detail?: string;
};
type CandidateProfile = { skills: string[]; preferredRoles: string[]; locations: string[]; remotePreference: "ANY" | "REMOTE" | "ONSITE" | "HYBRID" };
type ResumeDraft = { skills: string[]; education: string[]; experience: string[]; projects: string[]; certifications: string[] };
type ApplicationStatus = "SAVED" | "PREPARING" | "APPLIED" | "INTERVIEW" | "OFFER" | "REJECTED" | "WITHDRAWN";
type ApplicationTracking = { status: ApplicationStatus; notes: string; appliedAt: string; followUpAt: string };
type TrackedApplication = ApplicationTracking & { jobId: string; job: { id: string; title: string; company: string; location: string | null; applicationUrl: string } };
type ApplicationDraft = { id: string; jobId: string; resumeSummary: string; highlights: string[]; coverLetter: string; reviewNotes: string[]; status: "DRAFT" | "REVIEWED"; reviewedAt: string | null; createdAt: string; updatedAt: string };
type JobFitAnalysis = {
  score: number | null;
  breakdown: { skills: { score: number | null; matched: number; total: number; weight: number }; role: { matched: boolean | null; weight: number }; location: { matched: boolean | null; weight: number } };
  matchedSkills: string[]; missingSkills: string[]; requiredSkills: string[]; preferredSkills: string[];
  otherMentionedSkills: string[]; missingRequiredSkills: string[]; missingPreferredSkills: string[];
  evidence: Array<{ skill: string; sections: string[]; excerpts: string[] }>;
  strengths: string[]; gaps: string[]; recommendations: string[]; disclaimer: string;
};
const EMPTY_PROFILE: CandidateProfile = { skills: [], preferredRoles: [], locations: [], remotePreference: "ANY" };
const API = "http://localhost:4000";


function formatJobDescription(description: string): string {
  const withBreaks = description
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "• ")
    .replace(/<\/\s*(p|div|li|h[1-6]|section|article)\s*>/gi, "\n");
  const parsed = new DOMParser().parseFromString(withBreaks, "text/html");
  parsed.querySelectorAll("script, style, template, noscript").forEach(node => node.remove());
  return (parsed.body.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<JobSource[]>([]);
  const [catalog, setCatalog] = useState<SourceCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [source, setSource] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [workMode, setWorkMode] = useState("ANY");
  const [companyFilter, setCompanyFilter] = useState("");
  const [requiredSkills, setRequiredSkills] = useState("");
  const [sort, setSort] = useState("NEWEST");
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
  const [profile, setProfile] = useState<CandidateProfile>(EMPTY_PROFILE);
  const [profileSkills, setProfileSkills] = useState("");
  const [profileRoles, setProfileRoles] = useState("");
  const [profileLocations, setProfileLocations] = useState("");
  const [remotePreference, setRemotePreference] = useState<CandidateProfile["remotePreference"]>("ANY");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeDraft, setResumeDraft] = useState<ResumeDraft | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeMessage, setResumeMessage] = useState("");
  const [analysis, setAnalysis] = useState<{ jobId: string; data: JobFitAnalysis } | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState<string | null>(null);
  const [applicationDraft, setApplicationDraft] = useState<{ jobId: string; data: ApplicationDraft } | null>(null);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [trackingByJob, setTrackingByJob] = useState<Record<string, ApplicationTracking>>({});
  const [applicationRecords, setApplicationRecords] = useState<TrackedApplication[]>([]);
  const [trackingSaving, setTrackingSaving] = useState<string | null>(null);
  const [trackingMessage, setTrackingMessage] = useState("");
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [savedJobsBusy, setSavedJobsBusy] = useState(false);
  const [savingJobId, setSavingJobId] = useState<string | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [savedSearchName, setSavedSearchName] = useState("");
  const [savedSearchBusy, setSavedSearchBusy] = useState(false);
  const [checkingSearchId, setCheckingSearchId] = useState<string | null>(null);
  const [searchAlerts, setSearchAlerts] = useState<Record<string, SearchAlertJob[]>>({});
  const [searchAlertMessages, setSearchAlertMessages] = useState<Record<string, string>>({});

  const loadJobs = useCallback(async (filters = { query, location, source, employmentType, workMode, companyFilter, requiredSkills, sort }) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filters.query.trim()) params.set("q", filters.query.trim());
      if (filters.location.trim()) params.set("location", filters.location.trim());
      if (filters.source) params.set("source", filters.source);
      if (filters.employmentType) params.set("employmentType", filters.employmentType);
      if (filters.workMode !== "ANY") params.set("workMode", filters.workMode);
      if (filters.companyFilter.trim()) params.set("company", filters.companyFilter.trim());
      if (filters.requiredSkills.trim()) params.set("skills", filters.requiredSkills.trim());
      params.set("sort", filters.sort);
      params.set("limit", "100");
      const response = await fetch(`${API}/api/jobs?${params.toString()}`);
      if (!response.ok) throw new Error("Could not load jobs. Check that the API and database are running.");
      const body = await response.json() as { data: Job[]; total: number };
      setJobs(body.data);
      setTotal(body.total ?? body.data.length);
      setShowSavedOnly(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [query, location, source, employmentType, workMode, companyFilter, requiredSkills, sort]);




  const loadSavedSearches = useCallback(async () => {
    try {
      const response = await fetch(API + "/api/saved-searches");
      const body = await response.json() as { data?: SavedSearch[]; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error || "Could not load saved searches");
      setSavedSearches(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load saved searches");
    }
  }, []);

  async function saveCurrentSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = savedSearchName.trim();
    if (!name) return;
    setSavedSearchBusy(true);
    setError("");
    try {
      const filters: SavedSearchFilters = {
        query: query.trim(), location: location.trim(), company: companyFilter.trim(),
        source, employmentType, workMode, sort, skills: requiredSkills.split(",").map(item => item.trim()).filter(Boolean)
      };
      const response = await fetch(API + "/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filters })
      });
      const body = await response.json() as { data?: SavedSearch; error?: string; detail?: string };
      if (!response.ok || !body.data) throw new Error(body.detail || body.error || "Could not save search");
      setSavedSearches(current => [body.data!, ...current]);
      setSavedSearchName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save search");
    } finally {
      setSavedSearchBusy(false);
    }
  }

  function applySavedSearch(search: SavedSearch) {
    setQuery(search.filters.query);
    setLocation(search.filters.location);
    setCompanyFilter(search.filters.company);
    setSource(search.filters.source);
    setEmploymentType(search.filters.employmentType);
    setWorkMode(search.filters.workMode);
    setSort(search.filters.sort);
    setRequiredSkills(search.filters.skills.join(", "));
    void loadJobs({
      query: search.filters.query, location: search.filters.location, companyFilter: search.filters.company,
      source: search.filters.source, employmentType: search.filters.employmentType,
      workMode: search.filters.workMode, requiredSkills: search.filters.skills.join(", "), sort: search.filters.sort
    });
  }

  async function checkSavedSearchAlerts(search: SavedSearch) {
    setCheckingSearchId(search.id);
    setSearchAlertMessages(current => ({ ...current, [search.id]: "" }));
    try {
      const response = await fetch(API + "/api/saved-searches/" + encodeURIComponent(search.id) + "/alerts");
      const body = await response.json() as { data?: SearchAlertJob[]; count?: number; error?: string; detail?: string };
      if (!response.ok || !body.data) throw new Error(body.detail || body.error || "Could not check alerts");
      setSearchAlerts(current => ({ ...current, [search.id]: body.data! }));
      setSearchAlertMessages(current => ({ ...current, [search.id]: body.count ? `${body.count} new matching job(s) found.` : "No new matching jobs since the last check." }));
      await loadSavedSearches();
    } catch (e) {
      setSearchAlertMessages(current => ({ ...current, [search.id]: e instanceof Error ? e.message : "Could not check alerts" }));
    } finally {
      setCheckingSearchId(null);
    }
  }

  async function deleteSavedSearch(search: SavedSearch) {
    try {
      const response = await fetch(API + "/api/saved-searches/" + encodeURIComponent(search.id), { method: "DELETE" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not delete saved search");
      setSavedSearches(current => current.filter(item => item.id !== search.id));
      setSearchAlerts(current => { const next = { ...current }; delete next[search.id]; return next; });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete saved search");
    }
  }

  const loadSavedJobs = useCallback(async () => {
    setSavedJobsBusy(true);
    setError("");
    try {
      const response = await fetch(API + "/api/saved-jobs");
      const body = await response.json() as { data?: Job[]; count?: number; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error || "Could not load saved jobs");
      setJobs(body.data);
      setTotal(body.count ?? body.data.length);
      setShowSavedOnly(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load saved jobs");
    } finally {
      setSavedJobsBusy(false);
    }
  }, []);

  async function toggleSavedJob(job: Job) {
    setSavingJobId(job.id);
    setError("");
    try {
      const response = await fetch(API + "/api/jobs/" + encodeURIComponent(job.id) + "/save", {
        method: job.isSaved ? "DELETE" : "POST"
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not update saved job");
      if (job.isSaved && showSavedOnly) {
        setJobs(current => current.filter(item => item.id !== job.id));
        setTotal(current => Math.max(0, current - 1));
      } else {
        setJobs(current => current.map(item => item.id === job.id ? { ...item, isSaved: !job.isSaved } : item));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update saved job");
    } finally {
      setSavingJobId(null);
    }
  }

  const loadApplications = useCallback(async () => {
    try {
      const response = await fetch(API + "/api/applications");
      const body = await response.json() as { data?: TrackedApplication[]; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error || "Could not load application tracker");
      setApplicationRecords(body.data);
      setTrackingByJob(Object.fromEntries(body.data.map(item => [item.jobId, {
        status: item.status, notes: item.notes, appliedAt: item.appliedAt ?? "", followUpAt: item.followUpAt ?? ""
      }])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load application tracker");
    }
  }, []);

  function updateTracking(jobId: string, field: keyof ApplicationTracking, value: string) {
    setTrackingByJob(current => ({
      ...current,
      [jobId]: { ...(current[jobId] ?? { status: "SAVED", notes: "", appliedAt: "", followUpAt: "" }), [field]: value }
    }));
  }

  async function saveTracking(jobId: string) {
    const value = trackingByJob[jobId] ?? { status: "SAVED" as const, notes: "", appliedAt: "", followUpAt: "" };
    setTrackingSaving(jobId);
    setTrackingMessage("");
    try {
      const response = await fetch(API + "/api/jobs/" + encodeURIComponent(jobId) + "/application-tracking", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value)
      });
      const body = await response.json() as { data?: ApplicationTracking; error?: string; detail?: string };
      if (!response.ok || !body.data) throw new Error(body.detail || body.error || "Could not save tracking details");
      setTrackingByJob(current => ({ ...current, [jobId]: body.data! }));
      await loadApplications();
      setTrackingMessage("Application progress saved.");
    } catch (e) {
      setTrackingMessage(e instanceof Error ? e.message : "Could not save application progress");
    } finally {
      setTrackingSaving(null);
    }
  }

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/profile`);
      const body = await response.json() as { data?: CandidateProfile; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error || "Could not load candidate profile");
      setProfile(body.data);
      setProfileSkills(body.data.skills.join(", "));
      setProfileRoles(body.data.preferredRoles.join(", "));
      setProfileLocations(body.data.locations.join(", "));
      setRemotePreference(body.data.remotePreference);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load candidate profile");
    }
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileSaving(true);
    setProfileMessage("");
    try {
      const split = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean);
      const payload = { skills: split(profileSkills), preferredRoles: split(profileRoles), locations: split(profileLocations), remotePreference };
      const response = await fetch(`${API}/api/profile`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      const body = await response.json() as { data?: CandidateProfile; error?: string; detail?: string };
      if (!response.ok || !body.data) throw new Error(body.detail || body.error || "Could not save profile");
      setProfile(body.data);
      setProfileMessage("Preferences saved. Job match scores have been recalculated.");
      await loadJobs();
    } catch (e) {
      setProfileMessage(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setProfileSaving(false);
    }
  }


  async function analyzeFit(jobId: string) {
    if (analysis?.jobId === jobId) {
      setAnalysis(null);
      return;
    }
    setAnalysisBusy(jobId);
    setError("");
    try {
      const response = await fetch(`${API}/api/jobs/${encodeURIComponent(jobId)}/analyze`);
      const body = await response.json() as { data?: JobFitAnalysis; error?: string; detail?: string };
      if (!response.ok || !body.data) throw new Error(body.detail || body.error || "Could not analyze job fit");
      setAnalysis({ jobId, data: body.data });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not analyze job fit");
    } finally {
      setAnalysisBusy(null);
    }
  }


  async function openApplicationDraft(jobId: string) {
    if (applicationDraft?.jobId === jobId) {
      setApplicationDraft(null);
      setDraftMessage("");
      return;
    }
    setDraftBusy(jobId);
    setDraftMessage("");
    setError("");
    try {
      const path = API + "/api/jobs/" + encodeURIComponent(jobId) + "/application-draft";
      const existingResponse = await fetch(path);
      const existingBody = await existingResponse.json() as { data?: ApplicationDraft | null; error?: string };
      if (!existingResponse.ok) throw new Error(existingBody.error || "Could not load application draft");
      if (existingBody.data) {
        setApplicationDraft({ jobId, data: existingBody.data });
        return;
      }
      const response = await fetch(path, { method: "POST" });
      const body = await response.json() as { data?: ApplicationDraft; error?: string; detail?: string };
      if (!response.ok || !body.data) throw new Error(body.detail || body.error || "Could not prepare application draft");
      setApplicationDraft({ jobId, data: body.data });
      setDraftMessage("Draft generated from your saved, reviewed profile. Edit and save it before marking it reviewed.");
    } catch (e) {
      setDraftMessage(e instanceof Error ? e.message : "Could not prepare application draft");
    } finally {
      setDraftBusy(null);
    }
  }

  function updateApplicationDraft(field: "resumeSummary" | "coverLetter", value: string) {
    setApplicationDraft(current => current ? {
      ...current,
      data: { ...current.data, [field]: value, status: "DRAFT", reviewedAt: null }
    } : current);
  }

  function updateDraftHighlight(index: number, value: string) {
    setApplicationDraft(current => current ? {
      ...current,
      data: { ...current.data, highlights: current.data.highlights.map((item, i) => i === index ? value : item), status: "DRAFT", reviewedAt: null }
    } : current);
  }

  async function saveApplicationDraft() {
    if (!applicationDraft) return false;
    setDraftBusy(applicationDraft.jobId);
    setDraftMessage("");
    try {
      const response = await fetch(API + "/api/jobs/" + encodeURIComponent(applicationDraft.jobId) + "/application-draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeSummary: applicationDraft.data.resumeSummary,
          highlights: applicationDraft.data.highlights.filter(item => item.trim()),
          coverLetter: applicationDraft.data.coverLetter
        })
      });
      const body = await response.json() as { data?: ApplicationDraft; error?: string; detail?: string };
      if (!response.ok || !body.data) throw new Error(body.detail || body.error || "Could not save application draft");
      setApplicationDraft({ jobId: applicationDraft.jobId, data: body.data });
      setDraftMessage("Your edits are saved locally.");
      return true;
    } catch (e) {
      setDraftMessage(e instanceof Error ? e.message : "Could not save application draft");
      return false;
    } finally {
      setDraftBusy(null);
    }
  }

  async function markApplicationDraftReviewed() {
    if (!applicationDraft) return;
    const saved = await saveApplicationDraft();
    if (!saved) return;
    setDraftBusy(applicationDraft.jobId);
    try {
      const response = await fetch(API + "/api/jobs/" + encodeURIComponent(applicationDraft.jobId) + "/application-draft/review", { method: "POST" });
      const body = await response.json() as { data?: ApplicationDraft; message?: string; error?: string; detail?: string };
      if (!response.ok || !body.data) throw new Error(body.detail || body.error || "Could not mark draft reviewed");
      setApplicationDraft({ jobId: applicationDraft.jobId, data: body.data });
      setDraftMessage(body.message || "Marked reviewed for manual use only.");
    } catch (e) {
      setDraftMessage(e instanceof Error ? e.message : "Could not mark draft reviewed");
    } finally {
      setDraftBusy(null);
    }
  }

  async function parseResume() {
    if (!resumeFile) return;
    setResumeBusy(true);
    setResumeMessage("");
    setResumeDraft(null);
    try {
      const contentType = resumeFile.type || (resumeFile.name.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      const response = await fetch(`${API}/api/resume/parse`, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: resumeFile
      });
      const body = await response.json() as { data?: ResumeDraft; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error || "Could not parse resume");
      setResumeDraft(body.data);
      setResumeMessage("Extraction complete. Review every field below; nothing has been saved yet.");
    } catch (e) {
      setResumeMessage(e instanceof Error ? e.message : "Resume parsing failed");
    } finally {
      setResumeBusy(false);
    }
  }

  function updateResumeSection(section: keyof ResumeDraft, value: string) {
    if (!resumeDraft) return;
    const items = section === "skills"
      ? value.split(",").map(item => item.trim()).filter(Boolean)
      : value.split(String.fromCharCode(10)).map(item => item.trim()).filter(Boolean);
    setResumeDraft(current => current ? { ...current, [section]: items } : current);
  }

  async function saveResume() {
    if (!resumeDraft) return;
    setResumeBusy(true);
    setResumeMessage("");
    try {
      const response = await fetch(`${API}/api/profile/resume`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resumeDraft)
      });
      const body = await response.json() as { data?: ResumeDraft; error?: string; detail?: string };
      if (!response.ok || !body.data) throw new Error(body.detail || body.error || "Could not save reviewed resume");
      setResumeDraft(body.data);
      setResumeMessage("Reviewed resume details saved to your local candidate profile.");
      await loadProfile();
      await loadJobs();
    } catch (e) {
      setResumeMessage(e instanceof Error ? e.message : "Could not save reviewed resume");
    } finally {
      setResumeBusy(false);
    }
  }

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const response = await fetch(`${API}/api/sources/catalog`);
      const body = await response.json() as { data?: SourceCatalogEntry[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load starter catalog");
      setCatalog(body.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load starter catalog");
    } finally {
      setCatalogLoading(false);
    }
  }, []);

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

  async function addCatalogSource(item: SourceCatalogEntry) {
    setSavingSource(true);
    setSourceMessage("");
    setPreview(null);
    try {
      const response = await fetch(`${API}/api/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: item.provider, boardId: item.boardId, displayName: item.displayName })
      });
      const body = await response.json() as { data?: JobSource; error?: string; detail?: string };
      if (!response.ok || !body.data) {
        if (response.status === 409) {
          await loadSources();
          throw new Error("This board is already configured. Check the Company career boards list.");
        }
        throw new Error(body.detail || body.error || "Could not add source");
      }
      const saved = body.data;
      setSources(current => [saved, ...current]);
      const testResponse = await fetch(`${API}/api/sources/${saved.id}/test`, { method: "POST" });
      const testBody = await testResponse.json() as SourcePreview;
      if (!testResponse.ok || !testBody.success) {
        setSourceMessage(`${item.displayName} was saved, but live validation failed: ${testBody.detail || testBody.error || "Provider did not respond successfully"}`);
      } else {
        setPreview(testBody);
        setSourceMessage(`${item.displayName} validated: ${testBody.jobCount} public postings returned. Press Sync job sources to import them.`);
      }
    } catch (e) {
      setSourceMessage(e instanceof Error ? e.message : "Could not add catalog source");
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
    void loadProfile();
    void loadApplications();
    void loadSavedSearches();
    void (async () => {
      try {
        const response = await fetch(`${API}/api/profile/resume`);
        const body = await response.json() as { data?: ResumeDraft };
        if (response.ok && body.data) setResumeDraft(body.data);
      } catch {
        // Resume details are optional; profile preferences remain usable.
      }
    })();
  }, [loadSources, loadProfile, loadApplications, loadSavedSearches]);

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

    <section className="profile-section">
      <div className="section-heading">
        <div><span className="eyebrow-dark">YOUR CANDIDATE PROFILE</span><h3>What are you looking for?</h3><p>Set preferences to calculate transparent job relevance scores. No resume upload or AI API key is required.</p></div>
        <span className="profile-status">{profile.skills.length + profile.preferredRoles.length + profile.locations.length ? "Profile configured" : "Not configured"}</span>
      </div>
      <form className="profile-form" onSubmit={saveProfile}>
        <label>Skills (comma-separated)
          <input value={profileSkills} onChange={e => setProfileSkills(e.target.value)} placeholder="Node.js, PostgreSQL, Docker, React" />
        </label>
        <label>Preferred role categories (comma-separated)
          <input value={profileRoles} onChange={e => setProfileRoles(e.target.value)} placeholder="BACKEND, FULL_STACK, DEVOPS" />
        </label>
        <label>Preferred locations (comma-separated)
          <input value={profileLocations} onChange={e => setProfileLocations(e.target.value)} placeholder="Kanpur, Noida, Bengaluru" />
        </label>
        <label>Work preference
          <select value={remotePreference} onChange={e => setRemotePreference(e.target.value as CandidateProfile["remotePreference"])}>
            <option value="ANY">Any work mode</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option><option value="ONSITE">On-site</option>
          </select>
        </label>
        <button type="submit" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save preferences"}</button>
      </form>
      {profileMessage && <p className="profile-message" role="status">{profileMessage}</p>}
      <p className="form-hint">Scores are deterministic heuristics: skills contribute 70%, role 20%, and location/work mode 10% when those preferences are set. They are guidance, not a hiring prediction.</p>
    </section>


    <section className="resume-section">
      <div className="section-heading">
        <div><span className="eyebrow-dark">RESUME INTELLIGENCE</span><h3>Extract your verified experience</h3><p>Upload a text-based PDF or DOCX (max 5 MB). Extraction runs locally through this API; your file is not retained or sent to an AI provider.</p></div>
      </div>
      <div className="resume-upload">
        <label>Resume file
          <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => { setResumeFile(event.target.files?.[0] ?? null); setResumeDraft(null); setResumeMessage(""); }} />
        </label>
        <button type="button" disabled={!resumeFile || resumeBusy} onClick={() => void parseResume()}>{resumeBusy ? "Processing…" : "Parse resume"}</button>
      </div>
      {resumeMessage && <p className="resume-message" role="status">{resumeMessage}</p>}
      {resumeDraft && <div className="resume-review">
        <div className="resume-review-heading"><strong>Review extracted information</strong><span>Editable · Not saved until you approve</span></div>
        <label>Skills (comma-separated)
          <textarea rows={3} value={resumeDraft.skills.join(", ")} onChange={event => updateResumeSection("skills", event.target.value)} />
        </label>
        <label>Education (one entry per line)
          <textarea rows={3} value={resumeDraft.education.join("\\n")} onChange={event => updateResumeSection("education", event.target.value)} placeholder="No education entries detected" />
        </label>
        <label>Experience (one entry per line)
          <textarea rows={4} value={resumeDraft.experience.join("\\n")} onChange={event => updateResumeSection("experience", event.target.value)} placeholder="No experience entries detected" />
        </label>
        <label>Projects (one entry per line)
          <textarea rows={3} value={resumeDraft.projects.join("\\n")} onChange={event => updateResumeSection("projects", event.target.value)} placeholder="No projects detected" />
        </label>
        <label>Certifications (one entry per line)
          <textarea rows={2} value={resumeDraft.certifications.join("\\n")} onChange={event => updateResumeSection("certifications", event.target.value)} placeholder="No certifications detected" />
        </label>
        <button type="button" disabled={resumeBusy} onClick={() => void saveResume()}>{resumeBusy ? "Saving…" : "Approve & save to profile"}</button>
      </div>}
      <p className="form-hint">Extraction is heuristic and may miss sections, especially in multi-column or scanned resumes. Review and correct all entries. Scanned-image OCR is not included. Uploads are processed in memory and are not stored as files.</p>
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

    <section className="catalog-section">
      <div className="section-heading">
        <div><span className="eyebrow-dark">STARTER CATALOG</span><h3>Discover public company boards</h3><p>Suggested boards you can add and validate before importing jobs.</p></div>
        <button className="secondary" disabled={catalogLoading} onClick={() => void loadCatalog()}>{catalogLoading ? "Loading…" : "Refresh catalog"}</button>
      </div>
      <div className="catalog-grid">
        {catalog.map(item => {
          const configured = sources.some(sourceItem => sourceItem.provider === item.provider && sourceItem.boardId.toLowerCase() === item.boardId.toLowerCase());
          return <article className="catalog-card" key={item.id}>
            <div className="catalog-card-top"><span className={`source source-${item.provider.toLowerCase()}`}>{item.provider}</span><span className="catalog-focus">{item.focus}</span></div>
            <h4>{item.displayName}</h4>
            <p>{item.description}</p>
            <div className="catalog-card-actions">
              <a href={item.careersUrl} target="_blank" rel="noreferrer">Career board ↗</a>
              <button className="small-action" disabled={savingSource || configured} onClick={() => void addCatalogSource(item)}>{configured ? "Added" : "Add & validate"}</button>
            </div>
          </article>;
        })}
        {!catalog.length && !catalogLoading && <div className="source-empty">Starter catalog is unavailable. You can still add a board manually above.</div>}
      </div>
      <p className="form-hint">Catalog entries are suggestions, not verified live openings. Each board is checked when you add it. A successful check only confirms the public feed responded; sync imports the returned postings.</p>
    </section>

    <section className="toolbar">
      <div><h3>Job opportunities</h3><p>Browse, filter and rank normalized public job listings.</p></div>
      <div className="toolbar-actions">
        <button className="secondary" type="button" disabled={savedJobsBusy || loading} onClick={() => void loadSavedJobs()}>{savedJobsBusy ? "Loading saved…" : "★ Saved jobs"}</button>
        {showSavedOnly && <button className="secondary" type="button" onClick={() => void loadJobs()}>All jobs</button>}
        <button className="secondary" disabled={loading || syncing} onClick={() => void loadJobs()}>Refresh</button>
        <button disabled={syncing} onClick={() => void sync()}>{syncing ? "Syncing sources…" : "↻ Sync job sources"}</button>
      </div>
    </section>
    {!showSavedOnly && <section className="advanced-filters" aria-label="Advanced job filters">
      <label>Company
        <input value={companyFilter} onChange={event => setCompanyFilter(event.target.value)} placeholder="Company name" />
      </label>
      <label>Source
        <select value={source} onChange={event => setSource(event.target.value)}>
          <option value="">All sources</option><option value="GREENHOUSE">Greenhouse</option><option value="LEVER">Lever</option><option value="ASHBY">Ashby</option>
        </select>
      </label>
      <label>Employment type
        <select value={employmentType} onChange={event => setEmploymentType(event.target.value)}>
          <option value="">All job types</option><option value="FULL_TIME">Full-time</option><option value="PART_TIME">Part-time</option><option value="INTERNSHIP">Internship</option><option value="CONTRACT">Contract</option><option value="UNKNOWN">Unspecified</option>
        </select>
      </label>
      <label>Work mode
        <select value={workMode} onChange={event => setWorkMode(event.target.value)}>
          <option value="ANY">Any work mode</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option><option value="ONSITE">On-site</option><option value="UNKNOWN">Not specified</option>
        </select>
      </label>
      <label>Required skills (comma-separated)
        <input value={requiredSkills} onChange={event => setRequiredSkills(event.target.value)} placeholder="Node.js, PostgreSQL" />
      </label>
      <label>Sort by
        <select value={sort} onChange={event => setSort(event.target.value)}>
          <option value="NEWEST">Newest first</option><option value="MATCH">Best profile match</option><option value="RELEVANCE">Best overall fit</option>
        </select>
      </label>
      <button type="button" disabled={loading} onClick={() => void loadJobs()}>Apply filters</button>
      <button type="button" className="secondary" disabled={loading} onClick={() => {
        setEmploymentType(""); setWorkMode("ANY"); setCompanyFilter(""); setRequiredSkills(""); setSort("NEWEST"); setSource(""); void loadJobs({ query, location, source: "", employmentType: "", workMode: "ANY", companyFilter: "", requiredSkills: "", sort: "NEWEST" });
      }}>Clear filters</button>
    </section>}


    <section className="saved-search-section">
      <div className="section-heading">
        <div><span className="eyebrow-dark">SAVED SEARCHES</span><h3>Keep an eye on matching roles</h3><p>Save the current filters and manually check for newly discovered matching jobs. Alerts stay in this dashboard.</p></div>
      </div>
      <form className="saved-search-form" onSubmit={saveCurrentSearch}>
        <label>Search name
          <input value={savedSearchName} onChange={event => setSavedSearchName(event.target.value)} maxLength={80} required placeholder="e.g. Remote backend internships" />
        </label>
        <button type="submit" disabled={savedSearchBusy || !savedSearchName.trim()}>{savedSearchBusy ? "Saving…" : "Save current search"}</button>
      </form>
      {!!savedSearches.length && <div className="saved-search-list">
        {savedSearches.map(search => <article className="saved-search-card" key={search.id}>
          <div className="saved-search-info">
            <strong>{search.name}</strong>
            <small>{[search.filters.query, search.filters.company, search.filters.location, search.filters.employmentType, search.filters.workMode !== "ANY" ? search.filters.workMode : "", ...search.filters.skills].filter(Boolean).join(" · ") || "All jobs"}</small>
            <small>Last checked: {new Date(search.lastCheckedAt).toLocaleString()}</small>
          </div>
          <div className="saved-search-actions">
            <button className="small-action secondary" type="button" onClick={() => applySavedSearch(search)}>Apply filters</button>
            <button className="small-action secondary" type="button" disabled={checkingSearchId === search.id} onClick={() => void checkSavedSearchAlerts(search)}>{checkingSearchId === search.id ? "Checking…" : "Check new jobs"}</button>
            <button className="small-action danger-action" type="button" onClick={() => void deleteSavedSearch(search)}>Delete</button>
          </div>
          {searchAlertMessages[search.id] && <p className="saved-search-message" role="status">{searchAlertMessages[search.id]}</p>}
          {!!searchAlerts[search.id]?.length && <ul className="saved-search-alerts">
            {searchAlerts[search.id].map(job => <li key={job.id}><a href={job.applicationUrl} target="_blank" rel="noreferrer">{job.title} · {job.company}</a><small>{job.location || "Location not specified"} · discovered {new Date(job.discoveredAt).toLocaleString()}</small></li>)}
          </ul>}
        </article>)}
      </div>}
      {!savedSearches.length && <p className="form-hint">No saved searches yet. Apply your filters above, name the search, and save it here.</p>}
    </section>

    {syncSummary && <section className="sync-result" aria-live="polite">
      <div><strong>Sync completed</strong><span> {syncSummary.fetched} fetched</span></div>
      <div className="sync-stats"><span><b>{syncSummary.inserted}</b> new</span><span><b>{syncSummary.updated}</b> updated</span><span><b>{syncSummary.duplicatesSkipped}</b> duplicates skipped</span><span><b>{syncSummary.errors.length}</b> errors</span></div>
      {syncSummary.errors.length > 0 && <details><summary>View source errors</summary><ul>{syncSummary.errors.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    </section>}


    <section className="tracker-overview">
      <div className="section-heading"><div><span className="eyebrow-dark">APPLICATION PIPELINE</span><h3>Track your applications</h3><p>Keep a record of progress, application dates, notes and follow-ups. Updates are manual; nothing is sent to employers.</p></div><button className="secondary" type="button" onClick={() => void loadApplications()}>Refresh tracker</button></div>
      <div className="tracker-stats">
        <article><span>Tracked</span><strong>{applicationRecords.length}</strong></article>
        <article><span>Applied</span><strong>{applicationRecords.filter(item => item.status === "APPLIED").length}</strong></article>
        <article><span>Interviews</span><strong>{applicationRecords.filter(item => item.status === "INTERVIEW").length}</strong></article>
        <article><span>Offers</span><strong>{applicationRecords.filter(item => item.status === "OFFER").length}</strong></article>
      </div>
      {!!applicationRecords.length && <div className="tracker-recent">
        <strong>Recent tracked roles</strong>
        {applicationRecords.slice(0, 5).map(item => <div key={item.jobId}><span>{item.job.title} · {item.job.company}</span><span className="tracker-status">{item.status.replaceAll("_", " ")}</span>{item.followUpAt && <small>Follow up: {new Date(item.followUpAt + "T00:00:00").toLocaleDateString()}</small>}</div>)}
      </div>}
    </section>

    {error && <div className="error" role="alert">{error}</div>}

    <section className="jobs" aria-live="polite">
      {jobs.map(job => <article className="job" key={job.id}>
        <div className="job-top"><span className={`source source-${job.source.toLowerCase()}`}>{job.source}</span><span className="status">{job.status}</span></div>
        <h3>{job.title}</h3>
        <p className="company">{job.company}</p>
        <p className="muted">{job.location || "Location not specified"} · {job.workMode ? job.workMode.replaceAll("_", " ") : "Work mode unknown"} · {job.publishedAt ? new Date(job.publishedAt).toLocaleDateString() : "Publication date unavailable"}</p>
        <details className="job-details">
          <summary>Read full job description & details</summary>
          <div className="job-detail-facts">
            <div><span>Employment type</span><strong>{job.employmentType ? job.employmentType.replaceAll("_", " ") : "Not specified"}</strong></div>
            <div><span>Work mode</span><strong>{job.workMode ? job.workMode.replaceAll("_", " ") : "Unknown"}</strong></div>
            <div><span>First discovered</span><strong>{job.discoveredAt ? new Date(job.discoveredAt).toLocaleDateString() : "Not available"}</strong></div>
            <div><span>Last verified from source</span><strong>{job.lastVerifiedAt ? new Date(job.lastVerifiedAt).toLocaleString() : "Not verified yet"}</strong></div>
          </div>
          <div className="job-description-content">
            {formatJobDescription(job.description || "") || "The source did not provide a job description. Open the original employer listing for full details."}
          </div>
          <p className="job-description-note">Description text is provided by the public career board. Always confirm current requirements and application details on the employer's original listing.</p>
        </details>
        <div className="job-intelligence">
          <span className="category-chip">{(job.category || "OTHER").replaceAll("_", " ")}</span>
          {job.match?.score !== null && job.match?.score !== undefined && <span className="match-score">{job.match.score}% match</span>}
        </div>
        {!!job.skills?.length && <div className="skill-tags">{job.skills.slice(0, 8).map(skill => <span key={skill}>{skill}</span>)}</div>}
        {!!job.match?.matchedSkills.length && <p className="match-reason">Matched: {job.match.matchedSkills.join(", ")}</p>}
        <div className="job-actions">
          <button className="small-action secondary" type="button" disabled={savingJobId === job.id} onClick={() => void toggleSavedJob(job)} aria-label={job.isSaved ? "Remove from saved jobs" : "Save job"}>
            {savingJobId === job.id ? "Saving…" : job.isSaved ? "★ Saved" : "☆ Save job"}
          </button>
          <button className="small-action secondary" type="button" disabled={analysisBusy === job.id} onClick={() => void analyzeFit(job.id)}>
            {analysisBusy === job.id ? "Analyzing…" : analysis?.jobId === job.id ? "Hide fit analysis" : "Analyze resume fit"}
          </button>
          <a href={job.applicationUrl} target="_blank" rel="noreferrer">View original listing ↗</a>
        </div>


        <details className="application-tracking">
          <summary>Track application progress</summary>
          <div className="tracking-fields">
            <label>Status
              <select value={trackingByJob[job.id]?.status ?? "SAVED"} onChange={event => updateTracking(job.id, "status", event.target.value)}>
                <option value="SAVED">Saved</option><option value="PREPARING">Preparing</option><option value="APPLIED">Applied</option><option value="INTERVIEW">Interview</option><option value="OFFER">Offer</option><option value="REJECTED">Rejected</option><option value="WITHDRAWN">Withdrawn</option>
              </select>
            </label>
            <label>Applied on
              <input type="date" value={trackingByJob[job.id]?.appliedAt ?? ""} onChange={event => updateTracking(job.id, "appliedAt", event.target.value)} />
            </label>
            <label>Follow-up date
              <input type="date" value={trackingByJob[job.id]?.followUpAt ?? ""} onChange={event => updateTracking(job.id, "followUpAt", event.target.value)} />
            </label>
            <label className="tracking-notes">Notes
              <textarea rows={3} maxLength={5000} value={trackingByJob[job.id]?.notes ?? ""} onChange={event => updateTracking(job.id, "notes", event.target.value)} placeholder="Recruiter contact, interview preparation, next steps…" />
            </label>
            <div className="tracking-save"><button type="button" disabled={trackingSaving === job.id} onClick={() => void saveTracking(job.id)}>{trackingSaving === job.id ? "Saving…" : "Save progress"}</button></div>
          </div>
          {trackingMessage && <p className="resume-message" role="status">{trackingMessage}</p>}
        </details>
        <button className="small-action secondary" type="button" disabled={draftBusy === job.id} onClick={() => void openApplicationDraft(job.id)}>
          {draftBusy === job.id ? "Preparing…" : applicationDraft?.jobId === job.id ? "Hide application draft" : "Prepare application"}
        </button>
        {applicationDraft?.jobId === job.id && <div className="application-draft-panel">
          <div className="fit-analysis-top"><strong>Editable application draft</strong><span>{applicationDraft.data.status === "REVIEWED" ? "Reviewed for manual use" : "Draft · Not reviewed"}</span></div>
          <p className="form-hint">Generated only from your saved candidate profile and reviewed resume entries. Check every claim and personalize the wording. Nothing is submitted or sent.</p>
          <label>Resume tailoring summary
            <textarea rows={5} value={applicationDraft.data.resumeSummary} onChange={event => updateApplicationDraft("resumeSummary", event.target.value)} placeholder="No matching resume evidence was found. Add only accurate details." />
          </label>
          <label>Evidence highlights
            {applicationDraft.data.highlights.map((item, index) => <textarea key={index} rows={2} value={item} onChange={event => updateDraftHighlight(index, event.target.value)} />)}
            {!applicationDraft.data.highlights.length && <small>No direct evidence highlights detected.</small>}
          </label>
          <label>Cover letter
            <textarea rows={12} value={applicationDraft.data.coverLetter} onChange={event => updateApplicationDraft("coverLetter", event.target.value)} />
          </label>
          {!!applicationDraft.data.reviewNotes.length && <div><strong>Review notes</strong><ul>{applicationDraft.data.reviewNotes.map(note => <li key={note}>{note}</li>)}</ul></div>}
          <div className="draft-actions">
            <button type="button" disabled={draftBusy === job.id} onClick={() => void saveApplicationDraft()}>{draftBusy === job.id ? "Saving…" : "Save edits"}</button>
            <button type="button" className="secondary" disabled={draftBusy === job.id || applicationDraft.data.status === "REVIEWED"} onClick={() => void markApplicationDraftReviewed()}>Save & mark reviewed</button>
          </div>
          {draftMessage && <p className="resume-message" role="status">{draftMessage}</p>}
          <p className="fit-disclaimer">Reviewed means you approved this text for your own manual use only. It is not an application submission or authorization for automated contact.</p>
        </div>}
        {analysis?.jobId === job.id && <div className="fit-analysis">
          <div className="fit-analysis-top"><strong>Resume-to-job analysis</strong><span>{analysis.data.score === null ? "Add preferences to calculate a score" : `${analysis.data.score}% profile match`}</span></div>
          <div className="fit-breakdown">
            <span>Skills: {analysis.data.breakdown.skills.score === null ? "Not set" : `${analysis.data.breakdown.skills.score}%`} ({analysis.data.breakdown.skills.matched}/{analysis.data.breakdown.skills.total})</span>
            <span>Role: {analysis.data.breakdown.role.matched === null ? "Not set" : analysis.data.breakdown.role.matched ? "Match" : "No match"}</span>
            <span>Location: {analysis.data.breakdown.location.matched === null ? "Not set" : analysis.data.breakdown.location.matched ? "Match" : "No match"}</span>
          </div>
          {!!analysis.data.requiredSkills.length && <div><strong>Required skills detected</strong><p>{analysis.data.requiredSkills.join(", ")}</p></div>}
          {!!analysis.data.preferredSkills.length && <div><strong>Preferred skills detected</strong><p>{analysis.data.preferredSkills.join(", ")}</p></div>}
          {!!analysis.data.matchedSkills.length && <div><strong>Matching skills</strong><p className="fit-positive">{analysis.data.matchedSkills.join(", ")}</p></div>}
          {!!analysis.data.missingRequiredSkills.length && <div><strong>Required skills not in your profile</strong><p className="fit-gap">{analysis.data.missingRequiredSkills.join(", ")}</p></div>}
          {!!analysis.data.missingPreferredSkills.length && <div><strong>Preferred skills not in your profile</strong><p>{analysis.data.missingPreferredSkills.join(", ")}</p></div>}
          {!!analysis.data.evidence.length && <div><strong>Resume evidence</strong>{analysis.data.evidence.map(item => <p key={item.skill}><b>{item.skill}</b> — {item.sections.length ? item.sections.join(", ") : "No saved section evidence"}{item.excerpts.length ? `: ${item.excerpts.join(" · ")}` : ""}</p>)}</div>}
          {!!analysis.data.gaps.length && <div><strong>Gaps to review</strong><ul>{analysis.data.gaps.map(item => <li key={item}>{item}</li>)}</ul></div>}
          {!!analysis.data.recommendations.length && <div><strong>Next steps</strong><ul>{analysis.data.recommendations.map(item => <li key={item}>{item}</li>)}</ul></div>}
          <p className="fit-disclaimer">{analysis.data.disclaimer}</p>
        </div>}
      </article>)}
      {!jobs.length && !loading && <div className="empty"><h3>No matching jobs</h3><p>Add public board IDs in Source Management, then sync job sources. You can also adjust your search filters.</p></div>}
      {loading && <div className="empty loading-state">Loading job opportunities…</div>}
    </section>

    <footer>AI Job Agent · Public job discovery · Applications always remain under your control.</footer>
  </main>;
}
