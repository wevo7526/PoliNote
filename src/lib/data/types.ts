import { z } from "zod";

export const DataProviderIdSchema = z.enum([
  "fred",
  "alfred",
  "bea",
  "bls",
  "census",
  "oecd",
  "worldbank",
  "cbo",
]);

export type DataProviderId = z.infer<typeof DataProviderIdSchema>;

export const FredUnitsTransformSchema = z.enum([
  "lin", // Levels (No transformation)
  "chg", // Change
  "ch1", // Change from Year Ago
  "pch", // Percent Change
  "pc1", // Percent Change from Year Ago
  "pca", // Compounded Annual Rate of Change
  "cch", // Continuously Compounded Rate of Change
  "cca", // Continuously Compounded Annual Rate of Change
  "log", // Natural Log
]);

export type FredUnitsTransform = z.infer<typeof FredUnitsTransformSchema>;

export const DataFrequencySchema = z.enum([
  "d", // Daily
  "w", // Weekly
  "bw", // Biweekly
  "m", // Monthly
  "q", // Quarterly
  "sa", // Semiannual
  "a", // Annual
  "unknown",
]);

export type DataFrequency = z.infer<typeof DataFrequencySchema>;

export const AggregationMethodSchema = z.enum(["avg", "sum", "eop"]);
export type AggregationMethod = z.infer<typeof AggregationMethodSchema>;

/**
 * Full provenance record required on every number, chart, and table.
 */
export const DataProvenanceSchema = z.object({
  source: DataProviderIdSchema,
  seriesId: z.string().min(1),
  tableId: z.string().optional(),
  title: z.string().min(1),
  units: z.string().min(1),
  transform: z.string().min(1),
  seasonalAdjustment: z.string().min(1),
  frequency: z.string().min(1),
  observationWindow: z.object({
    start: z.string(),
    end: z.string(),
  }),
  realtimeWindow: z
    .object({
      realtimeStart: z.string(),
      realtimeEnd: z.string(),
      outputType: z.number().int().min(1).max(4).optional(),
      vintageMode: z.enum(["latest_revised", "realtime_as_of", "initial_release"]),
    })
    .optional(),
  vintageDate: z.string().optional(),
  lastUpdated: z.string(),
  retrievedAt: z.string(),
  url: z.string().url(),
  licenseAttribution: z.string(),
  copyrightedThirdParty: z.boolean().default(false),
  payloadSha256: z.string().min(32),
  deflatedWith: z
    .object({
      deflatorSeriesId: z.string(),
      baseYear: z.string(),
    })
    .optional(),
  normalizedWith: z
    .object({
      denominatorSeriesId: z.string(),
      mode: z.enum(["per_capita", "share_of_gdp"]),
    })
    .optional(),
});

export type DataProvenance = z.infer<typeof DataProvenanceSchema>;

export const ObservationPointSchema = z.object({
  date: z.string(),
  value: z.number(),
  realtimeStart: z.string().optional(),
  realtimeEnd: z.string().optional(),
});

export type ObservationPoint = z.infer<typeof ObservationPointSchema>;

export const SeriesMetadataSchema = z.object({
  provider: DataProviderIdSchema,
  id: z.string().min(1),
  title: z.string().min(1),
  units: z.string(),
  unitsShort: z.string().optional(),
  frequency: z.string(),
  frequencyShort: DataFrequencySchema.default("unknown"),
  seasonalAdjustment: z.string(),
  seasonalAdjustmentShort: z.string().optional(),
  observationStart: z.string(),
  observationEnd: z.string(),
  lastUpdated: z.string(),
  popularity: z.number().optional(),
  notes: z.string().optional(),
  discontinued: z.boolean().default(false),
  copyrightedThirdParty: z.boolean().default(false),
  licenseAttribution: z.string(),
  sourceUrl: z.string().url(),
});

export type SeriesMetadata = z.infer<typeof SeriesMetadataSchema>;

export type ObservationsQuery = {
  start?: string;
  end?: string;
  units?: FredUnitsTransform;
  frequency?: "d" | "w" | "bw" | "m" | "q" | "sa" | "a";
  aggregation?: AggregationMethod;
  realtimeStart?: string;
  realtimeEnd?: string;
  vintageDates?: string[];
  outputType?: 1 | 2 | 3 | 4;
  geography?: string;
};

export const RawSnapshotRecordSchema = z.object({
  id: z.string().min(1),
  provider: DataProviderIdSchema,
  seriesId: z.string().min(1),
  requestUrl: z.string().min(1),
  retrievedAt: z.string(),
  sha256: z.string().min(32),
  byteLength: z.number().int().nonnegative(),
  rawJson: z.string(),
});

export type RawSnapshotRecord = z.infer<typeof RawSnapshotRecordSchema>;

export type FetchedSeriesBundle = {
  metadata: SeriesMetadata;
  observations: ObservationPoint[];
  provenance: DataProvenance;
  snapshot: RawSnapshotRecord;
  vintages?: string[];
};

export interface LiveDataProvider {
  readonly id: DataProviderId;
  readonly displayName: string;
  isConfigured(): boolean;
  search(query: string, limit?: number): Promise<SeriesMetadata[]>;
  metadata(id: string): Promise<SeriesMetadata>;
  observations(
    id: string,
    options?: ObservationsQuery,
  ): Promise<FetchedSeriesBundle>;
}

/**
 * Thrown whenever a live provider cannot return data (missing API key, HTTP error,
 * rate limit, or empty observation window). Never substitute fallback data.
 */
export class DataUnavailableError extends Error {
  readonly source: DataProviderId | string;
  readonly reason: string;

  constructor(source: DataProviderId | string, reason: string) {
    const cleanReason = reason.replace(/^Data unavailable:\s*/i, "").trim();
    super(`Data unavailable: ${source.toUpperCase()} — ${cleanReason}`);
    this.name = "DataUnavailableError";
    this.source = source;
    this.reason = cleanReason;
  }
}
