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
}) {
  const [step, setStep] = useState("mode");

  const title = useMemo(() => {
    if (step === "mode") return "Bienvenido";
    if (step === "phone") return loginMode === "login" ? "Ingresa tu telefono" : "Telefono de registro";
    if (step === "pin") return "Configura tu PIN";
    return "Completa tu perfil";
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
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-white/60">Flujo progresivo para entrar rapido desde el celular.</p>
        </div>
        <InstallPwaButton />
      </div>

      <div className="relative min-h-[320px]">
        <Slide show={step === "mode"}>
          <div className="space-y-3">
            <button onClick={() => { setLoginMode("login"); setStep("phone"); }} data-testid="auth-login-mode-btn" className="focus-ring w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90">Ingresar</button>
            <button onClick={() => { setLoginMode("register"); setStep("phone"); }} data-testid="auth-register-mode-btn" className="focus-ring w-full rounded-2xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10">Crear cuenta</button>
          </div>
        </Slide>

        <Slide show={step === "phone"}>
          <div className="space-y-4">
            <div>
              <label htmlFor="auth-phone-input" className="text-xs font-semibold uppercase tracking-wide text-white/60">Celular</label>
              <input id="auth-phone-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ej: 5491122334455" inputMode="tel" data-testid="auth-phone-input" className="focus-ring mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-white/30" />
            </div>
            <div className="flex gap-2">
              <button type="button" data-testid="auth-back-btn" onClick={goBack} className="focus-ring rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">Atras</button>
              <button type="button" data-testid="auth-phone-next-btn" onClick={() => setStep("pin")} disabled={!phone.trim()} className="focus-ring flex-1 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40">Continuar</button>
            </div>
          </div>
        </Slide>

        <Slide show={step === "pin"}>
          <div className="space-y-4">
            <div>
              <label htmlFor="auth-pin-input" className="text-xs font-semibold uppercase tracking-wide text-white/60">PIN (4 o 6 digitos)</label>
              <input id="auth-pin-input" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D+/g, "").slice(0, 6))} placeholder="••••" inputMode="numeric" data-testid="auth-pin-input" className="focus-ring mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-white/30" />
            </div>
            <div className="flex gap-2">
              <button type="button" data-testid="auth-back-btn" onClick={goBack} className="focus-ring rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">Atras</button>
              <button type="button" data-testid={loginMode === "login" ? "auth-login-submit" : "auth-register-next-btn"} onClick={submitPinStep} disabled={busy || !(/^\d{4}$|^\d{6}$/.test(pin.trim()))} className="focus-ring flex-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-40">
                {busy ? "Validando..." : loginMode === "login" ? "Entrar" : "Continuar"}
              </button>
            </div>
          </div>
        </Slide>

        <Slide show={step === "profile"}>
          <div className="space-y-4">
            <div>
              <label htmlFor="auth-full-name-input" className="text-xs font-semibold uppercase tracking-wide text-white/60">Nombre y apellido</label>
              <input id="auth-full-name-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ej: Milton Clavijo" data-testid="auth-full-name-input" className="focus-ring mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-white/30" />
            </div>
            <div className="flex gap-2">
              <button type="button" data-testid="auth-back-btn" onClick={goBack} className="focus-ring rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">Atras</button>
              <button type="button" data-testid="auth-register-submit" onClick={onRegister} disabled={busy || fullName.trim().length < 3 || !phone.trim() || !(/^\d{4}$|^\d{6}$/.test(pin.trim()))} className="focus-ring flex-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-40">{busy ? "Validando..." : "Crear y entrar"}</button>
            </div>
          </div>
        </Slide>
      </div>

      <div className="mt-3"><InlineError>{err}</InlineError></div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/10 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Debug (Actor ID manual)</div>
        <div className="mt-1 text-xs text-white/45">Si necesitas, podes seguir pegando el Actor ID como antes.</div>
        <input value={actorDraft} onChange={(e) => setActorDraft(e.target.value)} placeholder="UUID actor..." className="focus-ring mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-white/30" />
        <button onClick={onSaveActor} disabled={busy || actorDraft.trim().length === 0} className="focus-ring mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-40">{busy ? "Validando..." : "Guardar Actor ID"}</button>
      </div>
    </Card>
  );
}

