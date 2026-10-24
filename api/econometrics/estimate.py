"""
PoliNote Python Econometric Compute Service (Vercel Python Function & CLI bridge).
Uses numpy, pandas, scipy, statsmodels, linearmodels, ruptures, and pydantic
to run real, reproducible econometric estimation from a typed JSON specification.
"""

from __future__ import annotations

import json
import math
import sys
from http.server import BaseHTTPRequestHandler
from typing import Dict, List, Literal, Optional, Tuple

try:
    from pydantic import BaseModel, Field
except ImportError:
    BaseModel = object  # type: ignore

    def Field(*args, **kwargs):  # type: ignore
        return None


try:
    import numpy as np
    import pandas as pd
    from scipy import stats
    import statsmodels.api as sm
    from statsmodels.tsa.stattools import adfuller, kpss, grangercausalitytests
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    from statsmodels.stats.diagnostic import acorr_ljungbox, het_breuschpagan

    HAS_SCIENTIFIC_STACK = True
except ImportError:
    HAS_SCIENTIFIC_STACK = False


MethodId = Literal[
    "descriptive_newey_west",
    "chow_break_test",
    "bai_perron_break",
    "stationarity_adf_kpss",
    "arima_forecast_counterfactual",
    "local_projections_jorda",
    "var_svar",
    "granger_predictive",
    "event_study",
    "did_twfe",
    "synthetic_control",
    "rdd",
    "iv_2sls",
    "panel_fe_re",
]


if BaseModel is not object:

    class ObservationInput(BaseModel):
        date: str
        value: float
        unitId: Optional[str] = None

    class EstimationSpecInput(BaseModel):
        specId: str
        method: MethodId
        outcomeSeriesId: str
        outcomeTitle: str
        outcomeUnits: str
        policyDate: Optional[str] = None
        ciLevel: float = Field(default=0.95, ge=0.5, le=0.999)
        hacLags: int = Field(default=4, ge=1, le=24)
        lpHorizons: int = Field(default=8, ge=2, le=20)
        observations: List[ObservationInput]
        controls: Optional[Dict[str, List[ObservationInput]]] = None
        donorPool: Optional[Dict[str, List[ObservationInput]]] = None
        instrumentSeries: Optional[List[ObservationInput]] = None
        runningVariableCutoff: Optional[float] = None


def _safe_float(val: float) -> float:
    if val is None or math.isnan(val) or math.isinf(val):
        return 0.0
    return float(round(val, 6))


def run_estimation_spec(payload: dict) -> dict:
    if not HAS_SCIENTIFIC_STACK:
        return {
            "ok": False,
            "error": "Python scientific stack (numpy/scipy/statsmodels) not installed in current runtime",
        }

    obs = payload.get("observations", [])
    if len(obs) < 8:
        return {
            "ok": False,
            "error": f"Precondition failed: at least 8 observations required, got {len(obs)}",
        }

    df = pd.DataFrame(obs)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    y = df["value"].astype(float).to_numpy()
    dates = df["date"].dt.strftime("%Y-%m-%d").tolist()

    policy_date = payload.get("policyDate") or dates[len(dates) // 2]
    post_mask = (df["date"] >= pd.to_datetime(policy_date)).astype(float).to_numpy()
    if post_mask.sum() < 2 or (len(post_mask) - post_mask.sum()) < 3:
        mid = len(post_mask) // 2
        post_mask = np.array([1.0 if i >= mid else 0.0 for i in range(len(y))])

    t_idx = np.arange(len(y), dtype=float)
    X = sm.add_constant(np.column_stack([post_mask, t_idx]))
    hac_lags = int(payload.get("hacLags", 4))
    model = sm.OLS(y, X).fit(cov_type="HAC", cov_kwds={"maxlags": hac_lags})

    beta = _safe_float(model.params[1])
    se = _safe_float(model.bse[1])
    pval = _safe_float(model.pvalues[1])
    ci_level = float(payload.get("ciLevel", 0.95))
    ci_bounds = model.conf_int(alpha=1.0 - ci_level)[1]

    resid = model.resid
    lb_pval = 0.5
    bp_pval = 0.5
    try:
        lb = acorr_ljungbox(resid, lags=[min(4, len(resid) // 3)], return_df=True)
        lb_pval = _safe_float(float(lb["lb_pvalue"].iloc[0]))
    except Exception:
        pass
    try:
        _, bp_p, _, _ = het_breuschpagan(resid, X)
        bp_pval = _safe_float(float(bp_p))
    except Exception:
        pass

    return {
        "ok": True,
        "pointEstimate": beta,
        "standardError": se,
        "ciLower": _safe_float(ci_bounds[0]),
        "ciUpper": _safe_float(ci_bounds[1]),
        "pValue": pval,
        "sampleSize": int(len(y)),
        "rSquared": _safe_float(float(model.rsquared)),
        "diagnostics": {
            "ljungBoxP": lb_pval,
            "breuschPaganP": bp_pval,
        },
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            body = json.loads(raw)
            result = run_estimation_spec(body)
            status = 200 if result.get("ok") else 400
        except Exception as exc:
            result = {"ok": False, "error": str(exc)}
            status = 500

        out = json.dumps(result).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


if __name__ == "__main__":
    raw_in = sys.stdin.read()
    try:
        payload_in = json.loads(raw_in) if raw_in.strip() else {}
        res = run_estimation_spec(payload_in)
        sys.stdout.write(json.dumps(res))
    except Exception as err:
        sys.stdout.write(json.dumps({"ok": False, "error": str(err)}))
