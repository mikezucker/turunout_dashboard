import { NextRequest, NextResponse } from "next/server";
import { extractBearerToken, verifyMobileToken } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Missing bearer token." },
        { status: 401 }
      );
    }

    verifyMobileToken(token);

    return NextResponse.json({
      success: true,
      stats: {
        department24h: 0,
        department7d: 0,
        department30d: 0,
        station24h: 0,
        station7d: 0,
        station30d: 0,
      },
      department: {
        total24h: 0,
        total7d: 0,
        total30d: 0,
        fire24h: 0,
        fire7d: 0,
        fire30d: 0,
        ems24h: 0,
        ems7d: 0,
        ems30d: 0,
      },
      station: {
        total24h: 0,
        total7d: 0,
        total30d: 0,
        fire24h: 0,
        fire7d: 0,
        fire30d: 0,
        ems24h: 0,
        ems7d: 0,
        ems30d: 0,
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("GET /api/mobile/stats error:", error);
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }
}