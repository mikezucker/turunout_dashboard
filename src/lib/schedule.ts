import { getFirstDueAuthHeaders } from "@/lib/firstdue-env";

type ScheduleEntry = {
  id: string;
  title: string;
  station: string | null;
  timeRange: string;
  staffing: string[];
};

type ScheduleResult = {
  ok: boolean;
  message: string | null;
  date: string | null;
  entries: ScheduleEntry[];
};

type Dictionary = Record<string, unknown>;

function asDictionary(value: unknown): Dictionary | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Dictionary)
    : null;
}

function pickString(record: Dictionary, key: string) {
  const value = record[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatTimeRange(startValue: string | null, endValue: string | null) {
  if (!startValue || !endValue) {
    return "Time not listed";
  }

  const start = new Date(startValue);
  const end = new Date(endValue);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Time not listed";
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function normalizeScheduleEntry(item: unknown, index: number): ScheduleEntry | null {
  const record = asDictionary(item);

  if (!record) {
    return null;
  }

  const positions = Array.isArray(record.positions) ? record.positions : [];
  const staffing = positions.flatMap((position) => {
    const positionRecord = asDictionary(position);

    if (!positionRecord) {
      return [];
    }

    const workShifts = Array.isArray(positionRecord.work_shifts)
      ? positionRecord.work_shifts
      : [];
    const firstShift = asDictionary(workShifts[0]);
    const user = firstShift ? asDictionary(firstShift.user) : null;

    if (user) {
      const publicName = pickString(user, "public_name");
      const qualifier = pickString(user, "qualifier_required");

      if (publicName && qualifier) {
        return [`${qualifier}: ${publicName}`];
      }

      return publicName ? [publicName] : [];
    }

    return positionRecord.is_vacant === true ? ["Vacant"] : [];
  });

  return {
    id: pickString(record, "id") ?? `schedule-${index}`,
    title: pickString(record, "name") ?? `Assignment ${index + 1}`,
    station: pickString(record, "station"),
    timeRange: formatTimeRange(
      pickString(record, "start_at_local"),
      pickString(record, "end_at_local"),
    ),
    staffing: staffing.slice(0, 4),
  };
}

export async function fetchDailySchedule(): Promise<ScheduleResult> {
  const headers = getFirstDueAuthHeaders();

  if (!headers) {
    return {
      ok: false,
      message: "FirstDue auth is not configured.",
      date: null,
      entries: [],
    };
  }

  const response = await fetch("https://sizeup.firstduesizeup.com/fd-api/v1/schedule", {
    headers,
    cache: "no-store",
  });
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    return {
      ok: false,
      message: "Failed to load FirstDue schedule.",
      date: null,
      entries: [],
    };
  }

  const days = Array.isArray(payload) ? payload : [];
  const day = asDictionary(days[0]);

  if (!day) {
    return {
      ok: true,
      message: "No schedule returned for today.",
      date: null,
      entries: [],
    };
  }

  const assignments = Array.isArray(day.assignments) ? day.assignments : [];
  const entries = assignments
    .filter((item) => {
      const record = asDictionary(item);

      if (!record) {
        return false;
      }

      const board = Array.isArray(record.board) ? record.board : [];
      return board.length > 0;
    })
    .map(normalizeScheduleEntry)
    .filter((entry): entry is ScheduleEntry => entry !== null);

  return {
    ok: true,
    message: null,
    date: pickString(day, "date"),
    entries,
  };
}
