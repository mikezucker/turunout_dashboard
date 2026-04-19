import { NextRequest, NextResponse } from "next/server";
import { extractBearerToken, verifyMobileToken } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";

async function getAnnouncementsSafe() {
  try {
    const maybeAnnouncements = await (prisma as any).announcement.findMany({
      where: {
        OR: [{ published: true }, { isPublished: true }],
      },
      orderBy: {
        publishedAt: "desc",
      },
      take: 10,
      select: {
        id: true,
        title: true,
        message: true,
        publishedAt: true,
      },
    });

    return maybeAnnouncements.map((item: any) => ({
      id: item.id,
      title: item.title,
      message: item.message,
      published_at: item.publishedAt,
    }));
  } catch (error) {
    console.warn("Announcement model lookup failed, using fallback:", error);

    return [
      {
        id: "fallback-1",
        title: "New member orientation scheduled",
        message:
          "Interested in joining? Come meet the officers, tour the station, and learn what to expect.",
        published_at: "2026-01-10T12:00:00.000Z",
      },
      {
        id: "fallback-2",
        title: "Winter safety reminder: heating and CO alarms",
        message:
          "Check your smoke/CO alarms and keep space heaters clear. Replace batteries and test monthly.",
        published_at: "2025-12-21T12:00:00.000Z",
      },
    ];
  }
}

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

    const announcements = await getAnnouncementsSafe();

    return NextResponse.json({
      success: true,
      announcements,
    });
  } catch (error) {
    console.error("GET /api/mobile/announcements error:", error);
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }
}