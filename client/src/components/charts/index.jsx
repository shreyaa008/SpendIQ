import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ComposedChart, Area, Line, Legend } from 'recharts';
import { useAuth } from '../../context/AuthContext.jsx';
import { periodLabel } from '../../utils/format.js';

const AXIS = { fontSize: 12, fill: 'var(--ink-3)' };
const TIP = { contentStyle: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--ink)', fontSize: 13 }, labelStyle: { color: 'var(--ink-2)' }, itemStyle: { color: 'var(--ink)' } };

export function Donut({ data, height = 220 }) {
  const { money } = useAuth();
  if (!data.length) return null;
  const total = data.reduce((t, d) => t + d.value, 0);
  return (
    <div style={{ position: 'relative', height }} role="img" aria-label={`Spending by category: ${data.map((d) => `${d.name} ${money(d.value)}`).join(', ')}`}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none" isAnimationActive={false}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip {...TIP} formatter={(v) => money(v)} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
        <div><div className="faint small">Total</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 650, fontSize: '1.2rem' }}>{money(total, { compact: true })}</div></div>
      </div>
    </div>
  );
}

export function MonthBars({ data, height = 220, highlight }) {
  const { money } = useAuth();
  return (
    <div style={{ height }} role="img" aria-label="Monthly spending">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => money(v, { compact: true })} width={56} />
          <Tooltip {...TIP} cursor={{ fill: 'var(--surface-2)' }} formatter={(v) => money(v)} />
          <Bar dataKey="total" name="Spent" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.period} fill={d.period === highlight ? 'var(--brand)' : 'var(--line-strong)'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DailyBars({ data, height = 200 }) {
  const { money } = useAuth();
  return (
    <div style={{ height }} role="img" aria-label="Daily spending">
      <ResponsiveContainer>
        <BarChart data={data.map((d) => ({ ...d, label: Number(d.day.slice(8)) }))} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval={2} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => money(v, { compact: true })} width={56} />
          <Tooltip {...TIP} formatter={(v) => money(v)} labelFormatter={(l) => `Day ${l}`} cursor={{ fill: 'var(--surface-2)' }} />
          <Bar dataKey="total" name="Spent" fill="var(--brand)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cumulative spending this month: actual line + dashed projection with an 80% band. */
export function ForecastPath({ path, budgetTotal, height = 280 }) {
  const { money } = useAuth();
  const data = path.map((p) => ({ day: Number(p.day.slice(8)), actual: p.actual, projected: p.projected, band: p.low != null ? [p.low, p.high] : null }));
  return (
    <div style={{ height }} role="img" aria-label="Cumulative spending this month with projection">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} interval={2} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => money(v, { compact: true })} width={60} />
          <Tooltip {...TIP} formatter={(v) => (Array.isArray(v) ? `${money(v[0])} – ${money(v[1])}` : money(v))} labelFormatter={(l) => `Day ${l}`} />
          <Area dataKey="band" name="Likely range (80%)" stroke="none" fill="var(--gold)" fillOpacity={0.18} isAnimationActive={false} connectNulls />
          <Line dataKey="projected" name="Projected" stroke="var(--gold)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />
          <Line dataKey="actual" name="Actual" stroke="var(--brand)" strokeWidth={3} dot={false} isAnimationActive={false} connectNulls />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Past months: what the model would have expected vs what happened, plus this month's projection. */
export function ExpectedActual({ rows, current, height = 260 }) {
  const { money } = useAuth();
  const data = [...rows.map((r) => ({ label: periodLabel(r.period, true), expected: r.expected, actual: r.actual })), ...(current?.expected != null ? [{ label: `${periodLabel(current.period, true)} (so far)`, expected: current.expected, actual: current.actualSoFar }] : [])];
  return (
    <div style={{ height }} role="img" aria-label="Expected versus actual spending by month">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => money(v, { compact: true })} width={60} />
          <Tooltip {...TIP} cursor={{ fill: 'var(--surface-2)' }} formatter={(v) => money(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="expected" name="Expected" fill="var(--gold)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="actual" name="Actual" fill="var(--brand)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** History followed by forecast months (with low/high). */
export function HistoryForecast({ history, next, height = 260 }) {
  const { money } = useAuth();
  const data = [...history.map((h) => ({ label: periodLabel(h.period, true), actual: h.actual })), ...next.filter((n) => n.total != null).map((n) => ({ label: periodLabel(n.period, true), forecast: n.total, range: [n.low, n.high] }))];
  return (
    <div style={{ height }} role="img" aria-label="Monthly spending history and forecast">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => money(v, { compact: true })} width={60} />
          <Tooltip {...TIP} formatter={(v) => (Array.isArray(v) ? `${money(v[0])} – ${money(v[1])}` : money(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="actual" name="Actual" fill="var(--brand)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="forecast" name="Forecast" fill="var(--gold)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Line dataKey="range" name="Range" stroke="none" dot={false} legendType="none" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CompareBars({ rows, current, previous, height = 280 }) {
  const { money } = useAuth();
  return (
    <div style={{ height }} role="img" aria-label="Category spending, this month versus previous">
      <ResponsiveContainer>
        <BarChart data={rows.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--line)" />
          <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => money(v, { compact: true })} />
          <YAxis type="category" dataKey="category" tick={AXIS} axisLine={false} tickLine={false} width={96} />
          <Tooltip {...TIP} cursor={{ fill: 'var(--surface-2)' }} formatter={(v) => money(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="previous" name={previous} fill="var(--line-strong)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
          <Bar dataKey="current" name={current} fill="var(--brand)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}