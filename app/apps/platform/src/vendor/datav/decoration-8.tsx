// Adapted from DataV-Team/DataV-React (MIT); see README.md and LICENSE.
import { useMemo, forwardRef } from "react";
import { useAutoResize, type DataVProps } from "./compat";

const defaultColor = ['#3f96a5', '#3f96a5']

const Decoration = forwardRef<HTMLDivElement, DataVProps>(({ reverse = false, className, style, color = [] }, ref) => {
  const { width, height, domRef } = useAutoResize(ref)

  const xPos = (pos: number) => (!reverse ? pos : width - pos)

  const mergedColor = useMemo(() => [color[0] ?? defaultColor[0], color[1] ?? defaultColor[1]], [color])

  const [pointsOne, pointsTwo, pointsThree] = useMemo(
    () => [
      `${xPos(0)}, 0 ${xPos(30)}, ${height / 2}`,
      `${xPos(20)}, 0 ${xPos(50)}, ${height / 2} ${xPos(width)}, ${height / 2}`,
      `${xPos(0)}, ${height - 3}, ${xPos(200)}, ${height - 3}`
    ],
    [reverse, width, height]
  )

  const classNames = useMemo(() => ['dv-decoration-8', className].filter(Boolean).join(' '), [
    className
  ])

  return (
    <div className={classNames} style={style} ref={domRef}>
      <svg aria-hidden="true" focusable="false" width={width} height={height}>
        <polyline
          stroke={mergedColor[0]}
          strokeWidth='2'
          fill='transparent'
          points={pointsOne}
        />

        <polyline
          stroke={mergedColor[0]}
          strokeWidth='2'
          fill='transparent'
          points={pointsTwo}
        />

        <polyline
          stroke={mergedColor[1]}
          fill='transparent'
          strokeWidth='3'
          points={pointsThree}
        />
      </svg>
    </div>
  )
})

export default Decoration
