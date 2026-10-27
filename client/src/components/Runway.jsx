// The signature visual: one bar for the month's money. Solid = spent so far, hatched = likely range for the month,
// dashed line = your total budget. Reading left to right shows how much room is left and how far the estimate may reach.
import { useAuth } from '../context/AuthContext.jsx';

export default function Runway({ spent, low, high, projected, preliminary }) {
  const { money: fmt } = useAuth();
  const money = (n, o) => fmt(n, { decimals: 0, ...o });
  const scale = Math.max(high ?? 0, spent, 1) * 1.06;
  const w = (n) => `${Math.min(100, (n / scale) * 100)}%`;
  return (
    <div className="runway">
      <div className="runway-track" role="img" aria-label={`Spent ${money(spent)}${projected != null ? `, projected ${money(projected)} between ${money(low)} and ${money(high)}` : ''}`}>
        {low != null && high != null && <div className="runway-band" style={{ left: w(low), width: `calc(${w(high)} - ${w(low)})` }} />}
        <div className="runway-spent" style={{ width: w(spent) }} />
      </div>
      <div className="runway-legend">
        <span><i style={{ background: 'var(--brand)' }} />Spent {money(spent)}</span>
        {projected != null && <span><i style={{ background: 'var(--gold)' }} />Expected month-end {money(projected)} ({money(low, { compact: true })}–{money(high, { compact: true })}){preliminary ? ' · preliminary' : ''}</span>}
      </div>
    </div>
  );
}