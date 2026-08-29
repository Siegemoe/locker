"use client";

import { dateFormatter, plainTaskPreview, statusLabel, TagBadges, taskProgress, type Project, type Task } from "./workspace-view";

export function TaskCard({ task, projects, onOpen, onEdit }: {
  task: Task;
  projects: Project[];
  onOpen: (task: Task, trigger: HTMLElement) => void;
  onEdit: (task: Task, trigger: HTMLElement) => void;
}) {
  const lastEvent = task.activities[0];
  return <article className="galleryCard">
    <button className="cardOpen" onClick={(event) => onOpen(task, event.currentTarget)} aria-label={`View details for ${task.title}`}>
      <div className="cardTop"><div className="titleTags"><TagBadges tags={task.tags} /></div><span className="cardStatus">{statusLabel(task.status)}</span></div>
      <h3>{task.title}</h3>
      <p>{plainTaskPreview(task.description)}</p>
      <div className="progressSignal"><i className={task.status.toLowerCase()} /><span>{taskProgress(task)}</span><b>v{task.version}</b></div>
    </button>
    <footer className="cardFooter"><span className="projectPill" style={{ "--project": task.project ? projects.find((project) => project.id === task.project!.id)?.color ?? "#c5f779" : "#768075" } as React.CSSProperties}>{task.project?.key ?? "UNSORTED"}</span><span>{lastEvent ? `${lastEvent.actorType === "AI_TOOL" ? "AI" : "Human"} · ${dateFormatter.format(new Date(lastEvent.createdAt))}` : task.createdBy ?? "Local"}</span>{!task.archivedAt && <button className="cardEdit" onClick={(event) => { event.stopPropagation(); onEdit(task, event.currentTarget); }} aria-label={`Edit ${task.title}`}>Edit</button>}</footer>
  </article>;
}
