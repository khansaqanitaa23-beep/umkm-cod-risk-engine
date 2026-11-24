import { colors, fonts } from '../config/uiTheme.js';

/**
 * Small KPI card used across the dashboard.
 * tone: 'default' | 'good' | 'bad' — controls the value color.
 */
export default function KpiCard({ title, value, subtitle, tone = 'default' }) {
  const valueColor =
    tone === 'good' ? colors.accent : tone === 'bad' ? colors.lane.BLOCK_COD : colors.textPrimary;

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: '14px 18px',
        minWidth: 160,
        flex: 1,
      }}
    >
      <div style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: fonts.mono, color: valueColor }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 4 }}>{subtitle}</div>
      )}
    </div>
  );
}
