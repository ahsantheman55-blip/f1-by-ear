/* F1 by Ear - pure game logic (no DOM, no audio). Works in browsers and Node. */
(function (root) {
  'use strict';
  var KMH = 3.6;
  var PHYS = {
    vTop: 94,            // m/s, about 338 km/h
    accel0: 13.5,        // m/s2 at low speed
    gripBase: 22,        // m/s2 mechanical grip
    gripAero: 18,        // extra m/s2 at top speed (scales with v^2)
    brakeBase: 26, brakeAero: 14,
    coastBase: 2.5, coastAero: 7,
    carLen: 5.0, carWid: 1.9,
    gears: [83, 122, 157, 192, 226, 262, 298, 340] // km/h at the limiter in each gear
  };

  // ---------- Tracks ----------
  // r: signed radius in metres (+ right-hand bend, - left-hand), 0 = straight. n: name for notes.
  var TRACKS = {
    monza: {
      id: 'monza', name: 'Monza-style speedway', short: 'Monza', lanes: 4, laneW: 3.5, runoff: 'gravel', runoffW: 7, crowd: [[-250, 320], [3900, 4150]],
      blurb: 'Fast. Long flat-out straights, two chicanes, the Lesmo bends, Ascari and the long Parabolica.',
      segs: [
        { len: 1000 }, { len: 32, r: 26, n: 'the first chicane' }, { len: 32, r: -26, n: 'the first chicane' }, { len: 260 },
        { len: 480, r: 360, n: 'Curva Grande' }, { len: 330 },
        { len: 30, r: -30, n: 'the second chicane' }, { len: 30, r: 30, n: 'the second chicane' }, { len: 260 },
        { len: 110, r: 95, n: 'Lesmo 1' }, { len: 160 }, { len: 90, r: 75, n: 'Lesmo 2' }, { len: 880 },
        { len: 80, r: -95, n: 'Ascari' }, { len: 90, r: 120, n: 'Ascari' }, { len: 90, r: -160, n: 'Ascari' }, { len: 980 },
        { len: 120, r: 70, n: 'Parabolica' }, { len: 220, r: 140, n: 'Parabolica' }, { len: 150 }
      ]
    },
    monaco: {
      id: 'monaco', name: 'Monaco-style street circuit', short: 'Monaco', lanes: 3, laneW: 3.5, runoff: 'wall', runoffW: 1.0, crowd: [[-200, 250], [1450, 1700], [2700, 2900]],
      blurb: 'Tight and slow. Barriers right beside the track, a hairpin, a tunnel and a harbour chicane.',
      segs: [
        { len: 380 }, { len: 45, r: 28, n: 'Sainte Devote' }, { len: 120 }, { len: 380, r: -420, n: 'Beau Rivage' },
        { len: 90, r: -55, n: 'Massenet' }, { len: 40 }, { len: 55, r: 40, n: 'Casino' }, { len: 170 },
        { len: 40, r: 20, n: 'Mirabeau' }, { len: 110 }, { len: 34, r: -11, n: 'the hairpin' }, { len: 90 },
        { len: 35, r: 19, n: 'the second Mirabeau' }, { len: 60 }, { len: 40, r: 22, n: 'Portier' }, { len: 60 },
        { len: 520, r: 320, n: 'the tunnel', tunnel: true }, { len: 220 },
        { len: 26, r: -18, n: 'the harbour chicane' }, { len: 26, r: 18, n: 'the harbour chicane' }, { len: 200 },
        { len: 48, r: -40, n: 'Tabac' }, { len: 150 },
        { len: 38, r: -55, n: 'the swimming pool' }, { len: 38, r: 55, n: 'the swimming pool' }, { len: 110 },
        { len: 38, r: 60, n: 'the second swimming pool' }, { len: 38, r: -60, n: 'the second swimming pool' }, { len: 120 },
        { len: 48, r: 15, n: 'Rascasse' }, { len: 50 }, { len: 40, r: 25, n: 'Anthony Noghes' }, { len: 300 }
      ]
    },
    ring: {
      id: 'ring', name: 'Practice ring', short: 'the practice ring', lanes: 4, laneW: 3.5, runoff: 'gravel', runoffW: 7, crowd: [],
      blurb: 'A short practice loop with one corner of each kind.',
      segs: [
        { len: 650 }, { len: 160, r: 130, n: 'the fast right' }, { len: 350 }, { len: 70, r: -38, n: 'the medium left' },
        { len: 420 }, { len: 36, r: -12, n: 'the hairpin' }, { len: 280 },
        { len: 28, r: 24, n: 'the chicane' }, { len: 28, r: -24, n: 'the chicane' }, { len: 380 },
        { len: 200, r: 220, n: 'the long right' }, { len: 200 }
      ]
    }
  };

  function grip(v) { return PHYS.gripBase + PHYS.gripAero * Math.pow(v / PHYS.vTop, 2); }
  function brakeDecel(v) { return PHYS.brakeBase + PHYS.brakeAero * Math.pow(v / PHYS.vTop, 2); }
  function accelAt(v, top) { top = top || PHYS.vTop; var f = 1 - Math.pow(Math.min(v, top) / top, 2); return PHYS.accel0 * Math.max(0, f) + (v < 15 ? 2 : 0); }
  function coastDecel(v) { return PHYS.coastBase + PHYS.coastAero * Math.pow(v / PHYS.vTop, 2); }
  function cornerVmax(r, gripScale) {
    gripScale = gripScale || 1;
    if (!r) return PHYS.vTop * 1.2;
    var k = 1 / Math.abs(r), a = PHYS.gripAero * gripScale / (PHYS.vTop * PHYS.vTop);
    if (k <= a) return PHYS.vTop * 1.2;
    return Math.sqrt(PHYS.gripBase * gripScale / (k - a));
  }

  // Build per-metre arrays and corner groups
  function buildTrack(id) {
    var T = TRACKS[id]; if (!T) throw new Error('no track ' + id);
    if (T._built) return T;
    var L = 0, i, j;
    T.segs.forEach(function (s) { s.start = L; L += s.len; });
    T.length = L;
    var N = Math.ceil(L);
    T.kappa = new Float32Array(N); T.radius = new Float32Array(N); T.tunnel = new Uint8Array(N); T.segAt = new Uint16Array(N);
    T.segs.forEach(function (s, si) {
      for (j = Math.floor(s.start); j < Math.min(N, Math.ceil(s.start + s.len)); j++) {
        T.kappa[j] = s.r ? 1 / s.r : 0; T.radius[j] = s.r || 0; T.tunnel[j] = s.tunnel ? 1 : 0; T.segAt[j] = si;
      }
    });
    T.halfW = T.lanes * T.laneW / 2;
    T.laneY = []; for (i = 0; i < T.lanes; i++) T.laneY.push(-T.halfW + T.laneW * (i + 0.5));
    T.kerbIn = T.halfW - 1.0;           // kerb starts
    T.edge = T.halfW + 0.9;             // past this you are off the track
    T.wall = T.edge + T.runoffW;        // barrier
    // corner groups (merge parts closer than 60 m)
    var parts = [];
    T.segs.forEach(function (s) { if (s.r) parts.push({ start: s.start, len: s.len, r: s.r, dir: s.r > 0 ? 1 : -1, n: s.n, vmax: cornerVmax(s.r) }); });
    var groups = [], g = null;
    parts.forEach(function (p) {
      if (g && p.start - (g.end) < 60) { g.parts.push(p); g.end = p.start + p.len; }
      else { g = { parts: [p], start: p.start, end: p.start + p.len }; groups.push(g); }
    });
    groups.forEach(function (g, gi) {
      g.idx = gi; g.vmin = Math.min.apply(null, g.parts.map(function (p) { return p.vmax; }));
      g.name = g.parts.reduce(function (a, b) { return b.vmax < a.vmax ? b : a; }).n;
      g.parts.forEach(function (p) { p.sev = p.vmax >= PHYS.vTop ? 0 : (Math.abs(p.r) < 32 ? 3 : (p.vmax < 50 ? 2 : 1)); });
      g.sev = Math.max.apply(null, g.parts.map(function (p) { return p.sev; }));
      g.flat = g.vmin >= PHYS.vTop;
    });
    T.groups = groups;
    T.profiles = {};
    T._built = true;
    return T;
  }
  // Speed profile for a grip scale (1 = the limit). Backward braking pass, forward acceleration pass, wraps around.
  function profile(T, gs, bs, top) {
    var key = gs.toFixed(3) + '|' + bs.toFixed(3) + '|' + (top || 0).toFixed(2);
    if (T.profiles[key]) return T.profiles[key];
    var N = T.kappa.length, v = new Float32Array(N), i, k, pass;
    top = top || PHYS.vTop;
    for (i = 0; i < N; i++) v[i] = Math.min(top, cornerVmax(T.radius[i], gs));
    for (pass = 0; pass < 2; pass++) {
      for (k = 2 * N - 1; k >= 0; k--) { i = k % N; var nx = v[(i + 1) % N]; var b = brakeDecel(nx) * bs; var lim = Math.sqrt(nx * nx + 2 * b); if (v[i] > lim) v[i] = lim; }
      for (k = 0; k < 2 * N; k++) { i = k % N; var pv = v[(i - 1 + N) % N]; var a = accelAt(pv, top); var lim2 = Math.sqrt(pv * pv + 2 * a); if (v[i] > lim2) v[i] = lim2; }
    }
    T.profiles[key] = v; return v;
  }
  function brakeDist(v, vt, bs) { if (v <= vt) return 0; var b = (brakeDecel(vt) + brakeDecel(v)) / 2 * (bs || 1); return (v * v - vt * vt) / (2 * b); }

  // ---------- Random ----------
  function rng(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  var NAMES = ['Hartmann', 'Okafor', 'Rossi', 'Lindqvist', 'Moreau', 'Tanaka', 'Silva', 'Novak', 'Kowalski', 'Byrne', 'Duarte', 'Haddad'];
  var DIFF = { easy: { k: 0.86, spread: 0.035, mistake: 0.10 }, medium: { k: 0.925, spread: 0.03, mistake: 0.05 }, hard: { k: 0.975, spread: 0.02, mistake: 0.02 } };

  function wrapS(T, s) { var L = T.length; s = s % L; return s < 0 ? s + L : s; }
  function idx(T, s) { var i = Math.floor(wrapS(T, s)); return i >= T.kappa.length ? T.kappa.length - 1 : i; }

  // ---------- Race ----------
  function Race(opts) {
    opts = opts || {};
    var T = buildTrack(opts.track || 'monza');
    var R = this;
    R.T = T; R.opts = opts; R.laps = opts.laps || 3; R.rand = rng(opts.seed || (Date.now() & 0xffffff));
    R.mode = opts.mode || 'race'; // race | practice | lesson
    R.auto = !!opts.auto;
    R.t = 0; R.started = false; R.finished = false; R.events = [];
    R.diff = DIFF[opts.difficulty || 'medium'] || DIFF.medium;
    var n = R.mode === 'race' ? Math.max(0, Math.min(11, opts.rivals == null ? 5 : opts.rivals)) : (opts.rivals || 0);
    R.cars = [];
    var grid = opts.grid || 'back';
    var total = n + 1, pslot = grid === 'pole' ? 0 : grid === 'middle' ? Math.floor(total / 2) : total - 1;
    var names = NAMES.slice(); for (var q = names.length - 1; q > 0; q--) { var w = Math.floor(R.rand() * (q + 1)); var tmp = names[q]; names[q] = names[w]; names[w] = tmp; }
    // rival skills: best first
    var skills = []; for (var i = 0; i < n; i++) skills.push(R.diff.k + R.diff.spread * (0.5 - i / Math.max(1, n - 1)) * (n > 1 ? 1 : 0));
    var slot = 0, ri = 0;
    var laneL = T.laneY[Math.max(0, Math.floor(T.lanes / 2) - 1)], laneR = T.laneY[Math.floor(T.lanes / 2)];
    for (slot = 0; slot < total; slot++) {
      var s0 = -8 - slot * 8, y0 = slot % 2 === 0 ? laneL : laneR;
      if (slot === pslot) { R.player = R.mkCar(true, 'You', s0, y0, R.auto ? 0.965 : 1); R.cars.push(R.player); }
      else { var c = R.mkCar(false, names[ri % names.length], s0, y0, skills[ri]); ri++; R.cars.push(c); }
    }
    if (!R.player) { R.player = R.mkCar(true, 'You', -8, laneL, 1); R.cars.push(R.player); }
    R.input = { steer: 0, throttle: 0, brake: 0 };
    R.lastPos = R.position();
    R.posPending = null;
    R.cueState = {}; R.lap = 0;
    R.notes = { offTrack: [], walls: 0, contacts: 0, kerbT: 0, lapTimes: [], slow: [], fast: [] };
    R.lapStart = 0; R.contactCool = {};
    R.lapNotesCur = { off: {}, walls: 0, contacts: 0, entryErr: {} };
  }
  Race.prototype.mkCar = function (isPlayer, name, s, y, k) {
    var T = this.T;
    var c = { player: isPlayer, name: name, s: s, y: y, v: 0, vy: 0, k: k, gear: 0, rpm: 0.15, lap: 0, finished: false, finishT: 0, laneTarget: y, mistakeUntil: 0, contactT: -9, off: false, onKerb: 0, wallT: -9, slide: 0 };
    if (!isPlayer) {
      c.prof = profile(T, k * k, k, PHYS.vTop * (0.955 + 0.045 * k));
      c.top = PHYS.vTop * (0.955 + 0.045 * k);
      c.wobble = this.rand() * 6.28;
    }
    return c;
  };
  Race.prototype.progress = function (c) { return c.finished ? 1e9 - c.finishT : c.s; };
  Race.prototype.order = function () { var R = this; return R.cars.slice().sort(function (a, b) { return R.progress(b) - R.progress(a); }); };
  Race.prototype.position = function () { return this.order().indexOf(this.player) + 1; };
  Race.prototype.emit = function (type, data) { var e = data || {}; e.type = type; e.t = this.t; this.events.push(e); };
  Race.prototype.start = function () { this.started = true; this.startT = this.t; this.lapStart = this.t; };

  // player controls -> speed
  Race.prototype.autoTarget = function (c) {
    var T = this.T; var p = profile(T, 0.93, 0.85);
    return p[idx(T, c.s + Math.max(5, c.v * 0.1))];
  };
  Race.prototype.stepPlayer = function (dt) {
    var R = this, T = R.T, c = R.player, inp = R.input;
    if (!R.started || c.finished) { if (c.finished) { c.v = Math.max(0, c.v - 8 * dt); } this.gearbox(c, dt, R.started ? 0 : inp.throttle); return; }
    var v = c.v, thr = inp.throttle, brk = inp.brake;
    if (R.cruise != null) {
      var vc = R.cruise; thr = 0; brk = 0;
      if (vc <= 0) brk = v > 0 ? 1 : 0; else if (v < vc - 0.5) thr = 1; else if (v > vc + 1) brk = Math.min(1, (v - vc) / 6); else thr = 0.35;
    } else if (R.auto) {
      var vt = R.autoTarget(c); thr = 0; brk = 0;
      if (v < vt - 0.5) thr = 1; else if (v > vt + 1.5) brk = Math.min(1, (v - vt) / 8); else thr = 0.4;
    }
    var top = PHYS.vTop * (1 + R.slip(c) * 0.035);
    var a = 0;
    if (brk > 0) a = -brakeDecel(v) * brk - coastDecel(v);
    else if (thr > 0) a = accelAt(v, top) * thr - (v > top ? coastDecel(v) : 0);
    else a = -coastDecel(v);
    // surface
    var ay = Math.abs(c.y);
    if (ay > T.edge) { a -= 14 + v * 0.25; if (v > 45) a -= 10; }
    c.v = Math.max(0, v + a * dt);
    c.thr = thr; c.brk = brk;
    this.lateral(c, inp.steer, dt);
    c.s += c.v * dt;
    this.gearbox(c, dt, thr);
  };
  Race.prototype.slip = function (c) {
    // slipstream 0..1 from a car 8-45 m ahead, nearly in line
    var best = 0, R = this;
    for (var i = 0; i < R.cars.length; i++) {
      var o = R.cars[i]; if (o === c || o.finished) continue;
      var ds = o.s - c.s; if (ds < 7 || ds > 45) continue;
      var dy = Math.abs(o.y - c.y); if (dy > 1.6) continue;
      var f = (1 - (ds - 7) / 38) * (1 - dy / 1.6); if (f > best) best = f;
    }
    return best;
  };
  Race.prototype.steerMax = function (v) { return 2.5 + 8.5 * Math.min(1, v / 50); };
  Race.prototype.lateral = function (c, steer, dt) {
    var T = this.T, v = c.v, i = idx(T, c.s), k = this.straight ? 0 : T.kappa[i];
    var smax = this.steerMax(v);
    var demand = v * v * Math.abs(k), g = grip(v), ratio = demand / g;
    var drift = 0, slide = 0;
    if (k) {
      drift = 0.55 * smax * Math.min(1, ratio);
      if (ratio > 1) { slide = ratio - 1; drift += smax * slide * 1.6; c.v = Math.max(0, c.v - Math.min(25, slide * 30) * dt); }
      drift *= (k > 0 ? -1 : 1); // pushed to the outside
    }
    var eff = 1 / (1 + slide);
    if (Math.abs(c.y) > T.edge) eff *= 0.65;
    var vy = steer * smax * eff + drift;
    c.vy = vy; c.slide = slide;
    var ny = c.y + vy * dt;
    // kerb / off
    var ay = Math.abs(ny);
    c.onKerb = ay > T.kerbIn && ay <= T.edge ? Math.min(1, (ay - T.kerbIn) / (T.edge - T.kerbIn) + 0.3) : 0;
    var wasOff = c.off; c.off = ay > T.edge;
    if (c.player && c.off && !wasOff && this.started) { this.emit('off', { side: ny > 0 ? 1 : -1 }); this.noteOff(); }
    if (c.player && !c.off && wasOff) this.emit('rejoin', {});
    if (ay > T.wall) {
      var impact = Math.abs(vy) + c.v * 0.12;
      ny = (ny > 0 ? 1 : -1) * (T.wall - 0.4);
      c.v *= T.runoff === 'wall' ? 0.5 : 0.6; c.vy = 0;
      if (this.t - c.wallT > 0.4) { c.wallT = this.t; if (c.player) { this.emit('wall', { side: ny > 0 ? 1 : -1, impact: impact }); this.lapNotesCur.walls++; this.notes.walls++; } }
    }
    c.y = ny;
  };
  Race.prototype.noteOff = function () {
    var g = this.groupAt(this.player.s, 80);
    var nm = g ? g.name : 'a straight';
    this.lapNotesCur.off[nm] = (this.lapNotesCur.off[nm] || 0) + 1;
  };
  Race.prototype.groupAt = function (s, slack) {
    var T = this.T, ws = wrapS(T, s);
    for (var i = 0; i < T.groups.length; i++) { var g = T.groups[i]; if (ws >= g.start - 30 && ws <= g.end + (slack || 0)) return g; }
    return null;
  };
  Race.prototype.gearbox = function (c, dt, thr) {
    var G = PHYS.gears, v = c.v * KMH;
    if (!this.started && c.player) { // revving on the grid
      var target = 0.15 + 0.75 * (thr || 0);
      c.rpm += (target - c.rpm) * Math.min(1, dt * (target > c.rpm ? 6 : 3)); c.gear = 0; return;
    }
    if (c.gear < 1) c.gear = 1;
    var frac = v / G[c.gear - 1];
    if (frac > 0.965 && c.gear < G.length) { c.gear++; if (c.player) this.emit('shift', { up: true, gear: c.gear }); }
    else if (c.gear > 1 && v / G[c.gear - 2] < 0.74) { c.gear--; if (c.player) this.emit('shift', { up: false, gear: c.gear }); }
    frac = v / G[c.gear - 1];
    var r = Math.max(0.15, Math.min(1, 0.12 + frac * 0.88));
    c.rpm += (r - c.rpm) * Math.min(1, dt * 25);
  };
  // rivals
  Race.prototype.stepRival = function (c, dt) {
    var R = this, T = R.T;
    if (!R.started) { c.rpm += (0.2 - c.rpm) * dt * 3; return; }
    if (c.finished) { c.v = Math.max(20, c.v - 4 * dt); c.s += c.v * dt; R.gearbox(c, dt, 0); return; }
    if (c.fixedV != null) { c.v += (c.fixedV - c.v) * Math.min(1, dt * 2); c.thr = 1; c.s += c.v * dt; R.gearbox(c, dt, 1); return; }
    var look = Math.max(4, c.v * 0.05);
    var vt = c.prof[idx(T, c.s + look)];
    if (R.t < c.mistakeUntil) vt *= 0.75;
    // follow / overtake: who is ahead in my lane
    var ahead = null, gap = 1e9, i, o;
    for (i = 0; i < R.cars.length; i++) {
      o = R.cars[i]; if (o === c) continue;
      var ds = o.s - c.s; if (ds <= 0 || ds > 40) continue;
      if (Math.abs(o.y - c.y) < 2.4 && ds < gap) { gap = ds; ahead = o; }
    }
    if (ahead && (ahead.v < vt || gap < 15)) {
      // try a free lane
      var bestLane = null, bestScore = -1e9;
      for (i = 0; i < T.laneY.length; i++) {
        var ly = T.laneY[i]; if (Math.abs(ly - c.y) < 1) continue;
        var free = true;
        for (var j = 0; j < R.cars.length; j++) { o = R.cars[j]; if (o === c) continue; var d2 = o.s - c.s; if (d2 > -12 && d2 < 30 && Math.abs(o.y - ly) < 2.6) { free = false; break; } }
        if (free) { var sc = -Math.abs(ly - c.y); if (sc > bestScore) { bestScore = sc; bestLane = ly; } }
      }
      if (bestLane !== null && Math.abs(c.laneTarget - c.y) < 0.5) c.laneTarget = bestLane;
      if (gap < 18 && Math.abs(c.laneTarget - c.y) < 1.2) vt = Math.min(vt, ahead.v + (gap - 9) * 0.6);
    }
    // keep away from walls in corners: drift lane toward centre slowly when idle
    var a;
    if (c.v < vt) a = Math.min(accelAt(c.v, c.top) * (0.9 + 0.1 * c.k), (vt - c.v) * 4 + 1);
    else a = -Math.min(brakeDecel(c.v) * c.k, (c.v - vt) * 6 + 1);
    c.v = Math.max(0, c.v + a * dt);
    c.thr = a > 0 ? 1 : 0;
    var dy = c.laneTarget - c.y, ls = 3.2;
    c.y += Math.max(-ls * dt, Math.min(ls * dt, dy));
    c.s += c.v * dt;
    R.gearbox(c, dt, c.thr);
  };
  Race.prototype.maybeMistake = function (c, g) {
    if (!c.player && this.rand() < this.diff.mistake) { c.mistakeUntil = this.t + 0.8 + this.rand() * 0.8; }
  };
  Race.prototype.contacts = function () {
    var R = this, p = R.player;
    if (!R.started || p.finished) return;
    for (var i = 0; i < R.cars.length; i++) {
      var o = R.cars[i]; if (o === p) continue;
      var ds = o.s - p.s, dy = o.y - p.y;
      if (Math.abs(ds) < PHYS.carLen && Math.abs(dy) < PHYS.carWid) {
        var key = o.name; if (R.t - (R.contactCool[key] || -9) < 0.6) continue;
        R.contactCool[key] = R.t;
        var rel = Math.abs(p.v - o.v), side = Math.abs(dy) > 0.9 && Math.abs(ds) < PHYS.carLen * 0.8;
        if (side) { var push = dy > 0 ? -1 : 1; p.y += push * 0.7; o.y -= push * 0.7; o.laneTarget = o.y; p.v *= 0.95; o.v *= 0.95; }
        else if (ds > 0) { p.v = Math.max(0, Math.min(p.v, o.v) - 4); o.v += 1; }
        else { o.v = Math.max(0, Math.min(o.v, p.v) - 4); }
        R.notes.contacts++; R.lapNotesCur.contacts++;
        R.emit('contact', { name: o.name, side: dy > 0 ? 1 : -1, ahead: ds > 0, impact: rel + (side ? 4 : 2) });
      }
    }
  };
  Race.prototype.step = function (dt) {
    var R = this, T = R.T, L = T.length;
    R.t += dt;
    R.stepPlayer(dt);
    for (var i = 0; i < R.cars.length; i++) if (!R.cars[i].player) R.stepRival(R.cars[i], dt);
    R.contacts();
    if (!R.started) return;
    // laps and finish
    for (i = 0; i < R.cars.length; i++) {
      var c = R.cars[i];
      var lapNow = Math.floor(c.s / L);
      if (lapNow > c.lap && R.straight) c.lap = lapNow;
      if (lapNow > c.lap) {
        c.lap = lapNow;
        if (!c.player && R.rand() < R.diff.mistake * 4) { c.mistakeLap = true; }
        if (R.mode === 'race' && !c.finished && c.lap >= R.laps) { c.finished = true; c.finishT = R.t; if (c.player) R.finishRace(); else R.emit('rivalFinish', { name: c.name }); }
        else if (c.player) R.playerLap();
      }
      if (!c.player && c.mistakeLap) { var g = R.groupAt(c.s, 0); if (g && !g.flat) { c.mistakeLap = false; R.maybeMistake(c, g); c.mistakeUntil = Math.max(c.mistakeUntil, R.t + 0.6 + R.rand() * 0.9); } }
    }
    if (!R.straight) R.cornerCues();
    // positions (debounced)
    var pos = R.position();
    if (pos !== R.lastPos && !R.player.finished) {
      if (!R.posPending || R.posPending.pos !== pos) R.posPending = { pos: pos, t: R.t };
      else if (R.t - R.posPending.t > 1.2) { var gained = pos < R.lastPos; R.lastPos = pos; R.posPending = null; R.emit('position', { pos: pos, gained: gained }); }
    } else R.posPending = null;
  };
  Race.prototype.playerLap = function () {
    var R = this, p = R.player, lt = R.t - R.lapStart;
    if (p.lap >= 1) {
      if (p.lap > 1 || R.mode !== 'race') R.notes.lapTimes.push(lt);
      else R.notes.lapTimes.push(lt); // first lap includes the start
    }
    var noteCur = R.lapNotesCur; R.lapNotesCur = { off: {}, walls: 0, contacts: 0, entryErr: {} };
    R.lapStart = R.t;
    if (p.lap >= 1) R.emit('lap', { lap: p.lap + 1, laps: R.laps, pos: R.position(), lapTime: lt, final: R.mode === 'race' && p.lap + 1 === R.laps, notes: noteCur });
  };
  Race.prototype.finishRace = function () {
    var R = this, p = R.player;
    R.notes.lapTimes.push(R.t - R.lapStart);
    R.finished = true;
    R.results = R.computeResults();
    R.emit('finish', { pos: R.results.indexOf(R.results.filter(function (r) { return r.player; })[0]) + 1, results: R.results });
  };
  Race.prototype.computeResults = function () {
    var R = this, L = R.T.length, end = R.laps * L, p = R.player;
    var rows = R.cars.map(function (c) {
      var t;
      if (c.finished) t = c.finishT;
      else { var rem = end - c.s; t = R.t + rem / Math.max(20, c.v || 40); }
      return { name: c.name, player: c.player, time: t - (R.startT || 0) };
    });
    rows.sort(function (a, b) { return a.time - b.time; });
    var lead = rows[0].time;
    rows.forEach(function (r, i) { r.pos = i + 1; r.gap = r.time - lead; });
    return rows;
  };
  // Corner warnings for the player
  Race.prototype.cornerCues = function () {
    var R = this, T = R.T, p = R.player, L = T.length;
    if (p.finished) return;
    var ws = wrapS(T, p.s), lapIdx = Math.floor(p.s / L);
    for (var i = 0; i < T.groups.length; i++) {
      var g = T.groups[i];
      var d = g.start - ws; if (d < -5) d += L;
      if (d > 1500) continue;
      var key = g.idx + ':' + (d > L / 2 ? lapIdx + 1 : (g.start < ws - 5 ? lapIdx + 1 : lapIdx));
      var st = R.cueState[key] || (R.cueState[key] = {});
      var lead = R.opts.lead || 2.4;
      var bd = brakeDist(p.v, g.vmin * 0.97, 0.9);
      var warnD = Math.max(g.flat ? 90 : 160, bd + p.v * lead);
      if (!st.warn && d <= warnD && d > 0) { st.warn = true; R.emit('cue', { group: g, dist: d, needBrake: p.v > g.vmin * 1.03 }); }
      if (!R.auto && !g.flat && !st.brake && d > 0 && p.v > g.vmin * 1.06 && d <= bd + p.v * 0.3) { st.brake = true; R.emit('brakeCue', { group: g }); }
      if (!st.turn && d <= Math.max(3, p.v * 0.12) && d > -5) { st.turn = true; R.emit('turnIn', { group: g, part: g.parts[0] }); if (!g.flat && p.v > g.vmin * 1.12) R.lapNotesCur.entryErr[g.name] = 1; }
      if (st.turn) {
        // later parts of a chicane
        for (var k = 1; k < g.parts.length; k++) {
          var pd = g.parts[k].start - ws; if (pd < -5) pd += L;
          if (!st['p' + k] && pd <= Math.max(3, p.v * 0.12) && pd > -5) { st['p' + k] = true; R.emit('turnIn', { group: g, part: g.parts[k] }); }
        }
      }
    }
    // tidy old keys
    if (R.t % 5 < 0.02) { for (var kk in R.cueState) { if (+kk.split(':')[1] < lapIdx - 1) delete R.cueState[kk]; } }
  };
  Race.prototype.drain = function () { var e = this.events; this.events = []; return e; };
  // Practice notes for a lap
  function lapNotes(n, T, lapTime) {
    var bits = [];
    var offs = Object.keys(n.off);
    if (!offs.length && !n.walls && !n.contacts) bits.push('A clean lap.');
    if (offs.length) bits.push('Off the track at ' + list(offs) + '.');
    if (n.walls) bits.push(n.walls === 1 ? 'One wall hit.' : n.walls + ' wall hits.');
    if (n.contacts) bits.push(n.contacts === 1 ? 'One contact with a car.' : n.contacts + ' contacts with cars.');
    var hot = Object.keys(n.entryErr).filter(function (x) { return offs.indexOf(x) >= 0; });
    if (hot.length) bits.push('Brake earlier for ' + list(hot) + '.');
    else if (Object.keys(n.entryErr).length && offs.length) bits.push('Brake a little earlier for ' + list(Object.keys(n.entryErr).slice(0, 2)) + '.');
    return bits.join(' ');
  }
  function list(a) { a = a.slice(0, 3); return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function fmtTime(t) { if (!isFinite(t)) return '--'; var m = Math.floor(t / 60), s = t - m * 60; return (m ? m + ' minute' + (m > 1 ? 's ' : ' ') : '') + s.toFixed(1) + ' seconds'; }
  function fmtShort(t) { var m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }

  var api = { PHYS: PHYS, TRACKS: TRACKS, buildTrack: buildTrack, profile: profile, cornerVmax: cornerVmax, brakeDist: brakeDist, Race: Race, wrapS: wrapS, idx: idx, KMH: KMH, lapNotes: lapNotes, fmtTime: fmtTime, fmtShort: fmtShort, DIFF: DIFF, accelAt: accelAt, rng: rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.F1L = api;
})(this);
