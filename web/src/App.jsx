import { useMemo, useState } from 'react';
import OrderInspector from './components/OrderInspector.jsx';
import PolicySimulator from './components/PolicySimulator.jsx';
import StressTestPanel from './components/StressTestPanel.jsx';
import { colors, fonts, layout } from './config/uiTheme.js';
import { useScoredOrders } from './hooks/useScoredOrders.js';
import { DEFAULT_ASSUMPTIONS, formatPercent } from './utils/riskEngine.js';
import './styles/global.css';

/**
 * App — layout shell + shared state.
 *
 * State ownership:
 *   - assumptions : business numbers (margins, costs) — owned here so the
 *                   PolicySimulator, OrderInspector and StressTestPanel all
 *                   react to the same values.
 *   - strictness  : shifts policy thresholds; the derived `thresholds`
 *                   object is computed HERE once and passed down.
 */
export default function App() {
  const { data, error, loading } = useScoredOrders();
  const [assumptions, setAssumptions] = useState(null);
  const [strictness, setStrictness] = useState(0);

  // Hydrate slider defaults from the JSON once it arrives, layered over the
  // engine's own DEFAULT_ASSUMPTIONS so any key missing from the JSON
  // (e.g. dpDeterrenceFactor) still has a safe value.
  const effectiveAssumptions = assumptions || {
    ...DEFAULT_ASSUMPTIONS,
    ...(data?.default_assumptions || {}),
  };

  const thresholds = useMemo(
    () => ({
      blockProbability: Math.max(0.05, 0.26 - strictness),
      dpProbability: Math.max(0.03, 0.14 - strictness * 0.6),
      depositAmountIdr: effectiveAssumptions.depositAmountIdr,
    }),
    [strictness, effectiveAssumptions.depositAmountIdr]
  );

  if (loading) return <Shell><p style={msgStyle}>Loading scored orders…</p></Shell>;
  if (error) return <Shell><p style={msgStyle}>Failed to load data: {String(error)}</p></Shell>;

  const m = data.metadata.metrics;

  return (
    <Shell>
      {/* Hero */}
      <header style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: colors.primary, textTransform: 'uppercase' }}>
          UMKM COD Risk Engine
        </div>
        <h1 style={{ fontSize: 34, lineHeight: 1.2, margin: '8px 0 12px', maxWidth: 720 }}>
          The smart bouncer for Cash-on-Delivery checkout
        </h1>
        <p style={{ fontSize: 15, color: colors.textSecondary, maxWidth: 720, lineHeight: 1.6 }}>
          Every order gets a calibrated refusal-risk score from an XGBoost model,
          multiplied by its own rupiah economics, and routed into one of three
          lanes: approve COD, ask for a QRIS deposit, or block COD. All policy
          math runs live in your browser.
        </p>

        {/* Model honesty strip */}
        <div
          style={{
            display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 20,
            padding: '12px 18px', background: colors.surface,
            border: `1px solid ${colors.border}`, borderRadius: 12,
            fontSize: 12, color: colors.textSecondary, fontFamily: fonts.mono,
          }}
        >
          <span>Model: XGBoost + {m.calibration_method} calibration</span>
          <span>AUC-ROC: <b>{m.auc_roc}</b></span>
          <span>Brier: {m.brier_score_uncalibrated} → <b>{m.brier_score}</b></span>
          <span>Test orders: <b>{data.metadata.n_test.toLocaleString('id-ID')}</b></span>
          <span>Showing: <b>{data.orders.length.toLocaleString('id-ID')}</b></span>
        </div>
      </header>

      <PolicySimulator
        orders={data.orders}
        assumptions={effectiveAssumptions}
        setAssumptions={setAssumptions}
        strictness={strictness}
        setStrictness={setStrictness}
        thresholds={thresholds}
      />

      <OrderInspector
        orders={data.orders}
        assumptions={effectiveAssumptions}
        thresholds={thresholds}
      />

      <StressTestPanel
        orders={data.orders}
        assumptions={effectiveAssumptions}
        thresholds={thresholds}
      />

      <footer
        style={{
          marginTop: 56, padding: '20px 0', borderTop: `1px solid ${colors.border}`,
          fontSize: 11, color: colors.textSecondary, lineHeight: 1.7,
        }}
      >
        <p>
          Methodology & honesty notes: trained on Brazil's Olist dataset (100k orders)
          with a documented COD-refusal proxy label; probabilities are calibrated
          (sigmoid) then level-shifted to an assumed {formatPercent(0.08)} Indonesian
          COD refusal prior. BRL→IDR converted at a flat Rp 3.000. SHAP bars show
          relative explanation weight, not probability points.
        </p>
        <p style={{ marginTop: 6 }}>
          Portfolio project — BSc Risk Management & Business Intelligence, HKUST.
        </p>
      </footer>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ maxWidth: layout.maxWidth, margin: '0 auto', padding: '32px 20px' }}>
      {children}
    </div>
  );
}

const msgStyle = { padding: 40, color: colors.textSecondary, fontSize: 14 };
