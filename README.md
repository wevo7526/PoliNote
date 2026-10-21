<div align="center">
  <img src="docs/brand/polinote-banner.png" alt="PoliNote — Economic Analysis Engine & Policy Digression Workbench" width="100%" />
</div>

<br />

<div align="center">

# PoliNote

**An economic analysis engine and policy digression workbench.**

Bring a real policy instrument, a target population, and a time horizon. PoliNote locks a formal **Scope Contract**, builds a 5-stage **Policy Argument Graph** with explicit counterfactual branches, attaches empirical time-series and literature spans via **MCP**, models **Baseline vs. Policy Trajectories** and **Distributional Incidence**, and compiles publication-ready **Word (`.docx`)** and **PDF (`.pdf`)** reports with embedded figures.

</div>

---

## Why PoliNote Exists

Serious economic policy questions — a 25% tariff on battery-electric vehicles, a by-right transit upzoning mandate, a carbon border adjustment on steel, or a semiconductor investment tax credit — do not resolve into a single paragraph. They fork across legal constraints, price pass-through elasticities, supply-chain substitution, and regional or household incidence.

PoliNote turns policy analysis into a **structured, verifiable artifact**:
1. **Every claim has a place on the Policy Spine** (`01 Policy Rule` → `02 Mechanism` → `03 Core Finding` → `04 Empirical Data` → `05 Who Pays / Gains`) or in the **Digression Band** (`What-If Baselines`, `Design Forks`, and `Key Risks`).
2. **Every output is quantitatively and empirically grounded**, pairing live **FRED** macroeconomic and sector series with **Counterfactual Fan Projections (2021–2030)**, **Dynamic Impulse-Response Functions (Q+1 to Q+8)**, and **Distributional Welfare Splits**.
3. **Every conclusion is traceable**, showing the exact agent role that created a node, the hashed MCP evidence span that verified it, and the 5-section economic analysis behind it.

---

## Core Capabilities & Workspaces

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>Projects Hub</h3>
      <p>Organize related inquiries inside persistent <strong>Projects</strong>. Each project maintains shared standing instructions, accumulates verified nodes and empirical charts across runs, and compiles a unified <strong>Project Master Report</strong>.</p>
    </td>
    <td width="33%" valign="top">
      <h3>Run & Blueprint Graph</h3>
      <p>Watch the 6-role crew assemble the policy spine and digression branches in real time. Inspect inline time-series projections, expand 5-section node analyses directly in the output panel, or scrub backward and forward through the domain event timeline.</p>
    </td>
    <td width="33%" valign="top">
      <h3>Report & Word / PDF Export</h3>
      <p>Compile run or project findings with AI and download native <strong>Microsoft Word (<code>.docx</code>)</strong> or <strong>PDF (<code>.pdf</code>)</strong> reports complete with high-resolution embedded charts, node provenance tables, and a verified bibliography.</p>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <h3>Full Knowledge Graph Map</h3>
      <p>Filter the argument by <em>Main Spine</em>, <em>Branches</em>, <em>Verified</em>, or <em>Needs Proof</em>. Hover any node to highlight its causal chain, contest or exclude nodes, or click <strong>+ Branch / Digress from this node</strong> to test a deeper mechanism.</p>
    </td>
    <td width="33%" valign="top">
      <h3>Scope Protocol & Slice Invalidation</h3>
      <p>Lock jurisdiction, horizon, instrument, target benchmark, identification strategy, and baseline. Editing the Scope Contract automatically identifies affected downstream nodes, marks them for re-verification, and re-runs only the invalidated slice.</p>
    </td>
    <td width="33%" valign="top">
      <h3>Persona & Macro Sandbox</h3>
      <p>Explore macro regimes and policy counterfactuals through the intellectual lenses of <strong>Adam Smith</strong>, <strong>John Maynard Keynes</strong>, <strong>Milton Friedman</strong>, <strong>Alexander Hamilton</strong>, <strong>Elinor Ostrom</strong>, or <strong>Paul Volcker</strong> — grounded in live FRED charts and promotable to a full Project Run in one click.</p>
    </td>
  </tr>
</table>

---

## The 5-Stage Policy Spine & Node Taxonomy

Every node on the PoliNote canvas has an explicit analytical role and verification status:

| Stage / Lane | Node Type | Role in the Policy Argument |
|---|---|---|
| **01 · Policy Rule** | `constraint` | The concrete statute, tariff, tax credit, zoning rule, or regulatory mandate being evaluated — and its higher-law bounds. |
| **02 · Mechanism** | `mechanism` | The causal transmission channel (price pass-through, factor substitution, capital formation) set in motion by the rule. |
| **03 · Core Finding** | `claim` | A testable quantitative prediction about prices, output, employment, or fiscal balance relative to the baseline. |
| **04 · Empirical Data** | `evidence` | Hashed proof spans pulled from allowlisted MCP servers (FRED economic series, OpenAlex peer-reviewed studies, official policy docs). |
| **05 · Who Pays / Gains** | `incidence` | Economic vs. statutory incidence across households, domestic producers, downstream firms, workers, and public budgets. |
| **Digression Branches** | `counterfactual` · `fork` · `uncertainty` | Status-quo baselines, policy design forks where outcomes split, and identification risks or unmeasured confounders. |

---

## Quantitative Economic Analysis & Time-Series Engine

PoliNote pairs empirical retrieval with structural economic visualization across every run, node modal, and exported report:

- **Counterfactual Time-Series Fan Projections (2021–2030)**: Benchmarks historical pre-policy trajectories against the **Status-Quo Baseline** and the **Enacted Policy Path** with a shaded **90% Confidence Interval Fan**.
- **Dynamic Impulse-Response Curves (Q+1 to Q+8)**: Maps quarter-by-quarter transmission across **Price / Cost Pass-Through**, **Real Sector Output**, and **Employment / Fiscal Balance** to distinguish short-run rigidities from medium-run supply responses.
- **Distributional Incidence & Welfare Split**: Quantifies net percentage surplus/income shifts and confidence bounds across stakeholder groups.
- **In-App MCP Verification**:
  - `econ-series`: St. Louis Fed (**FRED**) series search, multi-period observations, and vintage dates.
  - `literature`: **OpenAlex** peer-reviewed empirical economics search.
  - `policy-docs`: Official statutory, congressional, and regulatory document retrieval.
  - `workspace` & `trace`: Project/run working memos and append-only domain event replay.

---

## Hard Analytical Guarantees

- **Scope Readiness Gate**: The graph cannot graduate to ready until **instrument**, **target**, **identification strategy**, and **horizon** are locked in the Scope Contract.
- **Empirical Verification Wall**: No node can be marked `Verified` (`supported`) without at least one hashed MCP evidence span attached. The **Critic** role audits identification risks and cannot fabricate positive claims.
- **Grounded Synthesis**: Every factual claim in the compiled brief and technical appendix cites its backing graph node (`[node_key]`), rendering as an interactive pill that opens that node's provenance trace and time-series chart.
- **Targeted Subgraph Invalidation**: Modifying a Scope Contract field (`instrument`, `identificationStrategy`, `target`, `horizon`, `baseline`) diffs the contract and marks only the dependent downstream subgraph for re-evaluation.
- **Session Isolation**: Each researcher's projects, runs, graphs, and event logs are isolated in a per-user DuckDB store hydrated across serverless functions.

<div align="center">
  <br />
  <em>Lock the scope. Map the spine. Verify with data. Export the report.</em>
  <br /><br />
</div>
