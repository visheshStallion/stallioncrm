import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { app: "stallioncrm" },
  redact: { paths: ["password", "*.password", "passwordHash", "*.passwordHash", "totpSecret", "*.totpSecret", "token", "*.token", "secret", "*.secret", "authorization", "*.authorization", "cookie", "*.cookie", "passphrase", "*.passphrase"], remove: true },
});
