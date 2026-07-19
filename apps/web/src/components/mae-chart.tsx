function mean(values: number[]): number | null {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

function pointsFor(
  values: number[],
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  ceiling: number,
): string {
  if (values.length === 0) return "";
  return values
    .map((value, index) => {
      const x =
        offsetX +
        (values.length === 1
          ? width / 2
          : (index / (values.length - 1)) * width);
      const y = offsetY + height - (value / ceiling) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function MaeChart({ values }: { values: number[] }) {
  const windowSize = Math.min(5, Math.max(1, Math.ceil(values.length / 2)));
  const firstWindow = values.slice(0, windowSize);
  const recentWindow = values.slice(-windowSize);
  const firstMae = mean(firstWindow);
  const recentMae = mean(recentWindow);
  const maxValue = Math.max(10, ...values);
  const ceiling = Math.ceil(maxValue / 10) * 10;
  const mainPoints = pointsFor(values, 820, 250, 80, 44, ceiling);
  const comparisonCeiling = Math.max(
    10,
    Math.ceil(Math.max(...firstWindow, ...recentWindow, 0) / 10) * 10,
  );

  return (
    <div className="mae-visual">
      <svg
        aria-labelledby="mae-chart-title mae-chart-description"
        className="mae-chart"
        role="img"
        viewBox="0 0 960 360"
      >
        <title id="mae-chart-title">Mean absolute error over time</title>
        <desc id="mae-chart-description">
          Duration prediction error for completed incidents, measured in
          minutes.
        </desc>
        <g className="mae-chart__grid">
          {[44, 106.5, 169, 231.5, 294].map((y) => (
            <line key={y} x1="80" x2="900" y1={y} y2={y} />
          ))}
          {[80, 285, 490, 695, 900].map((x) => (
            <line key={x} x1={x} x2={x} y1="44" y2="294" />
          ))}
        </g>
        <g className="mae-chart__labels">
          <text x="24" y="49">
            {ceiling}
          </text>
          <text x="24" y="174">
            {Math.round(ceiling / 2)}
          </text>
          <text x="24" y="299">
            0
          </text>
          <text x="80" y="328">
            FIRST OUTCOME
          </text>
          <text textAnchor="end" x="900" y="328">
            LATEST
          </text>
          <text transform="rotate(-90 13 169)" x="13" y="169">
            ERROR / MIN
          </text>
        </g>
        {values.length > 0 ? (
          <>
            <polyline className="mae-chart__series-glow" points={mainPoints} />
            <polyline className="mae-chart__series" points={mainPoints} />
            {values.map((value, index) => {
              const [x = "0", y = "0"] = pointsFor(
                [value],
                0,
                250,
                80 +
                  (values.length === 1
                    ? 410
                    : (index / (values.length - 1)) * 820),
                44,
                ceiling,
              ).split(",");
              return (
                <circle
                  className="mae-chart__point"
                  cx={x}
                  cy={y}
                  key={`${index}-${value}`}
                  r="4"
                />
              );
            })}
          </>
        ) : (
          <path className="mae-chart__empty-line" d="M80 294H900" />
        )}
      </svg>

      {values.length === 0 ? (
        <p className="chart-empty-copy">
          The error series begins when a resolved incident records its observed
          duration.
        </p>
      ) : null}

      <section className="window-comparison" aria-label="MAE window comparison">
        <div className="window-comparison__heading">
          <div>
            <span className="panel-kicker">WINDOW COMPARISON</span>
            <h3>First observations against recent observations</h3>
          </div>
          <dl>
            <div>
              <dt>FIRST</dt>
              <dd>{firstMae === null ? "--" : `${firstMae.toFixed(1)}M`}</dd>
            </div>
            <div>
              <dt>RECENT</dt>
              <dd>{recentMae === null ? "--" : `${recentMae.toFixed(1)}M`}</dd>
            </div>
          </dl>
        </div>
        <svg
          aria-hidden="true"
          className="comparison-chart"
          preserveAspectRatio="none"
          viewBox="0 0 480 100"
        >
          <line
            className="comparison-chart__axis"
            x1="0"
            x2="480"
            y1="88"
            y2="88"
          />
          {firstWindow.length > 0 ? (
            <>
              <polyline
                className="comparison-chart__first"
                points={pointsFor(
                  firstWindow,
                  480,
                  72,
                  0,
                  12,
                  comparisonCeiling,
                )}
              />
              <polyline
                className="comparison-chart__recent"
                points={pointsFor(
                  recentWindow,
                  480,
                  72,
                  0,
                  12,
                  comparisonCeiling,
                )}
              />
            </>
          ) : (
            <line
              className="comparison-chart__empty"
              x1="0"
              x2="480"
              y1="72"
              y2="72"
            />
          )}
        </svg>
        <div className="comparison-legend">
          <span>
            <i className="comparison-legend__first" />
            FIRST WINDOW
          </span>
          <span>
            <i className="comparison-legend__recent" />
            RECENT WINDOW
          </span>
        </div>
      </section>
    </div>
  );
}
