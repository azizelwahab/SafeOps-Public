BEGIN;

-- CreateEnum
CREATE TYPE "HazardClosureOutcome" AS ENUM ('NOT_REQUIRED', 'ACCEPTED', 'ESCALATED');

-- AlterEnum
ALTER TYPE "HazardStatus" ADD VALUE 'CLOSED';

-- CreateTable
CREATE TABLE "ResidualRiskRevision" (
    "organizationId" UUID NOT NULL,
    "hazardId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "assessedById" UUID NOT NULL,
    "baselineVersion" INTEGER NOT NULL,
    "verifiedActionCount" INTEGER NOT NULL,
    "likelihood" INTEGER NOT NULL,
    "severity" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResidualRiskRevision_pkey" PRIMARY KEY ("hazardId","version")
);

-- CreateTable
CREATE TABLE "HazardClosureDecision" (
    "organizationId" UUID NOT NULL,
    "hazardId" UUID NOT NULL,
    "residualVersion" INTEGER NOT NULL,
    "decidedById" UUID NOT NULL,
    "outcome" "HazardClosureOutcome" NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HazardClosureDecision_pkey" PRIMARY KEY ("hazardId","residualVersion")
);

-- CreateIndex
CREATE INDEX "ResidualRiskRevision_organizationId_assessedById_idx" ON "ResidualRiskRevision"("organizationId", "assessedById");

-- CreateIndex
CREATE UNIQUE INDEX "ResidualRiskRevision_organizationId_hazardId_version_key" ON "ResidualRiskRevision"("organizationId", "hazardId", "version");

-- CreateIndex
CREATE INDEX "HazardClosureDecision_organizationId_decidedById_idx" ON "HazardClosureDecision"("organizationId", "decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "HazardClosureDecision_organizationId_hazardId_residualVersi_key" ON "HazardClosureDecision"("organizationId", "hazardId", "residualVersion");

-- AddForeignKey
ALTER TABLE "ResidualRiskRevision" ADD CONSTRAINT "ResidualRiskRevision_organizationId_hazardId_fkey" FOREIGN KEY ("organizationId", "hazardId") REFERENCES "Hazard"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ResidualRiskRevision" ADD CONSTRAINT "ResidualRiskRevision_organizationId_assessedById_fkey" FOREIGN KEY ("organizationId", "assessedById") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "HazardClosureDecision" ADD CONSTRAINT "HazardClosureDecision_organizationId_hazardId_residualVers_fkey" FOREIGN KEY ("organizationId", "hazardId", "residualVersion") REFERENCES "ResidualRiskRevision"("organizationId", "hazardId", "version") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "HazardClosureDecision" ADD CONSTRAINT "HazardClosureDecision_organizationId_decidedById_fkey" FOREIGN KEY ("organizationId", "decidedById") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ResidualRiskRevision"
  ADD CONSTRAINT "ResidualRiskRevision_snapshot_check"
    CHECK ("version" >= 1 AND "baselineVersion" >= 1 AND "verifiedActionCount" >= 1),
  ADD CONSTRAINT "ResidualRiskRevision_rating_check" CHECK (
    "likelihood" BETWEEN 1 AND 5 AND "severity" BETWEEN 1 AND 5
    AND "score" = "likelihood" * "severity"
    AND "level" = CASE
      WHEN "score" <= 4 THEN 'LOW'::"RiskLevel"
      WHEN "score" <= 9 THEN 'MEDIUM'::"RiskLevel"
      WHEN "score" <= 16 THEN 'HIGH'::"RiskLevel"
      ELSE 'CRITICAL'::"RiskLevel"
    END
  );

COMMIT;
