"use client";

import { FormEvent, useCallback, useMemo, useRef, useState } from "react";
import Journal from "./journal";
import Issues from "./issues";
import { ActivitySection } from "./activity-section";
import { ManageSection } from "./manage-section";
import { TaskCard } from "./task-card";
import { TaskDialog } from "./task-dialog";
import { classificationOrder, groupValue, stages, type DialogMode, type GroupKey, type Task, type WorkspaceActivity, type WorkspaceData } from "./workspace-view";

export default function Workspace({ initialWorkspace }: { initialWorkspace: WorkspaceData }) {
  const [tasks, setTasks] = useState(initialWorkspace.tasks);
  const [projects, setProjects] = useState(initialWorkspace.projects);
  const [tags, setTags] = useState(initialWorkspace.tags);
  const [archived, setArchived] = useState<Task[]>([]);
  const [showArchive, setShowArchive] = useState(false);
  const [section, setSection] = useState<"work" | "issues" | "journal" | "manage" | "activity">("work");
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

  return <main className="galleryShell">
    <header className="appHeader">
      <div className="brand"><span className="brandMark">S</span><div><strong>Spore Locker</strong><small>shared local work</small></div></div>
      <div className="viewTabs">
        <button className={section === "work" && !showArchive ? "active" : ""} onClick={() => changeView(false)}>Active <span>{tasks.length}</span></button>
        <button className={section === "work" && showArchive ? "active" : ""} onClick={() => changeView(true)}>Archive</button>
        <button className={section === "issues" ? "active" : ""} onClick={() => { setSection("issues"); setShowArchive(false); }}>Issues</button>
        <button className={section === "journal" ? "active" : ""} onClick={() => { setSection("journal"); setShowArchive(false); }}>Journal</button>
        <button className={section === "manage" ? "active" : ""} onClick={() => { setSection("manage"); setShowArchive(false); }}>Projects & tags</button>
        <button className={section === "activity" ? "active" : ""} onClick={loadActivity}>Activity</button>
      </div>
      <div className="headerActions"><button className="refreshAction" onClick={() => void refreshCurrent()} disabled={refreshState === "Refreshing…"}>↻ Refresh</button>{section === "work" && !showArchive && <button className="newAction" onClick={(event) => openCreator(event.currentTarget)}>+ New</button>}<span role="status">{refreshState}</span></div>
    </header>

    {section !== "manage" && section !== "journal" && section !== "issues" && <section className="filterBar" aria-label="Task controls">
      <label className="searchBox"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search work, type, or project" /></label>
      {section === "work" && <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option>{stages.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
      <label>Project<select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="ALL">All projects</option><option value="UNSORTED">Unsorted</option>{activeProjects.map((project) => <option value={project.id} key={project.id}>{project.key}</option>)}</select></label>
      <label>Tag<select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="ALL">All tags</option>{tags.map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select></label>
      {section === "work" ? <>
        <label>Group<select value={primaryGroup} onChange={(event) => setPrimaryGroup(event.target.value as GroupKey)}><option value="status">Status</option><option value="classification">Tag</option><option value="project">Project</option><option value="none">None</option></select></label>
        <label>Then<select value={secondaryGroup} onChange={(event) => setSecondaryGroup(event.target.value as GroupKey)}><option value="project">Project</option><option value="classification">Tag</option><option value="status">Status</option><option value="none">None</option></select></label>
        <label>Order<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="UPDATED">Recently changed</option><option value="PRIORITY">Priority</option><option value="OLDEST">Oldest first</option></select></label>
      </> : <>
        <label>Actor<select value={actorFilter} onChange={(event) => setActorFilter(event.target.value)}><option value="ALL">All actors</option><option value="USER">Human</option><option value="AI_TOOL">AI tool</option><option value="SYSTEM">System</option></select></label>
        <label>Action<select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}><option value="ALL">All actions</option><option value="task.">Task</option><option value="journal.">Journal</option><option value="project.">Project</option><option value="tag.">Tag</option><option value="artifact.">Artifact</option></select></label>
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
              <div className="cardGrid">{groupTasks.map((task) => <TaskCard key={task.id} task={task} projects={projects} onOpen={openDetails} onEdit={openEditor} />)}</div>
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

    {section === "issues" && <Issues workspaceId={initialWorkspace.id} projects={projects} />}

    {section === "journal" && <Journal workspaceId={initialWorkspace.id} projects={projects} />}

    {section === "manage" && <ManageSection workspaceId={initialWorkspace.id} projects={projects} tags={tags} busy={busy} onMutate={mutate} />}

    {section === "activity" && <ActivitySection events={activityLog} query={query} />}

    {dialogOpen && <TaskDialog
      selected={selected} creating={creating} dialogMode={dialogMode} busy={busy}
      projects={activeProjects} tags={tags}
      onClose={closeDialog} onChangeMode={setDialogMode}
      onCreate={createTask} onSave={saveTask} onLifecycle={lifecycle}
      onAddArtifact={addArtifact} onRemoveArtifact={removeArtifact}
    />}
  </main>;
}
