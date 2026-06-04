import { getUnitProfile, getWorkOrderTargets } from "@/lib/unit-session";

type WorkOrderRecord = {
  id: string;
  title: string;
  status: string | null;
};

type WorkOrderGroup = {
  apparatusApiId: string;
  displayName: string;
  workOrders: WorkOrderRecord[];
};

const MTFD_SITE_BASE_URL =
  process.env.MTFD_SITE_BASE_URL ?? "https://new-mtfd-site.vercel.app";

export async function fetchUnitWorkOrders(unitId: string) {
  const unit = getUnitProfile(unitId);

  if (!unit) {
    return {
      ok: false,
      message: "Unit not found.",
      workOrders: [] as WorkOrderRecord[],
      workOrderGroups: [] as WorkOrderGroup[],
    };
  }

  const workOrderTargets = getWorkOrderTargets(unit);

  if (workOrderTargets.length === 0) {
    return {
      ok: true,
      message: "Set apparatusApiId in UNIT_ACCOUNTS_JSON to load live work orders.",
      workOrders: unit.openWorkOrders.map((title, index) => ({
        id: `fallback-${index}`,
        title,
        status: null,
      })),
      workOrderGroups: [] as WorkOrderGroup[],
    };
  }

  try {
    const params = new URLSearchParams({
      targets: JSON.stringify(workOrderTargets),
    });

    const response = await fetch(
      `${MTFD_SITE_BASE_URL}/api/shared/work-orders?${params.toString()}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      },
    );

    const payload = (await response.json()) as {
      ok?: boolean;
      message?: string | null;
      workOrders?: WorkOrderRecord[];
      workOrderGroups?: WorkOrderGroup[];
    };

    return {
      ok: payload.ok === true,
      message: payload.message ?? null,
      workOrders: Array.isArray(payload.workOrders) ? payload.workOrders : [],
      workOrderGroups: Array.isArray(payload.workOrderGroups)
        ? payload.workOrderGroups
        : [],
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to load apparatus work orders.",
      workOrders: unit.openWorkOrders.map((title, index) => ({
        id: `fallback-${index}`,
        title,
        status: null,
      })),
      workOrderGroups: [] as WorkOrderGroup[],
    };
  }
}
