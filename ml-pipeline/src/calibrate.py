"""
calibrate.py
=============================================================================
Step 4 of the ML pipeline: probability calibration — the "secret sauce".

WHY THIS MATTERS (the portfolio paragraph):
    scale_pos_weight deliberately inflates the raw probabilities, and even
    without it, gradient-boosted trees are notoriously overconfident at the
    extremes. The frontend multiplies P(refusal) by real rupiah amounts, so
    a model that says "40%" when the truth is "25%" systematically makes
    wrong approve/DP/block decisions. Calibration fixes the *meaning* of
    the number: after calibration, of all orders scored 0.40, roughly 40%
    should actually fail.

METHODS COMPARED:
    - sigmoid  (Platt scaling: logistic regression on the raw score)
    - isotonic (non-parametric; more flexible but needs more positives)

    With ~90 positives in the calibration slice, isotonic is at risk of
    overfitting stair-steps; we pick the winner by Brier score on the
    untouched test set and report both.

Input : models/xgb_base.joblib, data/processed/splits.parquet
Output: models/xgb_calibrated.joblib
        data/processed/calibration_report.json
=============================================================================
"""

import json
import os
from pathlib import Path

from model_pipeline import CalibratedPipeline

import joblib
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score

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

DROP_COLS = [
    "order_id", "order_purchase_timestamp", "split", "split_role",
    "refused", "freight_value",
]
N_CALIBRATION_BINS = 10


def calibration_curve_points(y_true: np.ndarray, p: np.ndarray, n_bins: int) -> list[dict]:
    """Observed refusal rate within equal-width predicted-probability bins.

    NOTE: with rare positives, high bins may be empty — empty bins are
    omitted rather than fabricated.
    """
    points = []
    edges = np.linspace(0, p.max(), n_bins + 1)
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p >= lo) & (p < hi)
        if mask.sum() >= 5:  # need a minimum count for a meaningful rate
            points.append(
                {
                    "predicted_bin": round(float(p[mask].mean()), 5),
                    "observed_rate": round(float(y_true[mask].mean()), 5),
                    "n_orders": int(mask.sum()),
                }
            )
    return points


def main() -> None:
    df = pd.read_parquet(PROCESSED_DIR / "splits.parquet")
    feature_cols = [c for c in df.columns if c not in DROP_COLS]

    calib = df[df.split_role == "calib"]
    test = df[df.split_role == "test"]
    X_calib, y_calib = calib[feature_cols], calib["refused"].to_numpy()
    X_test, y_test = test[feature_cols], test["refused"].to_numpy()

    model = joblib.load(MODELS_DIR / "xgb_base.joblib")

    # --- Raw (uncalibrated) scores ------------------------------------------
    p_raw_test = model.predict_proba(X_test)[:, 1]

    # --- Method A: Platt / sigmoid -------------------------------------------
    # Logistic regression on the model's raw probability as the sole feature.
    p_raw_calib = model.predict_proba(X_calib)[:, 1]
    sigmoid_cal = LogisticRegression(C=1.0, solver="lbfgs")
    sigmoid_cal.fit(p_raw_calib.reshape(-1, 1), y_calib)
    p_sigmoid_test = sigmoid_cal.predict_proba(p_raw_test.reshape(-1, 1))[:, 1]

    # --- Method B: isotonic ---------------------------------------------------
    iso_cal = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso_cal.fit(p_raw_calib, y_calib)
    p_iso_test = iso_cal.predict(p_raw_test)

    # --- Compare on the untouched test set ------------------------------------
    results = {
        "uncalibrated": {
            "brier": float(brier_score_loss(y_test, p_raw_test)),
            "mean_predicted": float(p_raw_test.mean()),
        },
        "sigmoid": {
            "brier": float(brier_score_loss(y_test, p_sigmoid_test)),
            "mean_predicted": float(p_sigmoid_test.mean()),
        },
        "isotonic": {
            "brier": float(brier_score_loss(y_test, p_iso_test)),
            "mean_predicted": float(p_iso_test.mean()),
        },
    }
    auc = float(roc_auc_score(y_test, p_raw_test))  # AUC is rank-based: calibration-invariant

    winner = min(["sigmoid", "isotonic"], key=lambda m: results[m]["brier"])
    p_best = p_sigmoid_test if winner == "sigmoid" else p_iso_test

    print(f"Test AUC-ROC (calibration-invariant): {auc:.4f}")
    print(f"Test refusal base rate:               {y_test.mean():.4%}")
    for name, r in results.items():
        print(f"  {name:<13} Brier={r['brier']:.6f}  mean_p={r['mean_predicted']:.4%}")
    print(f"Winner: {winner}")

    # --- Persist the winner as a full pipeline object -------------------------
    # We wrap base model + calibrator so export_json.py has ONE predict call.
    pipeline = CalibratedPipeline(
        model, winner, sigmoid_cal if winner == "sigmoid" else iso_cal
    )
    joblib.dump(pipeline, MODELS_DIR / "xgb_calibrated.joblib")

    report = {
        "auc_roc": auc,
        "test_base_rate": float(y_test.mean()),
        "brier_scores": results,
        "winner": winner,
        "calibration_curve": calibration_curve_points(y_test, p_best, N_CALIBRATION_BINS),
    }
    with open(PROCESSED_DIR / "calibration_report.json", "w") as f:
        json.dump(report, f, indent=2)

    print(f"Saved -> {MODELS_DIR / 'xgb_calibrated.joblib'}")
    print(f"Saved -> {PROCESSED_DIR / 'calibration_report.json'}")


if __name__ == "__main__":
    main()
