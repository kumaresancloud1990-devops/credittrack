import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'credittrack:family-key';

/** Holds the shared family passcode used to authenticate every request to
 * the backend API. Backed by sessionStorage so it survives page reloads
 * within the same browser tab session but is never baked into the build. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly familyKey = signal<string | null>(this.readStored());

  private readStored(): string | null {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  setKey(key: string): void {
    const trimmed = key.trim();
    this.familyKey.set(trimmed || null);
    try {
      if (trimmed) sessionStorage.setItem(STORAGE_KEY, trimmed);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore — sessionStorage may be unavailable (private browsing, etc.)
    }
  }

  signOut(): void {
    this.familyKey.set(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
