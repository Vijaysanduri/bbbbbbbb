-- CandidateProfile layer: two brand-new tables only.
-- Nothing here alters, drops, or references the existing "Task" table.

CREATE TABLE "CandidateProfile" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "nationality" TEXT,
    "dob" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidateProfileApplication" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateProfileApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CandidateProfileApplication_taskId_key" ON "CandidateProfileApplication"("taskId");
CREATE INDEX "CandidateProfile_contactEmail_idx" ON "CandidateProfile"("contactEmail");
CREATE INDEX "CandidateProfile_contactPhone_idx" ON "CandidateProfile"("contactPhone");
CREATE INDEX "CandidateProfileApplication_taskId_idx" ON "CandidateProfileApplication"("taskId");

-- The only foreign key added anywhere in this migration is between the
-- two NEW tables. It does not touch "Task" or any existing table.
ALTER TABLE "CandidateProfileApplication"
  ADD CONSTRAINT "CandidateProfileApplication_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "CandidateProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
