"use client";

import { FormEvent, useEffect, useRef } from "react";
import { TaskDescription } from "./task-description";
import {
  classification, dateTimeFormatter, numberFormatter, stages, statusLabel,
  TagBadges, taskProgress, type DialogMode, type Project, type Tag, type Task
} from "./workspace-view";

type TaskDialogProps = {
  selected: Task | null;
  creating: boolean;
  dialogMode: DialogMode;
  busy: boolean;
  projects: Project[];
  tags: Tag[];
  onClose: () => void;
  onChangeMode: (mode: DialogMode) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onLifecycle: (task: Task, action: "approve" | "archive" | "restore") => void;
  onAddArtifact: (event: FormEvent<HTMLFormElement>) => void;
  onRemoveArtifact: (artifactId: string) => void;
};

export function TaskDialog({ selected, creating, dialogMode, busy, projects, tags, onClose, onChangeMode, onCreate, onSave, onLifecycle, onAddArtifact, onRemoveArtifact }: TaskDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
        onClose();
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
  }, [onClose, creating, dialogMode]);

  return <div className="modalBackdrop" onMouseDown={onClose}>
    <div ref={dialogRef} className={`modal ${selected && dialogMode === "detail" ? "detailModal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modalHead"><div><p className="eyebrow">{creating ? "CAPTURE" : `${classification(selected!)} · VERSION ${selected?.version}`}</p><h2 id="task-dialog-title">{creating ? "Save the thought" : dialogMode === "detail" ? selected?.title : "Edit task"}</h2></div><div className="modalHeadActions">{selected && dialogMode === "detail" && !selected.archivedAt && <button type="button" className="headerEdit" onClick={() => onChangeMode("edit")} aria-label={`Edit ${selected.title}`}>Edit</button>}<button type="button" className="close" data-detail-initial-focus={dialogMode === "detail" ? "true" : undefined} onClick={onClose} aria-label="Close task dialog">×</button></div></div>

      {selected && dialogMode === "detail" && <>
        <section className="detailContent">
          <div className="detailSummary">
            <div className="detailTags"><TagBadges tags={selected.tags} /></div>
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
          {selected.archivedAt && <button type="button" className="approve" disabled={busy} onClick={() => onLifecycle(selected, "restore")}>Restore to active</button>}
          {selected.status === "DONE" && !selected.approvedAt && !selected.archivedAt && <button type="button" className="approve" disabled={busy} onClick={() => onLifecycle(selected, "approve")}>Approve complete</button>}
          {selected.approvedAt && !selected.archivedAt && <button type="button" className="archive" disabled={busy} onClick={() => onLifecycle(selected, "archive")}>Archive approved task</button>}
        </div>}
      </>}

      {(creating || dialogMode === "edit") && <>
        <form onSubmit={creating ? onCreate : onSave}>
          <label>Title<input name="title" required maxLength={200} defaultValue={selected?.title} data-dialog-initial-focus /></label>
          <label>Details <span className="fieldHint">Markdown supported</span><textarea name="description" maxLength={20000} rows={6} defaultValue={selected?.description ?? ""} placeholder="Use headings, lists, links, tables, or checkboxes to structure the work…" /></label>
          <div className="formRow"><label>Project<select name="projectId" defaultValue={creating ? projects[0]?.id ?? "" : selected?.project?.id ?? ""}><option value="">Unsorted</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}{selected?.project && !projects.some((project) => project.id === selected.project!.id) && <option value={selected.project.id}>{selected.project.key} · archived project</option>}</select></label>
          <label>Priority<select name="priority" defaultValue={selected?.priority ?? "MEDIUM"}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>URGENT</option></select></label></div>
          <fieldset className="tagPicker"><legend>Tags</legend><div>{tags.map((tag) => <label key={tag.id} style={{ "--tag": tag.color ?? "#718266" } as React.CSSProperties}><input type="checkbox" name="tagIds" value={tag.id} defaultChecked={selected?.tags.some(({ tag: current }) => current.id === tag.id)} /><span>{tag.name}</span></label>)}</div></fieldset>
          {selected && <label>Stage<select name="status" defaultValue={selected.status}>{stages.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
          <div className="modalActions">
            {selected?.archivedAt && <button type="button" className="approve" disabled={busy} onClick={() => onLifecycle(selected, "restore")}>Restore to active</button>}
            {selected?.status === "DONE" && !selected.approvedAt && !selected.archivedAt && <button type="button" className="approve" disabled={busy} onClick={() => onLifecycle(selected, "approve")}>Approve complete</button>}
            {selected?.approvedAt && !selected.archivedAt && <button type="button" className="archive" disabled={busy} onClick={() => onLifecycle(selected, "archive")}>Archive approved task</button>}
            {!selected?.archivedAt && <button className="primary" disabled={busy}>{busy ? "Saving…" : creating ? "Capture item" : "Save changes"}</button>}
          </div>
        </form>
        {selected && <section className="artifactPanel">
          <div className="artifactHead"><div><h3>Attached context</h3><p>Safe web links, notes, and metadata-only file references.</p></div><span>{selected.artifacts.length}</span></div>
          <div className="artifactSection"><h4>Links</h4><div className="artifactList">{selected.artifacts.filter((artifact) => artifact.kind === "LINK").map((artifact) => <article key={artifact.id}>
            <span className="artifactKind">LINK</span>
            <div><strong>{artifact.title}</strong>{artifact.url && <a href={artifact.url} target="_blank" rel="noopener noreferrer">{artifact.url}</a>}</div>
            <button type="button" onClick={() => void onRemoveArtifact(artifact.id)} disabled={busy}>Remove</button>
          </article>)}{!selected.artifacts.some((artifact) => artifact.kind === "LINK") && <p className="artifactEmpty">No links attached.</p>}</div></div>
          <div className="artifactSection"><h4>Notes and file references</h4><div className="artifactList">{selected.artifacts.filter((artifact) => artifact.kind !== "LINK").map((artifact) => <article key={artifact.id}>
            <span className="artifactKind">{artifact.kind.replace("_", " ")}</span>
            <div><strong>{artifact.title}</strong>
              {artifact.kind === "TEXT" && <p>{artifact.textContent}</p>}
              {artifact.kind === "FILE_METADATA" && <small>{artifact.fileName} · {artifact.mimeType} · {artifact.sizeBytes == null ? "Unknown size" : `${numberFormatter.format(artifact.sizeBytes)} bytes`}</small>}
            </div>
            <button type="button" onClick={() => void onRemoveArtifact(artifact.id)} disabled={busy}>Remove</button>
          </article>)}</div></div>
          {!selected.archivedAt && <form className="artifactForm" onSubmit={onAddArtifact}>
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
  </div>;
}
