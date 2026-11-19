# GTA VI trophy rarity forecast 01 — v1

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
  638 → 3,868, ×6.06) and the newly tracked players have barely played, so
  they hold almost nothing except the trivial first-minute trophy. A new
  cohort's earn probability is modelled as the square of the trophy's
  current rate (100% stays 100%, a 1% trophy is ~0.01% for newcomers); the
  median is the pooled count over the enlarged base, spread 1.0 logit.
- **Trend history** (3+ distinct snapshots, the final case): each trophy is
  fitted with a saturating growth curve `r(t) = c + R·(1 − exp(−(t/τ)^p))`
  (grid search over τ, p; least squares for c, R). A straight logit-vs-log-time
  line extrapolates far too steeply because growth saturates. The median is
  floored at `lastCount / forecastN` (earn counts never fall; a rate only
  falls because the player base grew), with players tracked forecast by a
  log-time fit. Spread combines the random walk (0.5 logit/√day), the fit's
  residual and an uncertainty floor.

## Local measurements (practice answers reconstructed from the kit's
published refresh aggregates: 04:30 read, 3,868 players, 4,276 earned,
100% trophy unchanged, other trophies ×0.2208 — proxy, not the true rates)

| model | practice loss (p00+p01) | typical miss | 90% coverage |
|---|---|---|---|
| house baseline (starter) | 1.4008 | 0.677 pp | 0.00 |
| v1 (this entry) | **0.2459** | **0.042 pp** | **0.98** |

On two self-made synthetic final cases (2 days of reads, answer at day 7;
one with saturating-exponential truth, one with logistic-in-log-time
truth) v1 also beats the baseline (0.247 vs 0.295; 0.287 vs 0.328) and
roughly ties the house curve baseline (0.279; 0.282).
