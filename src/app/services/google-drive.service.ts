import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { DocumentKind, DOCUMENT_LABELS, LoanDocument } from '../models/document.model';
import { DataService } from './data.service';

// Google Identity Services has no bundled types — declare the global loaded via index.html's <script> tag.
declare const google: any;

const APP_FOLDER_NAME = 'CrediTrack';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
}

@Injectable({ providedIn: 'root' })
export class GoogleDriveService {
  private readonly _isSignedIn = signal<boolean>(false);
  readonly isSignedIn = this._isSignedIn.asReadonly();

  private accessToken: string | null = null;
  private tokenClient: TokenClient | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private folderId: string | null = null;
  /** Per-loan subfolder ids, keyed by the loan's (trimmed) name — looked up
   *  or created the first time a document is uploaded for that loan, then
   *  reused for the rest of this session so uploading both the Settlement
   *  Letter and NOC Copy for one loan doesn't search Drive twice. Not
   *  persisted anywhere (unlike the single shared app-folder id below,
   *  which is cached on the backend via `data.setDriveFolderId`) — there's
   *  no per-loan storage for it, and re-deriving it from the loan's own
   *  name on the next page load is cheap and always self-consistent. */
  private readonly loanFolderIds = new Map<string, string>();

  constructor(private data: DataService) {}

  private getClientId(): string {
    const id = environment.googleClientId;
    if (!id || id.startsWith('PASTE_YOUR_')) {
      throw new Error(
        'Google Drive is not configured yet. Paste your OAuth Client ID into src/environments/environment.ts (see README.md).'
      );
    }
    return id;
  }

  private ensureGis(): void {
    if (typeof google === 'undefined' || !google?.accounts?.oauth2) {
      throw new Error('Google Sign-In script has not loaded yet. Check your internet connection and reload the page.');
    }
  }

  signIn(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ensureGis();
        const clientId = this.getClientId();
        this.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          callback: (response: any) => {
            if (response.error) {
              reject(new Error(`Google sign-in failed: ${response.error}`));
              return;
            }
            this.accessToken = response.access_token;
            this._isSignedIn.set(true);
            const expiresInSec = Number(response.expires_in) || 3600;
            if (this.expiryTimer) clearTimeout(this.expiryTimer);
            this.expiryTimer = setTimeout(() => {
              this.accessToken = null;
              this._isSignedIn.set(false);
            }, expiresInSec * 1000);
            resolve();
          },
        });
        this.tokenClient!.requestAccessToken({ prompt: '' });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Could not start Google sign-in.'));
      }
    });
  }

  signOut(): void {
    this.accessToken = null;
    this._isSignedIn.set(false);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
  }

  private authHeaders(): Record<string, string> {
    if (!this.accessToken) {
      throw new Error('Not signed in to Google Drive yet. Click "Sign in with Google" first.');
    }
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  /**
   * Google's API always sends a JSON body explaining *why* a request failed
   * (e.g. `{ error: { status: 'PERMISSION_DENIED', message: '...', errors: [{ reason: 'accessNotConfigured' }] } }`).
   * A bare "status 403" throws that reason away, which made every past
   * report of this error impossible to diagnose without live access to the
   * user's browser. This reads the body and turns the handful of reasons
   * that actually happen with this app (Drive API not enabled yet, the
   * sign-in not granting Drive access, an org policy blocking file
   * creation, a quota hit) into a plain-language fix, falling back to
   * Google's own message for anything else.
   */
  private async describeDriveError(res: Response): Promise<string> {
    let reason = '';
    let message = '';
    try {
      const body = await res.json();
      reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
      message = body?.error?.message || '';
    } catch {
      // Response wasn't JSON (e.g. a proxy/network error page) — fall through to the generic message below.
    }

    if (res.status === 403 && (reason === 'accessNotConfigured' || /has not been used in project|is disabled/i.test(message))) {
      return 'The Google Drive API isn\'t turned on for your Google Cloud project yet. Go to Google Cloud Console → APIs & Services → Library, search for "Google Drive API", and click Enable (README section 5, step 3) — then try the upload again.';
    }
    if (res.status === 403 && (reason === 'insufficientPermissions' || reason === 'insufficientScopes')) {
      return 'Your Google sign-in didn\'t grant Drive access. Click "Sign in with Google" again and make sure to approve the Drive permission on the consent screen (it may ask again if a previous sign-in was only partially approved).';
    }
    if (res.status === 403 && reason === 'appNotAuthorizedToFile') {
      return 'Your Google account\'s Drive settings are blocking this app from creating files (common on a Google Workspace/work account with restricted third-party app access). Try a personal Google account, or ask your Workspace admin to allow this app.';
    }
    if (res.status === 403 && /dailyLimit|rateLimitExceeded/i.test(reason)) {
      return 'Google Drive rejected the request as too many requests too quickly (a quota limit). Wait a minute and try again.';
    }
    if (res.status === 403) {
      return `Google Drive refused the request (403 — permission denied)${message ? `: ${message}` : ''}. This usually means the Drive API isn\'t enabled yet for your Google Cloud project, or your account\'s Drive access is restricted — see README section 5.`;
    }
    if (res.status === 401) {
      return 'Your Google sign-in has expired. Click "Sign in with Google" again and retry the upload.';
    }
    return `Google Drive request failed (status ${res.status})${message ? `: ${message}` : ''}.`;
  }

  async ensureAppFolder(): Promise<string> {
    if (this.folderId) return this.folderId;
    const cached = this.data.meta().driveFolderId;
    if (cached) {
      this.folderId = cached;
      return cached;
    }

    const query = encodeURIComponent(
      `name='${APP_FOLDER_NAME.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'me' in owners`
    );
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`, {
      headers: this.authHeaders(),
    });
    if (!searchRes.ok) {
      throw new Error(await this.describeDriveError(searchRes));
    }
    const searchJson = await searchRes.json();
    const existing = searchJson.files?.[0];
    if (existing?.id) {
      this.folderId = existing.id;
      this.data.setDriveFolderId(existing.id);
      return existing.id;
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: APP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    if (!createRes.ok) {
      throw new Error(await this.describeDriveError(createRes));
    }
    const createJson = await createRes.json();
    this.folderId = createJson.id;
    this.data.setDriveFolderId(createJson.id);
    return createJson.id;
  }

  /**
   * Ensures a subfolder named after this loan exists inside the shared app
   * folder, and returns its Drive folder id — creating it the first time a
   * document is uploaded for that loan. Every document for a loan
   * (Settlement Letter, NOC Copy) then lands together in that one
   * loan-named subfolder instead of one flat pile shared by every loan, so
   * Drive's own folder structure mirrors the app's loan-by-loan records.
   * Looked up by name (scoped to the app folder as parent, same as
   * `ensureAppFolder` looks up the app folder itself by name) rather than a
   * stored id, so renaming a loan later simply finds-or-creates the
   * matching folder next time instead of leaving documents in a
   * now-mismatched name.
   */
  async ensureLoanFolder(loanName: string): Promise<string> {
    const safeName = (loanName || '').trim() || 'Untitled loan';
    const cached = this.loanFolderIds.get(safeName);
    if (cached) return cached;

    const parentId = await this.ensureAppFolder();
    const query = encodeURIComponent(
      `name='${safeName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentId}' in parents`
    );
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`, {
      headers: this.authHeaders(),
    });
    if (!searchRes.ok) {
      throw new Error(await this.describeDriveError(searchRes));
    }
    const searchJson = await searchRes.json();
    const existing = searchJson.files?.[0];
    if (existing?.id) {
      this.loanFolderIds.set(safeName, existing.id);
      return existing.id;
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safeName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
    });
    if (!createRes.ok) {
      throw new Error(await this.describeDriveError(createRes));
    }
    const createJson = await createRes.json();
    this.loanFolderIds.set(safeName, createJson.id);
    return createJson.id;
  }

  async uploadFile(file: File | Blob, fileName: string, mimeType: string, folderId: string): Promise<{ id: string; webViewLink: string }> {
    const metadata = { name: fileName, parents: [folderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file, fileName);

    let res: Response;
    try {
      res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: this.authHeaders(),
        body: form,
      });
    } catch (err) {
      throw new Error('Network error while uploading to Google Drive. Please check your connection and try again.');
    }
    if (!res.ok) {
      throw new Error(await this.describeDriveError(res));
    }
    const json = await res.json();
    return { id: json.id, webViewLink: json.webViewLink };
  }

  async uploadDocument(file: File, kind: DocumentKind, loanName: string): Promise<LoanDocument> {
    if (!this._isSignedIn()) {
      throw new Error('Please sign in with Google first (see the sidebar) before uploading documents.');
    }
    const folderId = await this.ensureLoanFolder(loanName);
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
    const fileName = `${loanName} - ${DOCUMENT_LABELS[kind]}${ext}`;
    const mimeType = file.type || 'application/octet-stream';
    const uploaded = await this.uploadFile(file, fileName, mimeType, folderId);
    return {
      fileName,
      driveFileId: uploaded.id,
      driveViewLink: uploaded.webViewLink,
      uploadedAt: new Date().toISOString(),
      sizeBytes: file.size,
      mimeType,
    };
  }

  /**
   * Downloads a previously-uploaded document's actual bytes for an in-app
   * preview, using the same authenticated session as the upload — this
   * works regardless of what Google account (if any) is active in an
   * iframe, unlike embedding Drive's own public preview URL directly,
   * because `drive.file` scope only grants access through authenticated
   * API calls, not anonymous viewing.
   */
  async fetchFileBlob(fileId: string): Promise<Blob> {
    if (!this._isSignedIn()) {
      throw new Error('Please sign in with Google first to preview this document.');
    }
    let res: Response;
    try {
      res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: this.authHeaders(),
      });
    } catch (err) {
      throw new Error('Network error while fetching the document from Google Drive.');
    }
    if (!res.ok) {
      throw new Error(await this.describeDriveError(res));
    }
    return res.blob();
  }

  async uploadExcelSnapshot(blob: Blob, fileName: string): Promise<{ id: string; webViewLink: string }> {
    if (!this._isSignedIn()) {
      throw new Error('Please sign in with Google first before uploading the Excel snapshot.');
    }
    const folderId = await this.ensureAppFolder();
    return this.uploadFile(blob, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', folderId);
  }
}
