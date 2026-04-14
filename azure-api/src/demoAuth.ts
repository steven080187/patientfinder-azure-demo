import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./config.js";

export type DemoAuthUser = {
  id: string;
  email: string;
  password: string;
  name: string;
  roles: string[];
};

export type AuthenticatedDemoUser = Omit<DemoAuthUser, "password">;

type DemoTokenPayload = {
  sub: string;
  email: string;
  name: string;
  roles: string[];
  exp: number;
};

const defaultUsers: DemoAuthUser[] = [
  {
    id: "4e83b685-6a3b-452b-a60e-6648f46c8ee2",
    email: "smasters@ncadd-sfv.org",
    password: "Demo123!",
    name: "Steven Masters",
    roles: ["Admin", "Counselor"],
  },
  {
    id: "39125e52-6efb-4959-8f5e-552fd8debe30",
    email: "mr.test@dr.com",
    password: "Demo123!",
    name: "Michael Test",
    roles: ["Counselor"],
  },
  {
    id: "99999999-9999-4999-8999-999999999999",
    email: "intake.demo@ncadd-sfv.org",
    password: "Demo123!",
    name: "Intake Demo",
    roles: ["Intake"],
  },
];

function base64url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signValue(value: string) {
  return createHmac("sha256", env.DEMO_AUTH_SECRET).update(value).digest("base64url");
}

function parseConfiguredUsers() {
  if (!env.DEMO_AUTH_USERS_JSON) {
    return defaultUsers;
  }

  try {
    const parsed = JSON.parse(env.DEMO_AUTH_USERS_JSON);
    if (!Array.isArray(parsed)) {
      return defaultUsers;
    }

    return parsed.filter((entry): entry is DemoAuthUser => {
      return Boolean(
        entry &&
          typeof entry.id === "string" &&
          typeof entry.email === "string" &&
          typeof entry.password === "string" &&
          typeof entry.name === "string" &&
          Array.isArray(entry.roles)
      );
    });
  } catch {
    return defaultUsers;
  }
}

const demoUsers = parseConfiguredUsers();

export function getDemoUsers(): AuthenticatedDemoUser[] {
  return demoUsers.map(({ password: _password, ...user }) => user);
}

export function findDemoUser(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const match = demoUsers.find((user) => user.email.toLowerCase() === normalized && user.password === password);
  if (!match) return null;
  const { password: _password, ...safeUser } = match;
  return safeUser;
}

export async function signDemoToken(user: AuthenticatedDemoUser) {
  const payload: DemoTokenPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles,
    exp: Date.now() + 1000 * 60 * 60 * 12,
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = signValue(encoded);
  return `${encoded}.${signature}`;
}

export async function verifyDemoToken(token: string): Promise<AuthenticatedDemoUser> {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid demo token.");
  }

  const expected = signValue(encodedPayload);
  if (signature.length !== expected.length) {
    throw new Error("Invalid demo token.");
  }
  const matches = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!matches) {
    throw new Error("Invalid demo token.");
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as DemoTokenPayload;
  if (!payload.sub || !payload.email || payload.exp < Date.now()) {
    throw new Error("Expired demo token.");
  }

  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    roles: payload.roles,
  };
}
