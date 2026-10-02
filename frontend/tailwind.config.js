/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // NOTE: "green" is a legacy name from an earlier reskin - these
        // are actually maroon (green-700 = #9f1d1d), not green. Kept
        // as-is so nothing already using bg-green-700 etc. breaks.
        // `primary` below is the same palette under its correct name -
        // new/migrated code should reach for `primary-*`, not `green-*`.
        green: {
          50: '#fdf3f2',
          100: '#fbe4e4',
          200: '#f7c8c8',
          300: '#f0a2a2',
          400: '#e46e6e',
          500: '#d54141',
          600: '#be2929',
          700: '#9f1d1d',
          800: '#841c1c',
          900: '#630702',
          950: '#3f0200',
        },
        primary: {
          50: '#fdf3f2',
          100: '#fbe4e4',
          200: '#f7c8c8',
          300: '#f0a2a2',
          400: '#e46e6e',
          500: '#d54141',
          600: '#be2929',
          700: '#9f1d1d',
          800: '#841c1c',
          900: '#630702',
          950: '#3f0200',
        },
        // A real green, for "this worked".
        //
        // Needed because `green` above is maroon, so bg-green-50 with
        // text-green-800 - the usual way to write a success banner - comes
        // out the same pink as bg-red-50 with text-red-700. An operator
        // pasting a price sheet then cannot tell at a glance whether it
        // saved or was rejected. Use `success-*` for confirmation states and
        // `red-*` for failures; `primary-*` remains the brand colour.
        success: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        risk: {
          critical: "#dc2626",
          high: "#ea580c",
          medium: "#d97706",
          low: "#65a30d",
          info: "#0284c7",
        },
      },
    },
  },
  plugins: [],
};
