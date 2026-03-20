import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function buildMockDispatch() {
  const dispatchedAt = new Date(Date.now() - 2 * 60 * 1000 - 15 * 1000);

  return {
    id: 48250564,
    type: "MVA ENTRAPMENT",
    message:
      "MVA, POSS INJ\n[03/18/26 14:37:21 401 C29] PTL CONFIRMS 1 PT CHEST PAIN\n[03/18/26 14:35:45 401 C29] PTL OUT WITH IT JUST BEFORE HARTER RD EXIT\n[03/18/26 14:34:25 253 C10] Situation Updated: 44 (MVA ENTRAPMENT)",
    place_name: null,
    address: "34.0 RT 287 S",
    address2: null,
    cross_streets: null,
    city: "Morris Twp",
    state_code: "NJ",
    latitude: 40.7677,
    longitude: -74.4902,
    unit_codes: [
      "E2366",
      "F22DUTY",
      "F22E2",
      "F22R6",
      "F22CH1",
      "F22E1",
      "F22ISP1",
    ],
    incident_type_code: "44",
    status_code: "open",
    xref_id: "E260770052",
    created_at: dispatchedAt.toISOString(),
    radio_channel: null,
    alarm_level: null,
    incident_number: null,
    fire_zone: "ZONE 2",
    fire_stations: ["Station 1"],
  };
}

export async function GET() {
  return NextResponse.json([buildMockDispatch()]);
}
