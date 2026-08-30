import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "data/**",
      "drizzle/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  {
    /*
     * These client screens load their data from this app's own API on mount and
     * poll while an analysis job is running — the "subscribe to an external
     * system" case that effects exist for. The state updates happen in async
     * callbacks after a network round trip, not synchronously during the effect
     * body, so the cascading-render concern behind this rule does not apply.
     * Genuine render-time impurity is still caught by the other rules.
     */
    files: [
      "src/app/dashboard/page.tsx",
      // Bracketed route segments are glob character classes, so match the dir.
      "src/app/games/**/page.tsx",
      "src/app/settings/page.tsx",
      "src/components/AnalysisBar.tsx",
      "src/components/Onboarding.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
];

export default config;
