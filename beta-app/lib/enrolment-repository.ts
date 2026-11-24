import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { pilotEnrolments } from "@/db/schema";
import type { PlatformIdentity } from "./access-control";
import { enrolmentInviteKey, getEnrolmentPolicy, invitationForEmail, type EnrolmentRuntimeConfig } from "./enrolment";

export class EnrolmentError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
    this.name = "EnrolmentError";
  }
}

function requireOpenPolicy(config: EnrolmentRuntimeConfig) {
  const policy = getEnrolmentPolicy(config);
  if (!policy.open || !policy.hashSecret) throw new EnrolmentError("Student enrolment is not currently available.");
  return policy;
}

function requireInvitedIdentity(identity: PlatformIdentity, config: EnrolmentRuntimeConfig, openRequired: boolean) {
  const policy = openRequired ? requireOpenPolicy(config) : getEnrolmentPolicy(config);
  if (!policy.configured || !policy.hashSecret) throw new EnrolmentError("Student enrolment is not currently available.");
  const reviewers = new Set((config.BETA_REVIEWER_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  if (reviewers.has(identity.userId)) throw new EnrolmentError("Reviewer accounts cannot be enrolled as students.");
  const invitation = invitationForEmail(policy, identity.email);
  if (!invitation) throw new EnrolmentError("This authenticated account is not invited to the private pilot.");
  return { policy, invitation };
}

export async function loadOwnEnrolmentStatus(identity: PlatformIdentity, config: EnrolmentRuntimeConfig = process.env) {
  const { policy, invitation } = requireInvitedIdentity(identity, config, false);
  const inviteKey = await enrolmentInviteKey(invitation.email, policy.hashSecret!);
  const [existing] = await getDb().select().from(pilotEnrolments).where(eq(pilotEnrolments.inviteKey, inviteKey)).limit(1);
  if (existing && existing.siteUserId !== identity.userId) throw new EnrolmentError("This invitation is already bound to another authenticated account.", 409);
  return { invited: true as const, enrolled: Boolean(existing), slot: invitation.slot, invitedTotal: policy.invitations.length, total: 5 as const, enrolmentOpen: policy.open };
}

export async function enrolInvitedIdentity(identity: PlatformIdentity, config: EnrolmentRuntimeConfig = process.env) {
  const { policy, invitation } = requireInvitedIdentity(identity, config, true);
  const inviteKey = await enrolmentInviteKey(invitation.email, policy.hashSecret!);
  const db = getDb();
  const [byInvitation] = await db.select().from(pilotEnrolments).where(eq(pilotEnrolments.inviteKey, inviteKey)).limit(1);
  const [byIdentity] = await db.select().from(pilotEnrolments).where(eq(pilotEnrolments.siteUserId, identity.userId)).limit(1);
  if (byInvitation || byIdentity) throw new EnrolmentError("This invitation or authenticated account is already enrolled.", 409);
  try {
    await db.insert(pilotEnrolments).values({ inviteKey, siteUserId: identity.userId });
  } catch {
    throw new EnrolmentError("This invitation or authenticated account is already enrolled.", 409);
  }
  return { invited: true as const, enrolled: true, slot: invitation.slot, invitedTotal: policy.invitations.length, total: 5 as const, enrolmentOpen: policy.open };
}

export async function isEnrolledSiteIdentity(siteUserId: string): Promise<boolean> {
  const [existing] = await getDb().select({ siteUserId: pilotEnrolments.siteUserId }).from(pilotEnrolments).where(eq(pilotEnrolments.siteUserId, siteUserId)).limit(1);
  return Boolean(existing);
}

export async function loadEnrolmentOverview(config: EnrolmentRuntimeConfig = process.env) {
  const policy = getEnrolmentPolicy(config);
  const rows = policy.configured ? await getDb().select().from(pilotEnrolments) : [];
  const byInviteKey = new Map(rows.map((row) => [row.inviteKey, row]));
  const slots = policy.hashSecret ? await Promise.all(policy.invitations.map(async (invitation) => {
    const inviteKey = await enrolmentInviteKey(invitation.email, policy.hashSecret!);
    return { slot: invitation.slot, account: invitation.maskedEmail, status: byInviteKey.has(inviteKey) ? "ENROLLED" as const : "PENDING" as const };
  })) : [];
  return {
    configured: policy.configured,
    open: policy.open,
    invitedCount: policy.invitations.length,
    enrolledCount: slots.filter((slot) => slot.status === "ENROLLED").length,
    slots,
    blockers: policy.blockers,
  };
}
