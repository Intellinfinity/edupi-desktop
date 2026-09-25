import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "vendor/pptxgenjs/**",
      "desktop/open-connector-console-assets/assets/**",
      ".next-desktop/**",
      "src-tauri/resources/server/**",
      "src-tauri/resources/open-connector/**",
      "src-tauri/resources/edupi-core/**",
      "src-tauri/resources/edupi-core-test-*/**",
      "src-tauri/target/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
