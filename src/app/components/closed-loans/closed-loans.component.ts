import { Component, ViewChild, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { Menu, MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { DataService } from '../../services/data.service';
import { ClosedLoan, LOAN_CATEGORIES, LoanCategory, hasFormalDocuments } from '../../models/loan.model';
import { DocumentKind, LoanDocument } from '../../models/document.model';
import { DocumentUploadComponent } from '../document-upload/document-upload.component';
import { categorySlug } from '../../models/category-colors';

interface ClosedGroup {
  category: LoanCategory;
  loans: ClosedLoan[];
  paidTotal: number;
}

interface EditableClosed {
  name: string;
  category: LoanCategory;
  originalAmount: number;
  settledAmount: number;
  amountPaid: number;
  balanceRemaining: number;
  /** A real Date for the date-picker to bind to — converted to/from the
   *  model's plain "YYYY-MM-DD" string at the add/save boundary (see
   *  toIsoDate/fromIsoDate below). */
  datePaid: Date | null;
  source: string;
  remarks: string;
}

@Component({
  selector: 'app-closed-loans',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DocumentUploadComponent,
    ButtonModule,
    CardModule,
    TableModule,
    SelectModule,
    InputTextModule,
    InputNumberModule,
    MenuModule,
    DatePickerModule,
  ],
  templateUrl: './closed-loans.component.html',
  styleUrl: './closed-loans.component.scss',
})
export class ClosedLoansComponent {
  catSlug(category: string): string {
    return categorySlug(category);
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

  /** Whether this loan already has a document attached — shown as a small dot on the collapsed Documents toggle so it's never hidden by the collapse. */
  hasAnyDoc(loan: ClosedLoan): boolean {
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

  /** The row-actions menu (Edit / Delete). One shared PrimeNG Menu instance,
   *  popped open with items scoped to whichever row's kebab button was
   *  clicked — PrimeNG's overlay positions and clips itself correctly
   *  regardless of where in a scrolling table it opens. */
  @ViewChild('actionsMenu') actionsMenuRef?: Menu;
  readonly activeMenuItems = signal<MenuItem[]>([]);

  /** Builds the Edit / Delete items for this row and pops the shared menu open at the clicked button. */
  openActionsMenu(loan: ClosedLoan, event: Event): void {
    this.activeMenuItems.set([
      { label: 'Edit', icon: 'pi pi-pencil', command: () => this.startEdit(loan) },
      { label: 'Delete', icon: 'pi pi-trash', styleClass: 'danger-item', command: () => this.deleteClosed(loan.id) },
    ]);
    this.actionsMenuRef?.toggle(event);
  }

  readonly categories = LOAN_CATEGORIES;
  readonly categoryOptions = LOAN_CATEGORIES.map((c) => ({ label: c, value: c }));

  readonly editingId = signal<string | null>(null);
  readonly editForm = signal<EditableClosed | null>(null);
  readonly showAddForm = signal(false);
  readonly newClosed = signal<EditableClosed>(this.blank());
  private readonly expandedRemarks = signal<ReadonlySet<string>>(new Set());
  private readonly expandedDocs = signal<ReadonlySet<string>>(new Set());

  /** Which category cards start open — same accordion pattern as Active
   *  Loans, so a long record of settled categories doesn't force scrolling
   *  past ones you're not looking at right now. */
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

  constructor(public data: DataService) {}

  readonly groups = computed<ClosedGroup[]>(() => {
    const closed = this.data.sortedClosed();
    return LOAN_CATEGORIES.map((category) => {
      const loans = closed.filter((c) => c.category === category);
      const paidTotal = loans.reduce((s, c) => s + (Number(c.amountPaid) || 0), 0);
      return { category, loans, paidTotal };
    }).filter((g) => g.loans.length > 0);
  });

  private blank(): EditableClosed {
    return {
      name: '',
      category: LOAN_CATEGORIES[0],
      originalAmount: 0,
      settledAmount: 0,
      amountPaid: 0,
      balanceRemaining: 0,
      datePaid: null,
      source: 'Added in app',
      remarks: '',
    };
  }

  fmtMoney(n: number | null | undefined): string {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  }

  /** Date -> the model's plain "YYYY-MM-DD" string, using the picker's
   *  local-calendar date (not toISOString(), which can shift a day across
   *  UTC midnight depending on timezone). */
  private toIsoDate(d: Date | null): string | null {
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** The model's "YYYY-MM-DD" string -> a Date for the picker. Older records
   *  may hold freeform text here from before this had a real date picker —
   *  those can't be parsed back with any confidence, so this leaves the
   *  picker empty rather than guessing. */
  private fromIsoDate(s: string | null | undefined): Date | null {
    if (!s) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  startEdit(loan: ClosedLoan): void {
    this.editingId.set(loan.id);
    this.editForm.set({
      name: loan.name,
      category: loan.category,
      originalAmount: loan.originalAmount,
      settledAmount: loan.settledAmount,
      amountPaid: loan.amountPaid,
      balanceRemaining: loan.balanceRemaining,
      datePaid: this.fromIsoDate(loan.datePaid),
      source: loan.source,
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
    this.data.updateClosedLoan(id, { ...form, datePaid: this.toIsoDate(form.datePaid) });
    this.cancelEdit();
  }

  deleteClosed(id: string): void {
    if (confirm('Delete this record? This cannot be undone.')) {
      this.data.deleteClosedLoan(id);
    }
  }

  onDocUploaded(loanId: string, kind: DocumentKind, doc: LoanDocument): void {
    this.data.attachClosedDocument(loanId, kind, doc);
  }

  toggleAddForm(): void {
    this.showAddForm.update((v) => !v);
    this.newClosed.set(this.blank());
  }

  addClosed(): void {
    const form = this.newClosed();
    if (!form.name.trim()) return;
    const paid = Number(form.amountPaid) || 0;
    this.data.addClosedLoan({
      name: form.name.trim(),
      category: form.category,
      originalAmount: Number(form.originalAmount) || 0,
      settledAmount: paid,
      amountPaid: paid,
      balanceRemaining: 0,
      datePaid: this.toIsoDate(form.datePaid),
      source: 'Added in app',
      remarks: '',
      order: this.data.closed().length,
    });
    this.showAddForm.set(false);
    this.newClosed.set(this.blank());
  }
}
