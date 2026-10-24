import { asJson, mutateUserDb, queryRows, withUserDb } from "@/lib/db/user-store";
import type { ProjectSummary } from "@/lib/platform-types";
import type { DigressionNode } from "@/schemas/digression";

export const DEFAULT_PROJECT_ID = "proj_general_policy";

function nowIso(): string {
  return new Date().toISOString();
}

type ProjectRow = {
  id: string;
  title: string;
  description: string;
  context_memo: string;
  created_at: string;
  updated_at: string;
};

function mapProjectRow(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    contextMemo: row.context_memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureDefaultProject(userId: string): Promise<ProjectSummary> {
  const existing = await withUserDb(userId, async (connection) => {
    const rows = await queryRows<ProjectRow>(
      connection,
      `SELECT id, title, description, context_memo, created_at, updated_at
       FROM projects
       ORDER BY updated_at DESC`,
    );
    const orphans = await queryRows<{ cnt: number }>(
      connection,
      `SELECT COUNT(*) AS cnt FROM runs WHERE project_id IS NULL OR project_id = ''`,
    );
    return {
      projects: rows.map(mapProjectRow),
      orphanCount: Number(orphans[0]?.cnt ?? 0),
    };
  });

  if (existing.projects.length > 0 && existing.orphanCount === 0) {
    return existing.projects[0]!;
  }

  const ts = nowIso();
  const targetProject: ProjectSummary = existing.projects[0] ?? {
    id: DEFAULT_PROJECT_ID,
    title: "Policy Research Studio",
    description:
      "Primary workspace for policy digressions, empirical FRED series, statutory text, and synthesized briefs.",
    contextMemo:
      "Prioritize empirical identification, supply-chain incidence, and statutory constraints across runs in this project.",
    createdAt: ts,
    updatedAt: ts,
  };

  await mutateUserDb(userId, async (connection) => {
    if (existing.projects.length === 0) {
      await connection.run(
        `INSERT OR IGNORE INTO projects (id, title, description, context_memo, created_at, updated_at)
         VALUES ($id, $title, $description, $context_memo, $created_at, $updated_at)`,
        {
          id: targetProject.id,
          title: targetProject.title,
          description: targetProject.description,
          context_memo: targetProject.contextMemo,
          created_at: targetProject.createdAt,
          updated_at: targetProject.updatedAt,
        },
      );
    }
    if (existing.orphanCount > 0) {
      await connection.run(
        `UPDATE runs SET project_id = $project_id WHERE project_id IS NULL OR project_id = ''`,
        { project_id: targetProject.id },
      );
    }
  });

  return targetProject;
}

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  await ensureDefaultProject(userId);
  return withUserDb(userId, async (connection) => {
    const rows = await queryRows<ProjectRow>(
      connection,
      `SELECT id, title, description, context_memo, created_at, updated_at
       FROM projects
       ORDER BY updated_at DESC`,
    );
    return rows.map(mapProjectRow);
  });
}

export async function getProject(
  userId: string,
  projectId: string,
): Promise<ProjectSummary | null> {
  await ensureDefaultProject(userId);
  return withUserDb(userId, async (connection) => {
    const rows = await queryRows<ProjectRow>(
      connection,
      `SELECT id, title, description, context_memo, created_at, updated_at
       FROM projects
       WHERE id = $id`,
      { id: projectId },
    );
    return rows[0] ? mapProjectRow(rows[0]) : null;
  });
}

const PROJECT_ID_RE = /^proj_[a-zA-Z0-9_-]{4,48}$/;

export async function createProject(
  userId: string,
  input?: {
    id?: string;
    title?: string;
    description?: string;
    contextMemo?: string;
  },
): Promise<ProjectSummary> {
  await ensureDefaultProject(userId);
  const ts = nowIso();
  const candidateId = input?.id?.trim() ?? "";
  const project: ProjectSummary = {
    id: PROJECT_ID_RE.test(candidateId)
      ? candidateId
      : `proj_${crypto.randomUUID().slice(0, 12)}`,
    title: input?.title?.trim() || "Untitled project",
    description:
      input?.description?.trim() ||
      "Shared policy workspace holding related runs, evidence spans, and synthesized reports.",
    contextMemo: input?.contextMemo?.trim() || "",
    createdAt: ts,
    updatedAt: ts,
  };

  await mutateUserDb(userId, async (connection) => {
    await connection.run(
      `INSERT OR REPLACE INTO projects (id, title, description, context_memo, created_at, updated_at)
       VALUES ($id, $title, $description, $context_memo, $created_at, $updated_at)`,
      {
        id: project.id,
        title: project.title,
        description: project.description,
        context_memo: project.contextMemo,
        created_at: project.createdAt,
        updated_at: project.updatedAt,
      },
    );
  });

  return project;
}

export async function updateProject(
  userId: string,
  projectId: string,
  input: { title?: string; description?: string; contextMemo?: string },
): Promise<ProjectSummary | null> {
  const current = await getProject(userId, projectId);
  const ts = nowIso();
  if (!current) {
    return createProject(userId, {
      id: projectId,
      title: input.title,
      description: input.description,
      contextMemo: input.contextMemo,
    });
  }
  const next: ProjectSummary = {
    ...current,
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : current.title,
    description:
      typeof input.description === "string" ? input.description.trim() : current.description,
    contextMemo:
      typeof input.contextMemo === "string" ? input.contextMemo.trim() : current.contextMemo,
    updatedAt: ts,
  };

  await mutateUserDb(userId, async (connection) => {
    await connection.run(
      `UPDATE projects
       SET title = $title, description = $description, context_memo = $context_memo, updated_at = $updated_at
       WHERE id = $id`,
      {
        id: projectId,
        title: next.title,
        description: next.description,
        context_memo: next.contextMemo,
        updated_at: ts,
      },
    );
  });

  return next;
}

export async function deleteProject(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const current = await getProject(userId, projectId);
  if (!current) return false;

  await mutateUserDb(userId, async (connection) => {
    const runRows = await queryRows<{ id: string }>(
      connection,
      `SELECT id FROM runs WHERE project_id = $project_id`,
      { project_id: projectId },
    );
    for (const row of runRows) {
      await connection.run(`DELETE FROM messages WHERE run_id = $id`, { id: row.id });
      await connection.run(`DELETE FROM nodes WHERE run_id = $id`, { id: row.id });
      await connection.run(`DELETE FROM edges WHERE run_id = $id`, { id: row.id });
      await connection.run(`DELETE FROM analyses WHERE run_id = $id`, { id: row.id });
      await connection.run(`DELETE FROM scopes WHERE run_id = $id`, { id: row.id });
      await connection.run(`DELETE FROM drafts WHERE run_id = $id`, { id: row.id });
      await connection.run(`DELETE FROM memos WHERE run_id = $id`, { id: row.id });
      await connection.run(`DELETE FROM events WHERE run_id = $id`, { id: row.id });
      await connection.run(`DELETE FROM runs WHERE id = $id`, { id: row.id });
    }
    await connection.run(`DELETE FROM projects WHERE id = $id`, { id: projectId });
  });

  await ensureDefaultProject(userId);
  return true;
}

export async function getProjectContextDigest(
  userId: string,
  projectId: string | undefined,
  excludeRunId?: string,
): Promise<string> {
  if (!projectId) return "";
  return withUserDb(userId, async (connection) => {
    const projects = await queryRows<ProjectRow>(
      connection,
      `SELECT id, title, description, context_memo, created_at, updated_at
       FROM projects WHERE id = $id`,
      { id: projectId },
    );
    const project = projects[0];
    if (!project) return "";

    const siblingRuns = await queryRows<{ id: string; title: string }>(
      connection,
      `SELECT id, title FROM runs WHERE project_id = $project_id ORDER BY updated_at DESC LIMIT 6`,
      { project_id: projectId },
    );
    const otherRunIds = siblingRuns
      .map((r) => r.id)
      .filter((id) => id !== excludeRunId);

    const priorFindings: string[] = [];
    for (const rId of otherRunIds.slice(0, 4)) {
      const nodeRows = await queryRows<{ data: unknown }>(
        connection,
        `SELECT data FROM nodes WHERE run_id = $id`,
        { id: rId },
      );
      const nodes = nodeRows
        .map((row) => asJson<DigressionNode>(row.data))
        .filter((n) => n.status === "supported" || n.kind === "claim" || n.kind === "incidence")
        .slice(0, 3);
      for (const n of nodes) {
        priorFindings.push(`[${n.kind}/${n.status}] ${n.title}: ${n.body.slice(0, 140)}`);
      }
    }

    const parts = [
      `Project: ${project.title}`,
      project.description ? `Description: ${project.description}` : "",
      project.context_memo ? `Project Instructions / Memo: ${project.context_memo}` : "",
      priorFindings.length > 0
        ? `Prior Project Findings:\n${priorFindings.slice(0, 8).join("\n")}`
        : "",
    ].filter(Boolean);

    return parts.join("\n");
  });
}
