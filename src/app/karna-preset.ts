import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';

/**
 * A thin customization of PrimeNG's Aura preset that maps the app's own
 * brand blue (var(--accent) / var(--accent-strong) in styles.scss) onto
 * PrimeNG's `primary` semantic palette, so PrimeNG components (buttons,
 * tags, inputs, the actions menu, etc.) read as part of the same "Karna
 * Credit" identity instead of Aura's default emerald green. Everything
 * else — surface grays, severity colors (success/warn/danger used by
 * p-tag), spacing, dark mode — is left as Aura's own defaults, which
 * already adapt correctly to the OS dark-mode preference the same way
 * styles.scss does.
 */
export const KarnaPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#EFF4FD',
      100: '#DCE7FB',
      200: '#B9CFF7',
      300: '#8FB0F0',
      400: '#5C87E5',
      500: '#3566D6',
      600: '#1D56C7',
      700: '#17449E',
      800: '#143E96',
      900: '#102F70',
      950: '#0A1F4A',
    },
    colorScheme: {
      light: {
        // Aura's own defaults (slate.700 / slate.500) read a little washed
        // out for table/form text — matched to the same darker tokens as
        // styles.scss's --text / --text-muted so PrimeNG-rendered text
        // (table cells, form fields, muted placeholders) is exactly as dark
        // as the app's own custom text everywhere else.
        text: {
          color: '#0E1830',
          mutedColor: '#3C4A6B',
        },
      },
      dark: {
        // Aura's default dark scheme builds every card/table/dialog/input
        // background from its own generic `surface` scale (zinc grays —
        // surface.900 ends up literally #18181b), which has nothing to do
        // with styles.scss's custom navy dark palette (--bg #0B1526,
        // --surface #111E36, --surface-alt #15233F, --border-soft #2E4470).
        // The result: PrimeNG-rendered cards/tables/menus/dialogs painted
        // in a near-black gray that barely differs from the page background
        // OR from our own hand-rolled elements — card boundaries vanish and
        // the whole page reads as one flat, "scattered" block with no
        // visual hierarchy. Anchoring this scale to the exact same navy
        // tokens makes every PrimeNG surface (p-card, p-table, p-dialog,
        // p-select overlay, p-menu, inputs) consistent with the rest of the
        // app, since Aura's dark tokens for content/overlay/formField are
        // all defined as references to `{surface.700..950}`, not hardcoded
        // — fixing this one scale cascades through all of them.
        surface: {
          0: '#ffffff',
          50: '#EAF0FF',
          100: '#CBD8F5',
          200: '#A8BBE8',
          300: '#8DA3D6',
          400: '#6F86B8',
          500: '#55699C',
          600: '#3F5080',
          700: '#2E4470',
          800: '#15233F',
          900: '#111E36',
          950: '#0B1526',
        },
        text: {
          color: '#EAF0FF',
          mutedColor: '#9FB0D6',
        },
        formField: {
          // Matches styles.scss's hand-rolled `.field input/select/textarea`
          // (background: var(--surface)) so native and PrimeNG-rendered
          // form fields look identical instead of one being darker than
          // the other.
          background: '#111E36',
          color: '#EAF0FF',
          placeholderColor: '#8494C2',
        },
      },
    },
  },
});
