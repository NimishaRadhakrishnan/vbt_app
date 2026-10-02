import React, { useState, useEffect } from "react";
import { Users, Award, TrendingUp, ChevronDown, ChevronUp, Send, Loader2 } from "lucide-react";
import MomentumWidget from "./MomentumWidget";
import { apiFetch } from "@/lib/api/client";

interface TeamMomentumCardProps {
  teamData: any;
  officersList: any[];
}

export default function TeamMomentumCard({ teamData, officersList }: TeamMomentumCardProps) {
  const [selectedOfficerId, setSelectedOfficerId] = useState<string | null>(null);
  const [officerMomentumData, setOfficerMomentumData] = useState<any | null>(null);
  const [loadingOfficer, setLoadingOfficer] = useState(false);

  // Kudos state
  const [showKudosForm, setShowKudosForm] = useState(false);
  const [kudosMessage, setKudosMessage] = useState("");
  const [submittingKudos, setSubmittingKudos] = useState(false);
  const [kudosSuccess, setKudosSuccess] = useState("");
  const [kudosError, setKudosError] = useState("");

  const handleSelectOfficer = async (officerId: string) => {
    if (selectedOfficerId === officerId) {
      setSelectedOfficerId(null);
      setOfficerMomentumData(null);
      setShowKudosForm(false);
      return;
    }
    
    setSelectedOfficerId(officerId);
    setLoadingOfficer(true);
    setShowKudosForm(false);
    setKudosSuccess("");
    setKudosError("");
    
    try {
      const data = await apiFetch(`/momentum/officers/${officerId}`);
      setOfficerMomentumData(data);
    } catch (err) {
      console.error("Failed to fetch officer momentum data", err);
      setOfficerMomentumData(null);
    } finally {
      setLoadingOfficer(false);
    }
  };

  const handleSendKudos = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOfficerId || !kudosMessage.trim()) return;

    setSubmittingKudos(true);
    setKudosSuccess("");
    setKudosError("");

    try {
      await apiFetch("/momentum/kudos", {
        method: "POST",
        body: JSON.stringify({
          to_user_id: selectedOfficerId,
          message: kudosMessage.trim()
        })
      });
      setKudosSuccess("Appreciation sent successfully!");
      setKudosMessage("");
      
      // Refresh the selected officer's data
      const data = await apiFetch(`/momentum/officers/${selectedOfficerId}`);
      setOfficerMomentumData(data);
      
      setTimeout(() => setShowKudosForm(false), 2000);
    } catch (err: any) {
      setKudosError(err.message || "Failed to send appreciation");
    } finally {
      setSubmittingKudos(false);
    }
  };

  if (!teamData) {
    return (
      <div className="w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex items-center justify-center min-h-[300px]">
        <div className="text-slate-400 font-medium">Loading Team Overview...</div>
      </div>
    );
  }

  const {
    percent_hit_target,
    team_badges_this_month,
    personal_bests_beaten_this_week
  } = teamData;

  const validOfficers = officersList.filter(o => o.role === 'field_officer' || o.role === 'sales_officer');

  return (
    <div className="w-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-600" />
          Team Momentum Overview
        </h2>

        {/* Top Aggregates */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center gap-4">
            <div className="bg-indigo-100 p-3 rounded-lg text-indigo-700">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{percent_hit_target}%</p>
              <p className="text-xs font-semibold text-slate-500 uppercase">On Target This Month</p>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center gap-4">
            <div className="bg-blue-100 p-3 rounded-lg text-blue-700">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{team_badges_this_month}</p>
              <p className="text-xs font-semibold text-slate-500 uppercase">Badges Earned</p>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center gap-4">
            <div className="bg-amber-100 p-3 rounded-lg text-amber-700">
              <Star className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{personal_bests_beaten_this_week}</p>
              <p className="text-xs font-semibold text-slate-500 uppercase">PBs Beaten This Week</p>
            </div>
          </div>
        </div>

        <hr className="border-slate-100 mb-6" />

        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4">
          Officer Drill-Down & Coaching
        </h3>
        
        <div className="space-y-3">
          {validOfficers.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No field officers in your territory.</p>
          ) : (
            validOfficers.map((officer) => (
              <div key={officer.id} className="border border-slate-200 rounded-xl overflow-hidden">
                <button 
                  onClick={() => handleSelectOfficer(officer.id)}
                  className="w-full bg-slate-50 hover:bg-slate-100 p-4 flex items-center justify-between transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
                      {officer.full_name?.charAt(0) || "U"}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{officer.full_name}</p>
                      <p className="text-xs font-medium text-slate-500">{officer.role.replace('_', ' ')}</p>
                    </div>
                  </div>
                  {selectedOfficerId === officer.id ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>

                {selectedOfficerId === officer.id && (
                  <div className="p-4 bg-white border-t border-slate-200">
                    {loadingOfficer ? (
                      <div className="flex justify-center p-6">
                        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                      </div>
                    ) : officerMomentumData ? (
                      <div className="space-y-4">
                        <MomentumWidget momentumData={officerMomentumData} />
                        
                        <div className="flex justify-end pt-2">
                          <button
                            onClick={() => setShowKudosForm(!showKudosForm)}
                            className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                          >
                            Give Appreciation
                          </button>
                        </div>

                        {showKudosForm && (
                          <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 mt-2">
                            <h4 className="text-sm font-bold text-indigo-900 mb-2">Send Appreciation to {officer.full_name}</h4>
                            <form onSubmit={handleSendKudos} className="flex flex-col gap-3">
                              <textarea
                                value={kudosMessage}
                                onChange={(e) => setKudosMessage(e.target.value)}
                                placeholder="Recognize great work (e.g. Thanks for resolving that issue so fast!)..."
                                className="w-full bg-white text-slate-800 p-3 rounded-lg border border-indigo-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none h-20"
                                required
                              />
                              {kudosError && <p className="text-xs font-bold text-red-600">{kudosError}</p>}
                              {kudosSuccess && <p className="text-xs font-bold text-green-600">{kudosSuccess}</p>}
                              
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setShowKudosForm(false)}
                                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="submit"
                                  disabled={submittingKudos}
                                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                                >
                                  {submittingKudos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                  Send
                                </button>
                              </div>
                            </form>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-red-500 text-center py-4">Failed to load officer data.</p>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Star(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}
