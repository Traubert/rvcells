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

/** Sample from a Beta distribution using Jöhnk's algorithm (simple, fine for prototype) */
function sampleBeta(alpha: number, beta: number): number {
  // Use the gamma-based method: Beta(a,b) = Ga/(Ga+Gb)
  const ga = sampleGamma(alpha);
  const gb = sampleGamma(beta);
  return ga / (ga + gb);
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
