import { LoanDocument } from './document.model';

export type LoanStatus = 'active' | 'settlement' | 'discussion' | 'closed';

export const LOAN_CATEGORIES = [
  'App Loans',
  'Bank Loans',
  'Credit Cards',
  'Individual Loans',
  'Magalir Loans / Chits / Gold',
  'Family Credit Funds / Other',
] as const;
export type LoanCategory = typeof LOAN_CATEGORIES[number];

export const STATUS_LABELS: Record<LoanStatus, string> = {
  active: 'Active',
  settlement: 'Settlement agreed',
  discussion: 'Discussion ongoing',
  closed: 'Closed',
};

/**
 * Categories that are informal, person-to-person arrangements rather than
 * loans issued by a bank/app/institution. These don't come with formal
 * paperwork (a settlement letter, an NOC copy) and are never negotiated
 * down to an agreed "settlement" the way an App/Bank/Credit-card loan can
 * be — they're simply active, being discussed, or closed.
 */
export const INFORMAL_CATEGORIES: LoanCategory[] = [
  'Individual Loans',
  'Magalir Loans / Chits / Gold',
  'Family Credit Funds / Other',
];

/** Whether this category's loans can carry a settlement letter / NOC copy upload. */
export function hasFormalDocuments(category: LoanCategory): boolean {
  return !INFORMAL_CATEGORIES.includes(category);
}

/** Status options selectable for a loan in this category — informal categories drop "Settlement agreed". */
export function allowedStatuses(category: LoanCategory): LoanStatus[] {
  const all: LoanStatus[] = ['active', 'settlement', 'discussion', 'closed'];
  return INFORMAL_CATEGORIES.includes(category) ? all.filter((s) => s !== 'settlement') : all;
}

export interface Loan {
  id: string;
  name: string;
  category: LoanCategory;
  totalAmount: number;
  totalOutstanding: number | null;
  settledAmount: number | null;
  balance: number;
  emi: number | null;
  /** Planned first-EMI date, "YYYY-MM-DD". Together with `emi` and
   *  `emiTenureMonths` this drives the tenure/completion-date display — it
   *  is not itself validated against actual payments. */
  plannedEmiStartDate: string | null;
  /** Total number of EMIs for the loan, entered directly (e.g. a 24-month
   *  chit). This is the source of truth for the tenure/completion-date
   *  display when set — total loan amount ÷ EMI is only a rough estimate,
   *  since it ignores interest, dividends, processing fees, and rounding
   *  that make the real number of installments differ from that ratio. */
  emiTenureMonths: number | null;
  status: LoanStatus;
  progress: string;
  remarks: string;
  order: number;
  settlementLetter?: LoanDocument | null;
  nocCopy?: LoanDocument | null;
}

export interface ClosedLoan {
  id: string;
  name: string;
  category: LoanCategory;
  originalAmount: number;
  settledAmount: number;
  amountPaid: number;
  balanceRemaining: number;
  datePaid: string | null;
  source: string;
  remarks: string;
  order: number;
  settlementLetter?: LoanDocument | null;
  nocCopy?: LoanDocument | null;
}
