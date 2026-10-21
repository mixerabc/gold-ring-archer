/**
 * UI facade.
 *
 * Owns the HUD, the menus, toasts and the (dev-only) FPS readout. The game
 * talks to this single object, so swapping the presentation layer later does
 * not touch gameplay code.
 */

import type { Screen } from '../state/store';
import { Hud, type HudData } from './hud';
import { Menus, type ResultsData, type UIActions } from './menus';
import type { Tournament } from '../competition/bracket';

export interface UIState {
  screen: Screen;
  bowClass: import('@shared/types').BowClass;
  venue: import('../state/store').VenueId;
  gear: import('@shared/types').GearSetup;
  settings: import('../state/store').Settings;
}

export class UI {
  readonly hud: Hud;
  readonly menus: Menus;
  private toasts: HTMLElement;
  private fps: HTMLElement;

  constructor(root: HTMLElement, actions: UIActions, getState: () => UIState) {
    this.hud = new Hud(root);
    this.menus = new Menus(root, actions, getState);

    this.toasts = document.getElementById('toasts') ?? document.createElement('div');
    if (!this.toasts.parentElement) {
      this.toasts.className = 'toasts';
      document.body.appendChild(this.toasts);
    }

    this.fps = document.createElement('div');
    this.fps.style.cssText =
      'position:fixed;left:10px;top:10px;z-index:60;font:11px/1.4 var(--mono);color:#3ddc84;background:rgba(0,0,0,.5);padding:4px 7px;border-radius:5px;display:none;pointer-events:none';
    root.appendChild(this.fps);
  }

  show(screen: Screen): void {
    if (screen === 'playing') {
      this.menus.hide();
      this.hud.setVisible(true);
      return;
    }
    if (screen === 'paused') {
      this.hud.setVisible(true);
      this.menus.show('paused');
      return;
    }
    if (screen === 'boot') {
      this.menus.hide();
      this.hud.setVisible(false);
      return;
    }
    this.hud.setVisible(false);
    this.menus.show(screen);
  }

  updateHud(data: HudData): void {
    this.hud.update(data);
  }

  setHudVisible(visible: boolean): void {
    this.hud.setVisible(visible);
  }

  showResults(data: ResultsData): void {
    this.hud.setVisible(false);
    this.menus.setResults(data);
  }

  showBracket(tournament: Tournament): void {
    this.hud.setVisible(false);
    this.menus.setBracket(tournament);
  }

  setOnlineStatus(text: string): void {
    this.menus.setOnlineStatus(text);
  }

  showLeaderboard(rows: Array<{ name: string; score: number; xCount: number; bowClass: string; playedAt: string }>, status: string): void {
    this.hud.setVisible(false);
    this.menus.setLeaderboard(rows, status);
  }

  showMedal(data: ResultsData): void {
    this.hud.setVisible(false);
    this.menus.setResults(data);
    this.menus.show('medal');
  }

  toast(message: string, kind: 'info' | 'gold' | 'warn' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast${kind === 'gold' ? ' toast--gold' : kind === 'warn' ? ' toast--warn' : ''}`;
    el.textContent = message;
    this.toasts.appendChild(el);
    window.setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(10px)';
      window.setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  showFps(enabled: boolean): void {
    this.fps.style.display = enabled ? 'block' : 'none';
  }

  setFps(fps: number, backend: string): void {
    this.fps.textContent = `${fps.toFixed(0)} FPS · ${backend}`;
  }

  destroy(): void {
    this.hud.destroy();
    this.menus.hide();
    this.fps.remove();
  }
}

export type { HudData, ResultsData, UIActions };
