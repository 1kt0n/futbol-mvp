import { useEffect, useMemo, useState } from "react";
import Card from "../../design/ui/Card.jsx";
import { cn } from "../../design/cn.js";
import InlineError from "./InlineError.jsx";

function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    function onBeforeInstallPrompt(event) {
      event.preventDefault();
      setDeferredPrompt(event);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  async function promptInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  return { canInstall: !!deferredPrompt, promptInstall };
}

export function InstallPwaButton({ className = "" }) {
  const { canInstall, promptInstall } = useInstallPrompt();
  if (!canInstall) return null;
  return (
    <button type="button" onClick={promptInstall} className={cn("focus-ring rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/30", className)}>
      Instalar app
    </button>
  );
}

const STEP_LABELS = ["Modo", "Celular", "PIN", "Perfil"];
const STEP_KEYS_LOGIN = ["mode", "phone", "pin"];
const STEP_KEYS_REGISTER = ["mode", "phone", "pin", "profile"];

function StepIndicator({ step, loginMode }) {
  const steps = loginMode === "register" ? STEP_KEYS_REGISTER : STEP_KEYS_LOGIN;
  const currentIdx = steps.indexOf(step);

  return (
    <div className="flex items-center justify-center gap-1.5">
      {steps.map((s, i) => (
        <div
          key={s}
          className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            i === currentIdx ? "w-6 bg-emerald-400" : i < currentIdx ? "w-3 bg-emerald-400/40" : "w-3 bg-white/15"
          )}
        />
      ))}
    </div>
  );
}

function Slide({ show, children }) {
  if (!show) {
    return (
      <div className="hidden" aria-hidden="true">
        {children}
      </div>
    );
  }

  return (
    <div className={cn("transition-all duration-200", "translate-x-0 opacity-100")}>
      {children}
    </div>
  );
}

export default function AuthFlowCard({
  busy,
  err,
  clearError,
  loginMode,
  setLoginMode,
  phone,
  setPhone,
  pin,
  setPin,
  fullName,
  setFullName,
  onLogin,
  onRegister,
  actorDraft,
  setActorDraft,
  onSaveActor,
  showDebug = false,
}) {
  const [step, setStep] = useState("mode");

  const title = useMemo(() => {
    if (step === "mode") return "Bienvenido";
    if (step === "phone") return loginMode === "login" ? "Tu celular" : "Registra tu celular";
    if (step === "pin") return loginMode === "login" ? "Tu PIN" : "Crea un PIN";
    return "Tu perfil";
  }, [step, loginMode]);

  const subtitle = useMemo(() => {
    if (step === "mode") return "Ingresa o crea tu cuenta para continuar.";
    if (step === "phone") return "Ingresa tu numero de celular.";
    if (step === "pin") return loginMode === "login" ? "Ingresa tu PIN de acceso." : "Elegí un PIN de 4 o 6 dígitos.";
    return "Completa tus datos para crear tu cuenta.";
  }, [step, loginMode]);

  useEffect(() => {
    clearError?.();
  }, [step, loginMode, clearError]);

  function goBack() {
    if (step === "phone") setStep("mode");
    else if (step === "pin") setStep("phone");
    else if (step === "profile") setStep("pin");
  }

  async function submitPinStep() {
    if (loginMode === "login") {
      await onLogin();
      return;
    }
    setStep("profile");
  }

  return (
    <Card className="relative overflow-hidden p-6">
      {/* Step indicator */}
      {step !== "mode" && (
        <div className="mb-5">
          <StepIndicator step={step} loginMode={loginMode} />
        </div>
      )}

      {/* Header */}
      <div className="mb-5 text-center">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-white/50">{subtitle}</p>
      </div>

      <div className="relative">
        {/* ── Step: Mode ── */}
        <Slide show={step === "mode"}>
          <div className="space-y-3">
            <button
              onClick={() => { setLoginMode("login"); setStep("phone"); }}
              data-testid="auth-login-mode-btn"
              className="focus-ring w-full rounded-2xl bg-emerald-500 px-4 py-3.5 text-sm font-semibold text-black transition-colors hover:bg-emerald-400"
            >
              Ingresar
            </button>
            <button
              onClick={() => { setLoginMode("register"); setStep("phone"); }}
              data-testid="auth-register-mode-btn"
              className="focus-ring w-full rounded-2xl border border-white/20 bg-white/5 px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Crear cuenta
            </button>
          </div>
          <InstallPwaButton className="mt-4 w-full" />
        </Slide>

        {/* ── Step: Phone ── */}
        <Slide show={step === "phone"}>
          <div className="space-y-4">
            <div>
              <label htmlFor="auth-phone-input" className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Celular
              </label>
              <input
                id="auth-phone-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ej: 1122334455"
                inputMode="tel"
                autoFocus
                data-testid="auth-phone-input"
                className="focus-ring mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-base text-white placeholder:text-white/25"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="auth-back-btn"
                onClick={goBack}
                className="focus-ring rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm transition-colors hover:bg-white/10"
              >
                Atras
              </button>
              <button
                type="button"
                data-testid="auth-phone-next-btn"
                onClick={() => setStep("pin")}
                disabled={!phone.trim()}
                className="focus-ring flex-1 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-emerald-400 disabled:opacity-40"
              >
                Continuar
              </button>
            </div>
          </div>
        </Slide>

        {/* ── Step: PIN ── */}
        <Slide show={step === "pin"}>
          <div className="space-y-4">
            <div>
              <label htmlFor="auth-pin-input" className="text-xs font-semibold uppercase tracking-wide text-white/50">
                PIN (4 o 6 dígitos)
              </label>
              <input
                id="auth-pin-input"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D+/g, "").slice(0, 6))}
                placeholder="••••"
                inputMode="numeric"
                autoFocus
                data-testid="auth-pin-input"
                className="focus-ring mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-base tracking-[0.3em] text-white placeholder:text-white/25"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="auth-back-btn"
                onClick={goBack}
                className="focus-ring rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm transition-colors hover:bg-white/10"
              >
                Atras
              </button>
              <button
                type="button"
                data-testid={loginMode === "login" ? "auth-login-submit" : "auth-register-next-btn"}
                onClick={submitPinStep}
                disabled={busy || !(/^\d{4}$|^\d{6}$/.test(pin.trim()))}
                className="focus-ring flex-1 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-emerald-400 disabled:opacity-40"
              >
                {busy ? "Validando..." : loginMode === "login" ? "Entrar" : "Continuar"}
              </button>
            </div>
          </div>
        </Slide>

        {/* ── Step: Profile (register only) ── */}
        <Slide show={step === "profile"}>
          <div className="space-y-4">
            <div>
              <label htmlFor="auth-full-name-input" className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Nombre y apellido
              </label>
              <input
                id="auth-full-name-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ej: Juan Pérez"
                autoFocus
                data-testid="auth-full-name-input"
                className="focus-ring mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-base text-white placeholder:text-white/25"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="auth-back-btn"
                onClick={goBack}
                className="focus-ring rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm transition-colors hover:bg-white/10"
              >
                Atras
              </button>
              <button
                type="button"
                data-testid="auth-register-submit"
                onClick={onRegister}
                disabled={busy || fullName.trim().length < 3 || !phone.trim() || !(/^\d{4}$|^\d{6}$/.test(pin.trim()))}
                className="focus-ring flex-1 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-emerald-400 disabled:opacity-40"
              >
                {busy ? "Creando cuenta..." : "Crear y entrar"}
              </button>
            </div>
          </div>
        </Slide>
      </div>

      <div className="mt-4"><InlineError>{err}</InlineError></div>

      {/* Debug section — hidden by default, revealed by tapping logo 5 times */}
      {showDebug && (
        <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-300/70">Debug (Actor ID manual)</div>
          <div className="mt-1 text-xs text-white/40">Pega el Actor ID para ingresar directamente.</div>
          <input
            value={actorDraft}
            onChange={(e) => setActorDraft(e.target.value)}
            placeholder="UUID actor..."
            className="focus-ring mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-white/30"
          />
          <button
            onClick={onSaveActor}
            disabled={busy || actorDraft.trim().length === 0}
            className="focus-ring mt-3 w-full rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-40"
          >
            {busy ? "Validando..." : "Guardar Actor ID"}
          </button>
        </div>
      )}
    </Card>
  );
}
