"""
download_data.py
=============================================================================
Step 0 of the ML pipeline: fetch the raw Olist CSVs.

Primary source is the official Kaggle dataset
(https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce), which needs a
Kaggle API token. To keep CI (GitHub Actions) secret-free, the default is the
official Olist GitHub mirror served via the jsDelivr CDN — same files, no auth.

Only the tables the pipeline actually uses are downloaded. The payments table
is deliberately excluded (post-checkout data = leakage channel).

Usage:  python src/download_data.py
=============================================================================
"""

import os
import urllib.request
from pathlib import Path

RAW_DIR = Path(
    os.environ.get(
        "ML_RAW_DIR",
        Path(__file__).resolve().parents[1] / "data" / "raw",
    )
)

MIRROR_BASE = "https://cdn.jsdelivr.net/gh/olist/work-at-olist-data@master/datasets"

FILES = [
    "olist_orders_dataset.csv",
    "olist_order_items_dataset.csv",
    "olist_customers_dataset.csv",
    "olist_products_dataset.csv",
]


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        dest = RAW_DIR / name
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"skip  {name} (already present)")
            continue
        url = f"{MIRROR_BASE}/{name}"
        print(f"fetch {url}")
        urllib.request.urlretrieve(url, dest)
        print(f"  -> {dest} ({dest.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
