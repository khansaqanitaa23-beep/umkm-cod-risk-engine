import { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { colors, fonts, layout } from '../config/uiTheme.js';
import { formatIDR, formatPercent, POLICIES, routeOrder } from '../utils/riskEngine.js';

const LANE_COLORS = {
  [POLICIES.APPROVE_COD]: colors.lane.APPROVE_COD,
  [POLICIES.REQUIRE_DP]: colors.lane.REQUIRE_DP,
  [POLICIES.BLOCK_COD]: colors.lane.BLOCK_COD,
};

/**
 * OrderInspector
 * --------------
 * Searchable risk-ranked table (left) + drill-down panel (right) showing:
 *   - the order's checkout facts
 *   - the expected-profit math in plain rupiah
 *   - the top-3 SHAP explanations as a divergence bar chart
 */
export default function OrderInspector({ orders, assumptions, thresholds }) {
  const [query, setQuery] = useState('');
  const [laneFilter, setLaneFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState(null);

  // Route every order once per assumption/threshold change.
  const routed = useMemo(
    () =>
      orders
        .map((o) => ({ ...o, routing: routeOrder(o, assumptions, thresholds) }))
        .sort((a, b) => b.routing.pRefusal - a.routing.pRefusal),
    [orders, assumptions, thresholds]
  );

  const visible = useMemo(
    () =>
      routed.filter((o) => {
        if (laneFilter !== 'ALL' && o.routing.policy !== laneFilter) return false;
        if (query && !o.order_id.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      }),
    [routed, query, laneFilter]
  );

  const selected = routed.find((o) => o.order_id === selectedId) || routed[0];

  return (
    <section style={{ marginTop: 48 }}>
      <h2 style={{ fontSize: 22, marginBottom: 4 }}>Order Inspector</h2>
      <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 20 }}>
        Every order, ranked by calibrated refusal risk. Click one to see exactly
        why the engine scored it — and what the rupiah math says.
      </p>

      <div style={{ display: 'flex', gap: layout.gap, flexWrap: 'wrap' }}>
        {/* --- Table -------------------------------------------------------- */}
        <div style={{ flex: 1, minWidth: 380 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              type="text"
              placeholder="Search order ID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={inputStyle}
            />
            <select value={laneFilter} onChange={(e) => setLaneFilter(e.target.value)} style={inputStyle}>
              <option value="ALL">All lanes</option>
              <option value={POLICIES.APPROVE_COD}>Green</option>
              <option value={POLICIES.REQUIRE_DP}>Yellow</option>
              <option value={POLICIES.BLOCK_COD}>Red</option>
            </select>
          </div>

          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {visible.slice(0, 200).map((o) => (
                <button
                  key={o.order_id}
                  onClick={() => setSelectedId(o.order_id)}
                  style={{
                    ...rowStyle,
                    background:
                      o.order_id === selected.order_id ? colors.surface : 'transparent',
                    borderLeft: `4px solid ${LANE_COLORS[o.routing.policy]}`,
                  }}
                >
                  <span style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.textSecondary }}>
                    {o.order_id.slice(0, 8)}…
                  </span>
                  <span style={{ fontFamily: fonts.mono, fontSize: 12 }}>
                    {formatIDR(o.order_value_idr)}
                  </span>
                  <span
                    style={{
                      fontFamily: fonts.mono, fontSize: 12, fontWeight: 700,
                      color: LANE_COLORS[o.routing.policy],
                    }}
                  >
                    {formatPercent(o.routing.pRefusal)}
                  </span>
                </button>
              ))}
            </div>
            <div style={{ padding: 8, fontSize: 11, color: colors.textSecondary, borderTop: `1px solid ${colors.border}` }}>
              Showing {Math.min(visible.length, 200)} of {visible.length} orders
            </div>
          </div>
        </div>

        {/* --- Detail panel --------------------------------------------------- */}
        {selected && (
          <div
            style={{
              flex: '0 0 400px',
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: layout.cardRadius,
              padding: layout.cardPadding,
            }}
          >
            <DetailPanel order={selected} assumptions={assumptions} />
          </div>
        )}
      </div>
    </section>
  );
}

function DetailPanel({ order, assumptions }) {
  const r = order.routing;
  const margin = order.order_value_idr * assumptions.grossMarginRate;
  const holdCost =
    order.order_value_idr * assumptions.capitalHoldDailyRate * assumptions.avgCapitalHoldDays;
  const loss = assumptions.returnShippingIdr + assumptions.packagingLossIdr + holdCost;

  const shapData = [...order.shap_top]
    .sort((a, b) => a.relative_weight - b.relative_weight)
    .map((s) => ({
      name: s.label.length > 34 ? `${s.label.slice(0, 34)}…` : s.label,
      weight: s.direction === 'raises_risk' ? s.relative_weight : -s.relative_weight,
      direction: s.direction,
    }));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.textSecondary }}>
          {order.order_id.slice(0, 16)}…
        </span>
        <span
          style={{
            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
            background: LANE_COLORS[r.policy], color: '#fff',
          }}
        >
          {r.policy.replace('_', ' ')}
        </span>
      </div>

      <div style={{ fontSize: 32, fontWeight: 700, fontFamily: fonts.mono, color: LANE_COLORS[r.policy] }}>
        {formatPercent(r.pRefusal)}
      </div>
      <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 16 }}>
        calibrated refusal probability
      </div>

      {/* The rupiah math, line by line */}
      <div style={{ fontSize: 12, lineHeight: 2, fontFamily: fonts.mono, marginBottom: 16 }}>
        <Row k="Order value" v={formatIDR(order.order_value_idr)} />
        <Row k={`Gross margin (${Math.round(assumptions.grossMarginRate * 100)}%)`} v={`+${formatIDR(margin)}`} />
        <Row k="Return shipping" v={`−${formatIDR(assumptions.returnShippingIdr)}`} />
        <Row k="Packaging loss" v={`−${formatIDR(assumptions.packagingLossIdr)}`} />
        <Row k="Capital hold cost" v={`−${formatIDR(holdCost)}`} />
        <div style={{ borderTop: `1px dashed ${colors.border}`, margin: '4px 0' }} />
        <Row k="Expected profit (COD)" v={formatIDR(r.expectedProfit)}
          strong tone={r.expectedProfit >= 0 ? 'good' : 'bad'} />
        <Row k="Expected profit (with DP)" v={formatIDR(r.expectedProfitWithDp)} strong />
        <Row k="If COD blocked (prepay)" v={formatIDR(r.expectedProfitIfBlocked)} strong />
        {order.actual_outcome && (
          <Row k="Actual outcome (data)" v={order.actual_outcome} />
        )}
      </div>

      {/* SHAP explanations */}
      <h4 style={{ fontSize: 13, marginBottom: 8 }}>Why this score? (SHAP top-3)</h4>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={shapData} layout="vertical" margin={{ left: 8, right: 16, top: 0, bottom: 0 }}>
          <XAxis type="number" hide domain={[-1, 1]} />
          <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 10, fill: colors.textSecondary }} />
          <Tooltip
            formatter={(v) => [`${(Math.abs(v) * 100).toFixed(0)}% of explanation weight`]}
          />
          <Bar dataKey="weight" radius={[0, 4, 4, 0]}>
            {shapData.map((d) => (
              <Cell
                key={d.name}
                fill={d.direction === 'raises_risk' ? colors.lane.BLOCK_COD : colors.accent}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p style={{ fontSize: 10, color: colors.textSecondary, marginTop: 6 }}>
        Bars show each factor's share of the total explanation weight
        (red = raises risk, green = lowers risk).
      </p>
    </>
  );
}

function Row({ k, v, strong, tone }) {
  const c = tone === 'good' ? colors.accent : tone === 'bad' ? colors.lane.BLOCK_COD : colors.textPrimary;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: colors.textSecondary }}>{k}</span>
      <span style={{ fontWeight: strong ? 700 : 400, color: c }}>{v}</span>
    </div>
  );
}

const inputStyle = {
  flex: 1,
  padding: '8px 12px',
  fontSize: 13,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  fontFamily: fonts.body,
  outline: 'none',
};

const rowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  padding: '10px 14px',
  border: 'none',
  borderBottom: `1px solid ${colors.border}`,
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: fonts.body,
};
