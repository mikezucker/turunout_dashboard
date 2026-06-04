type ScheduleEntry = {
  id: string;
  title: string;
  station: string | null;
  timeRange: string;
  staffing: string[];
  staffingDetails?: {
    name: string | null;
    qualifier: string | null;
    isVacant: boolean;
  }[];
};

type ScheduleResult = {
  ok: boolean;
  message: string | null;
  date: string | null;
  entries: ScheduleEntry[];
};

const MTFD_SITE_BASE_URL =
  process.env.MTFD_SITE_BASE_URL ?? "https://new-mtfd-site.vercel.app";

export async function fetchDailySchedule(): Promise<ScheduleResult> {
  try {
    const response = await fetch(`${MTFD_SITE_BASE_URL}/api/shared/schedule/today`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });

    const payload = (await response.json()) as Partial<ScheduleResult>;

    if (!response.ok) {
      return {
        ok: false,
        message: "Failed to load schedule from MTFD Site.",
        date: null,
        entries: [],
      };
    }

    return {
      ok: payload.ok === true,
      message: payload.message ?? null,
      date: payload.date ?? null,
      entries: Array.isArray(payload.entries) ? payload.entries : [],
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to load schedule.",
      date: null,
      entries: [],
    };
  }
}
