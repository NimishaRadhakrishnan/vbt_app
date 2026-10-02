import React, { useState, useMemo } from 'react';
import { AlertTriangle, Search, ChevronDown, ChevronUp, Users, CheckCircle, Clock, X, ChevronRight, Download, Filter } from 'lucide-react';
import { TeamMember } from './ManagerProductivity'; // Reusing type from Manager for mock data

interface AdminTeamMember extends TeamMember {
  manager: string;
  team: string;
}

interface AdminProductivityProps {
  organizationData?: AdminTeamMember[];
  alerts?: string[];
}

export default function AdminProductivity({
  organizationData,
  alerts,
}: AdminProductivityProps) {
  const [timeRange, setTimeRange] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof AdminTeamMember; direction: 'asc' | 'desc' } | null>(null);
  const [selectedOfficer, setSelectedOfficer] = useState<AdminTeamMember | null>(null);

  const [selectedManager, setSelectedManager] = useState<string>('All');
  const [selectedRole, setSelectedRole] = useState<string>('All');

  const mockOrgData: AdminTeamMember[] = [
    { id: '1', name: 'Karthik Raja', role: 'Field Officer', tasksCompleted: 12, tasksTotal: 15, visitsLogged: 8, hoursLogged: 36, status: 'On Track', manager: 'Ravi Chandran', team: 'Salem Zone' },
    { id: '2', name: 'Suresh Kumar', role: 'Field Officer', tasksCompleted: 5, tasksTotal: 12, visitsLogged: 4, hoursLogged: 28, status: 'Behind', manager: 'Ravi Chandran', team: 'Salem Zone' },
    { id: '3', name: 'Dinesh Prabhu', role: 'Senior Officer', tasksCompleted: 0, tasksTotal: 0, visitsLogged: 2, hoursLogged: 40, status: 'On Track', manager: 'Ravi Chandran', team: 'Salem Zone' },
    { id: '4', name: 'Palani G', role: 'Field Officer', tasksCompleted: 14, tasksTotal: 14, visitsLogged: 10, hoursLogged: 42, status: 'On Track', manager: 'Murugesan V', team: 'Erode Zone' },
    { id: '5', name: 'Vigneshwaran M', role: 'Field Officer', tasksCompleted: 7, tasksTotal: 10, visitsLogged: 5, hoursLogged: 31, status: 'At Risk', manager: 'Murugesan V', team: 'Erode Zone' },
    { id: '6', name: 'Sakthivel R', role: 'Junior Officer', tasksCompleted: 3, tasksTotal: 5, visitsLogged: 2, hoursLogged: 15, status: 'On Track', manager: 'Murugesan V', team: 'Erode Zone' },
  ];

  const data = organizationData || mockOrgData;
  const activeAlerts = alerts || [
    "Salem Zone is tracking 15% below quarterly goals.",
    "Suresh Kumar has missed 3 visits this week.",
  ];

  const managers = ['All', ...Array.from(new Set(data.map(d => d.manager)))];
  const roles = ['All', ...Array.from(new Set(data.map(d => d.role)))];

  const handleSort = (key: keyof AdminTeamMember) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedData = useMemo(() => {
    let result = [...data];
    
    if (selectedManager !== 'All') {
      result = result.filter(item => item.manager === selectedManager);
    }
    if (selectedRole !== 'All') {
      result = result.filter(item => item.role === selectedRole);
    }
    
    if (searchQuery) {
      result = result.filter(item => 
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.team.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (sortConfig !== null) {
      result.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
        if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [data, sortConfig, searchQuery, selectedManager, selectedRole]);

  const orgSummary = useMemo(() => {
    const totalTasks = filteredAndSortedData.reduce((acc, curr) => acc + curr.tasksTotal, 0);
    const completedTasks = filteredAndSortedData.reduce((acc, curr) => acc + curr.tasksCompleted, 0);
    const totalVisits = filteredAndSortedData.reduce((acc, curr) => acc + curr.visitsLogged, 0);
    return {
      totalTasks,
      completedTasks,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      totalVisits,
      orgSize: filteredAndSortedData.length,
    };
  }, [filteredAndSortedData]);

  // Group data by team for visual grouping
  const groupedData = useMemo(() => {
    const groups: { [key: string]: AdminTeamMember[] } = {};
    filteredAndSortedData.forEach(member => {
      const teamKey = member.team || 'Unassigned';
      if (!groups[teamKey]) groups[teamKey] = [];
      groups[teamKey]?.push(member);
    });
    return groups;
  }, [filteredAndSortedData]);

  const renderSortIcon = (columnName: keyof AdminTeamMember) => {
    if (sortConfig?.key !== columnName) return <ChevronDown className="w-4 h-4 text-gray-300 ml-1 inline" />;
    return sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4 text-blue-600 ml-1 inline" /> : <ChevronDown className="w-4 h-4 text-blue-600 ml-1 inline" />;
  };

  const handleExportCSV = () => {
    const headers = ['Name', 'Role', 'Manager', 'Team', 'Status', 'Tasks Completed', 'Tasks Total', 'Visits Logged', 'Hours Logged'];
    const csvContent = [
      headers.join(','),
      ...filteredAndSortedData.map(row => 
        `"${row.name}","${row.role}","${row.manager}","${row.team}","${row.status}",${row.tasksCompleted},${row.tasksTotal},${row.visitsLogged},${row.hoursLogged}`
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'productivity_export.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header & Toggles */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Organization Productivity</h2>
          <p className="text-gray-600 mt-1">Global overview of workforce performance</p>
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
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-amber-800">Global Alerts</h3>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {activeAlerts.map((alert, idx) => (
                <div key={idx} className="text-sm text-amber-700 flex items-center gap-2 bg-amber-100/50 p-2 rounded-md">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
                  {alert}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Org Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><Users className="w-6 h-6" /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Total Officers</p>
            <p className="text-2xl font-bold text-gray-900">{orgSummary.orgSize}</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg"><CheckCircle className="w-6 h-6" /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Global Tasks Completed</p>
            <p className="text-2xl font-bold text-gray-900">{orgSummary.completedTasks} <span className="text-sm text-gray-400 font-normal">/ {orgSummary.totalTasks}</span></p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-green-50 text-green-600 rounded-lg"><CheckCircle className="w-6 h-6" /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Avg Completion Rate</p>
            <p className="text-2xl font-bold text-gray-900">{orgSummary.completionRate}%</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-lg"><Clock className="w-6 h-6" /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Total Visits</p>
            <p className="text-2xl font-bold text-gray-900">{orgSummary.totalVisits}</p>
          </div>
        </div>
      </div>

      {/* Filters and Actions */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search directory..."
              className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-64 bg-slate-50 text-slate-900"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <select 
              className="py-2 pl-3 pr-8 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white text-slate-900"
              value={selectedManager}
              onChange={(e) => setSelectedManager(e.target.value)}
            >
              {managers.map(m => <option key={m} value={m}>{m === 'All' ? 'All Managers' : m}</option>)}
            </select>
            
            <select 
              className="py-2 pl-3 pr-8 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white text-slate-900"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
            >
              {roles.map(r => <option key={r} value={r}>{r === 'All' ? 'All Roles' : r}</option>)}
            </select>
          </div>
        </div>

        <button 
          onClick={handleExportCSV}
          className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors text-sm w-full sm:w-auto justify-center"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Data Table with Grouping */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-medium">
              <tr>
                <th className="px-6 py-4 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('name')}>Officer {renderSortIcon('name')}</th>
                <th className="px-6 py-4 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('role')}>Role {renderSortIcon('role')}</th>
                <th className="px-6 py-4 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('status')}>Status {renderSortIcon('status')}</th>
                <th className="px-6 py-4 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('tasksCompleted')}>Progress {renderSortIcon('tasksCompleted')}</th>
                <th className="px-6 py-4 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('visitsLogged')}>Visits {renderSortIcon('visitsLogged')}</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {Object.keys(groupedData).length > 0 ? (
                Object.entries(groupedData).map(([teamName, members]) => (
                  <React.Fragment key={teamName}>
                    {/* Team Header Row */}
                    <tr className="bg-gray-50/50">
                      <td colSpan={6} className="px-6 py-3 font-semibold text-gray-900 text-xs uppercase tracking-wider">
                        {teamName} <span className="text-gray-500 font-normal ml-2">({members[0]?.manager})</span>
                      </td>
                    </tr>
                    {/* Team Members */}
                    {members.map(member => {
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
                          </td>
                          <td className="px-6 py-4 text-gray-600">{member.role}</td>
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
                          <td className="px-6 py-4 text-right">
                            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors inline-block" />
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    No officers found matching your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mock Officer Detail Drawer (Reused from ManagerView visually) */}
      {selectedOfficer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-white/60 backdrop-blur-sm" onClick={() => setSelectedOfficer(null)} />
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <div>
                <h3 className="text-xl font-bold text-gray-900">{selectedOfficer.name}</h3>
                <p className="text-sm text-gray-500">{selectedOfficer.role} • {selectedOfficer.team}</p>
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
                    <p className="text-sm text-gray-500 mb-1">Tasks</p>
                    <p className="text-2xl font-bold text-gray-900">{selectedOfficer.tasksCompleted}/{selectedOfficer.tasksTotal}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <p className="text-sm text-gray-500 mb-1">Visits</p>
                    <p className="text-2xl font-bold text-gray-900">{selectedOfficer.visitsLogged}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 col-span-2">
                    <p className="text-sm text-gray-500 mb-1">Manager</p>
                    <p className="text-lg font-medium text-gray-900">{selectedOfficer.manager}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
