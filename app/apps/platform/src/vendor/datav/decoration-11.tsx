// Adapted from DataV-Team/DataV-React (MIT); see README.md and LICENSE.
import { forwardRef } from "react";
import { fade, useAutoResize, type DataVProps } from "./compat";

export default forwardRef<HTMLDivElement, DataVProps>(function Decoration11({ children, className = "", style, color = ['#1a98fc', '#2cf7fe'] }, ref) {
  const { width, height, domRef } = useAutoResize(ref);
  return <div className={`dv-decoration-11 ${className}`} style={style} ref={domRef}>
    <svg aria-hidden="true" focusable="false" width={width} height={height}>
      <g fill={fade(color[1], 10)} stroke={color[1]}>
        <polygon points="20 10, 25 4, 55 4 60 10" />
        <polygon points={`20 ${height - 10}, 25 ${height - 4}, 55 ${height - 4} 60 ${height - 10}`} />
        <polygon points={`${width - 20} 10, ${width - 25} 4, ${width - 55} 4 ${width - 60} 10`} />
        <polygon points={`${width - 20} ${height - 10}, ${width - 25} ${height - 4}, ${width - 55} ${height - 4} ${width - 60} ${height - 10}`} />
      </g>
      <polygon fill={fade(color[0], 20)} stroke={color[0]} points={`20 10, 5 ${height / 2} 20 ${height - 10} ${width - 20} ${height - 10} ${width - 5} ${height / 2} ${width - 20} 10`} />
      <g fill="transparent" stroke={fade(color[0], 70)}>
        <polyline points={`25 18, 15 ${height / 2} 25 ${height - 18}`} />
        <polyline points={`${width - 25} 18, ${width - 15} ${height / 2} ${width - 25} ${height - 18}`} />
      </g>
    </svg>
    <div className="decoration-content">{children}</div>
  </div>;
});
