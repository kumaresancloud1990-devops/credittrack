import { Injectable } from '@angular/core';
// Type-only imports — erased at compile time, so they cost nothing in the
// initial bundle. The real jsPDF / jspdf-autotable modules are loaded via a
// dynamic import() inside buildMonthDoc() below, so they only ship as their
// own lazy chunk, fetched on demand when the user actually clicks
// "Export to PDF" — not bundled into everyone's first page load (same
// pattern ExcelService uses for exceljs).
import type { jsPDF as JsPdfType } from 'jspdf';
import { DataService } from './data.service';
import { SpendEntry, SpendMonth } from '../models/spend.model';

const NAVY: [number, number, number] = [15, 30, 61];
const BLUE: [number, number, number] = [29, 86, 199];
const BLUE_SOFT: [number, number, number] = [239, 244, 253];
const SLATE: [number, number, number] = [60, 74, 107];
const LINE: [number, number, number] = [216, 222, 234];
const ROW_TINT: [number, number, number] = [247, 249, 253];
const MUTED: [number, number, number] = [150, 150, 150];

// jsPDF's built-in "helvetica" font has no glyph for the rupee sign (₹), so
// Intl's `style: 'currency'` renders as a blank space instead of the symbol.
// A plain grouped number with an ASCII "Rs." prefix renders correctly with
// any standard font, and still matches the app's en-IN digit grouping.
function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return 'Rs. ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

function statusFor(e: SpendEntry): string {
  if (e.paidAmount === null || e.paidAmount === undefined) return 'Pending';
  const bal = e.amount - e.paidAmount;
  return bal <= 0 ? 'Paid' : `Balance ${fmtMoney(bal)}`;
}

@Injectable({ providedIn: 'root' })
export class PdfService {
  constructor(private data: DataService) {}

  private async buildMonthDoc(mid: string, m: SpendMonth): Promise<JsPdfType> {
    const { jsPDF } = await import('jspdf');
    const { autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;

    // Title block
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...NAVY);
    doc.text('Monthly Spends', margin, 50);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(...SLATE);
    doc.text(m.label || mid, margin, 68);

    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(
      `Generated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      pageWidth - margin,
      50,
      { align: 'right' }
    );

    doc.setDrawColor(...LINE);
    doc.setLineWidth(1);
    doc.line(margin, 78, pageWidth - margin, 78);

    // Income table
    const incomes = m.incomes || [];
    const totalIncome = incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    autoTable(doc, {
      startY: 92,
      margin: { left: margin, right: margin },
      head: [['Income source', 'Amount']],
      body: incomes.length ? incomes.map((i) => [i.label, fmtMoney(i.amount)]) : [['No income rows yet', '']],
      foot: [['Total income', fmtMoney(totalIncome)]],
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 6, lineColor: LINE, lineWidth: 0.5 },
      headStyles: { fillColor: BLUE_SOFT, textColor: NAVY, fontStyle: 'bold', lineWidth: { bottom: 1 } },
      footStyles: { fillColor: ROW_TINT, textColor: [20, 20, 20], fontStyle: 'bold', lineWidth: { top: 1 } },
      columnStyles: {
        0: { cellWidth: 'auto', halign: 'left' },
        1: { cellWidth: 130, halign: 'right' },
      },
    });

    let y = (doc as any).lastAutoTable.finalY + 24;

    // Expenses & settlements table
    const entries = m.entries || [];
    const totalAmt = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const totalPaid = entries.reduce((s, e) => s + (Number(e.paidAmount) || 0), 0);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text('Expenses & settlements', margin, y);
    y += 10;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Item', 'Type', 'Amount', 'Paid', 'Status', 'Date / Remark']],
      body: entries.length
        ? entries.map((e) => [
            e.name,
            e.type === 'settlement' ? 'Settlement' : 'Expense',
            fmtMoney(e.amount),
            e.paidAmount != null ? fmtMoney(e.paidAmount) : '—',
            statusFor(e),
            [e.date, e.remarks].filter(Boolean).join(' — ') || '—',
          ])
        : [['No entries in this month yet', '', '', '', '', '']],
      foot: entries.length ? [['Total', '', fmtMoney(totalAmt), fmtMoney(totalPaid), '', '']] : undefined,
      theme: 'striped',
      styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 6, lineColor: LINE, lineWidth: 0.5, overflow: 'linebreak' },
      headStyles: { fillColor: BLUE, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: ROW_TINT },
      footStyles: { fillColor: BLUE_SOFT, textColor: NAVY, fontStyle: 'bold', lineWidth: { top: 1 } },
      columnStyles: {
        0: { cellWidth: 110, halign: 'left' },
        1: { cellWidth: 60, halign: 'center' },
        2: { cellWidth: 75, halign: 'right' },
        3: { cellWidth: 75, halign: 'right' },
        4: { cellWidth: 90, halign: 'left' },
        5: { cellWidth: 'auto', halign: 'left' },
      },
    });

    y = (doc as any).lastAutoTable.finalY + 24;

    // Summary — mirrors the on-screen stats on the Monthly Spends page.
    const summary: [string, string][] = [
      ['Total income', fmtMoney(totalIncome)],
      ['Planned amount', fmtMoney(totalAmt)],
      ['Paid from planned', fmtMoney(totalPaid)],
      ['Balance (unpaid plan)', fmtMoney(totalAmt - totalPaid)],
      ['Balance post all planned', fmtMoney(totalIncome - totalAmt)],
      ['Current bank balance', fmtMoney(totalIncome - totalPaid)],
    ];

    // Keep the summary block from being split across a page break.
    if (y + 24 + summary.length * 26 > pageHeight - 60) {
      doc.addPage();
      y = 50;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text('Summary', margin, y);
    y += 10;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      body: summary,
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 6, lineColor: LINE, lineWidth: 0.5 },
      columnStyles: {
        0: { cellWidth: 220, halign: 'left', fontStyle: 'bold' },
        1: { cellWidth: 130, halign: 'right' },
      },
    });

    // Footer page numbers
    // getNumberOfPages() exists at runtime (it's how jsPDF's own docs show
    // multi-page footers) but is missing from the published .d.ts, same gap
    // as lastAutoTable above — cast through `any` rather than fighting the
    // types for a method that genuinely exists.
    const pageCount = (doc.internal as any).getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 20, { align: 'right' });
    }

    return doc;
  }

  private filename(mid: string, label: string): string {
    const safeLabel = (label || mid).trim().replace(/[^\w-]+/g, '_');
    return `Monthly_Spends_${safeLabel}.pdf`;
  }

  /**
   * Builds a well-aligned, single-month PDF and triggers a browser
   * download. (A native-share-panel-first version of this existed briefly
   * — Web Share API, so the OS share sheet could hand the file straight to
   * WhatsApp — but WhatsApp's Windows desktop app isn't a registered
   * system share target, so on Windows that panel just came back with its
   * own "we couldn't show you all the ways you could share" error before
   * falling back to this same download anyway. Going straight to the
   * download avoids that broken-looking extra step; the component pairs
   * it with a WhatsApp Web link so sending the file is still one click
   * away, just done by hand instead of through the OS share sheet.) */
  async exportMonthAndDownload(mid: string): Promise<void> {
    const m = this.data.spends()[mid];
    if (!m) return;
    const doc = await this.buildMonthDoc(mid, m);
    doc.save(this.filename(mid, m.label));
  }
}
