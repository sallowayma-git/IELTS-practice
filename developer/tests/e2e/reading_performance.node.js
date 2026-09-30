// Run independently: WORDS=1000 node developer/tests/e2e/reading_performance.node.js
process.env.READING_STRESS = '1';
await import('./navigation_performance.node.js');
