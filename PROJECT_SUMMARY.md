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
