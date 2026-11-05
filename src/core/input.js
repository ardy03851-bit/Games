/**
 * Input: keyboard for desktop, virtual stick + taps for iPad.
 * One tap = "go there / use that". The camera never rotates, so there is
 * nothing to drag.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.move = { x: 0, z: 0 };
    this.joystick = { x: 0, y: 0, active: false };
    this.pointer = { x: 0, y: 0, down: false, inside: false };
    this.listeners = { tap: [], move: [], key: [] };
    this.sprint = false;

    this._down = null;
    this.bind();
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); return this; }
  emit(evt, ...args) { for (const fn of this.listeners[evt] || []) fn(...args); }

  bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.emit('key', e.code, e);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => {
      this.pointer.down = true;
      this.pointer.inside = true;
      this._down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.emit('move', e.clientX, e.clientY);
    });
    const end = (e) => {
      this.pointer.down = false;
      const d = this._down;
      this._down = null;
      if (!d) return;
      const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      const dt = performance.now() - d.t;
      if (dist < 16 && dt < 700) {
        this.emit('tap', e.clientX, e.clientY);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { this.pointer.down = false; this._down = null; });
    el.addEventListener('pointerleave', () => { this.pointer.inside = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setJoystick(x, y, active) {
    this.joystick.x = x;
    this.joystick.y = y;
    this.joystick.active = active;
  }

  /** Combined movement vector, camera-aligned (x → screen right, z → screen down). */
  moveVector() {
    let x = 0, z = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z += 1;
    if (this.joystick.active) {
      x += this.joystick.x;
      z += this.joystick.y;
    }
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    this.move.x = x;
    this.move.z = z;
    this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    return this.move;
  }
}
