export type EnrolmentRuntimeConfig = Record<string, string | undefined>;

export type EnrolmentInvitation = {
  slot: number;
  email: string;
  maskedEmail: string;
};

export type EnrolmentPolicy = {
  configured: boolean;
  open: boolean;
  invitations: EnrolmentInvitation[];
  hashSecret: string | null;
  blockers: string[];
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function maskEmail(value: string): string {
  const [local = "", domain = ""] = normaliseEmail(value).split("@");
  const parts = domain.split(".").filter(Boolean);
  const host = parts[0] ?? "";
  const suffix = parts.length > 1 ? `.${parts.at(-1)}` : "";
  const maskedLocal = local.length > 4 ? `${local.slice(0, 2)}…${local.slice(-2)}` : `${local.slice(0, 1) || "•"}•••`;
  return `${maskedLocal}@${host.slice(0, 1) || "•"}•••${suffix}`;
}

function split(value?: string): string[] {
  return (value ?? "").split(",").map(normaliseEmail).filter(Boolean);
}

export function getEnrolmentPolicy(config: EnrolmentRuntimeConfig = process.env): EnrolmentPolicy {
  const configuredEmails = split(config.BETA_INVITED_STUDENT_EMAILS);
  const uniqueEmails = [...new Set(configuredEmails)];
  const validInvitationList = configuredEmails.length >= 1
    && configuredEmails.length <= 5
    && uniqueEmails.length === configuredEmails.length
    && uniqueEmails.every((email) => EMAIL_PATTERN.test(email));
  const hashSecret = config.BETA_ENROLMENT_HASH_SECRET?.trim() ?? "";
  const validSecret = hashSecret.length >= 32;
  const reviewers = new Set((config.BETA_REVIEWER_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const students = new Set((config.BETA_STUDENT_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const blockers: string[] = [];

  if (!validInvitationList) blockers.push("Configure between one and five unique invited accounts.");
  if (!validSecret) blockers.push("The server-only enrolment hashing secret is unavailable.");
  if (reviewers.size !== 1) blockers.push("Exactly one reviewer identity must remain configured.");
  if (students.size > 5) blockers.push("The active pilot student allowlist cannot exceed five identities.");
  if ([...reviewers].some((reviewer) => students.has(reviewer))) blockers.push("Reviewer and student identities must not overlap.");
  if (config.BETA_ENROLMENT_ENABLED !== "true") blockers.push("The enrolment window is closed.");

  return {
    configured: validInvitationList && validSecret,
    open: blockers.length === 0,
    invitations: validInvitationList
      ? uniqueEmails.map((email, index) => ({ slot: index + 1, email, maskedEmail: maskEmail(email) }))
      : [],
    hashSecret: validSecret ? hashSecret : null,
    blockers,
  };
}

export function invitationForEmail(policy: EnrolmentPolicy, email: string): EnrolmentInvitation | null {
  const normalised = normaliseEmail(email);
  return policy.invitations.find((invitation) => invitation.email === normalised) ?? null;
}

export async function enrolmentInviteKey(email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(normaliseEmail(email)));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
