/**
 * Remembers the player's game folder between visits, where the browser allows it: the folder's
 * handle goes in IndexedDB on this machine, and the browser asks again before reading it.
 */
const DB = 'mudbrick';
const STORE = 'folders';
const KEY = 'game';

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemHandle {
    requestPermission(opts: { mode: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
  }
  interface FileSystemDirectoryHandle {
    values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error instanceof Error ? req.error : new Error('IndexedDB'));
  });
}

async function store(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  db.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, KEY);
}

export async function rememberedFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** The folder picker, or null when this browser has none and the file input must do. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null;
  const handle = await window.showDirectoryPicker({ mode: 'read' });
  await store(handle);
  return handle;
}

/** Every file under the folder, by upper-case path relative to it. */
export async function filesOf(root: FileSystemDirectoryHandle): Promise<Map<string, File>> {
  const files = new Map<string, File>();
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const entry of dir.values()) {
      if (entry.kind === 'directory') await walk(entry, `${prefix}${entry.name}/`);
      else files.set(`${prefix}${entry.name}`.toUpperCase(), await entry.getFile());
    }
  };
  await walk(root, '');
  return files;
}
