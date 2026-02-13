import { create } from "zustand";
import { e2eeApi } from "../api/client";
import { init, cryptoSignKeypair, cryptoBoxKeypair, cryptoSignDetached, toBase64 } from "../lib/e2ee/crypto";
import * as keyStorage from "../lib/e2ee/key-storage";

interface E2eeState {
  deviceId: number | null;
  isRegistered: boolean;
  error: string | null;
  ensureRegistered: () => Promise<boolean>;
  registerDevice: () => Promise<boolean>;
  uploadPrekeysIfLow: () => Promise<void>;
}

const PREKEY_COUNT = 100;
const PREKEY_LOW_THRESHOLD = 20;

export const useE2eeStore = create<E2eeState>((set, get) => ({
  deviceId: null,
  isRegistered: false,
  error: null,

  ensureRegistered: async () => {
    const stored = await keyStorage.getCurrentDeviceId();
    if (stored != null) {
      set({ deviceId: stored, isRegistered: true, error: null });
      return true;
    }
    return get().registerDevice();
  },

  registerDevice: async () => {
    try {
      await init();
      set({ error: null });

      let identity = await keyStorage.getIdentityKeyPair();
      if (!identity) {
        identity = cryptoSignKeypair();
        await keyStorage.saveIdentityKeyPair(identity);
      }

      const spk = cryptoBoxKeypair();
      const spkId = Math.floor(Date.now() / 1000) % 100000;
      const spkSig = cryptoSignDetached(spk.publicKey, identity.privateKey);

      const prekeys: { key_id: number; public_key: Uint8Array; private_key: Uint8Array }[] = [];
      for (let i = 0; i < PREKEY_COUNT; i++) {
        const kp = cryptoBoxKeypair();
        prekeys.push({ key_id: i, public_key: kp.publicKey, private_key: kp.privateKey });
      }
      await keyStorage.savePreKeys(
        prekeys.map((k) => ({
          keyId: k.key_id,
          publicKey: k.public_key,
          privateKey: k.private_key,
        }))
      );
      await keyStorage.saveSignedPreKey(
        spkId,
        spk.publicKey,
        spk.privateKey,
        spkSig
      );

      const existingDevices = await e2eeApi.listDevices().catch(() => ({ data: [] as { device_id: number }[] }));
      const nextId = existingDevices.data.length > 0
        ? Math.max(...existingDevices.data.map((d) => d.device_id)) + 1
        : 1;

      const res = await e2eeApi.registerDevice({
        device_id: nextId,
        name: getDeviceName(),
        identity_key: toBase64(identity.publicKey),
        signed_prekey: toBase64(spk.publicKey),
        signed_prekey_id: spkId,
        signed_prekey_sig: toBase64(spkSig),
        prekeys: prekeys.map((k) => ({
          key_id: k.key_id,
          public_key: toBase64(k.public_key),
        })),
      });

      const did = (res.data as { device_id?: number }).device_id ?? nextId;
      await keyStorage.setCurrentDeviceId(did);
      set({ deviceId: did, isRegistered: true, error: null });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg, isRegistered: false });
      return false;
    }
  },

  uploadPrekeysIfLow: async () => {
    const deviceId = await keyStorage.getCurrentDeviceId();
    if (deviceId == null) return;
    try {
      await init();
      const count = await keyStorage.getUnusedPreKeyCount();
      if (count >= PREKEY_LOW_THRESHOLD) return;
      const toUpload = Math.min(PREKEY_COUNT - count, 100);
      if (toUpload <= 0) return;
      const prekeys: { key_id: number; public_key: Uint8Array; private_key: Uint8Array }[] = [];
      const nextId = await keyStorage.getNextPreKeyId();
      for (let i = 0; i < toUpload; i++) {
        const kp = cryptoBoxKeypair();
        prekeys.push({ key_id: nextId + i, public_key: kp.publicKey, private_key: kp.privateKey });
      }
      await keyStorage.savePreKeys(
        prekeys.map((k) => ({
          keyId: k.key_id,
          publicKey: k.public_key,
          privateKey: k.private_key,
        }))
      );
      await e2eeApi.uploadPrekeys(
        deviceId,
        prekeys.map((k) => ({
          key_id: k.key_id,
          public_key: toBase64(k.public_key),
        }))
      );
    } catch {
      // Silently ignore
    }
  },
}));

function getDeviceName(): string {
  if (typeof navigator === "undefined") return "Unknown";
  const ua = navigator.userAgent;
  if (/Chrome/.test(ua) && !/Edge/.test(ua)) return "Chrome";
  if (/Firefox/.test(ua)) return "Firefox";
  if (/Safari/.test(ua) && !/Chrome/.test(ua)) return "Safari";
  if (/Edge/.test(ua)) return "Edge";
  return "Browser";
}
