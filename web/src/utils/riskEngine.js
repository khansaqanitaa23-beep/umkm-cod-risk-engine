/**
 * riskEngine.js
 * -----------------------------------------------------------------------------
 * The financial brain of the UMKM COD Fraud & Return Risk Engine.
 *
 * EVERYTHING money-related lives here and ONLY here:
 *   - Default UMKM assumptions (margins, shipping, packaging, capital hold)
 *   - The Expected Profit formula
 *   - Policy thresholds & routing logic (APPROVE_COD / REQUIRE_DP / BLOCK_COD)
 *   - Rupiah formatting
 *
 * This file is deliberately React-free (pure functions) so you can:
 *   - Unit-test the math without rendering anything
 *   - Reuse it in Node scripts or the stress-test simulator
 *
 * THE CORE FORMULA (do not change without updating the README):
 *
 *   expectedProfit = (1 - pRefusal) * grossMargin
 *                    - pRefusal * (returnShipping + packagingLoss + capitalHoldCost)
 *
 * where:
 *   grossMargin      = order_value * grossMarginRate        (what you earn if paid)
 *   capitalHoldCost  = order_value * capitalHoldDailyRate * avgCapitalHoldDays
 *                      (money tied up while the parcel bounces back to you)
 * -----------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// 1. DEFAULT ASSUMPTIONS
//    These mirror `default_assumptions` in scored_orders.json. The frontend
//    sliders start here; every value is overridable at runtime.
// ---------------------------------------------------------------------------

export const DEFAULT_ASSUMPTIONS = {
  grossMarginRate: 0.30,        // 30% gross margin on the sale price
  returnShippingIdr: 35000,     // courier fee to haul a refused parcel back
  packagingLossIdr: 10000,      // box, tape, inserts — unsellable after a return trip
  capitalHoldDailyRate: 0.0005, // ~0.05%/day opportunity cost of tied-up cash
  avgCapitalHoldDays: 14,       // days your money is stuck in the return loop
  depositAmountIdr: 25000,      // QRIS down payment asked in the yellow lane
  dpDeterrenceFactor: 0.15,     // asking for a DP scares off ~15% of would-be refusers
  prepayConversionRate: 0.70,   // share of genuine buyers who still buy when COD
                                // is blocked and they must pay upfront via QRIS
                                // (fraudsters/refusers simply walk away)
};

// ---------------------------------------------------------------------------
// 2. POLICY THRESHOLDS
//    The three checkout lanes. Tweak these to make the bouncer stricter or
//    looser — every UI slider labeled "strictness" ultimately lands here.
// ---------------------------------------------------------------------------

export const POLICY_THRESHOLDS = {
  // These two thresholds are RISK-APPETITE choices, not model outputs.
  // After the pipeline's domain-prior adjustment, test-set refusal
  // probabilities run p50 ~= 7%, p90 ~= 15%, p99 ~= 22%, max ~= 28%.
  //
  // Defaults chosen (the "hybrid" policy):
  //   - DP lane from p >= 0.14  (~top 10% of orders)
  //   - Block lane from p >= 0.26 (~top 0.3%) PLUS the pure-economics
  //     guardrail in routeOrder(): any order whose expected profit is
  //     negative even WITH a deposit is always blocked, regardless of p.
  //   This keeps the engine more profitable than naive allow-all COD at
  //   default assumptions while still hard-blocking the extreme tail as
  //   an insurance policy.
  //
  // The dashboard's "strictness" slider shifts both thresholds together.

  // Hard block: at or above this refusal probability we never offer COD,
  // no matter how fat the margin is.
  blockProbability: 0.26,

  // Down-payment lane: at or above this probability, a DP improves the
  // expected profit enough to be worth the friction.
  dpProbability: 0.14,

  // Deposit logic: if refusing, the seller keeps the DP, so it offsets the
  // return loss by up to this amount.
  depositAmountIdr: DEFAULT_ASSUMPTIONS.depositAmountIdr,
};

export const POLICIES = {
  APPROVE_COD: 'APPROVE_COD', // Green lane  — ship it, collect cash at the door
  REQUIRE_DP: 'REQUIRE_DP',   // Yellow lane — small QRIS deposit, rest COD
  BLOCK_COD: 'BLOCK_COD',     // Red lane    — upfront payment only
};

// ---------------------------------------------------------------------------
// 3. CORE MATH
// ---------------------------------------------------------------------------

/**
 * Cost of having your cash stuck in transit while a refused parcel
 * makes the round trip back to the warehouse.
 */
export function capitalHoldCost(orderValueIdr, a = DEFAULT_ASSUMPTIONS) {
  return orderValueIdr * a.capitalHoldDailyRate * a.avgCapitalHoldDays;
}

/**
 * Total rupiah lost when one specific order is refused at the door.
 */
export function refusalLoss(orderValueIdr, a = DEFAULT_ASSUMPTIONS) {
  return a.returnShippingIdr + a.packagingLossIdr + capitalHoldCost(orderValueIdr, a);
}

/**
 * THE expected profit formula. This is the line the whole project defends.
 *
 * @param {number} pRefusal   calibrated refusal probability (0..1)
 * @param {number} orderValueIdr
 * @param {object} a          assumptions (defaults to DEFAULT_ASSUMPTIONS)
 */
export function expectedProfit(pRefusal, orderValueIdr, a = DEFAULT_ASSUMPTIONS) {
  const grossMargin = orderValueIdr * a.grossMarginRate;
  const loss = refusalLoss(orderValueIdr, a);
  return (1 - pRefusal) * grossMargin - pRefusal * loss;
}

/**
 * Expected profit if we ask for a down payment first.
 * Two effects:
 *   1. Deterrence — some impulsive/prank buyers walk away, so pRefusal drops.
 *   2. Cushion — if a refusal still happens, the kept DP offsets the loss.
 */
export function expectedProfitWithDp(pRefusal, orderValueIdr, a = DEFAULT_ASSUMPTIONS) {
  const pAdj = pRefusal * (1 - a.dpDeterrenceFactor);
  const grossMargin = orderValueIdr * a.grossMarginRate;
  const lossAfterDp = Math.max(refusalLoss(orderValueIdr, a) - a.depositAmountIdr, 0);
  return (1 - pAdj) * grossMargin - pAdj * lossAfterDp;
}

/**
 * Expected profit when COD is BLOCKED and upfront payment is required.
 * A blocked order is NOT worth zero: a share of genuine buyers still
 * complete the purchase via QRIS/e-wallet (no courier, no refusal risk,
 * so no refusal loss), while refusal-prone "buyers" simply walk away.
 *
 *   EP_blocked = prepayConversionRate * (1 - pRefusal) * grossMargin
 */
export function expectedProfitIfBlocked(pRefusal, orderValueIdr, a = DEFAULT_ASSUMPTIONS) {
  return a.prepayConversionRate * (1 - pRefusal) * orderValueIdr * a.grossMarginRate;
}

// ---------------------------------------------------------------------------
// 4. POLICY ROUTING
// ---------------------------------------------------------------------------

/**
 * Route one order into a checkout lane.
 *
 * Logic (in order):
 *   1. pRefusal above the hard block line          -> BLOCK_COD
 *   2. COD expected profit is negative             -> BLOCK_COD
 *   3. Risky enough that a DP pays for itself      -> REQUIRE_DP
 *      (a DP "pays for itself" when it beats plain COD on expected profit)
 *   4. Otherwise                                   -> APPROVE_COD
 *
 * @returns {{ policy: string, expectedProfit: number,
 *             expectedProfitWithDp: number, expectedProfitIfBlocked: number,
 *             pRefusal: number }}
 */
export function routeOrder(order, a = DEFAULT_ASSUMPTIONS, t = POLICY_THRESHOLDS) {
  const p = order.p_refusal_calibrated;
  const value = order.order_value_idr;

  const epCod = expectedProfit(p, value, a);
  const epDp = expectedProfitWithDp(p, value, a);
  const epBlocked = expectedProfitIfBlocked(p, value, a);

  let policy;
  if (p >= t.blockProbability || epCod < 0 && epDp < 0) {
    policy = POLICIES.BLOCK_COD;
  } else if (epCod < 0 || (p >= t.dpProbability && epDp > epCod)) {
    policy = POLICIES.REQUIRE_DP;
  } else {
    policy = POLICIES.APPROVE_COD;
  }

  return {
    policy,
    expectedProfit: epCod,
    expectedProfitWithDp: epDp,
    expectedProfitIfBlocked: epBlocked,
    pRefusal: p,
  };
}

// ---------------------------------------------------------------------------
// 5. PORTFOLIO AGGREGATION
//    What the dashboard headline numbers are made of.
// ---------------------------------------------------------------------------

/**
 * Score a whole list of orders under one set of assumptions.
 * Returns per-order routing plus portfolio totals, and compares against the
 * naive "allow COD for everyone" baseline so the UI can show profit saved.
 */
export function summarizePortfolio(orders, a = DEFAULT_ASSUMPTIONS, t = POLICY_THRESHOLDS) {
  const routed = orders.map((order) => ({ ...order, routing: routeOrder(order, a, t) }));

  const totals = {
    [POLICIES.APPROVE_COD]: { count: 0, expectedProfit: 0 },
    [POLICIES.REQUIRE_DP]: { count: 0, expectedProfit: 0 },
    [POLICIES.BLOCK_COD]: { count: 0, expectedProfit: 0 },
  };

  let engineProfit = 0;
  let naiveProfit = 0;

  for (const o of routed) {
    const {
      policy, expectedProfit: epCod, expectedProfitWithDp: epDp,
      expectedProfitIfBlocked: epBlocked,
    } = o.routing;
    // Blocked orders still earn prepay conversions — not zero.
    const realized =
      policy === POLICIES.REQUIRE_DP ? epDp
      : policy === POLICIES.APPROVE_COD ? epCod
      : epBlocked;
    totals[policy].count += 1;
    totals[policy].expectedProfit += realized;
    engineProfit += realized;
    naiveProfit += epCod; // baseline: everyone gets COD
  }

  return {
    orders: routed,
    totals,
    engineExpectedProfit: engineProfit,
    naiveExpectedProfit: naiveProfit,
    profitSaved: engineProfit - naiveProfit,
  };
}

// ---------------------------------------------------------------------------
// 6. FORMATTING
//    One formatter for the whole app: "Rp 125.000" (Indonesian locale).
// ---------------------------------------------------------------------------

const idrFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

/** 125000 -> "Rp 125.000" */
export function formatIDR(amount) {
  return idrFormatter.format(Math.round(amount));
}

/** 0.4123 -> "41.2%" */
export function formatPercent(p, digits = 1) {
  return `${(p * 100).toFixed(digits)}%`;
}
