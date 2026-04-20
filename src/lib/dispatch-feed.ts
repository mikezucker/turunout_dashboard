import {
  filterDispatchesForUnit,
  type DispatchFetchResult,
} from "@/lib/dispatches";
import { type DispatchRecord } from "@/lib/dispatch-shared";
import {
  getDispatchAliasTokens,
  getUnitProfile,
} from "@/lib/unit-session";

export type DispatchApiResponse = {
  fetchedAt: string;
  configured: boolean;
  upstreamStatus: number | null;
  dispatches: DispatchRecord[];
  message: string | null;
  rawPreview?: unknown;
  sourceLabel: string | null;
};

export type DispatchSnapshot = {
  fetchedAt: string;
  revision: number;
  result: DispatchFetchResult;
};

export function buildDispatchApiResponse(
  snapshot: DispatchSnapshot,
  unitId: string | null,
): DispatchApiResponse {
  return buildDispatchApiResponseFromResult(
    snapshot.result,
    snapshot.fetchedAt,
    unitId,
  );
}

export function buildDispatchApiResponseFromResult(
  result: DispatchFetchResult,
  fetchedAt: string,
  unitId: string | null,
): DispatchApiResponse {
  const unit = unitId ? getUnitProfile(unitId) : null;
  const dispatches = filterDispatchesForUnit(
    result.dispatches,
    unit
      ? {
          ...unit,
          dispatchAliases: getDispatchAliasTokens(unit),
        }
      : null,
  );

  return {
    fetchedAt,
    ...result,
    dispatches,
  };
}

export function dispatchApiStatusCode(response: DispatchApiResponse) {
  return response.upstreamStatus && response.upstreamStatus >= 400
    ? response.upstreamStatus
    : 200;
}
