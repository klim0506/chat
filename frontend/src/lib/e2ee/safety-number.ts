/**
 * Safety numbers: 60-digit code for verification.
 * Formula: SHA-256(IK_A || userId_A) + SHA-256(IK_B || userId_B), truncated, sorted.
 */

import { cryptoGenericHash, fromBase64 } from "./crypto";

export function computeSafetyNumber(
  identityKeyA: string,
  userIdA: string,
  identityKeyB: string,
  userIdB: string
): string {
  const ikA = fromBase64(identityKeyA);
  const ikB = fromBase64(identityKeyB);
  const idA = new TextEncoder().encode(userIdA);
  const idB = new TextEncoder().encode(userIdB);

  const inputA = new Uint8Array(ikA.length + idA.length);
  inputA.set(ikA, 0);
  inputA.set(idA, ikA.length);

  const inputB = new Uint8Array(ikB.length + idB.length);
  inputB.set(ikB, 0);
  inputB.set(idB, ikB.length);

  const context = new TextEncoder().encode("E2EE-SafetyNumber");
  const hashA = cryptoGenericHash(32, inputA, context);
  const hashB = cryptoGenericHash(32, inputB, context);

  const combined = new Uint8Array(64);
  combined.set(hashA, 0);
  combined.set(hashB, 32);

  const bytes = combined.slice(0, 30);
  let digits = "";
  for (let i = 0; i < bytes.length; i += 5) {
    const chunk = bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24);
    const n = chunk % 100000;
    digits += n.toString().padStart(5, "0");
  }
  return digits.slice(0, 60);
}

export function formatSafetyNumber(code: string): string {
  const parts: string[] = [];
  for (let i = 0; i < code.length; i += 5) {
    parts.push(code.slice(i, i + 5));
  }
  return parts.join(" ");
}
