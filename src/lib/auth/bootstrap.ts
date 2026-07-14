import { z } from "zod";
import type { OrgType } from "@/generated/prisma/enums";
import { Conflict, Invalid, NotFound } from "@/lib/api/http";
import { audit, NO_META, type RequestMeta } from "@/lib/audit/log";
import { generateToken, hashPassword } from "@/lib/auth/password";
import { permissionsForOrgType } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";

/**
 * BOOTSTRAP — how identities come into existence. (Brief: "define how the first
 * Broker/Carrier Admin account is created vs. invited staff.")
 *
 *   Org admin  → public /signup. Creates the Org AND its first user in one
 *                transaction, granting them the auto-created system role that holds
 *                every permission for that org type. This is the ONLY way an org is
 *                born, and the only user who is ever created without an invite.
 *   Staff      → CANNOT self-signup. An admin with `staff.manage` issues an invite;
 *                the invitee sets a password at /invite/<token> and is created inside
 *                that org with exactly the roles pinned to the invite.
 *   Shipper    → public /signup. A SHIPPER org with a single user and no roles at all.
 */

export const ADMIN_ROLE_NAME = "Organization Administrator";

export const signupSchema = z
  .object({
    orgType: z.enum(["BROKER", "CARRIER", "SHIPPER"]),
    orgName: z.string().min(2, { error: "Company name is required." }).max(120),
    name: z.string().min(2, { error: "Your name is required." }).max(120),
    email: z.email({ error: "A valid email is required." }),
    password: z.string().min(8, { error: "Use at least 8 characters." }).max(200),
    mcNumber: z.string().max(32).optional(),
    dotNumber: z.string().max(32).optional(),
    city: z.string().max(80).optional(),
    state: z.string().max(2).optional(),
  })
  .refine((v) => v.orgType !== "CARRIER" || !!v.mcNumber, {
    error: "Carriers must supply an MC number.",
    path: ["mcNumber"],
  });

export type SignupInput = z.infer<typeof signupSchema>;

/** Create an org and its founding administrator. */
export async function signupOrg(input: SignupInput, meta: RequestMeta = NO_META) {
  const email = input.email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw Conflict("An account with that email already exists.");
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const org = await tx.org.create({
      data: {
        type: input.orgType as OrgType,
        name: input.orgName.trim(),
        contactEmail: email,
        mcNumber: input.mcNumber?.trim() || null,
        dotNumber: input.dotNumber?.trim() || null,
        city: input.city?.trim() || null,
        state: input.state?.trim().toUpperCase() || null,
      },
    });

    const created = await tx.user.create({
      data: { email, name: input.name.trim(), passwordHash, orgId: org.id },
    });

    // Shippers have no roles by design — their access is pure object-level scoping.
    if (org.type !== "SHIPPER") {
      const perms = permissionsForOrgType(org.type);

      const adminRole = await tx.role.create({
        data: {
          orgId: org.id,
          name: ADMIN_ROLE_NAME,
          description:
            "Full control of this organization. Created automatically with the org; holds every permission available to it.",
          isSystem: true,
          permissions: {
            create: perms.map((p) => ({ permissionKey: p.key })),
          },
        },
      });

      await tx.userRole.create({ data: { userId: created.id, roleId: adminRole.id } });
    }

    return created;
  });

  await audit({
    actor: null,
    action: "ORG_CREATED",
    entityType: "Org",
    entityId: user.orgId,
    summary: `${input.orgType} organization "${input.orgName}" was created, with ${email} as its founding administrator.`,
    detail: { orgType: input.orgType, founder: email },
    meta,
  });

  return user;
}

export const inviteSchema = z.object({
  name: z.string().min(2, { error: "Name is required." }).max(120),
  email: z.email({ error: "A valid email is required." }),
  roleIds: z.array(z.string()).min(1, { error: "Assign at least one role." }),
});
export type InviteInput = z.infer<typeof inviteSchema>;

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/** Caller must already hold `staff.manage` — checked by the route, not here. */
export async function createInvite(
  actor: { userId: string; orgId: string; email: string; name: string; orgName: string },
  input: InviteInput,
  meta: RequestMeta = NO_META,
) {
  const email = input.email.toLowerCase().trim();

  if (await prisma.user.findUnique({ where: { email } })) {
    throw Conflict("That email already belongs to an account.");
  }

  // Roles must belong to the inviter's own org — you cannot grant a role you do not own.
  const roles = await prisma.role.findMany({
    where: { id: { in: input.roleIds }, orgId: actor.orgId },
  });
  if (roles.length !== input.roleIds.length) {
    throw Invalid("One or more roles do not belong to your organization.");
  }

  const invite = await prisma.invite.create({
    data: {
      orgId: actor.orgId,
      email,
      name: input.name.trim(),
      token: generateToken(24),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedById: actor.userId,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
    include: { roles: { include: { role: true } } },
  });

  await audit({
    actor,
    action: "STAFF_INVITED",
    entityType: "Invite",
    entityId: invite.id,
    summary: `${actor.name} invited ${email} to ${actor.orgName} as ${roles.map((r) => r.name).join(", ")}.`,
    detail: { email, roles: roles.map((r) => r.name) },
    meta,
  });

  return invite;
}

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, { error: "Use at least 8 characters." }).max(200),
});

/** Redeem an invite: this is the only other way a user is created. */
export async function acceptInvite(
  input: z.infer<typeof acceptInviteSchema>,
  meta: RequestMeta = NO_META,
) {
  const invite = await prisma.invite.findUnique({
    where: { token: input.token },
    include: { roles: true, org: true },
  });

  if (!invite || invite.revokedAt) throw NotFound("Invitation");
  if (invite.acceptedAt) throw Conflict("That invitation has already been used.");
  if (invite.expiresAt.getTime() < Date.now()) throw Conflict("That invitation has expired.");

  if (await prisma.user.findUnique({ where: { email: invite.email } })) {
    throw Conflict("That email already belongs to an account.");
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: invite.email,
        name: invite.name,
        passwordHash,
        orgId: invite.orgId,
        roles: {
          create: invite.roles.map((r) => ({
            roleId: r.roleId,
            assignedById: invite.invitedById,
          })),
        },
      },
    });
    await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return created;
  });

  await audit({
    actor: null,
    action: "INVITE_ACCEPTED",
    entityType: "User",
    entityId: user.id,
    summary: `${user.email} accepted their invitation and joined ${invite.org.name}.`,
    meta,
  });

  return user;
}

/** Look up an invite for the acceptance page without exposing anything sensitive. */
export async function previewInvite(token: string) {
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { org: true, roles: { include: { role: true } } },
  });
  if (!invite) return null;

  return {
    email: invite.email,
    name: invite.name,
    orgName: invite.org.name,
    orgType: invite.org.type,
    roles: invite.roles.map((r) => r.role.name),
    expired: invite.expiresAt.getTime() < Date.now(),
    used: invite.acceptedAt !== null,
    revoked: invite.revokedAt !== null,
  };
}
