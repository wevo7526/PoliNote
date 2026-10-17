export async function getJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? 9000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      let detail = "";
      try {
        const errBody = (await response.json()) as {
          error_message?: string;
          message?: string;
          error?: string;
        };
        detail = errBody.error_message || errBody.message || errBody.error || "";
      } catch {
        /* ignore non-json error body */
      }
      throw new Error(
        detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
