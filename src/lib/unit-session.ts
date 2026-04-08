import crypto from "node:crypto";
import type { LiveWeatherData } from "@/lib/weather";

export type UnitProfile = {
  id: string;
  password: string;
  displayName: string;
  station: string;
  apparatus: string;
  apparatusApiId?: string;
  dispatchAliases?: string[];
  coverageUnitId?: string;
  memberUnitIds?: string[];
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
  memberUnitDisplayNames: string[];
  scopeKind: "apparatus" | "station";
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
      dispatchAliases: [],
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
      dispatchAliases: [],
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
          dispatchAliases: Array.isArray(candidate.dispatchAliases)
            ? candidate.dispatchAliases.filter(
                (alias): alias is string => typeof alias === "string" && alias.trim().length > 0,
              )
            : [],
          coverageUnitId:
            typeof candidate.coverageUnitId === "string" &&
            candidate.coverageUnitId.trim()
              ? candidate.coverageUnitId.trim()
              : undefined,
          memberUnitIds: Array.isArray(candidate.memberUnitIds)
            ? candidate.memberUnitIds.filter(
                (memberUnitId): memberUnitId is string =>
                  typeof memberUnitId === "string" && memberUnitId.trim().length > 0,
              )
            : [],
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
  return getEffectiveApparatusApiIds(unit)[0];
}

function resolveUnitGroup(
  unit: UnitProfile | null,
  seen = new Set<string>(),
): UnitProfile[] {
  if (!unit || seen.has(unit.id)) {
    return [];
  }

  seen.add(unit.id);

  const units = [unit];
  const coverageUnit = getCoverageUnit(unit);

  if (coverageUnit && !seen.has(coverageUnit.id)) {
    units.push(...resolveUnitGroup(coverageUnit, seen));
  }

  for (const memberUnitId of unit.memberUnitIds ?? []) {
    const memberUnit = getUnitProfile(memberUnitId);

    if (memberUnit && !seen.has(memberUnit.id)) {
      units.push(...resolveUnitGroup(memberUnit, seen));
    }
  }

  return units;
}

export function getEffectiveApparatusApiIds(unit: UnitProfile | null) {
  const ids = new Set<string>();

  for (const candidate of resolveUnitGroup(unit)) {
    if (candidate.apparatusApiId) {
      ids.add(candidate.apparatusApiId);
    }
  }

  return [...ids];
}

export function getWorkOrderTargets(unit: UnitProfile | null) {
  const targets = new Map<
    string,
    {
      apparatusApiId: string;
      displayName: string;
    }
  >();

  for (const candidate of resolveUnitGroup(unit)) {
    if (!candidate.apparatusApiId) {
      continue;
    }

    targets.set(candidate.apparatusApiId, {
      apparatusApiId: candidate.apparatusApiId,
      displayName: candidate.displayName,
    });
  }

  return [...targets.values()];
}

function deriveDispatchAliases(
  candidate: Pick<UnitProfile, "id" | "apparatus" | "radioName">,
) {
  const aliases = new Set<string>();
  const apparatus = candidate.apparatus.trim().toLowerCase();
  const radioName = candidate.radioName.trim().toLowerCase();
  const id = candidate.id.trim().toLowerCase();
  const digits = radioName.match(/\d+/)?.[0] ?? id.match(/\d+/)?.[0] ?? "";

  if (!digits) {
    return [];
  }

  const shorthandByApparatus: Record<string, string[]> = {
    engine: ["eng"],
    truck: ["trk", "truck"],
    ladder: ["lad", "ldr"],
    rescue: ["res"],
    squad: ["sqd"],
    tanker: ["tnk"],
    brush: ["brs"],
  };

  for (const shorthand of shorthandByApparatus[apparatus] ?? []) {
    aliases.add(`${shorthand}${digits}`);
  }

  return [...aliases];
}

export function getDispatchAliasTokens(unit: UnitProfile | null) {
  const aliases = new Set<string>();

  if (!unit) {
    return [];
  }

  for (const candidate of resolveUnitGroup(unit)) {
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

    for (const alias of candidate.dispatchAliases ?? []) {
      aliases.add(alias);
    }

    for (const alias of deriveDispatchAliases(candidate)) {
      aliases.add(alias);
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
  const memberUnits = (unit.memberUnitIds ?? [])
    .map((memberUnitId) => getUnitProfile(memberUnitId))
    .filter((candidate): candidate is UnitProfile => candidate !== null);

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
    memberUnitDisplayNames: memberUnits.map((memberUnit) => memberUnit.displayName),
    scopeKind: memberUnits.length > 0 ? "station" : "apparatus",
  };
}
