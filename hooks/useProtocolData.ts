'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ProtocolResponse } from '@/types';

export function useProtocolData(refreshMs = 15000) {
  const [data, setData] = useState<ProtocolResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/protocol', { cache: 'no-store' });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const json = (await res.json()) as ProtocolResponse;
      setData(json);
      setError(json.error ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Live data unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (refreshMs <= 0) return;
    const id = setInterval(() => void refresh(), refreshMs);
    return () => clearInterval(id);
  }, [refresh, refreshMs]);

  return { data, loading, error, refresh };
}
