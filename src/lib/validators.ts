import { z } from "zod";

export const assistantCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(""),
  language: z.string().trim().min(2).max(12).default("fr")
});

export const assistantUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500),
  language: z.string().trim().min(2).max(12),
  llmEnabled: z.boolean(),
  llmSystemPrompt: z.string().trim().max(20_000),
  configYaml: z.string().min(1).max(500_000),
  domainYaml: z.string().min(1).max(500_000),
  nluYaml: z.string().min(1).max(1_000_000),
  storiesYaml: z.string().min(1).max(1_000_000),
  rulesYaml: z.string().min(1).max(1_000_000),
  endpointsYaml: z.string().max(500_000),
  credentialsYaml: z.string().max(500_000),
  changeNote: z.string().trim().max(240).optional()
});

export const storeBotSchema = z.object({
  assistantId: z.string().cuid(),
  name: z.string().trim().min(2).max(80),
  allowedOrigins: z.array(z.string()).min(1).max(20),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  position: z.enum(["left", "right"]),
  welcomeMessage: z.string().trim().min(1).max(300),
  placeholder: z.string().trim().min(1).max(120),
  launcherLabel: z.string().trim().min(1).max(80),
  avatarUrl: z.string().url().or(z.literal("")).optional(),
  locale: z.string().trim().min(2).max(12),
  enabled: z.boolean().default(true)
});

export const userCreateSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  name: z.string().trim().min(2).max(100),
  password: z
    .string()
    .min(12)
    .max(200)
    .regex(/[a-z]/, "Le mot de passe doit contenir une minuscule.")
    .regex(/[A-Z]/, "Le mot de passe doit contenir une majuscule.")
    .regex(/[0-9]/, "Le mot de passe doit contenir un chiffre."),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).default("EDITOR")
});

export const userUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).optional(),
    isActive: z.boolean().optional(),
    password: z
      .string()
      .min(12)
      .max(200)
      .regex(/[a-z]/)
      .regex(/[A-Z]/)
      .regex(/[0-9]/)
      .optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Au moins une modification est requise."
  });
