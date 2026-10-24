import { fetchLiveJsonWithSnapshot } from "./cache";
import { alfredProvider, fredProvider } from "./fred";
import {
  DataUnavailableError,
  type DataProviderId,
  type FetchedSeriesBundle,
  type LiveDataProvider,
  type ObservationPoint,
  type ObservationsQuery,
  type SeriesMetadata,
} from "./types";

/**
 * Bureau of Economic Analysis (BEA) live provider (NIPA, FixedAssets, Regional).
 * Requires BEA_API_KEY. Fails visibly when key is absent.
 */
export class BeaDataProvider implements LiveDataProvider {
  readonly id = "bea" as const;
  readonly displayName = "U.S. Bureau of Economic Analysis (BEA NIPA / Fixed Assets / Regional)";

  private apiKey(): string {
    const key = process.env.BEA_API_KEY?.trim() ?? "";
    if (!key) {
      throw new DataUnavailableError(
        "bea",
        "BEA_API_KEY is not configured in the environment",
      );
    }
    return key;
  }

  isConfigured(): boolean {
    return Boolean(process.env.BEA_API_KEY?.trim());
  }

  async search(query: string, limit = 8): Promise<SeriesMetadata[]> {
    const key = this.apiKey();
    const url = `https://apps.bea.gov/api/data/?UserID=${encodeURIComponent(key)}&method=GetParameterValues&datasetname=NIPA&ParameterName=TableName&ResultFormat=JSON`;
    const { data } = await fetchLiveJsonWithSnapshot<{
      BEAAPI?: {
        Results?: {
          ParamValue?: Array<{ TableName?: string; Description?: string }>;
        };
      };
    }>({
      provider: "bea",
      seriesId: "NIPA_TableList",
      url,
    });

    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3);
    const tables = data.BEAAPI?.Results?.ParamValue ?? [];
    const matched = tables
      .filter((t) => {
        const desc = (t.Description ?? "").toLowerCase();
        return tokens.length === 0 || tokens.some((tok) => desc.includes(tok));
      })
      .slice(0, limit);

    return matched.map((row) => {
      const tableId = row.TableName ?? "T10101";
      return {
        provider: "bea",
        id: `NIPA:${tableId}`,
        title: row.Description ?? `BEA NIPA ${tableId}`,
        units: "Chained / Current Dollars (BEA NIPA)",
        frequency: "Quarterly",
        frequencyShort: "q",
        seasonalAdjustment: "Seasonally Adjusted Annual Rate",
        observationStart: "1947-01-01",
        observationEnd: new Date().toISOString().slice(0, 10),
        lastUpdated: new Date().toISOString(),
        discontinued: false,
        copyrightedThirdParty: false,
        licenseAttribution:
          "U.S. Bureau of Economic Analysis (BEA), Department of Commerce — Public Domain.",
        sourceUrl: "https://apps.bea.gov/iTable/",
      };
    });
  }

  async metadata(id: string): Promise<SeriesMetadata> {
    this.apiKey();
    const clean = id.replace(/^NIPA:/i, "").trim();
    return {
      provider: "bea",
      id: `NIPA:${clean}`,
      title: `BEA NIPA Table ${clean}`,
      units: "Index / Billions of Dollars",
      frequency: "Quarterly",
      frequencyShort: "q",
      seasonalAdjustment: "Seasonally Adjusted",
      observationStart: "1990-01-01",
      observationEnd: new Date().toISOString().slice(0, 10),
      lastUpdated: new Date().toISOString(),
      discontinued: false,
      copyrightedThirdParty: false,
      licenseAttribution:
        "U.S. Bureau of Economic Analysis (BEA), Department of Commerce — Public Domain.",
      sourceUrl: "https://apps.bea.gov/iTable/",
    };
  }

  async observations(
    id: string,
    options: ObservationsQuery = {},
  ): Promise<FetchedSeriesBundle> {
    const key = this.apiKey();
    const parts = id.replace(/^NIPA:/i, "").split(":");
    const tableName = parts[0] || "T10105";
    const lineNumber = parts[1] || "1";
    const frequency = (options.frequency ?? "Q").toUpperCase();
    const url = `https://apps.bea.gov/api/data/?UserID=${encodeURIComponent(key)}&method=GetData&datasetname=NIPA&TableName=${encodeURIComponent(tableName)}&Frequency=${encodeURIComponent(frequency)}&Year=ALL&ResultFormat=JSON`;

    const { data, snapshot } = await fetchLiveJsonWithSnapshot<{
      BEAAPI?: {
        Results?: {
          Data?: Array<{
            TableName?: string;
            SeriesCode?: string;
            LineNumber?: string;
            LineDescription?: string;
            TimePeriod?: string;
            DataValue?: string;
            UNIT_MULT?: string;
          }>;
        };
      };
    }>({
      provider: "bea",
      seriesId: id,
      url,
    });

    const rows = (data.BEAAPI?.Results?.Data ?? []).filter(
      (r) => !lineNumber || r.LineNumber === lineNumber,
    );
    if (rows.length === 0) {
      throw new DataUnavailableError(
        "bea",
        `No observations returned for BEA NIPA ${tableName} line ${lineNumber}`,
      );
    }

    const toIsoDate = (tp: string): string => {
      const qMatch = tp.match(/^(\d{4})Q([1-4])$/i);
      if (qMatch) {
        const month = String((Number(qMatch[2]) - 1) * 3 + 1).padStart(2, "0");
        return `${qMatch[1]}-${month}-01`;
      }
      if (/^\d{4}$/.test(tp)) return `${tp}-01-01`;
      return tp;
    };

    const observations: ObservationPoint[] = rows
      .map((r) => ({
        date: toIsoDate(r.TimePeriod ?? ""),
        value: Number.parseFloat((r.DataValue ?? "").replace(/,/g, "")),
      }))
      .filter((pt) => pt.date && Number.isFinite(pt.value))
      .filter(
        (pt) =>
          (!options.start || pt.date >= options.start) &&
          (!options.end || pt.date <= options.end),
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    if (observations.length === 0) {
      throw new DataUnavailableError(
        "bea",
        `BEA ${id} returned 0 observations inside the requested window`,
      );
    }

    const firstRow = rows[0]!;
    const title = firstRow.LineDescription
      ? `BEA NIPA ${tableName} L${lineNumber}: ${firstRow.LineDescription}`
      : `BEA NIPA ${tableName}`;
    const metadata: SeriesMetadata = {
      provider: "bea",
      id,
      title,
      units: "BEA Reported Units",
      frequency: frequency === "Q" ? "Quarterly" : "Annual",
      frequencyShort: frequency === "Q" ? "q" : "a",
      seasonalAdjustment: "Seasonally Adjusted",
      observationStart: observations[0]!.date,
      observationEnd: observations[observations.length - 1]!.date,
      lastUpdated: snapshot.retrievedAt,
      discontinued: false,
      copyrightedThirdParty: false,
      licenseAttribution:
        "U.S. Bureau of Economic Analysis (BEA), Department of Commerce — Public Domain.",
      sourceUrl: "https://apps.bea.gov/iTable/",
    };

    return {
      metadata,
      observations,
      provenance: {
        source: "bea",
        seriesId: id,
        tableId: tableName,
        title,
        units: metadata.units,
        transform: "lin — Levels",
        seasonalAdjustment: metadata.seasonalAdjustment,
        frequency: metadata.frequency,
        observationWindow: {
          start: observations[0]!.date,
          end: observations[observations.length - 1]!.date,
        },
        lastUpdated: snapshot.retrievedAt,
        retrievedAt: snapshot.retrievedAt,
        url: metadata.sourceUrl,
        licenseAttribution: metadata.licenseAttribution,
        copyrightedThirdParty: false,
        payloadSha256: snapshot.sha256,
      },
      snapshot,
    };
  }
}

/**
 * Bureau of Labor Statistics (BLS) Public Data API v2 provider (CPI, CES, QCEW, JOLTS).
 */
export class BlsDataProvider implements LiveDataProvider {
  readonly id = "bls" as const;
  readonly displayName = "U.S. Bureau of Labor Statistics (BLS API v2)";

  isConfigured(): boolean {
    return Boolean(process.env.BLS_API_KEY?.trim());
  }

  async search(_query: string): Promise<SeriesMetadata[]> {
    // BLS v2 API does not offer a free-text search endpoint; series discovery goes through FRED or direct BLS series IDs.
    if (!this.isConfigured()) {
      throw new DataUnavailableError(
        "bls",
        "BLS_API_KEY is not configured and BLS v2 requires explicit series IDs (e.g. CUUR0000SA0, CES0000000001)",
      );
    }
    return [];
  }

  async metadata(id: string): Promise<SeriesMetadata> {
    const cleanId = id.trim().toUpperCase();
    return {
      provider: "bls",
      id: cleanId,
      title: `BLS Series ${cleanId}`,
      units: "Index / Thousands",
      frequency: "Monthly",
      frequencyShort: "m",
      seasonalAdjustment: cleanId.includes("S") ? "Seasonally Adjusted" : "Not Seasonally Adjusted",
      observationStart: "2000-01-01",
      observationEnd: new Date().toISOString().slice(0, 10),
      lastUpdated: new Date().toISOString(),
      discontinued: false,
      copyrightedThirdParty: false,
      licenseAttribution:
        "U.S. Bureau of Labor Statistics (BLS), Department of Labor — Public Domain.",
      sourceUrl: `https://data.bls.gov/timeseries/${encodeURIComponent(cleanId)}`,
    };
  }

  async observations(
    id: string,
    options: ObservationsQuery = {},
  ): Promise<FetchedSeriesBundle> {
    const cleanId = id.trim().toUpperCase();
    const startYear = options.start ? options.start.slice(0, 4) : "2014";
    const endYear = options.end
      ? options.end.slice(0, 4)
      : String(new Date().getFullYear());
    const regKey = process.env.BLS_API_KEY?.trim();

    const body: Record<string, unknown> = {
      seriesid: [cleanId],
      startyear: startYear,
      endyear: endYear,
      catalog: true,
    };
    if (regKey) body.registrationkey = regKey;

    const { data, snapshot } = await fetchLiveJsonWithSnapshot<{
      status?: string;
      message?: string[];
      Results?: {
        series?: Array<{
          seriesID?: string;
          catalog?: {
            series_title?: string;
            seasonality?: string;
            survey_name?: string;
          };
          data?: Array<{
            year?: string;
            period?: string;
            value?: string;
          }>;
        }>;
      };
    }>({
      provider: "bls",
      seriesId: cleanId,
      url: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    });

    if (data.status && data.status !== "REQUEST_SUCCEEDED") {
      throw new DataUnavailableError(
        "bls",
        (data.message ?? ["BLS request failed"]).join("; "),
      );
    }

    const seriesObj = data.Results?.series?.[0];
    const rawPts = seriesObj?.data ?? [];
    const observations: ObservationPoint[] = rawPts
      .filter((r) => r.year && r.period && /^M(0[1-9]|1[0-2])$/.test(r.period))
      .map((r) => ({
        date: `${r.year}-${r.period!.slice(1)}-01`,
        value: Number.parseFloat(r.value ?? ""),
      }))
      .filter((pt) => Number.isFinite(pt.value))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (observations.length === 0) {
      throw new DataUnavailableError(
        "bls",
        `BLS series ${cleanId} returned 0 monthly observations`,
      );
    }

    const title =
      seriesObj?.catalog?.series_title ||
      seriesObj?.catalog?.survey_name ||
      `BLS ${cleanId}`;
    const seasonal =
      seriesObj?.catalog?.seasonality || "Reported by BLS";

    const metadata: SeriesMetadata = {
      provider: "bls",
      id: cleanId,
      title,
      units: "BLS Reported Units",
      frequency: "Monthly",
      frequencyShort: "m",
      seasonalAdjustment: seasonal,
      observationStart: observations[0]!.date,
      observationEnd: observations[observations.length - 1]!.date,
      lastUpdated: snapshot.retrievedAt,
      discontinued: false,
      copyrightedThirdParty: false,
      licenseAttribution:
        "U.S. Bureau of Labor Statistics (BLS) Public Data API v2 — Public Domain.",
      sourceUrl: `https://data.bls.gov/timeseries/${encodeURIComponent(cleanId)}`,
    };

    return {
      metadata,
      observations,
      provenance: {
        source: "bls",
        seriesId: cleanId,
        title,
        units: metadata.units,
        transform: "lin — Levels",
        seasonalAdjustment: seasonal,
        frequency: "Monthly",
        observationWindow: {
          start: observations[0]!.date,
          end: observations[observations.length - 1]!.date,
        },
        lastUpdated: snapshot.retrievedAt,
        retrievedAt: snapshot.retrievedAt,
        url: metadata.sourceUrl,
        licenseAttribution: metadata.licenseAttribution,
        copyrightedThirdParty: false,
        payloadSha256: snapshot.sha256,
      },
      snapshot,
    };
  }
}

/**
 * World Bank Open Data API v2 provider (cross-country panels for Synthetic Control & DiD donors).
 * Public machine-readable endpoint (no API key required).
 */
export class WorldBankDataProvider implements LiveDataProvider {
  readonly id = "worldbank" as const;
  readonly displayName = "World Bank World Development Indicators (WDI API v2)";

  isConfigured(): boolean {
    return true;
  }

  async search(query: string, limit = 8): Promise<SeriesMetadata[]> {
    const cleaned = query.trim();
    if (!cleaned) {
      throw new DataUnavailableError("worldbank", "Search query is required");
    }
    const url = `https://api.worldbank.org/v2/indicator?format=json&per_page=50`;
    const { data } = await fetchLiveJsonWithSnapshot<
      [
        unknown,
        Array<{
          id?: string;
          name?: string;
          sourceNote?: string;
          sourceOrganization?: string;
        }>,
      ]
    >({
      provider: "worldbank",
      seriesId: `wb_search_${cleaned.slice(0, 18)}`,
      url,
    });

    const list = Array.isArray(data?.[1]) ? data[1] : [];
    const tokens = cleaned
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    return list
      .filter((item) => {
        const text = `${item.id ?? ""} ${item.name ?? ""} ${item.sourceNote ?? ""}`.toLowerCase();
        return tokens.length === 0 || tokens.some((tok) => text.includes(tok));
      })
      .slice(0, limit)
      .map((item) => ({
        provider: "worldbank" as const,
        id: `USA:${item.id ?? "NY.GDP.MKTP.KD.ZG"}`,
        title: item.name ?? item.id ?? "World Bank Indicator",
        units: "World Bank WDI Units",
        frequency: "Annual",
        frequencyShort: "a" as const,
        seasonalAdjustment: "Not Applicable (Annual)",
        observationStart: "1960-01-01",
        observationEnd: new Date().toISOString().slice(0, 10),
        lastUpdated: new Date().toISOString(),
        notes: item.sourceNote,
        discontinued: false,
        copyrightedThirdParty: false,
        licenseAttribution:
          "World Bank Open Data — Creative Commons Attribution 4.0 (CC-BY 4.0).",
        sourceUrl: `https://data.worldbank.org/indicator/${encodeURIComponent(item.id ?? "")}`,
      }));
  }

  async metadata(id: string): Promise<SeriesMetadata> {
    const [country, indicator] = id.includes(":")
      ? id.split(":", 2)
      : ["USA", id];
    const url = `https://api.worldbank.org/v2/indicator/${encodeURIComponent(indicator!)}?format=json`;
    const { data } = await fetchLiveJsonWithSnapshot<
      [unknown, Array<{ id?: string; name?: string; sourceNote?: string }>]
    >({
      provider: "worldbank",
      seriesId: id,
      url,
    });
    const info = data?.[1]?.[0];
    if (!info) {
      throw new DataUnavailableError(
        "worldbank",
        `World Bank indicator ${indicator} not found`,
      );
    }
    return {
      provider: "worldbank",
      id: `${country}:${indicator}`,
      title: `${info.name ?? indicator} (${country})`,
      units: "Reported Indicator Units",
      frequency: "Annual",
      frequencyShort: "a",
      seasonalAdjustment: "Annual",
      observationStart: "1960-01-01",
      observationEnd: new Date().toISOString().slice(0, 10),
      lastUpdated: new Date().toISOString(),
      notes: info.sourceNote,
      discontinued: false,
      copyrightedThirdParty: false,
      licenseAttribution:
        "World Bank Open Data (WDI) — CC-BY 4.0 International.",
      sourceUrl: `https://data.worldbank.org/indicator/${encodeURIComponent(indicator!)}?locations=${encodeURIComponent(country!)}`,
    };
  }

  async observations(
    id: string,
    options: ObservationsQuery = {},
  ): Promise<FetchedSeriesBundle> {
    const [rawCountry, rawIndicator] = id.includes(":")
      ? id.split(":", 2)
      : [options.geography || "USA", id];
    const country = (rawCountry || "USA").trim().toUpperCase();
    const indicator = (rawIndicator || id).trim();

    const startYr = options.start ? options.start.slice(0, 4) : "1995";
    const endYr = options.end
      ? options.end.slice(0, 4)
      : String(new Date().getFullYear());

    const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}?date=${startYr}:${endYr}&format=json&per_page=200`;
    const { data, snapshot } = await fetchLiveJsonWithSnapshot<
      [
        { lastupdated?: string } | undefined,
        Array<{
          date?: string;
          value?: number | null;
          indicator?: { id?: string; value?: string };
          country?: { id?: string; value?: string };
        }> | null,
      ]
    >({
      provider: "worldbank",
      seriesId: `${country}:${indicator}`,
      url,
    });

    const rows = Array.isArray(data?.[1]) ? data[1] : [];
    const observations: ObservationPoint[] = rows
      .filter((r) => r.date && typeof r.value === "number" && Number.isFinite(r.value))
      .map((r) => ({
        date: `${r.date}-01-01`,
        value: r.value as number,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (observations.length === 0) {
      throw new DataUnavailableError(
        "worldbank",
        `World Bank ${country}:${indicator} returned 0 observations for ${startYr}-${endYr}`,
      );
    }

    const indName = rows[0]?.indicator?.value ?? indicator;
    const countryName = rows[0]?.country?.value ?? country;
    const title = `${indName} — ${countryName}`;
    const lastUpdated = data?.[0]?.lastupdated ?? snapshot.retrievedAt;
    const sourceUrl = `https://data.worldbank.org/indicator/${encodeURIComponent(indicator)}?locations=${encodeURIComponent(country)}`;

    const metadata: SeriesMetadata = {
      provider: "worldbank",
      id: `${country}:${indicator}`,
      title,
      units: indName,
      frequency: "Annual",
      frequencyShort: "a",
      seasonalAdjustment: "Not Seasonally Adjusted (Annual)",
      observationStart: observations[0]!.date,
      observationEnd: observations[observations.length - 1]!.date,
      lastUpdated,
      discontinued: false,
      copyrightedThirdParty: false,
      licenseAttribution:
        "World Bank World Development Indicators (WDI) — CC-BY 4.0.",
      sourceUrl,
    };

    return {
      metadata,
      observations,
      provenance: {
        source: "worldbank",
        seriesId: `${country}:${indicator}`,
        title,
        units: metadata.units,
        transform: "lin — Levels",
        seasonalAdjustment: metadata.seasonalAdjustment,
        frequency: "Annual",
        observationWindow: {
          start: observations[0]!.date,
          end: observations[observations.length - 1]!.date,
        },
        lastUpdated,
        retrievedAt: snapshot.retrievedAt,
        url: sourceUrl,
        licenseAttribution: metadata.licenseAttribution,
        copyrightedThirdParty: false,
        payloadSha256: snapshot.sha256,
      },
      snapshot,
    };
  }
}

/**
 * U.S. Census Bureau API provider.
 */
export class CensusDataProvider implements LiveDataProvider {
  readonly id = "census" as const;
  readonly displayName = "U.S. Census Bureau Data API (ACS / Economic Indicators)";

  isConfigured(): boolean {
    return Boolean(process.env.CENSUS_API_KEY?.trim());
  }

  async search(_query: string): Promise<SeriesMetadata[]> {
    if (!this.isConfigured()) {
      throw new DataUnavailableError(
        "census",
        "CENSUS_API_KEY is not configured in the environment",
      );
    }
    return [];
  }

  async metadata(id: string): Promise<SeriesMetadata> {
    if (!this.isConfigured()) {
      throw new DataUnavailableError(
        "census",
        "CENSUS_API_KEY is not configured in the environment",
      );
    }
    return {
      provider: "census",
      id,
      title: `U.S. Census Variable ${id}`,
      units: "Census Count / Dollars",
      frequency: "Annual",
      frequencyShort: "a",
      seasonalAdjustment: "Not Applicable",
      observationStart: "2010-01-01",
      observationEnd: new Date().toISOString().slice(0, 10),
      lastUpdated: new Date().toISOString(),
      discontinued: false,
      copyrightedThirdParty: false,
      licenseAttribution:
        "U.S. Census Bureau, Department of Commerce — Public Domain.",
      sourceUrl: "https://data.census.gov/",
    };
  }

  async observations(
    id: string,
    _options?: ObservationsQuery,
  ): Promise<FetchedSeriesBundle> {
    if (!this.isConfigured()) {
      throw new DataUnavailableError(
        "census",
        "CENSUS_API_KEY is not configured in the environment",
      );
    }
    throw new DataUnavailableError(
      "census",
      `Census variable ${id} requires an explicit ACS/BDS dataset path`,
    );
  }
}

export const beaProvider = new BeaDataProvider();
export const blsProvider = new BlsDataProvider();
export const worldBankProvider = new WorldBankDataProvider();
export const censusProvider = new CensusDataProvider();

const PROVIDERS: Record<DataProviderId, LiveDataProvider> = {
  fred: fredProvider,
  alfred: alfredProvider,
  bea: beaProvider,
  bls: blsProvider,
  census: censusProvider,
  worldbank: worldBankProvider,
  oecd: worldBankProvider,
  cbo: fredProvider,
};

export function getDataProvider(id: DataProviderId): LiveDataProvider {
  return PROVIDERS[id] ?? fredProvider;
}

export function listDataProviders(): LiveDataProvider[] {
  return [
    fredProvider,
    alfredProvider,
    beaProvider,
    blsProvider,
    censusProvider,
    worldBankProvider,
  ];
}
