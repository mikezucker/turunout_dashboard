const NOTIFICATION_UNITS = [
  { id: "F22MAN1", name: "Station 1" },
  { id: "F22MAN2", name: "Station 2" },
  { id: "F22MAN3", name: "Station 3" },
  { id: "F22MAN4", name: "Station 4" },
  { id: "F22MAN5", name: "Station 5" },
];

const NON_RESPONDING_UNIT_PATTERNS = [
  /^hq$/i,
  /^oem$/i,
  /^station$/i,
  /^station\s*[1-5]$/i,
];

const NON_RESPONDING_UNIT_IDS = new Set(
  NOTIFICATION_UNITS.map((unit) => unit.id.trim().toLowerCase()),
);

const NON_RESPONDING_UNIT_NAMES = new Set(
  NOTIFICATION_UNITS.map((unit) => unit.name.trim().toLowerCase()),
);

export function filterRespondingUnits(units: string[]) {
  const seen = new Set<string>();

  return units
    .map((unit) => unit.trim())
    .filter((unit) => {
      if (!unit) {
        return false;
      }

      const key = unit.toLowerCase();

      if (NON_RESPONDING_UNIT_IDS.has(key)) {
        return false;
      }

      if (NON_RESPONDING_UNIT_NAMES.has(key)) {
        return false;
      }

      if (NON_RESPONDING_UNIT_PATTERNS.some((pattern) => pattern.test(unit))) {
        return false;
      }

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}
