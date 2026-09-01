-- CreateTable
CREATE TABLE "AutomationRuleMessage" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "imageUrl" TEXT,
    "ctaText" TEXT,
    "ctaUrl" TEXT,
    "activeFromMonth" INTEGER,
    "activeToMonth" INTEGER,

    CONSTRAINT "AutomationRuleMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRuleMessage_ruleId_idx" ON "AutomationRuleMessage"("ruleId");

-- AddForeignKey
ALTER TABLE "AutomationRuleMessage" ADD CONSTRAINT "AutomationRuleMessage_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
