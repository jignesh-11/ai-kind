import {
  BillingInterval,
  ApiVersion,
  AppDistribution,
  shopifyApp,
  BillingReplacementBehavior,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma, { tableName: 'session' }),
  distribution: AppDistribution.AppStore,
  billing: {
    "Growth": {
      amount: 0,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
      usageTerms: "First 30 generations free per month, then $0.015 per generation.",
    }
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
  webhooks: {
    APP_SUBSCRIPTION_UPDATE: {
      deliveryMethod: "http",
      callbackUrl: "/webhooks/app/subscription_update",
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
