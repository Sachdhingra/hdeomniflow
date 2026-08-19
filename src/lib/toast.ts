/**
 * Drop-in replacement for `import { toast } from "@/lib/toast"`.
 * Plays a brief Web Audio ding on every notification so staff never miss an alert.
 */
import { toast as _toast } from "sonner";

function playDing() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx  = new AudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);           // A5
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15); // settle to E5
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.75);
    osc.onended = () => ctx.close();
  } catch (_) {}
}

function withDing<T extends (...args: any[]) => any>(fn: T): T {
  return ((...args: any[]) => { playDing(); return fn(...args); }) as T;
}

export const toast = Object.assign(
  withDing(_toast as any),
  {
    success:  withDing(_toast.success.bind(_toast)),
    error:    withDing(_toast.error.bind(_toast)),
    warning:  withDing(_toast.warning.bind(_toast)),
    info:     withDing(_toast.info.bind(_toast)),
    loading:  _toast.loading.bind(_toast),
    dismiss:  _toast.dismiss.bind(_toast),
    message:  _toast.message.bind(_toast),
    promise:  _toast.promise.bind(_toast),
    custom:   _toast.custom.bind(_toast),
  }
) as typeof _toast;
