BEGIN;

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "hazardId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessmentRevision" (
    "organizationId" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "assessedById" UUID NOT NULL,
    "likelihood" INTEGER NOT NULL,
    "severity" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAssessmentRevision_pkey" PRIMARY KEY ("assessmentId","version")
);

-- CreateIndex
CREATE INDEX "RiskAssessment_organizationId_createdAt_id_idx" ON "RiskAssessment"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAssessment_organizationId_id_key" ON "RiskAssessment"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAssessment_organizationId_hazardId_key" ON "RiskAssessment"("organizationId", "hazardId");

-- CreateIndex
CREATE INDEX "RiskAssessmentRevision_organizationId_assessedById_idx" ON "RiskAssessmentRevision"("organizationId", "assessedById");

-- CreateIndex
CREATE UNIQUE INDEX "Hazard_organizationId_id_key" ON "Hazard"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_organizationId_hazardId_fkey" FOREIGN KEY ("organizationId", "hazardId") REFERENCES "Hazard"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RiskAssessmentRevision" ADD CONSTRAINT "RiskAssessmentRevision_organizationId_assessmentId_fkey" FOREIGN KEY ("organizationId", "assessmentId") REFERENCES "RiskAssessment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RiskAssessmentRevision" ADD CONSTRAINT "RiskAssessmentRevision_organizationId_assessedById_fkey" FOREIGN KEY ("organizationId", "assessedById") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "RiskAssessment"
  ADD CONSTRAINT "RiskAssessment_version_check" CHECK ("version" >= 1);

ALTER TABLE "RiskAssessmentRevision"
  ADD CONSTRAINT "RiskAssessmentRevision_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "RiskAssessmentRevision_rating_check" CHECK (
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
