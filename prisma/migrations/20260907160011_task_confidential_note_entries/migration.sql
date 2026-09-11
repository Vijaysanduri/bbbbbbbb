-- CreateTable
CREATE TABLE "TaskConfidentialNote" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT,
    "text" TEXT NOT NULL,
    "attachmentFileName" TEXT,
    "attachmentMimeType" TEXT,
    "attachmentData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskConfidentialNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskConfidentialNote_taskId_idx" ON "TaskConfidentialNote"("taskId");

-- AddForeignKey
ALTER TABLE "TaskConfidentialNote" ADD CONSTRAINT "TaskConfidentialNote_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskConfidentialNote" ADD CONSTRAINT "TaskConfidentialNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
