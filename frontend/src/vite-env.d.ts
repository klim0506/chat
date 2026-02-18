/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_ALPHA_BANNER_ENABLED: string;
}
interface ImportMeta { readonly env: ImportMetaEnv; }

declare module "libsodium-wrappers-sumo" {
  const mod: any;
  export default mod;
}

declare module "@default-chat-bg" {
  const src: string;
  export default src;
}

declare module "*.ico?url" {
  const url: string;
  export default url;
}
