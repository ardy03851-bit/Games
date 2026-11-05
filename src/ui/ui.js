/**
 * UI: parchment HUD, build tray, thumb-stick, toasts.
 * All DOM, no framework — the game is a handful of files you can read.
 */

const ICONS = {
  path: `<svg viewBox="0 0 40 40"><path d="M8 32c6-3 8-8 12-11s8-7 12-12" stroke="#927651" stroke-width="9" stroke-linecap="round" fill="none"/><path d="M10 30c5-3 7-7 11-10" stroke="#ad9267" stroke-width="4" stroke-linecap="round" fill="none"/></svg>`,
  fence: `<svg viewBox="0 0 40 40"><path d="M12 10v22M28 10v22" stroke="#6b4c2c" stroke-width="4" stroke-linecap="round"/><path d="M8 16h24M8 25h24" stroke="#8a663c" stroke-width="3.4" stroke-linecap="round"/></svg>`,
  wall: `<svg viewBox="0 0 40 40"><rect x="7" y="24" width="11" height="8" rx="2" fill="#3e4455"/><rect x="20" y="24" width="13" height="8" rx="2" fill="#4d5568"/><rect x="11" y="15" width="13" height="8" rx="2" fill="#5c6576"/><rect x="10" y="32" width="20" height="5" rx="2" fill="#292d3b"/></svg>`,
  bench: `<svg viewBox="0 0 40 40"><rect x="7" y="20" width="26" height="5" rx="2" fill="#8a663c"/><rect x="9" y="13" width="22" height="4" rx="2" fill="#a57f4d"/><rect x="10" y="25" width="4" height="8" fill="#6b4c2c"/><rect x="26" y="25" width="4" height="8" fill="#6b4c2c"/></svg>`,
  lantern: `<svg viewBox="0 0 40 40"><rect x="18.5" y="6" width="3" height="24" rx="1.5" fill="#4c3a26"/><rect x="13" y="9" width="14" height="12" rx="4" fill="#ffe0a0" stroke="#4c3a26" stroke-width="2"/><path d="M12 22h16" stroke="#4c3a26" stroke-width="2.5"/></svg>`,
  fire: `<svg viewBox="0 0 40 40"><path d="M20 8c4 6 8 8 8 14a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 1 4 2 4 1-3 1-6 2-10z" fill="#e8842f"/><path d="M20 18c2 3 4 4 4 7a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 .5 2.5 1 2.5.6-2 .6-4 1-5.5z" fill="#ffd27a"/></svg>`,
  garden: `<svg viewBox="0 0 40 40"><rect x="5" y="24" width="30" height="9" rx="3" fill="#8a663c"/><rect x="8" y="26" width="24" height="4" rx="2" fill="#4c3a26"/><path d="M12 24c0-5 2-6 2-9M20 24c0-6 2-7 2-11M28 24c0-4 2-5 2-8" stroke="#5a7449" stroke-width="2.6" stroke-linecap="round"/><circle cx="14" cy="14" r="2.6" fill="#8ea161"/><circle cx="22" cy="12" r="2.9" fill="#779c5a"/><circle cx="30" cy="15" r="2.4" fill="#8ea161"/></svg>`,
  flower: `<svg viewBox="0 0 40 40"><rect x="7" y="26" width="26" height="8" rx="3" fill="#8a663c"/><path d="M20 26V14M25 26v-8M15 26v-7" stroke="#5a7449" stroke-width="2.4" stroke-linecap="round"/><circle cx="20" cy="11" r="4" fill="#f2e4b0"/><circle cx="26" cy="16" r="3.4" fill="#e8c07a"/><circle cx="14" cy="17" r="3.2" fill="#f6efd0"/></svg>`,
  sign: `<svg viewBox="0 0 40 40"><rect x="18.5" y="16" width="3" height="18" rx="1.5" fill="#4c3a26"/><rect x="8" y="10" width="24" height="9" rx="2.5" fill="#a57f4d" stroke="#6b4c2c" stroke-width="1.6"/><path d="M12 14h13M12 16.5h8" stroke="#6b4c2c" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  well: `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="30" rx="12" ry="5" fill="#3e4455"/><path d="M8 30V22c0-3 5.4-5 12-5s12 2 12 5v8" fill="#5c6576"/><path d="M12 22l8-6 8 6" stroke="#8a663c" stroke-width="3" fill="none" stroke-linejoin="round"/><rect x="18.5" y="22" width="3" height="7" fill="#6b4c2c"/></svg>`,
  bridge: `<svg viewBox="0 0 40 40"><path d="M4 26h32" stroke="#8a663c" stroke-width="6" stroke-linecap="round"/><path d="M6 26c4-8 24-8 28 0" stroke="#a57f4d" stroke-width="3" fill="none"/><path d="M8 22v10M20 18v14M32 22v10" stroke="#6b4c2c" stroke-width="2.2"/></svg>`,
  cabin: `<svg viewBox="0 0 40 40"><path d="M6 20 20 8l14 12" stroke="#6b4c2c" stroke-width="3" fill="none" stroke-linejoin="round"/><rect x="10" y="19" width="20" height="14" rx="1.5" fill="#8a663c"/><rect x="16" y="24" width="8" height="9" rx="1" fill="#4c3a26"/><rect x="23" y="21" width="5" height="5" rx="1" fill="#ffd88a"/></svg>`,
  tree: `<svg viewBox="0 0 40 40"><rect x="18" y="24" width="4" height="11" rx="2" fill="#6b4c2c"/><circle cx="20" cy="17" r="9" fill="#5a7449"/><circle cx="15" cy="20" r="6" fill="#6f8f4e"/><circle cx="25" cy="19" r="6" fill="#4a6b41"/></svg>`,
};

const RES_LABEL = { wood: 'wood', stone: 'stone', fiber: 'fiber' };

export class UI {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.el = {
      hud: document.getElementById('hud'),
      loading: document.getElementById('loading'),
      loadingFill: document.getElementById('loader-fill'),
      loadingText: document.getElementById('loading-text'),
      title: document.getElementById('title'),
      play: document.getElementById('btn-play'),
      continueBtn: document.getElementById('btn-continue'),
      reset: document.getElementById('btn-reset'),
      quality: document.getElementById('btn-quality'),
      buildBtn: document.getElementById('btn-build'),
      tray: document.getElementById('build-tray'),
      trayItems: document.getElementById('build-items'),
      trayClose: document.getElementById('btn-tray-close'),
      trayHint: document.getElementById('tray-hint'),
      rotate: document.getElementById('btn-rotate'),
      remove: document.getElementById('btn-remove'),
      cancel: document.getElementById('btn-cancel'),
      sound: document.getElementById('btn-sound'),
      help: document.getElementById('btn-help'),
      helpModal: document.getElementById('help'),
      helpClose: document.getElementById('btn-help-close'),
      hint: document.getElementById('hint'),
      toasts: document.getElementById('toasts'),
      floaters: document.getElementById('floaters'),
      dayLabel: document.getElementById('day-label'),
      dayIcon: document.getElementById('day-icon'),
      res: {
        wood: document.getElementById('res-wood'),
        stone: document.getElementById('res-stone'),
        fiber: document.getElementById('res-fiber'),
      },
      stickZone: document.getElementById('stick-zone'),
      stickBase: document.getElementById('stick-base'),
      stickKnob: document.getElementById('stick-knob'),
      grade: document.getElementById('grade'),
    };
    this.selected = null;
    this.cards = new Map();
    this.hintTimer = null;
    this.stick = { id: null, active: false };
    this.bind();
  }

  bind() {
    const { el, cb } = this;
    el.play?.addEventListener('click', () => cb.onPlay?.());
    el.continueBtn?.addEventListener('click', () => cb.onPlay?.(true));
    el.reset?.addEventListener('click', () => cb.onReset?.());
    el.buildBtn?.addEventListener('click', () => cb.onToggleTray?.());
    el.trayClose?.addEventListener('click', () => cb.onToggleTray?.(false));
    el.rotate?.addEventListener('click', () => cb.onRotate?.());
    el.remove?.addEventListener('click', () => cb.onRemove?.());
    el.cancel?.addEventListener('click', () => cb.onCancel?.());
    el.sound?.addEventListener('click', () => cb.onSound?.());
    el.help?.addEventListener('click', () => this.showHelp(true));
    el.helpClose?.addEventListener('click', () => this.showHelp(false));
    el.quality?.addEventListener('click', () => cb.onQuality?.());

    this.bindStick();
  }

  bindStick() {
    const zone = this.el.stickBase || this.el.stickZone;
    if (!zone) return;
    const radius = () => zone.clientWidth * 0.34; // px the knob can travel
    let cx = 0, cy = 0;

    const start = (e) => {
      e.preventDefault();
      const r = zone.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      this.stick.id = e.pointerId;
      this.stick.active = true;
      zone.setPointerCapture?.(e.pointerId);
      this.moveStick(e.clientX, e.clientY, cx, cy, radius);
    };
    const move = (e) => {
      if (!this.stick.active || e.pointerId !== this.stick.id) return;
      e.preventDefault();
      this.moveStick(e.clientX, e.clientY, cx, cy, radius);
    };
    const end = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.active = false;
      this.stick.id = null;
      this.el.stickKnob.style.transform = 'translate(0px, 0px)';
      this.cb.onStick?.(0, 0, false);
    };
    zone.addEventListener('pointerdown', start);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('pointerleave', (e) => { if (this.stick.active) end(e); });
  }

  moveStick(px, py, cx, cy, maxR) {
    let dx = px - cx;
    let dy = py - cy;
    const len = Math.hypot(dx, dy);
    const r = maxR();
    if (len > r) {
      dx = (dx / len) * r;
      dy = (dy / len) * r;
    }
    this.el.stickKnob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    const nx = dx / r;
    const ny = dy / r;
    this.cb.onStick?.(nx, ny, true);
  }

  setStickVisible(visible) {
    if (!this.el.stickZone) return;
    this.el.stickZone.style.display = visible ? '' : 'none';
    this.el.stickZone.style.opacity = visible ? '0.94' : '0';
  }

  showScreen(name, show) {
    const map = { title: this.el.title, hud: this.el.hud, loading: this.el.loading };
    const node = map[name];
    if (!node) return;
    node.classList.toggle('hidden', !show);
  }

  setLoading(fraction, text) {
    if (this.el.loadingFill) this.el.loadingFill.style.width = `${Math.round(fraction * 100)}%`;
    if (text && this.el.loadingText) this.el.loadingText.textContent = text;
  }

  setHasSave(has) {
    if (this.el.continueBtn) this.el.continueBtn.classList.toggle('hidden', !has);
  }

  buildTray(items) {
    const wrap = this.el.trayItems;
    if (!wrap) return;
    wrap.innerHTML = '';
    this.cards.clear();
    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'item-card';
      btn.dataset.id = item.id;
      btn.innerHTML = `
        <span class="ic">${ICONS[item.icon] || ICONS.tree}</span>
        <span class="nm">${item.name}</span>
        <span class="cost">${this.costHtml(item.cost)}</span>`;
      btn.addEventListener('click', () => this.cb.onSelectItem?.(item.id));
      wrap.appendChild(btn);
      this.cards.set(item.id, btn);
    }
    this.items = items;
  }

  costHtml(cost) {
    const parts = [];
    for (const [k, v] of Object.entries(cost || {})) {
      if (!v) continue;
      parts.push(`<i title="${RES_LABEL[k] || k}">${v} ${RES_LABEL[k] || k}</i>`);
    }
    return parts.length ? parts.join('') : '<i>free</i>';
  }

  updateResources(res) {
    for (const [k, node] of Object.entries(this.el.res)) {
      if (!node) continue;
      const next = res[k] || 0;
      if (node.textContent !== String(next)) {
        node.textContent = String(next);
        const pill = node.closest('.pill');
        if (pill) {
          pill.classList.remove('bump');
          void pill.offsetWidth;
          pill.classList.add('bump');
          setTimeout(() => pill.classList.remove('bump'), 200);
        }
      }
      const pill = node.closest('.pill');
      if (pill) pill.classList.toggle('zero', next <= 0);
    }
    this.refreshAffordability(res);
  }

  refreshAffordability(res) {
    if (!this.items) return;
    for (const item of this.items) {
      const btn = this.cards.get(item.id);
      if (!btn) continue;
      let ok = true;
      for (const [k, v] of Object.entries(item.cost || {})) {
        if ((res[k] || 0) < v) ok = false;
      }
      btn.classList.toggle('poor', !ok);
      btn.title = ok ? item.name : `${item.name} — needs more materials`;
    }
  }

  setSelected(id) {
    this.selected = id;
    for (const [key, btn] of this.cards) btn.classList.toggle('selected', key === id);
  }

  setTrayOpen(open) {
    this.el.tray?.classList.toggle('open', open);
    this.el.buildBtn?.classList.toggle('active', open || !!this.selected);
    if (open) this.el.tray?.classList.remove('hidden');
    else setTimeout(() => {
      if (!this.el.tray?.classList.contains('open')) this.el.tray?.classList.add('hidden');
    }, 240);
  }

  setPlacing(on, canRotate = false) {
    this.el.buildBtn?.classList.toggle('active', on);
    this.el.rotate?.classList.toggle('hidden', !(on && canRotate));
    this.el.rotate?.classList.toggle('hidden', !on);
    this.el.cancel?.classList.toggle('hidden', !on);
    if (!on) this.el.remove?.classList.add('hidden');
  }

  setRemoving(on) {
    this.el.remove?.classList.toggle('hidden', !on && !this.removingVisible);
    this.el.remove?.classList.toggle('armed', !!on);
  }

  setRemoveVisible(on, armed = false) {
    this.removingVisible = on;
    this.el.remove?.classList.toggle('hidden', !on);
    this.el.remove?.classList.toggle('armed', armed);
  }

  setDay(label, night) {
    if (this.el.dayLabel) this.el.dayLabel.textContent = label;
    if (this.el.dayIcon) {
      if (night > 0.55) {
        this.el.dayIcon.style.background = 'radial-gradient(circle at 35% 35%, #dfe9ff, #9fb2cf 65%, #6e819f)';
        this.el.dayIcon.style.boxShadow = '0 0 10px rgba(180, 200, 240, 0.7)';
      } else {
        const warm = Math.min(1, night * 1.6);
        this.el.dayIcon.style.background = `radial-gradient(circle at 35% 35%, #ffe9a8, rgb(${230 - warm * 30}, ${169 - warm * 40}, ${79 - warm * 20}) 65%, #c8823a)`;
        this.el.dayIcon.style.boxShadow = `0 0 ${10 + warm * 6}px rgba(255, ${206 - warm * 30}, 128, 0.8)`;
      }
    }
    if (this.el.grade) {
      const warm = this.el.grade.querySelector('.warm');
      if (warm) warm.style.opacity = String(1 - night * 0.7);
    }
  }

  toast(text, duration = 1900) {
    if (!this.el.toasts) return;
    const node = document.createElement('div');
    node.className = 'toast';
    node.textContent = text;
    this.el.toasts.appendChild(node);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 420);
    }, duration);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
  }

  hint(text, ms = 2600) {
    if (!this.el.hint) return;
    this.el.hint.textContent = text;
    this.el.hint.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.el.hint.classList.remove('show'), ms);
  }

  floater(x, y, text) {
    if (!this.el.floaters) return;
    const node = document.createElement('div');
    node.className = 'floater';
    node.textContent = text;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    this.el.floaters.appendChild(node);
    setTimeout(() => node.remove(), 1150);
  }

  showHelp(on) {
    this.el.helpModal?.classList.toggle('hidden', !on);
    this.cb.onHelpToggle?.(on);
  }

  setQualityLabel(text) {
    if (this.el.quality) this.el.quality.textContent = `Quality: ${text}`;
  }

  setMuted(muted) {
    this.el.sound?.classList.toggle('muted', muted);
  }
}

export { ICONS };
