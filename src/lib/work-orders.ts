import { getFirstDueAuthHeaders } from "@/lib/firstdue-env";
import { getEffectiveApparatusApiId, getUnitProfile } from "@/lib/unit-session";

type WorkOrderRecord = {
  id: string;
  title: string;
  status: string | null;
};

type Dictionary = Record<string, unknown>;

function asDictionary(value: unknown): Dictionary | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Dictionary)
    : null;
}

function pickString(record: Dictionary, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }

  return null;
}

function inferArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asDictionary(payload);

  if (!record) {
    return [];
  }

  for (const key of ["data", "results", "items", "work_orders", "workOrders"]) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function parsePayload(body: string, contentType: string) {
  if (contentType.includes("application/json")) {
    return JSON.parse(body) as unknown;
  }

  const trimmed = body.trim();

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return body;
    }
  }

  return body;
}

function normalizeWorkOrders(payload: unknown): WorkOrderRecord[] {
  return inferArray(payload).flatMap((item, index) => {
    const record = asDictionary(item);

    if (!record) {
      return [];
    }

    const id =
      pickString(record, ["id", "uuid", "work_order_id", "workOrderId"]) ??
      `work-order-${index}`;
    const number = pickString(record, ["number", "work_order_number", "orderNumber"]);
    const title =
      pickString(record, [
        "title",
        "subject",
        "name",
        "description",
        "issue",
        "problem",
      ]) ??
      number ??
      id;
    const status = pickString(record, ["status", "status_code", "state"]);

    return [{ id, title: number ? `${number} - ${title}` : title, status }];
  });
}

function isExcludedWorkOrder(workOrder: WorkOrderRecord) {
  const normalizedTitle = workOrder.title.toLowerCase();
  const normalizedStatus = workOrder.status?.toLowerCase() ?? "";

  if (
    normalizedStatus.includes("completed") ||
    normalizedStatus.includes("complete") ||
    normalizedStatus.includes("closed") ||
    normalizedStatus.includes("no repair")
  ) {
    return true;
  }

  if (
    normalizedTitle.includes("preventative maintenance") ||
    normalizedTitle.includes("preventive maintenance") ||
    normalizedTitle.includes("annual pump test") ||
    normalizedTitle.includes("annual pump maintenance") ||
    normalizedTitle.includes("annual maintenance") ||
    normalizedTitle.includes("maintenance")
  ) {
    return true;
  }

  return false;
}

export async function fetchUnitWorkOrders(unitId: string) {
  const unit = getUnitProfile(unitId);

  if (!unit) {
    return {
      ok: false,
      message: "Unit not found.",
      workOrders: [] as WorkOrderRecord[],
    };
  }

  const apparatusApiId = getEffectiveApparatusApiId(unit);

  if (!apparatusApiId) {
    return {
      ok: true,
      message: "Set apparatusApiId in UNIT_ACCOUNTS_JSON to load live work orders.",
      workOrders: unit.openWorkOrders.map((title, index) => ({
        id: `fallback-${index}`,
        title,
        status: null,
      })),
    };
  }

  const headers = getFirstDueAuthHeaders();

  if (!headers) {
    return {
      ok: false,
      message: "FirstDue auth is not configured.",
      workOrders: [] as WorkOrderRecord[],
    };
  }

  const response = await fetch(
    `https://sizeup.firstduesizeup.com/fd-api/v1/apparatuses/${apparatusApiId}/work-orders`,
    {
      headers,
      cache: "no-store",
    },
  );
  const body = await response.text();
  const payload = parsePayload(body, response.headers.get("content-type") ?? "");

  if (!response.ok) {
    const record = asDictionary(payload);
    const message =
      (record && pickString(record, ["message", "error"])) ??
      "Failed to load apparatus work orders.";

    return {
      ok: false,
      message,
      workOrders: unit.openWorkOrders.map((title, index) => ({
        id: `fallback-${index}`,
        title,
        status: null,
      })),
    };
  }

  const workOrders = normalizeWorkOrders(payload).filter(
    (workOrder) => !isExcludedWorkOrder(workOrder),
  );

  return {
    ok: true,
    message:
      workOrders.length > 0 ? null : "There are no active work orders for this apparatus.",
    workOrders,
  };
}
