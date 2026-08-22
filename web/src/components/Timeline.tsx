import { useEffect, useMemo, useRef, useState } from 'react';
import type { Drink, Member } from '@shared/types.js';
import { formatClock, formatStandardDrinks } from '../lib/format.js';

interface TimelineProps {
  members: Member[];
  drinks: Drink[];
  meId: string;
  now: number;
}

/** The validated categorical palette has eight slots; past that we fold. */
const MAX_SERIES = 8;

const MARGIN = { top: 12, right: 14, bottom: 26, left: 34 };
const HEIGHT = 210;
const SURFACE = '#1b1b26';

interface Series {
  member: Member;
  /** Cumulative standard drinks after each logged drink. */
  points: { t: number; total: number }[];
  total: number;
}

export function Timeline({ members, drinks, meId, now }: TimelineProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { series, hidden, domain, maxTotal } = useMemo(() => {
    const all: Series[] = members.map((member) => {
      const theirs = drinks
        .filter((drink) => drink.memberId === member.id)
        .sort((a, b) => a.consumedAt - b.consumedAt);
      let running = 0;
      const points = theirs.map((drink) => {
        running += drink.standardDrinks;
        return { t: drink.consumedAt, total: running };
      });
      return { member, points, total: running };
    });

    const ranked = [...all].sort((a, b) => b.total - a.total);
    // Colour follows the member, never their rank, so slots stay stable as the
    // ranking churns; only membership of the chart changes.
    const keep = new Set(ranked.slice(0, MAX_SERIES).map((entry) => entry.member.id));
    keep.add(meId);
    const shown = all.filter((entry) => keep.has(entry.member.id) && entry.points.length > 0);

    const times = drinks.map((drink) => drink.consumedAt);
    const start = times.length > 0 ? Math.min(...times) : now - 3_600_000;
    return {
      series: shown,
      hidden: all.filter((entry) => entry.points.length > 0).length - shown.length,
      domain: { start: Math.min(start, now - 900_000), end: now },
      maxTotal: Math.max(1, ...all.map((entry) => entry.total)),
    };
  }, [members, drinks, meId, now]);

  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const span = Math.max(1, domain.end - domain.start);

  const x = (t: number) => MARGIN.left + ((t - domain.start) / span) * plotWidth;
  const y = (value: number) => MARGIN.top + plotHeight - (value / yMax(maxTotal)) * plotHeight;

  if (drinks.length === 0) {
    return (
      <div className="card">
        <h2>Over the night</h2>
        <p className="tiny muted" style={{ margin: 0 }}>
          The chart fills in once someone logs a drink.
        </p>
      </div>
    );
  }

  const hoverTime = hoverX == null ? null : domain.start + ((hoverX - MARGIN.left) / plotWidth) * span;

  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Over the night</h2>
        <button
          className="btn btn-ghost tiny"
          style={{ minHeight: 32, padding: '0.2rem 0.6rem' }}
          onClick={() => setShowTable((open) => !open)}
        >
          {showTable ? 'Chart' : 'Table'}
        </button>
      </div>

      {showTable ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.6rem' }}>
          <caption className="tiny muted" style={{ captionSide: 'bottom', textAlign: 'left' }}>
            Cumulative standard drinks per person.
          </caption>
          <thead>
            <tr className="tiny muted">
              <th style={{ textAlign: 'left', paddingBottom: '0.3rem' }}>Person</th>
              <th style={{ textAlign: 'right' }}>Drinks</th>
              <th style={{ textAlign: 'right' }}>Standard</th>
              <th style={{ textAlign: 'right' }}>Last</th>
            </tr>
          </thead>
          <tbody>
            {series.map((entry) => (
              <tr key={entry.member.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '0.35rem 0' }}>{entry.member.name}</td>
                <td style={{ textAlign: 'right' }}>{entry.points.length}</td>
                <td style={{ textAlign: 'right' }}>{formatStandardDrinks(entry.total)}</td>
                <td style={{ textAlign: 'right' }} className="muted">
                  {formatClock(entry.points[entry.points.length - 1]!.t)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-wrap" ref={wrapRef} style={{ marginTop: '0.5rem' }}>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Cumulative standard drinks over time for ${series
              .map((entry) => entry.member.name)
              .join(', ')}`}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const px = event.clientX - bounds.left;
              setHoverX(Math.min(Math.max(px, MARGIN.left), MARGIN.left + plotWidth));
            }}
            onPointerLeave={() => setHoverX(null)}
          >
            {yTicks(maxTotal).map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + plotWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text x={0} y={y(tick) + 4} fill="var(--text-dim)" fontSize={10}>
                  {tick}
                </text>
              </g>
            ))}

            {timeTicks(domain.start, domain.end).map((tick) => (
              <text
                key={tick}
                x={x(tick)}
                y={HEIGHT - 8}
                fill="var(--text-dim)"
                fontSize={10}
                // Anchor the edge labels inward so they never run off the plot.
                textAnchor={
                  x(tick) <= MARGIN.left + 12
                    ? 'start'
                    : x(tick) >= MARGIN.left + plotWidth - 12
                      ? 'end'
                      : 'middle'
                }
              >
                {formatClock(tick)}
              </text>
            ))}

            {series.map((entry) => (
              <path
                key={entry.member.id}
                d={stepPath(entry.points, domain.end, x, y)}
                fill="none"
                stroke={entry.member.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {series.map((entry) => (
              <circle
                key={entry.member.id}
                cx={x(domain.end)}
                cy={y(entry.total)}
                r={4}
                fill={entry.member.color}
                stroke={SURFACE}
                strokeWidth={2}
              />
            ))}

            {hoverX != null && (
              <line
                x1={hoverX}
                x2={hoverX}
                y1={MARGIN.top}
                y2={MARGIN.top + plotHeight}
                stroke="var(--text-dim)"
                strokeWidth={1}
              />
            )}
          </svg>

          {hoverTime != null && (
            <div className="tiny" style={{ marginTop: '0.35rem' }}>
              <strong>{formatClock(hoverTime)}</strong>
              <span className="muted">
                {' — '}
                {series
                  .map(
                    (entry) =>
                      `${entry.member.name} ${formatStandardDrinks(totalAt(entry.points, hoverTime))}`,
                  )
                  .join(' · ')}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="legend">
        {series.map((entry) => (
          <span className="legend-item" key={entry.member.id}>
            <span className="legend-swatch" style={{ background: entry.member.color }} />
            {entry.member.name}
          </span>
        ))}
      </div>
      {hidden > 0 && (
        <p className="tiny muted" style={{ margin: '0.4rem 0 0' }}>
          Showing {series.length} of {series.length + hidden} people — the rest are in the list
          above.
        </p>
      )}
    </div>
  );
}

/** Round the y domain up to a clean number so ticks land on integers. */
function yMax(maxTotal: number): number {
  return Math.max(2, Math.ceil(maxTotal));
}

function yTicks(maxTotal: number): number[] {
  const top = yMax(maxTotal);
  const step = top <= 4 ? 1 : Math.ceil(top / 4);
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  return ticks;
}

/** Candidate tick spacings, in minutes, from a quick round to a long night. */
const TICK_STEPS_MIN = [5, 10, 15, 30, 60, 120, 180, 240, 360];

/**
 * Evenly spaced ticks on a round time, capped at five labels so they never
 * collide on a narrow phone.
 */
function timeTicks(start: number, end: number): number[] {
  const span = Math.max(1, end - start);
  const stepMs =
    (TICK_STEPS_MIN.find((minutes) => span / (minutes * 60_000) <= 4) ??
      TICK_STEPS_MIN[TICK_STEPS_MIN.length - 1]!) * 60_000;

  const ticks: number[] = [];
  for (let t = Math.ceil(start / stepMs) * stepMs; t <= end; t += stepMs) ticks.push(t);
  // A domain shorter than one step still deserves its bounds labelled.
  if (ticks.length < 2) return [start, end];
  return ticks;
}

/**
 * Drinks are discrete events, so the line steps rather than sloping: a level
 * run until the drink, then a jump. Sloping between drinks would imply drinking
 * continuously.
 */
function stepPath(
  points: { t: number; total: number }[],
  end: number,
  x: (t: number) => number,
  y: (value: number) => number,
): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  const parts = [`M ${x(first.t)} ${y(0)}`, `L ${x(first.t)} ${y(first.total)}`];
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]!;
    parts.push(`L ${x(point.t)} ${y(points[i - 1]!.total)}`);
    parts.push(`L ${x(point.t)} ${y(point.total)}`);
  }
  parts.push(`L ${x(end)} ${y(points[points.length - 1]!.total)}`);
  return parts.join(' ');
}

function totalAt(points: { t: number; total: number }[], time: number): number {
  let total = 0;
  for (const point of points) {
    if (point.t <= time) total = point.total;
  }
  return total;
}
