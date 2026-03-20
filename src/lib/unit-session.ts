import crypto from "node:crypto";
import type { LiveWeatherData } from "@/lib/weather";

export type UnitProfile = {
  id: string;
  password: string;
  displayName: string;
  station: string;
  apparatus: string;
  apparatusApiId?: string;
  coverageUnitId?: string;
  radioName: string;
  notes: string[];
  assignments: string[];
  weatherLocation: string;
  weatherSummary: string;
  weatherDetails: string[];
  weatherLatitude?: number;
  weatherLongitude?: number;
  weatherStationId?: string;
  openWorkOrders: string[];
};

export type SerializedUnitProfile = Omit<UnitProfile, "password"> & {
  weatherUpdatedAt: string | null;
  weatherSourceLabel: string | null;
  weatherRadarImageUrl: string | null;
  weatherRadarFrameImageUrls: string[];
  weatherRadarPageUrl: string | null;
  weatherIsLive: boolean;
  coverageDisplayName: string | null;
};

const SESSION_COOKIE = "turnout_unit_session";

function defaultUnits(): UnitProfile[] {
  return [
    {
      id: "engine1",
      password: "changeme",
      displayName: "Engine 1",
      station: "Station 1",
      apparatus: "Engine",
      apparatusApiId: undefined,
      radioName: "E1",
      notes: ["Primary first-due engine", "Confirm MDT and portable radios"],
      assignments: ["EMS responses", "Structure fires", "Automatic aid"],
      weatherLocation: "Morris Twp",
      weatherSummary: "Weather feed not configured",
      weatherDetails: ["Set weather fields in UNIT_ACCOUNTS_JSON"],
      openWorkOrders: ["No open work orders listed"],
    },
    {
      id: "truck1",
      password: "changeme",
      displayName: "Truck 1",
      station: "Station 2",
      apparatus: "Truck",
      apparatusApiId: undefined,
      radioName: "T1",
      notes: ["Check saws and irons", "Review target hazards before shift"],
      assignments: ["Rescue", "Ventilation", "Special service calls"],
      weatherLocation: "Station 2",
      weatherSummary: "Weather feed not configured",
      weatherDetails: ["Set weather fields in UNIT_ACCOUNTS_JSON"],
      openWorkOrders: ["No open work orders listed"],
    },
  ];
}

export function getUnitProfiles(): UnitProfile[] {
  const raw = process.env.UNIT_ACCOUNTS_JSON;

  if (!raw) {
    return defaultUnits();
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return defaultUnits();
    }

    return parsed.flatMap((item) => {
      if (item === null || typeof item !== "object") {
        return [];
      }

      const candidate = item as Partial<UnitProfile>;

      if (
        typeof candidate.id !== "string" ||
        typeof candidate.password !== "string" ||
        typeof candidate.displayName !== "string"
      ) {
        return [];
      }

      return [
        {
          id: candidate.id,
          password: candidate.password,
          displayName: candidate.displayName,
          station:
            typeof candidate.station === "string"
              ? candidate.station
              : "Station not configured",
          apparatus:
            typeof candidate.apparatus === "string"
              ? candidate.apparatus
              : "Apparatus not configured",
          apparatusApiId:
            typeof candidate.apparatusApiId === "string" &&
            candidate.apparatusApiId.trim()
              ? candidate.apparatusApiId
              : undefined,
          coverageUnitId:
            typeof candidate.coverageUnitId === "string" &&
            candidate.coverageUnitId.trim()
              ? candidate.coverageUnitId.trim()
              : undefined,
          radioName:
            typeof candidate.radioName === "string"
              ? candidate.radioName
              : candidate.id,
          notes: Array.isArray(candidate.notes)
            ? candidate.notes.filter(
                (note): note is string => typeof note === "string",
              )
            : [],
          assignments: Array.isArray(candidate.assignments)
            ? candidate.assignments.filter(
                (assignment): assignment is string =>
                  typeof assignment === "string",
              )
            : [],
          weatherLocation:
            typeof candidate.weatherLocation === "string"
              ? candidate.weatherLocation
              : "Location not configured",
          weatherSummary:
            typeof candidate.weatherSummary === "string"
              ? candidate.weatherSummary
              : "Weather feed not configured",
          weatherDetails: Array.isArray(candidate.weatherDetails)
            ? candidate.weatherDetails.filter(
                (detail): detail is string => typeof detail === "string",
              )
            : [],
          weatherLatitude:
            typeof candidate.weatherLatitude === "number" &&
            Number.isFinite(candidate.weatherLatitude)
              ? candidate.weatherLatitude
              : undefined,
          weatherLongitude:
            typeof candidate.weatherLongitude === "number" &&
            Number.isFinite(candidate.weatherLongitude)
              ? candidate.weatherLongitude
              : undefined,
          weatherStationId:
            typeof candidate.weatherStationId === "string" &&
            candidate.weatherStationId.trim()
              ? candidate.weatherStationId.trim().toUpperCase()
              : undefined,
          openWorkOrders: Array.isArray(candidate.openWorkOrders)
            ? candidate.openWorkOrders.filter(
                (order): order is string => typeof order === "string",
              )
            : [],
        },
      ];
    });
  } catch {
    return defaultUnits();
  }
}

export function getUnitProfile(unitId: string) {
  return getUnitProfiles().find((unit) => unit.id === unitId) ?? null;
}

export function getCoverageUnit(unit: UnitProfile | null) {
  if (!unit?.coverageUnitId) {
    return null;
  }

  return (
    getUnitProfiles().find((candidate) => candidate.id === unit.coverageUnitId) ?? null
  );
}

export function getEffectiveApparatusApiId(unit: UnitProfile | null) {
  const coverageUnit = getCoverageUnit(unit);
  return coverageUnit?.apparatusApiId ?? unit?.apparatusApiId;
}

export function getDispatchAliasTokens(unit: UnitProfile | null) {
  const aliases = new Set<string>();

  if (!unit) {
    return [];
  }

  const coverageUnit = getCoverageUnit(unit);

  for (const candidate of [unit, coverageUnit]) {
    if (!candidate) {
      continue;
    }

    aliases.add(candidate.id);
    aliases.add(candidate.displayName);
    aliases.add(candidate.apparatus);
    aliases.add(candidate.radioName);

    if (candidate.apparatusApiId) {
      aliases.add(candidate.apparatusApiId);
    }

    aliases.add(`${candidate.apparatus} ${candidate.id}`);
    aliases.add(`${candidate.apparatus} ${candidate.radioName}`);
    aliases.add(`${candidate.apparatus}${candidate.radioName}`);
  }

  return [...aliases];
}

function getSecret() {
  return process.env.TURNOUT_SESSION_SECRET ?? "local-dev-turnout-secret";
}

function sign(value: string) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

export function createSessionToken(unitId: string) {
  const signature = sign(unitId);
  return Buffer.from(`${unitId}.${signature}`).toString("base64url");
}

export function readSessionToken(token: string | undefined) {
  if (!token) {
    return null;
  }

  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [unitId, signature] = decoded.split(".");

    if (!unitId || !signature) {
      return null;
    }

    if (sign(unitId) !== signature) {
      return null;
    }

    return unitId;
  } catch {
    return null;
  }
}

export function sessionCookieName() {
  return SESSION_COOKIE;
}

export function serializeUnitProfile(
  unit: UnitProfile,
  weather?: LiveWeatherData | null,
): SerializedUnitProfile {
  const coverageUnit = getCoverageUnit(unit);

  return {
    id: unit.id,
    displayName: unit.displayName,
    station: unit.station,
    apparatus: unit.apparatus,
    apparatusApiId: unit.apparatusApiId,
    radioName: unit.radioName,
    notes: unit.notes,
    assignments: unit.assignments,
    weatherLocation: weather?.location ?? unit.weatherLocation,
    weatherSummary: weather?.summary ?? unit.weatherSummary,
    weatherDetails: weather?.details ?? unit.weatherDetails,
    weatherLatitude: unit.weatherLatitude,
    weatherLongitude: unit.weatherLongitude,
    weatherStationId: unit.weatherStationId,
    weatherUpdatedAt: weather?.updatedAt ?? null,
    weatherSourceLabel: weather?.sourceLabel ?? null,
    weatherRadarImageUrl: weather?.radarImageUrl ?? null,
    weatherRadarFrameImageUrls: weather?.radarFrameImageUrls ?? [],
    weatherRadarPageUrl: weather?.radarPageUrl ?? null,
    weatherIsLive: weather?.isLive ?? false,
    openWorkOrders: unit.openWorkOrders,
    coverageDisplayName: coverageUnit?.displayName ?? null,
  };
}
