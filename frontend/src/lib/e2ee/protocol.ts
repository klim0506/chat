/** E2EE protocol types and constants. */

/** PreKey whisper message (type 0) - first message in session, contains X3DH data. */
export const MSG_TYPE_PREKEY = 0;

/** Regular whisper message (type 1) - Double Ratchet. */
export const MSG_TYPE_WHISPER = 1;

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface KeyBundle {
  device_id: number;
  identity_key: string;
  signed_prekey: string;
  signed_prekey_id: number;
  signed_prekey_sig: string;
  one_time_prekey?: { key_id: number; public_key: string } | null;
}

export interface EncryptedKeyEntryWhisper {
  type: 1;
  body: string;
}

export interface EncryptedKeyEntryPreKey {
  type: 0;
  body: string;
  identity_key: string;
  ephemeral_key: string;
  spk_id: number;
  opk_id?: number;
}

export type EncryptedKeyEntry = EncryptedKeyEntryWhisper | EncryptedKeyEntryPreKey;

/** encrypted_keys map: device_id (as string) -> EncryptedKeyEntry */
export type EncryptedKeysMap = Record<string, EncryptedKeyEntry>;
