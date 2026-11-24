"""
features.py
=============================================================================
Step 2 of the ML pipeline: checkout-only feature engineering.

THE NO-LEAKAGE CONTRACT
-----------------------
Every feature in this file must be computable from information available
at the exact moment the buyer clicks "Buy" (order_purchase_timestamp):

    ALLOWED:
      - The basket itself (value, freight, n_items, category)
      - The shop's own estimate shown at checkout (estimated delivery date)
      - The buyer's/seller's/region's history BEFORE this timestamp
        (strict expanding windows — never the whole column)
      - Calendar facts (hour of day, weekend)

    BANNED (anything downstream of checkout):
      - order_approved_at, carrier date, actual delivery date
      - actual delivery delay, review scores, payment records
      - Anything that would not exist yet at checkout time

Input : data/processed/orders_labeled.parquet   (from data_prep.py)
Output: data/processed/orders_features.parquet  (features + label + split)
=============================================================================
"""

import os
from pathlib import Path

import numpy as np
import pandas as pd

# Overridable via env var for sandboxes/CI with restricted mounts.
PROCESSED_DIR = Path(
    os.environ.get(
        "ML_PROCESSED_DIR",
        Path(__file__).resolve().parents[1] / "data" / "processed",
    )
)

# Time-based split boundary: last 3 months of data become the test set.
# (The Olist data spans 2016-09 to 2018-10; a random split would let
#  buyer-history features leak across the boundary.)
TEST_START = "2018-07-01"

FEATURE_COLUMNS = [
    "buyer_prior_deliveries",
    "buyer_prior_refusals",
    "seller_refusal_rate",      # seller's historical failure rate (expanding)
    "seller_prior_orders",      # seller experience proxy
    "state_refusal_rate",       # regional historical failure rate (expanding)
    "order_value",
    "freight_to_price_ratio",
    "n_items",
    "order_hour",
    "is_weekend",
    "estimated_delivery_days",
    "category_price_zscore",
    "product_category",
]


def compute_buyer_history(df: pd.DataFrame) -> pd.DataFrame:
    """Expanding-window buyer history, strictly before each order.

    For each order, count the buyer's PRIOR deliveries and PRIOR refusals.
    Implemented via groupby().cumsum() on time-sorted data minus the current
    row — O(n log n), no row-wise loops.
    """
    df = df.sort_values("order_purchase_timestamp").copy()

    df["prior_success"] = (df["refused"] == 0).astype(int)
    df["prior_refusal"] = (df["refused"] == 1).astype(int)

    grouped = df.groupby("customer_unique_id")
    df["buyer_prior_deliveries"] = grouped["prior_success"].cumsum() - df["prior_success"]
    df["buyer_prior_refusals"] = grouped["prior_refusal"].cumsum() - df["prior_refusal"]

    return df.drop(columns=["prior_success", "prior_refusal"])


def compute_expanding_rate(df: pd.DataFrame, key: str, out_col: str) -> pd.DataFrame:
    """Historical refusal rate of a group (seller / state) using ONLY orders
    before the current one. Groups with no history fall back to the overall
    expanding mean, which is itself leakage-free."""
    df = df.sort_values("order_purchase_timestamp").copy()
    cum = df.groupby(key)["refused"].cumsum() - df["refused"]
    cnt = df.groupby(key).cumcount()
    rate = cum / cnt.replace(0, np.nan)

    # Leakage-free fallback: global refusal rate among all PRIOR orders.
    global_cum = df["refused"].cumsum() - df["refused"]
    global_rate = global_cum / (np.arange(len(df))).clip(min=1)
    df[out_col] = rate.fillna(pd.Series(global_rate, index=df.index))
    return df


def compute_seller_state_features(df: pd.DataFrame) -> pd.DataFrame:
    """Seller track record + regional risk, all expanding-window."""
    df = compute_expanding_rate(df, "seller_id", "seller_refusal_rate")
    df = compute_expanding_rate(df, "customer_state", "state_refusal_rate")
    df = df.sort_values("order_purchase_timestamp")
    df["seller_prior_orders"] = df.groupby("seller_id").cumcount()
    return df


def compute_category_zscore(df: pd.DataFrame) -> pd.DataFrame:
    """Z-score of this order's value within its category, using ONLY
    orders that happened before it (expanding statistics).

    Numerical-stability note: the naive E[x^2] - E[x]^2 expanding variance
    suffers catastrophic cancellation (values ~1e4, squares summed to ~1e11),
    which produced garbage z-scores of 1e8. We therefore center each
    category's values by the FIRST observed order value in that category
    (a past-known constant — no leakage) before accumulating sums. Z-scores
    are invariant to constant shifts, so the math is identical but stable.
    """
    df = df.sort_values("order_purchase_timestamp").copy()

    first_val = df.groupby("product_category")["order_value"].transform("first")
    y = df["order_value"] - first_val  # centered, shift-invariant

    g = y.groupby(df["product_category"])
    cum_sum = g.cumsum() - y
    cum_count = g.cumcount()
    cum_sq_sum = (y**2).groupby(df["product_category"]).cumsum() - y**2

    prior_mean = cum_sum / cum_count.replace(0, np.nan)
    prior_var = (cum_sq_sum / cum_count.replace(0, np.nan)) - prior_mean**2
    prior_std = np.sqrt(prior_var.clip(lower=0))

    z = (y - prior_mean) / prior_std.replace(0, np.nan)
    df["category_price_zscore"] = z.fillna(0.0).clip(-10, 10)
    return df


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # --- Basket features (known at checkout) --------------------------------
    df["freight_to_price_ratio"] = df["freight_value"] / df["order_value"].clip(lower=1)

    # --- Calendar features ---------------------------------------------------
    df["order_hour"] = df["order_purchase_timestamp"].dt.hour
    df["is_weekend"] = (df["order_purchase_timestamp"].dt.dayofweek >= 5).astype(int)

    # --- The shop's OWN estimate shown to the buyer at checkout ---------------
    # (estimated_delivery_date is set by the platform before purchase — legal)
    df["estimated_delivery_days"] = (
        df["order_estimated_delivery_date"] - df["order_purchase_timestamp"]
    ).dt.total_seconds() / 86400
    df["estimated_delivery_days"] = df["estimated_delivery_days"].clip(lower=0)

    # --- History features (strict expanding windows) ---------------------------
    df = compute_buyer_history(df)
    df = compute_seller_state_features(df)
    df = compute_category_zscore(df)

    # --- Categoricals ----------------------------------------------------------
    df["product_category"] = df["product_category"].fillna("unknown")

    return df


def add_time_split(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["split"] = np.where(
        df["order_purchase_timestamp"] >= pd.Timestamp(TEST_START), "test", "train"
    )
    return df


def main() -> None:
    df = pd.read_parquet(PROCESSED_DIR / "orders_labeled.parquet")
    df = build_features(df)
    df = add_time_split(df)

    out_path = PROCESSED_DIR / "orders_features.parquet"
    # FEATURE_COLUMNS already contains order_value; dedupe while keeping order.
    keep = list(dict.fromkeys(
        ["order_id", "order_purchase_timestamp", "split", "refused",
         "order_value", "freight_value"]
        + FEATURE_COLUMNS
    ))
    df[keep].to_parquet(out_path, index=False)

    train_rate = df.loc[df.split == "train", "refused"].mean()
    test_rate = df.loc[df.split == "test", "refused"].mean()
    print(f"Wrote {out_path}")
    print(f"Train: {(df.split == 'train').sum():,} orders (refusal {train_rate:.2%})")
    print(f"Test : {(df.split == 'test').sum():,} orders (refusal {test_rate:.2%})")


if __name__ == "__main__":
    main()
