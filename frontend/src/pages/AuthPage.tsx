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
  const authCopy = language === "ru"
    ? {
        eyebrow: "Private messaging, calmly refined",
        title: "Вход без шума, с ощущением настоящего продукта.",
        subtitle: "Лёгкий экран, понятные шаги, быстрый старт с телефона или QR-кода.",
        bullets: [
          "Чистый вход без перегруза интерфейса",
          "Один сценарий для mobile и web",
          "Мягкие состояния загрузки и переходов",
        ],
      }
    : {
        eyebrow: "Private messaging, calmly refined",
        title: "Sign in without noise, with a product-grade feel.",
        subtitle: "A lighter entry screen, clearer steps, fast start from phone or QR code.",
        bullets: [
          "Clean entry with less visual overload",
          "One flow tuned for mobile and web",
          "Softer loading and transition states",
        ],
      };
  const primaryButtonClass = "ui-accent-strong w-full rounded-2xl px-4 py-3 text-sm font-medium text-white transition-[transform,background-color,box-shadow] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryButtonClass = "w-full rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-white";
  const inputClass = "w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-[border-color,box-shadow,background-color] focus:border-sky-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-100";
  const authUxCopy = language === "ru"
    ? {
        eyebrow: "Pingy access flow",
        title: "Один спокойный вход для возвращения и регистрации.",
        subtitle: "Номер, код и короткая настройка профиля. Без разрозненных экранов и лишних решений.",
        stages: [
          { key: "phone" as const, label: "Номер", hint: "Введите телефон или код входа" },
          { key: "verify" as const, label: "Код", hint: "Подтверждение через Telegram или SMS" },
          { key: "profile" as const, label: "Профиль", hint: "Имя, username и фото по желанию" },
        ],
        flowBadges: { login: "Вход", create: "Новый аккаунт" },
        titles: {
          phone: "Введите номер телефона",
          verify: "Подтвердите вход",
          profile: "Завершите профиль",
        },
        descriptions: {
          phone: "Мы отправим код в Telegram или по SMS. Этот же сценарий подходит и для нового аккаунта.",
          verifyTelegram: "Код придёт в Telegram. Введите его и продолжайте без лишних шагов.",
          verifySms: "Введите шестизначный код из SMS, чтобы продолжить.",
          profile: "Имя, username и фото можно задать сейчас или позже в настройках.",
          pairing: "Введите код с другого устройства, чтобы подтвердить вход вручную.",
        },
      }
    : {
        eyebrow: "Pingy access flow",
        title: "One calm flow for sign-in and signup.",
        subtitle: "Phone, code, and a short profile step. No scattered screens and no extra friction.",
        stages: [
          { key: "phone" as const, label: "Phone", hint: "Enter your phone or pairing code" },
          { key: "verify" as const, label: "Code", hint: "Telegram or SMS confirmation" },
          { key: "profile" as const, label: "Profile", hint: "Name, username, and optional photo" },
        ],
        flowBadges: { login: "Log in", create: "New account" },
        titles: {
          phone: "Enter your phone number",
          verify: "Verify your access",
          profile: "Finish your profile",
        },
        descriptions: {
          phone: "We send a code via Telegram or SMS. The same flow works for both returning and new users.",
          verifyTelegram: "The code arrives in Telegram. Enter it and keep going without extra steps.",
          verifySms: "Enter the six-digit SMS code to continue.",
          profile: "Name, username, and photo can be set now or later in settings.",
          pairing: "Enter the code from another device to approve this sign-in manually.",
        },
      };
  const flowStage = pairingMode === "code" ? "verify" : step === "phone" ? "phone" : step === "code" ? "verify" : "profile";
  const currentStageIndex = authUxCopy.stages.findIndex((item) => item.key === flowStage);
  const flowBadge = flowStage === "profile" || isNewAccount || isNewPhone === true ? authUxCopy.flowBadges.create : authUxCopy.flowBadges.login;
  const stageTitle = pairingMode === "code" ? t("settings.qrLogin") : authUxCopy.titles[flowStage];
  const stageDescription = pairingMode === "code"
    ? authUxCopy.descriptions.pairing
    : flowStage === "verify"
      ? (codeMethod === "telegram" ? authUxCopy.descriptions.verifyTelegram : authUxCopy.descriptions.verifySms)
      : authUxCopy.descriptions[flowStage];
  const infoCardClass = "rounded-2xl border border-slate-200/80 bg-white/60 px-4 py-3 text-sm leading-6 text-slate-600";

  return (
    <div className="auth-shell relative min-h-screen overflow-hidden px-4 py-4 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-8%] top-[-6%] h-64 w-64 rounded-full bg-sky-200/40 blur-3xl" />
        <div className="absolute bottom-[-8%] right-[-4%] h-72 w-72 rounded-full bg-blue-200/40 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full items-stretch gap-5 lg:grid-cols-[1.04fr_0.96fr]">
          <section className="auth-soft-panel hidden min-h-[40rem] flex-col justify-between rounded-[32px] p-8 lg:flex xl:p-10">
            <div className="space-y-8">
              <Link
                to="/"
                className="inline-flex items-center rounded-2xl px-2 py-1.5 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2"
                aria-label={t("landing.brand")}
              >
                <img src={LOGO_URL} alt={t("auth.logo")} className="h-14 w-auto object-contain opacity-95" />
              </Link>
              <div className="max-w-lg space-y-4">
                <span className="soft-chip inline-flex rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  {authUxCopy.eyebrow}
                </span>
                <h1 className="max-w-xl text-4xl font-semibold tracking-[-0.04em] text-slate-950 xl:text-5xl">
                  {authUxCopy.title}
                </h1>
                <p className="max-w-md text-base leading-7 text-slate-600">
                  {authUxCopy.subtitle}
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              {false && authCopy.bullets.map((bullet) => (
                <div key={bullet} className="soft-chip flex items-center gap-3 rounded-2xl px-4 py-3 text-sm text-slate-700">
                  <span className="ui-accent-strong inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white">•</span>
                  <span>{bullet}</span>
                </div>
              ))}
              {authUxCopy.stages.map((item, index) => {
                const isActive = index === currentStageIndex;
                const isDone = index < currentStageIndex;
                return (
                  <div
                    key={item.key}
                    className={`rounded-2xl border px-4 py-3 transition-colors ${
                      isActive
                        ? "border-slate-900/10 bg-white/78 shadow-[0_12px_30px_rgba(15,23,42,0.08)]"
                        : "border-white/40 bg-white/40"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${
                        isDone || isActive ? "ui-accent-strong text-white" : "bg-white text-slate-500"
                      }`}>
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">{item.hint}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="auth-glass-card relative mx-auto flex w-full max-w-[32rem] flex-col justify-center rounded-[28px] p-5 sm:p-7 lg:max-w-none lg:rounded-[32px] lg:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="space-y-3">
                <Link
                  to="/"
                  className="inline-flex items-center rounded-2xl lg:hidden"
                  aria-label={t("landing.brand")}
                >
                  <img src={LOGO_URL} alt={t("auth.logo")} className="h-12 w-auto object-contain opacity-95" />
                </Link>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                    {flowBadge}
                  </p>
                  <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                    {stageTitle}
                  </h2>
                  <p className="max-w-md text-sm leading-6 text-slate-500">
                    {stageDescription}
                  </p>
                </div>
              </div>
              <div className="soft-chip inline-flex rounded-full p-1">
                <button
                  type="button"
                  onClick={() => setLanguage("ru")}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    language === "ru" ? "ui-accent-strong text-white" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Рус
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage("en")}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    language === "en" ? "ui-accent-strong text-white" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Eng
                </button>
              </div>
            </div>

            <div className="mb-6 grid grid-cols-3 gap-2">
              {authUxCopy.stages.map((item, index) => {
                const isCurrent = index === currentStageIndex;
                const isPassed = index < currentStageIndex;
                return (
                  <div
                    key={item.key}
                    className={`rounded-2xl border px-3 py-2 text-left transition-colors ${
                      isCurrent
                        ? "border-sky-200 bg-sky-50/90"
                        : isPassed
                          ? "border-slate-200 bg-white/80"
                          : "border-slate-200/70 bg-white/45"
                    }`}
                  >
                    <p className={`text-xs font-semibold ${isCurrent || isPassed ? "text-slate-800" : "text-slate-500"}`}>{item.label}</p>
                    <p className="mt-1 text-[0.6875rem] leading-4 text-slate-400">{item.hint}</p>
                  </div>
                );
              })}
            </div>

            {refCode && isNewPhone === true && (
              <div className="mb-5 rounded-2xl border border-emerald-200/80 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-700">
                {t("auth.referralBonus")}
              </div>
            )}

            {pairingToken && pairingLoading ? (
              <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
                <p className="text-sm text-slate-500">{t("common.loading")}</p>
              </div>
            ) : pairingMode === "code" ? (
              <form onSubmit={onPairingCodeSubmit} className="space-y-5">
                <div className={infoCardClass}>
                  {t("auth.qrLoginEnterCode")}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="123456"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className={`${inputClass} text-center text-xl tracking-[0.35em]`}
                />
                {error && <p className="text-sm text-rose-500">{error}</p>}
                <div className="space-y-3">
                  <button
                    type="submit"
                    disabled={pairingLoading || pairingCode.length !== 6}
                    className={primaryButtonClass}
                  >
                    {pairingLoading ? t("common.loading") : t("auth.loginBtn")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPairingMode(null); setError(""); setPairingCode(""); }}
                    className={secondaryButtonClass}
                  >
                    {t("common.back")}
                  </button>
                </div>
              </form>
            ) : step === "phone" ? (
              <form onSubmit={phoneForm.handleSubmit(onSendCode)} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">{t("auth.phoneNumber")}</label>
                  <div className="rounded-[22px] border border-slate-200/80 bg-white/72 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
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
                  </div>
                  {phoneForm.formState.errors.phone && (
                    <p className="text-sm text-rose-500">{phoneForm.formState.errors.phone.message}</p>
                  )}
                </div>
                <div className={infoCardClass}>{t("auth.codeHint")}</div>
                {error && <p className="text-sm text-rose-500">{error}</p>}
                <div className="space-y-3">
                  <button
                    type="submit"
                    disabled={loading || sendCodeCooldown > 0}
                    className={primaryButtonClass}
                  >
                    {loading
                      ? t("auth.sending")
                      : sendCodeCooldown > 0
                        ? t("auth.retryInSeconds").replace("%s", String(sendCodeCooldown))
                        : t("auth.sendCode")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPairingMode("code")}
                    className={secondaryButtonClass}
                  >
                    {t("settings.qrLogin")}
                  </button>
                </div>
              </form>
            ) : step === "username" ? (
              <form onSubmit={usernameForm.handleSubmit(onSetUsername)} className="space-y-5">
                <div className={infoCardClass}>
                  <span>{t("auth.verifiedPhone")}: </span>
                  <span className="font-medium text-slate-900">{phone || existingUser?.phone || "—"}</span>
                  <button
                    type="button"
                    onClick={() => { setStep("phone"); setError(""); }}
                    className="ml-2 font-medium text-sky-700 transition-colors hover:text-sky-800"
                  >
                    {t("auth.changeNumber")}
                  </button>
                </div>
                <div className="flex items-start gap-4">
                  <label className="cursor-pointer shrink-0" title={t("auth.addAvatar")}>
                    <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarChange} />
                    <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-dashed border-slate-300 bg-white/70 text-center text-[0.625rem] font-medium text-slate-400 transition-colors hover:border-sky-300">
                      {avatarPreview ? (
                        <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                      ) : (
                        t("auth.photoPlaceholder")
                      )}
                    </span>
                  </label>
                  <div className="min-w-0 flex-1">
                    <label className="mb-2 block text-sm font-medium text-slate-700">{t("auth.nameLabel")}</label>
                    <input
                      type="text"
                      autoComplete="name"
                      placeholder={t("auth.howToAddress")}
                      className={inputClass}
                      {...usernameForm.register("display_name")}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">{t("auth.usernameLabel")}</label>
                  <div className={`flex items-center overflow-hidden rounded-2xl border bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-[border-color,box-shadow,background-color] focus-within:bg-white focus-within:ring-4 ${usernameForm.formState.errors.username ? "border-rose-300 focus-within:ring-rose-100" : "border-slate-200 focus-within:border-sky-300 focus-within:ring-sky-100"}`}>
                    <span className="select-none border-r border-slate-200 bg-slate-50/80 px-4 py-3 text-base font-medium text-slate-500">@</span>
                    <input
                      type="text"
                      autoComplete="username"
                      placeholder="ivan_petrov"
                      className="min-w-0 flex-1 border-0 bg-transparent px-4 py-3 text-sm lowercase text-slate-800 focus:outline-none focus:ring-0"
                      {...usernameForm.register("username", {
                        onChange: (e) => checkUsernameAvailability(e.target.value),
                      })}
                    />
                  </div>
                  <p className="text-xs leading-5 text-slate-400">{t("auth.usernameRules")}</p>
                  {usernameForm.formState.errors.username && (
                    <p className="text-sm text-rose-500">{usernameForm.formState.errors.username.message}</p>
                  )}
                  {!usernameForm.formState.errors.username && usernameStatus === "checking" && (
                    <p className="text-xs text-slate-400">{t("auth.usernameChecking")}</p>
                  )}
                  {!usernameForm.formState.errors.username && usernameStatus === "available" && (
                    <p className="text-xs text-emerald-600">{t("auth.usernameAvailable")}</p>
                  )}
                  {!usernameForm.formState.errors.username && usernameStatus === "taken" && (
                    <p className="text-xs text-rose-500">{usernameDetail || t("auth.usernameTakenLive")}</p>
                  )}
                </div>
                {error && <p className="text-sm text-rose-500">{error}</p>}
                <div className="space-y-3">
                  <button
                    type="submit"
                    disabled={loading || usernameStatus === "taken" || usernameStatus === "checking"}
                    className={primaryButtonClass}
                  >
                    {loading ? t("auth.saving") : t("auth.continue")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStep("phone"); setError(""); }}
                    className={secondaryButtonClass}
                  >
                    {t("common.back")}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={codeForm.handleSubmit(onVerifyCode)} className="space-y-5">
                <div className={infoCardClass}>
                  {codeMethod === "telegram" ? (
                    <>{t("auth.codeSentTelegram")} {phone} ({t("auth.codeSentTelegramFrom")} <strong>@VerificationCodes</strong>)</>
                  ) : (
                    <>{t("auth.codeSentSms")} {phone}</>
                  )}
                  <button
                    type="button"
                    onClick={() => { setStep("phone"); setError(""); setIsNewPhone(null); }}
                    className="ml-2 font-medium text-sky-700 transition-colors hover:text-sky-800"
                  >
                    {t("auth.changePhone")}
                  </button>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    {codeMethod === "telegram" ? t("auth.codeFromTelegram") : t("auth.codeFromSms")}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    className={`${inputClass} text-center text-xl tracking-[0.35em] ${codeForm.formState.errors.code ? "!border-rose-300 !ring-rose-100" : ""}`}
                    {...codeForm.register("code", {
                      onChange: (e) => {
                        if (e.target.value.length === 6 && !loading) {
                          setTimeout(() => codeForm.handleSubmit(onVerifyCode)(), 0);
                        }
                      },
                    })}
                  />
                  {codeForm.formState.errors.code && (
                    <p className="text-sm text-rose-500">{codeForm.formState.errors.code.message}</p>
                  )}
                </div>
                {error && <p className="text-sm text-rose-500">{error}</p>}
                <div className="space-y-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className={primaryButtonClass}
                  >
                    {loading ? t("auth.checking") : t("auth.loginBtn")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStep("phone"); setError(""); setIsNewPhone(null); codeForm.reset({ code: "" }); }}
                    className={secondaryButtonClass}
                  >
                    {t("common.back")}
                  </button>
                </div>
              </form>
            )}
          </section>
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
          <div className="auth-glass-card w-full max-w-sm rounded-[28px] p-6 shadow-[0_28px_80px_rgba(15,23,42,0.24)]">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-sky-700">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"/>
                <path d="M10 17a2 2 0 0 0 4 0"/>
              </svg>
            </div>
            <p id="notify-modal-title" className="mb-2 text-xl font-semibold text-slate-900">
              {t("settings.notifications")}
            </p>
            <p className="mb-5 text-sm leading-6 text-slate-500">
              {t("auth.notifyPromptBody")}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onEnableNotifications}
                className="ui-accent-strong flex-1 rounded-2xl px-4 py-3 text-sm font-medium text-white transition-colors"
              >
                {t("auth.notifyEnable")}
              </button>
              <button
                type="button"
                onClick={closeNotifyModalAndNavigate}
                className="flex-1 rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-white"
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
