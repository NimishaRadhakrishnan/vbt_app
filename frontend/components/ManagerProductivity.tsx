import React, { useState, useMemo } from 'react';
import { AlertTriangle, Search, ChevronDown, ChevronUp, Users, CheckCircle, Clock, X, ChevronRight } from 'lucide-react';

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  tasksCompleted: number;
  tasksTotal: number;
  visitsLogged: number;
  hoursLogged: number;
  status: 'On Track' | 'At Risk' | 'Behind';
}

interface ManagerProductivityProps {
  teamData?: TeamMember[];
  alerts?: string[];
}

export default function ManagerProductivity({
  teamData,
  alerts,
}: ManagerProductivityProps) {
  const [timeRange, setTimeRange] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof TeamMember; direction: 'asc' | 'desc' } | null>(null);
  const [selectedOfficer, setSelectedOfficer] = useState<TeamMember | null>(null);

  const mockTeamData: TeamMember[] = [
    { id: '1', name: 'Karthik Raja', role: 'Field Officer', tasksCompleted: 12, tasksTotal: 15, visitsLogged: 8, hoursLogged: 36, status: 'On Track' },
    { id: '2', name: 'Suresh Kumar', role: 'Field Officer', tasksCompleted: 5, tasksTotal: 12, visitsLogged: 4, hoursLogged: 28, status: 'Behind' },
    { id: '3', name: 'Dinesh Prabhu', role: 'Senior Officer', tasksCompleted: 0, tasksTotal: 0, visitsLogged: 2, hoursLogged: 40, status: 'On Track' },
    { id: '4', name: 'Palani G', role: 'Field Officer', tasksCompleted: 14, tasksTotal: 14, visitsLogged: 10, hoursLogged: 42, status: 'On Track' },
    { id: '5', name: 'Vigneshwaran M', role: 'Field Officer', tasksCompleted: 7, tasksTotal: 10, visitsLogged: 5, hoursLogged: 31, status: 'At Risk' },
  ];

  const data = teamData || mockTeamData;
  const activeAlerts = alerts || [
    "Suresh Kumar has missed 3 visits this week.",
    "Vigneshwaran M is trending 20% below his weekly task goal.",
  ];

  const handleSort = (key: keyof TeamMember) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedData = useMemo(() => {
    let sortableItems = [...data];
    if (searchQuery) {
      sortableItems = sortableItems.filter(item => 
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.role.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
        if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [data, sortConfig, searchQuery]);

  const teamSummary = useMemo(() => {
    const totalTasks = data.reduce((acc, curr) => acc + curr.tasksTotal, 0);
    const completedTasks = data.reduce((acc, curr) => acc + curr.tasksCompleted, 0);
    const totalVisits = data.reduce((acc, curr) => acc + curr.visitsLogged, 0);
    return {
      totalTasks,
      completedTasks,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      totalVisits,
      teamSize: data.length,
    };
  }, [data]);

  const renderSortIcon = (columnName: keyof TeamMember) => {
    if (sortConfig?.key !== columnName) return <ChevronDown className="w-4 h-4 text-gray-300 ml-1 inline" />;
    return sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4 text-blue-600 ml-1 inline" /> : <ChevronDown className="w-4 h-4 text-blue-600 ml-1 inline" />;
  };

  return (
    <div className="space-y-6">
      {/* Header & Toggles */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Team Productivity</h2>
          <p className="text-gray-600 mt-1">Overview of your team&apos;s performance</p>
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

      {/* Alerts Panel */}
      {activeAlerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-amber-800">Action Required</h3>
              <ul className="mt-2 space-y-1">
                {activeAlerts.map((alert, idx) => (
                  <li key={idx} className="text-sm text-amber-700 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                    {alert}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Team Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><Users className="w-6 h-6" /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Team Size</p>
            <p className="text-2xl font-bold text-gray-900">{teamSummary.teamSize}</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg"><CheckCircle className="w-6 h-6" /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Tasks Completed</p>
            <p className="text-2xl font-bold text-gray-900">{teamSummary.completedTasks} <span className="text-sm text-gray-400 font-normal">/ {teamSummary.totalTasks}</span></p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-green-50 text-green-600 rounded-lg"><CheckCircle className="w-6 h-6" /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Completion Rate</p>
            <p className="text-2xl font-bold text-gray-900">{teamSummary.completionRate}%</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-lg"><Clock className="w-6 h-6" /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Total Visits</p>
            <p className="text-2xl font-bold text-gray-900">{teamSummary.totalVisits}</p>
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
          <h3 className="font-semibold text-gray-900">Officer Performance</h3>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search officers..."
              className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-64 transition-shadow bg-slate-50 text-slate-900"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-medium">
              <tr>
                <th className="px-6 py-4 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('name')}>
                  Officer {renderSortIcon('name')}
                </th>
                <th className="px-6 py-4 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('status')}>
                  Status {renderSortIcon('status')}
                </th>
                <th className="px-6 py-4 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('tasksCompleted')}>
                  Completion Rate {renderSortIcon('tasksCompleted')}
                </th>
                <th className="px-6 py-4 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('visitsLogged')}>
                  Visits Logged {renderSortIcon('visitsLogged')}
                </th>
                <th className="px-6 py-4 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('hoursLogged')}>
                  Hours {renderSortIcon('hoursLogged')}
                </th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedData.map((member) => {
                const completionPercentage = member.tasksTotal > 0 
                  ? Math.round((member.tasksCompleted / member.tasksTotal) * 100) 
                  : 0;

                return (
                  <tr 
                    key={member.id} 
                    className="hover:bg-gray-50 transition-colors cursor-pointer group"
                    onClick={() => setSelectedOfficer(member)}
                  >
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{member.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{member.role}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        member.status === 'On Track' ? 'bg-green-100 text-green-700' :
                        member.status === 'At Risk' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {member.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {member.tasksTotal === 0 ? (
                        <span className="text-gray-500 italic">No tasks assigned yet</span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${
                                completionPercentage >= 80 ? 'bg-green-500' : 
                                completionPercentage >= 50 ? 'bg-blue-500' : 'bg-red-500'
                              }`} 
                              style={{ width: `${completionPercentage}%` }}
                            />
                          </div>
                          <span className="font-medium text-gray-700">{completionPercentage}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{member.visitsLogged}</td>
                    <td className="px-6 py-4 text-gray-600">{member.hoursLogged}h</td>
                    <td className="px-6 py-4 text-right">
                      <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors inline-block" />
                    </td>
                  </tr>
                );
              })}
              {sortedData.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    No officers found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mock Officer Detail Drawer */}
      {selectedOfficer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-white/60 backdrop-blur-sm" onClick={() => setSelectedOfficer(null)} />
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <div>
                <h3 className="text-xl font-bold text-gray-900">{selectedOfficer.name}</h3>
                <p className="text-sm text-gray-500">{selectedOfficer.role}</p>
              </div>
              <button 
                onClick={() => setSelectedOfficer(null)}
                className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Performance Status</h4>
                  <div className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${
                        selectedOfficer.status === 'On Track' ? 'bg-green-100 text-green-700' :
                        selectedOfficer.status === 'At Risk' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                    {selectedOfficer.status}
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <p className="text-sm text-gray-500 mb-1">Tasks Completed</p>
                    <p className="text-2xl font-bold text-gray-900">{selectedOfficer.tasksCompleted}/{selectedOfficer.tasksTotal}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <p className="text-sm text-gray-500 mb-1">Visits</p>
                    <p className="text-2xl font-bold text-gray-900">{selectedOfficer.visitsLogged}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 col-span-2">
                    <p className="text-sm text-gray-500 mb-1">Hours Logged</p>
                    <p className="text-2xl font-bold text-gray-900">{selectedOfficer.hoursLogged}h</p>
                  </div>
                </div>
                
                <div className="pt-6 border-t border-gray-100">
                  <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors">
                    View Full Profile
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
