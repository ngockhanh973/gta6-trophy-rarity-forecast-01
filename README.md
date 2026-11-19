# GTA VI trophy rarity forecast 01 — v5

Forecasts each GTA VI trophy's Exophase earn rate at the case target as five
quantiles (5/25/50/75/95%), scored by pinball loss on the logit scale.
Entry for the make.fun bounty `gta6-trophy-rarity-forecast-01`.

Run: `mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts`
(Node 22, stdlib only, offline, deterministic, ~0.1 s/case.)

## Model

Exophase refreshes a game's counts hours apart, so consecutive reads are
often identical and a refresh arrives as one jump in `players_tracked`.

- **Flat history** (fewer than 3 distinct snapshots, e.g. the practice
  cases): no trend can be fitted, so the model reasons about the next
  refresh. Once the page has been frozen ~3 h, a refresh is expected before
  the target: tracked players jump (first refresh documented in the kit:
  638 → 3,868, ×6.06) and the newly tracked players have barely played.
  A new cohort's earn probability is a tier/secret-weighted power law of
  the trophy's current rate, `pNew ~ w · r^1.25` (platinum 0.3, gold 0.6,
  silver 0.8, bronze 1.0, secret bronze 1.2: new players can reach early
  story chapters but not grinds, the final mission, or the platinum),
  calibrated so the cohort's total new earns match the kit-published
  first-refresh aggregates (earned 943 → 4,276; the 100% trophy takes one
  earn per new player, leaving a budget of 103 earns over the other 54
  trophies). v1's squared law implied only ~17 new earns against the
  published 3,333. Spread 0.5 logit (the refresh size is documented, so
  the remaining uncertainty is per-trophy small-number noise plus the
  tier prior).
- **Trend history** (3+ distinct snapshots, the final case): each trophy is
  fitted with four saturating families — saturating exponential (v1),
  logistic in log-time, Gompertz, power saturation — and the family with
  the lowest in-sample squared error in rate space is used for that trophy,
  so growth speed and shape are estimated per trophy instead of betting
  every trophy on one curve family. A straight logit-vs-log-time line
  extrapolates far too steeply because growth saturates. The median is
  floored at `lastCount / forecastN` (earn counts never fall; a rate only
  falls because the player base grew), with players tracked forecast by a
  log-time fit. Spread combines the random walk (0.3 logit/√day since v3,
  down from the house baseline's 0.5: on four synthetic finals the 0.5
  spread is ~2× wider than the forecasts' actual logit error), the
  picked family's residual and an uncertainty floor. Selection by
  logit-space SSE was tried and rejected: it is dominated by the near-zero
  early rates and picks the wrong family on Gompertz truth.
- **v4: growth dampening.** The fitted median's growth over the last rate
  is shrunk, `med = lastRate · (med/lastRate)^0.8` when the median exceeds
  the last rate: extrapolating 2 days of reads 4.5 days out systematically
  overshoots on the late-rising (Gompertz) synthetic, and the shrink costs
  almost nothing elsewhere (γ is flat, 0.7–0.85, across the four
  synthetics, so 0.8 is not a tuned point). Recency-weighted SSE for
  family selection was tried and rejected: with few distinct snapshots it
  destroys selection (synth3 loss 0.72 → 2.27).
- **v5: three small guards, all in the trend branch.** (1) *Headroom cap:*
  the fitted median may close at most 60% of the gap from the last rate to
  100%. A stress set with only 6 distinct snapshots (synth5, Gompertz
  late-rise) showed the failure this fixes: v4 pinned many medians at
  99.99% against truths near 50% (loss 2.09). The cap binds almost never on
  the synthetic truths (their closure ratios top out at 0.67, p95 ≤ 0.54)
  and the result is flat for k in 0.5–0.7, so 0.6 is a prior about growth
  speed, not a tuned point. (2) *Tier-asymptote shrinkage:* each trophy's
  fitted asymptote is pulled 25% toward the median fitted asymptote of its
  tier, and the growth above the last rate is rescaled by A′/A — one
  trophy's asymptote is barely identified from a handful of snapshots,
  its tier-mates pin down the plausible range. (3) *Binomial-count spread:*
  4/earnCount added to the spread in quadrature, so rare trophies (few
  earners, noisy in logit space) get a wider band and common ones do not.
  Each guard was measured alone first (headroom 0.6: mean 0.2705 → 0.2285
  on synth1–4; tier shrinkage and binomial spread each add a little more)
  and they stack without regressing any single synthetic.

## Local measurements (practice answers reconstructed from the kit's
published refresh aggregates: 04:30 read, 3,868 players, 4,276 earned,
100% trophy unchanged, other trophies ×0.2208 — proxy, not the true rates)

| model | practice loss (p00+p01) | typical miss | 90% coverage |
|---|---|---|---|
| house baseline (starter) | 1.4008 | 0.677 pp | 0.00 |
| v1 | 0.2459 | 0.042 pp | 0.98 |
| v2 | 0.1066 | 0.008 pp | 0.98 |
| v3 | 0.1066 | 0.008 pp | 0.98 |
| v4 | 0.1066 | 0.008 pp | 0.98 |
| **v5 (this entry)** | **0.1066** | **0.008 pp** | **0.98** |

Synthetic finals (2 days of reads, answer at day 7; each a different truth
family and refresh/N regime — synth3/4 were generated for v2, after v1 was
chosen, to avoid overfitting one synthetic family):

| synthetic | truth family | v1 loss | v2 loss | v3 loss | v4 loss | v5 loss |
|---|---|---|---|---|---|---|
| synth1 | saturating exponential | 0.2465 | 0.2548 | 0.1833 | 0.1698 | 0.1697 |
| synth2 | logistic in log-time | 0.2872 | 0.2805 | 0.2107 | 0.2144 | 0.2133 |
| synth3 | Gompertz, refresh 5–9 h, N saturating | 1.5776 | 0.7427 | 0.7111 | 0.5155 | 0.2893 |
| synth4 | power saturation, refresh 1–2 h, N exponential | 0.2807 | 0.2556 | 0.1779 | 0.1824 | 0.1810 |
| synth5 | Gompertz late-rise, 6 snapshots, N jumps ×1.8–4 | — | — | — | 2.0942 | 0.3731 |
| synth6 | delayed logistic, 9 snapshots, N jumps ×1.5–3 | — | — | — | 0.3694 | 0.3568 |
| synth7 | power saturation, 6 snapshots, N jumps + one ×6 | — | — | — | 0.1930 | 0.1909 |
| **mean 1–4** | | **0.5980** | **0.3834** | **0.3208** | **0.2705** | **0.2133** |
| **mean 1–7** | | | | | **0.5341** | **0.2534** |

Synth5–7 (generated for v5, after v4 was chosen, to stress the few-snapshot
regime: 6–9 distinct snapshots instead of 9–30, refreshes 6–13 h apart,
players-tracked jumping by irregular multipliers instead of smoothly) are
the harsh set: v4 collapses on synth5 (2.09) and v5 rescues it (0.37) with
no synthetic regressing against v4. The final case's snapshot count is
unknown — the house reads every 10 minutes through the final, but Exophase
refreshes on its own schedule — so the few-snapshot regime is a real risk,
not a synthetic artifact.

v3–v5 change only the trend branch, so the practice loss is unchanged
from v2; the synthetic mean improves at each step. v2 is slightly worse
than v1 only on synth1 (v1's home family: per-trophy family selection
occasionally picks a different family on rounding noise); it is better
everywhere else, and far better when the truth is not v1's family — which
is the risk that matters for the real final, whose family is unknown.

Ideas tried for v5 and rejected: median-of-4 family predictions instead of
argmin-SSE pick (much worse everywhere: synth5 2.09 → 3.62, synth6
0.37 → 1.19 — with few snapshots two or more families blow up together, so
the median is not robust); stronger growth dampening when snapshots < 8
(γ = 0.5 rescues synth5 to 0.40 alone, but hurts synth7 0.19 → 0.23 and
adds nothing on top of the headroom cap, so it was left out).
