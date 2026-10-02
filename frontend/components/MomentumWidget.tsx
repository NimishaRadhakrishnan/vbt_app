import React from "react";
import { TrendingUp, Target, Award, Star, MessageCircle, Calendar } from "lucide-react";

interface MomentumWidgetProps {
  momentumData: any;
}

export default function MomentumWidget({ momentumData }: MomentumWidgetProps) {
  if (!momentumData) {
    return (
      <div className="w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex items-center justify-center min-h-[300px]">
        <div className="text-slate-400 font-medium">Loading Momentum data...</div>
      </div>
    );
  }

  const {
    momentum_score,
    monthly_tasks_completed,
    monthly_task_target,
    trend_label,
    personal_bests,
    badges,
    recent_kudos,
  } = momentumData;

  const progressPercent = Math.min(100, Math.round((monthly_tasks_completed / (monthly_task_target || 1)) * 100));

  return (
    <div className="w-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 space-y-6">
        
        {/* Header: Score & Goal */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-green-100 p-4 rounded-xl text-green-700">
              <TrendingUp className="w-8 h-8" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Momentum Score</p>
              <h2 className="text-3xl font-bold text-slate-800">{momentum_score}</h2>
            </div>
          </div>

          <div className="flex-1 max-w-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-slate-600 flex items-center gap-2">
                <Target className="w-4 h-4 text-slate-400" />
                Monthly Goal
              </p>
              <p className="text-sm font-bold text-slate-800">
                {monthly_tasks_completed} / {monthly_task_target} tasks
              </p>
            </div>
            <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
              <div 
                className="bg-green-500 h-full rounded-full transition-all duration-1000 ease-out" 
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {trend_label ? (
              <p className="text-xs font-medium text-slate-500 mt-2 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                {trend_label}
              </p>
            ) : (
              <p className="text-xs font-medium text-slate-500 mt-2">
                {progressPercent >= 100 
                  ? "Target achieved! Great job." 
                  : "Keep going, you're making progress!"}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
          
          {/* Personal Bests */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-500" />
              Personal Bests
            </h3>
            {(!personal_bests || personal_bests.length === 0) ? (
              <p className="text-sm text-slate-500 italic">No personal bests recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {personal_bests.map((pb: any) => (
                  <div key={pb.id} className="flex items-center justify-between bg-amber-50 rounded-lg p-3 border border-amber-100">
                    <div>
                      <p className="text-sm font-semibold text-amber-900 capitalize">
                        {pb.metric.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs font-medium text-amber-700">
                        {pb.achieved_period_start} to {pb.achieved_period_end}
                      </p>
                    </div>
                    <div className="text-lg font-bold text-amber-600">
                      {pb.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Badges & Appreciation */}
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="flex items-center gap-2 mb-2">
              <Award className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-700">
                Badges & Appreciation
              </h3>
            </div>
            <div className="space-y-4">
              {(!badges || badges.length === 0) && (!recent_kudos || recent_kudos.length === 0) ? (
                <p className="text-sm text-slate-500 italic">Keep working to earn badges and appreciation!</p>
              ) : null}

              {/* Badges horizontally scrollable */}
              {badges && badges.length > 0 && (
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                  {badges.map((b: any) => (
                    <div key={b.id} className="flex-shrink-0 w-28 bg-blue-50 border border-blue-100 rounded-xl p-3 text-center" title={b.description}>
                      <Award className="w-6 h-6 text-blue-600 mx-auto mb-2" />
                      <p className="text-xs font-bold text-blue-900 leading-tight">{b.title}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Appreciation list */}
              {recent_kudos && recent_kudos.length > 0 && (
                <div className="mt-2 space-y-2">
                  {recent_kudos.map((kudo: any) => (
                    <div key={kudo.id} className="bg-white rounded-lg p-3 text-sm flex gap-3 border border-slate-100">
                      <MessageCircle className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-slate-800 italic">&quot;{kudo.message}&quot;</p>
                        <p className="text-xs font-semibold text-slate-500 mt-1">
                          From: {kudo.from_user_name} • {new Date(kudo.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
