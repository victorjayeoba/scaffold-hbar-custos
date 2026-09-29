/**
 * The Custos metronome built from stacked glass plates, after Hedera.com's layered "H".
 * Pure CSS 3D (no video, no canvas). Every plate is a real box: a glass top, a bright front edge and two side
 * edges, lit from the upper left. Rows beside the window split into two rails. The pendulum is the only moving
 * part: it swings like a metronome, because keeping the beat is the product.
 */

const ROWS = 16;
const ROW_GAP = 25; // px between plates
const TOP_HALF = 46; // half-width of the top row
const BOTTOM_HALF = 132; // half-width of the bottom row
const RAIL = 28; // width of each rail beside the window
const WINDOW_ROWS = { from: 3, to: 11 }; // rows where the body is open in the middle
const DEPTH = 190; // plate length, front to back
const THICKNESS = 7;

type Plate = { key: string; x: number; y: number; width: number };

const plates: Plate[] = Array.from({ length: ROWS }, (_, row) => {
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

/** A glass box: `w` wide, `d` deep, `h` tall, with its top-left-back corner at the origin. */
const GlassBox = ({ w, d, h, className = "" }: { w: number; d: number; h: number; className?: string }) => (
  <div className={`custos-box ${className}`}>
    <div className="custos-face custos-face-top" style={{ width: w, height: d }} />
    <div className="custos-face custos-face-front" style={{ width: w, height: h, transform: `translateZ(${d}px)` }} />
    <div
      className="custos-face custos-face-side"
      style={{ width: d, height: h, transform: `translateX(${w}px) translateZ(${d}px) rotateY(90deg)` }}
    />
    <div
      className="custos-face custos-face-side"
      style={{ width: d, height: h, transform: `translateZ(${d}px) rotateY(90deg)` }}
    />
  </div>
);

const PIVOT_Y = 13 * ROW_GAP; // the arm swings from inside the base
const ARM_LENGTH = 380;
const ARM_WIDTH = 14;

export const MetronomeStack = () => (
  <div className="custos-stack-scene" aria-hidden>
    <div className="custos-stack">
      {plates.map(p => (
        <div
          key={p.key}
          className="custos-plate"
          style={{ transform: `translate3d(${p.x}px, ${p.y}px, ${-DEPTH / 2}px)` }}
        >
          <GlassBox w={p.width} d={DEPTH} h={THICKNESS} />
        </div>
      ))}
      {/* The pendulum sits in the middle plane, so it passes through the window. */}
      <div className="custos-arm" style={{ height: ARM_LENGTH, top: PIVOT_Y - ARM_LENGTH, left: -ARM_WIDTH / 2 }}>
        <div className="custos-part" style={{ transform: `translateZ(${-ARM_WIDTH / 2}px)` }}>
          <GlassBox w={ARM_WIDTH} d={ARM_WIDTH} h={ARM_LENGTH} className="custos-box-bright" />
        </div>
        <div
          className="custos-part"
          style={{ transform: `translate3d(${(ARM_WIDTH - 56) / 2}px, ${ARM_LENGTH * 0.5}px, -15px)` }}
        >
          <GlassBox w={56} d={30} h={30} className="custos-box-bright" />
        </div>
      </div>
    </div>
  </div>
);
