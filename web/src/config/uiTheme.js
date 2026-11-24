/**
 * uiTheme.js
 * -----------------------------------------------------------------------------
 * Single source of truth for the dashboard's look & feel.
 * Direction: "Bright Indonesian market" — white base, orange primary,
 * green accent. Import from here; never hardcode hex values in components.
 * -----------------------------------------------------------------------------
 */

export const colors = {
  // Base
  background: '#FFFFFF',
  surface: '#FFF9F3',        // warm off-white for cards
  border: '#F0E4D7',

  // Brand
  primary: '#F26522',        // pasar orange — buttons, active states
  primaryDark: '#C74E14',
  accent: '#1F9D55',         // market green — positive numbers, success
  accentDark: '#157A3E',

  // Policy lanes (map to POLICIES in riskEngine.js)
  lane: {
    APPROVE_COD: '#1F9D55',  // green
    REQUIRE_DP: '#F5A623',   // amber — sits between orange brand and red
    BLOCK_COD: '#D64545',    // red
  },

  // Text
  textPrimary: '#2B2118',
  textSecondary: '#7A6A5C',
  textOnPrimary: '#FFFFFF',

  // Charts (Recharts series order)
  chartSeries: ['#F26522', '#1F9D55', '#3B82C4', '#8B5CF6', '#F5A623'],
  chartGrid: '#F0E4D7',
};

export const fonts = {
  heading: "'Poppins', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace", // numbers & order IDs
};

export const layout = {
  maxWidth: '1200px',
  cardRadius: '12px',
  cardPadding: '20px',
  gap: '16px',
};

export const shadows = {
  card: '0 1px 3px rgba(43, 33, 24, 0.08)',
  cardHover: '0 4px 12px rgba(43, 33, 24, 0.12)',
};

export default { colors, fonts, layout, shadows };
