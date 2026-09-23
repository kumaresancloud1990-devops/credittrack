import { Injectable, computed, effect, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Loan, LoanCategory, LOAN_CATEGORIES, ClosedLoan, hasFormalDocuments } from '../models/loan.model';
import { AppMeta, Income, SpendEntry, SpendMonth } from '../models/spend.model';
import { DocumentKind, LoanDocument } from '../models/document.model';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

interface StateResponse {
  loans: Loan[];
  closed: ClosedLoan[];
  spends: Record<string, SpendMonth>;
  meta: AppMeta;
}

/** A SpendEntry, plus the id the backend uses to address it. The public
 * SpendEntry model has no `id` field (components address entries by array
 * index, as before) — this is an internal-only shape. */
type EntryRow = SpendEntry & { id: string };

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function slugify(name: string, prefix: string): string {
  const s = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return prefix + s;
}

function tempId(): string {
  return 'tmp-' + uid();
}

function isTempId(id: string | undefined | null): boolean {
  return !!id && id.startsWith('tmp-');
}

/**
 * Talks to the backend API (see server/) instead of localStorage.
 *
 * Pattern used throughout: every mutating method updates the local signal
 * synchronously first (so call sites and templates stay exactly as
 * responsive as before), then fires the matching HTTP request in the
 * background. On success the local state is reconciled with the server's
 * authoritative response (mainly to pick up server-generated ids). On
 * failure the error is logged to the console and surfaced via `syncError`
 * for the UI to show as a banner.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly _loans = signal<Loan[]>([]);
  private readonly _closed = signal<ClosedLoan[]>([]);
  private readonly _spends = signal<Record<string, SpendMonth>>({});
  private readonly _meta = signal<AppMeta>({ familyLabel: '', currency: 'INR' });
  private readonly _ready = signal<boolean>(false);
  private readonly _syncError = signal<string | null>(null);

  readonly loans = this._loans.asReadonly();
  readonly closed = this._closed.asReadonly();
  readonly spends = this._spends.asReadonly();
  readonly meta = this._meta.asReadonly();
  readonly ready = this._ready.asReadonly();
  /** Human-readable message when the last sync with the backend failed. Null when everything is fine. */
  readonly syncError = this._syncError.asReadonly();

  private readonly apiBase = environment.apiBaseUrl;
  private loadingState = false;

  /** Loans sorted by their `order` field, category groupings applied by callers. */
  readonly sortedLoans = computed(() => [...this._loans()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
  readonly sortedClosed = computed(() => [...this._closed()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));

  readonly totalActiveBalance = computed(() => this._loans().reduce((s, l) => s + (Number(l.balance) || 0), 0));
  /** Same idea as totalActiveBalance, but built from effectiveOutstanding()
   *  instead of the "Balance" field — this is what the Dashboard's totals
   *  and charts use, so they auto-tick down with the EMI schedule the same
   *  way Active Loans' own "Outstanding" column does, instead of only
   *  moving when you manually apply a Monthly Spends payment. */
  readonly totalActiveOutstanding = computed(() => this._loans().reduce((s, l) => s + this.effectiveOutstanding(l), 0));
  readonly totalClosedPaid = computed(() => this._closed().reduce((s, c) => s + (Number(c.amountPaid) || 0), 0));
  readonly totalEmiPerMonth = computed(() => this._loans().reduce((s, l) => s + (Number(l.emi) || 0), 0));
  readonly totalFamilyCredit = computed(() =>
    this._loans()
      .filter((l) => l.category === 'Family Credit Funds / Other')
      .reduce((s, l) => s + (Number(l.balance) || 0), 0)
  );
  readonly categoryTotals = computed(() => {
    const m: Record<string, number> = {};
    LOAN_CATEGORIES.forEach((c) => (m[c] = 0));
    this._loans().forEach((l) => {
      m[l.category] = (m[l.category] || 0) + this.effectiveOutstanding(l);
    });
    return m as Record<LoanCategory, number>;
  });

  /** Closed loans whose category carries formal paperwork (Bank/App/Credit
   *  Card loans — the informal categories like Individual/Magalir/Family
   *  never had a settlement letter or NOC to begin with, so they're left
   *  out here entirely). Used to scope the Dashboard's document-status card
   *  to loans that could actually have something pending. */
  readonly closedFormalDocsLoans = computed(() => this.sortedClosed().filter((c) => hasFormalDocuments(c.category)));

  /** Of those, the ones still missing at least one of the two documents
   *  (Settlement Letter or NOC Copy) — a partial upload still counts as
   *  pending, since the loan's paperwork isn't complete until both are on
   *  file. Surfaced on the Dashboard so a closed loan's documents don't get
   *  forgotten once it's off the Active Loans list. */
  readonly closedDocsPending = computed(() =>
    this.closedFormalDocsLoans().filter((c) => !c.settlementLetter || !c.nocCopy)
  );

  /** Whether this loan has an explicit, user-entered EMI tenure (the
   *  reliable source of truth) rather than a rough total÷EMI estimate. */
  hasExplicitTenure(loan: Loan): boolean {
    return !!loan.emiTenureMonths && loan.emiTenureMonths > 0;
  }

  /**
   * EMI tenure in months. Uses the loan's own `emiTenureMonths` when it's
   * been entered directly (a chit's fixed term, or any loan whose real
   * repayment count is known) — that's the reliable number. Only when it's
   * missing do we fall back to a rough total-amount ÷ EMI estimate, which
   * can be wrong whenever the total repaid differs from the amount
   * financed (interest, chit dividends, processing fees, rounding). Null
   * when there's no EMI/amount to go on, or the loan is already closed.
   * Shared here (not just on the Active Loans page) so every screen that
   * projects an EMI schedule agrees on the same number.
   */
  effectiveTenureMonths(loan: Loan): number | null {
    if (loan.status === 'closed') return null;
    if (this.hasExplicitTenure(loan)) return Math.round(loan.emiTenureMonths as number);
    const emi = Number(loan.emi) || 0;
    const total = Number(loan.totalAmount) || 0;
    if (!emi || !total) return null;
    return Math.max(1, Math.ceil(total / emi));
  }

  /** Whole months elapsed from `startDate` to today — a month only counts
   *  once its EMI due date (the same day-of-month as the start date) has
   *  actually passed, not the moment the calendar month ticks over. */
  private monthsElapsedSince(startDate: string): number {
    const start = new Date(startDate + 'T00:00:00');
    if (isNaN(start.getTime())) return 0;
    const now = new Date();
    let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    if (now.getDate() < start.getDate()) months -= 1;
    return Math.max(0, months);
  }

  /**
   * Outstanding balance for one loan: Total amount − (months elapsed since
   * the planned EMI start date × EMI), assuming EMIs land on schedule —
   * ticks down on its own as time passes, floored at 0 and capped once the
   * full tenure has elapsed. Falls back to the manually-entered
   * `totalOutstanding` field, then to `balance`, whenever there's no EMI +
   * start date to compute a schedule from (e.g. a loan with no fixed EMI at
   * all) — so this always returns a real number, never null, and every
   * screen that sums it (Dashboard) or shows it per-row (Active Loans)
   * agrees. This is a separate figure from `balance`, which only moves when
   * a Monthly Spends payment is actually linked to the loan.
   */
  effectiveOutstanding(loan: Loan): number {
    if (loan.plannedEmiStartDate && loan.emi) {
      const elapsed = this.monthsElapsedSince(loan.plannedEmiStartDate);
      const tenure = this.effectiveTenureMonths(loan);
      const monthsPaid = tenure ? Math.min(elapsed, tenure) : elapsed;
      const outstanding = (Number(loan.totalAmount) || 0) - monthsPaid * (Number(loan.emi) || 0);
      return Math.max(0, outstanding);
    }
    if (loan.totalOutstanding !== null && loan.totalOutstanding !== undefined) return Number(loan.totalOutstanding) || 0;
    return Number(loan.balance) || 0;
  }

  /** How many EMI installments have actually come due so far, and how many
   *  are still ahead — projected purely from the loan's own start date and
   *  tenure, the same schedule effectiveOutstanding() already uses. Null
   *  once there's no live schedule to project (no EMI, no start date, no
   *  tenure, or the loan is closed), so the caller can fall back to a plain
   *  tenure label instead. */
  pendingEmiInstallments(loan: Loan): { paid: number; pending: number; tenure: number } | null {
    if (loan.status === 'closed') return null;
    if (!loan.plannedEmiStartDate || !loan.emi) return null;
    const tenure = this.effectiveTenureMonths(loan);
    if (!tenure) return null;
    const elapsed = this.monthsElapsedSince(loan.plannedEmiStartDate);
    const paid = Math.min(elapsed, tenure);
    return { paid, pending: Math.max(0, tenure - paid), tenure };
  }

  /** The due date of the most recent EMI installment actually paid so far
   *  — the Nth paid installment's own due date is `start + N months`
   *  (matching how monthsElapsedSince itself counts a month as elapsed only
   *  once its due date has passed), not `start + (N-1) months`. Null when
   *  nothing has been paid yet, or there's no live schedule to project from. */
  lastPaidEmiDate(loan: Loan): Date | null {
    if (loan.status === 'closed') return null;
    if (!loan.plannedEmiStartDate || !loan.emi) return null;
    const tenure = this.effectiveTenureMonths(loan);
    if (!tenure) return null;
    const elapsed = this.monthsElapsedSince(loan.plannedEmiStartDate);
    const paid = Math.min(elapsed, tenure);
    if (paid < 1) return null;
    const start = new Date(loan.plannedEmiStartDate + 'T00:00:00');
    if (isNaN(start.getTime())) return null;
    return new Date(start.getFullYear(), start.getMonth() + paid, start.getDate());
  }

  /** Whether a loan's planned EMI schedule has actually begun by the given
   *  "YYYY-MM" month — a loan with no start date yet is treated as already
   *  started (nothing to gate on), so it isn't silently skipped. Used to
   *  keep ensureCurrentMonthEmiEntries from auto-adding an EMI entry for a
   *  loan whose first installment hasn't come due yet. */
  private hasEmiStartedByMonth(loan: Loan, monthId: string): boolean {
    if (!loan.plannedEmiStartDate) return true;
    return loan.plannedEmiStartDate.slice(0, 7) <= monthId;
  }

  readonly monthKeys = computed(() => Object.keys(this._spends()).sort());

  readonly lastLoggedMonth = computed<string | null>(() => {
    const keys = this.monthKeys();
    if (!keys.length) return null;
    const cur = this.currentMonthId();
    const prior = keys.filter((k) => k < cur);
    return prior.length ? prior[prior.length - 1] : keys[keys.length - 1];
  });

  /** Count of active (non-closed) loans that carry a monthly EMI. */
  readonly pendingEmiCount = computed(
    () => this._loans().filter((l) => l.status !== 'closed' && Number(l.emi) > 0).length
  );

  readonly totalClosedOriginal = computed(() => this._closed().reduce((s, c) => s + (Number(c.originalAmount) || 0), 0));
  readonly totalClosedSettled = computed(() => this._closed().reduce((s, c) => s + (Number(c.settledAmount) || 0), 0));
  /** What settling for less than the original amount has saved the family, in total. */
  readonly totalSavings = computed(() => this.totalClosedOriginal() - this.totalClosedSettled());

  readonly currentMonthKey = computed(() => this.currentMonthId());
  readonly previousMonthKey = computed(() => this.shiftMonthKey(this.currentMonthKey(), -1));

  /**
   * A short, actionable list of "what to tackle next" suggestions to help
   * reduce overall borrowing faster — computed from the current loan data,
   * not stored anywhere. Kept to at most 3 items so it stays a quick glance,
   * not another table.
   */
  readonly payoffSuggestions = computed(() => {
    const active = this._loans().filter((l) => l.status !== 'closed');
    type Suggestion = { id: string; kind: 'quick-win' | 'relief' | 'attention'; title: string; detail: string };
    const out: Suggestion[] = [];

    // 1) Quick win — smallest remaining outstanding, closest to being fully paid off.
    const byBalance = active
      .map((l) => ({ l, outstanding: this.effectiveOutstanding(l) }))
      .filter((x) => x.outstanding > 0)
      .sort((a, b) => a.outstanding - b.outstanding);
    if (byBalance.length) {
      const { l, outstanding } = byBalance[0];
      out.push({
        id: l.id,
        kind: 'quick-win',
        title: `Close out "${l.name}" next`,
        detail: `Only ${this.fmtShort(outstanding)} left — the smallest outstanding balance of your ${active.length} open loan${active.length === 1 ? '' : 's'}, and the fastest one to clear.`,
      });
    }

    // 2) Biggest monthly relief — clearing this loan frees up the most cash flow each month.
    const byEmi = active.filter((l) => (Number(l.emi) || 0) > 0).sort((a, b) => (b.emi || 0) - (a.emi || 0));
    if (byEmi.length && byEmi[0].id !== out[0]?.id) {
      const l = byEmi[0];
      out.push({
        id: l.id,
        kind: 'relief',
        title: `"${l.name}" is your biggest monthly EMI`,
        detail: `${this.fmtShort(l.emi || 0)}/month — paying this one off frees up the most cash flow of any active loan.`,
      });
    }

    // 3) Needs a decision — loans stuck in "discussion" status, i.e. no agreed plan yet.
    const discussing = active
      .map((l) => ({ l, outstanding: this.effectiveOutstanding(l) }))
      .filter((x) => x.l.status === 'discussion')
      .sort((a, b) => b.outstanding - a.outstanding);
    if (discussing.length) {
      const { l, outstanding } = discussing[0];
      out.push({
        id: l.id,
        kind: 'attention',
        title: `"${l.name}" still needs a decision`,
        detail:
          discussing.length > 1
            ? `In discussion with ${this.fmtShort(outstanding)} outstanding — plus ${discussing.length - 1} more loan${discussing.length - 1 === 1 ? '' : 's'} awaiting a settlement plan.`
            : `In discussion with ${this.fmtShort(outstanding)} outstanding — worth agreeing a settlement plan to move this to "Settlement agreed".`,
      });
    }

    return out.slice(0, 3);
  });

  private fmtShort(n: number): string {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 100000) return '₹' + (v / 100000).toFixed(2).replace(/\.00$/, '') + 'L';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);
  }

  /** Planned/paid/income per logged month, oldest to newest — the source
   *  data for the Dashboard's monthly spends trend chart. */
  readonly monthlySpendTrend = computed(() => {
    const spends = this._spends();
    return this.monthKeys().map((key) => {
      const m = spends[key];
      const entries = m?.entries || [];
      const totalAmt = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const totalPaid = entries.reduce((s, e) => s + (Number(e.paidAmount) || 0), 0);
      return { key, label: m?.label || key, planned: totalAmt, paid: totalPaid, income: this.monthIncomeTotal(key) };
    });
  });

  /** How much has been paid off vs. what's still owed, per active loan —
   *  the source data for the Dashboard's balance-reduction chart. Sorted by
   *  original size and capped at 10 so the chart stays readable; a family
   *  with more loans than that sees the largest ones, which is what matters
   *  most for a "how much progress am I making" view. */
  readonly loanReductionData = computed(() => {
    return this.sortedLoans()
      .filter((l) => l.status !== 'closed')
      .map((l) => {
        const remaining = this.effectiveOutstanding(l);
        return {
          name: l.name,
          paid: Math.max(0, (Number(l.totalAmount) || 0) - remaining),
          remaining,
        };
      })
      .sort((a, b) => b.paid + b.remaining - (a.paid + a.remaining))
      .slice(0, 10);
  });

  /**
   * Projects when all active loans could be fully closed, assuming the
   * current combined monthly EMI keeps being paid steadily and no new
   * loans are added — a simple linear projection, not a guarantee, since
   * it can't account for interest, settlements negotiated for less, or
   * loans without a fixed EMI. Also compares against paying 20% more per
   * month combined, as a concrete "what a bit extra buys you" suggestion.
   */
  readonly payoffProjection = computed(() => {
    const totalBalance = this.totalActiveOutstanding();
    const totalEmi = this.totalEmiPerMonth();
    const empty = {
      totalBalance,
      totalEmi,
      monthsToPayoff: null as number | null,
      projectedDate: null as Date | null,
      extraMonthly: 0,
      monthsSavedWithExtra: 0,
      timeline: [] as { label: string; remaining: number }[],
    };
    if (totalBalance <= 0) return { ...empty, monthsToPayoff: 0, projectedDate: new Date() };
    if (totalEmi <= 0) return empty;

    const monthsToPayoff = Math.ceil(totalBalance / totalEmi);
    const now = new Date();
    const projectedDate = new Date(now.getFullYear(), now.getMonth() + monthsToPayoff, 1);

    const extraMonthly = Math.round((totalEmi * 0.2) / 100) * 100;
    const fasterMonths = extraMonthly > 0 ? Math.ceil(totalBalance / (totalEmi + extraMonthly)) : monthsToPayoff;
    const monthsSavedWithExtra = Math.max(0, monthsToPayoff - fasterMonths);

    // Linear projection points for the chart, capped at ~24 so a very long
    // payoff (low EMI against a big balance) doesn't render an unreadable
    // number of x-axis labels — each step then spans more than one month.
    const maxPoints = 24;
    const step = Math.max(1, Math.ceil(monthsToPayoff / maxPoints));
    const timeline: { label: string; remaining: number }[] = [];
    for (let m = 0; m <= monthsToPayoff; m += step) {
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      timeline.push({
        label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        remaining: Math.max(0, totalBalance - totalEmi * m),
      });
    }
    if (timeline[timeline.length - 1]?.remaining !== 0) {
      timeline.push({ label: projectedDate.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), remaining: 0 });
    }

    return { totalBalance, totalEmi, monthsToPayoff, projectedDate, extraMonthly, monthsSavedWithExtra, timeline };
  });

  constructor(private http: HttpClient, private auth: AuthService) {
    // Only start talking to the backend once a family passcode is set —
    // otherwise every request would just 401. See auth.interceptor.ts.
    effect(() => {
      const key = this.auth.familyKey();
      if (key && !this.loadingState && !this._ready()) {
        this.loadState();
      }
    });
  }

  private loadState(): void {
    this.loadingState = true;
    this.http.get<StateResponse>(`${this.apiBase}/api/state`).subscribe({
      next: (state) => {
        this._loans.set(state.loans || []);
        this._closed.set(state.closed || []);
        this._spends.set(state.spends || {});
        this._meta.set(state.meta || { familyLabel: 'Family', currency: 'INR' });
        this._syncError.set(null);
        this._ready.set(true);
        this.loadingState = false;
        this.ensureCurrentMonthEmiEntries();
      },
      error: (err: HttpErrorResponse) => {
        this.loadingState = false;
        console.error('Could not load state from the backend', err);
        if (err.status === 401) {
          this._syncError.set('The backend rejected that family passcode. Sign out and try again.');
        } else {
          this._syncError.set(
            `Can't reach the backend server at ${this.apiBase} — make sure it's running (see README.md).`
          );
        }
        // `ready` stays false so the UI shows a clear "can't connect" state.
      },
    });
  }

  /** Retries the initial load after a failed connection, without requiring the passcode to change. */
  retryConnection(): void {
    if (this.loadingState) return;
    this._syncError.set(null);
    this.loadState();
  }

  private handleSyncError(err: unknown, fallback: string): void {
    console.error(fallback, err);
    let message = fallback + ' — check the backend is running.';
    if (err instanceof HttpErrorResponse) {
      if (err.status === 401) {
        message = 'The backend rejected the family passcode for this request.';
      } else if (err.error?.message) {
        message = err.error.message;
      }
    }
    this._syncError.set(message);
  }

  private shiftMonthKey(monthId: string, deltaMonths: number): string {
    const m = /^(\d{4})-(\d{2})$/.exec(monthId);
    if (!m) return monthId;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    d.setMonth(d.getMonth() + deltaMonths);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  private monthLabelFor(monthId: string): string {
    const m = /^(\d{4})-(\d{2})$/.exec(monthId);
    if (!m) return monthId;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  }

  // ============================================================
  // Loans
  // ============================================================

  addLoan(data: Omit<Loan, 'id'>): Loan {
    const loan: Loan = { ...data, id: slugify(data.name, 'a-') + '-' + uid() };
    this._loans.update((list) => [...list, loan]);
    this.http.post<Loan>(`${this.apiBase}/api/loans`, data).subscribe({
      next: (saved) => {
        this._loans.update((list) => list.map((l) => (l.id === loan.id ? saved : l)));
      },
      error: (err) => this.handleSyncError(err, 'Could not save the new loan to the server'),
    });
    return loan;
  }

  updateLoan(id: string, patch: Partial<Loan>): void {
    this._loans.update((list) => list.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    this.http.patch<Loan>(`${this.apiBase}/api/loans/${id}`, patch).subscribe({
      next: (saved) => {
        this._loans.update((list) => list.map((l) => (l.id === id ? saved : l)));
      },
      error: (err) => this.handleSyncError(err, 'Could not save loan changes to the server'),
    });
  }

  deleteLoan(id: string): void {
    this._loans.update((list) => list.filter((l) => l.id !== id));
    this.http.delete(`${this.apiBase}/api/loans/${id}`).subscribe({
      error: (err) => this.handleSyncError(err, 'Could not delete the loan on the server'),
    });
  }

  /** Moves an active loan into the Closed Loans list. */
  moveLoanToClosed(id: string): void {
    const loan = this._loans().find((l) => l.id === id);
    if (!loan) return;
    const closedLoan: ClosedLoan = {
      id: slugify(loan.name, 'c-') + '-' + uid(),
      name: loan.name,
      category: loan.category,
      originalAmount: loan.totalAmount,
      settledAmount: loan.settledAmount ?? 0,
      amountPaid: loan.totalAmount - (loan.balance || 0),
      balanceRemaining: loan.balance || 0,
      datePaid: null,
      source: 'Moved from Active Loans',
      remarks: loan.remarks || '',
      order: this._closed().length,
      settlementLetter: loan.settlementLetter ?? null,
      nocCopy: loan.nocCopy ?? null,
    };
    this._closed.update((list) => [...list, closedLoan]);
    this._loans.update((list) => list.filter((l) => l.id !== id));

    this.http.post<{ closedLoan: ClosedLoan }>(`${this.apiBase}/api/loans/${id}/close`, {}).subscribe({
      next: (res) => {
        this._closed.update((list) => list.map((c) => (c.id === closedLoan.id ? res.closedLoan : c)));
      },
      error: (err) => this.handleSyncError(err, 'Could not close the loan on the server'),
    });
  }

  // ============================================================
  // Closed loans
  // ============================================================

  addClosedLoan(data: Omit<ClosedLoan, 'id'>): ClosedLoan {
    const closedLoan: ClosedLoan = { ...data, id: slugify(data.name, 'c-') + '-' + uid() };
    this._closed.update((list) => [...list, closedLoan]);
    this.http.post<ClosedLoan>(`${this.apiBase}/api/closed-loans`, data).subscribe({
      next: (saved) => {
        this._closed.update((list) => list.map((c) => (c.id === closedLoan.id ? saved : c)));
      },
      error: (err) => this.handleSyncError(err, 'Could not save the closed loan to the server'),
    });
    return closedLoan;
  }

  updateClosedLoan(id: string, patch: Partial<ClosedLoan>): void {
    this._closed.update((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    this.http.patch<ClosedLoan>(`${this.apiBase}/api/closed-loans/${id}`, patch).subscribe({
      next: (saved) => {
        this._closed.update((list) => list.map((c) => (c.id === id ? saved : c)));
      },
      error: (err) => this.handleSyncError(err, 'Could not save closed loan changes to the server'),
    });
  }

  deleteClosedLoan(id: string): void {
    this._closed.update((list) => list.filter((c) => c.id !== id));
    this.http.delete(`${this.apiBase}/api/closed-loans/${id}`).subscribe({
      error: (err) => this.handleSyncError(err, 'Could not delete the closed loan on the server'),
    });
  }

  // ============================================================
  // Documents
  // ============================================================

  attachLoanDocument(id: string, kind: DocumentKind, doc: LoanDocument): void {
    this._loans.update((list) => list.map((l) => (l.id === id ? { ...l, [kind]: doc } : l)));
    this.http.patch<Loan>(`${this.apiBase}/api/loans/${id}/document`, { kind, doc }).subscribe({
      next: (saved) => {
        this._loans.update((list) => list.map((l) => (l.id === id ? saved : l)));
      },
      error: (err) => this.handleSyncError(err, 'Could not save the document link to the server'),
    });
  }

  attachClosedDocument(id: string, kind: DocumentKind, doc: LoanDocument): void {
    this._closed.update((list) => list.map((c) => (c.id === id ? { ...c, [kind]: doc } : c)));
    this.http.patch<ClosedLoan>(`${this.apiBase}/api/closed-loans/${id}/document`, { kind, doc }).subscribe({
      next: (saved) => {
        this._closed.update((list) => list.map((c) => (c.id === id ? saved : c)));
      },
      error: (err) => this.handleSyncError(err, 'Could not save the document link to the server'),
    });
  }

  // ============================================================
  // Spends — months
  // ============================================================

  private setMonthLocal(monthId: string, month: SpendMonth): void {
    this._spends.update((map) => ({ ...map, [monthId]: month }));
  }

  /** Creates/updates a month record (used to add a brand-new empty month). */
  saveMonth(monthId: string, month: SpendMonth): void {
    this.setMonthLocal(monthId, month);
    this.http.put(`${this.apiBase}/api/spend-months/${monthId}`, { label: month.label }).subscribe({
      error: (err) => this.handleSyncError(err, 'Could not save the month to the server'),
    });
  }

  // ============================================================
  // Spends — incomes
  // ============================================================

  addIncome(monthId: string, label: string, amount: number): void {
    const existing = this._spends()[monthId] || { label: this.monthLabelFor(monthId), incomes: [], entries: [] };
    const income: Income = { id: tempId(), label, amount: Number(amount) || 0 };
    this.setMonthLocal(monthId, { ...existing, incomes: [...existing.incomes, income] });

    this.http
      .post<Income>(`${this.apiBase}/api/spend-months/${monthId}/incomes`, { label, amount, monthLabel: existing.label })
      .subscribe({
        next: (saved) => {
          this._spends.update((map) => {
            const m = map[monthId];
            if (!m) return map;
            return { ...map, [monthId]: { ...m, incomes: m.incomes.map((i) => (i.id === income.id ? saved : i)) } };
          });
        },
        error: (err) => this.handleSyncError(err, 'Could not save income to the server'),
      });
  }

  updateIncome(monthId: string, incomeId: string, patch: Partial<Income>): void {
    const existing = this._spends()[monthId];
    if (!existing) return;
    this.setMonthLocal(monthId, {
      ...existing,
      incomes: existing.incomes.map((i) => (i.id === incomeId ? { ...i, ...patch } : i)),
    });
    if (isTempId(incomeId)) return; // not yet confirmed by the server — nothing to PATCH yet.
    this.http.patch<Income>(`${this.apiBase}/api/spend-months/${monthId}/incomes/${incomeId}`, patch).subscribe({
      next: (saved) => {
        this._spends.update((map) => {
          const m = map[monthId];
          if (!m) return map;
          return { ...map, [monthId]: { ...m, incomes: m.incomes.map((i) => (i.id === incomeId ? saved : i)) } };
        });
      },
      error: (err) => this.handleSyncError(err, 'Could not save income changes to the server'),
    });
  }

  deleteIncome(monthId: string, incomeId: string): void {
    const existing = this._spends()[monthId];
    if (!existing) return;
    this.setMonthLocal(monthId, { ...existing, incomes: existing.incomes.filter((i) => i.id !== incomeId) });
    if (isTempId(incomeId)) return;
    this.http.delete(`${this.apiBase}/api/spend-months/${monthId}/incomes/${incomeId}`).subscribe({
      error: (err) => this.handleSyncError(err, 'Could not delete income on the server'),
    });
  }

  /** Sums every income row for a given month. */
  monthIncomeTotal(monthId: string): number {
    return (this._spends()[monthId]?.incomes || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  }

  // ============================================================
  // Spends — entries
  // ============================================================

  addSpendEntry(monthId: string, entry: SpendEntry): void {
    const existing = this._spends()[monthId] || { label: this.monthLabelFor(monthId), incomes: [], entries: [] };
    const row: EntryRow = { ...entry, id: tempId() };
    this.setMonthLocal(monthId, { ...existing, entries: [...existing.entries, row] });

    this.http
      .post<EntryRow>(`${this.apiBase}/api/spend-months/${monthId}/entries`, { ...entry, monthLabel: existing.label })
      .subscribe({
        next: (saved) => {
          this._spends.update((map) => {
            const m = map[monthId];
            if (!m) return map;
            const entries = m.entries.map((e) => ((e as EntryRow).id === row.id ? saved : e));
            return { ...map, [monthId]: { ...m, entries } };
          });
        },
        error: (err) => this.handleSyncError(err, 'Could not save entry to the server'),
      });
  }

  updateSpendEntry(monthId: string, index: number, patch: Partial<SpendEntry>): void {
    const existing = this._spends()[monthId];
    if (!existing) return;
    const current = existing.entries[index] as EntryRow | undefined;
    if (!current) return;
    const entries = existing.entries.map((e, i) => (i === index ? { ...e, ...patch } : e));
    this.setMonthLocal(monthId, { ...existing, entries });

    if (isTempId(current.id)) return; // still waiting on the create request — nothing to PATCH yet.
    this.http
      .patch<EntryRow>(`${this.apiBase}/api/spend-months/${monthId}/entries/${current.id}`, patch)
      .subscribe({
        next: (saved) => {
          this._spends.update((map) => {
            const m = map[monthId];
            if (!m) return map;
            const updatedEntries = m.entries.map((e) => ((e as EntryRow).id === current.id ? saved : e));
            return { ...map, [monthId]: { ...m, entries: updatedEntries } };
          });
        },
        error: (err) => this.handleSyncError(err, 'Could not save entry changes to the server'),
      });
  }

  deleteSpendEntry(monthId: string, index: number): void {
    const existing = this._spends()[monthId];
    if (!existing) return;
    const current = existing.entries[index] as EntryRow | undefined;
    const entries = existing.entries.filter((_, i) => i !== index);
    this.setMonthLocal(monthId, { ...existing, entries });

    if (!current || isTempId(current.id)) return;
    this.http.delete(`${this.apiBase}/api/spend-months/${monthId}/entries/${current.id}`).subscribe({
      error: (err) => this.handleSyncError(err, 'Could not delete entry on the server'),
    });
  }

  /** Copies every recurring (expense-type) entry — and the income rows — from one month into a brand-new month. */
  cloneMonth(fromMonthId: string, toMonthId: string): void {
    this._syncError.set(null);
    if (this._spends()[toMonthId]) {
      this._syncError.set(`${toMonthId} already has data — pick a month that hasn't been logged yet.`);
      return;
    }
    const src = this._spends()[fromMonthId];
    const label = this.monthLabelFor(toMonthId);
    const incomes: Income[] = (src?.incomes || []).map((i) => ({ ...i, id: tempId() }));
    const entries: EntryRow[] = (src?.entries || [])
      .filter((e) => e.type === 'expense')
      .map((e) => ({ ...e, paidAmount: null, applied: false, id: tempId() }));
    this.setMonthLocal(toMonthId, { label, incomes, entries });

    this.http
      .post<{ monthId: string; label: string; incomes: Income[]; entries: SpendEntry[] }>(
        `${this.apiBase}/api/spend-months/${fromMonthId}/clone-to/${toMonthId}`,
        {}
      )
      .subscribe({
        next: (res) => {
          this.setMonthLocal(toMonthId, { label: res.label, incomes: res.incomes, entries: res.entries });
        },
        error: (err: HttpErrorResponse) => {
          // Roll back the optimistic month so we don't show data that never made it to the server.
          this._spends.update((map) => {
            const next = { ...map };
            delete next[toMonthId];
            return next;
          });
          if (err.status === 409) {
            this._syncError.set(err.error?.message || `${toMonthId} already has entries on the server.`);
          } else {
            this.handleSyncError(err, 'Could not clone the month to the server');
          }
        },
      });
  }

  /** Finds the best active-loan match for a free-text spend entry name.
   *  Exact match (case/whitespace-insensitive) always wins first — only
   *  when nothing matches exactly does a full-name substring match kick in
   *  as a fallback. A "first word" heuristic used to sit here instead, but
   *  it couldn't tell apart loans that share a first word (e.g. "Magalir
   *  Loan-1/2/3" all start with "magalir"), so it always matched whichever
   *  same-prefix loan happened to sort first, regardless of which one an
   *  entry was actually named after. */
  findLoanByName(name: string): Loan | null {
    const n = String(name).trim().toLowerCase();
    if (!n) return null;
    const candidates = this.sortedLoans().filter((l) => l.status !== 'closed');
    const exact = candidates.find((l) => l.name.trim().toLowerCase() === n);
    if (exact) return exact;
    const contains = candidates.find((l) => {
      const ln = l.name.trim().toLowerCase();
      return ln.includes(n) || n.includes(ln);
    });
    return contains ?? null;
  }

  /** Applies a spend entry's paid amount to the matching loan's balance, and marks the entry applied. */
  applyEntryToLoan(monthId: string, index: number, loanId: string): boolean {
    const month = this._spends()[monthId];
    const entry = month?.entries[index];
    const loan = this._loans().find((l) => l.id === loanId);
    if (!entry || !loan) return false;
    const paid = Number(entry.paidAmount) || 0;
    const newBalance = Math.max(0, (Number(loan.balance) || 0) - paid);
    this.updateLoan(loanId, { balance: newBalance, status: newBalance <= 0 ? 'closed' : loan.status });
    this.updateSpendEntry(monthId, index, { applied: true });
    return true;
  }

  currentMonthId(): string {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /** A sensible default due-date for an auto-added EMI entry: the same
   *  day-of-month as the loan's planned start date, landed in `monthId`
   *  (clamped to however many days that month actually has — e.g. day 31
   *  in a 30-day month becomes the 30th). Falls back to the 1st when there's
   *  no start date to go by. Just a starting guess — editable afterward. */
  private dueDateInMonth(monthId: string, plannedStartDate: string | null): string {
    const m = /^(\d{4})-(\d{2})$/.exec(monthId);
    if (!m) return '';
    const [, yStr, moStr] = m;
    const month0 = Number(moStr) - 1;
    let day = 1;
    if (plannedStartDate) {
      const sm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(plannedStartDate);
      if (sm) day = Number(sm[3]);
    }
    const daysInMonth = new Date(Number(yStr), month0 + 1, 0).getDate();
    day = Math.min(Math.max(1, day), daysInMonth);
    return `${yStr}-${moStr}-${String(day).padStart(2, '0')}`;
  }

  /**
   * Auto-adds this month's EMI as a Monthly Spends expense entry for every
   * active loan that has one set — so you don't have to remember to log
   * each loan's EMI by hand every month. Added UNPAID (`paidAmount: null`,
   * `applied: false`) with the loan's own name, so nothing is ever assumed
   * paid on its own — it just shows up ready for you to mark paid and
   * "Apply to loan" once you've actually paid it, same as any manually
   * typed entry. Safe to call every time state loads: it skips a loan
   * whenever the current month already has an entry with that same name,
   * so it never creates a duplicate.
   */
  private ensureCurrentMonthEmiEntries(): void {
    const monthId = this.currentMonthId();
    const month = this._spends()[monthId];
    const existingNames = new Set((month?.entries || []).map((e) => e.name.trim().toLowerCase()));
    // Only a loan that's actually active (not "discussion"/"settlement")
    // AND whose planned EMI start date has actually arrived should get an
    // auto-added entry — otherwise a loan still being negotiated, or one
    // that doesn't start until a future month, ends up with a phantom EMI
    // due this month.
    const dueLoans = this._loans().filter(
      (l) => l.status === 'active' && Number(l.emi) > 0 && this.hasEmiStartedByMonth(l, monthId)
    );
    for (const loan of dueLoans) {
      const key = loan.name.trim().toLowerCase();
      if (!key || existingNames.has(key)) continue;
      existingNames.add(key);
      this.addSpendEntry(monthId, {
        name: loan.name,
        date: this.dueDateInMonth(monthId, loan.plannedEmiStartDate),
        amount: Number(loan.emi) || 0,
        paidAmount: null,
        type: 'expense',
        remarks: 'Auto-added EMI',
        applied: false,
      });
    }
  }

  // ============================================================
  // Meta
  // ============================================================

  setDriveFolderId(folderId: string): void {
    this._meta.update((m) => ({ ...m, driveFolderId: folderId }));
    this.http.patch<AppMeta>(`${this.apiBase}/api/meta`, { driveFolderId: folderId }).subscribe({
      next: (saved) => this._meta.set(saved),
      error: (err) => this.handleSyncError(err, 'Could not save settings to the server'),
    });
  }
}
