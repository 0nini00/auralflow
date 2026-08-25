export interface LegacySecretMigrationInput {
  readSecure: () => Promise<string | null>;
  readLegacy: () => Promise<string | null>;
  writeSecure: (value: string) => Promise<void>;
  removeLegacy: () => Promise<void>;
}

export async function migrateLegacySecret(
  input: LegacySecretMigrationInput,
): Promise<string | null> {
  const secure = await input.readSecure();
  if (secure != null) {
    const legacy = await input.readLegacy();
    if (legacy) await input.removeLegacy();
    return secure;
  }

  const legacy = await input.readLegacy();
  if (!legacy) return null;

  await input.writeSecure(legacy);
  await input.removeLegacy();
  return legacy;
}
