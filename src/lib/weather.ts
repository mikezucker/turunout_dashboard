import type { UnitProfile } from "@/lib/unit-session";

export type LiveWeatherData = {
  location: string;
  summary: string;
  details: string[];
  updatedAt: string | null;
  sourceLabel: string;
  radarImageUrl: string | null;
  radarFrameImageUrls: string[];
  radarPageUrl: string | null;
  isLive: boolean;
};

type Dictionary = Record<string, unknown>;

const NOAA_SOURCE_LABEL = "NOAA / National Weather Service";
const WEATHER_DISPLAY_LOCATION = "Morristown, NJ";
const MORRISTOWN_RADAR_SITE_ID = "KDIX";

function nwsRadarUrls() {
  return {
    radarImageUrl: `https://radar.weather.gov/ridge/standard/${MORRISTOWN_RADAR_SITE_ID}_loop.gif`,
    radarFrameImageUrls: [],
    radarPageUrl: `https://radar.weather.gov/station/${MORRISTOWN_RADAR_SITE_ID}/standard`,
  };
}

function asDictionary(value: unknown): Dictionary | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Dictionary)
    : null;
}

function pickString(record: Dictionary | null, key: string) {
  if (!record) {
    return null;
  }

  const value = record[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return null;
}

function pickNumber(record: Dictionary | null, key: string) {
  if (!record) {
    return null;
  }

  const value = record[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatLocation(unit: UnitProfile, pointProperties: Dictionary | null) {
  void unit;
  void pointProperties;
  return WEATHER_DISPLAY_LOCATION;
}

function cardinalDirection(degrees: number | null) {
  if (degrees === null) {
    return null;
  }

  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % directions.length;

  return directions[index];
}

function fahrenheitFromCelsius(value: number | null) {
  if (value === null) {
    return null;
  }

  return (value * 9) / 5 + 32;
}

function mphFromMetersPerSecond(value: number | null) {
  if (value === null) {
    return null;
  }

  return value * 2.2369362921;
}

function inchesFromMillimeters(value: number | null) {
  if (value === null) {
    return null;
  }

  return value / 25.4;
}

function formatWholeNumber(value: number | null, suffix: string) {
  if (value === null) {
    return null;
  }

  return `${Math.round(value)}${suffix}`;
}

function formatDecimal(value: number | null, suffix: string) {
  if (value === null) {
    return null;
  }

  return `${value.toFixed(2)}${suffix}`;
}

function observationIsFresh(timestamp: string | null) {
  if (!timestamp) {
    return false;
  }

  const observedAt = Date.parse(timestamp);

  if (Number.isNaN(observedAt)) {
    return false;
  }

  return Date.now() - observedAt <= 90 * 60 * 1000;
}

function weatherHeaders() {
  const userAgent =
    process.env.TURNOUT_WEATHER_USER_AGENT ??
    "Turnout/0.1 (weather integration; contact not configured)";

  return {
    Accept: "application/geo+json",
    "User-Agent": userAgent,
  };
}

function weatherTimeoutMs() {
  const timeout = Number(process.env.TURNOUT_WEATHER_TIMEOUT_MS ?? "8000");
  return Number.isFinite(timeout) ? timeout : 8000;
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: weatherHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(weatherTimeoutMs()),
  });
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const record = asDictionary(payload);
    const detail = pickString(record, "detail") ?? pickString(record, "title");
    throw new Error(detail ?? `Weather request failed with ${response.status}.`);
  }

  return payload;
}

function fallbackWeather(unit: UnitProfile, reason?: string): LiveWeatherData {
  const details = [...unit.weatherDetails];

  if (reason) {
    details.unshift(reason);
  }

  return {
    location: WEATHER_DISPLAY_LOCATION,
    summary: unit.weatherSummary,
    details: details.length > 0 ? details : ["Weather feed not configured."],
    updatedAt: null,
    sourceLabel: NOAA_SOURCE_LABEL,
    ...nwsRadarUrls(),
    isLive: false,
  };
}

function prioritizeDetails(details: Array<string | null>) {
  const rankedDetails = details
    .filter((detail): detail is string => detail !== null)
    .map((detail) => {
      const normalized = detail.toLowerCase();
      let rank = 99;

      if (normalized.startsWith("active alerts:")) {
        rank = 0;
      } else if (normalized.startsWith("wind ")) {
        rank = 1;
      } else if (normalized.startsWith("relative humidity")) {
        rank = 2;
      } else if (
        normalized.startsWith("precipitation chance") ||
        normalized.includes("rain last hr")
      ) {
        rank = 3;
      } else if (
        normalized.startsWith("observed temperature") ||
        normalized.includes("temperature ")
      ) {
        rank = 4;
      } else if (normalized.startsWith("next hour:")) {
        rank = 5;
      } else if (normalized.startsWith("heat index") || normalized.startsWith("wind chill")) {
        rank = 6;
      } else if (normalized.startsWith("observation station")) {
        rank = 7;
      }

      return { detail, rank };
    })
    .sort((left, right) => left.rank - right.rank);

  return rankedDetails.map((item) => item.detail);
}

export async function fetchLiveWeather(unit: UnitProfile): Promise<LiveWeatherData> {
  if (
    typeof unit.weatherLatitude !== "number" ||
    typeof unit.weatherLongitude !== "number"
  ) {
    return fallbackWeather(
      unit,
      "Set weatherLatitude and weatherLongitude in UNIT_ACCOUNTS_JSON for live NOAA weather.",
    );
  }

  try {
    const point = asDictionary(
      await fetchJson(
        `https://api.weather.gov/points/${unit.weatherLatitude.toFixed(4)},${unit.weatherLongitude.toFixed(4)}`,
      ),
    );
    const pointProperties = asDictionary(point?.properties);
    const forecastHourlyUrl = pickString(pointProperties, "forecastHourly");
    const stationsUrl = pickString(pointProperties, "observationStations");
    const location = formatLocation(unit, pointProperties);

    if (!forecastHourlyUrl || !stationsUrl) {
      return fallbackWeather(unit, "NOAA weather point lookup did not return forecast endpoints.");
    }

    const [forecastHourlyPayload, stationsPayload, alertsPayload] = await Promise.all([
      fetchJson(forecastHourlyUrl),
      fetchJson(stationsUrl),
      fetchJson(
        `https://api.weather.gov/alerts/active?point=${unit.weatherLatitude.toFixed(4)},${unit.weatherLongitude.toFixed(4)}`,
      ),
    ]);

    const forecastProperties = asDictionary(asDictionary(forecastHourlyPayload)?.properties);
    const forecastPeriods = Array.isArray(forecastProperties?.periods)
      ? forecastProperties.periods
      : [];
    const currentForecast =
      forecastPeriods.length > 0 ? asDictionary(forecastPeriods[0]) : null;

    const stations = Array.isArray(asDictionary(stationsPayload)?.features)
      ? (asDictionary(stationsPayload)?.features as unknown[])
      : [];
    const configuredStationId = unit.weatherStationId?.toUpperCase() ?? null;
    const stationId =
      configuredStationId ??
      stations
        .map((station) => asDictionary(station))
        .map((station) => asDictionary(station?.properties))
        .map((station) => pickString(station, "stationIdentifier"))
        .find((station): station is string => station !== null) ??
      null;

    const observationPayload = stationId
      ? await fetchJson(
          `https://api.weather.gov/stations/${stationId}/observations/latest?require_qc=true`,
        )
      : null;
    const observationProperties = asDictionary(
      asDictionary(observationPayload)?.properties,
    );

    const observationTimestamp = pickString(observationProperties, "timestamp");
    const freshObservation = observationIsFresh(observationTimestamp);
    const observationText = pickString(observationProperties, "textDescription");
    const observationTemperature = formatWholeNumber(
      fahrenheitFromCelsius(
        pickNumber(asDictionary(observationProperties?.temperature), "value"),
      ),
      "F",
    );
    const humidity = formatWholeNumber(
      pickNumber(asDictionary(observationProperties?.relativeHumidity), "value"),
      "%",
    );
    const windMph = formatWholeNumber(
      mphFromMetersPerSecond(
        pickNumber(asDictionary(observationProperties?.windSpeed), "value"),
      ),
      " mph",
    );
    const windDirection = cardinalDirection(
      pickNumber(asDictionary(observationProperties?.windDirection), "value"),
    );
    const windChill = formatWholeNumber(
      fahrenheitFromCelsius(
        pickNumber(asDictionary(observationProperties?.windChill), "value"),
      ),
      "F",
    );
    const heatIndex = formatWholeNumber(
      fahrenheitFromCelsius(
        pickNumber(asDictionary(observationProperties?.heatIndex), "value"),
      ),
      "F",
    );
    const precipitation = formatDecimal(
      inchesFromMillimeters(
        pickNumber(asDictionary(observationProperties?.precipitationLastHour), "value"),
      ),
      "\" rain last hr",
    );

    const forecastName = pickString(currentForecast, "name");
    const forecastShort = pickString(currentForecast, "shortForecast");
    const forecastTemperature = pickNumber(currentForecast, "temperature");
    const forecastTempUnit = pickString(currentForecast, "temperatureUnit") ?? "F";
    const forecastWindSpeed = pickString(currentForecast, "windSpeed");
    const forecastWindDirection = pickString(currentForecast, "windDirection");
    const precipProbability = formatWholeNumber(
      pickNumber(asDictionary(currentForecast?.probabilityOfPrecipitation), "value"),
      "%",
    );

    const alerts = Array.isArray(asDictionary(alertsPayload)?.features)
      ? (asDictionary(alertsPayload)?.features as unknown[])
      : [];
    const activeAlerts = alerts
      .map((feature) => asDictionary(feature))
      .map((feature) => asDictionary(feature?.properties))
      .map((properties) => pickString(properties, "event"))
      .filter((event): event is string => event !== null)
      .slice(0, 2);

    const summaryBase =
      activeAlerts.length > 0
        ? activeAlerts[0]
        : freshObservation && observationText
          ? observationTemperature
            ? `${observationText}, ${observationTemperature}`
            : observationText
          : forecastShort ?? unit.weatherSummary;

    const details = prioritizeDetails([
      activeAlerts.length > 0 ? `Active alerts: ${activeAlerts.join(" | ")}` : null,
      windMph
        ? `Wind ${[windDirection, windMph].filter(Boolean).join(" ")}`
        : forecastWindSpeed
          ? `Forecast wind ${[forecastWindDirection, forecastWindSpeed].filter(Boolean).join(" ")}`
          : null,
      humidity ? `Relative humidity ${humidity}` : null,
      precipProbability ? `Precipitation chance ${precipProbability}` : null,
      freshObservation && precipitation ? precipitation : null,
      freshObservation && observationTemperature
        ? `Observed temperature ${observationTemperature}`
        : forecastTemperature !== null
          ? `${forecastName ?? "Current"} temperature ${Math.round(forecastTemperature)}${forecastTempUnit}`
          : null,
      freshObservation && forecastShort ? `Next hour: ${forecastShort}` : null,
      heatIndex ? `Heat index ${heatIndex}` : null,
      windChill ? `Wind chill ${windChill}` : null,
      stationId ? `Observation station ${stationId}` : null,
    ]);

    return {
      location,
      summary: summaryBase,
      details: details.slice(0, 6),
      updatedAt:
        (freshObservation ? observationTimestamp : null) ??
        pickString(forecastProperties, "updated") ??
        null,
      sourceLabel: NOAA_SOURCE_LABEL,
      ...nwsRadarUrls(),
      isLive: true,
    };
  } catch (error) {
    return fallbackWeather(
      unit,
      error instanceof Error ? error.message : "NOAA weather request failed.",
    );
  }
}
