/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  // Karna already ships its own global reset (styles.scss) and PrimeNG ships
  // its own base styles for every widget it renders. Tailwind's preflight
  // reset (default margins/borders/button styling stripped, headings
  // unstyled, etc.) would fight both of those instead of layering cleanly
  // alongside them — so it's switched off here. Tailwind is added purely as
  // a utility-class toolkit for restyling markup, not as a second reset.
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      // Mapped onto the app's own CSS custom properties (styles.scss)
      // instead of hardcoded hex, so a utility like `bg-surface` or
      // `text-muted` automatically follows the same light/dark switching
      // every hand-rolled and PrimeNG-themed element already uses, and a
      // future token tweak in one place updates Tailwind utilities too.
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-alt": "var(--surface-alt)",
        border: "var(--border)",
        "border-soft": "var(--border-soft)",
        text: "var(--text)",
        "text-muted": "var(--text-muted)",
        "text-faint": "var(--text-faint)",
        accent: "var(--accent)",
        "accent-strong": "var(--accent-strong)",
        good: "var(--good)",
        warn: "var(--warn)",
        danger: "var(--danger)",
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "var(--radius-sm)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
      },
      fontFamily: {
        head: "var(--font-head)",
        body: "var(--font-body)",
        mono: "var(--font-mono)",
      },
    },
  },
  plugins: [],
};
