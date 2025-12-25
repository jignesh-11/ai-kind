import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal_v2) {
    global.prismaGlobal_v2 = new PrismaClient();
  }
}

const prisma = global.prismaGlobal_v2 ?? new PrismaClient();

export default prisma;
// Forced reload for schema update
