/**
 * The Custos metronome built from stacked glass slabs, in the style of Hedera.com's layered "H".
 * Pure CSS 3D (no video, no canvas): each row of the body is a flat slab; rows beside the window split into two
 * rails. The pendulum is the only moving part: it swings like a metronome, because keeping the beat is the product.
 */

const ROWS = 20;
const ROW_GAP = 19; // px between slabs
const TOP_HALF = 46; // half-width of the top row
const BOTTOM_HALF = 132; // half-width of the bottom row
const RAIL = 30; // width of each rail beside the window
const WINDOW_ROWS = { from: 4, to: 13 }; // rows where the body is open in the middle
const DEPTH = 112; // slab depth, front to back

type Slab = { key: string; x: number; y: number; width: number };

const slabs: Slab[] = Array.from({ length: ROWS }, (_, row) => {
  const half = TOP_HALF + ((BOTTOM_HALF - TOP_HALF) * row) / (ROWS - 1);
  const y = row * ROW_GAP;
  if (row >= WINDOW_ROWS.from && row <= WINDOW_ROWS.to) {
    return [
      { key: `${row}-l`, x: -half, y, width: RAIL },
      { key: `${row}-r`, x: half - RAIL, y, width: RAIL },
    ];
  }
  return [{ key: `${row}`, x: -half, y, width: half * 2 }];
}).flat();

const PIVOT_Y = 16 * ROW_GAP; // the arm swings from inside the base
const ARM_LENGTH = 320;

export const MetronomeStack = () => (
  <div className="custos-stack-scene" aria-hidden>
    <div className="custos-stack">
      {slabs.map(s => (
        <div
          key={s.key}
          className="custos-slab"
          style={{ width: s.width, height: DEPTH, transform: `translate3d(${s.x}px, ${s.y}px, 0) rotateX(90deg)` }}
        />
      ))}
      <div className="custos-arm" style={{ height: ARM_LENGTH, top: PIVOT_Y - ARM_LENGTH }}>
        <div className="custos-weight" />
      </div>
    </div>
  </div>
);
