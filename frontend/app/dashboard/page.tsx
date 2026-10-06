"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { todayIST, weekStartIST } from "@/lib/dates";
import { useRouter } from "next/navigation";
import { 
  Users, MapPin, ClipboardList, ShoppingCart, 
  FileText, Activity, AlertTriangle, CheckCircle, 
  XCircle, Filter, Download, Plus, Search, 
  TrendingUp, Award, Calendar, RefreshCw, MessageSquare,
  Bell, LogOut, ChevronDown, User, Check,
  CalendarOff, BookOpen, HelpCircle, Upload, ImageIcon, X, Camera, Settings, Smartphone, Menu
} from "lucide-react";
import { apiFetch, API_BASE_URL, ApiError } from "@/lib/api/client";
import { tokenStorage } from "@/lib/api/token-storage";
import { useAuth } from "@/lib/auth-context";
import { computeLiveOfficers, countActive as countActiveOfficers, LiveOfficer } from "@/lib/officerStatus";
import dynamic from "next/dynamic";
import SectionTabs from "@/components/SectionTabs";
import { findActive, hrefFor, navForRole, searchNav } from "@/lib/navigation";
import type { NavTab } from "@/lib/navigation";

const MapComponent = dynamic(() => import("./MapComponent"), {
  ssr: false,
  loading: () => (
    <div className="h-[480px] w-full bg-slate-100 flex items-center justify-center text-slate-400 font-semibold rounded-xl border border-slate-200">
      Loading Interactive Map Layer...
    </div>
  )
});

const RouteReplay = dynamic(() => import("@/components/RouteReplay"), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] w-full bg-slate-100 flex items-center justify-center text-slate-400 font-semibold rounded-xl border border-slate-200">
      Loading Route Replay Engine...
    </div>
  )
});

import MomentumWidget from "@/components/MomentumWidget";
import DayClosureForm from "@/components/DayClosureForm";
import SalesDayClosureForm from "@/components/SalesDayClosureForm";
import DayClosureFormBuilder from "@/components/DayClosureFormBuilder";
import { downloadAuthenticatedFile, datedFilename } from "@/lib/api/download";
import { OtherDescriptionInput, descriptionMissing, OTHER_DESCRIPTION_MESSAGE } from "@/components/OtherDescriptionInput";
import PhoneSimulator from "@/components/PhoneSimulator";
import { VisitDetailPanel } from "@/components/VisitDetailPanel";
import OfficerProductivity from "@/components/OfficerProductivity";
import ManagerProductivity from "@/components/ManagerProductivity";
import AdminProductivity from "@/components/AdminProductivity";

import TeamMomentumCard from "@/components/TeamMomentumCard";
import ManagementDashboard from "@/components/management/ManagementDashboard";

// NOTE: Orders currently has no backend endpoint at all (no fetch call
// exists for it anywhere in this file) — it's local-only, in-memory state
// that resets on refresh. That's a separate, real gap from the mock-data
// fallback issue fixed elsewhere in this file; flagged here rather than
// silently left in a "no bugs" build. Wiring up a real /orders API is a
// follow-up task, not a one-line fix.
const SECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  home: TrendingUp,
  work: ClipboardList,
  field: Award,
  team: Users,
  stock: ShoppingCart,
  library: BookOpen,
  setup: Settings,
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  field_officer: "Field Officer",
  sales_officer: "Sales Officer",
  manager: "Regional Manager",
};

// Uploaded files (task proof photos, enquiry attachments) are served from
// GET /files/{filename}, which requires ?token=... - browsers can't attach
// an Authorization header to <img src> or <a href>, which is how these
// URLs actually get rendered. Previously served from an unauthenticated
// /static mount, so no token was needed at all; now every render site for
// a server-uploaded file needs to append one. See backend/file_router.py
// for the full reasoning, including why this is a token-in-URL stopgap
// pending an S3 migration, not the intended end state.
function withFileToken(url: string): string {
  const token = tokenStorage.getAccessToken();
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

export default function Dashboard() {
  const { user, isLoading, logout } = useAuth();

  const [dropdownOpenId, setDropdownOpenId] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<any>(null);
  const [deleteImpact, setDeleteImpact] = useState<any>(null);
  const [isArchivedTab, setIsArchivedTab] = useState(false);

  const userRoleRef = useRef(user?.role);
  useEffect(() => {
    userRoleRef.current = user?.role;
  }, [user?.role]);
  const router = useRouter();

  // Authentication Guard redirect
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  const [activeTab, setActiveTab] = useState("map");
  const [hasSetLandingTab, setHasSetLandingTab] = useState(false);
  const [navQuery, setNavQuery] = useState("");
  const [activeLocations, setActiveLocations] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [dealers, setDealers] = useState<any[]>([]);
  const [collectionsRequired, setCollectionsRequired] = useState<any[]>([]);
  const [farmers, setFarmers] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [hrPolicies, setHrPolicies] = useState<any[]>([]);
  const [enquiries, setEnquiries] = useState<any[]>([]);
  const [leaveForm, setLeaveForm] = useState({ leave_type: "planned", start_date: "", end_date: "", reason: "" });
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveMessage, setLeaveMessage] = useState({ type: "", text: "" });
  const [enquiryForm, setEnquiryForm] = useState({ district: "", description: "" });
  const [enquiryImageFile, setEnquiryImageFile] = useState<File | null>(null);
  const [enquirySubmitting, setEnquirySubmitting] = useState(false);
  const [enquiryMessage, setEnquiryMessage] = useState({ type: "", text: "" });
  const [enquiryResolveDrafts, setEnquiryResolveDrafts] = useState<Record<string, string>>({});
  const [dayClosureStatus, setDayClosureStatus] = useState<{ closed_today: boolean } | null>(null);
  const [showLogoutGateModal, setShowLogoutGateModal] = useState(false);
  // Daily Work Report state
  const [showDailyReportModal, setShowDailyReportModal] = useState(false);
  const [dailyReportSummary, setDailyReportSummary] = useState("");
  const [dailyReportSubmitting, setDailyReportSubmitting] = useState(false);
  const [dailyReportError, setDailyReportError] = useState("");
  const [dailyReportFile, setDailyReportFile] = useState<File | null>(null);

  // Admin view Daily Reports state
  const [dailyReportsData, setDailyReportsData] = useState<any[]>([]);
  const [loadingDailyReports, setLoadingDailyReports] = useState(false);
  const [dailyReportDateRange, setDailyReportDateRange] = useState({
    from_date: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split("T")[0],
    to_date: new Date().toISOString().split("T")[0]
  });
  const [dailyReportUserFilter, setDailyReportUserFilter] = useState("");

  const [closureMessage, setClosureMessage] = useState({ type: "", text: "" });
  const [showNoActivityForm, setShowNoActivityForm] = useState(false);
  const [noActivityReason, setNoActivityReason] = useState("");
  const [noActivitySaving, setNoActivitySaving] = useState(false);

  // Admin view Day Closures state
  const [adminDayClosures, setAdminDayClosures] = useState<any[]>([]);
  // Admin CRUD on Day Closure Reports
  const [dayClosureDetailVisitId, setDayClosureDetailVisitId] = useState<string | null>(null);
  const [editingClosure, setEditingClosure] = useState<any | null>(null);
  const [editClosureForm, setEditClosureForm] = useState<Record<string, any>>({});
  const [editClosureError, setEditClosureError] = useState("");
  const [editClosureSaving, setEditClosureSaving] = useState(false);
  const [showCreateClosure, setShowCreateClosure] = useState(false);
  const [showFormBuilder, setShowFormBuilder] = useState(false);
  // Sales Officer closures (admin view)
  const [salesClosures, setSalesClosures] = useState<any[]>([]);
  const [salesClosureDateFrom, setSalesClosureDateFrom] = useState("");
  const [salesClosureDateTo, setSalesClosureDateTo] = useState("");
  const [salesClosureMonth, setSalesClosureMonth] = useState("");
  const [salesClosureOfficerId, setSalesClosureOfficerId] = useState("");
  const [salesClosureDistrict, setSalesClosureDistrict] = useState("");
  const [salesClosureDetail, setSalesClosureDetail] = useState<any | null>(null);
  const [editingSalesClosure, setEditingSalesClosure] = useState<any | null>(null);
  const [salesEditForm, setSalesEditForm] = useState<Record<string, any>>({});
  const [salesEditSaving, setSalesEditSaving] = useState(false);
  const [showPhonePreview, setShowPhonePreview] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [createClosureOfficerId, setCreateClosureOfficerId] = useState("");
  const [createClosureError, setCreateClosureError] = useState("");
  const [missingDayClosures, setMissingDayClosures] = useState<any[]>([]);
  const [loadingDayClosures, setLoadingDayClosures] = useState(false);
  const [myTodayAttendance, setMyTodayAttendance] = useState<any>(null);
  const [rosterStatus, setRosterStatus] = useState<any[]>([]);
  const [filterDistrict, setFilterDistrict] = useState("All");
  const [dataLoadError, setDataLoadError] = useState("");
  const [isLoadingActiveLocations, setIsLoadingActiveLocations] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [isRefreshingMap, setIsRefreshingMap] = useState(false);
  const [officerTablePage, setOfficerTablePage] = useState(1);
  const OFFICER_PAGE_SIZE = 50;
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [routeHistoryOfficerId, setRouteHistoryOfficerId] = useState("");
  const [routeHistoryDate, setRouteHistoryDate] = useState(() => new Date().toISOString().split("T")[0]);

  // BUG FIX: the location-consent disclosure that gates check-in
  // (backend: require_location_consent on POST /attendance/check-in)
  // was only ever built for the native mobile app's LocationDisclosure
  // screen. A field/sales officer using the web dashboard had no way to
  // ever see or accept it, so "Check In Now" silently 403'd forever -
  // the button's onClick handler swallows errors with console.error
  // only, so nothing visible told them why. This state/modal gives the
  // web app the same consent flow the mobile app already has.
  const [locationConsent, setLocationConsent] = useState<any>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [isAcceptingConsent, setIsAcceptingConsent] = useState(false);
  const [consentError, setConsentError] = useState("");

  // Ticks once a second so the "Synced Xs ago" label near the Refresh
  // button stays accurate without needing its own network call.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
  

  return () => clearInterval(id);
  }, []);

  function formatSyncedAgo(syncedAt: number, now: number): string {
    const diffSec = Math.max(0, Math.round((now - syncedAt) / 1000));
    if (diffSec < 5) return "just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.round(diffSec / 60);
    return `${diffMin} min ago`;
  }

  // Task Assignment State
  const [tasks, setTasks] = useState<any[]>([]);
  const [taskStatusFilter, setTaskStatusFilter] = useState("All");
  const [taskSearchQuery, setTaskSearchQuery] = useState("");
  const [submittingTaskId, setSubmittingTaskId] = useState<string | null>(null);
  const [taskProofFile, setTaskProofFile] = useState<File | null>(null);
  const [taskProofUploading, setTaskProofUploading] = useState(false);
  const [taskProofError, setTaskProofError] = useState("");

  const taskSummaries = useMemo(() => {
    return {
      assigned: tasks.filter((t: any) => t.status === "assigned").length,
      inProgress: tasks.filter((t: any) => t.status === "in_progress").length,
      pendingReview: tasks.filter((t: any) => t.status === "pending_review").length,
      done: tasks.filter((t: any) => t.status === "done").length,
      overdue: tasks.filter((t: any) => t.is_overdue && t.status !== "done" && t.status !== "cancelled").length,
    };
  }, [tasks]);

  const groupedTasks = useMemo(() => {
    let filtered = tasks;
    if (taskStatusFilter !== "All") {
      filtered = filtered.filter((t: any) => t.status === taskStatusFilter);
    }
    if (taskSearchQuery.trim()) {
      const q = taskSearchQuery.toLowerCase();
      filtered = filtered.filter((t: any) => (t.title || "").toLowerCase().includes(q));
    }

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const overdue: any[] = [];
    const dueToday: any[] = [];
    const upcoming: any[] = [];

    filtered.forEach((t: any) => {
      const isActuallyOverdue = t.is_overdue && t.status !== "done" && t.status !== "cancelled";
      if (isActuallyOverdue) {
        overdue.push(t);
      } else if (t.due_date === todayStr) {
        dueToday.push(t);
      } else if (t.due_date && t.due_date < todayStr && t.status !== "done" && t.status !== "cancelled" && t.status !== "pending_review") {
        overdue.push(t);
      } else {
        upcoming.push(t);
      }
    });

    const sortFn = (a: any, b: any) => (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31");
    overdue.sort(sortFn);
    dueToday.sort(sortFn);
    upcoming.sort(sortFn);

    return { overdue, dueToday, upcoming, totalFiltered: filtered.length, total: tasks.length };
  }, [tasks, taskStatusFilter, taskSearchQuery]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskAssignedTo, setNewTaskAssignedTo] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [taskFormError, setTaskFormError] = useState("");
  const [taskFormSuccess, setTaskFormSuccess] = useState("");

  // Productivity State
  const [productivityPeriod, setProductivityPeriod] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [productivityData, setProductivityData] = useState<any[]>([]);
  const [myProductivity, setMyProductivity] = useState<any>(null);

  // Attendance Monitoring State
  const [attendanceDate, setAttendanceDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [isCheckingIn, setIsCheckingIn] = useState(false);

  // Notifications State
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // New Plan Submission Form State
  const [planWeek, setPlanWeek] = useState("");
  const [planDate, setPlanDate] = useState("");
  const [planType, setPlanType] = useState("farmer_visit");
  const [planDescription, setPlanDescription] = useState("");
  const [planVillages, setPlanVillages] = useState("");
  const [planDealers, setPlanDealers] = useState("");
  const [planSuccess, setPlanSuccess] = useState("");
  const [planError, setPlanError] = useState("");
  const [showPlanForm, setShowPlanForm] = useState(false);

  // Plan Disapproval Flow State
  const [disapprovingPlanId, setDisapprovingPlanId] = useState<string | null>(null);
  const [disapprovalNotes, setDisapprovalNotes] = useState("");

  // Crop Issue Form State
  const [reportFarmerId, setReportFarmerId] = useState("");
  const [reportCrop, setReportCrop] = useState("");
  const [reportDistrict, setReportDistrict] = useState("");
  const [reportSymptoms, setReportSymptoms] = useState("");
  const [reportImageUrl, setReportImageUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [issueSuccess, setIssueSuccess] = useState("");
  const [issueError, setIssueError] = useState("");
  const [showIssueForm, setShowIssueForm] = useState(false);

  // Crop Resolution State
  const [resolvingIssueId, setResolvingIssueId] = useState<string | null>(null);
  const [expertReplyText, setExpertReplyText] = useState("");

  const getMapCoords = (lat: number, lng: number) => {
    // Lat bounds: 10.8 (bottom/100%) to 12.2 (top/0%)
    // Lng bounds: 76.8 (left/0%) to 78.3 (right/100%)
    const top = ((12.2 - lat) / (12.2 - 10.8)) * 100;
    const left = ((lng - 76.8) / (78.3 - 76.8)) * 100;
    return { 
      top: `${Math.max(10, Math.min(90, top))}%`, 
      left: `${Math.max(10, Math.min(90, left))}%` 
    };
  };

  // User Management State
  const [usersList, setUsersList] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [resettingUser, setResettingUser] = useState<any | null>(null);
  const [assigningUser, setAssigningUser] = useState<any | null>(null);

  // Momentum State
  const [momentumData, setMomentumData] = useState<any | null>(null);
  const [teamMomentumOverview, setTeamMomentumOverview] = useState<any | null>(null);

  // Form Fields
  const [formPhone, setFormPhone] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formFullName, setFormFullName] = useState("");
  const [formRole, setFormRole] = useState("field_officer");
  const [formEmployeeId, setFormEmployeeId] = useState("");
  const [formManagerId, setFormManagerId] = useState("");
  const [formDeviceId, setFormDeviceId] = useState("");
  const [formTerritoryIds, setFormTerritoryIds] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const fetchUsers = async (archived = isArchivedTab) => {
    setLoadingUsers(true);
    try {
      const res: any = await apiFetch(`/users?archived=${archived}`);
      setUsersList(res.items || []);
    } catch (err) {
      console.error("Failed to fetch users:", err);
      setUsersList([]);
      setDataLoadError("Couldn't load users from the server. Showing no data instead of stale placeholders — try refreshing.");
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchNotifications = async () => {
    try {
      const res: any = await apiFetch("/notifications");
      setNotifications(res || []);
      setUnreadCount((res || []).filter((n: any) => !n.is_read).length);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  };

  const handleMarkAsRead = async (id: string) => {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: "POST" });
      fetchNotifications();
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await apiFetch("/notifications/read-all", { method: "POST" });
      fetchNotifications();
    } catch (err) {
      console.error("Failed to mark all notifications as read:", err);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview immediately
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(file);

    setIsUploading(true);
    setIssueError("");
    setIssueSuccess("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const token = tokenStorage.getAccessToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`${API_BASE_URL}/issues/upload`, {
        method: "POST",
        headers,
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload image.");
      }

      const data = await response.json();
      setReportImageUrl(data.url);
      setIssueSuccess("Image uploaded successfully!");
    } catch (err: any) {
      console.error(err);
      setIssueError(err.message || "Failed to upload image.");
    } finally {
      setIsUploading(false);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const plansData: any = await apiFetch("/plans");
      setPlans(plansData || []);
    } catch (err) {
      console.error("Failed to fetch plans:", err);
      setPlans([]);
      setDataLoadError("Couldn't load weekly plans from the server. Showing no data instead of stale placeholders — try refreshing.");
    }

    try {
      const farmersData: any = await apiFetch("/farmers/search");
      const mappedFarmers = (farmersData || []).map((f: any) => ({
        ...f,
        lat: f.location_lat,
        lng: f.location_lng,
      }));
      setFarmers(mappedFarmers);
    } catch (err) {
      console.error("Failed to fetch farmers:", err);
      setFarmers([]);
      setDataLoadError("Couldn't load farmers from the server. Showing no data instead of stale placeholders — try refreshing.");
    }

    let loadedDealers: any[] = [];
    try {
      const dealersData: any = await apiFetch("/dealers/search");
      loadedDealers = dealersData || [];
      setDealers(loadedDealers);
    } catch (err) {
      console.error("Failed to fetch dealers:", err);
      setDealers([]);
      setDataLoadError("Couldn't load dealers from the server. Showing no data instead of stale placeholders — try refreshing.");
    }

    // Overview screen's Outstanding/Overdue collections figure - real data
    // from the existing collections/required endpoint (server-side scoped
    // to the caller's own dealers for a Sales Officer, all dealers for
    // Admin/Manager), not computed or estimated client-side.
    try {
      const collectionsData: any = await apiFetch("/dealers/orders/collections/required");
      setCollectionsRequired(collectionsData || []);
    } catch (err) {
      console.error("Failed to fetch collections required:", err);
      setCollectionsRequired([]);
    }

    try {
      const issuesData: any = await apiFetch("/issues");
      setIssues(issuesData || []);
    } catch (err) {
      console.error("Failed to fetch issues:", err);
      setIssues([]);
      setDataLoadError("Couldn't load crop disease issues from the server. Showing no data instead of stale placeholders — try refreshing.");
    }

    try {
      const leaveData: any = await apiFetch("/leave");
      setLeaveRequests(leaveData || []);
    } catch (err) {
      console.error("Failed to fetch leave requests:", err);
      setLeaveRequests([]);
    }

    try {
      const policyData: any = await apiFetch("/hr-policies");
      setHrPolicies(policyData || []);
    } catch (err) {
      console.error("Failed to fetch HR policies:", err);
      setHrPolicies([]);
    }

    try {
      const enquiryData: any = await apiFetch("/enquiries");
      setEnquiries(enquiryData || []);
    } catch (err) {
      console.error("Failed to fetch enquiries:", err);
      setEnquiries([]);
    }

    if (user?.role === "field_officer" || user?.role === "sales_officer") {
      try {
        const closureData: any = await apiFetch("/day-closure/status");
        setDayClosureStatus(closureData);
      } catch (err) {
        console.error("Failed to fetch day closure status:", err);
      }
      try {
        const todayData: any = await apiFetch("/attendance/today");
        setMyTodayAttendance(todayData);
      } catch (err) {
        console.error("Failed to fetch today's attendance:", err);
      }
    }

    if (user?.role === "admin" || user?.role === "manager") {
      try {
        const rosterData: any = await apiFetch("/attendance/roster-status");
        setRosterStatus(rosterData || []);
      } catch (err) {
        console.error("Failed to fetch roster status:", err);
      }
      try {
        const teamMomentum: any = await apiFetch("/momentum/team");
        setTeamMomentumOverview(teamMomentum || null);
      } catch (err) {
        console.error("Failed to fetch team momentum:", err);
      }
    }

    if (user?.role === "field_officer" || user?.role === "sales_officer") {
      try {
        const momentum: any = await apiFetch("/momentum/me");
        setMomentumData(momentum || null);
      } catch (err) {
        console.error("Failed to fetch officer momentum:", err);
      }
    }
  };

  const uploadFileGeneric = async (endpoint: string, file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    const token = tokenStorage.getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${API_BASE_URL}${endpoint}`, { method: "POST", headers, body: formData });
    if (!response.ok) throw new Error("Failed to upload file.");
    const data = await response.json();
    return data.url;
  };

  const handleSubmitLeaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLeaveSubmitting(true);
    setLeaveMessage({ type: "", text: "" });
    try {
      await apiFetch("/leave", {
        method: "POST",
        body: JSON.stringify(leaveForm),
      });
      setLeaveMessage({ type: "success", text: "Leave request submitted." });
      setLeaveForm({ leave_type: "planned", start_date: "", end_date: "", reason: "" });
      const leaveData: any = await apiFetch("/leave");
      setLeaveRequests(leaveData || []);
    } catch (err: any) {
      setLeaveMessage({ type: "error", text: err.message || "Failed to submit leave request." });
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const handleLeaveDecision = async (leaveId: string, approve: boolean) => {
    try {
      await apiFetch(`/leave/${leaveId}/decision`, {
        method: "PATCH",
        body: JSON.stringify({ approve }),
      });
      const leaveData: any = await apiFetch("/leave");
      setLeaveRequests(leaveData || []);
    } catch (err: any) {
      alert(err.message || "Failed to record decision.");
    }
  };

  const handleSubmitEnquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnquirySubmitting(true);
    setEnquiryMessage({ type: "", text: "" });
    try {
      let image_url: string | undefined;
      if (enquiryImageFile) {
        image_url = await uploadFileGeneric("/enquiries/upload", enquiryImageFile);
      }
      await apiFetch("/enquiries", {
        method: "POST",
        body: JSON.stringify({ ...enquiryForm, image_url }),
      });
      setEnquiryMessage({ type: "success", text: "Enquiry logged. An officer will follow up with a solution." });
      setEnquiryForm({ district: "", description: "" });
      setEnquiryImageFile(null);
      const enquiryData: any = await apiFetch("/enquiries");
      setEnquiries(enquiryData || []);
    } catch (err: any) {
      setEnquiryMessage({ type: "error", text: err.message || "Failed to log enquiry." });
    } finally {
      setEnquirySubmitting(false);
    }
  };

  const handleResolveEnquiry = async (enquiryId: string) => {
    const solution = enquiryResolveDrafts[enquiryId];
    if (!solution || !solution.trim()) {
      alert("Please enter a solution before resolving.");
      return;
    }
    try {
      await apiFetch(`/enquiries/${enquiryId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ solution }),
      });
      const enquiryData: any = await apiFetch("/enquiries");
      setEnquiries(enquiryData || []);
    } catch (err: any) {
      alert(err.message || "Failed to resolve enquiry.");
    }
  };

  // Logout gate: field/sales officers must submit today's task-completion
  // document before they're allowed to sign out. Admin/manager/dealer
  // roles aren't gated — this only applies to officers whose day has a
  // "done for the day" concept.
  const requiresDayClosure = user?.role === "field_officer" || user?.role === "sales_officer";

  
  const handleSignOutClick = async () => {
    const gatedRoles = ["field_officer", "sales_officer", "manager"];
    if (user?.role && gatedRoles.includes(user.role)) {
      try {
        const res: any = await apiFetch("/reports/daily/today-status");
        if (!res.submitted_today) {
          setShowUserMenu(false);
          setShowDailyReportModal(true);
          return; // Block logout
        }
      } catch (err) {
        // Fall back gracefully
      }
    }
    // Proceed to existing logout flow
    await handleLogoutClick();
  };

  const handleSubmitDailyReport = async () => {
    if (!dailyReportSummary.trim()) {
      setDailyReportError("Summary is required.");
      return;
    }
    setDailyReportSubmitting(true);
    setDailyReportError("");
    try {
      let attachment_url = null;
      if (dailyReportFile) {
        attachment_url = await uploadFileGeneric("/reports/daily/upload", dailyReportFile);
      }
      await apiFetch("/reports/daily", {
        method: "POST",
        body: JSON.stringify({ summary: dailyReportSummary, attachment_url }),
      });
      setShowDailyReportModal(false);
      await handleLogoutClick();
    } catch (err: any) {
      if (err.message && err.message.includes("already submitted")) {
        setShowDailyReportModal(false);
        await handleLogoutClick();
      } else {
        setDailyReportError(err.message || "Failed to submit daily report.");
      }
    } finally {
      setDailyReportSubmitting(false);
    }
  };

  const handleLogoutClick = async () => {
    if (!requiresDayClosure) {
      await logout();
      router.replace("/login");
      return;
    }
    try {
      const status: any = await apiFetch("/day-closure/status");
      setDayClosureStatus(status);
      if (status?.closed_today) {
        await logout();
        router.replace("/login");
      } else {
        setShowUserMenu(false);
        setShowLogoutGateModal(true);
      }
    } catch (err) {
      // If we can't verify status, don't block logout — fail open rather
      // than trap the officer out of the app.
      await logout();
      router.replace("/login");
    }
  };

  const fetchAttendance = async (dateStr: string) => {
    setLoadingAttendance(true);
    try {
      const data: any = await apiFetch(`/attendance?date=${dateStr}`);
      setAttendanceRecords(data || []);
    } catch (err) {
      console.error("Failed to fetch attendance:", err);
      setAttendanceRecords([]);
    } finally {
      setLoadingAttendance(false);
    }
  };

  const fetchActiveLocations = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (userRoleRef.current !== "admin" && userRoleRef.current !== "manager") return;
    if (!silent) setIsLoadingActiveLocations(true);
    try {
      const data: any = await apiFetch("/location/active");
      setActiveLocations(data || []);
      setDataLoadError("");
      setLastSyncedAt(Date.now());
    } catch (err: any) {
      console.error("Failed to fetch active locations:", err);
      let errorMessage = "Network error — check your connection or CORS settings.";
      if (err instanceof ApiError) {
        errorMessage = `${err.status}: ${err.message}`;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      setDataLoadError(`Couldn't load live officer locations: ${errorMessage}. The map may be showing stale or no data.`);
    } finally {
      setIsLoadingActiveLocations(false);
    }
  };

  // Single source of truth for officer rows: the map, the table, and the
  // "Active Officers" count all read from this one memoized value so they
  // can never disagree with each other.
  const liveOfficers: LiveOfficer[] = useMemo(
    () => computeLiveOfficers(usersList, activeLocations),
    [usersList, activeLocations]
  );

  const getLiveOfficers = () => liveOfficers;

  const totalOfficerPages = Math.max(1, Math.ceil(liveOfficers.length / OFFICER_PAGE_SIZE));
  const paginatedOfficers = useMemo(
    () => liveOfficers.slice((officerTablePage - 1) * OFFICER_PAGE_SIZE, officerTablePage * OFFICER_PAGE_SIZE),
    [liveOfficers, officerTablePage]
  );

  // Keep the page in range if the roster shrinks (e.g. after a filter or a
  // refresh that returns fewer officers) instead of showing a blank page.
  useEffect(() => {
    if (officerTablePage > totalOfficerPages) setOfficerTablePage(totalOfficerPages);
  }, [totalOfficerPages, officerTablePage]);

  // watchPosition for active officer tracking pings
  useEffect(() => {
    if (!user || user.role === "admin" || user.role === "manager") return;

    let watchId: number | null = null;
    let lastPingTime = 0;
    let lastErrorPingTime = 0;
    let prevCoords: { latitude: number; longitude: number } | null = null;
    let prevTime: number | null = null;

    function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
      const R = 6371; // Earth's radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    if ("geolocation" in navigator) {
      watchId = navigator.geolocation.watchPosition(
        async (position) => {
          const now = Date.now();
          if (now - lastPingTime < 20000) return; // 20s throttle
          
          if (position.coords.accuracy && position.coords.accuracy > 5000) {
            console.warn(`GPS fix rejected client-side (accuracy ${position.coords.accuracy}m > 5000m)`);
            return;
          }
          
          lastPingTime = now;

          // 1. Derive speed in km/h
          let speed_kmh: number | null = null;
          if (position.coords.speed !== null && position.coords.speed >= 0) {
            speed_kmh = position.coords.speed * 3.6;
          } else if (prevCoords && prevTime) {
            const timeDeltaHours = (now - prevTime) / 3600000;
            if (timeDeltaHours > 0) {
              const distanceKm = calculateHaversineDistance(
                prevCoords.latitude,
                prevCoords.longitude,
                position.coords.latitude,
                position.coords.longitude
              );
              speed_kmh = distanceKm / timeDeltaHours;
            }
          }

          prevCoords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
          prevTime = now;

          // 2. Fetch battery status where supported (otherwise null)
          let battery_pct: number | null = null;
          if ("getBattery" in navigator) {
            try {
              const battery = await (navigator as any).getBattery();
              battery_pct = Math.round(battery.level * 100);
            } catch (e) {
              console.warn("Failed to read Battery API:", e);
            }
          }

          // 3. Send the active ping
          try {
            await apiFetch("/location/ping", {
              method: "POST",
              body: JSON.stringify({
                officer_id: user.id,
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy !== null ? Math.round(position.coords.accuracy * 10) / 10 : null,
                speed_kmh: speed_kmh !== null ? Math.round(speed_kmh * 10) / 10 : null,
                battery_pct: battery_pct,
                status: "active",
                timestamp: new Date(position.timestamp).toISOString(),
              }),
            });
            console.log("Location ping sent successfully:", position.coords);
          } catch (err) {
            console.error("Failed to send location ping:", err);
          }
        },
        async (err) => {
          console.warn("Geolocation watch error:", err);
          const now = Date.now();
          if (now - lastErrorPingTime < 20000) return; // Throttle error pings to 20s
          lastErrorPingTime = now;

          // Send a ping marking location as unavailable
          try {
            await apiFetch("/location/ping", {
              method: "POST",
              body: JSON.stringify({
                officer_id: user.id,
                lat: null,
                lng: null,
                accuracy: null,
                speed_kmh: null,
                battery_pct: null,
                status: "location_unavailable",
                timestamp: new Date().toISOString()
              })
            });
          } catch (pingErr) {
            console.error("Failed to send location_unavailable ping:", pingErr);
          }
        },
        { enableHighAccuracy: false, timeout: 30000, maximumAge: 0 }
      );
    }

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [user]);

  // BUG FIX: the "Active Officers" card on Overview always read 0/N.
  //
  // Every call to fetchActiveLocations() lived inside the map-only
  // effect below (`activeTab === "map"`), so on any other tab
  // activeLocations stayed [] and the numerator was always 0. The
  // denominator looked right because it comes from usersList, which
  // loads globally — which is exactly why this read as "wrong maths"
  // rather than "missing data".
  //
  // Overview needs the same data, so it gets its own lightweight poll.
  // Deliberately NOT a second WebSocket: the socket below is for the
  // live map's real-time position updates, and opening a second one
  // per tab would double the server's connections for a card that only
  // shows a count. A 30s poll is plenty for "how many are active".
  useEffect(() => {
    if (!user) return;
    if (user.role !== "admin" && user.role !== "manager") return;
    // The map tab already polls and sockets; don't double up.
    if (activeTab === "map") return;

    fetchActiveLocations({ silent: true });
    const id = setInterval(() => {
      // Skip while the tab is hidden — same reasoning as the map poll:
      // no point burning API calls in a background tab.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      fetchActiveLocations({ silent: true });
    }, 30000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeTab]);

  // Periodic active location polling for admin — every 30s, paused while
  // the tab isn't visible so we don't burn API calls/battery in a
  // background tab, and resumed (with an immediate refresh) when it
  // becomes visible again.
  useEffect(() => {
    if (!(user && activeTab === "map")) return;

    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    
    // Do an initial fetch to populate the list on load!
    fetchActiveLocations({ silent: true });

    const connect = () => {
      let baseUrl = API_BASE_URL;
      if (baseUrl.startsWith("/")) baseUrl = window.location.origin + baseUrl;
      let wsUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) + "/ws/locations" : baseUrl + "/ws/locations";
      wsUrl = wsUrl.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
      
      const token = tokenStorage.getAccessToken();
      if (token) wsUrl += `?token=${encodeURIComponent(token)}`;

      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setActiveLocations(prev => {
            const index = prev.findIndex(loc => loc.officer_id === data.officer_id);
            if (index >= 0) {
              const updated = [...prev];
              updated[index] = { ...updated[index], ...data };
              return updated;
            } else {
              // We need the login time and name from Postgres, so trigger a full fetch
              fetchActiveLocations({ silent: true });
              return prev;
            }
          });
          setLastSyncedAt(Date.now());
        } catch (err) {
          console.error("Failed to parse WS location message:", err);
        }
      };

      ws.onclose = () => {
        if (document.visibilityState === "visible") {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      };
    };

    const disconnect = () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) {
        ws.onclose = null; // Prevent reconnect loop
        ws.close();
        ws = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchActiveLocations({ silent: true });
        connect();
      } else {
        disconnect();
      }
    };

    if (document.visibilityState === "visible") connect();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeTab, user]);

  // Debounced/rate-limited manual refresh: ignores clicks while a refresh
  // is already in flight or for a short cooldown after one completes, so
  // impatient double/triple-clicking can't hammer the API.
  const handleManualRefreshMap = () => {
    if (isRefreshingMap) return;
    setIsRefreshingMap(true);
    fetchActiveLocations({ silent: true }).finally(() => {
      setTimeout(() => setIsRefreshingMap(false), 3000);
    });
  };

  useEffect(() => {
    if (user) {
      fetchDashboardData();
      fetchNotifications();
      fetchUsers(isArchivedTab);
      fetchTasks();

      // Admins are exempt server-side (require_location_consent returns
      // early for Role.ADMIN) - only field/sales officers ever need this.
      if (user.role === "field_officer" || user.role === "sales_officer") {
        apiFetch("/consent/location")
          .then((status: any) => setLocationConsent(status))
          .catch((err: any) => console.error("Failed to load location consent status", err));
      }

      // Poll every 5 seconds to receive requests, status changes, and notifications in real-time
      const interval = setInterval(() => {
        fetchDashboardData();
        fetchNotifications();
        fetchTasks();
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [user]);

  const fetchDailyReports = async () => {
    setLoadingDailyReports(true);
    try {
      let url = `/reports/daily?from_date=${dailyReportDateRange.from_date}&to_date=${dailyReportDateRange.to_date}`;
      if (dailyReportUserFilter) url += `&user_id=${dailyReportUserFilter}`;
      const data: any = await apiFetch(url);
      setDailyReportsData(data || []);
    } catch (err: any) {
      console.error("Failed to fetch daily reports:", err);
    } finally {
      setLoadingDailyReports(false);
    }
  };

  const fetchAdminDayClosures = async () => {
    setLoadingDayClosures(true);
    try {
      const [closuresData, missingData]: [any, any] = await Promise.all([
        apiFetch("/day-closure"),
        apiFetch("/day-closure/missing-today")
      ]);
      setAdminDayClosures(Array.isArray(closuresData) ? closuresData : []);
      setMissingDayClosures(Array.isArray(missingData) ? missingData : []);
    } catch (err: any) {
      console.error("Failed to fetch day closures:", err);
    } finally {
      setLoadingDayClosures(false);
    }
  };

  const fetchSalesClosures = async () => {
    // Admin/manager only - the endpoint enforces that server-side too,
    // this check just avoids a pointless 403 for other roles.
    if (user?.role !== "admin" && user?.role !== "manager") return;
    const params = new URLSearchParams();
    if (salesClosureOfficerId) params.set("officer_id", salesClosureOfficerId);
    if (salesClosureDateFrom) params.set("date_from", salesClosureDateFrom);
    if (salesClosureDateTo) params.set("date_to", salesClosureDateTo);
    if (salesClosureMonth) params.set("month", salesClosureMonth);
    if (salesClosureDistrict) params.set("district", salesClosureDistrict);
    try {
      const data: any = await apiFetch(`/day-closure/sales?${params.toString()}`);
      setSalesClosures(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch sales closures:", err);
      setSalesClosures([]);
    }
  };

  const openSalesClosureDetail = async (closureId: string) => {
    try {
      const d: any = await apiFetch(`/day-closure/sales/${closureId}`);
      setSalesClosureDetail(d);
    } catch (err: any) {
      alert(err.message || "Couldn't load closure detail.");
    }
  };

  const saveSalesClosureEdit = async () => {
    if (!editingSalesClosure) return;
    setSalesEditSaving(true);
    try {
      await apiFetch(`/day-closure/sales/${editingSalesClosure.closure_id}`, {
        method: "PUT",
        body: JSON.stringify(salesEditForm),
      });
      setEditingSalesClosure(null);
      await fetchSalesClosures();
    } catch (err: any) {
      alert(err.message || "Couldn't save changes.");
    } finally {
      setSalesEditSaving(false);
    }
  };

  const handleDeleteDayClosure = async (closure: any) => {    // Per the visits table having no is_deleted column, and no other
    // part of this app ever deleting a submitted visit (only drafts) -
    // this removes the closure bookkeeping only. Said explicitly here
    // since that's not obvious from a bare "Delete" button.
    const confirmed = window.confirm(
      `Delete this day closure record for ${closure.officer_name} (${closure.date})?\n\nThis removes the closure record only; the underlying visit data (farmer, crop, sales history) is kept.`
    );
    if (!confirmed) return;
    try {
      await apiFetch(`/admin/day-closures/${closure.id}`, { method: "DELETE" });
      await fetchAdminDayClosures();
    } catch (err: any) {
      alert(err.message || "Failed to delete day closure.");
    }
  };

  const openEditDayClosure = (closure: any) => {
    setEditingClosure(closure);
    setEditClosureForm({
      crop_status: closure.crop_status || "",
      status_other_text: closure.status_other_text || "",
      demo_status: closure.demo_status || "",
      purchased: closure.purchased ?? false,
      order_value: closure.order_value ?? "",
      conversion_status: closure.conversion_status || "",
    });
    setEditClosureError("");
  };

  const saveEditDayClosure = async () => {
    if (!editingClosure) return;
    if (descriptionMissing(editClosureForm.crop_status === "other", editClosureForm.status_other_text)) {
      setEditClosureError(OTHER_DESCRIPTION_MESSAGE);
      return;
    }
    setEditClosureSaving(true);
    setEditClosureError("");
    try {
      const payload: Record<string, any> = {};
      if (editClosureForm.crop_status) payload.crop_status = editClosureForm.crop_status;
      // Cleared when the status is no longer "other", so an abandoned
      // description is never stored against a different status.
      payload.status_other_text =
        editClosureForm.crop_status === "other" ? (editClosureForm.status_other_text || "").trim() : null;
      if (editClosureForm.demo_status) payload.demo_status = editClosureForm.demo_status;
      payload.purchased = !!editClosureForm.purchased;
      if (editClosureForm.order_value !== "") payload.order_value = parseFloat(editClosureForm.order_value);
      if (editClosureForm.conversion_status) payload.conversion_status = editClosureForm.conversion_status;

      await apiFetch(`/admin/day-closures/${editingClosure.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setEditingClosure(null);
      await fetchAdminDayClosures();
    } catch (err: any) {
      setEditClosureError(err.message || "Failed to save changes.");
    } finally {
      setEditClosureSaving(false);
    }
  };

  const [exportingClosures, setExportingClosures] = useState(false);

  const handleExportDayClosures = async () => {
    setExportingClosures(true);
    try {
      // Uses the shared helper so every export in the app behaves the
      // same way and the auth header can't be forgotten in one place.
      await downloadAuthenticatedFile(dayClosureExportUrl, datedFilename("day-closures", "xlsx"));
    } catch (err: any) {
      alert(err.message || "Couldn't export.");
    } finally {
      setExportingClosures(false);
    }
  };

  const dayClosureExportUrl = `${API_BASE_URL}/admin/daily-visits/export/excel?only_day_closures=true`;

  const fetchTasks = async () => {
    try {
      const data: any = await apiFetch("/tasks");
      setTasks(data || []);
    } catch (err) {
      console.error("Failed to fetch tasks:", err);
      setTasks([]);
      setDataLoadError("Couldn't load tasks from the server. Showing no data instead of stale placeholders — try refreshing.");
    }
  };

  const fetchProductivity = async (period: "daily" | "weekly" | "monthly") => {
    try {
      if (user?.role === "admin" || user?.role === "manager") {
        const data: any = await apiFetch(`/productivity?period=${period}`);
        setProductivityData(data || []);
      } else {
        const data: any = await apiFetch(`/productivity/me?period=${period}`);
        setMyProductivity(data);
      }
    } catch (err) {
      console.error("Failed to fetch productivity:", err);
      setDataLoadError("Couldn't load productivity data from the server — try refreshing.");
    }
  };

  const handleSubmitNoActivity = async () => {
    // Whitespace-only is rejected client-side too, so the officer gets an
    // immediate message rather than a round-trip 400. The backend and a
    // DB CHECK constraint enforce the same rule - this is convenience,
    // not the guarantee.
    if (!noActivityReason.trim()) {
      setClosureMessage({ type: "error", text: "Please give a short reason for having no activity today." });
      return;
    }
    setNoActivitySaving(true);
    try {
      await apiFetch("/day-closure/no-activity", {
        method: "POST",
        body: JSON.stringify({ reason: noActivityReason.trim() }),
      });
      setShowNoActivityForm(false);
      setNoActivityReason("");
      setClosureMessage({
        type: "success",
        text: "Day closed with no activity. You can now sign out.",
      });
      // Update the gate state directly so the officer is not still
      // prompted to close their day. (There is no shared refresher to
      // call - the only /day-closure/status fetch lives inside the
      // logout flow itself.)
      setDayClosureStatus({ closed_today: true });
    } catch (err: any) {
      setClosureMessage({ type: "error", text: err.message || "Couldn't submit." });
    } finally {
      setNoActivitySaving(false);
    }
  };

  const handleWebCheckIn = async (skipConsentGate = false) => {
    // Gate client-side on the consent status we already fetched, so the
    // officer sees an actual disclosure screen instead of a silent 403.
    // The server still enforces this independently either way (see
    // require_location_consent) - this is purely a better experience,
    // not a security boundary. An officer who somehow slips past this
    // (e.g. stale/unfetched locationConsent) still gets the 403 catch
    // below, which now surfaces the real reason instead of eating it.
    //
    // BUG FIX (two ways this used to do nothing at all):
    //  1. If the consent status had not loaded (or its request had failed),
    //     locationConsent was null, the modal only renders when it is
    //     non-null, and the tap silently did nothing. It is now fetched on
    //     demand, and a real message is shown if that fails too.
    //  2. After "I Agree", this function was called again from a closure
    //     that still held the OLD consent state, so it re-opened the modal
    //     instead of checking in. skipConsentGate is passed after a
    //     successful accept; the server still enforces consent either way.
    if ((user?.role === "field_officer" || user?.role === "sales_officer") && !skipConsentGate) {
      let consent = locationConsent;
      if (!consent) {
        try {
          consent = await apiFetch("/consent/location");
          setLocationConsent(consent);
        } catch (err: any) {
          alert(err?.message || "Couldn't load the location notice. Check your connection and try again.");
          return;
        }
      }
      if (
        consent.accepted_version == null ||
        consent.accepted_version < consent.required_version
      ) {
        setShowConsentModal(true);
        return;
      }
    }

    setIsCheckingIn(true);
    try {
      const getPosition = (): Promise<GeolocationPosition> => {
        return new Promise((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error("Geolocation is not supported by your browser"));
          } else {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 20000,
              maximumAge: 60000,
            });
          }
        });
      };

      let lat = 0;
      let lng = 0;
      let gotPosition = false;
      try {
        const pos = await getPosition();
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        gotPosition = true;
      } catch (err) {
        // Check-in still goes through, but it is recorded honestly as "no
        // GPS" rather than as a real fix at 0,0.
        console.warn("Could not get location", err);
      }

      await apiFetch("/attendance/check-in", {
        method: "POST",
        body: JSON.stringify({
          latitude: lat,
          longitude: lng,
          device_id: "web-dashboard",
          is_fake_gps: false,
          is_gps_disabled: !gotPosition,
          phone: "web"
        })
      });
      // Refresh dashboard after check-in
      fetchDashboardData();
    } catch (err: any) {
      console.error("Failed to check in via web", err);
      // BUG FIX: this previously swallowed every failure silently - the
      // button just reverted to "Check In Now" with no feedback at all,
      // which is exactly how the missing-consent 403 presented (see the
      // comment above this function). A 403 specifically means the
      // consent check failed server-side (it's the only thing that
      // returns 403 on this endpoint) - reopen the modal so the officer
      // can actually resolve it instead of retrying the same click
      // forever. Any other error is shown directly rather than hidden.
      if (err?.status === 403) {
        setShowConsentModal(true);
      } else {
        alert(err?.message || "Couldn't check in. Please try again.");
      }
    } finally {
      setIsCheckingIn(false);
    }
  };

  const handleAcceptLocationConsent = async () => {
    if (!locationConsent) return;
    setIsAcceptingConsent(true);
    setConsentError("");
    try {
      await apiFetch("/consent/location", {
        method: "POST",
        body: JSON.stringify({ version: locationConsent.required_version, source: "server" }),
      });
      setLocationConsent({
        ...locationConsent,
        accepted_version: locationConsent.required_version,
      });
      setShowConsentModal(false);
      // Proceed straight into the check-in the officer was originally
      // trying to do, rather than making them click twice.
      handleWebCheckIn(true);
    } catch (err: any) {
      setConsentError(err.message || "Couldn't record your acceptance. Please try again.");
    } finally {
      setIsAcceptingConsent(false);
    }
  };

  useEffect(() => {
    if (user && activeTab === "productivity") {
      fetchProductivity(productivityPeriod);
    }
  }, [activeTab, productivityPeriod, user]);

  const mappedProductivityTeam = useMemo(() => {
    return (productivityData || []).map((row: any) => {
      const officerUser = usersList.find((u: any) => u.id === row.officer_id);
      const manager = usersList.find((u: any) => u.id === officerUser?.manager_id);
      const rate = row.task_completion_rate;
      const status: 'On Track' | 'At Risk' | 'Behind' =
        rate === null || rate === undefined || rate >= 0.8
          ? 'On Track'
          : rate >= 0.5
          ? 'At Risk'
          : 'Behind';
      return {
        id: row.officer_id,
        name: row.officer_name,
        role: row.officer_role,
        tasksCompleted: row.tasks_completed ?? 0,
        tasksTotal: row.tasks_assigned ?? 0,
        visitsLogged: row.visits_completed ?? 0,
        hoursLogged: (row.days_present ?? 0) * 8,
        status,
        manager: manager?.full_name || 'Unassigned',
        team: manager?.full_name || 'Unassigned',
      };
    });
  }, [productivityData, usersList]);

  // ---- Navigation (see lib/navigation.ts) --------------------------------
  const navSections = useMemo(() => navForRole(user?.role), [user?.role]);
  const activeNav = findActive(navSections, { dashboardTab: activeTab });

  const selectNavTab = (tab: NavTab) => {
    if (tab.target.kind === "route") {
      const href = hrefFor(tab.target);
      if (href) router.push(href);
      return;
    }
    setActiveTab(tab.target.id);
    if (tab.target.id === "day-closures") {
      fetchAdminDayClosures();
      fetchSalesClosures();
    }
    if (tab.target.openFormBuilder) setShowFormBuilder(true);
  };

  // What the sidebar badge on each section adds up. These are the same
  // counts the old per-item badges showed - just rolled up.
  const sectionBadge = (sectionId: string): { count: number; alert?: boolean; live?: boolean } => {
    const isOversight = user?.role === "admin" || user?.role === "manager";
    if (sectionId === "work") {
      return {
        count: myOpenTasksCount + (user?.role === "admin" ? pendingPlansCount : 0) + (isOversight ? pendingLeaveCount : 0),
      };
    }
    if (sectionId === "field") {
      return {
        count: (user?.role === "admin" ? pendingIssuesCount : 0) + (user?.role !== "sales_officer" ? openEnquiriesCount : 0),
        alert: user?.role === "admin" && pendingIssuesCount > 0,
      };
    }
    if (sectionId === "team") return { count: 0, live: isOversight && activeCount > 0 };
    if (sectionId === "stock") return { count: user?.role === "admin" ? lowStockDealersCount : 0, alert: true };
    return { count: 0 };
  };

  // Dashboard opens immediately with the Overview screen for every role
  // (Section 26) - previously Admin landed on the Live Tracking Map and
  // everyone else on Weekly Plans, neither of which is an "at a glance"
  // summary of what the role needs to know/do.
  useEffect(() => {
    if (user && !hasSetLandingTab) {
      // Other pages link here as /dashboard?tab=plans (and &builder=1 for
      // the day-closure form builder). Only tabs this role can actually
      // see are honoured.
      const params = new URLSearchParams(window.location.search);
      const wanted = params.get("tab");
      const allowed = navForRole(user.role)
        .flatMap((sec) => sec.tabs)
        .some((t) => t.target.kind === "tab" && t.target.id === wanted);
      setActiveTab(allowed && wanted ? wanted : "overview");
      if (allowed && wanted === "day-closures") {
        fetchAdminDayClosures();
        fetchSalesClosures();
        if (params.get("builder") === "1" && user.role === "admin") setShowFormBuilder(true);
      }
      setHasSetLandingTab(true);
    }
  }, [user, hasSetLandingTab]);

  useEffect(() => {
    if (user && activeTab === "users") {
      fetchUsers(isArchivedTab);
    }
  }, [activeTab, user]);

  useEffect(() => {
    if (user && activeTab === "attendance") {
      fetchAttendance(attendanceDate || "");
    }
  }, [activeTab, attendanceDate, user]);

  useEffect(() => {
    if (activeTab === "users") {
      fetchUsers(isArchivedTab);
    }
  }, [isArchivedTab]);
  // Statistics — derived from real data (usersList + activeLocations), never mock data
  // "Active" here must mean "currently pinging with a fresh, non-stale
  // location" — not "account not disabled". Deriving it from is_active
  // was the source of the wrong Active Officers count: an officer who
  // hasn't logged in all day still counted as "active" as long as their
  // account wasn't disabled.
  const activeCount = countActiveOfficers(liveOfficers);
  const totalOfficersCount = liveOfficers.length;
  const lowStockDealersCount = dealers.filter(d => d.stockLevel === "low" || d.stock_qty < 10).length;
  const pendingPlansCount = plans.filter(p => p.status === "pending").length;
  const pendingIssuesCount = issues.filter(i => i.status === "pending").length;
  const pendingLeaveCount = leaveRequests.filter(l => l.status === "pending").length;
  const openEnquiriesCount = enquiries.filter(e => e.status === "open").length;
  const myOpenTasksCount = (user?.role === "admin" || user?.role === "manager")
    ? tasks.filter(t => t.status !== "done" && t.status !== "cancelled").length
    : tasks.filter(t => t.assigned_to === user?.id && t.status !== "done" && t.status !== "cancelled").length;

  // Overview screen figures - real, derived from collectionsRequired
  // (server-scoped per role, see fetch above), never estimated.
  const totalOutstanding = collectionsRequired.reduce((sum, c) => sum + (c.outstanding_amount || 0), 0);
  const overdueCollectionsCount = collectionsRequired.filter(c => c.payment_status === "overdue").length;
  const overdueDealerCount = new Set(collectionsRequired.filter(c => c.payment_status === "overdue").map(c => c.dealer_id)).size;

  // Attendance metrics
  const presentCount = attendanceRecords.length;
  const flaggedCount = attendanceRecords.filter(r => r.is_fake_gps).length;
  const activeShiftCount = attendanceRecords.filter(r => !r.check_out_time).length;

  const handleApprovePlan = async (id: string, approve: boolean, comment?: string) => {
    try {
      await apiFetch(`/plans/${id}/approve`, {
        method: "PATCH",
        body: JSON.stringify({ approve, comment }),
      });
      fetchDashboardData();
      fetchNotifications();
    } catch (err: any) {
      alert(err.message || "Failed to update weekly plan.");
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setTaskFormError("");
    setTaskFormSuccess("");
    if (!newTaskTitle || !newTaskAssignedTo || !newTaskDueDate) {
      setTaskFormError("Title, assignee, and due date are required.");
      return;
    }
    try {
      await apiFetch("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: newTaskTitle,
          description: newTaskDescription || null,
          assigned_to: newTaskAssignedTo,
          due_date: newTaskDueDate,
        }),
      });
      setTaskFormSuccess("Task assigned successfully!");
      setNewTaskTitle("");
      setNewTaskDescription("");
      setNewTaskAssignedTo("");
      setNewTaskDueDate("");
      fetchTasks();
    } catch (err: any) {
      setTaskFormError(err.message || "Failed to assign task.");
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, newStatus: string) => {
    try {
      await apiFetch(`/tasks/${taskId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      fetchTasks();
      fetchNotifications();
    } catch (err: any) {
      alert(err.message || "Failed to update task status.");
    }
  };

  // "Mark Done" no longer sets status directly - the backend now requires
  // going through pending_review first, with photo proof for farmer/
  // dealer tasks, then an admin/manager approval via a separate endpoint.
  // This captures the photo (reusing the same /issues/upload generic
  // handler already used for visit/crop-issue photos elsewhere in this
  // file) and current browser geolocation, then submits both along with
  // status: "pending_review".
  const handleSubmitTaskForReview = async (task: any) => {
    setTaskProofError("");
    const needsPhoto = task.related_type === "farmer" || task.related_type === "dealer";
    if (needsPhoto && !taskProofFile) {
      setTaskProofError("A proof photo is required for this task before it can be submitted for review.");
      return;
    }

    setTaskProofUploading(true);
    try {
      let proof_photo_url: string | undefined;
      if (taskProofFile) {
        proof_photo_url = await uploadFileGeneric("/issues/upload", taskProofFile);
      }

      let proof_gps_lat: number | undefined;
      let proof_gps_lng: number | undefined;
      if (navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
          });
          proof_gps_lat = position.coords.latitude;
          proof_gps_lng = position.coords.longitude;
        } catch {
          // GPS proof is optional - a denied/unavailable location
          // shouldn't block submission, only the photo is required.
        }
      }

      await apiFetch(`/tasks/${task.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "pending_review", proof_photo_url, proof_gps_lat, proof_gps_lng }),
      });

      setSubmittingTaskId(null);
      setTaskProofFile(null);
      fetchTasks();
      fetchNotifications();
    } catch (err: any) {
      setTaskProofError(err.message || "Failed to submit task for review.");
    } finally {
      setTaskProofUploading(false);
    }
  };

  const handleReviewTask = async (taskId: string, approve: boolean) => {
    let rejection_reason: string | null = null;
    if (!approve) {
      rejection_reason = window.prompt("Reason for rejecting this task (optional):");
      if (rejection_reason === null) return; // user cancelled the prompt
    }
    try {
      await apiFetch(`/tasks/${taskId}/review`, {
        method: "PATCH",
        body: JSON.stringify({ approve, rejection_reason: rejection_reason || undefined }),
      });
      fetchTasks();
      fetchNotifications();
    } catch (err: any) {
      alert(err.message || "Failed to record review decision.");
    }
  };

  // WebSocket dynamic alerts listener
  useEffect(() => {
    let baseUrl = API_BASE_URL;
    if (baseUrl.startsWith("/")) {
      baseUrl = window.location.origin + baseUrl;
    }
    let wsUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) + "/ws/alerts" : baseUrl + "/ws/alerts";
    wsUrl = wsUrl.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
    if (typeof window !== "undefined") {
      if (window.location.protocol === "https:") {
        wsUrl = wsUrl.replace(/^ws:\/\//i, "wss://");
      }
      try {
        const urlObj = new URL(wsUrl);
        urlObj.hostname = window.location.hostname;
        wsUrl = urlObj.toString();
      } catch (e) {
        console.warn("Could not rewrite WebSocket hostname:", e);
      }
    }
    const alertsToken = tokenStorage.getAccessToken();
    if (alertsToken) {
      wsUrl += (wsUrl.includes("?") ? "&" : "?") + `token=${encodeURIComponent(alertsToken)}`;
    }
    console.log("Connecting to WebSocket:", wsUrl);
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("WebSocket Alert Received:", data);
        if (data.officer_id || data.userId) {
          // Refresh from the real /location/active endpoint rather than
          // patching a locally-held officer object — the server is the
          // only source of truth for live position data. Cheap no-op if
          // the admin isn't currently viewing the map.
          fetchActiveLocations();
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };
    let isCleaningUp = false;
    ws.onerror = () => {
      if (isCleaningUp) return;
      // console.WARN, not error: the live map already falls back to
      // polling and the reconnect logic below retries, so a dropped
      // socket is a degraded state, not a failure. Logging it as an
      // error surfaced it in Next.js's dev overlay as "WebSocket
      // connection error: {}" - an empty object, because a WebSocket
      // ErrorEvent carries no useful detail by design (the spec hides
      // the cause to avoid leaking cross-origin information).
      //
      // The URL is logged instead, which is the part that is actually
      // diagnosable - almost always the backend not running, or a
      // ws:// vs wss:// mismatch behind a proxy.
      console.warn(
        `Live-tracking WebSocket unavailable (${wsUrl}). Falling back to polling; will retry.`
      );
    };
    ws.onclose = () => {
      if (!isCleaningUp) {
        console.log("WebSocket connection closed unexpectedly");
      }
    };
    return () => {
      isCleaningUp = true;
      ws.close();
    };
  }, []);

  const [selectedMarker, setSelectedMarker] = useState<any | null>(null);

  const myPendingPlansCount = plans.filter((p: any) => p.status === "pending" || p.status === "submitted").length;
  const myPendingIssuesCount = issues.filter((i: any) => i.status === "pending" || i.status === "reported" || i.status === "open").length;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header Bar */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-4 lg:px-6 py-3.5 text-white bg-green-900 border-b border-green-800 shadow-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowMobileSidebar(true)}
            className="lg:hidden p-1.5 -ml-1.5 hover:bg-green-800 rounded-lg transition flex-shrink-0"
            title="Open menu"
          >
            <Menu className="w-6 h-6 text-white" />
          </button>
          <img src="/logo.png" alt="Vishakan Biotech Logo" className="h-10 w-auto bg-white p-1 rounded shadow-sm flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-wide leading-none truncate">Vishakan Biotech</h1>
            <p className="text-[10px] text-green-200 mt-1 font-semibold uppercase tracking-wider truncate">
              {user?.role === "admin" && "Admin Portal"}
              {user?.role === "field_officer" && "Field Officer Portal"}
              {user?.role === "sales_officer" && "Sales Officer Portal"}
              {user?.role === "manager" && "Regional Manager Portal"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5 relative">
          {/* Phone preview simulator toggle */}
          <button
            onClick={() => setShowPhonePreview(true)}
            className="p-1.5 hover:bg-green-800 rounded-lg transition"
            title="Preview this page on a phone-sized frame"
          >
            <Smartphone className="w-5 h-5 text-green-100" />
          </button>

          {/* Notification Bell */}
          <div className="relative">
            <button 
              onClick={() => {
                setShowNotifications(!showNotifications);
                setShowUserMenu(false);
              }}
              className="p-1.5 hover:bg-green-800 rounded-lg transition relative"
            >
              <Bell className="w-5 h-5 text-green-100" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-600 rounded-full flex items-center justify-center text-[9px] font-bold text-white border border-green-900">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notifications Dropdown */}
            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-slate-100 py-3 text-slate-800 z-50">
                <div className="flex justify-between items-center px-4 pb-2 border-b border-slate-100">
                  <span className="font-bold text-sm text-slate-800">Notifications</span>
                  {unreadCount > 0 && (
                    <button 
                      onClick={handleMarkAllAsRead}
                      className="text-xs font-bold text-green-700 hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-50">
                  {notifications.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">No recent notifications</p>
                  ) : (
                    notifications.map(n => (
                      <div key={n.id} className={`p-3 text-left transition ${n.is_read ? "bg-white" : "bg-green-50/40"}`}>
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-xs text-slate-800">{n.title}</span>
                          {!n.is_read && (
                            <button 
                              onClick={() => handleMarkAsRead(n.id)}
                              className="text-[10px] text-green-700 font-bold hover:underline"
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 mt-1">{n.message}</p>
                        <span className="text-[9px] text-slate-400 block mt-1">
                          {new Date(n.created_at).toLocaleDateString()} {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Menu Dropdown */}
          <div className="relative">
            <button 
              onClick={() => {
                setShowUserMenu(!showUserMenu);
                setShowNotifications(false);
              }}
              className="flex items-center gap-3 hover:bg-green-800 px-2 py-1 rounded-lg transition"
            >
              <div className="text-right hidden md:block">
                <span className="block text-xs font-bold">{user?.full_name || "User"}</span>
                <span className="block text-[10px] text-green-300 font-medium capitalize">
                  {user?.role ? (ROLE_LABELS[user.role] || user.role) : ""}
                </span>
              </div>
              <div className="w-8 h-8 bg-green-700 hover:bg-green-600 rounded-full flex items-center justify-center font-bold border border-green-600 text-sm">
                {(user?.full_name || "US").split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)}
              </div>
              <ChevronDown className="w-4 h-4 text-green-200" />
            </button>

            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-2xl border border-slate-100 py-2 text-slate-800 z-50">
                <div className="px-4 py-2 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-800">{user?.full_name || "User"}</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">{user?.employee_id || user?.email}</p>
                </div>
                <button 
                  onClick={handleSignOutClick}
                  className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-xs font-bold text-red-600 flex items-center gap-2 transition"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {dataLoadError && (
        <div className="flex items-center justify-between gap-3 px-6 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{dataLoadError}</span>
          </div>
          <button
            onClick={() => setDataLoadError("")}
            className="text-amber-500 hover:text-amber-700 font-bold text-xs flex-shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 relative">
        {/* Mobile-only backdrop, shown behind the sidebar drawer when open.
            Tapping it closes the drawer - standard off-canvas nav pattern. */}
        {showMobileSidebar && (
          <div
            className="lg:hidden fixed inset-0 bg-black/40 z-30"
            onClick={() => setShowMobileSidebar(false)}
          />
        )}

        {/* Sidebar Menu - fixed/off-canvas on mobile (hidden by default,
            slides in from the left when the header hamburger is tapped),
            always visible + in-flow on desktop (md:). This was previously
            a plain w-64 block with no responsive behavior at all, so on a
            phone-width screen it just rendered at full width and pushed
            almost all real content off-screen - exactly the "sidebar
            hides 3/4 of the app" bug. Clicking anywhere inside (any nav
            button) closes the mobile drawer via event bubbling, rather
            than needing every individual nav onClick edited to do it. */}
        <aside
          onClick={() => setShowMobileSidebar(false)}
          className={`w-64 bg-slate-900 text-slate-300 flex flex-col justify-between border-r border-slate-800 overflow-y-auto
            fixed lg:relative inset-y-0 left-0 z-40 lg:z-auto
            transform transition-transform duration-200 ease-in-out
            ${showMobileSidebar ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
        >
          <div className="px-4 py-6">
            {/* Seven sections, built from lib/navigation.ts for the signed-in
                role. Tabs inside a section show in the strip above the page.
                Search matches current AND old names ("Admin Stock",
                "Movement History" ...) so nobody has to relearn the app. */}
            <div className="relative mb-4" onClick={(e) => e.stopPropagation()}>
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={navQuery}
                onChange={(e) => setNavQuery(e.target.value)}
                placeholder="Find a screen"
                aria-label="Find a screen"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-600"
              />
            </div>

            {navQuery.trim() ? (
              <nav className="space-y-1">
                {searchNav(navSections, navQuery).map(({ section, tab }) => (
                  <button
                    key={`${section.id}-${tab.id}`}
                    onClick={() => { selectNavTab(tab); setNavQuery(""); }}
                    className="flex items-center justify-between w-full gap-3 px-4 py-3 text-sm font-medium rounded-lg transition hover:bg-slate-800 hover:text-white"
                  >
                    <span>{tab.label}</span>
                    <span className="text-xs text-slate-500">{section.label}</span>
                  </button>
                ))}
                {searchNav(navSections, navQuery).length === 0 && (
                  <p className="px-4 py-3 text-sm text-slate-500">Nothing matches &ldquo;{navQuery}&rdquo;.</p>
                )}
              </nav>
            ) : (
              <nav className="space-y-1">
                {navSections.map((section) => {
                  const Icon = SECTION_ICONS[section.id] ?? ClipboardList;
                  const isCurrent = activeNav?.section.id === section.id;
                  const badge = sectionBadge(section.id);
                  return (
                    <button
                      key={section.id}
                      onClick={() => { const first = section.tabs[0]; if (first) selectNavTab(first); }}
                      className={`flex items-center w-full gap-3 px-4 py-3 text-sm font-medium rounded-lg transition ${isCurrent ? "bg-green-700 text-white" : "hover:bg-slate-800 hover:text-white"}`}
                    >
                      <Icon className="w-5 h-5" />
                      {section.label}
                      {badge.live ? (
                        <span className="ml-auto w-2.5 h-2.5 bg-green-400 rounded-full animate-ping" />
                      ) : badge.count > 0 ? (
                        <span className={`ml-auto px-2 py-0.5 text-xs rounded-full text-white ${badge.alert ? "bg-red-600" : "bg-amber-600"}`}>{badge.count}</span>
                      ) : null}
                    </button>
                  );
                })}
              </nav>
            )}
          </div>

          <div className="p-4 bg-slate-950 text-xs border-t border-slate-800">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span>API Server status:</span>
              <span className="flex items-center gap-1 text-green-400 font-bold"><span className="w-1.5 h-1.5 bg-green-400 rounded-full" />Online</span>
            </div>
            <div className="text-slate-600">v1.2.0-Production</div>
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-300 hover:underline mt-2 inline-block"
            >
              Privacy Policy
            </a>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-4 sm:p-6 bg-slate-50 overflow-y-auto overflow-x-hidden min-h-0 w-full min-w-0">
          <SectionTabs dashboardTab={activeTab} onSelectDashboardTab={selectNavTab} />
          {/* 9AM check-in / 6PM monitoring window reminders */}
          {(user?.role === "field_officer" || user?.role === "sales_officer") && !myTodayAttendance && nowTick > new Date(new Date().setHours(9, 0, 0, 0)).getTime() && (
            <div className="mb-6 flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-xl">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <div className="flex-1">
                <span>You haven&apos;t checked in yet today. Please check in — officers are monitored from check-in until 6:00 PM.</span>
              </div>
              <button
                onClick={() => handleWebCheckIn()}
                disabled={isCheckingIn}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs px-4 py-1.5 rounded-lg font-bold transition-colors disabled:opacity-50 flex-shrink-0"
              >
                {isCheckingIn ? "Checking In..." : "Check In Now"}
              </button>
            </div>
          )}


          {/* Attendance metrics — unique to this tab, not duplicated on
              Overview (which already shows Active Officers/Low Stock/
              Pending Plans/Crop Issues, so that same 4-card bar previously
              also rendered here on the Map tab was a direct duplicate and
              has been removed). */}
          {(user?.role === "admin" || user?.role === "manager") && activeTab === "attendance" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400 uppercase font-semibold">Present Today</span>
                  <span className="block text-2xl font-bold text-slate-800">{presentCount} Officers</span>
                </div>
                <div className="p-3 bg-green-50 rounded-lg">
                  <Users className="w-6 h-6 text-green-700" />
                </div>
              </div>

              <div className="p-4 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400 uppercase font-semibold">Flagged (Mock/Fake GPS)</span>
                  <span className="block text-2xl font-bold text-red-600">{flaggedCount} Detections</span>
                </div>
                <div className="p-3 bg-red-50 rounded-lg">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
              </div>

              <div className="p-4 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400 uppercase font-semibold">On Active Shift</span>
                  <span className="block text-2xl font-bold text-blue-600">{activeShiftCount} Active</span>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg">
                  <Activity className="w-6 h-6 text-blue-700" />
                </div>
              </div>
            </div>
          )}

          {/* Subtab Contents */}
          {activeTab === "route-history" && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Activity className="text-blue-700" /> Historical Route Replay</h2>
                  <p className="text-xs text-slate-400 mt-1">Select an officer and date to replay their GPS tracking history</p>
                </div>
                <div className="flex gap-4 items-center">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Officer</label>
                    <select
                      value={routeHistoryOfficerId}
                      onChange={(e) => setRouteHistoryOfficerId(e.target.value)}
                      className="px-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 min-w-[200px]"
                    >
                      <option value="">-- Select Officer --</option>
                      {/* Historical Route Replay is for PAST days, so this must list every
                          trackable officer, not just activeLocations (officers currently
                          mid-shift and pinging right now) - that emptied the dropdown
                          whenever nobody happened to be live at the moment an admin opened
                          this screen, even though plenty of past-day GPS history existed. */}
                      {usersList
                        .filter((u: any) => ["field_officer", "sales_officer", "manager"].includes(u.role))
                        .map((u: any) => (
                          <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                        ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Date</label>
                    <input 
                      type="date"
                      value={routeHistoryDate}
                      onChange={(e) => setRouteHistoryDate(e.target.value)}
                      className="px-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
                    />
                  </div>
                </div>
              </div>
              
              {routeHistoryOfficerId ? (
                <RouteReplay officer_id={routeHistoryOfficerId} date={routeHistoryDate || ""} />
              ) : (
                <div className="w-full h-[400px] flex items-center justify-center bg-slate-50 rounded-xl border border-slate-200 border-dashed text-slate-400">
                  Please select an officer to view their route history.
                </div>
              )}
            </div>
          )}

          {/* Overview — dashboard-home landing screen (Section 3/26). Brown/
              beige palette scoped to just this screen, per explicit request;
              the rest of the app's green identity is untouched. Every
              number here is real data already held in this component's
              state - nothing invented, nothing decorative. */}
          {activeTab === "overview" && (
            <div className="max-w-3xl mx-auto space-y-5">
              {user?.role === "admin" || user?.role === "manager" ? (
                <>
                  <div className="rounded-2xl overflow-hidden shadow-sm border border-slate-100">
                    <div className="bg-primary-700 text-white px-6 pt-6 pb-10">
                      <p className="text-xs font-semibold uppercase tracking-wider text-primary-100">
                        {user?.role === "admin" ? "Admin" : "Regional Manager"}
                      </p>
                      <h2 className="text-2xl font-bold mt-1">Organization overview</h2>
                    </div>
                    <div className="bg-slate-50 px-6 -mt-6 pb-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                          <p className="text-xs text-slate-500 font-medium">Outstanding</p>
                          <p className="text-2xl font-bold text-red-600 mt-1">
                            ₹{totalOutstanding >= 100000 ? `${(totalOutstanding / 100000).toFixed(1)}L` : totalOutstanding.toLocaleString()}
                          </p>
                        </div>
                        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                          <p className="text-xs text-slate-500 font-medium">Active Officers</p>
                          <p className="text-2xl font-bold text-primary-700 mt-1">{activeCount}/{totalOfficersCount}</p>
                        </div>
                      </div>

                      <button
                        onClick={() => setActiveTab("map")}
                        className="w-full mt-4 flex items-center justify-center gap-2 py-3 bg-white border-2 border-primary-700 text-primary-700 font-bold rounded-xl hover:bg-white transition"
                      >
                        <MapPin className="w-4 h-4" /> Live officer tracking
                      </button>
                    </div>
                  </div>

                  {(lowStockDealersCount > 0 || pendingIssuesCount > 0 || pendingLeaveCount > 0 || pendingPlansCount > 0 || overdueDealerCount > 0) && (
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                      <h3 className="text-sm font-bold text-primary-700 mb-3">Needs attention</h3>
                      <div className="space-y-2 text-sm">
                        {overdueDealerCount > 0 && (
                          <div className="flex justify-between items-center py-1.5">
                            <span className="text-slate-600">Dealers with overdue payments</span>
                            <span className="font-bold text-red-600">{overdueDealerCount}</span>
                          </div>
                        )}
                        {lowStockDealersCount > 0 && (
                          <div className="flex justify-between items-center py-1.5 border-t border-slate-100">
                            <span className="text-slate-600">Dealers with low stock</span>
                            <span className="font-bold text-red-600">{lowStockDealersCount}</span>
                          </div>
                        )}
                        {pendingIssuesCount > 0 && (
                          <div className="flex justify-between items-center py-1.5 border-t border-slate-100">
                            <span className="text-slate-600">Crop disease issues pending</span>
                            <span className="font-bold text-amber-600">{pendingIssuesCount}</span>
                          </div>
                        )}
                        {pendingLeaveCount > 0 && (
                          <div className="flex justify-between items-center py-1.5 border-t border-slate-100">
                            <span className="text-slate-600">Leave requests pending</span>
                            <span className="font-bold text-amber-600">{pendingLeaveCount}</span>
                          </div>
                        )}
                        {pendingPlansCount > 0 && (
                          <div className="flex justify-between items-center py-1.5 border-t border-slate-100">
                            <span className="text-slate-600">Weekly plans pending approval</span>
                            <span className="font-bold text-amber-600">{pendingPlansCount}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {user?.role === "admin" && (
                    <div>
                      <h3 className="text-sm font-bold text-primary-700 mb-3 px-1">Manage</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <button onClick={() => setActiveTab("users")} className="bg-white rounded-xl border border-slate-100 p-5 text-center hover:shadow-md transition">
                          <Users className="w-6 h-6 mx-auto text-primary-700" />
                          <p className="text-sm font-semibold text-slate-700 mt-2">Users</p>
                        </button>
                        <button onClick={() => router.push("/dashboard/products")} className="bg-white rounded-xl border border-slate-100 p-5 text-center hover:shadow-md transition">
                          <ShoppingCart className="w-6 h-6 mx-auto text-primary-700" />
                          <p className="text-sm font-semibold text-slate-700 mt-2">Products</p>
                        </button>
                        <button onClick={() => router.push("/dashboard/field-network")} className="bg-white rounded-xl border border-slate-100 p-5 text-center hover:shadow-md transition">
                          <Award className="w-6 h-6 mx-auto text-primary-700" />
                          <p className="text-sm font-semibold text-slate-700 mt-2">Dealers</p>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : user?.role === "sales_officer" ? (
                <>
                  <div className="bg-primary-700 text-white rounded-2xl px-6 py-6">
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary-100">Sales officer</p>
                    <h2 className="text-2xl font-bold mt-1">Namaste, {(user?.full_name || "").split(" ")[0]}</h2>
                  </div>

                  {overdueCollectionsCount > 0 && (
                    <button
                      onClick={() => router.push("/dashboard/field-network")}
                      className="w-full text-left bg-amber-50 border border-amber-200 rounded-2xl p-5 hover:shadow-sm transition"
                    >
                      <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Overdue collections</p>
                      <p className="text-3xl font-bold text-amber-700 mt-1">
                        ₹{totalOutstanding >= 100000 ? `${(totalOutstanding / 100000).toFixed(1)}L` : totalOutstanding.toLocaleString()}
                      </p>
                      <p className="text-xs text-amber-800 mt-1">{overdueDealerCount} dealer{overdueDealerCount === 1 ? "" : "s"} · tap to collect</p>
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                      <p className="text-xs text-slate-500 font-medium">Dealers</p>
                      <p className="text-2xl font-bold text-primary-700 mt-1">{dealers.length}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                      <p className="text-xs text-slate-500 font-medium">Low stock items</p>
                      <p className="text-2xl font-bold text-red-600 mt-1">{lowStockDealersCount}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => router.push("/dashboard/field-network")}
                    className="w-full py-3.5 bg-primary-700 text-white font-bold rounded-xl hover:bg-primary-800 transition"
                  >
                    Register dealer
                  </button>

                  <div>
                    <h3 className="text-sm font-bold text-primary-700 mb-3 px-1">Your tools</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <button onClick={() => router.push("/dashboard/field-network")} className="bg-white rounded-xl border border-slate-100 p-5 text-center hover:shadow-md transition">
                        <Award className="w-6 h-6 mx-auto text-primary-700" />
                        <p className="text-sm font-semibold text-slate-700 mt-2">Dealers</p>
                      </button>
                      {/* Collections legitimately lives on the dealer page -
                          outstanding balances are per-dealer. Left pointing
                          there deliberately rather than inventing a route:
                          there is no separate collections tab, and a tile
                          that goes nowhere is worse than one that shares a
                          destination for a real reason. */}
                      <button onClick={() => router.push("/dashboard/field-network?view=collections")} className="bg-white rounded-xl border border-slate-100 p-5 text-center hover:shadow-md transition">
                        <FileText className="w-6 h-6 mx-auto text-primary-700" />
                        <p className="text-sm font-semibold text-slate-700 mt-2">Collections</p>
                      </button>
                      {/* Was pushing to /dashboard/field-network, the same
                          destination as Dealers, Collections and the
                          Register-dealer button - four different tiles
                          all landing on one page. Stock is its own
                          concern and now has its own route. */}
                      <button onClick={() => router.push("/dashboard/my-stock")} className="bg-white rounded-xl border border-slate-100 p-5 text-center hover:shadow-md transition">
                        <ClipboardList className="w-6 h-6 mx-auto text-primary-700" />
                        <p className="text-sm font-semibold text-slate-700 mt-2">My stock</p>
                      </button>
                      {/* Sales Officers had NO check-in control at all: the
                          tile below existed only in the Field Officer
                          branch, and the amber banner only appears after
                          09:00. Without checking in, an SO never sends
                          location pings, so they can never appear under
                          "Active Officers" - which is the direct cause of
                          that count reading 0. */}
                      <button
                        onClick={() => { if (!myTodayAttendance) handleWebCheckIn(); }}
                        disabled={!!myTodayAttendance || isCheckingIn}
                        className="bg-white rounded-xl border border-slate-100 p-5 text-center hover:shadow-md transition disabled:opacity-60"
                      >
                        <Activity className="w-6 h-6 mx-auto text-primary-700" />
                        <p className="text-sm font-semibold text-slate-700 mt-2">
                          {myTodayAttendance ? "Checked In" : isCheckingIn ? "Checking In..." : "Check In"}
                        </p>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-primary-700 text-white rounded-2xl px-6 py-6">
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary-100">Field officer</p>
                    <h2 className="text-2xl font-bold mt-1">Namaste, {(user?.full_name || "").split(" ")[0]}</h2>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                      <p className="text-xs text-slate-500 font-medium">My tasks</p>
                      <p className="text-2xl font-bold text-primary-700 mt-1">{myOpenTasksCount}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                      <p className="text-xs text-slate-500 font-medium">Today&apos;s attendance</p>
                      <p className="text-lg font-bold text-primary-700 mt-1.5">{myTodayAttendance ? "Checked in" : "Not checked in"}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => router.push("/dashboard/field-network")}
                    className="w-full py-3.5 bg-primary-700 text-white font-bold rounded-xl hover:bg-primary-800 transition"
                  >
                    New visit
                  </button>

                  <div>
                    <h3 className="text-sm font-bold text-primary-700 mb-3 px-1">Your tools</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <button onClick={() => router.push("/dashboard/field-network")} className="bg-white rounded-xl border border-slate-100 p-5 text-center hover:shadow-md transition">
                        <Users className="w-6 h-6 mx-auto text-primary-700" />
                        <p className="text-sm font-semibold text-slate-700 mt-2">Farmers</p>
                      </button>
                      <button onClick={() => setActiveTab("plans")} className="bg-white rounded-xl border border-slate-100 p-5 text-center hover:shadow-md transition">
                        <ClipboardList className="w-6 h-6 mx-auto text-primary-700" />
                        <p className="text-sm font-semibold text-slate-700 mt-2">Weekly plan</p>
                      </button>
                      <button
                        onClick={() => { if (!myTodayAttendance) handleWebCheckIn(); }}
                        disabled={!!myTodayAttendance || isCheckingIn}
                        className="bg-white rounded-xl border border-slate-100 p-5 text-center hover:shadow-md transition disabled:opacity-60"
                      >
                        <Activity className="w-6 h-6 mx-auto text-primary-700" />
                        <p className="text-sm font-semibold text-slate-700 mt-2">
                          {myTodayAttendance ? "Checked In" : isCheckingIn ? "Checking In..." : "Check In"}
                        </p>
                      </button>
                      <button onClick={() => setActiveTab("productivity")} className="bg-white rounded-xl border border-slate-100 p-5 text-center hover:shadow-md transition">
                        <TrendingUp className="w-6 h-6 mx-auto text-primary-700" />
                        <p className="text-sm font-semibold text-slate-700 mt-2">My KPIs</p>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "map" && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><MapPin className="text-green-700" /> Live Field Force Tracking Map</h2>
                  <p className="text-xs text-slate-400 mt-1">
                    {lastSyncedAt
                      ? `Synced ${formatSyncedAgo(lastSyncedAt, nowTick)} · auto-refreshes every 30s`
                      : "Syncing…"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <select 
                    value={filterDistrict} 
                    onChange={(e) => setFilterDistrict(e.target.value)}
                    className="px-3 py-1.5 text-sm bg-slate-100 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                  >
                    <option value="All">All Districts</option>
                    <option value="Salem">Salem</option>
                    <option value="Namakkal">Namakkal</option>
                    <option value="Erode">Erode</option>
                    <option value="Coimbatore">Coimbatore</option>
                  </select>
                  <button 
                    onClick={handleManualRefreshMap}
                    disabled={isRefreshingMap}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-700 hover:bg-green-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition"
                  >
                    <RefreshCw className={`w-4 h-4 ${isRefreshingMap ? "animate-spin" : ""}`} />
                    {isRefreshingMap ? "Refreshing…" : "Refresh Map"}
                  </button>
                </div>
              </div>

              {/* Retry-able error banner */}
              {dataLoadError && (
                <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>{dataLoadError}</span>
                  </div>
                  <button
                    onClick={handleManualRefreshMap}
                    disabled={isRefreshingMap}
                    className="flex-shrink-0 px-3 py-1 text-xs font-semibold bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg transition"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Map Canvas */}
              <div className="relative h-[480px] rounded-xl overflow-hidden shadow-inner border border-slate-300">
                {isLoadingActiveLocations && activeLocations.length === 0 ? (
                  <div className="absolute inset-0 bg-slate-100 animate-pulse flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <MapPin className="w-8 h-8 animate-bounce" />
                      <span className="text-sm font-medium">Loading live map…</span>
                    </div>
                  </div>
                ) : (
                <MapComponent
                  officers={getLiveOfficers()}
                  dealers={dealers.map(d => ({
                    ...d,
                    lat: d.location_lat ?? null,
                    lng: d.location_lng ?? null,
                    contact: d.contact || d.contact_person || "N/A",
                    stockLevel: d.stockLevel || (d.stock_qty < 10 ? "low" : "normal")
                  }))}
                  farmers={farmers.map(f => ({
                    ...f,
                    lat: f.location_lat ?? null,
                    lng: f.location_lng ?? null
                  }))}
                  selectedMarker={selectedMarker}
                  onMarkerClick={(marker) => setSelectedMarker(marker)}
                  filterDistrict={filterDistrict}
                />
                )}

                {/* Selected Marker Detail Card */}
                {selectedMarker && (
                  <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-md p-4 rounded-xl shadow-lg border border-slate-200 w-72 z-30 space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-slate-800 text-sm">{selectedMarker.name || selectedMarker.full_name}</h4>
                        <span className="text-[10px] text-slate-400 capitalize">{selectedMarker.type} Details</span>
                      </div>
                      <button 
                        onClick={() => setSelectedMarker(null)} 
                        className="text-slate-400 hover:text-slate-600 text-xs font-bold font-mono"
                      >
                        ✕
                      </button>
                    </div>
                    
                    <div className="text-xs text-slate-600 space-y-1">
                      {selectedMarker.type === "officer" && (
                        <>
                          <p><strong>District:</strong> {selectedMarker.district}</p>
                          <p><strong>Speed:</strong> {selectedMarker.speed !== null ? `${selectedMarker.speed} km/h` : "N/A"}</p>
                          <p><strong>Battery:</strong> {selectedMarker.battery !== null ? `${selectedMarker.battery}%` : "N/A"}</p>
                          <p><strong>Last Logged Spot:</strong> {selectedMarker.lastVisit}</p>
                          <p>
                            <strong>Checked in today:</strong>{" "}
                            {selectedMarker.loginTime
                              ? `${new Date(selectedMarker.loginTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${
                                  selectedMarker.loginLat && selectedMarker.loginLng
                                    ? ` at ${selectedMarker.loginLat.toFixed(4)}, ${selectedMarker.loginLng.toFixed(4)}`
                                    : ""
                                }`
                              : "Not checked in yet today"}
                          </p>
                        </>
                      )}
                      {selectedMarker.type === "dealer" && (
                        <>
                          <p><strong>Contact:</strong> {selectedMarker.contact}</p>
                          <p><strong>District:</strong> {selectedMarker.district}</p>
                          <p><strong>Stock Status:</strong> <span className={selectedMarker.stockLevel === "low" ? "text-red-500 font-bold" : "text-green-600 font-bold"}>{selectedMarker.stockLevel?.toUpperCase()}</span></p>
                        </>
                      )}
                      {selectedMarker.type === "farmer" && (
                        <>
                          <p><strong>Crop:</strong> {selectedMarker.crop}</p>
                          <p><strong>Centage:</strong> {selectedMarker.cents} Cents</p>
                          <p><strong>District:</strong> {selectedMarker.district}</p>
                        </>
                      )}
                    </div>
                    
                    {selectedMarker.lat && selectedMarker.lng ? (
                      <button
                        onClick={() => {
                          window.open(
                            `https://www.google.com/maps/dir/?api=1&destination=${selectedMarker.lat},${selectedMarker.lng}`,
                            "_blank"
                          );
                        }}
                        className="w-full text-center py-2 bg-green-700 hover:bg-green-800 text-white font-semibold text-xs rounded-lg transition shadow-sm border-0"
                      >
                        Navigate via Google Maps
                      </button>
                    ) : (
                      <p className="w-full text-center py-2 bg-slate-100 text-slate-400 font-semibold text-xs rounded-lg">
                        No location data yet — can&apos;t navigate
                      </p>
                    )}
                  </div>
                )}

                <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur px-3 py-2 rounded-lg text-xs border border-slate-200 text-slate-600 flex flex-col gap-1 z-20">
                  <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-green-500 rounded-full" /> Sales Officer (Active)</div>
                  <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-blue-600 rounded animate-none" /> Dealer Outlet</div>
                  <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-amber-500 rounded-full" /> Registered Farmer</div>
                </div>
              </div>

              {/* Live Status Listing */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-6 py-3 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Officer Roster ({liveOfficers.length})
                  </h3>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Active</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Stale (&gt;10 min)</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300" /> Never reported</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase">
                      <th className="px-6 py-4">Officer Name</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Live Coordinates</th>
                      <th className="px-6 py-4">Check-in Location (Today)</th>
                      <th className="px-6 py-4">Speed</th>
                      <th className="px-6 py-4">Battery</th>
                      <th className="px-6 py-4">Last Logged Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
                    {isLoadingActiveLocations && liveOfficers.length === 0 && (
                      Array.from({ length: 4 }).map((_, i) => (
                        <tr key={`skeleton-${i}`} className="animate-pulse">
                          {Array.from({ length: 7 }).map((__, j) => (
                            <td key={j} className="px-6 py-4">
                              <div className="h-3 bg-slate-100 rounded w-3/4" />
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                    {!isLoadingActiveLocations && liveOfficers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-10 text-center text-slate-400 text-sm">
                          No field or sales officers found.
                        </td>
                      </tr>
                    )}
                    {paginatedOfficers.map(o => (
                      <tr 
                        key={o.id} 
                        onClick={() => setSelectedMarker({ ...o, type: "officer" })}
                        className="hover:bg-slate-100/70 cursor-pointer transition"
                      >
                        <td className="px-6 py-4 font-bold text-slate-800">
                          {o.name}
                          <div className="text-[10px] font-normal text-slate-400">{o.role}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            o.status === "Active"
                              ? "bg-green-100 text-green-800"
                              : o.status === "Stale"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-600"
                          }`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-mono text-xs">
                          {o.lat !== null && o.lng !== null ? `${Number(o.lat).toFixed(4)}, ${Number(o.lng).toFixed(4)}` : "No GPS logs"}
                        </td>
                        <td className="px-6 py-4 font-mono text-xs">
                          {o.loginLat !== null && o.loginLng !== null
                            ? `${Number(o.loginLat).toFixed(4)}, ${Number(o.loginLng).toFixed(4)}`
                            : "Not checked in"}
                        </td>
                        <td className="px-6 py-4">{o.speed !== null ? `${o.speed} km/h` : "-"}</td>
                        <td className="px-6 py-4">
                          {o.battery !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="w-12 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                <div className={`h-full ${o.battery < 20 ? "bg-red-500" : "bg-green-500"}`} style={{ width: `${o.battery}%` }} />
                              </div>
                              <span>{o.battery}%</span>
                            </div>
                          ) : (
                            <span>-</span>
                          )}
                        </td>
                        <td className={`px-6 py-4 ${!o.everReported ? "text-slate-400 italic" : ""}`}>{o.lastVisit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>

                {/* Pagination — only needed once the roster is large */}
                {liveOfficers.length > OFFICER_PAGE_SIZE && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-6 py-3 border-t border-slate-100 text-xs text-slate-500">
                    <span>
                      Showing {(officerTablePage - 1) * OFFICER_PAGE_SIZE + 1}
                      –{Math.min(officerTablePage * OFFICER_PAGE_SIZE, liveOfficers.length)} of {liveOfficers.length}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setOfficerTablePage(p => Math.max(1, p - 1))}
                        disabled={officerTablePage === 1}
                        className="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setOfficerTablePage(p => Math.min(totalOfficerPages, p + 1))}
                        disabled={officerTablePage >= totalOfficerPages}
                        className="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* District Coverage Summary — quick "meaningful" overview beyond raw pins */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-white rounded-xl shadow-sm border border-slate-100">
                  <span className="text-xs text-slate-400 uppercase font-semibold">Never Reported Today</span>
                  <span className="block text-2xl font-bold text-slate-700 mt-1">
                    {liveOfficers.filter(o => !o.everReported).length} Officers
                  </span>
                  <p className="text-[11px] text-slate-400 mt-1">Haven&apos;t sent a single GPS ping today — may not have opened the app.</p>
                </div>
                <div className="p-4 bg-white rounded-xl shadow-sm border border-slate-100">
                  <span className="text-xs text-slate-400 uppercase font-semibold">Stale (&gt;10 min)</span>
                  <span className="block text-2xl font-bold text-amber-600 mt-1">
                    {liveOfficers.filter(o => o.status === "Stale").length} Officers
                  </span>
                  <p className="text-[11px] text-slate-400 mt-1">Were pinging, but the last update is over 10 minutes old.</p>
                </div>
                <div className="p-4 bg-white rounded-xl shadow-sm border border-slate-100">
                  <span className="text-xs text-slate-400 uppercase font-semibold">Checked In, Not Yet Live</span>
                  <span className="block text-2xl font-bold text-blue-600 mt-1">
                    {liveOfficers.filter(o => o.loginLat !== null && !o.hasTelemetry).length} Officers
                  </span>
                  <p className="text-[11px] text-slate-400 mt-1">Logged attendance today but no live GPS ping has arrived yet.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "attendance" && (
            <div className="space-y-6">
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                <h2 className="text-lg font-bold text-slate-800">Attendance Monitoring Grid</h2>
                <div className="flex flex-wrap gap-2">
                  <input 
                    type="date" 
                    value={attendanceDate} 
                    onChange={(e) => setAttendanceDate(e.target.value)}
                    className="px-3 py-1.5 text-sm bg-slate-100 border border-slate-200 rounded-lg text-slate-700 focus:outline-none bg-white" 
                  />
                  <button 
                    onClick={() => {
                      downloadAuthenticatedFile(`${API_BASE_URL}/reports/attendance/pdf?date_val=${attendanceDate}`, `attendance-${attendanceDate}.pdf`).catch((e) => alert(e.message));
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-700 text-white font-medium rounded-lg hover:bg-green-800 transition"
                  >
                    <Download className="w-4 h-4" /> Export PDF
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase">
                      <th className="px-6 py-4">Officer Name</th>
                      <th className="px-6 py-4">Clock-In</th>
                      <th className="px-6 py-4">Clock-Out</th>
                      <th className="px-6 py-4">GPS Authenticity</th>
                      <th className="px-6 py-4">Device UUID</th>
                      <th className="px-6 py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
                    {loadingAttendance ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-slate-400">Loading attendance data...</td>
                      </tr>
                    ) : attendanceRecords.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-slate-400">No attendance logs found for this date.</td>
                      </tr>
                    ) : (
                      attendanceRecords.map(r => {
                        const isFlagged = r.is_fake_gps;
                        const hasCheckedOut = !!r.check_out_time;
                        let statusText = "Active Shift";
                        let statusColor = "bg-amber-100 text-amber-800";
                        if (isFlagged) {
                          statusText = "Flagged";
                          statusColor = "bg-red-100 text-red-800";
                        } else if (hasCheckedOut) {
                          statusText = "Completed";
                          statusColor = "bg-green-100 text-green-800";
                        }
                        
                        const formatTime = (isoString: string | null) => {
                          if (!isoString) return "--:--";
                          try {
                            const d = new Date(isoString);
                            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                          } catch (e) {
                            return "--:--";
                          }
                        };

                        return (
                          <tr key={r.id} className={`${isFlagged ? "bg-red-50/50 hover:bg-red-50" : "hover:bg-slate-50/50"}`}>
                            <td className={`px-6 py-4 font-bold ${isFlagged ? "text-red-800" : "text-slate-800"}`}>
                              {r.user_name || "Unknown Officer"}
                            </td>
                            <td className="px-6 py-4">{formatTime(r.check_in_time)}</td>
                            <td className="px-6 py-4">{formatTime(r.check_out_time)}</td>
                            <td className="px-6 py-4">
                              {isFlagged ? (
                                <span className="text-red-600 flex items-center gap-1 font-bold">
                                  <AlertTriangle className="w-4 h-4" /> FAILED (Mock GPS Detected)
                                </span>
                              ) : (
                                <span className="text-green-600 flex items-center gap-1">
                                  <CheckCircle className="w-4 h-4" /> Passed (Mock Disabled)
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 font-mono text-xs">{r.check_in_device_id || "N/A"}</td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusColor}`}>
                                {statusText}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "tasks" && (() => {
            const renderTaskRow = (t: any) => (
              <div key={t.id} className="p-4 flex flex-col gap-3 bg-white">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm">{t.title}</span>
                      {t.is_overdue && t.status !== "done" && t.status !== "cancelled" && t.status !== "pending_review" && (
                        <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full font-semibold">Overdue</span>
                      )}
                      {t.related_type && (
                        <span className="px-2 py-0.5 text-[10px] bg-purple-100 text-purple-700 rounded-full font-semibold uppercase tracking-wider">
                          {t.related_type} {t.related_name ? `• ${t.related_name}` : ''}
                        </span>
                      )}
                    </div>
                    {t.description && <p className="text-xs text-slate-500 mt-1">{t.description}</p>}
                    <p className="text-xs text-slate-400 mt-1 flex items-center flex-wrap gap-x-2 gap-y-1">
                      {(user?.role === "admin" || user?.role === "manager") && <span>Assigned to {t.assigned_to_name} •</span>}
                      {t.assigned_by_name && <span>Assigned by {t.assigned_by_name} •</span>}
                      <span>Due {t.due_date}</span>
                      {t.status === "done" && t.completed_at && (
                        <span>• Completed {new Date(t.completed_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                      )}
                      {t.status === "pending_review" && (
                        <span>• Submitted, awaiting {t.assigned_by_name || "manager"}&apos;s review</span>
                      )}
                    </p>
                    {/* Rejected-back-to-in_progress: officer needs to see why */}
                    {t.status === "in_progress" && t.rejection_reason && (
                      <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1 mt-2">
                        <strong>Sent back:</strong> {t.rejection_reason}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      t.status === "done" ? "bg-green-100 text-green-700" :
                      t.status === "in_progress" ? "bg-blue-100 text-blue-700" :
                      t.status === "cancelled" ? "bg-slate-100 text-slate-500" :
                      t.status === "pending_review" ? "bg-amber-100 text-amber-700" :
                      "bg-amber-100 text-amber-700"
                    }`}>
                      {t.status === "pending_review" ? "Awaiting Approval" : t.status.replace("_", " ")}
                    </span>
                    {t.assigned_to === user?.id && t.status === "assigned" && (
                      <button onClick={() => handleUpdateTaskStatus(t.id, "in_progress")} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">
                        Start
                      </button>
                    )}
                    {t.assigned_to === user?.id && t.status === "in_progress" && submittingTaskId !== t.id && (
                      <button
                        onClick={() => { setSubmittingTaskId(t.id); setTaskProofFile(null); setTaskProofError(""); }}
                        className="px-3 py-1 text-xs bg-green-700 hover:bg-green-800 text-white rounded-lg font-semibold"
                      >
                        Submit for Review
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline proof-capture form - officer submitting this specific task */}
                {submittingTaskId === t.id && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                    <label className="block text-xs font-semibold text-slate-600">
                      {(t.related_type === "farmer" || t.related_type === "dealer")
                        ? "Proof photo (required)"
                        : "Proof photo (optional)"}
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={e => setTaskProofFile(e.target.files?.[0] || null)}
                      className="text-xs bg-slate-50 text-slate-900"
                    />
                    <p className="text-[11px] text-slate-400">Your current location will be attached automatically if you allow it.</p>
                    {taskProofError && <p className="text-xs text-red-600 font-semibold">{taskProofError}</p>}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleSubmitTaskForReview(t)}
                        disabled={taskProofUploading}
                        className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-800 disabled:bg-slate-300 text-white rounded-lg font-semibold"
                      >
                        {taskProofUploading ? "Submitting..." : "Submit"}
                      </button>
                      <button
                        onClick={() => { setSubmittingTaskId(null); setTaskProofFile(null); setTaskProofError(""); }}
                        className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Admin/manager review panel - shows the submitted proof */}
                {(user?.role === "admin" || user?.role === "manager") && t.status === "pending_review" && (
                  <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-3 justify-between">
                    <div className="flex items-center gap-3">
                      {t.proof_photo_url ? (
                        <a href={withFileToken(t.proof_photo_url)} target="_blank" rel="noopener noreferrer">
                          <img src={withFileToken(t.proof_photo_url)} alt="Submitted proof" className="w-14 h-14 object-cover rounded-lg border border-amber-200" />
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No photo attached</span>
                      )}
                      {t.proof_gps_lat && t.proof_gps_lng && (
                        <a
                          href={`https://www.google.com/maps?q=${t.proof_gps_lat},${t.proof_gps_lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline font-semibold"
                        >
                          View location on map
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleReviewTask(t.id, true)} className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-800 text-white rounded-lg font-semibold">
                        Approve
                      </button>
                      <button onClick={() => handleReviewTask(t.id, false)} className="px-3 py-1.5 text-xs bg-red-100 hover:bg-red-200 text-red-800 rounded-lg font-semibold">
                        Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );

            return (
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                  <h2 className="text-lg font-bold text-slate-800">
                    {user?.role === "admin" || user?.role === "manager" ? "Assign Tasks" : "My Tasks"}
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    {user?.role === "admin" || user?.role === "manager"
                      ? "Assign a job directly to an officer with a due date — separate from their own weekly plan."
                      : "Jobs assigned to you by an admin or manager. Update the status as you work through them."}
                  </p>
                </div>

                {(user?.role === "admin" || user?.role === "manager") && (
                  <form onSubmit={handleCreateTask} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Assign New Task</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Title</label>
                        <input
                          type="text"
                          value={newTaskTitle}
                          onChange={e => setNewTaskTitle(e.target.value)}
                          placeholder="e.g. Visit Vignesh Farm to follow up on order"
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Assign To</label>
                        <select
                          value={newTaskAssignedTo}
                          onChange={e => setNewTaskAssignedTo(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-900"
                        >
                          <option value="">-- Select Officer --</option>
                          {usersList
                            .filter((u: any) => ["field_officer", "sales_officer", "manager"].includes(u.role))
                            .map((u: any) => (
                              <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Due Date</label>
                        <input
                          type="date"
                          value={newTaskDueDate}
                          onChange={e => setNewTaskDueDate(e.target.value)}
                          min={todayIST()}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-900"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Description (optional)</label>
                      <textarea
                        value={newTaskDescription}
                        onChange={e => setNewTaskDescription(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-900"
                      />
                    </div>
                    {taskFormError && <p className="text-xs text-red-600 font-semibold">{taskFormError}</p>}
                    {taskFormSuccess && <p className="text-xs text-green-600 font-semibold">{taskFormSuccess}</p>}
                    <button type="submit" className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded-lg">
                      Assign Task
                    </button>
                  </form>
                )}

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <span className="text-xs text-slate-400 uppercase font-semibold">Assigned</span>
                    <span className="block text-2xl font-bold text-slate-800">{taskSummaries.assigned}</span>
                  </div>
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <span className="text-xs text-slate-400 uppercase font-semibold">In Progress</span>
                    <span className="block text-2xl font-bold text-blue-600">{taskSummaries.inProgress}</span>
                  </div>
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <span className="text-xs text-slate-400 uppercase font-semibold">Awaiting Approval</span>
                    <span className="block text-2xl font-bold text-amber-600">{taskSummaries.pendingReview}</span>
                  </div>
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <span className="text-xs text-slate-400 uppercase font-semibold">Done</span>
                    <span className="block text-2xl font-bold text-green-600">{taskSummaries.done}</span>
                  </div>
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <span className="text-xs text-slate-400 uppercase font-semibold">Overdue</span>
                    <span className="block text-2xl font-bold text-red-600">{taskSummaries.overdue}</span>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                  <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-slate-700">Task List</h3>
                    <div className="flex flex-col md:flex-row gap-2">
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input 
                          type="text"
                          placeholder="Search tasks..."
                          value={taskSearchQuery}
                          onChange={e => setTaskSearchQuery(e.target.value)}
                          className="pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg w-full md:w-48 bg-white text-slate-900 focus:outline-none focus:border-green-600"
                        />
                      </div>
                      <select
                        value={taskStatusFilter}
                        onChange={e => setTaskStatusFilter(e.target.value)}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-900 focus:outline-none focus:border-green-600"
                      >
                        <option value="All">All Statuses</option>
                        <option value="assigned">Assigned</option>
                        <option value="in_progress">In Progress</option>
                        <option value="pending_review">Awaiting Approval</option>
                        <option value="done">Done</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                  </div>
                  
                  <div className="bg-slate-50 p-2">
                    {groupedTasks.total === 0 ? (
                      <div className="p-8 text-center text-slate-400 bg-white rounded-lg border border-slate-100">
                        <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No tasks assigned yet.</p>
                      </div>
                    ) : groupedTasks.totalFiltered === 0 ? (
                      <div className="p-8 text-center text-slate-400 bg-white rounded-lg border border-slate-100">
                        <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No tasks match your search.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {groupedTasks.overdue.length > 0 && (
                          <details open className="group bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                            <summary className="p-3 bg-red-50/50 hover:bg-red-50 cursor-pointer flex items-center font-bold text-sm text-red-700 select-none border-b border-transparent group-open:border-slate-100">
                              <span className="flex-1">Overdue ({groupedTasks.overdue.length})</span>
                              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="divide-y divide-slate-100">
                              {groupedTasks.overdue.map(renderTaskRow)}
                            </div>
                          </details>
                        )}
                        
                        {groupedTasks.dueToday.length > 0 && (
                          <details open className="group bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                            <summary className="p-3 bg-slate-50 hover:bg-slate-100 cursor-pointer flex items-center font-bold text-sm text-slate-700 select-none border-b border-transparent group-open:border-slate-100">
                              <span className="flex-1">Due Today ({groupedTasks.dueToday.length})</span>
                              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="divide-y divide-slate-100">
                              {groupedTasks.dueToday.map(renderTaskRow)}
                            </div>
                          </details>
                        )}

                        {groupedTasks.upcoming.length > 0 && (
                          <details open className="group bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                            <summary className="p-3 bg-slate-50 hover:bg-slate-100 cursor-pointer flex items-center font-bold text-sm text-slate-700 select-none border-b border-transparent group-open:border-slate-100">
                              <span className="flex-1">Upcoming ({groupedTasks.upcoming.length})</span>
                              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="divide-y divide-slate-100">
                              {groupedTasks.upcoming.map(renderTaskRow)}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {activeTab === "productivity" && (
            <div className="space-y-6">
              {user?.role === "admin" ? (
                <AdminProductivity organizationData={mappedProductivityTeam} alerts={[]} />
              ) : user?.role === "manager" ? (
                <ManagerProductivity teamData={mappedProductivityTeam} alerts={[]} />
              ) : (
                <OfficerProductivity />
              )}
            </div>
          )}

          {(activeTab === "momentum" || activeTab === "productivity") && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-slate-800">Momentum & Milestones</h1>
                  <p className="text-slate-500 mt-1">
                    {(user?.role === "admin" || user?.role === "manager")
                      ? "How the business is doing, and how every officer is performing."
                      : "Track your progress and celebrate team achievements."}
                  </p>
                </div>
              </div>

              {(user?.role === "field_officer" || user?.role === "sales_officer") ? (
                <MomentumWidget momentumData={momentumData} />
              ) : (user?.role === "admin" || user?.role === "manager") ? (
                // Admin and manager get the business view: money, products,
                // territories, seasons, and a ranked officer list.
                //
                // The officers' own momentum view is deliberately NOT this. Its
                // code says "personal trend only, never a ranking" and it means
                // it - an officer who is behind is told they are building, not
                // that they are last. The two readers want opposite things from
                // the same month, so they get different screens rather than one
                // screen that serves neither.
                <>
                  <ManagementDashboard />
                  <details className="bg-white rounded-xl border border-slate-200">
                    <summary className="cursor-pointer px-6 py-4 text-lg font-semibold text-slate-700">
                      Team momentum and badges
                    </summary>
                    <div className="px-6 pb-6">
                      <TeamMomentumCard teamData={teamMomentumOverview} officersList={usersList} />
                    </div>
                  </details>
                </>
              ) : (
                <TeamMomentumCard teamData={teamMomentumOverview} officersList={usersList} />
              )}
            </div>
          )}

          {activeTab === "plans" && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Weekly Plans & Schedule</h2>
                  <p className="text-xs text-slate-400 mt-1">Submit, view, and approve operational field force plans.</p>
                </div>
                <div className="flex gap-2">
                  {user?.role === "admin" && (
                    <span className="px-3 py-1 bg-amber-100 text-amber-800 font-bold rounded-lg text-sm flex items-center gap-1">
                      <ClipboardList className="w-4 h-4" /> {pendingPlansCount} Pending Approval
                    </span>
                  )}
                  {user?.role !== "admin" && (
                    <button
                      onClick={() => setShowPlanForm((v) => !v)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-green-700 hover:bg-green-800 text-white font-bold rounded-lg text-sm transition"
                    >
                      <Plus className="w-4 h-4" /> {showPlanForm ? "Cancel" : "Submit Weekly Plan"}
                    </button>
                  )}
                </div>
              </div>

              {/* Submit Plan Form (Non-Admins only) - collapsed behind the
                  button above; previously always rendered, pushing the
                  existing plans list down every time this tab opened. */}
              {user?.role !== "admin" && showPlanForm && (
                <form 
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setPlanError("");
                    setPlanSuccess("");
                    if (!planWeek || !planDate) {
                      setPlanError("Week Start Date and Activity Date are required.");
                      return;
                    }
                    try {
                      const payload = {
                        week_start_date: planWeek,
                        activities: [{
                          date: planDate,
                          territory_id: "00000000-0000-0000-0000-000000000000", // system default territory
                          activity_type: planType,
                          planned_villages: planVillages.split(",").map(v => v.trim()).filter(Boolean),
                          planned_dealers: planDealers.split(",").map(d => d.trim()).filter(Boolean),
                          description: planDescription
                        }]
                      };
                      await apiFetch("/plans/submit", {
                        method: "POST",
                        body: JSON.stringify(payload)
                      });
                      setPlanSuccess("Weekly plan submitted successfully!");
                      setPlanWeek("");
                      setPlanDate("");
                      setPlanDescription("");
                      setPlanVillages("");
                      setPlanDealers("");
                      setShowPlanForm(false);
                      fetchDashboardData();
                    } catch (err: any) {
                      setPlanError(err.message || "Failed to submit plan.");
                    }
                  }}
                  className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4"
                >
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Submit New Weekly Plan</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Week Start Date</label>
                      <input 
                        type="date" 
                        value={planWeek}
                        onChange={(e) => setPlanWeek(e.target.value)}
                        min={weekStartIST()}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Activity Date</label>
                      <input 
                        type="date" 
                        value={planDate}
                        onChange={(e) => setPlanDate(e.target.value)}
                        min={weekStartIST()}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Activity Type</label>
                      <select 
                        value={planType}
                        onChange={(e) => setPlanType(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                      >
                        <option value="farmer_visit">Farmer Visit</option>
                        <option value="dealer_visit">Dealer Stock Audit</option>
                        <option value="demo">Product Demonstration</option>
                        <option value="other">Other Operations</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Target Villages (Comma-separated)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Mallasamudram, Vennandur"
                        value={planVillages}
                        onChange={(e) => setPlanVillages(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Target Dealers (Comma-separated)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Subbu Agencies, Kovai Agro"
                        value={planDealers}
                        onChange={(e) => setPlanDealers(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Activity Description</label>
                    <textarea 
                      rows={2}
                      placeholder="Enter activity description..."
                      value={planDescription}
                      onChange={(e) => setPlanDescription(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                    />
                  </div>

                  {planSuccess && <p className="text-xs font-bold text-green-700">{planSuccess}</p>}
                  {planError && <p className="text-xs font-bold text-red-600">{planError}</p>}

                  <button 
                    type="submit"
                    className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white font-semibold text-sm rounded-lg transition"
                  >
                    Submit Weekly Plan
                  </button>
                </form>
              )}
              {planSuccess && !showPlanForm && (
                <p className="text-xs font-bold text-green-700">{planSuccess}</p>
              )}

              {/* Plans List */}
              <div className="grid grid-cols-1 gap-4">
                {plans.length === 0 ? (
                  <p className="text-slate-400 text-sm text-center bg-white p-8 rounded-xl border border-slate-100">No weekly plans found.</p>
                ) : (
                  plans.map(p => {
                    const officerName = p.officerName || (usersList.find(u => u.id === p.user_id)?.full_name) || "Field Staff";
                    const officerRole = p.role || (usersList.find(u => u.id === p.user_id)?.role) || "field_officer";
                    const formattedRole = officerRole.replace("_", " ").toUpperCase();
                    const week = p.week_start_date || p.week;

                    // Parse activities details safely
                    const targetVillagesList: string[] = p.activities?.flatMap((a: any) => a.planned_villages || []) || p.targetVillages || [];
                    const targetDealersList: string[] = p.activities?.flatMap((a: any) => a.planned_dealers || []) || p.targetDealers || [];

                    return (
                      <div key={p.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-800 text-base">{officerName}</span>
                            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold tracking-wider">{formattedRole}</span>
                            <span className="text-slate-400 text-xs font-medium">Week Starting: {week}</span>
                            <span className={`ml-auto px-2 py-0.5 text-xs font-bold rounded-full uppercase ${
                              p.status === "approved" ? "bg-green-100 text-green-800" :
                              p.status === "rejected" || p.status === "disapproved" ? "bg-red-100 text-red-800" :
                              p.status === "pending" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-800"
                            }`}>
                              {p.status === "rejected" ? "disapproved" : p.status}
                            </span>
                          </div>
                          
                          <div className="text-xs text-slate-600 space-y-1">
                            <div><strong className="text-slate-700">Planned Villages:</strong> {targetVillagesList.join(", ") || "None"}</div>
                            <div><strong className="text-slate-700">Target Dealers:</strong> {targetDealersList.join(", ") || "None"}</div>
                            {p.manager_comment && (
                              <div className="mt-2 p-2 bg-slate-50 border border-slate-100 rounded text-slate-500 italic text-[11px]">
                                <strong>Manager Comment:</strong> &quot;{p.manager_comment}&quot;
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Admin Action Bar */}
                        {user?.role === "admin" && p.status === "pending" && (
                          <div className="border-t border-slate-100 pt-4 flex flex-col gap-2">
                            {disapprovingPlanId === p.id ? (
                              <div className="space-y-2">
                                <label className="block text-xs font-semibold text-slate-600">Enter Disapproval Comments / Revision Notes (Required)</label>
                                <textarea
                                  rows={2}
                                  value={disapprovalNotes}
                                  onChange={(e) => setDisapprovalNotes(e.target.value)}
                                  placeholder="Type revision notes or replacement instructions..."
                                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                                />
                                <div className="flex gap-2 justify-end">
                                  <button
                                    onClick={() => {
                                      setDisapprovingPlanId(null);
                                      setDisapprovalNotes("");
                                    }}
                                    className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    disabled={!disapprovalNotes.trim()}
                                    onClick={async () => {
                                      await handleApprovePlan(p.id, false, disapprovalNotes);
                                      setDisapprovingPlanId(null);
                                      setDisapprovalNotes("");
                                    }}
                                    className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-lg transition"
                                  >
                                    Confirm Disapprove
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex gap-2 justify-end">
                                <button 
                                  onClick={() => setDisapprovingPlanId(p.id)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-800 font-semibold rounded-lg hover:bg-red-200 transition text-xs"
                                >
                                  <XCircle className="w-3.5 h-3.5" /> Disapprove
                                </button>
                                <button 
                                  onClick={() => handleApprovePlan(p.id, true)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 text-white font-semibold rounded-lg hover:bg-green-800 transition text-xs shadow-sm"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" /> Approve & Lock
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === "issues" && user?.role !== "sales_officer" && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <MessageSquare className="text-green-700" /> Crop Disease Reporting (WhatsApp Experts Queue)
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">Disease cases dispatched to regional crop specialists based on coordinates and district assignments.</p>
                </div>
                <div className="flex gap-2">
                  <span className="px-3 py-1 bg-amber-100 text-amber-800 font-bold rounded-lg text-sm flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> {pendingIssuesCount} Pending Resolution
                  </span>
                  {user?.role !== "admin" && (
                    <button
                      onClick={() => setShowIssueForm((v) => !v)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-green-700 hover:bg-green-800 text-white font-bold rounded-lg text-sm transition"
                    >
                      <Plus className="w-4 h-4" /> {showIssueForm ? "Cancel" : "Report Crop Issue"}
                    </button>
                  )}
                </div>
              </div>

              {/* Report New Crop Issue Form (Non-Admins only) - collapsed
                  behind the button above; previously always rendered. */}
              {user?.role !== "admin" && showIssueForm && (
                <form 
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setIssueError("");
                    setIssueSuccess("");
                    if (!reportFarmerId || !reportCrop || !reportDistrict || !reportSymptoms) {
                      setIssueError("Farmer, Crop, District, and Symptoms are required.");
                      return;
                    }
                    try {
                      const payload: any = {
                        farmer_id: reportFarmerId,
                        crop: reportCrop,
                        district: reportDistrict,
                        symptoms: reportSymptoms,
                      };
                      if (reportImageUrl) payload.image_url = reportImageUrl;
                      await apiFetch("/issues/", {
                        method: "POST",
                        body: JSON.stringify(payload)
                      });
                      setIssueSuccess("Crop issue logged and dispatched successfully!");
                      setReportFarmerId("");
                      setReportCrop("");
                      setReportDistrict("");
                      setReportSymptoms("");
                      setReportImageUrl("");
                      setPreviewUrl("");
                      setShowIssueForm(false);
                      fetchDashboardData();
                    } catch (err: any) {
                      setIssueError(err.message || "Failed to report crop issue.");
                    }
                  }}
                  className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4"
                >
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Report Crop Issue</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Select Farmer</label>
                      <select 
                        value={reportFarmerId}
                        onChange={(e) => setReportFarmerId(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none bg-white"
                      >
                        <option value="">-- Select Farmer --</option>
                        {farmers.map(f => (
                          <option key={f.id} value={f.id}>{f.name} ({f.village})</option>
                        ))}
                      </select>
                      {farmers.length === 0 && (
                        <p className="text-[10px] text-amber-600 mt-1">
                          No registered farmers found. Register a new farmer first under the <strong>Farmers Registry</strong> tab.
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Crop Type</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Paddy, Cotton"
                        value={reportCrop}
                        onChange={(e) => setReportCrop(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">District</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Salem, Namakkal"
                        value={reportDistrict}
                        onChange={(e) => setReportDistrict(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Disease Symptoms / Diagnostic Notes</label>
                    <textarea 
                      rows={3}
                      placeholder="Describe leaf spots, color decay, insect infestation symptoms in detail..."
                      value={reportSymptoms}
                      onChange={(e) => setReportSymptoms(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-500">Capture Crop Disease Photo</label>
                    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment" 
                        onChange={handleImageUpload}
                        disabled={isUploading}
                        className="text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100 cursor-pointer"
                      />
                      {isUploading && <span className="text-xs text-slate-400">Uploading photo...</span>}
                    </div>
                    {previewUrl && (
                      <div className="relative w-24 h-24 mt-2 border border-slate-200 rounded-lg overflow-hidden bg-slate-50 flex items-center justify-center">
                        <img src={previewUrl} alt="Crop preview" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => {
                            setPreviewUrl("");
                            setReportImageUrl("");
                          }}
                          className="absolute top-1 right-1 bg-red-600 hover:bg-red-700 text-white rounded-full p-1 text-[8px] leading-none"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>

                  {issueSuccess && <p className="text-xs font-bold text-green-700">{issueSuccess}</p>}
                  {issueError && <p className="text-xs font-bold text-red-600">{issueError}</p>}

                  <button 
                    type="submit"
                    className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white font-semibold text-sm rounded-lg transition"
                  >
                    Log crop Issue
                  </button>
                </form>
              )}
              {issueSuccess && !showIssueForm && (
                <p className="text-xs font-bold text-green-700">{issueSuccess}</p>
              )}

              {/* Crop Issues Feed */}
              <div className="grid grid-cols-1 gap-4">
                {issues.length === 0 ? (
                  <p className="text-slate-400 text-sm text-center bg-white p-8 rounded-xl border border-slate-100">No crop issues reported.</p>
                ) : (
                  issues.map(i => {
                    const farmerName = i.farmerName || farmers.find(f => f.id === i.farmer_id)?.name || "Registered Farmer";
                    const officerName = i.officerName || usersList.find(u => u.id === i.user_id)?.full_name || "Field Officer";
                    const expertName = i.expertName || (i.district === "Salem" ? "Dr. Sundar (Salem Specialist)" : "Agri Hotline Specialist");

                    return (
                      <div key={i.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col justify-between gap-4">
                        <div>
                          <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800 text-base">{farmerName}</span>
                              <span className="px-2 py-0.5 bg-green-50 text-green-800 rounded font-semibold text-[10px] uppercase tracking-wider">{i.crop}</span>
                            </div>
                            <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full uppercase ${
                              i.status === "resolved" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                            }`}>
                              {i.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mb-3"><strong className="text-slate-700">Symptoms:</strong> {i.symptoms}</p>
                          
                          <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-500 border border-slate-100 flex flex-col md:flex-row gap-4">
                            <div><strong>Specialist Whatsapp:</strong> {i.assigned_expert_whatsapp}</div>
                            <div><strong>Dispatched By:</strong> {officerName} ({i.district})</div>
                          </div>
                        </div>

                        {/* Resolved Block */}
                        {i.status === "resolved" ? (
                          <div className="p-4 bg-green-50/50 rounded-xl border border-green-100 text-xs text-green-900">
                            <strong className="block text-green-800 font-bold mb-1">Expert Diagnosis & Recommended Solution:</strong>
                            <p className="italic">&quot;{i.expert_reply || i.reply}&quot;</p>
                          </div>
                        ) : (
                          /* Admin/Manager Resolution Form */
                          (user?.role === "admin" || user?.role === "manager") && (
                            <div className="border-t border-slate-100 pt-4 space-y-3">
                              {resolvingIssueId === i.id ? (
                                <div className="space-y-2">
                                  <label className="block text-xs font-semibold text-slate-600">Provide Diagnostic Diagnosis & Solution Text</label>
                                  <textarea
                                    rows={2}
                                    value={expertReplyText}
                                    onChange={(e) => setExpertReplyText(e.target.value)}
                                    placeholder="Type instructions (e.g. Apply Bio-NPK Pesticide 20ml/L at sunset)..."
                                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                                  />
                                  <div className="flex gap-2 justify-end">
                                    <button
                                      onClick={() => {
                                        setResolvingIssueId(null);
                                        setExpertReplyText("");
                                      }}
                                      className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      disabled={!expertReplyText.trim()}
                                      onClick={async () => {
                                        try {
                                          await apiFetch(`/issues/${i.id}/resolve`, {
                                            method: "POST",
                                            body: JSON.stringify({ expert_reply: expertReplyText })
                                          });
                                          setResolvingIssueId(null);
                                          setExpertReplyText("");
                                          fetchDashboardData();
                                        } catch (err: any) {
                                          alert(err.message || "Failed to resolve crop issue.");
                                        }
                                      }}
                                      className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-800 disabled:bg-green-300 text-white font-semibold rounded-lg transition"
                                    >
                                      Submit Solution
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex justify-end">
                                  <button 
                                    onClick={() => setResolvingIssueId(i.id)}
                                    className="px-3 py-1.5 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-lg transition shadow-sm"
                                  >
                                    Submit Expert Advice
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === "enquiry" && user?.role !== "sales_officer" && (
            <div className="space-y-6">
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><HelpCircle className="text-green-700" /> Farmer Enquiry</h2>
                <p className="text-xs text-slate-500 mt-1">
                  For farmers who are hesitant to share their name, phone, or address — log just their issue and a photo. No personal details required.
                </p>
              </div>

              <form onSubmit={handleSubmitEnquiry} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">District (optional)</label>
                  <input
                    type="text"
                    value={enquiryForm.district}
                    onChange={(e) => setEnquiryForm({ ...enquiryForm, district: e.target.value })}
                    placeholder="e.g. Salem"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-green-600 bg-white text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Describe the issue</label>
                  <textarea
                    required
                    value={enquiryForm.description}
                    onChange={(e) => setEnquiryForm({ ...enquiryForm, description: e.target.value })}
                    rows={4}
                    placeholder="What is the farmer seeing? Symptoms, crop, anything they mentioned."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-green-600 bg-white text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Photo (optional)</label>
                  <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-500 cursor-pointer hover:border-green-600 w-fit">
                    <ImageIcon className="w-4 h-4" />
                    {enquiryImageFile ? enquiryImageFile.name : "Attach a photo"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden bg-slate-50 text-slate-900"
                      onChange={(e) => setEnquiryImageFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>
                {enquiryMessage.text && (
                  <p className={`text-xs font-medium ${enquiryMessage.type === "error" ? "text-red-600" : "text-green-700"}`}>{enquiryMessage.text}</p>
                )}
                <button
                  type="submit"
                  disabled={enquirySubmitting}
                  className="px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-slate-300 text-white text-sm font-bold rounded-lg transition"
                >
                  {enquirySubmitting ? "Submitting…" : "Log Enquiry"}
                </button>
              </form>

              <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="px-6 py-3 border-b border-slate-100">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Enquiries ({enquiries.length})</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {enquiries.length === 0 && (
                    <div className="px-6 py-10 text-center text-slate-400 text-sm">No enquiries logged yet.</div>
                  )}
                  {enquiries.map((enq) => (
                    <div key={enq.id} className="px-6 py-4">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${enq.status === "open" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
                            {enq.status === "open" ? "Open" : "Resolved"}
                          </span>
                          {enq.district && <span className="ml-2 text-xs text-slate-400">{enq.district}</span>}
                        </div>
                        <span className="text-[10px] text-slate-400">{new Date(enq.created_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-sm text-slate-700 mt-2">{enq.description}</p>
                      {enq.image_url && (
                        <img src={withFileToken(enq.image_url)} alt="Enquiry attachment" className="mt-2 w-32 h-32 object-cover rounded-lg border border-slate-200" />
                      )}
                      <p className="text-[11px] text-slate-400 mt-1">Reported by {enq.reported_by_name}</p>
                      {enq.status === "resolved" ? (
                        <div className="mt-2 bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-xs text-green-800">
                          <span className="font-semibold">Solution:</span> {enq.solution}
                          {enq.resolved_by_name && <span className="text-green-600"> — {enq.resolved_by_name}</span>}
                        </div>
                      ) : (
                        <div className="mt-2 flex gap-2">
                          <input
                            type="text"
                            placeholder="Enter a solution…"
                            value={enquiryResolveDrafts[enq.id] || ""}
                            onChange={(e) => setEnquiryResolveDrafts({ ...enquiryResolveDrafts, [enq.id]: e.target.value })}
                            className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-green-600 bg-slate-50 text-slate-900"
                          />
                          <button
                            onClick={() => handleResolveEnquiry(enq.id)}
                            className="px-3 py-1.5 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-lg transition"
                          >
                            Resolve
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "leave" && (
            <div className="space-y-6">
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><CalendarOff className="text-green-700" /> {(user?.role === "admin" || user?.role === "manager") ? "Leave Approvals" : "My Leave"}</h2>
                {(user?.role === "field_officer" || user?.role === "sales_officer") && (
                  <p className="text-xs text-slate-500 mt-1">Planned leave needs at least 2 days&apos; notice; emergency leave needs at least 2 hours&apos; notice.</p>
                )}
              </div>

              {(user?.role === "field_officer" || user?.role === "sales_officer") && (
                <form onSubmit={handleSubmitLeaveRequest} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Leave Type</label>
                      <select
                        value={leaveForm.leave_type}
                        onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}
                        className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-green-600"
                      >
                        <option value="planned">Planned</option>
                        <option value="emergency">Emergency</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Start Date</label>
                      <input
                        type="date"
                        required
                        value={leaveForm.start_date}
                        onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                        className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-green-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">End Date</label>
                      <input
                        type="date"
                        required
                        value={leaveForm.end_date}
                        onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                        className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-green-600"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Reason</label>
                    <textarea
                      required
                      rows={3}
                      value={leaveForm.reason}
                      onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                      className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-green-600"
                    />
                  </div>
                  {leaveMessage.text && (
                    <p className={`text-xs font-medium ${leaveMessage.type === "error" ? "text-red-600" : "text-green-700"}`}>{leaveMessage.text}</p>
                  )}
                  <button
                    type="submit"
                    disabled={leaveSubmitting}
                    className="px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-slate-300 text-white text-sm font-bold rounded-lg transition"
                  >
                    {leaveSubmitting ? "Submitting…" : "Submit Leave Request"}
                  </button>
                </form>
              )}

              <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase">
                      {(user?.role === "admin" || user?.role === "manager") && <th className="px-6 py-4">Officer</th>}
                      <th className="px-6 py-4">Type</th>
                      <th className="px-6 py-4">Dates</th>
                      <th className="px-6 py-4">Reason</th>
                      <th className="px-6 py-4">Status</th>
                      {(user?.role === "admin" || user?.role === "manager") && <th className="px-6 py-4">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
                    {leaveRequests.length === 0 && (
                      <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400 text-sm">No leave requests yet.</td></tr>
                    )}
                    {leaveRequests.map((l) => (
                      <tr key={l.id}>
                        {(user?.role === "admin" || user?.role === "manager") && (
                          <td className="px-6 py-4 font-bold text-slate-800">{l.officer_name}</td>
                        )}
                        <td className="px-6 py-4 capitalize">{l.leave_type}</td>
                        <td className="px-6 py-4">{l.start_date} → {l.end_date}</td>
                        <td className="px-6 py-4 max-w-xs truncate">{l.reason}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                            l.status === "approved" ? "bg-green-100 text-green-800"
                            : l.status === "rejected" ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-800"
                          }`}>
                            {l.status}
                          </span>
                        </td>
                        {(user?.role === "admin" || user?.role === "manager") && (
                          <td className="px-6 py-4">
                            {l.status === "pending" ? (
                              <div className="flex gap-2">
                                <button onClick={() => handleLeaveDecision(l.id, true)} className="px-2 py-1 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-lg">Approve</button>
                                <button onClick={() => handleLeaveDecision(l.id, false)} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg">Reject</button>
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400">by {l.decided_by_name || "-"}</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === "hrpolicy" && (
            <div className="space-y-6">
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><BookOpen className="text-green-700" /> HR Policies</h2>
                <p className="text-xs text-slate-500 mt-1">Login timing, leave rules, and other policies every officer should know.</p>
              </div>
              <div className="space-y-4">
                {hrPolicies.length === 0 && (
                  <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 text-center text-slate-400 text-sm">
                    No policy sections published yet.
                  </div>
                )}
                {hrPolicies.map((p) => (
                  <div key={p.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-800">{p.title}</h3>
                    <p className="text-sm text-slate-600 mt-2 leading-relaxed">{p.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "day-closures" && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Day Closure Reports</h2>
                  <p className="text-xs text-slate-400 mt-1">Review end-of-day submissions from field and sales officers.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Was a plain <a href>. A browser navigation sends no
                      Authorization header, so the endpoint rejected it and
                      the download silently did nothing. Fetched with the
                      token and saved as a blob instead. */}
                  <button
                    onClick={handleExportDayClosures}
                    disabled={exportingClosures}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg transition"
                  >
                    <Download className="w-4 h-4" />
                    {exportingClosures ? "Exporting…" : "Export Excel"}
                  </button>
                  <button
                    onClick={() => setShowFormBuilder(true)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-700 hover:bg-green-800 text-white rounded-lg transition"
                  >
                    <Settings className="w-4 h-4" />
                    Form Builder
                  </button>
                  <button
                    onClick={() => { setShowCreateClosure(true); setCreateClosureOfficerId(""); setCreateClosureError(""); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
                    title="File a day closure on behalf of an officer (e.g. correcting a missed submission)"
                  >
                    <Plus className="w-4 h-4" />
                    Add Manually
                  </button>
                  <button 
                    onClick={fetchAdminDayClosures}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingDayClosures ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Submitted Reports (Left, 2 columns wide) */}
                <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                  <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <h3 className="font-bold text-slate-800">Submitted Reports</h3>
                  </div>
                  
                  {loadingDayClosures && adminDayClosures.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-sm">Loading reports...</div>
                  ) : adminDayClosures.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-sm">No day closure reports found.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Date</th>
                            <th className="px-4 py-3 font-semibold">Officer</th>
                            <th className="px-4 py-3 font-semibold">Farmer</th>
                            <th className="px-4 py-3 font-semibold">District / Village</th>
                            <th className="px-4 py-3 font-semibold">Crop</th>
                            <th className="px-4 py-3 font-semibold">Status</th>
                            <th className="px-4 py-3 font-semibold">Demo</th>
                            <th className="px-4 py-3 font-semibold">Purchase</th>
                            <th className="px-4 py-3 font-semibold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {adminDayClosures.map((closure) => (
                            <tr key={closure.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-medium text-slate-800">{closure.date}</td>
                              <td className="px-4 py-3 text-slate-600">{closure.officer_name}</td>
                              <td className="px-4 py-3 text-slate-600">{closure.farmer_name || "—"}</td>
                              <td className="px-4 py-3 text-slate-600">{[closure.village, closure.district].filter(Boolean).join(", ") || "—"}</td>
                              <td className="px-4 py-3 text-slate-600">{closure.crop_name || "—"}</td>
                              <td className="px-4 py-3">
                                {closure.crop_status ? (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">{closure.crop_status.replace(/_/g, " ")}</span>
                                ) : "—"}
                              </td>
                              <td className="px-4 py-3 text-slate-600">{closure.demo_status ? closure.demo_status.replace(/_/g, " ") : "—"}</td>
                              <td className="px-4 py-3">
                                {closure.purchased ? (
                                  <span className="text-green-700 font-semibold">₹{closure.order_value ?? "—"}</span>
                                ) : <span className="text-slate-400">No</span>}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex justify-end gap-3">
                                  {closure.visit_id && (
                                    <button onClick={() => setDayClosureDetailVisitId(closure.visit_id)} className="text-slate-500 hover:text-slate-800 text-xs font-semibold">View</button>
                                  )}
                                  <button onClick={() => openEditDayClosure(closure)} className="text-blue-600 hover:text-blue-800 text-xs font-semibold">Edit</button>
                                  <button onClick={() => handleDeleteDayClosure(closure)} className="text-red-500 hover:text-red-700 text-xs font-semibold">Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Missing Today (Right, 1 column wide) */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex flex-col h-full">
                  <div className="p-4 border-b border-slate-100 bg-red-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                      <h3 className="font-bold text-red-900">Missing Today</h3>
                    </div>
                    <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold">
                      {missingDayClosures.length}
                    </span>
                  </div>
                  
                  <div className="p-4 flex-1 overflow-y-auto">
                    {loadingDayClosures && missingDayClosures.length === 0 ? (
                      <div className="text-center text-slate-400 text-sm py-4">Checking missing officers...</div>
                    ) : missingDayClosures.length === 0 ? (
                      <div className="text-center py-8">
                        <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
                        <p className="text-slate-500 text-sm font-medium">All active officers have submitted their reports today!</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-xs text-slate-500 mb-2">The following officers have not submitted a day closure report for {new Date().toLocaleDateString()}:</p>
                        {missingDayClosures.map((officer) => (
                          <div key={officer.officer_id} className="flex items-center justify-between p-3 border border-slate-100 rounded-lg hover:border-slate-200 hover:bg-slate-50 transition">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                                <User className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="font-semibold text-sm text-slate-800">{officer.officer_name}</div>
                                <div className="text-xs text-slate-500">{ROLE_LABELS[officer.role] || officer.role}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sales Officer closures. Separate table rather than mixed
                  into the one above because the two closure types share
                  no meaningful columns - farmer/crop/demo vs.
                  dealer/order/collection - and forcing them together
                  would leave half of every row empty. */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5 text-green-600" />
                    <h3 className="font-bold text-slate-800">Sales Officer Closures</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={salesClosureOfficerId}
                      onChange={(e) => setSalesClosureOfficerId(e.target.value)}
                      className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700"
                    >
                      <option value="">All officers</option>
                      {usersList.filter((u: any) => u.role === "sales_officer").map((u: any) => (
                        <option key={u.id} value={u.id}>{u.full_name}</option>
                      ))}
                    </select>
                    <input
                      type="date"
                      title="From"
                      value={salesClosureDateFrom}
                      onChange={(e) => setSalesClosureDateFrom(e.target.value)}
                      className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700"
                    />
                    <input
                      type="date"
                      title="To"
                      value={salesClosureDateTo}
                      onChange={(e) => setSalesClosureDateTo(e.target.value)}
                      className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700"
                    />
                    <input
                      type="month"
                      title="Month"
                      value={salesClosureMonth}
                      onChange={(e) => setSalesClosureMonth(e.target.value)}
                      className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700"
                    />
                    <input
                      placeholder="District"
                      value={salesClosureDistrict}
                      onChange={(e) => setSalesClosureDistrict(e.target.value)}
                      className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 w-28"
                    />
                    <button
                      onClick={fetchSalesClosures}
                      className="px-3 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold"
                    >
                      Filter
                    </button>
                  </div>
                </div>

                {salesClosures.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-sm">No sales closures found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Date</th>
                          <th className="px-4 py-3 font-semibold">Officer</th>
                          <th className="px-4 py-3 font-semibold">Dealer</th>
                          <th className="px-4 py-3 font-semibold">District</th>
                          <th className="px-4 py-3 font-semibold">Purpose</th>
                          <th className="px-4 py-3 font-semibold text-right">Order</th>
                          <th className="px-4 py-3 font-semibold text-right">Collected</th>
                          <th className="px-4 py-3 font-semibold">Stock</th>
                          <th className="px-4 py-3 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {salesClosures.map((s: any) => (
                          <tr key={s.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-800">{s.date}</td>
                            <td className="px-4 py-3 text-slate-600">{s.officer_name || "—"}</td>
                            <td className="px-4 py-3 text-slate-600">{s.dealer_name}</td>
                            <td className="px-4 py-3 text-slate-600">{s.district}</td>
                            <td className="px-4 py-3 text-slate-600">{(s.visit_purpose || "").replace(/_/g, " ")}</td>
                            <td className="px-4 py-3 text-right text-slate-700">
                              {s.order_booked ? `₹${s.order_value ?? "—"}` : <span className="text-slate-400">No</span>}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-700">
                              {s.amount_collected != null ? `₹${s.amount_collected}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-slate-600">{(s.stock_status || "—").replace(/_/g, " ")}</td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-3">
                                <button onClick={() => openSalesClosureDetail(s.closure_id)} className="text-slate-500 hover:text-slate-800 text-xs font-semibold">View</button>
                                {/* Edit shown only after the PUT endpoint was
                                    verified working against a real database. */}
                                <button
                                  onClick={() => { setEditingSalesClosure(s); setSalesEditForm({ dealer_name: s.dealer_name, district: s.district, amount_collected: s.amount_collected ?? "", remarks: s.remarks ?? "" }); }}
                                  className="text-blue-600 hover:text-blue-800 text-xs font-semibold"
                                >
                                  Edit
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {salesClosureDetail && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setSalesClosureDetail(null); }}>
                  <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-slate-800">Sales Closure Detail</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {salesClosureDetail.officer_name} · submitted {salesClosureDetail.date}
                        </p>
                      </div>
                      <button onClick={() => setSalesClosureDetail(null)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
                      {([
                        ["Dealer", salesClosureDetail.dealer_name],
                        ["District", salesClosureDetail.district],
                        ["Village", salesClosureDetail.village],
                        ["Contact", salesClosureDetail.dealer_contact],
                        ["Visit purpose", (salesClosureDetail.visit_purpose || "").replace(/_/g, " ")],
                        ["Order booked", salesClosureDetail.order_booked === null ? null : salesClosureDetail.order_booked ? "Yes" : "No"],
                        ["Order value", salesClosureDetail.order_value != null ? `₹${salesClosureDetail.order_value}` : null],
                        ["Amount collected", salesClosureDetail.amount_collected != null ? `₹${salesClosureDetail.amount_collected}` : null],
                        ["New dealer", salesClosureDetail.new_dealer_details],
                        ["Reviewed FO visit", salesClosureDetail.reviewed_fo_visit === null ? null : salesClosureDetail.reviewed_fo_visit ? "Yes" : "No"],
                        ["Competitor activity", salesClosureDetail.competitor_activity],
                        ["Stock status", (salesClosureDetail.stock_status || "").replace(/_/g, " ")],
                        ["Day rating", salesClosureDetail.day_rating ? `${salesClosureDetail.day_rating}/5` : null],
                        ["Remarks", salesClosureDetail.remarks],
                      ] as [string, any][])
                        .filter(([, v]) => v !== null && v !== undefined && v !== "")
                        .map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-4 text-sm py-1 border-b border-slate-50">
                            <span className="text-slate-500 flex-shrink-0">{k}</span>
                            <span className="text-slate-800 font-medium text-right">{String(v)}</span>
                          </div>
                        ))}
                      {salesClosureDetail.images?.length > 0 && (
                        <div className="pt-3">
                          <p className="text-xs font-bold text-slate-500 uppercase mb-2">Photos</p>
                          <div className="flex gap-2 flex-wrap">
                            {salesClosureDetail.images.map((u: string, i: number) => (
                              <img key={i} src={withFileToken(u)} className="w-24 h-24 object-cover rounded border border-slate-200" />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {editingSalesClosure && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
                    <h3 className="text-lg font-bold text-slate-800">Edit Sales Closure</h3>
                    {[["dealer_name","Dealer"],["district","District"],["amount_collected","Amount Collected (₹)"],["remarks","Remarks"]].map(([k,lbl]) => (
                      <div key={k}>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">{lbl}</label>
                        <input
                          className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                          value={(salesEditForm as any)[k as string] ?? ""}
                          onChange={(e) => setSalesEditForm({ ...salesEditForm, [k as string]: e.target.value })}
                        />
                      </div>
                    ))}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingSalesClosure(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg">Cancel</button>
                      <button onClick={saveSalesClosureEdit} disabled={salesEditSaving} className="px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-slate-300 text-white text-sm font-bold rounded-lg">
                        {salesEditSaving ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {dayClosureDetailVisitId && (
                <VisitDetailPanel visitId={dayClosureDetailVisitId} onClose={() => setDayClosureDetailVisitId(null)} />
              )}

              {editingClosure && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
                    <h3 className="text-lg font-bold text-slate-800">
                      Edit Day Closure — {editingClosure.officer_name} ({editingClosure.date})
                    </h3>
                    <p className="text-xs text-slate-400">
                      Corrects the linked visit&apos;s summary fields. Only changed fields are saved.
                    </p>
                    {editClosureError && <p className="text-xs font-bold text-red-600">{editClosureError}</p>}

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Crop Status</label>
                      <select
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                        value={editClosureForm.crop_status}
                        onChange={(e) => setEditClosureForm({ ...editClosureForm, crop_status: e.target.value })}
                      >
                        <option value="">— No change —</option>
                        <option value="healthy">Healthy</option>
                        <option value="mild_stress">Mild stress</option>
                        <option value="pest_disease_affected">Pest/Disease affected</option>
                        <option value="drought">Drought</option>
                        <option value="waterlogged">Waterlogged</option>
                        <option value="nutrient_deficiency">Nutrient deficiency</option>
                        <option value="other">Other</option>
                      </select>
                      {/* Admin edit must capture the same description an
                          officer would be required to give, or an admin
                          switching a record to "Other" silently drops it. */}
                      <OtherDescriptionInput
                        required={editClosureForm.crop_status === "other"}
                        value={editClosureForm.status_other_text ?? ""}
                        onChange={(v) => setEditClosureForm({ ...editClosureForm, status_other_text: v })}
                        showError={!!editClosureError}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Demo Status</label>
                      <select
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                        value={editClosureForm.demo_status}
                        onChange={(e) => setEditClosureForm({ ...editClosureForm, demo_status: e.target.value })}
                      >
                        <option value="">— No change —</option>
                        <option value="not_discussed">No demo - not discussed</option>
                        <option value="explained_not_interested">Demo explained - not interested</option>
                        <option value="agreed_not_started">Farmer agreed - not started</option>
                        <option value="started_today">Demo started today</option>
                        <option value="followup_running">Follow-up on running demo</option>
                        <option value="completed_success">Demo completed - success</option>
                        <option value="completed_failed">Demo completed - failed</option>
                        <option value="converted">Converted to paid purchase</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="edit-purchased"
                        checked={!!editClosureForm.purchased}
                        onChange={(e) => setEditClosureForm({ ...editClosureForm, purchased: e.target.checked })}
                      />
                      <label htmlFor="edit-purchased" className="text-sm text-slate-700">Farmer purchased</label>
                    </div>

                    {editClosureForm.purchased && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Order Value (₹)</label>
                        <input
                          type="number"
                          className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                          value={editClosureForm.order_value}
                          onChange={(e) => setEditClosureForm({ ...editClosureForm, order_value: e.target.value })}
                        />
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingClosure(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg">Cancel</button>
                      <button
                        onClick={saveEditDayClosure}
                        disabled={editClosureSaving}
                        className="px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-slate-300 text-white text-sm font-bold rounded-lg"
                      >
                        {editClosureSaving ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {showFormBuilder && (
                <DayClosureFormBuilder onClose={() => setShowFormBuilder(false)} />
              )}

              {showCreateClosure && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
                  <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full my-8 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-slate-800">Add Day Closure (on behalf of an officer)</h3>
                      <button onClick={() => setShowCreateClosure(false)} className="text-slate-400 hover:text-slate-700">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-400">
                      For correcting a missed submission. Filed under today&apos;s date for the officer selected below.
                    </p>
                    {createClosureError && <p className="text-xs font-bold text-red-600">{createClosureError}</p>}

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Officer *</label>
                      <select
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                        value={createClosureOfficerId}
                        onChange={(e) => setCreateClosureOfficerId(e.target.value)}
                      >
                        <option value="">— Select officer —</option>
                        {usersList
                          .filter((u: any) => u.role === "field_officer" || u.role === "sales_officer")
                          .map((u: any) => (
                            <option key={u.id} value={u.id}>{u.full_name} ({u.role.replace("_", " ")})</option>
                          ))}
                      </select>
                    </div>

                    {createClosureOfficerId ? (
                      <DayClosureForm
                        adminOfficerId={createClosureOfficerId}
                        onSubmitted={() => {
                          setShowCreateClosure(false);
                          fetchAdminDayClosures();
                        }}
                        onError={(msg) => setCreateClosureError(msg)}
                      />
                    ) : (
                      <p className="text-sm text-slate-400 italic">Select an officer above to fill in the visit details.</p>
                    )}
                  </div>
                </div>
              )}

            </div>
          )}

          {activeTab === "work-doc" && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <FileText className="text-green-700" /> Submit Today&apos;s Day Closure
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {user?.role === "sales_officer"
                    ? "Record today's dealer visit. Required before you can log out."
                    : "Fill in today's visit details. Required before you can log out."}
                </p>
              </div>

              {closureMessage.text && (
                <div className={`p-4 rounded-lg text-sm font-medium ${closureMessage.type === "error" ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
                  {closureMessage.text}
                </div>
              )}

              {/* "No activity today" (approved requirement).
                  Without this an officer who was sick, travelling or in
                  training has NOTHING they can validly submit - and
                  since 17:30 logout enforcement is live, they would be
                  unable to sign out at all. A short reason is required;
                  the backend and a DB CHECK constraint both enforce it. */}
              {!showNoActivityForm ? (
                <button
                  onClick={() => { setShowNoActivityForm(true); setClosureMessage({ type: "", text: "" }); }}
                  className="w-full py-3 text-sm font-semibold text-slate-600 bg-white border border-dashed border-slate-300 rounded-xl hover:bg-slate-50 transition"
                >
                  No activity today
                </button>
              ) : (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-amber-200 space-y-3">
                  <h3 className="text-sm font-bold text-slate-800">No activity today</h3>
                  <p className="text-xs text-slate-500">
                    This closes your day without any visits or sales. Please give a short reason —
                    it is required.
                  </p>
                  <textarea
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-600"
                    rows={2}
                    placeholder="e.g. On sick leave, travelling, training day"
                    value={noActivityReason}
                    onChange={(e) => setNoActivityReason(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => { setShowNoActivityForm(false); setNoActivityReason(""); }}
                      className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmitNoActivity}
                      disabled={noActivitySaving}
                      className="px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-slate-300 text-white text-sm font-bold rounded-lg"
                    >
                      {noActivitySaving ? "Submitting…" : "Submit No-Activity Closure"}
                    </button>
                  </div>
                </div>
              )}

              {/* A Sales Officer's day is dealers, orders and collection;
                  a Field Officer's is a farm agronomy visit. Same table,
                  same duplicate guard, same logout gate - only the form
                  content differs, which is what closure_type records. */}
              {user?.role === "sales_officer" ? (
                <SalesDayClosureForm
                  onSubmitted={() => {
                    setClosureMessage({ type: "success", text: "Today's closure submitted successfully!" });
                  }}
                  onError={(msg) => setClosureMessage({ type: "error", text: msg })}
                />
              ) : (
                <DayClosureForm
                  onSubmitted={() => {
                    setClosureMessage({ type: "success", text: "Today's closure submitted successfully!" });
                  }}
                  onError={(msg) => setClosureMessage({ type: "error", text: msg })}
                />
              )}
            </div>
          )}

          {activeTab === "reports" && (
            <div className="space-y-6">
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-800">Reports Generation Center</h2>
                <p className="text-xs text-slate-400 mt-1">Generate PDF logs and Excel registries for operations analysis.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* PDF Attendance Card */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-green-50 rounded-lg"><FileText className="w-6 h-6 text-green-700" /></div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-md">Daily Attendance PDF Report</h3>
                      <p className="text-xs text-slate-400">Compiles check-ins, check-outs, device IDs, and mock-location (GPS spoofing) alerts.</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="date" 
                      value={reportDate || new Date().toISOString().slice(0, 10)} 
                      onChange={(e) => setReportDate(e.target.value)} 
                      className="px-3 py-2 text-sm bg-slate-100 border border-slate-200 rounded-lg text-slate-700 focus:outline-none flex-1" 
                    />
                    <button 
                      onClick={() => {
                        const targetDate = reportDate || new Date().toISOString().slice(0, 10);
                        downloadAuthenticatedFile(`${API_BASE_URL}/reports/attendance/pdf?date_val=${targetDate}`, `attendance-${targetDate}.pdf`).catch((e) => alert(e.message));
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-green-700 text-white font-semibold rounded-lg text-sm hover:bg-green-800 transition"
                    >
                      <Download className="w-4 h-4" /> Download PDF
                    </button>
                  </div>
                </div>

                {/* Excel Farmer Registry Card */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-green-50 rounded-lg"><FileText className="w-6 h-6 text-green-700" /></div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-md">Farmer Directory Excel Spreadsheet</h3>
                      <p className="text-xs text-slate-400">Exports demographics, phone coordinates, crop type, centage, and visit logs.</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button 
                      onClick={() => {
                        downloadAuthenticatedFile(`${API_BASE_URL}/reports/farmers/excel`, datedFilename("farmers", "xlsx")).catch((e) => alert(e.message));
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-green-700 text-white font-semibold rounded-lg text-sm hover:bg-green-800 transition w-full md:w-auto justify-center"
                    >
                      <Download className="w-4 h-4" /> Export Excel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "users" && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Users className="text-green-700 w-5 h-5" /> User Management Console
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">Create, edit, reset passwords, enable/disable users, and assign reporting lines.</p>
                </div>
                <button
                  onClick={() => {
                    setIsCreatingUser(true);
                    setFormPhone("");
                    setFormPassword("");
                    setFormFullName("");
                    setFormRole("field_officer");
                    setFormEmployeeId("");
                    setFormManagerId("");
                    setFormDeviceId("");
                    setFormError("");
                    setFormSuccess("");
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-700 hover:bg-green-800 text-white font-semibold rounded-lg text-sm transition shadow-sm"
                >
                  <Plus className="w-4 h-4" /> Add User
                </button>
              </div>

              {/* Error and Success Alerts */}
              {formError && (
                <div className="p-4 bg-red-50 border border-red-100 text-sm text-red-600 rounded-xl">
                  {formError}
                </div>
              )}
              {formSuccess && (
                <div className="p-4 bg-green-50 border border-green-100 text-sm text-green-700 rounded-xl">
                  {formSuccess}
                </div>
              )}

              {/* Create/Edit Form (Shown inline when editing or creating) */}
              {(isCreatingUser || editingUser) && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
                  <h3 className="font-bold text-slate-800 text-md">
                    {isCreatingUser ? "Create New User Profile" : `Edit Profile: ${editingUser?.full_name}`}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Full Name</label>
                      <input
                        type="text"
                        value={formFullName}
                        onChange={(e) => setFormFullName(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-green-700"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Phone Number (Optional)</label>
                      <input
                        type="tel"
                        inputMode="tel"
                        placeholder="e.g. 98765 43210"
                        value={formPhone}
                        onChange={(e) => setFormPhone(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-green-700"
                      />
                    </div>
                    {isCreatingUser && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Password</label>
                        <input
                          type="password"
                          value={formPassword}
                          onChange={(e) => setFormPassword(e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-green-700"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Employee ID <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={formEmployeeId}
                        onChange={(e) => setFormEmployeeId(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-green-700"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Role</label>
                      <select
                        value={formRole}
                        onChange={(e) => setFormRole(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-green-700"
                      >
                        <option value="field_officer">Field Officer</option>
                        <option value="sales_officer">Sales Officer</option>
                        <option value="manager">Regional Manager</option>
                        <option value="admin">Administrator</option>
                      </select>
                    </div>
                  </div>
                  {!isCreatingUser && editingUser && (
                    <div className="pt-2 text-xs text-slate-500">
                      Password last changed {editingUser.password_changed_at ? new Date(editingUser.password_changed_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "") : "never"} by {usersList.find((u: any) => u.id === editingUser.password_changed_by)?.full_name || editingUser.password_changed_by || "unknown"} · Failed logins today: {editingUser.failed_logins_today || 0}
                    </div>
                  )}


                  <div className="flex gap-2 justify-end pt-2">
                    <button
                      onClick={() => {
                        setIsCreatingUser(false);
                        setEditingUser(null);
                        setFormError("");
                      }}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        setFormError("");
                        setFormSuccess("");
                        if (!formEmployeeId.trim()) {
                          setFormError("Employee ID is required - it is what this person signs in with.");
                          return;
                        }
                        try {
                          if (isCreatingUser) {
                            const res: any = await apiFetch("/users", {
                              method: "POST",
                              body: JSON.stringify({
                                phone: formPhone.trim() || undefined,
                                password: formPassword,
                                full_name: formFullName,
                                role: formRole,
                                employee_id: formEmployeeId.trim(),
                              }),
                            });
                            setFormSuccess(`User ${res.full_name} created successfully!`);
                            setIsCreatingUser(false);
                          } else {
                            const res: any = await apiFetch(`/users/${editingUser.id}`, {
                              method: "PUT",
                              body: JSON.stringify({
                                phone: formPhone.trim() || undefined,
                                full_name: formFullName,
                                role: formRole,
                                employee_id: formEmployeeId.trim(),
                              }),
                            });
                            setFormSuccess(`User ${res.full_name} updated successfully!`);
                            setEditingUser(null);
                          }
                          fetchUsers(isArchivedTab);
                        } catch (err: any) {
                          setFormError(err.message || "Failed to save user");
                        }
                      }}
                      className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded-lg transition"
                    >
                      Save Profile
                    </button>
                  </div>
                </div>
              )}

              {/* Password Reset Modal Panel */}
              {resettingUser && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
                  <h3 className="font-bold text-slate-800 text-md">Reset Password for {resettingUser.full_name}</h3>
                  <div className="w-full max-w-md">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">New Password</label>
                    <input
                      type="password"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-green-700"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setResettingUser(null)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        setFormError("");
                        setFormSuccess("");
                        try {
                          await apiFetch(`/users/${resettingUser.id}/reset-password`, {
                            method: "POST",
                            body: JSON.stringify({ password: formPassword }),
                          });
                          setFormSuccess(`Password reset successfully for ${resettingUser.full_name}!`);
                          setResettingUser(null);
                        } catch (err: any) {
                          setFormError(err.message || "Failed to reset password");
                        }
                      }}
                      className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded-lg transition"
                    >
                      Reset Password
                    </button>
                  </div>
                </div>
              )}

              {/* Assignments Config Panel */}
              {assigningUser && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
                  <h3 className="font-bold text-slate-800 text-md">Configure Assignments: {assigningUser.full_name}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Reporting Manager</label>
                      <select
                        value={formManagerId}
                        onChange={(e) => setFormManagerId(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-green-700"
                      >
                        <option value="">No Reporting Manager</option>
                        {usersList
                          .filter(u => u.role === "manager" || u.role === "admin")
                          .map(u => (
                            <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Device Hardware UUID Binding</label>
                      <input
                        type="text"
                        value={formDeviceId}
                        onChange={(e) => setFormDeviceId(e.target.value)}
                        placeholder="e.g. dev-device-uuid-9912"
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-green-700"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end pt-2">
                    <button
                      onClick={() => setAssigningUser(null)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        setFormError("");
                        setFormSuccess("");
                        try {
                          await apiFetch(`/users/${assigningUser.id}/assignments`, {
                            method: "POST",
                            body: JSON.stringify({
                              manager_id: formManagerId || null,
                              device_id: formDeviceId || null,
                              territory_ids: [], // Set empty or populate
                            }),
                          });
                          setFormSuccess(`Assignments updated for ${assigningUser.full_name}!`);
                          setAssigningUser(null);
                          fetchUsers(isArchivedTab);
                        } catch (err: any) {
                          setFormError(err.message || "Failed to update assignments");
                        }
                      }}
                      className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded-lg transition"
                    >
                      Save Assignments
                    </button>
                  </div>
                </div>
              )}

                            {/* Users Header & Tabs */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex bg-slate-100 rounded-lg p-1">
                  <button onClick={() => setIsArchivedTab(false)} className={`px-4 py-1.5 text-sm font-semibold rounded-md transition ${!isArchivedTab ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>Active Users</button>
                  <button onClick={() => setIsArchivedTab(true)} className={`px-4 py-1.5 text-sm font-semibold rounded-md transition ${isArchivedTab ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>Archived Users</button>
                </div>
              </div>

              
              {/* Delete Modal */}
              {deletingUser && deleteImpact && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                  <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-100 space-y-4 max-w-md w-full">
                    <h3 className="font-bold text-slate-800 text-lg">Confirm Action</h3>
                    <p className="text-sm text-slate-600">
                      {deleteImpact.can_hard_delete ? (
                        `Delete ${deletingUser.full_name} (${deletingUser.employee_id || "no employee ID"}) permanently? This cannot be undone.`
                      ) : (
                        `${deletingUser.full_name} (${deletingUser.employee_id || "no employee ID"}) has ${deleteImpact.counts.visits || 0} visits and ${deleteImpact.counts.day_closures || 0} day closures. They will be archived: hidden from lists, all records kept. You can restore them later.`
                      )}
                    </p>
                    <div className="flex gap-3 justify-end pt-2">
                      <button
                        onClick={() => {
                          setDeletingUser(null);
                          setDeleteImpact(null);
                        }}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          setFormError("");
                          setFormSuccess("");
                          try {
                            await apiFetch(`/admin/users/${deletingUser.id}`, { method: "DELETE" });
                            setFormSuccess(deleteImpact.can_hard_delete ? "User deleted permanently." : "User archived.");
                            setDeletingUser(null);
                            setDeleteImpact(null);
                            
                            // Remove from table without full reload
                            setUsersList(prev => prev.filter(u => u.id !== deletingUser.id));
                          } catch (err: any) {
                            setDeletingUser(null);
                            setDeleteImpact(null);
                            setFormError(err.message || "Failed to process delete");
                          }
                        }}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition"
                      >
                        {deleteImpact.can_hard_delete ? "Delete permanently" : "Archive"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Users Grid Table */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                {loadingUsers ? (
                  <div className="p-8 text-center text-slate-400 text-sm">Loading users from catalog...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs font-semibold border-b border-slate-100">
                          <th className="p-4">Name</th>
                          <th className="p-4">Employee ID</th>
                          <th className="p-4">Phone</th>
                          <th className="p-4">Role</th>
                          <th className="p-4">Status</th>
                          <th className="p-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                        {usersList.map((u) => (
                          <tr key={u.id} className="hover:bg-slate-50/50">
                            <td className="p-4 font-semibold text-slate-800">{u.full_name}</td>
                            <td className="p-4 font-mono text-slate-600">{u.employee_id || "-"}</td>
                            <td className="p-4 text-slate-500">{u.phone || "-"}</td>
                            <td className="p-4">
                              <span className="px-2.5 py-0.5 text-xs font-medium bg-slate-100 rounded-full text-slate-800 capitalize">
                                {u.role.replace("_", " ")}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${u.is_active ? "text-green-600" : "text-red-500"}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? "bg-green-600" : "bg-red-500"}`} />
                                {u.is_active ? "Active" : "Disabled"}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              {isArchivedTab ? (
                                <button
                                  onClick={async () => {
                                    setFormError(""); setFormSuccess("");
                                    try {
                                      await apiFetch(`/admin/users/${u.id}/restore`, { method: "POST" });
                                      setFormSuccess("User restored successfully.");
                                      fetchUsers(isArchivedTab);
                                    } catch(err: any) { setFormError(err.message); }
                                  }}
                                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2.5 py-1 rounded-lg transition"
                                >
                                  Restore
                                </button>
                              ) : (
                                <div className="flex items-center justify-end gap-2 relative">
                                  <button
                                    onClick={() => {
                                      setEditingUser(u);
                                      setIsCreatingUser(false);
                                      setFormPhone(u.phone || "");
                                      setFormFullName(u.full_name);
                                      setFormRole(u.role);
                                      setFormEmployeeId(u.employee_id || "");
                                    }}
                                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-3 py-1.5 rounded-lg transition"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => setDropdownOpenId(dropdownOpenId === u.id ? null : u.id)}
                                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2 py-1.5 rounded-lg transition"
                                  >
                                    ⋯
                                  </button>
                                  {dropdownOpenId === u.id && (
                                    <div className="absolute right-0 top-8 w-40 bg-white border border-slate-100 shadow-md rounded-lg py-1 z-10 text-left">
                                      <button onClick={() => { setDropdownOpenId(null); router.push(`/dashboard/officers/${u.id}`); }} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Profile</button>
                                      <button onClick={() => { setDropdownOpenId(null); setAssigningUser(u); setFormManagerId(u.manager_id || ""); setFormDeviceId(u.device_id || ""); }} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Assign</button>
                                      <button onClick={() => { setDropdownOpenId(null); setResettingUser(u); setFormPassword(""); }} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Key</button>
                                      <button
                                        disabled={u.id === user?.id}
                                        onClick={async () => {
                                          setDropdownOpenId(null); setFormError(""); setFormSuccess("");
                                          try {
                                            await apiFetch(`/users/${u.id}/status`, { method: "POST", body: JSON.stringify({ is_active: !u.is_active }) });
                                            setFormSuccess(`Status updated!`); fetchUsers(isArchivedTab);
                                          } catch(err: any) { setFormError(err.message); }
                                        }}
                                        className={`w-full text-left px-4 py-2 text-sm ${u.id === user?.id ? "text-slate-400 cursor-not-allowed" : "text-slate-700 hover:bg-slate-50"}`}
                                      >
                                        {u.is_active ? "Disable" : "Enable"}
                                      </button>
                                      {!u.is_active && u.id !== user?.id && (
                                        <button
                                          onClick={async () => {
                                            setDropdownOpenId(null); setFormError(""); setFormSuccess("");
                                            try {
                                              const impact = await apiFetch(`/admin/users/${u.id}/delete-impact`);
                                              setDeleteImpact(impact);
                                              setDeletingUser(u);
                                            } catch(err: any) { setFormError(err.message); }
                                          }}
                                          className="w-full text-left px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700"
                                        >
                                          Delete
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      
      {/* Daily Report Submission Modal */}
      {showDailyReportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowDailyReportModal(false)} />
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden relative flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="font-bold text-slate-800">Daily Work Report</h3>
                <p className="text-xs text-slate-500">Required before sign out</p>
              </div>
              <button onClick={() => setShowDailyReportModal(false)} className="text-slate-400 hover:text-slate-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              {dailyReportError && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
                  {dailyReportError}
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Summary of Today&apos;s Work <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={dailyReportSummary}
                    onChange={(e) => setDailyReportSummary(e.target.value)}
                    placeholder="Briefly describe the fields visited, tasks completed, and any issues..."
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-green-500 focus:ring-4 focus:ring-green-500/10 outline-none transition resize-none h-32 bg-slate-50 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Attachment (Optional)</label>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center justify-center w-10 h-10 bg-slate-100 text-slate-500 rounded-lg cursor-pointer hover:bg-slate-200 transition">
                      <Camera className="w-5 h-5" />
                      <input
                        type="file"
                        className="hidden bg-slate-50 text-slate-900"
                        accept="image/*,.pdf"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) setDailyReportFile(e.target.files[0]);
                        }}
                      />
                    </label>
                    <div className="flex-1 text-sm text-slate-600 truncate">
                      {dailyReportFile ? dailyReportFile.name : "No file chosen"}
                    </div>
                    {dailyReportFile && (
                      <button onClick={() => setDailyReportFile(null)} className="text-red-500 hover:text-red-700">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => setShowDailyReportModal(false)}
                className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitDailyReport}
                disabled={dailyReportSubmitting}
                className="px-5 py-2.5 text-sm font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition flex items-center gap-2"
              >
                {dailyReportSubmitting ? "Submitting..." : "Submit & Sign Out"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout gate: field/sales officers must submit today's closure
          before they can actually sign out. The full form (crop profile,
          health diagnosis, demo/trial, sales, photos) is too large for a
          modal overlay, so this gate confirms the requirement and sends
          them to the real "work-doc" tab rather than duplicating the form
          inline - one copy of the field set, not two. */}
      {showLogoutGateModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <FileText className="w-5 h-5 text-green-700" /> Today&apos;s Closure Required
            </h3>
            <p className="text-sm text-slate-600">
              You haven&apos;t submitted today&apos;s closure yet. Please fill it in before signing out.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowLogoutGateModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowLogoutGateModal(false);
                  setActiveTab("work-doc");
                }}
                className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-bold rounded-lg transition"
              >
                Go to Day Closure
              </button>
            </div>
          </div>
        </div>
      )}

      {showPhonePreview && (
        <PhoneSimulator onClose={() => setShowPhonePreview(false)} />
      )}

      {/* Location consent disclosure - the web equivalent of the mobile
          app's LocationDisclosure screen. Required before check-in
          (require_location_consent, enforced server-side independent of
          this UI) because check-in is the action that starts location
          tracking for the day. Deliberately not dismissible by clicking
          the backdrop - unlike other modals here, declining this one
          must be a real choice the officer makes via Decline, not an
          accidental outside click that looks like acceptance. */}
      {showConsentModal && locationConsent && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-800">{locationConsent.title}</h3>
            <ul className="space-y-2">
              {locationConsent.points?.map((p: any, i: number) => (
                <li key={i} className="text-sm text-slate-600">
                  <span className="font-semibold text-slate-700">{p.label}: </span>
                  {p.text}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-400">{locationConsent.footer}</p>
            {consentError && (
              <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
                {consentError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConsentModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg transition"
              >
                Not Now
              </button>
              <button
                onClick={handleAcceptLocationConsent}
                disabled={isAcceptingConsent}
                className="px-4 py-2 bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition"
              >
                {isAcceptingConsent ? "Saving..." : "I Agree & Check In"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
