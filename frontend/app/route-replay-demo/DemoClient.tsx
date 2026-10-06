"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { todayIST } from "@/lib/dates";
import { MOCK_OFFICERS, MOCK_PLACES, mockFetchDay } from "@/components/route-replay/mockData";

const RouteReplayScreen = dynamic(() => import("@/components/route-replay"), {
  ssr: false,
  loading: () => <div className="h-[540px] animate-pulse rounded-xl bg-slate-100" />,
});

const officers = MOCK_OFFICERS.map((o) => ({
  id: o.id,
  name: o.name,
  role: o.role,
  employeeId: o.employeeId,
  territory: o.territory,
}));

export default function DemoClient() {
  const [officerId, setOfficerId] = useState("demo-normal");
  const [date, setDate] = useState(todayIST());
  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-[1400px]">
        <RouteReplayScreen
          demo
          officers={officers}
          places={MOCK_PLACES}
          officerId={officerId}
          onOfficerChange={setOfficerId}
          date={date}
          onDateChange={setDate}
          fetchDay={mockFetchDay}
          fetchDiagnostics={async () => ({
            date,
            ping_count: 5216,
            delivery_rate_pct: 94,
            accuracy_summary: { avg: 12 },
            low_accuracy_pct: 0.1,
            suspect_jumps: [{}],
          })}
        />
      </div>
    </main>
  );
}
