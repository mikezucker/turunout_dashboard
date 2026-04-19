import jwt from "jsonwebtoken";

const MOBILE_TOKEN_TYPE = "mobile-access";
const MOBILE_ISSUER = "mtfd-membership";
const MOBILE_AUDIENCE = "mtfd-mobile-app";
const DEFAULT_EXPIRES_IN = "30d";

type MobileTokenPayload = {
  sub: string;
  email: string;
  role: string;
  type: string;
};

function getJwtSecret() {
  const secret = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("Missing JWT_SECRET or NEXTAUTH_SECRET");
  }
  return secret;
}

export function signMobileToken(args: {
  userId: string;
  email: string;
  role: string;
}) {
  const payload: MobileTokenPayload = {
    sub: args.userId,
    email: args.email,
    role: args.role,
    type: MOBILE_TOKEN_TYPE,
  };

  return jwt.sign(payload, getJwtSecret(), {
    issuer: MOBILE_ISSUER,
    audience: MOBILE_AUDIENCE,
    expiresIn: DEFAULT_EXPIRES_IN,
  });
}

export function verifyMobileToken(token: string) {
  const decoded = jwt.verify(token, getJwtSecret(), {
    issuer: MOBILE_ISSUER,
    audience: MOBILE_AUDIENCE,
  }) as MobileTokenPayload & jwt.JwtPayload;

  if (decoded.type !== MOBILE_TOKEN_TYPE) {
    throw new Error("Invalid mobile token type");
  }

  return decoded;
}

export function extractBearerToken(authHeader: string | null) {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}