/* eslint-disable camelcase */

/**
 * Adds `emi_tenure_months` to `credittrack.loans` — the total number of EMIs for
 * the loan, entered directly by the family instead of derived from
 * total_amount / emi.
 *
 * That derived ratio is only a rough estimate: it silently breaks for any
 * loan where the total actually repaid isn't the same as the amount
 * financed — a Magalir chit with a fixed 24-month term and dividends is the
 * case that surfaced this (total_amount 1,00,000 / emi 5,500 rounds up to
 * 19 months, when the chit's real term is 24). Once this column is set for
 * a loan it's treated as the source of truth for tenure/completion-date;
 * the amount/EMI ratio is only used as a fallback estimate when it's null.
 *
 * Run with: npm run migrate
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn({ schema: 'credittrack', name: 'loans' }, {
    emi_tenure_months: { type: 'integer' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn({ schema: 'credittrack', name: 'loans' }, 'emi_tenure_months');
};
