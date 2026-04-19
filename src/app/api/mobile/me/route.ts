import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractBearerToken, verifyMobileToken } from "@/lib/mobile-auth";
import { mobileMemberFromUser } from "@/lib/mobile-response";

export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Missing bearer token." },
        { status: 401 }
      );
    }

    const payload = verifyMobileToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        badgeNumber: true,
        status: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "User not found." },
        { status: 404 }
      );
    }

    if (user.status && user.status !== "ACTIVE") {
      return NextResponse.json(
        { success: false, error: "Account is not active." },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      member: mobileMemberFromUser(user),
    });
  } catch (error) {
    console.error("GET /api/mobile/me error:", error);
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }
}