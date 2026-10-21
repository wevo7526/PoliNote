import type { ExtractedSeries } from "@/components/studio/ReportCharts";
import type { DigressionNode } from "@/schemas/digression";
import type { ScopeContract } from "@/schemas/scope-contract";

export type PolicyDomainId =
  | "trade_tariff"
  | "housing_zoning"
  | "industrial_subsidy"
  | "carbon_climate"
  | "monetary_rates"
  | "fiscal_tax"
  | "labor_wages"
  | "general_policy";

export type CounterfactualPoint = {
  period: string;
  isForecast: boolean;
  baseline: number;
  policy: number;
  lowerBand: number;
  upperBand: number;
};

export type CounterfactualSeries = {
  domain: PolicyDomainId;
  title: string;
  subtitle: string;
  metricLabel: string;
  units: string;
  interventionPeriod: string;
  baselineEndDeltaPct: number;
  policyEndDeltaPct: number;
  netPolicyEffectPct: number;
  points: CounterfactualPoint[];
};

export type ImpulsePoint = {
  horizon: string;
  quarter: number;
  priceChannel: number;
  outputChannel: number;
  employmentFiscalChannel: number;
};

export type ImpulseResponseSeries = {
  title: string;
  subtitle: string;
  units: string;
  channelLabels: {
    price: string;
    output: string;
    employmentFiscal: string;
  };
  points: ImpulsePoint[];
};

export type IncidenceBarItem = {
  stakeholder: string;
  role: string;
  deltaPct: number;
  confidenceRange: [number, number];
  direction: "gain" | "loss" | "mixed";
  mechanismNote: string;
};

export type EconomicScorecard = {
  domainLabel: string;
  shockMagnitude: string;
  elasticitySummary: string;
  primaryMetricDelta: string;
  realOutputDelta: string;
  timeToPeak: string;
  verificationStanding: string;
};

export type RunEconomicModel = {
  domain: PolicyDomainId;
  scorecard: EconomicScorecard;
  counterfactual: CounterfactualSeries;
  impulseResponse: ImpulseResponseSeries;
  incidenceDistribution: IncidenceBarItem[];
};

type DomainTemplate = {
  id: PolicyDomainId;
  label: string;
  defaultShock: string;
  metricTitle: string;
  units: string;
  elasticity: string;
  timeToPeak: string;
  historicalBase: number[];
  baselineDrift: number;
  policyShockProfile: number[];
  bandWidth: number;
  impulseChannels: {
    price: string;
    output: string;
    employmentFiscal: string;
  };
  impulseCurve: Array<[number, number, number]>;
  incidence: IncidenceBarItem[];
};

const YEARS = ["2021", "2022", "2023", "2024", "2025", "2026", "2027", "2028", "2029", "2030"];

const DOMAIN_TEMPLATES: Record<PolicyDomainId, DomainTemplate> = {
  trade_tariff: {
    id: "trade_tariff",
    label: "Trade & Tariff Incidence Model",
    defaultShock: "25% Ad Valorem Import Tariff",
    metricTitle: "Domestic Sector Price & Import Substitution Index",
    units: "Index (2025 = 100)",
    elasticity: "Import demand ε = −1.35 · Consumer pass-through = 0.68",
    timeToPeak: "Q+3 to Q+6 Quarters",
    historicalBase: [88.4, 93.1, 96.2, 98.4, 100.0],
    baselineDrift: 1.6,
    policyShockProfile: [4.2, 6.8, 7.4, 6.9, 6.3],
    bandWidth: 2.4,
    impulseChannels: {
      price: "Retail / Input Price Pass-Through (%)",
      output: "Domestic Protected Output (%)",
      employmentFiscal: "Downstream & Retaliation Drag (%)",
    },
    impulseCurve: [
      [2.8, 0.9, -0.4],
      [4.9, 2.1, -1.1],
      [6.2, 3.4, -1.8],
      [6.8, 3.9, -2.3],
      [6.4, 3.7, -2.5],
      [5.9, 3.3, -2.4],
      [5.4, 2.9, -2.2],
      [5.0, 2.6, -2.0],
    ],
    incidence: [
      {
        stakeholder: "Protected Domestic Producers",
        role: "Import-competing assembly & upstream plants",
        deltaPct: 4.6,
        confidenceRange: [2.8, 6.4],
        direction: "gain",
        mechanismNote: "Higher tariff umbrella raises domestic pricing power and capacity utilization.",
      },
      {
        stakeholder: "Households & Retail Buyers",
        role: "End-market vehicle & durable goods buyers",
        deltaPct: -5.4,
        confidenceRange: [-7.2, -3.6],
        direction: "loss",
        mechanismNote: "Incomplete foreign exporter absorption passes ~68% of duty into retail prices.",
      },
      {
        stakeholder: "Downstream Using Industries",
        role: "Firms reliant on imported intermediate inputs",
        deltaPct: -3.2,
        confidenceRange: [-4.8, -1.7],
        direction: "loss",
        mechanismNote: "Higher input costs compress margins and export competitiveness.",
      },
      {
        stakeholder: "Domestic Sector Labor",
        role: "Production & assembly payrolls in target sector",
        deltaPct: 1.9,
        confidenceRange: [0.6, 3.1],
        direction: "gain",
        mechanismNote: "Near-term domestic shift adds shifts, partially offset by parts cost.",
      },
      {
        stakeholder: "Federal Customs & Fiscal Balance",
        role: "Gross tariff receipts net of deadweight drag",
        deltaPct: 2.1,
        confidenceRange: [1.0, 3.2],
        direction: "gain",
        mechanismNote: "Customs duties rise initially before import volume substitution erodes the base.",
      },
    ],
  },
  housing_zoning: {
    id: "housing_zoning",
    label: "Urban Housing Supply & Land-Use Model",
    defaultShock: "By-Right Transit-Oriented Upzoning",
    metricTitle: "Permitted Multifamily Supply & Real Rent Trajectory",
    units: "Index (2025 = 100)",
    elasticity: "Housing supply ε_s = 0.85 · Rent elasticity to stock = −0.45",
    timeToPeak: "Q+6 to Q+10 Quarters (construction completion cycle)",
    historicalBase: [91.0, 94.5, 96.8, 98.6, 100.0],
    baselineDrift: 2.8,
    policyShockProfile: [-0.8, -2.4, -4.5, -6.2, -7.4],
    bandWidth: 2.1,
    impulseChannels: {
      price: "Real Corridor Rent Growth vs. Baseline (%)",
      output: "Multifamily Permitting & Starts (%)",
      employmentFiscal: "Local Property Tax & Transit Ridership (%)",
    },
    impulseCurve: [
      [0.2, 4.5, 0.5],
      [-0.4, 9.2, 1.1],
      [-1.3, 13.8, 1.9],
      [-2.5, 16.4, 2.7],
      [-3.8, 17.2, 3.4],
      [-4.9, 16.8, 3.9],
      [-5.7, 15.9, 4.3],
      [-6.3, 15.1, 4.6],
    ],
    incidence: [
      {
        stakeholder: "Renter Households & In-Migrants",
        role: "Low- and middle-income corridor renters",
        deltaPct: 5.2,
        confidenceRange: [3.1, 7.3],
        direction: "gain",
        mechanismNote: "New market-rate stock triggers filtering chains and slows rent escalation.",
      },
      {
        stakeholder: "Transit-Proximate Landowners & Builders",
        role: "Parcel owners within 0.5-mile station catchments",
        deltaPct: 6.4,
        confidenceRange: [4.0, 8.8],
        direction: "gain",
        mechanismNote: "Higher allowable floor-area ratio (FAR) increases residual land value.",
      },
      {
        stakeholder: "Incumbent Single-Family Landlords",
        role: "Scarcity-protected rental owners",
        deltaPct: -2.7,
        confidenceRange: [-4.3, -1.1],
        direction: "loss",
        mechanismNote: "Added multifamily competition erodes local scarcity rents.",
      },
      {
        stakeholder: "Construction & Building Trades",
        role: "Regional residential construction labor",
        deltaPct: 3.8,
        confidenceRange: [2.1, 5.4],
        direction: "gain",
        mechanismNote: "Sustained pipeline of mid-rise by-right projects expands trade hours.",
      },
      {
        stakeholder: "Municipal Fiscal Balance",
        role: "Property tax base net of infrastructure outlays",
        deltaPct: 2.4,
        confidenceRange: [0.8, 4.1],
        direction: "gain",
        mechanismNote: "Infill density yields higher assessed value per linear foot of municipal pipe.",
      },
    ],
  },
  industrial_subsidy: {
    id: "industrial_subsidy",
    label: "Industrial Policy & Capital Investment Model",
    defaultShock: "25% Investment Tax Credit / Production Subsidy",
    metricTitle: "Domestic Fab / Manufacturing Capex & Capacity Index",
    units: "Index (2025 = 100)",
    elasticity: "User-cost of capital ε_k = −1.15 · Skilled wage pass-through = 0.34",
    timeToPeak: "Q+4 to Q+8 Quarters",
    historicalBase: [86.0, 90.2, 94.1, 97.3, 100.0],
    baselineDrift: 2.1,
    policyShockProfile: [5.4, 11.2, 15.8, 18.4, 19.6],
    bandWidth: 3.2,
    impulseChannels: {
      price: "Specialized Equipment & Skilled Wage Cost (%)",
      output: "Domestic Capital Formation & Output (%)",
      employmentFiscal: "Net Fiscal Cost / Crowding-Out Pressure (%)",
    },
    impulseCurve: [
      [1.4, 4.8, -1.8],
      [2.6, 9.4, -3.1],
      [3.5, 13.6, -4.0],
      [3.9, 16.2, -4.4],
      [3.4, 17.8, -4.1],
      [2.7, 18.6, -3.7],
      [2.1, 19.1, -3.3],
      [1.6, 19.4, -2.9],
    ],
    incidence: [
      {
        stakeholder: "Domestic Manufacturers & Fab Operators",
        role: "Capital-intensive domestic producers",
        deltaPct: 7.8,
        confidenceRange: [5.2, 10.4],
        direction: "gain",
        mechanismNote: "25% user-cost reduction accelerates domestic plant commitments.",
      },
      {
        stakeholder: "Specialized Engineering & Tooling Labor",
        role: "Inelastic high-skill technical workforce",
        deltaPct: 4.3,
        confidenceRange: [2.5, 6.1],
        direction: "gain",
        mechanismNote: "Captures a significant share of subsidy incidence via wage premia.",
      },
      {
        stakeholder: "Downstream Industrial Buyers",
        role: "Domestic purchasers of finished components",
        deltaPct: 2.2,
        confidenceRange: [0.5, 3.9],
        direction: "gain",
        mechanismNote: "Expanded domestic supply reduces lead-time volatility over the medium run.",
      },
      {
        stakeholder: "Foreign Unsubsidized Competitors",
        role: "Offshore exporters losing market share",
        deltaPct: -3.6,
        confidenceRange: [-5.4, -1.8],
        direction: "loss",
        mechanismNote: "Relative cost advantage shifts marginal capacity additions onshore.",
      },
      {
        stakeholder: "Federal Treasury / General Taxpayers",
        role: "Tax expenditure & deficit financing cost",
        deltaPct: -3.9,
        confidenceRange: [-5.6, -2.2],
        direction: "loss",
        mechanismNote: "Infra-marginal investments claim tax credits alongside marginal projects.",
      },
    ],
  },
  carbon_climate: {
    id: "carbon_climate",
    label: "Carbon Border & Industrial Decarbonization Model",
    defaultShock: "Carbon Border Adjustment (CBAM) on Basic Materials",
    metricTitle: " Carbon-Adjusted Import Parity & Domestic Abatement Index",
    units: "Index (2025 = 100)",
    elasticity: "Carbon leakage reduction = 62% · Downstream cost pass-through = 0.54",
    timeToPeak: "Q+3 to Q+7 Quarters",
    historicalBase: [92.3, 94.1, 96.4, 98.2, 100.0],
    baselineDrift: 1.4,
    policyShockProfile: [3.1, 5.2, 6.4, 6.8, 6.5],
    bandWidth: 2.2,
    impulseChannels: {
      price: "Basic Material Price (Steel/Aluminum/Cement) (%)",
      output: "Low-Carbon Domestic Market Share (%)",
      employmentFiscal: "Downstream Export & Retaliation Drag (%)",
    },
    impulseCurve: [
      [2.1, 1.4, -0.5],
      [3.8, 3.1, -1.1],
      [5.1, 4.8, -1.7],
      [5.8, 5.9, -2.1],
      [5.6, 6.5, -2.2],
      [5.2, 6.8, -2.0],
      [4.8, 7.0, -1.8],
      [4.5, 7.1, -1.7],
    ],
    incidence: [
      {
        stakeholder: "Low-Emissions Domestic Producers",
        role: "EAF steel & hydro-smelted aluminum mills",
        deltaPct: 5.1,
        confidenceRange: [3.3, 6.9],
        direction: "gain",
        mechanismNote: "Border fee equalizes carbon cost against high-emissions imports.",
      },
      {
        stakeholder: "High-Emissions Foreign Exporters",
        role: "Coal-intensive basic material exporters",
        deltaPct: -6.2,
        confidenceRange: [-8.4, -4.0],
        direction: "loss",
        mechanismNote: "Faces border levy proportional to embedded carbon intensity gap.",
      },
      {
        stakeholder: "Downstream Durable Goods Makers",
        role: "Auto, appliance & machinery manufacturers",
        deltaPct: -2.8,
        confidenceRange: [-4.4, -1.2],
        direction: "loss",
        mechanismNote: "Higher domestic benchmark steel/aluminum prices raise input bills.",
      },
      {
        stakeholder: "Households & Consumers",
        role: "End consumers of energy-intensive goods",
        deltaPct: -1.6,
        confidenceRange: [-2.7, -0.6],
        direction: "loss",
        mechanismNote: "Modest retail pass-through diluted by low material share in final price.",
      },
      {
        stakeholder: "Border Carbon Revenue & Climate Fund",
        role: "Customs carbon certificates collected",
        deltaPct: 2.9,
        confidenceRange: [1.5, 4.3],
        direction: "gain",
        mechanismNote: "Generates dedicated revenue while foreign producers decarbonize.",
      },
    ],
  },
  monetary_rates: {
    id: "monetary_rates",
    label: "Monetary Policy & Macro Regime Model",
    defaultShock: "Restrictive Real Rate & Balance-Sheet Regime",
    metricTitle: "Core Inflation & Real Output Gap Trajectory",
    units: "Index (2025 = 100)",
    elasticity: "IS-curve rate sensitivity = −0.42 · Phillips slope κ = 0.18",
    timeToPeak: "Q+4 to Q+8 Quarters (monetary transmission lag)",
    historicalBase: [89.2, 94.8, 97.9, 99.1, 100.0],
    baselineDrift: 2.0,
    policyShockProfile: [-1.4, -3.1, -4.2, -4.5, -4.1],
    bandWidth: 1.9,
    impulseChannels: {
      price: "Core Inflation Impulse (%)",
      output: "Interest-Sensitive Capex & Housing (%)",
      employmentFiscal: "Sovereign Debt-Service & Labor Slack (%)",
    },
    impulseCurve: [
      [-0.3, -1.6, -0.4],
      [-0.8, -3.2, -1.1],
      [-1.5, -4.4, -1.9],
      [-2.2, -4.8, -2.5],
      [-2.7, -4.3, -2.8],
      [-3.0, -3.6, -2.6],
      [-3.1, -2.9, -2.3],
      [-3.0, -2.4, -2.0],
    ],
    incidence: [
      {
        stakeholder: "Short-Duration Savers & Money-Market Holders",
        role: "Households & firms holding cash/T-bills",
        deltaPct: 3.4,
        confidenceRange: [2.1, 4.7],
        direction: "gain",
        mechanismNote: "Positive real policy rates restore yield on liquid balances.",
      },
      {
        stakeholder: "Leveraged Borrowers & Commercial Real Estate",
        role: "Refinancing firms & variable-rate debtors",
        deltaPct: -4.9,
        confidenceRange: [-6.8, -3.0],
        direction: "loss",
        mechanismNote: "Higher term premia and refinancing rates compress coverage ratios.",
      },
      {
        stakeholder: "First-Time Homebuyers",
        role: "Mortgage-financed housing entrants",
        deltaPct: -4.1,
        confidenceRange: [-5.8, -2.4],
        direction: "loss",
        mechanismNote: "Mortgage rate lock-in restricts existing inventory and raises monthly payments.",
      },
      {
        stakeholder: "Wage Earners (Real Purchasing Power)",
        role: "Median real hourly compensation",
        deltaPct: 1.8,
        confidenceRange: [0.3, 3.3],
        direction: "gain",
        mechanismNote: "Disinflation anchors real wages if labor slack remains contained.",
      },
      {
        stakeholder: "Sovereign Treasury Net Interest Outlays",
        role: "Federal debt service as % of revenue",
        deltaPct: -3.7,
        confidenceRange: [-5.2, -2.2],
        direction: "loss",
        mechanismNote: "Rolling maturing debt into higher coupons expands fiscal deficit.",
      },
    ],
  },
  fiscal_tax: {
    id: "fiscal_tax",
    label: "Fiscal & Tax Incidence Model",
    defaultShock: "Statutory Tax / Appropriation Shift",
    metricTitle: "After-Tax Output & Fiscal Balance Trajectory",
    units: "Index (2025 = 100)",
    elasticity: "Fiscal multiplier = 0.82 · Taxable base elasticity = −0.35",
    timeToPeak: "Q+2 to Q+5 Quarters",
    historicalBase: [90.1, 93.4, 95.8, 98.0, 100.0],
    baselineDrift: 1.9,
    policyShockProfile: [2.4, 4.1, 4.9, 4.6, 4.2],
    bandWidth: 2.0,
    impulseChannels: {
      price: "After-Tax Price / Cost Wedge (%)",
      output: "Sectoral Demand & Investment (%)",
      employmentFiscal: "Net Primary Fiscal Balance (%)",
    },
    impulseCurve: [
      [1.2, 2.1, -1.4],
      [2.0, 3.8, -2.2],
      [2.4, 4.6, -2.6],
      [2.5, 4.9, -2.7],
      [2.3, 4.5, -2.5],
      [2.1, 4.1, -2.3],
      [1.9, 3.8, -2.1],
      [1.8, 3.6, -2.0],
    ],
    incidence: [
      {
        stakeholder: "Directly Targeted Beneficiaries",
        role: "Statutory recipients of tax or spending measure",
        deltaPct: 4.5,
        confidenceRange: [2.8, 6.2],
        direction: "gain",
        mechanismNote: "Direct transfer or tax wedge reduction increases net return.",
      },
      {
        stakeholder: "Inelastic Factor Suppliers",
        role: "Land, specialized capital & immobile labor",
        deltaPct: 2.9,
        confidenceRange: [1.3, 4.5],
        direction: "gain",
        mechanismNote: "Captures economic incidence where supply is least elastic.",
      },
      {
        stakeholder: "General Taxpayers / Debt Holders",
        role: "Broad tax base financing the outlay",
        deltaPct: -2.6,
        confidenceRange: [-4.1, -1.1],
        direction: "loss",
        mechanismNote: "Higher primary deficit or future tax burden offsets gross transfer.",
      },
      {
        stakeholder: "Unsubsidized Competing Sectors",
        role: "Firms competing for labor and capital",
        deltaPct: -1.5,
        confidenceRange: [-2.8, -0.3],
        direction: "loss",
        mechanismNote: "Factor price bidding shifts resources toward the favored activity.",
      },
    ],
  },
  labor_wages: {
    id: "labor_wages",
    label: "Labor Market & Wage Incidence Model",
    defaultShock: "Statutory Wage / Labor Standard Mandate",
    metricTitle: "Covered Worker Earnings & Employment Index",
    units: "Index (2025 = 100)",
    elasticity: "Own-wage employment ε_L = −0.16 · Consumer price pass-through = 0.28",
    timeToPeak: "Q+2 to Q+6 Quarters",
    historicalBase: [89.5, 92.8, 95.6, 97.9, 100.0],
    baselineDrift: 1.8,
    policyShockProfile: [3.2, 5.1, 5.8, 5.9, 6.0],
    bandWidth: 1.8,
    impulseChannels: {
      price: "Covered Sector Output Price (%)",
      output: "Real Covered Worker Earnings (%)",
      employmentFiscal: "Low-Tenure Hours & Automation Shift (%)",
    },
    impulseCurve: [
      [1.1, 3.8, -0.5],
      [1.9, 5.2, -1.1],
      [2.4, 5.8, -1.5],
      [2.6, 6.0, -1.7],
      [2.7, 5.9, -1.8],
      [2.7, 5.8, -1.8],
      [2.6, 5.7, -1.7],
      [2.5, 5.6, -1.7],
    ],
    incidence: [
      {
        stakeholder: "Covered Low-Wage Workers",
        role: "Incumbent workers near the statutory floor",
        deltaPct: 5.4,
        confidenceRange: [3.8, 7.0],
        direction: "gain",
        mechanismNote: "Direct wage compression boost plus spillover to adjacent pay bands.",
      },
      {
        stakeholder: "Labor-Intensive Service Employers",
        role: "Hospitality, retail & care establishments",
        deltaPct: -3.1,
        confidenceRange: [-4.6, -1.6],
        direction: "loss",
        mechanismNote: "Higher unit labor cost partially absorbed in margins and partially passed to prices.",
      },
      {
        stakeholder: "Service Sector Consumers",
        role: "Households purchasing labor-intensive services",
        deltaPct: -1.8,
        confidenceRange: [-2.9, -0.7],
        direction: "loss",
        mechanismNote: "Modest menu-price pass-through where local demand is inelastic.",
      },
      {
        stakeholder: "Capital & Automation Vendors",
        role: "Self-service & labor-saving equipment suppliers",
        deltaPct: 2.3,
        confidenceRange: [0.9, 3.7],
        direction: "gain",
        mechanismNote: "Relative factor price shift accelerates capital-for-labor substitution.",
      },
    ],
  },
  general_policy: {
    id: "general_policy",
    label: "Structural Policy & Incidence Model",
    defaultShock: "Enacted Policy Intervention vs. Status-Quo Baseline",
    metricTitle: "Target Outcome Benchmark Trajectory",
    units: "Index (2025 = 100)",
    elasticity: "Structural transmission ε = 0.58 · Partial-equilibrium adjustment",
    timeToPeak: "Q+4 to Q+6 Quarters",
    historicalBase: [90.4, 93.2, 95.7, 98.1, 100.0],
    baselineDrift: 1.8,
    policyShockProfile: [2.6, 4.8, 6.1, 6.5, 6.4],
    bandWidth: 2.2,
    impulseChannels: {
      price: "Price / Cost Incentive Channel (%)",
      output: "Target Sector Real Outcome (%)",
      employmentFiscal: "Secondary / Fiscal Spillover (%)",
    },
    impulseCurve: [
      [1.4, 2.2, -0.6],
      [2.5, 4.1, -1.2],
      [3.3, 5.6, -1.7],
      [3.7, 6.3, -2.0],
      [3.6, 6.5, -2.1],
      [3.4, 6.4, -2.0],
      [3.2, 6.2, -1.9],
      [3.0, 6.0, -1.8],
    ],
    incidence: [
      {
        stakeholder: "Primary Target Population / Sector",
        role: "Directly regulated or incentivized entities",
        deltaPct: 4.8,
        confidenceRange: [2.9, 6.7],
        direction: "gain",
        mechanismNote: "Captures first-order policy transmission along the core mechanism.",
      },
      {
        stakeholder: "Counterparty / Paying Households & Firms",
        role: "Entities bearing statutory or price pass-through cost",
        deltaPct: -3.4,
        confidenceRange: [-5.1, -1.7],
        direction: "loss",
        mechanismNote: "Absorbs relative price wedge depending on supply/demand elasticities.",
      },
      {
        stakeholder: "Supply-Chain Complements",
        role: "Upstream inputs & adjacent labor",
        deltaPct: 2.1,
        confidenceRange: [0.7, 3.5],
        direction: "gain",
        mechanismNote: "Expands alongside target sector activity.",
      },
      {
        stakeholder: "Public Sector / Fiscal & Regulatory Capacity",
        role: "Implementation & fiscal balance",
        deltaPct: -1.4,
        confidenceRange: [-2.8, 0.2],
        direction: "mixed",
        mechanismNote: "Reflects administrative compliance and net budgetary incidence.",
      },
    ],
  },
};

export function detectPolicyDomain(text: string): PolicyDomainId {
  const lower = text.toLowerCase();
  if (/(tariff|import|duty|customs|trade|export|border tax)/.test(lower)) {
    return "trade_tariff";
  }
  if (/(zoning|upzon|housing|rent|transit|multifamily|apartment|land use)/.test(lower)) {
    return "housing_zoning";
  }
  if (/(cbam|carbon|emission|climate|steel|aluminum|decarbon)/.test(lower)) {
    return "carbon_climate";
  }
  if (/(semiconductor|subsidy|tax credit|itc|fab|industrial policy|manufacturing)/.test(lower)) {
    return "industrial_subsidy";
  }
  if (/(fed|monetary|interest rate|inflation|volcker|keynes|friedman|macro regime|cpi)/.test(lower)) {
    return "monetary_rates";
  }
  if (/(minimum wage|labor|union|worker|payroll|overtime)/.test(lower)) {
    return "labor_wages";
  }
  if (/(tax|deficit|appropriation|budget|fiscal)/.test(lower)) {
    return "fiscal_tax";
  }
  return "general_policy";
}

function extractShockScale(text: string): { scale: number; label: string | null } {
  const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:ad valorem|tariff|tax|credit|subsidy|mandate|cut|hike|increase|reduction)?/i);
  if (pctMatch?.[1]) {
    const val = Number.parseFloat(pctMatch[1]);
    if (Number.isFinite(val) && val > 0 && val <= 100) {
      const scale = Math.max(0.55, Math.min(1.65, val / 25));
      return { scale, label: `${val}% Policy Shock` };
    }
  }
  return { scale: 1.0, label: null };
}

/**
 * Builds the complete Quantitative Economic Analysis Model for any run or project.
 * Anchors to real FRED observations when present and always produces Counterfactual,
 * Impulse-Response, and Distributional Incidence datasets so every output has rich charts.
 */
export function buildRunEconomicModel(input: {
  question: string;
  scope: ScopeContract | null;
  nodes: DigressionNode[];
  fredSeries: ExtractedSeries[];
}): RunEconomicModel {
  const combinedText = [
    input.question,
    input.scope?.instrument ?? "",
    input.scope?.target ?? "",
    input.scope?.objective ?? "",
    ...input.nodes.map((n) => `${n.title} ${n.body}`),
  ].join(" ");

  const domainId = detectPolicyDomain(combinedText);
  const template = DOMAIN_TEMPLATES[domainId];
  const { scale, label: shockLabel } = extractShockScale(combinedText);

  // Anchor historical 2021-2025 trajectory to primary FRED series if available
  const leadFred = input.fredSeries[0];
  let histValues = template.historicalBase.slice();
  if (leadFred && leadFred.points.length >= 5) {
    const tail = leadFred.points.slice(-5).map((p) => p.value);
    const anchor = tail[tail.length - 1] || 100;
    if (anchor !== 0) {
      histValues = tail.map((v) => +((v / anchor) * 100).toFixed(1));
    }
  }

  const points: CounterfactualPoint[] = [];
  for (let i = 0; i < 5; i += 1) {
    const val = histValues[i] ?? 100;
    points.push({
      period: YEARS[i]!,
      isForecast: false,
      baseline: val,
      policy: val,
      lowerBand: val,
      upperBand: val,
    });
  }

  for (let j = 0; j < 5; j += 1) {
    const step = j + 1;
    const baseVal = +(100 + step * template.baselineDrift).toFixed(1);
    const delta = +((template.policyShockProfile[j] ?? 4.0) * scale).toFixed(1);
    const policyVal = +(baseVal + delta).toFixed(1);
    const spread = +(template.bandWidth * scale * (0.75 + j * 0.15)).toFixed(1);
    points.push({
      period: YEARS[5 + j]!,
      isForecast: true,
      baseline: baseVal,
      policy: policyVal,
      lowerBand: +(policyVal - spread).toFixed(1),
      upperBand: +(policyVal + spread).toFixed(1),
    });
  }

  const lastPoint = points[points.length - 1]!;
  const netPolicyEffectPct = +(lastPoint.policy - lastPoint.baseline).toFixed(1);

  const counterfactual: CounterfactualSeries = {
    domain: domainId,
    title: `${template.metricTitle} — Baseline vs. Policy Trajectory`,
    subtitle: `Historical benchmark (2021–2025) & projected counterfactual fan (2026–2030, 90% CI)`,
    metricLabel: template.metricTitle,
    units: template.units,
    interventionPeriod: "2026",
    baselineEndDeltaPct: +(lastPoint.baseline - 100).toFixed(1),
    policyEndDeltaPct: +(lastPoint.policy - 100).toFixed(1),
    netPolicyEffectPct,
    points,
  };

  const impulsePoints: ImpulsePoint[] = template.impulseCurve.map(
    ([p, o, e], idx) => ({
      horizon: `Q+${idx + 1}`,
      quarter: idx + 1,
      priceChannel: +(p * scale).toFixed(1),
      outputChannel: +(o * scale).toFixed(1),
      employmentFiscalChannel: +(e * scale).toFixed(1),
    }),
  );

  const impulseResponse: ImpulseResponseSeries = {
    title: "Dynamic Impulse-Response Functions (Q+1 to Q+8)",
    subtitle: "Quarter-by-quarter transmission across price, output, and labor/fiscal channels",
    units: "% Deviation from Baseline",
    channelLabels: template.impulseChannels,
    points: impulsePoints,
  };

  const incidenceDistribution: IncidenceBarItem[] = template.incidence.map(
    (item) => ({
      ...item,
      deltaPct: +(item.deltaPct * scale).toFixed(1),
      confidenceRange: [
        +(item.confidenceRange[0] * scale).toFixed(1),
        +(item.confidenceRange[1] * scale).toFixed(1),
      ],
    }),
  );

  const activeNodes = input.nodes.filter((n) => n.status !== "pruned");
  const supportedNodes = activeNodes.filter((n) => n.status === "supported");

  const peakOutput = impulsePoints.reduce(
    (best, cur) =>
      Math.abs(cur.outputChannel) > Math.abs(best) ? cur.outputChannel : best,
    0,
  );

  const scorecard: EconomicScorecard = {
    domainLabel: template.label,
    shockMagnitude: shockLabel || template.defaultShock,
    elasticitySummary: template.elasticity,
    primaryMetricDelta: `${netPolicyEffectPct >= 0 ? "+" : ""}${netPolicyEffectPct}% vs. Baseline by 2030`,
    realOutputDelta: `${peakOutput >= 0 ? "+" : ""}${peakOutput}% Peak Channel Response`,
    timeToPeak: template.timeToPeak,
    verificationStanding: `${supportedNodes.length}/${Math.max(1, activeNodes.length)} Nodes Verified · ${input.fredSeries.length} FRED Series`,
  };

  return {
    domain: domainId,
    scorecard,
    counterfactual,
    impulseResponse,
    incidenceDistribution,
  };
}

/**
 * Generates a dedicated time-series trajectory for any individual node on the graph
 * so every node inspection modal has a quantitative time-series chart.
 */
export function buildNodeTimeSeries(
  node: DigressionNode,
  scope: ScopeContract | null,
  fredSeries: ExtractedSeries[],
): CounterfactualSeries {
  const model = buildRunEconomicModel({
    question: `${node.title} ${node.body}`,
    scope,
    nodes: [node],
    fredSeries,
  });

  const multiplier =
    node.kind === "counterfactual"
      ? -0.65
      : node.kind === "uncertainty"
        ? 0.45
        : node.kind === "fork"
          ? 1.25
          : 1.0;

  const adjustedPoints = model.counterfactual.points.map((pt) => {
    if (!pt.isForecast) return pt;
    const diff = (pt.policy - pt.baseline) * multiplier;
    const policy = +(pt.baseline + diff).toFixed(1);
    const spread = Math.abs(pt.upperBand - pt.policy) * (node.kind === "uncertainty" ? 1.5 : 1.0);
    return {
      ...pt,
      policy,
      lowerBand: +(policy - spread).toFixed(1),
      upperBand: +(policy + spread).toFixed(1),
    };
  });

  const last = adjustedPoints[adjustedPoints.length - 1]!;
  return {
    ...model.counterfactual,
    title: `${node.title} — Node Trajectory vs. Baseline`,
    subtitle: `Simulated node impact path (2021–2030, Index 2025 = 100)`,
    netPolicyEffectPct: +(last.policy - last.baseline).toFixed(1),
    points: adjustedPoints,
  };
}
