import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { authApi } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useTranslation } from "../lib/i18n";
import logoUrl from "../../../ТЕЛЕГА.ico?url";

type PhoneForm = { phone: string };
type CodeForm = { code: string };
type UsernameForm = { username: string; display_name?: string };

export default function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref") || "";

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
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"phone" | "code" | "username">("phone");
  const [codeMethod, setCodeMethod] = useState<"sms" | "telegram" | "">("");
  const [preferredMethod, setPreferredMethod] = useState<"telegram" | "sms">("telegram");
  const [isNewAccount, setIsNewAccount] = useState(false);
  const [isNewPhone, setIsNewPhone] = useState<boolean | null>(null); // null = not yet checked

  // If already authenticated but missing username, skip straight to username step
  useEffect(() => {
    if (isAuthenticated && existingUser && !existingUser.username) {
      setIsNewAccount(true);
      setStep("username");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const phoneForm = useForm<PhoneForm>({ resolver: zodResolver(phoneSchema), defaultValues: { phone: "" } });
  const codeForm = useForm<CodeForm>({ resolver: zodResolver(codeSchema), defaultValues: { code: "" } });
  const usernameForm = useForm<UsernameForm>({
    resolver: zodResolver(usernameSchema),
    defaultValues: { username: "", display_name: "" },
  });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

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
      const res = await authApi.sendCode(data.phone, preferredMethod === "sms" ? "sms" : undefined);
      setPhone(data.phone);
      setStep("code");
      const resData = res.data as { method?: string; is_new?: boolean };
      setCodeMethod(resData.method === "telegram" ? "telegram" : "sms");
      setIsNewPhone(resData.is_new ?? null);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const nextUrl = searchParams.get("next");
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

  const onAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    if (!file) {
      setAvatarFile(null);
      setAvatarPreview(null);
      return;
    }
    if (!file.type.startsWith("image/")) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
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
      const target = nextUrl && nextUrl.startsWith("/") ? nextUrl : "/chats";
      navigate(target, { replace: true });
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("auth.usernameTaken")
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 p-4">
      <div className="absolute left-4 top-4">
        <img src={logoUrl} alt={t("auth.logo")} className="h-8 w-8 object-contain" />
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

        {step === "phone" ? (
          <form onSubmit={phoneForm.handleSubmit(onSendCode)} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("auth.phoneNumber")}</label>
              <input
                type="tel"
                placeholder="+7 999 123-45-67"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                {...phoneForm.register("phone")}
              />
              {phoneForm.formState.errors.phone && (
                <p className="text-red-500 text-sm mt-1">{phoneForm.formState.errors.phone.message}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">{t("auth.codeDeliveryMethod")}</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPreferredMethod("telegram")}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    preferredMethod === "telegram" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Telegram
                </button>
                <button
                  type="button"
                  onClick={() => setPreferredMethod("sms")}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    preferredMethod === "sms" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  SMS
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              {t("auth.codeHint")}
            </p>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? t("auth.sending") : t("auth.sendCode")}
            </button>
          </form>
        ) : step === "username" ? (
          <form onSubmit={usernameForm.handleSubmit(onSetUsername)} className="space-y-4">
            <p className="text-sm text-gray-600 mb-4">
              {t("auth.usernameHint")}
            </p>
            <div className="flex gap-4 items-start mb-4">
              <label className="cursor-pointer shrink-0" title={t("auth.addAvatar")}>
                <input type="file" accept="image/*" className="hidden" onChange={onAvatarChange} />
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
              <input
                type="text"
                autoComplete="username"
                placeholder="ivan_petrov"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent lowercase"
                {...usernameForm.register("username", {
                  onChange: (e) => checkUsernameAvailability(e.target.value),
                })}
              />
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                {...codeForm.register("code")}
              />
              {codeForm.formState.errors.code && (
                <p className="text-red-500 text-sm mt-1">{codeForm.formState.errors.code.message}</p>
              )}
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            {codeMethod === "telegram" && (
              <p className="text-sm text-gray-500">
                {t("auth.didntReceiveCode")}{" "}
                <button
                  type="button"
                  onClick={async () => {
                    setError("");
                    setLoading(true);
                    try {
                      const res = await authApi.sendCode(phone, "sms");
                      setCodeMethod((res.data as { method?: string }).method === "sms" ? "sms" : "telegram");
                    } catch (e: unknown) {
                      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("common.error"));
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="text-blue-600 hover:underline disabled:opacity-50"
                >
                  {t("auth.sendViaSms")}
                </button>
              </p>
            )}
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
    </div>
  );
}
