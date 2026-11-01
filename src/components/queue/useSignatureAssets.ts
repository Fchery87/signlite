import { useCallback, useEffect, useState } from 'react';
import type { SignatureAsset } from '../../db/schema';
import { listAssets } from '../../db/signatures';

export function useSignatureAssets() {
  const [assets, setAssets] = useState<SignatureAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listAssets();
      setAssets(next);
      setSelectedId((current) => (
        current && next.some((asset) => asset.id === current) ? current : next[0]?.id ?? null
      ));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0] ?? null;
  return { assets, selected, selectedId: selected?.id ?? null, select: setSelectedId, refresh, loading };
}
