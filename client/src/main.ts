/**
 * Entry point.
 *
 * Boots the renderer, shows the loading screen, then hands control to the
 * game. Any fatal error (no WebGL 2) is surfaced as a readable message instead
 * of a blank canvas.
 */

import { Game } from './game';

async function boot(): Promise<void> {
  const stage = document.getElementById('stage');
  const bootEl = document.getElementById('boot');
  const fill = document.getElementById('boot-fill');
  const status = document.getElementById('boot-status');

  if (!stage) throw new Error('Missing #stage element');

  const canvas = document.createElement('canvas');
  canvas.id = 'range-canvas';
  stage.appendChild(canvas);

  const setProgress = (value: number, text: string) => {
    if (fill) fill.style.width = `${value}%`;
    if (status) status.textContent = text;
  };

  setProgress(12, 'Starting the renderer…');
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const game = new Game(canvas, document.getElementById('ui')!);
  try {
    setProgress(38, 'Building the range…');
    await game.init();
    setProgress(82, 'Tensioning the string…');
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    setProgress(100, 'Ready');
  } catch (error) {
    console.error('[GOLD RING] Boot failed', error);
    const fatal = document.getElementById('webgl-error');
    if (fatal) fatal.hidden = false;
    if (status) status.textContent = 'The renderer could not start.';
    return;
  }

  // First gesture unlocks Web Audio.
  const unlock = () => {
    void (game as unknown as { audio?: { start: () => Promise<void> } }).audio?.start();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  window.setTimeout(() => {
    bootEl?.classList.add('is-hidden');
    window.setTimeout(() => bootEl?.remove(), 700);
  }, 260);

  // Expose for debugging and for the automated smoke test.
  (window as unknown as { goldRing?: Game }).goldRing = game;
}

boot().catch((error) => {
  console.error('[GOLD RING] Fatal boot error', error);
  const fatal = document.getElementById('webgl-error');
  if (fatal) fatal.hidden = false;
});
