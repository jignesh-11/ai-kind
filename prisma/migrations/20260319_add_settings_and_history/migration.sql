-- Migration: Add ShopSettings, DescriptionHistory, SeoHistory

CREATE TABLE IF NOT EXISTS "shop_settings" (
    "shop"              TEXT        NOT NULL,
    "defaultTone"       TEXT        NOT NULL DEFAULT 'professional',
    "defaultLang"       TEXT        NOT NULL DEFAULT 'English',
    "defaultLen"        TEXT        NOT NULL DEFAULT 'short',
    "brandVoice"        TEXT,
    "brandVoicePrompt"  TEXT,
    "updatedAt"         TIMESTAMP   NOT NULL DEFAULT NOW(),
    CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("shop")
);

CREATE TABLE IF NOT EXISTS "description_history" (
    "id"           TEXT        NOT NULL,
    "shop"         TEXT        NOT NULL,
    "productId"    TEXT        NOT NULL,
    "productTitle" TEXT        NOT NULL,
    "content"      TEXT        NOT NULL,
    "tone"         TEXT        NOT NULL,
    "language"     TEXT        NOT NULL,
    "createdAt"    TIMESTAMP   NOT NULL DEFAULT NOW(),
    CONSTRAINT "description_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "description_history_shop_productId_idx"
    ON "description_history"("shop", "productId");

CREATE TABLE IF NOT EXISTS "seo_history" (
    "id"             TEXT        NOT NULL,
    "shop"           TEXT        NOT NULL,
    "productId"      TEXT        NOT NULL,
    "productTitle"   TEXT        NOT NULL,
    "seoTitle"       TEXT        NOT NULL,
    "seoDescription" TEXT        NOT NULL,
    "keywords"       TEXT,
    "createdAt"      TIMESTAMP   NOT NULL DEFAULT NOW(),
    CONSTRAINT "seo_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "seo_history_shop_productId_idx"
    ON "seo_history"("shop", "productId");
