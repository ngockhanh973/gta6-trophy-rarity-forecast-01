// gta6-trophy-rarity-forecast-01 — v1.
//
// Forecast each GTA VI trophy's Exophase earn rate at the case target as five
// quantiles (5/25/50/75/95%), scored by pinball loss on the logit scale.
//
// Model (per trophy, all in logit space, logit(p) = ln(p / (100 - p))):
//
// The page the house reads is NOT live: Exophase refreshes a game's counts on
// its own schedule, hours apart, so consecutive reads are often byte-identical
// and a refresh shows up as one jump in players_tracked with every rate
// moving at once. The forecast therefore has two branches:
//
//  1. FLAT history (fewer than 3 distinct snapshots, e.g. the practice
//     cases: every read identical). No trend can be fitted, so the model
//     reasons about the next refresh instead. The page has been frozen since
//     the first read; when the freeze is older than a refresh cadence and the
//     horizon reaches past it, a refresh is expected before the target.
//     At a refresh the tracked-player count jumps (the kit documents the
//     first one: 638 -> 3,868, x6.06) and the newly tracked players have
//     barely played, so they hold almost nothing except the trivial
//     first-minute trophy: a new cohort's earn probability for a trophy is
//     modelled as the square of its current rate (100% stays 100%, a 1%
//     trophy is ~0.01% for newcomers). The median rate is then the pooled
//     count over the enlarged player base, with a wide spread (1.0 logit)
//     because the refresh size and timing are uncertain.
//
//  2. TREND history (3+ distinct snapshots, the final case). Each trophy
//     is fitted with a saturating growth curve in rate space,
//     r(t) = c + R * (1 - exp(-(t / tau)^p)), with (tau, p) chosen by grid
//     search and (c, R) by least squares: a straight line of logit(rate)
//     against log-time extrapolates far too steeply because growth
//     saturates. Two consistency guards use the player count: players
//     tracked is forecast by a log-time fit, and a trophy's implied earn
//     count may never fall below its last observed count (counts only grow;
//     a rate only falls because the player base grew), so the median is
//     floored at lastCount / forecastN. The spread combines the baseline
//     random walk (0.5 logit per sqrt-day) and the fit's residual in logit
//     space.
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
/** Baseline random-walk spread, logit per square-root day. */
const RW_SIGMA = 0.5;
/** First-refresh player multiplier, as documented in the kit (638 -> 3,868). */
const FIRST_REFRESH_MULT = 3868 / 638;
/** Refresh cadence in hours implied by the launch-night freeze (~4.7h). */
/** Spread (logit) of the flat-branch forecast: refresh size/timing unknown. */
const FLAT_SPREAD = 1.0;

interface Trophy { id: number; tier: string; }
interface Read { at: string; players_tracked: number; rates: Array<number | null>; }
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
    return c.trophies.map((t, i) => {
      const r = last.rates[i] ?? 0;
      if (r >= 100) return { id: t.id, q: quantiles(logit(100), 0.05) };
      // New cohort's earn probability ~ rate squared (percent units):
      // the trivial trophy stays ~100% for newcomers, hard ones ~0.
      const pNew = (r * r) / 100;
      const count = (r / 100) * lastN + (pNew / 100) * dN;
      const med = (count / nStar) * 100;
      const spread = refreshExpected ? FLAT_SPREAD : RW_SIGMA * Math.sqrt(horizonDays);
      return { id: t.id, q: quantiles(logit(med), Math.max(spread, 0.3)) };
    });
  }

  // ---- Branch 2: trend history — saturating growth curve per trophy. ----
  // A straight line of logit(rate) against log-time extrapolates far too
  // steeply (early growth is fast, late growth flattens as trophies
  // saturate), so each trophy is fitted with a saturating curve in rate
  // space instead: r(t) = c + R * (1 - exp(-(t / tau)^p)), with (tau, p)
  // chosen by grid search and (c, R) by least squares at each grid point.
  // c absorbs the rate already present at the first read (players had the
  // game before the release day began); R is the trophy's ceiling.
  const ts = snaps.map((s) => hoursSinceRelease(s.at));
  // Forecast players tracked by a log-time fit (power-law growth).
  const xsN = snaps.map((s) => Math.log1p(hoursSinceRelease(s.at)));
  const nFit = ols(xsN, snaps.map((s) => Math.log(Math.max(1, s.players_tracked))));
  let nStar = Math.exp(nFit[0] + nFit[1] * xStar);
  nStar = Math.min(Math.max(nStar, lastN), lastN * 10);

  // Grid over timescale tau (hours) and shape p.
  const taus: number[] = [];
  for (let k = 0; k < 48; k++) taus.push(0.5 * Math.pow(4000, k / 47));
  const shapes = [0.7, 1, 1.5];

  return c.trophies.map((t, i) => {
    const rs = snaps.map((s) => s.rates[i] ?? 0);
    // Least squares for r = c + R*g at fixed g, with c, R >= 0.
    const fitCR = (g: number[]): [number, number, number] => {
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
      return [cc, rr, sse];
    };
    let best: [number, number, number, number, number] | null = null; // c,R,sse,tau,p
    for (const tau of taus) {
      for (const p of shapes) {
        const g = ts.map((tj) => 1 - Math.exp(-((tj / tau) ** p)));
        const [cc, rr, sse] = fitCR(g);
        if (best === null || sse < best[2]) best = [cc, rr, sse, tau, p];
      }
    }
    const [cc, rr, , tau, p] = best as [number, number, number, number, number];
    const gStar = 1 - Math.exp(-((targetH / tau) ** p));
    let med = cc + rr * gStar;
    // Counts never fall: floor the median at lastCount / forecastN.
    const lastRate = last.rates[i] ?? 0;
    const floorRate = ((lastRate / 100) * lastN) / nStar * 100;
    med = Math.min(99.99, Math.max(0.01, Math.max(med, floorRate)));
    if (lastRate >= 100) med = 99.99;
    // Spread: random walk + residual std in logit space around the curve.
    let se = 0;
    for (let j = 0; j < ts.length; j++) {
      const pred = cc + rr * (1 - Math.exp(-((ts[j] / tau) ** p)));
      const d = logit(rs[j]) - logit(pred);
      se += d * d;
    }
    const resid = Math.sqrt(se / ts.length);
    const s = Math.min(1.5, Math.max(0.55,
      Math.sqrt((RW_SIGMA * Math.sqrt(horizonDays)) ** 2 + Math.max(resid, 0.15) ** 2 + 0.15 ** 2)));
    return { id: t.id, q: quantiles(logit(med), s) };
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
