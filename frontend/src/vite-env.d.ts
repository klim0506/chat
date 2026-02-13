/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_API_URL: string; readonly VITE_WS_URL: string; }
interface ImportMeta { readonly env: ImportMetaEnv; }

declare module "@default-chat-bg" {
  const src: string;
  export default src;
}

declare module "*.ico?url" {
  const url: string;
  export default url;
}
