// Adapted from DataV-Team/DataV-React (MIT); see README.md and LICENSE.
import { useMemo, forwardRef } from "react";
import { useAutoResize, type DataVProps } from "./compat";

const defaultColor = ['#3f96a5', '#3f96a5']

const Decoration = forwardRef<HTMLDivElement, DataVProps>(({ className, style, color = [] }, ref) => {
  const { width, height, domRef } = useAutoResize(ref)

  function calcSVGData() {
    const line1Array = [
      [0, height * 0.2],
      [width * 0.18, height * 0.2],
      [width * 0.2, height * 0.4],
      [width * 0.25, height * 0.4],
      [width * 0.27, height * 0.6],
      [width * 0.72, height * 0.6],
      [width * 0.75, height * 0.4],
      [width * 0.8, height * 0.4],
      [width * 0.82, height * 0.2],
      [width, height * 0.2]
    ]

    const line2Array = [[width * 0.3, height * 0.8], [width * 0.7, height * 0.8]]

    const line1Points = line1Array.map(point => point.join(',')).join(' ')
    const line2Points = line2Array.map(point => point.join(',')).join(' ')

    return { line1Points, line2Points }
  }

  const mergedColor = useMemo(() => [color[0] ?? defaultColor[0], color[1] ?? defaultColor[1]], [color])

  const { line1Points, line2Points } = useMemo(
    calcSVGData,
    [width, height]
  )

  const classNames = useMemo(() => ['dv-decoration-5', className].filter(Boolean).join(' '), [
    className
  ])

  return (
    <div className={classNames} style={style} ref={domRef}>
      <svg aria-hidden="true" focusable="false" width={width} height={height}>
        <polyline
          fill='transparent'
          stroke={mergedColor[0]}
          strokeWidth='3'
          points={line1Points}
        />
        <polyline
          fill='transparent'
          stroke={mergedColor[1]}
          strokeWidth='2'
          points={line2Points}
        />
      </svg>
    </div>
  )
})

export default Decoration
