-- CreateEnum
CREATE TYPE "HazardCategory" AS ENUM ('ELECTRICAL', 'CHEMICAL', 'FIRE', 'MECHANICAL', 'ERGONOMIC', 'BIOLOGICAL', 'PHYSICAL', 'PSYCHOSOCIAL', 'ENVIRONMENTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "HazardStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'CONFIRMED', 'DISMISSED');

-- CreateTable
CREATE TABLE "Hazard" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "reportedById" UUID NOT NULL,
    "reviewedById" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "HazardCategory" NOT NULL,
    "location" TEXT NOT NULL,
    "status" "HazardStatus" NOT NULL DEFAULT 'REPORTED',
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Hazard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Hazard_organizationId_createdAt_id_idx" ON "Hazard"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Hazard_organizationId_status_createdAt_idx" ON "Hazard"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Hazard_organizationId_category_createdAt_idx" ON "Hazard"("organizationId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "Hazard_organizationId_reportedById_createdAt_idx" ON "Hazard"("organizationId", "reportedById", "createdAt");

-- CreateIndex
CREATE INDEX "Hazard_organizationId_reviewedById_idx" ON "Hazard"("organizationId", "reviewedById");

-- AddForeignKey
ALTER TABLE "Hazard" ADD CONSTRAINT "Hazard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Hazard" ADD CONSTRAINT "Hazard_organizationId_reportedById_fkey" FOREIGN KEY ("organizationId", "reportedById") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Hazard" ADD CONSTRAINT "Hazard_organizationId_reviewedById_fkey" FOREIGN KEY ("organizationId", "reviewedById") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
