import type { ProjectSummary, RunSnapshot, RunSummary } from "@/lib/platform-types";

/**
 * Browser-local UI cache for fast rendering.
 * Never stores or transmits a user/workspace ID as an authentication credential;
 * workspace identity is enforced exclusively by the server's HttpOnly signed `pn_uid` cookie.
 */
const LOCAL_WORKSPACE_CACHE_KEY = "polinote:workspace:cache:v2";

export const DEFAULT_LOCAL_PROJECT_ID = "proj_general_policy";

export function createDefaultLocalProject(): ProjectSummary {
  const ts = new Date().toISOString();
  return {
    id: DEFAULT_LOCAL_PROJECT_ID,
    title: "Policy Research Studio",
    description:
      "Primary workspace for policy digressions, empirical FRED series, statutory text, and synthesized briefs.",
    contextMemo:
      "Prioritize empirical identification, supply-chain incidence, and statutory constraints across runs in this project.",
    createdAt: ts,
    updatedAt: ts,
  };
}

export type LocalWorkspaceState = {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  runs: RunSummary[];
  snapshots: Record<string, RunSnapshot>;
};

export function loadLocalWorkspace(): LocalWorkspaceState {
  const fallbackProject = createDefaultLocalProject();
  const empty: LocalWorkspaceState = {
    projects: [fallbackProject],
    activeProjectId: fallbackProject.id,
    runs: [],
    snapshots: {},
  };
  if (typeof window === "undefined") return empty;

  try {
    // Purge legacy localStorage user_id key if present from older builds
    window.localStorage.removeItem("polinote:user_id");

    const raw = window.localStorage.getItem(LOCAL_WORKSPACE_CACHE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<LocalWorkspaceState> | null;
    if (!parsed || typeof parsed !== "object") return empty;

    const projects = Array.isArray(parsed.projects)
      ? parsed.projects.filter(
          (p): p is ProjectSummary =>
            Boolean(p && typeof p.id === "string" && typeof p.title === "string"),
        )
      : [];
    const normalizedProjects = projects.length > 0 ? projects : [fallbackProject];
    const runs = Array.isArray(parsed.runs)
      ? parsed.runs.filter(
          (r): r is RunSummary =>
            Boolean(r && typeof r.id === "string" && typeof r.title === "string"),
        )
      : [];
    const snapshots =
      parsed.snapshots && typeof parsed.snapshots === "object"
        ? (parsed.snapshots as Record<string, RunSnapshot>)
        : {};
    const activeProjectId =
      typeof parsed.activeProjectId === "string" &&
      normalizedProjects.some((p) => p.id === parsed.activeProjectId)
        ? parsed.activeProjectId
        : normalizedProjects[0]?.id ?? null;

    return {
      projects: normalizedProjects,
      activeProjectId,
      runs,
      snapshots,
    };
  } catch {
    return empty;
  }
}

export function saveLocalWorkspace(state: LocalWorkspaceState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LOCAL_WORKSPACE_CACHE_KEY,
      JSON.stringify(state),
    );
  } catch {
    /* ignore quota errors */
  }
}

export function mergeProjects(
  local: ProjectSummary[],
  remote: ProjectSummary[],
): ProjectSummary[] {
  const map = new Map<string, ProjectSummary>();
  for (const item of remote) {
    if (item && typeof item.id === "string") {
      map.set(item.id, item);
    }
  }
  for (const item of local) {
    if (!item || typeof item.id !== "string") continue;
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else if (item.updatedAt > existing.updatedAt) {
      map.set(item.id, item);
    }
  }
  const merged = [...map.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  return merged.length > 0 ? merged : [createDefaultLocalProject()];
}

export function mergeRuns(
  local: RunSummary[],
  remote: RunSummary[],
): RunSummary[] {
  const map = new Map<string, RunSummary>();
  for (const item of remote) {
    if (item && typeof item.id === "string") {
      map.set(item.id, item);
    }
  }
  for (const item of local) {
    if (!item || typeof item.id !== "string") continue;
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else if (item.updatedAt > existing.updatedAt) {
      map.set(item.id, item);
    }
  }
  return [...map.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}
