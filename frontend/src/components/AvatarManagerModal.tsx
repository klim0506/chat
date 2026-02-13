import { useState, useRef, useEffect } from "react";
import { authApi, type UserAvatar } from "../api/client";
import { AvatarCropConfirmModal } from "./AvatarCropConfirmModal";

const MAX_AVATARS = 30;

interface AvatarManagerModalProps {
  avatars: UserAvatar[];
  onClose: () => void;
  onUpdated: (avatars: UserAvatar[]) => void;
  onUserUpdate?: () => void;
}

export function AvatarManagerModal({
  avatars: initialAvatars,
  onClose,
  onUpdated,
  onUserUpdate,
}: AvatarManagerModalProps) {
  const [avatars, setAvatars] = useState<UserAvatar[]>(initialAvatars);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAvatars = () => {
    authApi.listAvatars().then((res) => {
      setAvatars(res.data);
      onUpdated(res.data);
    });
  };

  useEffect(() => {
    fetchAvatars();
  }, []);

  const handleAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    e.target.value = "";
    setPendingFile(file);
  };

  const handleCropConfirm = async (blob: Blob) => {
    if (!pendingFile) return;
    setLoading(true);
    setError("");
    try {
      const file = new File([blob], "avatar.png", { type: "image/png" });
      const res = await authApi.addAvatar(file);
      setAvatars((prev) => [...prev, res.data].sort((a, b) => a.order - b.order));
      fetchAvatars();
      onUserUpdate?.();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Не удалось добавить");
    } finally {
      setPendingFile(null);
      setLoading(false);
    }
  };

  const handleDelete = async (id: number | "legacy") => {
    setLoading(true);
    setError("");
    try {
      if (id === "legacy") {
        await authApi.deleteAvatar();
      } else {
        await authApi.deleteAvatarById(id);
      }
      setAvatars((prev) => prev.filter((a) => a.id !== id));
      fetchAvatars();
      onUserUpdate?.();
    } catch {
      setError("Не удалось удалить");
    } finally {
      setLoading(false);
    }
  };

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const newOrder = [...avatars];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    reorderAvatars(newOrder);
  };

  const moveDown = (index: number) => {
    if (index >= avatars.length - 1) return;
    const newOrder = [...avatars];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    reorderAvatars(newOrder);
  };

  const reorderAvatars = async (newOrder: UserAvatar[]) => {
    const ids = newOrder.map((a) => a.id).filter((id): id is number => typeof id === "number");
    if (ids.length === 0) return;
    setLoading(true);
    try {
      await authApi.reorderAvatars(ids);
      setAvatars(newOrder.map((a, i) => ({ ...a, order: i })));
      fetchAvatars();
      onUserUpdate?.();
    } catch {
      setError("Не удалось изменить порядок");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-slate-800">Аватарки</h2>
          <button type="button" onClick={onClose} className="p-2 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
            {avatars.map((a, i) => (
              <div key={a.id} className="relative group">
                <div className="aspect-square rounded-full overflow-hidden bg-slate-100 border-2 border-slate-200">
                  <img src={a.url} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 bg-black/50 rounded-full transition-opacity p-1">
                  {(a.id !== "legacy") && (
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); moveUp(i); }}
                        disabled={loading || i === 0}
                        className="w-6 h-6 bg-white/90 rounded flex items-center justify-center text-slate-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Выше"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m18 15-6-6-6 6"/></svg>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); moveDown(i); }}
                        disabled={loading || i === avatars.length - 1}
                        className="w-6 h-6 bg-white/90 rounded flex items-center justify-center text-slate-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Ниже"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}
                    disabled={loading}
                    className="w-6 h-6 bg-red-500/90 rounded flex items-center justify-center text-white hover:bg-red-600 disabled:opacity-40"
                    title="Удалить"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                  </button>
                </div>
              </div>
            ))}
            {avatars.length < MAX_AVATARS && (
              <label className="aspect-square rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAdd}
                  disabled={loading}
                />
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                  <path d="M12 5v14"/><path d="M5 12h14"/>
                </svg>
              </label>
            )}
          </div>
          <p className="text-slate-500 text-xs mt-3">{avatars.length} / {MAX_AVATARS} аватарок</p>
        </div>
      </div>

      {pendingFile && (
        <AvatarCropConfirmModal
          file={pendingFile}
          onConfirm={handleCropConfirm}
          onCancel={() => setPendingFile(null)}
        />
      )}
    </div>
  );
}
