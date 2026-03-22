type FirstDueAuthConfig = {
  headerName: string;
  headerValue: string | null;
};

function normalizeEnvValue(value: string | undefined) {
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
  return normalizeEnvValue(process.env.FIRSTDUE_API_URL);
}

export function getFirstDueAuthConfig(): FirstDueAuthConfig {
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
  const parsedTimeout = Number(normalizeEnvValue(process.env.FIRSTDUE_TIMEOUT_MS));
  return Number.isFinite(parsedTimeout) ? parsedTimeout : fallbackMs;
}
