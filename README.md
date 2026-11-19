# GTA VI trophy rarity forecast 01 — v9

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
  fitted with five saturating families — saturating exponential (v1),
  logistic in log-time, Gompertz, power saturation, delayed logistic (v9) — and the family with
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
- **v6: median-of-4 when snapshots ≤ 4.** With 3–4 distinct snapshots the
  SSE gaps between the four families are rounding noise, so picking one
  family bets each trophy on a coin flip — synth8's bimodal error (22
  trophies overshoot, 33 undershoot). The median is instead the median
  (mean of the middle two) of the four families' target medians, each
  first passed through the same dampening + headroom-cap + floor
  transforms as the picked median, so the four values are comparable and
  one blow-up family cannot drag the trophy. Scoped to ≤ 4 snapshots
  (the boundary the v6a/v6b probes used): synth1–7, with 6+ snapshots,
  are bit-identical to v5. Synth8 0.5879 → 0.4668 (miss 18.7 → 16.8 pp,
  coverage 0.71 → 0.80); the only cost is synth9 0.1838 → 0.1948.
  The blanket median-of-4 that v5 rejected (much worse on synth5/6)
  stays rejected — the scope is what makes it work.

- **v7 (REJECTED): selection-confidence rule.** In the ≤ 4-snapshot regime
  the median-of-4 is used only when the top-two families' in-sample SSEs
  are within 20% (sse1/sse2 ≥ 0.8), else the argmin pick is kept — the idea
  was to keep synth9's good pick while still rescuing synth8. It loses on
  every threshold swept (0.1/0.2/0.5/0.7/0.8/0.9; mean 1–9 0.2776–0.2825
  vs v6's 0.2706, mean 1–12 0.2844–0.2877 vs 0.2774): with 3–4 points the
  best family fits 3–9× better in-sample than the runner-up (median SSE
  ratio 0.11–0.38), so the gate almost never fires and the rule collapses
  to ~v5 — and the ratio does not separate the cases where the pick is
  right (synth10: 0.112) from where it is wrong (synth8: 0.118).
  In-sample SSE cannot tell a confident pick from a coin flip here.
  Practice unchanged (trend branch only). Best stayed v6 until v8.

- **v8: median-of-4 scope narrowed to ≤ 3 snapshots.** At 4 snapshots the
  argmin-SSE pick is kept instead of the median. At 4 snapshots the pick
  beats the median on all four test cases, one per truth family — power
  synth9 (0.1948 → 0.1838), satexp synth11 (0.2001 → 0.1934), Gompertz
  synth13 (0.4485 → 0.3247), delayed logistic synth14 (0.3982 → 0.3055).
  The boundary was hypothesised from synth9/11 and then confirmed on two
  cases generated afterwards (synth13/14, late-rise truth — the confound
  that would have made it point-tuning), so it is a tested scope. At 3
  snapshots the median still wins 2 of 3 (synth8, synth12) and only loses
  on delayed logistic (synth10). Mean 1–9 0.2706 → 0.2694, mean 1–12
  0.2774 → 0.2759, mean 1–14 0.2982 → 0.2815 (v6's median-at-4 actually
  scores worse than plain argmin v5's 0.2907 on mean 1–14). Practice
  unchanged (trend branch only). **Best is now v8.**

- **v9: 5th family — delayed logistic.** The delayed logistic
  `A / (1 + exp(-k*(log1p(max(0,t-D)) - x0)))`, D in 6/12/24/48/72/96 h,
  k in 0.5–3, x0 = log1p(2–168), joins the candidate pool — it is the only
  synthetic truth family with no matching candidate (delayed logistic:
  synth6/10/14; D ranges 2–100 h by tier in the generators). D = 0 is
  excluded because the plain logistic already covers it, so the 5th family
  is distinct. Argmin-SSE now picks over 5 families and the few-snapshot
  median becomes the median-of-5 (middle value) at ≤ 3 snapshots. The
  delayed family also helps Gompertz late-rise truth (it can mimic a flat
  start then rise): synth5 0.3731 → 0.3348, synth13 0.3247 → 0.2869,
  synth8 0.4668 → 0.3981 (coverage 0.80 → 0.87), synth10 0.4893 → 0.4743
  (coverage 0.82 → 0.84); synth6's loss is unchanged at 0.3568 but its
  median miss halves (3.40 → 1.69 pp). Costs are small and all in the pick:
  synth3 0.2893 → 0.2974, synth11 0.1934 → 0.2010, synth12 0.2033 → 0.2078.
  Two scoped alternatives were measured and rejected: median over the
  original 4 with the 5th family as pick-only (v9b: mean 1–14 0.2750,
  synth8 0.4450 vs median-of-5's 0.3981) and extending median-of-5 to ≤ 4
  snapshots (v9c: mean 1–14 0.2851, worse than v8 — synth13 0.4170,
  synth14 0.3372), which confirms v8's ≤ 3 scope with 5 families. Mean
  1–14 0.2815 → **0.2713**, mean 1–9 0.2694 → 0.2584. **Best is now v9.**

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
| v5 | 0.1066 | 0.008 pp | 0.98 |
| v6 | 0.1066 | 0.008 pp | 0.98 |
| v8 | 0.1066 | 0.008 pp | 0.98 |
| **v9 (this entry)** | **0.1066** | **0.008 pp** | **0.98** |
| v7 (rejected) | 0.1066 | 0.008 pp | 0.98 |

Synthetic finals (2 days of reads, answer at day 7; each a different truth
family and refresh/N regime — synth3/4 were generated for v2, after v1 was
chosen, to avoid overfitting one synthetic family):

| synthetic | truth family | v1 loss | v2 loss | v3 loss | v4 loss | v5 loss | v6 loss | v7 loss | v8 loss | v9 loss |
|---|---|---|---|---|---|---|---|---|---|
| synth1 | saturating exponential | 0.2465 | 0.2548 | 0.1833 | 0.1698 | 0.1697 | 0.1697 | 0.1697 | 0.1697 | 0.1697 |
| synth2 | logistic in log-time | 0.2872 | 0.2805 | 0.2107 | 0.2144 | 0.2133 | 0.2133 | 0.2133 | 0.2133 | 0.2133 |
| synth3 | Gompertz, refresh 5–9 h, N saturating | 1.5776 | 0.7427 | 0.7111 | 0.5155 | 0.2893 | 0.2893 | 0.2893 | 0.2893 | 0.2974 |
| synth4 | power saturation, refresh 1–2 h, N exponential | 0.2807 | 0.2556 | 0.1779 | 0.1824 | 0.1810 | 0.1810 | 0.1810 | 0.1810 | 0.1810 |
| synth5 | Gompertz late-rise, 6 snapshots, N jumps ×1.8–4 | — | — | — | 2.0942 | 0.3731 | 0.3731 | 0.3731 | 0.3731 | 0.3348 |
| synth6 | delayed logistic, 9 snapshots, N jumps ×1.5–3 | — | — | — | 0.3694 | 0.3568 | 0.3568 | 0.3568 | 0.3568 | 0.3568 |
| synth7 | power saturation, 6 snapshots, N jumps + one ×6 | — | — | — | 0.1930 | 0.1909 | 0.1909 | 0.1909 | 0.1909 | 0.1909 |
| synth8 | Gompertz late-rise, **3 snapshots**, N jumps ×2–5 | — | — | — | 3.2039 | 0.5879 | 0.4668 | 0.5837 | 0.4668 | 0.3981 |
| synth9 | power saturation, 4 snapshots, N jumps ×2–4 | — | — | — | 0.1856 | 0.1838 | 0.1948 | 0.1852 | 0.1838 | 0.1838 |
| synth10 | delayed logistic, **3 snapshots**, N jumps ×2–5 | — | — | — | — | 0.4501 | 0.4893 | 0.4646 | 0.4893 | 0.4743 |
| synth11 | saturating exponential, 4 snapshots, N jumps ×2–4 | — | — | — | — | 0.1934 | 0.2001 | 0.1951 | 0.1934 | 0.2010 |
| synth12 | saturating exponential, **3 snapshots**, N jumps ×2–5 | — | — | — | — | 0.2503 | 0.2033 | 0.2497 | 0.2033 | 0.2078 |
| synth13 | Gompertz late-rise, 4 snapshots, N jumps ×2–4 | — | — | — | — | 0.3247 | 0.4485 | 0.3428 | 0.3247 | 0.2869 |
| synth14 | delayed logistic, 4 snapshots, N jumps ×2–4 | — | — | — | — | 0.3055 | 0.3982 | 0.3104 | 0.3055 | 0.3022 |
| **mean 1–4** | | **0.5980** | **0.3834** | **0.3208** | **0.2705** | **0.2133** | **0.2133** | **0.2133** | **0.2133** | **0.2154** |
| **mean 1–7** | | | | | **0.5341** | **0.2534** | **0.2534** | **0.2534** | **0.2534** | **0.2491** |
| **mean 1–9** | | | | | **0.7920** | **0.2829** | **0.2706** | **0.2825** | **0.2694** | **0.2584** |
| **mean 1–12** | | | | | | **0.2866** | **0.2774** | **0.2877** | **0.2759** | **0.2674** |
| **mean 1–14** | | | | | | **0.2907** | **0.2982** | **0.2932** | **0.2815** | **0.2713** |

Synth5–7 (generated for v5, after v4 was chosen, to stress the few-snapshot
regime: 6–9 distinct snapshots instead of 9–30, refreshes 6–13 h apart,
players-tracked jumping by irregular multipliers instead of smoothly) are
the harsh set: v4 collapses on synth5 (2.09) and v5 rescues it (0.37) with
no synthetic regressing against v4. The final case's snapshot count is
unknown — the house reads every 10 minutes through the final, but Exophase
refreshes on its own schedule — so the few-snapshot regime is a real risk,
not a synthetic artifact. Synth10–12 (generated for v7, after v6 was chosen,
to test the ≤ 4 scope's generality across families: synth10 delayed
logistic at 3 snapshots, synth11 saturating exponential at 4, synth12
saturating exponential at 3) show the scope is mixed, not universal:
v6 beats argmin on synth8 (+0.12) and synth12 (+0.05) but loses on
synth9 (−0.01), synth10 (−0.04) and synth11 (−0.01) — net mean 1–12
0.2774 vs argmin's 0.2866, so v6 still wins overall, but the 4-snapshot
cases all favour the pick, which motivates the v8 scope test. Synth13/14 (generated for v8, after the ≤ 3 hypothesis,
with late-rise truth at 4 snapshots) confirm it: the pick beats the median
by 0.12 and 0.09 there, so the scope is a tested win, not a boundary pick.

v3–v9 change only the trend branch, so the practice loss is unchanged
from v2. The synthetic mean improves at each step except v7 (rejected);
v8 and v9 improve it again. v6 changes only the
≤ 4-snapshot regime, so synth1–7 are bit-identical to v5. v2 is slightly worse
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

Boundary probe for v6 (synth8/9: only 3–4 distinct snapshots): v5 already
rescues synth8 from v4's 3.20 to 0.59, and v6's scoped median-of-4 takes it
further to 0.47 (miss 16.8 pp, coverage 0.80) — but it stays the worst case
because with 3 points the truth is bimodal, so no median rule fixes both
sides fully, and synth9 pays a small cost (0.18 → 0.19). The ≤ 4 boundary
was fixed before measuring (the v6a/v6b boundary), not tuned to synth9:
a ≤ 3 scope would have scored 0.2694 on mean 1–9, but choosing the scope
after seeing synth9 would be point-tuning on one synthetic.

Ideas tried for v6 and rejected (all measured on practice + synth1–9 with
the real `main.ts`; variant files in the work dir):
- *Per-trophy spread from family disagreement* (the v6 priority idea):
  logit-std of the four families' transformed target medians, added in
  quadrature with k = 0.25/0.5/0.75/1.0, cap 1.5 (and 2.0). Synth8
  improves monotonically with k (0.59 → 0.55 at k = 1.0, coverage up to
  0.89) but every other synthetic worsens — best net is k = 0.5 at mean
  1–9 = 0.2820 vs v5's 0.2829, with mean 1–4 worse (0.2150 vs 0.2133):
  a trade-off knob, not a win. IQR instead of std does nothing on
  synth8 (0.59); raw (untransformed) medians are worse (cap 2.0:
  synth6 0.36 → 0.41).
- *Cross-trophy growth shrinkage:* shrink each trophy's logit-growth
  toward its tier's median logit-growth (α = 0.15/0.25/0.35/0.5,
  always or ≤ 4 only). Flat plateau α = 0.15–0.35 at synth8 ≈ 0.57,
  α = 0.5 gives nothing — a real but tiny effect (mean 1–9 0.2811 at
  best, ≤ 4 scope). Adds nothing on top of median-of-4 (combo 0.2708
  vs 0.2706 alone), and neither does the disagreement spread on top
  of it (0.2700, but mean 1–4 worse at 0.2150).
- *Tier-percentile asymptote clip* (clip each fitted asymptote to its
  tier's [p25, p75] or [p10, p90] instead of the 25% shrinkage):
  worse everywhere that matters (mean 1–4 0.2290/0.2327, synth8
  0.66/0.62). The shrinkage, not a hard clip, is the right shape.

Next idea worth trying for v10: spread recalibration in the
few-snapshot regime — 90% coverage is still only 0.84–0.87 on synth8/10
after v9 (median wins there) while 0.95–0.98 elsewhere, so the band is
too narrow exactly where the median is most uncertain. Candidates: a
spread multiplier scoped to snapshots ≤ 3–4, or spread added in
quadrature from the median's own uncertainty (spread of the five
families' transformed medians). Only keep it if mean pinball loss
improves, not merely coverage — widening the band always buys coverage
and always pays pinball where the median is already right. Note the
spread knob tried for v6 (disagreement spread, k = 0.25–1.0) was a
trade-off, not a win, so a few-snapshot-scoped version must be measured
on all of synth1–14, not just synth8/10. (The v9 idea — a 5th delayed
logistic family — is done and is now the best.)
