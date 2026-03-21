"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isResolvedDispatch,
  isStaleOpenDispatch,
  type DispatchRecord,
} from "@/lib/dispatches";
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
  totalDepartmentCalls: number;
  totalApparatusCalls: number;
  emsCalls: number;
  fireRescueCalls: number;
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

const POLL_INTERVAL_MS = Number(
  process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? "5000",
);
const IDLE_ROTATION_MS = Number(
  process.env.NEXT_PUBLIC_IDLE_ROTATION_MS ?? "20000",
);
const WEATHER_POLL_INTERVAL_MS = Number(
  process.env.NEXT_PUBLIC_WEATHER_POLL_INTERVAL_MS ?? "300000",
);
const STATS_POLL_INTERVAL_MS = 15 * 60 * 1000;
const DISPATCH_TIME_ZONE = "America/New_York";

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
}: {
  subtitle?: string;
  dark?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <Image
        src="/branding/mtfd-logo.svg"
        alt="Morris Township Fire Department logo"
        width={224}
        height={224}
        unoptimized
        className="h-52 w-52 object-contain drop-shadow-[0_12px_28px_rgba(0,0,0,0.28)] 2xl:h-56 2xl:w-56"
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
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [featuredDispatch, setFeaturedDispatch] = useState<DispatchRecord | null>(
    null,
  );
  const [unit, setUnit] = useState<SerializedUnitProfile | null>(null);
  const [workOrders, setWorkOrders] = useState<
    Array<{ id: string; title: string; status: string | null }>
  >([]);
  const [workOrdersMessage, setWorkOrdersMessage] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string | null>(null);
  const [scheduleEntries, setScheduleEntries] = useState<
    ScheduleResponse["entries"]
  >([]);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const [statsYear, setStatsYear] = useState<number>(new Date().getFullYear());
  const [totalDepartmentCalls, setTotalDepartmentCalls] = useState(0);
  const [totalApparatusCalls, setTotalApparatusCalls] = useState(0);
  const [emsCalls, setEmsCalls] = useState(0);
  const [fireRescueCalls, setFireRescueCalls] = useState(0);
  const [statsMessage, setStatsMessage] = useState<string | null>(null);
  const [statsSourceLabel, setStatsSourceLabel] = useState<string | null>(null);
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
  const unitId = unit?.id ?? null;
  const unitApparatusApiId = unit?.apparatusApiId ?? null;
  const activeDispatches = useMemo(
    () =>
      dispatches.filter(
        (dispatch) => !isResolvedDispatch(dispatch),
      ),
    [dispatches],
  );
  const freshDispatches = useMemo(
    () => activeDispatches.filter((dispatch) => !isStaleOpenDispatch(dispatch, now)),
    [activeDispatches, now],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

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
      return;
    }

    let active = true;

    async function poll() {
      try {
        const response = await fetch("/api/dispatches", { cache: "no-store" });
        const data = (await response.json()) as ApiResponse;

        if (!active) {
          return;
        }

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

        if (latestNewDispatch) {
          setFeaturedDispatch(latestNewDispatch);
        } else if (featuredDispatch) {
          const updatedFeaturedDispatch =
            data.dispatches.find(
              (dispatch) =>
                dispatch.id === featuredDispatch.id &&
                !isResolvedDispatch(dispatch) &&
                !isStaleOpenDispatch(dispatch),
            ) ??
            null;

          if (!updatedFeaturedDispatch) {
            setFeaturedDispatch(null);
          } else {
            setFeaturedDispatch(updatedFeaturedDispatch);
          }
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setMessage(
          error instanceof Error ? error.message : "Polling request failed.",
        );
      }
    }

    poll();
    const intervalId = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [featuredDispatch, unitId]);

  useEffect(() => {
    if (!unitId) {
      setWorkOrders([]);
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
        setWorkOrdersMessage(data.message);
      } catch (error) {
        if (!active) {
          return;
        }

        setWorkOrders([]);
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
      setTotalDepartmentCalls(0);
      setTotalApparatusCalls(0);
      setEmsCalls(0);
      setFireRescueCalls(0);
      setStatsMessage(null);
      setStatsSourceLabel(null);
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
        setTotalDepartmentCalls(data.totalDepartmentCalls);
        setTotalApparatusCalls(data.totalApparatusCalls);
        setEmsCalls(data.emsCalls);
        setFireRescueCalls(data.fireRescueCalls);
        setStatsMessage(data.message);
        setStatsSourceLabel(data.sourceLabel);
      } catch (error) {
        if (!active) {
          return;
        }

        setStatsYear(new Date().getFullYear());
        setTotalDepartmentCalls(0);
        setTotalApparatusCalls(0);
        setEmsCalls(0);
        setFireRescueCalls(0);
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

  const primaryDispatch = useMemo(() => {
    if (featuredDispatch && !isStaleOpenDispatch(featuredDispatch, now)) {
      return featuredDispatch;
    }

    return freshDispatches[0] ?? null;
  }, [featuredDispatch, freshDispatches, now]);
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

    return [
      {
        id: "work-orders",
        label: "Work Orders",
        eyebrow: "Maintenance Queue",
        title: `${unit.displayName} apparatus work orders`,
        description: `${
          workOrders.length
        } item${workOrders.length === 1 ? "" : "s"} currently open for this unit.${
          unit.coverageDisplayName ? ` Covered by ${unit.coverageDisplayName}.` : ""
        }`,
        contentVersion: `work-orders:${workOrders.length}:${workOrdersMessage ?? ""}`,
        scrollable: true,
        backgroundStyle: {
          background:
            "radial-gradient(circle at top left, rgba(255,206,138,0.18), transparent 28%), linear-gradient(135deg, rgba(74,47,24,0.98), rgba(28,20,14,1))",
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
                {workOrders.length > 0 ? (
                  workOrders.map((order) => (
                    <li
                      key={order.id}
                      className="rounded-[1.8rem] border border-white/12 bg-white/6 px-8 py-7"
                    >
                      <p className="text-3xl font-medium text-white">{order.title}</p>
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
                    <p className="mt-4 text-3xl font-medium text-white">
                      There are no active work orders for this apparatus.
                    </p>
                  </li>
                )}
              </ul>
            </div>
            <div className="self-start rounded-[2rem] border border-white/12 bg-black/18 px-8 py-8">
              <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                Queue Status
              </p>
              <p className="mt-5 text-7xl font-semibold tracking-[-0.06em] text-white">
                {workOrders.length}
              </p>
              <p className="mt-3 text-lg text-white/72">Open work orders</p>
              <p className="mt-8 text-base leading-7 text-white/72">
                {workOrdersMessage ??
                  "Work orders are loading from the configured apparatus feed."}
              </p>
            </div>
          </div>
        ),
      },
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
              ? "radial-gradient(circle at 18% 20%, rgba(255,255,255,0.16), transparent 16%), radial-gradient(circle at 80% 18%, rgba(255,120,120,0.24), transparent 18%), radial-gradient(circle at 70% 78%, rgba(255,80,80,0.18), transparent 24%), linear-gradient(145deg, rgba(90,12,18,1), rgba(139,17,28,0.96) 55%, rgba(58,8,14,1))"
              : "radial-gradient(circle at 18% 20%, rgba(255,255,255,0.2), transparent 16%), radial-gradient(circle at 80% 18%, rgba(159,216,255,0.24), transparent 18%), radial-gradient(circle at 70% 78%, rgba(83,185,255,0.18), transparent 24%), linear-gradient(145deg, rgba(13,66,94,1), rgba(22,109,126,0.94) 55%, rgba(8,42,64,1))",
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
          <div className="grid h-full min-h-0 content-start gap-6 xl:grid-cols-[minmax(340px,0.84fr)_minmax(500px,1.16fr)]">
            <div className="min-h-0 rounded-[2rem] border border-white/12 bg-white/6 px-7 py-7 backdrop-blur-sm">
              {flashingWeatherAlert ? (
                <div className="animate-pulse rounded-[1.5rem] border border-red-300/50 bg-red-500/24 px-6 py-4 shadow-[0_0_40px_rgba(248,113,113,0.18)]">
                  <p className="font-mono text-sm uppercase tracking-[0.28em] text-red-50">
                    Weather Warning
                  </p>
                  <p className="mt-2 text-2xl font-semibold leading-tight text-white">
                    {flashingWeatherAlert}
                  </p>
                </div>
              ) : null}
              <div
                className={`flex flex-col gap-5 ${
                  flashingWeatherAlert ? "mt-5" : ""
                }`}
              >
                <div className="flex flex-col gap-4 rounded-[1.6rem] border border-white/12 bg-black/16 px-6 py-5 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/58">
                      Current Weather
                    </p>
                    <p className="mt-4 text-3xl font-semibold leading-tight text-white 2xl:text-4xl">
                      {unit.weatherSummary}
                    </p>
                    <p className="mt-3 text-lg text-white/68">
                      {unit.weatherLocation}
                    </p>
                  </div>
                  <div className="md:max-w-[18rem] md:text-right">
                    <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                      Last Updated
                    </p>
                    <p className="mt-4 text-xl font-medium text-white 2xl:text-2xl">
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
                    className={`rounded-[1.4rem] border border-white/12 bg-black/16 px-5 py-4 ${
                      factor.label === "Alerts" && flashingWeatherAlert
                        ? "animate-pulse border-red-300/55 bg-red-500/26 shadow-[0_0_30px_rgba(248,113,113,0.16)]"
                        : factor.className
                    }`}
                  >
                    <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/56">
                      {factor.label}
                    </p>
                    <p className="mt-2 text-xl font-medium text-white">
                      {factor.value}
                    </p>
                  </div>
                ))}
              </div>
              <ul className="mt-5 grid gap-3 text-xl leading-tight text-white/88 2xl:text-2xl">
                {(unit.weatherDetails.length > 0
                  ? unit.weatherDetails
                  : ["No weather details configured"]).slice(0, 4).map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </div>
            <div className="min-h-0 rounded-[2rem] border border-white/12 bg-black/14 px-7 py-7">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                  Radar
                </p>
                <p className="text-sm text-white/60">Centered on Morris Township</p>
              </div>
              <div className="mt-5 overflow-hidden rounded-[1.7rem] border border-white/12 bg-black/24">
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
                  <div className="flex h-[clamp(22rem,40vh,32rem)] items-center justify-center px-8 text-center text-xl text-white/68">
                    Radar feed unavailable for this location.
                  </div>
                )}
              </div>
              <p className="mt-4 text-base leading-7 text-white/64">
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
          ? `Daily staffing for ${formatDateOnly(`${scheduleDate}T12:00:00`)}` 
          : "Daily staffing schedule",
        description:
          scheduleMessage ??
          "Current staffed assignments from the FirstDue daily schedule across all stations.",
        contentVersion: `schedule:${scheduleDate ?? ""}:${scheduleEntries.length}:${scheduleMessage ?? ""}`,
        scrollable: true,
        backgroundStyle: {
          background:
            "radial-gradient(circle at top right, rgba(255,255,255,0.08), transparent 18%), linear-gradient(135deg, rgba(31,24,58,1), rgba(17,42,86,0.96) 58%, rgba(10,22,46,1))",
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
                <p className="font-mono text-4xl uppercase tracking-[0.2em] text-white/64">
                  {entry.timeRange}
                </p>
                <div>
                  <p className="text-3xl font-medium text-white">{entry.title}</p>
                  <p className="mt-2 text-lg text-white/72">
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
        title: `${statsYear} call statistics`,
        description:
          statsMessage ??
          `Year-to-date department call volume with ${unit.displayName} apparatus totals and Fire vs EMS split.`,
        contentVersion: `stats:${statsYear}:${totalDepartmentCalls}:${totalApparatusCalls}:${emsCalls}:${fireRescueCalls}:${statsMessage ?? ""}`,
        backgroundStyle: {
          background:
            "radial-gradient(circle at top left, rgba(255,255,255,0.08), transparent 20%), radial-gradient(circle at 82% 16%, rgba(78,219,161,0.16), transparent 18%), linear-gradient(140deg, rgba(14,56,49,1), rgba(10,32,39,0.96) 52%, rgba(8,19,27,1))",
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
          <div className="grid h-full content-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className="grid gap-5 md:grid-cols-2">
              <div className="rounded-[2rem] border border-white/12 bg-white/7 px-8 py-7">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                  Total Dept. Calls
                </p>
                <p className="mt-4 text-7xl font-semibold tracking-[-0.06em] text-white">
                  {totalDepartmentCalls}
                </p>
                <p className="mt-4 text-lg text-white/68">Year to date</p>
              </div>
              <div className="rounded-[2rem] border border-white/12 bg-white/7 px-8 py-7">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                  Total Apparatus Calls
                </p>
                <p className="mt-4 text-7xl font-semibold tracking-[-0.06em] text-white">
                  {totalApparatusCalls}
                </p>
                <p className="mt-4 text-lg text-white/68">{unit.displayName} year to date</p>
              </div>
              <div className="rounded-[2rem] border border-red-300/16 bg-red-300/8 px-8 py-7">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-red-50/72">
                  Fire
                </p>
                <p className="mt-4 text-7xl font-semibold tracking-[-0.06em] text-white">
                  {fireRescueCalls}
                </p>
                <p className="mt-4 text-lg text-white/68">Department fire/rescue incidents</p>
              </div>
              <div className="rounded-[2rem] border border-sky-300/16 bg-sky-300/8 px-8 py-7">
                <p className="font-mono text-sm uppercase tracking-[0.28em] text-sky-50/72">
                  EMS
                </p>
                <p className="mt-4 text-7xl font-semibold tracking-[-0.06em] text-white">
                  {emsCalls}
                </p>
                <p className="mt-4 text-lg text-white/68">Department EMS incidents</p>
              </div>
            </div>
            <div className="rounded-[2rem] border border-white/12 bg-black/18 px-8 py-8">
              <p className="font-mono text-sm uppercase tracking-[0.28em] text-white/56">
                Stats Summary
              </p>
              <div className="mt-6 grid gap-4">
                <div className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/54">
                    Department Split
                  </p>
                  <p className="mt-3 text-2xl font-medium text-white">
                    {fireRescueCalls} Fire / {emsCalls} EMS
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/54">
                    Apparatus Share
                  </p>
                  <p className="mt-3 text-2xl font-medium text-white">
                    {totalDepartmentCalls > 0
                      ? `${Math.round((totalApparatusCalls / totalDepartmentCalls) * 100)}% of department calls`
                      : "No department calls counted yet"}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/54">
                    Source
                  </p>
                  <p className="mt-3 text-lg leading-8 text-white/78">
                    {statsMessage ?? statsSourceLabel ?? "Stats feed not configured"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ),
      },
    ];
  }, [
    emsCalls,
    fireRescueCalls,
    scheduleDate,
    scheduleEntries,
    scheduleMessage,
    statsMessage,
    statsSourceLabel,
    statsYear,
    totalApparatusCalls,
    totalDepartmentCalls,
    unit,
    flashingWeatherAlert,
    weatherFactors,
    activeWeatherRadarImageUrl,
    workOrders,
    workOrdersMessage,
  ]);
  const currentIdleScreen =
    idleScreens[idleScreenIndex % Math.max(idleScreens.length, 1)] ?? null;
  useEffect(() => {
    if (primaryDispatch || !currentIdleScreen?.scrollable) {
      return;
    }

    const container = idleContentRef.current;

    if (!container) {
      return;
    }

    const scrollContainer =
      currentIdleScreen.id === "work-orders"
        ? workOrdersListRef.current ?? container
        : container;

    scrollContainer.scrollTo({ top: 0, behavior: "auto" });

    const maxScrollTop =
      scrollContainer.scrollHeight - scrollContainer.clientHeight;

    if (maxScrollTop <= 24) {
      return;
    }

    const startDelayMs = Math.min(
      5000,
      Math.max(2500, Math.floor(IDLE_ROTATION_MS * 0.2)),
    );
    const scrollDurationMs = Math.min(
      22000,
      Math.max(9000, Math.floor(IDLE_ROTATION_MS * 0.55)),
    );

    let animationFrameId = 0;
    let animationStartedAt = 0;

    function step(timestamp: number) {
      if (animationStartedAt === 0) {
        animationStartedAt = timestamp;
      }

      const elapsed = timestamp - animationStartedAt;
      const progress = Math.min(elapsed / scrollDurationMs, 1);
      const easedProgress = 1 - (1 - progress) * (1 - progress);

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
      setWorkOrdersMessage(null);
      setScheduleDate(null);
      setScheduleEntries([]);
      setScheduleMessage(null);
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
        <section className="grid h-full w-full gap-5 bg-[linear-gradient(135deg,rgba(220,93,52,0.98),rgba(120,23,23,1))] p-7 text-white xl:grid-cols-[minmax(0,1.7fr)_380px]">
          <div className="min-w-0">
            <div className="grid gap-6 xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:items-start">
              <DepartmentLogo subtitle="Turnout Board" dark />
              <div className="min-w-0 xl:px-2">
                <p className="font-mono text-sm uppercase tracking-[0.38em] text-white/70">
                  Active Dispatch / {unit.displayName}
                </p>
                <h1 className="mt-4 max-w-6xl text-6xl font-semibold leading-[0.9] tracking-[-0.06em] text-white sm:text-7xl xl:text-[6.2rem] 2xl:text-[7.6rem]">
                  {primaryDispatch.nature ?? "Dispatch Alert"}
                </h1>
              </div>
              <div className="text-right">
                <div className="flex justify-end">
                  <UnitBrandBlock unit={unit} />
                </div>
                <p className="mt-3 font-mono text-xs uppercase tracking-[0.28em] text-white/44">
                  Unit
                </p>
                <p className="mt-2 text-3xl font-medium text-white">{unit.displayName}</p>
                <p className="mt-1 text-base text-white/64">
                  {unit.apparatus} / {unit.station} / {unit.radioName}
                </p>
                {unit.coverageDisplayName ? (
                  <p className="mt-2 text-sm text-amber-100/78">
                    Covered by {unit.coverageDisplayName}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-6 h-px w-full max-w-6xl bg-white/18" />
            <p className="mt-6 max-w-6xl line-clamp-2 text-6xl font-semibold leading-[0.9] tracking-[-0.06em] text-white sm:text-7xl xl:text-[6.2rem] 2xl:text-[7.6rem]">
              {primaryDispatch.address ?? "Address not provided"}
            </p>

            <div className="mt-7 grid gap-4 md:grid-cols-3">
              <div className="rounded-[1.6rem] border border-white/15 bg-black/12 p-5">
                <p className="font-mono text-sm uppercase tracking-[0.24em] text-white/62">
                  Incident
                </p>
                <p className="mt-3 text-3xl font-medium">
                  {primaryDispatch.incidentNumber ?? primaryDispatch.id}
                </p>
              </div>
              <div className="rounded-[1.6rem] border border-white/15 bg-black/12 p-5">
                <p className="font-mono text-sm uppercase tracking-[0.24em] text-white/62">
                  Assigned Units
                </p>
                <p className="mt-3 text-2xl font-medium leading-tight">
                  {primaryDispatch.unit ?? "Unassigned"}
                </p>
              </div>
              <div className="rounded-[1.6rem] border border-white/15 bg-black/12 p-5">
                <p className="font-mono text-sm uppercase tracking-[0.24em] text-white/62">
                  Status
                </p>
                <p className="mt-3 text-3xl font-medium">
                  {dispatchDisplayStatus(primaryDispatch, now).toUpperCase()}
                </p>
                {isStaleOpenDispatch(primaryDispatch, now) ? (
                  <p className="mt-2 text-sm text-amber-100/80">
                    {formatDispatchLastActivity(primaryDispatch)}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-7 grid gap-4 md:grid-cols-3">
              <div className="rounded-[1.6rem] border border-white/15 bg-black/12 p-5">
                <p className="font-mono text-sm uppercase tracking-[0.24em] text-white/62">
                  Dispatch Time
                </p>
                <p className="mt-3 text-3xl font-medium">
                  {formatTime(primaryDispatch.dispatchedAt)}
                </p>
              </div>
              <div className="rounded-[1.6rem] border border-white/15 bg-black/12 p-5">
                <p className="font-mono text-sm uppercase tracking-[0.24em] text-white/62">
                  Feed
                </p>
                <p className="mt-3 text-xl font-medium">
                  {sourceLabel ?? "Not connected"}
                </p>
              </div>
              <div className="rounded-[1.6rem] border border-white/15 bg-black/12 p-5">
                <p className="font-mono text-sm uppercase tracking-[0.24em] text-white/62">
                  Updated
                </p>
                <p className="mt-3 text-3xl font-medium">
                  {formatShortTime(fetchedAt)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid min-h-0 gap-4 xl:grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-[1.9rem] border border-white/16 bg-black/16 px-6 py-6">
              <p className="font-mono text-sm uppercase tracking-[0.3em] text-white/62">
                Elapsed Since Dispatch
              </p>
              <p className="mt-4 font-mono text-8xl font-medium tracking-[-0.06em]">
                {featuredElapsed}
              </p>
            </div>
            <div className="min-h-0 rounded-[1.9rem] border border-white/16 bg-black/12 px-6 py-6">
              <p className="font-mono text-sm uppercase tracking-[0.3em] text-white/62">
                Current Notes
              </p>
              {unit.coverageDisplayName ? (
                <p className="mt-4 rounded-[1.1rem] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-50/88">
                  Dispatch matching and apparatus work orders are currently following {unit.coverageDisplayName}.
                </p>
              ) : null}
              <ul className="mt-4 grid gap-3 text-lg text-white/84">
                {(unit.notes.length > 0 ? unit.notes : ["No unit notes configured"]).slice(0, 4).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
            {additionalDispatches.length > 0 ? (
              <div className="min-h-0 rounded-[1.9rem] border border-white/16 bg-black/12 px-6 py-6">
                <p className="font-mono text-sm uppercase tracking-[0.3em] text-white/62">
                  Additional Active Calls
                </p>
                <ul className="mt-4 grid gap-3 text-white/88">
                  {additionalDispatches.slice(0, 4).map((dispatch) => (
                    <li
                      key={dispatch.id}
                      className="rounded-[1.3rem] border border-white/12 bg-black/12 px-4 py-4"
                    >
                      <p className="text-lg font-medium">
                        {dispatch.nature ?? "Dispatch Alert"}
                      </p>
                      <p className="mt-1 text-sm text-white/72">
                        {dispatch.address ?? "Address not provided"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 font-mono text-xs uppercase tracking-[0.18em] text-white/58">
                        <span>{dispatch.incidentNumber ?? dispatch.id}</span>
                        <span>{formatShortTime(dispatch.dispatchedAt)}</span>
                        <span>{dispatchDisplayStatus(dispatch, now).toUpperCase()}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="rounded-full border border-white/20 bg-black/12 px-5 py-3 font-mono text-xs uppercase tracking-[0.22em] text-white/80 transition hover:bg-black/20 disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.34))]" />
          <div className="relative grid h-full gap-8 px-10 py-10 sm:px-12 sm:py-12 xl:grid-cols-[minmax(0,1fr)_220px]">
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="grid gap-6 xl:grid-cols-[auto_minmax(0,1fr)] xl:items-start">
                <DepartmentLogo subtitle="Turnout Board" dark />
                <div className="min-w-0 xl:px-2">
                  <p className="font-mono text-sm uppercase tracking-[0.34em] text-white/58">
                    {currentIdleScreen.eyebrow}
                  </p>
                  <h1 className="mt-4 max-w-5xl text-5xl font-semibold leading-[0.92] tracking-[-0.07em] text-white sm:text-6xl 2xl:text-[6rem]">
                    {currentIdleScreen.title}
                  </h1>
                  <p className="mt-4 max-w-4xl text-xl leading-tight text-white/80 2xl:text-2xl">
                    {currentIdleScreen.description}
                  </p>
                </div>
              </div>

              <div
                ref={idleContentRef}
                className={`mt-6 min-h-0 flex-1 ${
                  currentIdleScreen.scrollable ? "overflow-y-auto pr-3" : ""
                }`}
              >
                {currentIdleScreen.content}
              </div>
            </div>

            <div className="hidden xl:flex xl:flex-col xl:items-end xl:justify-between">
              <div className="w-full text-right">
                <div className="flex justify-end">
                  <UnitBrandBlock unit={unit} />
                </div>
                <p className="mt-3 font-mono text-xs uppercase tracking-[0.28em] text-white/44">
                  Unit
                </p>
                <p className="mt-2 text-3xl font-medium text-white">{unit.displayName}</p>
                <p className="mt-1 text-base text-white/64">
                  {unit.apparatus} / {unit.station} / {unit.radioName}
                </p>
                {unit.coverageDisplayName ? (
                  <p className="mt-2 text-sm text-amber-100/78">
                    Covered by {unit.coverageDisplayName}
                  </p>
                ) : null}
              </div>
              <div className="text-right">
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="rounded-full border border-white/14 bg-black/14 px-5 py-3 font-mono text-xs uppercase tracking-[0.22em] text-white/78 transition hover:bg-black/24 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loggingOut ? "Logging Out" : "Log Out"}
                </button>
                <p className="font-mono text-xs uppercase tracking-[0.28em] text-white/40">
                  Screen
                </p>
                <p className="mt-3 text-lg text-white/72">{currentIdleScreen.label}</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      {(message || !configured) ? (
        <div className="absolute bottom-8 left-1/2 z-10 w-[min(920px,calc(100%-4rem))] -translate-x-1/2">
          <div className="flex flex-wrap justify-center gap-3">
            {message ? (
              <div className="rounded-full border border-[rgba(255,255,255,0.16)] bg-[rgba(0,0,0,0.28)] px-4 py-2 text-sm text-white/88 backdrop-blur">
                {message}
              </div>
            ) : null}
            {!configured ? (
              <div className="rounded-full border border-[rgba(255,255,255,0.16)] bg-[rgba(0,0,0,0.28)] px-4 py-2 text-sm text-white/88 backdrop-blur">
                Configure <code>FIRSTDUE_API_URL</code> and auth in <code>.env.local</code>.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
