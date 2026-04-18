import { loadEnvConfig } from "@next/env";
import { normalizeEnvValue } from "@/lib/firstdue-env";
import { getUnitProfile } from "@/lib/unit-session";

export type DashboardAudience = "STATION" | "OFFICER";

export type DashboardNote = {
  id: string;
  audience: DashboardAudience;
  title: string;
  body: string;
  stationTag: string | null;
  isPinned: boolean;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
};

type DashboardNotesUpstreamResponse = {
  ok?: boolean;
  error?: string;
  notes?: DashboardNote[];
};

type DashboardNotesFetchResult = {
  ok: boolean;
  message: string | null;
  stationNotes: DashboardNote[];
  officerNotes: DashboardNote[];
};

let envLoaded = false;

function ensureServerEnvLoaded() {
  if (envLoaded) {
    return;
  }

  loadEnvConfig(process.cwd());
  envLoaded = true;
}

function getDashboardNotesApiUrl() {
  ensureServerEnvLoaded();
  return normalizeEnvValue(process.env.DASHBOARD_NOTES_API_URL);
}

function getDashboardNotesApiToken() {
  ensureServerEnvLoaded();
  return normalizeEnvValue(process.env.DASHBOARD_API_TOKEN);
}

function getDashboardNotesTimeoutMs() {
  ensureServerEnvLoaded();
  const parsed = Number(normalizeEnvValue(process.env.DASHBOARD_NOTES_TIMEOUT_MS) ?? "8000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8000;
}

function splitDashboardNotes(notes: DashboardNote[]) {
  return {
    stationNotes: notes.filter((note) => note.audience === "STATION"),
    officerNotes: notes.filter((note) => note.audience === "OFFICER"),
  };
}

export async function fetchDashboardNotesForUnit(unitId: string): Promise<DashboardNotesFetchResult> {
  const unit = getUnitProfile(unitId);

  if (!unit) {
    return {
      ok: false,
      message: "Unit profile not found.",
      stationNotes: [],
      officerNotes: [],
    };
  }

  const apiUrl = getDashboardNotesApiUrl();
  const apiToken = getDashboardNotesApiToken();

  if (!apiUrl || !apiToken) {
    return {
      ok: false,
      message: "Dashboard notes feed is not configured.",
      stationNotes: [],
      officerNotes: [],
    };
  }

  let requestUrl: URL;

  try {
    requestUrl = new URL(apiUrl);
  } catch {
    return {
      ok: false,
      message: "Dashboard notes API URL is invalid.",
      stationNotes: [],
      officerNotes: [],
    };
  }

  requestUrl.searchParams.set("station", unit.station);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getDashboardNotesTimeoutMs());

  try {
    const response = await fetch(requestUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as DashboardNotesUpstreamResponse | null;

    if (!response.ok) {
      return {
        ok: false,
        message: payload?.error ?? `Dashboard notes request failed (${response.status}).`,
        stationNotes: [],
        officerNotes: [],
      };
    }

    const notes = Array.isArray(payload?.notes) ? payload.notes : [];

    return {
      ok: true,
      message: null,
      ...splitDashboardNotes(notes),
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Dashboard notes request failed.",
      stationNotes: [],
      officerNotes: [],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
