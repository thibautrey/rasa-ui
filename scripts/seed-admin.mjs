import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!email || !password || password.length < 12) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) are required.");
  process.exit(1);
}

const passwordHash = await bcrypt.hash(password, 12);

await prisma.user.upsert({
  where: { email },
  create: {
    email,
    name: "Administrator",
    passwordHash,
    role: "ADMIN"
  },
  update: {
    role: "ADMIN",
    isActive: true
  }
});

await prisma.$disconnect();
console.log("Administrator account is ready.");
