/* eslint-disable camelcase */

/**
 * Initial schema for CrediTrack.
 *
 * Everything lives in a dedicated `credittrack` schema (not `public`) — standard
 * practice for a single-purpose app database so it can share a Postgres
 * instance with other apps/schemas without collisions, and so a
 * least-privilege app role can be scoped to exactly this schema.
 *
 * Run with: npm run migrate   (wraps `node-pg-migrate up`)
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createSchema('credittrack', { ifNotExists: true });

  // ----------------------------------------------------------------
  // loans (active)
  // ----------------------------------------------------------------
  pgm.createTable(
    { schema: 'credittrack', name: 'loans' },
    {
      id: { type: 'text', primaryKey: true },
      name: { type: 'text', notNull: true },
      category: {
        type: 'text',
        notNull: true,
        check:
          "category IN ('App Loans','Bank Loans','Credit Cards','Individual Loans','Magalir Loans / Chits / Gold','Family Credit Funds / Other')",
      },
      total_amount: { type: 'numeric', notNull: true, default: 0 },
      total_outstanding: { type: 'numeric' },
      settled_amount: { type: 'numeric' },
      balance: { type: 'numeric', notNull: true, default: 0 },
      emi: { type: 'numeric' },
      status: {
        type: 'text',
        notNull: true,
        default: 'active',
        check: "status IN ('active','settlement','discussion','closed')",
      },
      progress: { type: 'text', notNull: true, default: '' },
      remarks: { type: 'text', notNull: true, default: '' },
      order: { type: 'integer', notNull: true, default: 0 },
      settlement_letter: { type: 'jsonb' },
      noc_copy: { type: 'jsonb' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }
  );
  pgm.createIndex({ schema: 'credittrack', name: 'loans' }, 'status');
  pgm.createIndex({ schema: 'credittrack', name: 'loans' }, 'category');

  // ----------------------------------------------------------------
  // closed_loans
  // ----------------------------------------------------------------
  pgm.createTable(
    { schema: 'credittrack', name: 'closed_loans' },
    {
      id: { type: 'text', primaryKey: true },
      name: { type: 'text', notNull: true },
      category: {
        type: 'text',
        notNull: true,
        check:
          "category IN ('App Loans','Bank Loans','Credit Cards','Individual Loans','Magalir Loans / Chits / Gold','Family Credit Funds / Other')",
      },
      original_amount: { type: 'numeric', notNull: true, default: 0 },
      settled_amount: { type: 'numeric', notNull: true, default: 0 },
      amount_paid: { type: 'numeric', notNull: true, default: 0 },
      balance_remaining: { type: 'numeric', notNull: true, default: 0 },
      date_paid: { type: 'text' },
      source: { type: 'text', notNull: true, default: '' },
      remarks: { type: 'text', notNull: true, default: '' },
      order: { type: 'integer', notNull: true, default: 0 },
      settlement_letter: { type: 'jsonb' },
      noc_copy: { type: 'jsonb' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }
  );
  pgm.createIndex({ schema: 'credittrack', name: 'closed_loans' }, 'category');

  // ----------------------------------------------------------------
  // spend_months / incomes / spend_entries
  // ----------------------------------------------------------------
  pgm.createTable(
    { schema: 'credittrack', name: 'spend_months' },
    {
      id: { type: 'text', primaryKey: true }, // "YYYY-MM"
      label: { type: 'text', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }
  );

  pgm.createTable(
    { schema: 'credittrack', name: 'incomes' },
    {
      id: { type: 'text', primaryKey: true },
      month_id: {
        type: 'text',
        notNull: true,
        references: { schema: 'credittrack', name: 'spend_months' },
        onDelete: 'CASCADE',
      },
      label: { type: 'text', notNull: true },
      amount: { type: 'numeric', notNull: true, default: 0 },
      order: { type: 'integer', notNull: true, default: 0 },
    }
  );
  pgm.createIndex({ schema: 'credittrack', name: 'incomes' }, 'month_id');

  pgm.createTable(
    { schema: 'credittrack', name: 'spend_entries' },
    {
      id: { type: 'text', primaryKey: true },
      month_id: {
        type: 'text',
        notNull: true,
        references: { schema: 'credittrack', name: 'spend_months' },
        onDelete: 'CASCADE',
      },
      name: { type: 'text', notNull: true },
      date: { type: 'text', notNull: true, default: '' },
      amount: { type: 'numeric', notNull: true, default: 0 },
      paid_amount: { type: 'numeric' },
      type: { type: 'text', notNull: true, default: 'expense', check: "type IN ('expense','settlement')" },
      remarks: { type: 'text', notNull: true, default: '' },
      applied: { type: 'boolean', notNull: true, default: false },
      order: { type: 'integer', notNull: true, default: 0 },
    }
  );
  pgm.createIndex({ schema: 'credittrack', name: 'spend_entries' }, 'month_id');

  // ----------------------------------------------------------------
  // app_meta — single row (id fixed to 1)
  // ----------------------------------------------------------------
  pgm.createTable(
    { schema: 'credittrack', name: 'app_meta' },
    {
      id: { type: 'integer', primaryKey: true, default: 1, check: 'id = 1' },
      family_label: { type: 'text', notNull: true, default: 'Family' },
      currency: { type: 'text', notNull: true, default: 'INR' },
      seeded_from: { type: 'text' },
      seeded_at: { type: 'text' },
      drive_folder_id: { type: 'text' },
    }
  );

  // ----------------------------------------------------------------
  // updated_at auto-touch trigger — set at the database layer so it's
  // correct regardless of which application code writes the row.
  // ----------------------------------------------------------------
  pgm.sql(`
    CREATE OR REPLACE FUNCTION credittrack.set_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  for (const table of ['loans', 'closed_loans', 'spend_months']) {
    pgm.sql(`
      CREATE TRIGGER trg_${table}_updated_at
      BEFORE UPDATE ON credittrack.${table}
      FOR EACH ROW EXECUTE FUNCTION credittrack.set_updated_at();
    `);
  }
};

exports.down = (pgm) => {
  pgm.dropSchema('credittrack', { cascade: true, ifExists: true });
};
