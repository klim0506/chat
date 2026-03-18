import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { authApi } from "../api/client";
import { useAuthStore } from "../store/auth";
import { usePreferencesStore } from "../store/preferences";
import { useTranslation } from "../lib/i18n";
import { requestPermission, NOTIFICATIONS_SUPPORTED } from "../lib/notifications";
import { AvatarCropConfirmModal } from "../components/AvatarCropConfirmModal";
import { PhoneInput } from "../components/PhoneInput";

import { LOGO_URL } from "../lib/constants";

type PhoneForm = { phone: string };
type CodeForm = { code: string };
type UsernameForm = { username: string; display_name?: string };

export default function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref") || "";
  const pairingToken = searchParams.get("pairing") || "";

  const phoneSchema = z.object({ phone: z.string().min(10, t("auth.enterPhone")) });
  const codeSchema = z.object({ code: z.string().length(6, t("auth.codeDigits")) });
  const usernameSchema = z.object({
    username: z
      .string()
      .min(3, t("auth.username3to30"))
      .max(30, t("auth.username3to30"))
      .regex(/^[a-zA-Z0-9_]+$/, t("auth.usernameChars")),
    display_name: z.string().max(255).optional(),
  });

  const setTokens = useAuthStore((s) => s.setTokens);
  const existingUser = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const language = usePreferencesStore((s) => s.language);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"phone" | "code" | "username">("phone");
  const [codeMethod, setCodeMethod] = useState<"sms" | "telegram" | "">("");
  const [isNewAccount, setIsNewAccount] = useState(false);
  const [isNewPhone, setIsNewPhone] = useState<boolean | null>(null); // null = not yet checked
  const [pairingMode, setPairingMode] = useState<"code" | null>(null); // "code" = show manual code input
  const [pairingCode, setPairingCode] = useState("");
  const [pairingLoading, setPairingLoading] = useState(false);
  /** Seconds left before "Get code" can be requested again (429 throttle). */
  const [sendCodeCooldown, setSendCodeCooldown] = useState(0);
  /** После успешной установки username: показать модалку «включить уведомления», затем редирект. */
  const [showNotifyModal, setShowNotifyModal] = useState(false);

  const nextUrl = searchParams.get("next");

  // Countdown for send-code cooldown
  useEffect(() => {
    if (sendCodeCooldown <= 0) return;
    const t = setInterval(() => {
      setSendCodeCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [sendCodeCooldown]);

  // If URL has ?pairing=token, exchange and redirect
  useEffect(() => {
    if (!pairingToken || isAuthenticated) return;
    let cancelled = false;
    setPairingLoading(true);
    authApi
      .pairingExchange({ token: pairingToken })
      .then((res) => {
        if (cancelled) return;
        setTokens(res.data.access, res.data.refresh, res.data.user);
        const target = nextUrl && nextUrl.startsWith("/") ? nextUrl : "/chats";
        navigate(target, { replace: true });
      })
      .catch(() => {
        if (!cancelled) {
          setError(t("auth.qrLoginError"));
          setPairingLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [pairingToken, isAuthenticated, setTokens, navigate, nextUrl, t]);

  // Если уже авторизован по куки/JWT: с username — редирект в чаты; без username — шаг выбора ника
  useEffect(() => {
    if (!isAuthenticated || !existingUser) return;
    if (existingUser.username) {
      const target = nextUrl && nextUrl.startsWith("/") ? nextUrl : "/chats";
      navigate(target, { replace: true });
      return;
    }
    setIsNewAccount(true);
    setStep("username");
  }, [isAuthenticated, existingUser, nextUrl, navigate]);

  const phoneForm = useForm<PhoneForm>({ resolver: zodResolver(phoneSchema), defaultValues: { phone: "" } });
  const codeForm = useForm<CodeForm>({ resolver: zodResolver(codeSchema), defaultValues: { code: "" } });
  const usernameForm = useForm<UsernameForm>({
    resolver: zodResolver(usernameSchema),
    defaultValues: { username: "", display_name: "" },
  });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);

  // Live username availability check
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [usernameDetail, setUsernameDetail] = useState("");
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedRef = useRef("");

  const checkUsernameAvailability = useCallback((value: string) => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed.length < 3 || !/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      setUsernameStatus("idle");
      setUsernameDetail("");
      lastCheckedRef.current = "";
      return;
    }
    if (trimmed === lastCheckedRef.current) return;
    setUsernameStatus("checking");
    setUsernameDetail("");
    checkTimerRef.current = setTimeout(async () => {
      try {
        const res = await authApi.checkUsername(trimmed);
        lastCheckedRef.current = trimmed;
        if (res.data.available) {
          setUsernameStatus("available");
          setUsernameDetail("");
        } else {
          setUsernameStatus("taken");
          setUsernameDetail(res.data.detail || "");
        }
      } catch {
        setUsernameStatus("idle");
        setUsernameDetail("");
      }
    }, 400);
  }, []);

  const onSendCode = async (data: PhoneForm) => {
    setError("");
    setLoading(true);
    setCodeMethod("");
    try {
      const res = await authApi.sendCode(data.phone);
      setPhone(data.phone);
      setStep("code");
      const resData = res.data as { method?: string; is_new?: boolean };
      setCodeMethod(resData.method === "sms" ? "sms" : "telegram");
      setIsNewPhone(resData.is_new ?? null);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { detail?: string; wait?: number } } };
      const data = err?.response?.data;
      const statusCode = err?.response?.status;
      setError(data?.detail || t("common.error"));
      if (statusCode === 429 && typeof data?.wait === "number" && data.wait > 0) {
        setSendCodeCooldown(data.wait);
      }
    } finally {
      setLoading(false);
    }
  };

  const onPairingCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = pairingCode.replace(/\s/g, "").replace(/-/g, "").trim();
    if (code.length !== 6) {
      setError(t("auth.codeDigits"));
      return;
    }
    setError("");
    setPairingLoading(true);
    try {
      const res = await authApi.pairingExchange({ code });
      setTokens(res.data.access, res.data.refresh, res.data.user);
      const target = nextUrl && nextUrl.startsWith("/") ? nextUrl : "/chats";
      navigate(target, { replace: true });
    } catch {
      setError(t("auth.qrLoginError"));
    } finally {
      setPairingLoading(false);
    }
  };

  const onVerifyCode = async (data: CodeForm) => {
    setError("");
    setLoading(true);
    try {
      const res = await authApi.verifyCode(phone, data.code, isNewPhone !== false ? (refCode || undefined) : undefined);
      setTokens(res.data.access, res.data.refresh, res.data.user);
      const created = !!(res.data as { created?: boolean }).created;
      setIsNewAccount(created);
      if (res.data.user && !res.data.user.username) {
        setStep("username");
      } else {
        const target = nextUrl && nextUrl.startsWith("/") ? nextUrl : "/chats";
        navigate(target, { replace: true });
      }
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("auth.invalidCode"));
    } finally {
      setLoading(false);
    }
  };

  const avatarInputRef = useRef<HTMLInputElement>(null);

  const onAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    setCropFile(file);
    // Reset input so the same file can be re-selected
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const onCropConfirm = (blob: Blob) => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    const croppedFile = new File([blob], "avatar.png", { type: "image/png" });
    setAvatarFile(croppedFile);
    setAvatarPreview(URL.createObjectURL(blob));
    setCropFile(null);
  };

  const onCropCancel = () => {
    setCropFile(null);
  };

  const onSetUsername = async (data: UsernameForm) => {
    setError("");
    setLoading(true);
    try {
      const normalized = data.username.trim().toLowerCase();
      const displayName = (data.display_name ?? "").trim() || undefined;
      const res = await authApi.updateMe({ username: normalized, display_name: displayName });
      let user = res.data;
      if (avatarFile) {
        const avatarRes = await authApi.uploadAvatar(avatarFile);
        user = avatarRes.data;
      }
      setTokens(
        useAuthStore.getState().accessToken!,
        useAuthStore.getState().refreshToken!,
        user
      );
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      if (NOTIFICATIONS_SUPPORTED && Notification.permission === "default") {
        setShowNotifyModal(true);
      } else {
        const target = nextUrl && nextUrl.startsWith("/") ? nextUrl : "/chats";
        navigate(target, { replace: true });
      }
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("auth.usernameTaken")
      );
    } finally {
      setLoading(false);
    }
  };

  const nextUrlResolved = nextUrl && nextUrl.startsWith("/") ? nextUrl : "/chats";
  const closeNotifyModalAndNavigate = () => {
    setShowNotifyModal(false);
    navigate(nextUrlResolved, { replace: true });
  };
  const onEnableNotifications = async () => {
    await requestPermission();
    closeNotifyModalAndNavigate();
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 p-4">
      <div className="absolute left-4 top-4">
        <Link to="/" className="inline-block cursor-pointer opacity-90 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded" aria-label={t("landing.brand")}>
          <img src={LOGO_URL} alt={t("auth.logo")} className="h-[3.75rem] w-auto object-contain" />
        </Link>
      </div>
      <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-md p-6">
        <h1 className="text-xl font-semibold text-center mb-6">
          {isNewAccount ? t("auth.createAccount") : t("auth.login")}
        </h1>

        {refCode && isNewPhone === true && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
            {t("auth.referralBonus")}
          </div>
        )}

        {pairingToken && pairingLoading ? (
          <div className="py-8 text-center">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-gray-600">{t("common.loading")}</p>
          </div>
        ) : pairingMode === "code" ? (
          <form onSubmit={onPairingCodeSubmit} className="space-y-4">
            <p className="text-sm text-gray-600">{t("auth.qrLoginEnterCode")}</p>
            <div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                placeholder="123456"
                value={pairingCode}
                onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className={`w-full border rounded-lg px-3 py-2 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:border-transparent border-gray-300 focus:ring-blue-500`}
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={pairingLoading || pairingCode.length !== 6}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {pairingLoading ? t("common.loading") : t("auth.loginBtn")}
            </button>
            <button
              type="button"
              onClick={() => { setPairingMode(null); setError(""); setPairingCode(""); }}
              className="w-full text-sm text-gray-500 hover:text-gray-700 py-1"
            >
              {t("common.back")}
            </button>
          </form>
        ) : step === "phone" ? (
          <form onSubmit={phoneForm.handleSubmit(onSendCode)} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t("auth.interfaceLanguage")}</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLanguage("ru")}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    language === "ru"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Русский
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage("en")}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    language === "en"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  English
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("auth.phoneNumber")}</label>
              <Controller
                name="phone"
                control={phoneForm.control}
                render={({ field }) => (
                  <PhoneInput
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="917 123 45 67"
                    error={phoneForm.formState.errors.phone?.message}
                  />
                )}
              />
            {phoneForm.formState.errors.phone && (
              <p className="text-red-500 text-sm mt-1">{phoneForm.formState.errors.phone.message}</p>
            )}
            </div>
            <p className="text-xs text-gray-400">
              {t("auth.codeHint")}
            </p>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading || sendCodeCooldown > 0}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? t("auth.sending") : sendCodeCooldown > 0 ? t("auth.retryInSeconds").replace("%s", String(sendCodeCooldown)) : t("auth.sendCode")}
            </button>
            <button
              type="button"
              onClick={() => setPairingMode("code")}
              className="w-full text-sm text-blue-600 hover:text-blue-700 py-2"
            >
              {t("settings.qrLogin")}
            </button>
          </form>
        ) : step === "username" ? (
          <form onSubmit={usernameForm.handleSubmit(onSetUsername)} className="space-y-4">
            <p className="text-sm text-gray-600 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{t("auth.verifiedPhone")}:</span>
              <span className="text-gray-800 font-medium">{phone || existingUser?.phone || "—"}</span>
              <button
                type="button"
                onClick={() => { setStep("phone"); setError(""); }}
                className="text-blue-600 hover:text-blue-700 hover:underline"
              >
                {t("auth.changeNumber")}
              </button>
            </p>
            <p className="text-sm text-gray-600 mb-4">
              {t("auth.usernameHint")}
            </p>
            <div className="flex gap-4 items-start mb-4">
              <label className="cursor-pointer shrink-0" title={t("auth.addAvatar")}>
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarChange} />
                <span className="w-14 h-14 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden bg-gray-50 hover:border-blue-400 transition-colors">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-gray-400 text-xs font-medium">{t("auth.photoPlaceholder")}</span>
                  )}
                </span>
              </label>
              <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("auth.nameLabel")}</label>
                <input
                  type="text"
                  autoComplete="name"
                  placeholder={t("auth.howToAddress")}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  {...usernameForm.register("display_name")}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("auth.usernameLabel")}</label>
              <div
                className={`flex items-center border rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent ${usernameForm.formState.errors.username ? "border-red-500 focus-within:ring-red-500" : "border-gray-300 focus-within:ring-blue-500"}`}
              >
                <span className="px-3 py-2 text-gray-500 bg-gray-50 border-r border-gray-200 text-lg font-medium select-none">@</span>
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="ivan_petrov"
                  className="flex-1 min-w-0 border-0 rounded-none px-3 py-2 focus:outline-none focus:ring-0 lowercase bg-transparent"
                  {...usernameForm.register("username", {
                    onChange: (e) => checkUsernameAvailability(e.target.value),
                  })}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {t("auth.usernameRules")}
              </p>
              {usernameForm.formState.errors.username && (
                <p className="text-red-500 text-sm mt-1">{usernameForm.formState.errors.username.message}</p>
              )}
              {!usernameForm.formState.errors.username && usernameStatus === "checking" && (
                <p className="text-xs text-gray-400 mt-1">{t("auth.usernameChecking")}</p>
              )}
              {!usernameForm.formState.errors.username && usernameStatus === "available" && (
                <p className="text-xs text-green-600 mt-1">{t("auth.usernameAvailable")}</p>
              )}
              {!usernameForm.formState.errors.username && usernameStatus === "taken" && (
                <p className="text-xs text-red-500 mt-1">{usernameDetail || t("auth.usernameTakenLive")}</p>
              )}
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading || usernameStatus === "taken" || usernameStatus === "checking"}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? t("auth.saving") : t("auth.continue")}
            </button>
          </form>
        ) : (
          <form onSubmit={codeForm.handleSubmit(onVerifyCode)} className="space-y-4">
            <p className="text-sm text-gray-600">
              {codeMethod === "telegram" ? (
                <>{t("auth.codeSentTelegram")} {phone} ({t("auth.codeSentTelegramFrom")} <strong>@VerificationCodes</strong>)</>
              ) : (
                <>{t("auth.codeSentSms")} {phone}</>
              )}
              <button
                type="button"
                onClick={() => { setStep("phone"); setError(""); setIsNewPhone(null); }}
                className="ml-2 text-blue-600 hover:underline"
              >
                {t("auth.changePhone")}
              </button>
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {codeMethod === "telegram" ? t("auth.codeFromTelegram") : t("auth.codeFromSms")}
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                className={`w-full border rounded-lg px-3 py-2 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:border-transparent ${codeForm.formState.errors.code ? "border-red-500 focus:ring-red-500" : "border-gray-300 focus:ring-blue-500"}`}
                {...codeForm.register("code", {
                  onChange: (e) => {
                    if (e.target.value.length === 6 && !loading) {
                      setTimeout(() => codeForm.handleSubmit(onVerifyCode)(), 0);
                    }
                  },
                })}
              />
              {codeForm.formState.errors.code && (
                <p className="text-red-500 text-sm mt-1">{codeForm.formState.errors.code.message}</p>
              )}
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? t("auth.checking") : t("auth.loginBtn")}
            </button>
          </form>
        )}
      </div>
      </div>

      {/* Avatar crop modal */}
      {cropFile && (
        <AvatarCropConfirmModal
          file={cropFile}
          onConfirm={onCropConfirm}
          onCancel={onCropCancel}
        />
      )}

      {/* Рекомендация включить уведомления после регистрации; по кнопке — запрос разрешения у браузера */}
      {showNotifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="notify-modal-title">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <p id="notify-modal-title" className="text-gray-800">
              {t("auth.notifyPromptBody")}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onEnableNotifications}
                className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t("auth.notifyEnable")}
              </button>
              <button
                type="button"
                onClick={closeNotifyModalAndNavigate}
                className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {t("auth.notifyLater")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
