"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Clock, CheckCircle, XCircle, Archive, Search } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

// Phase 2 of the Disease Knowledge Search system: case submission and
// the officer's own submission list. The SEARCH interface arrives in
// Phase 3 - this page is deliberately shipped first so the knowledge
// base can start accumulating real verified content before search goes
// live. Searching an empty database would just teach officers that the
// feature doesn't work.

type CaseImage = { id: string; image_url: string; image_type: string | null; caption: string | null };

type KnowledgeCase = {
  id: string;
  case_number: number;
  question: string;
  crop_name: string | null;
  disease_name: string | null;
  crop_text: string | null;
  disease_text: string | null;
  symptoms: string | null;
  solution_used: string | null;
  notes: string | null;
  district: string | null;
  verification_status: string;
  rejection_reason: string | null;
  usage_count: number;
  created_at: string;
  images: CaseImage[];
};

const STATUS_STYLES: Record<string, { label: string; cls: string; Icon: any }> = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-600", Icon: Archive },
  pending_review: { label: "Pending Review", cls: "bg-amber-100 text-amber-800", Icon: Clock },
  verified: { label: "Verified", cls: "bg-emerald-100 text-emerald-700", Icon: CheckCircle },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-700", Icon: XCircle },
  archived: { label: "Archived", cls: "bg-slate-100 text-slate-500", Icon: Archive },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || { label: "Draft", cls: "bg-slate-100 text-slate-600", Icon: Archive };
  const Icon = s.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${s.cls}`}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

const inputCls =
  "w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-600";

export default function KnowledgeBasePage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [cases, setCases] = useState<KnowledgeCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState("");
  const [cropText, setCropText] = useState("");
  const [diseaseText, setDiseaseText] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [solutionUsed, setSolutionUsed] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // --- Phase 3 search ---
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResponse, setSearchResponse] = useState<any>(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSuccessMsg("");
    try {
      const data: any = await apiFetch("/knowledge/search", {
        method: "POST",
        body: JSON.stringify({ query: searchQuery.trim() }),
      });
      setSearchResponse(data);
    } catch (err: any) {
      setSearchResponse({ results: [], message: err.message || "Search failed.", can_create_case: false });
    } finally {
      setSearching(false);
    }
  };

  const openCase = async (caseId: string) => {
    // Records which result was actually opened (spec s20/s22) - fire and
    // forget, since failing to log a click must never block the officer
    // from reading the solution.
    apiFetch("/knowledge/search/select", {
      method: "POST",
      body: JSON.stringify({ case_id: caseId }),
    }).catch(() => {});
  };

  // --- Phase 4 feedback (spec s21) ---
  // Keyed by case_id so each result carries its own state - a single
  // shared value would make answering one card appear to answer all.
  const [feedback, setFeedback] = useState<Record<string, { was_useful: boolean; reason?: string }>>({});
  const [reasonPromptFor, setReasonPromptFor] = useState<string | null>(null);

  const sendFeedback = async (caseId: string, wasUseful: boolean, reason?: string) => {
    // Optimistic: the officer sees their answer land immediately. This is
    // a preference signal, not data they'd lose work over, so a failed
    // write reverting silently is the right trade rather than blocking
    // them behind a spinner.
    setFeedback((p) => ({ ...p, [caseId]: { was_useful: wasUseful, reason } }));
    if (!wasUseful && !reason) {
      setReasonPromptFor(caseId);
    } else {
      setReasonPromptFor(null);
    }
    try {
      await apiFetch(`/knowledge/cases/${caseId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ was_useful: wasUseful, reason: reason ?? null }),
      });
    } catch {
      setFeedback((p) => {
        const next = { ...p };
        delete next[caseId];
        return next;
      });
    }
  };

  const fetchCases = async () => {
    setLoading(true);
    setError("");
    try {
      const data: any = await apiFetch("/knowledge/cases/my");
      setCases(data || []);
    } catch (err: any) {
      setError(err.message || "Couldn't load your cases.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) fetchCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleSubmit = async () => {
    if (!question.trim()) {
      setFormError("Please describe the problem — that's the only required field.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      await apiFetch("/knowledge/cases", {
        method: "POST",
        body: JSON.stringify({
          question: question.trim(),
          crop_text: cropText.trim() || null,
          disease_text: diseaseText.trim() || null,
          symptoms: symptoms.trim() || null,
          solution_used: solutionUsed.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      setQuestion("");
      setCropText("");
      setDiseaseText("");
      setSymptoms("");
      setSolutionUsed("");
      setNotes("");
      setShowForm(false);
      setSuccessMsg("Case submitted. An admin will review it before it becomes searchable.");
      await fetchCases();
    } catch (err: any) {
      setFormError(err.message || "Couldn't submit the case.");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return <main className="p-6 text-sm text-slate-400">Loading…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h1 className="text-xl font-bold text-slate-900">Knowledge Base</h1>
          <p className="text-sm text-slate-500 mt-1">
            Share a problem you solved so other officers can find it later. An admin reviews each
            case before it becomes searchable.
          </p>
        </div>

        {successMsg && (
          <div className="p-4 rounded-lg text-sm font-medium bg-green-50 text-green-700 border border-green-200">
            {successMsg}
          </div>
        )}

        {/* Search (Phase 3). Results come entirely from stored,
            admin-verified cases - nothing here is generated. */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className={`${inputCls} pl-9`}
                placeholder="e.g. Tomato leaves have brown circular spots"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="px-5 py-2 bg-green-700 hover:bg-green-800 disabled:bg-slate-300 text-white text-sm font-bold rounded-lg transition"
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>

          {searchResponse && (
            <div className="space-y-3">
              {/* Spec s18/s19: this message is the guardrail that stops a
                  weak match reading as a confirmed answer. */}
              {searchResponse.message && (
                <div className="p-3 rounded-lg text-sm bg-amber-50 text-amber-800 border border-amber-200">
                  {searchResponse.message}
                </div>
              )}

              {(searchResponse.results || []).map((r: any) => (
                <div
                  key={r.case_id}
                  onClick={() => openCase(r.case_id)}
                  className="border border-slate-200 rounded-lg p-4 hover:border-green-400 cursor-pointer transition"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">
                        {r.disease_name || r.crop_name || "Previous case"}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{r.question}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                        {r.relevance_band}
                      </span>
                      {r.has_verified_solution && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                          <CheckCircle className="w-3 h-3" /> Verified
                        </span>
                      )}
                    </div>
                  </div>

                  {r.symptoms && (
                    <p className="text-xs text-slate-500 mt-2">
                      <span className="font-semibold">Symptoms:</span> {r.symptoms}
                    </p>
                  )}

                  {r.solution && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <p className="text-xs font-bold text-green-700 mb-1">
                        Verified Solution{r.solution.version_number ? ` (v${r.solution.version_number})` : ""}
                      </p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{r.solution.solution_text}</p>
                      {r.solution.precautions && (
                        <p className="text-xs text-amber-700 mt-2">
                          <span className="font-semibold">Precautions:</span> {r.solution.precautions}
                        </p>
                      )}
                    </div>
                  )}

                  <p className="text-[11px] text-slate-400 mt-2">
                    Case #{String(r.case_number).padStart(5, "0")}
                    {r.usage_count > 0 && ` · used ${r.usage_count} time${r.usage_count === 1 ? "" : "s"}`}
                  </p>

                  {/* Spec s21: only ask about results that actually
                      carried a solution - "was this useful?" on a bare
                      case with nothing attached has no useful answer. */}
                  {r.solution && (
                    <div
                      className="mt-3 pt-3 border-t border-slate-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {feedback[r.case_id] ? (
                        <p className="text-xs text-slate-500">
                          {feedback[r.case_id]?.was_useful
                            ? "Thanks — marked as useful."
                            : "Thanks — we've noted this wasn't helpful."}
                        </p>
                      ) : (
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs font-semibold text-slate-600">Was this useful?</span>
                          <button
                            onClick={() => sendFeedback(r.case_id, true)}
                            className="px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => sendFeedback(r.case_id, false)}
                            className="px-3 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200"
                          >
                            No
                          </button>
                        </div>
                      )}

                      {reasonPromptFor === r.case_id && (
                        <div className="mt-2">
                          <p className="text-xs text-slate-500 mb-1.5">What was wrong with it? (optional)</p>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              ["not_relevant", "Not relevant"],
                              ["incorrect", "Incorrect"],
                              ["outdated", "Outdated"],
                              ["incomplete", "Incomplete"],
                              ["other", "Other"],
                            ].map(([value, label]) => (
                              <button
                                key={value}
                                onClick={() => sendFeedback(r.case_id, false, value)}
                                className="px-2.5 py-1 rounded-full text-xs font-medium border border-slate-200 text-slate-600 hover:border-green-400 hover:text-green-700"
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Spec s18: no invented answer - offer to file the gap. */}
              {searchResponse.can_create_case && (
                <button
                  onClick={() => {
                    setQuestion(searchQuery);
                    setShowForm(true);
                    setSuccessMsg("");
                  }}
                  className="w-full py-2.5 text-sm font-semibold text-green-700 border border-dashed border-green-300 rounded-lg hover:bg-green-50"
                >
                  + Submit this as a new case
                </button>
              )}
            </div>
          )}
        </div>

        {!showForm ? (
          <button
            onClick={() => { setShowForm(true); setSuccessMsg(""); setFormError(""); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-green-700 hover:bg-green-800 text-white text-sm font-bold rounded-lg transition"
          >
            <Plus className="w-4 h-4" /> Submit a Case
          </button>
        ) : (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">New Case</h2>
            {formError && <p className="text-xs font-bold text-red-600">{formError}</p>}

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                What was the problem? <span className="text-red-500">*</span>
              </label>
              <textarea
                className={inputCls}
                rows={3}
                placeholder="e.g. Tomato leaves turning brown with circular spots"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Crop</label>
                <input className={inputCls} placeholder="e.g. Tomato" value={cropText} onChange={(e) => setCropText(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Disease / pest (if known)
                </label>
                <input className={inputCls} placeholder="Leave blank if unsure" value={diseaseText} onChange={(e) => setDiseaseText(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Symptoms you saw</label>
              <textarea className={inputCls} rows={2} value={symptoms} onChange={(e) => setSymptoms(e.target.value)} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">What solved it?</label>
              <textarea
                className={inputCls}
                rows={3}
                placeholder="The treatment or advice that worked"
                value={solutionUsed}
                onChange={(e) => setSolutionUsed(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Other notes</label>
              <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowForm(false); setFormError(""); }}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-slate-300 text-white text-sm font-bold rounded-lg"
              >
                {submitting ? "Submitting…" : "Submit Case"}
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide">My Submissions</h2>
          </div>

          {loading ? (
            <p className="p-8 text-center text-sm text-slate-400">Loading…</p>
          ) : error ? (
            <div className="p-8 text-center">
              <p className="text-sm text-red-600 mb-3">{error}</p>
              <button onClick={fetchCases} className="text-xs font-semibold text-green-700 hover:underline">
                Try again
              </button>
            </div>
          ) : cases.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">
              You haven&apos;t submitted any cases yet — tap &quot;Submit a Case&quot; above to add one.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {cases.map((c) => (
                <div key={c.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">{c.question}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Case #{String(c.case_number).padStart(5, "0")}
                        {(c.crop_name || c.crop_text) && ` · ${c.crop_name || c.crop_text}`}
                        {(c.disease_name || c.disease_text) && ` · ${c.disease_name || c.disease_text}`}
                      </p>
                    </div>
                    <StatusBadge status={c.verification_status} />
                  </div>

                  {/* An officer whose case was rejected should be able to
                      see why, not just that it disappeared. */}
                  {c.verification_status === "rejected" && c.rejection_reason && (
                    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
                      <span className="font-semibold">Not accepted:</span> {c.rejection_reason}
                    </p>
                  )}

                  {c.verification_status === "verified" && c.usage_count > 0 && (
                    <p className="text-xs text-emerald-700 mt-2">
                      Helped {c.usage_count} other {c.usage_count === 1 ? "officer" : "officers"}.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
