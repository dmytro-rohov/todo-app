// drizzle-kit configuration: generation only (no database connection is needed to generate migrations).
module.exports = { dialect: "postgresql", schema: "./db/schema.js", out: "./drizzle", breakpoints: true };
