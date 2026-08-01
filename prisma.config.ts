import { defineConfig } from "prisma/config";

if (!process.env["DATABASE_URL"]) {
  try {
    require("dotenv").config();
  } catch {
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"]!,
  },
});
