<div align="center">
  <img src="docs/brand/polinote-banner.png" alt="PoliNote — Econometric Policy Workbench & Digression Engine" width="100%" />
</div>

<br />

<div align="center">

# PoliNote

**A pre-registered econometric estimation and policy digression workbench.**

Bring a real policy instrument, a target population, and a time horizon. PoliNote locks a cryptographic **Pre-Registration & Scope Contract**, pulls live time-series data from **FRED/ALFRED, BEA, BLS, U.S. Census, and World Bank**, executes real econometric estimators (**Event Studies, Jordà Local Projections, Difference-in-Differences, Synthetic Control, Chow/Bai–Perron Structural Break Tests**) with **Newey–West HAC** standard errors, runs an automatic **Specification Curve** across windows, transforms, and placebos, audits every number in prose with a deterministic **Data Auditor**, and exports publication-ready **Word (`.docx`), PDF (`.pdf`), CSV Bundles, and Runnable Jupyter Notebooks (`.ipynb`)**.

</div>

---

## Two First-Class Halves: Analysis & Digression

1. **ANALYSIS (Real, Reproducible Econometrics on Live Data)**:
   - **Zero Hard-Coded Data or Templates**: Every series is searched and fetched live at run time with a SHA-256 raw payload snapshot, vintage date, seasonal adjustment, and license attribution. If a provider key is missing or an endpoint is unreachable, the step fails visibly (`Data unavailable: <source> <reason>`) and dependent claims are marked `unverifiable`.
   - **Pre-Registration Lock**: Scope, series IDs, transforms, estimator, and observation window lock with a SHA-256 hash and timestamp *before* estimation runs. Post-lock edits spawn an explicit **Specification Fork** linked to its parent hash.
   - **Automatic Robustness & Specification Curve**: Every headline estimate is automatically re-estimated across narrow/extended windows, growth-rate/log transforms, macro controls, and in-time pre-policy placebos.
   - **Deterministic Numeric Auditor**: The LLM crew reasons, plans, and writes—it never computes or invents numbers. Code extracts every numeric figure in generated text and verifies that it matches a fetched observation, computed estimate, or quote-backed OpenAlex study.

2. **DIGRESSION (The Argument Map, Forks, Critiques & Personas)**:
   - **5-Stage Policy Spine + Digression Band**: `01 Policy Rule` → `02 Mechanism & Identification` → `03 Testable Claim` → `04 Empirical Proof` → `05 Distributional Incidence`, with `Counterfactuals`, `Pre-Registration Forks`, and `Skeptic Red-Team Critiques` mapped below.
   - **Strict Claim Lifecycle**: `proposed` → `data_attached` → `tested` → `supported` / `contradicted` / `inconclusive` / `unverifiable`, set **only** by deterministic code rules on the estimate (sign match, 95% CI excluding zero, pre-trend test pass, and specification curve pass rate).
   - **Simulated Perspective Sandbox**: Historical lenses (Adam Smith, Keynes, Friedman, Hamilton, Ostrom, Volcker) are explicitly labeled `Simulated perspective` and debate strictly over the run's actual estimates and cited literature without introducing numbers.

---

## The 9-Role Crew (`src/agents/roles.ts`)

| # | Role ID | Responsibility |
|---|---|---|
| 1 | `scoper` | Locks the **Scope Contract**, policy date, unit of analysis, treatment/control candidates, and directional hypothesis. |
| 2 | `data_scout` | Searches live providers (FRED/ALFRED, BEA, BLS, Census, World Bank) and validates candidate metadata (coverage window, frequency, seasonal adjustment, discontinued flag). |
| 3 | `identification_strategist` | Selects an estimator from the method catalog (`METHOD_CATALOG`), states identifying assumptions, and names confounders in the window. |
| 4 | `econometrician` | Defines the estimation specification; deterministic code executes OLS/HAC, Event Studies, Jordà Local Projections, Synthetic Control, and the Specification Curve. |
| 5 | `literature_analyst` | Queries OpenAlex for peer-reviewed studies and extracts empirical estimates only when backed by a verbatim quote span. |
| 6 | `skeptic` | Red-team critique of confounders, reverse causality, and pre-trend fragility; proposes interactive **“What would change my mind”** falsification forks. |
| 7 | `data_auditor` | **Deterministic code** (not an LLM) that matches every number in prose against fetched observations and computed estimates, stripping any untraced numbers. |
| 8 | `synthesizer` | Compiles the executive brief and methodology appendix referencing only verified node/estimate IDs and stating honesty labels (`Descriptive`, `Associational`, `Quasi-experimental (method)`, `Literature estimate (citation)`). |
| 9 | `trace_narrator` | Produces the plain-language provenance walkthrough across all 7 pipeline stages. |

---

## Diagnostics, Reproducibility & Evaluation

- **Health & Startup Validation (`/api/health`)**: Validates environment configuration (`FRED_API_KEY`, `BEA_API_KEY`, `BLS_API_KEY`, `CENSUS_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL`, `SESSION_SECRET`) with Zod and reports live reachability across DB, FRED, BEA, BLS, Census, OpenAlex, World Bank, and OpenAI.
- **Reproducible Exports**: Download native `.docx` and `.pdf` reports, full `.csv` provenance data bundles, and runnable **Jupyter Notebooks (`.ipynb`)** that re-pull live data, diff vintage revisions against the run's SHA-256 snapshot, and reproduce every regression with `statsmodels`.
- **Benchmark Suite (`src/lib/evaluation/benchmarks.ts`)**: 20 literature-backed policy questions (TCJA business investment, 2018 tariff pass-through, Volcker disinflation, CHIPS/IRA manufacturing construction, minimum wage elasticity, etc.) + automated unit and static guard tests (`npm test`).
