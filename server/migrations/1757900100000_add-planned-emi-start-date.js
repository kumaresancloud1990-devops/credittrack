/* eslint-disable camelcase */

/**
 * Adds `planned_emi_start_date` to `credittrack.loans` — the date the family
 * expects the first EMI to go out for a loan. Combined with `total_amount`
 * and `emi` on the frontend, this drives the "tenure / completion date"
 * display on Active Loans.
 *
 * Stored as `text` ("YYYY-MM-DD"), matching the existing convention in this
 * schema for date-ish fields (closed_loans.date_paid, spend_entries.date) —
 * avoids node-postgres handing back a JS Date (with its timezone quirks)
 * for what is really just a plain calendar date typed by a person.
 *
 * Run with: npm run migrate
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn({ schema: 'credittrack', name: 'loans' }, {
    planned_emi_start_date: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn({ schema: 'credittrack', name: 'loans' }, 'planned_emi_start_date');
};
