import { create } from "zustand";
import { filesApi } from "../api/client";
import { useMessagesStore } from "./messages";

/** One in-flight file upload (survives ChatPage unmount when user switches chats). */
export interface ActiveUpload {
  tempId: string;
  conversationId: string;
  fileName: string;
  loaded: number;
  total: number;
  abortController: AbortController;
  /** Set after first chunk for chunked uploads; used to cancel on server and free temp files. One or many (multi-image). */
  chunkedUploadId?: string | string[];
}

interface UploadProgressState {
  activeUploads: ActiveUpload[];

  registerUpload: (params: {
    tempId: string;
    conversationId: string;
    fileName: string;
    total: number;
    abortController: AbortController;
  }) => void;
  setChunkedUploadId: (tempId: string, uploadId: string) => void;
  updateProgress: (tempId: string, loaded: number, total: number) => void;
  unregisterUpload: (tempId: string) => void;
  cancelUpload: (tempId: string) => void;

  getProgress: (tempId: string) => { loaded: number; total: number } | undefined;
  getActiveUploadsForChat: (conversationId: string) => ActiveUpload[];
  getActiveUploadsForOtherChats: (currentConversationId: string) => ActiveUpload[];
}

export const useUploadProgressStore = create<UploadProgressState>((set, get) => ({
  activeUploads: [],

  registerUpload: ({ tempId, conversationId, fileName, total, abortController }) => {
    set((state) => ({
      activeUploads: [
        ...state.activeUploads.filter((u) => u.tempId !== tempId),
        { tempId, conversationId, fileName, loaded: 0, total, abortController },
      ],
    }));
  },

  setChunkedUploadId: (tempId, uploadId) => {
    set((state) => ({
      activeUploads: state.activeUploads.map((u) => {
        if (u.tempId !== tempId) return u;
        const prev = u.chunkedUploadId;
        const next = prev == null ? uploadId : (Array.isArray(prev) ? [...prev, uploadId] : [prev, uploadId]);
        return { ...u, chunkedUploadId: next };
      }),
    }));
  },

  updateProgress: (tempId, loaded, total) => {
    set((state) => ({
      activeUploads: state.activeUploads.map((u) =>
        u.tempId === tempId ? { ...u, loaded, total } : u
      ),
    }));
  },

  unregisterUpload: (tempId) => {
    set((state) => ({
      activeUploads: state.activeUploads.filter((u) => u.tempId !== tempId),
    }));
  },

  cancelUpload: (tempId) => {
    const upload = get().activeUploads.find((u) => u.tempId === tempId);
    if (upload) {
      const ids = upload.chunkedUploadId;
      if (ids != null) {
        const list = Array.isArray(ids) ? ids : [ids];
        list.forEach((id) => filesApi.cancelChunkedUpload(id).catch(() => {}));
      }
      try {
        upload.abortController.abort();
      } catch {
        /* ignore */
      }
      get().unregisterUpload(tempId);
      useMessagesStore.getState().removeMessage(upload.conversationId, tempId);
    }
  },

  getProgress: (tempId) => {
    const u = get().activeUploads.find((x) => x.tempId === tempId);
    return u ? { loaded: u.loaded, total: u.total } : undefined;
  },

  getActiveUploadsForChat: (conversationId) =>
    get().activeUploads.filter((u) => u.conversationId === conversationId),

  getActiveUploadsForOtherChats: (currentConversationId) =>
    get().activeUploads.filter((u) => u.conversationId !== currentConversationId),
}));
