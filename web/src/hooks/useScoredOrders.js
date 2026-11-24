import { useEffect, useState } from 'react';

/**
 * Loads the scored orders JSON once (from /public/data).
 * All policy math happens client-side in riskEngine.js — this hook
 * only fetches and exposes the payload + loading state.
 */
export function useScoredOrders() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // import.meta.env.BASE_URL keeps the path correct under the GitHub
    // Pages sub-path (e.g. /umkm-cod-risk-engine/).
    fetch(`${import.meta.env.BASE_URL}data/scored_orders.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(setError);
  }, []);

  return { data, error, loading: !data && !error };
}
