import {
  filterDispatchesForUnit,
  normalizeDispatchPayload,
} from "@/lib/dispatches";
import { isDatabaseConfigured } from "@/lib/db";
import {
  getDispatchRetentionDays,
  getPersistedIncidentsSince,
} from "@/lib/dispatch-store";
import type { DispatchRecord } from "@/lib/dispatch-shared";
import {
  getFirstDueApiUrl,
  getFirstDueAuthHeaders,
} from "@/lib/firstdue-env";

type UnitMatcher = {
  id: string;
  displayName: string;
  apparatus: string;
  apparatusApiId?: string;
  radioName: string;
  dispatchAliases?: string[];
};

export type DispatchStatsResult = {
  ok: boolean;
  message: string | null;
  sourceLabel: string | null;
  year: number;
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

const PAGE_SIZE_FALLBACK = 20;
const CLASSIFICATION_MAX_PAGES = 50;

const EMS_CALL_TYPES = new Set([
  "ABDOMINAL PAIN   PROBLEMS",
  "ALLERGIES   ENVENOMATIONS",
  "BREATHING PROBLEMS",
  "BURNS   EXPLOSION",
  "CARDIAC OR RESPIRATORY ARREST   DEATH",
  "CHEST PAINS",
  "CHOKING",
  "CO ILLNESS   INHALATION   HAZMAT   CBRN",
  "CONVULSIONS   SEIZURES",
  "DIABETIC PROBLEMS",
  "FALLS",
  "HEADACHE",
  "HEART PROBLEMS   A.I.C.D.",
  "HEAT   COLD EXPOSURE",
  "LIFT ASSIST NO INJURY   NON EMERGENCY TRANSPORT",
  "MMA INBOUND CATEGORY A RESPONSE",
  "MMA INBOUND CATEGORY B RESPONSE",
  "MVA INJURY",
  "MVA WITH INJURIES [77]",
  "OVERDOSE   POISONING",
  "PREGNANCY   CHILDBIRTH",
  "PSYCHIATRIC  ABNORMAL BEHAVIOR   SUICIDE ATTEMPT",
  "SICK PERSON",
  "STROKE   CVA",
  "TRAUMATIC INJURIES",
  "UNCONSCIOUS   FAINTING",
  "UNKNOWN PROBLEM",
  "ASSIST EMS",
]);

const FIRE_RESCUE_CALL_TYPES = new Set([
  "APPLIANCE FIRE [69]",
  "ASSIST POLICE",
  "BOILER MALFUNCTION [53]",
  "CHIMNEY FIRE [69]",
  "CO ALARM NO ILLNESS [52]",
  "CO ALARM W  ILLNESS [52]",
  "COMMERCIAL STRUCTURE FIRE [69]",
  "ELECTRICAL FIRE [69]",
  "ELEVATOR EMERGENCY [56]",
  "FIRE ALARM COMMERCIAL [52]",
  "FIRE ALARM RESIDENTIAL [52]",
  "HAZMAT SPILL GASOLINE [59 61]",
  "INVESTIGATION",
  "LOCK OUT   TAG OUT ELEVATOR FD NOTIFICATION ONLY",
  "MVA ENTRAPMENT",
  "MVA ENTRAPMENT [77]",
  "MVA FLUID SPILL CAR SMOKING [77]",
  "MVA INTO A BUILDING [77]",
  "MVA OVERTURNED",
  "MVA OVERTURNED [77]",
  "ODOR OF SMOKE IN BUILDING [69]",
  "ODOR UNKNOWN   STRANGE INSIDE BLD [66]",
  "OUTSIDE FIRE [67]",
  "PUBLIC SERVICE",
  "RESIDENTIAL STRUCTURE FIRE [69]",
  "SMELL ODOR SOUND OF GAS LEAK INSIDE BUILDING [60]",
  "SMELL ODOR SOUND OF GAS LEAK OUTSIDE [60]",
  "STANDBY",
  "VEHICLE CAR FIRE [71]",
  "WATER PUMP OUT [53]",
  "WIRES   TRANSFORMER   ELECTRICAL [55]",
]);

function describeSource(apiUrl: string) {
  try {
    return `Live feed: ${new URL(apiUrl).hostname}`;
  } catch {
    return "Configured feed";
  }
}

function parseLastPageFromLinkHeader(linkHeader: string | null) {
  if (!linkHeader) {
    return 1;
  }

  const lastMatch = linkHeader.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/i);

  if (lastMatch) {
    return Number(lastMatch[1]);
  }

  return linkHeader.includes('rel="next"') ? 2 : 1;
}

function easternYearStartSinceIso(now = new Date()) {
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
  }).format(now);

  return `${year}-01-01T05:00:00Z`;
}

function daysAgoIso(days: number, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function buildStatsUrl(baseUrl: string, page: number, sinceIso: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("page", String(page));
  url.searchParams.set("since", sinceIso);
  return url.toString();
}

async function fetchDispatchPage(
  url: string,
  headers: Record<string, string>,
) {
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });

  const payload = (await response.json()) as unknown;

  return {
    response,
    dispatches: normalizeDispatchPayload(payload),
  };
}

function classifyCalls(dispatches: DispatchRecord[]) {
  let emsCalls = 0;
  let fireRescueCalls = 0;

  for (const dispatch of dispatches) {
    const nature = dispatch.nature?.trim().toUpperCase() ?? "";

    if (EMS_CALL_TYPES.has(nature)) {
      emsCalls += 1;
    }

    if (FIRE_RESCUE_CALL_TYPES.has(nature)) {
      fireRescueCalls += 1;
    }
  }

  return { emsCalls, fireRescueCalls };
}

function buildRollingWindowSummary(
  label: string,
  days: number,
  dispatches: DispatchRecord[],
  unit: UnitMatcher | null,
  sourceLabel: string | null,
) {
  const classified = classifyCalls(dispatches);

  return {
    label,
    days,
    totalDepartmentCalls: dispatches.length,
    totalApparatusCalls: filterDispatchesForUnit(dispatches, unit).length,
    emsCalls: classified.emsCalls,
    fireRescueCalls: classified.fireRescueCalls,
    sourceLabel,
  };
}

async function fetchRollingDispatchWindows(unit: UnitMatcher | null) {
  const windows = [
    { label: "Last 24 Hours", days: 1 },
    { label: "Last 7 Days", days: 7 },
    { label: "Last 30 Days", days: 30 },
  ];

  if (!isDatabaseConfigured()) {
    return windows.map((window) => ({
      ...window,
      totalDepartmentCalls: 0,
      totalApparatusCalls: 0,
      emsCalls: 0,
      fireRescueCalls: 0,
      sourceLabel: null,
    }));
  }

  const maxDays = Math.max(...windows.map((window) => window.days));
  const incidents = await getPersistedIncidentsSince(daysAgoIso(maxDays));
  const sourceLabel = `Persisted incident history (${getDispatchRetentionDays()}-day retention)`;

  return windows.map((window) => {
    const threshold = Date.parse(daysAgoIso(window.days));
    const filtered = incidents.filter((dispatch) => {
      const timestamp = dispatch.lastActivityAt ?? dispatch.dispatchedAt ?? null;

      if (!timestamp) {
        return false;
      }

      const parsed = Date.parse(timestamp);
      return Number.isFinite(parsed) && parsed >= threshold;
    });

    return buildRollingWindowSummary(
      window.label,
      window.days,
      filtered,
      unit,
      sourceLabel,
    );
  });
}

export async function fetchDispatchStats(
  unit: UnitMatcher | null,
): Promise<DispatchStatsResult> {
  const year = new Date().getFullYear();
  const sinceIso = easternYearStartSinceIso();
  const rollingWindows = await fetchRollingDispatchWindows(unit);

  const headers = getFirstDueAuthHeaders();
  const apiUrl = getFirstDueApiUrl();

  if (!headers || !apiUrl) {
    return {
      ok: false,
      message: "FirstDue auth is not configured.",
      sourceLabel: null,
      year,
      totalDepartmentCalls: 0,
      totalApparatusCalls: 0,
      emsCalls: 0,
      fireRescueCalls: 0,
      rollingWindows,
    };
  }

  try {
    const first = await fetchDispatchPage(buildStatsUrl(apiUrl, 1, sinceIso), headers);
    const firstResponse = first.response;

    if (!firstResponse.ok) {
      return {
        ok: false,
        message: `Dispatch stats request failed (${firstResponse.status}).`,
        sourceLabel: describeSource(apiUrl),
        year,
        totalDepartmentCalls: 0,
        totalApparatusCalls: 0,
        emsCalls: 0,
        fireRescueCalls: 0,
        rollingWindows,
      };
    }

    const lastPage = parseLastPageFromLinkHeader(firstResponse.headers.get("link"));
    const pageSize = first.dispatches.length || PAGE_SIZE_FALLBACK;
    let totalDepartmentCalls = first.dispatches.length;

    if (lastPage > 1) {
      const last = await fetchDispatchPage(buildStatsUrl(apiUrl, lastPage, sinceIso), headers);

      if (!last.response.ok) {
        return {
          ok: false,
          message: `Dispatch stats request failed (${last.response.status}).`,
          sourceLabel: describeSource(apiUrl),
          year,
          totalDepartmentCalls: 0,
          totalApparatusCalls: 0,
          emsCalls: 0,
          fireRescueCalls: 0,
          rollingWindows,
        };
      }

      totalDepartmentCalls = (lastPage - 1) * pageSize + last.dispatches.length;
    }

    let totalApparatusCalls = filterDispatchesForUnit(first.dispatches, unit).length;
    const firstClassified = classifyCalls(first.dispatches);
    let emsCalls = firstClassified.emsCalls;
    let fireRescueCalls = firstClassified.fireRescueCalls;

    const cappedLastPage = Math.min(lastPage, CLASSIFICATION_MAX_PAGES);

    for (let page = 2; page <= cappedLastPage; page += 1) {
      const current = await fetchDispatchPage(buildStatsUrl(apiUrl, page, sinceIso), headers);

      if (!current.response.ok) {
        break;
      }

      totalApparatusCalls += filterDispatchesForUnit(current.dispatches, unit).length;

      const classified = classifyCalls(current.dispatches);
      emsCalls += classified.emsCalls;
      fireRescueCalls += classified.fireRescueCalls;
    }

    return {
      ok: true,
      message: null,
      sourceLabel: describeSource(apiUrl),
      year,
      totalDepartmentCalls,
      totalApparatusCalls,
      emsCalls,
      fireRescueCalls,
      rollingWindows,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Dispatch stats unavailable.",
      sourceLabel: describeSource(apiUrl),
      year,
      totalDepartmentCalls: 0,
      totalApparatusCalls: 0,
      emsCalls: 0,
      fireRescueCalls: 0,
      rollingWindows,
    };
  }
}
