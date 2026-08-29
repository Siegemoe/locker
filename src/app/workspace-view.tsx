/**
 * The shared presentation vocabulary of the workspace view: the wire types the
 * UI reads, the formatters, and the display labels every task surface agrees
 * on. Components live beside the concept they render; this module only holds
 * what more than one of them needs.
 */

export type Activity = { id: string; actorType: string; actorLabel: string; action: string; summary: string; createdAt: string };
export type Project = { id: string; key: string; name: string; description: string | null; color: string | null; status: string; archivedAt: string | null };
export type Tag = { id: string; name: string; color: string | null; archivedAt?: string | null };
export type Artifact = { id: string; kind: "LINK" | "TEXT" | "FILE_METADATA"; title: string; url: string | null; textContent: string | null; fileName: string | null; mimeType: string | null; sizeBytes: number | null };
export type Task = {
  id: string; title: string; description: string | null; status: string; priority: string;
  createdBy: string | null; version: number; createdAt: string; updatedAt: string;
  completedAt: string | null; approvedAt: string | null; approvedBy: string | null;
  archivedAt: string | null; project: { id: string; key: string; name: string } | null; activities: Activity[];
  tags: { tag: Tag }[]; artifacts: Artifact[];
};
export type WorkspaceData = { id: string; name: string; projects: Project[]; tags: Tag[]; tasks: Task[] };
export type WorkspaceActivity = Activity & {
  project: { id: string; key: string; name: string } | null;
  task: { id: string; title: string } | null;
  tag: { id: string; name: string } | null;
  artifact: { id: string; title: string; kind: string } | null;
  journalEntry: { id: string; entryDate: string; title: string } | null;
  journalContribution: { id: string; authorLabel: string } | null;
  journalCandidate: { id: string; summary: string; kind: string } | null;
};
export type GroupKey = "status" | "classification" | "project" | "none";
export type DialogMode = "detail" | "edit";

export const stages = [
  ["BACKLOG", "Inbox"], ["READY", "Ready"], ["IN_PROGRESS", "In progress"],
  ["BLOCKED", "Blocked"], ["DONE", "Complete"], ["CANCELED", "Canceled"]
] as const;
export const classificationOrder = ["Feature", "UI / UX", "Security", "MCP", "Bug", "Subagent", "Task"];
export const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric" });
export const dateTimeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
export const numberFormatter = new Intl.NumberFormat("en-US");

export function classification(task: Task) {
  return task.tags[0]?.tag.name ?? "Untagged";
}

export function statusLabel(status: string) {
  return stages.find(([value]) => value === status)?.[1] ?? status;
}

export function groupValue(task: Task, key: GroupKey) {
  if (key === "status") return statusLabel(task.status);
  if (key === "classification") return classification(task);
  if (key === "project") return task.project?.key ?? "Unsorted";
  return "All work";
}

export function taskProgress(task: Task) {
  if (task.archivedAt) return "Archived";
  if (task.approvedAt) return "Approved";
  if (task.status === "DONE") return "Awaiting approval";
  if (task.status === "BLOCKED") return "Needs a decision";
  if (task.status === "IN_PROGRESS") return "Work is moving";
  return task.activities.length ? `${task.activities.length} logged changes` : "Newly captured";
}

export function plainTaskPreview(description: string | null) {
  if (!description) return "Open this card to review the work and define the outcome.";
  return description
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_~`>|]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The tag badge row — the card and the dialog render the exact same one. */
export function TagBadges({ tags }: { tags: { tag: Tag }[] }) {
  return <>{tags.length ? tags.map(({ tag }) => <span className="typeBadge" style={{ "--tag": tag.color ?? "#718266" } as React.CSSProperties} key={tag.id}>{tag.name}</span>) : <span className="typeBadge">Untagged</span>}</>;
}
