import { LoanCategory } from './loan.model';

/**
 * Turns a loan category name into the CSS class slug used by the
 * `.cat-dot.c-*` rules in styles.scss (e.g. "Magalir Loans / Chits / Gold"
 * -> "c-magalir-loans-chits-gold"). Keeping this as one shared function
 * means the slug logic only has to be right in one place.
 */
export function categorySlug(category: string): string {
  return (
    'c-' +
    String(category)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

/** The CSS custom-property name (e.g. "--cat-app") holding this category's accent colour. */
export const CATEGORY_COLOR_VAR: Record<LoanCategory, string> = {
  'App Loans': '--cat-app',
  'Bank Loans': '--cat-bank',
  'Credit Cards': '--cat-cards',
  'Individual Loans': '--cat-individual',
  'Magalir Loans / Chits / Gold': '--cat-magalir',
  'Family Credit Funds / Other': '--cat-family',
};
