"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type DescriptionSection = { id: string; title: string; level: number; body: string };

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

export function TaskDescription({ description }: { description: string | null }) {
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
