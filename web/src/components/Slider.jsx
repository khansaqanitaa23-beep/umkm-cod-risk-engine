import { colors, fonts } from '../config/uiTheme.js';

/**
 * Reusable labeled slider row. Purely presentational.
 *
 * Props:
 *   label    - string shown above the slider
 *   value    - current numeric value
 *   min/max/step
 *   onChange - (number) => void
 *   format   - (number) => string  (value display, e.g. formatIDR)
 */
export default function Slider({ label, value, min, max, step, onChange, format }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: colors.textSecondary }}>
          {label}
        </label>
        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: fonts.mono, color: colors.primary }}>
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
