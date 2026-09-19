import { Component, ViewChild, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { Menu, MenuModule } from 'primeng/menu';
import { TableModule } from 'primeng/table';
import { MenuItem } from 'primeng/api';
import { DataService } from '../../services/data.service';
import { Loan, LOAN_CATEGORIES, LoanCategory, LoanStatus, STATUS_LABELS, hasFormalDocuments, allowedStatuses } from '../../models/loan.model';
import { DocumentKind, LoanDocument } from '../../models/document.model';
import { DocumentUploadComponent } from '../document-upload/document-upload.component';
import { categorySlug } from '../../models/category-colors';

interface CategoryGroup {
  category: LoanCategory;
  loans: Loan[];
  subtotal: number;
}

interface EditableLoan {
  name: string;
  category: LoanCategory;
  totalAmount: number;
  totalOutstanding: number | null;
  settledAmount: number | null;
  balance: number;
  emi: number | null;
  plannedEmiStartDate: string | null;
  emiTenureMonths: number | null;
  status: LoanStatus;
  progress: string;
  remarks: string;
}

@Component({
  selector: 'app-active-loans',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DocumentUploadComponent,
    ButtonModule,
    CardModule,
    TagModule,
    SelectModule,
    InputTextModule,
    InputNumberModule,
    MenuModule,
    TableModule,
  ],
  templateUrl: './active-loans.component.html',
  styleUrl: './active-loans.component.scss',
})
export class ActiveLoansComponent {
  catSlug(category: string): string {
    return categorySlug(category);
  }

  readonly categories = LOAN_CATEGORIES;
  readonly categoryOptions = LOAN_CATEGORIES.map((c) => ({ label: c, value: c }));
  readonly statusLabels = STATUS_LABELS;

  readonly editingId = signal<string | null>(null);
  readonly editForm = signal<EditableLoan | null>(null);
  readonly showAddForm = signal(false);
  readonly newLoan = signal<EditableLoan>(this.blankLoan());
  private readonly expandedRemarks = signal<ReadonlySet<string>>(new Set());
  private readonly expandedDocs = signal<ReadonlySet<string>>(new Set());

  /** Which category cards start open — the rest collapse behind their
   *  header (dot, name, count, subtotal) until clicked, so a long list of
   *  categories doesn't force scrolling past ones you don't need right now. */
  private readonly expandedCategories = signal<ReadonlySet<LoanCategory>>(new Set(['App Loans', 'Individual Loans']));

  isCategoryOpen(category: LoanCategory): boolean {
    return this.expandedCategories().has(category);
  }

  toggleCategory(category: LoanCategory): void {
    this.expandedCategories.update((set) => {
      const next = new Set(set);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  /** The row-actions menu (Edit / Mark closed / Delete). One shared PrimeNG
   *  Menu instance, popped open with items scoped to whichever row's kebab
   *  button was clicked — PrimeNG's overlay positions and clips itself
   *  correctly regardless of where in a scrolling table it opens. */
  @ViewChild('actionsMenu') actionsMenuRef?: Menu;
  readonly activeMenuItems = signal<MenuItem[]>([]);

  constructor(public data: DataService) {}

  readonly groups = computed<CategoryGroup[]>(() => {
    const loans = this.data.sortedLoans();
    return LOAN_CATEGORIES.map((category) => {
      const items = loans.filter((l) => l.category === category);
      const subtotal = items.reduce((s, l) => s + (Number(l.balance) || 0), 0);
      return { category, loans: items, subtotal };
    }).filter((g) => g.loans.length > 0);
  });

  private blankLoan(): EditableLoan {
    return {
      name: '',
      category: LOAN_CATEGORIES[0],
      totalAmount: 0,
      totalOutstanding: null,
      settledAmount: null,
      balance: 0,
      emi: null,
      plannedEmiStartDate: null,
      emiTenureMonths: null,
      status: 'active',
      progress: '',
      remarks: '',
    };
  }

  fmtMoney(n: number | null | undefined): string {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  }

  statusClass(status: LoanStatus): string {
    return status;
  }

  /** Whether this category's loans can carry a settlement-letter / NOC-copy upload. */
  catHasDocs(category: LoanCategory): boolean {
    return hasFormalDocuments(category);
  }

  /** A long remark forced the whole Remarks column to stretch (table auto-layout ignores max-width on <td>),
   *  which could push the row's Edit/Delete buttons out of view. Remarks now render in a fixed-width,
   *  truncating inner box with a toggle instead, so the column can never balloon. */
  remarksNeedsToggle(remarks: string | null | undefined): boolean {
    return !!remarks && remarks.length > 42;
  }

  isRemarksExpanded(id: string): boolean {
    return this.expandedRemarks().has(id);
  }

  toggleRemarks(id: string): void {
    this.expandedRemarks.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Status options this loan's category is allowed to be set to (informal categories drop "Settlement agreed"). */
  catStatuses(category: LoanCategory): LoanStatus[] {
    return allowedStatuses(category);
  }

  /** Same status list as catStatuses(), shaped as {label, value} pairs for p-select. */
  statusOptionsFor(category: LoanCategory): { label: string; value: LoanStatus }[] {
    return allowedStatuses(category).map((s) => ({ label: STATUS_LABELS[s], value: s }));
  }

  /** Small wrapper so the template can read a status label without indexing `statusLabels` directly on a
   *  p-table row var (PrimeNG's pTemplate row context is untyped, and TS won't allow indexing a Record with
   *  an `any` key in a template) — same lookup as before, just done here instead of inline. */
  statusLabel(loan: Loan): string {
    return this.statusLabels[loan.status];
  }

  /** Maps a loan status to a p-tag severity so the status pill keeps roughly the same meaning it had as a custom `.pill` (blue = active, amber = settlement/discussion, green = closed), using PrimeNG's own palette. */
  statusSeverity(status: LoanStatus): 'success' | 'info' | 'warn' {
    if (status === 'closed') return 'success';
    if (status === 'active') return 'info';
    return 'warn'; // settlement, discussion
  }

  /** Whether this loan already has a document attached — shown as a small dot on the collapsed Documents toggle so it's never hidden by the collapse. */
  hasAnyDoc(loan: Loan): boolean {
    return !!loan.settlementLetter || !!loan.nocCopy;
  }

  isDocsExpanded(id: string): boolean {
    return this.expandedDocs().has(id);
  }

  toggleDocs(id: string): void {
    this.expandedDocs.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Builds the Edit / Mark closed / Delete items for this row and pops the shared menu open at the clicked button. */
  openActionsMenu(loan: Loan, event: Event): void {
    this.activeMenuItems.set([
      { label: 'Edit', icon: 'pi pi-pencil', command: () => this.startEdit(loan) },
      { label: 'Mark closed', icon: 'pi pi-check-circle', command: () => this.markClosed(loan.id) },
      { label: 'Delete', icon: 'pi pi-trash', styleClass: 'danger-item', command: () => this.deleteLoan(loan.id) },
    ]);
    this.actionsMenuRef?.toggle(event);
  }

  /** Whether this loan has an explicit, user-entered tenure (the reliable source of truth). */
  private hasExplicitTenure(loan: Loan): boolean {
    return !!loan.emiTenureMonths && loan.emiTenureMonths > 0;
  }

  /**
   * EMI tenure in months. Uses the loan's own `emiTenureMonths` when it's
   * been entered directly (a chit's fixed term, or any loan whose real
   * repayment count is known) — that's the reliable number. Only when it's
   * missing do we fall back to a rough total-amount ÷ EMI estimate, which
   * can be wrong whenever the total repaid differs from the amount
   * financed (interest, chit dividends, processing fees, rounding).
   * Null when there's no EMI/amount to go on, or the loan is already closed.
   */
  effectiveTenureMonths(loan: Loan): number | null {
    if (loan.status === 'closed') return null;
    if (this.hasExplicitTenure(loan)) return Math.round(loan.emiTenureMonths as number);
    const emi = Number(loan.emi) || 0;
    const total = Number(loan.totalAmount) || 0;
    if (!emi || !total) return null;
    return Math.max(1, Math.ceil(total / emi));
  }

  /** The month the loan finishes, from its planned EMI start date plus its tenure. Null until a start date is set. */
  emiCompletionDate(loan: Loan): Date | null {
    const months = this.effectiveTenureMonths(loan);
    if (!months || !loan.plannedEmiStartDate) return null;
    const start = new Date(loan.plannedEmiStartDate + 'T00:00:00');
    if (isNaN(start.getTime())) return null;
    return new Date(start.getFullYear(), start.getMonth() + (months - 1), 1);
  }

  /** Short "18 mo · Feb 2028" style label shown under the EMI amount. Flags an unconfirmed (estimated) tenure so it's never mistaken for a fact. */
  emiPayoffLabel(loan: Loan): string {
    const months = this.effectiveTenureMonths(loan);
    if (!months) return '';
    const completion = this.emiCompletionDate(loan);
    const tenure = this.hasExplicitTenure(loan) ? `${months} mo` : `~${months} mo (est.)`;
    if (!completion) return `${tenure} · set start date`;
    return `${tenure} · done ${completion.toLocaleString('en-US', { month: 'short', year: 'numeric' })}`;
  }

  startEdit(loan: Loan): void {
    this.editingId.set(loan.id);
    this.editForm.set({
      name: loan.name,
      category: loan.category,
      totalAmount: loan.totalAmount,
      totalOutstanding: loan.totalOutstanding,
      settledAmount: loan.settledAmount,
      balance: loan.balance,
      emi: loan.emi,
      plannedEmiStartDate: loan.plannedEmiStartDate ?? null,
      emiTenureMonths: loan.emiTenureMonths ?? null,
      status: loan.status,
      progress: loan.progress,
      remarks: loan.remarks,
    });
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editForm.set(null);
  }

  saveEdit(id: string): void {
    const form = this.editForm();
    if (!form) return;
    this.data.updateLoan(id, { ...form });
    this.cancelEdit();
  }

  deleteLoan(id: string): void {
    if (confirm('Delete this loan? This cannot be undone.')) {
      this.data.deleteLoan(id);
    }
  }

  markClosed(id: string): void {
    if (confirm('Move this loan to Closed Loans?')) {
      this.data.moveLoanToClosed(id);
    }
  }

  onDocUploaded(loanId: string, kind: DocumentKind, doc: LoanDocument): void {
    this.data.attachLoanDocument(loanId, kind, doc);
  }

  toggleAddForm(): void {
    this.showAddForm.update((v) => !v);
    this.newLoan.set(this.blankLoan());
  }

  addLoan(): void {
    const form = this.newLoan();
    if (!form.name.trim()) return;
    this.data.addLoan({
      name: form.name.trim(),
      category: form.category,
      totalAmount: Number(form.totalAmount) || 0,
      totalOutstanding: null,
      settledAmount: null,
      balance: Number(form.balance) || 0,
      emi: form.emi === null || (form.emi as unknown) === '' ? null : Number(form.emi),
      plannedEmiStartDate: form.plannedEmiStartDate || null,
      emiTenureMonths: form.emiTenureMonths === null || (form.emiTenureMonths as unknown) === '' ? null : Number(form.emiTenureMonths),
      status: 'active',
      progress: '',
      remarks: '',
      order: this.data.loans().length,
    });
    this.showAddForm.set(false);
    this.newLoan.set(this.blankLoan());
  }
}
