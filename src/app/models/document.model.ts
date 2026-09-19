/** Metadata for a document uploaded to Google Drive and linked to a loan.
 * The file's actual bytes live in the user's Google Drive — only the
 * pointer (Drive file id + link) is stored locally. */
export interface LoanDocument {
  fileName: string;
  driveFileId: string;
  driveViewLink: string;
  uploadedAt: string; // ISO timestamp
  sizeBytes?: number;
  /** The uploaded file's MIME type (e.g. "application/pdf", "image/jpeg"),
   *  used to pick how to render the in-app preview. Optional because
   *  documents uploaded before this field existed won't have it — the
   *  preview falls back to guessing from the file extension in that case. */
  mimeType?: string;
}

export type DocumentKind = 'settlementLetter' | 'nocCopy';

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  settlementLetter: 'Settlement Letter',
  nocCopy: 'NOC Copy',
};
