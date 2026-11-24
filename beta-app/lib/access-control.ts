export type ActorRole = "STUDENT" | "REVIEWER";

export type RequestActor = {
  userId: string;
  email: string | null;
  role: ActorRole;
  source: "PLATFORM" | "SYNTHETIC_LOCAL";
};

export type PlatformIdentity = {
  userId: string;
  email: string;
};

type RuntimeConfig = Record<string, string | undefined>;

export class AccessControlError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
    this.name = "AccessControlError";
  }
}

const splitIds = (value?: string) => new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean));

export function enrolledIdentityAccessEnabled(config: RuntimeConfig = process.env): boolean {
  return config.BETA_AUTHENTICATION_VERIFIED === "true"
    && config.BETA_PRIVATE_DEPLOYMENT_VERIFIED === "true"
    && config.BETA_PRIVATE_STORAGE_VERIFIED === "true"
    && splitIds(config.BETA_REVIEWER_IDS).size === 1;
}

export function isReviewerIdentity(userId: string, config: RuntimeConfig = process.env): boolean {
  return splitIds(config.BETA_REVIEWER_IDS).has(userId);
}

export function isStudentIdentity(userId: string, config: RuntimeConfig = process.env): boolean {
  return splitIds(config.BETA_STUDENT_IDS).has(userId);
}

export function platformIdentityFromRequest(request: Request): PlatformIdentity | null {
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  return userId && email ? { userId, email } : null;
}

export function requirePlatformIdentity(request: Request): PlatformIdentity {
  const identity = platformIdentityFromRequest(request);
  if (!identity) throw new AccessControlError("Authentication is required.", 401);
  return identity;
}

export function isSyntheticLocal(config: RuntimeConfig = process.env): boolean {
  return config.NODE_ENV !== "production" && config.BETA_SYNTHETIC_MODE !== "false";
}

export function actorFromRequest(request: Request, config: RuntimeConfig = process.env): RequestActor {
  const identity = platformIdentityFromRequest(request);
  if (identity) {
    const { userId, email } = identity;
    if (isReviewerIdentity(userId, config)) return { userId, email, role: "REVIEWER", source: "PLATFORM" };
    if (isStudentIdentity(userId, config)) return { userId, email, role: "STUDENT", source: "PLATFORM" };
    throw new AccessControlError("This authenticated account is not enrolled in the private pilot.");
  }

  if (isSyntheticLocal(config)) {
    const requested = request.headers.get("x-beta-synthetic-user") ?? new URL(request.url).searchParams.get("userId");
    if (requested === "local-reviewer") return { userId: requested, email: null, role: "REVIEWER", source: "SYNTHETIC_LOCAL" };
    if (requested && ["student-a", "student-b", "local-student"].includes(requested)) {
      return { userId: requested, email: null, role: "STUDENT", source: "SYNTHETIC_LOCAL" };
    }
  }
  throw new AccessControlError("Authentication is required.", 401);
}

export function requireReviewer(request: Request, config: RuntimeConfig = process.env): RequestActor {
  const actor = actorFromRequest(request, config);
  if (actor.role !== "REVIEWER") throw new AccessControlError("Reviewer permission is required.");
  return actor;
}

export function requireStudent(request: Request, config: RuntimeConfig = process.env): RequestActor {
  const actor = actorFromRequest(request, config);
  if (actor.role !== "STUDENT") throw new AccessControlError("Student access is required.");
  return actor;
}

export function accessErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof AccessControlError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
