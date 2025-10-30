/**
 * === VolleyVision: p5.js video annotation for volleyball sets ===
 *
 * Features
 * - Plays a local MP4 inside a p5.js canvas.
 * - User “records” a rep by clicking the ball across frames to form a trail.
 * - Reps are coloured; they stay hidden during recording and reveal at the end.
 * - A replay dashboard (buttons) appears when the video ends.
 * - Calibration step converts screen pixels → real metres using the net (2.43 m).
 * - Computes per-rep PEAK HEIGHT (m and cm above net) + HORIZONTAL WIDTH (m).
 * - A stats table is rendered below the canvas at the end of the video.
 *
 * UX Notes
 * - Calibration is 4 clicks: Left Bottom (LB), Left Top (LT), Right Bottom (RB), Right Top (RT).
 * - No dark overlay during calibration; a top banner gives instructions.
 * - First click “primes” the video to guarantee a decodable frame is visible.
 *
 * Files
 * - index.html (loads p5.js and this file)
 * - sketch.js (this file)
 * - stupid-training.mp4 (video in the same folder)
 */

// ------------------------------ Global constants ------------------------------

// Official men’s beach volleyball net height (metres)
const NET_HEIGHT_M = 2.43;

// ------------------------------ Video state -----------------------------------

let vid;             // p5.MediaElement wrapping an HTML <video>
let ready = false;   // becomes true when the video metadata/data is available
let warmed = false;  // becomes true after we briefly play/pause to decode a frame
let started = false; // becomes true after the user starts playback (post-calibration)

// ------------------------------ Rep data --------------------------------------

/**
 * A “rep” = { points: [{x,y,t}, ...], color: [r,g,b], peakM, aboveNetCM, widthM, direction }
 * - points.x/y are canvas pixel coordinates when the user clicked
 * - points.t is the video time of that click (seconds)
 * - color is the trail colour for that rep
 * - peakM = absolute peak height in metres (ground → ball)
 * - aboveNetCM = centimetres above the net at the peak point
 * - widthM = horizontal start→end distance (metres) across the set
 * - direction = '→' or '←' for left/right (purely cosmetic)
 */
let trails = [];                                 // all completed reps
let current = { points: [], color: null };       // the rep currently being drawn

// When the video ends, we set this so all reps render; during recording they stay hidden
let showAllAtEnd = false;
// Dashboard toggle to show/hide trails on the end screen
let showTrails = true;

// ------------------------------ Calibration -----------------------------------

/**
 * We measure the net in pixels by asking the user to click:
 *  1) Left-BOTTOM (LB)
 *  2) Left-TOP    (LT)
 *  3) Right-BOTTOM(RB)
 *  4) Right-TOP   (RT)
 *
 * From these points we compute:
 *  - pixelsPerMeter = (average net pixel height) / NET_HEIGHT_M
 *  - topLine: the equation of the top tape in image space (y = m*x + b).
 *    This lets us find the pixel y of the top tape at ANY x; useful for “above net” calc.
 */
let calibStep = 0;                                // 0..4 (4 means calibration finished)
let calibPts = { LB: null, LT: null, RB: null, RT: null };
let pixelsPerMeter = null;                        // conversion factor (px / m)
let topLine = null;                               // { m, b } for the top tape

// ------------------------------ UI widgets ------------------------------------

let btnReplay, btnToggle, btnSnapshot, btnRestart, btnStats; // dashboard buttons
let statsDiv;                 // HTML container under the canvas for the stats table
let statsVisible = true;      // toggle to show/hide stats after the video ends

// ------------------------------ Colour palette --------------------------------

/**
 * Distinct colours for each rep; we cycle through the palette.
 * Using fixed RGB values keeps colours stable between runs (useful for marking).
 */
const PALETTE = [
  [255, 80, 80],   // red
  [255, 160, 0],   // orange
  [255, 220, 0],   // yellow
  [0, 190, 255],   // sky
  [80, 220, 160],  // mint
  [180, 120, 255], // purple
  [255, 100, 200], // pink
];
let paletteIdx = 0;
const nextColour = () => PALETTE[(paletteIdx++) % PALETTE.length].slice();

// ------------------------------ Setup -----------------------------------------

function setup() {
  // Canvas matches video aspect here (960x540 ~ 16:9); change if your video differs
  createCanvas(960, 540);
  textFont('system-ui');

  // Create the <video>, but we’ll draw it on the canvas with image(vid, ...)
  // ⚠️ If you keep the original filename with a space, use 'stupid training.mp4' instead.
  vid = createVideo('stupid-training.mp4', () => console.log('video element created'));
  vid.attribute('playsinline', ''); // stay inline on iOS instead of fullscreen
  vid.attribute('muted', '');       // allow autoplay in browsers that require muted
  vid.volume(0);                    // ensure silence
  vid.hide();                       // hide the DOM element; we draw frames ourselves

  // Once the browser has enough data to decode frames, mark ready.
  vid.elt.onloadeddata = () => { ready = true; };
  // NEW: extra hook some browsers fire when the first frame is ready to paint
  vid.elt.oncanplay = () => { ready = true; };

  // Basic error logging if the video fails to load
  vid.elt.onerror = (e) => console.error('VIDEO ERROR', e);

  // When playback naturally reaches the end:
  vid.elt.onended = () => {
    showAllAtEnd = true;   // reveal all trails
    showTrails = true;

    // compute summary metrics and render the stats table
    computeAllRepMetrics(); // peak height + width per rep
    renderStatsTable();

    // show the dashboard (replay/toggle/save/restart/stats)
    updateDashboard();
  };

  // First rep colour
  current.color = nextColour();

  // Create the stats container (shown only when the video ends)
  statsDiv = createDiv('');
  statsDiv.style('font-family', 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial');
  statsDiv.style('margin', '8px 0 0 0');
  statsDiv.style('padding', '12px');
  statsDiv.style('border-radius', '10px');
  statsDiv.style('background', '#111');
  statsDiv.style('color', '#fff');
  statsDiv.style('display', 'none');

  // Create dashboard buttons (hidden until end)
  btnReplay   = createButton('▶ Replay (hide trails)');
  btnToggle   = createButton('🎨 Toggle trails');
  btnSnapshot = createButton('💾 Save snapshot (PNG)');
  btnRestart  = createButton('⏮ Restart video');
  btnStats    = createButton('📊 Show/Hide Stats');

  // Shared button style for a clean, consistent look
  [btnReplay, btnToggle, btnSnapshot, btnRestart, btnStats].forEach((b) => {
    b.style('padding', '10px 14px');
    b.style('border-radius', '10px');
    b.style('border', 'none');
    b.style('background', '#ffffff');
    b.style('box-shadow', '0 2px 10px rgba(0,0,0,0.15)');
    b.style('font-family', 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial');
    b.style('cursor', 'pointer');
    b.hide(); // only visible after video ends
  });

  // ----- Dashboard actions -----

  // Replay: rewind to 0, hide trails, clear current rep, play again
  btnReplay.mousePressed(() => {
    showAllAtEnd = false;
    showTrails = false;
    statsDiv.style('display', 'none');
    current = { points: [], color: nextColour() };
    vid.time(0);
    vid.play();
    updateDashboard();
  });

  // Toggle whether trails are drawn on the end screen
  btnToggle.mousePressed(() => {
    showTrails = !showTrails;
    updateDashboard();
  });

  // Save the canvas (with trails) as a PNG image
  btnSnapshot.mousePressed(() => {
    const prev = showTrails;
    showTrails = true; // ensure trails are visible in the saved file
    redraw();
    saveCanvas('reps_snapshot', 'png');
    showTrails = prev;
  });

  // Restart is like immediate replay (also available via keyboard “S”)
  btnRestart.mousePressed(restartVideoHidden);

  // Show/Hide the stats table below the canvas
  btnStats.mousePressed(() => {
    statsVisible = !statsVisible;
    statsDiv.style('display', statsVisible ? 'block' : 'none');
  });
}

// ------------------------------ Draw loop --------------------------------------

function draw() {
  background(0);

  // Always draw the current video frame first (if available)
  if (ready) image(vid, 0, 0, width, height);

  // NEW: If the browser hasn’t produced a decodable frame yet, guide the user.
  if (!warmed) {
    centerMsg('Click once to load video');
    // Don’t return; we still want the calibration banner to be visible when applicable.
  }

  // ---- CALIBRATION MODE (before any recording) ----
  if (calibStep < 4) {
    if (!warmed) primeVideo(); // ensure a frame is visible during calibration

    // No semi-transparent overlay; just a banner at the very top and cross markers
    drawCalibrationBanner();
    drawCalibrationMarkers();

    // HUD shows “Calibration mode” and counters
    drawHUD(true);
    return; // stop here until calibration is done
  }

  // ---- NORMAL MODE (after calibration) ----
  strokeWeight(4);
  noFill();

  if (showAllAtEnd) {
    // End screen: optionally draw all completed trails
    if (showTrails) {
      for (const rep of trails) {
        stroke(rep.color[0], rep.color[1], rep.color[2]);
        drawSmoothPath(rep.points);
      }
    }
  } else {
    // Recording: draw only the current rep being created
    stroke(current.color[0], current.color[1], current.color[2]);
    drawSmoothPath(current.points);
  }

  // Heads-up display (status text and instructions)
  drawHUD(false);

  // Keep dashboard position/visibility in sync
  updateDashboard();
}

// ------------------------------ Video priming ----------------------------------

/**
 * Some browsers won’t show a decoded frame until playback begins.
 * We briefly play→pause (muted) to guarantee a frame exists for calibration.
 */
function primeVideo() {
  if (warmed) return;
  vid.volume(0);
  const p = vid.play();
  if (p && p.catch) p.catch(() => {}); // ignore autoplay promise errors
  setTimeout(() => {
    vid.pause();
    warmed = true;
    redraw(); // trigger a paint so the first frame appears
  }, 150); // tweak (120–240ms) for slower machines
}

// ------------------------------ Calibration UI ---------------------------------

// Large banner at the top so the net remains fully visible
function drawCalibrationBanner() {
  push();
  noStroke();
  fill(0, 200);
  rect(0, 0, width, 56);

  fill(255);
  textSize(24);               // large and readable on video
  textAlign(LEFT, CENTER);

  let msg = '';
  if (calibStep === 0) msg = 'Calibration 1/4 — Click the BOTTOM of the net at the LEFT antenna';
  if (calibStep === 1) msg = 'Calibration 2/4 — Click the TOP of the net at the LEFT antenna';
  if (calibStep === 2) msg = 'Calibration 3/4 — Click the BOTTOM of the net at the RIGHT antenna';
  if (calibStep === 3) msg = 'Calibration 4/4 — Click the TOP of the net at the RIGHT antenna';
  text(msg, 12, 28);
  pop();
}

// Crosshair markers showing which calibration points you’ve already clicked
function drawCalibrationMarkers() {
  if (calibPts.LB) drawCross(calibPts.LB.x, calibPts.LB.y, '#ff5757'); // bottom = red
  if (calibPts.LT) drawCross(calibPts.LT.x, calibPts.LT.y, '#57c7ff'); // top = blue
  if (calibPts.RB) drawCross(calibPts.RB.x, calibPts.RB.y, '#ff5757');
  if (calibPts.RT) drawCross(calibPts.RT.x, calibPts.RT.y, '#57c7ff');
}

// Simple cross drawing helper
function drawCross(x, y, color) {
  push();
  stroke(color); strokeWeight(3);
  line(x - 8, y, x + 8, y);
  line(x, y - 8, x, y + 8);
  pop();
}

// ------------------------------ HUD / Instructions -----------------------------

function drawHUD(inCalibration) {
  fill(255);
  noStroke();
  textSize(12);

  // Build a short status string
  const paused = vid && vid.elt ? vid.elt.paused : true;
  const status = inCalibration
    ? 'Calibration mode'
    : (showAllAtEnd ? 'Ended' : (paused ? 'Paused' : 'Playing'));

  text(
    `Status: ${status}   Reps: ${trails.length}   Current pts: ${current.points.length}`,
    12, height - 12
  );

  // Start instructions before the first click post-calibration
  if (!started && !inCalibration) {
    centerMsg(
      'Click once to start video\n' +
      'Click to add points • N = end rep • Z = undo\n' +
      'Space = play/pause • ,/. = step • R = reset • Enter = replay & hide • S = restart'
    );
  }

  // Extra tip while paused (not in calibration / not at the end)
  if (!showAllAtEnd && started && !inCalibration && vid.elt.paused) {
    text('Tip: press N to end a rep (it hides until the end).', 12, 40);
  }
}

// Draw centred helper text
function centerMsg(msg) {
  push();
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(18);
  text(msg, width / 2, height / 2);
  pop();
}

// ------------------------------ Mouse interaction ------------------------------

function mousePressed() {
  // NEW: If the video hasn’t been primed yet, do that on the very first click.
  if (!warmed) { primeVideo(); return; }

  // --- Handle calibration clicks first ---
  if (calibStep < 4) {
    // Record the four calibration points in order
    const pt = { x: mouseX, y: mouseY };
    if (calibStep === 0) calibPts.LB = pt;
    else if (calibStep === 1) calibPts.LT = pt;
    else if (calibStep === 2) calibPts.RB = pt;
    else if (calibStep === 3) calibPts.RT = pt;
    calibStep++;

    // After the fourth click, compute the calibration model
    if (calibStep === 4) finalizeCalibration();
    return;
  }

  // --- Normal interaction after calibration ---
  // First click after calibration starts playback
  if (!started) {
    const p = vid.play(); if (p && p.catch) p.catch(() => {});
    started = true;
    return;
  }

  // Ignore clicks on the end screen
  if (showAllAtEnd) return;

  // Record a point for the current rep (store video time too)
  current.points.push({ x: mouseX, y: mouseY, t: vid.time() });
}

// ------------------------------ Keyboard interaction ---------------------------

function keyPressed() {
  // Disable keys during calibration to avoid confusion
  if (calibStep < 4) return;

  if (key === ' ') {
    // Space: play/pause toggle
    if (vid.elt.paused) vid.play(); else vid.pause();

  } else if (key === 'N' || key === 'n') {
    // N: end the current rep (save to trails and start a fresh one)
    if (current.points.length) trails.push(current);
    current = { points: [], color: nextColour() };

  } else if (key === 'Z' || key === 'z') {
    // Z: undo last clicked point
    if (current.points.length) current.points.pop();

  } else if (key === ',') {
    // , : single-frame step backward (approx 1/30 s)
    if (!showAllAtEnd) { vid.pause(); vid.time(max(0, vid.time() - 1 / 30)); }

  } else if (key === '.') {
    // . : single-frame step forward
    if (!showAllAtEnd) { vid.pause(); vid.time(min(vid.duration(), vid.time() + 1 / 30)); }

  } else if (keyCode === ENTER) {
    // Enter: replay video and hide trails (good for “fresh” recording pass)
    showAllAtEnd = false;
    showTrails = false;
    statsDiv.style('display', 'none');
    current = { points: [], color: nextColour() };
    vid.time(0); vid.play();
    updateDashboard();

  } else if (key === 'S' || key === 's') {
    // S: restart at any time (same as the Restart button)
    restartVideoHidden();

  } else if (key === 'R' || key === 'r') {
    // R: full reset (clears reps and calibration)
    trails = [];
    current = { points: [], color: nextColour() };
    showAllAtEnd = false; started = false; ready = false;

    // Reset calibration model and UI state
    calibStep = 0; calibPts = { LB: null, LT: null, RB: null, RT: null };
    pixelsPerMeter = null; topLine = null; warmed = false;

    statsDiv.style('display', 'none'); statsDiv.html('');
    vid.time(0); vid.pause();
    ready = true;
    updateDashboard();
  }
}

// ------------------------------ Calibration math -------------------------------

/**
 * Build the pixel→metre model and the top-of-net line from the 4 clicked points.
 *  - Net pixel height on the left/right = |LT.y - LB.y|, |RT.y - RB.y|
 *  - Average those two to lessen perspective error → hAvgPx
 *  - pixelsPerMeter = hAvgPx / 2.43
 *  - Top tape line = through (LT) and (RT) → y = m*x + b
 */
function finalizeCalibration() {
  const hLeft  = Math.abs(calibPts.LT.y - calibPts.LB.y);
  const hRight = Math.abs(calibPts.RT.y - calibPts.RB.y);
  const hAvgPx = (hLeft + hRight) / 2;

  pixelsPerMeter = hAvgPx / NET_HEIGHT_M;

  // line through the two top-tape points (LT and RT)
  const m = (calibPts.RT.y - calibPts.LT.y) / (calibPts.RT.x - calibPts.LT.x);
  const b = calibPts.LT.y - m * calibPts.LT.x;
  topLine = { m, b };

  console.log('Calibration complete:', { hLeft, hRight, hAvgPx, pixelsPerMeter, topLine });
}

/**
 * Convert a point’s vertical offset from the net into metres.
 * We compute the pixel y of the top tape at the same x, then compare.
 * Returns positive metres if the point is ABOVE the net, negative if below.
 */
function metersAboveNetAtPoint(x, y) {
  if (!pixelsPerMeter || !topLine) return null;
  const yTop = topLine.m * x + topLine.b; // pixel y of top tape at this x
  const dyPx = (yTop - y);                // pixel difference (screen y grows downward)
  return dyPx / pixelsPerMeter;           // convert pixels → metres
}

/**
 * Horizontal distance helper (start → end, in metres).
 * We reuse pixelsPerMeter for x distance (approximation; ignores perspective foreshortening).
 */
function metersHorizDistance(p1, p2) {
  if (!pixelsPerMeter) return null;
  const dxPx = Math.abs(p2.x - p1.x);
  return dxPx / pixelsPerMeter;
}

// ------------------------------ Metrics per rep --------------------------------

/**
 * For each rep:
 *  - Peak height = max metresAboveNet among clicked points + NET_HEIGHT_M
 *  - Above-net (cm) = peakAboveNet(m) * 100 (rounded)
 *  - Width (m) = horizontal start→end distance (approx screen-space)
 *  - Direction = → (to right) or ← (to left) for readability
 */
function computeAllRepMetrics() {
  for (const rep of trails) {
    if (!rep.points || rep.points.length < 2) {
      rep.peakM = null;
      rep.aboveNetCM = null;
      rep.widthM = null;
      rep.direction = null;
      continue;
    }

    // ---- 1) Peak height above the net (metres) ----
    let peakAboveM = -Infinity;
    for (const p of rep.points) {
      const a = metersAboveNetAtPoint(p.x, p.y);
      if (a != null && a > peakAboveM) peakAboveM = a;
    }
    if (!isFinite(peakAboveM)) {
      rep.peakM = null;
      rep.aboveNetCM = null;
    } else {
      rep.peakM = NET_HEIGHT_M + peakAboveM;          // absolute height from ground
      rep.aboveNetCM = Math.round(peakAboveM * 100);  // centimetres above the net
    }

    // ---- 2) Horizontal width from first → last point (metres) ----
    const start = rep.points[0];
    const end   = rep.points[rep.points.length - 1];
    const wM = metersHorizDistance(start, end);
    rep.widthM = (wM != null) ? wM : null;

    // Directional arrow purely for display
    rep.direction = (end.x > start.x) ? '→' : (end.x < start.x ? '←' : '•');
  }
}

// ------------------------------ Stats table (HTML) -----------------------------

/**
 * Renders a table under the canvas with columns:
 *   Rep | Peak height (m) | Above net (cm) | Width (m)
 * Also shows “Highest Peak” and “Average” lines.
 */
function renderStatsTable() {
  const rows = [];
  let bestIdx = -1, bestVal = -Infinity;
  let sumPeak = 0, nPeak = 0;
  let sumWidth = 0, nWidth = 0;

  for (let i = 0; i < trails.length; i++) {
    const r = trails[i];

    if (r.peakM != null) {
      if (r.peakM > bestVal) { bestVal = r.peakM; bestIdx = i; }
      sumPeak += r.peakM; nPeak++;
    }
    if (r.widthM != null) {
      sumWidth += r.widthM; nWidth++;
    }

    rows.push({
      rep: i + 1,
      peakM: r.peakM,
      aboveCM: r.aboveNetCM,
      widthM: r.widthM,
      direction: r.direction || '',
      color: r.color
    });
  }

  const avgPeak  = nPeak  ? (sumPeak  / nPeak)  : null;
  const avgWidth = nWidth ? (sumWidth / nWidth) : null;

  // Build a styled HTML table string (kept inline for simplicity)
  let html = `
    <div style="font-size:14px; line-height:1.4">
      <div style="margin-bottom:8px; font-weight:600">SET STATS (Net = ${NET_HEIGHT_M.toFixed(2)} m)</div>
      <table style="width:100%; border-collapse:collapse; overflow:hidden; border-radius:10px">
        <thead>
          <tr style="background:#222; color:#ddd">
            <th style="text-align:left; padding:8px 10px">Rep</th>
            <th style="text-align:left; padding:8px 10px">Peak height (m)</th>
            <th style="text-align:left; padding:8px 10px">Above net (cm)</th>
            <th style="text-align:left; padding:8px 10px">Width (m)</th>
          </tr>
        </thead>
        <tbody>
  `;

  rows.forEach((row) => {
    const clr = `rgb(${row.color[0]},${row.color[1]},${row.color[2]})`;
    const peakTxt  = row.peakM  != null ? row.peakM.toFixed(2)  : '—';
    const aboveTxt = row.aboveCM != null ? `${row.aboveCM}`      : '—';
    const widthTxt = row.widthM != null ? `${row.direction} ${row.widthM.toFixed(2)}` : '—';

    html += `
      <tr style="background:#181818; border-top:1px solid #2a2a2a">
        <td style="padding:8px 10px">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${clr};margin-right:8px"></span>
          Rep ${row.rep}
        </td>
        <td style="padding:8px 10px">${peakTxt}</td>
        <td style="padding:8px 10px">${aboveTxt}</td>
        <td style="padding:8px 10px">${widthTxt}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
  `;

  if (bestIdx >= 0) {
    html += `<div style="margin-top:8px">🏅 <b>Highest Peak:</b> Rep ${bestIdx + 1} (${bestVal.toFixed(2)} m)</div>`;
  }
  if (avgPeak != null) {
    html += `<div><b>Average Peak:</b> ${avgPeak.toFixed(2)} m</div>`;
  }
  if (avgWidth != null) {
    html += `<div><b>Average Width:</b> ${avgWidth.toFixed(2)} m</div>`;
  }

  html += `</div>`;

  statsDiv.html(html);
  statsDiv.style('display', 'block');
  statsVisible = true;
}

// ------------------------------ Dashboard layout -------------------------------

/**
 * Shows buttons across the bottom of the canvas when the video has ended.
 * Hides them during recording or replay.
 */
function updateDashboard() {
  if (showAllAtEnd && calibStep >= 4) {
    const pad = 12, gap = 10, btnW = 190, btnH = 40;

    btnReplay.position(  pad,                       height - btnH - pad );
    btnToggle.position(  pad + btnW + gap,         height - btnH - pad );
    btnSnapshot.position(pad + (btnW + gap) * 2,   height - btnH - pad );
    btnRestart.position( pad + (btnW + gap) * 3,   height - btnH - pad );
    btnStats.position(   pad + (btnW + gap) * 4,   height - btnH - pad );

    btnReplay.show();
    btnToggle.show();
    btnSnapshot.show();
    btnRestart.show();
    btnStats.show();

    btnToggle.html(showTrails ? '🎨 Hide trails' : '🎨 Show trails');
  } else {
    [btnReplay, btnToggle, btnSnapshot, btnRestart, btnStats].forEach(b => b.hide());
  }
}

// ------------------------------ Drawing helpers --------------------------------

// Spline-ish path using curve vertices for a smooth trail
function drawSmoothPath(points) {
  if (!points || points.length < 2) return;
  beginShape();
  curveVertex(points[0].x, points[0].y);
  for (const p of points) curveVertex(p.x, p.y);
  curveVertex(points[points.length - 1].x, points[points.length - 1].y);
  endShape();
}

// Restart helper used by the button and “S” key
function restartVideoHidden() {
  showAllAtEnd = false;
  showTrails = false;
  statsDiv.style('display', 'none');
  current = { points: [], color: nextColour() };
  vid.time(0);
  vid.play();
  started = true;
  updateDashboard();
}


