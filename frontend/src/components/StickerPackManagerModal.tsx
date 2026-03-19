import { useState, useEffect, useCallback } from "react";
import { stickersApi, filesApi, type StickerPack } from "../api/client";
import { LottieSticker } from "./LottieSticker";
import { MediaImage } from "./MediaImage";

interface StickerPackManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after packs change (e.g. to refresh StickerGifPanel) */
  onPacksUpdated?: () => void;
}

export function StickerPackManagerModal({ isOpen, onClose, onPacksUpdated }: StickerPackManagerModalProps) {
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [createTitle, setCreateTitle] = useState("");
  const [createShortName, setCreateShortName] = useState("");
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadPacks = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    setError("");
    try {
      const res = await stickersApi.listPacks();
      setPacks(res.data);
      if (res.data.length > 0 && !selectedPackId) {
        setSelectedPackId(res.data[0].id);
      }
    } catch {
      setError("Не удалось загрузить наборы");
      setPacks([]);
    } finally {
      setLoading(false);
    }
  }, [isOpen, selectedPackId]);

  useEffect(() => {
    loadPacks();
  }, [loadPacks]);

  // Load pack details (with stickers) when a pack is selected
  useEffect(() => {
    if (!isOpen || !selectedPackId) return;
    stickersApi.getPack(selectedPackId).then(({ data }) => {
      setPacks((prev) => prev.map((p) => (p.id === selectedPackId ? data : p)));
    }).catch(() => {});
  }, [isOpen, selectedPackId]);

  const handleCreatePackStep1 = () => {
    const title = createTitle.trim();
    const shortName = createShortName.trim().toLowerCase().replace(/\s+/g, "_");
    if (!title || !shortName) {
      setError("Введите название и short_name");
      return;
    }
    if (!/^[a-z0-9_]{3,32}$/.test(shortName)) {
      setError("short_name: 3–32 символа, только a-z, 0-9, _");
      return;
    }
    setError("");
    setCreateStep(2);
  };

  const handleCreatePackFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const list = Array.from(files);
    const valid = list.filter((f) => {
      const m = f.type.toLowerCase();
      return m.startsWith("image/") || m === "application/json";
    });
    if (valid.length < list.length) {
      setError("Допустимы только ICO, JPEG, PNG, WebP или Lottie JSON");
    } else {
      setError("");
    }
    setCreateFiles((prev) => [...prev, ...valid]);
    e.target.value = "";
  };

  const handleCreatePack = async () => {
    const title = createTitle.trim();
    const shortName = createShortName.trim().toLowerCase().replace(/\s+/g, "_");
    setError("");
    setCreating(true);
    try {
      const { data } = await stickersApi.createPack({ title, short_name: shortName });
      for (const file of createFiles) {
        const { data: uploaded } = await filesApi.upload(file);
        await stickersApi.addSticker(data.id, { file_id: uploaded.id });
      }
      const { data: packWithStickers } = await stickersApi.getPack(data.id);
      setPacks((prev) => [...prev.filter((p) => p.id !== data.id), packWithStickers]);
      setSelectedPackId(data.id);
      setShowCreate(false);
      setCreateStep(1);
      setCreateTitle("");
      setCreateShortName("");
      setCreateFiles([]);
      onPacksUpdated?.();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setError(err.response?.data?.detail || "Ошибка создания набора");
    } finally {
      setCreating(false);
    }
  };

  const handleDeletePack = async (packId: string) => {
    if (!confirm("Удалить этот набор стикеров?")) return;
    setError("");
    try {
      await stickersApi.deletePack(packId);
      const nextPacks = packs.filter((p) => p.id !== packId);
      setPacks(nextPacks);
      if (selectedPackId === packId) {
        setSelectedPackId(nextPacks[0]?.id ?? null);
      }
      onPacksUpdated?.();
    } catch {
      setError("Ошибка удаления");
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedPackId) return;
    const files = e.target.files;
    if (!files?.length) return;
    setError("");
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const mime = file.type.toLowerCase();
        const ok = mime.startsWith("image/") || mime === "application/json";
        if (!ok) {
          setError(`Файл ${file.name}: допустимы только ICO, JPEG, PNG, WebP или Lottie JSON`);
          continue;
        }
        const { data: uploaded } = await filesApi.upload(file);
        await stickersApi.addSticker(selectedPackId, { file_id: uploaded.id });
      }
      const { data: updated } = await stickersApi.getPack(selectedPackId);
      setPacks((prev) => prev.map((p) => (p.id === selectedPackId ? updated : p)));
      onPacksUpdated?.();
    } catch {
      setError("Ошибка загрузки стикера");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleRemoveSticker = async (packId: string, stickerId: string) => {
    setError("");
    try {
      await stickersApi.removeSticker(packId, stickerId);
      const { data: updated } = await stickersApi.getPack(packId);
      setPacks((prev) => prev.map((p) => (p.id === packId ? updated : p)));
      onPacksUpdated?.();
    } catch {
      setError("Ошибка удаления стикера");
    }
  };

  const handleInstall = async (packId: string) => {
    setError("");
    try {
      await stickersApi.install(packId);
      onPacksUpdated?.();
    } catch {
      setError("Ошибка установки набора");
    }
  };

  const selectedPack = packs.find((p) => p.id === selectedPackId);
  const stickers = selectedPack?.stickers ?? [];

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Мои наборы стикеров</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 text-sm text-red-600 bg-red-50">{error}</div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {loading ? (
            <div className="py-8 text-center text-slate-500">Загрузка...</div>
          ) : (
            <>
              {showCreate ? (
                <div className="space-y-3 mb-4 p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs font-medium text-slate-500">
                    {createStep === 1 ? "Шаг 1 из 2" : "Шаг 2 из 2"}
                  </p>
                  {createStep === 1 ? (
                    <>
                      <input
                        type="text"
                        value={createTitle}
                        onChange={(e) => setCreateTitle(e.target.value)}
                        placeholder="Название набора"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                      <input
                        type="text"
                        value={createShortName}
                        onChange={(e) => setCreateShortName(e.target.value)}
                        placeholder="short_name (a-z, 0-9, _)"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Добавить стикеры (ICO, JPEG, PNG, WebP, Lottie JSON)
                      </label>
                      <label className="inline-block cursor-pointer px-3 py-2 text-sm bg-slate-200 hover:bg-slate-300 rounded-lg mb-2">
                        + Выбрать файлы
                        <input
                          type="file"
                          accept="image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/png,image/webp,application/json"
                          multiple
                          className="hidden"
                          onChange={handleCreatePackFilesSelect}
                        />
                      </label>
                      {createFiles.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {createFiles.map((f, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                            >
                              {f.name}
                              <button
                                type="button"
                                onClick={() => setCreateFiles((prev) => prev.filter((_, j) => j !== i))}
                                className="text-slate-500 hover:text-red-600"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {createStep === 2 ? (
                      <button
                        type="button"
                        onClick={() => setCreateStep(1)}
                        className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200 rounded"
                      >
                        Назад
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setShowCreate(false); setCreateStep(1); setCreateTitle(""); setCreateShortName(""); setCreateFiles([]); setError(""); }}
                        className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200 rounded"
                      >
                        Отмена
                      </button>
                    )}
                    {createStep === 1 ? (
                      <button
                        type="button"
                        onClick={handleCreatePackStep1}
                        className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                      >
                        Далее
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleCreatePack}
                        disabled={creating}
                        className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                      >
                        {creating ? "Создание…" : "Создать"}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="mb-4 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                >
                  + Создать набор
                </button>
              )}

              <div className="flex gap-2 mb-4 overflow-x-auto">
                {packs.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPackId(p.id)}
                    className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap ${selectedPackId === p.id ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    {p.title}
                  </button>
                ))}
              </div>

              {selectedPack && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700">{selectedPack.title}</span>
                    <div className="flex gap-1">
                      <label className="cursor-pointer px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-50">
                        {uploading ? "Загрузка…" : "+ Добавить"}
                        <input
                          type="file"
                          accept="image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/png,image/webp,application/json"
                          multiple
                          className="hidden"
                          onChange={handleFileSelect}
                          disabled={uploading}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => handleInstall(selectedPack.id)}
                        className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                      >
                        Установить
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePack(selectedPack.id)}
                        className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {stickers.map((s) => (
                      <div key={s.id} className="relative group">
                        <div className="w-14 h-14 flex items-center justify-center rounded-lg bg-slate-100 p-1">
                          {s.file?.url &&
                            ((s.file?.mime_type || "").includes("application/json") ? (
                              <LottieSticker animationUrl={s.file.url} size={40} />
                            ) : (
                              <MediaImage source={s.file.url} alt={s.label} className="w-10 h-10 object-contain" />
                            ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveSticker(selectedPack.id, s.id)}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 hover:bg-red-600"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
