-- AlterTable
ALTER TABLE "Comment" ADD COLUMN "partnerId" TEXT;

-- CreateIndex
CREATE INDEX "Comment_partnerId_idx" ON "Comment"("partnerId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
