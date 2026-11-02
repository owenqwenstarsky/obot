import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Placeholder lets `prisma generate` run without a database configured.
    url: process.env.DATABASE_URL ?? "postgresql://obot:obot@localhost:5432/obot",
  },
});
