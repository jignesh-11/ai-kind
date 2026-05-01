export const FREE_PLAN = "Free Forever";
export const PRO_PLAN = "Pro (Growth)";
export const ELITE_PLAN = "Elite (Scale)";

export const PLAN_CONFIG = {
    [FREE_PLAN]: {
        credits: 20, // Increased for launch
        features: ["descriptions", "seo"],
    },
    [PRO_PLAN]: {
        credits: 500,
        features: ["descriptions", "seo", "alt-text", "audit"],
    },
    [ELITE_PLAN]: {
        credits: 999999, // Unlimited
        features: ["descriptions", "seo", "alt-text", "audit", "bulk"],
    },
};
