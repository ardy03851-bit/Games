/**
 * Saves are tiny: the world is regenerated from an integer seed, so only the
 * player's changes have to be stored.
 */
const KEY = 'mosswood.save.v3';
const SETTINGS_KEY = 'mosswood.settings.v1';

export function saveGame(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, v: 3, at: Date.now() }));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 3) return null;
    return data;
  } catch (e) {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
