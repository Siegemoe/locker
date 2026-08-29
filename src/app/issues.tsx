"use client";

import { IssueKind, IssueSeverity, IssueStatus } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Activity = { id: string; actorType: string; actorLabel: string; action: string; summary: string; createdAt: string };
type Project = { id: string; key: string; name: string; archivedAt: string | null };
type IssueArtifact = {
  id: string; kind: "LINK" | "TEXT" | "FILE_METADATA"; title: string; url: string | null;
  textContent: string | null; fileName: string | null; mimeType: string | null; sizeBytes: number | null;
};
type Issue = {
  id: string; code: string; kind: string; title: string; details: string | null;
  status: string; severity: string; closeReason: string | null;
  project: { id: string; key: string; name: string };
  assignedTaskId: string | null; assignedTask: { id: string; title: string; status: string } | null;
  duplicateOfId: string | null; duplicateOf: { id: string; code: string; title: string } | null;
  reportedBy: string | null; version: number; createdAt: string; updatedAt: string;
  resolvedAt: string | null; closedAt: string | null;
  artifacts: IssueArtifact[]; activities: Activity[];
};

// Vocabularies come from the Prisma client, the same source the contracts use.
const statuses = Object.values(IssueStatus);
const severities = Object.values(IssueSeverity);
const kinds = Object.values(IssueKind);
const numberFormatter = new Intl.NumberFormat("en-US");
const timeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

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

export default function Issues({ workspaceId, projects }: { workspaceId: string; projects: Project[] }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [kindFilter, setKindFilter] = useState<string>("ALL");
  const [projectFilter, setProjectFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const activeProjects = useMemo(() => projects.filter((project) => !project.archivedAt), [projects]);

  async function load() {
    setError("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/issues`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load issues");
      setIssues(body.data as Issue[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load issues");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/workspaces/${workspaceId}/issues`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load issues");
        return body.data as Issue[];
      })
      .then((data) => { if (active) setIssues(data); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load issues"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId]);

  const visible = useMemo(() => issues.filter((issue) => {
    const haystack = `${issue.code} ${issue.title} ${issue.details ?? ""} ${issue.project.key}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) &&
      (statusFilter === "ALL" || issue.status === statusFilter) &&
      (severityFilter === "ALL" || issue.severity === severityFilter) &&
      (kindFilter === "ALL" || issue.kind === kindFilter) &&
      (projectFilter === "ALL" || issue.project.id === projectFilter);
  }), [issues, query, statusFilter, severityFilter, kindFilter, projectFilter]);

  // Unassigned work-orders age in the open: pin them, oldest first.
  const pinned = useMemo(() => visible
    .filter((issue) => !issue.assignedTaskId && (issue.status === "OPEN" || issue.status === "TRIAGED"))
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)), [visible]);
  const grouped = useMemo(() => severities
    .map((severity) => [severity, visible.filter((issue) => pinned.every((pinnedIssue) => pinnedIssue.id !== issue.id) && issue.severity === severity)] as const)
    .filter(([, group]) => group.length > 0), [visible, pinned]);

  return <section className="journalPage">
    <div className="journalTopline">
      <div><p className="eyebrow">KNOWN PROBLEMS</p><h1>Issues</h1><p>Work-orders for problems that are not committed work yet. Filing and editing run through the agents and MCP tools; this page reads what they recorded.</p></div>
      <form className="journalSearch" onSubmit={(event) => event.preventDefault()}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search code, title, details" />
        <button type="button" onClick={() => void load()}>Reload</button>
      </form>
    </div>
    {error && <div className="error journalError" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}

    <div className="filterBar" aria-label="Issue controls">
      <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option>{statuses.map((status) => <option value={status} key={status}>{label(status)}</option>)}</select></label>
      <label>Severity<select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option value="ALL">All severities</option>{severities.map((severity) => <option value={severity} key={severity}>{label(severity)}</option>)}</select></label>
      <label>Kind<select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="ALL">All kinds</option>{kinds.map((kind) => <option value={kind} key={kind}>{label(kind)}</option>)}</select></label>
      <label>Project<select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="ALL">All projects</option>{activeProjects.map((project) => <option value={project.id} key={project.id}>{project.key}</option>)}</select></label>
      <button className="resetAction" onClick={() => { setStatusFilter("ALL"); setSeverityFilter("ALL"); setKindFilter("ALL"); setProjectFilter("ALL"); setQuery(""); }}>Reset controls</button>
    </div>

    {loading ? <div className="emptyPanel">Loading issues…</div> : visible.length === 0 ? <div className="emptyPanel">No issues match these controls.</div> : <>
      {pinned.length > 0 && <section className="groupBlock" key="unassigned">
        <div className="groupHeading"><h2>Unassigned &amp; aging</h2><span>{pinned.length}</span></div>
        <div className="cardGrid">{pinned.map(renderIssue)}</div>
      </section>}
      {grouped.map(([severity, group]) => <section className="groupBlock" key={severity}>
        <div className="groupHeading"><h2>{label(severity)}</h2><span>{group.length}</span></div>
        <div className="cardGrid">{group.map(renderIssue)}</div>
      </section>)}
    </>}
  </section>;

  function renderIssue(issue: Issue) {
    const lastEvent = issue.activities[0];
    return <article className="galleryCard" key={issue.id}>
      <div className="cardOpen" aria-label={`Issue ${issue.code}: ${issue.title}`}>
        <div className="cardTop">
          <span className="typeBadge">{issue.code}</span>
          <span className="cardStatus">{label(issue.status)}</span>
        </div>
        <h3>Issue {issue.code} · {issue.title}</h3>
        {issue.details && <div className="taskMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeUrl}>{issue.details}</ReactMarkdown></div>}
        {!issue.details && <p>No details recorded — the work-order code is the record.</p>}
        <div className="progressSignal"><i className={issue.severity.toLowerCase()} /><span>{label(issue.kind)} · {label(issue.severity)}</span><b>v{issue.version}</b></div>
      </div>
      <footer className="cardFooter">
        <span className="projectPill">{issue.project.key}</span>
        <span>{issue.assignedTask ? issue.assignedTask.title : "Unassigned"}{issue.artifacts.length ? ` · ${numberFormatter.format(issue.artifacts.length)} attachment${issue.artifacts.length === 1 ? "" : "s"}` : ""}</span>
        {lastEvent && <span>{lastEvent.actorLabel} · {timeFormatter.format(new Date(lastEvent.createdAt))}</span>}
      </footer>
      {issue.artifacts.length > 0 && <div className="artifactList detailArtifactList">{issue.artifacts.map((artifact) => <article key={artifact.id}>
        <span className="artifactKind">{artifact.kind.replace("_", " ")}</span>
        <div><strong>{artifact.title}</strong>
          {artifact.url && <a href={safeUrl(artifact.url ?? "")} target="_blank" rel="noopener noreferrer">{artifact.url}</a>}
          {artifact.kind === "TEXT" && <p>{artifact.textContent}</p>}
          {artifact.kind === "FILE_METADATA" && <small>{artifact.fileName} · {artifact.mimeType} · {artifact.sizeBytes == null ? "Unknown size" : `${numberFormatter.format(artifact.sizeBytes)} bytes`}</small>}
        </div>
      </article>)}</div>}
      {issue.activities.length > 0 && <details className="taskHistory">
        <summary>History ({issue.activities.length})</summary>
        {issue.activities.map((event) => <p key={event.id}><strong>{event.actorLabel}</strong> · {event.summary}<small>{timeFormatter.format(new Date(event.createdAt))}</small></p>)}
      </details>}
    </article>;
  }
}
