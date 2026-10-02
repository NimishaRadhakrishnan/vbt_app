"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, XCircle, TrendingUp, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

// Admin side of the knowledge system: the review queue (spec s8), the
// cold-start promotion queue (Phase 5), the knowledge-gap list (s24),
// and the statistics dashboard (s23).

const inputCls =
  "w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-600";

type Tab = "review" | "promote" | "gaps" | "stats";

export default function AdminKnowledgePage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("review");

  const [pending, setPending] = useState<any[]>([]);
  const [promotable, setPromotable] = useState<any[]>([]);
  const [gaps, setGaps] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // Promotion editor state - keyed by issue id so editing one row can't
  // leak into another.
  const [editing, setEditing] = useState<string | null>(null);
  const [draftQuestion, setDraftQuestion] = useState("");
  const [draftSolution, setDraftSolution] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      if (tab === "review") {
        const d: any = await apiFetch("/admin/knowledge/cases?verification_status=pending_review");
        setPending(d || []);
      } else if (tab === "promote") {
        const d: any = await apiFetch("/admin/knowledge/promotable-issues");
        setPromotable(d || []);
      } else if (tab === "gaps") {
        const d: any = await apiFetch("/admin/knowledge/unanswered");
        setGaps(d || []);
      } else {
        const d: any = await apiFetch("/admin/knowledge/stats");
        setStats(d);
      }
    } catch (err: any) {
      setError(err.message || "Couldn't load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tab]);

  const verifyCase = async (id: string) => {
    try {
      await apiFetch(`/admin/knowledge/cases/${id}/verify`, { method: "PUT", body: JSON.stringify({}) });
      setMsg("Case verified — it's now searchable by officers.");
      await load();
    } catch (err: any) {
      setError(err.message || "Couldn't verify.");
    }
  };

  const rejectCase = async (id: string) => {
    const reason = window.prompt("Why is this being rejected? The officer will see this.");
    if (!reason?.trim()) return;
    try {
      await apiFetch(`/admin/knowledge/cases/${id}/reject`, {
        method: "PUT",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setMsg("Case rejected.");
      await load();
    } catch (err: any) {
      setError(err.message || "Couldn't reject.");
    }
  };

  const promote = async (issueId: string) => {
    try {
      await apiFetch(`/admin/knowledge/promote-issue/${issueId}`, {
        method: "POST",
        body: JSON.stringify({
          question: draftQuestion.trim() || undefined,
          solution_text: draftSolution.trim() || undefined,
        }),
      });
      setEditing(null);
      setMsg("Promoted into the knowledge base — officers can find it now.");
      await load();
    } catch (err: any) {
      setError(err.message || "Couldn't promote.");
    }
  };

  if (authLoading) return <main className="p-6 text-sm text-slate-400">Loading…</main>;

  if (user && user.role !== "admin") {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <p className="text-sm text-slate-500">This page is for administrators.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h1 className="text-xl font-bold text-slate-900">Knowledge Administration</h1>
          <p className="text-sm text-slate-500 mt-1">
            Review submissions, build knowledge from past crop issues, and see what officers can&apos;t find.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ["review", "Review Queue"],
            ["promote", "Build from Past Issues"],
            ["gaps", "Knowledge Gaps"],
            ["stats", "Statistics"],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setTab(key); setMsg(""); setError(""); }}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                tab === key ? "bg-green-700 text-white" : "bg-white text-slate-600 border border-slate-200 hover:border-green-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {msg && <div className="p-3 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200">{msg}</div>}
        {error && <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}

        {loading ? (
          <p className="text-sm text-slate-400 p-6 text-center">Loading…</p>
        ) : tab === "review" ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 divide-y divide-slate-100">
            {pending.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">Nothing waiting for review.</p>
            ) : (
              pending.map((c) => (
                <div key={c.id} className="p-4">
                  <p className="text-sm font-semibold text-slate-800">{c.question}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Case #{String(c.case_number).padStart(5, "0")}
                    {c.officer_name && ` · ${c.officer_name}`}
                    {(c.crop_name || c.crop_text) && ` · ${c.crop_name || c.crop_text}`}
                  </p>
                  {c.symptoms && <p className="text-xs text-slate-600 mt-2"><span className="font-semibold">Symptoms:</span> {c.symptoms}</p>}
                  {c.solution_used && <p className="text-xs text-slate-600 mt-1"><span className="font-semibold">What worked:</span> {c.solution_used}</p>}
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => verifyCase(c.id)} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-semibold">
                      <CheckCircle className="w-3.5 h-3.5" /> Verify
                    </button>
                    <button onClick={() => rejectCase(c.id)} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg text-xs font-semibold">
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : tab === "promote" ? (
          <div className="space-y-3">
            <div className="p-3 rounded-lg text-xs bg-slate-100 text-slate-600">
              These are past crop issues an expert already answered. Edit the wording so it reads as
              general guidance, then promote it — expert replies were written for one farmer, and
              usually need rewording before they&apos;re useful to the next officer.
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 divide-y divide-slate-100">
              {promotable.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-400">
                  No unpromoted resolved issues with an expert answer.
                </p>
              ) : (
                promotable.map((i) => (
                  <div key={i.id} className="p-4">
                    {editing === i.id ? (
                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-slate-600">Problem (as a future officer would search it)</label>
                        <textarea className={inputCls} rows={2} value={draftQuestion} onChange={(e) => setDraftQuestion(e.target.value)} />
                        <label className="block text-xs font-semibold text-slate-600">Solution</label>
                        <textarea className={inputCls} rows={4} value={draftSolution} onChange={(e) => setDraftSolution(e.target.value)} />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs font-semibold text-slate-500">Cancel</button>
                          <button onClick={() => promote(i.id)} className="px-3 py-1.5 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-lg">
                            Promote to Knowledge
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-slate-800">{i.symptoms}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {i.crop} · {i.district}
                          {i.officer_name && ` · reported by ${i.officer_name}`}
                        </p>
                        <p className="text-xs text-slate-600 mt-2 bg-slate-50 border border-slate-100 rounded-lg p-2">
                          <span className="font-semibold">Expert reply:</span> {i.expert_reply}
                        </p>
                        <button
                          onClick={() => { setEditing(i.id); setDraftQuestion(i.symptoms || ""); setDraftSolution(i.expert_reply || ""); }}
                          className="mt-3 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
                        >
                          Review &amp; Promote
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : tab === "gaps" ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 divide-y divide-slate-100">
            {gaps.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">
                No unanswered searches — officers are finding what they need.
              </p>
            ) : (
              gaps.map((g) => (
                <div key={g.id} className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{g.sample_query}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Searched {g.search_count} time{g.search_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 flex-shrink-0">
                    {g.search_count}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : stats ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ["Verified", stats.cases.verified, "text-emerald-700"],
                ["Pending", stats.cases.pending_review, "text-amber-700"],
                ["Rejected", stats.cases.rejected, "text-red-700"],
                ["Total cases", stats.cases.total, "text-slate-800"],
              ].map(([label, val, cls]: any) => (
                <div key={label} className="bg-white p-4 rounded-xl border border-slate-100">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className={`text-2xl font-bold ${cls}`}>{val}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ["Searches", stats.search.total_searches],
                ["No results", stats.search.no_result_searches],
                ["Weak results", stats.search.low_relevance_searches],
                ["Open gaps", stats.search.open_knowledge_gaps],
              ].map(([label, val]: any) => (
                <div key={label} className="bg-white p-4 rounded-xl border border-slate-100">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="text-2xl font-bold text-slate-800">{val}</p>
                </div>
              ))}
            </div>

            {stats.needs_attention?.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-100">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                    Marked unhelpful more often than helpful
                  </h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {stats.needs_attention.map((c: any) => (
                    <div key={c.id} className="p-3 flex justify-between gap-3">
                      <p className="text-sm text-slate-700 min-w-0">{c.question}</p>
                      <span className="text-xs font-semibold text-red-600 flex-shrink-0">
                        {c.not_helpful}/{c.total_feedback}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {stats.most_used_cases?.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-100">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide">Most used knowledge</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {stats.most_used_cases.map((c: any) => (
                    <div key={c.id} className="p-3 flex justify-between gap-3">
                      <p className="text-sm text-slate-700 min-w-0">{c.question}</p>
                      <span className="text-xs text-slate-500 flex-shrink-0">
                        {c.usage_count} uses · {c.helpful} helpful
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
