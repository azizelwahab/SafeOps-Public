BEGIN;

-- CreateEnum
CREATE TYPE "CorrectiveActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'VERIFIED');

-- CreateEnum
CREATE TYPE "CorrectiveActionEventKind" AS ENUM ('CREATED', 'UPDATED', 'STARTED', 'SUBMITTED', 'VERIFIED', 'RETURNED');

-- CreateTable
CREATE TABLE "CorrectiveAction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "hazardId" UUID NOT NULL,
    "assigneeId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "submittedById" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'OPEN',
    "workNotes" TEXT,
    "completionDetails" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CorrectiveAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectiveActionEvent" (
    "organizationId" UUID NOT NULL,
    "actionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" UUID NOT NULL,
    "kind" "CorrectiveActionEventKind" NOT NULL,
    "fromStatus" "CorrectiveActionStatus",
    "toStatus" "CorrectiveActionStatus" NOT NULL,
    "reason" TEXT,
    "completionDetails" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectiveActionEvent_pkey" PRIMARY KEY ("actionId","version")
);

-- CreateIndex
CREATE INDEX "CorrectiveAction_organizationId_createdAt_id_idx" ON "CorrectiveAction"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CorrectiveAction_organizationId_hazardId_idx" ON "CorrectiveAction"("organizationId", "hazardId");

-- CreateIndex
CREATE INDEX "CorrectiveAction_organizationId_assigneeId_idx" ON "CorrectiveAction"("organizationId", "assigneeId");

-- CreateIndex
CREATE INDEX "CorrectiveAction_organizationId_status_dueAt_idx" ON "CorrectiveAction"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectiveAction_organizationId_id_key" ON "CorrectiveAction"("organizationId", "id");

-- CreateIndex
CREATE INDEX "CorrectiveActionEvent_organizationId_actorId_idx" ON "CorrectiveActionEvent"("organizationId", "actorId");

-- AddForeignKey
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_organizationId_hazardId_fkey" FOREIGN KEY ("organizationId", "hazardId") REFERENCES "RiskAssessment"("organizationId", "hazardId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_organizationId_assigneeId_fkey" FOREIGN KEY ("organizationId", "assigneeId") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_organizationId_createdById_fkey" FOREIGN KEY ("organizationId", "createdById") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_organizationId_submittedById_fkey" FOREIGN KEY ("organizationId", "submittedById") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CorrectiveActionEvent" ADD CONSTRAINT "CorrectiveActionEvent_organizationId_actionId_fkey" FOREIGN KEY ("organizationId", "actionId") REFERENCES "CorrectiveAction"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CorrectiveActionEvent" ADD CONSTRAINT "CorrectiveActionEvent_organizationId_actorId_fkey" FOREIGN KEY ("organizationId", "actorId") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CorrectiveAction"
  ADD CONSTRAINT "CorrectiveAction_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "CorrectiveAction_submission_check" CHECK (
    ("status" IN ('PENDING_VERIFICATION', 'VERIFIED') AND "submittedById" IS NOT NULL AND "completionDetails" IS NOT NULL)
    OR ("status" IN ('OPEN', 'IN_PROGRESS') AND "submittedById" IS NULL AND "completionDetails" IS NULL)
  );

ALTER TABLE "CorrectiveActionEvent"
  ADD CONSTRAINT "CorrectiveActionEvent_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "CorrectiveActionEvent_details_check" CHECK (
    ("kind" = 'RETURNED') = ("reason" IS NOT NULL)
    AND ("kind" = 'SUBMITTED') = ("completionDetails" IS NOT NULL)
  );

COMMIT;
