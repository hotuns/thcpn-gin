import { useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";

const steps = [
  { title: "欢迎使用原位生态云", description: "这里可以统一管理原位观测设备、查看设备数据并开展数据分析。" },
  { selector: ".workspace-trigger", title: "选择工作区", description: "先确认当前工作区。设备、项目和数据都会按照工作区隔离。" },
  { selector: '[data-onboarding="devices"]', title: "管理设备", description: "进入设备中心，查看设备状态、详细资料、数据趋势和采集图片。" },
  { selector: '[data-onboarding="deviceMap"]', title: "查看设备地图", description: "在地图中查看设备位置，并按生态类型和观测用途筛选。" },
  { selector: '[data-onboarding="compare"]', title: "分析设备数据", description: "选择多个设备和指标，在同一张图表中进行对比分析。" },
];

export function OnboardingTour({ userId, startOpen = false }: { userId: string; startOpen?: boolean }) {
  const storageKey = `ecocloud:onboarding-completed:${userId}`;
  const [step, setStep] = useState(() => startOpen || localStorage.getItem(storageKey) !== "true" ? 0 : -1);
  const [target, setTarget] = useState<DOMRect | null>(null);
  const dismiss = () => {
    localStorage.setItem(storageKey, "true");
    setStep(-1);
  };

  useLayoutEffect(() => {
    if (step < 0) return;
    const update = () => {
      const selector = steps[step]?.selector;
      setTarget(selector ? document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null : null);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  useEffect(() => {
    if (step < 0) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        localStorage.setItem(storageKey, "true");
        setStep(-1);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [step]);

  if (step < 0) return null;
  const current = steps[step];
  const bubbleStyle = target
    ? {
        top: Math.min(Math.max(16, target.top), window.innerHeight - 240),
        left: target.right + 340 < window.innerWidth ? target.right + 18 : Math.max(16, target.left - 338),
      }
    : undefined;

  return <div className="onboarding-tour" role="dialog" aria-modal="true" aria-label="平台使用引导">
    <div className="onboarding-backdrop" />
    {target ? <div className="onboarding-target" style={{ top: target.top - 5, left: target.left - 5, width: target.width + 10, height: target.height + 10 }} /> : null}
    <section className={`onboarding-bubble ${target ? "is-targeted" : ""}`} style={bubbleStyle}>
      <button type="button" className="onboarding-close" aria-label="跳过引导" onClick={dismiss}><X size={17} /></button>
      <span className="onboarding-step">{step + 1} / {steps.length}</span>
      <h2>{current.title}</h2>
      <p>{current.description}</p>
      <div className="onboarding-actions">
        <button type="button" className="onboarding-skip" onClick={dismiss}>跳过</button>
        <div>
          {step > 0 ? <button type="button" className="onboarding-secondary" onClick={() => setStep(step - 1)}>上一步</button> : null}
          {step === steps.length - 1
            ? <button type="button" className="onboarding-primary" onClick={dismiss}>完成</button>
            : <button type="button" className="onboarding-primary" onClick={() => setStep(step + 1)}>下一步</button>}
        </div>
      </div>
    </section>
  </div>;
}
