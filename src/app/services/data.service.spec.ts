import { TestBed } from '@angular/core/testing';
import { ApplicationRef } from '@angular/core';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DataService } from './data.service';
import { AuthService } from './auth.service';
import { Loan } from '../models/loan.model';
import { environment } from '../../environments/environment';

/**
 * These cover the EMI-schedule date math and free-text loan matching that
 * have each broken in a subtle way at least once during real use — an
 * off-by-one in the "last paid" date, and a loan-name matcher that
 * collapsed several similarly-named loans onto whichever one happened to
 * sort first. Both bugs passed a casual glance at the code; they only
 * showed up against real data. Nothing here touches the network — the
 * schedule methods take a plain Loan object directly, so most of these
 * don't even need the backend mocked.
 */

function makeLoan(overrides: Partial<Loan>): Loan {
  return {
    id: 'test-id',
    name: 'Test Loan',
    category: 'App Loans',
    totalAmount: 100000,
    totalOutstanding: null,
    settledAmount: null,
    balance: 100000,
    emi: 5000,
    plannedEmiStartDate: null,
    emiTenureMonths: 24,
    status: 'active',
    progress: '',
    remarks: '',
    order: 0,
    ...overrides,
  };
}

describe('DataService — EMI schedule math', () => {
  let service: DataService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DataService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DataService);
  });

  it('reports nothing paid yet for a loan that starts in the future', () => {
    const future = new Date();
    future.setMonth(future.getMonth() + 2);
    const loan = makeLoan({ plannedEmiStartDate: future.toISOString().slice(0, 10) });

    expect(service.pendingEmiInstallments(loan)?.paid).toBe(0);
    expect(service.lastPaidEmiDate(loan)).toBeNull();
  });

  it('counts a month as paid only once its due date has actually passed, not the moment the calendar month ticks over', () => {
    // Started exactly 3 months ago today: by definition, day-of-month
    // hasn't passed yet relative to itself, so exactly 3 installments are
    // due — not 2, not 4.
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    const loan = makeLoan({ plannedEmiStartDate: start.toISOString().slice(0, 10), emiTenureMonths: 24 });

    expect(service.pendingEmiInstallments(loan)?.paid).toBe(3);
  });

  it("the Nth paid installment's due date is start + N months, not start + (N-1) months", () => {
    // Regression test for a real bug: lastPaidEmiDate used to compute
    // `start + (paid - 1) months`, which showed the wrong month (e.g. "Aug"
    // instead of "Sep") for every loan with at least one payment made.
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    const loan = makeLoan({ plannedEmiStartDate: start.toISOString().slice(0, 10), emiTenureMonths: 24 });

    const lastPaid = service.lastPaidEmiDate(loan);
    const expected = new Date(start.getFullYear(), start.getMonth() + 3, start.getDate());
    expect(lastPaid?.getFullYear()).toBe(expected.getFullYear());
    expect(lastPaid?.getMonth()).toBe(expected.getMonth());
    expect(lastPaid?.getDate()).toBe(expected.getDate());
  });

  it('caps paid installments at the tenure once the schedule has fully run', () => {
    const start = new Date();
    start.setFullYear(start.getFullYear() - 5); // started long enough ago to have finished
    const loan = makeLoan({ plannedEmiStartDate: start.toISOString().slice(0, 10), emiTenureMonths: 12 });

    const progress = service.pendingEmiInstallments(loan);
    expect(progress?.paid).toBe(12);
    expect(progress?.pending).toBe(0);
  });

  it('returns null for a closed loan, a loan with no EMI, or one with no start date', () => {
    expect(service.pendingEmiInstallments(makeLoan({ status: 'closed', plannedEmiStartDate: '2025-01-01' }))).toBeNull();
    expect(service.pendingEmiInstallments(makeLoan({ emi: null, plannedEmiStartDate: '2025-01-01' }))).toBeNull();
    expect(service.pendingEmiInstallments(makeLoan({ plannedEmiStartDate: null }))).toBeNull();
  });
});

describe('DataService — findLoanByName', () => {
  let service: DataService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DataService, AuthService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DataService);
    httpMock = TestBed.inject(HttpTestingController);

    const auth = TestBed.inject(AuthService);
    auth.setKey('test-passcode');
    // The constructor's `effect()` that watches auth.familyKey() only runs
    // on the next change-detection tick, not synchronously inline with
    // setKey() — flush one tick so loadState() has actually fired before
    // we try to intercept its request.
    TestBed.inject(ApplicationRef).tick();
    const req = httpMock.expectOne(`${environment.apiBaseUrl}/api/state`);
    // emi: null on every loan here — findLoanByName doesn't care about EMI
    // values, and it keeps loadState()'s ensureCurrentMonthEmiEntries() from
    // firing its own auto-add POST requests as a side effect of loading,
    // which would otherwise be unrelated open requests this suite would
    // have to account for.
    req.flush({
      loans: [
        makeLoan({ id: 'l1', name: 'Magalir Loan-1', emi: null }),
        makeLoan({ id: 'l2', name: 'Magalir Loan-2', emi: null }),
        makeLoan({ id: 'l3', name: 'Magalir Loan-3', emi: null }),
        makeLoan({ id: 'l4', name: 'Old Personal Loan', status: 'closed', emi: null }),
      ],
      closed: [],
      spends: {},
      meta: { familyLabel: 'Test', currency: 'INR' },
    });
  });

  afterEach(() => httpMock.verify());

  it('matches each same-prefix loan to itself, not all to whichever sorts first', () => {
    // Regression test for a real bug: a "first word" heuristic matched
    // every "Magalir Loan-N" entry to Magalir Loan-1, since they all start
    // with "magalir" and the old code took the first loan satisfying ANY
    // of its OR'd conditions.
    expect(service.findLoanByName('Magalir Loan-1')?.id).toBe('l1');
    expect(service.findLoanByName('Magalir Loan-2')?.id).toBe('l2');
    expect(service.findLoanByName('Magalir Loan-3')?.id).toBe('l3');
  });

  it('matches case- and whitespace-insensitively', () => {
    expect(service.findLoanByName('  magalir loan-2  ')?.id).toBe('l2');
  });

  it('never matches a closed loan', () => {
    expect(service.findLoanByName('Old Personal Loan')).toBeNull();
  });

  it('returns null for a blank or unmatched name', () => {
    expect(service.findLoanByName('')).toBeNull();
    expect(service.findLoanByName('   ')).toBeNull();
    expect(service.findLoanByName('Some Unrelated Entry')).toBeNull();
  });
});

/**
 * ensureCurrentMonthEmiEntries is private, and only ever runs as a side
 * effect of loadState() succeeding — so these drive it the same way the app
 * does (flush /api/state) and observe the Monthly Spends entries it
 * produces, rather than calling it directly. Covers the exact gating rules
 * in its filter: active status, an EMI actually set, and the planned start
 * date having arrived — plus the no-duplicate guard that makes it safe to
 * call on every load.
 */
describe('DataService — ensureCurrentMonthEmiEntries gating (auto-added EMI entries)', () => {
  let service: DataService;
  let httpMock: HttpTestingController;
  let monthId: string;

  function loadWithLoans(loans: Partial<Loan>[], existingEntries: Record<string, unknown>[] = []) {
    const auth = TestBed.inject(AuthService);
    auth.setKey('test-passcode');
    TestBed.inject(ApplicationRef).tick();
    const req = httpMock.expectOne(`${environment.apiBaseUrl}/api/state`);
    req.flush({
      loans: loans.map((l) => makeLoan(l)),
      closed: [],
      spends: existingEntries.length
        ? { [monthId]: { label: monthId, incomes: [], entries: existingEntries } }
        : {},
      meta: { familyLabel: 'Test', currency: 'INR' },
    });
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DataService, AuthService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DataService);
    httpMock = TestBed.inject(HttpTestingController);
    monthId = service.currentMonthId();
  });

  afterEach(() => httpMock.verify());

  it('auto-adds an unpaid EMI entry for an active loan whose schedule has started', () => {
    const past = new Date();
    past.setMonth(past.getMonth() - 1);
    loadWithLoans([
      { id: 'l1', name: 'Car Loan', emi: 4000, plannedEmiStartDate: past.toISOString().slice(0, 10) },
    ]);

    const addReq = httpMock.expectOne(`${environment.apiBaseUrl}/api/spend-months/${monthId}/entries`);
    expect(addReq.request.body.name).toBe('Car Loan');
    expect(addReq.request.body.amount).toBe(4000);
    expect(addReq.request.body.paidAmount).toBeNull();
    expect(addReq.request.body.applied).toBeFalse();
    expect(addReq.request.body.remarks).toBe('Auto-added EMI');
    addReq.flush({ id: 'e1', ...addReq.request.body });
  });

  it('does not add an entry for a loan whose planned start date is still in the future', () => {
    const future = new Date();
    future.setMonth(future.getMonth() + 1);
    loadWithLoans([
      { id: 'l1', name: 'Future Loan', emi: 4000, plannedEmiStartDate: future.toISOString().slice(0, 10) },
    ]);

    expect(service.spends()[monthId]?.entries.length ?? 0).toBe(0);
  });

  it('does not add an entry for a loan that is not active (discussion/settlement)', () => {
    const past = new Date();
    past.setMonth(past.getMonth() - 1);
    loadWithLoans([
      {
        id: 'l1',
        name: 'Discussion Loan',
        status: 'discussion',
        emi: 4000,
        plannedEmiStartDate: past.toISOString().slice(0, 10),
      },
    ]);

    expect(service.spends()[monthId]?.entries.length ?? 0).toBe(0);
  });

  it('does not add an entry for a loan with no EMI amount set', () => {
    const past = new Date();
    past.setMonth(past.getMonth() - 1);
    loadWithLoans([
      { id: 'l1', name: 'No EMI Loan', emi: null, plannedEmiStartDate: past.toISOString().slice(0, 10) },
    ]);

    expect(service.spends()[monthId]?.entries.length ?? 0).toBe(0);
  });

  it('treats a loan with no planned start date yet as already started (nothing to gate on)', () => {
    loadWithLoans([{ id: 'l1', name: 'No Start Date Loan', emi: 4000, plannedEmiStartDate: null }]);

    const addReq = httpMock.expectOne(`${environment.apiBaseUrl}/api/spend-months/${monthId}/entries`);
    expect(addReq.request.body.name).toBe('No Start Date Loan');
    addReq.flush({ id: 'e1', ...addReq.request.body });
  });

  it('never creates a duplicate when this month already has an entry with the same name', () => {
    // Regression-guard for the documented "safe to call every time state
    // loads" behavior: whitespace/case differences in the existing entry's
    // name must still count as a match.
    const past = new Date();
    past.setMonth(past.getMonth() - 1);
    loadWithLoans(
      [{ id: 'l1', name: 'Car Loan', emi: 4000, plannedEmiStartDate: past.toISOString().slice(0, 10) }],
      [
        {
          id: 'existing-1',
          name: '  Car Loan  ',
          date: '2026-01-01',
          amount: 4000,
          paidAmount: 4000,
          type: 'expense',
          remarks: '',
          applied: true,
        },
      ]
    );

    expect(service.spends()[monthId]?.entries.length).toBe(1);
    httpMock.expectNone(`${environment.apiBaseUrl}/api/spend-months/${monthId}/entries`);
  });
});

/**
 * applyEntryToLoan is what "Apply to loan" in Monthly Spends actually calls.
 * Each case here mirrors the method's own local-first update: the loan
 * balance/status and the entry's `applied` flag change synchronously before
 * the matching PATCH requests are even sent.
 */
describe('DataService — applyEntryToLoan', () => {
  let service: DataService;
  let httpMock: HttpTestingController;
  const monthId = '2026-01';

  function loadWithEntry(loanBalance: number, paidAmount: number) {
    const auth = TestBed.inject(AuthService);
    auth.setKey('test-passcode');
    TestBed.inject(ApplicationRef).tick();
    const req = httpMock.expectOne(`${environment.apiBaseUrl}/api/state`);
    req.flush({
      loans: [makeLoan({ id: 'l1', name: 'Car Loan', emi: null, balance: loanBalance, status: 'active' })],
      closed: [],
      spends: {
        [monthId]: {
          label: 'Jan 2026',
          incomes: [],
          entries: [
            {
              id: 'e1',
              name: 'Car Loan',
              date: '2026-01-05',
              amount: paidAmount,
              paidAmount,
              type: 'expense',
              remarks: '',
              applied: false,
            },
          ],
        },
      },
      meta: { familyLabel: 'Test', currency: 'INR' },
    });
  }

  /** Flushes the two PATCH requests applyEntryToLoan fires after its local update, so httpMock.verify() in afterEach doesn't fail on an open request. */
  function flushFollowupPatches() {
    httpMock.expectOne(`${environment.apiBaseUrl}/api/loans/l1`).flush(service.loans().find((l) => l.id === 'l1')!);
    httpMock
      .expectOne(`${environment.apiBaseUrl}/api/spend-months/${monthId}/entries/e1`)
      .flush(service.spends()[monthId].entries[0]);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DataService, AuthService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DataService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('subtracts the paid amount from the loan balance and marks the entry applied', () => {
    loadWithEntry(10000, 3000);

    const ok = service.applyEntryToLoan(monthId, 0, 'l1');

    expect(ok).toBeTrue();
    expect(service.loans().find((l) => l.id === 'l1')?.balance).toBe(7000);
    expect(service.spends()[monthId]?.entries[0].applied).toBeTrue();
    flushFollowupPatches();
  });

  it('leaves the loan active when the balance stays above zero', () => {
    loadWithEntry(10000, 3000);

    service.applyEntryToLoan(monthId, 0, 'l1');

    expect(service.loans().find((l) => l.id === 'l1')?.status).toBe('active');
    flushFollowupPatches();
  });

  it('closes the loan once the paid amount exactly clears the balance', () => {
    loadWithEntry(3000, 3000);

    service.applyEntryToLoan(monthId, 0, 'l1');

    const loan = service.loans().find((l) => l.id === 'l1');
    expect(loan?.balance).toBe(0);
    expect(loan?.status).toBe('closed');
    flushFollowupPatches();
  });

  it('floors the balance at zero and closes the loan when the payment overshoots it', () => {
    loadWithEntry(2000, 3000);

    service.applyEntryToLoan(monthId, 0, 'l1');

    const loan = service.loans().find((l) => l.id === 'l1');
    expect(loan?.balance).toBe(0);
    expect(loan?.status).toBe('closed');
    flushFollowupPatches();
  });

  it('returns false and makes no changes for an unknown loan id', () => {
    loadWithEntry(10000, 3000);

    const ok = service.applyEntryToLoan(monthId, 0, 'not-a-real-loan');

    expect(ok).toBeFalse();
    expect(service.loans().find((l) => l.id === 'l1')?.balance).toBe(10000);
    expect(service.spends()[monthId]?.entries[0].applied).toBeFalse();
    // No follow-up PATCH requests fire when it bails out early.
  });

  it('returns false and makes no changes for an out-of-range entry index', () => {
    loadWithEntry(10000, 3000);

    const ok = service.applyEntryToLoan(monthId, 99, 'l1');

    expect(ok).toBeFalse();
    expect(service.loans().find((l) => l.id === 'l1')?.balance).toBe(10000);
  });
});
