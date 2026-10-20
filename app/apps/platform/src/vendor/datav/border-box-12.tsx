// Adapted from DataV-Team/DataV-React (MIT); see README.md and LICENSE.
import { forwardRef, useId } from "react";
import { fade, useAutoResize, type DataVProps } from "./compat";

export default forwardRef<HTMLDivElement, DataVProps>(function BorderBox12({ children, className = "", style, color = ['#2e6099', '#7ce7fd'], backgroundColor = 'transparent' }, ref) {
  const filterId = `dv-border-12-${useId().replace(/:/g, '')}`;
  const { width, height, domRef } = useAutoResize(ref);
  return <div className={`dv-border-box-12 ${className}`} style={style} ref={domRef}>
    <svg aria-hidden="true" focusable="false" className="dv-border-svg-container" width={width} height={height}>
      <defs><filter id={filterId} height="150%" width="150%" x="-25%" y="-25%">
        <feMorphology operator="dilate" radius="1" in="SourceAlpha" result="thicken" />
        <feGaussianBlur in="thicken" stdDeviation="2" result="blurred" />
        <feFlood floodColor={fade(color[1], 70)} result="glowColor" />
        <feComposite in="glowColor" in2="blurred" operator="in" result="softGlowColored" />
        <feMerge><feMergeNode in="softGlowColored" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter></defs>
      {width > 0 && height > 0 && <>
        <path fill={backgroundColor} strokeWidth="2" stroke={color[0]} d={`M15 5 L ${width - 15} 5 Q ${width - 5} 5, ${width - 5} 15 L ${width - 5} ${height - 15} Q ${width - 5} ${height - 5}, ${width - 15} ${height - 5} L 15, ${height - 5} Q 5 ${height - 5} 5 ${height - 15} L 5 15 Q 5 5 15 5`} />
        <g strokeWidth="2" fill="transparent" strokeLinecap="round" filter={`url(#${filterId})`} stroke={color[1]}>
          <path d="M 20 5 L 15 5 Q 5 5 5 15 L 5 20" />
          <path d={`M ${width - 20} 5 L ${width - 15} 5 Q ${width - 5} 5 ${width - 5} 15 L ${width - 5} 20`} />
          <path d={`M ${width - 20} ${height - 5} L ${width - 15} ${height - 5} Q ${width - 5} ${height - 5} ${width - 5} ${height - 15} L ${width - 5} ${height - 20}`} />
          <path d={`M 20 ${height - 5} L 15 ${height - 5} Q 5 ${height - 5} 5 ${height - 15} L 5 ${height - 20}`} />
        </g>
      </>}
    </svg>
    <div className="border-box-content">{children}</div>
  </div>;
});
