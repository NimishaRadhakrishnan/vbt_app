import React, { useState } from 'react';
import { Calendar, CheckCircle, Clock, FileText, ArrowUp, ArrowDown } from 'lucide-react';

interface Stat {
  label: string;
  value: number | string;
  previousValue: number;
  unit?: string;
  icon: React.ElementType;
}

interface ProductivityData {
  tasksCompleted: number;
  tasksTotal: number;
  trend_data: { name: string; tasks: number; visits: number }[];
  previous_tasks_completed: number;
  visitsCompleted: number;
  previous_visits_completed: number;
  timeSpent: number;
  previous_time_spent: number;
  reportsFiled: number;
  previous_reports_filed: number;
}

export default function OfficerProductivity({
  myProductivity,
}: {
  myProductivity?: ProductivityData;
}) {
  const [timeRange, setTimeRange] = useState<'daily' | 'weekly' | 'monthly'>('weekly');

  const data = myProductivity || {
    tasksCompleted: 4,
    tasksTotal: 6,
    trend_data: [
      { name: 'Mon', tasks: 1, visits: 2 },
      { name: 'Tue', tasks: 2, visits: 1 },
      { name: 'Wed', tasks: 1, visits: 3 },
      { name: 'Thu', tasks: 0, visits: 1 },
      { name: 'Fri', tasks: 0, visits: 0 },
    ],
    previous_tasks_completed: 3,
    visitsCompleted: 7,
    previous_visits_completed: 8,
    timeSpent: 32,
    previous_time_spent: 30,
    reportsFiled: 5,
    previous_reports_filed: 5,
  };

  const getDifferenceText = (current: number, previous: number, label: string) => {
    const diff = current - previous;
    if (diff === 0) return `Same as last ${timeRange === 'daily' ? 'day' : timeRange.replace('ly', ' week')}`;
    const diffAbs = Math.abs(diff);
    return `${diffAbs} ${diff > 0 ? 'more' : 'fewer'} than last ${timeRange === 'daily' ? 'day' : timeRange.replace('ly', ' week')}`;
  };

  const stats: Stat[] = [
    {
      label: 'Tasks Completed',
      value: data.tasksCompleted,
      previousValue: data.previous_tasks_completed,
      icon: CheckCircle,
    },
    {
      label: 'Visits Logged',
      value: data.visitsCompleted,
      previousValue: data.previous_visits_completed,
      icon: Calendar,
    },
    {
      label: 'Hours Logged',
      value: data.timeSpent,
      previousValue: data.previous_time_spent,
      icon: Clock,
      unit: 'hrs',
    },
    {
      label: 'Reports Filed',
      value: data.reportsFiled,
      previousValue: data.previous_reports_filed,
      icon: FileText,
    },
  ];

  // Helper for flexbox graph
  const maxTasks = Math.max(...data.trend_data.map(d => d.tasks), 1);
  const maxVisits = Math.max(...data.trend_data.map(d => d.visits), 1);
  const overallMax = Math.max(maxTasks, maxVisits);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Your Productivity</h2>
          <p className="text-gray-600 mt-1">
            You&apos;ve completed {data.tasksCompleted} of {data.tasksTotal} tasks this {timeRange.replace('ly', ' week')}. Keep it up!
          </p>
        </div>
        
        <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
          {(['daily', 'weekly', 'monthly'] as const).map((range) => (
            <button
              key={range}
              role="tab"
              aria-selected={timeRange === range}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                timeRange === range
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
              onClick={() => setTimeRange(range)}
            >
              {range.charAt(0).toUpperCase() + range.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <stat.icon className="w-6 h-6" />
              </div>
              {Number(stat.value) > stat.previousValue ? (
                <span className="flex items-center text-sm font-medium text-green-600">
                  <ArrowUp className="w-4 h-4 mr-1" />
                  +{Number(stat.value) - stat.previousValue}
                </span>
              ) : Number(stat.value) < stat.previousValue ? (
                <span className="flex items-center text-sm font-medium text-red-600">
                  <ArrowDown className="w-4 h-4 mr-1" />
                  {stat.previousValue - Number(stat.value)}
                </span>
              ) : (
                <span className="flex items-center text-sm font-medium text-gray-500">
                  -
                </span>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">{stat.label}</p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-2xl font-bold text-gray-900">{stat.value}</h3>
                {stat.unit && <span className="text-sm text-gray-500 font-medium">{stat.unit}</span>}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {getDifferenceText(Number(stat.value), stat.previousValue, stat.label)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Activity Trend</h3>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-blue-500"></div><span className="text-gray-600">Tasks</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-emerald-500"></div><span className="text-gray-600">Visits</span></div>
          </div>
        </div>
        <div className="h-64 w-full flex items-end justify-between gap-2 border-b border-gray-100 pb-2 relative">
          {/* Y Axis Guide Lines */}
          <div className="absolute inset-0 flex flex-col justify-between border-l border-gray-100 pointer-events-none">
             {[4,3,2,1,0].map(i => (
               <div key={i} className="w-full border-t border-dashed border-gray-100 flex items-center">
                 <span className="text-xs text-gray-400 -ml-6">{Math.round((overallMax / 4) * i)}</span>
               </div>
             ))}
          </div>

          {data.trend_data.map((day, idx) => (
            <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full z-10">
              <div className="flex items-end gap-1 w-full justify-center h-full pt-6">
                <div 
                  className="w-1/3 max-w-[24px] bg-blue-500 rounded-t-sm transition-all duration-500 relative group"
                  style={{ height: `${(day.tasks / overallMax) * 100}%`, minHeight: day.tasks > 0 ? '4px' : '0' }}
                >
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                    {day.tasks} Tasks
                  </div>
                </div>
                <div 
                  className="w-1/3 max-w-[24px] bg-emerald-500 rounded-t-sm transition-all duration-500 relative group"
                  style={{ height: `${(day.visits / overallMax) * 100}%`, minHeight: day.visits > 0 ? '4px' : '0' }}
                >
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                    {day.visits} Visits
                  </div>
                </div>
              </div>
              <span className="text-xs text-gray-500 mt-2">{day.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors shadow-sm">
          View My Tasks
        </button>
        <button className="flex-1 bg-white hover:bg-gray-50 text-gray-900 font-medium py-2.5 px-4 rounded-lg border border-gray-200 transition-colors shadow-sm">
          Log a Visit
        </button>
      </div>
    </div>
  );
}
