import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { DataService } from '../../services/data.service';

interface EmiResult {
  principal: number;
  emi: number;
  totalPayment: number;
  totalInterest: number;
  months: number;
}

@Component({
  selector: 'app-emi-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CardModule, InputNumberModule],
  templateUrl: './emi-calculator.component.html',
  styleUrl: './emi-calculator.component.scss',
})
export class EmiCalculatorComponent {
  readonly principal = signal(100000);
  readonly annualRate = signal(12);
  readonly months = signal(12);

  constructor(private data: DataService, private router: Router) {}

  readonly result = computed<EmiResult>(() => {
    const P = Number(this.principal()) || 0;
    const n = Math.max(1, Math.round(Number(this.months()) || 1));
    const r = (Number(this.annualRate()) || 0) / 12 / 100;
    let emi: number;
    if (r === 0) {
      emi = P / n;
    } else {
      emi = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    }
    const totalPayment = emi * n;
    return { principal: P, emi, totalPayment, totalInterest: totalPayment - P, months: n };
  });

  fmtMoney(n: number | null | undefined): string {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  }

  addAsLoan(): void {
    const r = this.result();
    this.data.addLoan({
      name: 'New loan',
      category: 'Bank Loans',
      totalAmount: r.principal,
      totalOutstanding: null,
      settledAmount: null,
      balance: r.principal,
      emi: Math.round(r.emi),
      plannedEmiStartDate: null,
      emiTenureMonths: r.months,
      status: 'active',
      progress: `Tenure ${r.months} months`,
      remarks: 'Added from EMI calculator',
      order: this.data.loans().length,
    });
    this.router.navigate(['/active-loans']);
  }
}
