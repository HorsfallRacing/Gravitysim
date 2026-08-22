# Harewood Gravity Kart Simulator — Project Summary (updated)

## Overview
Physics-based pace prediction simulator for a gravity-powered soapbox running
Harewood Speed Hillclimb (Leeds, UK), **top-to-bottom** — the reverse of the
official car-hillclimb direction. Course is run slightly short of the full
official length (stops before Esses/Clark's, the two corners nearest the
official start line).

Current file: `soapbox_circuit_simulator.html` (single-page, Chart.js,
all data embedded).

---

## Data source (important — read this first)

Everything — elevation, distance, and speed — is derived from **one GPX file**
(Garmin, run recorded 26 Jul 2026, 72 trackpoints), using the same distance
calculation (haversine on raw lat/lon) throughout. This matters a lot:

- An earlier version of this project had `elevationProfile` and `runsData`
  sourced from two different places, and their distance labels disagreed by
  up to ~50m in some stretches. This showed up as a false "kink" around 100m
  on the chart and other local artifacts. **Do not reintroduce a second data
  source without cross-checking its distance basis against the existing one
  point-by-point** — matching point *counts* is not enough evidence they're
  the same recording (learned this the hard way).
- The GPX has no logged speed field for this device, so `runsData`'s speed is
  reconstructed via central difference of position/time between consecutive
  points (irregular 1–9s spacing). Coarser than a watch's own speed estimate.
- `routePoints` (lat/lon per point) is kept separately from `elevationProfile`
  /`runsData` (distance/elevation, distance/speed) but all three now share the
  same distance basis since they're the same underlying points.
- **Only one run's data is embedded.** Everything — corner apex speeds, brake
  defaults — is calibrated against this single recording. If you get more GPX
  files from other runs, averaging corner apex speeds/behaviour across them is
  probably the single highest-value next step.

---

## Physics model

### Integrator (fixed a real bug)
Old code advanced distance by a **fixed 2m per iteration** regardless of
actual speed, while only ever integrating **0.1s of acceleration** per step —
i.e. it silently assumed ~72 km/h (2m/0.1s) everywhere on track. Fine near
top speed, catastrophic near launch (a car at 10 km/h actually takes ~0.7s to
cover 2m, not 0.1s). This was the primary cause of a large "launch phase"
under-prediction that was initially (wrongly) blamed on GPS noise.

Fixed: proper time-domain integration — `d += ((v+v_new)/2/3.6) * dt`, trapezoidal.
Also fixed a boundary bug where gradient was hard-zeroed at d=0, which combined
with v=0 start meant the car could never mathematically leave rest. Now
bootstraps from the first recorded speed (`V0`).

Result: predicted run time now ~91s, matching real runs (~88–92s). Previously
predicted 75–85s.

### Forces
```
F_grav  = mass × g × gradient(d)              — from elevation profile
F_drag  = 0.5 × ρ × CdA × v_rel × |v_rel|      — signed, uses wind-relative airspeed
F_rr    = Crr × mass × g
F_brake = mass × decel(corner)                 — see corner model below
```
`ρ` (air density) is fixed at 1.225 kg/m³, not user-editable — altitude/weather
effects here are ~1-2%, inside the model's other uncertainties.

CdA=0.1125 m², Crr=0.0048 are real measured values (CFD estimate, Pro One
tube-type tyre data) — **not** fitted to the trace. An earlier "grid-search
optimized" pair (CdA=0.088, Crr=0.003) turned out to just be compensating for
the integrator bug; don't reintroduce parameter fitting without checking it's
not doing this again.

### Wind
Direction-aware per point on track: track heading (from GPS curvature data)
changes constantly through the corners, so a fixed compass wind direction
gives a different headwind/tailwind/crosswind mix at different points on the
same run. `windDir` follows meteorological convention (direction wind blows
FROM). Only the along-track component is used for drag (crosswind's effect on
yawed CdA is a real but unmodelled second-order effect).

Two modes, toggleable in the UI, each with its own draggable SVG compass dial:
- **Manual** — freely editable, for experimentation.
- **Actual (recorded)** — intended to hold the real conditions for a specific
  run's date. **Currently just a labelled placeholder** (12 km/h from SW) —
  could not retrieve a verified historical station reading for 26 Jul 2026 at
  Harewood via available web tools (Wunderground's history is a JS
  date-picker that resists automated date-specific queries with the tools
  available in this environment). Fix this by supplying the real conditions
  if known, or revisit the lookup with better tooling.

Known interaction worth knowing: corner braking targets a physical grip limit,
so a tailwind's speed gain on a straight can get partly "spent" as extra
braking into the next corner rather than banked as time saved. Not a bug, just
how the model currently works.

### Corners
Six named corners, **located by GPS heading/curvature, not speed** — this
matters because speed-dip detection conflates real corners with braking
zones, gradient changes, etc. Cross-checked against Harewood's published
course guide, reversed for direction (you run top-to-bottom):

`Quarry → Farmhouse/Croisdale → Orchard → Willow → Country → Chippy's`

Per corner, computed from GPS geometry: **radius**, **direction** (left/right
— this was buggy earlier, a sign-convention error inverted every corner's
handedness; fixed and verified against your own on-track knowledge).

**Braking model (current, as of this session):**
```
v_limit  = μ × √(g × radius) × 3.6          — physical corner-grip limit
v_target = brake% × v_limit / 100            — per-corner, user-editable
```
- `μ` is one global input (grip assumption), editable in the main params panel.
- `brake%` is a **per-corner editable input**, shown directly in the corner
  panel next to each corner's computed limit and target speed.
- Braking deceleration to hit `v_target` is calibrated via SUVAT
  (`v_target² = v_entry² − 2·a·window`) the moment the model enters that
  corner's brake window (window length = `scrubWindow`, global, default 60m) —
  calibrated against whatever speed *the model* has reached there, so it
  self-adjusts if mass/CdA/wind/etc change the entry speed.
- All 6 corners get this treatment now, including Quarry (defaults to 100% —
  no deliberate braking, just capped at the grip limit — so a faster/lighter
  vehicle that *would* need to brake there still gets braking added correctly).
- Default `brake%` per corner is back-calculated from this run's actual
  recorded apex speed at μ=0.8, shown for reference in the panel.

**Known issue, unresolved:** the back-calculated defaults don't cleanly split
into "corners I actually braked at" (Farmhouse/Croisdale, Orchard, and right at the
end/Chippy's — per rider's own account) vs "corners taken without braking"
(Willow, Country). A proper sweep comparing actual deceleration against pure
physics (no braking) *does* show this split clearly — Farmhouse/Croisdale/Orchard/end
show 2–2.7 m/s² of "extra" deceleration beyond gravity+drag+Crr, vs 0.4–1.8
m/s² at Willow/Country, and the pattern is far more sustained at the braked
corners. But the brake%-of-limit framing conflates "how hard you braked" with
"whether μ=0.8 was the right grip assumption" for that specific corner, so the
percentages alone don't visibly separate the two groups.

**Suggested next step, not yet done:** set Willow and Country to 100% (no
deliberate braking) and tune μ (possibly per-corner, if a single global μ
can't reconcile grip-limited vs braked corners) until targets there roughly
match what actually happened — this should properly separate "grip" from
"driver choice," which the model can't yet do cleanly.

### Wheelbase / vehicle geometry — discussed, not implemented
The `v_max = μ√(gr)` corner-limit formula is a **point-mass approximation** —
no wheelbase, no track width, no weight transfer. This is fine for *this run*
specifically, because the radius used comes from the GPS path actually driven
— whatever effect this vehicle's real wheelbase had on the line taken through
each corner is already baked into that measured radius.

It stops being fine the moment a **different vehicle** (different wheelbase)
is simulated on these corners: wheelbase (+ track width + steering lock) sets
a hard minimum turning radius, so a vehicle with a meaningfully different
wheelbase may not be able to hold the same line through the tighter corners
(Orchard/Chippy's, ~37m radius, are much tighter than Willow/Farmhouse/Croisdale at
~50–55m) — it might need a wider/faster or tighter/slower line than what was
recorded. Wheelbase also affects weight transfer under trail-braking
(Farmhouse/Croisdale/Orchard, where you brake and corner at once — combined slip, not
modelled) and yaw responsiveness (transient turn-in speed, not steady-state).

**Not yet built.** If/when simulating a second vehicle becomes the actual
goal, add wheelbase + track width as inputs and use them to adjust achievable
radius per corner, rather than assuming this run's driven radius applies
universally.

---

## Known limitations, roughly by how much they matter

1. **Single run.** Everything's calibrated against one recording's noise,
   sampling gaps, and quirks. No averaging possible yet.
2. **Speed isn't real GPS speed** — reconstructed from irregular-interval
   position/time, coarser than the watch's own estimate.
3. **Corner braking is still backward-fit** to reproduce this run, not
   independently predictive — improving CdA or adding tailwind, the model
   still brakes to hit the same calibrated target rather than genuinely
   allowing a faster corner, unless you also revisit brake% by hand.
4. **Elevation resolution is coarse** (~72 points / 1.1km, ~15m spacing).
5. **No real grip/weight-transfer model** — braking deceleration is imposed
   to hit a target, not derived from an actual lateral-longitudinal friction
   circle. Two corners (Farmhouse/Croisdale, Willow, per rider's account) have
   documented 4-wheel sliding. Corner limit is also a point-mass
   approximation with no wheelbase/track width — fine for this run (the
   radius used is the path actually driven), not fine for a different vehicle
   with a meaningfully different wheelbase (see "Wheelbase" section above).
6. **Esses and Clark's are missing** — run stops before the official start line.
7. **"Actual weather" mode has a placeholder, not verified data.**
8. **CdA/Crr are only loosely separable from this data** (shallow/degenerate
   fit) — leaning on independently-measured values rather than statistical
   confidence from this run alone.

---

## File/data structure reference

- `elevationProfile`: `[{d, ele}, ...]` — 72 points
- `runsData`: `[[{d, v}, ...]]` — single run, 72 points (array-of-arrays for
  future multi-run support)
- `routePoints`: `[{d, lat, lon}, ...]` — 72 points, used for heading/curvature
- `routeHeadings`: compass bearing per route point, shared by corner detection
  and wind model
- `CORNER_DEFS`: hand-verified `{name, d0, d1}` distance ranges per corner
- `cornerZones` = `analyzeCorners()`: adds radius, direction, recorded apex
  speed, default brake% per corner
- Key functions: `getGradientAtDistance(d)`, `getHeadingAtDistance(d)`,
  `predictPaceWithDiagnostics(params)`, `analyzeCorners()`

## Source file for corners/route
`activity_23739269267.gpx` — 26 Jul 2026, 13:31:59 UTC start, 72 trackpoints,
Harewood Speed Hillclimb.

---

## Session update: physics-driven braking, no more per-corner fitting

Goal for this session: sign off the model against the recorded run so it can
be trusted for mod/new-vehicle comparisons. That requires the predicted trace
to come entirely from vehicle params vs track params — not from anything
fitted to this specific run. The old per-corner `brake%` (back-calculated
from this run's own recorded apex speeds) violated that, and was quietly
masking a real physics bug. Both are now fixed.

### Bug found: braking calibration ignored gravity during the brake window
The old model calibrated brake deceleration via isolated SUVAT kinematics
(`v_target² = v_entry² − 2·a·window`), as if the car coasted in a vacuum
during the scrub window — not accounting for gravity/drag/rr still acting
throughout it. On Farmhouse/Croisdale's approach (~18% gradient, the steepest on the
course), gravity alone contributed ~1.74 m/s² while the calibrated brake
decel was only ~0.87 m/s² — the "brake" was overpowered by the hill and the
car accelerated through what was meant to be a braking zone, overshooting the
actual apex by ~12 km/h. The old per-corner `brake%` fitting hid this by
just forcing the target to match anyway.

### New braking model: forward/backward envelope method
Standard point-mass lap-sim technique, entirely physics-driven:
- **Forward pass**: speed vs distance under gravity+drag+rr alone (no
  braking), clamped to the local grip limit wherever the track curves.
- **Backward pass**: starting from the finish, integrated backward assuming
  max available brake force is applied continuously
  (`brakeConfidence% × μ × g × mass` — same tyre grip budget as cornering,
  not a separate parameter), also clamped to the local grip limit.
- **Predicted speed = min(forward, backward)** at every point. Braking point
  and intensity fall out of this automatically — corners that don't need it
  show none, corners that do get a brake point and required deceleration
  purely from vehicle mass/CdA/Crr/μ and the track's real geometry.

Replaced UI: the 6 per-corner `brake%` inputs and the single `scrubWindow`
are gone. One new global input, **Brake Confidence (%)** (default 90),
represents imperfect real-world threshold braking. The corner panel is now
fully read-only: grip limit, predicted apex, brake point/distance, and
recorded actual apex (reference only, feeds nothing back into the model).

### Corner grip limit: local curvature, not one radius per named corner
Also fixed: the grip-limit clamp used to apply ONE constant radius across a
named corner's *entire* nominal distance span (up to 151m for Farmhouse/Croisdale),
flat-lining predicted speed through entry/exit sections that aren't at the
true tightest point. The actual GPS trace enters Farmhouse/Croisdale's zone at 66km/h,
dips to 52 at the real apex, climbs back to 57+ — but the old clamp held the
whole 151m at one number. Fixed by computing a **local, point-by-point
curvature radius** from each route point's neighbours (`pointRadius` /
`localRadiusAtDistance()`), applied continuously everywhere on the course
(not just inside named-corner windows) — straights naturally get a very
large radius (capped at 3000m) and never bind. Named corners' d0-d1 spans are
now used only for labeling/chart-banding and for reporting each corner's
tightest point; they no longer define where the physics clamp applies.

**Known weakness of this fix:** point-by-point curvature is more sensitive
to sparse GPS sampling than the old whole-zone average was. Willow has only
6 points over its 134m span (~27m spacing, the sparsest of any corner) and
now under-predicts its actual apex (46.8 vs 55.3 km/h actual) — likely one
noisy point pulling the local minimum-radius estimate too low. All other
corners improved substantially (Farmhouse/Croisdale 51.5 vs 51.9 actual, Orchard 38.2
vs 37.0, Country 42.2 vs 41.7). **A second GPX run would help most here** —
either averaging radius estimates across runs, or at minimum cross-checking
whether Willow's geometry is genuinely as tight as this one recording
suggests.

### μ recalibrated from 0.8 to 0.4, from evidence not a guess
Backing out implied grip (`μ = v_actual²/(g·r)`) per corner at the old
μ=0.8 default showed values from 0.24 to 0.44 — a real spread, not fittable
by a single number, so each corner was checked individually rather than
averaging blindly:
- **Orchard/Chippy's (0.29/0.24, lowest)**: rider's account says these were
  *deliberately braked*, so `v_actual²/(g·r)` measures driver caution, not
  grip — using it to imply μ is circular.
- **Farmhouse/Croisdale (0.42)**: the corner itself carries a 10.3% average gradient
  (steepest of any named corner) — combined lateral+longitudinal grip demand
  (friction circle) isn't modelled, so this number is contaminated by a real,
  separate, still-unmodelled effect (see "Wheelbase" section above, which
  already flagged combined slip as unmodelled — this is the same gap).
- **Chippy's apex is additionally unreliable**: the GPX recording stops
  mid-corner there, so its "apex" may just be the last sample before cutoff,
  not a genuine cornering minimum.
- **Willow/Country (0.44/0.35) were NOT deliberately braked** (rider's
  account) and have comparatively low grade (2.1%/6.3%) — the cleanest
  available grip-limited measurements. Average ≈ **0.40**, confirmed
  plausible by the user for tube-type tyres at this vehicle's loading.
  Default `μ` changed from 0.8 → 0.4 on this basis.

### Mass corrected: 110kg placeholder → 125.3kg measured (fully loaded)
Real measured value, not fitted. Physically has only a small effect on
straight-line pace (gravity and rolling resistance both scale with mass, so
only the drag term's relative share shifts) but is now correct regardless.

### Straight-line gap found and corrected: early GPS-altimeter settling
With mass/CdA/Crr all at their real values, pure coast physics (no
corners/braking active) under-predicted actual speed by ~5-6.5 km/h across
d=30-260m — a straight, corner-free, braking-free stretch, so nothing to do
with the cornering/braking model. Ruled out normal parameter uncertainty:
even CdA down to 0.02 (no aero drag at all), Crr down to 0.0005
(near-frictionless), or a 40km/h tailwind individually fell far short even
at physically implausible extremes. Confirmed with the user there was no
push-start (V0 bootstrap genuinely reflects the whole launch).

What fits almost exactly (RMSE 0.66 km/h across 6 checkpoints) is a gradient
under-statement that decays with distance — consistent with a Garmin's
barometric altimeter not yet settled in the first ~20-30s after power-on (a
known failure mode), rather than genuine terrain. Implemented as
`altimeterSettlingScale(d) = 1 + 0.78·e^(−d/50)`, applied as a multiplier on
`rawGradientAtDistance()`. **This is flagged in-code as an unconfirmed
assumption, not measured data** — same caution the old CdA/Crr
"grid-search-optimized" mistake should have taught (see Integrator section
above): the fit is unusually clean, but there's no independent altitude
reference confirming the mechanism. Revisit if a barometric log, known
start-line elevation, or a second GPX run becomes available. Fades to
negligible by d≈150-200m — does not affect corners or the rest of the course.

### Net result
Overall section RMSE (100-1100m) dropped from ~8-15 km/h (old model, already
falsely low due to per-corner fitting) to ~2-6.6 km/h on an honestly
physics-driven trace. Predicted total time ≈ 86.9s vs the ~88-92s real-run
range noted above — close, with Willow's known under-prediction the main
remaining drag on accuracy.

### Finish line corrected: was a placeholder at d=1100, actually d=1078
User supplied two what3words addresses (`pancakes.scrapping.slippers`,
`attic.soaps.glory`) marking either side of the real finish gate (~9m apart —
plausible gate/track width). Resolved to lat/lon via what3words.com and
projected the gate's midpoint onto the recorded GPS polyline: closest point
sits only ~0.7m off the actual recorded track, at **d≈1078m**
(`FINISH_DISTANCE` constant). Notably this falls **inside the Chippy's
corner zone (988-1093m)** — the run finishes mid-corner, and the GPX
recording continues ~24m past the real line before it stops (d=1102). This
explains the "Chippy's recording stops mid-corner" oddity noted earlier: it's
really "the finish line is mid-corner," not a data-quality artifact.

Updated to use `FINISH_DISTANCE` instead of the old placeholder (~1100m):
- Chart's Finish Line marker moved to the correct distance.
- **Run Time (Pred)** now integrates only up to the real line, not the
  simulation's full safety-margin extent — dropped 86.9s → 83.8s (was
  counting ~24m of track past the actual finish).
- **Finish Speed (Avg)** now interpolates the actual recorded speed AT the
  real line, instead of the fastest point anywhere after d=1050 (which could
  pick up a peak before or after the true crossing) — corrected 42.0 → 39.4
  km/h.

### Immediate next step
A second GPX run (offered, not yet supplied) would resolve two of the three
open items above at once: cross-check Willow's sparse-GPS radius estimate,
and give an independent apex-speed sample for corners where this run's
braking behaviour (Orchard/Chippy's) or data quality (Chippy's cutoff) limits
what a single recording can tell us.

---

## Session update: multi-run corner geometry, μ recalibrated to ~0.5

User supplied 4 more GPX recordings from the same 26 Jul 2026 session
(09:31, 11:37, 12:17, 12:49 — the originally-embedded run, 13:31, was
actually the *last* one recorded that day). All 4 validated clean: no
GPS-glitch speed spikes, normal timestamp gaps (3-6s), correct course
start/end, run times (87/89/92/92s) all inside the documented 88-92s
real-run range.

### Why: the old radius estimate wasn't trustworthy enough to check
Backing out implied grip (`μ = v²/(g·r)`) at Willow/Country using the
existing 3-point-curvature `pointRadius` swung from **0.15 to 0.76** across
the 5 runs, while apex *speed* at those same corners stayed tightly
clustered. That's the signature of a noise problem, not real physics:
computing radius from raw GPS position is a second-derivative-like operation
(position → heading → heading-change), which amplifies GPS jitter far more
than the first-derivative speed reconstruction does. Confirmed with the user
this needed fixing before trusting any recalibration.

### Fix: least-squares circle fit, per corner, per run, combined by median
Replaced 3-point differencing with a proper circle fit (Kåsa method — linear
least squares, `fitCircle()`) using every GPS point in a corner's window
jointly. Each corner is fit independently in each run (matched by physical
lat/lon proximity to the corner's known apex, `locateCornerInRun()` — not by
reusing distance-along-track, which drifts between runs: total lengths
ranged 1072-1112m). Radii are combined by **median** across runs, with the
min/max spread reported alongside rather than hidden (visible in the corner
panel, e.g. `r≈33m (26-41m across 4 runs)`).

`activity_23738438725` (1072m total, notably shorter than the other 1097-1112m
runs) passed every data-integrity check but is a genuinely different/tighter
line — confirmed with the user to exclude it from radius fitting and μ
calibration specifically (`EXCLUDED_GEOMETRY_RUN_IDX`), while still counting
its pace data everywhere else (chart, RMSE, finish speed).

**Result:** implied μ at Willow tightened from a single-run 0.44 (noisy) to
**0.56-0.64 across 4 runs** — a real, consistent cluster. Country improved
similarly (0.21-0.44, no more absurd outliers). New global default:
**μ ≈ 0.50** (`CALIBRATED_MU`, computed at page load — the static HTML
`value="0.4"` on the input is now just a fallback if that computation ever
fails), up from the earlier single-run estimate of 0.4.

### Two real bugs found and fixed along the way
1. **`analyzeCorners()`'s apex-position search used `runsData.flat()`.**
   Harmless with one run, but with 5 runs of different total lengths, a
   low-speed point from a *different* run's own line could hijack the apex
   distance used as the anchor for everything downstream — e.g. Willow's
   anchor landed at d=761m instead of ~800m. Fixed to search only
   `runsData[0]` (the original run) — the coordinate frame `CORNER_DEFS`/
   `routePoints`/every `d0`/`d1` is defined in. Cross-run combination is
   handled separately and correctly via lat/lon matching.
2. **Adjacent, opposite-curving corners contaminating each other's fit
   window.** Willow ends exactly where Country starts (d=830, no straight
   between them) — clipping the fit window to the midpoint of the two
   corners' *apexes* wasn't tight enough to stop a point already curving the
   other way from bleeding into Willow's window and badly inflating its
   radius (one run's fit blew up to 135m before the fix). Fixed by clipping
   to each corner's own known `d0`/`d1` extent as well, with a small floor
   (15m) for edge cases like Chippy's, whose apex sits right at its own
   boundary (see "finish line is mid-corner" above).

### Rescale, don't replace
To apply the new radius without reintroducing the earlier flat-lining bug
(one constant radius across a whole 100+m corner span): the existing
single-run `pointRadius` tapering curve is kept for *shape*, but rescaled
within each corner's own span so its minimum matches the new median —
magnitude corrected, entry/exit recovery preserved.

### Known remaining spread
Willow's per-run circle fits still range 28-102m even after the window fix —
one run's own GPS noise, not corrected further since the median (37.5m)
already handles it appropriately and the spread is reported, not hidden.
Country's implied-μ spread (0.21-0.44) is real too, likely reflecting that
"not deliberately braked" doesn't mean "identically grip-limited every run" —
worth watching if more runs are added later.

---

## Session update: legend/run-visibility, energy breakdown, wind UI, GPX upload

### Chart legend now controls what counts, not just what's drawn
Legend swatches switched to line-style (`pointStyle: 'line'`) instead of
boxes. More substantively: clicking a run in the legend to hide it now also
excludes that run's data from Max Speed (Actual), the "Model vs Reality"
diagnostics, and the corner panel's "actual" apex-speed reference —
previously it was purely a visual toggle, so a hidden line's data was still
silently mixed into every readout below it.

**Correction after initial implementation:** track geometry (corner radius,
and therefore grip limit / predicted apex / run time) was initially wired to
also respect the toggle — wrong, per user feedback: track shape is a
physical property of the road, it shouldn't move depending on which lines
happen to be currently displayed. Fixed by splitting
`fitCornerGeometryAcrossRuns()`'s per-run loop into two independently
filtered concerns: radii (always every run except the one permanently
excluded for data-quality reasons — `EXCLUDED_GEOMETRY_RUN_IDX` — regardless
of the legend) vs. `perRunApex` (the actual-speed comparison number, which
does respect the toggle, since that's genuinely "what does the currently
selected recorded data show"). Also made the radius rescale idempotent
(`rawPointRadius` baseline, `z.baseRadius` frozen per corner) so repeated
toggling can't compound errors — needed regardless of the above, since
`applyCornerFitResults()` now reruns on every `updateChart()` call.

### Energy breakdown: Available / RR / Drag / Cornering / Braking
Added five metric tiles (Joules integrated 0→`FINISH_DISTANCE`, shown in
kJ): **Available** (gravitational PE released, using the corrected gradient
— see altimeter-settling section above — so it stays self-consistent with
Run Time), **Rolling Resistance** (constant force × distance, exact), and
**Drag** (summed along the merged trace using the same wind model as
`accelAt()`). Initially shipped without Cornering/Braking — the three didn't
sum close to Available (a ~51kJ gap), correctly diagnosed as energy the
model actually dissipates scrubbing off speed for corners, just not captured
by RR/drag alone. Added both: at each point, compute the "extra" retarding
force implied by the actual merged trace's own acceleration
(`mass × v × dv/dd`) beyond gravity/drag/rr, then split it by whether `d`
falls inside a named corner's own `d0`-`d1` span (**Cornering** — grip
holding the car to its curve) or not (**Braking** — shedding speed on the
straight approaching a corner, where the backward/max-brake envelope is
binding). Verified self-consistent: Available (84.6) − RR (6.4) − Drag
(16.8) − Cornering (51.8) − Braking (0.2) ≈ 9.4 kJ residual, which matches
plausible leftover kinetic energy at the finish line (the car is still
moving there, not stopped) — the five numbers were never expected to sum to
zero-remainder, and now visibly don't need to.

### Wind control: compact layout, unambiguous direction
Previous layout: two full 160×160px compass dials (one per mode) plus
verbose paragraph text, taking a lot of vertical space, and per user
feedback not clear at a glance which way the wind was actually heading.
Rebuilt as a single compact row (70×70px compass + inline direction/speed
readout) per mode, with the lengthy "actual weather" disclaimer collapsed
into a one-line note (full text still available via `title` tooltip).
**Direction fix**: `windDir`'s stored value/semantics are unchanged
(meteorological "from" convention, matches the physics calculation
elsewhere), but the arrow drawn now points where the wind blows *toward* —
using an SVG marker (`orient="auto"`) so it's a real arrowhead, not just a
line — matching the convention common weather apps use for a flow arrow,
which reads correctly without the viewer needing to mentally flip it. What
you drag is what you see: dragging the arrow tip directly sets the toward
bearing, converted to "from" only where the value is stored (`setFromAngle`
in `setupCompassDial()`).

### Add a GPX run by drag-and-drop
New drop zone above the chart (drag a `.gpx` file, or browse). Parsed
entirely client-side (`DOMParser`, no server) using the identical
methodology as every embedded run — haversine cumulative distance,
central-difference speed — so a dropped-in run is directly comparable, not
a second data source with a different basis. Validated before being added
(≥10 track points, total distance 500-2000m, start point within 300m of
this course's known start) to avoid silently corrupting the corner-geometry
fit with an unrelated file. Confirmed with the user this only needs to be
**session-only** — added runs live in memory (`runsData`/`allRoutePoints`
arrays get `.push()`ed) and are lost on refresh, not written back into the
HTML file. A newly added run participates in track geometry exactly like
any other non-excluded run (per the toggle-vs-geometry split above).

---

## Session update: rename/retitle, param grid fix, route map

Renamed the app to **Harewood Gravity Kart Simulator** (`<title>` + `<h1>`,
doc title above). Renamed the Farmhouse corner to **Farmhouse/Croisdale**
everywhere (name field, comments, section labels, this doc).

**Param grid fix**: the μ input's description was shortened, but the actual
cause of Brake Confidence wrapping to its own row was the grid's
`minmax(140px, 1fr)` not fitting 5 columns at typical widths (CSS Grid
column count is width-driven, not content-height-driven — a longer/shorter
description text doesn't change it). Reduced to `minmax(100px, 1fr)` so all
five vehicle/track params sit in one row.

### Route map (real basemap — the one part of this file that needs internet)
Everything else here has been deliberately offline/self-contained all
session; this is a genuine exception, confirmed with the user first. Added
Leaflet (CDN) with two switchable tile layers — OpenStreetMap street and Esri
World Imagery satellite, both free, no API key. New "Route Map" section,
`initRouteMap()` once at load, `refreshRouteMap()` called from `updateChart()`
so it stays live with every parameter change.

- **Speed heatmap**: the known GPS line resampled every 8m (interpolated
  between the real points via `interpolateRoutePoint()` — no fabricated
  geometry beyond straight lines between known points), each short segment
  coloured by the live *predicted* speed there (blue→white→red) using the
  already-returned 10m-resolution `predicted` array — no need to expose the
  finer 1m `mergedV` grid just for this.
- **Corners**: a translucent band along each corner's own `d0`-`d1` span plus
  an apex marker (`CORNER_COLORS`, matching the chart), with a popup showing
  the same grip limit / predicted apex / actual apex numbers as the corner
  panel — same numbers, different view, not a second source of truth.
- **Braking zones**: dashed red overlay + start marker wherever
  `zoneState.brakePointDist` is active — empty by default at the current
  calibrated μ≈0.50 (every corner currently shows "no straight-line braking
  needed"), confirmed working by temporarily lowering μ to 0.25 and back.

Verified end-to-end in the live preview: tiles load on both layers, heatmap
colours and corner popups match the panel/chart numbers, braking markers
render correctly when active, no console errors.

---

## Session update: layout restructure — sticky input rail, sensitivity panel

Presentation-layer session. **No physics changed** — `predictPaceWithDiagnostics()`,
`analyzeCorners()`, the envelope passes and every constant are untouched. What
changed is the order things appear in, and two new panels that read the model's
existing outputs.

### The finding that drove it
Sweeping each vehicle parameter ±10% through the existing predictor:

| Parameter | Δ run time |
|---|---|
| **μ (grip)** | **−0.91s / +2.32s** |
| Mass | −0.25s / +0.37s |
| Crr | −0.20s / +0.20s |
| CdA | −0.17s / +0.21s |
| Brake confidence | −0.05s / +0.06s |

Grip moves run time ~5× more than the next parameter and ~13× more than CdA.
Two things worth recording:
- **Grip response is asymmetric** — losing 10% costs 2.32s, gaining 10% returns
  0.91s. The current μ≈0.50 sits on the steep side of the curve (sweeping
  μ 0.30→0.80 spans 96.5s→75.3s), so grip *uncertainty* is a bigger risk than
  grip *improvement* is an opportunity.
- **Mass runs backwards from intuition** — 10% heavier is 0.25s *faster*, since
  gravity scales with mass and drag doesn't. Lightening this vehicle to find
  time works against the physics.
- **Brake confidence is currently inert** (0.05s, below the model's own 4–16 km/h
  RMSE floor) because at μ≈0.50 the backward/max-brake envelope never binds —
  consistent with the map legend showing no braking zones. It becomes live again
  below roughly μ=0.4; kept as an input, demoted in the rail.

The energy breakdown agrees from the other direction: cornering scrub is 51.8
of 84.6 kJ (61%), ~3× what drag costs. **This is a grip problem, not a drag problem.**

### Layout
Container width bug fixed first: `.container`'s `max-width: 1240px` was being
silently capped to ~836px by the site's legacy `<table width="847">` chrome, so
it had never actually applied. `#gravitySimSection` now breaks out to
`min(1240px, calc(100vw - 48px))` via a negative-margin centring trick (every
ancestor is `overflow: visible`, so this is safe). The rest of the site keeps
its original ~860px layout.

- **Sticky left rail (304px)** holds all inputs, grouped by dependency: Grip &
  driver → Mass & balance → Vehicle geometry → Aero & rolling, with Conditions
  (wind) and Runs (GPX) collapsed into disclosures. Inputs and results now share
  a screen, which is the point — the page is used iteratively.
  - Implementation note: `.rail` is a **stretched** grid item wrapping a sticky
    `.rail-inner`. Sticky inside a content-height item has no travel and does
    nothing; this was the one real trap in the restructure.
  - The read-only Mass field is gone — mass is derived, so it's now a live chip
    under the four corner weights it comes from.
  - Provenance markers (measured / estimated / unverified) replace the
    inconsistent `<small>` captions.
- **Readout order**: result band → sensitivity + energy budget → speed trace →
  derived geometry → corners → fidelity → route map (demoted to context).

### New panels
- **Sensitivity** (`renderSensitivity`) — the tornado chart above, live. ~10
  extra predictor calls, ~40ms, debounced 140ms since `updateChart()` fires on
  every keystroke. Sorted by span; bars auto-scale with a 0.5s floor so a flat
  set doesn't get magnified into false drama.
- **Energy budget** (`renderEnergyBudget`) — the five energy tiles as one
  stacked bar, with the calibrated baseline as a ghost bar beneath. KE-at-line
  is derived as the residual (`available − cornering − drag − rr − braking`),
  which is the ~9.4 kJ previously noted as unexplained remainder.
- **Baseline + Δ** — `BASELINE` is captured after first render (so it picks up
  `CALIBRATED_MU`, computed at load, not the markup fallback). Any change shows
  as "±Xs vs baseline" with a reset.

### Rebuilt panels
- **Corners**: 6 verbose boxes → one table sorted by **|predicted − actual|**,
  so the misses lead (Chippy's +15.3, Willow −6.3) instead of being buried in
  course order. Radius spreads wider than 1.2× the median get a ⚠ (catches
  Willow's known 28–102m fit). Load transfer moved behind a row expander.
- **Model vs Reality**: 4 identical text blocks → 4 rows sorted worst-first with
  RMSE encoded as bar length as well as digits. Willow→finish (16.27 km/h)
  previously rendered identically to Launch→Farmhouse (4.01).

Dead CSS removed: `.metrics`/`.metric-*`, `.diag-section`, `.corner-box` and
friends, `.param-grid` (the lap calculator's separate `.lap-*` rules are untouched).

### Verified
Two-column shell resolves to 304px/872px at 1440px viewport; rail confirmed
pinned at `top:14px` while the readout scrolls past; all values match the
pre-restructure figures (83.5s, 36.0 km/h finish, 66.3/74.0 peak, 84.6 kJ);
μ→0.35 correctly re-sorts the corner table, surfaces a braking zone at 53m out,
and shifts the energy split; reset restores baseline; compass drag still works
inside its disclosure; no sim-originated layout overflow at any width. The only
console error is the pre-existing legacy `MM_preloadImages` from the site's
Dreamweaver chrome.

**Not done:** the gradient strip under the speed trace (proposed, would share
the chart's x-axis to put the "why" next to the "what") — left out as it's the
one item that touches chart config rather than layout.

---

## Session update: map re-centre, lap calculator moved/unit-toggled

Follow-on presentation work. No physics touched.

### Route map: re-centre control
The map is pannable and zoomable, so an accidental drag could lose the course
entirely with no way back. `routeHomeBounds` now holds the opening framing
(`bounds.pad(0.12)`) as a module-level constant, and a `topleft` Leaflet control
calls `recentreRouteMap()` to `fitBounds()` back to it. Deliberately stores the
*opening* bounds rather than recomputing from current state, so repeated use
always returns to the same framing. Verified restoring from both a far-off pan
at the same zoom and a pan combined with zoom-out (z12) and zoom-in (z18).

### Lap Speed Calculator moved below the simulator
Was above it, pushing the sim down the page. Now sits after
`#gravitySimSection`, and matched to it exactly: same
`min(1240px, calc(100vw - 48px))` breakout, same `#f2f4f7` ground, same 20px
padding — so both render at an identical 1240px outer / 1200px inner and read
as one continuous surface rather than two separate pages. The `<hr>` between
them became `.section-rule`, widened from its old fixed 860px to the same
breakout width. Verified pixel-identical at 1440px and 820px viewports.

Note the horizontal scroll that appears below ~870px viewport width is
pre-existing legacy chrome (the site's fixed 860px header images / 847px layout
table, measured at 990px), not the sim or the calculator — both sit inside it.

### Unit toggle (MPH ↔ KM/H)
One segmented control now drives both input and output: `lapUnit` is
`'imperial'` (miles in, MPH out) or `'metric'` (kilometres in, KM/H out). The
selected unit is the large primary readout; the converted equivalent shows
beside it as a secondary tile, so the conversion isn't lost.

**Toggling converts any distance already entered** (`setLapUnit()`), so the
toggle changes the units the lap is *expressed in*, not the lap itself — the
resulting speed stays the same physical speed, just relabelled. Verified:
1 mile / 60s = 60.00 MPH / 96.56 KM/H; switching to metric gives 1.609 km →
96.54 KM/H / 59.99 MPH; switching back returns exactly 1.000 miles / 60.00 MPH.
The ~0.02 drift is the distance field rounding to 3dp to match its own
`step="0.001"` — round-trips are stable, and holding more precision would put
unreadable values like `1.609344` in the input.

Old `#mph`/`#kmh` element IDs are replaced by `#lapPrimary`/`#lapSecondary`
(plus `#lapPrimaryUnit`/`#lapSecondaryUnit`/`#distanceUnit` for the labels).
The toggle is wired on `DOMContentLoaded` since the markup now sits after the
script that defines its handlers.

### Legacy title removed
The Dreamweaver-era `>Lap Speed Calculator` heading (a `<FONT size=+2>` string
split across three spans inside the layout table) is gone — the calculator's own
`.lap-header` already titles it.

---

## Session update: actual pace on the map, and an actual-vs-predicted Δ trace

Presentation and diagnostics only. **No physics changed** —
`predictPaceWithDiagnostics()`, the envelope passes, `analyzeCorners()` and
every constant are untouched. Everything added here reads outputs that already
existed; nothing feeds back into the model.

### What was missing
The map only ever showed *predicted* pace, and the only actual-vs-predicted
comparison on the page was the fidelity table's four section averages. Where
along the course the model gains or loses is exactly the thing those averages
throw away.

### Three views of the same line
The map's pace overlay is now a mutually exclusive radio group ("Colour route
by"), not a checkbox: all three views paint the same physical line, so "both
on" would only ever mean "one of them is invisible". Corners and Braking zones
stay checkboxes, unchanged.

- **Predicted pace** — as before.
- **Actual pace** — the selected run's recorded speed.
- **Δ actual − predicted** — symmetric diverging ramp about zero.

**All three share one colour scale**, computed across the predicted *and*
actual sample sets together (`refreshRouteMap()`). If Actual rescaled to its
own min/max, the same colour would mean different speeds either side of a
radio click and the comparison would be worthless.

**Actual and Δ are drawn along the selected run's own GPS line**
(`allRoutePoints[actualRunIdx]`), not the canonical `routePoints`, so the line
on screen is the line that run actually took.

### Run selection
A `<select>` above the map (`#actualRunSelect`, rebuilt every `updateChart()`
so GPX drops appear without a reload) picks which run feeds the Actual/Δ views
*and* the chart's Δ trace. It sits above the map rather than inside it because
it isn't a map-only control.

Selecting a hidden run un-hides it — picking it for comparison is an explicit
request to see it. Hiding the selected run afterwards blanks the Actual/Δ
layers and says so in the legend, rather than silently switching to a different
run: hidden runs are excluded from every other readout on the page
(`runVisible`), so they're excluded here too.

### Δ trace on the pace chart
New dataset on a right-hand `y1` axis, filled to zero (the sign is the whole
point), plotted at the run's **own sample distances** rather than on a
resampled common grid — those are the only places actual speed is a
measurement rather than an interpolation. `y1` is kept symmetric about zero
and rescaled per run in `updateChart()` rather than left to Chart.js autoscale.
The Δ zero reference line is filtered out of the chart legend: it's a datum,
not a series, and a legend entry would only invite toggling it off.

Sign convention matches the fidelity table: **Δ = actual − predicted**, so
negative means the model is optimistic. First 100m excluded from the Δ stats
and the colour/axis scaling for the same reason the fidelity table excludes
it — GPS jitter is a large fraction of displacement at walking pace, so early
Δ is a distance-tagging artefact, not model error.

### What the Δ actually says (calibrated μ≈0.50, from 100m)

| Run | mean Δ | RMSE | worst Δ | at | run ends |
|---|---|---|---|---|---|
| 13:31 | −0.2 | 5.1 | −14.9 | 1093m | 1102m |
| 09:31 | −4.5 | 8.4 | −32.2 | 1112m | 1112m |
| 11:37 | −3.1 | 6.3 | −26.4 | 1097m | 1097m |
| 12:17 | −6.1 | 13.3 | −40.2 | 1072m | 1072m |
| 12:49 | −5.9 | 13.8 | −42.5 | 1101m | 1101m |

Two things fall out of this table:

- **Every mean is negative.** The model is optimistic against all five runs —
  it predicts more speed than was carried. 13:31 is the run the μ calibration
  was fitted to, which is why it's near zero and the others aren't.
- **Every run's worst Δ is its own final sample.** This is a recording-boundary
  artefact, not a model error: the model carries speed to `dMax`=1120m while
  each GPX recording stops between 1072m and 1112m with the kart braking to a
  halt. It inflates RMSE and stretches the Δ axis — 12:17 and 12:49 scale to
  ±40 largely because of it. Left faithful rather than trimmed, since any cut-off
  rule would be arbitrary, but it's the first thing to discount when reading the
  tail of a Δ trace. A `evt_beacon` channel (LOGGER_SPEC.md) would remove this
  permanently by fixing the real finish line per run.

### Colour scale: the first attempt didn't work
The Δ layer initially used a textbook RdBu diverging ramp and was very hard to
pick out against the basemap. Three separate causes, all fixed:

1. **White neutral collided with the basemap.** OSM street tiles sit at almost
   exactly that lightness, so "the model agreed here" — the most common case —
   rendered as an invisible line.
2. **Not enough chroma.** RdBu is built for choropleths, where the mark is a
   large filled area and pastels have room to register. Here the mark is a
   3–7px line, which needs far more saturation. Ends pushed to `#0a46be` /
   `#ce1414` with the mid-tones properly saturated.
3. **No casing.** Added a `#141414` polyline at weight 9 *under* the coloured
   segments, so every colour sits on its own dark ribbon instead of competing
   with whatever tile is behind it. Drawn as **one** polyline for the whole
   track (not one per segment — a single layer instead of ~140) and marked
   `interactive: false` so it never steals hover from the segments above it.
   Applied to all three views, since Predicted and Actual had the same
   weakness.

**Plus |Δ| on line width as well as colour** — 3px at agreement, 7px at full
scale. This is the change that made it scannable: redundant encoding means the
problem areas read as thick and loud before any hue is decoded, and agreement
recedes to a thin dark thread. On 13:31 that distributes as 43% thin/neutral,
44% mid, 13% fat and saturated — most of the route quietly recedes and the
eight genuinely-wrong segments jump out.

### Known limitation: distance drift between runs
Each run's d-axis is its own haversine cumulative and total lengths span
1072–1112m (the same drift `locateCornerInRun()` already works around by
matching corners on lat/lon rather than distance). Δ against distance inherits
it — roughly ±1–2% on the x-axis. Stated in the map panel text rather than
silently corrected.

### Verification
Structural and functional, via evaluated JS against the live page: all three
modes render, casing present and non-interactive on each, Δ core weights span
3.0–7.0, colour interpolation correct at the stops, run selector repopulates
and un-hides, hidden-run fallback message fires, `y1` rescales per run, Δ zero
filtered from the chart legend, no new console errors. (The pre-existing
`MM_preloadImages` error from the legacy site nav is unrelated and predates
this work.)

**Not visually verified** — screenshots were unavailable in this session, so
the rendered appearance over real tiles was confirmed by the user, not by
inspection.

---

## Session update: GPX timestamps recovered, sector times, mobile

Three things: the run data gained a time channel it always could have had, the
corner panel became a corner *and sector* panel keyed on time rather than
speed, and the page became usable on a phone for the first time. **No physics
changed** — `predictPaceWithDiagnostics()`'s force model, the envelope passes,
`analyzeCorners()` and every constant are untouched. Run Time, finish speed and
peak speeds all still read 83.5s / 36.0 / 66.3 / 74.0.

### The gap: the page had no time axis

Everything on it was km/h. Run Time appeared exactly once, as a total, and
every diagnostic below it — RMSE, Δ, apex, peak, grip limit — was a speed. That
makes speed error and time cost look interchangeable when they aren't: Willow
under-predicts apex by 6.3 km/h and ranked second-worst in the corner table,
but costs 0.91s; Chippy's is the largest speed miss on the page at +15.2 km/h
and costs 0.51s.

### `t` was in the GPX all along and was being thrown away

`runsData` was `{d, v}`. The GPX timestamps were read at parse time (to derive
speed by central difference) and then discarded, which meant any actual sector
time had to be obtained by integrating `dt = dd/v` back out of the trace.

That integration is systematically short — **85.7-90.0s against measured
87-92s** across the five runs — and the deficit is not spread out. Comparing
per sector on the original run, every sector agrees to within 0.07s **except
the launch**, which is short by 1.11s of a 1.08s total. Trapezoidal integration
of speed against distance under-reads badly wherever speed climbs steeply from
near-zero across sparse samples, which describes 0-63m and nothing else on the
course.

Fixed by re-parsing the five source GPX files and adding `t` (elapsed seconds
from each run's own first trackpoint). The re-parse reproduced the existing
`d` and `v` arrays **exactly** — max deviation 0.000 on both, all five runs —
before anything was written, so this was verifiably a pure addition and not a
silent re-derivation of data other things are calibrated against. The embedded
literals were edited in place, leaving the `d`/`v` text byte-identical.

`addGpxRun()` now keeps `t` too (rebased to the dropped run's own start), so
uploaded runs behave like embedded ones. It was already computing it and
dropping it on the same line.

**Resolution caveat, stated in the panel rather than hidden:** GPX timestamps
are whole seconds. A sector boundary falls between trackpoints and is
interpolated (distributed across the bracketing pair by its own speed profile,
not linearly in distance, then scaled to match the measured interval), so a
sector time carries roughly **±0.5s**. Δt under about half a second is inside
the measurement's own resolution. The table colours accordingly — green under
0.5s, amber to 1.0s, red beyond.

### Sectors, merged into the corner table

Six sectors, one per corner, each running from the previous corner's exit to
this corner's exit. Approach and corner are deliberately one unit — braking
point and entry speed are a single decision, and a "corner time" that excludes
the straight before it can't be acted on independently. Every metre belongs to
exactly one sector, so **the six sector times sum to Run Time** (83.45 against
the headline 83.46; the remainder is rounding). The table closes on a total row
that makes that reconciliation visible rather than leaving it to be trusted.

Merged into the existing Corners panel rather than added as a new one, per the
user's call, and held to seven columns by folding grip limit under radius (it's
derived from radius and μ, so it reads naturally there) and dropping the Δ-apex
bar to a plain signed number. The bar now encodes **Δt**, and the table sorts
by it.

Sector times come from `predictPaceWithDiagnostics()`'s own 1m `mergedV` grid
via a new cumulative-time array, not from the 10m `predicted` array the chart
and map use. That matters: reconstructing sector times from the 10m array put
the launch 1.8s out on its own, for the same convexity reason the integration
bias exists. Predicted sector figures stay inside the physics function;
**actual** sector time is computed in `renderCornerTable()` from the selected
run, keeping run-selection state out of the physics — the same split already
applied to radius (ignores the legend) vs apex speed (follows it).

### What the sector table says

Original run (13:31), calibrated μ≈0.50, sorted by |Δt|:

| Sector | Span | Entry → exit | Pred | Actual | Δt |
|---|---|---|---|---|---|
| Quarry | 0–63m | 4.0 → 33.6 | 15.14 | 16.88 | **+1.74** |
| Willow | 594–830m | 45.8 → 47.6 | 14.92 | 14.01 | −0.91 |
| Farmhouse/Croisdale | 63–421m | 33.6 → 59.6 | 24.76 | 24.10 | −0.66 |
| Chippy's | 922–1078m | 57.8 → 47.3 | 10.00 | 10.51 | +0.51 |
| Orchard | 421–594m | 59.6 → 45.8 | 11.68 | 11.98 | +0.30 |
| Country | 830–922m | 47.6 → 57.8 | 6.95 | 7.03 | +0.07 |
| | | | **83.46** | **84.51** | **+1.05** |

Two things worth recording:

- **The launch is the single largest error on the course**, roughly double the
  next, and it is the one region no existing readout covers — the fidelity
  panel starts at 100m by design (GPS jitter is a large fraction of
  displacement at walking pace, which is the right call for *speed* RMSE and
  the wrong one for *time*). It is also exactly where `altimeterSettlingScale`
  was fitted, so the two should be looked at together: the settling correction
  is an unconfirmed assumption tuned in the same 0-150m window that now shows
  the biggest time deficit.
- **The total is more accurate than the model is.** Sector errors run −0.91s to
  +1.74s and largely cancel to +1.05s. A headline built on offsetting errors
  will not stay accurate through a parameter change or a different vehicle,
  which is precisely what this page is meant to be used for.

Across all five runs the total Δt ranges −0.96s (09:31, model pessimistic) to
+3.97s (12:49). Worth noting because in *speed* terms the model is optimistic
against all five; in time terms it is not, so the two framings genuinely
disagree and the speed-only view was not telling the whole story. Run 12:17
stops at 1072m, short of the 1078m finish, and correctly reports "run stops
short" rather than a partial total.

### Mobile

The page had no `viewport` meta tag at all. Mobile browsers therefore assumed a
~980px desktop layout viewport and scaled the whole thing to roughly 38% — and
because the layout viewport stayed at 980px, the existing 1080px/640px media
queries (which were fine) **never matched on a phone**.

Adding the meta alone was not enough: the Dreamweaver chrome around this page
pins a ~880px floor via `<table width="847">` and an 860px banner image. Two
false starts worth recording, because both fail silently:

1. `max-width: 100%` on the images does nothing. A percentage max-width inside
   an **auto-layout** table resolves against a containing block whose width
   depends on that same content; browsers resolve the circularity by treating
   it as `none`. The table always grows to min-content, which the banner's own
   `width` attribute sets.
2. `max-width: 100vw` binds, but `100vw` **includes the vertical scrollbar**, so
   on any viewport that has one the chrome lands ~15px wider than the usable
   width and re-introduces the horizontal scroll it was meant to remove.

The fix is `table-layout: fixed` on the legacy tables, which makes cell widths
definite up front so `max-width: 100%` on the images finally binds. Every row
in that chrome is a single `colspan="6"` cell, so fixing the layout costs
nothing in column proportions. Plus `border-spacing: 0` (the default 2px per
nested table is on its own enough to overflow) and `body { margin: 0 }` (the UA
default 8px is what the caps would otherwise be measured against). All of it
sits inside `@media (max-width: 900px)`, below the chrome's natural width, so
the desktop rendering is unchanged **by construction** rather than by argument.

This also removes the horizontal scroll below ~870px that the previous session
recorded as pre-existing and out of scope.

Then the tuning: chart 450→300px and map 480→320px on small screens (both were
fixed desktop heights taking most of a phone screen each, on a ~7000px page);
all text inputs to 16px, since iOS Safari zooms in on focus below that and
never zooms back out, which on a page this input-heavy leaves the layout
magnified after every edit; two-up rail grid; stacked map controls. Data tables
deliberately keep scrolling horizontally rather than reflowing into cards —
they're numeric comparisons whose value is the column-to-column read.

A debounced `resize` handler now calls `paceChartInstance.resize()` and
`routeMap.invalidateSize()`. Chart.js sizes its canvas from the container it
saw at creation and does not reliably pick up a width change originating from a
media query rather than the container's own box; without this, a phone rotation
could leave the canvas at its landscape width and push the document into
horizontal scroll.

Also removed while in the head: a stray `<title>Untitled Document</title>` and a
duplicate `</head><body>` pair mid-document. Browsers recovered from both, but
they made the markup misleading to read.

### Verified

Widths swept at 1440 / 820 / 768 / 390 / 360 / 320px: no page-level horizontal
overflow at any of them (the only elements extending past the viewport are
Leaflet tiles, correctly clipped inside the map). Desktop confirmed unchanged in
layout — 1240px sim, 304px sticky rail, 412px chart, 480px map, 13px inputs,
860px banner, 8px body margin. Sector times verified to sum to Run Time; the run
selector drives actual sector times across all five runs including the short one;
μ→0.35 re-sorts the table, surfaces the Orchard braking zone at 53m out and
returns 91.4s, and reset restores 83.5s. Only console errors are the pre-existing
legacy `MM_preloadImages` and 404s for `Images/*`, which the local dev server
doesn't serve.

**Not visually verified** — screenshots were again unavailable in this session,
so layout was confirmed by measured geometry rather than by looking at it. The
legacy nav images are image maps with fixed pixel `coords`; they are scaled down
below 900px, and whether the hotspots still line up has **not** been checked.

### Open, not done

- **The launch deficit and `altimeterSettlingScale` overlap** and should be
  revisited together now that the launch is measurable in seconds.
- **"Model vs Reality by Section" still uses arbitrary 100/400/700/950
  boundaries** and reports in km/h. Now that corner-bounded sectors exist and
  cover the whole course including the launch, that panel largely duplicates
  them on worse boundaries; folding it in would remove a panel rather than add
  one.
- **No uncertainty band on the headline.** Run Time is a point estimate while μ
  ±10% moves it −0.91/+2.32s and μ itself came from a 0.56-0.64 spread. The
  sensitivity panel already computes everything a ± band would need.
- **Nothing aggregates the five runs** — every comparison is against one
  selected run, so there is no actual-pace corridor to judge against.
- **Legacy image-map hotspot alignment below 900px is unverified** (above).

---

## Session update: stall bug, start-line gradient artifact, full assumptions register

Two real bugs fixed, one compensating error exposed, and the model's assumptions
written down in one place for the first time.

### Bug 1: a stalled car reported an impossibly fast run time

Reported as "these inputs give an impossibly fast time" with 185kg (4×46.25),
CofG 200mm, wheelbase 1345, track 650 f/r, μ 1.1, Crr 0.02. The page showed
**13.7s**.

Chain of causation:

1. The elevation profile opens `{d:0, ele:96.8}, {d:1.0, 96.8}, {d:4.1, 96.8}` —
   the first 4.1m read as dead flat.
2. On zero gradient the only force is rolling resistance, whose deceleration is
   `Crr·g` — mass cancels, so no other input can rescue it.
3. Coast distance from V0 (3.99 km/h) is `v²/(2·Crr·g)` = `0.0625/Crr`. Above
   **Crr ≈ 0.0152** that is under 4.1m: the car stops before reaching the slope.
4. `forwardEnvelope` hit v=0, distance stopped advancing, and it burned its whole
   300s `tMax` parked at d=3.1m. `sampleTrace` then returned 0 km/h for every
   metre beyond.
5. The time integration scored those metres as **zero seconds each**:
   `cumTime.push(... vAvg_ms > 0.01 ? 1/vAvg_ms : 0)`. All 13.74s accrued in the
   first four metres; metres 4 to 1078 contributed exactly 0.00s.

Measured cliff: Crr 0.0150 → 76.0s, Crr 0.0153 → 19.5s, and non-monotonic
garbage above that (0.016 → 7.4s, 0.02 → 13.7s) because the number was only
measuring how far the car coasted before dying.

**Fix.** `forwardEnvelope` now returns `stalledAt` and breaks out instead of
spinning. `predictPaceWithDiagnostics` scans the merged trace and returns
`time: null` plus `stallDistance` when the car does not reach the finish. The
hero readout shows an em-dash, the result band shows `no finish — car stops at
NNNm`, the sensitivity panel is replaced with an explanation, and the corner
table shows a stall notice — it had the identical bug, reporting `0.00s` sector
times and `0.0 km/h` apexes for every sector past the stall. Sensitivity also
handles the partial case: if the base setting finishes but ±10% does not, that
row reads `no finish at ±10%` rather than producing NaN bars.

### Bug 2: the start-line gradient artifact

The three identical 96.8m samples are the barometric altimeter's 0.1m
quantisation, not terrain. Harewood's start line is on the slope and there is no
push start (confirmed with the user).

`LEADING_FLAT` now finds the leading run of identical elevation samples and
extends the first genuinely-measured gradient back to d=0. Gradient at the line
goes from 0 to 0.093. Deliberately bounded to that leading run — the rest of the
profile and the `altimeterSettlingScale` fit are untouched.

There was already a guard attempting this, but it only fired at exactly `d <= 0`
and read its gradient from two samples that both read 96.8, so it returned zero
anyway.

### What the fix exposed: ~4.2s of compensating error

The calibrated default moved from **83.5s to 79.2s**. The flat-start artifact had
been adding ~4.2s of start-line crawl to every run.

Measured times from the GPX clock to the real finish line (d=1078):

| Run | Measured |
|---|---|
| 13:31 | 84.51s |
| 09:31 | 82.50s |
| 11:37 | 86.56s |
| 12:17 | (GPX does not reach the line) |
| 12:49 | 87.43s |

So before the fix the model sat inside the real range for the wrong reason;
after it, the model is **3-8s optimistic**. It was not accurate, it was wrong in
two directions at once. Anything calibrated by matching a predicted time to a
stopwatch has been absorbing this.

**Also found, not changed:** `REAL_RUN_MIN`/`REAL_RUN_MAX` are 88/92 and the band
renders "real runs 88-92s", but the runs measure 82.5-87.4s to the current finish
line. Those constants look to predate the finish-line relocation to d=1078. They
are coupled to hardcoded CSS percentages (`left:57.1%, width:14.3%`), so changing
them means touching the stylesheet too.

### Assumptions register

Status key: **M** measured · **F** fitted/inferred · **A** assumed · **P**
placeholder · **S** structural (deliberately not modelled).

#### Highest impact

- **(F/A) `altimeterSettlingScale` (`A=0.78, L=50`)** — self-described in the
  source as "UNCONFIRMED ASSUMPTION, not measured data". A gradient multiplier
  fitted to explain a straight-line speed deficit, attributed to a barometric
  sensor settling. Never verified against an independent altitude reference.
  Inflates gradient by up to 78% at the line, decaying by ~150m. The entire
  launch rests on it.
- **(F) μ from `calibrateMu()`** — median implied lateral g from Willow and
  Country apex speeds only (2 of 6 corners), which **assumes the driver was
  exactly at the grip limit** at those apexes. If anything was left in hand, μ
  is understated and every corner limit with it. Falls back to a hardcoded 0.4.
- **(A) `LEADING_FLAT`** — assumes the flat leading run is sensor quantisation,
  not terrain, and that the next segment's gradient represents the start line.
  Uses exact float equality as the "same quantised reading" test. Unverified
  against a survey; moved the headline 4.2s.
- **(A) Crr as a single constant** — see the dedicated section below.

#### Vehicle inputs (UI chip vs reality)

| Input | Chip | Status |
|---|---|---|
| μ | `4-run fit` | **F** — fitted from 2 corners, assumes at-the-limit driving |
| Brake confidence 90% | `assumed` | **A** — no braking data exists |
| Corner weights | `measured` | **M** |
| Wheelbase 1345 | `unconfirmed` | **A** |
| CofG height 300 | `estimate` | **A** — never measured |
| Track F/R 1060 | `measured` | **M** |
| CdA 0.1125 | `CFD` | **A** — simulated, not tunnel or coast-down |
| Crr 0.0048 | `tyre data` | **A** — published figure, not this car or surface |

Input *ranges* are themselves assumptions: Crr's `max="0.010"` did not stop a
typed 0.02, and nothing clamps or warns.

#### Physics deliberately excluded (S)

- **Rolling resistance is a constant force** — speed-independent, and does not
  vanish at v=0. This is what makes zero speed an absorbing state.
- **No rotational inertia** — mass is purely translational; no wheel spin-up
  energy, no effective-mass penalty. *Scoped out for now by decision.*
- **No drivetrain or bearing losses** beyond whatever Crr absorbs. *Ignored by
  decision.*
- **Lateral load transfer computed but never fed back into grip** — no tyre load
  sensitivity. *Deliberate: see the reasoning below.*
- **Crosswind ignored** — only the along-track component affects drag; yawed CdA
  is unmodelled. *Ignored by decision.*
- **CdA constant** with speed, attitude and ride height. *Accepted by decision.*
- **No banking or camber** — lateral limit is pure μg on a flat plane.
  *Accepted by decision.*
- **Point-mass model** — no yaw dynamics, no slip angles, no line choice. The car
  is assumed to follow the recorded GPS line exactly.
- **Driver assumed perfect** — exactly at the grip limit in corners, exactly
  `brakeConfidence`% of μ under braking, everywhere, every time.
- **Gravity uses `m·g·tan(θ)`, not `m·g·sin(θ)`** — the gradient is rise/run. Max
  gradient on the course is 17.8% at d=378 (mean 6.4%, total drop 67.6m), so this
  over-states gravity by up to **1.57%** at the steepest point. Small, but
  systematic, and it stacks with the settling scale above. Likewise rolling
  resistance should act on `m·g·cos(θ)`, not `m·g`.

**Removed from this list:** suspension roll compliance. The car has none, so the
rigid-body `aRoll` is exact for this vehicle apart from tyre deformation.

#### Track and course data

- **(A)** Elevation is barometric, quantised to 0.1m — root cause of both bugs
  above.
- **(F)** `FINISH_DISTANCE = 1078`, projected from two what3words points onto the
  GPS line; ~0.7m off-track at closest approach.
- **(F)** Corner spans (`CORNER_DEFS`) located from a single run's heading-change
  data.
- **(F)** Corner radii from GPS curvature fit. **Willow's spread across runs is
  28-102m** and the code already flags it as noise rather than geometry.
- **(F)** Speed is derived, not logged — central difference of GPX position/time,
  sample spacing 1-9s.
- **(A)** GPS jitter ~2-3m; the first 100m is excluded from diagnostics for it.
- **(F)** `V0 = 3.99 km/h`, average first-sample speed across 5 runs, used as the
  launch speed for every simulation.
- **(P)** Wind is placeholder data throughout: `actualWindDir = 225` is commented
  "placeholder until a verified reading is confirmed", default actual wind speed
  is 12 km/h, and the UI itself says "unverified placeholder, not a real
  reading".
- **(A)** One run's GPS trace is treated as *the* racing line for all runs.
- **(A)** `RHO = 1.225` fixed at sea-level standard. Harewood is ~120m and real
  conditions shift it 1-2%. **Agreed to make this adaptable.**

### Rolling resistance: the piece worth opening up

Rolling resistance is not a rounding error here. Over the timed run it consumes
**7.5%** of the available gravitational energy at Crr 0.0048 and **31.1%** at
Crr 0.02. On the 8-wheel car it is nearly a third of the energy budget and it is
the parameter the whole wheel-swap strategy turns on.

Problems with `F_rr = Crr · m · g` as written:

1. **No speed dependence.** Real tyres follow roughly `Crr(v) = C0 + C1·v`
   (sometimes a `v²` term). A single figure applied flat across 0-70 km/h is a
   systematic error that varies along the course — and the published "tyre data"
   value is quoted at some reference speed that is not stated.
2. **Does not vanish at v=0.** Physically rolling resistance IS zero at rest;
   what holds a car stationary is static breakaway. Conflating the two is what
   makes v=0 absorbing and what produced Bug 1. These should be separate terms.
3. **Normal load should be `m·g·cos(θ)`** — see the gradient note above.
4. **Surface is assumed uniform** for the whole course. Crr is a property of
   tyre *and* surface.
5. **Tyre pressure is not an input**, despite being one of the strongest
   real-world levers on Crr.
6. **Bearing/hub drag is lumped in**, which means the published tyre figure is
   the wrong number to use as a total.

**The identifiability problem — the important one.** Crr and a gradient error
both produce a near-constant retarding force, so **they are not separately
identifiable from a single GPS run.** The model currently carries a fitted
gradient correction (`altimeterSettlingScale`) *and* a fixed Crr; each absorbs
the other's error. That is precisely why touching the gradient surfaced 4.2s of
hidden optimism. Breaking the degeneracy needs an independent measurement:

- a **flat-ground coast-down** (gradient known to be zero, so the decay is pure
  Crr, and the speed decay curve gives C0 and C1 separately), or
- a **surveyed elevation profile** so gradient stops being a free parameter.

Either would let the fitted correction be retired rather than re-tuned. This
ranks above every other modelling improvement on the list.

### Brake confidence: how it actually works

One global number, no per-corner or per-run structure:

- `accelAt()` applies `F_brake = (brakeConfidence/100) · μ · g · mass`, and only
  when `brakeOn` is true — which happens **only in `backwardEnvelope`**.
- The backward pass runs that maximum brake force *everywhere*, working back
  from the finish, producing the fastest speed the car could carry at each point
  and still slow for everything downstream.
- Actual speed is `min(forward, backward)` — so braking appears only where the
  backward pass binds, and **where and how hard is derived, never fitted**.
- `brakePointDist` is an *output*: the first metre where the backward envelope
  drops below the forward one.

So it is not "how hard the driver brakes at corner N" — it is "what fraction of
the available μ·g the driver is willing to use, anywhere braking is required."
90% is a pure assumption.

**Requested direction:** the user can supply real braking points but does not
want them applied to all models. That matches the architecture already in place
for recorded apex speed — displayed as a validation reference, feeding nothing
back into the model. Measured brake points should be an *overlay* on the derived
braking zones, per run, never an input to the physics.

### Racing line: possible, but downstream

Solving a minimum-time line is a well-posed problem, but it needs **track
boundaries**, and GPS gives one driven line, not the edges. It could be
approximated by assuming a width around the recorded centreline — but it would
sit on top of a radius fit that already swings 28-102m at Willow. Optimising a
line against a track whose shape is known to ±70m of radius would produce a
confident-looking answer with nothing behind it. Improving the geometry comes
first.

### Tyre load sensitivity: recommended *against*, for now

Tempting, but it would double-count. Load transfer reduces total axle grip
because the outside tyre gains less than the inside loses — and **μ is already
fitted from real cornering data**, so that effect is baked into the fitted
number. Adding an explicit load-sensitivity curve on top would subtract it twice,
unless μ were re-fitted from a load-free reference that does not exist. It would
also mean inventing a sensitivity coefficient that cannot be fitted from this
data: replacing a stated assumption with a hidden one, and making the model look
more sophisticated without being more accurate.

The existing diagnostic display is the right level — it already says explicitly
that it shows load movement, not grip cost.

### Scope decisions taken this session

| Area | Decision |
|---|---|
| Rolling resistance | **Open up** — speed dependence, v=0 handling, cos(θ) |
| Rotational inertia | Out for now |
| Drivetrain losses | Ignore |
| Suspension roll compliance | N/A — car has none |
| Tyre load sensitivity | Interesting, but recommended against (double-counts) |
| Crosswind | Ignore |
| Air density | Make adaptable |
| CdA | Fine as is |
| Racing line | Wanted, but blocked on geometry confidence |
| Banking/camber | Fine as is |
| Brake confidence | Keep derived; add measured brake points as overlay only |

### The 8-wheel comparison car (modelled, entirely unvalidated)

A second vehicle: 8 wheels, 4 in contact at a time. Pneumatically deployed Xootr
wheels for the start and straights, dropping onto kart wheels for fast corners.
Brakes act **only** on the karts. Steering acts on all four front wheels. Ride
height does not change — the axles pivot. No GPX exists for this car, so
everything below is assumption on assumption:

- **(A)** Crr_xootr = 0.012, range 0.009-0.018, from general PU/industrial-wheel
  literature — not this wheel, durometer, load or surface. The range spans ~3s of
  run time. **Note the literature argues against the premise**: solid PU
  generally rolls *worse* than pneumatic on hard surfaces, and smaller diameter
  makes it worse again. The comparison only favours the Xootrs because kart
  slicks are deliberately high-hysteresis.
- **(A)** Crr_kart = 0.02, μ_kart = 1.1 — user figures, no fit.
- **(A)** Lateral-g allowance of 0.3g on the Xootrs — invented to reproduce the
  actual schedule. Needed because "never corner on the Xootrs" is a geometric
  rule the track does not respect: Quarry is a named corner at d=16-63m and is
  taken on Xootrs. Track demand there is only ~0.19g (the car is doing 30 km/h),
  against 0.59-0.82g at the real corners and ≤0.21g anywhere off-corner, so a
  single threshold separates them cleanly.
- **(A)** 0.5s transition, ≈9.0m of track at 64 km/h. On karts by d=270, so the
  swap initiates around d=261.
- **(A)** Changeover spin-up loss ≈1.2 km/h, derived from *assumed* wheel masses
  (3kg kart, 0.35kg Xootr), *assumed* radii (0.13m, 0.09m) and an assumed
  rim-heavy inertia factor. Three guesses stacked. Not currently modelled at all,
  since rotational inertia is out of scope.
- **(A)** Shares the base car's CdA, CoG, track and wheelbase by instruction.
- The lateral-g figures above use the **bicycle-wheel car's** recorded speeds —
  indicative of what the track demands, not a measurement of the 8-wheeler.
- Predicted 71.0s for the user's setup inherits every assumption above *plus* the
  3-8s optimism.

**Deferred design work** (agreed but not built): per-wheelset Crr and `braked`
flag, changeover-point schedule (`[{d, set}]`, not spans — spans allow silent
gaps), blended transition, and a schedule optimiser. The optimiser has a clean
structure: karts are required through corner zones *and* their braking zones plus
a transition lead-in, Xootrs everywhere else, solved as a fixed point since lower
Crr on the straights lengthens the braking zones.

### Open, not done

- **Air density is still hardcoded** at 1.225.
- **The 3-8s optimism is unexplained** and is now visible rather than masked.
- **`REAL_RUN_MIN`/`MAX` are stale** (88/92 vs measured 82.5-87.4).
- **Several UI chips overstate confidence** — μ reads `4-run fit`, CdA reads
  `CFD`, Crr reads `tyre data`; all three are closer to `estimated`.
- **The 8-wheel car model is unvalidated** — no GPX exists for it.

---

## Session update: what the baseline GPX runs can and cannot constrain

Question asked: given the baseline vehicle and its five GPX runs, can we derive
constraints that say how a *different* vehicle would perform? Answer: yes, four
useful ones — and one of them says the current 8-wheeler prediction is resting
entirely on an unmeasured number.

### Constraint 1: the noise floor (precision limit on any comparison)

Each run compared against the mean of the other four, interpolated onto a 10m
grid from d=100 to d=1078:

| Run | RMSE vs other four |
|---|---|
| 13:31 | 5.29 km/h |
| 09:31 | 4.10 km/h |
| 11:37 | 4.01 km/h |
| 12:17 | 9.69 km/h (also the run excluded from geometry) |
| 12:49 | 6.68 km/h |
| **Pooled** | **6.31 km/h** |

Measured times span 82.5-87.4s — a **4.9s spread for the same car and driver.**

This is the hard limit on vehicle comparison. **A predicted difference smaller
than roughly ±2.5s is inside the run-to-run noise** and cannot be claimed from
this dataset, no matter how good the model gets.

### Constraint 2: the physical floor

With drag, rolling resistance and grip limits all removed — pure gravity down
this course — the run takes **51.9s**. No vehicle can beat that here. Any
prediction approaching it should be treated as a modelling error, not a result.

### Constraint 3: the model's systematic error, and that it is NOT one parameter

Model vs all visible runs (d=100-1078, n=282): **RMSE 8.60 km/h** against a noise
floor of 6.31. Subtracting in quadrature leaves ~**5.9 km/h of systematic error**
a better model could remove.

Signed error by 100m bin (positive = model too fast):

| d | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 |
|---|---|---|---|---|---|---|---|---|---|---|
| mean err | +1.0 | +3.1 | +1.2 | +5.3 | +2.5 | -3.4 | +6.2 | +0.3 | +6.0 | +9.8 |

The error **grows with distance**, which is the signature of a cumulative energy
leak rather than a one-off offset. Corners are worse than straights (+3.87 vs
+1.69 km/h mean).

But no single parameter fixes it. Best achievable RMSE by sweeping one variable:

| Explanation | Best RMSE | at | Time then |
|---|---|---|---|
| Crr | 8.16 | 0.015 | 83.5s |
| CdA | 7.90 | 0.30 (implausible) | 83.2s |
| Global gradient scale | 8.24 | ×0.85 | 83.2s |
| Brake confidence | 8.02 | 50% | 79.9s |

All bottom out around 8, none approaches the 6.31 floor, and each can reach the
right *total time* while leaving the *shape* wrong. **The gap is not Crr, not
CdA, and not gradient alone** — which also means it cannot be cleanly attributed
or transferred to another vehicle.

Related: braking binds for only **82 of 1079 metres** and just **48 metres sit at
the grip limit**, which is why brake confidence barely moves the result. The
model believes the car coasts essentially free for over 90% of the course.

### Constraint 4: attribution — where the 8-wheeler's advantage actually comes from

Stepping the baseline params to the 8-wheeler one change at a time:

| Change | Run time | Delta |
|---|---|---|
| Baseline (125.3kg, μ 0.50, Crr 0.0048) | 79.25s | — |
| + mass 125.3 → 185kg | 78.37s | **−0.88s** |
| + geometry (CoG 200, track 650) | 78.37s | **0.00s** |
| + Crr 0.0048 → 0.020 (kart slicks) | 84.78s | **+6.41s** |
| + μ 0.50 → 1.10 (**assumed**) | 71.03s | **−13.75s** |

Three things fall out:

1. **The entire predicted advantage is μ.** Everything else nets to +5.5s
   *slower*; μ alone pulls 13.75s back. The 8-wheeler "pulls away" because of a
   grip figure nobody has measured.
2. **Mass helps** — +59.7kg made it 0.88s *faster*, because gravity scales with
   mass while drag does not. Counterintuitive, robust, and independent of μ.
   This one transfers.
3. **Geometry contributes exactly zero.** Rollover never binds (aRoll 15.9 m/s²
   vs grip at ~10.8), so CoG height and track width are currently inert inputs.

The comparison is also contaminated on both sides: baseline μ=0.50 was *fitted
assuming the driver was at the grip limit*. If they were not, real baseline μ is
higher and the 8-wheeler's margin shrinks — while μ=1.1 was never fitted at all.

### What transfers to a new vehicle, and what does not

| Quantity | Transfers? |
|---|---|
| Track geometry, radii, distance | Yes — track property |
| Gradient profile (and its error) | Yes, if same logger |
| Driver behaviour / grip usage | Probably, if same driver |
| Noise floor (±2.5s) | Yes |
| Vehicle mass, Crr, CdA, μ | No — these are what differ |
| The ~5.9 km/h systematic error | **Unknown** — unattributed, so cannot be assumed shared |

The useful consequence: **relative predictions are more trustworthy than absolute
ones.** Shared track/instrument/driver error largely cancels in a Δt between two
vehicles on the same course — but only if they run at similar speeds, since the
error's speed dependence is unknown and it is the thing growing with distance.

### The one measurement that would unlock this

**μ for the kart wheels, measured rather than assumed.** It is worth 13.75s in
the current prediction — more than every other difference combined, and larger
than the entire model error.

Cheapest route: one GPS run of the 8-wheeler through a known-radius corner
(Willow or Country), then apply the same implied-lateral-g calculation
`calibrateMu()` already uses. That converts the dominant assumption into a fitted
value using machinery that already exists.

Second priority remains the flat-ground coast-down for Crr, which breaks the
Crr/gradient degeneracy described in the previous session note.

---

## Session update: the getaway phase specifically

Focus narrowed to the initial getaway rather than the full run. The launch turns
out to be a much cleaner problem than the full lap — and completely unmeasurable
with the current data.

### The launch is a two-parameter problem, and neither is grip

At launch speeds there is no cornering at the grip limit, no braking, and
negligible drag. What remains is `a = g·(gradient − Crr)` — and **mass cancels
exactly**, because gravity and rolling resistance both scale with it.

Model sensitivity of time-to-50m (baseline vehicle):

| Parameter | Change | t50 | Effect |
|---|---|---|---|
| Crr | 0.0048 → 0.012 | 9.80 → 10.20s | **+0.40s** |
| Crr | 0.0048 → 0.020 | 9.80 → 10.70s | **+0.90s** |
| μ | 0.50 → 1.10 | 9.80 → 9.80s | **0.00s** |
| Mass | 125.3 → 185kg | 9.80 → 9.79s | −0.01s |
| CdA | 0.1125 → 0.20 | 9.80 → 9.84s | +0.04s |

Launch acceleration at d=10m: 0.792 m/s² at Crr 0.0048, 0.721 at 0.012, 0.642 at
0.020. Mean gradient over the first 50m is 0.0852.

**This exactly inverts the full-run finding.** Over the whole course μ was worth
13.75s and Crr 6.41s. Over the first 50m μ is worth *nothing* and Crr is the only
vehicle parameter that moves the needle.

Consequence for the 8-wheel car: **the getaway is the one phase where the
Xootr-vs-kart question is cleanly answerable**, because the only differing
parameter that matters there is Crr. No unmeasured μ contaminating the result.

### The current data cannot measure it

Measured getaway splits from the GPX clock:

| Run | v0 km/h | t10 | t25 | t50 | t100 | t200 | total |
|---|---|---|---|---|---|---|---|
| 13:31 | 3.67 | 7.95 | 11.95 | 15.42 | 20.41 | 27.69 | 84.51 |
| 09:31 | 3.93 | 4.04 | 5.59 | 8.86 | 14.41 | 21.72 | 82.50 |
| 11:37 | 4.55 | 7.44 | 10.92 | 14.28 | 19.14 | 26.36 | 86.56 |
| 12:17 | 1.62 | 7.23 | 10.37 | 13.47 | 18.39 | 25.71 | — |
| 12:49 | 6.16 | 7.60 | 10.75 | 13.91 | 18.51 | 25.78 | 87.43 |

**t50 spans 8.86 to 15.42s — a 6.56s spread over 50 metres, same car, same
driver.** The model predicts 9.80s. The measurement spread is roughly **7× the
entire Crr effect** we would be trying to detect.

It is not explained by launch speed: 12:49 had the highest v0 (6.16 km/h) and a
middling t50; 09:31 had a middling v0 (3.93) and was 4.6s faster to 50m than
anything else. Its second GPX sample sits at d=3.3m/t=3s where the others are at
~1.0-1.7m/t=1s — a different early sampling pattern. At walking pace GPS position
jitter (2-3m) is comparable to the distance actually travelled, so early distance
tagging is unreliable. This is the same reason the diagnostics panel already
excludes the first 100m.

### The spread is frozen in, not recovered

Range across runs at each mark: t50 **6.56s**, t100 6.00, t150 5.99, t200 5.97.

After roughly 50m the gap between runs stops changing — all five proceed at
effectively the same rate thereafter. Final time spread is 4.93s, slightly less
than the launch spread, so a little is recovered but most is carried.

Correlation between t50 and total time is r ≈ 0.69 across the four runs with a
finish time. Suggestive that the launch matters disproportionately, **not
statistically meaningful at n=4** — and confounded by the measurement problem
above, since much of that t50 variation is probably not real.

### How to apply it: the differential launch test

The getaway depends on `g·(gradient − Crr)`. On the same start line the gradient
is **common to both wheelsets**, so it cancels exactly in a *difference* between
two launches.

**A back-to-back launch measures ΔCrr between wheelsets without needing to know
the gradient at all.** That is the experiment that breaks the Crr/gradient
degeneracy flagged earlier — and it is a 50-metre roll, not a full run, so it can
be repeated many times in an afternoon.

It cannot be done with GPS. It can be done with the logger already drafted in
`LOGGER_SPEC.md`:

- **Wheel encoders at 200 Hz** (`whl_count_fl/fr/rl/rr`, with
  `wheel_circumference_m` and `encoder_teeth_per_rev`) give distance and speed
  directly at walking pace, immune to GPS jitter.
- **IMU at 200 Hz** (`imu_ax`) measures acceleration directly, so
  `g·(gradient − Crr)` is read as a single quantity rather than differentiated
  out of a noisy position trace.
- The spec already notes at its ingest-mapping table that `imu_ax` +
  `gnss_speed_ms` yields measured gradient and retires `altimeterSettlingScale()`.

So the getaway question is **blocked on hardware, not on modelling**. The logger
as specced is the right instrument, and this is a strong argument for prioritising
the encoder and IMU channels over everything else in it.

### Caveat: rotational inertia belongs back in scope for launch work

Rotational inertia was scoped out, which is defensible for full-run work. But the
launch is the one phase dominated by *acceleration* rather than steady speed, so
the wheel-inertia difference acts almost entirely here.

Rough sizing: ~6.5kg of equivalent mass difference between wheelsets on 185kg is
~3.5%, which costs roughly **0.15-0.20s over a 50m launch** — the same order as
the 0.40-0.90s Crr effect being measured. At the precision the encoder makes
possible, it can no longer be ignored: leaving it out would bias any fitted
ΔCrr.

---

## Session update: characterising the launch phase from baseline GPX only

Baseline car only (125.3kg, bicycle wheels, 5 GPX runs). Goal: understand the
launch well enough to turn it into a parameterised component that new input data
can be dropped into.

Method: a forward-only integrator (nothing binds on grip or brakes at launch),
run **per GPX run from that run's own starting speed** rather than the global
averaged `V0`, compared against that run's own trace over d=0-200m.

### Finding 1: per-run v0 transforms the fit

| Run | v0 km/h | n pts | RMSE, settling ON | bias | RMSE, settling OFF | bias |
|---|---|---|---|---|---|---|
| 13:31 | 3.67 | 18 | 2.57 | +1.82 | 3.93 | −2.82 |
| 09:31 | 3.93 | 17 | 7.20 | +0.63 | 8.17 | −4.29 |
| 11:37 | 4.55 | 16 | 2.66 | +1.33 | 4.66 | −3.36 |
| 12:17 | 1.62 | 14 | 1.77 | +0.85 | 4.50 | −3.72 |
| 12:49 | 6.16 | 17 | 2.80 | +0.76 | 5.54 | −3.99 |

Four of five runs sit at **1.8-2.8 km/h RMSE** once started from their own v0,
against ~8.6 km/h for the whole-course aggregate. 09:31 remains an outlier
(7.20) — consistent with its anomalous early sampling (second sample at
d=3.3m/t=3s where the others are ~1.0-1.7m/t=1s).

**The averaged `V0 = 3.99 km/h` is throwing away real, available information.**

### Finding 2: the settling correction is *required*, not merely fitted

With the settling scale off, the best-fit Crr **pegs at zero for every single
run** and still leaves the model 1.6-3.0 km/h too slow.

Since Crr cannot go below zero, **no physically possible rolling resistance can
explain the launch.** There is genuinely more energy in the first 200m than the
raw barometric gradient provides. This does not validate the specific
exponential form (`A=0.78, L=50`), but it does establish that a correction of
this sign and rough magnitude is necessary rather than cosmetic.

### Finding 3: effective launch resistance is consistent across runs

Best-fit Crr per run, settling on:

| Run | fitted Crr | RMSE | bias |
|---|---|---|---|
| 13:31 | 0.0095 | 2.27 | +0.82 |
| 09:31 | 0.0105 | 7.07 | −0.72 |
| 11:37 | 0.0080 | 2.49 | +0.57 |
| 12:17 | 0.0080 | 1.53 | +0.14 |
| 12:49 | 0.0065 | 2.77 | +0.40 |

**Mean ≈ 0.0085, range 0.0065-0.0105** — tight for five runs, and roughly
**1.8× the nominal 0.0048** the model currently uses.

Crucially this is an **effective** coefficient. It absorbs everything constant-ish
resisting the car at launch: tyre rolling resistance, bearing and hub drag, any
residual gradient error, wheel scrub, **and rotational inertia**. It is not a
tyre property and must not be compared against a tyre datasheet figure.

### Finding 4: speed fits well while time does not

Model vs measured time-to-distance, using each run's own v0 and the fitted
Crr=0.0085:

| Run | t50 model | t50 measured | t100 model | t100 measured |
|---|---|---|---|---|
| 13:31 | 10.09 | 15.42 | 15.10 | 20.41 |
| 09:31 | 10.02 | 8.86 | 15.02 | 14.41 |
| 11:37 | 9.83 | 14.28 | 14.82 | 19.14 |
| 12:17 | 10.74 | 13.47 | 15.76 | 18.39 |
| 12:49 | 9.36 | 13.91 | 14.33 | 18.51 |

Speed RMSE looked good (~2 km/h), yet time-to-50m is out by 2.7-5.3s on four of
five runs. Both statements come from the same data.

The reason is that **time is hypersensitive to speed error at low speed**: a
2 km/h error at 5 km/h is worth roughly 2 seconds over just 10 metres. A
respectable speed RMSE can conceal a five-second time error.

**Consequence: the launch phase must be validated on time-to-distance, never on
speed RMSE.**

### Finding 5: where the model's error is generated

Splitting the run at d=50m:

| Run | launch measured | launch model | rest measured | rest model |
|---|---|---|---|---|
| 13:31 | 15.42 | 9.80 | 69.08 | 69.44 |
| 09:31 | 8.86 | 9.80 | 73.64 | 69.44 |
| 11:37 | 14.28 | 9.80 | 72.28 | 69.44 |
| 12:17 | 13.47 | 9.80 | — | 69.44 |
| 12:49 | 13.91 | 9.80 | 73.53 | 69.44 |

Mean error: **−3.32s over the first 50m**, **−2.69s over the remaining 1028m**.

So roughly **55% of the model's total optimism is generated in 4.6% of the
course** — the launch is about **25× worse per metre** than everything after it.

**Caveat:** runs with slow launches had fast rests and vice versa. That
anti-correlation is what you would see if the d=50 marker is misplaced between
runs by early distance-tagging error, so the exact launch/rest split is
confounded even though the concentration is clear.

### Finding 6: v0 explains only a fifth of the launch spread

Model-predicted range in t50 driven by v0 variation alone: **1.38s**. Measured
range: **6.56s**. So about 21%. The remaining ~5s is either genuine
launch-technique variation or early distance-tagging error, and the current data
cannot separate them.

### How the sim's launch phase should be reshaped

1. **Make v0 a per-run input, not a global average.** Biggest single win, and the
   data is already in the GPX. Keep the average only as the fallback for
   hypothetical runs with no recording.
2. **Separate launch resistance from steady-state Crr.** Introduce an explicit
   effective `launchResistance` (~0.0085 for the baseline car) distinct from the
   tyre `crr` (0.0048), blending to the steady value above some speed. Give it
   its own confidence chip — it is fitted, not looked up.
3. **Validate the launch on time-to-distance.** Report t10/t25/t50/t100 predicted
   vs measured per run. Speed RMSE is the wrong metric here and will mislead.
4. **Keep the settling correction fixed when swapping vehicles.** It is a
   property of the instrument and the start line, not of the car, so it is the
   part that cancels in a vehicle-to-vehicle comparison.

### How this applies to the 8-wheeler

The transferable structure is: **gradient + settling correction (fixed, shared) ×
effective launch resistance (per vehicle)**.

To predict the 8-wheeler's getaway you need *its* effective launch resistance,
defined the same way — **not** a tyre-datasheet Crr. Substituting a published
figure into a model calibrated with an effective one would be an
apples-to-oranges comparison and would silently drop bearing drag and wheel
inertia.

The useful consequence: because the effective coefficient absorbs rotational
inertia, **a differential launch test measures exactly the right quantity with
inertia included** — the previously scoped-out wheel-inertia difference comes
along for free inside the fitted number, with no need to model it explicitly.

Sizing for the eventual test: the fitted spread across five baseline runs is
±0.002 in effective Crr, and the Xootr-vs-kart difference under discussion is
roughly 0.008 — about 4× the baseline scatter. Detectable in principle, but not
with GPS-derived distance at walking pace (see the getaway note above); the
encoder and IMU channels in `LOGGER_SPEC.md` are what make it measurable.

---

## Session update: is the launch anomaly just a badly modelled gradient?

Hypothesis put by the user. Tested directly. **Answer: largely yes — and the
evidence goes further than the question did. The `altimeterSettlingScale`
correction appears to be actively harmful, and removing it moves the model
inside the measured range.**

### Evidence 1: elevation quantisation swamps the signal

The barometric altimeter resolves to 0.1m. Early GPX segments are short, because
the car is slow, so the induced gradient error is large:

| Segment | Length | Δele | gradient | quantisation error |
|---|---|---|---|---|
| 4.1-15.6m | 11.5m | −0.6 | 0.0522 | **±0.0087** |
| 15.6-25.3m | 9.7m | −0.6 | 0.0619 | **±0.0103** |
| 25.3-32.4m | 7.1m | −0.4 | 0.0563 | **±0.0141** |
| 32.4-38.7m | 6.3m | −0.4 | 0.0635 | **±0.0159** |
| 236.9-270.9m | 34m | −2.0 | 0.0588 | ±0.0029 |

Nominal Crr is **0.0048**. A single 0.1m quantisation step on those early
segments produces a gradient error **2-3× larger than the entire rolling
resistance term being modelled.** And the error is worst exactly where the launch
is, because segment length scales with speed.

### Evidence 2: the correction invents ~2.3m of height, all of it early

| Quantity | Value |
|---|---|
| Profile total drop (0 → 1078m) | 66.76m |
| Integrated raw gradient | 66.91m |
| Integrated **settling-corrected** gradient | 69.21m |
| **Height invented by the correction** | **+2.31m** |
| ...of which in the first 200m | +2.27m |

A 2.3m barometric datum error is entirely ordinary. So **"the recorded start
elevation is ~2.3m too low"** is a simpler hypothesis that fits the same facts as
a two-parameter exponential decay — and is directly testable against a survey or
a mapping DEM.

### Evidence 3: the correction was fitted against the wrong metric

Launch fit across all five runs, d=0-200m:

| Gradient model | Crr | speed RMSE | **time RMSE** |
|---|---|---|---|
| Exponential settling (current) | 0.0048 | 3.96 | 4.08 |
| Exponential settling (current) | 0.0085 | **3.85** | 3.82 |
| Constant offset k=0.010 | 0.0048 | 4.21 | 2.74 |
| Constant offset k=0.015 | 0.0085 | 4.14 | 2.82 |
| **Raw gradient, no correction** | 0.0048 | 5.59 | **2.43** |
| Raw gradient, no correction | 0 | 4.77 | 2.49 |

The settling correction gives the **best speed fit and the worst time fit**. Raw
gradient with nominal Crr is the best time fit by a wide margin.

The original correction was fitted to close a *speed* deficit at checkpoints.
Time-to-distance is what actually matters at launch (see the previous session
note — a 2 km/h error at 5 km/h is worth ~2s over 10m). **Optimising speed at the
expense of time is precisely the trap, and this correction is sitting in it.**

### Evidence 4: GPS path length is inflated, and varies run to run

Total recorded distance for the same physical course:

| Run | 13:31 | 09:31 | 11:37 | 12:17 | 12:49 |
|---|---|---|---|---|---|
| total d | 1102.0 | 1112.1 | 1096.9 | 1072.0 | 1101.1 |

**40m of spread (3.7%)** on a course that is identical every time. Position
jitter adds spurious path length, worst at low speed where jitter is comparable
to real displacement. So the *distance axis itself* is unreliable at launch — and
distance, speed and gradient are all derived from that same position stream.

This also explains a paradox in the earlier analysis: the model looked
simultaneously **too slow on speed** (bias −2.8 to −4.3 km/h) and **too fast on
time** (−3.3s to 50m). Inflated path length produces exactly both symptoms at
once, because recorded speed and recorded distance are inflated together.

### Evidence 5: one run is physically impossible

Time to 50m against the absolute floor — raw gradient, **zero** rolling
resistance, zero drag, free-rolling from that run's own v0:

| Run | v0 | t50 measured | absolute floor | verdict |
|---|---|---|---|---|
| 13:31 | 3.67 | 15.42 | 11.95 | ok |
| **09:31** | 3.93 | **8.86** | **11.83** | **impossible** |
| 11:37 | 4.55 | 14.28 | 11.55 | ok |
| 12:17 | 1.62 | 13.47 | 12.94 | ok |
| 12:49 | 6.16 | 13.91 | 10.86 | ok |

**Run 09:31 reaches 50m three seconds faster than a frictionless car could.** Its
early samples show 3.3m at t=3s then 29m at t=6s — 25.7m in 3 seconds from
walking pace, which needs ~5.7 m/s² on a hill that provides 0.8.

It is still violated even with the settling correction applied (floor 9.54s vs
8.86s measured). Note the correction lowers the physical floor by ~2.3s, i.e.
part of what it does is make impossible runs look possible.

**09:31 is not the run excluded from geometry fitting** —
`EXCLUDED_GEOMETRY_RUN_IDX` is 3, which is 12:17. So the physically impossible
run is currently inside every fit, including the one that produced the settling
correction.

### The headline consequence

| Model | Run time |
|---|---|
| With settling correction (current) | 79.25s |
| **Settling correction removed** | **84.21s** |
| Settling removed + launch-fitted Crr 0.0085 | 86.06s |
| **Measured** | **82.50-87.43s (mean 85.25)** |

Removing the correction entirely puts the model **inside the measured range**.
With settling on it is ~6s optimistic. The 3-8s optimism documented earlier is
largely this correction.

### Recommendation

1. **Do not try to model the gradient better from this data.** It cannot be done:
   quantisation error exceeds the signal, and the distance axis is unreliable.
2. **Retire `altimeterSettlingScale`, or demote it to an off-by-default
   experiment.** Test at minimum: removing it moves the headline from 79.25s to
   84.21s and improves launch time RMSE from 3.82 to 2.43.
3. **Exclude 09:31 from all fitting**, not just geometry. It breaks conservation
   of energy in the first 50m.
4. **Treat launch parameters as unidentified rather than fitted** until encoder
   and IMU data exist. The previously proposed effective `launchResistance` of
   0.0085 was fitted on top of the suspect correction and should not be trusted
   as a transferable number.
5. The independent check worth doing cheaply: **compare the recorded start
   elevation against a survey or mapping DEM.** If the real start line is ~2.3m
   higher than 96.8m, the settling story is vindicated as a datum error and can be
   replaced with a one-line offset. If it is not, the correction should go.
