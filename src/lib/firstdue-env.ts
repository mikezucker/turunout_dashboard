import { loadEnvConfig } from "@next/env";

type FirstDueAuthConfig = {
  headerName: string;
  headerValue: string | null;
};

let envLoaded = false;

function ensureServerEnvLoaded() {
  if (envLoaded) {
    return;
  }

  loadEnvConfig(process.cwd());
  envLoaded = true;
}

export function normalizeEnvValue(value: string | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const firstCharacter = trimmed[0];
  const lastCharacter = trimmed[trimmed.length - 1];
  const hasWrappingQuotes =
    (firstCharacter === `"` && lastCharacter === `"`) ||
    (firstCharacter === "'" && lastCharacter === "'");

  if (!hasWrappingQuotes) {
    return trimmed;
  }

  const unwrapped = trimmed.slice(1, -1).trim();
  return unwrapped || null;
}

export function getFirstDueApiUrl() {
  ensureServerEnvLoaded();
  return normalizeEnvValue(process.env.FIRSTDUE_API_URL);
}

export function getFirstDueAuthConfig(): FirstDueAuthConfig {
  ensureServerEnvLoaded();
  const token = normalizeEnvValue(process.env.FIRSTDUE_API_TOKEN);

  return {
    headerName:
      normalizeEnvValue(process.env.FIRSTDUE_API_HEADER_NAME) ?? "Authorization",
    headerValue:
      normalizeEnvValue(process.env.FIRSTDUE_API_HEADER_VALUE) ??
      (token ? `Bearer ${token}` : null),
  };
}

export function getFirstDueAuthHeaders() {
  const { headerName, headerValue } = getFirstDueAuthConfig();

  return headerValue
    ? {
        Accept: "application/json",
        [headerName]: headerValue,
      }
    : null;
}

export function getFirstDueTimeoutMs(fallbackMs: number) {
  ensureServerEnvLoaded();
  const normalizedTimeout = normalizeEnvValue(process.env.FIRSTDUE_TIMEOUT_MS);

  if (!normalizedTimeout) {
    return fallbackMs;
  }

  const parsedTimeout = Number(normalizedTimeout);

  return Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : fallbackMs;
}

export function getFirstDueEnvDebug() {
  ensureServerEnvLoaded();
  const rawApiUrl = process.env.FIRSTDUE_API_URL;
  const apiUrl = getFirstDueApiUrl();
  const rawHeaderName = process.env.FIRSTDUE_API_HEADER_NAME;
  const rawHeaderValue = process.env.FIRSTDUE_API_HEADER_VALUE;
  const rawToken = process.env.FIRSTDUE_API_TOKEN;
  const rawTimeout = process.env.FIRSTDUE_TIMEOUT_MS;
  const normalizedTimeout = normalizeEnvValue(rawTimeout);
  const timeoutMs = getFirstDueTimeoutMs(8000);
  let apiUrlIsValid = false;

  if (apiUrl) {
    try {
      new URL(apiUrl);
      apiUrlIsValid = true;
    } catch {
      apiUrlIsValid = false;
    }
  }

  return {
    apiUrl: {
      present: typeof rawApiUrl === "string",
      normalizedPresent: apiUrl !== null,
      valid: apiUrlIsValid,
      valuePreview: apiUrl ? apiUrl.slice(0, 80) : null,
    },
    auth: {
      headerNamePresent: normalizeEnvValue(rawHeaderName) !== null,
      headerValuePresent: normalizeEnvValue(rawHeaderValue) !== null,
      tokenPresent: normalizeEnvValue(rawToken) !== null,
    },
    timeout: {
      present: typeof rawTimeout === "string",
      normalizedPresent: normalizedTimeout !== null,
      parsedMs: timeoutMs,
    },
    sessionSecretPresent:
      normalizeEnvValue(process.env.TURNOUT_SESSION_SECRET) !== null,
  };
}
