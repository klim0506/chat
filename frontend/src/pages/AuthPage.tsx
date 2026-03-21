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
import { ModalViewportLayer } from "../components/TopLayerPortal";

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
  const [isNewPhone, setIsNewPhone] = useState<boolean | null>(null); // null = not yet checked
  const [, setDeliveryInfo] = useState("");
  const [telegramRequesting, setTelegramRequesting] = useState(false);
  const [pairingMode, setPairingMode] = useState<"code" | null>(null); // "code" = show manual code input
  const [pairingCode, setPairingCode] = useState("");
  const [pairingLoading, setPairingLoading] = useState(false);
  /** Seconds left before "Get code" can be requested again (429 throttle). */
  const [sendCodeCooldown, setSendCodeCooldown] = useState(0);
  /** Сколько раз уже отправили код на этот номер в текущей сессии (1 — после телефона, 2 — после 1-го «в Telegram», 3 — после 2-го). */
  const [codeSendCount, setCodeSendCount] = useState(0);
  /** Секунды до следующей повторной отправки под кнопкой «Войти»: после 1-го кода — 60 с, перед 3-м — 180 с после 2-го. */
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
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

  useEffect(() => {
    if (resendCooldownSec <= 0) return;
    const id = setInterval(() => {
      setResendCooldownSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [resendCooldownSec]);

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
  const codeInputRef = useRef<HTMLInputElement>(null);
  const { ref: codeRegisterRef, ...codeFieldProps } = codeForm.register("code", {
    onChange: (e) => {
      const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, 6);
      if (digitsOnly !== e.target.value) {
        e.target.value = digitsOnly;
      }
      codeForm.setValue("code", digitsOnly, {
        shouldDirty: true,
        shouldValidate: digitsOnly.length === 6,
      });
    },
  });
  const pairingInputRef = useRef<HTMLInputElement>(null);

  // Live username availability check
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [usernameDetail, setUsernameDetail] = useState("");
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedRef = useRef("");
  const protectedUsernames = new Set(["pingy", "support", "admin", "security", "news", "help"]);

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
    if (protectedUsernames.has(trimmed)) {
      setUsernameStatus("taken");
      setUsernameDetail(
        language === "ru"
          ? "Этот юзернейм защищён. Для его активации свяжитесь с аккаунтом @pingy в Pingy."
          : "This username is protected. To activate it, contact @pingy in Pingy."
      );
      lastCheckedRef.current = trimmed;
      return;
    }
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
  }, [language]);

  const onSendCode = async (data: PhoneForm) => {
    const submittedPhone = data.phone;
    setError("");
    setDeliveryInfo("");
    setLoading(true);
    try {
      const res = await authApi.sendCode(data.phone, "telegram");
      // #region agent log
      fetch("http://localhost:7918/ingest/77362a67-2cd9-4f4e-9a91-df1884063ee5", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d69873" },
        body: JSON.stringify({
          sessionId: "d69873",
          location: "AuthPage.tsx:onSendCode",
          message: "send_code_ok",
          data: {
            hypothesisId: "FE1",
            phoneLen: data.phone.length,
            phoneSuffix: data.phone.slice(-4),
            status: res.status,
            method: (res.data as { method?: string })?.method,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setPhone(data.phone);
      setStep("code");
      setCodeSendCount(1);
      setResendCooldownSec(60);
      const resData = res.data as { detail?: string; method?: string; is_new?: boolean };
      setIsNewPhone(resData.is_new ?? null);
      setDeliveryInfo(resData.detail || "");
    } catch (e: unknown) {
      const err = e as {
        response?: { status?: number; data?: { detail?: string; wait?: number } };
        code?: string;
      };
      const errData = err?.response?.data;
      const statusCode = err?.response?.status;
      // #region agent log
      fetch("http://localhost:7918/ingest/77362a67-2cd9-4f4e-9a91-df1884063ee5", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d69873" },
        body: JSON.stringify({
          sessionId: "d69873",
          location: "AuthPage.tsx:onSendCode",
          message: "send_code_err",
          data: {
            hypothesisId: "FE1",
            phoneLen: submittedPhone.length,
            hasResponse: Boolean(err?.response),
            status: statusCode,
            detailPrefix: typeof errData?.detail === "string" ? errData.detail.slice(0, 80) : "",
            isAxiosTimeout: err?.code === "ECONNABORTED",
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      const fallbackMessage = t("auth.sendCodeFailed");
      if (statusCode === 429) {
        setError("");
      } else {
        setError((errData?.detail && String(errData.detail).trim()) || fallbackMessage);
      }
      if (statusCode === 429 && typeof errData?.wait === "number" && errData.wait > 0) {
        setSendCodeCooldown(errData.wait);
      }
    } finally {
      setLoading(false);
    }
  };

  const onRequestCodeVia = async (method: "telegram" | "sms" | "pingy") => {
    if (!phone) return;
    if (codeSendCount >= 3 || resendCooldownSec > 0) return;
    setError("");
    setDeliveryInfo("");
    setTelegramRequesting(true);
    try {
      const res = await authApi.sendCode(phone, method, true);
      const resData = res.data as { detail?: string; method?: string };
      setDeliveryInfo(resData.detail || "");
      codeForm.reset({ code: "" });
      setCodeSendCount((c) => {
        const next = c + 1;
        if (next === 2) setResendCooldownSec(180);
        return next;
      });
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { detail?: string; wait?: number } } };
      const data = err?.response?.data;
      const statusCode = err?.response?.status;
      setError(data?.detail || t("common.error"));
      if (statusCode === 429 && typeof data?.wait === "number" && data.wait > 0) {
        setResendCooldownSec((s) => Math.max(s, data.wait!));
      }
    } finally {
      setTelegramRequesting(false);
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
    // #region agent log
    fetch("http://localhost:7918/ingest/77362a67-2cd9-4f4e-9a91-df1884063ee5", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d69873" },
      body: JSON.stringify({
        sessionId: "d69873",
        location: "AuthPage.tsx:onVerifyCode",
        message: "verify_attempt",
        data: {
          hypothesisId: "FE2",
          phoneStateLen: phone.length,
          phoneSuffix: phone.slice(-4),
          codeLen: data.code.length,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    try {
      const res = await authApi.verifyCode(phone, data.code, isNewPhone !== false ? (refCode || undefined) : undefined);
      setTokens(res.data.access, res.data.refresh, res.data.user);
      if (res.data.user && !res.data.user.username) {
        setStep("username");
      } else {
        const target = nextUrl && nextUrl.startsWith("/") ? nextUrl : "/chats";
        navigate(target, { replace: true });
      }
    } catch (e: unknown) {
      const ve = e as { response?: { status?: number; data?: { detail?: string } } };
      // #region agent log
      fetch("http://localhost:7918/ingest/77362a67-2cd9-4f4e-9a91-df1884063ee5", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d69873" },
        body: JSON.stringify({
          sessionId: "d69873",
          location: "AuthPage.tsx:onVerifyCode",
          message: "verify_err",
          data: {
            hypothesisId: "FE2",
            status: ve.response?.status,
            detail: typeof ve.response?.data?.detail === "string" ? ve.response.data.detail.slice(0, 120) : "",
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setError(ve.response?.data?.detail || t("auth.invalidCode"));
    } finally {
      setLoading(false);
    }
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

  const renderCodeCells = (value: string, activeIndex: number, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full grid-cols-6 gap-2 text-center focus:outline-none sm:gap-3"
      aria-label={language === "ru" ? "Введите код подтверждения" : "Enter confirmation code"}
    >
      {Array.from({ length: 6 }, (_, index) => {
        const digit = value[index] ?? "";
        const isActive = activeIndex === index || (index === value.length && value.length < 6);
        return (
          <span
            key={index}
            className={`flex h-14 items-center justify-center rounded-2xl border bg-white text-2xl font-semibold tabular-nums transition-[border-color,box-shadow,color] sm:h-16 sm:text-3xl ${
              digit
                ? "border-sky-300 text-slate-950 shadow-[0_10px_30px_rgba(125,211,252,0.18)]"
                : "border-slate-200 text-slate-300"
            } ${isActive ? "ring-4 ring-sky-100" : ""}`}
          >
            {digit || "\u00A0"}
          </span>
        );
      })}
    </button>
  );

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
  const inputClass = "ui-field-shell w-full rounded-2xl px-4 py-3 text-sm text-slate-800 transition-[border-color,box-shadow,background-color] focus:border-sky-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-100";
  const authUxCopy = language === "ru"
    ? {
        eyebrow: "Pingy access flow",
        title: "Один спокойный вход для возвращения и регистрации.",
        subtitle: "Номер, код и короткая настройка профиля. Без разрозненных экранов и лишних решений.",
        stages: [
          { key: "phone" as const, label: "Номер", hint: "Введите телефон или код входа" },
          { key: "verify" as const, label: "Код", hint: "Подтверждение через Telegram" },
          { key: "profile" as const, label: "Профиль", hint: "Имя, username и фото по желанию" },
        ],
        flowBadges: { login: "Вход", create: "Новый аккаунт" },
        titles: {
          phone: "Введите номер телефона",
          verify: "Подтвердите вход",
          profile: "Создайте аккаунт",
        },
        descriptions: {
          phone: "Код входа приходит в Telegram.",
          // verifyPingy: "Мы отправили сообщение на другое устройство с Pingy. Если удобнее, ниже можно запросить это же сообщение в Telegram.",
          verifyTelegram: "Код придёт в Telegram. Введите его и продолжайте без лишних шагов.",
          // verifySms: "Введите шестизначный код из SMS, чтобы продолжить.",
          profile: "",
          pairing: "Введите код с другого устройства, чтобы подтвердить вход вручную.",
        },
      }
    : {
        eyebrow: "Pingy access flow",
        title: "One calm flow for sign-in and signup.",
        subtitle: "Phone, code, and a short profile step. No scattered screens and no extra friction.",
        stages: [
          { key: "phone" as const, label: "Phone", hint: "Enter your phone or pairing code" },
          { key: "verify" as const, label: "Code", hint: "Telegram confirmation" },
          { key: "profile" as const, label: "Profile", hint: "Name, username, and optional photo" },
        ],
        flowBadges: { login: "Log in", create: "New account" },
        titles: {
          phone: "Enter your phone number",
          verify: "Verify your access",
          profile: "Create account",
        },
        descriptions: {
          phone: "The login code is sent to Telegram.",
          // verifyPingy: "We sent a message to your other active Pingy device. If you prefer, you can request the same code in Telegram below.",
          verifyTelegram: "The code arrives in Telegram. Enter it and keep going without extra steps.",
          // verifySms: "Enter the six-digit SMS code to continue.",
          profile: "",
          pairing: "Enter the code from another device to approve this sign-in manually.",
        },
      };
  const flowStage = pairingMode === "code" ? "verify" : step === "phone" ? "phone" : step === "code" ? "verify" : "profile";
  const currentStageIndex = authUxCopy.stages.findIndex((item) => item.key === flowStage);
  const stageTitle = pairingMode === "code" ? t("settings.qrLogin") : authUxCopy.titles[flowStage];
  const stageDescription = pairingMode === "code"
    ? authUxCopy.descriptions.pairing
    : flowStage === "verify"
      ? ""
      : authUxCopy.descriptions[flowStage];
  return (
    <div className="auth-shell relative min-h-screen overflow-hidden px-4 py-4 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-8%] top-[-6%] h-64 w-64 rounded-full bg-sky-200/40 blur-3xl" />
        <div className="absolute bottom-[-8%] right-[-4%] h-72 w-72 rounded-full bg-blue-200/40 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-3xl items-center justify-center">
        <div className="grid w-full items-stretch gap-5">
          <section className="hidden">
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

          <section className={`auth-glass-card relative mx-auto flex w-full max-w-[34rem] flex-col justify-center rounded-[28px] p-5 sm:p-7 lg:rounded-[32px] lg:p-8 ${
            step === "phone" || step === "code" ? "min-h-[24rem]" : ""
          }`}>
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-3">
                <Link
                  to="/"
                  className="inline-flex items-center rounded-2xl"
                  aria-label={t("landing.brand")}
                >
                  <img src={LOGO_URL} alt={t("auth.logo")} className="h-12 w-auto object-contain opacity-95" />
                </Link>
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                    {stageTitle}
                  </h2>
                  {stageDescription && (
                    <p className="max-w-md text-sm leading-6 text-slate-500">
                      {stageDescription}
                    </p>
                  )}
                  {step === "username" && (
                    <p className="pt-1 text-sm leading-5 text-slate-500">
                      {language === "ru" ? `Аккаунт создаётся для номера ${phone || existingUser?.phone || "—"}` : `Creating account for ${phone || existingUser?.phone || "—"}`}
                    </p>
                  )}
                  {step === "code" && (
                    <div className="flex min-w-0 items-baseline gap-2 pt-2 text-sm leading-6 text-slate-600 whitespace-nowrap">
                      <span>
                        {language === "ru"
                          ? "Отправили сообщение в Telegram на номер"
                          : "Sent a message to Telegram for number"}
                      </span>
                      <span className="font-medium text-slate-900">{phone}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setStep("phone");
                          setError("");
                          setDeliveryInfo("");
                          setIsNewPhone(null);
                          setCodeSendCount(0);
                          setResendCooldownSec(0);
                          codeForm.reset({ code: "" });
                        }}
                        className="font-medium text-sky-700 transition-colors hover:text-sky-800"
                      >
                        {t("auth.changeNumber")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="soft-chip inline-flex shrink-0 rounded-full p-1 self-start">
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
              <form onSubmit={onPairingCodeSubmit} className="space-y-6">
                <div className="space-y-4 text-center">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/85 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                    <img src={LOGO_URL} alt="" className="h-10 w-auto object-contain" />
                  </div>
                  <p className="text-sm text-slate-500">{language === "ru" ? "Введите код подтверждения с другого устройства." : "Enter the confirmation code from another device."}</p>
                </div>
                <input
                  ref={pairingInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="sr-only"
                  autoFocus
                />
                {renderCodeCells(pairingCode, pairingCode.length, () => pairingInputRef.current?.focus())}
                {error && step !== "code" && <p className="text-sm text-rose-500">{error}</p>}
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
                    className="mx-auto block text-sm font-medium text-sky-700 underline-offset-4 transition-colors hover:text-sky-800 hover:underline"
                  >
                    {t("auth.changeNumber")}
                  </button>
                </div>
              </form>
            ) : step === "phone" ? (
              <form onSubmit={phoneForm.handleSubmit(onSendCode)} className="space-y-6">
                <div className="space-y-2">
                  <div className="rounded-[22px] bg-white/40 p-1.5">
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
                    className="mx-auto block text-sm font-medium text-sky-700 underline-offset-4 transition-colors hover:text-sky-800 hover:underline"
                  >
                    {t("settings.qrLogin")}
                  </button>
                </div>
              </form>
            ) : step === "username" ? (
              <form onSubmit={usernameForm.handleSubmit(onSetUsername)} className="space-y-4">
                <div className="space-y-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">{t("auth.nameLabel")}</label>
                    <input
                      type="text"
                      autoComplete="name"
                      placeholder={language === "ru" ? "Это имя будет видно другим в pingy" : "This name will be visible to others in Pingy"}
                      className={inputClass}
                      {...usernameForm.register("display_name")}
                    />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">{t("auth.usernameLabel")}</label>
                  <div className={`ui-field-shell flex items-center overflow-hidden rounded-2xl border transition-[border-color,box-shadow,background-color] focus-within:bg-white focus-within:ring-4 ${
                    usernameForm.formState.errors.username || usernameStatus === "taken"
                      ? "border-rose-300 focus-within:ring-sky-100"
                      : usernameStatus === "available"
                        ? "border-emerald-300 focus-within:ring-sky-100"
                        : "focus-within:border-sky-300 focus-within:ring-sky-100"
                  }`}>
                    <span className={`select-none border-r px-4 py-3 text-base font-medium ${
                      usernameForm.formState.errors.username || usernameStatus === "taken"
                        ? "border-slate-200 bg-slate-50/80 text-slate-500"
                        : usernameStatus === "available"
                          ? "border-slate-200 bg-slate-50/80 text-slate-500"
                          : "border-slate-200 bg-slate-50/80 text-slate-500"
                    }`}>@</span>
                    <input
                      type="text"
                      autoComplete="username"
                      placeholder="pingy"
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
                    {loading ? t("auth.saving") : (language === "ru" ? "Создать аккаунт" : "Create account")}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={codeForm.handleSubmit(onVerifyCode)} className="space-y-6">
                <div className="space-y-2">
                  <div className="rounded-[22px] bg-white/40 p-1.5">
                    <div className={`ui-field-shell flex overflow-hidden rounded-[18px] border transition-[border-color,box-shadow,background-color] focus-within:bg-white focus-within:ring-4 ${codeForm.formState.errors.code || error ? "border-rose-300 focus-within:ring-rose-100" : "focus-within:border-sky-300 focus-within:ring-sky-100"}`}>
                      <div className="ui-picker-tile flex min-w-0 items-center gap-2 rounded-none border-r border-slate-200 px-5 py-3 text-left">
                        <span className="text-base font-medium text-slate-700 sm:text-lg">
                          {language === "ru" ? "Код" : "Code"}
                        </span>
                      </div>
                      <input
                        ref={(node) => {
                          (codeInputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
                          codeRegisterRef(node);
                        }}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="123456"
                        autoFocus
                        className="min-w-0 flex-1 border-0 bg-transparent px-4 py-3 text-base font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0 sm:text-lg"
                        {...codeFieldProps}
                      />
                    </div>
                  </div>
                  {codeForm.formState.errors.code && (
                    <p className="text-sm text-rose-500">{codeForm.formState.errors.code.message}</p>
                  )}
                </div>
                <div className="space-y-3">
                  <button
                    type="submit"
                    disabled={loading || telegramRequesting || (codeForm.watch("code")?.length ?? 0) !== 6}
                    className={primaryButtonClass}
                  >
                    {loading ? t("auth.checking") : t("auth.loginBtn")}
                  </button>
                  <p className="text-center text-sm text-slate-500">
                    {telegramRequesting ? (
                      t("auth.sending")
                    ) : codeSendCount >= 3 ? (
                      <span className="text-slate-400">
                        {language === "ru"
                          ? "Достигнут лимит повторных отправок кода"
                          : "Maximum number of code requests reached"}
                      </span>
                    ) : resendCooldownSec > 0 ? (
                      <span className="text-slate-400">
                        {language === "ru"
                          ? `Отправить снова через ${resendCooldownSec} сек.`
                          : `Send again in ${resendCooldownSec} sec.`}
                      </span>
                    ) : (
                      <>
                        {/*
                        <button
                          type="button"
                          onClick={() => onRequestCodeVia("pingy")}
                          disabled={loading}
                          className="font-medium text-sky-700 underline-offset-4 transition-colors hover:text-sky-800 hover:underline"
                        >
                          {language === "ru" ? "Отправить в Pingy" : "Send to Pingy"}
                        </button>
                        {" · "}
                        */}
                        <button
                          type="button"
                          onClick={() => onRequestCodeVia("telegram")}
                          disabled={loading || resendCooldownSec > 0 || codeSendCount >= 3}
                          className="font-medium text-sky-700 underline-offset-4 transition-colors hover:text-sky-800 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                        >
                          {language === "ru" ? "Отправить в Telegram" : "Send to Telegram"}
                        </button>
                        {/*
                        {" · "}
                        <button
                          type="button"
                          onClick={() => onRequestCodeVia("sms")}
                          disabled={loading}
                          className="font-medium text-sky-700 underline-offset-4 transition-colors hover:text-sky-800 hover:underline"
                        >
                          {language === "ru" ? "Отправить по SMS" : "Send via SMS"}
                        </button>
                        */}
                      </>
                    )}
                  </p>
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
        <ModalViewportLayer>
          <div className="auth-glass-card w-full max-w-sm rounded-[28px] p-6 shadow-[0_28px_80px_rgba(15,23,42,0.24)]" role="dialog" aria-modal="true" aria-labelledby="notify-modal-title" onClick={(e) => e.stopPropagation()}>
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
        </ModalViewportLayer>
      )}
    </div>
  );
}


