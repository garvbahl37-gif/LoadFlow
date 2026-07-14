-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('BROKER', 'CARRIER', 'SHIPPER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AuthorityStatus" AS ENUM ('ACTIVE', 'PENDING', 'INACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "LoadStatus" AS ENUM ('POSTED', 'CARRIER_ASSIGNED', 'RATE_CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'POD_VERIFIED', 'INVOICED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CarrierResponse" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "RateStatus" AS ENUM ('CONFIRMED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('OPEN', 'RESOLVED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "FlagSeverity" AS ENUM ('BLOCKING', 'WARNING');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('ALLOWED', 'DENIED');

-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL,
    "type" "OrgType" NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "phone" TEXT,
    "mcNumber" TEXT,
    "dotNumber" TEXT,
    "city" TEXT,
    "state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "orgId" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "forBroker" BOOLEAN NOT NULL DEFAULT false,
    "forCarrier" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionKey")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedById" TEXT NOT NULL,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteRole" (
    "inviteId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "InviteRole_pkey" PRIMARY KEY ("inviteId","roleId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarrierCompliance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "insuranceProvider" TEXT NOT NULL,
    "insurancePolicyNumber" TEXT NOT NULL,
    "insuranceExpiry" TIMESTAMP(3) NOT NULL,
    "cargoInsuranceCents" INTEGER NOT NULL,
    "autoLiabilityCents" INTEGER NOT NULL,
    "mcNumber" TEXT NOT NULL,
    "dotNumber" TEXT NOT NULL,
    "authorityStatus" "AuthorityStatus" NOT NULL DEFAULT 'ACTIVE',
    "approvedEquipment" JSONB NOT NULL,
    "approvedCommodities" JSONB NOT NULL,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "CarrierCompliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Load" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "shipperOrgId" TEXT NOT NULL,
    "brokerOrgId" TEXT NOT NULL,
    "carrierOrgId" TEXT,
    "status" "LoadStatus" NOT NULL DEFAULT 'POSTED',
    "carrierResponse" "CarrierResponse" NOT NULL DEFAULT 'PENDING',
    "originCity" TEXT NOT NULL,
    "originState" TEXT NOT NULL,
    "destCity" TEXT NOT NULL,
    "destState" TEXT NOT NULL,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "deliverBy" TIMESTAMP(3) NOT NULL,
    "commodity" TEXT NOT NULL,
    "equipmentType" TEXT NOT NULL,
    "weightLbs" INTEGER NOT NULL,
    "declaredValueCents" INTEGER NOT NULL,
    "offeredRateCents" INTEGER NOT NULL,
    "confirmedRateConfirmationId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Load_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateConfirmation" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "baseRateCents" INTEGER NOT NULL,
    "accessorials" JSONB NOT NULL,
    "totalRateCents" INTEGER NOT NULL,
    "status" "RateStatus" NOT NULL DEFAULT 'CONFIRMED',
    "carrierOrgId" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceFlag" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "carrierOrgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" "FlagSeverity" NOT NULL DEFAULT 'BLOCKING',
    "message" TEXT NOT NULL,
    "status" "FlagStatus" NOT NULL DEFAULT 'OPEN',
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "overriddenById" TEXT,
    "overrideReason" TEXT,
    "overriddenAt" TIMESTAMP(3),

    CONSTRAINT "ComplianceFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofOfDelivery" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "notes" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "ProofOfDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "actorName" TEXT,
    "actorOrgId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "loadId" TEXT,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'ALLOWED',
    "permission" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "ip" TEXT,
    "method" TEXT,
    "path" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Org_type_idx" ON "Org"("type");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_orgId_idx" ON "User"("orgId");

-- CreateIndex
CREATE INDEX "Role_orgId_idx" ON "Role"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_orgId_name_key" ON "Role"("orgId", "name");

-- CreateIndex
CREATE INDEX "RolePermission_permissionKey_idx" ON "RolePermission"("permissionKey");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE INDEX "Invite_orgId_idx" ON "Invite"("orgId");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CarrierCompliance_orgId_key" ON "CarrierCompliance"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Load_reference_key" ON "Load"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Load_confirmedRateConfirmationId_key" ON "Load"("confirmedRateConfirmationId");

-- CreateIndex
CREATE INDEX "Load_brokerOrgId_status_idx" ON "Load"("brokerOrgId", "status");

-- CreateIndex
CREATE INDEX "Load_carrierOrgId_status_idx" ON "Load"("carrierOrgId", "status");

-- CreateIndex
CREATE INDEX "Load_shipperOrgId_status_idx" ON "Load"("shipperOrgId", "status");

-- CreateIndex
CREATE INDEX "RateConfirmation_loadId_idx" ON "RateConfirmation"("loadId");

-- CreateIndex
CREATE UNIQUE INDEX "RateConfirmation_loadId_version_key" ON "RateConfirmation"("loadId", "version");

-- CreateIndex
CREATE INDEX "ComplianceFlag_loadId_status_idx" ON "ComplianceFlag"("loadId", "status");

-- CreateIndex
CREATE INDEX "ComplianceFlag_carrierOrgId_idx" ON "ComplianceFlag"("carrierOrgId");

-- CreateIndex
CREATE INDEX "ProofOfDelivery_loadId_idx" ON "ProofOfDelivery"("loadId");

-- CreateIndex
CREATE INDEX "AuditLog_loadId_ts_idx" ON "AuditLog"("loadId", "ts");

-- CreateIndex
CREATE INDEX "AuditLog_actorOrgId_ts_idx" ON "AuditLog"("actorOrgId", "ts");

-- CreateIndex
CREATE INDEX "AuditLog_outcome_ts_idx" ON "AuditLog"("outcome", "ts");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "Permission"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteRole" ADD CONSTRAINT "InviteRole_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "Invite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteRole" ADD CONSTRAINT "InviteRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarrierCompliance" ADD CONSTRAINT "CarrierCompliance_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarrierCompliance" ADD CONSTRAINT "CarrierCompliance_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_shipperOrgId_fkey" FOREIGN KEY ("shipperOrgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_brokerOrgId_fkey" FOREIGN KEY ("brokerOrgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_carrierOrgId_fkey" FOREIGN KEY ("carrierOrgId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_confirmedRateConfirmationId_fkey" FOREIGN KEY ("confirmedRateConfirmationId") REFERENCES "RateConfirmation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateConfirmation" ADD CONSTRAINT "RateConfirmation_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateConfirmation" ADD CONSTRAINT "RateConfirmation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceFlag" ADD CONSTRAINT "ComplianceFlag_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceFlag" ADD CONSTRAINT "ComplianceFlag_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorOrgId_fkey" FOREIGN KEY ("actorOrgId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

