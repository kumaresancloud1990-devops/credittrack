import { Component, computed, signal, ViewChild, ApplicationRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ChartModule, UIChart } from 'primeng/chart';
import { DataService } from '../../services/data.service';
import { LOAN_CATEGORIES, LoanCategory } from '../../models/loan.model';
import { categorySlug, CATEGORY_COLOR_VAR } from '../../models/category-colors';

/** The light-theme chart palette, hardcoded — also used as the "always
 *  print in these colors" set below, not just as a fallback. */
const LIGHT_CHART_COLORS = {
  text: '#3C4A6B',
  grid: '#A5BBE6',
  accent: '#1D56C7',
  accentSoft: '#E2EBFC',
  surfaceAlt: '#E8EFFB',
  borderSoft: '#A5BBE6',
  good: '#287A4B',
  goodSoft: '#E1F3E7',
  warn: '#8D6621',
  warnSoft: '#FAF0DC',
  danger: '#AA4D38',
  surface: '#FFFFFF',
};

/** Reads the app's current CSS custom properties so Chart.js — which needs
 *  literal color strings, not var(--x) — renders in the same palette as the
 *  rest of the page. Called fresh every time `theme()` below re-evaluates
 *  (on light/dark changes), never cached, so it always reflects whichever
 *  theme is actually in effect right now. */
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name)?.trim() || fallback;
  return {
    text: v('--text-muted', LIGHT_CHART_COLORS.text),
    grid: v('--border-soft', LIGHT_CHART_COLORS.grid),
    accent: v('--accent', LIGHT_CHART_COLORS.accent),
    accentSoft: v('--accent-soft', LIGHT_CHART_COLORS.accentSoft),
    surfaceAlt: v('--surface-alt', LIGHT_CHART_COLORS.surfaceAlt),
    borderSoft: v('--border-soft', LIGHT_CHART_COLORS.borderSoft),
    good: v('--good', LIGHT_CHART_COLORS.good),
    goodSoft: v('--good-soft', LIGHT_CHART_COLORS.goodSoft),
    warn: v('--warn', LIGHT_CHART_COLORS.warn),
    warnSoft: v('--warn-soft', LIGHT_CHART_COLORS.warnSoft),
    danger: v('--danger', LIGHT_CHART_COLORS.danger),
    surface: v('--surface', LIGHT_CHART_COLORS.surface),
  };
}

/** ₹1,50,000 → ₹1.5L, ₹2,00,00,000 → ₹2Cr — the same shorthand the stat
 *  tiles already use, reused on chart axes/tooltips so a wide range of
 *  balances (thousands to crores) stays readable instead of a wall of
 *  digits like "2,000,000". */
function shortMoney(n: number): string {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 10000000) return '₹' + (v / 10000000).toFixed(abs % 10000000 === 0 ? 0 : 1) + 'Cr';
  if (abs >= 100000) return '₹' + (v / 100000).toFixed(abs % 100000 === 0 ? 0 : 1) + 'L';
  if (abs >= 1000) return '₹' + (v / 1000).toFixed(abs % 1000 === 0 ? 0 : 1) + 'k';
  return '₹' + v.toFixed(0);
}

function fullMoney(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);
}

/** A soft top-to-bottom gradient fill for the payoff-projection area chart —
 *  a flat semi-transparent fill reads flatter/cheaper than Chart.js's own
 *  canvas-gradient areas, which is the polish most line/area chart designs
 *  lean on. Scriptable (a function, not a literal color), which Chart.js
 *  calls with live chart context once the canvas exists. */
function verticalGradient(colorHex: string) {
  return (context: any) => {
    const { chart } = context;
    const { ctx, chartArea } = chart;
    if (!chartArea) return colorHex + '22';
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, colorHex + '55');
    gradient.addColorStop(1, colorHex + '02');
    return gradient;
  };
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule, ChartModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  readonly categories = LOAN_CATEGORIES;

  /** Tracks the OS/browser's light-vs-dark preference live. Previously
   *  `theme` read the page's CSS custom properties exactly once, at
   *  component construction — so every chart color was frozen at whichever
   *  theme happened to be active the moment this component was first built,
   *  and never updated again even after the system theme changed, short of
   *  a full page reload landing after the switch. Listening for the
   *  media-query's own `change` event and feeding it into a signal makes
   *  `theme()` below a proper Angular `computed()` that every chart already
   *  depends on — so flipping light/dark now repaints every chart's colors
   *  immediately, no reload required. */
  private readonly prefersDark = signal(
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );

  /** True only while the browser's print/"Save as PDF" pass is actually
   *  running (set on `beforeprint`, cleared on `afterprint` — see below).
   *  `theme()` forces the light palette whenever this is true, regardless
   *  of the real on-screen theme. Reasoning: printing a page's *background*
   *  colors is opt-in in Chrome (the "Background graphics" checkbox in
   *  print options, off by default), so a printed/PDF'd page almost always
   *  comes out with plain white cards no matter what theme is showing on
   *  screen — but a chart's colors are pixels baked into its own <canvas>,
   *  not a CSS background, so they print through regardless of that
   *  checkbox. Without this, dark-mode chart colors (a dark, low-contrast
   *  "remaining" navy, tiny "paid" slivers) would print correctly-dark but
   *  onto a page that's still stuck white — unreadable, and confusingly
   *  different from every other screenshot of this same page. Forcing
   *  light for the print pass keeps the printed chart legible against the
   *  white page it's actually going to land on. */
  private readonly isPrinting = signal(false);

  private readonly theme = computed(() => {
    this.prefersDark();
    if (this.isPrinting()) return LIGHT_CHART_COLORS;
    return themeColors();
  });

  /** Chart.js sizes each canvas's actual drawing surface to match its
   *  container at the moment it last measured it, via a ResizeObserver on
   *  `responsive: true`. Printing (Ctrl+P / "Save as PDF") re-lays-out the
   *  page at the print page's width — usually narrower than whatever
   *  browser window the page was last viewed in — but that ResizeObserver
   *  doesn't reliably get a chance to fire before the browser captures the
   *  printed page, so the canvas keeps drawing at its old, wider size:
   *  labels and legends end up positioned for a canvas wider than the box
   *  now displaying it, so they run off the edge or overlap. `beforeprint`
   *  fires synchronously as printing starts, with the print layout already
   *  in effect. Flipping `isPrinting` and forcing an Angular tick there
   *  pushes the (now light-forced) chart data/options into `<p-chart>`
   *  synchronously — PrimeNG's chart destroys and rebuilds the underlying
   *  Chart.js instance whenever those inputs change, so the rebuilt chart
   *  measures its real, current (print-narrowed) container from scratch,
   *  the same way any freshly-loaded chart would. The explicit `resize()`
   *  afterwards is just a defensive backstop for that same sizing problem
   *  in case a chart's inputs didn't happen to trigger a rebuild. */
  @ViewChild('monthlySpendChart') private monthlySpendChartRef?: UIChart;
  @ViewChild('payoffChart') private payoffChartRef?: UIChart;

  private resizeCharts(): void {
    [this.monthlySpendChartRef, this.payoffChartRef].forEach((c) => c?.chart?.resize());
  }

  constructor(public data: DataService, private appRef: ApplicationRef) {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', (e) => this.prefersDark.set(e.matches));
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeprint', () => {
        this.isPrinting.set(true);
        this.appRef.tick();
        this.resizeCharts();
      });
      window.addEventListener('afterprint', () => {
        this.isPrinting.set(false);
        this.appRef.tick();
        this.resizeCharts();
      });
    }
  }

  private readonly fontFamily = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";

  private readonly legendBase = computed(() => ({
    labels: { color: this.theme().text, usePointStyle: true, pointStyle: 'circle' as const, boxWidth: 8, boxHeight: 8, padding: 16, font: { family: this.fontFamily, size: 12 } },
  }));
  private readonly tooltipBase = computed(() => ({
    backgroundColor: this.theme().text,
    titleColor: this.theme().surface,
    bodyColor: this.theme().surface,
    padding: 10,
    cornerRadius: 8,
    displayColors: true,
    boxPadding: 4,
    titleFont: { family: this.fontFamily, weight: 600 as const },
    bodyFont: { family: this.fontFamily },
  }));
  private readonly gridOptionsBase = computed(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: { legend: { ...this.legendBase() }, tooltip: { ...this.tooltipBase() } },
    scales: {
      x: { ticks: { color: this.theme().text, font: { family: this.fontFamily, size: 11 } }, grid: { color: this.theme().grid + '55', drawBorder: false } },
      y: {
        ticks: { color: this.theme().text, font: { family: this.fontFamily, size: 11 }, callback: (v: number) => shortMoney(v) },
        grid: { color: this.theme().grid + '55', drawBorder: false },
        beginAtZero: true,
      },
    },
  }));

  /** Planned vs. paid vs. income, one line per series, across every logged month. */
  readonly monthlySpendChartData = computed(() => {
    const rows = this.data.monthlySpendTrend();
    const theme = this.theme();
    const mk = (label: string, color: string) => ({
      label,
      data: rows.map((r) => (r as any)[label.toLowerCase()]),
      borderColor: color,
      backgroundColor: color,
      pointBackgroundColor: color,
      pointBorderColor: theme.surface,
      pointBorderWidth: 2,
      pointRadius: 4,
      pointHoverRadius: 6,
      borderWidth: 2.5,
      tension: 0.35,
      fill: false,
    });
    return {
      labels: rows.map((r) => r.label),
      datasets: [mk('Income', theme.good), mk('Planned', theme.accent), mk('Paid', theme.warn)],
    };
  });
  readonly monthlySpendChartOptions = computed(() => ({
    ...this.gridOptionsBase(),
    plugins: {
      ...this.gridOptionsBase().plugins,
      tooltip: { ...this.tooltipBase(), callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${fullMoney(ctx.parsed.y)}` } },
    },
  }));

  /** Projected combined active balance shrinking to zero at the current EMI rate. */
  readonly payoffChartData = computed(() => {
    const p = this.data.payoffProjection();
    const theme = this.theme();
    return {
      labels: p.timeline.map((t) => t.label),
      datasets: [
        {
          label: 'Projected remaining balance',
          data: p.timeline.map((t) => t.remaining),
          borderColor: theme.danger,
          backgroundColor: verticalGradient(theme.danger),
          pointBackgroundColor: theme.danger,
          pointBorderColor: theme.surface,
          pointBorderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 6,
          borderWidth: 2.5,
          fill: true,
          tension: 0.3,
        },
      ],
    };
  });
  readonly payoffChartOptions = computed(() => ({
    ...this.gridOptionsBase(),
    plugins: {
      legend: { display: false },
      tooltip: { ...this.tooltipBase(), callbacks: { label: (ctx: any) => `Projected remaining: ${fullMoney(ctx.parsed.y)}` } },
    },
    scales: {
      ...this.gridOptionsBase().scales,
      x: { ...this.gridOptionsBase().scales.x, ticks: { ...this.gridOptionsBase().scales.x.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
    },
  }));

  readonly payoffSuggestionText = computed(() => {
    const p = this.data.payoffProjection();
    if (p.totalBalance <= 0) return 'All active loans are paid off — nothing left to project.';
    if (p.monthsToPayoff === null) {
      return "None of your active loans have a monthly EMI set, so there's not enough to project a close date from — add an EMI amount on a loan to see one.";
    }
    const dateStr = p.projectedDate!.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    let msg = `At your current combined EMI of ${this.fmtMoney(p.totalEmi)}/month, all active loans project to be fully closed by around ${dateStr} (~${p.monthsToPayoff} month${p.monthsToPayoff === 1 ? '' : 's'} from now).`;
    if (p.extraMonthly > 0 && p.monthsSavedWithExtra > 0) {
      msg += ` Paying an extra ${this.fmtMoney(p.extraMonthly)}/month across all loans (about 20% more) would close them roughly ${p.monthsSavedWithExtra} month${p.monthsSavedWithExtra === 1 ? '' : 's'} sooner.`;
    }
    msg += ' This is a straight-line projection from current balances and EMIs — it assumes no new loans and steady payments, so treat it as a rough guide, not a guarantee.';
    return msg;
  });

  readonly categoryBars = computed(() => {
    const totals = this.data.categoryTotals();
    const max = Math.max(1, ...Object.values(totals));
    return LOAN_CATEGORIES.map((c) => {
      const v = totals[c] || 0;
      return { name: c, value: v, pct: Math.max(2, Math.round((v / max) * 100)) };
    });
  });

  /** Builds the summary card data for an arbitrary month id, reading gracefully when there's no data yet. */
  monthCard(monthId: string) {
    const m = this.data.spends()[monthId];
    if (!m) return null;
    const entries = m.entries || [];
    const totalAmt = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const totalPaid = entries.reduce((s, e) => s + (Number(e.paidAmount) || 0), 0);
    const income = this.data.monthIncomeTotal(monthId);
    return {
      mid: monthId,
      label: m.label,
      income,
      totalAmt,
      totalPaid,
      // How much of the planned spend is still unpaid.
      balance: totalAmt - totalPaid,
      // If every planned expense were paid off, this is what would be left of this month's income.
      postPlannedBalance: income - totalAmt,
      // What's actually still in the bank right now — income minus only what's actually been paid so far.
      bankBalance: income - totalPaid,
      entries: entries.slice(0, 6),
    };
  }

  readonly thisMonthCard = computed(() => this.monthCard(this.data.currentMonthKey()));
  readonly previousMonthCard = computed(() => this.monthCard(this.data.previousMonthKey()));

  fmtMoney(n: number | null | undefined): string {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  }

  catSlug(category: string): string {
    return categorySlug(category);
  }

  catColorVar(category: string): string {
    return CATEGORY_COLOR_VAR[category as LoanCategory] || '--accent';
  }

  fmtMoneyShort(n: number): string {
    if (Math.abs(n) >= 100000) return '₹' + (n / 100000).toFixed(2).replace(/\.00$/, '') + 'L';
    return this.fmtMoney(n);
  }
}
