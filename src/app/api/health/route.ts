import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/db";
import { toTypedApiError, validateStartupEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ServiceHealth = {
  service: string;
  configured: boolean;
  reachable: boolean;
  latencyMs: number;
  status: "healthy" | "degraded" | "unconfigured" | "unreachable";
  detail: string;
};

async function probeEndpoint(
  service: string,
  configured: boolean,
  url: string,
  init?: RequestInit,
  requiresKey = true,
): Promise<ServiceHealth> {
  const start = Date.now();
  if (requiresKey && !configured) {
    return {
      service,
      configured: false,
      reachable: false,
      latencyMs: 0,
      status: "unconfigured",
      detail: `Data unavailable: ${service} API key not configured in environment`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return {
        service,
        configured,
        reachable: true,
        latencyMs,
        status: "healthy",
        detail: `HTTP ${res.status} OK (${latencyMs}ms)`,
      };
    }
    return {
      service,
      configured,
      reachable: false,
      latencyMs,
      status: "degraded",
      detail: `Data unavailable: ${service} returned HTTP ${res.status}`,
    };
  } catch (error) {
    const typed = toTypedApiError(error, service);
    return {
      service,
      configured,
      reachable: false,
      latencyMs: Date.now() - start,
      status: "unreachable",
      detail: typed.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deep = url.searchParams.get("probe") !== "0";
  const envSummary = validateStartupEnv();
  const dbHealth = await checkDatabaseHealth();

  const fredKey = process.env.FRED_API_KEY?.trim() ?? "";
  const beaKey = process.env.BEA_API_KEY?.trim() ?? "";
  const blsKey = process.env.BLS_API_KEY?.trim() ?? "";
  const censusKey = process.env.CENSUS_API_KEY?.trim() ?? "";
  const openaiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const gatewayKey =
    process.env.AI_GATEWAY_API_KEY?.trim() ||
    process.env.VERCEL_OIDC_TOKEN?.trim() ||
    "";
  const pythonUrl = process.env.PYTHON_ECONOMETRICS_URL?.trim() ?? "";

  const probes: Record<string, ServiceHealth> = {
    db: {
      service: "db",
      configured: dbHealth.configured || true,
      reachable: dbHealth.reachable,
      latencyMs: dbHealth.latencyMs,
      status: dbHealth.reachable ? "healthy" : "unreachable",
      detail: dbHealth.message,
    },
  };

  if (deep) {
    const [fred, bea, bls, census, openalex, worldbank, openai, pythonSvc] =
      await Promise.all([
        probeEndpoint(
          "fred",
          Boolean(fredKey),
          `https://api.stlouisfed.org/fred/series?series_id=GDPC1&file_type=json&api_key=${encodeURIComponent(fredKey)}`,
          undefined,
          true,
        ),
        probeEndpoint(
          "bea",
          Boolean(beaKey),
          `https://apps.bea.gov/api/data/?UserID=${encodeURIComponent(beaKey)}&method=GetDataSetList&ResultFormat=JSON`,
          undefined,
          true,
        ),
        probeEndpoint(
          "bls",
          Boolean(blsKey),
          "https://api.bls.gov/publicAPI/v2/surveys",
          undefined,
          false,
        ),
        probeEndpoint(
          "census",
          Boolean(censusKey),
          `https://api.census.gov/data/2022/acs/acs1?get=NAME&for=us:1${censusKey ? `&key=${encodeURIComponent(censusKey)}` : ""}`,
          undefined,
          false,
        ),
        probeEndpoint(
          "openalex",
          true,
          "https://api.openalex.org/works?per_page=1",
          {
            headers: {
              "User-Agent": "PoliNote/2.0 (mailto:research@polinote.org)",
            },
          },
          false,
        ),
        probeEndpoint(
          "worldbank",
          true,
          "https://api.worldbank.org/v2/country/USA?format=json",
          undefined,
          false,
        ),
        openaiKey
          ? probeEndpoint(
              "openai",
              true,
              "https://api.openai.com/v1/models",
              {
                headers: { Authorization: `Bearer ${openaiKey}` },
              },
              true,
            )
          : probeEndpoint(
              "openai",
              Boolean(gatewayKey),
              "https://ai-gateway.vercel.sh/v1/models",
              gatewayKey
                ? { headers: { Authorization: `Bearer ${gatewayKey}` } }
                : undefined,
              true,
            ),
        pythonUrl
          ? probeEndpoint(
              "python_econometrics",
              true,
              pythonUrl,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  specId: "health_probe",
                  method: "descriptive_newey_west",
                  outcomeSeriesId: "PROBE",
                  outcomeTitle: "Probe",
                  outcomeUnits: "Units",
                  observations: Array.from({ length: 10 }, (_, i) => ({
                    date: `2020-0${(i % 9) + 1}-01`,
                    value: 100 + i,
                  })),
                }),
              },
              true,
            )
          : Promise.resolve<ServiceHealth>({
              service: "python_econometrics",
              configured: false,
              reachable: false,
              latencyMs: 0,
              status: "unconfigured",
              detail:
                "PYTHON_ECONOMETRICS_URL not configured; using built-in TypeScript Newey–West HAC & Simplex engine.",
            }),
      ]);

    probes.fred = fred;
    probes.bea = bea;
    probes.bls = bls;
    probes.census = census;
    probes.openalex = openalex;
    probes.worldbank = worldbank;
    probes.openai = openai;
    probes.python_econometrics = pythonSvc;
  } else {
    probes.fred = {
      service: "fred",
      configured: Boolean(fredKey),
      reachable: Boolean(fredKey),
      latencyMs: 0,
      status: fredKey ? "healthy" : "unconfigured",
      detail: fredKey ? "FRED_API_KEY configured" : "FRED_API_KEY not set",
    };
    probes.bea = {
      service: "bea",
      configured: Boolean(beaKey),
      reachable: Boolean(beaKey),
      latencyMs: 0,
      status: beaKey ? "healthy" : "unconfigured",
      detail: beaKey ? "BEA_API_KEY configured" : "BEA_API_KEY not set",
    };
    probes.bls = {
      service: "bls",
      configured: Boolean(blsKey),
      reachable: true,
      latencyMs: 0,
      status: blsKey ? "healthy" : "degraded",
      detail: blsKey
        ? "BLS_API_KEY configured (v2 higher quota)"
        : "BLS public v2 active (no key)",
    };
    probes.census = {
      service: "census",
      configured: Boolean(censusKey),
      reachable: true,
      latencyMs: 0,
      status: censusKey ? "healthy" : "degraded",
      detail: censusKey
        ? "CENSUS_API_KEY configured"
        : "Census public endpoint active (no key)",
    };
    probes.openalex = {
      service: "openalex",
      configured: true,
      reachable: true,
      latencyMs: 0,
      status: "healthy",
      detail: "OpenAlex public API enabled",
    };
    probes.openai = {
      service: "openai",
      configured: Boolean(openaiKey || gatewayKey),
      reachable: Boolean(openaiKey || gatewayKey),
      latencyMs: 0,
      status: openaiKey || gatewayKey ? "healthy" : "unconfigured",
      detail:
        openaiKey || gatewayKey
          ? "LLM credentials configured"
          : "OPENAI_API_KEY not set",
    };
    probes.python_econometrics = {
      service: "python_econometrics",
      configured: Boolean(pythonUrl),
      reachable: Boolean(pythonUrl),
      latencyMs: 0,
      status: pythonUrl ? "healthy" : "unconfigured",
      detail: pythonUrl
        ? "PYTHON_ECONOMETRICS_URL configured"
        : "PYTHON_ECONOMETRICS_URL not set (built-in TS engine active)",
    };
  }

  return NextResponse.json({
    ok: envSummary.valid && dbHealth.reachable,
    timestamp: new Date().toISOString(),
    env: {
      valid: envSummary.valid,
      issues: envSummary.issues,
      warnings: envSummary.warnings,
      configured: envSummary.configured,
    },
    services: probes,
  });
}
