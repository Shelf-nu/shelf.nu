import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "app/database/schema.prisma",
});
