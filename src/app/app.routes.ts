import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () => import('./components/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'active-loans',
    loadComponent: () => import('./components/active-loans/active-loans.component').then((m) => m.ActiveLoansComponent),
  },
  {
    path: 'closed-loans',
    loadComponent: () => import('./components/closed-loans/closed-loans.component').then((m) => m.ClosedLoansComponent),
  },
  {
    path: 'monthly-spends',
    loadComponent: () => import('./components/monthly-spends/monthly-spends.component').then((m) => m.MonthlySpendsComponent),
  },
  {
    path: 'emi-calculator',
    loadComponent: () => import('./components/emi-calculator/emi-calculator.component').then((m) => m.EmiCalculatorComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];
