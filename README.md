<div align="center">
  <img src="docs/brand/polinote-banner.png" alt="PoliNote — Econometric Policy Workbench & Digression Engine" width="100%" />
</div>

<br />

<div align="center">

# PoliNote

**A pre-registered econometric estimation and policy digression workbench.**

Bring a real policy instrument, a target population, and a time horizon. PoliNote locks a cryptographic **Pre-Registration & Scope Contract**, pulls live time-series data from **FRED/ALFRED, World Bank WDI, BLS Public API v2, and BEA NIPA**, executes real econometric estimators (**Event Studies, Jordà Local Projections, Difference-in-Differences, Synthetic Control, Chow/Bai–Perron Structural Break Tests**) with **Newey–West HAC** standard errors, runs an automatic **Specification Curve** across windows, transforms, and placebos, audits every number in prose with a deterministic **Data Auditor**, and exports publication-ready **Word (`.docx`), PDF (`.pdf`), CSV Bundles, and Runnable Jupyter Notebooks (`.ipynb`)**.

</div>

---

## Two First-Class Halves: Analysis & Digression

1. **ANALYSIS (Real, Reproducible Econometrics on Live Data)**:
   - **Zero Hard-Coded Data or Templates**: Every series is searched and fetched live at run time with a SHA-256 raw payload snapshot, vintage date, seasonal adjustment, and license attribution. If a provider key is missing or an endpoint is unreachable, the step fails visibly (`Data unavailable: <source> <reason>`) and dependent claims are marked `unverifiable`.
   - **Pre-Registration Lock Before Fetch**: Scope, series selection rules, transforms, estimator, HAC lags, and observation window lock with a SHA-256 hash and timestamp *before* any observations are fetched. Post-lock edits spawn an explicit **Specification Fork** linked to its parent hash.
   - **Method Honesty Enforcement**: Difference-in-Differences requires a qualified untreated comparison series, and Synthetic Control requires a donor pool of at least 2 aligned series. If none qualifies (or if an Event Study is run on a single series), the estimate is automatically relabeled **Descriptive** with the reason recorded—single-series pre/post regressions are never labeled quasi-experimental.
   - **Context-Bound, Rounding-Aware Data Auditor**: The LLM crew reasons, plans, and writes—it never computes or invents numbers. Deterministic code extracts every numeric figure in generated text (and in compiled reports) and verifies that it matches the specific series and date (or estimate object) cited at the printed decimal precision.

2. **DIGRESSION (The Argument Map, Forks, Critiques & Personas)**:
   - **5-Stage Policy Spine + Digression Band**: `01 Policy Rule` → `02 Mechanism & Identification` → `03 Testable Claim` → `04 Empirical Proof` → `05 Distributional Incidence`, with `Counterfactuals`, `Pre-Registration Forks`, and `Skeptic Red-Team Critiques` mapped below.
   - **Strict Claim Lifecycle**: `proposed` → `data_attached` → `tested` → `supported` / `contradicted` / `inconclusive` / `unverifiable`, set **only** by deterministic code rules on the estimate (sign match, 95% CI excluding zero, pre-trend test pass, specification curve pass rate, and Skeptic unresolved objections).
   - **Simulated Perspective Sandbox**: Historical lenses (Adam Smith, Keynes, Friedman, Hamilton, Ostrom, Volcker) are explicitly labeled `Simulated perspective` and debate strictly over the run's actual estimates and cited literature without introducing numbers.

---

## Data Providers & Live Routing Status

| Provider | Status | Coverage & Configuration |
|---|---|---|
| **FRED / ALFRED** | **Live** | Series search, metadata validation, observations (`lin\|chg\|ch1\|pch\|pc1\|pca\|cch\|cca\|log`), and real-time vintage dates (`FRED_API_KEY`). |
| **World Bank WDI** | **Live** | Public API v2 indicator search and country-level annual series (`USA:<indicator>`, no API key required). |
| **BLS Public API v2** | **Live** | Direct BLS series pulls (`BLS:<seriesId>`); higher quota when `BLS_API_KEY` is configured. |
| **BEA NIPA** | **Live (with key)** | NIPA table search and line-item series pulls (`NIPA:<table>:<line>`) when `BEA_API_KEY` is configured. |
| **OpenAlex** | **Live** | Peer-reviewed economics literature search with inverted-index abstract reconstruction and quote-span estimate extraction. |
| **Congress.gov** | **Live (with key)** | Paginated federal bill search across pages (`CONGRESS_API_KEY`) with govinfo/CBO web fallback (`FIRECRAWL_API_KEY`). |
| **U.S. Census / CBO** | **Not live** | Micro/cross-sectional ACS survey paths and bespoke CBO score tables are marked *Not live* for aggregate time-series pulls. |

---

## The 9-Role Crew (`src/agents/roles.ts`)

| # | Role ID | Responsibility |
|---|---|---|
| 1 | `scoper` | Locks the **Scope Contract**, explicit `policyDate` + `policyDateSource`, unit of analysis, treatment/control candidates, and directional hypothesis. |
| 2 | `data_scout` | Searches live providers and validates candidate metadata (coverage window, frequency, seasonal adjustment, discontinued flag). |
| 3 | `identification_strategist` | Selects an estimator from `METHOD_CATALOG` (`Working` / `Partial` / `Not yet`), states identifying assumptions, and names confounders. |
| 4 | `econometrician` | Defines the estimation specification; deterministic code (or `PYTHON_ECONOMETRICS_URL` when configured) executes OLS/HAC, Event Studies, Jordà Local Projections, DiD, Synthetic Control, and the Specification Curve. |
| 5 | `literature_analyst` | Queries OpenAlex for peer-reviewed studies and extracts empirical estimates only when backed by a verbatim quote span. |
| 6 | `skeptic` | Dedicated Red-Team model call (`SKEPTIC_MODEL` when set) critiquing confounders, reverse causality, and pre-trend fragility; unresolved objections lower claim confidence and generate interactive **“What would change my mind”** forks. |
| 7 | `data_auditor` | **Deterministic code** (not an LLM) that matches every number in prose and compiled reports against the specific series/date or estimate cited, stripping any untraced numbers. |
| 8 | `synthesizer` | Compiles the executive brief and methodology appendix referencing only verified node/estimate IDs and stating honesty labels. |
| 9 | `trace_narrator` | Produces the plain-language provenance walkthrough across all 7 pipeline stages. |

---

## Diagnostics, Reproducibility & Evaluation

- **Health & Startup Validation (`/api/health`)**: Validates environment configuration (`FRED_API_KEY`, `SESSION_SECRET`, `OPENAI_API_KEY`, and optional `BEA_API_KEY`, `BLS_API_KEY`, `CENSUS_API_KEY`, `CONGRESS_API_KEY`, `DATABASE_URL`, `PYTHON_ECONOMETRICS_URL`) with Zod and surfaces missing-config warnings in the Workbench header.
- **Reproducible Exports**: Download native `.docx` and `.pdf` reports, full `.csv` provenance data bundles, and runnable **Jupyter Notebooks (`.ipynb`)** with pinned package versions (`numpy==1.26.4`, `pandas==2.2.2`, `scipy==1.13.1`, `statsmodels==0.14.2`, `linearmodels==6.0`, `requests==2.32.3`) that re-pull live data, diff vintage revisions against the run's SHA-256 snapshot, and reproduce every regression.
- **Benchmark Suite (`src/lib/evaluation/benchmarks.ts`)**: 20 literature-backed policy questions evaluated in CI against deterministic recorded fixtures (`npm test`) scoring series relevance, direction agreement, magnitude within the literature range, and auditor strip rate.
