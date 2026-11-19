# GTA VI trophy rarity forecast 01 — v19

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
- **v14 (REJECTED): SSE-weighted trimmed mean at ≤ 3 snapshots.** The
  one median idea not yet tried: weight the middle three families by
  in-sample SSE instead of a flat average. Three weight forms, each
  measured on practice + synth1–20 with the real `main.ts` (variant
  files `var-v14*.ts` in the work dir; the weights use the families'
  rate-space SSEs, temperature/floor normalised by the median SSE of
  the five so the scale is per-trophy): (a) w = 1/(SSE + 0.1·medianSSE)
  — mean 1–20 0.3185, 3-snap mean (9 cases) 0.4059; (b) w =
  exp(−SSE/medianSSE) — mean 1–20 0.3174, 3-snap 0.4033; (c) w = 1/SSE
  raw — mean 1–20 0.3215, 3-snap 0.4125. All three LOSE to v13
  (mean 1–20 0.3156, 3-snap 0.3993) on both gates, and on 7–8 of the
  9 three-snapshot cases each — only synth20 wins consistently
  (0.3944 → 0.3657/0.3677/0.3707) and synth16 marginally in (a)/(b).
  The raw 1/SSE form is worst, as expected: with 3 points one family
  often fits near-perfectly by chance, so the weights collapse toward
  the argmin pick — the exact failure v7 documented. The mechanism is
  visible in the misses: weighting pulls the median toward the
  best-fitting family, and at 3 points the best-fitting family is
  usually the early-riser that overshoots (the signed-error bias),
  so the weighted median inherits more overshoot, not less. v7's
  verdict stands and now extends to weighting: in-sample SSE cannot
  separate right from wrong families at 3 snapshots, in any form
  tried (gate, 1/SSE, exp(−SSE/T)). No code change; best stays v13.
  The SSE family is now closed alongside spread and γ.

- **v15 (REJECTED): logit-space trimmed mean at ≤ 3 snapshots.** Average
  the middle three transformed medians in logit space (mean of logit(m),
  then inv-logit) instead of rate space — the idea was that logit-averaging
  downweights a high outlier family more than rate-averaging does.
  Measured on practice + synth1–20 with the real `main.ts` (variant file
  `var-v15-logitmean.ts` in the work dir). It LOSES on both gates: mean
  1–20 0.3177 vs v13's 0.3156, 3-snapshot mean (9 cases) 0.4039 vs 0.3993;
  practice unchanged at 0.1066. It loses 7 of the 9 three-snapshot cases
  (only synth20 wins, by 0.0032; synth10 is a 0.0001 tie-loss) and the
  damage is worst exactly on the overshoot cases it was meant to fix —
  synth16 0.4046 → 0.4202, synth18 0.4228 → 0.4384, synth8 0.3992 →
  0.4028. Mechanism, measured not hypothesised: the logit-mean sits
  ABOVE the rate-mean here — the pooled medians sit near/above 50% on
  the trophies that dominate 3-snapshot error, where inv-logit is
  concave, so averaging in logit space pushes the median further UP,
  feeding the overshoot bias instead of fighting it. The "downweight
  high outliers" intuition was backwards in this rate range. No code
  change; best stays v13. The logit-averaging family is closed.

- **v16: asymmetric top-only trim at ≤ 3 snapshots (on top of v13).** The
  median is the mean of the LOWEST three of the five families' transformed
  target medians (meds5[0..2]) instead of the trimmed mean of the middle
  three — the two highest families are dropped outright, so an
  early-rising family that fits the 3 early reads and extrapolates high
  cannot drag the median. It wins BOTH gates vs v13: mean 1–20 0.3156 →
  **0.3128**, 3-snapshot mean (9 cases) 0.3993 → **0.3932**; practice
  unchanged at 0.1066. It wins 5 of the 9 three-snapshot cases — synth10
  0.4701 → 0.4335, synth20 0.3944 → 0.3381, synth17 0.3992 → 0.3792,
  synth19 0.3935 → 0.3794, synth15 0.4896 → 0.4758 — and loses 4:
  synth12 0.2199 → 0.2465 (the balanced case, the expected cost — the
  same single-case price that sank the ×1.5 spread), synth16 0.4046 →
  0.4346, synth18 0.4228 → 0.4473, synth8 0.3992 → 0.4041. Note synth16/
  18 lose on pinball even though their median miss IMPROVES (15.33 →
  13.92 pp, 13.78 → 12.69 pp): the downward shift helps the median but
  costs at the lower quantiles for the trophies whose truth sits above
  it. **Caveat, stated plainly:** two fresh seeds generated after the
  win (synth21 delayed logistic seed 101, synth22 Gompertz seed 112 —
  see below) split 1–1, mean 0.4149 → 0.4193, so the win rests on the
  20-case set; on all 22 cases v16 still wins both gates (mean 1–22
  0.3246 → 0.3225, 3-snapshot 11 cases 0.4021 → 0.3980). The effect is
  family-dependent: it helps delayed-logistic truth consistently
  (synth10/15/17/19/21 all win) and is mixed on Gompertz late-rise
  (synth20 wins big, synth16/18/22 lose). Same promotion logic as v11/
  v13 (which also carried a stated caveat). Practice unchanged.
  **Best is now v16.**

- **Fresh-seed validation, round 5 (synth23/24, before v17).**
  `gen_synth2324.py` in the work dir, not committed: synth23 delayed
  logistic, seed 121, 3 snapshots; synth24 Gompertz late-rise, seed 131,
  3 snapshots — both gave 3 distinct snapshots on the first seed tried
  (seed chosen on the snapshot-count criterion only, before any loss was
  measured). v16 on them: synth23 0.4091 (miss 5.97 pp, cov 0.93),
  synth24 0.3097 (miss 9.91 pp, cov 0.96) — the Gompertz case is the best
  3-snapshot Gompertz score yet, the delayed case in the usual bad range.
  Mean over the fresh pair 0.3594. The 3-snapshot verdict now rests on 13
  cases; on all 24 cases v16 is mean 1–24 0.3256, 3-snapshot 13-case mean
  0.3920.

- **v17 (REJECTED): Winsorize the top at ≤ 3 snapshots.** Clip the
  second-highest transformed median down to the middle value
  (`meds5[3] := meds5[2]`) before the trimmed mean of the middle three,
  so the median is `(meds5[1] + 2·meds5[2]) / 3` — the gentler cousin of
  v16, meant to cap the blow-up family instead of dropping two families
  outright, keeping v16's delayed-logistic wins while paying less on the
  balanced synth12 and the Gompertz cases v16 loses (s16/18/22).
  Measured on practice + synth1–24 with the real `main.ts` (variant file
  `var-v17-winsor.ts` in the work dir). It LOSES on both gates: mean 1–20
  0.3128 → 0.3183, 3-snapshot mean (9 cases) 0.3932 → 0.4054; on all 24
  cases mean 1–24 0.3256 → 0.3321, 3-snapshot 13-case mean 0.3920 →
  0.4040; practice unchanged at 0.1066. It wins only 3 of the 13
  three-snapshot cases — synth12 0.2465 → 0.2299 (the hoped-for saving,
  but only −0.0166), synth22 0.4570 → 0.4396, synth8 0.4041 → 0.4006 —
  and loses the other 10, worst on synth20 0.3381 → 0.3902 and synth24
  0.3097 → 0.3541 (the two best Gompertz cases under v16), and on the
  fresh pair as a whole (0.3594 → 0.3849, losing both seeds). Mechanism:
  unlike v16, Winsorize drops the LOWEST family from the average and
  double-weights the middle value, so the median sits HIGHER than v16's
  and the median miss worsens on most overshoot cases (synth20 10.78 →
  14.03 pp, synth24 9.91 → 12.83 pp) — it feeds the overshoot bias
  instead of fighting it. v16's edge comes from keeping the lowest family
  as a downward anchor, not just from capping the top.
  A second, gentler variant was measured in the same round (v17b,
  `var-v17b-winsor-mid.ts`): clip the second-highest down to the mean of
  the two middle values (`meds5[3] := (meds5[1]+meds5[2])/2`), i.e. the
  midpoint between v13's trimmed mean and v17. It also LOSES on both
  gates (mean 1–20 0.3175, 3-snapshot 9-case 0.4036; mean 1–24 0.3311,
  3-snapshot 13-case 0.4022; fresh pair 0.3788), winning only synth12
  (0.2354) and synth22 (0.4483) of the 13 — the gentler point loses
  almost as much as the hard one, so no point on this axis works. Note:
  winsorizing BOTH top families down to the middle value and then taking
  the middle-three mean is identical to v17 (the clipped max never enters
  the middle three), so it is not a separate variant. No code change;
  best stays v16. The Winsorize family is now closed alongside spread,
  γ, SSE and logit-averaging.

- **v18: adaptive trim by pool spread — low3 UNLESS the pool is extremely
  dispersed (on top of v16).** The v18 diagnostic ran BEFORE any variant was
  built (instrumented `main.ts` dump of the five transformed medians per
  trophy, `diag-main.ts`/`diag18.py`/`diag18b.py`/`diag18c.py` in the work
  dir; the dump reproduces v16/v13 case losses to 4 decimals, so the
  diagnostic is exact, not an approximation). The hypothesised direction
  was BACKWARDS. Per trophy (715 trophies, 13 three-snapshot cases),
  lowest-3 wins 286, loses 271, ties 158 (floor/cap-bound); pool range in
  logit space separates winners from losers — range > 0.5: 84% of
  win-trophies vs 44% of lose-trophies — but the gain is NOT monotone in
  dispersion: by range decile the mean gain rises +0.004 → +0.077 up to
  range ~2 logit (win share 0.33 → 0.68), then COLLAPSES in the top decile
  (range 2.01–5.70: mean gain −0.137, win share 0.38). At case level the
  pattern is the same, inverted vs the hypothesis: the cases lowest-3 wins
  (s10/15/17/19/20/21) have mean range 0.51 logit, the cases it loses
  (s8/12/16/18/22) have 1.37 — no clean case threshold exists (s12 loses
  at 0.64 while s20/s24 win at ~1.03), but the per-trophy rule is clear:
  keep lowest-3 except when the pool is EXTREMELY dispersed, where the
  low families are absurdly low (mid3 nearly unbiased there, mean signed
  error +0.11 logit vs +0.58 in the decile below) rather than the high
  families being blown up. The hypothesised rule (lowest-3 iff wide,
  mid3 iff tight) is noise: best threshold 0.3914 vs always-lowest-3
  0.3920 on the 13-case mean. The rule built is the inverted one: at
  ≤ 3 snapshots, use the middle-three trimmed mean when the five
  transformed medians' logit std is ≥ 0.8 (~10% of trophies), else
  lowest-3. It wins BOTH gates vs v16, measured with the real `main.ts`
  (variant file `var-v18-adaptive-std.ts` in the work dir): mean 1–20
  0.3128 → **0.3045**, 3-snapshot mean (9 cases) 0.3932 → **0.3748**;
  mean 1–24 0.3256 → 0.3176, 3-snapshot 13-case mean 0.3920 → 0.3773;
  practice unchanged at 0.1066. It rescues exactly the cases v16 loses
  — synth8 0.4041 → 0.3536, synth16 0.4346 → 0.3598, synth18 0.4473 →
  0.3950, synth22 0.4570 → 0.4238 — at a small cost on synth10 (+0.0095),
  synth24 (+0.0072) and synth20 (+0.0026). The threshold is flat, not a
  tuned point: std 0.7–1.25 gives 3-snap13 0.377–0.381, range 1.75–3.0
  gives 0.378–0.383, and all four dispersion measures (range/iqr/std/
  topGap, inverted) improve — the same ∩-shape seen from four angles.
  **Caveat, stated plainly:** on the fresh pair 23/24 it loses slightly
  (0.3594 → 0.3630), but on the fresh pair 25/26, generated before v18
  was built, it wins (0.4211 → 0.4043), so all four fresh seeds favour
  v18 (0.3902 → 0.3836). Same promotion logic as v11/v13/v16. Practice
  unchanged. **Best is now v18.**

- **Fresh-seed validation, round 7 (synth27/28, before v19).**
  `gen_synth2728.py` in the work dir, not committed: synth27 delayed
  logistic, seed 161, 3 snapshots; synth28 Gompertz late-rise, seed 172,
  3 snapshots — seed 172 was the second tried for synth28 (seed 171 gave
  4 distinct snapshots), seed chosen on the snapshot-count criterion only,
  before any loss was measured, and before the v19 variant existed. v18
  on them: synth27 0.4445 (miss 6.59 pp, cov 0.89), synth28 0.3194 (miss
  10.40 pp, cov 0.95) — pair mean 0.3819, in line with the earlier fresh
  pairs (23/24: 0.3594, 25/26: 0.4211). The 3-snapshot verdict now rests
  on 17 cases; on all 28 cases v18 is mean 1–28 0.3284, 3-snapshot
  17-case mean 0.3810.

- **v19: γ = 0.65 at exactly 3 snapshots (on top of v18).** The v12
  γ sweep (0.6 lost, 0.7 kept) was measured on the pre-v16/v18 base, so
  the knob was re-probed on the new base: γ = 0.65 only at 3 snapshots
  (0.7 nowhere else in the trend branch — the flat branch never reaches
  it — 0.8 at 4+), applied to the picked median AND to each family's
  transformed median in the pool, exactly as v12 scoped it. It wins
  BOTH gates vs v18, measured with the real `main.ts` (variant file
  `var-v19-gamma065.ts` in the work dir): mean 1–20 0.3045 →
  **0.3041**, 3-snapshot mean (9 cases) 0.3748 → **0.3739**; mean 1–24
  0.3176 → 0.3176, mean 1–28 0.3284 → 0.3281, 3-snapshot 17-case mean
  0.3810 → 0.3806; practice unchanged at 0.1066. Per truth family on
  the 3-snapshot cases it helps delayed-logistic (8 cases 0.4037 →
  0.3980) and costs on Gompertz (8 cases 0.3752 → 0.3795) and on the
  single satexp case (synth12 0.2465 → 0.2497). **Caveat, stated
  plainly:** the win is noise-level (0.0004–0.0009 on the gates) —
  mean 1–26 and 3-snapshot 15-case mean TIE v18 exactly (0.3243 /
  0.3809), 3-snapshot 13-case mean also ties (0.3773), and the fresh
  pair 25/26 loses by 0.0002 (synth25 wins −0.0084, synth26 loses
  +0.0089). But the fresh pair 27/28 wins (0.3819 → 0.3780), all six
  fresh seeds 23–28 win (0.3831 → 0.3804), and no expanded aggregate
  loses, so the promotion follows the same fresh-seed logic as
  v11/v13/v16/v18. Flatness check, same round: γ = 0.6 on the new base
  (variant `var-v19b-gamma06.ts`) wins the two gates by MORE (mean
  1–20 0.3032, 3-snap9 0.3717) but LOSES on the fresh pair 25/26
  (+0.0055, synth26 +0.0259), mean 1–26 (0.3250) and 3-snap15
  (0.3822) — so 0.6 is NOT kept; the γ axis is flat within noise
  (3-snap13: 0.3779/0.3773/0.3773 for 0.6/0.65/0.7) and 0.65 is the
  middle, safest point. Per-case vs v18 (13 three-snapshot cases):
  wins 8 (s10/15/17/19/20/21/23/24), loses 5 (s8 +0.0100, s16
  +0.0084, s22 +0.0208, s12 +0.0032, s18 +0.0050). Practice unchanged.
  **Best is now v19.** The γ family is now closed a second time:
  0.6/0.65/0.7 all sit within noise of each other on the expanded set.

- **Fresh-seed validation, round 6 (synth25/26, before v18).**
  `gen_synth2526.py` in the work dir, not committed: synth25 delayed
  logistic, seed 141, 3 snapshots; synth26 Gompertz late-rise, seed 151,
  3 snapshots — both gave 3 distinct snapshots on the first seed tried
  (seed chosen on the snapshot-count criterion only, before any loss was
  measured, and before the v18 variant existed). v16 on them: synth25
  0.3003 (miss 5.33 pp, cov 0.96), synth26 0.5419 (miss 11.04 pp, cov
  0.87) — the Gompertz case is the worst 3-snapshot score since synth8,
  so the regime stays the worst on every seed. v18: synth25 0.3165,
  synth26 0.4921 — the delayed case loses (+0.0162), the Gompertz case
  wins big (−0.0498), pair mean 0.4211 → 0.4043. The 3-snapshot verdict
  now rests on 15 cases; on all 26 cases v18 is mean 1–26 0.3243,
  3-snapshot 15-case mean 0.3809 (v16: 0.3329 / 0.3959).

- **Fresh-seed validation, round 4 (synth21/22, after v16).**
  `gen_synth2122.py` in the work dir, not committed: synth21 delayed
  logistic, seed 101, 3 snapshots; synth22 Gompertz late-rise, seed 112,
  3 snapshots — both gave 3 distinct snapshots on the first seed tried
  (seed 112 was the second tried for synth22: seed 111 gave 4 distinct
  snapshots, so the seed was changed on the snapshot-count criterion
  only, before any loss was measured). v13 on them: synth21 0.3978 (miss
  10.09 pp, cov 0.91), synth22 0.4320 (miss 12.11 pp, cov 0.89). v16:
  synth21 0.3817 (miss 9.14 pp, cov 0.91), synth22 0.4570 (miss 10.39
  pp, cov 0.85) — the delayed case wins, the Gompertz case loses, the
  same family split as the 20-case set. Both are in the same bad
  0.38–0.46 range as the other 3-snapshot cases, so the regime stays the
  worst on every seed. The 3-snapshot verdict now rests on 11 cases.

- **Fresh-seed validation, round 3 (synth19/20, before v14).**
  `gen_synth1920.py` in the work dir, not committed: synth19 delayed
  logistic, seed 81, 3 snapshots; synth20 Gompertz late-rise, seed 91,
  3 snapshots — both gave 3 distinct snapshots on the first seed tried
  (seed chosen on the snapshot-count criterion only, before any loss
  was measured). v13 on them: synth19 0.3935 (miss 10.24 pp, cov 0.87),
  synth20 0.3944 (miss 14.42 pp, cov 0.96) — both in the same bad
  0.39–0.49 range as synth8/10/15–18, so the 3-snapshot regime is
  still the worst regime on every seed. Mean 1–20 for v13 is 0.3156
  (mean 1–18 0.3068); 3-snapshot mean over 9 cases 0.3993 (7 cases
  0.4008). The fresh seeds also arbitrate v14: all three weight forms
  lose on synth19 (0.3935 → 0.4089–0.4135) and only win synth20, so
  the rejection is not an old-seed artifact.

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
| v13 | 0.1066 | 0.008 pp | 0.98 |
| v15 (rejected) | 0.1066 | 0.008 pp | 0.98 |
| v16 | 0.1066 | 0.008 pp | 0.98 |
| v18 | 0.1066 | 0.008 pp | 0.98 |
| **v19 (this entry)** | **0.1066** | **0.008 pp** | **0.98** |
| v17 (rejected) | 0.1066 | 0.008 pp | 0.98 |
| v7 (rejected) | 0.1066 | 0.008 pp | 0.98 |

Synthetic finals (2 days of reads, answer at day 7; each a different truth
family and refresh/N regime — synth3/4 were generated for v2, after v1 was
chosen, to avoid overfitting one synthetic family):

| synthetic | truth family | v1 loss | v2 loss | v3 loss | v4 loss | v5 loss | v6 loss | v7 loss | v8 loss | v9 loss | v11 loss | v12 loss | v13 loss | v16 loss | v18 loss | v19 loss |
|---|---|---|---|---|---|---|---|---|---|
| synth1 | saturating exponential | 0.2465 | 0.2548 | 0.1833 | 0.1698 | 0.1697 | 0.1697 | 0.1697 | 0.1697 | 0.1697 | 0.1697 | 0.1697 | 0.1697 | 0.1697 | 0.1697 | 0.1697 |
| synth2 | logistic in log-time | 0.2872 | 0.2805 | 0.2107 | 0.2144 | 0.2133 | 0.2133 | 0.2133 | 0.2133 | 0.2133 | 0.2133 | 0.2133 | 0.2133 | 0.2133 | 0.2133 | 0.2133 |
| synth3 | Gompertz, refresh 5–9 h, N saturating | 1.5776 | 0.7427 | 0.7111 | 0.5155 | 0.2893 | 0.2893 | 0.2893 | 0.2893 | 0.2974 | 0.2974 | 0.2974 | 0.2974 | 0.2974 | 0.2974 | 0.2974 |
| synth4 | power saturation, refresh 1–2 h, N exponential | 0.2807 | 0.2556 | 0.1779 | 0.1824 | 0.1810 | 0.1810 | 0.1810 | 0.1810 | 0.1810 | 0.1810 | 0.1810 | 0.1810 | 0.1810 | 0.1810 | 0.1810 |
| synth5 | Gompertz late-rise, 6 snapshots, N jumps ×1.8–4 | — | — | — | 2.0942 | 0.3731 | 0.3731 | 0.3731 | 0.3731 | 0.3348 | 0.3348 | 0.3348 | 0.3348 | 0.3348 | 0.3348 | 0.3348 |
| synth6 | delayed logistic, 9 snapshots, N jumps ×1.5–3 | — | — | — | 0.3694 | 0.3568 | 0.3568 | 0.3568 | 0.3568 | 0.3568 | 0.3568 | 0.3568 | 0.3568 | 0.3568 | 0.3568 | 0.3568 |
| synth7 | power saturation, 6 snapshots, N jumps + one ×6 | — | — | — | 0.1930 | 0.1909 | 0.1909 | 0.1909 | 0.1909 | 0.1909 | 0.1909 | 0.1909 | 0.1909 | 0.1909 | 0.1909 | 0.1909 |
| synth8 | Gompertz late-rise, **3 snapshots**, N jumps ×2–5 | — | — | — | 3.2039 | 0.5879 | 0.4668 | 0.5837 | 0.4668 | 0.3981 | 0.4046 | 0.4015 | 0.3992 | 0.4041 | 0.3536 | 0.3636 |
| synth9 | power saturation, 4 snapshots, N jumps ×2–4 | — | — | — | 0.1856 | 0.1838 | 0.1948 | 0.1852 | 0.1838 | 0.1838 | 0.1838 | 0.1838 | 0.1838 | 0.1838 | 0.1838 | 0.1838 |
| synth10 | delayed logistic, **3 snapshots**, N jumps ×2–5 | — | — | — | — | 0.4501 | 0.4893 | 0.4646 | 0.4893 | 0.4743 | 0.4833 | 0.4750 | 0.4701 | 0.4335 | 0.4430 | 0.4343 |
| synth11 | saturating exponential, 4 snapshots, N jumps ×2–4 | — | — | — | — | 0.1934 | 0.2001 | 0.1951 | 0.1934 | 0.2010 | 0.2010 | 0.2010 | 0.2010 | 0.2010 | 0.2010 | 0.2010 |
| synth12 | saturating exponential, **3 snapshots**, N jumps ×2–5 | — | — | — | — | 0.2503 | 0.2033 | 0.2497 | 0.2033 | 0.2078 | 0.2015 | 0.2053 | 0.2199 | 0.2465 | 0.2465 | 0.2497 |
| synth13 | Gompertz late-rise, 4 snapshots, N jumps ×2–4 | — | — | — | — | 0.3247 | 0.4485 | 0.3428 | 0.3247 | 0.2869 | 0.2869 | 0.2869 | 0.2869 | 0.2869 | 0.2869 | 0.2869 |
| synth14 | delayed logistic, 4 snapshots, N jumps ×2–4 | — | — | — | — | 0.3055 | 0.3982 | 0.3104 | 0.3055 | 0.3022 | 0.3022 | 0.3022 | 0.3022 | 0.3022 | 0.3022 | 0.3022 |
| synth15 | delayed logistic, **3 snapshots**, N jumps ×2–5, fresh seed 61 | — | — | — | — | — | — | — | — | 0.5109 | 0.4972 | 0.4939 | 0.4896 | 0.4758 | 0.4758 | 0.4723 |
| synth16 | Gompertz late-rise, **3 snapshots**, N jumps ×2–5, fresh seed 63 | — | — | — | — | — | — | — | — | 0.4627 | 0.4295 | 0.4155 | 0.4046 | 0.4346 | 0.3598 | 0.3682 |
| synth17 | delayed logistic, **3 snapshots**, N jumps ×2–5, fresh seed 71 | — | — | — | — | — | — | — | — | 0.4226 | 0.4158 | 0.4075 | 0.3992 | 0.3792 | 0.3792 | 0.3743 |
| synth18 | Gompertz late-rise, **3 snapshots**, N jumps ×2–5, fresh seed 72 | — | — | — | — | — | — | — | — | 0.4710 | 0.4397 | 0.4298 | 0.4228 | 0.4473 | 0.3950 | 0.4000 |
| synth19 | delayed logistic, **3 snapshots**, N jumps ×2–5, fresh seed 81 | — | — | — | — | — | — | — | — | — | — | — | 0.3935 | 0.3794 | 0.3794 | 0.3727 |
| synth20 | Gompertz late-rise, **3 snapshots**, N jumps ×2–5, fresh seed 91 | — | — | — | — | — | — | — | — | — | — | — | 0.3944 | 0.3381 | 0.3407 | 0.3295 |
| synth21 | delayed logistic, **3 snapshots**, N jumps ×2–5, fresh seed 101 | — | — | — | — | — | — | — | — | — | — | — | — | 0.3978 | 0.3817 | 0.3817 | 0.3778 |
| synth22 | Gompertz late-rise, **3 snapshots**, N jumps ×2–5, fresh seed 112 | — | — | — | — | — | — | — | — | — | — | — | — | 0.4320 | 0.4570 | 0.4238 | 0.4446 |
| synth23 | delayed logistic, **3 snapshots**, N jumps ×2–5, fresh seed 121 | — | — | — | — | — | — | — | — | — | — | — | — | — | 0.4091 | 0.4091 | 0.4054 |
| synth24 | Gompertz late-rise, **3 snapshots**, N jumps ×2–5, fresh seed 131 | — | — | — | — | — | — | — | — | — | — | — | — | — | 0.3097 | 0.3169 | 0.3120 |
| synth25 | delayed logistic, **3 snapshots**, N jumps ×2–5, fresh seed 141 | — | — | — | — | — | — | — | — | — | — | — | — | — | 0.3165 | 0.3081 |
| synth26 | Gompertz late-rise, **3 snapshots**, N jumps ×2–5, fresh seed 151 | — | — | — | — | — | — | — | — | — | — | — | — | — | — | 0.4921 | 0.5010 |
| synth27 | delayed logistic, **3 snapshots**, N jumps ×2–5, fresh seed 161 | — | — | — | — | — | — | — | — | — | — | — | — | — | — | 0.4445 | 0.4389 |
| synth28 | Gompertz late-rise, **3 snapshots**, N jumps ×2–5, fresh seed 172 | — | — | — | — | — | — | — | — | — | — | — | — | — | — | 0.3194 | 0.3170 |
| **mean 1–4** | | **0.5980** | **0.3834** | **0.3208** | **0.2705** | **0.2133** | **0.2133** | **0.2133** | **0.2133** | **0.2154** | **0.2154** | **0.2154** | **0.2154** | 0.2154 | 0.2153 |
| **mean 1–7** | | | | | **0.5341** | **0.2534** | **0.2534** | **0.2534** | **0.2534** | **0.2491** | **0.2491** | **0.2491** | **0.2491** | 0.2491 | 0.2491 |
| **mean 1–9** | | | | | **0.7920** | **0.2829** | **0.2706** | **0.2825** | **0.2694** | **0.2584** | **0.2592** | **0.2588** | **0.2585** | 0.2591 | 0.2535 | 0.2546 |
| **mean 1–12** | | | | | | **0.2866** | **0.2774** | **0.2877** | **0.2759** | **0.2674** | **0.2682** | **0.2675** | **0.2682** | 0.2677 | 0.2643 | 0.2647 |
| **mean 1–14** | | | | | | **0.2907** | **0.2982** | **0.2932** | **0.2815** | **0.2713** | **0.2720** | **0.2714** | **0.2719** | 0.2716 | 0.2686 | 0.2690 |
| **mean 1–16** | | | | | | | | | | **0.2982** | **0.2959** | **0.2943** | **0.2938** | 0.2945 | 0.2873 | 0.2879 |
| **mean 1–18** | | | | | | | | | | **0.3147** | **0.3105** | **0.3081** | **0.3068** | 0.3077 | 0.2984 | 0.2989 |
| **mean 1–20** | | | | | | | | | | | | | **0.3156** | **0.3128**  0.3045 | 0.3041 |
| **mean 3-snap (8/10/12/15/16/17/18)** | | | | | | | | | | **0.4211** | **0.4102** | **0.4041** | **0.4008** | 0.4030 | 0.3790 | 0.3803 |
| **mean 3-snap (8/10/12/15/16/17/18/19/20)** | | | | | | | | | | | | | **0.3993** | **0.3932**  0.3748 | 0.3739 |
| **mean 1–22** | | | | | | | | | | | | | 0.3246 | 0.3225 | 0.3135 | 0.3139 |
| **mean 1–24** | | | | | | | | | | | | | | 0.3256 | 0.3176 | 0.3176 |
| **mean 3-snap (11 cases, +21/22)** | | | | | | | | | | | | | 0.4021 | 0.3979 | 0.3799 | 0.3806 |
| **mean 3-snap (13 cases, +21/22/23/24)** | | | | | | | | | | | | | | 0.3920 | 0.3773 | 0.3773 |
| **mean 1–26** | | | | | | | | | | | | | | | 0.3243 | 0.3243 |
| **mean 3-snap (15 cases, +21/22/23/24/25/26)** | | | | | | | | | | | | | | | 0.3809 | 0.3809 |
| **mean 1–28** | | | | | | | | | | | | | | | | 0.3284 | 0.3281 |
| **mean 3-snap (17 cases, +21/22/23/24/25/26/27/28)** | | | | | | | | | | | | | | | | 0.3810 | 0.3806 |

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

Next ideas worth trying for v15 (v14 closed the SSE family — gate,
1/SSE and exp(−SSE/T) all lose; spread and γ were already closed —
do not re-sweep any of the three):
1. *SSE-weighted trimmed mean at ≤ 3 snapshots* — TRIED as v14 and
   REJECTED (all three weight forms lose on both gates; see v14
   above). The SSE family is closed.
2. *v19 outcome — γ by snapshot count, DONE and PROMOTED:* γ = 0.65
   only at 3 snapshots wins both gates (mean 1–20 0.3045 → 0.3041,
   3-snap9 0.3748 → 0.3739) with fresh-seed support (27/28 win, all
   six fresh seeds 23–28 win 0.3831 → 0.3804); γ = 0.6 wins the gates
   by more but loses on fresh pair 25/26 and the expanded aggregates,
   so 0.65 is the kept point and the γ family is closed a second time.
   Next median candidate for v20 (one variant at a time, same two
   gates): a *family-aware rescue* — v19 still costs on Gompertz truth
   at 3 snapshots (8 cases 0.3752 → 0.3795) while helping
   delayed-logistic (0.4037 → 0.3980), and v18's mid3 fallback costs
   on delayed-logistic (s10 +0.0095, s25 +0.0162) while winning big
   on Gompertz — DIAGNOSE BEFORE BUILDING: check whether the picked
   family's identity (or the delayed-logistic family's own median)
   separates the rescue wins from the rescue losses; if it does not
   separate, do not build blind, record the diagnosis and stop that
   idea. Deadline 21/11 18:30 — one variant at a time, no parallel
   tuning.
3. *More fresh 3-snapshot seeds before any further scope change* —
   the 3-snapshot verdict now rests on 17 cases (synth27/28 added for
   v19, seeds 161/172). Two more seeds would firm up a v20 decision
   before the deadline (21/11 18:30). Note the diminishing returns:
   v9 → v19 moved mean 1–18 only 0.3147 → 0.2989, and each step since
   v11 has been ~0.001–0.003 — the current family is near its
   ceiling, so a new version needs a genuinely different median rule,
   not another knob on the same one. The family split found by v16
   (delayed wins, Gompertz mixed) is the most informative lead: any
   v20 idea should be checked per truth family, not just on the means.