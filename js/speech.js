/* F1 by Ear - announcer. One short utterance at a time, never overlapping, with a watchdog
   so a lost "end" event can never jam the queue. Based on the Narration App speech engine. */
(function (root) {
  'use strict';
  var synth = root.speechSynthesis, Utter = root.SpeechSynthesisUtterance;
  function Announcer() {
    this.q = []; this.cur = null; this.gen = 0; this.keep = []; this.rate = 1.1; this.voiceURI = ''; this.onDuck = null; this.enabled = !!(synth && Utter);
    this.log = [];
    var self = this;
    if (synth && synth.addEventListener) try { synth.addEventListener('voiceschanged', function () { self._voices = null; }); } catch (e) {}
  }
  Announcer.prototype.voices = function () {
    if (!synth) return [];
    if (!this._voices || !this._voices.length) { try { this._voices = synth.getVoices() || []; } catch (e) { this._voices = []; } }
    return this._voices;
  };
  Announcer.prototype.voice = function () {
    var vs = this.voices(), i, v;
    for (i = 0; i < vs.length; i++) if (vs[i].voiceURI === this.voiceURI) return vs[i];
    var pick = function (re, lang) { for (var j = 0; j < vs.length; j++) if ((!lang || /^en[-_]GB/i.test(vs[j].lang)) && re.test(vs[j].name + ' ' + vs[j].voiceURI)) return vs[j]; return null; };
    v = pick(/premium/i, 1) || pick(/enhanced/i, 1) || pick(/Daniel|Serena|Kate|Arthur|Martha|Stephanie|Jamie/i, 1) || pick(/./, 1);
    if (v) return v;
    for (i = 0; i < vs.length; i++) if (/^en/i.test(vs[i].lang)) return vs[i];
    return null;
  };
  // say(text, {key, interrupt, then}) - key replaces any queued message with the same key.
  Announcer.prototype.say = function (text, o) {
    o = o || {};
    if (!this.enabled || !text) { if (o.then) setTimeout(o.then, 10); return; }
    var item = { text: String(text), key: o.key || null, then: o.then || null };
    if (o.interrupt) {
      var dropped = this.q; this.q = [item];
      if (this.cur) this.stopCurrent(); else this.next();
      return;
    }
    if (item.key) this.q = this.q.filter(function (x) { return x.key !== item.key || x.then; });
    if (this.q.length >= 3) this.q.shift();
    this.q.push(item);
    if (!this.cur) this.next();
  };
  Announcer.prototype.busy = function () { return !!this.cur || this.q.length > 0; };
  Announcer.prototype.stopCurrent = function () {
    var self = this, c = this.cur;
    this.gen++; this.cur = null;
    if (c) clearTimeout(c.wd);
    try { synth.cancel(); } catch (e) {}
    // Safari needs a short breath after cancel or the next utterance can be dropped.
    var g = this.gen;
    setTimeout(function () { if (g === self.gen && !self.cur) self.next(); }, 140);
  };
  Announcer.prototype.clear = function () {
    var c = this.cur; this.q = []; this.gen++; this.cur = null;
    if (c) clearTimeout(c.wd);
    try { if (synth && (synth.speaking || synth.pending)) synth.cancel(); } catch (e) {}
    if (this.onDuck) this.onDuck(false);
  };
  Announcer.prototype.next = function () {
    var self = this;
    if (this.cur) return;
    var item = this.q.shift();
    if (!item) { if (this.onDuck) this.onDuck(false); return; }
    var gen = ++this.gen;
    var u = new Utter(item.text);
    var v = this.voice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
    u.rate = this.rate; u.pitch = 1; u.volume = 1;
    var cur = { item: item, u: u, gen: gen, done: false };
    var finish = function () {
      if (cur.done) return; cur.done = true; clearTimeout(cur.wd);
      if (self.cur === cur) self.cur = null;
      if (item.then) { try { item.then(); } catch (e) { setTimeout(function () { throw e; }); } }
      if (gen === self.gen || !self.cur) setTimeout(function () { if (!self.cur) self.next(); }, 60);
    };
    u.onend = function () { if (gen === self.gen) finish(); };
    u.onerror = function (e) { if (gen === self.gen) finish(); };
    this.cur = cur;
    this.keep.push(u); if (this.keep.length > 8) this.keep.shift();
    this.log.push(item.text); if (this.log.length > 200) this.log.shift();
    if (this.onDuck) this.onDuck(true);
    // Watchdog: about 75 ms per character at rate 1, plus margin.
    cur.wd = setTimeout(function () { if (!cur.done && self.cur === cur) { try { if (synth.speaking) { cur.wd = setTimeout(function () { finish(); }, 4000); return; } } catch (e) {} finish(); } }, 1800 + item.text.length * 75 / this.rate);
    try { if (synth.paused) synth.resume(); synth.speak(u); } catch (e) { finish(); }
  };
  root.F1Announcer = Announcer;
})(this);
