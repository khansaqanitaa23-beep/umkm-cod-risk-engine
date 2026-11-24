import { useMemo } from 'react';
import {
  Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { colors, fonts, layout } from '../config/uiTheme.js';
import {
  formatIDR, POLICIES, summarizePortfolio,
} from '../utils/riskEngine.js';
import KpiCard from './KpiCard.jsx';
import Slider from './Slider.jsx';

const LANE_LABELS = {
  [POLICIES.APPROVE_COD]: 'Green lane (COD approved)',
  [POLICIES.REQUIRE_DP]: 'Yellow lane (deposit required)',
  [POLICIES.BLOCK_COD]: 'Red lane (COD blocked)',
};

/**
 * PolicySimulator
 * ---------------
 * Left column: sliders for every UMKM assumption + policy strictness.
 * Right column: live KPIs, lane distribution donut, and the headline
 * "engine vs. naive allow-all-COD" profit comparison.
 *
 * All math re-runs client-side on every slider tick via summarizePortfolio().
 * `thresholds` is derived in App.jsx and shared with the other panels.
 */
export default function PolicySimulator({ orders, assumptions, setAssumptions, strictness, setStrictness, thresholds }) {
  const summary = useMemo(
    () => summarizePortfolio(orders, assumptions, thresholds),
    [orders, assumptions, thresholds]
  );

  const laneData = Object.entries(summary.totals).map(([policy, t]) => ({
    name: LANE_LABELS[policy],
    value: t.count,
    fill: colors.lane[policy],
  }));

  const profitData = [
    { name: 'Naive (all COD)', profit: Math.round(summary.naiveExpectedProfit), fill: colors.textSecondary },
    { name: 'Risk engine', profit: Math.round(summary.engineExpectedProfit), fill: colors.primary },
  ];

  const saved = summary.profitSaved;
  const savedPct = summary.naiveExpectedProfit
    ? (saved / Math.abs(summary.naiveExpectedProfit)) * 100
    : 0;

  const set = (key) => (v) => setAssumptions((a) => ({ ...a, [key]: v }));

  return (
    <section>
      <h2 style={{ fontSize: 22, marginBottom: 4 }}>Policy Simulator</h2>
      <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 20 }}>
        Move the sliders — every number recomputes live from the per-order expected
        profit formula. No server involved.
      </p>

      <div style={{ display: 'flex', gap: layout.gap, flexWrap: 'wrap' }}>
        {/* --- Controls ----------------------------------------------------- */}
        <div
          style={{
            flex: '0 0 320px',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: layout.cardRadius,
            padding: layout.cardPadding,
          }}
        >
          <h3 style={{ fontSize: 14, marginBottom: 16, color: colors.textPrimary }}>
            Business assumptions
          </h3>
          <Slider label="Gross margin" value={assumptions.grossMarginRate}
            min={0.10} max={0.50} step={0.01} onChange={set('grossMarginRate')}
            format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Return shipping cost" value={assumptions.returnShippingIdr}
            min={15000} max={80000} step={1000} onChange={set('returnShippingIdr')}
            format={formatIDR} />
          <Slider label="Packaging loss per refusal" value={assumptions.packagingLossIdr}
            min={0} max={30000} step={1000} onChange={set('packagingLossIdr')}
            format={formatIDR} />
          <Slider label="QRIS deposit amount (DP)" value={assumptions.depositAmountIdr}
            min={10000} max={50000} step={1000} onChange={set('depositAmountIdr')}
            format={formatIDR} />
          <Slider label="Capital hold period" value={assumptions.avgCapitalHoldDays}
            min={3} max={30} step={1} onChange={set('avgCapitalHoldDays')}
            format={(v) => `${v} days`} />

          <h3 style={{ fontSize: 14, margin: '8px 0 16px', color: colors.textPrimary }}>
            Policy strictness
          </h3>
          <Slider label="Stricter →" value={strictness}
            min={-0.06} max={0.12} step={0.005} onChange={setStrictness}
            format={(v) => (v === 0 ? 'default' : v > 0 ? `+${(v * 100).toFixed(1)} stricter` : `${(v * 100).toFixed(1)} looser`)} />
          <p style={{ fontSize: 11, color: colors.textSecondary, lineHeight: 1.5 }}>
            Block at p ≥ {(thresholds.blockProbability * 100).toFixed(1)}% ·
            DP at p ≥ {(thresholds.dpProbability * 100).toFixed(1)}%
          </p>
        </div>

        {/* --- Results -------------------------------------------------------- */}
        <div style={{ flex: 1, minWidth: 340 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <KpiCard title="Engine expected profit" value={formatIDR(summary.engineExpectedProfit)} />
            <KpiCard title="Naive (all COD)" value={formatIDR(summary.naiveExpectedProfit)} />
            <KpiCard
              title="Profit protected"
              value={formatIDR(saved)}
              subtitle={`${savedPct >= 0 ? '+' : ''}${savedPct.toFixed(1)}% vs naive`}
              tone={saved >= 0 ? 'good' : 'bad'}
            />
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {/* Lane donut */}
            <div style={chartCardStyle}>
              <h4 style={chartTitleStyle}>Checkout lanes</h4>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={laneData} dataKey="value" nameKey="name"
                    innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {laneData.map((d) => <Cell key={d.name} fill={d.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${v} orders`, n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Engine vs naive */}
            <div style={chartCardStyle}>
              <h4 style={chartTitleStyle}>Expected profit comparison</h4>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={profitData} layout="vertical" margin={{ left: 20, right: 30 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={110}
                    tick={{ fontSize: 11, fill: colors.textSecondary }} />
                  <Tooltip formatter={(v) => formatIDR(v)} />
                  <Bar dataKey="profit" radius={[0, 6, 6, 0]}>
                    {profitData.map((d) => <Cell key={d.name} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const chartCardStyle = {
  flex: 1,
  minWidth: 280,
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: layout.cardRadius,
  padding: layout.cardPadding,
};

const chartTitleStyle = {
  fontSize: 13,
  color: colors.textPrimary,
  marginBottom: 8,
  fontFamily: fonts.heading,
};
