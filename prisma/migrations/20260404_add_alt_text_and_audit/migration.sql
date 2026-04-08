-- Add new fields to UsageStat for tracking alt text and PDF exports
ALTER TABLE "usage_stat" ADD COLUMN "altTextGenerated" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "usage_stat" ADD COLUMN "pdfExported" INTEGER NOT NULL DEFAULT 0;

-- Create AltTextHistory table for tracking generated alt texts
CREATE TABLE "alt_text_history" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "generatedAltText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alt_text_history_pkey" PRIMARY KEY ("id")
);

-- Create index on alt_text_history for fast lookups
CREATE INDEX "alt_text_history_shop_productId_idx" ON "alt_text_history"("shop", "productId");

-- Create AuditExport table for logging PDF exports
CREATE TABLE "audit_export" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "productsCount" INTEGER NOT NULL,
    "issuesCount" INTEGER NOT NULL,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_export_pkey" PRIMARY KEY ("id")
);

-- Create index on audit_export for fast lookups
CREATE INDEX "audit_export_shop_idx" ON "audit_export"("shop");
