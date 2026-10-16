'use client';

export function Unavailable({ message = 'Live data unavailable' }: { message?: string }) {
  return (
    <div className="panel p-5 border-[rgba(255,180,84,0.35)]">
      <div className="flex items-center gap-3">
        <span className="badge badge-amber">● LIVE DATA UNAVAILABLE</span>
      </div>
      <p className="text-sm text-[var(--muted)] mt-3 mb-0">
        {message} SOLFLOW never substitutes unavailable live data with simulated numbers. Configure RPC / program settings or check back later.
      </p>
    </div>
  );
}
