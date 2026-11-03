import { useEffect, useState } from "react";

export function AtlasClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const pad = (value: number) => String(value).padStart(2, "0");
  return <time className="atlas-clock" dateTime={now.toISOString()}>
    <span>{now.getFullYear()}.{pad(now.getMonth() + 1)}.{pad(now.getDate())}</span>
    <strong>{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</strong>
  </time>;
}
