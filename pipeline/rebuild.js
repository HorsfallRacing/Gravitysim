// REBUILD WRAPPER — runs the Node stages of the course pipeline in order.
//
// The rebuild CANNOT be a single command, because stage 3b (roadsnap.js) must
// run in a browser: it classifies tarmac from Esri aerial imagery, and the
// tile endpoint serves JPEG, which Node cannot decode unaided. See the
// "Road snap" section of PIPELINE_NOTES.md, and imagerypng.js for a proven
// route to removing this constraint.
//
// So the rebuild is deliberately TWO commands with a manual step between:
//
//   node rebuild.js              stages 1-2, then STOPS and tells you what to
//                                do in the browser
//   node rebuild.js --resume     stages 4-6, after snapped_line.json is written
//   node rebuild.js --all        both halves back to back. ONLY correct if
//                                snapped_line.json is already current for this
//                                centreline -- see the idempotency warning below.
//
// IDEMPOTENCY WARNING. The snap is a fixed-point iteration, not a pure
// function: roadsnap.js reads the CURRENT course and writes a corrected line,
// so a snapped_line.json produced against an older centreline is stale the
// moment buildcourse.js re-runs. --all reuses whatever is on disk and is only
// for re-running the deterministic tail (e.g. after changing corner detection).

const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const DIR = __dirname;

const PRE  = ['fetchdtm.js', 'buildcourse.js'];
const POST = ['buildfromline.js', 'buildasset.js', 'injectcourse.js'];

function run(script) {
  process.stdout.write(`\n=== ${script} ===\n`);
  execFileSync(process.execPath, [script], { cwd: DIR, stdio: 'inherit' });
}

const arg = process.argv[2] || '';
const resume = arg === '--resume', all = arg === '--all';
if (arg && !resume && !all) {
  console.error('usage: node rebuild.js [--resume|--all]');
  process.exit(2);
}

try {
  if (!resume) PRE.forEach(run);

  if (!resume && !all) {
    const snap = path.join(DIR, 'snapped_line.json');
    const age = fs.existsSync(snap)
      ? `(existing one on disk is now STALE: written ${fs.statSync(snap).mtime.toISOString()}, before this rebuild)`
      : '(none on disk)';
    console.log(`
========================================================================
STOP. The next stage cannot run in Node.

  3b. ROAD SNAP -- browser required
      1. node server.js
      2. open http://localhost:8137/Tools.html
      3. paste the whole of roadsnap.js into the browser console
      4. wait for it to log "wrote snapped_line.json"

      snapped_line.json ${age}

Then finish the rebuild with:

  node rebuild.js --resume
========================================================================
`);
    process.exit(0);
  }

  POST.forEach(run);
  console.log('\nRebuild complete: course.harewood.json rebuilt and injected into Tools.html.');
} catch (e) {
  console.error(`\nRebuild FAILED at the stage above (exit ${e.status ?? '?'}). Nothing further was run.`);
  process.exit(1);
}
