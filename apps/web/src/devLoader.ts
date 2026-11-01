/**
 * Development-only convenience: one click loads the game folder and a chosen save from
 * `apps/web/dev-game/`, a gitignored symlink to the developer's own copy served by the Vite dev
 * server. Never part of a production build (`import.meta.env.DEV` guard in `main.ts`).
 */
import { loadGameFolderFromUrl, type GameFolder } from './gameFiles.js';

export const DEV_GAME_BASE = '/dev-game/';

export interface DevLoaderHooks {
  onFolder: (folder: GameFolder) => void;
  onGame: (name: string, bytes: Uint8Array) => void;
  onError: (what: string, err: unknown) => void;
}

export function installDevLoader(container: HTMLElement, hooks: DevLoaderHooks): void {
  const button = document.createElement('button');
  button.textContent = 'Load dev-game folder';
  button.title = 'Loads RULES.TXT and the sheets from apps/web/dev-game (developer symlink)';
  const name = document.createElement('input');
  name.placeholder = 'e.g. WWII.SCN or SCENARIO/MARS/MARS.SCN';
  name.size = 32;
  name.value = new URLSearchParams(location.search).get('game') ?? '';
  const open = document.createElement('button');
  open.textContent = 'Open from dev-game';
  container.append(button, ' ', name, ' ', open);

  button.addEventListener('click', () => {
    loadGameFolderFromUrl(DEV_GAME_BASE)
      .then(hooks.onFolder)
      .catch((err: unknown) => hooks.onError('dev-game folder', err));
  });
  const openGame = () => {
    const file = name.value.trim();
    if (!file) return;
    fetch(DEV_GAME_BASE + file)
      .then(async (res) => {
        if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) {
          throw new Error(`${file} not found under dev-game`);
        }
        // The path inside the folder is kept so a scenario's EVENTS.TXT can be found beside it.
        hooks.onGame(file, new Uint8Array(await res.arrayBuffer()));
      })
      .catch((err: unknown) => hooks.onError(file, err));
  };
  open.addEventListener('click', openGame);
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openGame();
  });

  // ?game=NAME in the URL loads folder + game immediately, for screenshots and tests.
  if (name.value) {
    loadGameFolderFromUrl(DEV_GAME_BASE)
      .then((folder) => {
        hooks.onFolder(folder);
        openGame();
      })
      .catch((err: unknown) => hooks.onError('dev-game folder', err));
  }
}
