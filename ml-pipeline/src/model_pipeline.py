"""
model_pipeline.py
=============================================================================
Shared wrapper classes. Kept in an importable module (NOT inside any
script's main()) so joblib pickles can be saved in calibrate.py and loaded
in export_json.py without __main__ attribute errors.
=============================================================================
"""


class CalibratedPipeline:
    """Thin wrapper: base XGBoost -> chosen 1D probability calibrator."""

    def __init__(self, base_model, method, calibrator):
        self.base_model = base_model
        self.method = method  # "sigmoid" | "isotonic"
        self.calibrator = calibrator

    def predict_proba(self, X):
        """Return calibrated P(refusal) as a 1D numpy array."""
        p_raw = self.base_model.predict_proba(X)[:, 1]
        if self.method == "sigmoid":
            return self.calibrator.predict_proba(p_raw.reshape(-1, 1))[:, 1]
        return self.calibrator.predict(p_raw)
