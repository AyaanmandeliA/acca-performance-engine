// Part of ../../PROJECT.md — production student authorization through static verification IDs or private D1 enrolment bindings.
import {
  AccessControlError,
  actorFromRequest,
  enrolledIdentityAccessEnabled,
  isReviewerIdentity,
  isStudentIdentity,
  platformIdentityFromRequest,
  type RequestActor,
} from "./access-control";
import { isEnrolledSiteIdentity } from "./enrolment-repository";

type RuntimeConfig = Record<string, string | undefined>;

export async function actorFromRequestWithEnrolment(request: Request, config: RuntimeConfig = process.env): Promise<RequestActor> {
  const identity = platformIdentityFromRequest(request);
  if (!identity) return actorFromRequest(request, config);

  if (isReviewerIdentity(identity.userId, config)) {
    return { userId: identity.userId, email: identity.email, role: "REVIEWER", source: "PLATFORM" };
  }
  if (isStudentIdentity(identity.userId, config)) {
    return { userId: identity.userId, email: identity.email, role: "STUDENT", source: "PLATFORM" };
  }
  if (enrolledIdentityAccessEnabled(config) && await isEnrolledSiteIdentity(identity.userId)) {
    return { userId: identity.userId, email: identity.email, role: "STUDENT", source: "PLATFORM" };
  }
  throw new AccessControlError("This authenticated account is not enrolled in the private pilot.");
}

export async function requireAuthorisedStudent(request: Request, config: RuntimeConfig = process.env): Promise<RequestActor> {
  const actor = await actorFromRequestWithEnrolment(request, config);
  if (actor.role !== "STUDENT") throw new AccessControlError("Student access is required.");
  return actor;
}
