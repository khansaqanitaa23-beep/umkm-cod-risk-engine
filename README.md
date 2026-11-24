# UMKM COD Fraud & Return Risk Engine

> A "smart bouncer" for Cash-on-Delivery checkout in Indonesian e-commerce.
> Predicts each order's refusal risk, prices it in rupiah, and routes the
> order: **approve COD**, **require a QRIS deposit (DP)**, or **block COD**.

Portfolio project — BSc Risk Management & Business Intelligence, HKUST.

**Live dashboard:** https://khansaqanitaa23-beep.github.io/umkm-cod-risk-engine/

## The problem

Indonesian UMKM sellers live and die by COD: buyers pay cash when the courier
knocks. If the buyer refuses the package (*paket ditolak*), the seller eats
return shipping, damaged packaging, and weeks of tied-up capital. Allow COD
for everyone and prank buyers eat your margin; ban COD and honest buyers
walk away. This engine finds the middle lane, per order, with math.

## Architecture

Two halves, one JSON contract (`web/public/data/scored_orders.json`):

```
ml-pipeline/  (Python)                web/  (Vite + React, GitHub Pages)
  src/download_data.py fetch Olist      src/utils/riskEngine.js   all money math
  src/data_prep.py     join + label     src/config/uiTheme.js     all styling
  src/features.py      leakage-free     src/components/
  src/train.py         XGBoost              PolicySimulator.jsx   sliders → live EP
  src/calibrate.py     prob. calib.         OrderInspector.jsx    SHAP drill-down
  src/export_json.py   JSON contract        StressTestPanel.jsx   Harbolnas 11.11
```

The frontend is fully static: **all** expected-profit and policy-routing
calculations run client-side in `riskEngine.js`, so every slider tick is
instant and the whole thing hosts on GitHub Pages.

## The core formula

```
expectedProfit = (1 − pRefusal) · grossMargin
               − pRefusal · (returnShipping + packagingLoss + capitalHoldCost)
```

- `grossMargin` = order value × margin rate
- `capitalHoldCost` = order value × daily rate × days stuck in the return loop
- Blocked orders are **not** worth zero: a share of genuine buyers still pay
  upfront (QRIS) while refusal-prone buyers walk away.

## Methodology & honest limitations

1. **Proxy label.** Olist (Brazilian marketplace, 100k orders) has no COD
   flag. Refusal is proxied by `canceled`/`unavailable` order outcomes. The
   mechanism transfers; the base rate does not — see next point.
2. **Calibration + domain-prior adjustment.** XGBoost with
   `scale_pos_weight ≈ 191` is wildly overconfident (Brier 0.031). Sigmoid
   calibration fixes ranking-to-probability mapping on Olist's 0,5% base
   rate (Brier 0,0056), then a logit-scale intercept shift levels
   probabilities to an assumed 8% Indonesian COD refusal prior. Ranking
   (AUC 0,605) is untouched; levels reflect a documented assumption.
3. **No data leakage.** Every feature is computable at checkout time;
   buyer/seller/regional histories use strict expanding windows; the
   train/test split is time-based (last 3 months = test).
4. **SHAP explanations** are precomputed (top-3 per order) and displayed as
   *relative explanation weight*, not probability points.
5. BRL→IDR at a flat, documented Rp 3.000/BRL. Absolute rupiah values are
   illustrative; decisions are driven by currency-invariant ratios.

## Reproduce

```bash
# 1. ML pipeline (downloads the Olist CSVs itself, no Kaggle token needed)
cd ml-pipeline
pip install -r requirements.txt
cd src
python download_data.py   # fetches 4 CSVs from the official Olist mirror
python data_prep.py && python features.py \
  && python train.py && python calibrate.py && python export_json.py

# 2. Dashboard
cd ../../web
npm install
npm run dev        # local
npm run build      # production build (dist/)
```

Data source: [Olist Brazilian E-Commerce Dataset](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce)
(CC BY-NC-SA 4.0) — raw CSVs are gitignored. `scored_orders.json` is also
gitignored and regenerated on every deploy.

Deployment: the GitHub Actions workflow in `.github/workflows/deploy.yml`
re-runs the **entire** pipeline (download → train → calibrate → export) and
then builds `web/` on every push to `main` — the published dashboard is
always reproducible from raw data, no committed artifacts.
