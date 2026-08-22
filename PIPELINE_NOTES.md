# Course-building pipeline — notes for generalising to other tracks

Status: **the pipeline exists and works, but only Harewood has been run through
it.** This file records how it works, what is generic, what is track-specific,
and what would have to change to add a second venue. Written while building the
Harewood course asset so the knowledge isn't reconstructed later.

Scripts live in `pipeline/`. Full rebuild from source:

```
node fetchdtm.js             # LIDAR tile from the EA WCS (~1 s; gitignored, 4 MB)
node buildcourse.js          # runs -> spline -> mean -> SavGol -> LIDAR elevation
# then roadsnap.js in the browser (see stage 3b), which writes snapped_line.json
node buildfromline.js        # re-resample and re-sample elevation on the snapped line
node buildasset.js           # curvature, corners, provenance -> course.harewood.json
node injectcourse.js         # embed the asset into Tools.html
```

To serve the app (and to give roadsnap.js somewhere to POST):
`node pipeline/server.js` → http://localhost:8137/Tools.html

---

## Why this exists

The original sim derived elevation, distance and corner geometry from a single
Garmin GPX. Every one of those turned out to be wrong in a way that mattered:

| Quantity | From GPX | Problem |
|---|---|---|
| Elevation | barometric altimeter | up to **8.8 m** wrong mid-course |
| Distance | haversine on raw lat/lon | inflated by GPS jitter |
| Corner radius | 2nd derivative of position | Willow spread **28–102 m** across runs |

All three are fixed by taking terrain from LIDAR and geometry from a smoothed
multi-run centreline. See PROJECT_SUMMARY.md for the evidence.

---

## The pipeline, stage by stage

### 1. Source runs → OSGB36

`osgb.js` — WGS84 ⇄ OSGB36 National Grid, Helmert 7-parameter + Transverse
Mercator. Pure JS, no dependencies.

- Forward projection validated against the **OS worked example** (Caister water
  tower) to **sub-millimetre**.
- Datum shift magnitude checked (104 m at Harewood — normal for the UK).
- Round-trip error 2.4 mm, which is solver convergence tolerance, not method error.
- Accurate to ~5 m absolute (Helmert). **OSTN15 would be needed for sub-metre
  work** and requires a ~15 MB shift grid. Not needed for sampling a 1 m DTM.

**Generic.** Works anywhere in Great Britain.

### 2. Terrain → LIDAR DTM

Environment Agency **LIDAR Composite DTM 1 m**, free under Open Government
Licence, ~99% of England, **±15 cm RMSE vertical**.

Fetched by **WCS**, which returns just the bounding box wanted rather than a
whole 5 km tile:

```
https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs
  ?service=WCS&version=2.0.1&request=GetCoverage
  &coverageId=13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m
  &subsettingCrs=http://www.opengis.net/def/crs/EPSG/0/27700
  &subset=E(433350,433900)&subset=N(445350,445950)
  &format=image/tiff
```

Harewood: 550 × 600 m, 4.19 MB, **1.2 seconds, zero nodata**.

Notes learned the hard way:
- Axis labels are `E` and `N` (from `DescribeCoverage`), not `x`/`y`.
- The GeoTIFF is **tiled** (512×512), not stripped, and georeferences via
  `ModelTransformation` (34264), not `ModelPixelScale` + `ModelTiepoint`.
- `format=text/plain` also works and is easier to parse if you don't want a
  TIFF reader.
- Only **1 m and 2 m** DTM are exposed via WCS. DSM, first-return and
  **intensity** are download-portal or raw LAZ only.

`readtif.js` — minimal reader for exactly this GeoTIFF flavour (uncompressed,
tiled, float32, big-endian), plus bilinear sampling. Asserts everything it
assumes rather than failing silently.

**Generic for England.** Wales (DataMapWales / NRW) and Scotland (Scottish
Remote Sensing Portal) publish their own open LIDAR under different endpoints —
this stage needs a pluggable DEM source to go beyond England.

### 3. Centreline from multiple runs

`buildcourse.js`:

1. Project every run to OSGB36.
2. Re-parameterise each by **fraction of its own length**, so runs of differing
   recorded length average without distance drift.
3. Take the mean position at 2000 fractional stations.
4. **Savitzky–Golay smooth (window ±40, order 3).**
5. Resample to exact 1 m stations.
6. Sample LIDAR elevation at each station.

#### Interpolate with a spline before averaging

The source GPX points are ~15 m apart. Joining them with **straight lines chords
across every corner**: on Chippy's at R≈18 m a 15 m chord cuts **1.54 m inside
the true arc**. Averaging four such polylines and smoothing cannot recover the
arc — it bakes the chording in. Fixed with centripetal Catmull-Rom
(`catmull.js`), verified against a synthetic circle of known radius:

| | Worst radial error |
|---|---|
| Linear interpolation | 1.540 m |
| **Catmull-Rom** | **0.192 m** |

This was the dominant line error, larger than the smoothing bias below, and it
was found by eye on a satellite overlay before it was found in the numbers.

#### Use Savitzky–Golay, never a moving average

This is the single most important lesson in this file.

A moving average is a local *constant* fit, so it pulls a curve inward by
approximately **L²/(6R)**. Measured on this course:

| Method | Country shift | Chippy's shift | Line length |
|---|---|---|---|
| moving average ±25 | **2.06 m** | **2.04 m** | 1061.5 m |
| SavGol ±25 ord 2 | 0.55 m | 0.57 m | 1086.3 m |
| **SavGol ±40 ord 3** | **0.84 m** | **0.96 m** | **1085.1 m** |
| SavGol ±60 ord 3 | 1.38 m | 1.26 m | 1082.4 m |

The moving average put the line on the **inside kerb** instead of the middle of
the road, and shortened the course by **24 m** — worth about **1.9 s** of run
time, most of the ±2.5 s run-to-run noise floor, spent entirely on an artefact.

It also nearly caused a false conclusion: the 26.6 m the moving average removed
was initially recorded as "GPS jitter removed from the distance axis". It was
mostly corner-cutting. Real jitter is only ~3 m.

Implementation note: the SavGol normal equations **must** be centred and scaled
(offsets normalised to [-1,1], local mean removed) or they are hopelessly
ill-conditioned at National Grid coordinate magnitudes and return NaN.

### 3b. Road snap (browser stage)

`roadsnap.js` — constrains the centreline to the tarmac, classified from
aerial imagery. **Must run in a browser** (Node cannot decode JPEG tiles):
serve the repo, open Tools.html, paste the file into the console, then run
`node buildfromline.js && node buildasset.js && node injectcourse.js`.

Why it is needed: the centreline is a mean of four GPS traces. GPS error,
imagery georeferencing and residual smoothing bias together left it **up to
5.5 m off the road**. The car physically cannot leave the tarmac, so the road
edge is real information.

| | Before snap | After |
|---|---|---|
| Off-road stations (good light) | 145 | **22** |
| Worst excursion | 5.5 m | **1.75 m** |
| Chippy's apex | 0.5 m outside the edge | on road, ~1.8 m inside |

**Where it fails, and how that is handled:**
- **Tree canopy.** Shaded road is lit by light filtered through leaves and reads
  *greener than sunlit grass* — chromaticity cannot separate them either. Those
  stations are found by a transect-brightness test (<75) and left untouched
  rather than guessed at. ~290 of 1092 stations are unclassifiable this way.
- **Adjacent tarmac.** The farmyard near Orchard can be mistaken for the course.
  Guarded by a plausible-width filter (3.5–14 m) and a median filter along d.
- Corrections are tapered over ±14 m so the snap eases in rather than kinking
  the line. Margin is **2.0 m** from the kerb, capped at a third of the road
  width. An earlier 0.9 m margin technically put the line on tarmac but left it
  hugging the inner kerb at hairpins, which reads as "on the grass" at map zoom
  and is not a line anyone drives.
- The snap is a **fixed-point iteration**: it operates on the current course and
  writes a new one, so re-running `buildcourse.js` from scratch requires
  re-running the snap too.

### 4. Corner detection

`curvature.js` — continuous radius profile by circle fit over a moving window,
then local minima with a **prominence test** (surrounding radius ≥ 2× the apex)
so a gentle bend on a straight isn't promoted to a named corner.

Harewood result, all six corners found in order with **handedness matching the
published course guide** (reversed for top-to-bottom running). Radius here is
the minimum local radius at the apex (1/|κ|), not a circle fit over a window —
a fixed window biases tight corners *high* by dragging the fit onto the entry
and exit straights:

| Corner | d (m) | R (m) | Direction |
|---|---|---|---|
| Quarry | 28 | 22.9 | left |
| Farmhouse/Croisdale | 378 | 22.6 | right |
| Orchard | 545 | 16.1 | left |
| Willow | 760 | 27.6 | left |
| Country | 860 | 20.9 | right |
| Chippy's | 1037 | 20.3 | left |

Course length **1090 m**, finish **1066 m**, drop **67.77 m**.

**Store signed curvature, not radius.** Radius blows up and changes sign at
inflection points, where circle-fitting is ill-posed. This produced an apparent
67 km/h grip-limit discrepancy at d=801 that was pure fitting artefact — signed
curvature there runs +3.99 → −0.88 → −2.22 per 1000 m, i.e. a handedness change.
Curvature is well defined everywhere; derive radius only where |κ| is meaningful.
The old sim's `STRAIGHT_RADIUS = 3000` sentinel is a workaround for this.

Known open issue: the circle-fit window is a fixed ±30 m, which biases tight
corners low by including entry and exit straights. Should be scaled per corner.

---

## What is generic vs track-specific

| Stage | Generic? |
|---|---|
| WGS84 ⇄ OSGB36 (`osgb.js`) | Yes, all of GB |
| GeoTIFF read + sample (`readtif.js`) | Yes |
| SavGol smoothing (`savgol.js`) | Yes |
| Centreline construction | Yes |
| Corner detection | Yes (prominence threshold may need tuning) |
| LIDAR WCS fetch | England only |
| Source GPX runs | **Track-specific** |
| Bounding box | **Track-specific** (derivable from the runs) |
| Corner names | **Track-specific** |
| Finish line position | **Track-specific** |

So adding an English venue is: supply GPX runs, name the corners, set the
finish. Everything else already runs.

---

## Decisions to take before the course asset is frozen

1. **Course asset must be track-agnostic from day one.** If `Tools.html` embeds
   Harewood-shaped data, a second venue means refactoring the app. If it loads a
   `COURSE` object against a schema, a second venue is a data change. No extra
   cost to do this right initially.
2. **Store signed curvature and per-track provenance** (source, date, method,
   error bars), not just numbers.
3. **Keep the derivation scripted end to end**, so any course can be rebuilt
   when a method improves. This has already happened twice in one session.

Deliberately deferred: track-creation UI, generalised corner naming, non-England
DEM sources, tarmac-edge digitising.

---

## Things explicitly ruled out, with reasons

- **Tarmac edge detection from the 1 m DTM.** Doesn't work. The detector finds
  the bench the road sits in, not the kerb — median "width" came out 10.5 m
  ranging 3.8–25.3 m, i.e. open parkland. A 4–6 m road across a 1 m grid is
  ~5 samples with ±15 cm noise each. Would need LIDAR **intensity** (tarmac and
  grass reflect differently), which means the download portal or raw LAZ.

- **Racing-line solving / minimum-radius feasibility.** Minimum turning radius
  never binds: even a 2.4 m wheelbase at 15° lock gives a 9 m minimum radius
  against a tightest corner of 23 m. You would need **3.3°** of steering lock for
  it to matter. Line choice also largely cancels in a concept-vs-concept Δt,
  since both vehicles run the same road with the same driver.

- **Modelling gradient better from GPX.** Quantisation exceeds the signal and
  the distance axis is unreliable. Superseded entirely by LIDAR.

---

## Harewood-specific results worth keeping

- Course bounding box: **E 433395–433849, N 445408–445899** (OS grid SE, tile SE34NW)
- Start line: **E 433833.4, N 445413.9** — LIDAR elevation **97.06 m**
- Centreline length **1085 m**; drop over the raced section **67.54 m**
- Barometric start elevation was 96.80 m — only **+0.43 m** below surveyed, which
  **refutes** the `altimeterSettlingScale` hypothesis (it needed +2.31 m)
- Barometric profile error is up to **−8.8 m** mid-course; roughly half fits a
  lag model with **τ ≈ 3.1 s**, consistent with error ∝ descent rate
- Official course is 1448 m rising 76 m; the run is short of Esses/Clark's
- Run 12:17 leaves the road entirely between Willow and Country — visually
  confirmed against imagery, correctly excluded from geometry fitting

## Open

- ~~Finish line~~ **Resolved.** The finish is at the **end of the kerb**, set from
  rider knowledge and corroborated by detecting white kerb paint in imagery
  (runs d=1068–1089). Finish = **1089 m**. The previous provisional value of
  1066 m was the legacy `FINISH_DISTANCE` remapped, and was 23 m early.
- **There is no push-off.** The old `V0` (~4 km/h) was the mean first recorded
  GPX speed — an artefact of trackpoint placement, kept to work around a
  boundary bug that surveyed elevation removed. The car starts from rest;
  the start line falls at 6.6%, giving 0.605 m/s². Removing it costs 1.6 s.
- **The model is now ~3–5 s pessimistic** (90.6 s vs measured 82.5–87.4). This
  is not a regression: a fictitious head start and a 23 m-short course were two
  compensating errors hiding a real gap. μ is the prime suspect — it is
  `fitted` against corner radii that no longer exist and needs recalibrating.
- Corner circle-fit windows should scale per corner.
- Half the barometric elevation error remains unexplained after the lag model.
