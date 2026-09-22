import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { DocumentKind, DOCUMENT_LABELS, LoanDocument } from '../../models/document.model';
import { GoogleDriveService } from '../../services/google-drive.service';

type PreviewKind = 'pdf' | 'image' | 'unsupported';

function guessKind(doc: LoanDocument): PreviewKind {
  const mime = doc.mimeType || '';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (!mime) {
    // Documents uploaded before mimeType was tracked — guess from the
    // file's extension instead.
    const ext = doc.fileName.slice(doc.fileName.lastIndexOf('.')).toLowerCase();
    if (ext === '.pdf') return 'pdf';
    if (['.jpg', '.jpeg', '.png'].includes(ext)) return 'image';
  }
  return 'unsupported';
}

@Component({
  selector: 'app-document-upload',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonModule],
  templateUrl: './document-upload.component.html',
  styleUrl: './document-upload.component.scss',
})
export class DocumentUploadComponent {
  @Input({ required: true }) loanId!: string;
  @Input({ required: true }) kind!: DocumentKind;
  @Input() loanName = '';
  @Input() existingDoc: LoanDocument | null | undefined = null;

  @Output() uploaded = new EventEmitter<LoanDocument>();

  readonly uploading = signal(false);
  readonly downloading = signal(false);
  readonly error = signal<string | null>(null);
  readonly labels = DOCUMENT_LABELS;

  readonly previewOpen = signal(false);
  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly previewKind = signal<PreviewKind>('unsupported');
  readonly previewUrl = signal<SafeResourceUrl | null>(null);
  private previewObjectUrl: string | null = null;

  constructor(public drive: GoogleDriveService, private sanitizer: DomSanitizer) {}

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.error.set(null);

    if (!this.drive.isSignedIn()) {
      try {
        await this.drive.signIn();
      } catch (err) {
        this.error.set(err instanceof Error ? err.message : 'Sign-in failed.');
        input.value = '';
        return;
      }
    }

    this.uploading.set(true);
    try {
      const doc = await this.drive.uploadDocument(file, this.kind, this.loanName || this.loanId);
      this.existingDoc = doc;
      this.uploaded.emit(doc);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      this.uploading.set(false);
      input.value = '';
    }
  }

  /**
   * Downloads this document's actual bytes to the user's computer, saved
   * under the exact same name shown in the app (`existingDoc.fileName` —
   * "<loan name> - <Settlement Letter|NOC Copy>.<ext>") rather than
   * whatever name a browser might otherwise guess from the URL. Reuses the
   * same authenticated fetch as the in-app preview, so it works the same
   * way regardless of which Google account (if any) is active elsewhere in
   * the browser.
   */
  async downloadDocument(): Promise<void> {
    const doc = this.existingDoc;
    if (!doc) return;
    this.error.set(null);
    this.downloading.set(true);
    try {
      if (!this.drive.isSignedIn()) {
        await this.drive.signIn();
      }
      const blob = await this.drive.fetchFileBlob(doc.driveFileId);
      const objectUrl = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = objectUrl;
      link.download = doc.fileName;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not download this document.');
    } finally {
      this.downloading.set(false);
    }
  }

  async openPreview(): Promise<void> {
    const doc = this.existingDoc;
    if (!doc) return;
    this.previewOpen.set(true);
    this.previewLoading.set(true);
    this.previewError.set(null);
    this.previewUrl.set(null);
    const kind = guessKind(doc);
    this.previewKind.set(kind);

    if (kind === 'unsupported') {
      this.previewLoading.set(false);
      return;
    }

    try {
      if (!this.drive.isSignedIn()) {
        await this.drive.signIn();
      }
      const blob = await this.drive.fetchFileBlob(doc.driveFileId);
      this.revokeObjectUrl();
      this.previewObjectUrl = URL.createObjectURL(blob);
      this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.previewObjectUrl));
    } catch (err) {
      this.previewError.set(err instanceof Error ? err.message : 'Could not load a preview for this document.');
    } finally {
      this.previewLoading.set(false);
    }
  }

  closePreview(): void {
    this.previewOpen.set(false);
    this.revokeObjectUrl();
    this.previewUrl.set(null);
  }

  private revokeObjectUrl(): void {
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
  }
}
