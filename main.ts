// gta6-trophy-rarity-forecast-01 — v6.
//
// Forecast each GTA VI trophy's Exophase earn rate at the case target as five
// quantiles (5/25/50/75/95%), scored by pinball loss on the logit scale.
//
// v6 changes over v5 (see README for measurements):
//  - TREND branch, few snapshots only: when there are at most 4 distinct
//    snapshots, the median is the median (mean of the middle two) of the
//    four families' target medians — each first passed through the same
//    dampening + headroom-cap + floor transforms as the picked median —
//    instead of the argmin-SSE family's median. With 3-4 points the SSE
//    gaps between families are rounding noise, so picking one family bets
//    the trophy on a coin flip; the median across families is robust to
//    one family blowing up. Scoped to <= 4 snapshots (the boundary used by
//    the v6a/v6b probes): synth1-7, with 6+ snapshots, are untouched, and
//    the blanket median-of-4 that v5 rejected stays rejected.
//
// Forecast each GTA VI trophy's Exophase earn rate at the case target as five
// quantiles (5/25/50/75/95%), scored by pinball loss on the logit scale.
//
// v5 changes over v4 (see README for measurements):
//  - TREND branch: the fitted median may close at most 60% of the gap from
//    the last rate to 100% (HEADROOM_CLOSE). With few snapshots, or on
//    late-rising truth, a fitted saturating curve can blow up to ~100% while
//    the truth is near 50%; the cap binds almost never on the synthetic
//    truths (their closure ratios top out at 0.67, p95 <= 0.54) and the
//    result is flat for k in 0.5-0.7, so 0.6 is a prior, not a tuned point.
//  - TREND branch: the fitted asymptote is shrunk 25% toward the median
//    fitted asymptote of its tier (TIER_SHRINK_OWN = 0.75), and the growth
//    above the last rate is rescaled by A'/A. A single trophy's asymptote
//    is barely identified from a handful of snapshots; its tier-mates pin
//    down the plausible range.
//  - TREND branch: the spread gains a binomial-count term, 4/earnCount in
//    quadrature (earnCount = last earn count): rare trophies are noisier in
//    logit space, common ones are not.
//
// Everything is deterministic (no randomness), stdlib only, offline.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Levels scored, and the standard normal's quantile at each. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.645, -0.674, 0, 0.674, 1.645];

/** Release day began 2026-11-19T00:00:00Z; log-time is measured from here. */
const RELEASE_MS = Date.parse('2026-11-19T00:00:00Z');
/** Baseline random-walk spread, logit per square-root day. v1/v2 used the
    house baseline's 0.5; v3 lowers it to 0.3: on four synthetic finals of
    four different truth families the 0.5 spread is ~2x wider than the
    forecasts' actual logit error (90% coverage 0.98 even at 0.2), so the
    extra width only pays pinball at every trophy. 0.3, not the synthetic
    optimum (~0.2), keeps margin for the real final's unknown family and
    refresh staleness, which noiseless synthetics cannot price. */
const RW_SIGMA = 0.3;
/** First-refresh player multiplier, as documented in the kit (638 -> 3,868). */
const FIRST_REFRESH_MULT = 3868 / 638;
/** Kit-published first-refresh aggregates: players 638 -> 3,868, trophies
    earned 943 -> 4,276. The new cohort therefore earned 4,276 - 943 = 3,333
    trophy instances; every trophy already at 100% accounts for one earn per
    new player, the rest is the budget the power law below is calibrated to. */
const FIRST_REFRESH_N = 3868;
const FIRST_REFRESH_EARNED = 4276;
/** Power-law exponent for the new cohort's earn probability: a new player's
    hours played are a shrunk version of an old player's, so (for exponential
    hours) pNew ~ r^alpha with alpha = mean-hours ratio; the trophies-per-
    player ratio 943/638 vs (4276-943)/3230 ~ 1.43 points to alpha ~ 1.25-1.5. */
const NEW_COHORT_ALPHA = 1.25;
/** Tier/secret prior on the new cohort's earn probability (mild: a factor
    ~4 from platinum to early-story secret bronze). New players in their
    first hours can reach early story chapters but not grinds, the final
    mission, or the platinum. Calibrated as a group, never fitted to the
    (unpublished) per-trophy practice answers. */
const TIER_WEIGHT: Record<string, number> = {
  platinum: 0.3, gold: 0.6, silver: 0.8, bronze: 1.0,
};
const SECRET_BRONZE_WEIGHT = 1.2;
/** Growth-dampening exponent (v4): the fitted median's growth over the last
    rate is shrunk toward no growth; extrapolating 2 days of reads 4.5 days
    out systematically overshoots on late-rising truth. Flat across
    gamma 0.7-0.85 on four synthetic families, so 0.8 is not a tuned point. */
const GROWTH_DAMPEN = 0.8;
/** Headroom cap (v5): the fitted median may close at most this share of the
    gap from the last rate to 100% over the horizon. See the header comment:
    synthetic truths close at most 0.67 of the gap (p95 <= 0.54), and the
    result is flat for 0.5-0.7. */
const HEADROOM_CLOSE = 0.6;
/** Tier-asymptote shrinkage (v5): weight on a trophy's own fitted asymptote
    when pulling it toward its tier's median fitted asymptote. */
const TIER_SHRINK_OWN = 0.75;
/** Binomial-count spread (v5): numerator of the 1/earnCount variance term
    added to the spread in quadrature; rare trophies are noisier in logit
    space. */
const BINOM_SPREAD_NUM = 4;
/** Spread (logit) of the flat-branch forecast: refresh size is documented,
    so the remaining uncertainty is per-trophy small-number noise plus the
    tier prior. */
const FLAT_SPREAD = 0.5;

interface Trophy { id: number; tier: string; }
interface Read { at: string; players_tracked: number; trophies_earned?: number; rates: Array<number | null>; }
interface Case {
  id: string; at: string; horizon_minutes: number; target: string;
  trophies: Trophy[]; history: Read[];
}

const clampPct = (x: number): number => Math.min(99.99, Math.max(0.01, x));
const logit = (pct: number): number => {
  const p = clampPct(pct) / 100;
  return Math.log(p / (1 - p));
};
const invLogit = (l: number): number => 100 / (1 + Math.exp(-l));
const round4 = (x: number): number => Math.round(x * 10000) / 10000;
const hoursSinceRelease = (iso: string): number =>
  Math.max(0, (Date.parse(iso) - RELEASE_MS) / 3600000);

/** Least-squares line y ~ a + b*x; returns [a, b, residStd, seB, meanX, sxx, n]. */
function ols(xs: number[], ys: number[]): [number, number, number, number, number, number, number] {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const b = sxx > 1e-12 ? sxy / sxx : 0;
  const a = my - b * mx;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (ys[i] - (a + b * xs[i])) ** 2;
  const resid = n > 2 ? Math.sqrt(rss / (n - 2)) : 0;
  const seB = sxx > 1e-12 ? resid / Math.sqrt(sxx) : 0;
  return [a, b, resid, seB, mx, sxx, n];
}

/** Quantiles for a median logit m and spread s, as rounded percents, non-decreasing. */
function quantiles(m: number, s: number): number[] {
  const qs = Z.map((z) => round4(clampPct(invLogit(m + z * s))));
  for (let i = 1; i < qs.length; i++) if (qs[i] < qs[i - 1]) qs[i] = qs[i - 1];
  return qs;
}

function forecastCase(c: Case): Array<{ id: number; q: number[] }> {
  const targetH = hoursSinceRelease(c.target);
  const horizonDays = c.horizon_minutes / 1440;
  const xStar = Math.log1p(targetH);
  const nT = c.trophies.length;

  // Distinct snapshots only: identical consecutive reads are one refresh.
  const snaps: Read[] = [];
  for (const r of c.history) {
    const prev = snaps[snaps.length - 1];
    if (prev && prev.players_tracked === r.players_tracked &&
      prev.rates.every((v, i) => v === r.rates[i])) continue;
    snaps.push(r);
  }
  const last = c.history[c.history.length - 1];
  const lastN = last.players_tracked;

  // ---- Branch 1: flat history — reason about the next refresh. ----
  if (snaps.length < 3) {
    const firstAt = Date.parse(c.history[0].at);
    const frozenH = Math.max(0, (Date.parse(c.at) - firstAt) / 3600000);
    // A refresh is expected before the target once the page has been frozen
    // for about a refresh cadence (launch night: frozen 3h+ at 03:00, and
    // the page was already frozen before the first read).
    const refreshExpected = frozenH >= 3;
    const nStar = refreshExpected ? lastN * FIRST_REFRESH_MULT : lastN;
    const dN = Math.max(0, nStar - lastN);
    // Calibrate the new cohort's earn law to the kit-published aggregates:
    // pNew_j = scale * w_j * (r_j/100)^alpha (as a fraction), with scale
    // solved so the cohort's new earns over the non-100% trophies equal the
    // published budget (earned 4,276 minus the old 943, minus one earn per
    // new player for each trophy already at 100%).
    let scale = 0;
    if (refreshExpected && dN > 0) {
      const oldEarned = last.trophies_earned ??
        c.trophies.reduce((s, _t, i) => s + ((last.rates[i] ?? 0) / 100) * lastN, 0);
      const nFull = c.trophies.reduce((s, _t, i) => s + ((last.rates[i] ?? 0) >= 100 ? 1 : 0), 0);
      const budget = FIRST_REFRESH_EARNED - oldEarned - nFull * dN;
      let denom = 0;
      for (let i = 0; i < nT; i++) {
        const r = last.rates[i] ?? 0;
        if (r >= 100) continue;
        const w = c.trophies[i].tier === 'bronze' && c.trophies[i].secret
          ? SECRET_BRONZE_WEIGHT : (TIER_WEIGHT[c.trophies[i].tier] ?? 1.0);
        denom += w * Math.pow(r / 100, NEW_COHORT_ALPHA) * dN;
      }
      scale = budget > 0 && denom > 0 ? budget / denom : 0;
    }
    return c.trophies.map((t, i) => {
      const r = last.rates[i] ?? 0;
      if (r >= 100) return { id: t.id, q: quantiles(logit(100), 0.05) };
      const w = t.tier === 'bronze' && t.secret
        ? SECRET_BRONZE_WEIGHT : (TIER_WEIGHT[t.tier] ?? 1.0);
      // New cohort's earn probability (percent): scale * w * r^alpha, with
      // r in percent units — a 1% trophy's newcomers earn it at ~0.07%,
      // not ~0.01% as v1's squared law had it (which implied ~17 new earns
      // in total against the published 3,333).
      const pNew = scale * w * Math.pow(r / 100, NEW_COHORT_ALPHA) * 100;
      const count = (r / 100) * lastN + (pNew / 100) * dN;
      const med = (count / nStar) * 100;
      const spread = refreshExpected ? FLAT_SPREAD : RW_SIGMA * Math.sqrt(horizonDays);
      return { id: t.id, q: quantiles(logit(med), Math.max(spread, 0.3)) };
    });
  }

  // ---- Branch 2: trend history — one saturating family per trophy. ----
  // A straight line of logit(rate) against log-time extrapolates far too
  // steeply (early growth is fast, late growth flattens as trophies
  // saturate), so each trophy is fitted with a saturating curve in rate
  // space. v1 bet everything on one family (saturating exponential); v2
  // fits four and keeps, per trophy, the one with the lowest in-sample
  // squared error in rate space, so each trophy's growth speed and shape
  // are estimated from its own history and a wrong family cannot drag
  // every trophy with it:
  //   satexp:   r = c + R*(1 - exp(-(t/tau)^p))      (v1's family)
  //   logistic: r = A / (1 + exp(-k*(ln(1+t) - x0)))
  //   gompertz: r = A * exp(-exp(-k*(t - t0)))
  //   power:    r = A * (t/(t+tau))^p
  // Each family's scale (c,R / A) is solved by least squares at fixed shape
  // parameters, which are grid-searched. Selection by rate-space SSE: a
  // logit-space SSE was tried and rejected — it is dominated by the near-
  // zero early rates and picks the wrong family on Gompertz truth.
  const ts = snaps.map((s) => hoursSinceRelease(s.at));
  // Forecast players tracked by a log-time fit (power-law growth).
  const xsN = snaps.map((s) => Math.log1p(hoursSinceRelease(s.at)));
  const nFit = ols(xsN, snaps.map((s) => Math.log(Math.max(1, s.players_tracked))));
  let nStar = Math.exp(nFit[0] + nFit[1] * xStar);
  nStar = Math.min(Math.max(nStar, lastN), lastN * 10);

  /** Least squares for r = A*g at fixed g, with A >= 0; returns [A, sse]. */
  const fitScale = (g: number[], rs: number[]): [number, number] => {
    let ss = 0, sgr = 0;
    for (let j = 0; j < g.length; j++) { ss += g[j] * g[j]; sgr += g[j] * rs[j]; }
    const a = ss > 1e-12 ? Math.max(0, sgr / ss) : 0;
    let sse = 0;
    for (let j = 0; j < g.length; j++) { const d = rs[j] - a * g[j]; sse += d * d; }
    return [a, sse];
  };

  const rows = c.trophies.map((t, i) => {
    const rs = snaps.map((s) => s.rates[i] ?? 0);
    // Candidate fits: [medianAtTarget, sse, predictAt(t), asymptote].
    const cands: Array<[number, number, (tj: number) => number, number]> = [];
    // 1. Saturating exponential (v1): r = c + R*g, LS for c, R >= 0.
    {
      const taus: number[] = [];
      for (let k = 0; k < 48; k++) taus.push(0.5 * Math.pow(4000, k / 47));
      let best: [number, number, number, number, number] | null = null;
      for (const tau of taus) {
        for (const p of [0.7, 1, 1.5]) {
          const g = ts.map((tj) => 1 - Math.exp(-((tj / tau) ** p)));
          let sg = 0, sgg = 0, sr = 0, sgr = 0;
          const n = g.length;
          for (let j = 0; j < n; j++) {
            sg += g[j]; sgg += g[j] * g[j]; sr += rs[j]; sgr += g[j] * rs[j];
          }
          const det = n * sgg - sg * sg;
          let cc = sr / n, rr = 0;
          if (Math.abs(det) > 1e-12) {
            rr = (n * sgr - sg * sr) / det;
            cc = (sr - rr * sg) / n;
          }
          if (rr < 0) { rr = 0; cc = sr / n; }
          if (cc < 0) cc = 0;
          let sse = 0;
          for (let j = 0; j < n; j++) {
            const d = rs[j] - (cc + rr * g[j]);
            sse += d * d;
          }
          if (best === null || sse < best[2]) best = [cc, rr, sse, tau, p];
        }
      }
      const [cc, rr, sse, tau, p] = best as [number, number, number, number, number];
      cands.push([cc + rr * (1 - Math.exp(-((targetH / tau) ** p))), sse,
        (tj) => cc + rr * (1 - Math.exp(-((tj / tau) ** p))), cc + rr]);
    }
    // 2. Logistic in log-time.
    {
      let best: [number, number, number, number] | null = null; // A,sse,k,x0
      for (const k of [0.5, 1, 1.5, 2, 3]) {
        for (const v of [2, 6, 12, 24, 48, 96, 168]) {
          const x0 = Math.log1p(v);
          const g = ts.map((tj) => 1 / (1 + Math.exp(-k * (Math.log1p(tj) - x0))));
          const [a, sse] = fitScale(g, rs);
          if (best === null || sse < best[1]) best = [a, sse, k, x0];
        }
      }
      const [a, sse, k, x0] = best as [number, number, number, number];
      cands.push([a / (1 + Math.exp(-k * (Math.log1p(targetH) - x0))), sse,
        (tj) => a / (1 + Math.exp(-k * (Math.log1p(tj) - x0))), a]);
    }
    // 3. Gompertz in linear time.
    {
      let best: [number, number, number, number] | null = null; // A,sse,k,t0
      for (const k of [0.02, 0.04, 0.08, 0.15, 0.3]) {
        for (const t0 of [0, 6, 12, 24, 48, 96]) {
          const g = ts.map((tj) => Math.exp(-Math.exp(-k * (tj - t0))));
          const [a, sse] = fitScale(g, rs);
          if (best === null || sse < best[1]) best = [a, sse, k, t0];
        }
      }
      const [a, sse, k, t0] = best as [number, number, number, number];
      cands.push([a * Math.exp(-Math.exp(-k * (targetH - t0))), sse,
        (tj) => a * Math.exp(-Math.exp(-k * (tj - t0))), a]);
    }
    // 4. Power saturation.
    {
      let best: [number, number, number, number] | null = null; // A,sse,tau,p
      for (const tau of [2, 6, 12, 24, 48, 96, 200, 400]) {
        for (const p of [0.5, 0.8, 1, 1.5, 2]) {
          const g = ts.map((tj) => (tj > 0 ? (tj / (tj + tau)) ** p : 0));
          const [a, sse] = fitScale(g, rs);
          if (best === null || sse < best[1]) best = [a, sse, tau, p];
        }
      }
      const [a, sse, tau, p] = best as [number, number, number, number];
      cands.push([a * ((targetH / (targetH + tau)) ** p), sse,
        (tj) => (tj > 0 ? a * ((tj / (tj + tau)) ** p) : 0), a]);
    }
    // Lowest in-sample SSE wins; ties keep the earliest family (satexp).
    let pick = cands[0];
    for (const cand of cands) if (cand[1] < pick[1]) pick = cand;
    let med = pick[0];
    // Counts never fall: floor the median at lastCount / forecastN.
    const lastRate = last.rates[i] ?? 0;
    const floorRate = ((lastRate / 100) * lastN) / nStar * 100;
    // v4: shrink the fitted growth over the last rate toward no growth.
    const lr = Math.max(lastRate, 0.01);
    if (med > lr) med = lr * Math.pow(med / lr, GROWTH_DAMPEN);
    // v5: close at most 60% of the remaining headroom to 100%.
    med = Math.min(med, lr + HEADROOM_CLOSE * (100 - lr));
    med = Math.min(99.99, Math.max(0.01, Math.max(med, floorRate)));
    if (lastRate >= 100) med = 99.99;
    // Spread: random walk + residual std in logit space around the picked
    // family's curve.
    let se = 0;
    for (let j = 0; j < ts.length; j++) {
      const d = logit(rs[j]) - logit(pick[2](ts[j]));
      se += d * d;
    }
    const resid = Math.sqrt(se / ts.length);
    // v5: binomial-count term — a trophy earned by few players is noisier
    // in logit space (variance ~ 1/earnCount).
    const earnCount = Math.max(1, (lastRate / 100) * lastN);
    const s = Math.min(1.5, Math.max(0.55,
      Math.sqrt((RW_SIGMA * Math.sqrt(horizonDays)) ** 2 + Math.max(resid, 0.15) ** 2 + 0.15 ** 2 + BINOM_SPREAD_NUM / earnCount)));
    // v6: median of the four families' (transformed) target medians, used
    // as the median instead of the picked family's when snapshots <= 4
    // (applied in the tier-shrinkage step below). Each family's median is
    // transformed exactly like the picked median, so the four values are
    // comparable; the median of four is the mean of the middle two.
    const xform4 = (mm: number): number => {
      let v = mm;
      if (v > lr) v = lr * Math.pow(v / lr, GROWTH_DAMPEN);
      v = Math.min(v, lr + HEADROOM_CLOSE * (100 - lr));
      return Math.min(99.99, Math.max(0.01, Math.max(v, floorRate)));
    };
    const meds4 = cands.map((cd) => xform4(cd[0])).sort((a, b) => a - b);
    const med4 = (meds4[1] + meds4[2]) / 2;
    return { id: t.id, q: quantiles(logit(med), s), med, s, lastRate, floorRate, tier: t.tier, asym: pick[3], med4 };
  });
  // v5: tier-asymptote shrinkage. A single trophy's fitted asymptote is
  // barely identified from a handful of snapshots, so pull it 25% toward
  // the median fitted asymptote of its tier and rescale the growth above
  // the last rate by A'/A, then re-apply the headroom cap and the floor.
  const byTier = new Map<string, number[]>();
  for (const r of rows) {
    const arr = byTier.get(r.tier) ?? [];
    arr.push(Math.max(0, r.asym));
    byTier.set(r.tier, arr);
  }
  const tierMed = new Map<string, number>();
  for (const [tier, arr] of byTier) {
    const srt = [...arr].sort((a, b) => a - b);
    tierMed.set(tier, srt[Math.floor(srt.length / 2)]);
  }
  return rows.map((r) => {
    const tm = tierMed.get(r.tier) ?? r.asym;
    const aPrime = TIER_SHRINK_OWN * r.asym + (1 - TIER_SHRINK_OWN) * tm;
    let m = snaps.length <= 4 ? r.med4 : r.med;
    if (m > r.lastRate && r.asym > 0) m = r.lastRate + (m - r.lastRate) * (aPrime / r.asym);
    const lr2 = Math.max(r.lastRate, 0.01);
    m = Math.min(m, lr2 + HEADROOM_CLOSE * (100 - lr2));
    m = Math.min(99.99, Math.max(0.01, Math.max(m, r.floorRate)));
    if (r.lastRate >= 100) m = 99.99;
    return { id: r.id, q: quantiles(logit(m), r.s) };
  });
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  const trophies = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ trophies })}\n`);
}
