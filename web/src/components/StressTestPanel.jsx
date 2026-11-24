import { useMemo, useState } from 'react';
import {
  Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { colors, fonts, layout } from '../config/uiTheme.js';
import { formatIDR, POLICIES, summarizePortfolio } from '../utils/riskEngine.js';
import KpiCard from './KpiCard.jsx';
import Slider from './Slider.jsx';

/**
 * StressTestPanel — "Harbolnas 11.11" scenario
 * ---------------------------------------------
 * Simulates a shopping-festival shock and shows whether the policy engine
 * keeps the business profitable:
 *
 *   - Refusal risk multiplier: festive impulse buying + courier delays push
 *     refusal probabilities up.
 *   - Margin squeeze: festival discounts cut gross margin.
 *   - Slower reverse logistics: refused parcels take longer to come back,
 *     extending the capital-hold period.
 *   - Volume multiplier: scales headline totals (per-order math is unchanged).
 *
 * The engine's policy thresholds are held fixed — the point is that a policy
 * calibrated on normal days still protects you on crazy days.
 */
export default function StressTestPanel({ orders, assumptions, thresholds }) {
  const [refusalMultiplier, setRefusalMultiplier] = useState(1.8);
  const [marginDrop, setMarginDrop] = useState(0.08);
  const [extraHoldDays, setExtraHoldDays] = useState(4);
  const [volumeMultiplier, setVolumeMultiplier] = useState(3);

  const scenario = useMemo(() => {
    const stressedAssumptions = {
      ...assumptions,
      grossMarginRate: Math.max(0.01, assumptions.grossMarginRate - marginDrop),
      avgCapitalHoldDays: assumptions.avgCapitalHoldDays + extraHoldDays,
    };
    // Shock the refusal probabilities (festival regret + courier strain).
    const stressedOrders = orders.map((o) => ({
      ...o,
      p_refusal_calibrated: Math.min(o.p_refusal_calibrated * refusalMultiplier, 0.95),
    }));
    return {
      summary: summarizePortfolio(stressedOrders, stressedAssumptions, thresholds),
      stressedAssumptions,
    };
  }, [orders, assumptions, thresholds, refusalMultiplier, marginDrop, extraHoldDays]);

  const s = scenario.summary;
  const scaled = (x) => x * volumeMultiplier;

  const laneData = [
    { name: 'Green', count: s.totals[POLICIES.APPROVE_COD].count, fill: colors.lane.APPROVE_COD },
    { name: 'Yellow (DP)', count: s.totals[POLICIES.REQUIRE_DP].count, fill: colors.lane.REQUIRE_DP },
    { name: 'Red (blocked)', count: s.totals[POLICIES.BLOCK_COD].count, fill: colors.lane.BLOCK_COD },
  ];

  const saved = s.profitSaved;
  const naiveSurvives = s.naiveExpectedProfit > 0;
  const engineSurvives = s.engineExpectedProfit > 0;

  return (
    <section style={{ marginTop: 48 }}>
      <h2 style={{ fontSize: 22, marginBottom: 4 }}>Harbolnas 11.11 Stress Test</h2>
      <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 20 }}>
        What happens when order volume explodes, couriers run late, and
        impulse-buy regret peaks? The policy thresholds stay fixed — this tests
        whether the engine is robust, not tuned to the scenario.
      </p>

      <div style={{ display: 'flex', gap: layout.gap, flexWrap: 'wrap' }}>
        <div
          style={{
            flex: '0 0 320px',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: layout.cardRadius,
            padding: layout.cardPadding,
          }}
        >
          <h3 style={{ fontSize: 14, marginBottom: 16 }}>Festival shock knobs</h3>
          <Slider label="Refusal risk multiplier" value={refusalMultiplier}
            min={1} max={3} step={0.1} onChange={setRefusalMultiplier}
            format={(v) => `×${v.toFixed(1)}`} />
          <Slider label="Margin squeeze (discounts)" value={marginDrop}
            min={0} max={0.20} step={0.01} onChange={setMarginDrop}
            format={(v) => `−${Math.round(v * 100)} pts`} />
          <Slider label="Extra reverse-logistics delay" value={extraHoldDays}
            min={0} max={10} step={1} onChange={setExtraHoldDays}
            format={(v) => `+${v} days`} />
          <Slider label="Order volume" value={volumeMultiplier}
            min={1} max={5} step={0.5} onChange={setVolumeMultiplier}
            format={(v) => `×${v.toFixed(1)}`} />
          <p style={{ fontSize: 11, color: colors.textSecondary, lineHeight: 1.5 }}>
            Stressed margin: {(scenario.stressedAssumptions.grossMarginRate * 100).toFixed(0)}% ·
            capital hold: {scenario.stressedAssumptions.avgCapitalHoldDays} days
          </p>
        </div>

        <div style={{ flex: 1, minWidth: 340 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <KpiCard
              title={`Engine profit (×${volumeMultiplier} volume)`}
              value={formatIDR(scaled(s.engineExpectedProfit))}
              tone={engineSurvives ? 'good' : 'bad'}
              subtitle={engineSurvives ? 'Business survives the festival' : 'Business loses money'}
            />
            <KpiCard
              title="Naive all-COD profit"
              value={formatIDR(scaled(s.naiveExpectedProfit))}
              tone={naiveSurvives ? 'default' : 'bad'}
              subtitle={naiveSurvives ? 'Still profitable' : 'Loss-making under stress'}
            />
            <KpiCard
              title="Festival damage prevented"
              value={formatIDR(scaled(saved))}
              tone={saved >= 0 ? 'good' : 'bad'}
            />
          </div>

          <div style={chartCardStyle}>
            <h4 style={chartTitleStyle}>Lane migration under stress</h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={laneData} margin={{ left: 0, right: 16, top: 8, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: colors.textSecondary }} />
                <YAxis tick={{ fontSize: 11, fill: colors.textSecondary }} />
                <Tooltip formatter={(v) => [`${v} orders`]} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {laneData.map((d) => <Cell key={d.name} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p style={{ fontSize: 11, color: colors.textSecondary, marginTop: 8 }}>
              As refusal risk inflates, borderline orders migrate green → yellow → red —
              the bouncer tightens automatically while honest buyers keep their COD.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const chartCardStyle = {
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
