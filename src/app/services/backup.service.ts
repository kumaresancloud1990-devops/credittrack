import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface RestoreResult {
  status: string;
  message: string;
}

/** Extracts the backend's own error message out of a failed HttpClient
 *  call, falling back to something generic when the response wasn't the
 *  JSON `{ error, message }` shape the API normally sends. */
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

@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly apiBase = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  private filename(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `credittrack_backup_${stamp}.dump`;
  }

  /** Downloads a full Postgres backup (.dump, pg_dump custom format —
   *  schema, data and the migration history all included) and triggers a
   *  browser download of it. Throws with a friendly message on failure. */
  async downloadBackup(): Promise<void> {
    let blob: Blob;
    try {
      // POST, not GET — the backend endpoint changed to POST since a full
      // database export has real server-side effects (shelling out to
      // pg_dump, writing a temp file) and shouldn't be a plain GET that
      // could end up cached or logged by an intermediary.
      blob = await firstValueFrom(this.http.post(`${this.apiBase}/api/backup`, null, { responseType: 'blob' }));
    } catch (err) {
      throw new Error(apiErrorMessage(err, 'Backup failed.'));
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.filename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Uploads a backup file and restores the database from it — a full
   *  replace of every loan, closed loan, and monthly spend, matching
   *  ordinary "restore a backup" semantics. Throws with a friendly message
   *  on failure; the backend rolls back on any failure, so the existing
   *  data is left untouched when this rejects. */
  async restoreBackup(file: File): Promise<RestoreResult> {
    try {
      return await firstValueFrom(
        this.http.post<RestoreResult>(`${this.apiBase}/api/restore`, file, {
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      );
    } catch (err) {
      throw new Error(apiErrorMessage(err, 'Restore failed.'));
    }
  }
}
