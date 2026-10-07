/**
 * "Install app" (Matt, 7 Oct 2026): a button in the top bar that installs the tool as its own app, so a salesperson can
 * pin it to the Windows taskbar, and that disappears once it is installed.
 *
 * Chrome and Edge announce that a page can be installed with `beforeinstallprompt`, and only while it is NOT installed
 * (nor running as the installed app). The event can fire before React has drawn anything, so this module listens from
 * the moment it is imported (main.tsx imports it first) and keeps the event for the button. `appinstalled` hides the
 * button. Browsers without the event (Firefox, Safari) never show it. The browser cannot pin to the taskbar itself, so
 * the installed app's window shows a one-off tip saying how (`pinTipNeeded`).
 */
import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let promptEvent: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // our own button asks, not the browser's mini-bar
    promptEvent = e as InstallPromptEvent;
    installed = false;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    promptEvent = null;
    installed = true;
    notify();
  });
}

/** Running as the installed app (its own window), not in a browser tab. */
export const runningAsApp = (): boolean => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches;
  } catch {
    return false;
  }
};

const PIN_TIP_KEY = 'dl-pin-tip-seen:v1';
const readFlag = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

interface InstallState {
  /** The browser can install the tool now: show the button. */
  canInstall: boolean;
  /** Installed from this tab just now: tell them where it went. */
  justInstalled: boolean;
}
let snapshot: InstallState = { canInstall: false, justInstalled: false };
const getSnapshot = (): InstallState => {
  const next = { canInstall: !!promptEvent && !runningAsApp(), justInstalled: installed };
  if (next.canInstall !== snapshot.canInstall || next.justInstalled !== snapshot.justInstalled) snapshot = next;
  return snapshot;
};
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useInstallApp(): InstallState & { install: () => Promise<void> } {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const install = async (): Promise<void> => {
    const e = promptEvent;
    if (!e) return;
    await e.prompt();
    // Either way this event is spent (a prompt runs once): on "Install" the button goes and appinstalled follows; on
    // "Cancel" it comes back the next time the page loads and the browser offers the install again.
    promptEvent = null;
    notify();
  };
  return { ...state, install };
}

/** The installed app's first launch: say how to pin it, once. */
export const pinTipNeeded = (): boolean => runningAsApp() && !readFlag(PIN_TIP_KEY);
export const pinTipSeen = (): void => {
  try {
    localStorage.setItem(PIN_TIP_KEY, '1');
  } catch {
    /* blocked storage: the tip just shows again next time */
  }
};
