/**
 * The menu bar, read from the folder's Menu.txt: same labels, same keys, real drop-down menus.
 * Items the game has no action for stay in the list, greyed, as the original greys what does not
 * apply.
 */
import { decodeText } from '@mudbrick/formats';

export interface MenuEntry {
  section: string;
  label: string;
  key: string;
}

const SKIP = new Set(['EDITOR']);

export function parseMenu(bytes: Uint8Array): { title: string; items: MenuEntry[] }[] {
  const menus: { title: string; items: MenuEntry[] }[] = [];
  let section = '';
  let current: { title: string; items: MenuEntry[] } | null = null;
  for (const raw of decodeText(bytes).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith(';') || line === '') continue;
    if (line.startsWith('@')) {
      section = line.slice(1);
      current = null;
      continue;
    }
    if (SKIP.has(section)) continue;
    const [label = '', key = ''] = line.replace(/&/g, '').split('|');
    if (!current) {
      current = { title: label, items: [] };
      menus.push(current);
      continue;
    }
    current.items.push({ section, label, key });
  }
  return menus;
}

export function buildMenuBar(
  bar: HTMLElement,
  menus: { title: string; items: MenuEntry[] }[],
  action: (entry: MenuEntry) => (() => void) | null,
): void {
  bar.replaceChildren();
  let openDrop: { title: HTMLElement; drop: HTMLElement } | null = null;
  const closeMenu = () => {
    openDrop?.drop.remove();
    openDrop?.title.classList.remove('active');
    openDrop = null;
  };
  const show = (title: HTMLElement, menu: { items: MenuEntry[] }) => {
    closeMenu();
    const drop = document.createElement('div');
    drop.className = 'menuDrop';
    for (const entry of menu.items) {
      const run = action(entry);
      const row = document.createElement('div');
      row.className = 'menuItem';
      if (!run) row.classList.add('off');
      const name = document.createElement('span');
      name.textContent = entry.label;
      const key = document.createElement('span');
      key.textContent = entry.key;
      row.append(name, key);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!run) return;
        closeMenu();
        run();
      });
      drop.append(row);
    }
    title.classList.add('active');
    title.append(drop);
    openDrop = { title, drop };
  };
  for (const menu of menus) {
    const title = document.createElement('div');
    title.className = 'menuTitle';
    title.textContent = menu.title;
    title.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openDrop?.title === title) closeMenu();
      else show(title, menu);
    });
    title.addEventListener('mouseenter', () => {
      if (openDrop && openDrop.title !== title) show(title, menu);
    });
    bar.append(title);
  }
  window.addEventListener('click', closeMenu);
}
