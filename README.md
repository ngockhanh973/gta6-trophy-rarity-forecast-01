# GTA VI trophy rarity forecast 01 — v13

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

- **v10 (REJECTED): spread recalibration in the few-snapshot regime.**
  Five variants on top of v9, all scoped to snapshots ≤ 3 (the only cases
  with low coverage — synth8/10 at 0.84–0.87 vs 0.95–0.98 elsewhere),
  all measured on practice + synth1–14 with the real `main.ts` (variant
  files `var-v10*.ts` in the work dir): blanket spread multiplier ×1.5
  (v10a: mean 1–14 0.2779) and ×2.0 (v10b: 0.2874); additive +0.5 in
  quadrature (v10d: 0.2737); family-disagreement spread in quadrature,
  k = 0.5 (v10c: 0.2712) and k = 1.0 (v10e: 0.2726) — the disagreement
  version scoped to ≤ 3 only, where v6's global version was already a
  trade-off. None beats v9 (0.2713): the disagreement k = 0.5 is a
  0.0001 tie, i.e. noise (synth8 0.3981 → 0.3959, synth10 0.4743 →
  0.4729, synth12 0.2078 → 0.2106), and every other variant loses.
  Widening buys coverage — v10a takes synth8 to 0.98 and synth10 to
  0.91 — but pays more pinball than it saves, even on synth10 itself
  at ×1.5 (0.4743 → 0.4999), and heavily on synth12, whose median is
  already right (0.2078 → 0.2640 at ×1.5, → 0.3206 at ×2.0). Lesson:
  the few-snapshot coverage gap is a *median* problem (a biased median
  at 3 snapshots), not a spread problem — no width fixes it, so this
  direction is closed. No code change; best stays v9.

- **v11: trimmed mean-of-5 at ≤ 3 snapshots.** Drop the min/max
  transformed medians and average the middle three instead of taking
  the middle value (one-line change in the `medFew` computation).
  On synth1–14 it is a wash: mean 1–14 0.2713 → 0.2720, mean 1–9
  0.2584 → 0.2592 — it wins synth12 (0.2078 → 0.2015, miss 4.37 →
  4.01 pp) but loses synth8 (0.3981 → 0.4046) and synth10
  (0.4743 → 0.4833), the two old cases that motivated the median-of-5.
  The fresh-seed validation (idea 2, below) overturns that reading:
  on synth15/16, generated after v9 with new seeds, the trimmed mean
  wins BOTH — synth15 0.5109 → 0.4972, synth16 0.4627 → 0.4295
  (coverage 0.82 → 0.87 on synth16). Mean 1–16 0.2982 → **0.2959**;
  mean over the five 3-snapshot cases (8/10/12/15/16) 0.4108 → 0.4032.
  **Promoted to best on the expanded set, with the caveat stated
  plainly:** it misses the pre-registered mean-1–14 bar by 0.0007
  (0.26%, noise), but the fresh seeds are the unbiased arbiter — v9's
  edge on synth8/10 was partly seed-luck, and the trimmed mean wins
  the only cases the change touches (the 3-snapshot ones) by 0.0075
  on average. Practice unchanged (trend branch only). **Best is now
  v11.**

- **Fresh-seed validation (synth15/16, idea 2).** Generated after v9
  (`gen_synth1516.py` in the work dir, not committed): synth15 delayed
  logistic, seed 61, 3 snapshots, refresh 18–24 h, N ×2–5; synth16
  Gompertz late-rise, seed 63, 3 snapshots, same regime (seed 62 was
  tried first but gave 4 distinct snapshots — its 4th refresh landed
  at 59.2 h, inside the 60 h window — so the seed was changed on the
  snapshot-count criterion only, before any loss was measured).
  v9 on the fresh seeds: synth15 0.5109 (miss 9.97 pp, cov 0.85),
  synth16 0.4627 (miss 17.05 pp, cov 0.82) — both in the same bad
  range as synth8/10, so v9 did NOT win stably: its 3-snapshot median
  is not seed-luck-proof, and the trimmed mean (v11) beats it on both
  fresh cases. The 3-snapshot regime stays the worst regime on every
  seed (losses 0.40–0.51 vs 0.18–0.36 elsewhere).

- **Signed-error check (idea 3).** Measured on the v9 median (logit
  scale, `signed_err.py` in the work dir): the 3-snapshot median
  OVERSHOOTS on late-rise truth — synth8 mean +0.354 (median +0.456,
  only 31% of trophies undershoot, p90 +1.29), synth16 mean +0.511
  (median +0.654, 24% undershoot), synth10 mean +0.108 — the opposite
  of the hypothesised lag/undershoot. With only 3 points the
  early-rising families fit the early reads and extrapolate high, and
  the median across families inherits the overshoot; the headroom cap
  limits it but does not prevent it. Synth12 is balanced (mean −0.079,
  median +0.008) and synth15 near-balanced (mean +0.124, median
  0.000), so the bias is tied to late-rise truth, not to 3 snapshots
  as such. The trimmed mean (v11) does NOT fix the bias (synth8 mean
  +0.310, synth16 +0.551) — it only trims error magnitude. Consequence
  for the spread idea: if an asymmetric spread is tried, the direction
  is DOWNWARD (widen the lower tail only), not upward as originally
  sketched — the truth sits below the median on the biased cases.
  Note the pinball weights favour this direction: at τ = 0.05/0.25 a
  downward move helps overshoot truths with weights 1.9/1.5 and costs
  only 0.1/0.5 when the truth is above the median. Worth one measured
  variant (v12 candidate), scoped to ≤ 3 snapshots.

- **v12: stronger growth dampening (γ = 0.7) at ≤ 3 snapshots.** The
  median-level fix for the overshoot bias the signed-error check found:
  at ≤ 3 snapshots the dampening exponent is 0.7 instead of 0.8,
  applied both to the picked median and to each family's transformed
  median in the trimmed-mean pool, so the whole pool shifts toward the
  last rate together. It wins on every aggregate vs v11 — mean 1–9
  0.2592 → 0.2588, mean 1–12 0.2682 → 0.2675, mean 1–14 0.2720 →
  0.2714, mean 1–16 0.2959 → 0.2943 — and on the 3-snapshot mean
  0.4032 → 0.3982, winning synth8 (0.4046 → 0.4015), synth10
  (0.4833 → 0.4750), synth15 (0.4972 → 0.4939) and synth16
  (0.4295 → 0.4155), losing only synth12 (0.2015 → 0.2053, the
  balanced case where the median was already right). The win is small
  (0.0006–0.0016 on the means) but consistent across all aggregates
  and 4 of 5 targeted cases, and it follows from a measured bias
  rather than a blind sweep. Practice unchanged (trend branch only).
  **Best is now v12.**
  Two variants were measured in the same round and rejected: (a)
  asymmetric DOWNWARD spread ×1.5 at ≤ 3 (v12a) — it helps the four
  overshoot cases (synth8 0.4046 → 0.3993, synth16 0.4295 → 0.4140,
  coverage up to 0.95) but synth12 pays 0.2015 → 0.2381, wiping out
  the gains (mean 1–16 0.2962 vs v11's 0.2959, 3-snapshot mean
  0.4042 vs 0.4032); the pinball-weight argument for the direction
  was right, but the shift in logit units is too large for the many
  trophies whose truth sits just under the median. Direction closed
  unless a much smaller factor is tried. (b) γ = 0.6 at ≤ 3 (v12b) —
  mean 1–16 0.2945, mean 1–9 0.2603: it wins synth10/15/16 but loses
  synth8 (0.4154) and synth12 (0.2134), and loses to γ = 0.7 on
  every aggregate, so 0.7 — not 0.6 — is the kept value.

- **v13: asymmetric downward spread ×1.2 at ≤ 3 snapshots (on top of
  v12).** Widen only the lower tail (q05/q25 further below the median;
  median and upper quantiles unchanged). The ×1.5 version (v12a) lost
  on synth12's cost; the smaller ×1.2 factor keeps the overshoot-case
  gains while shrinking that cost (synth12 0.2053 → 0.2199 instead of
  0.2381). It wins all four fresh-seed cases — synth15 0.4939 →
  0.4896, synth16 0.4155 → 0.4046, synth17 0.4075 → 0.3992, synth18
  0.4298 → 0.4228 — and 6 of 7 three-snapshot cases, losing only
  synth12. Mean 1–16 0.2943 → 0.2938, mean 1–18 0.3081 → 0.3068,
  3-snapshot mean (7 cases) 0.4041 → 0.4008. **Caveat, stated
  plainly:** it misses the pre-registered mean-1–14 bar (0.2719 vs
  v9's 0.2713 and v12's 0.2714) — the miss is driven by that single
  synth12 case, the only satexp 3-snapshot case; every aggregate that
  includes the unbiased fresh seeds favours v13. Same promotion logic
  as v11 (which also missed the 1–14 bar and was kept on fresh-seed
  evidence). Practice unchanged. **Best is now v13.** The spread
  family is now closed: ×1.5 and ×1.2 both lose on mean 1–14, and
  ×2.0 would cost more on synth12; no further spread knob is worth
  trying.

- **Fresh-seed validation, round 2 (synth17/18, after v12).**
  `gen_synth1718.py` in the work dir, not committed: synth17 delayed
  logistic, seed 71, 3 snapshots; synth18 Gompertz late-rise, seed
  72, 3 snapshots (its 4th refresh lands at 59.4 h, after the last
  59.33 h slot, so only 3 distinct snapshots are observed). v12 holds
  up on them: v9 0.4226/0.4710, v11 0.4158/0.4397, **v12 0.4075/
  0.4298** — v12 beats v9 and v11 on both, so the γ = 0.7 scope is
  not seed-luck either. Cumulative v9 → v13 on mean 1–18: 0.3147 →
  0.3068.

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
| v9 | 0.1066 | 0.008 pp | 0.98 |
| v11 | 0.1066 | 0.008 pp | 0.98 |
| v12 | 0.1066 | 0.008 pp | 0.98 |
| **v13 (this entry)** | **0.1066** | **0.008 pp** | **0.98** |
| v7 (rejected) | 0.1066 | 0.008 pp | 0.98 |

Synthetic finals (2 days of reads, answer at day 7; each a different truth
family and refresh/N regime — synth3/4 were generated for v2, after v1 was
chosen, to avoid overfitting one synthetic family):

| synthetic | truth family | v1 loss | v2 loss | v3 loss | v4 loss | v5 loss | v6 loss | v7 loss | v8 loss | v9 loss | v11 loss | v12 loss | v13 loss |
|---|---|---|---|---|---|---|---|---|---|
| synth1 | saturating exponential | 0.2465 | 0.2548 | 0.1833 | 0.1698 | 0.1697 | 0.1697 | 0.1697 | 0.1697 | 0.1697 | 0.1697 | 0.1697 | 0.1697 |
| synth2 | logistic in log-time | 0.2872 | 0.2805 | 0.2107 | 0.2144 | 0.2133 | 0.2133 | 0.2133 | 0.2133 | 0.2133 | 0.2133 | 0.2133 | 0.2133 |
| synth3 | Gompertz, refresh 5–9 h, N saturating | 1.5776 | 0.7427 | 0.7111 | 0.5155 | 0.2893 | 0.2893 | 0.2893 | 0.2893 | 0.2974 | 0.2974 | 0.2974 | 0.2974 |
| synth4 | power saturation, refresh 1–2 h, N exponential | 0.2807 | 0.2556 | 0.1779 | 0.1824 | 0.1810 | 0.1810 | 0.1810 | 0.1810 | 0.1810 | 0.1810 | 0.1810 | 0.1810 |
| synth5 | Gompertz late-rise, 6 snapshots, N jumps ×1.8–4 | — | — | — | 2.0942 | 0.3731 | 0.3731 | 0.3731 | 0.3731 | 0.3348 | 0.3348 | 0.3348 | 0.3348 |
| synth6 | delayed logistic, 9 snapshots, N jumps ×1.5–3 | — | — | — | 0.3694 | 0.3568 | 0.3568 | 0.3568 | 0.3568 | 0.3568 | 0.3568 | 0.3568 | 0.3568 |
| synth7 | power saturation, 6 snapshots, N jumps + one ×6 | — | — | — | 0.1930 | 0.1909 | 0.1909 | 0.1909 | 0.1909 | 0.1909 | 0.1909 | 0.1909 | 0.1909 |
| synth8 | Gompertz late-rise, **3 snapshots**, N jumps ×2–5 | — | — | — | 3.2039 | 0.5879 | 0.4668 | 0.5837 | 0.4668 | 0.3981 | 0.4046 | 0.4015 | 0.3992 |
| synth9 | power saturation, 4 snapshots, N jumps ×2–4 | — | — | — | 0.1856 | 0.1838 | 0.1948 | 0.1852 | 0.1838 | 0.1838 | 0.1838 | 0.1838 | 0.1838 |
| synth10 | delayed logistic, **3 snapshots**, N jumps ×2–5 | — | — | — | — | 0.4501 | 0.4893 | 0.4646 | 0.4893 | 0.4743 | 0.4833 | 0.4750 | 0.4701 |
| synth11 | saturating exponential, 4 snapshots, N jumps ×2–4 | — | — | — | — | 0.1934 | 0.2001 | 0.1951 | 0.1934 | 0.2010 | 0.2010 | 0.2010 | 0.2010 |
| synth12 | saturating exponential, **3 snapshots**, N jumps ×2–5 | — | — | — | — | 0.2503 | 0.2033 | 0.2497 | 0.2033 | 0.2078 | 0.2015 | 0.2053 | 0.2199 |
| synth13 | Gompertz late-rise, 4 snapshots, N jumps ×2–4 | — | — | — | — | 0.3247 | 0.4485 | 0.3428 | 0.3247 | 0.2869 | 0.2869 | 0.2869 | 0.2869 |
| synth14 | delayed logistic, 4 snapshots, N jumps ×2–4 | — | — | — | — | 0.3055 | 0.3982 | 0.3104 | 0.3055 | 0.3022 | 0.3022 | 0.3022 | 0.3022 |
| synth15 | delayed logistic, **3 snapshots**, N jumps ×2–5, fresh seed 61 | — | — | — | — | — | — | — | — | 0.5109 | 0.4972 | 0.4939 | 0.4896 |
| synth16 | Gompertz late-rise, **3 snapshots**, N jumps ×2–5, fresh seed 63 | — | — | — | — | — | — | — | — | 0.4627 | 0.4295 | 0.4155 | 0.4046 |
| synth17 | delayed logistic, **3 snapshots**, N jumps ×2–5, fresh seed 71 | — | — | — | — | — | — | — | — | 0.4226 | 0.4158 | 0.4075 | 0.3992 |
| synth18 | Gompertz late-rise, **3 snapshots**, N jumps ×2–5, fresh seed 72 | — | — | — | — | — | — | — | — | 0.4710 | 0.4397 | 0.4298 | 0.4228 |
| **mean 1–4** | | **0.5980** | **0.3834** | **0.3208** | **0.2705** | **0.2133** | **0.2133** | **0.2133** | **0.2133** | **0.2154** | **0.2154** | **0.2154** | **0.2154** |
| **mean 1–7** | | | | | **0.5341** | **0.2534** | **0.2534** | **0.2534** | **0.2534** | **0.2491** | **0.2491** | **0.2491** | **0.2491** |
| **mean 1–9** | | | | | **0.7920** | **0.2829** | **0.2706** | **0.2825** | **0.2694** | **0.2584** | **0.2592** | **0.2588** | **0.2585** |
| **mean 1–12** | | | | | | **0.2866** | **0.2774** | **0.2877** | **0.2759** | **0.2674** | **0.2682** | **0.2675** | **0.2682** |
| **mean 1–14** | | | | | | **0.2907** | **0.2982** | **0.2932** | **0.2815** | **0.2713** | **0.2720** | **0.2714** | **0.2719** |
| **mean 1–16** | | | | | | | | | | **0.2982** | **0.2959** | **0.2943** | **0.2938** |
| **mean 1–18** | | | | | | | | | | **0.3147** | **0.3105** | **0.3081** | **0.3068** |
| **mean 3-snap (8/10/12/15/16/17/18)** | | | | | | | | | | **0.4211** | **0.4102** | **0.4041** | **0.4008** |

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

Next ideas worth trying for v14 (the v12/v13 rounds closed the spread
family — ×1.5 rejected, ×1.2 kept — and the γ knob — 0.6 rejected,
0.7 kept; do not re-sweep either):
1. *SSE-weighted trimmed mean at ≤ 3 snapshots* — the one median idea
   not yet tried: weight the middle three families by in-sample SSE
   (better-fitting families count more) instead of a flat average.
   Risky: v7 showed in-sample SSE cannot separate right from wrong
   picks at 3–4 points, so the weights may be noise — measure on
   synth1–18 and keep only a clear win on the 3-snapshot mean AND
   mean 1–18.
2. *More fresh 3-snapshot seeds before any further scope change* —
   the 3-snapshot verdict now rests on 7 cases; two more seeds (one
   delayed, one Gompertz) would firm up a v14 decision before the
   deadline (21/11 18:30). Note the diminishing returns: v9 → v13
   moved mean 1–18 only 0.3147 → 0.3068, and each step since v11 has
   been ~0.001–0.002 — the current family is near its ceiling, so a
   new version needs a genuinely different median rule, not another
   knob on the same one.
3. *More fresh 3-snapshot seeds* — the 3-snapshot verdict now rests on
   5 cases; one more delayed-logistic and one more Gompertz seed would
   firm up any v12 scope decision before the deadline.
