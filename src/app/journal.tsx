"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Project = { id: string; key: string; name: string; archivedAt: string | null };
type Contribution = {
  id: string; authorKey: string; authorLabel: string; modelId: string | null; role: string;
  bodyMarkdown: string; topics: string[]; importance: number; version: number;
  projects: { project: { id: string; key: string; name: string } }[];
  createdAt: string; updatedAt: string;
};
type Candidate = {
  id: string; authorKey: string; authorLabel: string; modelId: string | null; kind: string;
  summary: string; contextMarkdown: string | null; importance: number; consumedAt: string | null;
  project: { id: string; key: string; name: string } | null; createdAt: string;
};
type JournalEntry = {
  id: string; entryDate: string; title: string; subtitle: string | null; status: "OPEN" | "FINALIZED";
  version: number; finalizedAt: string | null; finalizedBy: string | null; markdown: string;
  contributions: Contribution[]; candidates: Candidate[];
};
type SearchResult = {
  kind: "CONTRIBUTION" | "CANDIDATE"; passageId: string; entryId: string; entryDate: string;
  entryTitle: string; authorKey: string; authorLabel: string; modelId: string | null; role: string;
  passage: string; importance: number; topics: string[]; projectKeys: string[]; rank: number;
};

const roles = ["REFLECTION", "USER_DECISION", "AGENT_OBSERVATION", "AGENT_HYPOTHESIS", "AGENT_RECOMMENDATION", "OBJECTIVE_ACTIVITY"];
const candidateKinds = ["DECISION", "REALIZATION", "MILESTONE", "DIRECTION_CHANGE", "ABANDONED_ASSUMPTION", "IDEA", "DISAGREEMENT", "FAILURE", "CHANGE_OF_MIND", "COMPLETION", "EVIDENCE"];
const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric", weekday: "long" });
const timeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function lockerToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function moveDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function label(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? url : "";
  } catch {
    return "";
  }
}

export default function Journal({ workspaceId, projects }: { workspaceId: string; projects: Project[] }) {
  const [date, setDate] = useState(lockerToday);
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [editingAuthor, setEditingAuthor] = useState("local-user");
  const activeProjects = useMemo(() => projects.filter((project) => !project.archivedAt), [projects]);

  useEffect(() => {
    let active = true;
    fetch(`/api/workspaces/${workspaceId}/journal?date=${date}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load the Journal");
        return body.data as JournalEntry | null;
      })
      .then((data) => { if (active) { setEntry(data); setLoading(false); } })
      .catch((cause) => { if (active) { setError(cause instanceof Error ? cause.message : "Could not load the Journal"); setLoading(false); } });
    return () => { active = false; };
  }, [date, workspaceId]);

  function navigateDate(nextDate: string) {
    setLoading(true);
    setDate(nextDate);
  }

  async function saveContribution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const authorKey = String(form.get("authorKey"));
    const existing = entry?.contributions.find((item) => item.authorKey === authorKey);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/journal/contributions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date, authorKey, authorLabel: form.get("authorLabel"), modelId: form.get("modelId") || null,
          role: form.get("role"), bodyMarkdown: form.get("bodyMarkdown"),
          topics: String(form.get("topics") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
          importance: Number(form.get("importance")), projectIds: form.getAll("projectIds"),
          candidateIds: form.getAll("candidateIds"), version: existing?.version
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save the contribution");
      setEntry(body.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the contribution");
    } finally { setBusy(false); }
  }

  async function flagCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/journal/candidates`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date, authorKey: form.get("authorKey"), authorLabel: form.get("authorLabel"),
          modelId: form.get("modelId") || null, kind: form.get("kind"), summary: form.get("summary"),
          contextMarkdown: form.get("contextMarkdown") || null, importance: Number(form.get("importance")),
          projectId: form.get("projectId") || null
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not flag the event");
      setEntry(body.data); event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not flag the event");
    } finally { setBusy(false); }
  }

  async function finalize() {
    if (!entry) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/journal/${entry.id}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: entry.version, action: "finalize" })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not finalize the Journal entry");
      setEntry(body.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finalize the Journal entry");
    } finally { setBusy(false); }
  }

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!search.trim()) { setResults([]); return; }
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ query: search, limit: "50" });
      const response = await fetch(`/api/workspaces/${workspaceId}/journal/search?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not search the Journal");
      setResults(body.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not search the Journal");
    } finally { setBusy(false); }
  }

  const selectedContribution = entry?.contributions.find((item) => item.authorKey === editingAuthor);
  const unusedCandidates = entry?.candidates.filter((candidate) => !candidate.consumedAt) ?? [];
  const displayDate = dateFormatter.format(new Date(`${date}T00:00:00.000Z`));

  return <section className="journalPage">
    <div className="journalTopline">
      <div><p className="eyebrow">PERSISTENT CONTINUITY</p><h1>The Journal</h1><p>One day, many perspectives. PostgreSQL is canonical; Markdown remains the authored language.</p></div>
      <form className="journalSearch" onSubmit={runSearch}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Journal history" /><button disabled={busy}>Search</button>{results.length > 0 && <button type="button" onClick={() => { setResults([]); setSearch(""); }}>Clear</button>}</form>
    </div>
    {error && <div className="error journalError" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}

    {results.length > 0 ? <section className="journalResults">
      <div className="journalSectionHead"><div><p className="eyebrow">RETRIEVAL</p><h2>Original passages</h2></div><span>{results.length} matches</span></div>
      {results.map((result) => <article key={`${result.kind}-${result.passageId}`}>
        <div><strong>{result.authorLabel}</strong><span>{result.kind.toLowerCase()} · {label(result.role)} · importance {result.importance}</span></div>
        <button onClick={() => { navigateDate(result.entryDate.slice(0, 10)); setResults([]); }}>{dateFormatter.format(new Date(result.entryDate))}</button>
        <p>{result.passage}</p>
        <small>{[...result.projectKeys, ...result.topics].join(" · ") || "Unclassified"}</small>
      </article>)}
    </section> : <>
      <div className="journalDateBar">
        <button onClick={() => navigateDate(moveDate(date, -1))} aria-label="Previous day">←</button>
        <label><span>{displayDate}</span><input type="date" value={date} onChange={(event) => navigateDate(event.target.value)} /></label>
        <button onClick={() => navigateDate(moveDate(date, 1))} aria-label="Next day">→</button>
        {date !== lockerToday() && <button className="journalToday" onClick={() => navigateDate(lockerToday())}>Today</button>}
        <span className={`journalState ${entry?.status.toLowerCase() ?? "empty"}`}>{entry?.status ?? "No entry"}{entry ? ` · v${entry.version}` : ""}</span>
      </div>

      {loading ? <div className="emptyPanel">Loading this day…</div> : <div className="journalLayout">
        <section className="journalReading">
          <div className="journalEntryHead"><div><p className="eyebrow">{date}</p><h2>{entry?.title ?? displayDate}</h2></div>{entry?.status === "OPEN" && <button disabled={busy || !entry.contributions.length} onClick={finalize}>Finalize day</button>}</div>
          {!entry?.contributions.length ? <div className="journalBlank"><h3>No authored contribution yet.</h3><p>This day stays empty until a person or agent has something meaningful to preserve.</p></div> : entry.contributions.map((contribution) => <article className="journalContribution" key={contribution.id}>
            <header><div><h3>{contribution.authorLabel}</h3><p>{contribution.modelId ?? contribution.authorKey} · {label(contribution.role)}</p></div><span>importance {contribution.importance} · v{contribution.version}</span></header>
            <div className="taskMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeUrl}>{contribution.bodyMarkdown}</ReactMarkdown></div>
            <footer><span>{contribution.projects.map(({ project }) => project.key).join(" · ") || "Personal"}</span><span>{contribution.topics.join(" · ")}</span><time>{timeFormatter.format(new Date(contribution.updatedAt))}</time></footer>
          </article>)}
          {entry?.status === "FINALIZED" && <p className="journalFinalized">Finalized {entry.finalizedAt ? timeFormatter.format(new Date(entry.finalizedAt)) : ""} by {entry.finalizedBy}. Later reinterpretation belongs in a new dated entry.</p>}
        </section>

        <aside className="journalComposer">
          {entry?.status !== "FINALIZED" ? <>
            <details open>
              <summary>Write a contribution</summary>
              <form onSubmit={saveContribution} key={`${date}-${selectedContribution?.id ?? editingAuthor}`}>
                <div className="journalFormRow"><label>Author key<input name="authorKey" value={editingAuthor} onChange={(event) => setEditingAuthor(event.target.value)} required pattern="[A-Za-z0-9][A-Za-z0-9._-]*" /></label><label>Display name<input name="authorLabel" defaultValue={selectedContribution?.authorLabel ?? "Local user"} required /></label></div>
                <label>Model or runtime<input name="modelId" defaultValue={selectedContribution?.modelId ?? ""} placeholder="Optional" /></label>
                <div className="journalFormRow"><label>Role<select name="role" defaultValue={selectedContribution?.role ?? "REFLECTION"}>{roles.map((role) => <option key={role} value={role}>{label(role)}</option>)}</select></label><label>Importance<select name="importance" defaultValue={selectedContribution?.importance ?? 3}>{[1,2,3,4,5].map((value) => <option key={value}>{value}</option>)}</select></label></div>
                <label>Topics<input name="topics" defaultValue={selectedContribution?.topics.join(", ") ?? ""} placeholder="continuity, locker, direction" /></label>
                <fieldset><legend>Related projects</legend>{activeProjects.map((project) => <label className="journalCheck" key={project.id}><input type="checkbox" name="projectIds" value={project.id} defaultChecked={selectedContribution?.projects.some((item) => item.project.id === project.id)} />{project.key}</label>)}</fieldset>
                {unusedCandidates.length > 0 && <fieldset><legend>Use candidate events</legend>{unusedCandidates.map((candidate) => <label className="journalCheck" key={candidate.id}><input type="checkbox" name="candidateIds" value={candidate.id} />{candidate.summary}</label>)}</fieldset>}
                <label>Contribution in Markdown<textarea name="bodyMarkdown" rows={14} defaultValue={selectedContribution?.bodyMarkdown ?? ""} required placeholder="What happened, what changed, and what do you think it means?" /></label>
                <button className="primary" disabled={busy}>{selectedContribution ? "Update contribution" : "Add contribution"}</button>
              </form>
            </details>
            <details>
              <summary>Flag an important event</summary>
              <form onSubmit={flagCandidate}>
                <div className="journalFormRow"><label>Author key<input name="authorKey" defaultValue="local-user" required /></label><label>Display name<input name="authorLabel" defaultValue="Local user" required /></label></div>
                <input name="modelId" type="hidden" />
                <div className="journalFormRow"><label>Kind<select name="kind" defaultValue="REALIZATION">{candidateKinds.map((kind) => <option value={kind} key={kind}>{label(kind)}</option>)}</select></label><label>Importance<select name="importance" defaultValue="3">{[1,2,3,4,5].map((value) => <option key={value}>{value}</option>)}</select></label></div>
                <label>Project<select name="projectId"><option value="">Personal / none</option>{activeProjects.map((project) => <option value={project.id} key={project.id}>{project.key}</option>)}</select></label>
                <label>Summary<input name="summary" required maxLength={2000} /></label>
                <label>Context<textarea name="contextMarkdown" rows={5} placeholder="Enough provenance for later reflection—not a transcript." /></label>
                <button className="secondaryAction" disabled={busy}>Flag event</button>
              </form>
            </details>
            {entry?.candidates.length ? <section className="candidateList"><h3>Candidate events</h3>{entry.candidates.map((candidate) => <article className={candidate.consumedAt ? "consumed" : ""} key={candidate.id}><strong>{label(candidate.kind)}</strong><p>{candidate.summary}</p><small>{candidate.authorLabel} · importance {candidate.importance}{candidate.project ? ` · ${candidate.project.key}` : ""}{candidate.consumedAt ? " · used" : ""}</small></article>)}</section> : null}
          </> : <div className="journalLocked"><h3>This day is finalized.</h3><p>Its original authored passages and revisions remain intact.</p></div>}
        </aside>
      </div>}
    </>}
  </section>;
}
