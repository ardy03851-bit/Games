/**
 * Audio is fully synthesised — no sample downloads, so the whole game stays a
 * few text files plus a handful of painted sprites.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.started = false;
    this.night = 0;
    this.birdTimer = 3;
    this.cricketTimer = 1;
  }

  ensure() {
    if (this.started) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    // shared noise buffer
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;

    // ---- wind
    const wind = this.ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.16;
    wind.connect(windFilter).connect(this.windGain).connect(this.master);
    wind.start();
    // slow gust modulation
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.09;
    lfo.connect(lfoGain).connect(this.windGain.gain);
    lfo.start();

    // ---- stream
    const water = this.ctx.createBufferSource();
    water.buffer = buf;
    water.loop = true;
    const wf = this.ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 1100;
    wf.Q.value = 0.5;
    this.waterGain = this.ctx.createGain();
    this.waterGain.gain.value = 0.05;
    water.connect(wf).connect(this.waterGain).connect(this.master);
    water.start();

    this.started = true;
    return this.ctx;
  }

  resume() {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.enabled = !muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.55;
  }

  setNight(n) { this.night = n; }

  setProximity(riverDistance) {
    if (!this.waterGain) return;
    const k = Math.max(0, Math.min(1, 1 - riverDistance / 26));
    this.waterGain.gain.value = 0.02 + k * 0.11;
  }

  blip(freq = 440, dur = 0.12, type = 'sine', gain = 0.12, sweep = 0) {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noiseBurst(dur = 0.18, freq = 900, q = 1.2, gain = 0.22, type = 'bandpass') {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(freq * 0.55, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  gather() {
    this.noiseBurst(0.16, 1300, 1.6, 0.16);
    this.blip(190 + Math.random() * 40, 0.16, 'triangle', 0.1, -60);
  }

  chop() {
    this.noiseBurst(0.11, 900, 2.0, 0.2);
    this.blip(140, 0.18, 'sine', 0.14, -40);
  }

  place() {
    this.blip(220, 0.16, 'triangle', 0.16, -60);
    this.noiseBurst(0.13, 520, 1.4, 0.14);
    setTimeout(() => this.blip(587, 0.22, 'sine', 0.09), 70);
  }

  remove() {
    this.blip(320, 0.2, 'triangle', 0.11, -140);
  }

  click() { this.blip(660, 0.06, 'sine', 0.07); }

  error() { this.blip(180, 0.12, 'square', 0.06, -40); }

  tick(dt) {
    if (!this.started) return;
    // birds by day, crickets by night
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 4 + Math.random() * 8;
      if (this.night < 0.45) {
        const base = 1500 + Math.random() * 1300;
        this.blip(base, 0.09, 'sine', 0.05, 500);
        setTimeout(() => this.blip(base * 1.15, 0.08, 'sine', 0.04, -300), 110);
      }
    }
    this.cricketTimer -= dt;
    if (this.cricketTimer <= 0) {
      this.cricketTimer = 0.6 + Math.random() * 1.6;
      if (this.night > 0.4) this.blip(3200 + Math.random() * 900, 0.05, 'square', 0.012);
    }
  }
}
