/**
 * X3DH key agreement protocol.
 * Initiator: Alice fetches Bob's bundle, derives SK, sends PreKey message.
 * Responder: Bob receives PreKey message, derives SK, decrypts.
 */

import {
  cryptoBoxKeypair,
  cryptoSignVerifyDetached,
  cryptoScalarmult,
  cryptoSignEd25519PkToCurve25519,
  cryptoSignEd25519SkToCurve25519,
  cryptoGenericHash,
  fromBase64,
} from "./crypto";
import type { KeyPair, KeyBundle } from "./protocol";

const F_PAD = new Uint8Array(32).fill(0xff);

/** KDF for X3DH shared secret. */
function kdf(ikm: Uint8Array): Uint8Array {
  return cryptoGenericHash(32, ikm, F_PAD);
}

/** X3DH initiator: derive SK from our keys and Bob's bundle. */
export function x3dhInitiate(
  ourIdentity: KeyPair,
  _ourSignedPrekey: KeyPair | null,
  bundle: KeyBundle
): { sharedSecret: Uint8Array; ephemeralKey: KeyPair } {
  const ephemeral = cryptoBoxKeypair();

  const IKB = fromBase64(bundle.identity_key);
  const SPKB = fromBase64(bundle.signed_prekey);
  const OPKB = bundle.one_time_prekey ? fromBase64(bundle.one_time_prekey.public_key) : null;

  // Convert our Ed25519 IK to X25519 for DH
  const IKA_x25519_priv = cryptoSignEd25519SkToCurve25519(ourIdentity.privateKey);
  const IKB_x25519 = cryptoSignEd25519PkToCurve25519(IKB);

  const DH1 = cryptoScalarmult(IKA_x25519_priv, SPKB);
  const DH2 = cryptoScalarmult(ephemeral.privateKey, IKB_x25519);
  const DH3 = cryptoScalarmult(ephemeral.privateKey, SPKB);

  let km = new Uint8Array(DH1.length + DH2.length + DH3.length);
  km.set(DH1, 0);
  km.set(DH2, DH1.length);
  km.set(DH3, DH1.length + DH2.length);

  if (OPKB) {
    const DH4 = cryptoScalarmult(ephemeral.privateKey, OPKB);
    const km2 = new Uint8Array(km.length + DH4.length);
    km2.set(km, 0);
    km2.set(DH4, km.length);
    km = km2;
  }

  const sharedSecret = kdf(km);
  return { sharedSecret, ephemeralKey: ephemeral };
}

/** Verify signed prekey signature. */
export function verifySignedPrekey(bundle: KeyBundle): boolean {
  const IKB = fromBase64(bundle.identity_key);
  const SPKB = fromBase64(bundle.signed_prekey);
  const sig = fromBase64(bundle.signed_prekey_sig);
  return cryptoSignVerifyDetached(sig, SPKB, IKB);
}

/** X3DH responder: derive SK from PreKey message and our keys. */
export function x3dhRespond(
  ourIdentity: KeyPair,
  ourSignedPrekey: KeyPair,
  ourOpk: KeyPair | null,
  theirIdentityPk: Uint8Array,
  theirEphemeralPk: Uint8Array,
  _usedOpkId?: number
): Uint8Array {
  const IKA_x25519 = cryptoSignEd25519PkToCurve25519(theirIdentityPk);
  const IKB_x25519_priv = cryptoSignEd25519SkToCurve25519(ourIdentity.privateKey);

  const DH1 = cryptoScalarmult(ourSignedPrekey.privateKey, IKA_x25519);
  const DH2 = cryptoScalarmult(IKB_x25519_priv, theirEphemeralPk);
  const DH3 = cryptoScalarmult(ourSignedPrekey.privateKey, theirEphemeralPk);

  let km = new Uint8Array(DH1.length + DH2.length + DH3.length);
  km.set(DH1, 0);
  km.set(DH2, DH1.length);
  km.set(DH3, DH1.length + DH2.length);

  if (ourOpk) {
    const DH4 = cryptoScalarmult(ourOpk.privateKey, theirEphemeralPk);
    const km2 = new Uint8Array(km.length + DH4.length);
    km2.set(km, 0);
    km2.set(DH4, km.length);
    km = km2;
  }

  return kdf(km);
}
