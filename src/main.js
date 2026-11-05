import { UI } from './ui/ui.js';
import { Game } from './game/game.js';

const ui = new UI({});
const game = new Game(ui);
window.mosswood = { game, ui };

boot();

async function boot() {
  try {
    await game.load();
    ui.setLoading(1, 'Ready');
    setTimeout(() => {
      ui.showScreen('loading', false);
      ui.showScreen('title', true);
      ui.setQualityLabel(['low', 'medium', 'high'][game.engine.quality]);
    }, 260);
  } catch (err) {
    console.error(err);
    const text = document.getElementById('loading-text');
    if (text) {
      text.textContent = 'Something went wrong while growing the valley.';
      text.style.color = '#f0c0a8';
    }
    const fill = document.getElementById('loader-fill');
    if (fill) fill.style.background = '#c07a5a';
    throw err;
  }
}

window.addEventListener('beforeunload', () => game.persist?.());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.persist?.();
});

// block iOS double-tap zoom on the UI layer
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
