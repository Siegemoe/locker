"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type Activity = { id: string; actorType: string; actorLabel: string; action: string; summary: string; createdAt: string };
type Project = { id: string; key: string; name: string; description: string | null; color: string | null; status: string; archivedAt: string | null };
type Tag = { id: string; name: string; color: string | null; archivedAt?: string | null };
type Artifact = { id: string; kind: "LINK" | "TEXT" | "FILE_METADATA"; title: string; url: string | null; textContent: string | null; fileName: string | null; mimeType: string | null; sizeBytes: number | null };
type Task = {
  id: string; title: string; description: string | null; status: string; priority: string;
  createdBy: string | null; version: number; createdAt: string; updatedAt: string;
  completedAt: string | null; approvedAt: string | null; approvedBy: string | null;
  archivedAt: string | null; project: { id: string; key: string; name: string } | null; activities: Activity[];
  tags: { tag: Tag }[]; artifacts: Artifact[];
};
type WorkspaceData = { id: string; name: string; projects: Project[]; tags: Tag[]; tasks: Task[] };
type WorkspaceActivity = Activity & {
  project: { id: string; key: string; name: string } | null;
  task: { id: string; title: string } | null;
  tag: { id: string; name: string } | null;
  artifact: { id: string; title: string; kind: string } | null;
};
type GroupKey = "status" | "classification" | "project" | "none";
type DialogMode = "detail" | "edit";
type DescriptionSection = { id: string; title: string; level: number; body: string };

const stages = [
  ["BACKLOG", "Inbox"], ["READY", "Ready"], ["IN_PROGRESS", "In progress"],
  ["BLOCKED", "Blocked"], ["DONE", "Complete"], ["CANCELED", "Canceled"]
] as const;
const classificationOrder = ["Feature", "UI / UX", "Security", "MCP", "Bug", "Subagent", "Task"];
const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
const numberFormatter = new Intl.NumberFormat("en-US");

function classification(task: Task) {
  return task.tags[0]?.tag.name ?? "Untagged";
}

function statusLabel(status: string) {
  return stages.find(([value]) => value === status)?.[1] ?? status;
}

function groupValue(task: Task, key: GroupKey) {
  if (key === "status") return statusLabel(task.status);
  if (key === "classification") return classification(task);
  if (key === "project") return task.project?.key ?? "Unsorted";
  return "All work";
}

function taskProgress(task: Task) {
  if (task.archivedAt) return "Archived";
  if (task.approvedAt) return "Human approved";
  if (task.status === "DONE") return "Awaiting approval";
  if (task.status === "BLOCKED") return "Needs a decision";
  if (task.status === "IN_PROGRESS") return "Work is moving";
  return task.activities.length ? `${task.activities.length} logged changes` : "Newly captured";
}

function plainTaskPreview(description: string | null) {
  if (!description) return "Open this card to review the work and define the outcome.";
  return description
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_~`>|]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function promoteLooseHeadings(description: string) {
  const lines = description.replace(/\r\n?/g, "\n").trim().split("\n");
  return lines.map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed) || /^([-+*]|\d+[.)])\s/.test(trimmed)) return line;
    const previousIsBlank = index === 0 || !lines[index - 1].trim();
    const nextIsBlank = index < lines.length - 1 && !lines[index + 1].trim();
    const nextContent = lines.slice(index + 1).find((candidate) => candidate.trim());
    const title = trimmed.replace(/:$/, "");
    const looksLikeHeading = previousIsBlank && nextIsBlank && Boolean(nextContent) &&
      title.length <= 80 && title.split(/\s+/).length <= 10 && !/[.!?;]$/.test(title);
    return looksLikeHeading ? `## ${title}` : line;
  }).join("\n");
}

function slugifyHeading(value: string) {
  return value.toLowerCase().replace(/[`*_~[\]()]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
}

function structureDescription(description: string) {
  const markdown = promoteLooseHeadings(description);
  const intro: string[] = [];
  const sections: DescriptionSection[] = [];
  const usedIds = new Map<string, number>();
  let current: DescriptionSection | null = null;

  for (const line of markdown.split("\n")) {
    const heading = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line.trim());
    if (!heading) {
      if (current) current.body = `${current.body}${current.body ? "\n" : ""}${line}`;
      else intro.push(line);
      continue;
    }
    const title = heading[2].replace(/[*_~`]/g, "").trim();
    const baseId = `task-section-${slugifyHeading(title)}`;
    const occurrence = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, occurrence + 1);
    current = { id: occurrence ? `${baseId}-${occurrence + 1}` : baseId, title, level: heading[1].length, body: "" };
    sections.push(current);
  }

  return { intro: intro.join("\n").trim(), sections: sections.map((section) => ({ ...section, body: section.body.trim() })) };
}

function safeMarkdownUrl(url: string) {
  if (url.startsWith("#")) return url;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? url : "";
  } catch {
    return "";
  }
}

const markdownComponents: Components = {
  a: ({ href, children }) => {
    const safeHref = href ? safeMarkdownUrl(href) : "";
    if (!safeHref) return <span>{children}</span>;
    const opensNewTab = /^https?:/i.test(safeHref);
    return <a href={safeHref} target={opensNewTab ? "_blank" : undefined} rel={opensNewTab ? "noopener noreferrer" : undefined}>{children}</a>;
  }
};

function TaskDescription({ description }: { description: string | null }) {
  const structured = useMemo(() => description ? structureDescription(description) : null, [description]);
  if (!description || !structured) return <p className="detailDescription detailEmpty">No details have been added yet.</p>;
  const showOutline = description.length > 500 && structured.sections.length > 1;
  const renderMarkdown = (value: string) => <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml urlTransform={safeMarkdownUrl}>{value}</ReactMarkdown>;

  return <div className="detailDescription taskMarkdown" data-testid="task-description">
    {showOutline && <details className="detailOutline" open>
      <summary>On this task <span>{structured.sections.length} sections</span></summary>
      <ol>{structured.sections.map((section) => <li className={`level-${section.level}`} key={section.id}><a href={`#${section.id}`} onClick={(event) => { event.preventDefault(); document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{section.title}</a></li>)}</ol>
    </details>}
    {structured.intro && <div className="markdownIntro">{renderMarkdown(structured.intro)}</div>}
    {structured.sections.map((section) => <section className={`markdownSection level-${section.level}`} id={section.id} key={section.id}>
      {section.level <= 2 ? <h3>{section.title}</h3> : <h4>{section.title}</h4>}
      {section.body && renderMarkdown(section.body)}
    </section>)}
  </div>;
}

export default function Workspace({ initialWorkspace }: { initialWorkspace: WorkspaceData }) {
  const [tasks, setTasks] = useState(initialWorkspace.tasks);
  const [projects, setProjects] = useState(initialWorkspace.projects);
  const [tags, setTags] = useState(initialWorkspace.tags);
  const [archived, setArchived] = useState<Task[]>([]);
  const [showArchive, setShowArchive] = useState(false);
  const [section, setSection] = useState<"work" | "manage" | "activity">("work");
  const [activityLog, setActivityLog] = useState<WorkspaceActivity[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>("detail");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshState, setRefreshState] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [tagFilter, setTagFilter] = useState("ALL");
  const [actorFilter, setActorFilter] = useState("ALL");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [taskFilter, setTaskFilter] = useState("ALL");
  const [daysFilter, setDaysFilter] = useState("30");
  const [primaryGroup, setPrimaryGroup] = useState<GroupKey>("status");
  const [secondaryGroup, setSecondaryGroup] = useState<GroupKey>("project");
  const [sort, setSort] = useState("UPDATED");
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dialogOpen = creating || Boolean(selected);

  const closeDialog = useCallback(() => {
    setCreating(false);
    setSelected(null);
    setDialogMode("detail");
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  function openDetails(task: Task, trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setCreating(false);
    setDialogMode("detail");
    setSelected(task);
  }

  function openEditor(task: Task, trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setCreating(false);
    setDialogMode("edit");
    setSelected(task);
  }

  function openCreator(trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setSelected(null);
    setDialogMode("edit");
    setCreating(true);
  }

  useEffect(() => {
    if (!dialogOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const initialFocus = creating || dialogMode === "edit"
        ? dialogRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]")
        : dialogRef.current?.querySelector<HTMLElement>("[data-detail-initial-focus]");
      initialFocus?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeDialog, creating, dialogMode, dialogOpen]);

  const sourceTasks = showArchive ? archived : tasks;
  const activeProjects = projects.filter((project) => !project.archivedAt);
  const visibleTasks = useMemo(() => {
    const priorityRank: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return sourceTasks.filter((task) => {
      const haystack = `${task.title} ${task.description ?? ""} ${task.project?.key ?? ""} ${task.tags.map(({ tag }) => tag.name).join(" ")}`.toLowerCase();
      return (!query || haystack.includes(query.toLowerCase())) &&
        (statusFilter === "ALL" || task.status === statusFilter) &&
        (projectFilter === "ALL" || (task.project?.id ?? "UNSORTED") === projectFilter) &&
        (tagFilter === "ALL" || task.tags.some(({ tag }) => tag.id === tagFilter));
    }).sort((a, b) => {
      if (sort === "PRIORITY") return priorityRank[a.priority] - priorityRank[b.priority] || +new Date(b.updatedAt) - +new Date(a.updatedAt);
      if (sort === "OLDEST") return +new Date(a.createdAt) - +new Date(b.createdAt);
      return +new Date(b.updatedAt) - +new Date(a.updatedAt);
    });
  }, [sourceTasks, query, statusFilter, projectFilter, tagFilter, sort]);

  const grouped = useMemo(() => {
    const primary = new Map<string, Map<string, Task[]>>();
    for (const task of visibleTasks) {
      const first = groupValue(task, primaryGroup);
      const second = secondaryGroup === "none" || secondaryGroup === primaryGroup ? "All" : groupValue(task, secondaryGroup);
      if (!primary.has(first)) primary.set(first, new Map());
      const nested = primary.get(first)!;
      if (!nested.has(second)) nested.set(second, []);
      nested.get(second)!.push(task);
    }
    const rank = (value: string) => {
      if (primaryGroup === "status") {
        const index = stages.findIndex(([, label]) => label === value);
        return index < 0 ? 99 : index;
      }
      if (primaryGroup === "classification") return classificationOrder.indexOf(value);
      return 0;
    };
    return [...primary.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [visibleTasks, primaryGroup, secondaryGroup]);

  const stats = useMemo(() => ({
    active: tasks.length,
    moving: tasks.filter((task) => task.status === "IN_PROGRESS").length,
    blocked: tasks.filter((task) => task.status === "BLOCKED").length,
    review: tasks.filter((task) => task.status === "DONE" && !task.approvedAt).length,
    approved: tasks.filter((task) => task.approvedAt).length,
    human: tasks.flatMap((task) => task.activities).filter((event) => event.actorType === "USER").length,
    ai: tasks.flatMap((task) => task.activities).filter((event) => event.actorType === "AI_TOOL").length
  }), [tasks]);

  async function refresh(includeArchived = showArchive) {
    const [activeResponse, archiveResponse, workspaceResponse] = await Promise.all([
      fetch(`/api/workspaces/${initialWorkspace.id}/tasks`, { cache: "no-store" }),
      includeArchived ? fetch(`/api/workspaces/${initialWorkspace.id}/tasks?archived=true`, { cache: "no-store" }) : null,
      fetch("/api/workspace", { cache: "no-store" })
    ]);
    const activeBody = await activeResponse.json();
    const workspaceBody = await workspaceResponse.json();
    if (!activeResponse.ok) throw new Error(activeBody.error ?? "Could not refresh tasks");
    if (!workspaceResponse.ok) throw new Error(workspaceBody.error ?? "Could not refresh workspace");
    setTasks(activeBody.data);
    setProjects(workspaceBody.data.projects);
    setTags(workspaceBody.data.tags);
    let archiveData = archived;
    if (archiveResponse) {
      const archiveBody = await archiveResponse.json();
      if (!archiveResponse.ok) throw new Error(archiveBody.error ?? "Could not refresh archive");
      setArchived(archiveBody.data);
      archiveData = archiveBody.data;
    }
    if (selected) {
      setSelected([...activeBody.data, ...archiveData].find((task: Task) => task.id === selected.id) ?? selected);
    }
    return activeBody.data as Task[];
  }

  async function refreshCurrent() {
    setRefreshState("Refreshing…"); setError("");
    try {
      await refresh(showArchive || Boolean(selected?.archivedAt));
      if (section === "activity") await fetchActivity();
      setRefreshState("Up to date");
      window.setTimeout(() => setRefreshState(""), 1800);
    } catch (cause) {
      setRefreshState("Refresh failed");
      setError(cause instanceof Error ? cause.message : "Could not refresh current data");
    }
  }

  function resetControls() {
    setQuery(""); setStatusFilter("ALL"); setProjectFilter("ALL"); setTagFilter("ALL");
    setPrimaryGroup("status"); setSecondaryGroup("project"); setSort("UPDATED");
    setActorFilter("ALL"); setActionFilter("ALL"); setTaskFilter("ALL"); setDaysFilter("30");
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/workspaces/${initialWorkspace.id}/tasks`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"), description: form.get("description"),
          projectId: form.get("projectId") || undefined, priority: form.get("priority"), status: "BACKLOG",
          tagIds: form.getAll("tagIds")
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not capture item");
      closeDialog(); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/tasks/${selected.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: selected.version, title: form.get("title"), description: form.get("description"),
          projectId: form.get("projectId") || null, priority: form.get("priority"), status: form.get("status"),
          tagIds: form.getAll("tagIds")
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save item");
      await refresh(); closeDialog();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  async function lifecycle(task: Task, action: "approve" | "archive" | "restore") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: task.version, action })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `Could not ${action} item`);
      closeDialog(); await refresh(action === "restore" || showArchive);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  async function changeView(archiveView: boolean) {
    setSection("work");
    setShowArchive(archiveView);
    if (archiveView) {
      try { await refresh(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load archive"); }
    }
  }

  async function mutate(path: string, method: "POST" | "PATCH", body: unknown) {
    setBusy(true); setError("");
    try {
      const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The change could not be saved");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
      setBusy(false);
    }
  }

  async function addArtifact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const kind = String(form.get("kind"));
    const base = { kind, title: form.get("artifactTitle") };
    const body = kind === "LINK" ? { ...base, url: form.get("url") } :
      kind === "TEXT" ? { ...base, textContent: form.get("textContent") } :
        { ...base, fileName: form.get("fileName"), mimeType: form.get("mimeType"), sizeBytes: Number(form.get("sizeBytes")) };
    try {
      const response = await fetch(`/api/tasks/${selected.id}/artifacts`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not attach context");
      const next = await refresh();
      setSelected(next.find((task) => task.id === selected.id) ?? null);
      event.currentTarget.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  async function removeArtifact(artifactId: string) {
    if (!selected) return; setBusy(true);
    try {
      const response = await fetch(`/api/artifacts/${artifactId}`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not remove context");
      const next = await refresh();
      setSelected(next.find((task) => task.id === selected.id) ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  async function fetchActivity() {
    const params = new URLSearchParams();
    if (projectFilter !== "ALL" && projectFilter !== "UNSORTED") params.set("projectId", projectFilter);
    if (tagFilter !== "ALL") params.set("tagId", tagFilter);
    if (actorFilter !== "ALL") params.set("actorType", actorFilter);
    if (actionFilter !== "ALL") params.set("action", actionFilter);
    if (taskFilter !== "ALL") params.set("taskId", taskFilter);
    if (daysFilter !== "ALL") params.set("days", daysFilter);
    try {
      const response = await fetch(`/api/workspaces/${initialWorkspace.id}/activity?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load activity");
      setActivityLog(result.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong"); }
  }

  async function loadActivity() {
    setSection("activity"); setShowArchive(false);
    await fetchActivity();
  }

  const renderCard = (task: Task) => {
    const lastEvent = task.activities[0];
    return <article className="galleryCard" key={task.id}>
      <button className="cardOpen" onClick={(event) => openDetails(task, event.currentTarget)} aria-label={`View details for ${task.title}`}>
        <div className="cardTop"><div className="titleTags">{task.tags.length ? task.tags.map(({ tag }) => <span className="typeBadge" style={{ "--tag": tag.color ?? "#718266" } as React.CSSProperties} key={tag.id}>{tag.name}</span>) : <span className="typeBadge">Untagged</span>}</div><span className="cardStatus">{statusLabel(task.status)}</span></div>
        <h3>{task.title}</h3>
        <p>{plainTaskPreview(task.description)}</p>
        <div className="progressSignal"><i className={task.status.toLowerCase()} /><span>{taskProgress(task)}</span><b>v{task.version}</b></div>
      </button>
      <footer className="cardFooter"><span className="projectPill" style={{ "--project": task.project ? projects.find((project) => project.id === task.project!.id)?.color ?? "#c5f779" : "#768075" } as React.CSSProperties}>{task.project?.key ?? "UNSORTED"}</span><span>{lastEvent ? `${lastEvent.actorType === "AI_TOOL" ? "AI" : "Human"} · ${dateFormatter.format(new Date(lastEvent.createdAt))}` : task.createdBy ?? "Local"}</span>{!task.archivedAt && <button className="cardEdit" onClick={(event) => { event.stopPropagation(); openEditor(task, event.currentTarget); }} aria-label={`Edit ${task.title}`}>Edit</button>}</footer>
    </article>;
  };

  return <main className="galleryShell">
    <header className="appHeader">
      <div className="brand"><span className="brandMark">S</span><div><strong>Spore Locker</strong><small>shared local work</small></div></div>
      <div className="viewTabs">
        <button className={section === "work" && !showArchive ? "active" : ""} onClick={() => changeView(false)}>Active <span>{tasks.length}</span></button>
        <button className={section === "work" && showArchive ? "active" : ""} onClick={() => changeView(true)}>Archive</button>
        <button className={section === "manage" ? "active" : ""} onClick={() => { setSection("manage"); setShowArchive(false); }}>Projects & tags</button>
        <button className={section === "activity" ? "active" : ""} onClick={loadActivity}>Activity</button>
      </div>
      <div className="headerActions"><button className="refreshAction" onClick={() => void refreshCurrent()} disabled={refreshState === "Refreshing…"}>↻ Refresh</button>{section === "work" && !showArchive && <button className="newAction" onClick={(event) => openCreator(event.currentTarget)}>+ New</button>}<span role="status">{refreshState}</span></div>
    </header>

    {section !== "manage" && <section className="filterBar" aria-label="Task controls">
      <label className="searchBox"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search work, type, or project" /></label>
      {section === "work" && <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option>{stages.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
      <label>Project<select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="ALL">All projects</option><option value="UNSORTED">Unsorted</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.key}</option>)}</select></label>
      <label>Tag<select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="ALL">All tags</option>{tags.map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select></label>
      {section === "work" ? <>
        <label>Group<select value={primaryGroup} onChange={(event) => setPrimaryGroup(event.target.value as GroupKey)}><option value="status">Status</option><option value="classification">Tag</option><option value="project">Project</option><option value="none">None</option></select></label>
        <label>Then<select value={secondaryGroup} onChange={(event) => setSecondaryGroup(event.target.value as GroupKey)}><option value="project">Project</option><option value="classification">Tag</option><option value="status">Status</option><option value="none">None</option></select></label>
        <label>Order<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="UPDATED">Recently changed</option><option value="PRIORITY">Priority</option><option value="OLDEST">Oldest first</option></select></label>
      </> : <>
        <label>Actor<select value={actorFilter} onChange={(event) => setActorFilter(event.target.value)}><option value="ALL">All actors</option><option value="USER">Human</option><option value="AI_TOOL">AI tool</option><option value="SYSTEM">System</option></select></label>
        <label>Action<select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}><option value="ALL">All actions</option><option value="task.">Task</option><option value="project.">Project</option><option value="tag.">Tag</option><option value="artifact.">Artifact</option></select></label>
        <label>Task<select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option value="ALL">All tasks</option>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select></label>
        <label>Time<select value={daysFilter} onChange={(event) => setDaysFilter(event.target.value)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="ALL">All time</option></select></label>
        <button className="applyFilters" onClick={loadActivity}>Apply</button>
      </>}
      <button className="resetAction" onClick={resetControls}>Reset controls</button>
    </section>}

    {error && <div className="error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}

    {section === "work" && <div className="galleryLayout">
      <section className="galleryMain">
        <div className="galleryIntro"><div><p className="eyebrow">{showArchive ? "RECOVERABLE HISTORY" : "ORDERED WORKSPACE"}</p><h1>{showArchive ? "Approved, not erased." : "Work, without the lanes."}</h1></div><p>{visibleTasks.length} {visibleTasks.length === 1 ? "card" : "cards"} · grouped by {primaryGroup}{secondaryGroup !== "none" && secondaryGroup !== primaryGroup ? ` then ${secondaryGroup}` : ""}</p></div>
        {grouped.length === 0 ? <div className="emptyPanel">No cards match these controls.</div> : grouped.map(([first, nested]) =>
          <section className="groupBlock" key={first}>
            <div className="groupHeading"><h2>{first}</h2><span>{[...nested.values()].flat().length}</span></div>
            {[...nested.entries()].map(([second, groupTasks]) => <div className="subgroup" key={second}>
              {second !== "All" && <h3>{second}<span>{groupTasks.length}</span></h3>}
              <div className="cardGrid">{groupTasks.map(renderCard)}</div>
            </div>)}
          </section>)}
      </section>

      <aside className="statsRail">
        <div><p className="eyebrow">PULSE</p><h2>Workspace signal</h2></div>
        <div className="statHero"><strong>{stats.active}</strong><span>active cards</span></div>
        <div className="statGrid"><span><b>{stats.moving}</b>Moving</span><span><b>{stats.blocked}</b>Blocked</span><span><b>{stats.review}</b>Review</span><span><b>{stats.approved}</b>Approved</span></div>
        <div className="actorSplit"><div><span>Human activity</span><b>{stats.human}</b></div><div><span>AI activity</span><b>{stats.ai}</b></div></div>
        <div className="miniBars"><i style={{ width: `${Math.max(8, stats.human / Math.max(1, stats.human + stats.ai) * 100)}%` }} /><i className="ai" style={{ width: `${Math.max(8, stats.ai / Math.max(1, stats.human + stats.ai) * 100)}%` }} /></div>
        <p className="railNote">A compact baseline for later cycle time, throughput, and project health analytics.</p>
      </aside>
    </div>}

    {section === "manage" && <section className="managementPage">
      <div className="pageIntro"><p className="eyebrow">WORKSPACE STRUCTURE</p><h1>Projects and tags</h1><p>Projects organize work; tags describe it. Archiving hides a filter without breaking task history.</p></div>
      <div className="managerGrid">
        <section className="managerPanel">
          <div className="managerHead"><div><h2>Projects</h2><p>Delete is available only when no tasks reference the project.</p></div><span>{activeProjects.length} active</span></div>
          <form className="quickCreate" onSubmit={(event) => {
            event.preventDefault(); const form = new FormData(event.currentTarget);
            void mutate(`/api/workspaces/${initialWorkspace.id}/projects`, "POST", { key: form.get("key"), name: form.get("name"), color: form.get("color") });
          }}>
            <input name="key" required maxLength={12} placeholder="KEY" />
            <input name="name" required maxLength={100} placeholder="Project name" />
            <input name="color" type="color" defaultValue="#c5f779" aria-label="Project color" />
            <button disabled={busy}>Add project</button>
          </form>
          <div className="managerList">{projects.map((project) => <form className={`managerItem ${project.archivedAt ? "archived" : ""}`} key={project.id} onSubmit={(event) => {
            event.preventDefault(); const form = new FormData(event.currentTarget);
            void mutate(`/api/projects/${project.id}`, "PATCH", { key: form.get("key"), name: form.get("name"), color: form.get("color") });
          }}>
            <input name="key" defaultValue={project.key} maxLength={12} required />
            <input name="name" defaultValue={project.name} maxLength={100} required />
            <input name="color" type="color" defaultValue={project.color ?? "#768075"} aria-label={`${project.name} color`} />
            <button disabled={busy}>Save</button>
            {!project.archivedAt && <button type="button" className="quietDanger" disabled={busy} onClick={() => void mutate(`/api/projects/${project.id}`, "POST", { action: "archive" })}>Archive</button>}
            <button type="button" className="quietDanger" disabled={busy} onClick={() => void mutate(`/api/projects/${project.id}`, "POST", { action: "delete" })}>Delete empty</button>
          </form>)}</div>
        </section>

        <section className="managerPanel">
          <div className="managerHead"><div><h2>Tags</h2><p>Task labels are explicit, reusable, and support multiple values.</p></div><span>{tags.length} active</span></div>
          <form className="quickCreate tagCreate" onSubmit={(event) => {
            event.preventDefault(); const form = new FormData(event.currentTarget);
            void mutate(`/api/workspaces/${initialWorkspace.id}/tags`, "POST", { name: form.get("name"), color: form.get("color") });
          }}>
            <input name="name" required maxLength={40} placeholder="Tag name" />
            <input name="color" type="color" defaultValue="#8ec6ff" aria-label="Tag color" />
            <button disabled={busy}>Add tag</button>
          </form>
          <div className="managerList">{tags.map((tag) => <form className="managerItem tagItem" key={tag.id} onSubmit={(event) => {
            event.preventDefault(); const form = new FormData(event.currentTarget);
            void mutate(`/api/tags/${tag.id}`, "PATCH", { name: form.get("name"), color: form.get("color") });
          }}>
            <input name="name" defaultValue={tag.name} maxLength={40} required />
            <input name="color" type="color" defaultValue={tag.color ?? "#718266"} aria-label={`${tag.name} color`} />
            <button disabled={busy}>Save</button>
            <button type="button" className="quietDanger" disabled={busy} onClick={() => void mutate(`/api/tags/${tag.id}`, "POST", { action: "archive" })}>Archive</button>
          </form>)}</div>
        </section>
      </div>
    </section>}

    {section === "activity" && <section className="activityPage">
      <div className="pageIntro"><p className="eyebrow">IMMUTABLE AUDIT</p><h1>Everything that changed.</h1><p>{activityLog.length} events match the current filters. Lifecycle records remain append-only even when an empty project filter is removed.</p></div>
      <div className="activityTable" role="table">
        <div className="activityHeader" role="row"><span>When</span><span>Actor</span><span>Action</span><span>Target</span><span>Summary</span></div>
        {activityLog.filter((event) => !query || `${event.summary} ${event.task?.title ?? ""} ${event.project?.name ?? ""} ${event.tag?.name ?? ""}`.toLowerCase().includes(query.toLowerCase())).map((event) => <article className="activityRow" role="row" key={event.id}>
          <time>{dateTimeFormatter.format(new Date(event.createdAt))}</time>
          <span><b>{event.actorLabel}</b><small>{event.actorType.replace("_", " ")}</small></span>
          <code>{event.action}</code>
          <span>{event.task?.title ?? event.project?.name ?? event.tag?.name ?? event.artifact?.title ?? "Workspace"}</span>
          <p>{event.summary}</p>
        </article>)}
        {!activityLog.length && <div className="emptyPanel">No activity matches these filters.</div>}
      </div>
    </section>}

    {dialogOpen && <div className="modalBackdrop" onMouseDown={closeDialog}>
      <div ref={dialogRef} className={`modal ${selected && dialogMode === "detail" ? "detailModal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalHead"><div><p className="eyebrow">{creating ? "CAPTURE" : `${classification(selected!)} · VERSION ${selected?.version}`}</p><h2 id="task-dialog-title">{creating ? "Save the thought" : dialogMode === "detail" ? selected?.title : "Edit task"}</h2></div><div className="modalHeadActions">{selected && dialogMode === "detail" && !selected.archivedAt && <button type="button" className="headerEdit" onClick={() => setDialogMode("edit")} aria-label={`Edit ${selected.title}`}>Edit</button>}<button type="button" className="close" data-detail-initial-focus={dialogMode === "detail" ? "true" : undefined} onClick={closeDialog} aria-label="Close task dialog">×</button></div></div>

        {selected && dialogMode === "detail" && <>
          <section className="detailContent">
            <div className="detailSummary">
              <div className="detailTags">{selected.tags.length ? selected.tags.map(({ tag }) => <span className="typeBadge" style={{ "--tag": tag.color ?? "#718266" } as React.CSSProperties} key={tag.id}>{tag.name}</span>) : <span className="typeBadge">Untagged</span>}</div>
              <span className="detailStatus"><i className={selected.status.toLowerCase()} />{statusLabel(selected.status)}</span>
            </div>
            <TaskDescription description={selected.description} />
            <dl className="detailMeta">
              <div><dt>Project</dt><dd>{selected.project ? `${selected.project.key} · ${selected.project.name}` : "Unsorted"}</dd></div>
              <div><dt>Priority</dt><dd>{selected.priority.toLowerCase()}</dd></div>
              <div><dt>Progress</dt><dd>{taskProgress(selected)}</dd></div>
              <div><dt>Updated</dt><dd>{dateTimeFormatter.format(new Date(selected.updatedAt))}</dd></div>
              <div><dt>Created</dt><dd>{dateTimeFormatter.format(new Date(selected.createdAt))}</dd></div>
              {selected.approvedAt && <div><dt>Approved</dt><dd>{dateTimeFormatter.format(new Date(selected.approvedAt))}{selected.approvedBy ? ` by ${selected.approvedBy}` : ""}</dd></div>}
              {selected.archivedAt && <div><dt>Archived</dt><dd>{dateTimeFormatter.format(new Date(selected.archivedAt))}</dd></div>}
            </dl>

            <section className="detailSection">
              <div className="artifactHead"><div><h3>Attached context</h3><p>References and durable notes connected to this task.</p></div><span>{selected.artifacts.length}</span></div>
              {selected.artifacts.length ? <div className="artifactList detailArtifactList">{selected.artifacts.map((artifact) => <article key={artifact.id}>
                <span className="artifactKind">{artifact.kind.replace("_", " ")}</span>
                <div><strong>{artifact.title}</strong>
                  {artifact.url && <a href={artifact.url} target="_blank" rel="noopener noreferrer">{artifact.url}</a>}
                  {artifact.kind === "TEXT" && <p>{artifact.textContent}</p>}
                  {artifact.kind === "FILE_METADATA" && <small>{artifact.fileName} · {artifact.mimeType} · {artifact.sizeBytes == null ? "Unknown size" : `${numberFormatter.format(artifact.sizeBytes)} bytes`}</small>}
                </div>
              </article>)}</div> : <p className="artifactEmpty">No context is attached.</p>}
            </section>

            <section className="detailSection taskHistory"><h3>Immutable task history</h3>{selected.activities.length ? selected.activities.map((event) => <p key={event.id}><strong>{event.actorLabel}</strong> · {event.summary}<small>{dateTimeFormatter.format(new Date(event.createdAt))}</small></p>) : <p className="artifactEmpty">No activity has been logged yet.</p>}</section>
          </section>
          {(selected.archivedAt || (selected.status === "DONE" && !selected.approvedAt) || selected.approvedAt) && <div className="detailActions">
            {selected.archivedAt && <button type="button" className="approve" disabled={busy} onClick={() => lifecycle(selected, "restore")}>Restore to active</button>}
            {selected.status === "DONE" && !selected.approvedAt && !selected.archivedAt && <button type="button" className="approve" disabled={busy} onClick={() => lifecycle(selected, "approve")}>Approve complete</button>}
            {selected.approvedAt && !selected.archivedAt && <button type="button" className="archive" disabled={busy} onClick={() => lifecycle(selected, "archive")}>Archive approved task</button>}
          </div>}
        </>}

        {(creating || dialogMode === "edit") && <>
          <form onSubmit={creating ? createTask : saveTask}>
            <label>Title<input name="title" required maxLength={200} defaultValue={selected?.title} data-dialog-initial-focus /></label>
            <label>Details <span className="fieldHint">Markdown supported</span><textarea name="description" maxLength={20000} rows={6} defaultValue={selected?.description ?? ""} placeholder="Use headings, lists, links, tables, or checkboxes to structure the work…" /></label>
            <div className="formRow"><label>Project<select name="projectId" defaultValue={selected?.project?.id ?? activeProjects[0]?.id ?? ""}><option value="">Unsorted</option>{activeProjects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}{selected?.project && !activeProjects.some((project) => project.id === selected.project!.id) && <option value={selected.project.id}>{selected.project.key} · archived project</option>}</select></label>
            <label>Priority<select name="priority" defaultValue={selected?.priority ?? "MEDIUM"}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>URGENT</option></select></label></div>
            <fieldset className="tagPicker"><legend>Tags</legend><div>{tags.map((tag) => <label key={tag.id} style={{ "--tag": tag.color ?? "#718266" } as React.CSSProperties}><input type="checkbox" name="tagIds" value={tag.id} defaultChecked={selected?.tags.some(({ tag: current }) => current.id === tag.id)} /><span>{tag.name}</span></label>)}</div></fieldset>
            {selected && <label>Stage<select name="status" defaultValue={selected.status}>{stages.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
            <div className="modalActions">
              {selected?.archivedAt && <button type="button" className="approve" disabled={busy} onClick={() => lifecycle(selected, "restore")}>Restore to active</button>}
              {selected?.status === "DONE" && !selected.approvedAt && !selected.archivedAt && <button type="button" className="approve" disabled={busy} onClick={() => lifecycle(selected, "approve")}>Approve complete</button>}
              {selected?.approvedAt && !selected.archivedAt && <button type="button" className="archive" disabled={busy} onClick={() => lifecycle(selected, "archive")}>Archive approved task</button>}
              {!selected?.archivedAt && <button className="primary" disabled={busy}>{busy ? "Saving…" : creating ? "Capture item" : "Save changes"}</button>}
            </div>
          </form>
          {selected && <section className="artifactPanel">
            <div className="artifactHead"><div><h3>Attached context</h3><p>Safe web links, notes, and metadata-only file references.</p></div><span>{selected.artifacts.length}</span></div>
            <div className="artifactSection"><h4>Links</h4><div className="artifactList">{selected.artifacts.filter((artifact) => artifact.kind === "LINK").map((artifact) => <article key={artifact.id}>
              <span className="artifactKind">LINK</span>
              <div><strong>{artifact.title}</strong>{artifact.url && <a href={artifact.url} target="_blank" rel="noopener noreferrer">{artifact.url}</a>}</div>
              <button type="button" onClick={() => void removeArtifact(artifact.id)} disabled={busy}>Remove</button>
            </article>)}{!selected.artifacts.some((artifact) => artifact.kind === "LINK") && <p className="artifactEmpty">No links attached.</p>}</div></div>
            <div className="artifactSection"><h4>Notes and file references</h4><div className="artifactList">{selected.artifacts.filter((artifact) => artifact.kind !== "LINK").map((artifact) => <article key={artifact.id}>
              <span className="artifactKind">{artifact.kind.replace("_", " ")}</span>
              <div><strong>{artifact.title}</strong>
                {artifact.kind === "TEXT" && <p>{artifact.textContent}</p>}
                {artifact.kind === "FILE_METADATA" && <small>{artifact.fileName} · {artifact.mimeType} · {artifact.sizeBytes == null ? "Unknown size" : `${numberFormatter.format(artifact.sizeBytes)} bytes`}</small>}
              </div>
              <button type="button" onClick={() => void removeArtifact(artifact.id)} disabled={busy}>Remove</button>
            </article>)}</div></div>
            {!selected.archivedAt && <form className="artifactForm" onSubmit={addArtifact}>
              <div className="formRow"><label>Context type<select name="kind" defaultValue="LINK"><option value="LINK">External link</option><option value="TEXT">Text / Markdown</option><option value="FILE_METADATA">File metadata</option></select></label><label>Title<input name="artifactTitle" required maxLength={200} placeholder="Design sketch, API notes…" /></label></div>
              <label>Safe external URL<input name="url" type="url" placeholder="https://excalidraw.com/…" /></label>
              <label>Text / Markdown<textarea name="textContent" maxLength={100000} rows={4} placeholder="Paste durable context or Markdown here." /></label>
              <div className="formRow"><label>File name<input name="fileName" maxLength={255} placeholder="specification.pdf" /></label><label>MIME type<select name="mimeType" defaultValue="application/pdf"><option>application/pdf</option><option>text/plain</option><option>text/markdown</option><option>image/png</option><option>image/jpeg</option><option>image/webp</option></select></label></div>
              <label>File size in bytes<input name="sizeBytes" type="number" min="1" max="26214400" placeholder="Metadata only; no binary is uploaded" /></label>
              <button className="secondaryAction" disabled={busy}>Attach context</button>
            </form>}
            <p className="policyNote">Binary upload is not enabled yet. File entries validate allowed type and a 25 MiB ceiling, but store metadata only—never arbitrary local paths or raw database blobs.</p>
          </section>}
          {selected && <div className="taskHistory"><h3>Immutable task history</h3>{selected.activities.map((event) => <p key={event.id}><strong>{event.actorLabel}</strong> · {event.summary}<small>{dateTimeFormatter.format(new Date(event.createdAt))}</small></p>)}</div>}
        </>}
      </div>
    </div>}
  </main>;
}
