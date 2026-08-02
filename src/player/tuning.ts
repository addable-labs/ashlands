/**
 * Locomotion constants. Gravity is well above 9.81 on purpose: real gravity
 * makes a 1.8m humanoid feel like a balloon at these camera FOVs, and every
 * action game since Quake has cheated it upward.
 */
export interface PlayerTuning {
  radius: number;
  standHeight: number;
  crouchHeight: number;
  eyeOffset: number;

  gravity: number;
  jumpSpeed: number;
  terminalSpeed: number;

  walkSpeed: number;
  runSpeed: number;
  sneakSpeed: number;

  groundAccel: number;
  groundFriction: number;
  stopSpeed: number;
  airAccel: number;
  airDrag: number;

  /** Cosine of the steepest slope the player can stand on. */
  slopeLimitCos: number;
  /** Speed retained running straight up the steepest standable slope. */
  slopeSpeedFloor: number;
  stepHeight: number;
  snapDistance: number;
  coyoteTime: number;
  jumpLockout: number;

  swimSpeed: number;
  swimFastSpeed: number;
  swimVertSpeed: number;
  /** Linear wading drag, used while the feet still reach the bed. */
  swimDrag: number;
  /**
   * Quadratic drag coefficients, per metre. Water resists as v^2, not v: it is
   * what arrests a dive entry inside a metre or two instead of letting the
   * plunge carry to the seabed, and it is what gives a finite ascent speed
   * from any depth without a magic velocity clamp.
   */
  swimDragH: number;
  swimDragV: number;
  /** Buoyant acceleration of a fully submerged body, m/s^2. */
  buoyancy: number;
  /**
   * Depth over which buoyancy saturates. Deeper than this it is the constant
   * force Archimedes describes; inside it, it tapers to zero at the float line
   * and so acts as a restoring spring toward the surface.
   */
  buoyancyDepth: number;
  /** Where the eye rests relative to the waterline: just under it. */
  swimEyeDepth: number;
  /** Submersion at which swimming starts / stops. The gap is deliberate. */
  swimEnter: number;
  swimExit: number;
  /** Ledge a swimmer at the surface can pull themselves out onto. */
  swimClimbHeight: number;
  /** Vertical kick of a hop at the surface. */
  swimHopSpeed: number;

  levitateSpeed: number;
  levitateFastSpeed: number;
  levitateAccel: number;
  levitateDrag: number;

  strideWalk: number;
  strideRun: number;
  strideSneak: number;
}

export const TUNING: PlayerTuning = {
  radius: 0.34,
  standHeight: 1.8,
  crouchHeight: 1.2,
  eyeOffset: -0.16,

  gravity: 24,
  jumpSpeed: 7.4,
  terminalSpeed: 62,

  // A walk is a walk: at the old 3.4 m/s it was already a jog, which left the
  // run only 1.9x faster than it and gave every speed cue — bob, FOV, cadence —
  // almost no range to work in. 2.3 / 6.4 is a 2.8x spread you can feel.
  walkSpeed: 2.3,
  runSpeed: 6.4,
  sneakSpeed: 1.25,

  // Tuned against the measured ramp, not guessed: with friction no longer
  // fighting it, 34 puts a standing start at top speed in ~0.14 s. The old 62
  // only looked large because ~80% of it was being spent cancelling friction.
  groundAccel: 34,
  // Friction is what stops you, and it is now applied only across the direction
  // you are driving (see applyFriction), so it can be set for the stop it owes
  // without stealing from the accelerator. 6.4 -> 0 in ~0.15 s.
  groundFriction: 13,
  stopSpeed: 2.4,
  // Air control is present but about half of ground authority; it can never add
  // speed beyond the ground target, so a jump preserves a run rather than
  // boosting it. Held at that ratio now that groundAccel is honest.
  airAccel: 16,
  airDrag: 0.12,

  // 58 degrees, not 50. Measured over this heightfield, a 50 degree limit makes
  // 28% of the land a wall the player creeps up at 0.4 m/s; 58 takes that to
  // ~15% and leaves the genuine cliffs unclimbable.
  slopeLimitCos: Math.cos((58 * Math.PI) / 180),
  // Straight up the steepest standable bank you keep 72% of your pace. Enough
  // that a hill reads as effort; not so much that terrain quietly becomes the
  // reason the game feels slow.
  slopeSpeedFloor: 0.72,
  stepHeight: 0.52,
  snapDistance: 0.42,
  coyoteTime: 0.12,
  jumpLockout: 0.14,

  // Shift now selects the slow tier of every mode, so `swimFastSpeed` is the
  // unmodified stroke and holds the 2.5 m/s the swim model was tuned and
  // verified at; `swimSpeed` is the new quiet, deliberate tier under Shift.
  swimSpeed: 1.8,
  swimFastSpeed: 2.5,
  swimVertSpeed: 2.2,
  swimDrag: 2.6,
  // Stroke thrust is derived from swimDragH so terminal speed is swimSpeed
  // exactly; swimDragV sets the ascent from the deep at sqrt(buoyancy/drag),
  // i.e. ~5 m/s, which is a hard swim up rather than a cork.
  swimDragH: 2.2,
  swimDragV: 1.0,
  buoyancy: 26,
  buoyancyDepth: 1.8,
  swimEyeDepth: 0.06,
  swimEnter: 0.62,
  swimExit: 0.46,
  swimClimbHeight: 1.35,
  swimHopSpeed: 3.4,

  // Same swap: unmodified levitation is the 5.0 m/s it always was, and Shift
  // buys the slow tier you want when threading a tower window.
  levitateSpeed: 3.0,
  levitateFastSpeed: 5.0,
  levitateAccel: 14,
  levitateDrag: 2.4,

  // Metres of travel per half-cycle, i.e. per footfall pair. These set footstep
  // cadence, and cadence is most of what reads as pace: 1.15 m at 2.3 m/s is
  // ~115 steps/min (a walk), 2.15 m at 6.4 m/s is ~179 (a run).
  strideWalk: 1.15,
  strideRun: 2.15,
  strideSneak: 0.85,
};
