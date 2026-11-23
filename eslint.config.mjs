import wcandillon from "eslint-config-react-native-wcandillon";

export default [
  {
    // docs/ is a standalone project with its own toolchain, except for the
    // examples: they are checked here, against the source of the library.
    ignores: [
      "dist/**",
      "docs/*",
      "!docs/examples/",
      "node_modules/**",
      "test-results/**",
      "*.mjs"
    ]
  },
  ...wcandillon,
  {
    // The nearest tsconfig.json is the one of the docs site, which leaves the
    // examples out: they belong to the project of the repository root.
    files: ["docs/examples/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // "skia-wasm" is this package: tsconfig.json maps it to src/ts.
      "import/no-extraneous-dependencies": "off"
    }
  }
];
