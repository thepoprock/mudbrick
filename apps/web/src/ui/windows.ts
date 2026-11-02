/**
 * The game's windows: a title bar, a stone body and buttons, drawn by the page instead of the
 * browser's own boxes. Everything the player answers goes through here, so Enter takes the
 * default button, Escape cancels, and the map ignores the keyboard while a window is up.
 */

export interface GameWindow {
  el: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close: () => void;
}

export interface WindowOptions {
  title: string;
  /** Width in pixels; the window keeps inside the screen either way. */
  width?: number;
  /** Runs for Escape and the close box. Without it those do nothing. */
  onCancel?: () => void;
  /** Runs for Enter when no button inside the window has the focus. */
  onAccept?: () => void;
  /** A stable id, for tests and styles. */
  id?: string;
}

const open: { win: GameWindow; opts: WindowOptions }[] = [];

function layer(): HTMLElement {
  let el = document.getElementById('windowLayer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'windowLayer';
    document.body.append(el);
  }
  return el;
}

/** Windows above the map stop it taking keys and clicks. */
export function windowIsOpen(): boolean {
  return open.length > 0;
}

function dragBy(handle: HTMLElement, el: HTMLElement): void {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target instanceof HTMLButtonElement) return;
    const box = el.getBoundingClientRect();
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    handle.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      el.style.left = `${Math.max(0, Math.min(innerWidth - 60, m.clientX - dx))}px`;
      el.style.top = `${Math.max(0, Math.min(innerHeight - 30, m.clientY - dy))}px`;
      el.style.transform = 'none';
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

export function openWindow(opts: WindowOptions): GameWindow {
  const el = document.createElement('div');
  el.className = 'gameWindow';
  if (opts.id) el.id = opts.id;
  if (opts.width) el.style.width = `${opts.width}px`;
  const bar = document.createElement('div');
  bar.className = 'windowTitle';
  const label = document.createElement('span');
  label.textContent = opts.title;
  bar.append(label);
  if (opts.onCancel) {
    const x = document.createElement('button');
    x.className = 'windowClose';
    x.textContent = '×';
    x.title = 'Close';
    x.addEventListener('click', () => opts.onCancel?.());
    bar.append(x);
  }
  const body = document.createElement('div');
  body.className = 'windowBody';
  const footer = document.createElement('div');
  footer.className = 'windowFooter';
  el.append(bar, body, footer);
  dragBy(bar, el);
  const backdrop = document.createElement('div');
  backdrop.className = 'windowBackdrop';
  layer().append(backdrop, el);
  const win: GameWindow = {
    el,
    body,
    footer,
    close: () => {
      const i = open.findIndex((w) => w.win === win);
      if (i >= 0) open.splice(i, 1);
      el.remove();
      backdrop.remove();
    },
  };
  open.push({ win, opts });
  return win;
}

export function addButton(win: GameWindow, label: string, run: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', run);
  win.footer.append(b);
  return b;
}

// The top window has the keyboard. Capture runs first, so the map never sees these keys.
window.addEventListener(
  'keydown',
  (e) => {
    const top = open[open.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
      top.opts.onCancel?.();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    const typing =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement;
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      top.opts.onAccept?.();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (!typing && !(e.ctrlKey || e.metaKey)) e.stopImmediatePropagation();
  },
  true,
);

export function textBlock(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'windowText';
  p.textContent = text;
  return p;
}

/** A message with buttons; resolves to the index of the one pressed, or -1 for Escape. */
export function askButtons(
  title: string,
  text: string,
  buttons: string[],
  cancel: number | null = null,
): Promise<number> {
  return new Promise((resolve) => {
    const finish = (n: number) => {
      win.close();
      resolve(n);
    };
    const win = openWindow({
      title,
      width: 420,
      onAccept: () => finish(0),
      ...(cancel !== null ? { onCancel: () => finish(cancel) } : {}),
    });
    win.body.append(textBlock(text));
    buttons.forEach((label, n) => addButton(win, label, () => finish(n)));
    win.footer.querySelector('button')?.focus();
  });
}

export async function askYes(text: string, title = 'Question'): Promise<boolean> {
  return (await askButtons(title, text, ['Yes', 'No'], 1)) === 0;
}

export async function tell(text: string, title = 'Notice'): Promise<void> {
  await askButtons(title, text, ['OK'], 0);
}

/** A line of text, or null for Cancel. */
export function askText(
  title: string,
  label: string,
  value = '',
  opts: { password?: boolean; maxLength?: number } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const finish = (v: string | null) => {
      win.close();
      resolve(v);
    };
    const win = openWindow({
      title,
      width: 400,
      onCancel: () => finish(null),
      onAccept: () => finish(input.value),
    });
    const input = document.createElement('input');
    input.value = value;
    input.className = 'windowInput';
    if (opts.password) input.type = 'password';
    if (opts.maxLength) input.maxLength = opts.maxLength;
    win.body.append(textBlock(label), input);
    addButton(win, 'OK', () => finish(input.value));
    addButton(win, 'Cancel', () => finish(null));
    input.focus();
    input.select();
  });
}

/** A number, or null for Cancel or anything that is not one. */
export async function askNumber(
  title: string,
  label: string,
  value: number,
): Promise<number | null> {
  const typed = await askText(title, label, String(value));
  if (typed === null || typed.trim() === '') return null;
  const n = Number(typed);
  return Number.isFinite(n) ? n : null;
}

export interface ListItem {
  label: string;
  icon?: HTMLElement;
  disabled?: boolean;
  /** Shown to the right of the label. */
  note?: string;
}

/** A list to pick from. Double click or Enter accepts. Resolves to the index, or null. */
export function askList(
  title: string,
  text: string,
  items: ListItem[],
  opts: {
    selected?: number;
    width?: number;
    accept?: string;
    extra?: { label: string; run: (index: number) => void }[];
  } = {},
): Promise<number | null> {
  return new Promise((resolve) => {
    let current = opts.selected ?? items.findIndex((i) => !i.disabled);
    const finish = (n: number | null) => {
      win.close();
      resolve(n);
    };
    const accept = () => {
      if (current >= 0 && items[current]?.disabled !== true) finish(current);
    };
    const win = openWindow({
      title,
      width: opts.width ?? 420,
      onCancel: () => finish(null),
      onAccept: accept,
    });
    if (text) win.body.append(textBlock(text));
    const list = document.createElement('div');
    list.className = 'windowList';
    list.tabIndex = 0;
    const rows = items.map((item, n) => {
      const row = document.createElement('div');
      row.className = 'windowRow';
      if (item.disabled) row.classList.add('disabled');
      if (item.icon) row.append(item.icon);
      const name = document.createElement('span');
      name.className = 'rowLabel';
      name.textContent = item.label;
      row.append(name);
      if (item.note) {
        const note = document.createElement('span');
        note.className = 'rowNote';
        note.textContent = item.note;
        row.append(note);
      }
      row.addEventListener('click', () => {
        if (!item.disabled) mark(n);
      });
      row.addEventListener('dblclick', () => {
        if (!item.disabled) finish(n);
      });
      list.append(row);
      return row;
    });
    const mark = (n: number) => {
      rows[current]?.classList.remove('chosen');
      current = n;
      rows[n]?.classList.add('chosen');
      rows[n]?.scrollIntoView({ block: 'nearest' });
    };
    list.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (step === 0) return;
      e.preventDefault();
      for (let n = current + step; n >= 0 && n < items.length; n += step) {
        if (items[n]?.disabled !== true) {
          mark(n);
          break;
        }
      }
    });
    win.body.append(list);
    if (current >= 0) mark(current);
    addButton(win, opts.accept ?? 'OK', accept);
    for (const x of opts.extra ?? []) addButton(win, x.label, () => x.run(current));
    addButton(win, 'Cancel', () => finish(null));
    list.focus();
  });
}
