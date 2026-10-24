/**
 * Pure numerical linear algebra, OLS, Newey-West HAC covariance,
 * Student-t / Normal / Chi-Square / F p-values, ADF / KPSS stationarity,
 * and Simplex-constrained Synthetic Control optimizer.
 * Zero hardcoded economic values; operates strictly on passed data arrays.
 */

export type Matrix = number[][];

export function transpose(A: Matrix): Matrix {
  const rows = A.length;
  const cols = A[0]?.length ?? 0;
  const out: Matrix = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      out[j]![i] = A[i]![j]!;
    }
  }
  return out;
}

export function matMul(A: Matrix, B: Matrix): Matrix {
  const m = A.length;
  const k = A[0]?.length ?? 0;
  const n = B[0]?.length ?? 0;
  const out: Matrix = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i += 1) {
    for (let p = 0; p < k; p += 1) {
      const aip = A[i]![p]!;
      for (let j = 0; j < n; j += 1) {
        out[i]![j]! += aip * B[p]![j]!;
      }
    }
  }
  return out;
}

export function matVecMul(A: Matrix, v: number[]): number[] {
  return A.map((row) => row.reduce((acc, val, j) => acc + val * (v[j] ?? 0), 0));
}

/**
 * Gauss-Jordan matrix inversion with partial pivoting and tiny ridge fallback for near-singular matrices.
 */
export function invertMatrix(M: Matrix): Matrix {
  const n = M.length;
  const A: Matrix = M.map((row, i) =>
    row.map((val, j) => val + (i === j ? 1e-10 : 0)),
  );
  const I: Matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)),
  );

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    let maxVal = Math.abs(A[col]![col]!);
    for (let r = col + 1; r < n; r += 1) {
      const abs = Math.abs(A[r]![col]!);
      if (abs > maxVal) {
        maxVal = abs;
        pivotRow = r;
      }
    }

    if (pivotRow !== col) {
      [A[col], A[pivotRow]] = [A[pivotRow]!, A[col]!];
      [I[col], I[pivotRow]] = [I[pivotRow]!, I[col]!];
    }

    const pivot = A[col]![col]!;
    const safePivot = Math.abs(pivot) < 1e-12 ? (pivot >= 0 ? 1e-12 : -1e-12) : pivot;
    for (let j = 0; j < n; j += 1) {
      A[col]![j]! /= safePivot;
      I[col]![j]! /= safePivot;
    }

    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = A[r]![col]!;
      if (factor === 0) continue;
      for (let j = 0; j < n; j += 1) {
        A[r]![j]! -= factor * A[col]![j]!;
        I[r]![j]! -= factor * I[col]![j]!;
      }
    }
  }

  return I;
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun 7.1.26, error < 1.5e-7).
 */
export function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

export function twoSidedPValueFromT(tStat: number, df: number): number {
  if (!Number.isFinite(tStat)) return 1;
  const absT = Math.abs(tStat);
  if (df <= 0) return 2 * (1 - normalCdf(absT));
  // Cornish-Fisher normal equivalent for Student-t
  const z =
    absT * (1 - 1 / (4 * Math.max(1, df))) /
    Math.sqrt(1 + (absT * absT) / (2 * Math.max(1, df)));
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(z))));
}

export function criticalZ(ciLevel = 0.95): number {
  if (ciLevel >= 0.99) return 2.5758;
  if (ciLevel >= 0.95) return 1.95996;
  if (ciLevel >= 0.9) return 1.64485;
  return 1.95996;
}

/**
 * Wilson-Hilferty chi-square p-value approximation.
 */
export function chiSquarePValue(chiSq: number, df: number): number {
  if (chiSq <= 0 || df <= 0) return 1;
  const k = df;
  const z =
    (Math.pow(chiSq / k, 1 / 3) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  return Math.max(0, Math.min(1, 1 - normalCdf(z)));
}

export function fTestPValue(fStat: number, df1: number, df2: number): number {
  if (fStat <= 0 || df1 <= 0 || df2 <= 0) return 1;
  return chiSquarePValue(fStat * df1, df1);
}

export type OlsHacResult = {
  betas: number[];
  standardErrors: number[];
  tStats: number[];
  pValues: number[];
  residuals: number[];
  fitted: number[];
  rSquared: number;
  rss: number;
  tss: number;
  n: number;
  k: number;
  df: number;
  covMatrix: Matrix;
  ljungBoxP: number;
  breuschPaganP: number;
};

/**
 * Ordinary Least Squares with Newey-West HAC (Bartlett kernel) covariance matrix.
 */
export function fitOlsHac(
  y: number[],
  X: Matrix,
  maxLags = 4,
): OlsHacResult {
  const n = y.length;
  const k = X[0]?.length ?? 1;
  const df = Math.max(1, n - k);

  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const XtXInv = invertMatrix(XtX);
  const Xty = matVecMul(Xt, y);
  const betas = matVecMul(XtXInv, Xty);

  const fitted = matVecMul(X, betas);
  const residuals = y.map((yi, i) => yi - (fitted[i] ?? 0));

  const yMean = y.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const tss = y.reduce((acc, yi) => acc + (yi - yMean) ** 2, 0);
  const rss = residuals.reduce((acc, e) => acc + e * e, 0);
  const rSquared = tss > 0 ? Math.max(0, Math.min(1, 1 - rss / tss)) : 0;

  // Bartlett-kernel Newey-West meat matrix S
  const S: Matrix = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let t = 0; t < n; t += 1) {
    const et2 = residuals[t]! * residuals[t]!;
    const xt = X[t]!;
    for (let i = 0; i < k; i += 1) {
      for (let j = 0; j < k; j += 1) {
        S[i]![j]! += et2 * xt[i]! * xt[j]!;
      }
    }
  }

  const L = Math.min(maxLags, Math.max(0, Math.floor(n / 3)));
  for (let l = 1; l <= L; l += 1) {
    const weight = 1 - l / (L + 1);
    for (let t = l; t < n; t += 1) {
      const prod = residuals[t]! * residuals[t - l]!;
      const xt = X[t]!;
      const xtl = X[t - l]!;
      for (let i = 0; i < k; i += 1) {
        for (let j = 0; j < k; j += 1) {
          S[i]![j]! += weight * prod * (xt[i]! * xtl[j]! + xtl[i]! * xt[j]!);
        }
      }
    }
  }

  const smallSampleCorrection = n / Math.max(1, n - k);
  const covMatrix = matMul(matMul(XtXInv, S), XtXInv).map((row) =>
    row.map((v) => v * smallSampleCorrection),
  );

  const standardErrors = betas.map((_, i) =>
    Math.sqrt(Math.max(1e-14, covMatrix[i]?.[i] ?? 0)),
  );
  const tStats = betas.map((b, i) => b / (standardErrors[i] || 1e-7));
  const pValues = tStats.map((t) => twoSidedPValueFromT(t, df));

  // Ljung-Box Q(1..min(4, n/4)) for residual autocorrelation
  const lbLags = Math.min(4, Math.max(1, Math.floor(n / 4)));
  let qStat = 0;
  if (rss > 0) {
    for (let lag = 1; lag <= lbLags; lag += 1) {
      let num = 0;
      for (let t = lag; t < n; t += 1) {
        num += residuals[t]! * residuals[t - lag]!;
      }
      const rho = num / rss;
      qStat += (n * (n + 2) * rho * rho) / Math.max(1, n - lag);
    }
  }
  const ljungBoxP = chiSquarePValue(qStat, lbLags);

  // Breusch-Pagan heteroskedasticity check: regress e_t^2 on X
  const e2 = residuals.map((e) => e * e);
  const e2Mean = e2.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const e2Tss = e2.reduce((acc, v) => acc + (v - e2Mean) ** 2, 0);
  let breuschPaganP = 0.5;
  if (e2Tss > 0 && k > 1) {
    const bpBetas = matVecMul(XtXInv, matVecMul(Xt, e2));
    const bpFitted = matVecMul(X, bpBetas);
    const bpRss = e2.reduce((acc, v, i) => acc + (v - (bpFitted[i] ?? 0)) ** 2, 0);
    const bpR2 = Math.max(0, 1 - bpRss / e2Tss);
    const lmStat = n * bpR2;
    breuschPaganP = chiSquarePValue(lmStat, k - 1);
  }

  return {
    betas,
    standardErrors,
    tStats,
    pValues,
    residuals,
    fitted,
    rSquared,
    rss,
    tss,
    n,
    k,
    df,
    covMatrix,
    ljungBoxP,
    breuschPaganP,
  };
}

/**
 * Augmented Dickey-Fuller (ADF) unit root test and KPSS stationarity statistic.
 */
export function runStationarityTests(y: number[]): {
  adfStat: number;
  adfPValue: number;
  kpssStat: number;
} {
  const n = y.length;
  if (n < 8) {
    return { adfStat: -1.5, adfPValue: 0.5, kpssStat: 0.3 };
  }

  // Δy_t = α + β t + γ y_{t-1} + δ Δy_{t-1} + e_t
  const dy: number[] = [];
  const X: Matrix = [];
  for (let t = 2; t < n; t += 1) {
    dy.push(y[t]! - y[t - 1]!);
    X.push([1, t, y[t - 1]!, y[t - 1]! - y[t - 2]!]);
  }
  const ols = fitOlsHac(dy, X, 1);
  const adfStat = ols.tStats[2] ?? -1.5;
  // MacKinnon approximate p-value mapping for constant+trend ADF
  const adfPValue =
    adfStat <= -3.96
      ? 0.01
      : adfStat <= -3.41
        ? 0.05
        : adfStat <= -3.13
          ? 0.1
          : Math.min(0.99, Math.max(0.11, normalCdf(adfStat + 2.2)));

  // KPSS level stationarity statistic
  const mean = y.reduce((a, b) => a + b, 0) / n;
  const res = y.map((v) => v - mean);
  const partialSums: number[] = [];
  let running = 0;
  for (const r of res) {
    running += r;
    partialSums.push(running);
  }
  const s2 = res.reduce((acc, r) => acc + r * r, 0) / n;
  const kpssStat =
    s2 > 0
      ? partialSums.reduce((acc, s) => acc + s * s, 0) / (n * n * s2)
      : 0;

  return {
    adfStat: +adfStat.toFixed(4),
    adfPValue: +adfPValue.toFixed(4),
    kpssStat: +kpssStat.toFixed(4),
  };
}

/**
 * Simplex-constrained Synthetic Control weight solver (w_j >= 0, sum w_j = 1)
 * via projected gradient descent on pre-period squared error.
 */
export function solveSyntheticControlWeights(
  yPre: number[],
  donorsPre: number[][], // J donors, each of length T_pre
): { weights: number[]; rmspePre: number } {
  const J = donorsPre.length;
  const T = yPre.length;
  if (J === 0 || T === 0) {
    return { weights: [], rmspePre: 0 };
  }

  let w = new Array(J).fill(1 / J);

  const projectOntoSimplex = (v: number[]): number[] => {
    const u = [...v].sort((a, b) => b - a);
    let cssv = 0;
    let rho = 0;
    for (let i = 0; i < u.length; i += 1) {
      cssv += u[i]!;
      const t = (cssv - 1) / (i + 1);
      if (u[i]! - t > 0) rho = i + 1;
    }
    const sumRho = u.slice(0, rho).reduce((a, b) => a + b, 0);
    const theta = (sumRho - 1) / Math.max(1, rho);
    return v.map((vi) => Math.max(0, vi - theta));
  };

  const lr = 0.05;
  for (let iter = 0; iter < 250; iter += 1) {
    const grad = new Array(J).fill(0);
    for (let t = 0; t < T; t += 1) {
      let synth = 0;
      for (let j = 0; j < J; j += 1) {
        synth += w[j]! * (donorsPre[j]?.[t] ?? 0);
      }
      const err = synth - yPre[t]!;
      for (let j = 0; j < J; j += 1) {
        grad[j]! += (2 / T) * err * (donorsPre[j]?.[t] ?? 0);
      }
    }
    const maxGrad = Math.max(1, ...grad.map(Math.abs));
    const stepped = w.map((wj, j) => wj - (lr / maxGrad) * grad[j]!);
    w = projectOntoSimplex(stepped);
  }

  let mse = 0;
  for (let t = 0; t < T; t += 1) {
    let synth = 0;
    for (let j = 0; j < J; j += 1) {
      synth += w[j]! * (donorsPre[j]?.[t] ?? 0);
    }
    mse += (yPre[t]! - synth) ** 2;
  }
  const rmspePre = Math.sqrt(mse / Math.max(1, T));
  return {
    weights: w.map((wj) => +wj.toFixed(4)),
    rmspePre: +rmspePre.toFixed(4),
  };
}
