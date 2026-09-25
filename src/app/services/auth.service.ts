import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

const USERNAME_KEY = 'credittrack:username';
const PASSWORD_KEY = 'credittrack:password';

/** Extracts the backend's own error message out of a failed HttpClient
 *  call, falling back to something generic when the response wasn't the
 *  JSON `{ error, message }` shape the API normally sends. Same logic as
 *  backup.service.ts's private helper — small enough that duplicating it
 *  beats introducing a shared util for one line of reuse. */
function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    if (err.status === 0) {
      return `Can't reach the backend server — make sure it's running.`;
    }
  }
  return fallback;
}

/** Holds the logged-in username + password used to authenticate every
 * request to the backend API (see server/index.js's AUTH NOTE — it's
 * checked fresh against the database on every request, no session token
 * involved). Backed by sessionStorage so it survives page reloads within
 * the same browser tab session but is never baked into the build.
 *
 * Unlike the app this is mirrored from, registration is open here (see
 * register() below) — anyone can create their own account — but every
 * account, however it was created, reads and writes the exact same one
 * shared demo dataset. There's no per-account data split; this only
 * changes how you get in the door. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly username = signal<string | null>(this.readStored(USERNAME_KEY));
  readonly password = signal<string | null>(this.readStored(PASSWORD_KEY));

  constructor(private http: HttpClient) {}

  private readStored(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private setStored(key: string, value: string | null): void {
    try {
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch {
      // ignore — sessionStorage may be unavailable (private browsing, etc.)
    }
  }

  /** Stores a username + password as the active credentials without
   *  validating them against the backend first (login()/register() below
   *  do that validation before calling this). Exposed so tests can seed an
   *  "already logged in" state directly, without needing to intercept a
   *  request just to get there. */
  setCredentials(username: string, password: string): void {
    this.username.set(username);
    this.password.set(password);
    this.setStored(USERNAME_KEY, username);
    this.setStored(PASSWORD_KEY, password);
  }

  /** Validates the given credentials against the backend (see POST
   *  /api/login) and, on success, stores them so every subsequent request
   *  is authenticated. Throws with a friendly message on failure — most
   *  often "Wrong username or password." — leaving any previously stored
   *  credentials untouched. */
  async login(username: string, password: string): Promise<void> {
    let confirmedUsername = username.trim();
    try {
      const res = await firstValueFrom(
        this.http.post<{ username: string }>(`${environment.apiBaseUrl}/api/login`, { username, password })
      );
      confirmedUsername = res.username;
    } catch (err) {
      throw new Error(apiErrorMessage(err, 'Could not sign in.'));
    }
    this.setCredentials(confirmedUsername, password);
  }

  /** Creates a brand-new account (see server/index.js's POST /api/register
   *  — deliberately open, no invite or approval needed) and, on success,
   *  immediately signs the new account in so the person lands straight in
   *  the app rather than being sent back to a login form they'd just typed
   *  the same details into. Throws with a friendly message on failure —
   *  most often "That username is already taken." */
  async register(username: string, password: string): Promise<void> {
    let confirmedUsername = username.trim();
    try {
      const res = await firstValueFrom(
        this.http.post<{ username: string }>(`${environment.apiBaseUrl}/api/register`, { username, password })
      );
      confirmedUsername = res.username;
    } catch (err) {
      throw new Error(apiErrorMessage(err, 'Could not create the account.'));
    }
    this.setCredentials(confirmedUsername, password);
  }

  signOut(): void {
    this.username.set(null);
    this.password.set(null);
    this.setStored(USERNAME_KEY, null);
    this.setStored(PASSWORD_KEY, null);
  }

  /** Renames the logged-in account (see server/index.js's POST
   *  /api/change-username). Authenticated implicitly by whatever
   *  credentials are currently stored — the auth interceptor attaches them
   *  to this request like any other. On success, immediately swaps the
   *  stored username over so every request right after this one keeps
   *  working without asking the person to sign in again. */
  async changeUsername(newUsername: string): Promise<void> {
    let confirmed = newUsername.trim();
    try {
      const res = await firstValueFrom(
        this.http.post<{ username: string }>(`${environment.apiBaseUrl}/api/change-username`, { newUsername })
      );
      confirmed = res.username;
    } catch (err) {
      throw new Error(apiErrorMessage(err, 'Could not change the username.'));
    }
    const pw = this.password();
    if (pw) this.setCredentials(confirmed, pw);
  }

  /** Rotates the logged-in account's password (see server/index.js's POST
   *  /api/change-password). Same implicit-auth reasoning as
   *  changeUsername above — no separate "current password" field needed
   *  here; the frontend handles "confirm the new one twice" itself before
   *  ever sending a request. */
  async changePassword(newPassword: string): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${environment.apiBaseUrl}/api/change-password`, { newPassword }));
    } catch (err) {
      throw new Error(apiErrorMessage(err, 'Could not change the password.'));
    }
    const name = this.username();
    if (name) this.setCredentials(name, newPassword);
  }
}
