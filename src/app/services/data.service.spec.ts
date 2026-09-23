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
