import { Injectable } from '@angular/core';
// Type-only import — erased at compile time, so it costs nothing in the
// initial bundle. The real ExcelJS module (a sizeable CommonJS library) is
// loaded via a dynamic import() inside buildWorkbook() below, so it only
// ships as its own lazy chunk, fetched on demand when the user actually
// clicks "Export to Excel" — not bundled into everyone's first page load.
import type ExcelJS from 'exceljs';
import { LOAN_CATEGORIES, STATUS_LABELS } from '../models/loan.model';
import { DataService } from './data.service';

/** Indian-style digit grouping (1,00,000 instead of 100,000) with a ₹ prefix,
 *  matching the app's own `fmtMoney()` (`Intl.NumberFormat('en-IN', ...)`) so
 *  the exported numbers read the same way the app displays them on screen. */
const CURRENCY_FMT = '"₹"#,##,##0';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE7FB' } };
const GROUP_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3566D6' } };
const SUBTOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FF102F70' } };
const GROUP_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 14, color: { argb: 'FF102F70' } };
const THIN_BOTTOM: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFD9DEE8' } };

@Injectable({ providedIn: 'root' })
export class ExcelService {
  constructor(private data: DataService) {}

  private titleRow(ws: ExcelJS.Worksheet, text: string, span: number): void {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, span);
    row.getCell(1).font = TITLE_FONT;
    row.getCell(1).alignment = { vertical: 'middle' };
    row.height = 22;
  }

  private headerRow(ws: ExcelJS.Worksheet, headers: string[]): ExcelJS.Row {
    const row = ws.addRow(headers);
    row.eachCell((cell) => {
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.border = { bottom: THIN_BOTTOM };
      cell.alignment = { vertical: 'middle' };
    });
    row.height = 18;
    return row;
  }

  /** A shaded, bold band spanning every column — visually separates one
   *  loan category's rows from the next, the way the app's own grouped
   *  cards do on the Active/Closed Loans pages. */
  private groupBandRow(ws: ExcelJS.Worksheet, label: string, span: number): void {
    const row = ws.addRow([label]);
    ws.mergeCells(row.number, 1, row.number, span);
    row.getCell(1).font = GROUP_FONT;
    row.getCell(1).fill = GROUP_FILL;
    row.getCell(1).alignment = { vertical: 'middle', indent: 1 };
    row.height = 19;
  }

  private subtotalRow(ws: ExcelJS.Worksheet, cells: (string | number)[], moneyCols: number[]): void {
    const row = ws.addRow(cells);
    row.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = SUBTOTAL_FILL;
      cell.border = { top: THIN_BOTTOM };
    });
    moneyCols.forEach((c) => (row.getCell(c).numFmt = CURRENCY_FMT));
  }

  private moneyCell(row: ExcelJS.Row, col: number, value: number | null | undefined): void {
    const cell = row.getCell(col);
    if (value === null || value === undefined || value === 0) {
      // Zero/blank amounts (e.g. no EMI set) are left empty rather than
      // shown as "₹0" — a blank cell is unambiguous, whereas a zero could
      // be misread as "confirmed zero" for something that's simply unset.
      cell.value = value === 0 ? 0 : '';
    } else {
      cell.value = value;
    }
    cell.numFmt = CURRENCY_FMT;
  }

  private buildActiveLoansSheet(wb: ExcelJS.Workbook): void {
    const ws = wb.addWorksheet('Active Loans', { views: [{ state: 'frozen', ySplit: 2 }] });
    const cols = [
      { width: 26 }, // Loan / Lender
      { width: 15 }, // Total Amount
      { width: 15 }, // Balance Due Now
      { width: 13 }, // Monthly EMI
      { width: 18 }, // Status
      { width: 30 }, // Progress / Notes
      { width: 36 }, // Remarks
    ];
    ws.columns = cols as ExcelJS.Column[];

    this.titleRow(ws, 'Active Loans — everything still outstanding', 7);
    this.headerRow(ws, ['Loan / Lender', 'Total Amount', 'Balance Due Now', 'Monthly EMI', 'Status', 'Progress / Notes', 'Remarks']);

    const loans = this.data.sortedLoans();
    let anyGroup = false;
    LOAN_CATEGORIES.forEach((cat) => {
      const items = loans.filter((l) => l.category === cat);
      if (!items.length) return;
      anyGroup = true;
      this.groupBandRow(ws, `${cat}  (${items.length} loan${items.length === 1 ? '' : 's'})`, 7);
      items.forEach((l) => {
        const row = ws.addRow([l.name, null, null, null, STATUS_LABELS[l.status] || l.status, l.progress || '', l.remarks || '']);
        this.moneyCell(row, 2, l.totalAmount);
        this.moneyCell(row, 3, l.balance);
        this.moneyCell(row, 4, l.emi);
      });
      const subtotal = items.reduce((s, l) => s + (Number(l.balance) || 0), 0);
      this.subtotalRow(ws, [`${cat} — subtotal`, '', subtotal, '', '', '', ''], [3]);
    });
    if (!anyGroup) ws.addRow(['No active loans yet.']);
  }

  private buildClosedLoansSheet(wb: ExcelJS.Workbook): void {
    const ws = wb.addWorksheet('Closed Loans', { views: [{ state: 'frozen', ySplit: 2 }] });
    ws.columns = [
      { width: 26 }, // Loan / Lender
      { width: 15 }, // Original Amount
      { width: 15 }, // Settled Amount
      { width: 14 }, // Amount Paid
      { width: 15 }, // Savings
      { width: 13 }, // Date Paid
      { width: 22 }, // Source
      { width: 36 }, // Remarks
    ] as ExcelJS.Column[];

    this.titleRow(ws, 'Closed Loans — fully settled, kept for your records', 8);
    this.headerRow(ws, ['Loan / Lender', 'Original Amount', 'Settled Amount', 'Amount Paid', 'Savings', 'Date Paid', 'Source', 'Remarks']);

    const closed = this.data.sortedClosed();
    let anyGroup = false;
    LOAN_CATEGORIES.forEach((cat) => {
      const items = closed.filter((c) => c.category === cat);
      if (!items.length) return;
      anyGroup = true;
      this.groupBandRow(ws, `${cat}  (${items.length} loan${items.length === 1 ? '' : 's'})`, 8);
      items.forEach((c) => {
        const row = ws.addRow([c.name, null, null, null, null, c.datePaid || '', c.source || '', c.remarks || '']);
        this.moneyCell(row, 2, c.originalAmount);
        this.moneyCell(row, 3, c.settledAmount);
        this.moneyCell(row, 4, c.amountPaid);
        this.moneyCell(row, 5, c.originalAmount - c.settledAmount);
      });
    });
    if (!anyGroup) ws.addRow(['No closed loans yet.']);
  }

  private buildMonthSheet(wb: ExcelJS.Workbook, mid: string, m: { label: string; entries: any[]; incomes: any[] }): void {
    const sheetName = (m.label || mid).slice(0, 31).replace(/[\\/*?:[\]]/g, ' ');
    const ws = wb.addWorksheet(sheetName);
    ws.columns = [{ width: 28 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 34 }] as ExcelJS.Column[];

    this.titleRow(ws, `Monthly Spends — ${m.label}`, 5);
    ws.addRow([]);

    this.headerRow(ws, ['Item', 'Type', 'Amount', 'Paid Amount', 'Date / Remark']);
    const entries = m.entries || [];
    entries.forEach((e) => {
      const row = ws.addRow([e.name, e.type === 'settlement' ? 'Settlement' : 'Expense', null, null, [e.date, e.remarks].filter(Boolean).join(' — ')]);
      this.moneyCell(row, 3, e.amount);
      if (e.paidAmount !== null && e.paidAmount !== undefined) {
        this.moneyCell(row, 4, e.paidAmount);
      }
    });
    const totalAmt = entries.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
    const totalPaid = entries.reduce((s: number, e: any) => s + (Number(e.paidAmount) || 0), 0);
    this.subtotalRow(ws, ['Total', '', totalAmt, totalPaid, ''], [3, 4]);

    ws.addRow([]);
    ws.addRow([]);
    this.headerRow(ws, ['Income source', '', 'Amount', '', '']);
    const incomes = m.incomes || [];
    incomes.forEach((inc) => {
      const row = ws.addRow([inc.label, '', null, '', '']);
      this.moneyCell(row, 3, inc.amount);
    });
    const totalIncome = incomes.reduce((s: number, inc: any) => s + (Number(inc.amount) || 0), 0);
    this.subtotalRow(ws, ['Total income', '', totalIncome, '', ''], [3]);

    // A quick at-a-glance summary at the bottom, mirroring the same stats
    // shown on the Monthly Spends page in the app.
    ws.addRow([]);
    const balance = totalAmt - totalPaid;
    const postPlannedBalance = totalIncome - totalAmt;
    const bankBalance = totalIncome - totalPaid;
    this.headerRow(ws, ['Summary', '', '', '', '']);
    const summaryRows: [string, number][] = [
      ['Total income', totalIncome],
      ['Planned amount', totalAmt],
      ['Paid from planned', totalPaid],
      ['Balance (unpaid plan)', balance],
      ['Balance post all planned', postPlannedBalance],
      ['Current bank balance', bankBalance],
    ];
    summaryRows.forEach(([label, value]) => {
      const row = ws.addRow([label, '', null, '', '']);
      row.getCell(1).font = { bold: true };
      this.moneyCell(row, 3, value);
    });
  }

  private buildSummarySheet(wb: ExcelJS.Workbook): void {
    const ws = wb.addWorksheet('Summary');
    ws.columns = [{ width: 34 }, { width: 18 }] as ExcelJS.Column[];

    this.titleRow(ws, 'CrediTrack — Summary', 2);
    const genRow = ws.addRow(['Generated', new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })]);
    genRow.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } };
    genRow.getCell(2).font = { italic: true, color: { argb: 'FF6B7280' } };
    ws.addRow([]);

    const statRows: [string, number][] = [
      ['Active loans (count)', this.data.sortedLoans().length],
      ['Closed loans (count)', this.data.sortedClosed().length],
    ];
    statRows.forEach(([label, value]) => {
      const row = ws.addRow([label, value]);
      row.getCell(1).font = { bold: true };
    });

    const moneyStatRows: [string, number][] = [
      ['Total active balance', this.data.totalActiveBalance()],
      ['Total closed / paid off (total saved)', this.data.totalClosedPaid()],
      ['Total EMI per month', this.data.totalEmiPerMonth()],
    ];
    moneyStatRows.forEach(([label, value]) => {
      const row = ws.addRow([label, null]);
      row.getCell(1).font = { bold: true };
      this.moneyCell(row, 2, value);
    });

    ws.addRow([]);
    this.headerRow(ws, ['Category', 'Balance due now']);
    const totals = this.data.categoryTotals();
    LOAN_CATEGORIES.forEach((c) => {
      const row = ws.addRow([c, null]);
      this.moneyCell(row, 2, totals[c] || 0);
    });
  }

  private async buildWorkbook(): Promise<ExcelJS.Workbook> {
    const { default: ExcelJSRuntime } = await import('exceljs');
    const wb = new ExcelJSRuntime.Workbook();
    wb.creator = 'CrediTrack';
    wb.created = new Date();

    this.buildSummarySheet(wb);
    this.buildActiveLoansSheet(wb);
    this.buildClosedLoansSheet(wb);

    const spends = this.data.spends();
    Object.keys(spends)
      .sort()
      .forEach((mid) => this.buildMonthSheet(wb, mid, spends[mid]));

    return wb;
  }

  private filename(): string {
    return `CrediTrack_${new Date().toISOString().slice(0, 10)}.xlsx`;
  }

  /** Builds the workbook and triggers a browser download. */
  async exportAndDownload(): Promise<void> {
    const wb = await this.buildWorkbook();
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.filename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Builds the same workbook as a Blob, for uploading to Drive without a browser download. */
  async buildWorkbookBlob(): Promise<Blob> {
    const wb = await this.buildWorkbook();
    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  getFilename(): string {
    return this.filename();
  }
}
