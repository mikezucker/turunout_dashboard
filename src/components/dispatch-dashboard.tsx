"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isResolvedDispatch,
  isStaleOpenDispatch,
} from "@/lib/dispatch-shared";
import type { DispatchRecord } from "@/lib/dispatch-shared";
import type { SerializedUnitProfile } from "@/lib/unit-session";

type ApiResponse = {
  fetchedAt: string;
  configured: boolean;
  upstreamStatus: number | null;
  dispatches: DispatchRecord[];
  message: string | null;
  sourceLabel: string | null;
  rawPreview?: unknown;
};

type SessionResponse = {
  authenticated: boolean;
  unit: SerializedUnitProfile | null;
};

type WeatherResponse = {
  ok: boolean;
  message: string | null;
  unit: SerializedUnitProfile | null;
};

type WorkOrdersResponse = {
  ok: boolean;
  message: string | null;
  workOrders: Array<{
    id: string;
    title: string;
    status: string | null;
  }>;
  workOrderGroups: Array<{
    apparatusApiId: string;
    displayName: string;
    workOrders: Array<{
      id: string;
      title: string;
      status: string | null;
    }>;
  }>;
};

type ScheduleResponse = {
  ok: boolean;
  message: string | null;
  date: string | null;
  entries: Array<{
    id: string;
    title: string;
    station: string | null;
    timeRange: string;
    staffing: string[];
  }>;
};

type StatsResponse = {
  ok: boolean;
  message: string | null;
  sourceLabel: string | null;
  year: number;
  liveTotalsAvailable: boolean;
  totalDepartmentCalls: number;
  totalApparatusCalls: number;
  emsCalls: number;
  fireRescueCalls: number;
  rollingWindows: Array<{
    label: string;
    days: number;
    totalDepartmentCalls: number;
    totalApparatusCalls: number;
    emsCalls: number;
    fireRescueCalls: number;
    sourceLabel: string | null;
  }>;
};

type DispatchHealthResponse = {
  ok: boolean;
  pollIntervalMs: number;
  lockTtlMs: number;
  retentionDays: number;
  listeners: number;
  revision: number;
  snapshotFetchedAt: string | null;
  snapshotUpstreamStatus: number | null;
  snapshotSourceLabel: string | null;
  database: {
    configured: boolean;
    target: string | null;
  };
  redis: {
    configured: boolean;
    subscribed: boolean;
    clientStatus: string;
    publisherStatus: string;
    subscriberStatus: string;
  };
  firstDue?: {
    apiUrl: {
      present: boolean;
      normalizedPresent: boolean;
      valid: boolean;
      valuePreview: string | null;
    };
    auth: {
      headerNamePresent: boolean;
      headerValuePresent: boolean;
      tokenPresent: boolean;
    };
    timeout: {
      present: boolean;
      normalizedPresent: boolean;
      parsedMs: number;
    };
    sessionSecretPresent: boolean;
  };
  telemetry: {
    lastRefreshStartedAt: string | null;
    lastRefreshCompletedAt: string | null;
    lastSuccessfulFetchAt: string | null;
    lastFetchDurationMs: number | null;
    lastPersistDurationMs: number | null;
    lastPersistError: string | null;
    lastRefreshDurationMs: number | null;
    lastError: string | null;
    lastResultMessage: string | null;
    lastUpstreamStatus: number | null;
  };
};

type DispatchEventsResponse = {
  ok: boolean;
  message?: string | null;
  incidentId: string;
  events: Array<{
    id: number;
    incidentId: string;
    fetchedAt: string;
    eventType: string;
    status: string | null;
    dispatch: DispatchRecord;
  }>;
};

type IdleScreen = {
  id: string;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  contentVersion?: string;
  className?: string;
  backgroundStyle?: React.CSSProperties;
  artwork?: React.ReactNode;
  scrollable?: boolean;
  content: React.ReactNode;
};

const IDLE_ROTATION_MS = Number(
  process.env.NEXT_PUBLIC_IDLE_ROTATION_MS ?? "20000",
);
const WEATHER_POLL_INTERVAL_MS = Number(
  process.env.NEXT_PUBLIC_WEATHER_POLL_INTERVAL_MS ?? "300000",
);
const DISPATCH_FALLBACK_POLL_INTERVAL_MS = Number(
  process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? "10000",
);
const STATS_POLL_INTERVAL_MS = 15 * 60 * 1000;
const HEALTH_POLL_INTERVAL_MS = 60000;
const DISPATCH_STREAM_RECONNECT_MS = 3000;
const DISPATCH_TIME_ZONE = "America/New_York";
const STATUS_BANNER_PERSIST_MS = 15000;
const STALE_FEED_WARNING_MS = 90 * 1000;
const STALE_FEED_CRITICAL_MS = 5 * 60 * 1000;
const HIGH_PRIORITY_NATURE_PATTERNS = [
  /structure fire/i,
  /commercial fire/i,
  /residential fire/i,
  /entrapment/i,
  /cardiac/i,
  /unconscious/i,
  /stroke/i,
  /chest pain/i,
  /breathing/i,
  /mva injury/i,
  /mva entrainment/i,
  /mva entrapp?ment/i,
  /burns/i,
];

function formatTime(value: string | null) {
  if (!value) {
    return "Unknown time";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: DISPATCH_TIME_ZONE,
  }).format(parsed);
}

function formatShortTime(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPATCH_TIME_ZONE,
  }).format(parsed);
}

function formatDateOnly(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: DISPATCH_TIME_ZONE,
  }).format(parsed);
}

function parseTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function formatDurationBetween(
  startValue: string | null,
  now: number,
) {
  const start = parseTimestamp(startValue);

  if (!start) {
    return "Timer unavailable";
  }

  const deltaMs = Math.max(0, now - start.getTime());
  const totalSeconds = Math.floor(deltaMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatElapsedSince(value: string | null, now: number) {
  const start = parseTimestamp(value);

  if (!start) {
    return "Unavailable";
  }

  const totalSeconds = Math.max(0, Math.floor((now - start.getTime()) / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s ago`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes}m ago`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes > 0 ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
}

function timestampValue(value: string | null) {
  const parsed = parseTimestamp(value);
  return parsed ? parsed.getTime() : Number.NEGATIVE_INFINITY;
}

function turnoutState(dispatch: DispatchRecord) {
  if (dispatch.enrouteAt) {
    return "En Route";
  }

  return "Awaiting En Route";
}

function dispatchDisplayStatus(dispatch: DispatchRecord, now: number) {
  if (isStaleOpenDispatch(dispatch, now)) {
    return "Open - Stale";
  }

  return dispatch.status ?? turnoutState(dispatch);
}

function formatDispatchLastActivity(dispatch: DispatchRecord) {
  const lastActivityAt = dispatch.lastActivityAt ?? dispatch.dispatchedAt;

  if (!lastActivityAt) {
    return "Last activity unavailable";
  }

  return `Last activity ${formatTime(lastActivityAt)}`;
}

function formatDurationMs(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Unavailable";
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  return `${(value / 1000).toFixed(1)} s`;
}

function timelineEventLabel(eventType: string) {
  switch (eventType) {
    case "created":
      return "Incident Created";
    case "status_changed":
      return "Status Changed";
    case "updated":
      return "Incident Updated";
    default:
      return eventType.replace(/_/g, " ");
  }
}

function timelineEventSummary(message: string | null, eventType: string) {
  if (!message) {
    return "No CAD notes captured.";
  }

  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "No CAD notes captured.";
  }

  if (eventType === "created") {
    return lines[0] ?? "No CAD notes captured.";
  }

  return lines.at(-1) ?? lines[0] ?? "No CAD notes captured.";
}

function eventToneClasses(eventType: string) {
  switch (eventType) {
    case "created":
      return {
        border: "border-emerald-300/24",
        badge: "bg-emerald-300/16 text-emerald-50",
        dot: "bg-emerald-300",
      };
    case "status_changed":
      return {
        border: "border-amber-300/24",
        badge: "bg-amber-300/16 text-amber-50",
        dot: "bg-amber-300",
      };
    default:
      return {
        border: "border-white/12",
        badge: "bg-white/10 text-white/78",
        dot: "bg-sky-300",
      };
  }
}

function formatRelativeEventOffset(
  dispatchAt: string | null,
  eventAt: string,
) {
  const start = timestampValue(dispatchAt);
  const eventTime = timestampValue(eventAt);

  if (!Number.isFinite(start) || !Number.isFinite(eventTime) || eventTime < start) {
    return "Offset unavailable";
  }

  const totalMinutes = Math.floor((eventTime - start) / 60000);

  if (totalMinutes < 1) {
    return "At dispatch";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `+${totalMinutes} min`;
  }

  return `+${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function dispatchPriorityScore(dispatch: DispatchRecord, now: number) {
  let score = 0;
  const status = dispatch.status?.trim().toLowerCase() ?? "";
  const nature = dispatch.nature ?? "";
  const dispatchTime = timestampValue(dispatch.dispatchedAt);
  const activityTime = timestampValue(dispatch.lastActivityAt ?? dispatch.dispatchedAt);
  const dispatchAgeMs = Number.isFinite(dispatchTime)
    ? Math.max(0, now - dispatchTime)
    : Number.POSITIVE_INFINITY;
  const activityAgeMs = Number.isFinite(activityTime)
    ? Math.max(0, now - activityTime)
    : Number.POSITIVE_INFINITY;

  if (status === "open") {
    score += 260;
  }

  if (!dispatch.enrouteAt) {
    score += 150;
  } else {
    score += 40;
  }

  if (dispatchAgeMs <= 10 * 60 * 1000) {
    score += 160;
  } else if (dispatchAgeMs <= 30 * 60 * 1000) {
    score += 90;
  }

  if (activityAgeMs <= 10 * 60 * 1000) {
    score += 120;
  } else if (activityAgeMs <= 30 * 60 * 1000) {
    score += 70;
  }

  if (HIGH_PRIORITY_NATURE_PATTERNS.some((pattern) => pattern.test(nature))) {
    score += 140;
  }

  if (isStaleOpenDispatch(dispatch, now)) {
    score -= 160;
  }

  return score;
}

function compareDispatchPriority(
  left: DispatchRecord,
  right: DispatchRecord,
  now: number,
) {
  const scoreDelta =
    dispatchPriorityScore(right, now) - dispatchPriorityScore(left, now);

  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const activityDelta =
    timestampValue(right.lastActivityAt ?? right.dispatchedAt) -
    timestampValue(left.lastActivityAt ?? left.dispatchedAt);

  if (activityDelta !== 0) {
    return activityDelta;
  }

  return timestampValue(right.dispatchedAt) - timestampValue(left.dispatchedAt);
}

function dispatchPriorityLabel(dispatch: DispatchRecord, now: number) {
  const score = dispatchPriorityScore(dispatch, now);

  if (score >= 520) {
    return "Immediate";
  }

  if (score >= 360) {
    return "Primary";
  }

  return "Monitor";
}

function weatherArtwork(summary: string) {
  const normalized = summary.toLowerCase();

  if (normalized.includes("storm") || normalized.includes("thunder")) {
    return (
      <div className="relative h-56 w-56">
        <div className="absolute left-10 top-16 h-20 w-36 rounded-full bg-white/85 blur-[1px]" />
        <div className="absolute left-2 top-28 h-16 w-44 rounded-full bg-white/75" />
        <div className="absolute left-28 top-30 h-24 w-10 skew-x-[-18deg] bg-[linear-gradient(180deg,#fde68a,#f59e0b)] [clip-path:polygon(48%_0,100%_0,62%_44%,100%_44%,28%_100%,45%_56%,0_56%)]" />
      </div>
    );
  }

  if (normalized.includes("snow") || normalized.includes("sleet") || normalized.includes("ice")) {
    return (
      <div className="relative h-56 w-56">
        <div className="absolute left-10 top-12 h-24 w-24 rounded-full bg-[rgba(255,248,220,0.88)]" />
        <div className="absolute left-16 top-28 h-16 w-40 rounded-full bg-white/85" />
        <div className="absolute left-6 top-32 h-14 w-36 rounded-full bg-white/75" />
        <div className="absolute left-14 top-44 h-4 w-4 rounded-full bg-white/90 shadow-[32px_6px_0_0_rgba(255,255,255,0.9),64px_-2px_0_0_rgba(255,255,255,0.9),96px_8px_0_0_rgba(255,255,255,0.9)]" />
      </div>
    );
  }

  if (normalized.includes("rain") || normalized.includes("shower") || normalized.includes("drizzle")) {
    return (
      <div className="relative h-56 w-56">
        <div className="absolute left-12 top-18 h-20 w-36 rounded-full bg-white/85 blur-[1px]" />
        <div className="absolute left-4 top-30 h-16 w-44 rounded-full bg-white/78" />
        <div className="absolute left-20 top-44 h-16 w-px rotate-[12deg] bg-white/75 shadow-[18px_4px_0_0_rgba(255,255,255,0.75),36px_-2px_0_0_rgba(255,255,255,0.75),54px_6px_0_0_rgba(255,255,255,0.75),72px_0_0_0_rgba(255,255,255,0.75)]" />
      </div>
    );
  }

  if (normalized.includes("cloud") || normalized.includes("overcast")) {
    return (
      <div className="relative h-56 w-56">
        <div className="absolute left-20 top-12 h-22 w-22 rounded-full bg-[rgba(255,245,200,0.72)] blur-sm" />
        <div className="absolute left-12 top-22 h-24 w-40 rounded-full bg-white/82 blur-[1px]" />
        <div className="absolute left-2 top-34 h-16 w-44 rounded-full bg-white/72" />
      </div>
    );
  }

  if (normalized.includes("wind")) {
    return (
      <div className="relative h-56 w-56">
        <div className="absolute left-10 top-24 h-px w-44 bg-white/80 shadow-[0_18px_0_0_rgba(255,255,255,0.7),0_36px_0_0_rgba(255,255,255,0.6)]" />
        <div className="absolute left-28 top-20 h-10 w-24 rounded-full border-t border-white/70" />
        <div className="absolute left-18 top-56 h-10 w-28 rounded-full border-t border-white/60" />
      </div>
    );
  }

  return (
    <div className="relative h-56 w-56">
      <div className="absolute left-10 top-10 h-28 w-28 rounded-full bg-[rgba(255,236,166,0.94)] shadow-[0_0_80px_rgba(255,236,166,0.35)]" />
      <div className="absolute left-30 top-34 h-16 w-40 rounded-full bg-white/78" />
      <div className="absolute left-18 top-40 h-12 w-32 rounded-full bg-white/64" />
    </div>
  );
}

function weatherOperationalFactors(details: string[]) {
  const findByPrefix = (prefix: string) =>
    details.find((detail) => detail.toLowerCase().startsWith(prefix));

  const alert = findByPrefix("active alerts:");
  const wind = findByPrefix("wind ") ?? findByPrefix("forecast wind ");
  const humidity = findByPrefix("relative humidity");
  const precip =
    findByPrefix("precipitation chance") ??
    details.find((detail) => detail.toLowerCase().includes("rain last hr"));

  return [
    {
      label: "Alerts",
      value: alert ? alert.replace(/^Active alerts:\s*/i, "") : "None",
      className: alert ? "border-amber-300/30 bg-amber-200/12" : "",
    },
    {
      label: "Wind",
      value: wind
        ? wind.replace(/^Forecast wind\s*/i, "").replace(/^Wind\s*/i, "")
        : "Unavailable",
      className: "",
    },
    {
      label: "Humidity",
      value: humidity
        ? humidity.replace(/^Relative humidity\s*/i, "")
        : "Unavailable",
      className: "",
    },
    {
      label: "Precip",
      value: precip
        ? precip
            .replace(/^Precipitation chance\s*/i, "")
            .replace(/\s+rain last hr$/i, " last hr")
        : "Unavailable",
      className: "",
    },
  ];
}

function activeWeatherAlert(details: string[]) {
  const alertDetail = details.find((detail) =>
    detail.toLowerCase().startsWith("active alerts:"),
  );

  return alertDetail ? alertDetail.replace(/^Active alerts:\s*/i, "") : null;
}

function companyBrand(unit: SerializedUnitProfile) {
  if (unit.id === "engine2") {
    return {
      name: "Rt 24 Express",
      monogram: "E2",
      imageSrc: "/rt24express.PNG",
      className: "border-sky-300/28 bg-sky-300/12 text-sky-50",
    };
  }

  if (unit.station === "Station 1") {
    return {
      name: "Mt. Kemble",
      monogram: "MK",
      imageSrc: null,
      className: "border-amber-300/28 bg-amber-200/12 text-amber-50",
    };
  }

  if (unit.station === "Station 2") {
    return {
      name: "Collinsville",
      monogram: "CV",
      imageSrc: null,
      className: "border-sky-300/28 bg-sky-300/12 text-sky-50",
    };
  }

  if (unit.station === "Station 3") {
    return {
      name: "Hillside",
      monogram: "HS",
      imageSrc: null,
      className: "border-emerald-300/28 bg-emerald-300/12 text-emerald-50",
    };
  }

  if (unit.station === "Station 4") {
    return {
      name: "Fairchild",
      monogram: "FC",
      imageSrc: null,
      className: "border-rose-300/28 bg-rose-300/12 text-rose-50",
    };
  }

  if (unit.station === "Station 5") {
    return {
      name: "Woodland",
      monogram: "WD",
      imageSrc: null,
      className: "border-violet-300/28 bg-violet-300/12 text-violet-50",
    };
  }

  return {
    name: unit.station,
    monogram: "MT",
    imageSrc: null,
    className: "border-white/18 bg-white/10 text-white",
  };
}

function UnitBrandBlock({ unit }: { unit: SerializedUnitProfile }) {
  const company = companyBrand(unit);

  return (
    <div className="flex items-center justify-center">
      {company.imageSrc ? (
        <div className="flex h-64 w-64 items-center justify-center overflow-hidden 2xl:h-72 2xl:w-72">
          <Image
            src={company.imageSrc}
            alt={`${company.name} logo`}
            width={288}
            height={288}
            unoptimized
            className="h-full w-full object-contain drop-shadow-[0_10px_24px_rgba(0,0,0,0.24)]"
          />
        </div>
      ) : (
        <div
          className={`flex h-24 w-24 items-center justify-center rounded-full border font-mono text-xl font-medium tracking-[0.18em] 2xl:h-28 2xl:w-28 ${company.className}`}
          aria-label={`${company.name} company badge`}
        >
          {company.monogram}
        </div>
      )}
    </div>
  );
}

function DepartmentLogo({
  subtitle,
  dark = false,
  compact = false,
}: {
  subtitle?: string;
  dark?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <Image
        src="/branding/mtfd-logo.svg"
        alt="Morris Township Fire Department logo"
        width={224}
        height={224}
        unoptimized
        className={`object-contain drop-shadow-[0_12px_28px_rgba(0,0,0,0.28)] ${
          compact ? "h-32 w-32 2xl:h-40 2xl:w-40" : "h-52 w-52 2xl:h-56 2xl:w-56"
        }`}
      />
      <div>
        <p
          className={`font-mono text-xs uppercase tracking-[0.28em] ${
            dark ? "text-white/52" : "text-[var(--signal)]"
          }`}
        >
          Morris Township Fire
        </p>
        {subtitle ? (
          <p className={`mt-1 text-sm ${dark ? "text-white/72" : "text-black/60"}`}>
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function DispatchDashboard() {
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stickyMessage, setStickyMessage] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [featuredDispatch, setFeaturedDispatch] = useState<DispatchRecord | null>(
    null,
  );
  const [unit, setUnit] = useState<SerializedUnitProfile | null>(null);
  const [workOrders, setWorkOrders] = useState<
    Array<{ id: string; title: string; status: string | null }>
  >([]);
  const [workOrderGroups, setWorkOrderGroups] = useState<
    WorkOrdersResponse["workOrderGroups"]
  >([]);
  const [workOrdersMessage, setWorkOrdersMessage] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string | null>(null);
  const [scheduleEntries, setScheduleEntries] = useState<
    ScheduleResponse["entries"]
  >([]);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const [statsYear, setStatsYear] = useState<number>(new Date().getFullYear());
  const [liveStatsAvailable, setLiveStatsAvailable] = useState(false);
  const [totalDepartmentCalls, setTotalDepartmentCalls] = useState(0);
  const [totalApparatusCalls, setTotalApparatusCalls] = useState(0);
  const [emsCalls, setEmsCalls] = useState(0);
  const [fireRescueCalls, setFireRescueCalls] = useState(0);
  const [rollingWindows, setRollingWindows] = useState<StatsResponse["rollingWindows"]>(
    [],
  );
  const [statsMessage, setStatsMessage] = useState<string | null>(null);
  const [statsSourceLabel, setStatsSourceLabel] = useState<string | null>(null);
  const [dispatchHealth, setDispatchHealth] = useState<DispatchHealthResponse | null>(
    null,
  );
  const [dispatchHealthMessage, setDispatchHealthMessage] = useState<string | null>(
    null,
  );
  const [timelineEvents, setTimelineEvents] = useState<
    DispatchEventsResponse["events"]
  >([]);
  const [timelineMessage, setTimelineMessage] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [loginUnitId, setLoginUnitId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [idleScreenIndex, setIdleScreenIndex] = useState(0);
  const [weatherRadarFrameIndex, setWeatherRadarFrameIndex] = useState(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const idleContentRef = useRef<HTMLDivElement | null>(null);
  const workOrdersListRef = useRef<HTMLDivElement | null>(null);
  const timelineListRef = useRef<HTMLDivElement | null>(null);
  const stickyMessageTimeoutRef = useRef<number | null>(null);
  const unitId = unit?.id ?? null;
  const unitApparatusApiId = unit?.apparatusApiId ?? null;
  const isStationScope = unit?.scopeKind === "station";
  const unitScopeLabel = isStationScope ? "Station" : "Unit";
  const responseLabel = isStationScope ? "Company" : "Apparatus";
  const responseLabelPlural = isStationScope ? "companies" : "apparatus";
  const unitMembershipSummary =
    unit?.memberUnitDisplayNames.length
      ? unit.memberUnitDisplayNames.join(" / ")
      : unit
        ? `${unit.apparatus} / ${unit.station} / ${unit.radioName}`
        : "";

  function applyDispatchUpdate(data: ApiResponse) {
    setConfigured(data.configured);
    setFetchedAt(data.fetchedAt);
    setMessage(data.message);
    setSourceLabel(data.sourceLabel);
    setDispatches(data.dispatches);

    const nextSeenIds = new Set(seenIdsRef.current);
    let latestNewDispatch: DispatchRecord | null = null;

    for (const dispatch of data.dispatches) {
      if (isResolvedDispatch(dispatch) || isStaleOpenDispatch(dispatch)) {
        continue;
      }

      if (!nextSeenIds.has(dispatch.id) && !latestNewDispatch) {
        latestNewDispatch = dispatch;
      }

      nextSeenIds.add(dispatch.id);
    }

    seenIdsRef.current = nextSeenIds;

    setFeaturedDispatch((current) => {
      if (latestNewDispatch) {
        return latestNewDispatch;
      }

      if (!current) {
        return null;
      }

      return (
        data.dispatches.find(
          (dispatch) =>
            dispatch.id === current.id &&
            !isResolvedDispatch(dispatch) &&
            !isStaleOpenDispatch(dispatch),
        ) ?? null
      );
    });
  }
  const activeDispatches = useMemo(
    () =>
      dispatches.filter(
        (dispatch) => !isResolvedDispatch(dispatch),
      ),
    [dispatches],
  );
  const freshDispatches = useMemo(
    () =>
      activeDispatches
        .filter((dispatch) => !isStaleOpenDispatch(dispatch, now))
        .sort((left, right) => compareDispatchPriority(left, right, now)),
    [activeDispatches, now],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (stickyMessageTimeoutRef.current !== null) {
        window.clearTimeout(stickyMessageTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!message) {
      return;
    }

    setStickyMessage(message);

    if (stickyMessageTimeoutRef.current !== null) {
      window.clearTimeout(stickyMessageTimeoutRef.current);
    }

    stickyMessageTimeoutRef.current = window.setTimeout(() => {
      setStickyMessage((current) => (current === message ? null : current));
      stickyMessageTimeoutRef.current = null;
    }, STATUS_BANNER_PERSIST_MS);
  }, [message]);

  useEffect(() => {
    setWeatherRadarFrameIndex(0);
  }, [unit?.weatherRadarFrameImageUrls]);

  useEffect(() => {
    const frameCount = unit?.weatherRadarFrameImageUrls.length ?? 0;

    if (frameCount <= 1) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setWeatherRadarFrameIndex((current) => (current + 1) % frameCount);
    }, 900);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [unit?.weatherRadarFrameImageUrls]);

  useEffect(() => {
    let active = true;

    async function loadSession() {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        const data = (await response.json()) as SessionResponse;

        if (!active) {
          return;
        }

        setUnit(data.authenticated ? data.unit : null);
      } finally {
        if (active) {
          setSessionReady(true);
        }
      }
    }

    loadSession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!unitId) {
      setConfigured(true);
      return;
    }

    let active = true;
    let eventSource: EventSource | null = null;
    let reconnectTimeoutId: number | null = null;
    let fetchInFlight = false;
    let streamConnected = false;

    async function loadDispatches() {
      if (fetchInFlight) {
        return;
      }

      fetchInFlight = true;

      try {
        const response = await fetch("/api/dispatches", { cache: "no-store" });
        const data = (await response.json()) as ApiResponse;

        if (!active) {
          return;
        }

        applyDispatchUpdate(data);
      } catch (error) {
        if (!active) {
          return;
        }

        setMessage(
          error instanceof Error ? error.message : "Dispatch request failed.",
        );
      } finally {
        fetchInFlight = false;
      }
    }

    function clearReconnectTimeout() {
      if (reconnectTimeoutId !== null) {
        window.clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
      }
    }

    function scheduleStreamReconnect() {
      if (!active || reconnectTimeoutId !== null || document.visibilityState !== "visible") {
        return;
      }

      reconnectTimeoutId = window.setTimeout(() => {
        reconnectTimeoutId = null;

        if (!active) {
          return;
        }

        connectDispatchStream();
      }, DISPATCH_STREAM_RECONNECT_MS);
    }

    function connectDispatchStream() {
      if (document.visibilityState !== "visible") {
        return;
      }

      clearReconnectTimeout();
      eventSource?.close();
      streamConnected = false;
      eventSource = new EventSource("/api/dispatch-stream");
      eventSource.onopen = () => {
        if (!active) {
          return;
        }

        streamConnected = true;
        setMessage((current) =>
          current === "Live dispatch stream reconnecting." ? null : current,
        );
      };
      eventSource.addEventListener("dispatch", (event) => {
        if (!active) {
          return;
        }

        const data = JSON.parse((event as MessageEvent<string>).data) as ApiResponse;
        applyDispatchUpdate(data);
      });
      eventSource.onerror = () => {
        if (!active) {
          return;
        }

        streamConnected = false;
        setMessage("Live dispatch stream reconnecting.");
        eventSource?.close();
        scheduleStreamReconnect();
      };
    }

    function refreshDispatchesIfVisible(force = false) {
      if (!force && document.visibilityState !== "visible") {
        return;
      }

      void loadDispatches();
    }

    function refreshDispatchesIfStreamUnavailable() {
      if (streamConnected) {
        return;
      }

      refreshDispatchesIfVisible();
    }

    void loadDispatches();
    connectDispatchStream();
    const pollIntervalId = window.setInterval(() => {
      refreshDispatchesIfStreamUnavailable();
    }, DISPATCH_FALLBACK_POLL_INTERVAL_MS);
    const refreshOnFocus = () => {
      if (!streamConnected && document.visibilityState === "visible") {
        connectDispatchStream();
      }

      refreshDispatchesIfVisible(true);
    };
    const refreshOnVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        connectDispatchStream();
      } else {
        clearReconnectTimeout();
        streamConnected = false;
        eventSource?.close();
      }

      refreshDispatchesIfVisible();
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibilityChange);

    return () => {
      active = false;
      streamConnected = false;
      clearReconnectTimeout();
      window.clearInterval(pollIntervalId);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibilityChange);
      eventSource?.close();
    };
  }, [unitId]);

  useEffect(() => {
    if (!unitId) {
      setWorkOrders([]);
      setWorkOrderGroups([]);
      setWorkOrdersMessage(null);
      return;
    }

    let active = true;

    async function loadWorkOrders() {
      try {
        const response = await fetch("/api/unit-work-orders", {
          cache: "no-store",
        });
        const data = (await response.json()) as WorkOrdersResponse;

        if (!active) {
          return;
        }

        setWorkOrders(data.workOrders);
        setWorkOrderGroups(data.workOrderGroups);
        setWorkOrdersMessage(data.message);
      } catch (error) {
        if (!active) {
          return;
        }

        setWorkOrders([]);
        setWorkOrderGroups([]);
        setWorkOrdersMessage(
          error instanceof Error ? error.message : "Failed to load work orders.",
        );
      }
    }

    loadWorkOrders();
    const intervalId = window.setInterval(loadWorkOrders, 60000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [unitApparatusApiId, unitId]);

  useEffect(() => {
    if (!unitId) {
      return;
    }

    let active = true;

    async function loadWeather() {
      try {
        const response = await fetch("/api/weather", {
          cache: "no-store",
        });
        const data = (await response.json()) as WeatherResponse;

        if (!active || !data.unit) {
          return;
        }

        setUnit(data.unit);
      } catch {
        if (!active) {
          return;
        }
      }
    }

    loadWeather();
    const intervalId = window.setInterval(loadWeather, WEATHER_POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [unitId]);

  useEffect(() => {
    if (!unitId) {
      setScheduleDate(null);
      setScheduleEntries([]);
      setScheduleMessage(null);
      return;
    }

    let active = true;

    async function loadSchedule() {
      try {
        const response = await fetch("/api/schedule", {
          cache: "no-store",
        });
        const data = (await response.json()) as ScheduleResponse;

        if (!active) {
          return;
        }

        setScheduleDate(data.date);
        setScheduleEntries(data.entries);
        setScheduleMessage(data.message);
      } catch (error) {
        if (!active) {
          return;
        }

        setScheduleDate(null);
        setScheduleEntries([]);
        setScheduleMessage(
          error instanceof Error ? error.message : "Failed to load schedule.",
        );
      }
    }

    loadSchedule();
    const intervalId = window.setInterval(loadSchedule, 300000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [unitId]);

  useEffect(() => {
    if (!unitId) {
      setStatsYear(new Date().getFullYear());
      setLiveStatsAvailable(false);
      setTotalDepartmentCalls(0);
      setTotalApparatusCalls(0);
      setEmsCalls(0);
      setFireRescueCalls(0);
      setRollingWindows([]);
      setStatsMessage(null);
      setStatsSourceLabel(null);
      setDispatchHealth(null);
      setDispatchHealthMessage(null);
      setTimelineEvents([]);
      setTimelineMessage(null);
      return;
    }

    let active = true;

    async function loadStats() {
      try {
        const response = await fetch("/api/stats", {
          cache: "no-store",
        });
        const data = (await response.json()) as StatsResponse;

        if (!active) {
          return;
        }

        setStatsYear(data.year);
        setLiveStatsAvailable(data.liveTotalsAvailable);
        setTotalDepartmentCalls(data.totalDepartmentCalls);
        setTotalApparatusCalls(data.totalApparatusCalls);
        setEmsCalls(data.emsCalls);
        setFireRescueCalls(data.fireRescueCalls);
        setRollingWindows(data.rollingWindows);
        setStatsMessage(data.message);
        setStatsSourceLabel(data.sourceLabel);
      } catch (error) {
        if (!active) {
          return;
        }

        setStatsYear(new Date().getFullYear());
        setLiveStatsAvailable(false);
        setTotalDepartmentCalls(0);
        setTotalApparatusCalls(0);
        setEmsCalls(0);
        setFireRescueCalls(0);
        setRollingWindows([]);
        setStatsSourceLabel(null);
        setStatsMessage(
          error instanceof Error ? error.message : "Failed to load statistics.",
        );
      }
    }

    loadStats();
    const intervalId = window.setInterval(loadStats, STATS_POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [unitId]);

  useEffect(() => {
    if (!unitId) {
      setDispatchHealth(null);
      setDispatchHealthMessage(null);
      return;
    }

    let active = true;

    async function loadDispatchHealth() {
      try {
        const response = await fetch("/api/dispatch-health", {
          cache: "no-store",
        });
        const data = (await response.json()) as
          | DispatchHealthResponse
          | { ok?: boolean; message?: string };
        const responseMessage = "message" in data ? data.message : null;

        if (!active) {
          return;
        }

        if (!response.ok || !("telemetry" in data)) {
          setDispatchHealth(null);
          setDispatchHealthMessage(responseMessage ?? "Dispatch diagnostics unavailable.");
          return;
        }

        setDispatchHealth(data);
        setDispatchHealthMessage(null);
      } catch (error) {
        if (!active) {
          return;
        }

        setDispatchHealth(null);
        setDispatchHealthMessage(
          error instanceof Error ? error.message : "Dispatch diagnostics unavailable.",
        );
      }
    }

    void loadDispatchHealth();
    const intervalId = window.setInterval(loadDispatchHealth, HEALTH_POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [unitId]);

  const primaryDispatch = useMemo(() => {
    if (
      featuredDispatch &&
      freshDispatches.some((dispatch) => dispatch.id === featuredDispatch.id)
    ) {
      const matchedDispatch = freshDispatches.find(
        (dispatch) => dispatch.id === featuredDispatch.id,
      );

      if (matchedDispatch) {
        return matchedDispatch;
      }
    }

    return freshDispatches[0] ?? null;
  }, [featuredDispatch, freshDispatches]);
  const additionalDispatches = useMemo(() => {
    if (!primaryDispatch) {
      return freshDispatches;
    }

    return freshDispatches.filter((dispatch) => dispatch.id !== primaryDispatch.id);
  }, [freshDispatches, primaryDispatch]);

  const featuredElapsed = useMemo(
    () => formatDurationBetween(primaryDispatch?.dispatchedAt ?? null, now),
    [primaryDispatch?.dispatchedAt, now],
  );
  const lastHealthyFetchAt = dispatchHealth?.telemetry.lastSuccessfulFetchAt ?? fetchedAt;
  const staleFeedAgeMs = useMemo(() => {
    const parsed = parseTimestamp(lastHealthyFetchAt);
    return parsed ? Math.max(0, now - parsed.getTime()) : null;
  }, [lastHealthyFetchAt, now]);
  const staleFeedLevel = staleFeedAgeMs === null
    ? "unknown"
    : staleFeedAgeMs >= STALE_FEED_CRITICAL_MS
      ? "critical"
      : staleFeedAgeMs >= STALE_FEED_WARNING_MS
        ? "warning"
        : "healthy";
  const staleFeedMessage =
    staleFeedLevel === "critical"
      ? `Live dispatch feed is stale. Last healthy refresh ${formatElapsedSince(lastHealthyFetchAt, now)}.`
      : staleFeedLevel === "warning"
        ? `Live dispatch feed is delayed. Last healthy refresh ${formatElapsedSince(lastHealthyFetchAt, now)}.`
        : null;
  useEffect(() => {
    if (!unitId || !primaryDispatch?.id) {
      setTimelineEvents([]);
      setTimelineMessage(null);
      return;
    }

    let active = true;

    async function loadTimeline() {
      try {
        const url = new URL("/api/dispatch-events", window.location.origin);
        url.searchParams.set("incidentId", primaryDispatch.id);

        const response = await fetch(url.toString(), { cache: "no-store" });
        const data = (await response.json()) as
          | DispatchEventsResponse
          | { ok?: boolean; message?: string };
        const responseMessage = "message" in data ? data.message : null;

        if (!active) {
          return;
        }

        if (!response.ok || !("events" in data)) {
          setTimelineEvents([]);
          setTimelineMessage(responseMessage ?? "Timeline unavailable.");
          return;
        }

        setTimelineEvents(data.events);
        setTimelineMessage(null);
      } catch (error) {
        if (!active) {
          return;
        }

        setTimelineEvents([]);
        setTimelineMessage(
          error instanceof Error ? error.message : "Timeline unavailable.",
        );
      }
    }

    void loadTimeline();

    return () => {
      active = false;
    };
  }, [fetchedAt, primaryDispatch?.id, unitId]);
  useEffect(() => {
    if (!unitId || primaryDispatch) {
      setIdleScreenIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setIdleScreenIndex((current) => current + 1);
    }, IDLE_ROTATION_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [primaryDispatch, unitId]);
  const weatherFactors = useMemo(
    () => (unit ? weatherOperationalFactors(unit.weatherDetails) : []),
    [unit],
  );
  const flashingWeatherAlert = useMemo(
    () => (unit ? activeWeatherAlert(unit.weatherDetails) : null),
    [unit],
  );
  const activeWeatherRadarImageUrl = useMemo(() => {
    if (!unit) {
      return null;
    }

    if (unit.weatherRadarFrameImageUrls.length > 0) {
      return (
        unit.weatherRadarFrameImageUrls[
          weatherRadarFrameIndex % unit.weatherRadarFrameImageUrls.length
        ] ?? unit.weatherRadarImageUrl
      );
    }

    return unit.weatherRadarImageUrl;
  }, [unit, weatherRadarFrameIndex]);
  const recentTimelineEvents = useMemo(
    () => [...timelineEvents].slice(-6).reverse(),
    [timelineEvents],
  );
  const statsUnavailable = !liveStatsAvailable;
  const idleScreens = useMemo<IdleScreen[]>(() => {
    if (!unit) {
      return [];
    }

    const visibleScheduleEntries =
      scheduleEntries.length > 0
        ? scheduleEntries
        : [
            {
              id: "empty-schedule",
              title: "No daily schedule listed",
              station: null,
              timeRange: "Schedule unavailable",
              staffing: [],
            },
          ];

    const workOrderScreenGroups =
      workOrderGroups.length > 1
        ? workOrderGroups
        : [
            {
              apparatusApiId: unit.apparatusApiId ?? unit.id,
              displayName: unit.displayName,
              workOrders,
            },
          ];

    const workOrderScreens = workOrderScreenGroups.map((group) => {
      const hasMultipleGroups = workOrderScreenGroups.length > 1;

      return {
        id: `work-orders:${group.apparatusApiId}`,
        label: "Work Orders",
        eyebrow: hasMultipleGroups ? `${group.displayName} Queue` : "Maintenance Queue",
        title: hasMultipleGroups
          ? `${group.displayName} Work Orders`
          : `${unit.displayName} ${responseLabel} Work Orders`,
        description: hasMultipleGroups
          ? `${group.workOrders.length} item${group.workOrders.length === 1 ? "" : "s"} currently open for ${group.displayName}.`
          : `${
              workOrders.length
            } item${workOrders.length === 1 ? "" : "s"} currently open for this ${isStationScope ? "station" : "unit"}.${
              unit.coverageDisplayName ? ` Covered by ${unit.coverageDisplayName}.` : ""
            }`,
        contentVersion: `work-orders:${group.apparatusApiId}:${group.workOrders.length}:${workOrdersMessage ?? ""}`,
        scrollable: true,
        backgroundStyle: {
          background:
            "radial-gradient(circle at top left, rgba(255,215,160,0.28), transparent 30%), linear-gradient(135deg, rgba(118,76,39,0.98), rgba(56,37,24,0.96))",
        },
        artwork: (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -right-16 top-12 h-80 w-80 rounded-full border border-white/10" />
            <div className="absolute -right-4 top-24 h-56 w-56 rounded-full border-[24px] border-white/6" />
            <div className="absolute right-24 top-40 h-16 w-16 rounded-full border-[10px] border-white/10" />
            <div className="absolute bottom-16 right-10 h-48 w-[24rem] rotate-[-12deg] rounded-[2rem] border border-white/8 bg-white/4" />
            <div className="absolute bottom-28 right-28 h-3 w-32 rounded-full bg-white/10" />
            <div className="absolute bottom-40 right-24 h-3 w-48 rounded-full bg-white/8" />
          </div>
        ),
        content: (
          <div className="grid h-full min-h-0 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
            <div ref={workOrdersListRef} className="min-h-0 overflow-y-auto pr-3">
              <ul className="grid gap-4">
                {group.workOrders.length > 0 ? (
                  group.workOrders.map((order) => (
                    <li
                      key={`${group.apparatusApiId}:${order.id}`}
                      className="rounded-[1.8rem] border border-white/12 bg-white/6 px-8 py-7"
                    >
                      <p className="text-[2.15rem] font-medium leading-tight text-white">{order.title}</p>
                      {order.status ? (
                        <p className="mt-4 font-mono text-sm uppercase tracking-[0.18em] text-white/56">
                          {order.status}
                        </p>
                      ) : null}
                    </li>
                  ))
                ) : (
                  <li className="rounded-[1.8rem] border border-emerald-300/18 bg-emerald-300/8 px-8 py-9">
                    <p className="font-mono text-sm uppercase tracking-[0.24em] text-emerald-100/72">
                      Queue Clear
                    </p>
                    <p className="mt-4 text-[2.15rem] font-medium leading-tight text-white">
                      {hasMultipleGroups
                        ? `There are no active work orders for ${group.displayName}.`
                        : `There are no active work orders for ${isStationScope ? "these apparatus" : "this apparatus"}.`}
                    </p>
                  </li>
                )}
              </ul>
            </div>
            <div className="self-start rounded-[2rem] border border-white/16 bg-white/10 px-8 py-8">
              <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                Queue Status
              </p>
              <p className="mt-5 text-[5.25rem] font-semibold tracking-[-0.06em] text-white">
                {group.workOrders.length}
              </p>
              <p className="mt-3 text-xl text-white/72">Open work orders</p>
              <p className="mt-8 text-lg leading-8 text-white/72">
                {workOrdersMessage ??
                  (hasMultipleGroups
                    ? `Work orders are loading from the configured ${group.displayName} feed.`
                    : `Work orders are loading from the configured ${isStationScope ? "station company" : "apparatus"} feed.`)}
              </p>
            </div>
          </div>
        ),
      };
    });

    return [
      ...workOrderScreens,
      {
        id: "weather",
        label: "Weather",
        eyebrow: flashingWeatherAlert ? "Active Weather Alert" : "Weather Brief",
        title: "Current Weather",
        description: unit.weatherUpdatedAt
          ? `Last updated ${formatTime(unit.weatherUpdatedAt)}`
          : "Awaiting live weather update.",
        backgroundStyle: {
          background:
            flashingWeatherAlert
              ? "radial-gradient(circle at 18% 20%, rgba(255,255,255,0.22), transparent 16%), radial-gradient(circle at 80% 18%, rgba(255,145,145,0.3), transparent 18%), radial-gradient(circle at 70% 78%, rgba(255,110,110,0.22), transparent 24%), linear-gradient(145deg, rgba(136,30,36,0.98), rgba(178,38,44,0.94) 55%, rgba(90,18,24,0.96))"
              : "radial-gradient(circle at 18% 20%, rgba(255,255,255,0.24), transparent 16%), radial-gradient(circle at 80% 18%, rgba(184,228,255,0.3), transparent 18%), radial-gradient(circle at 70% 78%, rgba(108,205,255,0.24), transparent 24%), linear-gradient(145deg, rgba(27,98,132,0.98), rgba(42,144,166,0.94) 55%, rgba(17,70,98,0.96))",
        },
        artwork: (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute right-10 top-8 h-32 w-32 rounded-full bg-[rgba(255,236,166,0.24)] blur-2xl" />
            <div className="absolute right-20 top-16 h-24 w-24 rounded-full bg-[rgba(255,244,201,0.3)]" />
            <div className="absolute left-[8%] top-[16%] h-24 w-52 rounded-full bg-white/10 blur-sm" />
            <div className="absolute left-[15%] top-[20%] h-20 w-40 rounded-full bg-white/12 blur-sm" />
            <div className="absolute left-[58%] top-[30%] h-20 w-44 rounded-full bg-white/10 blur-sm" />
            <div className="absolute left-[63%] top-[35%] h-16 w-36 rounded-full bg-white/12 blur-sm" />
            <div className="absolute bottom-0 left-[14%] h-64 w-px bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0.18),rgba(255,255,255,0))]" />
            <div className="absolute bottom-0 left-[18%] h-72 w-px bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0.14),rgba(255,255,255,0))]" />
            <div className="absolute bottom-0 left-[72%] h-56 w-px bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0.18),rgba(255,255,255,0))]" />
            <div className="absolute bottom-0 left-[76%] h-64 w-px bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0.14),rgba(255,255,255,0))]" />
          </div>
        ),
        content: (
          <div className="grid min-h-0 content-start items-start gap-6 xl:grid-cols-[minmax(340px,0.84fr)_minmax(500px,1.16fr)]">
            <div className="min-h-0 self-start rounded-[2rem] border border-white/12 bg-white/6 px-7 py-7 backdrop-blur-sm">
              {flashingWeatherAlert ? (
                <div className="animate-pulse rounded-[1.5rem] border border-red-300/50 bg-red-500/24 px-6 py-4 shadow-[0_0_40px_rgba(248,113,113,0.18)]">
                  <p className="font-mono text-sm uppercase tracking-[0.28em] text-red-50">
                    Weather Warning
                  </p>
                  <p className="mt-2 text-[2.1rem] font-semibold leading-tight text-white">
                    {flashingWeatherAlert}
                  </p>
                </div>
              ) : null}
              <div
                className={`flex flex-col gap-5 ${
                  flashingWeatherAlert ? "mt-5" : ""
                }`}
              >
                <div className="flex flex-col gap-4 rounded-[1.6rem] border border-white/16 bg-white/10 px-6 py-5 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/58">
                      Current Weather
                    </p>
                    <p className="mt-4 text-[2.55rem] font-semibold leading-tight text-white 2xl:text-[3.1rem]">
                      {unit.weatherSummary}
                    </p>
                    <p className="mt-3 text-xl text-white/68">
                      {unit.weatherLocation}
                    </p>
                  </div>
                  <div className="md:max-w-[18rem] md:text-right">
                    <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                      Last Updated
                    </p>
                    <p className="mt-4 text-[1.65rem] font-medium text-white 2xl:text-[1.9rem]">
                      {unit.weatherUpdatedAt
                        ? formatTime(unit.weatherUpdatedAt)
                        : "Awaiting live weather"}
                    </p>
                    <p className="mt-3 text-base text-white/64">
                      {unit.weatherSourceLabel ?? "Weather source not configured"}
                    </p>
                  </div>
                </div>
                {!unit.weatherRadarImageUrl && !unit.weatherRadarPageUrl ? (
                  <div className="flex justify-center xl:justify-start">
                    {weatherArtwork(unit.weatherSummary)}
                  </div>
                ) : null}
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {weatherFactors.map((factor) => (
                  <div
                    key={factor.label}
                    className={`rounded-[1.4rem] border border-white/16 bg-white/10 px-5 py-4 ${
                      factor.label === "Alerts" && flashingWeatherAlert
                        ? "animate-pulse border-red-300/55 bg-red-500/26 shadow-[0_0_30px_rgba(248,113,113,0.16)]"
                        : factor.className
                    }`}
                  >
                    <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/56">
                      {factor.label}
                    </p>
                    <p className="mt-2 text-[1.6rem] font-medium leading-tight text-white">
                      {factor.value}
                    </p>
                  </div>
                ))}
              </div>
              <ul className="mt-5 grid gap-3 text-[1.55rem] leading-tight text-white/88 2xl:text-[1.8rem]">
                {(unit.weatherDetails.length > 0
                  ? unit.weatherDetails
                  : ["No weather details configured"]).slice(0, 4).map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </div>
            <div className="min-h-0 self-start rounded-[2rem] border border-white/16 bg-white/10 px-7 py-7">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                  Radar
                </p>
                <p className="text-sm text-white/60">Centered on Morris Township</p>
              </div>
              <div className="mt-5 overflow-hidden rounded-[1.7rem] border border-white/16 bg-white/10">
                {activeWeatherRadarImageUrl ? (
                  <a
                    href={unit.weatherRadarPageUrl ?? activeWeatherRadarImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activeWeatherRadarImageUrl}
                      alt={`${unit.weatherLocation} radar loop`}
                      className="h-[clamp(22rem,40vh,32rem)] w-full object-cover"
                      style={{ objectPosition: "50% 50%" }}
                    />
                  </a>
                ) : (
                  <div className="flex h-[clamp(22rem,40vh,32rem)] items-center justify-center px-8 text-center text-[1.45rem] text-white/68">
                    Radar feed unavailable for this location.
                  </div>
                )}
              </div>
              <p className="mt-4 text-lg leading-8 text-white/64">
                NOAA radar loop for Morristown area coverage.
              </p>
              <p className="mt-2 text-sm text-white/48">
                Radar imagery by the National Weather Service.
              </p>
            </div>
          </div>
        ),
      },
      {
        id: "schedule",
        label: "Schedule",
        eyebrow: "Current Schedule",
        title: scheduleDate
          ? `Daily Staffing for ${formatDateOnly(`${scheduleDate}T12:00:00`)}` 
          : "Daily Staffing Schedule",
        description:
          scheduleMessage ??
          "Current staffed assignments from the FirstDue daily schedule across all stations.",
        contentVersion: `schedule:${scheduleDate ?? ""}:${scheduleEntries.length}:${scheduleMessage ?? ""}`,
        scrollable: true,
        backgroundStyle: {
          background:
            "radial-gradient(circle at top right, rgba(255,255,255,0.14), transparent 18%), linear-gradient(135deg, rgba(52,44,92,0.98), rgba(33,67,128,0.94) 58%, rgba(21,38,79,0.96))",
        },
        artwork: (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute right-16 top-14 h-[32rem] w-[32rem] rounded-full border border-white/6" />
            <div className="absolute right-28 top-28 h-[22rem] w-[22rem] rounded-full border border-white/6" />
            <div className="absolute bottom-14 left-10 h-64 w-64 rotate-45 rounded-[2rem] border border-white/6" />
            <div className="absolute left-16 top-24 h-px w-[28rem] bg-white/8" />
            <div className="absolute left-16 top-40 h-px w-[22rem] bg-white/8" />
            <div className="absolute left-16 top-56 h-px w-[26rem] bg-white/8" />
          </div>
        ),
        content: (
          <div className="grid h-full content-start gap-4">
            {visibleScheduleEntries.map((entry) => (
              <div
                key={entry.id}
                className="grid gap-4 rounded-[1.8rem] border border-white/12 bg-white/6 px-8 py-7 md:grid-cols-[160px_minmax(0,1fr)]"
              >
                <p className="font-mono text-[2.8rem] uppercase tracking-[0.2em] text-white/64">
                  {entry.timeRange}
                </p>
                <div>
                  <p className="text-[2.9rem] font-medium leading-tight text-white">{entry.title}</p>
                  <p className="mt-2 text-[1.85rem] text-white/80">
                    {entry.station ? `${entry.station} / ` : ""}
                    {entry.staffing.length > 0
                      ? entry.staffing.join(" • ")
                      : "No staffing listed"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ),
      },
      {
        id: "stats",
        label: "Stats",
        eyebrow: "Department Activity",
        title: `${statsYear} Call Statistics`,
        description:
          statsMessage ??
          `Year-to-date department call volume with ${unit.displayName} ${responseLabel.toLowerCase()} totals, plus rolling recent windows from FirstDue history.`,
        contentVersion: `stats:${statsYear}:${totalDepartmentCalls}:${totalApparatusCalls}:${emsCalls}:${fireRescueCalls}:${rollingWindows.map((window) => `${window.days}:${window.totalDepartmentCalls}:${window.totalApparatusCalls}`).join("|")}:${statsMessage ?? ""}`,
        backgroundStyle: {
          background:
            "radial-gradient(circle at top left, rgba(255,255,255,0.14), transparent 20%), radial-gradient(circle at 82% 16%, rgba(102,232,180,0.22), transparent 18%), linear-gradient(140deg, rgba(25,92,82,0.98), rgba(19,54,63,0.94) 52%, rgba(15,33,41,0.96))",
        },
        artwork: (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute left-10 top-20 h-px w-64 bg-white/10" />
            <div className="absolute left-10 top-28 h-px w-80 bg-white/7" />
            <div className="absolute right-16 top-16 h-64 w-64 rounded-full border border-white/8" />
            <div className="absolute right-28 top-28 h-40 w-40 rounded-full border border-emerald-300/10" />
            <div className="absolute bottom-18 left-14 h-56 w-56 rounded-[2rem] border border-white/6" />
          </div>
        ),
        content: (
          <div className="grid min-h-0 content-start items-start gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)] xl:items-start">
            <div className="grid auto-rows-min gap-5 md:grid-cols-2">
              <div className="self-start rounded-[2rem] border border-white/12 bg-white/7 px-8 py-7">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                  Total Dept. Calls
                </p>
                <p className="mt-4 text-[5.1rem] font-semibold tracking-[-0.06em] text-white">
                  {statsUnavailable ? "Unavailable" : totalDepartmentCalls}
                </p>
                <p className="mt-4 text-xl text-white/68">Year to date</p>
              </div>
              <div className="self-start rounded-[2rem] border border-white/12 bg-white/7 px-8 py-7">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                  {`Total ${responseLabel} Calls`}
                </p>
                <p className="mt-4 text-[5.1rem] font-semibold tracking-[-0.06em] text-white">
                  {statsUnavailable ? "Unavailable" : totalApparatusCalls}
                </p>
                <p className="mt-4 text-xl text-white/68">{unit.displayName} year to date</p>
              </div>
              <div className="self-start rounded-[2rem] border border-red-300/16 bg-red-300/8 px-8 py-7">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-red-50/72">
                  Fire
                </p>
                <p className="mt-4 text-[5.1rem] font-semibold tracking-[-0.06em] text-white">
                  {statsUnavailable ? "Unavailable" : fireRescueCalls}
                </p>
                <p className="mt-4 text-xl text-white/68">Department fire/rescue incidents</p>
              </div>
              <div className="self-start rounded-[2rem] border border-sky-300/16 bg-sky-300/8 px-8 py-7">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-sky-50/72">
                  EMS
                </p>
                <p className="mt-4 text-[5.1rem] font-semibold tracking-[-0.06em] text-white">
                  {statsUnavailable ? "Unavailable" : emsCalls}
                </p>
                <p className="mt-4 text-xl text-white/68">Department EMS incidents</p>
              </div>
            </div>
            <div className="self-start rounded-[2rem] border border-white/16 bg-white/10 px-8 py-8">
              <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                Stats Summary
              </p>
              <div className="mt-6 grid gap-4">
                <div className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/54">
                    Department Split
                  </p>
                  <p className="mt-3 text-[1.9rem] font-medium leading-tight text-white">
                    {statsUnavailable
                      ? "Live totals unavailable"
                      : `${fireRescueCalls} Fire / ${emsCalls} EMS`}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/54">
                    {`${responseLabel} Share`}
                  </p>
                  <p className="mt-3 text-[1.9rem] font-medium leading-tight text-white">
                    {statsUnavailable
                      ? "Live totals unavailable"
                      : totalDepartmentCalls > 0
                      ? `${Math.round((totalApparatusCalls / totalDepartmentCalls) * 100)}% of department calls`
                      : "No department calls counted yet"}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/54">
                    Recent Windows
                  </p>
                  <div className="mt-4 grid gap-3">
                    {rollingWindows.map((window) => (
                      <div
                        key={window.label}
                        className="rounded-[1.1rem] border border-white/14 bg-white/8 px-4 py-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-[1.35rem] font-medium text-white">
                              {window.label}
                            </p>
                            <p className="mt-1 text-sm text-white/62">
                              {window.totalDepartmentCalls} dept. / {window.totalApparatusCalls} {responseLabelPlural}
                            </p>
                          </div>
                          <p className="font-mono text-xs uppercase tracking-[0.18em] text-white/48">
                            {window.fireRescueCalls} Fire · {window.emsCalls} EMS
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/54">
                    Source
                  </p>
                  <p className="mt-3 text-xl leading-8 text-white/78">
                    {statsMessage ??
                      rollingWindows[0]?.sourceLabel ??
                      statsSourceLabel ??
                      "Stats feed not configured"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ),
      },
      {
        id: "health",
        label: "Diagnostics",
        eyebrow: "System Health",
        title: "Dispatch feed diagnostics",
        description:
          dispatchHealthMessage ??
          (dispatchHealth?.telemetry.lastError ??
            "Current poller, persistence, and shared-store status."),
        contentVersion: `health:${dispatchHealth?.revision ?? 0}:${dispatchHealth?.snapshotFetchedAt ?? ""}:${dispatchHealth?.telemetry.lastFetchDurationMs ?? "na"}:${dispatchHealth?.telemetry.lastPersistDurationMs ?? "na"}:${dispatchHealthMessage ?? ""}`,
        backgroundStyle: {
          background:
            "radial-gradient(circle at top right, rgba(255,255,255,0.14), transparent 18%), radial-gradient(circle at 14% 22%, rgba(140,184,255,0.24), transparent 20%), linear-gradient(145deg, rgba(34,46,84,0.98), rgba(36,69,122,0.94) 52%, rgba(21,31,61,0.96))",
        },
        artwork: (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute right-12 top-16 h-64 w-64 rounded-full border border-white/8" />
            <div className="absolute right-24 top-28 h-40 w-40 rounded-full border border-sky-300/12" />
            <div className="absolute left-12 top-24 h-px w-72 bg-white/10" />
            <div className="absolute left-12 top-40 h-px w-96 bg-white/8" />
            <div className="absolute bottom-18 left-16 h-52 w-52 rounded-[2rem] border border-white/6" />
          </div>
        ),
        content: (
          <div className="grid h-full content-start gap-5 xl:grid-cols-[repeat(2,minmax(0,1fr))_minmax(340px,1.05fr)]">
            <div className="grid gap-5 md:grid-cols-2 xl:col-span-2">
              <div className="rounded-[2rem] border border-white/12 bg-white/7 px-8 py-7">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                  Last Success
                </p>
                <p className="mt-4 text-3xl font-semibold leading-tight text-white">
                  {formatTime(dispatchHealth?.telemetry.lastSuccessfulFetchAt ?? null)}
                </p>
                <p className="mt-4 text-xl text-white/68">
                  Latest healthy upstream refresh
                </p>
              </div>
              <div className="rounded-[2rem] border border-white/12 bg-white/7 px-8 py-7">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                  Snapshot Revision
                </p>
                <p className="mt-4 text-[5.1rem] font-semibold tracking-[-0.06em] text-white">
                  {dispatchHealth?.revision ?? 0}
                </p>
                <p className="mt-4 text-xl text-white/68">
                  Upstream {dispatchHealth?.snapshotUpstreamStatus ?? "Unavailable"}
                </p>
              </div>
              <div className="rounded-[2rem] border border-sky-300/16 bg-sky-300/8 px-8 py-7">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-sky-50/72">
                  Fetch Latency
                </p>
                <p className="mt-4 text-[5.1rem] font-semibold tracking-[-0.06em] text-white">
                  {formatDurationMs(dispatchHealth?.telemetry.lastFetchDurationMs ?? null)}
                </p>
                <p className="mt-4 text-xl text-white/68">
                  Last FirstDue request duration
                </p>
              </div>
              <div className="rounded-[2rem] border border-amber-300/16 bg-amber-300/8 px-8 py-7">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-amber-50/72">
                  Persist Duration
                </p>
                <p className="mt-4 text-[5.1rem] font-semibold tracking-[-0.06em] text-white">
                  {formatDurationMs(dispatchHealth?.telemetry.lastPersistDurationMs ?? null)}
                </p>
                <p className="mt-4 text-xl text-white/68">
                  Snapshot + event write time
                </p>
              </div>
            </div>
            <div className="rounded-[2rem] border border-white/16 bg-white/10 px-8 py-8 xl:col-start-3 xl:row-span-2">
              <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                Status Summary
              </p>
              <div className="mt-6 grid gap-4">
                <div className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/54">
                    Shared Store
                  </p>
                  <p className="mt-3 text-[1.9rem] font-medium leading-tight text-white">
                    {dispatchHealth?.redis.configured ? "Redis enabled" : "Process-local fallback"}
                  </p>
                  <p className="mt-2 text-base text-white/66">
                    Subscriber {dispatchHealth?.redis.subscriberStatus ?? "disabled"} / feed {dispatchHealth?.redis.subscribed ? "subscribed" : "not subscribed"}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/54">
                    Persistence
                  </p>
                  <p className="mt-3 text-[1.9rem] font-medium leading-tight text-white">
                    {dispatchHealth?.database.configured ? "Postgres enabled" : "Database disabled"}
                  </p>
                  <p className="mt-2 text-base text-white/66">
                    Retention {dispatchHealth?.retentionDays ?? 0} days
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/54">
                    FirstDue Config
                  </p>
                  <p className="mt-3 text-xl leading-8 text-white/78">
                    URL {dispatchHealth?.firstDue?.apiUrl.valid ? "ready" : "invalid"} / auth {dispatchHealth?.firstDue?.auth.headerValuePresent ? "present" : "missing"} / timeout {dispatchHealth?.firstDue?.timeout.parsedMs ?? "n/a"} ms
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/54">
                    Last Error
                  </p>
                  <p className="mt-3 text-xl leading-8 text-white/78">
                    {dispatchHealthMessage ??
                      dispatchHealth?.telemetry.lastError ??
                      dispatchHealth?.snapshotSourceLabel ??
                      "No current diagnostics errors"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ),
      },
    ];
  }, [
    dispatchHealth,
    dispatchHealthMessage,
    emsCalls,
    fireRescueCalls,
    rollingWindows,
    scheduleDate,
    scheduleEntries,
    scheduleMessage,
    statsMessage,
    statsSourceLabel,
    statsYear,
    statsUnavailable,
    totalApparatusCalls,
    totalDepartmentCalls,
    unit,
    isStationScope,
    responseLabel,
    responseLabelPlural,
    flashingWeatherAlert,
    weatherFactors,
    activeWeatherRadarImageUrl,
    workOrders,
    workOrderGroups,
    workOrdersMessage,
  ]);
  const currentIdleScreen =
    idleScreens[idleScreenIndex % Math.max(idleScreens.length, 1)] ?? null;
  const showIdleFeedStatus = Boolean(
    unitId && staleFeedMessage && currentIdleScreen?.id === "health",
  );
  useEffect(() => {
    if (primaryDispatch || !currentIdleScreen?.scrollable) {
      return;
    }

    const container = idleContentRef.current;

    if (!container) {
      return;
    }

    const scrollContainer =
      currentIdleScreen.id.startsWith("work-orders:")
        ? workOrdersListRef.current ?? container
        : container;

    scrollContainer.scrollTo({ top: 0, behavior: "auto" });

    const maxScrollTop =
      scrollContainer.scrollHeight - scrollContainer.clientHeight;

    if (maxScrollTop <= 24) {
      return;
    }

    const isScheduleScreen = currentIdleScreen.id === "schedule";
    const startDelayMs = isScheduleScreen
      ? Math.min(3500, Math.max(1800, Math.floor(IDLE_ROTATION_MS * 0.12)))
      : Math.min(5000, Math.max(2500, Math.floor(IDLE_ROTATION_MS * 0.2)));
    const maxAvailableScrollMs = Math.max(
      6000,
      IDLE_ROTATION_MS - startDelayMs - 1200,
    );
    const scrollDurationMs = isScheduleScreen
      ? Math.min(
          maxAvailableScrollMs,
          Math.max(12000, Math.floor(maxScrollTop * 28)),
        )
      : Math.min(22000, Math.max(9000, Math.floor(IDLE_ROTATION_MS * 0.55)));

    let animationFrameId = 0;
    let animationStartedAt = 0;

    function step(timestamp: number) {
      if (animationStartedAt === 0) {
        animationStartedAt = timestamp;
      }

      const elapsed = timestamp - animationStartedAt;
      const progress = Math.min(elapsed / scrollDurationMs, 1);
      const easedProgress = isScheduleScreen
        ? progress
        : 1 - (1 - progress) * (1 - progress);

      scrollContainer.scrollTop = maxScrollTop * easedProgress;

      if (progress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
      }
    }

    const scrollTimeout = window.setTimeout(() => {
      animationFrameId = window.requestAnimationFrame(step);
    }, startDelayMs);

    return () => {
      window.clearTimeout(scrollTimeout);
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [
    currentIdleScreen?.contentVersion,
    currentIdleScreen?.id,
    currentIdleScreen?.scrollable,
    primaryDispatch,
  ]);
  useEffect(() => {
    if (!primaryDispatch) {
      return;
    }

    const container = timelineListRef.current;

    if (!container) {
      return;
    }

    const timelineContainer = container;

    timelineContainer.scrollTo({ top: 0, behavior: "auto" });

    const maxScrollTop =
      timelineContainer.scrollHeight - timelineContainer.clientHeight;

    if (maxScrollTop <= 24) {
      return;
    }

    const startDelayMs = 2200;
    const scrollDurationMs = 14000;
    let animationFrameId = 0;
    let animationStartedAt = 0;

    function step(timestamp: number) {
      if (animationStartedAt === 0) {
        animationStartedAt = timestamp;
      }

      const elapsed = timestamp - animationStartedAt;
      const progress = Math.min(elapsed / scrollDurationMs, 1);
      const easedProgress = 1 - (1 - progress) * (1 - progress);

      timelineContainer.scrollTop = maxScrollTop * easedProgress;

      if (progress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
      }
    }

    const scrollTimeout = window.setTimeout(() => {
      animationFrameId = window.requestAnimationFrame(step);
    }, startDelayMs);

    return () => {
      window.clearTimeout(scrollTimeout);
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [primaryDispatch, recentTimelineEvents]);
  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitId: loginUnitId.trim(),
          password: loginPassword,
        }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        message?: string;
        unit?: SerializedUnitProfile;
      };

      if (!response.ok || !data.unit) {
        setLoginError(data.message ?? "Login failed.");
        return;
      }

      setUnit(data.unit);
      setLoginPassword("");
      setLoginError(null);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setLoggingIn(false);
      setSessionReady(true);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);

    try {
      await fetch("/api/logout", {
        method: "POST",
      });
    } finally {
      setUnit(null);
      setDispatches([]);
      setFeaturedDispatch(null);
      setWorkOrders([]);
      setWorkOrderGroups([]);
      setWorkOrdersMessage(null);
      setScheduleDate(null);
      setScheduleEntries([]);
      setScheduleMessage(null);
      setRollingWindows([]);
      setDispatchHealth(null);
      setDispatchHealthMessage(null);
      setTimelineEvents([]);
      setTimelineMessage(null);
      setLoginPassword("");
      setLoggingOut(false);
      seenIdsRef.current = new Set();
    }
  }

  if (!sessionReady) {
    return (
      <main className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
        <div className="absolute left-4 top-4 sm:left-6 sm:top-6 lg:left-8 lg:top-8">
          <DepartmentLogo subtitle="Turnout Board" />
        </div>
        <section className="w-full max-w-xl rounded-[2rem] border border-[var(--line)] bg-[var(--panel)] p-8 shadow-[0_24px_80px_rgba(65,43,24,0.14)]">
          <p className="font-mono text-sm uppercase tracking-[0.3em] text-[var(--signal)]">
            Turnout / Loading
          </p>
          <h1 className="mt-4 overflow-hidden text-ellipsis whitespace-nowrap text-4xl font-semibold tracking-[-0.04em]">
            Checking unit session
          </h1>
        </section>
      </main>
    );
  }

  if (!unit) {
    return (
      <main className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
        <div className="absolute left-4 top-4 sm:left-6 sm:top-6 lg:left-8 lg:top-8">
          <DepartmentLogo subtitle="Turnout Board" />
        </div>
        <section className="w-full max-w-2xl overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--panel)] shadow-[0_24px_80px_rgba(65,43,24,0.14)]">
          <div className="border-b border-[var(--line)] px-8 py-8">
            <p className="font-mono text-sm uppercase tracking-[0.3em] text-[var(--signal)]">
              Turnout / Unit Login
            </p>
            <h1 className="mt-3 overflow-hidden text-ellipsis whitespace-nowrap text-4xl font-semibold tracking-[-0.04em]">
              Sign in this display to a unit
            </h1>
            <p className="mt-3 max-w-xl text-base text-black/65">
              Each TV can log into a specific unit so the idle screen shows the
              right unit information when there is no active dispatch.
            </p>
          </div>
          <form onSubmit={handleLogin} className="grid gap-6 px-8 py-8">
            <label className="grid gap-2">
              <span className="font-mono text-sm uppercase tracking-[0.24em] text-black/52">
                Unit Login
              </span>
              <input
                value={loginUnitId}
                onChange={(event) => setLoginUnitId(event.target.value)}
                className="rounded-2xl border border-[var(--line)] bg-white/80 px-4 py-4 text-lg outline-none transition focus:border-[var(--signal)]"
                placeholder="engine1"
                autoComplete="username"
              />
            </label>
            <label className="grid gap-2">
              <span className="font-mono text-sm uppercase tracking-[0.24em] text-black/52">
                Password
              </span>
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                className="rounded-2xl border border-[var(--line)] bg-white/80 px-4 py-4 text-lg outline-none transition focus:border-[var(--signal)]"
                placeholder="Password"
                autoComplete="current-password"
              />
            </label>
            {loginError ? (
              <div className="rounded-2xl border border-[rgba(138,28,28,0.16)] bg-[rgba(138,28,28,0.08)] px-4 py-3 text-sm text-[var(--danger)]">
                {loginError}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={loggingIn}
              className="rounded-full bg-[var(--signal)] px-6 py-4 font-mono text-sm uppercase tracking-[0.2em] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingIn ? "Signing In" : "Sign In"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (!currentIdleScreen) {
    return null;
  }

  if (primaryDispatch) {
    return (
      <main className="flex h-screen w-screen overflow-hidden">
        <section className="grid h-full w-full gap-4 bg-[linear-gradient(135deg,rgba(235,121,76,0.98),rgba(162,44,44,0.96))] p-6 text-white xl:grid-cols-[minmax(0,1.72fr)_360px]">
          <div className="min-w-0 pr-2">
            <div className="grid gap-4 xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:items-start">
              <DepartmentLogo subtitle="Turnout Board" dark />
              <div className="min-w-0 xl:px-2">
                <p className="font-mono text-sm uppercase tracking-[0.38em] text-white/70">
                  Active Dispatch / {unit.displayName}
                </p>
                <p className="mt-2 font-mono text-xs uppercase tracking-[0.3em] text-white/52">
                  Address
                </p>
                <h1 className="mt-1 max-w-5xl line-clamp-2 text-[4.6rem] font-semibold leading-[0.88] tracking-[-0.06em] text-white 2xl:text-[5.1rem]">
                  {primaryDispatch.address ?? "Address not provided"}
                </h1>
                <p className="mt-2 font-mono text-xs uppercase tracking-[0.3em] text-white/52">
                  Call Type
                </p>
                <p className="mt-1 max-w-5xl line-clamp-2 text-[4.6rem] font-medium leading-[0.88] tracking-[-0.06em] text-white/88 2xl:text-[5.1rem]">
                  {primaryDispatch.nature ?? "Dispatch Alert"}
                </p>
              </div>
              <div className="text-right">
                <div className="flex justify-end">
                  <UnitBrandBlock unit={unit} />
                </div>
                <p className="mt-3 font-mono text-xs uppercase tracking-[0.28em] text-white/44">
                  {unitScopeLabel}
                </p>
                <p className="mt-2 text-[2.2rem] font-medium text-white">{unit.displayName}</p>
                <p className="mt-1 text-lg text-white/64">
                  {unitMembershipSummary}
                </p>
                {unit.coverageDisplayName ? (
                  <p className="mt-2 text-sm text-amber-100/78">
                    Covered by {unit.coverageDisplayName}
                  </p>
                ) : null}
                {staleFeedMessage ? (
                  <div
                    className={`mt-4 max-w-md rounded-[1.2rem] border px-4 py-3 text-left ${
                      staleFeedLevel === "critical"
                        ? "border-amber-200/40 bg-amber-300/22 text-amber-50"
                        : "border-white/18 bg-white/10 text-white/88"
                    }`}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em]">
                      Feed Status
                    </p>
                    <p className="mt-2 text-sm leading-6">{staleFeedMessage}</p>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.04fr)_minmax(320px,0.96fr)] xl:items-start">
              <div className="rounded-[1.7rem] border border-white/18 bg-white/10 px-5 py-5 xl:min-h-[16rem]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-sm uppercase tracking-[0.3em] text-white/62">
                    Incident Timeline
                  </p>
                  <p className="text-sm text-white/62">
                    {timelineEvents.length} event{timelineEvents.length === 1 ? "" : "s"} captured
                  </p>
                </div>
                {timelineMessage ? (
                  <p className="mt-4 rounded-[1.1rem] border border-white/14 bg-white/8 px-4 py-3 text-sm text-white/84">
                    {timelineMessage}
                  </p>
                ) : null}
                <div
                  ref={timelineListRef}
                  className="mt-4 max-h-[11rem] overflow-y-auto pr-2 xl:max-h-[12rem]"
                >
                  <ul className="grid gap-3">
                    {recentTimelineEvents.length > 0 ? (
                      recentTimelineEvents.map((event) => {
                        const tone = eventToneClasses(event.eventType);

                        return (
                          <li
                            key={event.id}
                            className={`rounded-[1.3rem] border bg-white/8 px-4 py-4 ${tone.border}`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                <div className="mt-1 flex flex-col items-center">
                                  <span className={`h-3 w-3 rounded-full ${tone.dot}`} />
                                  <span className="mt-2 h-10 w-px bg-white/12" />
                                </div>
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-[1.35rem] font-medium text-white">
                                      {timelineEventLabel(event.eventType)}
                                    </p>
                                    <span
                                      className={`rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${tone.badge}`}
                                    >
                                      {formatRelativeEventOffset(
                                        primaryDispatch.dispatchedAt,
                                        event.fetchedAt,
                                      )}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-sm text-white/62">
                                    {formatTime(event.fetchedAt)}
                                  </p>
                                </div>
                              </div>
                              <p className="font-mono text-xs uppercase tracking-[0.18em] text-white/54">
                                {(event.status ?? event.dispatch.status ?? "unknown").toUpperCase()}
                              </p>
                            </div>
                            <p className="mt-3 text-lg leading-8 text-white/84">
                              {timelineEventSummary(event.dispatch.message, event.eventType)}
                            </p>
                          </li>
                        );
                      })
                    ) : (
                      <li className="rounded-[1.3rem] border border-white/14 bg-white/8 px-4 py-4 text-base text-white/80">
                        Waiting for persisted incident events for this dispatch.
                      </li>
                    )}
                  </ul>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-2">
                <div className="rounded-[1.4rem] border border-white/18 bg-white/10 p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/62">
                    Incident
                  </p>
                  <p className="mt-2 text-[1.8rem] font-medium">
                    {primaryDispatch.incidentNumber ?? primaryDispatch.id}
                  </p>
                  <p className="mt-1 text-sm text-white/62">
                    Priority {dispatchPriorityLabel(primaryDispatch, now)}
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-white/18 bg-white/10 p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/62">
                    Assigned Units
                  </p>
                  <p className="mt-2 text-[1.55rem] font-medium leading-tight">
                    {primaryDispatch.unit ?? "Unassigned"}
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-white/18 bg-white/10 p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/62">
                    Status
                  </p>
                  <p className="mt-2 text-[1.8rem] font-medium">
                    {dispatchDisplayStatus(primaryDispatch, now).toUpperCase()}
                  </p>
                  <p className="mt-1 text-sm text-white/68">
                    {primaryDispatch.enrouteAt
                      ? `En route ${formatShortTime(primaryDispatch.enrouteAt)}`
                      : formatDispatchLastActivity(primaryDispatch)}
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-white/18 bg-white/10 p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/62">
                    Dispatch Time
                  </p>
                  <p className="mt-2 text-[3.0rem] font-medium leading-tight">
                    {formatTime(primaryDispatch.dispatchedAt)}
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-white/18 bg-white/10 p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/62">
                    Feed
                  </p>
                  <p className="mt-2 text-[1.45rem] font-medium">
                    {sourceLabel ?? "Not connected"}
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-white/18 bg-white/10 p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/62">
                    Updated
                  </p>
                  <p className="mt-2 text-[1.75rem] font-medium">
                    {formatShortTime(fetchedAt)}
                  </p>
                  <p className="mt-1 text-sm text-white/68">
                    {formatElapsedSince(fetchedAt, now)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid min-h-0 gap-3 xl:grid-rows-[auto_auto_1fr]">
            <div className="rounded-[1.7rem] border border-white/18 bg-white/10 px-5 py-5">
              <p className="font-mono text-sm uppercase tracking-[0.3em] text-white/62">
                Elapsed Since Dispatch
              </p>
              <p className="mt-3 font-mono text-[5.1rem] font-medium tracking-[-0.06em]">
                {featuredElapsed}
              </p>
            </div>
            {additionalDispatches.length > 0 ? (
              <div className="rounded-[1.7rem] border border-white/18 bg-white/10 px-5 py-5">
                <p className="font-mono text-sm uppercase tracking-[0.3em] text-white/62">
                  Additional Active Calls
                </p>
                <ul className="mt-3 grid gap-2 text-white/88">
                  {additionalDispatches.slice(0, 3).map((dispatch) => (
                    <li
                      key={dispatch.id}
                      className="rounded-[1.2rem] border border-white/14 bg-white/8 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <p className="text-[1.2rem] font-medium leading-tight">
                          {dispatch.nature ?? "Dispatch Alert"}
                        </p>
                        <span className="rounded-full bg-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/70">
                          {dispatchPriorityLabel(dispatch, now)}
                        </span>
                      </div>
                      <p className="mt-1 text-base text-white/72">
                        {dispatch.address ?? "Address not provided"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.18em] text-white/58">
                        <span>{dispatch.incidentNumber ?? dispatch.id}</span>
                        <span>{formatShortTime(dispatch.dispatchedAt)}</span>
                        <span>{dispatchDisplayStatus(dispatch, now).toUpperCase()}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex items-end justify-end">
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="rounded-full border border-white/18 bg-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-white/82 transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loggingOut ? "Logging Out" : "Log Out"}
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <section className="relative h-full w-full overflow-hidden bg-black text-white">
        <div
          key={currentIdleScreen.id}
          className="absolute inset-0 overflow-hidden"
          style={{
            animation: "idle-screen-fade 900ms ease both",
            ...currentIdleScreen.backgroundStyle,
          }}
        >
          {currentIdleScreen.artwork}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.02),rgba(0,0,0,0.16))]" />
          <div className="relative grid h-full grid-rows-[auto_minmax(0,1fr)_auto] gap-4 px-6 py-5 sm:gap-5 sm:px-8 sm:py-6 xl:px-10 xl:py-8">
            <div className="grid gap-4 xl:grid-cols-[auto_minmax(0,1fr)_minmax(180px,240px)] xl:items-start">
              <DepartmentLogo subtitle="Turnout Board" dark compact />
              <div className="min-w-0 xl:px-2">
                <p className="font-mono text-sm uppercase tracking-[0.34em] text-white/58">
                  {currentIdleScreen.eyebrow}
                </p>
                <h1 className="mt-2 max-w-4xl text-[2.9rem] font-semibold leading-[0.94] tracking-[-0.07em] text-white sm:text-[3.2rem] 2xl:text-[4.9rem]">
                  {currentIdleScreen.title}
                </h1>
                <p className="mt-3 max-w-3xl text-lg leading-tight text-white/80 2xl:text-xl">
                  {currentIdleScreen.description}
                </p>
              </div>
              <div className="hidden xl:block xl:text-right">
                <div className="flex justify-end">
                  <UnitBrandBlock unit={unit} />
                </div>
                <p className="mt-3 font-mono text-xs uppercase tracking-[0.28em] text-white/44">
                  {unitScopeLabel}
                </p>
                <p className="mt-2 text-[1.9rem] font-medium text-white">{unit.displayName}</p>
                <p className="mt-1 text-base text-white/64">
                  {unitMembershipSummary}
                </p>
                {unit.coverageDisplayName ? (
                  <p className="mt-2 text-sm text-amber-100/78">
                    Covered by {unit.coverageDisplayName}
                  </p>
                ) : null}
              </div>
            </div>

            <div
              ref={idleContentRef}
              className={`min-h-0 ${
                currentIdleScreen.scrollable ? "overflow-y-auto pr-2" : ""
              }`}
            >
              {currentIdleScreen.content}
            </div>

            <div className="flex items-end justify-between gap-4">
              <div className="xl:hidden">
                <DepartmentLogo subtitle="Turnout Board" dark />
                <p className="mt-3 text-sm text-white/68">{unit.displayName}</p>
                {showIdleFeedStatus ? (
                  <p className="mt-2 max-w-md text-sm leading-6 text-amber-100/86">
                    {staleFeedMessage}
                  </p>
                ) : null}
              </div>
              <div className="ml-auto text-right">
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="rounded-full border border-white/18 bg-white/10 px-5 py-3 font-mono text-xs uppercase tracking-[0.22em] text-white/86 transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loggingOut ? "Logging Out" : "Log Out"}
                </button>
                <p className="mt-3 font-mono text-xs uppercase tracking-[0.28em] text-white/40">
                  Screen
                </p>
                <p className="mt-2 text-lg text-white/72">{currentIdleScreen.label}</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      {(stickyMessage || (Boolean(unitId) && !configured)) ? (
        <div className="absolute bottom-8 left-1/2 z-10 w-[min(920px,calc(100%-4rem))] -translate-x-1/2">
          <div className="flex flex-wrap justify-center gap-3">
            {stickyMessage ? (
              <div className="rounded-full border border-[rgba(255,255,255,0.16)] bg-[rgba(0,0,0,0.28)] px-4 py-2 text-sm text-white/88 backdrop-blur">
                {stickyMessage}
              </div>
            ) : null}
            {unitId && !configured ? (
              <div className="rounded-full border border-[rgba(255,255,255,0.16)] bg-[rgba(0,0,0,0.28)] px-4 py-2 text-sm text-white/88 backdrop-blur">
                Configure <code>FIRSTDUE_API_URL</code> and auth in your server environment variables.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {showIdleFeedStatus ? (
        <div className="pointer-events-none absolute left-1/2 top-6 z-10 w-[min(1120px,calc(100%-3rem))] -translate-x-1/2">
          <div
            className={`rounded-[1.4rem] border px-5 py-4 text-center shadow-[0_12px_40px_rgba(0,0,0,0.28)] backdrop-blur ${
              staleFeedLevel === "critical"
                ? "border-amber-200/50 bg-[rgba(112,48,0,0.7)] text-amber-50"
                : "border-white/18 bg-[rgba(0,0,0,0.4)] text-white"
            }`}
          >
            <p className="font-mono text-xs uppercase tracking-[0.28em]">
              {staleFeedLevel === "critical" ? "Feed Stale" : "Feed Delayed"}
            </p>
            <p className="mt-2 text-lg leading-7">{staleFeedMessage}</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
