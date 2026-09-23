import { Component, computed, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { DataService } from '../../services/data.service';
import { PdfService } from '../../services/pdf.service';
import { SpendEntry, SpendType } from '../../models/spend.model';

interface NewEntryForm {
  name: string;
  type: SpendType;
  amount: number;
  paidAmount: number | null;
  /** A real Date for the date-picker to bind to — converted to/from the
   *  model's plain "YYYY-MM-DD" string at the add/save boundary (see
   *  toIsoDate/fromIsoDate below). Kept separate from `remarks` now instead
   *  of the old single freeform "Date / remark" text field. */
  date: Date | null;
  remarks: string;
}

interface NewIncomeForm {
  label: string;
  amount: number;
}

@Component({
    selector: 'app-monthly-spends',
    imports: [
    FormsModule,
    ButtonModule,
    CardModule,
    TableModule,
    TagModule,
    MessageModule,
    SelectModule,
    InputTextModule,
    InputNumberModule,
    DatePickerModule
],
    templateUrl: './monthly-spends.component.html',
    styleUrl: './monthly-spends.component.scss'
})
export class MonthlySpendsComponent {
  readonly selectedMonth = signal<string | null>(null);
  readonly showAddEntry = signal(false);
  readonly showAddMonth = signal(false);
  readonly newMonthKey = signal('');
  readonly newMonthLabel = signal('');
  readonly newEntry = signal<NewEntryForm>(this.blankEntry());
  readonly newIncome = signal<NewIncomeForm>({ label: '', amount: 0 });
  readonly editingIndex = signal<number | null>(null);
  readonly editEntry = signal<NewEntryForm>(this.blankEntry());
  readonly cloneError = signal<string | null>(null);
  readonly cloning = signal(false);
  readonly exportingPdf = signal(false);
  readonly pdfExportMessage = signal<string | null>(null);

  constructor(public data: DataService, private pdf: PdfService) {
    const keys = this.data.monthKeys();
    if (keys.length) {
      this.selectedMonth.set(keys[keys.length - 1]);
    }
  }

  readonly monthKeys = computed(() => this.data.monthKeys());

  readonly currentMonth = computed(() => {
    const key = this.selectedMonth() ?? (this.monthKeys().length ? this.monthKeys()[this.monthKeys().length - 1] : null);
    if (!key) return null;
    const m = this.data.spends()[key];
    if (!m) return null;
    return { key, ...m };
  });

  readonly stats = computed(() => {
    const m = this.currentMonth();
    if (!m) return { totalAmt: 0, totalPaid: 0, income: 0, balance: 0, postPlannedBalance: 0, bankBalance: 0 };
    const totalAmt = m.entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const totalPaid = m.entries.reduce((s, e) => s + (Number(e.paidAmount) || 0), 0);
    const income = this.data.monthIncomeTotal(m.key);
    return {
      totalAmt,
      totalPaid,
      income,
      // How much of the planned spend is still unpaid.
      balance: totalAmt - totalPaid,
      // If every planned expense were paid off, this is what would be left of this month's income.
      postPlannedBalance: income - totalAmt,
      // What's actually still in the bank right now — income minus only what's actually been paid so far
      // (unpaid planned amounts haven't left the bank yet, so they don't reduce this).
      bankBalance: income - totalPaid,
    };
  });

  /** The calendar month right after the one currently selected, as a "YYYY-MM" key. */
  readonly nextMonthKey = computed(() => {
    const m = this.currentMonth();
    if (!m) return null;
    const match = /^(\d{4})-(\d{2})$/.exec(m.key);
    if (!match) return null;
    const d = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    d.setMonth(d.getMonth() + 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  });

  readonly entryTypeOptions: { label: string; value: SpendType }[] = [
    { label: 'Expense', value: 'expense' },
    { label: 'Settlement', value: 'settlement' },
  ];

  private blankEntry(): NewEntryForm {
    return { name: '', type: 'expense', amount: 0, paidAmount: null, date: null, remarks: '' };
  }

  /** Date -> the model's plain "YYYY-MM-DD" string, using the picker's
   *  local-calendar date (not toISOString(), which can shift a day across
   *  UTC midnight depending on timezone). */
  private toIsoDate(d: Date | null): string {
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** The model's "YYYY-MM-DD" string -> a Date for the picker. Entries
   *  created before this field had a real date picker may hold freeform
   *  text here instead (the old UI let you type anything into a combined
   *  "Date / remark" box) — those can't be parsed back into a date with any
   *  confidence, so this leaves the picker empty rather than guessing. */
  private fromIsoDate(s: string | null | undefined): Date | null {
    if (!s) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  fmtMoney(n: number | null | undefined): string {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  }

  selectMonth(key: string): void {
    this.selectedMonth.set(key);
    this.editingIndex.set(null);
  }

  findMatch(entry: SpendEntry) {
    if (entry.applied) return null;
    return this.data.findLoanByName(entry.name);
  }

  apply(index: number, loanId: string): void {
    const key = this.currentMonth()?.key;
    if (!key) return;
    this.data.applyEntryToLoan(key, index, loanId);
  }

  deleteEntry(index: number): void {
    const key = this.currentMonth()?.key;
    if (!key) return;
    if (this.editingIndex() === index) this.editingIndex.set(null);
    this.data.deleteSpendEntry(key, index);
  }

  startEdit(index: number, entry: SpendEntry): void {
    this.showAddEntry.set(false);
    this.editingIndex.set(index);
    this.editEntry.set({
      name: entry.name,
      type: entry.type,
      amount: entry.amount,
      paidAmount: entry.paidAmount,
      date: this.fromIsoDate(entry.date),
      remarks: entry.remarks,
    });
  }

  cancelEdit(): void {
    this.editingIndex.set(null);
  }

  saveEdit(): void {
    const key = this.currentMonth()?.key;
    const index = this.editingIndex();
    if (!key || index === null) return;
    const form = this.editEntry();
    if (!form.name.trim()) return;
    this.data.updateSpendEntry(key, index, {
      name: form.name.trim(),
      type: form.type,
      amount: Number(form.amount) || 0,
      paidAmount: form.paidAmount === null || (form.paidAmount as unknown) === '' ? null : Number(form.paidAmount),
      date: this.toIsoDate(form.date),
      remarks: form.remarks.trim(),
    });
    this.editingIndex.set(null);
  }

  addIncomeRow(): void {
    const key = this.currentMonth()?.key;
    const form = this.newIncome();
    if (!key || !form.label.trim()) return;
    this.data.addIncome(key, form.label.trim(), Number(form.amount) || 0);
    this.newIncome.set({ label: '', amount: 0 });
  }

  updateIncomeAmount(incomeId: string, amount: number): void {
    const key = this.currentMonth()?.key;
    if (!key) return;
    this.data.updateIncome(key, incomeId, { amount: Number(amount) || 0 });
  }

  updateIncomeLabel(incomeId: string, label: string): void {
    const key = this.currentMonth()?.key;
    if (!key) return;
    this.data.updateIncome(key, incomeId, { label });
  }

  deleteIncomeRow(incomeId: string): void {
    const key = this.currentMonth()?.key;
    if (!key) return;
    this.data.deleteIncome(key, incomeId);
  }

  toggleAddMonth(): void {
    this.showAddMonth.update((v) => !v);
    this.newMonthKey.set(this.data.currentMonthId());
    this.newMonthLabel.set('');
  }

  addMonth(): void {
    const key = this.newMonthKey().trim() || this.data.currentMonthId();
    const label = this.newMonthLabel().trim() || key;
    this.data.saveMonth(key, { label, incomes: [], entries: [] });
    this.selectedMonth.set(key);
    this.showAddMonth.set(false);
  }

  cloneToNextMonth(): void {
    const from = this.currentMonth()?.key;
    const to = this.nextMonthKey();
    if (!from || !to) return;
    this.cloneError.set(null);
    if (this.data.spends()[to]) {
      this.cloneError.set(`${to} already has data — pick a different month or edit it directly.`);
      return;
    }
    const ok = confirm(
      `Copy this month's recurring expenses and income into a new month (${to})? Settlement entries won't be copied, and paid/applied status resets.`
    );
    if (!ok) return;
    this.cloning.set(true);
    this.data.cloneMonth(from, to);
    // Fire-and-forget sync: switch to the new month right away. If the
    // clone is rejected by the server (e.g. 409 — month already has data),
    // DataService rolls the optimistic copy back and surfaces the reason
    // via `syncError`, which the sidebar shows as a banner.
    this.selectedMonth.set(to);
    this.cloning.set(false);
  }

  async exportPdf(): Promise<void> {
    const key = this.currentMonth()?.key;
    if (!key || this.exportingPdf()) return;
    this.exportingPdf.set(true);
    this.pdfExportMessage.set(null);
    try {
      // Straight to a plain download — no native-share-panel attempt first.
      // That path reliably failed for WhatsApp on Windows desktop (WhatsApp's
      // Windows app isn't a registered system share target, so the OS panel
      // had nothing to offer and just showed its own error), so it's not
      // worth the extra step and a broken-looking dialog flashing up first.
      // A straightforward download plus a WhatsApp Web link to finish the
      // job by hand is the reliable path on this setup.
      await this.pdf.exportMonthAndDownload(key);
      this.pdfExportMessage.set('Saved to your downloads folder.');
    } finally {
      this.exportingPdf.set(false);
    }
  }

  toggleAddEntry(): void {
    this.showAddEntry.update((v) => !v);
    this.newEntry.set(this.blankEntry());
    this.editingIndex.set(null);
  }

  addEntry(): void {
    const key = this.currentMonth()?.key;
    if (!key) return;
    const form = this.newEntry();
    if (!form.name.trim()) return;
    const entry: SpendEntry = {
      name: form.name.trim(),
      date: this.toIsoDate(form.date),
      amount: Number(form.amount) || 0,
      paidAmount: form.paidAmount === null || (form.paidAmount as unknown) === '' ? null : Number(form.paidAmount),
      type: form.type,
      remarks: form.remarks.trim(),
      applied: false,
    };
    this.data.addSpendEntry(key, entry);
    this.showAddEntry.set(false);
    this.newEntry.set(this.blankEntry());
  }
}
