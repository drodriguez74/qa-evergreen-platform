// Cucumber-JS runner config — standard FLAT layout.
// Run with:  NODE_OPTIONS='--import tsx' cucumber-js   (see package.json test:cucumber)
// The --import tsx loader (env var, NOT --loader) is required for ESM + TypeScript.
export default {
  import: ['support/**/*.ts', 'steps/**/*.ts'],
  paths: ['features/**/*.feature'],
  format: ['progress-bar'],
};
