export type SpendType = 'expense' | 'settlement';

export interface SpendEntry {
  name: string;
  date: string;
  amount: number;
  paidAmount: number | null;
  type: SpendType;
  remarks: string;
  applied: boolean;
}

export interface Income {
  id: string;
  label: string;
  amount: number;
}

export interface SpendMonth {
  label: string;
  incomes: Income[];
  entries: SpendEntry[];
}

export interface AppMeta {
  familyLabel: string;
  currency: string;
  seededFrom?: string;
  seededAt?: string;
  driveFolderId?: string;
}
