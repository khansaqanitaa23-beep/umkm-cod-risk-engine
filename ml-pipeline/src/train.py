"""
train.py
=============================================================================
Step 3 of the ML pipeline: train the XGBoost refusal-risk classifier.

Design decisions (each defensible in the portfolio write-up):

  1. TIME-BASED EVERYTHING. The test split was already made in features.py
     (last 3 months). Here we additionally carve a CALIBRATION slice out of
     the tail of the training period — calibration must be fit on data the
     model never trained on, otherwise calibration just memorizes residuals.

  2. CLASS IMBALANCE. Base rate is ~0.5%, i.e. roughly 200:1. We use
     scale_pos_weight = n_negative / n_positive, the standard XGBoost
     recipe. Consequence: raw output probabilities are systematically
     inflated — which is exactly why Step 4 (calibration) is not optional.

  3. NATIVE CATEGORICALS. product_category is passed as pandas 'category'
     dtype with enable_categorical=True — no one-hot explosion, and XGBoost
     learns its own optimal category groupings.

Input : data/processed/orders_features.parquet
Output: models/xgb_base.joblib  (uncalibrated model)
        data/processed/splits.parquet  (train/calib/test indices + labels)
=============================================================================
"""

import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from xgboost import XGBClassifier

PROCESSED_DIR = Path(
    os.environ.get(
        "ML_PROCESSED_DIR",
        Path(__file__).resolve().parents[1] / "data" / "processed",
    )
)
MODELS_DIR = Path(
    os.environ.get(
        "ML_MODELS_DIR",
        Path(__file__).resolve().parents[1] / "models",
    )
)

# Fraction of the (time-ordered) training period reserved for calibration.
CALIB_FRACTION = 0.20

CATEGORICAL_COLS = ["product_category"]

# Excluded from features: identifiers, label, split helper, and the raw
# components that engineered features were derived from (freight_value is
# kept OUT because freight_to_price_ratio carries the signal with leakage-
# free normalization; raw order_value stays since margin scales with it).
DROP_COLS = [
    "order_id", "order_purchase_timestamp", "split", "refused", "freight_value",
]

XGB_PARAMS = dict(
    n_estimators=400,
    max_depth=5,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    min_child_weight=50,   # high value = conservative on rare positives
    enable_categorical=True,
    tree_method="hist",
    random_state=42,
)


def load_and_encode() -> tuple[pd.DataFrame, list[str]]:
    df = pd.read_parquet(PROCESSED_DIR / "orders_features.parquet")
    for col in CATEGORICAL_COLS:
        df[col] = df[col].astype("category")
    feature_cols = [c for c in df.columns if c not in DROP_COLS]
    return df, feature_cols


def main() -> None:
    df, feature_cols = load_and_encode()

    train_pool = df[df.split == "train"].sort_values("order_purchase_timestamp")
    test = df[df.split == "test"]

    # Calibration slice = the LAST 20% of the training period (time-ordered).
    cut = int(len(train_pool) * (1 - CALIB_FRACTION))
    train, calib = train_pool.iloc[:cut], train_pool.iloc[cut:]

    X_train, y_train = train[feature_cols], train["refused"]
    X_calib, y_calib = calib[feature_cols], calib["refused"]
    X_test, y_test = test[feature_cols], test["refused"]

    scale_pos_weight = (y_train == 0).sum() / max((y_train == 1).sum(), 1)
    print(f"Train {len(train):,} | Calib {len(calib):,} | Test {len(test):,}")
    print(f"scale_pos_weight = {scale_pos_weight:.1f}")

    model = XGBClassifier(scale_pos_weight=scale_pos_weight, **XGB_PARAMS)
    model.fit(X_train, y_train)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODELS_DIR / "xgb_base.joblib")

    # Persist the exact split so calibrate.py / export_json.py reuse it.
    splits = pd.concat(
        [
            train.assign(split_role="train"),
            calib.assign(split_role="calib"),
            test.assign(split_role="test"),
        ]
    )
    splits.to_parquet(PROCESSED_DIR / "splits.parquet", index=False)
    print(f"Saved model -> {MODELS_DIR / 'xgb_base.joblib'}")
    print(f"Saved splits -> {PROCESSED_DIR / 'splits.parquet'}")


if __name__ == "__main__":
    main()
