import { useEffect, useMemo, useRef, useState } from 'react';
import { bacSampleTimes, estimateBac } from '@shared/drinks.js';
import type { Drink, Member } from '@shared/types.js';
import { formatBac, formatClock, formatStandardDrinks } from '../lib/format.js';

interface TimelineProps {
  members: Member[];
  drinks: Drink[];
  meId: string;
  now: number;
}

type Metric = 'drinks' | 'bac';

/** The validated categorical palette has eight slots; past that we fold. */
const MAX_SERIES = 8;

/** How far back the BAC chart's time axis reaches, independent of the drinks chart. */
const BAC_WINDOW_HOURS = 3;

const MARGIN = { top: 12, right: 14, bottom: 26, left: 34 };
const HEIGHT = 210;
const SURFACE = '#1b1b26';

interface Point {
  t: number;
  value: number;
}

interface Series {
  member: Member;
  points: Point[];
  /** Final value shown on the end-dot, in the legend fold count, and ranking. */
  value: number;
  lastDrinkAt: number;
}

interface SeriesData {
  series: Series[];
  /** Active people bumped from the chart by the MAX_SERIES cap. */
  hidden: number;
  /** People who can't be estimated at all (no weight, or opted out) — BAC only. */
  ineligible: number;
  yTop: number;
}

export function Timeline({ members, drinks, meId, now }: TimelineProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [metric, setMetric] = useState<Metric>('drinks');

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fullDomain = useMemo(() => {
    const times = drinks.map((drink) => drink.consumedAt);
    const start = times.length > 0 ? Math.min(...times) : now - 3_600_000;
    return { start: Math.min(start, now - 900_000), end: now };
  }, [drinks, now]);

  // BAC is a current physiological state, not a running total — a peak from
  // six hours ago is no longer relevant to "how am I doing right now," and
  // squeezing the whole night into one axis flattens the recent shape that
  // actually matters. Capped independently of the drinks chart, which stays
  // a full-night cumulative view on purpose.
  const bacDomain = useMemo(() => {
    const start = Math.max(fullDomain.start, now - BAC_WINDOW_HOURS * 3_600_000);
    return { start: Math.min(start, now - 900_000), end: now };
  }, [fullDomain, now]);

  const drinkData = useMemo(() => buildDrinkSeries(members, drinks, meId), [members, drinks, meId]);
  const bacData = useMemo(
    () => buildBacSeries(members, drinks, meId, bacDomain),
    [members, drinks, meId, bacDomain],
  );
  const { series, hidden, ineligible, yTop } = metric === 'drinks' ? drinkData : bacData;
  const domain = metric === 'drinks' ? fullDomain : bacDomain;
  const eligibleCount = members.length - ineligible;

  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const span = Math.max(1, domain.end - domain.start);

  const x = (t: number) => MARGIN.left + ((t - domain.start) / span) * plotWidth;
  const y = (value: number) => MARGIN.top + plotHeight - (value / yTop) * plotHeight;

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
  const ticks = metric === 'drinks' ? drinksYTicks(yTop) : bacYTicks(yTop);
  const valueAt = metric === 'drinks' ? totalAt : interpolateAt;
  const formatValue = metric === 'drinks' ? formatStandardDrinks : formatBac;

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

      <div className="segmented" style={{ margin: '0.5rem 0' }}>
        <button aria-pressed={metric === 'drinks'} onClick={() => setMetric('drinks')}>
          Drinks
        </button>
        <button aria-pressed={metric === 'bac'} onClick={() => setMetric('bac')}>
          BAC
        </button>
      </div>

      {metric === 'bac' && series.length === 0 ? (
        <p className="tiny muted" style={{ margin: 0 }}>
          {eligibleCount === 0
            ? "No one has added a weight yet, so there's nothing to estimate. Add yours in Settings."
            : 'No estimates yet — once someone with a weight logs a drink, this fills in.'}
        </p>
      ) : showTable ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.6rem' }}>
          <caption className="tiny muted" style={{ captionSide: 'bottom', textAlign: 'left' }}>
            {metric === 'drinks'
              ? 'Cumulative standard drinks per person.'
              : "Rough BAC estimate per person, right now."}
          </caption>
          <thead>
            <tr className="tiny muted">
              <th style={{ textAlign: 'left', paddingBottom: '0.3rem' }}>Person</th>
              {metric === 'drinks' ? (
                <>
                  <th style={{ textAlign: 'right' }}>Drinks</th>
                  <th style={{ textAlign: 'right' }}>Standard</th>
                </>
              ) : (
                <th style={{ textAlign: 'right' }}>Est. BAC</th>
              )}
              <th style={{ textAlign: 'right' }}>Last</th>
            </tr>
          </thead>
          <tbody>
            {series.map((entry) => (
              <tr key={entry.member.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '0.35rem 0' }}>{entry.member.name}</td>
                {metric === 'drinks' ? (
                  <>
                    <td style={{ textAlign: 'right' }}>{entry.points.length}</td>
                    <td style={{ textAlign: 'right' }}>{formatStandardDrinks(entry.value)}</td>
                  </>
                ) : (
                  <td style={{ textAlign: 'right' }}>{formatBac(entry.value)}</td>
                )}
                <td style={{ textAlign: 'right' }} className="muted">
                  {formatClock(entry.lastDrinkAt)}
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
            aria-label={`${metric === 'drinks' ? 'Cumulative standard drinks' : 'Estimated BAC'} over time for ${series
              .map((entry) => entry.member.name)
              .join(', ')}`}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const px = event.clientX - bounds.left;
              setHoverX(Math.min(Math.max(px, MARGIN.left), MARGIN.left + plotWidth));
            }}
            onPointerLeave={() => setHoverX(null)}
          >
            {ticks.map((tick) => (
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
                  {metric === 'drinks' ? tick : tick.toFixed(2)}
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
                d={
                  metric === 'drinks'
                    ? stepPath(entry.points, domain.end, x, y)
                    : linePath(entry.points, x, y)
                }
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
                cy={y(entry.value)}
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
                      `${entry.member.name} ${formatValue(valueAt(entry.points, hoverTime))}`,
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
      {metric === 'bac' && ineligible > 0 && (
        <p className="tiny muted" style={{ margin: '0.4rem 0 0' }}>
          {ineligible} more {ineligible === 1 ? "person hasn't" : "people haven't"} added a weight,
          or {ineligible === 1 ? 'has' : 'have'} kept theirs private.
        </p>
      )}
      {metric === 'bac' && (
        <p className="tiny disclaimer">
          Rough estimates from each person's weight and their own log. Never a measure of
          impairment or of who can drive.
        </p>
      )}
    </div>
  );
}

/** Round the y domain up to a clean number so ticks land on integers. */
function drinksYMax(maxTotal: number): number {
  return Math.max(2, Math.ceil(maxTotal));
}

function drinksYTicks(maxTotal: number): number[] {
  const top = drinksYMax(maxTotal);
  const step = top <= 4 ? 1 : Math.ceil(top / 4);
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  return ticks;
}

/** BAC tick spacing scales with the range so a small night still gets useful ticks. */
function bacTickStep(maxBac: number): number {
  if (maxBac <= 0.02) return 0.005;
  if (maxBac <= 0.08) return 0.02;
  if (maxBac <= 0.16) return 0.04;
  return 0.05;
}

function bacYMax(maxBac: number): number {
  const step = bacTickStep(maxBac);
  return Math.max(step, Math.ceil(maxBac / step) * step);
}

function bacYTicks(maxBac: number): number[] {
  const step = bacTickStep(maxBac);
  const top = bacYMax(maxBac);
  const ticks: number[] = [];
  for (let value = 0; value <= top + 1e-9; value += step) ticks.push(Math.round(value * 1000) / 1000);
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

function buildDrinkSeries(members: Member[], drinks: Drink[], meId: string): SeriesData {
  const all: Series[] = members.map((member) => {
    const theirs = drinks
      .filter((drink) => drink.memberId === member.id)
      .sort((a, b) => a.consumedAt - b.consumedAt);
    let running = 0;
    const points = theirs.map((drink) => {
      running += drink.standardDrinks;
      return { t: drink.consumedAt, value: running };
    });
    return {
      member,
      points,
      value: running,
      lastDrinkAt: points.length > 0 ? points[points.length - 1]!.t : 0,
    };
  });

  const ranked = [...all].sort((a, b) => b.value - a.value);
  // Colour follows the member, never their rank, so slots stay stable as the
  // ranking churns; only membership of the chart changes.
  const keep = new Set(ranked.slice(0, MAX_SERIES).map((entry) => entry.member.id));
  keep.add(meId);
  const shown = all.filter((entry) => keep.has(entry.member.id) && entry.points.length > 0);

  return {
    series: shown,
    hidden: all.filter((entry) => entry.points.length > 0).length - shown.length,
    ineligible: 0,
    yTop: drinksYMax(Math.max(1, ...all.map((entry) => entry.value))),
  };
}

function buildBacSeries(
  members: Member[],
  drinks: Drink[],
  meId: string,
  domain: { start: number; end: number },
): SeriesData {
  // Someone who opted out has their weight and sex redacted for everyone but
  // themselves (see rooms.ts), so an estimate for them literally cannot be
  // computed here — this mirrors the same rule the leaderboard applies.
  const eligible = members.filter((member) => member.shareBac && member.weightKg != null);

  const all: Series[] = eligible.map((member) => {
    const theirs = drinks.filter((drink) => drink.memberId === member.id);
    if (theirs.length === 0) return { member, points: [], value: 0, lastDrinkAt: 0 };

    const profile = { weightKg: member.weightKg, sex: member.sex };
    const points = bacSampleTimes(theirs, domain.start, domain.end).map((t) => ({
      t,
      value: estimateBac(theirs, profile, t) ?? 0,
    }));

    return {
      member,
      points,
      value: points[points.length - 1]!.value,
      lastDrinkAt: Math.max(...theirs.map((drink) => drink.consumedAt)),
    };
  });

  const ranked = [...all].sort((a, b) => b.value - a.value);
  const keep = new Set(ranked.slice(0, MAX_SERIES).map((entry) => entry.member.id));
  keep.add(meId);
  const shown = all.filter((entry) => keep.has(entry.member.id) && entry.points.length > 0);

  return {
    series: shown,
    hidden: all.filter((entry) => entry.points.length > 0).length - shown.length,
    ineligible: members.length - eligible.length,
    // The peak actually reached in the window, not the current/final value —
    // otherwise the axis shrinks as someone's estimate decays and clips the
    // very peak it should be showing.
    yTop: bacYMax(Math.max(0, ...all.flatMap((entry) => entry.points.map((point) => point.value)))),
  };
}

/**
 * Drinks are discrete events, so the line steps rather than sloping: a level
 * run until the drink, then a jump. Sloping between drinks would imply drinking
 * continuously.
 */
function stepPath(
  points: Point[],
  end: number,
  x: (t: number) => number,
  y: (value: number) => number,
): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  const parts = [`M ${x(first.t)} ${y(0)}`, `L ${x(first.t)} ${y(first.value)}`];
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]!;
    parts.push(`L ${x(point.t)} ${y(points[i - 1]!.value)}`);
    parts.push(`L ${x(point.t)} ${y(point.value)}`);
  }
  parts.push(`L ${x(end)} ${y(points[points.length - 1]!.value)}`);
  return parts.join(' ');
}

/**
 * BAC actually is continuous — it rises the instant a drink lands and decays
 * steadily after — so unlike the drinks total, a straight connecting line
 * between samples is the honest shape rather than a simplification.
 */
function linePath(points: Point[], x: (t: number) => number, y: (value: number) => number): string {
  if (points.length === 0) return '';
  return points.map((point, i) => `${i === 0 ? 'M' : 'L'} ${x(point.t)} ${y(point.value)}`).join(' ');
}

/** The step value in effect at `time` — correct for a chart that only moves at events. */
function totalAt(points: Point[], time: number): number {
  let total = 0;
  for (const point of points) {
    if (point.t <= time) total = point.value;
  }
  return total;
}

/** Linear interpolation between the two samples bracketing `time`. */
function interpolateAt(points: Point[], time: number): number {
  if (points.length === 0) return 0;
  if (time <= points[0]!.t) return points[0]!.value;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    if (time <= curr.t) {
      const gap = curr.t - prev.t;
      const frac = gap <= 0 ? 0 : (time - prev.t) / gap;
      return prev.value + (curr.value - prev.value) * frac;
    }
  }
  return points[points.length - 1]!.value;
}
