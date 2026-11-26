/* F1 by Ear - app: menus, race screen, pedals, steering, lesson, practice notes. */
(function () {
  'use strict';
  var L = window.F1L, S = window.F1S;
  function $(id) { return document.getElementById(id); }
  var KEY = 'f1be.v1';
  var DEF = { track: 'monza', laps: '3', rivals: '5', diff: 'medium', grid: 'back', speed: 'manual', sens: '1', dead: '0.04', smooth: 'normal', centre: '1', lead: '2.4', vol: '0.9', eng: '0.8', riv: '0.8', voice: '', rate: '1.1', cal: null, best: {}, bestLap: {} };
  var st = load();
  function load() { var o = {}; try { o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {} var r = {}; for (var k in DEF) r[k] = o[k] != null ? o[k] : (typeof DEF[k] === 'object' && DEF[k] ? JSON.parse(JSON.stringify(DEF[k])) : DEF[k]); return r; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

  var snd = new window.F1Sound(); window.F1SoundPrefetch();
  var ann = new window.F1Announcer(); ann.onDuck = function (on) { snd.setDuck(on); };
  var wheel = new S.Wheel();
  var G = { screen: 'menu', race: null, phase: null, touches: 0, maxTouches: 0, keys: {}, raf: 0, lastT: 0, paused: false, runId: 0,
    stats: { frames: 0, slow: 0, loopMax: 0, loopSum: 0 }, motion: 'unknown', listening: false, cal: null, lightsT: 0, lightN: 0, holdT: 0, shiftT: 0, demoRpm: null, lesson: null, lastSteer: 0 };
  window.__f1 = { G: G, st: st, wheel: wheel, snd: snd, ann: ann, L: L, S: S, save: save };

  function status(msg) { var el = $('status'); el.textContent = ''; setTimeout(function () { el.textContent = msg; }, 30); }

  // ---------- motion ----------
  function listen() {
    if (G.listening) return; G.listening = true;
    window.addEventListener('devicemotion', function (e) { wheel.onMotion(e); }, { passive: true });
    window.addEventListener('deviceorientation', function (e) { wheel.onOrientation(e); }, { passive: true });
  }
  var needsPerm = (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') || (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function');
  if (!needsPerm) listen();
  // Must be called directly from a tap. Resolves true if motion is allowed.
  function askMotion() {
    if (!needsPerm) { G.motion = 'granted'; return Promise.resolve(true); }
    var reqs = [];
    try { if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') reqs.push(DeviceMotionEvent.requestPermission()); } catch (e) {}
    try { if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') reqs.push(DeviceOrientationEvent.requestPermission()); } catch (e) {}
    return Promise.all(reqs.map(function (p) { return Promise.resolve(p).catch(function () { return 'denied'; }); })).then(function (r) {
      var ok = r.indexOf('granted') >= 0; G.motion = ok ? 'granted' : 'denied';
      listen(); return ok;
    });
  }
  function steerNow() {
    var k = (G.keys.ArrowRight ? 1 : 0) - (G.keys.ArrowLeft ? 1 : 0);
    if (k) return k;
    if (wheel.angle == null || !G.cal) return 0;
    return S.mapSteer(wheel.angle, G.cal, { deadZone: +st.dead, sensitivity: +st.sens });
  }
  function baseCal() { return st.cal || S.defaultCal(wheel.angle == null ? 0 : wheel.angle); }
  function centreNow() {
    var b = baseCal();
    if (wheel.angle != null && (st.centre === '1' || !st.cal)) G.cal = { centre: wheel.angle, left: b.left, right: b.right };
    else G.cal = b;
  }

  // ---------- screens ----------
  function showRace(on) {
    $('race').classList.toggle('on', on); $('race').setAttribute('aria-hidden', on ? 'false' : 'true');
    $('menu').setAttribute('aria-hidden', on ? 'true' : 'false');
    try { $('menu').inert = on; } catch (e) {}
    G.screen = on ? 'race' : 'menu';
    if (!on) { $('results').classList.remove('on'); }
    wake(on);
  }
  function setBar(main, pause, leave) {
    $('rMain').textContent = main || ''; $('rMain').style.display = main ? '' : 'none';
    $('rPause').textContent = pause || ''; $('rPause').style.display = pause ? '' : 'none';
    $('rLeave').textContent = leave || 'Leave';
  }
  function hud(a, b) { $('hud').textContent = a; $('hud2').textContent = b || ''; }
  var wl = null;
  function wake(on) {
    try {
      if (on && !wl && navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(function (l) { wl = l; l.addEventListener && l.addEventListener('release', function () { wl = null; }); }).catch(function () {});
      if (!on && wl) { wl.release(); wl = null; }
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (G.screen === 'race' && !G.paused && (G.phase === 'racing' || G.phase === 'lights' || G.phase === 'lesson')) pause(true); }
    else if (G.screen === 'race') wake(true);
  });

  // ---------- starting things (all from taps) ----------
  function prepare() {
    // inside a tap: audio, speech, motion permission
    var a = snd.unlock();
    var m = askMotion();
    snd.setVolumes({ master: +st.vol, engine: +st.eng, rivals: +st.riv });
    ann.rate = +st.rate; ann.voiceURI = st.voice;
    wheel.setSmoothing(st.smooth);
    return Promise.all([a, m]).then(function (r) { return r[1]; });
  }
  function newRace(mode) {
    var opts = { track: mode === 'lesson' ? 'ring' : st.track, laps: +st.laps, rivals: mode === 'race' ? +st.rivals : 0, difficulty: st.diff, grid: st.grid, auto: st.speed === 'auto', mode: mode, lead: +st.lead };
    var R = new L.Race(opts);
    G.race = R; G.mode = mode; G.paused = false; G.runId++;
    snd.setRivalCount(R.cars.length - 1);
    return R;
  }
  function trackName(id) { return L.TRACKS[id].short; }
  function startRace(mode) {
    // called from a tap
    ann.clear();
    var R = newRace(mode);
    var auto = R.auto;
    var msg;
    if (mode === 'race') msg = 'Grid. ' + trackName(st.track) + ', ' + plural(+st.laps, 'lap') + ', ' + plural(+st.rivals, 'rival') + '. You start P' + R.position() + '. ';
    else msg = 'Free practice at ' + trackName(st.track) + '. ';
    msg += auto ? 'Double-tap Start lights when ready.' : 'Turn VoiceOver off, then tap the screen to start the lights.';
    ann.say(msg, { key: 'grid' });
    G.phase = 'grid'; G.lightsT = 0; G.lightN = 0;
    showRace(true); $('results').classList.remove('on');
    setBar('Start lights', 'Pause', 'Leave');
    hud('On the grid', L.TRACKS[R.T.id].name);
    prepare().then(function (ok) { if (!ok) ann.say('Motion access was not allowed, so steering will not work. Leave, then reload the page and allow Motion and Orientation access.'); });
    focusMain();
    loop();
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function focusMain() { setTimeout(function () { try { $('rMain').focus(); } catch (e) {} }, 50); }
  function beginLights() {
    if (G.phase !== 'grid') return;
    centreNow();
    G.phase = 'lights'; G.lightsT = 0; G.lightN = 0; G.holdT = 1.0 + Math.random() * 1.6;
    ann.clear();
    setBar('', 'Pause', 'Leave');
    if (wheel.count === 0) {
      // no readings yet; say once, but still start
      setTimeout(function () { if (wheel.count === 0 && G.screen === 'race') ann.say('No steering readings from the phone yet.'); }, 2500);
    }
  }
  function lightsTick(dt) {
    G.lightsT += dt;
    var want = Math.min(5, Math.floor(G.lightsT / 0.9));
    while (G.lightN < want) { G.lightN++; snd.light(); hud('Light ' + G.lightN); }
    if (G.lightN >= 5 && G.lightsT >= 4.5 + G.holdT) {
      snd.lightsOut(); G.race.start(); G.phase = G.mode === 'lesson' ? 'lesson' : 'racing'; hud('Go');
    }
  }

  // ---------- pause / leave ----------
  function pause(auto) {
    if (G.paused || G.screen !== 'race') return;
    G.paused = true; ann.clear(); snd.silenceAll();
    setTimeout(function () { if (G.paused) snd.suspend(); }, 200);
    setBar('Resume', '', 'Leave');
    ann.say(auto ? 'Paused.' : 'Paused. Tap with three fingers to carry on, or hold three fingers for two seconds to leave.');
    hud('Paused');
    focusMain();
  }
  function resume() {
    if (!G.paused) return;
    snd.resume(); G.paused = false; G.lastT = 0; ann.clear();
    setBar(G.phase === 'grid' ? 'Start lights' : '', 'Pause', 'Leave');
    if (G.phase === 'lights') { G.lightsT = 0; G.lightN = 0; }
    if (G.phase === 'lesson' && G.lesson) lessonRepeat(); else ann.say('Go.', { key: 'resume' });
  }
  function leave() {
    G.runId++; G.paused = false; ann.clear(); snd.silenceAll(); G.lesson = null; G.phase = null; G.race = null; G.demoRpm = null;
    cancelAnimationFrame(G.raf); G.raf = 0;
    setTimeout(function () { if (!G.race) snd.suspend(); }, 400);
    showRace(false); renderBest(); renderCal();
    setTimeout(function () { try { $('bRace').focus(); } catch (e) {} }, 50);
  }

  // ---------- touch pedals ----------
  var pad = $('pad');
  function onTouch(e) {
    if (G.screen !== 'race') return;
    if (e.cancelable) e.preventDefault();
    var n = e.touches ? e.touches.length : 0;
    var was = G.touches; G.touches = n;
    if (n > G.maxTouches) G.maxTouches = n;
    if (n >= 3 && !G.threeAt) G.threeAt = performance.now();
    if (e.type === 'touchstart' && was === 0) onPadTap();
    if (n === 0) {
      if (G.maxTouches >= 3) {
        var held = performance.now() - (G.threeAt || 0);
        if (held < 1500) { if (G.paused) resume(); else if (G.phase !== 'finished') pause(false); }
      }
      G.maxTouches = 0; G.threeAt = 0;
    }
  }
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (t) { pad.addEventListener(t, onTouch, { passive: false }); });
  pad.addEventListener('mousedown', function (e) { if (G.screen !== 'race') return; G.touches = 1; onPadTap(); });
  window.addEventListener('mouseup', function () { if (G.touches === 1 && !('ontouchstart' in window)) G.touches = 0; });
  function onPadTap() {
    if (G.paused) return;
    if (G.phase === 'grid') { snd.unlock(); beginLights(); }
    else if (G.phase === 'calib') calibAdvance();
    else if (G.lesson && G.lesson.waitTap) { var f = G.lesson.waitTap; G.lesson.waitTap = null; f(); }
  }
  function pedals() {
    var thr = 0, brk = 0, n = G.touches;
    if (G.maxTouches >= 3) n = 0;
    if (n === 1) thr = 1; else if (n === 2) brk = 1;
    if (G.keys.ArrowUp || G.keys[' ']) thr = 1;
    if (G.keys.ArrowDown) { brk = 1; thr = 0; }
    return { thr: thr, brk: brk };
  }
  window.addEventListener('keydown', function (e) {
    if (G.screen !== 'race') return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) >= 0) { G.keys[e.key] = true; e.preventDefault(); }
    if (e.key === 'Enter' && document.activeElement === document.body) onPadTap();
    if (e.key === 'p' || e.key === 'P') { if (G.paused) resume(); else pause(false); }
  });
  window.addEventListener('keyup', function (e) { if (G.keys[e.key]) G.keys[e.key] = false; });

  // three-finger hold to leave while paused
  setInterval(function () { if (G.paused && G.threeAt && performance.now() - G.threeAt > 2000) { G.threeAt = 0; G.maxTouches = 0; leave(); } }, 200);

  // ---------- main loop ----------
  function loop() { if (!G.raf) { G.lastT = 0; G.raf = requestAnimationFrame(frame); } }
  function frame(ts) {
    G.raf = requestAnimationFrame(frame);
    var t0 = performance.now();
    var dt = G.lastT ? (ts - G.lastT) / 1000 : 1 / 60; G.lastT = ts;
    if (dt > 0.05) dt = 0.05; if (dt <= 0) dt = 1 / 120;
    dt *= G.timeScale || 1;
    if (G.paused) return;
    tick(dt);
    var ms = performance.now() - t0;
    G.stats.frames++; G.stats.loopSum += ms; if (ms > G.stats.loopMax) G.stats.loopMax = ms; if (dt > 0.025) G.stats.slow++;
  }
  function tick(dt) {
    var R = G.race;
    if (G.phase === 'calib') { calibTick(dt); return; }
    if (!R) return;
    var steer = steerNow(); G.lastSteer = steer;
    var p = pedals();
    R.input.steer = steer; R.input.throttle = p.thr; R.input.brake = p.brk;
    if (G.phase === 'lights') lightsTick(dt);
    var n = Math.max(1, Math.round(dt * 120)), h = dt / n;
    for (var i = 0; i < n; i++) R.step(h);
    handle(R.drain());
    if (G.phase === 'lesson' && G.lesson) lessonTick();
    sound(R);
    G.hudT = (G.hudT || 0) + dt;
    if (G.hudT > 0.25) { G.hudT = 0; drawHud(R); }
  }
  function sound(R) {
    var c = R.player, T = R.T;
    var ws = L.wrapS(T, c.s), crowd = 0;
    T.crowd.forEach(function (z) { var a = L.wrapS(T, z[0]), b = L.wrapS(T, z[1]); var inside = a < b ? (ws >= a && ws <= b) : (ws >= a || ws <= b); if (inside) crowd = 1; });
    var halfW = T.halfW;
    var stt = { rpm: G.demoRpm != null ? G.demoRpm : c.rpm, thr: G.demoRpm != null ? 1 : (R.started ? (c.thr || 0) : R.input.throttle), pan: Math.max(-1, Math.min(1, c.y / (halfW + 0.9) * 0.85)), speed: c.v,
      kerb: G.demoOff ? 0 : c.onKerb, kerbSide: c.y > 0 ? 1 : -1, off: G.demoOff || c.off, offSide: c.y > 0 ? 1 : -1, slide: c.slide || 0, tunnel: !!T.tunnel[L.idx(T, c.s)] && !R.straight, crowd: G.mode === 'lesson' ? 0 : crowd, running: true, shiftT: G.shiftT };
    if (G.demoOff) { stt.speed = 30; }
    var rivals = [], k = 0;
    for (var i = 0; i < R.cars.length; i++) {
      var o = R.cars[i]; if (o.player) continue;
      var ds = o.s - c.s, dy = o.y - c.y, dist = Math.sqrt(ds * ds + dy * dy) || 1;
      rivals[k++] = { ds: ds, dy: dy, rpm: o.rpm, thr: o.thr, closing: (c.v - o.v) * ds / dist };
    }
    snd.update(stt, rivals);
  }
  function drawHud(R) {
    var c = R.player;
    var a = R.mode === 'race' ? 'P' + R.position() + ' of ' + R.cars.length + '   Lap ' + Math.min(R.laps, Math.max(1, c.lap + 1)) + ' of ' + R.laps : (G.mode === 'lesson' ? 'Lesson' : 'Practice lap ' + Math.max(1, c.lap + 1));
    if (!R.started && G.phase === 'grid') a = 'On the grid, ' + (R.mode === 'race' ? 'P' + R.position() : '');
    hud(a, Math.round(c.v * 3.6) + ' km/h   gear ' + (c.gear || 'N') + '   steer ' + Math.round(G.lastSteer * 100));
  }
  // ---------- events -> sound and speech ----------
  function handle(evs) {
    var R = G.race;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      switch (e.type) {
        case 'cue': snd.cornerCue(e.group); break;
        case 'brakeCue': snd.brakeCue(); break;
        case 'turnIn': snd.turnIn(e.part.dir); break;
        case 'wall': snd.crash(e.impact, e.side); if (G.lesson) G.lesson.wall = true; break;
        case 'contact': snd.contact(e.impact, e.side); if (G.lesson) G.lesson.contact = true; break;
        case 'shift': G.shiftT = snd.ctx ? snd.ctx.currentTime : 0; break;
        case 'position': if (R.mode === 'race') ann.say('P' + e.pos, { key: 'pos' }); break;
        case 'lap': onLap(e); break;
        case 'finish': onFinish(e); break;
      }
    }
  }
  function onLap(e) {
    var R = G.race; snd.lapLine();
    if (R.mode === 'race') ann.say((e.final ? 'Final lap. ' : 'Lap ' + e.lap + ' of ' + e.laps + '. ') + 'P' + e.pos, { key: 'pos' });
    else {
      var lt = e.lapTime, best = st.bestLap[R.T.id];
      var isBest = !best || lt < best;
      if (isBest && G.mode === 'practice') { st.bestLap[R.T.id] = lt; save(); }
      var note = L.lapNotes(e.notes, R.T, lt);
      if (G.mode === 'lesson' && G.lesson && G.lesson.lapDone) { G.lesson.lapDone(lt, note); return; }
      ann.say('Lap time ' + L.fmtTime(lt) + (isBest && best ? ', your best' : '') + '. ' + note, { key: 'lap' });
    }
  }
  function onFinish(e) {
    var R = G.race; G.phase = 'finished';
    snd.finish();
    var rows = e.results, me = rows.filter(function (r) { return r.player; })[0];
    var key = [R.T.id, R.laps, R.cars.length - 1, st.diff, st.speed].join('|');
    var prev = st.best[key], newBest = !prev || me.pos < prev.pos;
    if (newBest) { st.best[key] = { pos: me.pos, of: rows.length, date: new Date().toISOString().slice(0, 10) }; }
    var fl = Math.min.apply(null, R.notes.lapTimes.slice(1).concat([Infinity]));
    if (isFinite(fl) && (!st.bestLap[R.T.id] || fl < st.bestLap[R.T.id])) st.bestLap[R.T.id] = fl;
    save();
    var said = me.pos === 1 ? 'Chequered flag. You win! ' : 'Chequered flag. You finished P' + me.pos + ' of ' + rows.length + '. ';
    if (me.pos > 1) said += rows[0].name + ' won, ' + me.gap.toFixed(1) + ' seconds ahead of you. ';
    else if (rows[1]) said += rows[1].name + ' was ' + rows[1].gap.toFixed(1) + ' seconds behind. ';
    if (newBest && prev) said += 'A new best result. ';
    said += 'Results are on the screen. Turn VoiceOver on to read them, or tap with three fingers to race again.';
    setTimeout(function () { ann.say(said, { key: 'finish' }); }, 1600);
    // results panel
    var ol = $('resList'); ol.innerHTML = '';
    rows.forEach(function (r) { var li = document.createElement('li'); li.textContent = (r.player ? 'You' : r.name) + (r.pos === 1 ? ', winner' : ', ' + r.gap.toFixed(1) + ' seconds behind'); ol.appendChild(li); });
    $('resTitle').textContent = 'Results: you finished P' + me.pos + ' of ' + rows.length;
    var lapsTxt = R.notes.lapTimes.map(function (t, i) { return 'lap ' + (i + 1) + ' ' + L.fmtShort(t); }).join(', ');
    $('resNote').textContent = 'Your laps: ' + lapsTxt + '. Wall hits: ' + R.notes.walls + '. Contacts: ' + R.notes.contacts + '.';
    $('results').classList.add('on'); setBar('', '', 'Leave');
    G.finishedAt = performance.now();
    setTimeout(function () { snd.silenceAll(); }, 6000);
  }
  // three-finger tap after the finish = race again
  var origPause = pause;
  pause = function (auto) { if (G.phase === 'finished') { if (!auto) raceAgain(); return; } origPause(auto); };
  function raceAgain() { if (G.mode === 'race') { snd.resume(); startRace('race'); } }

  // ---------- calibration ----------
  var CAL_STEPS = [
    'Calibration. Hold the phone sideways in both hands like a steering wheel, screen facing you, in your natural driving position. Keep it still, then tap the screen, or double-tap Record if VoiceOver is on.',
    'Now turn the wheel fully to the left, as far as is comfortable, and tap.',
    'Now turn it fully to the right, and tap.'
  ];
  function startCalib() {
    ann.clear(); G.race = null; G.phase = 'calib'; G.calStep = 0; G.calVals = []; G.mode = 'calib';
    showRace(true); setBar('Record', '', 'Leave'); hud('Calibration', 'Step 1 of 3: centre');
    ann.say(CAL_STEPS[0], { key: 'cal' });
    prepare().then(function (ok) {
      if (!ok) ann.say('Motion access was not allowed. Leave, then reload the page and allow Motion and Orientation access when asked.');
      setTimeout(function () { if (wheel.count === 0 && G.phase === 'calib') ann.say('I am not getting any readings from the phone\'s motion sensor yet.'); }, 3000);
    });
    focusMain(); loop();
  }
  function calibAdvance() {
    if (G.phase !== 'calib') return;
    var now = performance.now(); if (G.calLast && now - G.calLast < 600) return; G.calLast = now;
    if (G.calStep === 3) { leave(); status('Steering calibrated.'); return; }
    if (wheel.angle == null) { ann.say('No readings from the motion sensor yet. Hold on a moment and tap again.', { interrupt: true }); return; }
    if (G.calStep === 0 && wheel.upright < 0.4) { ann.say('The phone seems nearly flat. Tilt the screen up towards you, like a wheel, and tap again.', { interrupt: true }); return; }
    G.calVals[G.calStep] = wheel.angle; snd.ok();
    G.calStep++;
    if (G.calStep < 3) { ann.say(CAL_STEPS[G.calStep], { interrupt: true }); hud('Calibration', 'Step ' + (G.calStep + 1) + ' of 3: ' + (G.calStep === 1 ? 'full left' : 'full right')); return; }
    var r = S.makeCal(G.calVals[0], G.calVals[1], G.calVals[2]);
    if (!r.ok) {
      G.calStep = 0; G.calVals = [];
      ann.say(r.problem === 'small' ? 'That turn was too small. Let\'s try again. Hold it centred and tap.' : 'Left and right came out the same way. Let\'s try again. Hold it centred and tap.', { interrupt: true });
      return;
    }
    st.cal = r.cal; save(); G.cal = r.cal;
    ann.say('Calibrated. ' + Math.round(Math.abs(r.cal.left)) + ' degrees to the left, ' + Math.round(Math.abs(r.cal.right)) + ' to the right. Now turn the wheel and hear the engine follow it. Tap when you are done.', { interrupt: true });
    hud('Calibrated', 'Turn to test, tap to finish');
    setBar('Finish', '', 'Leave');
  }
  function calibTick(dt) {
    if (G.calStep === 3 && G.cal) {
      var s = S.mapSteer(wheel.angle, G.cal, { deadZone: +st.dead, sensitivity: +st.sens }); G.lastSteer = s;
      snd.update({ rpm: 0.25 + Math.abs(s) * 0.25, thr: 0.4, pan: s, speed: 0, kerb: 0, kerbSide: 0, off: false, offSide: 0, slide: 0, tunnel: false, crowd: 0, running: true }, []);
      $('hud2').textContent = 'steer ' + Math.round(s * 100);
    } else snd.update({ rpm: 0.15, thr: 0, pan: 0, speed: 0, kerb: 0, kerbSide: 0, off: false, offSide: 0, slide: 0, tunnel: false, crowd: 0, running: false }, []);
  }

  // ---------- practice lesson ----------
  function lessonSteps(auto) {
    var steps = [];
    function S_(o) { steps.push(o); }
    S_({ say: 'Practice lesson. I will explain each sound, then you try it. Each part starts when I stop talking. Tap with three fingers to pause.' });
    S_({ say: 'This is your engine, idling.', act: function (R, done) { G.demoRpm = 0.15; later(1800, done); } });
    S_({ say: 'And revving up through the range.', act: function (R, done) { var t0 = performance.now(); G.lesson.anim = function () { var f = (performance.now() - t0) / 2500; G.demoRpm = f < 1 ? 0.15 + 0.85 * f : Math.max(0.15, 1 - (f - 1) * 1.5); if (f > 1.6) { G.lesson.anim = null; G.demoRpm = null; done(); } }; } });
    S_({ say: 'Higher pitch means higher revs. Gears change by themselves, and you hear the revs drop at each change.' });
    S_({ say: 'Now you are moving on a long straight. Your engine sound sits where your car is across the track. Turn the wheel left until you hear the kerb rumble on your left.', setup: function (R) { R.straight = true; R.cruise = 30; R.start(); centreNow(); },
      check: function (R) { return R.player.onKerb > 0 && R.player.y < 0; }, ok: 'That is the left kerb.' });
    S_({ say: 'Now steer right, across the track, to the kerb on your right.', check: function (R) { return R.player.onKerb > 0 && R.player.y > 0; }, ok: 'That is the right kerb.' });
    S_({ say: 'Now bring the car back to the middle, so your engine sounds centred, and hold it there.', check: function (R) { G.lesson.mid = Math.abs(R.player.y) < 1.2 ? (G.lesson.mid || 0) + 1 : 0; return G.lesson.mid > 90; }, ok: 'Good, centred.' });
    S_({ say: 'If you run wide past the kerb, you hear gravel, and the car slows down.', act: function (R, done) { G.demoOff = true; later(2200, function () { G.demoOff = false; done(); }); } });
    S_({ say: 'At Monaco there is no gravel. The barrier is right beside the track.', act: function (R, done) { snd.crash(20, -0.6); later(1500, done); } });
    if (!auto) {
      S_({ say: 'Pedals. Hold one thumb anywhere on the screen to accelerate. Lift it to coast. Get up to 200 kilometres an hour.', setup: function (R) { R.cruise = null; }, check: function (R) { return R.player.v >= 55.5; }, timeout: 45, ok: '200.' });
      S_({ say: 'Now put a second thumb on the screen to brake, and come to a stop.', check: function (R) { return R.player.v < 2; }, timeout: 40, ok: 'Stopped.' });
    } else {
      S_({ say: 'You chose automatic speed, so the game accelerates and brakes for you. You only steer.' });
    }
    S_({ say: 'Bend warnings. A sweep moves towards the direction of the bend. A fast bend on the right.', setup: function (R) { R.cruise = 0; }, act: function (R, done) { later(snd.cornerCue(fake([1])) * 1000 + 500, done); } });
    S_({ say: 'A medium bend on the left.', act: function (R, done) { later(snd.cornerCue(fake([-2])) * 1000 + 500, done); } });
    S_({ say: 'A tight bend, or hairpin, on the right. Lower pitch means tighter.', act: function (R, done) { later(snd.cornerCue(fake([3])) * 1000 + 500, done); } });
    S_({ say: 'A chicane plays one sweep for each part, right then left.', act: function (R, done) { later(snd.cornerCue(fake([3, -3])) * 1000 + 500, done); } });
    if (!auto) S_({ say: 'When you need to brake for a bend, you hear this double beep.', act: function (R, done) { snd.brakeCue(); later(900, done); } });
    S_({ say: 'And this tick, on the side of the bend, means turn in now.', act: function (R, done) { snd.turnIn(1); later(500, function () { snd.turnIn(1); later(800, done); }); } });
    S_({ say: 'In a bend your car drifts to the outside, so steer into the bend, and hold it until your engine sounds centred again.' });
    S_({ say: 'Rival cars. A car is coming past you on your left.', setup: function (R) { R.cruise = 38; R.cars = R.cars.filter(function (c) { return c.player; }); var c = R.mkCar(false, 'Rival', R.player.s - 70, R.player.y - 3.5, 0.9); c.fixedV = 56; c.v = 56; R.cars.push(c); snd.setRivalCount(R.cars.length - 1); G.lesson.rival = c; },
      check: function (R) { return G.lesson.rival.s - R.player.s > 70; }, timeout: 20, ok: 'Its sound moved forward and dropped in pitch as it passed.' });
    S_({ say: 'Now overtake. A slower car is ahead of you in your lane. Steer into another lane, go past it, and keep clear of it.', setup: function (R) {
        R.cars = R.cars.filter(function (c) { return c.player; }); var c = R.mkCar(false, 'Rival', R.player.s + 90, R.player.y, 0.9); c.fixedV = 24; c.v = 24; R.cars.push(c); snd.setRivalCount(1); G.lesson.rival = c; G.lesson.contact = false;
        R.cruise = auto ? 40 : null; if (!auto) R.player.v = Math.max(R.player.v, 20);
      },
      check: function (R) { if (G.lesson.contact && !G.lesson.saidContact) { G.lesson.saidContact = true; ann.say('Contact. Steer away from its sound.'); } return R.player.s - G.lesson.rival.s > 20; }, timeout: 60, ok: 'You are past it. Well done.' });
    S_({ say: 'The race start. Five beeps for the five red lights, a short wait, then this rising tone means lights out. Go.', setup: function (R) { R.cars = R.cars.filter(function (c) { return c.player; }); snd.setRivalCount(0); R.cruise = 0; },
      act: function (R, done) { var k = 0; (function b() { if (k < 5) { snd.light(); k++; later(900, b); } else later(1300, function () { snd.lightsOut(); later(900, done); }); })(); } });
    S_({ say: 'Last part. A full lap of the practice ring, with bend warnings. Your practice notes come at the end. The lights start when I stop talking.', setup: function (R) { R.cruise = 0; },
      act: function (R, done) {
        // put the car on the start line of the ring, then run the lights
        R.straight = false; R.cruise = null; R.player.s = -15; R.player.lap = 0; R.player.y = 0; R.player.v = 0; R.cueState = {}; R.lapNotesCur = { off: {}, walls: 0, contacts: 0, entryErr: {} };
        R.started = false; G.phase = 'lights'; G.lightsT = 0; G.lightN = 0; G.holdT = 1 + Math.random(); centreNow();
        G.lesson.lapDone = function (lt, note) { G.lesson.lapDone = null; done(lt, note); };
      }, final: true });
    return steps;
  }
  function fake(parts) { return { parts: parts.map(function (p) { return { dir: p > 0 ? 1 : -1, sev: Math.abs(p) }; }) }; }
  var timers = [];
  function later(ms, fn) { var id = G.runId; var t = setTimeout(function () { if (id === G.runId && !G.paused) fn(); else if (id === G.runId && G.paused) G.lesson && (G.lesson.resumeFn = fn); }, ms); timers.push(t); return t; }
  function startLesson() {
    ann.clear();
    var R = newRace('lesson');
    G.phase = 'lesson'; G.lesson = { i: -1, steps: lessonSteps(R.auto) };
    showRace(true); setBar('', 'Pause', 'Leave'); hud('Lesson');
    prepare().then(function (ok) { if (!ok) ann.say('Motion access was not allowed, so steering will not work. Leave, then reload the page and allow Motion and Orientation access.'); });
    focusMain(); loop();
    lessonNext();
  }
  function lessonNext() {
    var Ls = G.lesson; if (!Ls) return;
    Ls.i++; Ls.check = null; Ls.mid = 0; Ls.anim = null;
    var s = Ls.steps[Ls.i], R = G.race, id = G.runId;
    if (!s) return lessonEnd();
    if (s.setup) s.setup(R);
    hud('Lesson', 'Part ' + (Ls.i + 1) + ' of ' + Ls.steps.length);
    ann.say(s.say, { key: 'lesson', then: function () { if (id !== G.runId || G.lesson !== Ls || Ls.steps[Ls.i] !== s || G.paused) return; lessonGo(s); } });
  }
  function lessonGo(s) {
    var Ls = G.lesson, R = G.race;
    if (s.check) { Ls.check = s.check; Ls.deadline = R.t + (s.timeout || 30); Ls.stepRef = s; return; }
    if (s.act) { s.act(R, function (lt, note) { if (G.lesson !== Ls) return; if (s.final) return lessonEnd(lt, note); lessonNext(); }); return; }
    later(250, lessonNext);
  }
  function lessonTick() {
    var Ls = G.lesson, R = G.race;
    if (Ls.anim) Ls.anim();
    if (Ls.check) {
      var s = Ls.stepRef;
      if (Ls.check(R)) { Ls.check = null; snd.ok(); ann.say(s.ok || 'Good.', { key: 'lesson', then: function () { if (G.lesson === Ls) lessonNext(); } }); }
      else if (R.t > Ls.deadline) { Ls.check = null; ann.say('Let\'s move on.', { key: 'lesson', then: function () { if (G.lesson === Ls) lessonNext(); } }); }
    }
  }
  function lessonRepeat() {
    var Ls = G.lesson; if (!Ls) return;
    if (Ls.resumeFn) { var f = Ls.resumeFn; Ls.resumeFn = null; f(); return; }
    var s = Ls.steps[Ls.i]; if (!s) return;
    if (Ls.check) { Ls.deadline = G.race.t + (s.timeout || 30); ann.say(s.say, { key: 'lesson' }); return; }
    if (s.final && G.lesson.lapDone) { ann.say('Carry on with your lap.'); return; }
    Ls.i--; lessonNext();
  }
  function lessonEnd(lt, note) {
    var R = G.race; G.phase = 'finished'; G.lesson = null;
    snd.cheer(0.5);
    var msg = 'Lesson complete. ' + (lt ? 'Your lap took ' + L.fmtTime(lt) + '. ' + (note || '') + ' ' : '') + 'Next, try free practice or a race. Turn VoiceOver back on and double-tap Leave.';
    ann.say(msg, { key: 'lesson' });
    setBar('', '', 'Leave');
    setTimeout(function () { snd.silenceAll(); }, 3000);
  }

  // ---------- menu wiring ----------
  $('bRace').addEventListener('click', function () { startRace('race'); });
  $('bPractice').addEventListener('click', function () { startRace('practice'); });
  $('bLesson').addEventListener('click', function () { startLesson(); });
  $('bCalib').addEventListener('click', function () { startCalib(); });
  $('rMain').addEventListener('click', function () {
    if (G.paused) { resume(); return; }
    if (G.phase === 'grid') { snd.unlock(); beginLights(); }
    else if (G.phase === 'calib') calibAdvance();
  });
  $('rPause').addEventListener('click', function () { if (G.paused) resume(); else pause(false); });
  $('rLeave').addEventListener('click', leave);
  $('resAgain').addEventListener('click', function () { raceAgain(); });
  $('resMenu').addEventListener('click', leave);
  $('bTestVoice').addEventListener('click', function () {
    prepare();
    ann.clear(); ann.say('This is the announcer. P1. Here is a bend on the right.', { then: function () { if (snd.ctx) { snd.resume(); snd.cornerCue(fake([2])); } } });
  });

  var BIND = { sTrack: 'track', sLaps: 'laps', sRivals: 'rivals', sDiff: 'diff', sGrid: 'grid', sSpeed: 'speed', sSens: 'sens', sDead: 'dead', sSmooth: 'smooth', sCentre: 'centre', sLead: 'lead', sVol: 'vol', sEng: 'eng', sRiv: 'riv', sVoice: 'voice', sRate: 'rate' };
  function vt(id, v) {
    v = +v;
    if (id === 'sSens') return v.toFixed(1) + (v < 0.95 ? ', gentle' : v > 1.05 ? ', sharp' : ', normal');
    if (id === 'sDead') return Math.round(v * 100) + ' percent';
    return Math.round(v * 100) + ' percent';
  }
  Object.keys(BIND).forEach(function (id) {
    var el = $(id), k = BIND[id];
    if (id !== 'sVoice') el.value = st[k];
    if (el.type === 'range') el.setAttribute('aria-valuetext', vt(id, el.value));
    el.addEventListener(el.type === 'range' ? 'input' : 'change', function () {
      st[k] = el.value; save();
      if (el.type === 'range') el.setAttribute('aria-valuetext', vt(id, el.value));
      snd.setVolumes({ master: +st.vol, engine: +st.eng, rivals: +st.riv }); ann.rate = +st.rate; ann.voiceURI = st.voice; wheel.setSmoothing(st.smooth);
    });
  });
  function fillVoices() {
    var sel = $('sVoice'), vs = ann.voices().filter(function (v) { return /^en/i.test(v.lang); });
    if (!vs.length) return;
    var cur = st.voice; sel.innerHTML = '';
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Automatic British voice'; sel.appendChild(o0);
    vs.forEach(function (v) { var o = document.createElement('option'); o.value = v.voiceURI; o.textContent = v.name + ' (' + v.lang + ')'; sel.appendChild(o); });
    sel.value = cur; if (sel.value !== cur) sel.value = '';
  }
  fillVoices(); setTimeout(fillVoices, 800);
  try { speechSynthesis.addEventListener('voiceschanged', fillVoices); } catch (e) {}
  function renderCal() { $('calInfo').textContent = st.cal ? 'Steering is calibrated: ' + Math.round(Math.abs(st.cal.left)) + ' degrees left, ' + Math.round(Math.abs(st.cal.right)) + ' degrees right.' : 'Steering not calibrated yet. It still works, centred on how you hold the phone at the start, but calibrating feels best.'; }
  function renderBest() {
    var box = $('best'), keys = Object.keys(st.best), html = '';
    var T = L.TRACKS;
    if (!keys.length && !Object.keys(st.bestLap).length) { box.innerHTML = '<p>No races yet.</p>'; return; }
    html += '<ul class="plain">';
    keys.sort().forEach(function (k) { var p = k.split('|'), b = st.best[k]; html += '<li><strong>' + T[p[0]].short + ', ' + p[1] + ' laps, ' + p[2] + ' rivals, ' + p[3] + (p[4] === 'auto' ? ', automatic speed' : '') + ':</strong> best finish P' + b.pos + ' of ' + b.of + ' (' + b.date + ')</li>'; });
    Object.keys(st.bestLap).forEach(function (k) { html += '<li><strong>Best lap at ' + T[k].short + ':</strong> ' + L.fmtShort(st.bestLap[k]) + '</li>'; });
    box.innerHTML = html + '</ul>';
  }
  renderCal(); renderBest();
  if ('serviceWorker' in navigator && location.protocol === 'https:') { try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) {} }
  window.__f1.api = { startRace: startRace, startLesson: startLesson, startCalib: startCalib, beginLights: beginLights, pause: pause, resume: resume, leave: leave, calibAdvance: calibAdvance, onPadTap: onPadTap };
})();
