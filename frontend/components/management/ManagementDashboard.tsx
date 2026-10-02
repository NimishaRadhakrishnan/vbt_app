"use client";

/**
 * The business in thirty seconds, for the person who owns it.
 *
 * Written for a reader who is not technical, may be older, and is not going
 * to hunt for anything. That shapes every decision here:
 *
 *   * **Big numbers, plain words.** The headline is set large enough to read
 *     across a desk. Nothing on this screen says "conversion funnel",
 *     "YoY", "attach rate" or "contribution margin %" without also saying it
 *     in a sentence.
 *
 *   * **Every chart carries its own explanation**, and the sentence comes
 *     from the server - the same place the number came from. If the wording
 *     were written here it could say "sales are up" beside a figure that had
 *     gone down, and nobody would catch it.
 *
 *   * **Order is the answer to "what matters".** Money first, then the trend,
 *     then who and what, then where, then seasons, then the people who need
 *     attention. A reader who stops after the first screenful has still had
 *     the important part.
 *
 *   * **An unknown is never drawn as a zero.** Where the data does not exist
 *     the card says so and says what to enter to fix it. A zero and an
 *     unknown look identical and mean opposite things.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Info,
  Loader2,
  Minus,
} from "lucide-react";

import { apiFetch } from "@/lib/api/client";
import { HorizontalBars, SeasonLines, TrendLine, seriesColor } from "./charts";

// ---------------------------------------------------------------- types

type Figure = {
  value: number | null;
  display: string;
  note: string;
  direction: "up" | "down" | "flat" | "unknown";
};

type Milestone = {
  stages: string[];
  reached_index: number;
  current_stage: string;
  note: string;
};

type Officer = {
  officer_id: string;
  name: string;
  role: string;
  employee_id: string | null;
  rank: number;
  visits: number;
  farmers_contacted: number;
  dealers_contacted: number;
  orders: number;
  products_sold: number;
  units_sold: number;
  new_farmers: number;
  follow_ups_planned: number;
  follow_ups_due: number;
  follow_up_note: string;
  districts_covered: number;
  districts_total: number;
  coverage_note: string;
  sales_value: number;
  sales_display: string;
  growth_percent: number | null;
  target_value: number | null;
  target_display: string | null;
  achievement_percent: number | null;
  target_note: string;
  milestone: Milestone;
  headline: string;
  needs_attention: string | null;
};

type ProductRow = {
  product_id: string;
  name: string;
  sku_code: string;
  has_cost_price: boolean;
  revenue: number;
  revenue_display: string;
  units: number;
  share_percent: number;
  growth_percent: number | null;
  note: string;
};

type Dashboard = {
  period: { label: string; month: string };
  headline: {
    period_label: string;
    total_sales: Figure;
    growth_percent: Figure;
    units_sold: Figure;
    orders: Figure;
    officers_selling: Figure;
  };
  contribution: {
    available: boolean;
    contribution: Figure;
    margin_percent?: number;
    coverage_percent: number | null;
    products_without_cost: number;
  };
  funnel: {
    visits: number;
    visits_with_sale: number;
    conversion_percent: number | null;
    orders: number;
    new_farmers: number;
    new_dealers: number;
    note: string;
  };
  trend: { points: { label: string; revenue: number; revenue_display: string }[]; note: string };
  officers: Officer[];
  products: {
    products: ProductRow[];
    top: ProductRow | null;
    slow_moving: ProductRow[];
    slow_moving_note: string;
    total_revenue_display: string;
  };
  territories: {
    districts: { district: string; revenue: number; revenue_display: string; officers: number; note: string }[];
    best: { district: string } | null;
    note: string;
  };
  seasonality: {
    has_enough_history: boolean;
    months_with_sales: number;
    months_needed: number;
    history_note: string;
    products: { product_id: string; name: string; points: { label: string; revenue: number }[] }[];
    insights: { product_id: string; name: string; sentence: string }[];
  };
  answers: Record<string, string>;
  needs_attention: { name: string; officer_id: string; reason: string }[];
  dormant: { count: number; officer_ids: string[]; note: string };
};

// ------------------------------------------------------------- pieces

function Direction({ direction }: { direction: Figure["direction"] }) {
  if (direction === "up")
    return <ArrowUpRight className="w-7 h-7 text-success-600" aria-label="increased" />;
  if (direction === "down")
    return <ArrowDownRight className="w-7 h-7 text-red-600" aria-label="decreased" />;
  if (direction === "flat")
    return <Minus className="w-7 h-7 text-slate-400" aria-label="about the same" />;
  return null;
}

/** The one number the whole screen is about. */
function Headline({ figure, label }: { figure: Figure; label: string }) {
  return (
    // h-full and centred: without it the headline card is shorter than the
    // two stat cards stacked beside it and leaves a band of empty white under
    // the most important number on the screen.
    <div className="bg-white rounded-xl border border-slate-200 p-6 md:p-8 h-full flex flex-col justify-center">
      <p className="text-lg text-slate-500">{label}</p>
      <div className="flex items-center gap-4 mt-1 flex-wrap">
        <span className="text-5xl md:text-6xl font-bold text-slate-900 tabular-nums">
          {figure.display}
        </span>
        <Direction direction={figure.direction} />
      </div>
      <p className="text-xl text-slate-700 mt-3 leading-snug">{figure.note}</p>
    </div>
  );
}

/** A supporting number: still large, still explained. */
function Stat({
  label,
  value,
  note,
  tone = "normal",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "normal" | "muted";
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-base text-slate-500">{label}</p>
      <p
        className={`text-3xl font-bold tabular-nums mt-1 ${
          tone === "muted" ? "text-slate-400" : "text-slate-900"
        }`}
      >
        {value}
      </p>
      {note && <p className="text-sm text-slate-500 mt-2 leading-snug">{note}</p>}
    </div>
  );
}

/** A titled card with the explanation directly under the chart. */
function Panel({
  title,
  explanation,
  children,
  action,
}: {
  title: string;
  explanation?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 md:p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
      {explanation && (
        <p className="text-lg text-slate-700 mt-4 leading-snug border-t border-slate-100 pt-3">
          {explanation}
        </p>
      )}
    </section>
  );
}

/**
 * The officer's month as a track of stages.
 *
 * Stages read left to right in the order the work actually happens, so a
 * glance at how far the fill has travelled is the whole answer. Reached
 * stages are also ticked, so the progress is not carried by colour alone.
 */
function MilestoneTrack({ milestone }: { milestone: Milestone }) {
  return (
    <div>
      <ol className="flex flex-wrap gap-x-1 gap-y-3">
        {milestone.stages.map((stage, index) => {
          const reached = index <= milestone.reached_index;
          const current = index === milestone.reached_index;
          return (
            <li key={stage} className="flex items-center gap-1 min-w-0">
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${
                  current
                    ? "bg-primary-700 border-primary-700 text-white"
                    : reached
                      ? "bg-success-50 border-success-200 text-success-800"
                      : "bg-slate-50 border-slate-200 text-slate-400"
                }`}
              >
                {reached && !current && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                <span className="text-sm font-medium whitespace-nowrap">{stage}</span>
              </div>
              {index < milestone.stages.length - 1 && (
                <ArrowRight className="w-4 h-4 text-slate-300 shrink-0" />
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-base text-slate-600 mt-3">{milestone.note}</p>
    </div>
  );
}

/** Target vs achievement, as a bar anybody can read without a number. */
function TargetBar({ officer }: { officer: Officer }) {
  if (officer.achievement_percent === null) {
    return <p className="text-base text-slate-500">{officer.target_note}</p>;
  }
  const percent = Math.min(100, officer.achievement_percent);
  const achieved = officer.achievement_percent >= 100;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-base text-slate-600">
          {officer.sales_display} of {officer.target_display}
        </span>
        <span
          className={`text-lg font-bold tabular-nums ${
            achieved ? "text-success-700" : "text-slate-900"
          }`}
        >
          {officer.achievement_percent}%
        </span>
      </div>
      <div className="h-4 w-full rounded bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-r ${achieved ? "bg-success-600" : "bg-primary-700"}`}
          style={{ width: `${Math.max(1, percent)}%` }}
        />
      </div>
      <p className="text-base text-slate-600 mt-2">{officer.target_note}</p>
    </div>
  );
}

function OfficerDetail({ officer }: { officer: Officer }) {
  const facts: { label: string; value: string }[] = [
    { label: "Visits completed", value: String(officer.visits) },
    { label: "Farmers contacted", value: String(officer.farmers_contacted) },
    { label: "Dealers contacted", value: String(officer.dealers_contacted) },
    { label: "Orders generated", value: String(officer.orders) },
    { label: "Products sold", value: String(officer.products_sold) },
    { label: "Units sold", value: officer.units_sold.toLocaleString("en-IN") },
    { label: "New farmers added", value: String(officer.new_farmers) },
    { label: "Sales value", value: officer.sales_display },
  ];

  return (
    <div className="bg-slate-50 border-t border-slate-200 p-5 space-y-5">
      <p className="text-xl text-slate-800 leading-snug">{officer.headline}</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-white rounded-lg border border-slate-200 p-3">
            <p className="text-sm text-slate-500">{fact.label}</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{fact.value}</p>
          </div>
        ))}
      </div>

      <div>
        <h4 className="text-base font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Target this month
        </h4>
        <TargetBar officer={officer} />
      </div>

      <div>
        <h4 className="text-base font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Progress
        </h4>
        <MilestoneTrack milestone={officer.milestone} />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <p className="text-base text-slate-600">{officer.follow_up_note}</p>
        <p className="text-base text-slate-600">{officer.coverage_note}</p>
      </div>
    </div>
  );
}

/** One row of the officer list, used for both the active and dormant groups. */
function OfficerRow({
  officer,
  open,
  onToggle,
}: {
  officer: Officer;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left px-5 md:px-6 py-4 hover:bg-slate-50 flex items-center justify-between gap-4"
      >
        <div className="min-w-0">
          <p className="text-xl font-semibold text-slate-900 truncate">
            {officer.name}
            {officer.needs_attention && officer.visits > 0 && (
              <AlertTriangle
                className="w-5 h-5 text-amber-600 inline-block ml-2 -mt-1"
                aria-label="needs attention"
              />
            )}
          </p>
          <p className="text-base text-slate-500">
            {officer.milestone.current_stage} · {officer.visits} visit
            {officer.visits === 1 ? "" : "s"}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold text-slate-900 tabular-nums">
            {officer.sales_display}
          </p>
          {officer.achievement_percent !== null && (
            <p
              className={`text-base font-medium ${
                officer.achievement_percent >= 100 ? "text-success-700" : "text-slate-500"
              }`}
            >
              {officer.achievement_percent}% of target
            </p>
          )}
        </div>
      </button>
      {open && <OfficerDetail officer={officer} />}
    </li>
  );
}

// --------------------------------------------------------------- page

export default function ManagementDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openOfficer, setOpenOfficer] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    apiFetch<Dashboard>("/momentum/management/dashboard")
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load the dashboard.")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const productBars = useMemo(
    () =>
      (data?.products.products ?? [])
        .filter((p) => p.revenue > 0)
        .map((p) => ({ label: p.name, value: p.revenue, display: p.revenue_display })),
    [data]
  );

  const officerBars = useMemo(
    () =>
      (data?.officers ?? [])
        .filter((o) => o.sales_value > 0)
        .map((o) => ({
          label: o.name,
          value: o.sales_value,
          display: o.sales_display,
          sublabel: o.role === "sales_officer" ? "Sales officer" : "Field officer",
        })),
    [data]
  );

  const districtBars = useMemo(
    () =>
      (data?.territories.districts ?? [])
        .filter((d) => d.revenue > 0)
        .map((d) => ({
          label: d.district,
          value: d.revenue,
          display: d.revenue_display,
          sublabel: `${d.officers} officer${d.officers === 1 ? "" : "s"}`,
        })),
    [data]
  );

  // An officer with no visits and no sales is dormant, not underperforming.
  // They stay on the page, one group down, so the list of people whose month
  // can still be acted on is the one in front of the reader.
  const activeOfficers = useMemo(
    () => (data?.officers ?? []).filter((o) => o.visits > 0 || o.sales_value > 0),
    [data]
  );
  const dormantOfficers = useMemo(
    () => (data?.officers ?? []).filter((o) => o.visits === 0 && o.sales_value <= 0),
    [data]
  );

  const seasonSeries = useMemo(
    () =>
      (data?.seasonality.products ?? []).slice(0, 4).map((p) => ({
        name: p.name,
        points: p.points.map((pt) => ({ label: pt.label, value: pt.revenue })),
      })),
    [data]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-lg text-slate-500 py-12 justify-center">
        <Loader2 className="w-6 h-6 animate-spin" /> Loading the business summary...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-5 text-lg">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const { headline, contribution, funnel, products, territories, seasonality } = data;

  return (
    <div className="space-y-6">
      {/* 1. How much did we sell, and is it going up or down. */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Headline
            figure={headline.total_sales}
            label={`Total sales in ${headline.period_label}`}
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
          <Stat
            label="Orders"
            value={headline.orders.display}
            note={headline.orders.note}
          />
          <Stat
            label="Units sold"
            value={headline.units_sold.display}
            note={headline.units_sold.note}
          />
        </div>
      </div>

      {/* Profit, or a plain statement that it cannot be shown yet. */}
      <div className="grid md:grid-cols-2 gap-4">
        {contribution.available ? (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-lg text-slate-500">Contribution after product cost</p>
            <p className="text-4xl font-bold text-slate-900 tabular-nums mt-1">
              {contribution.contribution.display}
            </p>
            <p className="text-lg text-slate-700 mt-2 leading-snug">
              {contribution.contribution.note}
            </p>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
            <div className="flex items-start gap-3">
              <Info className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-lg font-semibold text-amber-900">
                  Profit cannot be shown yet
                </p>
                <p className="text-lg text-amber-900 mt-1 leading-snug">
                  {contribution.contribution.note}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-lg text-slate-500">Are field visits producing business?</p>
          <p className="text-4xl font-bold text-slate-900 tabular-nums mt-1">
            {funnel.visits_with_sale} of {funnel.visits}
          </p>
          <p className="text-lg text-slate-700 mt-2 leading-snug">{funnel.note}</p>
          <p className="text-base text-slate-500 mt-3">
            {funnel.new_farmers} new farmers and {funnel.new_dealers} new dealers added
            this month.
          </p>
        </div>
      </div>

      {/* 2. The trend. */}
      <Panel title="Sales month by month" explanation={data.trend.note}>
        <TrendLine
          points={data.trend.points.map((p) => ({
            label: p.label,
            value: p.revenue,
            display: p.revenue_display,
          }))}
        />
      </Panel>

      {/* 3 & 4. Who sells most, what sells most. */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel
          title="Who is selling the most"
          explanation={data.answers.who_sells_most}
        >
          <HorizontalBars
            data={officerBars}
            emptyMessage="No officer has recorded a sale this month."
          />
        </Panel>

        <Panel
          title="Which products are selling"
          explanation={products.top?.note ?? products.slow_moving_note}
        >
          <HorizontalBars
            data={productBars}
            emptyMessage="No product has sold this month."
          />
          {products.slow_moving.length > 0 && (
            <p className="text-base text-slate-600 mt-4 bg-slate-50 rounded-lg p-3">
              <span className="font-semibold">Not selling: </span>
              {products.slow_moving.map((p) => p.name).join(", ")}.
            </p>
          )}
        </Panel>
      </div>

      {/* 5. Where. */}
      <Panel title="Where products are selling" explanation={territories.note}>
        <HorizontalBars
          data={districtBars}
          emptyMessage="No district has recorded sales this month."
        />
      </Panel>

      {/* 6. Seasons. */}
      <Panel
        title="Which products are seasonal"
        explanation={seasonality.history_note}
      >
        {seasonality.has_enough_history ? (
          <>
            <SeasonLines series={seasonSeries} />
            <ul className="mt-4 space-y-2">
              {seasonality.insights.map((insight) => (
                <li
                  key={insight.product_id}
                  className="text-lg text-slate-800 flex items-start gap-2"
                >
                  <span
                    className="inline-block w-3 h-3 rounded-full mt-2 shrink-0"
                    style={{
                      backgroundColor: seriesColor(
                        seasonSeries.findIndex((s) => s.name === insight.name)
                      ),
                    }}
                  />
                  {insight.sentence}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="bg-slate-50 rounded-lg p-5 text-lg text-slate-700">
            {seasonality.history_note}
            <p className="text-base text-slate-500 mt-2">
              {seasonality.months_with_sales} of {seasonality.months_needed} months
              recorded so far.
            </p>
          </div>
        )}
      </Panel>

      {/* 7. Who needs attention — before the full list, because it is the
          part a busy reader must not miss. */}
      {data.needs_attention.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-5 md:p-6">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-7 h-7 text-amber-700" />
            <h2 className="text-2xl font-bold text-amber-900">Needs attention</h2>
          </div>
          <ul className="space-y-2">
            {data.needs_attention.map((item) => (
              <li key={item.officer_id} className="text-lg text-amber-900">
                <button
                  type="button"
                  onClick={() => setOpenOfficer(item.officer_id)}
                  className="font-semibold underline underline-offset-2"
                >
                  {item.name}
                </button>{" "}
                — {item.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 8. Every officer, click to open.
          Officers with no activity at all are grouped behind a single line
          rather than listed one by one. Seen on the real screen, a dozen
          dormant accounts pushed the people who are actually working off the
          first screenful and made the warning icon meaningless. They are
          still here, and still countable — just not competing for the
          attention of someone reading for thirty seconds. */}
      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-5 md:p-6 pb-3">
          <h2 className="text-2xl font-bold text-slate-900">Every officer this month</h2>
          <p className="text-lg text-slate-600 mt-1">
            Click a name to see their full performance.
          </p>
        </div>
        <ul className="divide-y divide-slate-100">
          {activeOfficers.map((officer) => (
            <OfficerRow
              key={officer.officer_id}
              officer={officer}
              open={openOfficer === officer.officer_id}
              onToggle={() =>
                setOpenOfficer(
                  openOfficer === officer.officer_id ? null : officer.officer_id
                )
              }
            />
          ))}
        </ul>

        {dormantOfficers.length > 0 && (
          <details className="border-t border-slate-200">
            <summary className="cursor-pointer px-5 md:px-6 py-4 text-lg text-slate-600 hover:bg-slate-50">
              {data.dormant.note || `${dormantOfficers.length} officer(s) had no activity.`}
            </summary>
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {dormantOfficers.map((officer) => (
                <OfficerRow
                  key={officer.officer_id}
                  officer={officer}
                  open={openOfficer === officer.officer_id}
                  onToggle={() =>
                    setOpenOfficer(
                      openOfficer === officer.officer_id ? null : officer.officer_id
                    )
                  }
                />
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
