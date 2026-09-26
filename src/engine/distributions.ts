import type { Distribution } from "./types";

/** Box-Muller transform: two standard normal samples from two uniform samples */
function boxMuller(): [number, number] {
  const u1 = Math.random();
  const u2 = Math.random();
  const r = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

/** Fill a Float64Array with standard normal samples */
function fillStdNormal(out: Float64Array): void {
  for (let i = 0; i < out.length - 1; i += 2) {
    const [a, b] = boxMuller();
    out[i] = a;
    out[i + 1] = b;
  }
  if (out.length % 2 === 1) {
    out[out.length - 1] = boxMuller()[0];
  }
}

/** Sample from Beta(a, b) as Ga/(Ga+Gb) with Gamma(a,1), Gamma(b,1) draws
 *  (exact; the gammas come from Marsaglia–Tsang). For tiny shapes the
 *  U^(1/shape) boost can underflow both gammas to 0, so retry on 0/0. */
function sampleBeta(alpha: number, beta: number): number {
  for (;;) {
    const ga = sampleGamma(alpha);
    const gb = sampleGamma(beta);
    if (ga + gb > 0) return ga / (ga + gb);
  }
}

/** Sample from Gamma(shape, 1) using Marsaglia and Tsang's method */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    // Gamma(a) = Gamma(a+1) * U^(1/a)
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = boxMuller()[0];
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Generate n samples from a distribution */
/** One Binomial(trials, p) draw. Direct simulation for few trials; sequential
 *  inversion on the smaller tail when the expected count there is modest
 *  (≤ ~30 iterations); rounded normal approximation only when both n·p and
 *  n·(1−p) are at least 30, where its error is negligible. */
export function sampleBinomial(trials: number, p: number): number {
  const k = Math.max(0, Math.round(trials));
  if (k === 0 || p <= 0) return 0;
  if (p >= 1) return k;
  if (k <= 64) {
    let c = 0;
    for (let i = 0; i < k; i++) if (Math.random() < p) c++;
    return c;
  }
  // Count the rarer outcome so the inversion walk stays short
  const q = p <= 0.5 ? p : 1 - p;
  const flip = p > 0.5;
  if (k * q < 30) {
    const ratio = q / (1 - q);
    let x = 0;
    let pr = Math.pow(1 - q, k); // P(X = 0)
    let cdf = pr;
    const u = Math.random();
    while (u > cdf && x < k) {
      x++;
      pr *= ((k - x + 1) / x) * ratio;
      cdf += pr;
    }
    return flip ? k - x : x;
  }
  const [z] = boxMuller();
  return Math.min(k, Math.max(0, Math.round(k * p + Math.sqrt(k * p * (1 - p)) * z)));
}

/** Inverse standard normal CDF (Acklam's rational approximation, |err| < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425, pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function sample(dist: Distribution, n: number): Float64Array {
  const out = new Float64Array(n);

  switch (dist.type) {
    case "Normal": {
      fillStdNormal(out);
      for (let i = 0; i < n; i++) {
        out[i] = dist.mean + dist.std * out[i];
      }
      break;
    }
    case "LogNormal": {
      fillStdNormal(out);
      for (let i = 0; i < n; i++) {
        out[i] = Math.exp(dist.mu + dist.sigma * out[i]);
      }
      break;
    }
    case "Uniform": {
      for (let i = 0; i < n; i++) {
        out[i] = dist.low + (dist.high - dist.low) * Math.random();
      }
      break;
    }
    case "Triangular": {
      const { low, mode, high } = dist;
      const fc = (mode - low) / (high - low);
      for (let i = 0; i < n; i++) {
        const u = Math.random();
        if (u < fc) {
          out[i] = low + Math.sqrt(u * (high - low) * (mode - low));
        } else {
          out[i] = high - Math.sqrt((1 - u) * (high - low) * (high - mode));
        }
      }
      break;
    }
    case "Beta": {
      for (let i = 0; i < n; i++) {
        out[i] = sampleBeta(dist.alpha, dist.beta);
      }
      break;
    }
    case "Pareto": {
      // Inverse CDF: x_min / U^(1/alpha)
      const { xMin, alpha } = dist;
      const invAlpha = 1 / alpha;
      for (let i = 0; i < n; i++) {
        out[i] = xMin / Math.pow(Math.random(), invAlpha);
      }
      break;
    }
    case "Poisson": {
      const lambda = dist.lambda;
      if (lambda < 30) {
        // Knuth's algorithm for small lambda
        const L = Math.exp(-lambda);
        for (let i = 0; i < n; i++) {
          let k = 0;
          let p = 1;
          do {
            k++;
            p *= Math.random();
          } while (p > L);
          out[i] = k - 1;
        }
      } else {
        // Normal approximation for large lambda
        fillStdNormal(out);
        const sqrtLambda = Math.sqrt(lambda);
        for (let i = 0; i < n; i++) {
          out[i] = Math.max(0, Math.round(lambda + sqrtLambda * out[i]));
        }
      }
      break;
    }
    case "Binomial": {
      for (let i = 0; i < n; i++) out[i] = sampleBinomial(dist.n, dist.p);
      break;
    }
    case "StudentT": {
      // t(nu) = Normal(0,1) / sqrt(Chi2(nu)/nu)
      // Chi2(nu) = Gamma(nu/2, 2), so Chi2(nu)/nu = Gamma(nu/2) * 2/nu
      const { nu, mu, sigma } = dist;
      const halfNu = nu / 2;
      const scale = 2 / nu;
      fillStdNormal(out);
      for (let i = 0; i < n; i++) {
        const chi2 = sampleGamma(halfNu) * scale;
        out[i] = mu + sigma * (out[i] / Math.sqrt(chi2));
      }
      break;
    }
  }

  return out;
}
