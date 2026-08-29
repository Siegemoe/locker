"use client";

import type { FormEvent } from "react";
import type { Project, Tag } from "./workspace-view";

type ManageSectionProps = {
  workspaceId: string;
  projects: Project[];
  tags: Tag[];
  busy: boolean;
  onMutate: (path: string, method: "POST" | "PATCH", body: unknown) => void;
};

export function ManageSection({ workspaceId, projects, tags, busy, onMutate }: ManageSectionProps) {
  const activeProjects = projects.filter((project) => !project.archivedAt);

  function submit(event: FormEvent<HTMLFormElement>, path: string, method: "POST" | "PATCH", build: (form: FormData) => unknown) {
    event.preventDefault();
    void onMutate(path, method, build(new FormData(event.currentTarget)));
  }

  return <section className="managementPage">
    <div className="pageIntro"><p className="eyebrow">WORKSPACE STRUCTURE</p><h1>Projects and tags</h1><p>Projects organize work; tags describe it. Archiving hides a filter without breaking task history.</p></div>
    <div className="managerGrid">
      <section className="managerPanel">
        <div className="managerHead"><div><h2>Projects</h2><p>Delete is available only when no tasks reference the project.</p></div><span>{activeProjects.length} active</span></div>
        <form className="quickCreate" onSubmit={(event) => submit(event, `/api/workspaces/${workspaceId}/projects`, "POST", (form) => ({ key: form.get("key"), name: form.get("name"), color: form.get("color") }))}>
          <input name="key" required maxLength={12} placeholder="KEY" />
          <input name="name" required maxLength={100} placeholder="Project name" />
          <input name="color" type="color" defaultValue="#c5f779" aria-label="Project color" />
          <button disabled={busy}>Add project</button>
        </form>
        <div className="managerList">{projects.map((project) => <form className={`managerItem ${project.archivedAt ? "archived" : ""}`} key={project.id} onSubmit={(event) => submit(event, `/api/projects/${project.id}`, "PATCH", (form) => ({ key: form.get("key"), name: form.get("name"), color: form.get("color") }))}>
          <input name="key" defaultValue={project.key} maxLength={12} required />
          <input name="name" defaultValue={project.name} maxLength={100} required />
          <input name="color" type="color" defaultValue={project.color ?? "#768075"} aria-label={`${project.name} color`} />
          <span className="managerState">{project.archivedAt ? "Archived" : "Active"}</span>
          <button disabled={busy}>Save</button>
          {!project.archivedAt && <button type="button" className="quietDanger" disabled={busy} onClick={() => void onMutate(`/api/projects/${project.id}`, "POST", { action: "archive" })}>Archive</button>}
          {project.archivedAt && <button type="button" className="restoreAction" disabled={busy} onClick={() => void onMutate(`/api/projects/${project.id}`, "POST", { action: "restore" })}>Restore</button>}
          <button type="button" className="quietDanger" disabled={busy} onClick={() => void onMutate(`/api/projects/${project.id}`, "POST", { action: "delete" })}>Delete empty</button>
        </form>)}</div>
      </section>

      <section className="managerPanel">
        <div className="managerHead"><div><h2>Tags</h2><p>Task labels are explicit, reusable, and support multiple values.</p></div><span>{tags.length} active</span></div>
        <form className="quickCreate tagCreate" onSubmit={(event) => submit(event, `/api/workspaces/${workspaceId}/tags`, "POST", (form) => ({ name: form.get("name"), color: form.get("color") }))}>
          <input name="name" required maxLength={40} placeholder="Tag name" />
          <input name="color" type="color" defaultValue="#8ec6ff" aria-label="Tag color" />
          <button disabled={busy}>Add tag</button>
        </form>
        <div className="managerList">{tags.map((tag) => <form className="managerItem tagItem" key={tag.id} onSubmit={(event) => submit(event, `/api/tags/${tag.id}`, "PATCH", (form) => ({ name: form.get("name"), color: form.get("color") }))}>
          <input name="name" defaultValue={tag.name} maxLength={40} required />
          <input name="color" type="color" defaultValue={tag.color ?? "#718266"} aria-label={`${tag.name} color`} />
          <button disabled={busy}>Save</button>
          <button type="button" className="quietDanger" disabled={busy} onClick={() => void onMutate(`/api/tags/${tag.id}`, "POST", { action: "archive" })}>Archive</button>
        </form>)}</div>
      </section>
    </div>
  </section>;
}
