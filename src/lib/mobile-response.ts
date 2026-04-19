export function mobileMemberFromUser(user: {
  id: string;
  name: string | null;
  role: string;
  badgeNumber?: string | null;
  status?: string | null;
  email?: string | null;
}) {
  return {
    name: user.name || "Member",
    role: user.role,
    member_id: user.badgeNumber || `USER-${user.id}`,
    expiration: user.status || "ACTIVE",
    email: user.email || null,
  };
}