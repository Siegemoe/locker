"use client";

import { dateTimeFormatter, type WorkspaceActivity } from "./workspace-view";

export function ActivitySection({ events, query }: { events: WorkspaceActivity[]; query: string }) {
  return <section className="activityPage">
    <div className="pageIntro"><p className="eyebrow">IMMUTABLE AUDIT</p><h1>Everything that changed.</h1><p>{events.length} events match the current filters. Lifecycle records remain append-only even when an empty project filter is removed.</p></div>
    <div className="activityTable" role="table">
      <div className="activityHeader" role="row"><span>When</span><span>Actor</span><span>Action</span><span>Target</span><span>Summary</span></div>
      {events.filter((event) => !query || `${event.summary} ${event.task?.title ?? ""} ${event.project?.name ?? ""} ${event.tag?.name ?? ""}`.toLowerCase().includes(query.toLowerCase())).map((event) => <article className="activityRow" role="row" key={event.id}>
        <time>{dateTimeFormatter.format(new Date(event.createdAt))}</time>
        <span><b>{event.actorLabel}</b><small>{event.actorType.replace("_", " ")}</small></span>
        <code>{event.action}</code>
        <span>{event.task?.title ?? event.journalContribution?.authorLabel ?? event.journalCandidate?.summary ?? event.journalEntry?.title ?? event.project?.name ?? event.tag?.name ?? event.artifact?.title ?? "Workspace"}</span>
        <p>{event.summary}</p>
      </article>)}
      {!events.length && <div className="emptyPanel">No activity matches these filters.</div>}
    </div>
  </section>;
}
