import { db } from "@/lib/db";
import Workspace from "./workspace";

export const dynamic = "force-dynamic";

export default async function Home() {
  const workspace = await db.workspace.findUnique({
    where: { slug: "spore-locker" },
    include: {
      projects: { orderBy: [{ archivedAt: "asc" }, { name: "asc" }] },
      tags: { where: { archivedAt: null }, orderBy: { name: "asc" } },
      tasks: {
        where: { archivedAt: null },
        include: {
          project: { select: { id: true, key: true, name: true } },
          tags: { include: { tag: true }, orderBy: { createdAt: "asc" } },
          artifacts: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
          activities: { orderBy: { createdAt: "desc" }, take: 30 }
        },
        orderBy: [{ position: "asc" }, { createdAt: "desc" }]
      }
    }
  });

  if (!workspace) {
    return <main className="emptyState"><h1>Spore Locker needs its seed data.</h1><p>Run the local database setup, then refresh.</p></main>;
  }

  return <Workspace initialWorkspace={JSON.parse(JSON.stringify(workspace))} />;
}
