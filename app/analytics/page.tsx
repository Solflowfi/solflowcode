'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsPoint } from '@/types';
import { Unavailable } from '@/components/common/Unavailable';

const RANGES = ['24H', '7D', '30D', '90D', 'ALL'] as const;

type RangeKey = (typeof RANGES)[number];

interface SeriesResponse {
  points: AnalyticsPoint[];
  source: 'demo' | 'live';
  error?: string;
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>('7D');
  const [points, setPoints] = useState<AnalyticsPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (r: RangeKey) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?range=${r}`, { cache: 'no-store' });
      const json = (await res.json()) as SeriesResponse;
      setPoints(json.points ?? []);
      setError(json.error ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Live data unavailable');
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const hasData = (points ?? []).length > 0;

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="display text-3xl mb-2">Analytics</h1>
          <p className="text-sm text-[var(--muted)] mb-0">Protocol activity over time. Charts render indexed protocol events only.</p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r} className={`btn btn-sm ${range === r ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {error ? <Unavailable message={error} /> : null}

      {!loading && !hasData && !error ? (
        <div className="panel p-10 text-center text-[var(--muted)]">No protocol activity recorded in this window yet.</div>
      ) : null}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="panel p-6">
          <h3 className="display text-lg mb-4">Creator Fees Inflow</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points ?? []}>
                <CartesianGrid stroke="#1c2336" strokeDasharray="3 3" />
                <XAxis dataKey="t" stroke="#8b93ad" tickFormatter={(v: number) => new Date(v * 1000).getHours() + 'h'} />
                <YAxis stroke="#8b93ad" width={44} />
                <Tooltip
                  contentStyle={{ background: '#0b0e17', border: '1px solid #2a3550', borderRadius: 12, color: '#e8ecf8' }}
                  labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
                />
                <Area type="monotone" dataKey="fees" stroke="#14f195" fill="rgba(20,241,149,0.12)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-6">
          <h3 className="display text-lg mb-4">Reward Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={points ?? []}>
                <CartesianGrid stroke="#1c2336" strokeDasharray="3 3" />
                <XAxis dataKey="t" stroke="#8b93ad" tickFormatter={(v: number) => new Date(v * 1000).getHours() + 'h'} />
                <YAxis stroke="#8b93ad" width={44} />
                <Tooltip contentStyle={{ background: '#0b0e17', border: '1px solid #2a3550', borderRadius: 12, color: '#e8ecf8' }} labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()} />
                <Bar dataKey="distribution" fill="#9945ff" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-6">
          <h3 className="display text-lg mb-4">Total Value Locked</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points ?? []}>
                <CartesianGrid stroke="#1c2336" strokeDasharray="3 3" />
                <XAxis dataKey="t" stroke="#8b93ad" tickFormatter={(v: number) => new Date(v * 1000).getHours() + 'h'} />
                <YAxis stroke="#8b93ad" width={44} />
                <Tooltip contentStyle={{ background: '#0b0e17', border: '1px solid #2a3550', borderRadius: 12, color: '#e8ecf8' }} labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()} />
                <Area type="monotone" dataKey="tvl" stroke="#00d1ff" fill="rgba(0,209,255,0.1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-6">
          <h3 className="display text-lg mb-4">Active Stakers</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points ?? []}>
                <CartesianGrid stroke="#1c2336" strokeDasharray="3 3" />
                <XAxis dataKey="t" stroke="#8b93ad" tickFormatter={(v: number) => new Date(v * 1000).getHours() + 'h'} />
                <YAxis stroke="#8b93ad" width={44} />
                <Tooltip contentStyle={{ background: '#0b0e17', border: '1px solid #2a3550', borderRadius: 12, color: '#e8ecf8' }} labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()} />
                <Area type="monotone" dataKey="stakers" stroke="#14f195" fill="rgba(20,241,149,0.08)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
