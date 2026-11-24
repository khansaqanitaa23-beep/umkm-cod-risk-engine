"""
data_prep.py
=============================================================================
Step 1 of the ML pipeline: load the raw Olist CSVs, join them into one
order-level table, and build the COD-refusal proxy label.

THE BIG HONESTY NOTE (goes in the portfolio write-up):
    Olist is Brazilian marketplace data and has no Cash-on-Delivery flag.
    We therefore build a *proxy* label for "this order would likely have
    failed at the door":

        refusal = 1  if the order was canceled OR marked unavailable
                     (fulfillment failed / never properly delivered)

    Concretely, Olist order_status values map to:
        'canceled'    -> refusal (1)   buyer/system killed the order
        'unavailable' -> refusal (1)   fulfillment failed
        'delivered'   -> success (0)
        everything else (shipped, processing, invoiced, created, approved)
                      -> dropped from training (outcome unknowable)

    This is a documented modeling assumption, not a fact about Indonesian
    COD. Defense: the *mechanism* we model (checkout signals -> fulfillment
    failure) transfers; the base rates do not, and we never claim they do.

Outputs:
    ml-pipeline/data/processed/orders_labeled.parquet
    One row per order with raw checkout fields + `refused` label.
=============================================================================
"""

import os
from pathlib import Path

import pandas as pd

RAW_DIR = Path(
    os.environ.get(
        "ML_RAW_DIR",
        Path(__file__).resolve().parents[1] / "data" / "raw",
    )
)
OUT_DIR = Path(
    os.environ.get(
        "ML_PROCESSED_DIR",
        Path(__file__).resolve().parents[1] / "data" / "processed",
    )
)

# --- Label mapping -----------------------------------------------------------
REFUSAL_STATUSES = {"canceled", "unavailable"}
SUCCESS_STATUSES = {"delivered"}
# All other statuses have no knowable outcome -> excluded from training.


def load_raw(raw_dir: Path = RAW_DIR) -> dict[str, pd.DataFrame]:
    """Load the Olist tables we need. Raises a clear error if files are missing."""
    # NOTE: we deliberately do NOT load olist_order_payments_dataset.csv.
    # Payment records are created after checkout, and payment_type would be a
    # leakage channel (in this engine, every order is hypothetically COD).
    files = {
        "orders": "olist_orders_dataset.csv",
        "items": "olist_order_items_dataset.csv",
        "customers": "olist_customers_dataset.csv",
        "products": "olist_products_dataset.csv",
    }
    tables = {}
    for name, filename in files.items():
        path = raw_dir / filename
        if not path.exists():
            raise FileNotFoundError(
                f"Missing {path}. Run src/download_data.py first."
            )
        tables[name] = pd.read_csv(path)
    return tables


def build_order_table(tables: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Join orders + items + customers into one row per order.

    Aggregation choices (order_items is one row per line item):
      - order_value_idr-ish  : sum of item prices (kept in BRL cents scale;
                               converted to IDR at export time for the story)
      - freight_value        : sum of freight across items
      - n_items              : line items in the basket
      - product_category     : dominant (highest-value) category
    """
    orders = tables["orders"].copy()
    items = tables["items"].copy()
    customers = tables["customers"].copy()
    products = tables["products"].copy()

    # Items carry only product_id; category names live in the products table.
    items = items.merge(
        products[["product_id", "product_category_name"]], on="product_id", how="left"
    )

    # Parse timestamps once, here, so every downstream step stays honest.
    ts_cols = [
        "order_purchase_timestamp",
        "order_approved_at",
        "order_delivered_carrier_date",
        "order_delivered_customer_date",
        "order_estimated_delivery_date",
    ]
    for col in ts_cols:
        orders[col] = pd.to_datetime(orders[col], errors="coerce")

    # Aggregate line items to order level.
    items_agg = (
        items.groupby("order_id")
        .agg(
            order_value=("price", "sum"),
            freight_value=("freight_value", "sum"),
            n_items=("order_item_id", "count"),
        )
        .reset_index()
    )

    # Dominant category AND dominant seller = those of the highest-priced
    # item in the basket. seller_id unlocks seller-track-record features
    # downstream (a shop with a history of failed fulfillments is a strong,
    # leakage-free risk signal).
    idx_max = items.groupby("order_id")["price"].idxmax()
    categories = (
        items.loc[idx_max, ["order_id", "product_category_name", "seller_id"]]
        .rename(columns={"product_category_name": "product_category"})
    )

    df = (
        orders.merge(items_agg, on="order_id", how="inner")
        .merge(categories, on="order_id", how="left")
        .merge(
            customers[["customer_id", "customer_unique_id", "customer_state"]],
            on="customer_id",
            how="left",
        )
    )
    return df


def build_label(df: pd.DataFrame) -> pd.DataFrame:
    """Attach the refusal proxy label and drop unknowable outcomes."""
    df = df.copy()
    df["refused"] = None
    df.loc[df["order_status"].isin(SUCCESS_STATUSES), "refused"] = 0
    df.loc[df["order_status"].isin(REFUSAL_STATUSES), "refused"] = 1
    df = df.dropna(subset=["refused"])
    df["refused"] = df["refused"].astype(int)
    return df


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tables = load_raw()
    df = build_order_table(tables)
    df = build_label(df)

    out_path = OUT_DIR / "orders_labeled.parquet"
    df.to_parquet(out_path, index=False)

    n = len(df)
    rate = df["refused"].mean()
    print(f"Wrote {out_path}")
    print(f"Orders with knowable outcome: {n:,}")
    print(f"Refusal proxy base rate: {rate:.2%}  "
          f"(remember: proxy, not real Indonesian COD refusal)")


if __name__ == "__main__":
    main()
