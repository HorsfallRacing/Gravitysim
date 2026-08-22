# Onboard Logger — File Format & Ingest Spec (draft v1)

Status: **design draft, nothing implemented.** This exists so the logger firmware
and `Tools.html` are built against the same contract rather than being reconciled
afterwards. See PROJECT_SUMMARY.md's "Data source" section for why that matters
here specifically.

---

## Part 1 — What the logger writes

### Format: CSV with a header block

One file per run. Plain text. Chosen over a binary format because it opens in
Excel at the trackside, parses in the browser in three lines, and can be read by
a human when something looks wrong — which is worth more than the write
performance a binary format would buy. At the data rates involved (~5 MB for a
90-second run) storage is not a constraint.

A file has three parts:

```
# schema_version: 1                 <- metadata block, lines start with #
# run_id: 2026-08-23_run03
# ...
time_s,gnss_lat,gnss_lon,imu_ax     <- channel names (one row)
s,deg,deg,m/s2                      <- units (one row)
0.000,53.89412,-1.53887,0.02        <- data, one row per master tick
0.005,53.89412,-1.53887,0.04
```

### The metadata block

Everything that describes the run but isn't sampled. Free-form `# key: value`.
Unknown keys are preserved and shown, never rejected — this is where you record
the things that later explain unexplained spread.

```
# schema_version: 1
# logger_id: gk-logger-01
# firmware: 0.3.2
# run_id: 2026-08-23_run03
# datetime_utc: 2026-08-23T10:14:02Z
# course: harewood-reverse
# rider: <name>
# mass_total_kg: 125.3
# corner_weight_fl_kg: 31.2
# corner_weight_fr_kg: 30.8
# corner_weight_rl_kg: 31.9
# corner_weight_rr_kg: 31.4
# cg_height_m: 0.34
# wheelbase_m: 1.42
# track_width_f_m: 0.98
# track_width_r_m: 1.02
# tyre_set: pro-one-tube-A
# tyre_age_runs: 7
# pressure_cold_kpa_fl: 448
# pressure_cold_kpa_fr: 448
# pressure_cold_kpa_rl: 441
# pressure_cold_kpa_rr: 441
# wheel_circumference_m: 1.598
# encoder_teeth_per_rev: 12
# imu_mount_note: chassis rails, x forward, y left, z up
# weather: dry, overcast, 18C
# track_condition: dry
# notes: brake cable retensioned before this run
```

### Units — no exceptions, no unit suffixes in names

| Quantity | Unit | Column examples |
|---|---|---|
| Time | seconds | `time_s` |
| Distance / position | metres, decimal degrees | `gnss_alt_m`, `gnss_lat` |
| Speed | m/s | `gnss_speed_ms` |
| Acceleration | m/s² | `imu_ax` |
| Rotation rate | deg/s | `imu_gz` |
| Angle | degrees | `drv_steer_ang` |
| Force | newtons | `sus_load_fl` |
| Pressure | kPa | `tyre_press_fl` |
| Temperature | °C | `tyre_temp_fl` |

The sim converts to whatever it displays (it works in km/h internally). **The
file is always SI.** No file ever contains a mix.

### Rate handling

One master rate — recommend **200 Hz** — and one row per tick. Channels that
update more slowly leave their cell **empty** between updates.

An empty cell means *"no new reading"*, not zero. The ingest forward-fills them.
This wastes some bytes and buys a format with no per-channel timing ambiguity,
which is the right trade.

### Rules the firmware must follow

1. **Timestamp at acquisition, not at write.** `time_s` is when the sample was
   taken, from the MCU's own monotonic clock, disciplined by the GNSS PPS pin.
2. **Log raw, derive nothing.** No speed from position, no filtering, no
   smoothing, no computed slip. Every derived quantity is recomputed by the sim,
   where the method is visible and changeable. This is the rule that a Garmin
   breaks and that cost this project a session.
3. **Never write a distance column.** Distance along course is the sim's job
   (see ingest step 5).
4. **Write a dropped-sample counter.** A gap you know about is a data quality
   note; a gap you don't know about is a wrong answer.
5. **Ten seconds stationary at the start line, logged.** This is the IMU zero
   reference. Without it a 1° mount error injects 0.17 m/s² into the wrong axis.

---

## Part 2 — Channel list

### Core — required

The sim rejects a file missing any of these. This set alone reproduces exactly
what a GPX gives today, no more.

| Column | Unit | Notes |
|---|---|---|
| `time_s` | s | From run start, monotonic, never resets |
| `gnss_lat` | deg | Decimal degrees, ≥7 dp |
| `gnss_lon` | deg | Decimal degrees, ≥7 dp |

### Core — strongly recommended

Absent, the sim falls back to its current behaviour and says so in the UI.

| Column | Unit | Rate | Unlocks |
|---|---|---|---|
| `gnss_speed_ms` | m/s | 10–25 Hz | **Measured** speed. Retires central-difference reconstruction — limitation #2 in PROJECT_SUMMARY |
| `gnss_alt_m` | m | 10–25 Hz | Elevation, if RTK-fixed |
| `gnss_fix` | enum | 10 Hz | `none`/`2d`/`3d`/`dgps`/`rtk_float`/`rtk_fixed` |
| `gnss_sats` | count | 10 Hz | Data-quality filtering |
| `gnss_hacc_m` | m | 10 Hz | Per-sample horizontal uncertainty → **weighted** circle fit instead of unweighted |
| `gnss_vacc_m` | m | 10 Hz | Vertical uncertainty |
| `gnss_sacc_ms` | m/s | 10 Hz | Speed uncertainty |
| `sys_dropped` | count | 1 Hz | Cumulative dropped samples |
| `sys_vbat` | V | 1 Hz | Brownout detection |

### Inertial

| Column | Unit | Rate | Unlocks |
|---|---|---|---|
| `imu_ax` `imu_ay` `imu_az` | m/s² | 200 Hz | Friction circle; **gradient without a barometer** (see below) |
| `imu_gx` `imu_gy` `imu_gz` | deg/s | 200 Hz | `imu_gz` (yaw rate) → **radius as `v / ω`**, replacing the GPS second-derivative estimate that swung Willow 28–102 m |
| `imu_temp` | °C | 1 Hz | Bias correction |
| `imu_mx` `imu_my` `imu_mz` | µT | 50 Hz | Heading backup (optional) |

> **Gradient from the IMU.** `imu_ax − d(gnss_speed_ms)/dt = g·sin(θ)`. Slope,
> continuously, referenced to gravity, with no dependence on a barometric
> altimeter. This is a real replacement for `altimeterSettlingScale()` rather
> than another unverified curve.

### Wheels

| Column | Unit | Rate | Unlocks |
|---|---|---|---|
| `whl_count_fl` `_fr` `_rl` `_rr` | count | 200 Hz | Cumulative encoder counts — **not** a computed speed |
| `whl_edge_t_fl` … | s | per edge | Optional higher-resolution variant: timestamp of last tooth edge |

Wheel speed vs `gnss_speed_ms` gives **slip** — the channel that finally
separates "grip limited" from "driver chose to brake", which PROJECT_SUMMARY
currently resolves by rider recollection. Per-wheel counts identify *which* end
let go.

### Driver inputs

| Column | Unit | Rate | Unlocks |
|---|---|---|---|
| `drv_steer_ang` | deg | 100 Hz | Intended vs achieved radius = measured understeer |
| `drv_brake_pos` | 0–1 | 100 Hz | **Definitively labels every corner braked/not-braked** |
| `drv_brake_press` | kPa | 100 Hz | Proportional to brake torque, if hydraulic |
| `drv_steer_torque` | Nm | 100 Hz | Self-aligning torque peaks then falls at the limit — front-axle saturation detector |
| `drv_marker` | 0/1 | on change | Rider event button |

### Load & suspension

| Column | Unit | Rate | Unlocks |
|---|---|---|---|
| `sus_load_fl` `_fr` `_rl` `_rr` | N | 200 Hz | **Measured** normal load — the quantity the load-transfer panel currently models |
| `sus_pos_fl` `_fr` `_rl` `_rr` | m | 100 Hz | Damper position, if sprung |
| `sus_ride_f` `sus_ride_r` | m | 50 Hz | Ride height |

`sus_load_*` with `imu_ay` gives μ **per axle, per instant** — the honest version
of one global μ.

### Tyres & brakes

| Column | Unit | Rate | Unlocks |
|---|---|---|---|
| `tyre_press_fl` `_fr` `_rl` `_rr` | kPa | 1 Hz | μ vs pressure |
| `tyre_temp_fl` `_fr` `_rl` `_rr` | °C | 10 Hz | Grip vs temperature |
| `tyre_temp_fl_i` `_fl_m` `_fl_o` … | °C | 10 Hz | 3-zone variant (inner/middle/outer) — camber evidence |
| `hub_temp_fl` … | °C | 1 Hz | Crr drift, binding brake |
| `brake_disc_temp_f` `_r` | °C | 10 Hz | Fade across a day |
| `brake_torque_f` `_r` | Nm | 200 Hz | Direct longitudinal tyre force |

### Aero & atmosphere

| Column | Unit | Rate | Unlocks |
|---|---|---|---|
| `air_dyn_press` | Pa | 50 Hz | Pitot → **true airspeed**. Deletes the wind-guessing problem, including the unverified placeholder currently in the "actual weather" mode |
| `air_static_press` | Pa | 10 Hz | With temp/humidity → real air density, retires fixed ρ=1.225 |
| `air_temp` | °C | 1 Hz | " |
| `air_humidity` | % | 1 Hz | " |
| `air_yaw_ang` | deg | 10 Hz | Flow yaw angle → yawed CdA |
| `track_temp` | °C | 1 Hz | Biggest run-to-run μ variable across a day |

### Course events

| Column | Unit | Rate | Unlocks |
|---|---|---|---|
| `evt_beacon` | 0/1 | on change | Start/finish beacon — permanently fixes "the line is mid-corner, 24 m before the recording stops" |

### Naming rules

- Lowercase, `snake_case`, group prefix (`gnss_`, `imu_`, `whl_`, `drv_`, `sus_`,
  `tyre_`, `brake_`, `air_`, `evt_`, `sys_`).
- Corner suffixes are always `_fl` `_fr` `_rl` `_rr`, in that order.
- **The schema is additive.** New channels may be appended at any time; existing
  ones are never renamed or repurposed. A v1 file must still load into a v5 sim,
  and a v5 file must load into a v1 sim with the extra columns ignored.

---

## Part 3 — The ingest path

What `Tools.html` does when a file is dropped. Steps 1–4 and 9 mirror what
`addGpxRun()` already does today.

**1. Read** — `FileReader.readAsText`, unchanged from the current GPX handler.

**2. Parse header** — `#` lines into a metadata object. Unknown keys kept.

**3. Parse columns** — names row + units row → a channel map. Assert the units
row matches this spec; a mismatch is a hard reject, not a silent conversion.

**4. Validate** — reject with a specific message, never a generic failure:

| Check | Threshold | Reuses |
|---|---|---|
| Schema version understood | ≤ current | new |
| Required channels present | `time_s`, `gnss_lat`, `gnss_lon` | new |
| Usable rows | ≥ 10 | existing GPX check |
| Total distance | 500–2000 m | existing GPX check |
| Start within | 300 m of course start | existing GPX check |
| `time_s` monotonic | strictly increasing | new |
| Dropped samples | warn if > 1% | new |
| GNSS fix quality | warn if RTK expected but not achieved | new |

**5. Distance** — computed by the sim, always, using haversine cumulative on
`gnss_lat`/`gnss_lon`, identical to `processGpxRun()`. **A distance column in the
file is ignored even if present.** This is the single rule that prevents a repeat
of the two-source distance disagreement.

**6. Speed** — prefer `gnss_speed_ms` (measured). Fall back to central-difference
only if absent. Record which was used in a per-run `provenance` field so the UI
can label it — the existing "measured / estimated / unverified" markers in the
input rail extend naturally to run data.

**7. Resample** — build the model's existing coarse grid for `runsData`, and keep
the full-rate channels in a parallel structure. The physics model doesn't need
200 Hz; the new diagnostic panels do.

**8. Store** — push onto the existing arrays exactly as today:

```
runsData.push(...)        // {d, v} — unchanged shape, model untouched
allRoutePoints.push(...)  // {d, lat, lon} — unchanged shape
runVisible.push(true)
RUN_LABELS.push(label)
runChannels.push({...})   // NEW — everything else, full rate, plus metadata
```

Keeping the first four shapes unchanged means **the physics model needs no
changes to accept a logger file.** Everything new reads `runChannels`.

**9. Redraw** — `updateChart()`, unchanged. Geometry fitting
(`fitCornerGeometryAcrossRuns`) picks the run up automatically, exactly as a
dropped GPX does now.

### What each channel group would light up, once present

| Present | Becomes possible |
|---|---|
| `gnss_speed_ms` | Limitation #2 closed — speed is measured, not reconstructed |
| `imu_gz` | Corner radius from yaw rate; the Willow ⚠ spread should collapse |
| `imu_ax` + `gnss_speed_ms` | Measured gradient; `altimeterSettlingScale()` retired |
| `whl_count_*` + `gnss_speed_ms` | Slip. μ becomes measured, not backed out — attacks the model's dominant sensitivity directly |
| `drv_brake_pos` | Braked/not-braked per corner becomes data. The "known issue, unresolved" split resolves itself |
| `sus_load_*` + `imu_ay` | Real friction circle; limitation #5 closed |
| `air_dyn_press` | True airspeed; the weather placeholder becomes unnecessary |
| `evt_beacon` | Exact finish line, every run |

---

## Part 4 — Open questions

1. **Master rate.** 200 Hz suits suspension and slip. 100 Hz halves the file and
   is probably enough for everything except load cells. Decide before firmware.
2. **Session persistence.** Dropped GPX runs are session-only by design. Logger
   files are much richer — worth persisting to `localStorage`, or still not?
3. **Multi-file runs.** If video is recorded separately, does the beacon channel
   carry enough to sync them, or does the logger need to drive a sync flash?
4. **Where the derived channels live.** Recomputed in the browser on every load
   (simple, always current) or cached (fast)? Recommend recompute — it keeps the
   method visible, consistent with how the project has handled every other
   derived quantity.
