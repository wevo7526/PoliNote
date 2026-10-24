import type { ProjectSummary, RunSnapshot, RunSummary } from "@/lib/platform-types";

export const USER_HEADER = "x-polinote-user";
const LOCAL_USER_ID_KEY = "polinote:user_id";
const LOCAL_WORKSPACE_PREFIX = "polinote:workspace:v1:";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_LOCAL_PROJECT_ID = "proj_general_policy";

export function isValidUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

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

export function getOrCreateLocalUserId(): string {
  if (typeof window === "undefined") {
    return "00000000-0000-4000-8000-000000000000";
  }
  try {
    const existing = window.localStorage.getItem(LOCAL_USER_ID_KEY)?.trim();
    if (isValidUuid(existing)) {
      return existing;
    }
    const created = crypto.randomUUID();
    window.localStorage.setItem(LOCAL_USER_ID_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function setLocalUserId(userId: string): void {
  if (typeof window === "undefined" || !isValidUuid(userId)) return;
  try {
    window.localStorage.setItem(LOCAL_USER_ID_KEY, userId.trim());
  } catch {
    /* ignore storage errors */
  }
}

export type LocalWorkspaceState = {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  runs: RunSummary[];
  snapshots: Record<string, RunSnapshot>;
};

export function loadLocalWorkspace(userId: string): LocalWorkspaceState {
  const fallbackProject = createDefaultLocalProject();
  const empty: LocalWorkspaceState = {
    projects: [fallbackProject],
    activeProjectId: fallbackProject.id,
    runs: [],
    snapshots: {},
  };
  if (typeof window === "undefined" || !userId) return empty;

  try {
    const raw = window.localStorage.getItem(`${LOCAL_WORKSPACE_PREFIX}${userId}`);
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

export function saveLocalWorkspace(
  userId: string,
  state: LocalWorkspaceState,
): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(
      `${LOCAL_WORKSPACE_PREFIX}${userId}`,
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
