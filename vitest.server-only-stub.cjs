/* Test-only stub for the "server-only" guard package.
 * Vitest executes server modules in jsdom (a client-like environment), which
 * makes the real package throw before any test can load a server module's
 * pure logic. Swapped in exclusively by vitest.config.ts aliasing — production
 * bundles are unaffected. No behavior is simulated here; the stub is inert. */
module.exports = {};
