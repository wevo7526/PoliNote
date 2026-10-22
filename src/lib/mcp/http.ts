export function redactSecrets(value: string): string {
  return value
    .replace(/([?&](?:api[_-]?key|token|key|secret)=)[^&\s"']+/gi, "$1redacted")
    .replace(/\b((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,&"']+/gi, "$1redacted")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer redacted")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "sk-redacted")
    .replace(/\bfc-[A-Za-z0-9_-]{12,}/g, "fc-redacted")
    .replace(/\bvercel_blob_rw_[A-Za-z0-9_-]+/g, "vercel_blob_rw_redacted")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "jwt-redacted")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://redacted");
}

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
      const safeDetail = detail ? redactSecrets(detail) : "";
      throw new Error(
        safeDetail ? `HTTP ${response.status}: ${safeDetail}` : `HTTP ${response.status}`,
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error) {
      error.message = redactSecrets(error.message);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
