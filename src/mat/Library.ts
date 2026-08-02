/**
 * The material library: one GLSL fragment per surface.
 *
 * Contract for each entry's `glsl`:
 *   float mHeight(vec2 uv)
 *     Returns the height field in [0,1]. Called once per texel; the normal map
 *     and the AO term are both derived from the *rendered* height buffer, not
 *     from repeated evaluations of this function.
 *   void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough,
 *               inout float metal, inout float armA)
 *     albedo is LINEAR (the framebuffer is sRGB and encodes on write).
 *     armA lands in the alpha of the ARM map. It is ALWAYS the height, for
 *     every set without exception — consumers height-blend on it and drive
 *     cavity/emissive terms from (1 - armA), so a set that put anything else
 *     there would silently invert both.
 *
 * mHeight always runs before mShade, so a material may stash intermediate
 * fields in file-scope globals rather than recomputing them.
 *
 * Directional features are built from anisotropic periods — rep=(high, low)
 * elongates along Y, rep=(low, high) along X — because rotating uv would break
 * the lattice wrap. Where a feature genuinely needs free rotation it is done in
 * cell-local coordinates, whose seams are hidden by the cell boundary.
 *
 * SPECTRAL BAR. Every set here is checked with a 2D FFT of its rendered albedo:
 * no isolated spectral peak may exceed 3x the local radial median, and the
 * energy must not be concentrated in one band. That rules out the two shapes
 * that read instantly as "texture" rather than as ground — a fixed-radius
 * Worley threshold (a dot screen) and phase-locked fBm octaves (a grey grid at
 * the base period). Use `clasts` for scattered solids and let `fbm`/`ridged`
 * handle the de-phasing; both are documented in Noise.ts.
 */
export interface MatDef {
  readonly name: string;
  readonly glsl: string;
  /** Relief height as a fraction of tile width. Drives normal slope and AO. */
  readonly relief: number;
  /** Horizon-AO march radius in texels. Mid-scale occlusion only. */
  readonly aoRadius?: number;
  readonly aoStrength?: number;
}

/**
 * Loose volcanic ash — the dominant ground plane, and therefore the material
 * the whole frame is judged on.
 *
 * The previous version shaded from two low-frequency fields plus a monodisperse
 * Worley dot field, which is exactly the "printed polka dot on tan" the review
 * measured: one spatial frequency carried nearly all the albedo energy and the
 * dots sat on the Worley lattice. This one spreads the energy over five decades
 * — 1/3 tile dunes, drift, crust patches, sparse lapilli, and three bands of
 * grain — and every one of them writes to ALBEDO as well as to height, so the
 * surface still reads when the light is flat.
 *
 * Palette: ash #8a7f72 -> #4a423b, per the art bible. Roughness runs 0.72 on
 * wind-polished crust to 0.93 on loose drift, which is the differentiation the
 * bar asks for *within* a single substance.
 */
const ash = /* glsl */ `
float gCinder, gCindId, gCindRim, gDrift, gGrain, gFineG, gCrust, gDune, gStreak;
float gCrack, gPolyId, gLitter;
float mHeight(vec2 uv) {
  // Warp amplitude is deliberately small. At 0.13 the streamlines fold far
  // enough to turn the field into marbling — a swirl pattern reads as polished
  // stone, not as a wind-graded powder.
  vec2 w = warp2(uv, vec2(3.0), 0.055, 4.1);
  gDune = ridged(w, vec2(3.0, 6.0), 5, 0.55, 8.3);
  // Axis deliberately transposed against the dune field. Every anisotropic
  // field in the old version elongated along the same axis, so the tile summed
  // to one direction — which is exactly the "uniform directional streak, the
  // signature of a stretched detail texture" the review measured across the
  // whole lower third of the vale shot. Nothing about a wind-graded ash flat is
  // unidirectional at the metre scale, and now nothing here is either.
  gDrift = fbm(w, vec2(21.0, 9.0), 5, 0.52, 1.7) * 0.5 + 0.5;
  // Wind ripples. Two trains at right angles, selected by a slow field: a wind
  // that has shifted, which is both true of an ash flat and the reason no one
  // direction survives across the tile. Amplitude follows the drift: crests
  // ripple, hollows are packed.
  float rA = fbm(uv, vec2(12.0, 96.0), 3, 0.5, 27.4) * 0.5 + 0.5;
  float rB = fbm(uv, vec2(90.0, 15.0), 3, 0.5, 31.9) * 0.5 + 0.5;
  float rsel = smoothstep(0.36, 0.64, fbm(uv, vec2(3.0), 3, 0.5, 71.2) * 0.5 + 0.5);
  gStreak = mix(rA, rB, rsel) * (0.35 + 0.65 * gDrift);
  // Two grain decades, not one. 45 cycles is ~2 cm of world feature at the mid
  // projection and survives the 512 array downsample intact; 111 is the finest
  // band that still has three texels to its name and is what carries the last
  // metre before the camera.
  gGrain = microGrain(uv, 45.0, 2.7);
  gFineG = microGrain(uv, 111.0, 88.4);
  // Wind-packed crust: broad, soft-edged patches, nothing lattice about them.
  gCrust = smoothstep(0.40, 0.80, fbm(w, vec2(6.0), 4, 0.5, 21.0) * 0.5 + 0.5);
  // Deflation cracks. Ash that has been rained on and baked contracts into
  // polygons; the seams are hairlines, not canyons. This is the one motif in
  // the set with a hard edge, and a hard edge is what a Laplacian — and an eye
  // at two metres — actually reads. Gated on a slow mask so the network is
  // patchy rather than a drawn net across the whole tile.
  vec3 pc = worleyUV(warp(uv, vec2(6.0), 0.09, 96.0), vec2(27.0), 1.0, 97.0);
  gPolyId = pc.z;
  gCrack = (1.0 - smoothstep(0.0, 0.024, pc.y - pc.x))
         * smoothstep(0.26, 0.70, fbm(uv, vec2(5.0), 4, 0.5, 98.0) * 0.5 + 0.5);
  // Lapilli. Sparse, size-graded and clumped by a low-frequency density mask —
  // see Noise.clasts for why the old fixed-radius Worley threshold could not be
  // anything but a dot screen. Three decades now: at the terrain's mid tiling
  // 23/59/117 cycles are roughly 15 cm, 6 cm and 3 cm, which is the 2-15 cm
  // debris band the near plane was missing entirely.
  float dens = 0.30 + 0.50 * smoothstep(0.28, 0.85, fbm(uv, vec2(6.0), 3, 0.5, 44.0) * 0.5 + 0.5);
  vec4 c1 = clasts(uv, vec2(23.0),  dens * 0.7, 0.08, 0.34, 3.0);
  vec4 c2 = clasts(uv, vec2(59.0),  dens,       0.10, 0.38, 4.0);
  vec4 c3 = clasts(uv, vec2(117.0), dens * 1.2, 0.12, 0.36, 5.5);
  gCinder = max(c1.x, max(c2.x * 0.82, c3.x * 0.66));
  gCindId = c1.x > c2.x * 0.82 ? c1.y : (c2.x * 0.82 > c3.x * 0.66 ? c2.y : c3.y);
  gCindRim = max(c1.w, max(c2.w, c3.w * 0.7));
  gLitter = c3.x;
  return clamp(gDune * 0.33 + gDrift * 0.16 + gStreak * 0.10 + gGrain * 0.13
             + gFineG * 0.07 + gCrust * 0.04
             + c1.x * (0.10 + 0.07 * c1.y) + c2.x * 0.07 + c3.x * 0.05
             - gCrack * 0.17, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  // BAND BUDGET. The terrain samples this tile through a per-cell randomly
  // rotated and reflected frame (Heitz-Neyret), which is the only way to kill a
  // readable repeat — but it only works on a texture that is statistically
  // stationary at the cell scale. Any albedo feature comparable to the TILE is
  // rotated into a different place in every cell, so neighbouring cells no
  // longer agree on their local mean and the cell partition itself becomes
  // visible: a mosaic of flat, hard-edged patches. That is the "blotchy
  // cellular albedo that reads as military camouflage" the review measured on
  // the ridge, and the material's half of the fix is to keep the energy out of
  // the sub-8-cycle band. Measured, this set had 19.5% of its albedo energy
  // below 8 cycles per tile; the fields below move most of it to 11-33, where
  // the eye reads it as surface and a rotated copy still averages the same.
  //
  // The macro variation that band used to provide is the terrain's job — it has
  // a metre-scale colour field of its own and does not need this tile to supply
  // one.
  float mottle = fbm(uv, vec2(11.0), 5, 0.52, 1.3) * 0.5 + 0.5;
  float meso   = fbm(uv, vec2(27.0), 4, 0.5, 5.7) * 0.5 + 0.5;
  float fine   = fbm(uv, vec2(33.0), 3, 0.5, 6.6) * 0.5 + 0.5;
  vec3 pale  = PAL(152.0, 141.0, 126.0);
  vec3 mid   = PAL(120.0, 110.0,  97.0);   // ~#8a7f72 once grain is applied
  vec3 dark  = PAL( 78.0,  70.0,  62.0);   // #4a423b end
  vec3 cind  = PAL( 44.0,  41.0,  38.0);
  vec3 rust  = PAL(112.0,  80.0,  58.0);
  vec3 seam  = PAL( 40.0,  35.0,  31.0);
  albedo = mix(dark, mid, smoothstep(0.14, 0.72, gDrift * 0.36 + mottle * 0.34 + meso * 0.30));
  // The pale wind-polished lie of the ash. Two thirds of the weight is now on
  // the drift and the crust rather than on the tile-scale dune field.
  albedo = mix(albedo, pale, smoothstep(0.28, 0.88, gDune * 0.22 + gCrust * 0.34 + gDrift * 0.24 + meso * 0.20));
  // Oxidised ash streaks. Sparse enough to be an accent, not a second colour.
  albedo = mix(albedo, rust, smoothstep(0.68, 0.98, mottle * 0.35 + meso * 0.25 + fine * 0.40) * 0.30);
  // Each polygon between the cracks dried to its own value.
  albedo *= mix(0.88, 1.14, gPolyId) * (1.0 - 0.16 * gCrack);
  // Each lapillus takes its own value from dark scoria to pale pumice. The
  // spread has to be wide — a stone within 10% of the matrix it sits in is not
  // a stone, it is noise — but it stops short of black-and-white, because
  // monochrome specks read as confetti.
  albedo = mix(albedo, mix(cind, pale, 0.10 + 0.85 * gCindId), gCinder * 0.92);
  // Pale ash caught against the upwind side of every stone. This is the term
  // that gives each clast a light and a dark edge, i.e. that makes it read as a
  // solid with a contact shadow rather than as a printed dot.
  albedo = mix(albedo, pale, gCindRim * 0.40);
  // The crack itself: a hairline of shadow, the strongest local contrast in the
  // tile and the thing that survives to the frame at two metres.
  albedo = mix(albedo, seam, gCrack * 0.85);
  // Grain in the albedo, not only in the normal — this is what holds the near
  // plane up when the sun is behind the camera and N-dot-L carries nothing.
  // The old coefficients gave +-12%; measured on the rendered map that was an
  // albedo standard deviation of 11.8 against sand's 18.7, and a Laplacian of
  // 4.9 against sand's 13.4. On the material that covers most of every frame.
  albedo *= 0.38 + 0.86 * gGrain + 0.30 * gFineG + 0.08 * fine + 0.06 * gStreak;
  // Loose drift is a powder and scatters everything; the packed crust is
  // polished by the same wind that packed it and takes a real grazing sheen.
  // The old field ran 0.70-0.94 and measured a standard deviation of 0.061 on
  // the material that covers most of every frame — not enough separation for
  // "rough vs polished" to be readable from shading, which rule 5 requires.
  rough = mix(0.95, 0.62, gCrust * (0.50 + 0.50 * (1.0 - gDrift)));
  // A wind-scoured ripple crest is burnished; its lee face is not. That is a
  // centimetre-scale wet-vs-dry read available on any patch of ground.
  rough -= 0.10 * smoothstep(0.55, 0.95, gStreak) * (0.4 + 0.6 * gCrust);
  // Stones are rained on and polished; the crack floors hold damp fines that
  // stay dark and glossy for days after the surface has dried.
  rough -= 0.22 * gCinder * (0.3 + 0.7 * gCindId);
  rough = mix(rough, 0.50, smoothstep(0.35, 0.95, gCrack) * 0.55);
  metal = 0.0;
  armA = h;
}`;

/**
 * Ash with a coarse scree fraction — the transition band between ash flats and
 * rock, and the material that has to carry the near plane on a slope.
 *
 * Three clast decades rather than one, each with its own density mask, so the
 * size distribution is continuous instead of a single dot screen; plus the same
 * grain bands as `ash` so the matrix between the stones is not bare.
 */
const ashCoarse = /* glsl */ `
float gPeb, gPebId, gPebRim, gFines, gBed, gGrainC, gFineC, gGrit, gGritId;
float mHeight(vec2 uv) {
  vec2 w = warp2(uv, vec2(6.0), 0.07, 11.0);
  gBed = fbm(w, vec2(5.0), 5, 0.52, 3.3) * 0.5 + 0.5;
  // Scree collects in the hollows of the bed and thins on the highs.
  float dens = 0.14 + 0.46 * smoothstep(0.62, 0.18, gBed);
  vec4 big = clasts(uv, vec2(13.0), dens * 0.55, 0.16, 0.62, 5.0);
  vec4 mid = clasts(uv, vec2(29.0), dens,        0.12, 0.48, 6.0);
  vec4 sml = clasts(uv, vec2(67.0), dens * 1.25, 0.10, 0.40, 7.0);
  // A fourth decade at the grit scale. The three above bottom out at about 6 cm
  // of world feature; between them the matrix was bare, which is what makes a
  // scree slope go soft in the last few metres before the camera.
  vec4 grt = clasts(uv, vec2(139.0), dens * 1.5, 0.12, 0.38, 8.5);
  gPeb = max(big.x, max(mid.x * 0.86, sml.x * 0.62));
  gPebId = big.x > mid.x ? big.y : (mid.x * 0.86 > sml.x * 0.62 ? mid.y : sml.y);
  gPebRim = max(big.w, mid.w);
  gFines = sml.x;
  gGrit = grt.x;
  gGritId = grt.y;
  gGrainC = microGrain(uv, 48.0, 9.1);
  gFineC = microGrain(uv, 117.0, 43.7);
  return clamp(gBed * 0.30 + gGrainC * 0.13 + gFineC * 0.06
             + big.x * (0.34 + 0.22 * big.y) + mid.x * (0.20 + 0.14 * mid.y)
             + sml.x * 0.09 + grt.x * 0.05, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  // Same band budget as the ash set: this tile is read through the terrain's per-cell
  // rotated frame, so a feature the size of the tile turns into a visible cell
  // mosaic. 9 -> 15 cycles, with a decorrelated 31-cycle field carrying the
  // weight the 5-cycle bed used to.
  float mot = fbm(uv, vec2(15.0), 4, 0.5, 12.7) * 0.5 + 0.5;
  float mesoC = fbm(uv, vec2(31.0), 4, 0.5, 18.3) * 0.5 + 0.5;
  vec3 dust  = PAL(134.0, 124.0, 110.0);
  vec3 ochre = PAL( 96.0,  84.0,  68.0);
  vec3 deep  = PAL( 62.0,  56.0,  50.0);
  vec3 basaltic = PAL( 44.0,  42.0,  39.0);
  // Saturation discipline: a scree slope of white and orange stones reads as
  // terrazzo. The clasts differ in VALUE far more than they differ in hue.
  vec3 red   = PAL( 94.0,  68.0,  52.0);
  vec3 pumiceC = PAL(122.0, 115.0, 104.0);
  albedo = mix(deep, ochre, smoothstep(0.16, 0.80, gBed * 0.32 + mot * 0.38 + mesoC * 0.30));
  albedo = mix(albedo, dust, smoothstep(0.52, 0.95, gBed * 0.40 + mot * 0.35 + mesoC * 0.25) * 0.55);
  // Every stone is a different rock: scoria, oxidised andesite or pale pumice.
  vec3 stone = mix(basaltic, red, smoothstep(0.30, 0.66, gPebId));
  stone = mix(stone, pumiceC, smoothstep(0.72, 0.99, gPebId));
  albedo = mix(albedo, stone, smoothstep(0.05, 0.50, gPeb) * 0.78);
  // Pale dust caught against the upslope rim of each stone.
  albedo = mix(albedo, dust, gPebRim * 0.35);
  // Grit: dark scoria chips and pale pumice crumbs in the matrix itself.
  albedo = mix(albedo, mix(basaltic, pumiceC, gGritId), smoothstep(0.05, 0.55, gGrit) * 0.55);
  albedo *= 0.56 + 0.60 * gGrainC + 0.24 * gFineC + 0.10 * gFines;
  // Stone faces are rained-on and polished; the ash matrix around them is not.
  rough = mix(0.92, 0.54 + 0.22 * gPebId, smoothstep(0.10, 0.62, gPeb));
  metal = 0.0;
  armA = h;
}`;

/**
 * Weathered volcanic rock — the general cliff and steep-slope surface.
 *
 * Measured on the previous version, the albedo had a luminance standard
 * deviation of 0.0034 against a mean of 0.043: a mathematically uniform slate
 * field, which is precisely the "every square metre shades identically" defect.
 * The cause was structural, not a tuning miss — every colour term was gated on a
 * `smoothstep(0.44, 0.88, fbm)` mask that is zero over most of the tile, so
 * outside those few patches the albedo was literally the constant `rock`.
 *
 * Rebuilt so the base tone itself is a field: fracture-block value, oxidation,
 * settled ash dust and grain all multiply into it everywhere, and the vesicles
 * come from `clasts` rather than three phase-locked Worley grids.
 */
const volcanicRock = /* glsl */ `
float gVes, gOx, gDust, gBlock, gFrac, gGritV, gFineV, gChipV, gChipVId, gFaceV;
float mHeight(vec2 uv) {
  vec2 w = warp2(uv, vec2(3.0), 0.15, 21.0);
  float lump = ridged(w, vec2(5.0), 5, 0.5, 2.2) * 0.52
             + fbm(w, vec2(3.0), 4, 0.5, 7.7) * 0.24 + 0.30;
  // Fracture network at two scales. Warped Worley edges, not cell centres, so
  // what shows is a crack pattern rather than a field of blobs.
  vec3 f1 = worleyUV(warp(uv, vec2(6.0), 0.10, 33.0), vec2(7.0), 1.0, 12.0);
  vec3 f2 = worleyUV(warp(uv, vec2(12.0), 0.07, 34.0), vec2(17.0), 1.0, 13.0);
  gBlock = f1.z * 0.6 + f2.z * 0.4;
  gFrac = max(1.0 - smoothstep(0.0, 0.055, f1.y - f1.x),
             (1.0 - smoothstep(0.0, 0.038, f2.y - f2.x)) * 0.62);
  // Trapped gas. Sparse, size-graded, clumped: scoria degasses in pockets.
  float dens = 0.20 + 0.45 * smoothstep(0.35, 0.85, fbm(uv, vec2(6.0), 3, 0.5, 45.0) * 0.5 + 0.5);
  vec4 v1 = clasts(uv, vec2(23.0), dens * 0.8, 0.12, 0.46, 12.0);
  vec4 v2 = clasts(uv, vec2(53.0), dens,       0.10, 0.42, 13.0);
  gVes = clamp(max(v1.x * 0.85, v2.x * 0.55), 0.0, 1.0);
  gGritV = microGrain(uv, 60.0, 4.4);
  // A second grain decade and an angular chip field. Without them everything on
  // this material lived at or above the 7-cell fracture scale, so at the two
  // metres a boulder or a cliff foot is actually seen from there was nothing on
  // it at all — the near plane read as a flat-shaded facet.
  gFineV = microGrain(uv, 128.0, 46.2);
  vec4 ch = clasts(uv, vec2(97.0), 0.34 + 0.30 * lump, 0.12, 0.40, 47.1);
  gChipV = ch.x;
  gChipVId = ch.y;
  // Intra-block texture: each fracture block has its own weathered face, so the
  // per-cell value is a field rather than a constant fill. A flat cell value is
  // what turns a cellular albedo into a camouflage stamp.
  gFaceV = fbm(warp(uv, vec2(9.0), 0.08, 48.3), vec2(23.0), 4, 0.5, 49.7) * 0.5 + 0.5;
  return clamp(lump * 0.68 + gGritV * 0.12 + gFineV * 0.06 + gChipV * 0.06
             - gVes * 0.34 - gFrac * 0.16, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  // Oxidation is a *field*, not a gate: some of it everywhere, a lot of it in
  // patches. Fed by a warped fBm so the patches have organic edges.
  gOx = smoothstep(0.44, 0.92, fbm(warp(uv, vec2(3.0), 0.12, 55.0), vec2(5.0), 5, 0.52, 6.1) * 0.5 + 0.5);
  // Ash dust settles on anything close to horizontal and in every hollow.
  gDust = smoothstep(0.30, 0.90, fbm(uv, vec2(11.0), 4, 0.5, 71.0) * 0.5 + 0.5)
        * smoothstep(0.30, 0.78, h);
  vec3 deepC = PAL( 30.0,  28.0,  26.0);
  vec3 rock  = PAL( 68.0,  63.0,  57.0);
  vec3 pale  = PAL(102.0,  95.0,  85.0);
  // Desaturated rust. Saturation discipline: the only vivid things in this
  // world are lava and bioluminescence, so oxidation is a warm grey-brown.
  vec3 rust  = PAL(112.0,  72.0,  48.0);
  vec3 ashD  = PAL(128.0, 119.0, 106.0);
  vec3 shadowC = PAL( 16.0,  15.0,  14.0);
  // Every fracture block quarried its own value out of the flow — but the block
  // id is blended with an intra-block field before it reaches the albedo, so a
  // cell is a *region* with texture in it rather than a flat polygon of one
  // colour. A cellular albedo whose cells are constant is a camouflage stamp,
  // which is precisely what the review measured across the ridge.
  // MACRO CONTRAST BUDGET. See the note on basalt for the measurement and the
  // reasoning; this set fails the same way and for the same reason. Its albedo
  // luminance standard deviation is 11.3 code values at level 0 and about 2 by
  // level 4, which is the level Red Mountain's summit and upper flanks are
  // sampled from — and two code values across a whole massif is what renders as
  // "flat-shaded polygonal facets in uniform pale putty, individual triangles
  // readable as solid colour plates".
  //
  // No new frequency is introduced: gBlock is a 6-and-18-cycle fracture field
  // and gFaceV a 24-cycle intra-block one, both of which survive to level 5. The
  // composite is pre-emphasised so the authored deep-to-pale range is actually
  // reached, and the height field — which is dominated by grain and is gone by
  // level 3 — no longer gets to dilute the one term that carries the distance.
  float macroV = clamp(0.5 + (gBlock * 0.62 + gFaceV * 0.38 - 0.5) * 2.0, 0.0, 1.0);
  albedo = mix(deepC * 0.64, rock, smoothstep(0.12, 0.90, macroV * 0.74 + h * 0.26));
  albedo = mix(albedo, pale, smoothstep(0.58, 1.0, macroV) * 0.44);
  // Oxidation is a 6-cycle field and therefore one of the few things on this
  // material still legible at a kilometre, so it is worth its full weight rather
  // than a fifth of one. Still a warm grey-brown, not a rust: saturation
  // discipline is not what was failing here, amplitude was.
  albedo = mix(albedo, rust, gOx * (0.24 + 0.30 * (1.0 - h)));
  albedo = mix(albedo, ashD, gDust * 0.55);
  // Angular chips spalled off the face: fresh dark glass and pale altered rind.
  albedo = mix(albedo, mix(deepC, pale, gChipVId), smoothstep(0.06, 0.55, gChipV) * 0.45);
  albedo = mix(albedo, shadowC, gVes * 0.72 + gFrac * 0.32);
  albedo *= 0.66 + 0.44 * gGritV + 0.22 * gFineV;
  // Roughness as a FIELD, not a gate.
  //
  // The old line was mix(0.55, 0.92, mask) where the mask is zero over most of
  // the tile, so the rendered roughness map had a standard deviation of 0.05 —
  // a constant, on the material every cliff and midground rock in the world is
  // made of. That is measurably the "one uniform albedo, no roughness or
  // specular variation" the review read off the boulders, and no amount of
  // lighting can recover a lobe the map does not vary.
  float cavity = clamp(gVes * 0.85 + gFrac * 0.75, 0.0, 1.0);
  // Each fracture block quenched with its own glass content and takes its own
  // lobe; exposed faces are sand-blasted matte; the sheltered crevice floors
  // stay damp and are the glossiest thing on the rock. Wet-against-dry on one
  // object at one depth is exactly what rule 5 asks to be readable.
  rough = mix(0.50, 0.78, gBlock);
  rough = mix(rough, 0.90, smoothstep(0.45, 0.95, h) * 0.70);
  rough = mix(rough, 0.34, cavity * 0.80);
  // Settled ash is powder and kills the lobe wherever it lands.
  rough = mix(rough, 0.95, gDust * 0.85);
  rough += gOx * 0.06;
  metal = 0.0;
  armA = h;
}`;

/**
 * Basalt — cliffs, columnar rock, the dark end of the palette.
 *
 * The old version drew five hexagonal columns across the tile. At the terrain's
 * 8 m projection that is a 1.6 m honeycomb whose joints are the single loudest
 * frequency in the image; the FFT put its peak 60x above the local spectral
 * median in albedo and 250x in the normal map, and on screen it read as printed
 * chicken wire. Columnar jointing is right for Vvardenfell, but it has to be a
 * *texture* rather than a graphic: the columns are now nine across (0.9 m), the
 * joint darkening is a fraction of what it was, and three louder fields — spall
 * scars, a two-scale fracture network and grain — sit on top of it so no single
 * period owns the spectrum.
 *
 * Colour: #2a2622 -> #141312. Roughness 0.42 on wind-polished column faces
 * against 0.85 in the powdered joints, which is the ash-vs-basalt separation the
 * bar asks to be provable from shading alone.
 */
const basalt = /* glsl */ `
float gJoint, gColH, gColId, gWear, gPlateau, gSpall, gFracB, gGritB, gFineB, gChipB, gChipBId, gFaceB;
float mHeight(vec2 uv) {
  // The column lattice is *warped* before it is evaluated. hexCells wraps on
  // integer cell ids, and the warp is periodic, so the tile still tiles — but
  // the rows stop being straight, which is what a real cooling front does and
  // what stops the eye locking onto the lattice.
  //
  // The warp amplitude has to be of the order of one cell, not a tenth of one.
  // hexCells lays its rows at exact integer multiples of 1/n.y; with a small
  // warp the row structure survives as a pure tone, and the FFT saw it at 118x
  // the local median in the normal map — the same houndstooth defect, just at a
  // finer pitch. 0.11 uv against ten rows displaces a row by a full cell, which
  // spreads that line across the spectrum instead of concentrating it.
  vec2 wc = warp2(uv, vec2(3.0), 0.11, 91.0);
  vec4 hx = hexCells(wc, vec2(9.0, 10.0), 0.85, 31.0);
  float edge = hx.y - hx.x;
  gColId = hx.z;
  gColH = hx.w;
  gPlateau = smoothstep(0.002, 0.020, edge);
  // Not every joint is open: two thirds of them are welded or ash-filled, which
  // is both true of a real flow and the thing that stops the joint network
  // reading as a continuous drawn line.
  float open = smoothstep(0.30, 0.75, fbm(uv, vec2(7.0), 4, 0.5, 92.0) * 0.5 + 0.5);
  gJoint = (1.0 - smoothstep(0.0, 0.038, edge)) * (0.30 + 0.70 * open);
  gPlateau = mix(1.0, gPlateau, 0.35 + 0.65 * open);
  // Conchoidal spall scars: whole slabs have come off the face.
  vec2 ws = warp2(uv, vec2(4.0), 0.12, 93.0);
  vec3 sp = worleyUV(ws, vec2(6.0), 1.0, 95.0);
  gSpall = smoothstep(0.52, 0.16, sp.x) * step(0.45, sp.z);
  // Fracture network, decoupled from the columns so the two never rhyme.
  vec3 fr = worleyUV(warp(uv, vec2(9.0), 0.09, 97.0), vec2(21.0), 1.0, 99.0);
  gFracB = 1.0 - smoothstep(0.0, 0.030, fr.y - fr.x);
  float face = fbm(uv, vec2(21.0), 4, 0.5, 5.5) * 0.5 + 0.5;
  // Horizontal striae: each cooling increment left a chisel-like step.
  float stria = fbm(uv, vec2(6.0, 111.0), 3, 0.5, 8.8) * 0.5 + 0.5;
  gGritB = microGrain(uv, 66.0, 13.7);
  // Second grain decade plus angular spall chips. Measured, this set rendered
  // the lowest albedo Laplacian of the whole rock family (6.5 against volcanic
  // rock's 11.6): everything on it lived at or above the 9-column scale, so a
  // cliff foot two metres from the camera had no surface at all.
  gFineB = microGrain(uv, 132.0, 101.3);
  vec4 cb = clasts(uv, vec2(89.0), 0.32 + 0.30 * face, 0.12, 0.40, 102.7);
  gChipB = cb.x;
  gChipBId = cb.y;
  // Intra-column face variation, decorrelated from the column id, so a column
  // is a surface rather than a flat polygon of one value.
  gFaceB = fbm(warp(uv, vec2(11.0), 0.07, 103.1), vec2(29.0), 4, 0.5, 104.9) * 0.5 + 0.5;
  float top = 0.44 + gColH * 0.24 + face * 0.10 + stria * 0.06 + gGritB * 0.12
            + gFineB * 0.05 + gChipB * 0.05;
  // The joint floor is 0.30, not 0.05: a 0.4-deep step at every cell wall put a
  // 119x spectral spike into the normal map at the row frequency, which is the
  // same "regular lattice of dark blobs" defect one derivative removed. The
  // joints read from the albedo and the AO; they do not need to be a canyon.
  return clamp(mix(0.30, top, gPlateau) - gSpall * 0.14 - gFracB * 0.08, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  gWear = fbm(warp(uv, vec2(3.0), 0.10, 77.0), vec2(7.0), 5, 0.52, 2.9) * 0.5 + 0.5;
  float dust = smoothstep(0.42, 0.95, fbm(uv, vec2(13.0), 4, 0.5, 79.0) * 0.5 + 0.5);
  vec3 jet   = PAL(42.0, 38.0, 34.0);   // #2a2622
  vec3 deepC = PAL(20.0, 19.0, 18.0);   // #141312
  // Only faintly cool. A blue-grey at 0.42 mix put pale ice-coloured patches
  // across a material the bible calls near-black.
  vec3 sheen = PAL(72.0, 71.0, 70.0);
  vec3 stain = PAL(96.0, 62.0, 40.0);
  vec3 ashD  = PAL(116.0, 108.0, 96.0);
  // Base value varies column to column and within each column. gFaceB carries a
  // third of the weight so a column reads as a textured face, not a flat cell.
  // MACRO CONTRAST BUDGET.
  //
  // Measured on the shipped set: albedo luminance standard deviation 8.8 code
  // values over the tile at level 0, and about 2 by level 4 — and level 4 is
  // what a cliff face or a Daedric ruin forty metres out is actually sampled
  // from. Two code values is not a material, it is a solid fill, and "a uniform
  // mid-brown, hard-faceted mass with zero surface variation" is precisely what
  // two code values looks like on screen.
  //
  // The FREQUENCIES were not the problem and are deliberately not touched: gWear
  // is a 6-cycle field, gColId a 9-cycle one and dust a 12-cycle one, all of
  // which survive well past level 5, and this set is also a terrain splat layer,
  // which holds it to the >=9-cycle albedo band budget documented on ash (the
  // terrain reads the tile through a per-cell rotated frame, so a tile-scale
  // albedo feature becomes a visible cell mosaic). The AMPLITUDE was the
  // problem. Three independent [0,1] fields summed with weights that add to one
  // pile up hard around 0.5 — the sum has roughly a third of the spread of any
  // one of them — so a smoothstep over that composite only ever walks the middle
  // of the ramp and the darkest and the palest cooling units on the flow never
  // appear at all. Pre-emphasising the composite back out to its own range is
  // what turns an authored value range into a rendered one, and unlike adding an
  // octave it costs nothing, at any distance.
  float macroB = clamp(0.5 + (gColId * 0.30 + gWear * 0.36 + gFaceB * 0.34 - 0.5) * 2.2, 0.0, 1.0);
  albedo = mix(deepC * 0.64, jet, smoothstep(0.09, 0.82, macroB));
  albedo = mix(albedo, sheen, smoothstep(0.60, 1.0, macroB) * 0.44);
  // Fresh spall exposes unweathered glass — the lightest thing on the face.
  albedo = mix(albedo, sheen * 0.85, gSpall * 0.35);
  albedo = mix(albedo, mix(deepC, sheen, gChipBId), smoothstep(0.06, 0.55, gChipB) * 0.42);
  albedo = mix(albedo, deepC * 0.55, gJoint * 0.55 + gFracB * 0.40);
  albedo = mix(albedo, stain, smoothstep(0.58, 0.98, gWear) * gJoint * 0.45);
  // The ash mantle is a 12-cycle field and so is one of the two things on this
  // material still resolvable at distance; gating it entirely on the height
  // field spent it, because the height field is grain and is gone by level 3.
  // It keeps a height preference — ash lands on the ledges, not on the overhangs
  // — but no longer needs the height to be high to exist at all.
  albedo = mix(albedo, ashD, dust * 0.28 * (0.45 + 0.55 * smoothstep(0.35, 0.85, h)));
  albedo *= 0.58 + 0.54 * gGritB + 0.30 * gFineB;
  // Wind-polished basalt glass takes a real specular lobe; the joints are
  // powdered rock flour and take none. This contrast against ash at 0.9 is the
  // material differentiation the bar wants visible in every frame.
  //
  // The polished face was 0.42, which put the set's mean at 0.56 — below the
  // 0.60-0.75 band the bar names for basalt, i.e. glossier than basalt should
  // ever be, while ash sits at 0.86. 0.50 lands the mean at the bottom of the
  // named band without touching the face-to-joint contrast, which is the part
  // that has to stay readable.
  rough = mix(0.85, 0.50 + gWear * 0.10, gPlateau * (1.0 - gFracB * 0.6));
  rough = mix(rough, 0.90, dust * 0.5);
  metal = 0.0;
  armA = h;
}`;

const sand = /* glsl */ `
float gMica, gMottle, gRipple, gGrainS, gShell;
float mHeight(vec2 uv) {
  vec2 w = warp2(uv, vec2(6.0), 0.07, 41.0);
  // Integer frequency keeps the ripple train seamless across the tile edge; the
  // warp is what stops it reading as a sine grating.
  // Phase-modulated hard: an unwarped sine train is a single spectral line, and
  // a single spectral line on a beach reads as corduroy.
  gRipple = pow(sin(TAU * (w.y * 26.0 + fbm(uv, vec2(6.0, 12.0), 3, 0.5, 43.0) * 1.6)) * 0.5 + 0.5, 1.2);
  float dunes = fbm(uv, vec2(3.0, 6.0), 5, 0.5, 5.0) * 0.5 + 0.5;
  gGrainS = microGrain(uv, 72.0, 6.0);
  gMica = smoothstep(0.90, 0.995, worleyUV(uv, vec2(240.0), 1.0, 20.0).z);
  // Shell hash and pebble litter along the strand.
  vec4 sh = clasts(uv, vec2(41.0), 0.13, 0.10, 0.34, 21.0);
  gShell = sh.x * sh.y;
  return clamp(dunes * 0.36 + gRipple * 0.30 * (0.4 + 0.6 * dunes)
             + gGrainS * 0.20 + gShell * 0.10, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  gMottle = fbm(uv, vec2(9.0), 5, 0.5, 7.0) * 0.5 + 0.5;
  vec3 lit  = PAL(158.0, 145.0, 122.0);
  vec3 dark = PAL( 86.0,  74.0,  60.0);
  vec3 grey = PAL(112.0, 112.0, 111.0);
  albedo = mix(dark, lit, smoothstep(0.24, 0.82, h * 0.4 + gMottle * 0.6));
  // Black sand streaks: magnetite winnowed out of the ash by the tide.
  albedo = mix(albedo, grey, smoothstep(0.50, 0.94, fbm(uv, vec2(6.0), 3, 0.5, 8.0) * 0.5 + 0.5) * 0.5);
  albedo = mix(albedo, PAL(208.0, 200.0, 186.0), gShell * 0.7);
  albedo = mix(albedo, PAL(198.0, 194.0, 188.0), gMica * 0.5);
  albedo *= 0.76 + 0.42 * gGrainS;
  rough = 0.89 - 0.50 * gMica - 0.04 * gMottle - 0.10 * gShell;
  metal = 0.0;
  armA = h;
}`;

const mud = /* glsl */ `
float gCrack, gPlate, gWet, gSilt;
float mHeight(vec2 uv) {
  vec2 w = warp(uv, vec2(6.0), 0.07, 51.0);
  vec3 c = worleyUV(w, vec2(10.0), 0.95, 22.0);
  float edge = c.y - c.x;
  gCrack = 1.0 - smoothstep(0.0, 0.11, edge);
  gPlate = c.z;
  // Drying plates curl up at the rim before the crack cuts through.
  float lip = smoothstep(0.22, 0.06, edge) * (1.0 - gCrack);
  float base = fbm(uv, vec2(3.0), 5, 0.5, 2.0) * 0.5 + 0.5;
  gSilt = microGrain(uv, 66.0, 3.0);
  return clamp(0.46 + base * 0.22 + lip * 0.12 + gPlate * 0.06 + gSilt * 0.09 - gCrack * 0.44, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  gWet = smoothstep(0.55, 0.12, h);
  vec3 wet = PAL( 40.0,  34.0,  29.0);
  vec3 dry = PAL(116.0, 103.0,  85.0);
  vec3 alg = PAL( 78.0,  80.0,  58.0);
  albedo = mix(wet, dry, smoothstep(0.30, 0.88, h) * (0.55 + 0.45 * gPlate));
  albedo = mix(albedo, alg, smoothstep(0.6, 0.96, fbm(uv, vec2(9.0), 4, 0.5, 4.0) * 0.5 + 0.5) * 0.35);
  albedo *= 0.78 + 0.40 * gSilt;
  // Standing water in the cracks against a dried, dusty plate top: the clearest
  // wet-vs-dry read in the library, and it has to survive to the frame.
  rough = mix(0.90, 0.22, gWet);
  metal = 0.0;
  armA = h;
}`;

const lichenGrass = /* glsl */ `
float gTuft, gTuftId, gLum, gLich, gRustL, gGrainG, gFineL, gFib, gPebL, gPebLId, gSoil;
float mHeight(vec2 uv) {
  vec2 w = warp2(uv, vec2(6.0), 0.10, 61.0);
  // Tufts grow in patches with a spread of sizes, not one per lattice cell.
  float dens = 0.22 + 0.50 * smoothstep(0.28, 0.86, fbm(uv, vec2(5.0), 4, 0.5, 63.0) * 0.5 + 0.5);
  vec4 t1 = clasts(w, vec2(11.0), dens * 0.7, 0.18, 0.70, 33.0);
  vec4 t2 = clasts(w, vec2(27.0), dens,       0.14, 0.52, 34.0);
  gTuft = clamp(max(t1.x * (0.5 + 0.5 * t1.y), t2.x * 0.72), 0.0, 1.0);
  gTuftId = t1.x * (0.5 + 0.5 * t1.y) > t2.x * 0.72 ? t1.y : t2.y;
  // Blades. Two fibre trains at right angles, mixed by the tuft id, so
  // neighbouring tufts lie in different directions instead of the whole tile
  // combing one way — which is what turns ground cover into brushed metal when
  // the tile lands on a slope.
  float fA = fbm(uv, vec2(48.0, 144.0), 3, 0.5, 4.0) * 0.5 + 0.5;
  float fB = fbm(uv, vec2(138.0, 51.0), 3, 0.5, 8.6) * 0.5 + 0.5;
  gFib = mix(fA, fB, smoothstep(0.3, 0.7, gTuftId));
  gLich = fbm(w, vec2(15.0), 5, 0.52, 5.0) * 0.5 + 0.5;
  gGrainG = microGrain(uv, 54.0, 66.0);
  gFineL = microGrain(uv, 123.0, 12.9);
  // The ash this lichen grows on, showing between the tufts: grit and small
  // stones. Without it the material was a single soft ochre field — measured at
  // an albedo standard deviation of 6.5, the lowest in the library, on the
  // surface that carries the entire foreground of the vale shot.
  gSoil = 1.0 - smoothstep(0.05, 0.45, gTuft);
  vec4 pb = clasts(uv, vec2(53.0), 0.34, 0.12, 0.44, 77.0);
  gPebL = pb.x * gSoil;
  gPebLId = pb.y;
  // Sparse: a handful of fruiting bodies per tile, not a spray of confetti.
  // Bioluminescence is one of only two things in the bible allowed to be vivid,
  // which is exactly why it has to be rationed — the same discipline the ember
  // in lava_crust just had to be put back under.
  vec4 l = clasts(uv, vec2(19.0), 0.028, 0.07, 0.20, 44.0);
  gLum = l.x;
  return clamp(0.18 + gTuft * 0.42 + gFib * 0.18 * gTuft + gLich * 0.13
             + gGrainG * 0.10 + gFineL * 0.05 + gPebL * 0.09 + gLum * 0.08, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  // Vvardenfell ground cover is lichen on ash, not meadow: ochre, grey-green
  // and rust. Nothing here is lush, and the glow is an accent, not a colour.
  gRustL = smoothstep(0.62, 0.95, fbm(uv, vec2(12.0), 4, 0.5, 9.0) * 0.5 + 0.5);
  vec3 dust  = PAL(112.0, 105.0,  94.0);
  vec3 soil  = PAL( 76.0,  70.0,  62.0);
  vec3 moss  = PAL( 92.0, 100.0,  62.0);
  vec3 mossD = PAL( 52.0,  60.0,  36.0);
  vec3 crust = PAL(146.0, 139.0, 106.0);
  vec3 rustL = PAL(126.0,  76.0,  40.0);
  vec3 stone = PAL( 58.0,  55.0,  51.0);
  vec3 lum   = PAL( 92.0, 214.0, 196.0);
  vec3 sere  = PAL(158.0, 142.0,  96.0);
  vec3 shade = PAL( 34.0,  34.0,  26.0);
  // Bare ash first, then the cover on top of it, so the gaps read as ground.
  albedo = mix(dust, soil, gSoil * 0.45);
  // Each tuft is at its own point in the season: some green, some gone over to
  // straw. The old version gave every tuft the same two-stop ramp, which is why
  // the measured albedo standard deviation was 9.5 — the lowest in the library,
  // on the surface that carries the whole foreground of the vale shot.
  vec3 tuftC = mix(mossD, moss, 0.25 + 0.75 * gFib);
  tuftC = mix(tuftC, sere, smoothstep(0.42, 0.95, gTuftId) * 0.80);
  albedo = mix(albedo, tuftC, gTuft * 0.90);
  // The litter and shadow down between the blades, where no light reaches.
  albedo = mix(albedo, shade, smoothstep(0.55, 0.05, gTuft) * gTuft * 0.55);
  albedo = mix(albedo, crust, smoothstep(0.48, 0.94, gLich) * 0.55);
  albedo = mix(albedo, rustL, gRustL * 0.45);
  albedo = mix(albedo, mix(stone, dust, gPebLId), smoothstep(0.05, 0.5, gPebL) * 0.72);
  albedo = mix(albedo, lum, gLum * 0.70);
  albedo *= 0.52 + 0.68 * gGrainG + 0.26 * gFineL;
  // Living blades are waxy and take a real sheen at a grazing sun; dead straw
  // and the ash between the tufts take none. A 0.44-to-0.96 spread inside one
  // material is the differentiation rule 5 asks to be readable from shading.
  rough = mix(0.96, 0.44, gTuft * (1.0 - smoothstep(0.42, 0.95, gTuftId) * 0.65));
  rough -= gLum * 0.25 + 0.14 * gPebL;
  metal = 0.0;
  armA = h;
}`;

/**
 * Chilled lava crust with live fissures.
 *
 * The ARM alpha used to carry an inverted emissive mask here as a documented
 * exception to the rest of the library. That exception was the reason no ember
 * ever reached the frame: every consumer — the terrain splat included — reads
 * the alpha as a displacement and drives its emissive from `1 - height`, which
 * with an emissive mask in the slot put the glow on the plate tops and zeroed it
 * inside the cracks, i.e. exactly backwards. Making the alpha an honest height
 * with the fissures at the bottom of it satisfies both readings at once: the
 * height blend interlocks the crust against ash the way it does for every other
 * set, and `1 - height` peaks precisely along the fissure network.
 */
const lavaCrust = /* glsl */ `
float gFis, gRope, gDust, gGritL, gGlow, gWhite, gPlateId, gCrumb;
float mHeight(vec2 uv) {
  vec2 w = warp2(uv, vec2(3.0), 0.17, 71.0);
  vec3 c1 = worleyUV(w, vec2(7.0),  0.95, 55.0);
  vec3 c2 = worleyUV(warp(uv, vec2(9.0), 0.09, 57.0), vec2(23.0), 0.95, 56.0);
  gPlateId = c1.z;
  // Cold seams: hairlines. 0.070 across a 7-cell network is a drawn line four
  // times the width of the thing it represents, and at the terrain's tiling it
  // was the loudest signal in the frame.
  float crack = max(1.0 - smoothstep(0.0, 0.032, c1.y - c1.x),
                   (1.0 - smoothstep(0.0, 0.024, c2.y - c2.x)) * 0.55);
  // Which stretches are still venting.
  //
  // The review of iter4 measured ember-orange hooks and loops at 20-30 px
  // spacing carpeting the entire foreground of the ridge shot, and it is right
  // that this is the single worst art-direction failure in the build: the bible
  // reserves ember for fissures and emissives and says the fact that ember and
  // bioluminescence are the ONLY saturated things is the whole look. Painting
  // the ground with it destroys the contrast it exists to create.
  //
  // The cause was here, and it was structural rather than a tuning miss. "live"
  // opened on the top ~28% of a slow field and gGlow started at crack = 0.38,
  // so the glow covered a *fraction of the whole crack network* — and both
  // consumers of this set read it: the albedo carries the orange directly, and
  // the terrain drives its emissive from pow(1 - height, 3), which the 0.62
  // depth dip fired along every one of those metres.
  //
  // Now: the vent mask takes the top few per cent of the field, and the glow is
  // confined to the innermost core of a crack rather than its whole width. The
  // product puts hot pixels at well under 1% of the tile, which is what "an
  // authored fissure layer at well under 1% of screen area" means when the
  // fissures have to come out of a tiling texture.
  float live = smoothstep(0.74, 0.95, fbm(uv, vec2(4.0), 4, 0.52, 58.0) * 0.5 + 0.5);
  gFis = crack;
  gGlow = smoothstep(0.70, 1.0, crack) * live;
  gWhite = smoothstep(0.88, 1.0, crack) * live * live;
  // Pahoehoe ropes: transverse folds in the chilled skin, dragged by the flow.
  float flow = fbm(uv, vec2(3.0, 6.0), 4, 0.5, 12.0) + fbm(uv, vec2(9.0, 18.0), 3, 0.5, 16.0) * 0.6;
  gRope = sin(TAU * (uv.y * 14.0 + flow * 2.6)) * 0.5 + 0.5;
  float plate = fbm(w, vec2(6.0), 5, 0.5, 13.0) * 0.5 + 0.5;
  gGritL = microGrain(uv, 60.0, 14.0);
  // Spalled crust: the chilled skin breaks up into angular crumbs, which is the
  // near-plane debris this material owes the frame now that it is not spending
  // its whole contrast budget on glow.
  vec4 cr = clasts(uv, vec2(71.0), 0.30 + 0.34 * plate, 0.12, 0.42, 59.0);
  gCrumb = cr.x;
  // A chilled crack is a shallow seam; only a fissure that is still venting is
  // a canyon. Splitting the depth this way is what puts the ember exactly where
  // the glow is and nowhere else — and the dip now tracks gGlow, not "crack",
  // so a cold seam no longer asks a consumer to light it.
  return clamp(0.70 + plate * 0.14 + gRope * 0.08 * (1.0 - crack) + gGritL * 0.08
             + gCrumb * 0.07 - crack * 0.07 - gGlow * 0.58, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  gDust = smoothstep(0.44, 0.95, fbm(uv, vec2(11.0), 4, 0.5, 15.0) * 0.5 + 0.5) * (0.5 + 0.5 * gRope);
  // Basalt, per the bible: #2a2622 -> #141312. A chilled flow is black rock
  // with grey ash on it. Anything warm in here is the exception, not the field.
  vec3 skin  = PAL( 42.0,  38.0,  34.0);   // #2a2622
  vec3 deepC = PAL( 20.0,  19.0,  18.0);   // #141312
  vec3 ashy  = PAL(102.0,  95.0,  85.0);
  vec3 charr = PAL(  8.0,   7.0,   7.0);
  vec3 hot   = PAL(196.0,  85.0,  31.0);   // #c4551f
  vec3 flame = PAL(255.0, 122.0,  42.0);   // #ff7a2a
  vec3 core  = PAL(255.0, 224.0, 168.0);
  albedo = mix(deepC, skin, smoothstep(0.10, 0.88, gPlateId * 0.45 + h * 0.55));
  albedo = mix(albedo, ashy, gDust * 0.72);
  albedo = mix(albedo, charr, gFis * 0.6);
  albedo = mix(albedo, albedo * mix(0.55, 1.35, gCrumb), smoothstep(0.05, 0.6, gCrumb) * 0.6);
  // Ember, and only ember: three nested bands inside the core of a live vent.
  albedo = mix(albedo, hot, gGlow * 0.75);
  albedo = mix(albedo, flame, gGlow * gGlow * 0.8);
  albedo = mix(albedo, core, gWhite * 0.75);
  albedo *= 0.68 + 0.52 * gGritL;
  rough = mix(0.34, 0.93, gDust) * (1.0 - gWhite * 0.4);
  metal = 0.0;
  // Height, like every other set in this library. The fissures sit at the
  // bottom of it, so any consumer driving an emissive from (1 - height) lights
  // the cracks and nothing else.
  armA = h;
}`;

const snow = /* glsl */ `
float gSpark, gCrust;
float mHeight(vec2 uv) {
  vec2 w = warp(uv, vec2(3.0), 0.10, 81.0);
  float drift = fbm(w, vec2(3.0, 6.0), 4, 0.55, 2.0) * 0.5 + 0.5;
  float sastrugi = ridged(w, vec2(12.0, 6.0), 3, 0.5, 3.0);
  gCrust = fbm(uv, vec2(96.0), 3, 0.5, 4.0) * 0.5 + 0.5;
  float grain = fbm(uv, vec2(288.0), 2, 0.5, 5.0) * 0.5 + 0.5;
  gSpark = smoothstep(0.93, 1.0, worleyUV(uv, vec2(300.0), 1.0, 66.0).z);
  return clamp(drift * 0.45 + sastrugi * 0.27 + gCrust * 0.17 + grain * 0.11, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  vec3 lit = PAL(236.0, 239.0, 246.0);
  vec3 pit = PAL(168.0, 183.0, 206.0);
  vec3 ash = PAL(138.0, 132.0, 126.0);
  albedo = mix(pit, lit, smoothstep(0.22, 0.86, h));
  // Nowhere on this island is snow clean; ashfall greys the windward faces.
  albedo = mix(albedo, ash, smoothstep(0.52, 0.94, fbm(uv, vec2(6.0), 4, 0.5, 7.0) * 0.5 + 0.5) * 0.45);
  rough = mix(0.58, 0.30, smoothstep(0.4, 0.92, h)) - gSpark * 0.22;
  metal = 0.0;
  armA = h;
}`;

/**
 * Quarried tuff ashlar — Dwemer plate, Redoran revetment, every cut wall.
 *
 * The previous version put 3.7% of its albedo energy above 48 cycles per tile
 * and rendered a Laplacian of 4.9: at the 1.1 m tiling architecture uses, a
 * 250 px quad of it two metres from the camera is a value ramp with nothing in
 * it, which is exactly what the review measured off the Dwemer front plate.
 * Everything it had lived at the block scale. It also put a 108x spectral spike
 * at 54 cycles — the chisel train, whose phase warp was 2.2 radians, a third of
 * a cycle, far too little to de-phase a pure tone.
 *
 * Now: the chisel phase is warped by more than a full cycle and its amplitude is
 * gated by a per-block field, so the strokes crowd and fade rather than combing
 * every block at one pitch; and three decades of quarry grit, vesicular pitting
 * and frost spall carry the 5-30 mm band the near plane was missing.
 */
const cutStone = /* glsl */ `
float gJoint, gBlock, gPit, gChip, gChisel, gGritS, gFineS, gVug, gVugId, gSpallS, gSalt;
float mHeight(vec2 uv) {
  vec4 b = brickCells(uv, vec2(3.0, 6.0), 1.0, 77.0);
  gJoint = 1.0 - smoothstep(0.005, 0.024, b.w);
  gBlock = b.z;
  // Block-local coordinates need no periodicity of their own, so the chisel
  // strokes can be freely rotated per block — the joints hide the seams.
  vec2 lp = vec2(b.x, b.y) - 0.5;
  vec2 rp = rot2((b.z - 0.5) * 1.3) * lp;
  // Phase warp of 9 radians is 1.4 cycles: enough to move a stroke past its
  // neighbour, which is what spreads the train across a band of the spectrum
  // instead of concentrating it in one line. Amplitude is gated per block, so a
  // third of the wall is dressed smooth and takes no strokes at all.
  float chAmp = smoothstep(0.22, 0.78, fbm(uv, vec2(6.0), 3, 0.5, 44.0) * 0.5 + 0.5);
  gChisel = pow(sin(rp.y * 96.0 + psnoise3(vec3(rp * 14.0, b.z * 40.0), vec3(0.0)) * 9.0) * 0.5 + 0.5, 1.4)
          * (0.20 + 0.80 * chAmp);
  gPit = fbm(uv, vec2(96.0), 3, 0.5, 9.0) * 0.5 + 0.5;
  gChip = smoothstep(0.36, 0.78, fbm(uv, vec2(48.0), 3, 0.5, 10.0) * 0.5 + 0.5);
  // Vugs: a welded tuff is full of collapsed pumice casts. Two decades through
  // clasts rather than a thresholded Worley, so most cells are empty and the
  // radii are power-law instead of a printed dot screen.
  float dens = 0.26 + 0.40 * smoothstep(0.30, 0.86, fbm(uv, vec2(7.0), 3, 0.5, 45.0) * 0.5 + 0.5);
  vec4 v1 = clasts(uv, vec2(43.0),  dens * 0.8, 0.10, 0.40, 46.0);
  vec4 v2 = clasts(uv, vec2(101.0), dens * 1.2, 0.10, 0.32, 47.0);
  gVug = clamp(max(v1.x, v2.x * 0.7), 0.0, 1.0);
  gVugId = v1.x > v2.x * 0.7 ? v1.y : v2.y;
  // Frost spall: shallow flakes off the exposed face, brighter because the
  // stone under them has not weathered.
  gSpallS = smoothstep(0.58, 0.20, worleyUV(warp(uv, vec2(9.0), 0.10, 48.0), vec2(15.0), 1.0, 49.0).x)
          * step(0.62, fbm(uv, vec2(6.0), 3, 0.5, 50.0) * 0.5 + 0.5);
  gSalt = smoothstep(0.56, 0.95, fbm(warp(uv, vec2(6.0), 0.08, 51.0), vec2(9.0), 4, 0.5, 52.0) * 0.5 + 0.5);
  gGritS = microGrain(uv, 54.0, 53.0);
  gFineS = microGrain(uv, 118.0, 54.0);
  float bevel = smoothstep(0.0, 0.030, b.w);
  float face = 0.58 + (b.z - 0.5) * 0.06 + gChisel * 0.12 + gPit * 0.05
             + gGritS * 0.10 + gFineS * 0.05 - gVug * 0.16 - gSpallS * 0.07;
  return clamp(mix(0.22, face, bevel * (1.0 - gChip * 0.35)) - gJoint * 0.10, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  // Streaks: high frequency across, low along, so the wash runs down the wall.
  float streak = fbm(uv, vec2(24.0, 3.0), 4, 0.5, 11.0) * 0.5 + 0.5;
  vec3 tuff   = PAL(150.0, 142.0, 124.0);
  vec3 tuff2  = PAL( 98.0,  90.0,  78.0);
  vec3 mortar = PAL( 76.0,  71.0,  65.0);
  vec3 soot   = PAL( 44.0,  40.0,  38.0);
  vec3 vugC   = PAL( 40.0,  36.0,  32.0);
  vec3 clast  = PAL(126.0, 112.0,  92.0);
  vec3 fresh  = PAL(172.0, 164.0, 146.0);
  vec3 saltC  = PAL(206.0, 202.0, 192.0);
  // Blocks were quarried from different beds, so each has its own value.
  albedo = mix(tuff2, tuff, smoothstep(0.15, 0.9, gBlock) * 0.8 + gPit * 0.2);
  albedo *= 0.88 + 0.22 * gChisel;
  // Lithic fragments in the tuff: a pale rim of collapsed pumice around a dark
  // throat is what makes a vug read as a hole rather than as a printed spot.
  albedo = mix(albedo, mix(vugC, clast, gVugId), smoothstep(0.05, 0.55, gVug) * 0.70);
  albedo = mix(albedo, fresh, gSpallS * 0.45);
  albedo = mix(albedo, saltC, gSalt * 0.22 * (1.0 - gJoint));
  albedo = mix(albedo, mortar, gJoint);
  albedo = mix(albedo, soot, smoothstep(0.52, 0.96, streak) * 0.5 * (1.0 - gJoint));
  albedo *= 0.56 + 0.58 * gGritS + 0.30 * gFineS;
  // A dressed face is polished by the chisel and by four centuries of weather;
  // fresh spall is raw crystal; the joints are lime mortar and take nothing.
  rough = mix(0.78, 0.58, smoothstep(0.30, 0.90, gChisel) * (1.0 - gVug * 0.6));
  rough = mix(rough, 0.90, gSpallS * 0.7 + gSalt * 0.5);
  rough = mix(rough, 0.94, gJoint);
  rough += gPit * 0.05 + gVug * 0.06;
  metal = 0.0;
  armA = h;
}`;

/**
 * Lime render over earth daub on a reed lath — every village hut in the frame.
 *
 * Measured on the previous version this was the flattest material in the
 * library by a wide margin: 2.0% of its albedo energy above 48 cycles per tile
 * (against sand's 51%), a rendered Laplacian of 2.6, a normal-map standard
 * deviation of 12.6 and a ROUGHNESS standard deviation of 0.008 — a
 * mathematically constant specular lobe on the surface a whole village is made
 * of. That is precisely the "smooth-shaded untextured clay" the review read off
 * the huts, and it was structural rather than a tuning miss:
 *
 *   - only two fields (a 6-cycle trowel fBm and a 12-cycle swirl) ever reached
 *     the albedo, and both live at the tile scale, so 74% of the energy sat
 *     below 8 cycles and there was nothing at all for the near plane;
 *   - the one high-frequency term, `tooth`, was an fBm at 288 cycles, which is
 *     under two texels on the shipped map and is annihilated by the first mip
 *     before it can reach a pixel;
 *   - roughness was `mix(0.74, 0.93, gChip)` where gChip is zero over ~90% of
 *     the tile, i.e. the constant 0.74.
 *
 * Rebuilt around what the substance actually is: three decades of sand and grit
 * aggregate in the binder, a spall network that exposes daub and then reed lath,
 * efflorescent salt bloom, and a roughness *field* that separates burnished
 * trowel face (0.54) from chalky bloom (0.97) from damp crazing (0.62).
 */
const plaster = /* glsl */ `
float gCraze, gChip, gTrowel, gFloatP, gAgg, gAggId, gGrainPl, gFinePl, gBloom, gLath, gDeepP, gLip;
float mHeight(vec2 uv) {
  vec2 w = warp2(uv, vec2(6.0), 0.05, 91.0);
  gTrowel = fbm(w, vec2(6.0), 4, 0.5, 2.0) * 0.5 + 0.5;
  gFloatP = ridged(w, vec2(12.0), 4, 0.55, 3.0);
  // Aggregate. A lime render is sand and grit held in a binder, and the grit is
  // the entire reason the surface has tooth. Three decades — roughly 3 cm, 1.5 cm
  // and 7 mm at the 1.3 m tiling architecture uses — so the size distribution is
  // continuous instead of one screen, and every decade writes to ALBEDO as well
  // as to height so the wall still reads when the light is flat.
  float dens = 0.42 + 0.40 * smoothstep(0.25, 0.85, fbm(uv, vec2(5.0), 3, 0.5, 12.0) * 0.5 + 0.5);
  vec4 a1 = clasts(uv, vec2(37.0),  dens * 0.7, 0.10, 0.34, 21.0);
  vec4 a2 = clasts(uv, vec2(79.0),  dens,       0.10, 0.30, 22.0);
  vec4 a3 = clasts(uv, vec2(151.0), dens * 1.3, 0.12, 0.34, 23.0);
  gAgg = max(a1.x, max(a2.x * 0.85, a3.x * 0.62));
  gAggId = a1.x > a2.x * 0.85 ? a1.y : (a2.x * 0.85 > a3.x * 0.62 ? a2.y : a3.y);
  gGrainPl = microGrain(uv, 52.0, 4.0);
  gFinePl  = microGrain(uv, 116.0, 87.0);
  vec3 c = worleyUV(warp(uv, vec2(12.0), 0.05, 5.0), vec2(13.0), 1.0, 88.0);
  // Crazing only appears where the render dried too fast, in patches.
  gCraze = (1.0 - smoothstep(0.0, 0.030, c.y - c.x))
         * smoothstep(0.38, 0.80, fbm(uv, vec2(6.0), 3, 0.5, 6.0) * 0.5 + 0.5);
  // Spalled render, in three nested bands off one field: a slightly proud arris
  // where the skin is about to let go, bare daub where it has, and reed lath
  // where the blow went right through. Three substances on one wall is the
  // differentiation rule 5 asks to be readable from shading alone.
  float blow = fbm(warp(uv, vec2(6.0), 0.09, 7.0), vec2(9.0), 4, 0.5, 71.0) * 0.5 + 0.5;
  gChip = smoothstep(0.62, 0.80, blow);
  gDeepP = smoothstep(0.78, 0.94, blow);
  gLip  = smoothstep(0.55, 0.63, blow) * (1.0 - gChip);
  gLath = pow(sin(TAU * (uv.y * 27.0 + fbm(uv, vec2(6.0, 12.0), 3, 0.5, 9.0) * 2.4)) * 0.5 + 0.5, 2.2) * gDeepP;
  // Efflorescence: salts wicked out of the daub and dried as a chalky bloom.
  gBloom = smoothstep(0.52, 0.94, fbm(warp(uv, vec2(5.0), 0.10, 10.0), vec2(7.0), 4, 0.5, 11.0) * 0.5 + 0.5);
  return clamp(0.60 + gTrowel * 0.12 + gFloatP * 0.07 + gAgg * 0.11
             + gGrainPl * 0.10 + gFinePl * 0.05 + gLip * 0.06 + gLath * 0.05
             - gCraze * 0.24 - gChip * 0.18 - gDeepP * 0.16, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  vec3 lime  = PAL(202.0, 198.0, 187.0);
  vec3 wash  = PAL(152.0, 133.0, 106.0);
  vec3 daub  = PAL( 98.0,  78.0,  58.0);
  vec3 reed  = PAL(126.0, 100.0,  60.0);
  vec3 grit  = PAL(128.0, 120.0, 106.0);
  vec3 salt  = PAL(224.0, 221.0, 212.0);
  vec3 deepP = PAL( 54.0,  46.0,  38.0);
  albedo = mix(wash, lime, smoothstep(0.22, 0.88, gTrowel * 0.6 + gFloatP * 0.4));
  // Every grain of aggregate is its own mineral, from dark scoria to pale quartz.
  albedo = mix(albedo, mix(deepP, grit, 0.15 + 0.85 * gAggId), smoothstep(0.05, 0.50, gAgg) * 0.55);
  albedo = mix(albedo, daub, gChip * 0.85);
  albedo = mix(albedo, reed, gLath * 0.65);
  albedo = mix(albedo, salt, gBloom * 0.30 * (1.0 - gChip));
  albedo = mix(albedo, albedo * 0.50, gCraze * 0.85);
  albedo *= 0.62 + 0.50 * gGrainPl + 0.24 * gFinePl;
  // Roughness as a FIELD, not a gate on a mask that is zero nearly everywhere.
  // A trowel burnishes the binder to the surface and that face takes a real
  // grazing sheen; bloom is chalk and kills the lobe; bare daub is earth; a
  // crazing seam holds damp long after the face has dried.
  rough = mix(0.86, 0.54, smoothstep(0.28, 0.92, gTrowel) * (1.0 - gAgg * 0.70));
  rough = mix(rough, 0.97, gBloom * 0.85);
  rough = mix(rough, 0.90, gChip * 0.80);
  rough = mix(rough, 0.62, gCraze * 0.55);
  rough += 0.05 * gAgg;
  metal = 0.0;
  armA = h;
}`;

const chitin = /* glsl */ `
float gSegY, gPlateR, gRib, gEdge, gLam, gPore, gPoreId, gScuff, gDustC, gStipple;
float mHeight(vec2 uv) {
  // Segmented carapace: overlapping plates, each curved, finely ribbed along
  // its length and banded across it. Six segments is the scale at which the
  // eye reads "insect" rather than "crazed enamel".
  const float SEG = 6.0;
  // The plate boundary has to undulate by an appreciable fraction of a segment.
  // At 0.10 it was a ruled line across the tile, and a ruled line is a pure tone
  // in the same spectrum the rib train lives in.
  float sy = uv.y * SEG + fbm(uv, vec2(3.0, 6.0), 4, 0.5, 2.0) * 0.30;
  float si = floor(sy);
  gSegY = sy - si;
  gPlateR = hash32(vec2(mod(si, SEG), 0.0), 111.0).x;
  float curve = pow(sin(clamp(gSegY, 0.0, 1.0) * 3.14159265), 0.55);
  // Each plate slides under the one below it, so the trailing edge is sharp.
  gEdge = smoothstep(0.0, 0.05, gSegY) * smoothstep(0.0, 0.16, 1.0 - gSegY);
  // Ribbing along the plate.
  //
  // A constant-period sine across x crossed with a constant-period sine along
  // y is a GRID, and a grid at this pitch renders as burlap: the review found
  // "an unmistakable regular diagonal woven/knit grid, roughly a 6px repeat"
  // and this pair of lines is where it came from. Two independent pure tones at
  // right angles is the one construction that cannot be saved by tuning, so
  // neither survives: the rib phase is warped by well over a full cycle and its
  // amplitude is gated by a metre-scale field, so the ridges wander, crowd and
  // fade out instead of combing the whole tile at one frequency.
  float ribPhase = uv.x * 22.0 + fbm(uv, vec2(6.0, 12.0), 4, 0.5, 3.0) * 2.8;
  float ribAmp = smoothstep(0.26, 0.84, fbm(uv, vec2(6.0, 9.0), 3, 0.5, 17.0) * 0.5 + 0.5);
  gRib = pow(sin(TAU * ribPhase) * 0.5 + 0.5, 1.8) * (0.25 + 0.75 * ribAmp);
  // Growth lines across the plate. A ridged multifractal rather than a sine, so
  // the second axis contributes a band of frequencies for the first to sit in
  // rather than a single line for it to beat against.
  gLam = pow(ridged(uv, vec2(6.0, 63.0), 3, 0.55, 19.0), 1.3);
  // Punctures. The old version dropped these into the height field at 0.07 and
  // never mentioned them in the albedo, which is why the rendered map came back
  // with a Laplacian of 0.97 — an order of magnitude flatter than any other set
  // in the library, on the material the Telvanni pod shells and every insect
  // carapace are made of. A shell with no surface is why the review could not
  // tell chitin from ash from bark.
  vec4 pr = clasts(uv, vec2(64.0), 0.46, 0.10, 0.36, 113.0);
  gPore = pr.x;
  gPoreId = pr.y;
  gStipple = microGrain(uv, 108.0, 118.0);
  // Scuffs: a carapace that has been through an ash storm is not showroom.
  gScuff = smoothstep(0.60, 0.96, fbm(uv, vec2(31.0, 7.0), 4, 0.5, 116.0) * 0.5 + 0.5);
  return clamp(0.26 + curve * 0.42 + gRib * 0.11 * gEdge + gLam * 0.05
             + gStipple * 0.07 - gPore * 0.10 - gScuff * 0.05, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  // PALETTE. The bible gives chitin/bone as #d8c9a4 -> #8f7d5a and says
  // architecture and armour are made of it. The previous ramp ran
  // #221a1b -> #603618, i.e. a dark red-brown: measured on the rendered map its
  // mean was (64,42,30), two stops below the darker end of the band and off its
  // hue entirely. Warm-lit and lifted, that is the salmon the review found on
  // the pods and could not place in the palette, because it is not in it.
  vec3 shell = PAL(143.0, 125.0,  90.0);   // #8f7d5a
  vec3 pale  = PAL(216.0, 201.0, 164.0);   // #d8c9a4
  vec3 deepC = PAL( 74.0,  63.0,  44.0);
  vec3 pit   = PAL( 44.0,  37.0,  27.0);
  vec3 wax   = PAL(232.0, 220.0, 192.0);
  vec3 dustC = PAL(122.0, 114.0, 102.0);
  // Baked thin-film interference. A real elytron's colour comes from a stack of
  // quarter-wave layers whose thickness drifts *slowly* across the shell, so
  // the driving field must sweep well under one full cycle per tile — a whole
  // cycle per segment is what turns a beetle into a rainbow zebra.
  float t = gPlateR * 0.55 + gSegY * 0.20 + gLam * 0.05
          + fbm(uv, vec2(3.0), 3, 0.5, 4.0) * 0.40;
  vec3 irid = 0.5 + 0.5 * cos(TAU * (vec3(t) + vec3(0.0, 0.28, 0.55)));
  // Desaturate hard and bias to the violet/teal end. Saturation discipline: only
  // lava and bioluminescence may be vivid, and a full-chroma cosine palette
  // multiplied into an 8-bit albedo is also where channel-asymmetric colour
  // noise comes from once anything lifts the exposure.
  irid = mix(vec3(dot(irid, vec3(0.3333))), irid, 0.22);
  irid *= vec3(0.86, 0.96, 1.0);
  albedo = mix(deepC, shell, smoothstep(0.26, 0.88, h));
  // Weighted onto the height and the growth lamellae rather than the per-segment
  // random: a constant per plate is a tile-scale feature, and this set already
  // spends 60% of its albedo energy below 8 cycles on the segment structure.
  albedo = mix(albedo, pale, smoothstep(0.60, 0.99, h * 0.44 + gLam * 0.34 + gPlateR * 0.22) * 0.55);
  // Tint multiplicatively: the shell keeps its own value and only takes the
  // interference as a cast, the way a real carapace does.
  albedo = mix(albedo, albedo * (0.80 + 0.42 * irid), 0.5 + 0.4 * gEdge);
  // Every puncture is a dark point with a raised waxy lip. This is the 2 mm
  // detail that separates a shell from a painted dome at arm's length.
  albedo = mix(albedo, pit, smoothstep(0.20, 0.85, gPore) * 0.70);
  albedo = mix(albedo, wax, smoothstep(0.05, 0.30, gPore) * (1.0 - smoothstep(0.30, 0.7, gPore)) * 0.35 * gPoreId);
  // Scuffed lacquer: the interference film is worn off and the matte cuticle
  // beneath shows, which is also where the ash sticks.
  gDustC = gScuff * (0.4 + 0.6 * (1.0 - gEdge));
  albedo = mix(albedo, dustC, gDustC * 0.30);
  // Luminance-only stipple. Multiplying a three-channel field into the albedo is
  // the other way to manufacture per-pixel chroma noise; a scalar cannot.
  albedo *= 0.80 + 0.34 * gStipple + 0.06 * gRib;
  // Polished lacquer against worn cuticle: a 0.13-to-0.62 spread inside one
  // material, so a single object shows both a tight highlight and a matte
  // patch. That contrast is what rule 5 asks to be readable from shading alone.
  // The growth lamellae run across the plate and are burnished flatter than the
  // cuticle between them, which is what gives the shell its directional sheen.
  rough = mix(0.44, 0.13, gLam * 0.55 + gEdge * 0.45);
  rough = mix(rough, 0.62, gDustC * 0.9 + smoothstep(0.3, 0.9, gPore) * 0.4);
  // A small metallic term is the cheapest way to get a *coloured* specular out
  // of a standard BRDF, which is what sells the shell as insectile rather than
  // as painted plastic. It goes with the film, so it wears off with it.
  metal = (0.14 + 0.16 * gEdge) * (1.0 - gDustC * 0.8);
  armA = h;
}`;

const thatch = /* glsl */ `
float gRound, gRow, gTip;
vec3 gStalkH;
float mHeight(vec2 uv) {
  // Marsh reed laid in courses. 44 stalks per tile is about a hand's width per
  // reed at the scale these tiles get used, which is what makes them legible.
  const float ROWS = 6.0;
  const float STALKS = 44.0;
  float ry = uv.y * ROWS;
  float rowI = floor(ry);
  gRow = ry - rowI;
  float shift = hash32(vec2(mod(rowI, ROWS), 0.0), 5.0).x;
  // shift is constant per course, so the stalk train still advances by an
  // integer number of stalks across the tile and stays seamless.
  float sx = (uv.x + shift) * STALKS + fbm(uv, vec2(6.0, 24.0), 3, 0.5, 2.0) * 1.2;
  float sid = floor(sx);
  gStalkH = hash32(vec2(mod(sid, STALKS), mod(rowI, ROWS)), 6.0);
  gRound = sin(fract(sx) * 3.14159265);
  float len = 0.50 + 0.50 * gStalkH.x;
  gTip = smoothstep(len, len - 0.30, gRow);
  float layer = (1.0 - gRow) * 0.30;
  float fuzz = fbm(uv, vec2(96.0, 288.0), 3, 0.5, 3.0) * 0.5 + 0.5;
  return clamp(0.14 + layer + pow(gRound, 0.7) * 0.40 * gTip + gStalkH.y * 0.10 + fuzz * 0.08, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  vec3 straw = PAL(150.0, 120.0,  66.0);
  vec3 pale  = PAL(188.0, 166.0, 114.0);
  vec3 rot   = PAL( 62.0,  57.0,  47.0);
  vec3 grey  = PAL(122.0, 117.0, 106.0);
  albedo = mix(straw, pale, gStalkH.z);
  albedo = mix(albedo, grey, gStalkH.y * 0.45);
  // Weathering runs inward from the exposed butt end of each course.
  albedo = mix(rot, albedo, 0.3 + 0.7 * smoothstep(0.02, 0.5, gRow));
  albedo *= 0.55 + 0.45 * gRound;
  rough = 0.92 - gRound * 0.10;
  metal = 0.0;
  armA = h;
}`;

const woodWeathered = /* glsl */ `
float gRing, gSplit, gPlank, gGap, gFibre;
float mHeight(vec2 uv) {
  const float PLANKS = 4.0;
  float px = uv.x * PLANKS;
  float pi = floor(px), pf = px - pi;
  vec3 ph = hash32(vec2(mod(pi, PLANKS), 0.0), 7.0);
  gPlank = ph.z;
  gGap = 1.0 - smoothstep(0.0, 0.030, min(pf, 1.0 - pf));
  // Growth rings = distance to an off-centre pith. The along-plank drift has to
  // be an integer slope or the rings would not meet at the tile seam.
  float slope = floor(ph.z * 5.0) - 2.0;
  float wob = fbm(uv, vec2(6.0, 12.0), 3, 0.5, 2.0);
  float r = abs(pf - 0.5 + (ph.x - 0.5) * 0.5) * (7.0 + 8.0 * ph.y) + wob * 1.1 + uv.y * slope;
  gRing = pow(sin(TAU * r) * 0.5 + 0.5, 2.4);
  gFibre = fbm(uv, vec2(144.0, 12.0), 3, 0.5, 3.0) * 0.5 + 0.5;
  gSplit = (1.0 - smoothstep(0.0, 0.030, abs(fbm(uv, vec2(24.0, 3.0), 3, 0.5, 4.0))))
         * smoothstep(0.38, 0.80, fbm(uv, vec2(6.0), 3, 0.5, 5.0) * 0.5 + 0.5);
  float cup = 1.0 - pow(abs(pf * 2.0 - 1.0), 2.0);
  return clamp(0.52 + cup * 0.12 + gRing * 0.18 + gFibre * 0.12 - gSplit * 0.32 - gGap * 0.44, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  // Timber this side of the Inner Sea silvers rather than rots.
  vec3 silver = PAL(148.0, 142.0, 133.0);
  vec3 warm   = PAL( 88.0,  66.0,  45.0);
  vec3 dark   = PAL( 40.0,  30.0,  24.0);
  albedo = mix(silver, warm, gRing * 0.75 + gPlank * 0.15);
  albedo = mix(albedo, dark, gSplit * 0.8 + gGap * 0.7);
  albedo *= 0.82 + 0.32 * gFibre;
  rough = mix(0.66, 0.94, gRing * 0.5 + gSplit * 0.5) + gGap * 0.05;
  metal = 0.0;
  armA = h;
}`;

/**
 * The trunk of a grown Telvanni tower and of every fungal stalk.
 *
 * Every large field in the previous version was elongated along Y — the welts,
 * the fissures and the fibre all ran up the stalk — so the material carried no
 * cross-grain information whatsoever and read as 1D vertical striping smeared
 * over a bulging cylinder, which is exactly what the review measured on the
 * hero trunk. A fungal stalk is not extruded: it grows in flushes, and each
 * flush leaves an annulation running *around* it. Those annulations, plus the
 * occasional heavier collar scar, are the second axis the material was missing.
 */
const barkFungal = /* glsl */ `
float gPore, gPoreB, gFiss, gGlow, gWelt, gFibreB, gScaleB, gScaleId, gGritB2, gPatch;
float gAnnul, gCollar, gCollarId, gFlush;
float mHeight(vec2 uv) {
  // MACRO BAND — the growth flushes, at the scale the tower itself is seen at.
  //
  // Measured on the shipped set: albedo luminance standard deviation 10 code
  // values at level 0 and 5 by level 4. The architecture system projects this
  // set at one tile per 9 m ('fungus') and per 6.5 m ('cap') onto pod towers
  // forty metres tall, so at any normal viewing distance the tower is read from
  // level 4-5 — and everything the set had lived at 6 cycles per tile or finer,
  // which is 1.5 m of world feature and below. At level 5 the whole trunk
  // therefore collapsed to one value, which is exactly the filed defect: "a
  // single uniform mauve-grey matte value across cap, pods and stalk with only
  // low-frequency vertex-ish mottling".
  //
  // A grown Telvanni tower is not extruded from one flush. It swells in seasons,
  // and each season's growth carries its own skin colour, metres deep, with the
  // older flushes below bleached and ash-caked and the younger ones above still
  // dark. Three octaves from rep3's floor of 3 cycles put that at a 3 m, 1.5 m
  // and 0.75 m band on the tower — the coarsest thing this library is able to
  // say, and the only band still resolvable on a silhouette across the waste.
  //
  // Legal here specifically because this set is bound by the architecture system
  // only (Architecture.ts, the 'fungus' and 'cap' entries) and is never a
  // terrain splat layer, so it is not read through the terrain's per-cell
  // rotated frame and the >=9-cycle albedo band budget the ground materials are
  // held to - see ash and basalt - does not apply to it.
  gFlush = fbm(warp2(uv, vec2(3.0), 0.24, 145.3), vec2(3.0), 3, 0.58, 146.7) * 0.5 + 0.5;
  gFlush = clamp(0.5 + (gFlush - 0.5) * 1.9, 0.0, 1.0);
  // A giant mushroom's trunk is leathery, not woody: welts and deep fissures
  // run UP the stalk, so the large-scale fields here are elongated along Y.
  vec2 w = warp(uv, vec2(9.0, 3.0), 0.10, 121.0);
  gWelt = ridged(w, vec2(12.0, 3.0), 4, 0.55, 2.0);
  vec3 c = worleyUV(warp(uv, vec2(12.0, 3.0), 0.05, 3.0), vec2(9.0, 3.0), 0.9, 122.0);
  gFiss = 1.0 - smoothstep(0.0, 0.13, c.y - c.x);
  float leather = fbm(uv, vec2(48.0), 4, 0.5, 4.0) * 0.5 + 0.5;
  gPore = smoothstep(0.26, 0.0, worleyUV(uv, vec2(56.0), 1.0, 123.0).x);
  gGlow = smoothstep(0.55, 0.98, gFiss)
        * smoothstep(0.45, 0.92, fbm(uv, vec2(6.0, 3.0), 3, 0.5, 5.0) * 0.5 + 0.5);
  // The review measured the hero trunk as "uniform brown with no bark". It was
  // right: everything above lives at the 3-12 cycle scale, so once the stalk is
  // more than a couple of metres away the whole material is one value. These
  // three carry the 1-3 cm band that makes it read as a surface.
  //
  // Lifted scales: a fungal stalk sheds its skin in irregular plates, curling
  // away from the stem, each a slightly different colour.
  vec4 sc = clasts(uv, vec2(23.0, 13.0), 0.42, 0.16, 0.55, 126.0);
  gScaleB = sc.x;
  gScaleId = sc.y;
  // Vertical fibre — irregular spacing, not a 1D band train. The period is
  // anisotropic and warped, and the warp amplitude is a full band, so no two
  // fibres sit the same distance apart.
  gFibreB = fbm(warp(uv, vec2(6.0, 3.0), 0.06, 128.0), vec2(132.0, 21.0), 3, 0.5, 129.0) * 0.5 + 0.5;
  gGritB2 = microGrain(uv, 96.0, 131.0);
  gPoreB = clasts(uv, vec2(78.0), 0.34, 0.10, 0.30, 133.0).x;
  gPatch = smoothstep(0.42, 0.88, fbm(uv, vec2(7.0, 4.0), 4, 0.5, 137.0) * 0.5 + 0.5);
  // CROSS-GRAIN. Growth annulations run around the stalk, so these two fields
  // are elongated along X — the transpose of everything above them. The phase is
  // warped by well over a cycle so the rings wander and crowd instead of ruling
  // the tile, and the amplitude is gated so stretches of smooth flesh survive
  // between flushes.
  float aPhase = uv.y * 21.0 + fbm(uv, vec2(9.0, 5.0), 4, 0.5, 141.0) * 3.4;
  float aAmp = smoothstep(0.24, 0.82, fbm(uv, vec2(4.0, 7.0), 3, 0.5, 142.0) * 0.5 + 0.5);
  gAnnul = pow(sin(TAU * aPhase) * 0.5 + 0.5, 1.7) * (0.25 + 0.75 * aAmp);
  // Collar scars: the heavier ridge left where the stalk widened in one season.
  // Anisotropic clasts — wide in x, short in y — so each is an arc around the
  // trunk rather than a blob, and only a few per tile.
  vec4 cl = clasts(warp(uv, vec2(3.0, 6.0), 0.05, 143.0), vec2(3.0, 13.0), 0.30, 0.16, 0.52, 144.0);
  gCollar = cl.x;
  gCollarId = cl.y;
  return clamp(0.40 + gWelt * 0.26 + leather * 0.09 + gFibreB * 0.07
             + gScaleB * 0.09 + gGritB2 * 0.06 + gAnnul * 0.11 + gCollar * 0.12
             - gFiss * 0.40 - gPore * 0.08 - gPoreB * 0.07, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  vec3 skin   = PAL(126.0, 104.0,  74.0);
  vec3 pale   = PAL(170.0, 148.0, 112.0);
  vec3 grey   = PAL( 92.0,  86.0,  88.0);
  vec3 violet = PAL( 66.0,  52.0,  70.0);
  vec3 dark   = PAL( 38.0,  30.0,  26.0);
  vec3 glow   = PAL( 96.0, 222.0, 198.0);
  albedo = mix(violet, skin, smoothstep(0.20, 0.88, h));
  albedo = mix(albedo, grey, smoothstep(0.42, 0.92, gWelt) * 0.45);
  // Each shed scale is its own value, with a dark shadow under its lifted edge.
  albedo = mix(albedo, mix(dark, pale, gScaleId), smoothstep(0.06, 0.55, gScaleB) * 0.55);
  albedo = mix(albedo, pale, gPatch * 0.22);
  // Cross-grain in the albedo as well as in the relief. A ridge that exists only
  // in the normal map disappears the moment the light runs along it, which on a
  // backlit silhouette is most of the time.
  albedo = mix(albedo, pale, gAnnul * 0.24);
  albedo = mix(albedo, mix(dark, pale, gCollarId), smoothstep(0.06, 0.60, gCollar) * 0.40);
  albedo = mix(albedo, albedo * 0.40, gPore * 0.75 + gPoreB * 0.55);
  // Glow lives in the albedo only; the ARM alpha stays height for this set.
  albedo = mix(albedo, glow, gGlow * 0.7);
  // The flush band, applied to VALUE first and hue second. A band that exists
  // only as hue is invisible on a tower, because a tower is always seen through
  // enough aerial perspective to have had its saturation taken off it; value is
  // the one channel a 400 m silhouette still has. The two endpoints are the
  // set's own dark and pale, so this stays inside the chitin/bone ramp, and the
  // pale weight is held at 0.16 against the dark's 0.34 so that the multiplier's
  // mean and the mix's mean cancel and the set's average albedo does not move —
  // this must read as more surface, not as a brighter tower.
  vec3 flushDark = mix(albedo, dark, 0.34);
  vec3 flushPale = mix(albedo, pale, 0.16);
  albedo = mix(flushDark, flushPale, gFlush) * (0.68 + 0.66 * gFlush);
  albedo *= 0.62 + 0.46 * gGritB2 + 0.22 * gFibreB;
  // Fungus is damp: the fissures and the young skin under a lifted scale are
  // the wettest thing in the library outside mud, and a wet-vs-dry read on one
  // object is what rule 5 asks for.
  rough = mix(0.90, 0.52, gGlow) - gWelt * 0.06;
  rough = mix(rough, 0.42, smoothstep(0.4, 0.95, gFiss) * 0.7);
  // A fresh annulation is the youngest, wettest flesh on the stalk and takes a
  // tighter lobe than the weathered skin between the rings.
  rough = mix(rough, 0.56, gAnnul * 0.45 + smoothstep(0.1, 0.7, gCollar) * 0.30);
  // Wet against dry at the MACRO scale as well as the micro one. A young flush
  // is still damp and takes a tight lobe; an old bleached one is powder. Every
  // other roughness term on this set lives above 12 cycles and is averaged flat
  // by level 4, so this is the only one that can still separate one part of a
  // distant tower from another — which is what the bar means by material
  // differentiation being provable from shading alone.
  rough = mix(rough, 0.44, smoothstep(0.55, 1.00, gFlush) * 0.55);
  rough = mix(rough, 0.93, smoothstep(0.45, 0.00, gFlush) * 0.45);
  rough += 0.06 * gScaleB;
  metal = 0.0;
  armA = h;
}`;

const cloth = /* glsl */ `
float gOver, gTwist, gSlub, gParity, gDye, gNap, gFineC2, gAbrade, gSnag, gSoil;
float mHeight(vec2 uv) {
  // 40 threads per tile: coarse homespun, and coarse enough that the weave is
  // still legible once the tile is a metre across.
  const float N = 40.0;
  vec2 t = uv * N;
  vec2 ci = floor(t), f = t - ci;
  // Plain weave: warp passes over weft on alternating crossings.
  gParity = mod(ci.x + ci.y, 2.0);
  // Per-yarn thickness. Handspun singles vary along their length by a third,
  // and that variation is what stops forty identical threads reading as a
  // printed grid — it is also the only way to spread a weave's spectrum without
  // breaking the lattice the tile depends on.
  vec3 yh = hash32(vec2(mod(ci.x, N), 0.0), 14.0);
  vec3 yv = hash32(vec2(0.0, mod(ci.y, N)), 15.0);
  float wThick = 0.62 + 0.38 * yh.x;
  float fThick = 0.62 + 0.38 * yv.x;
  float warpH = sin(clamp(f.x, 0.0, 1.0) * 3.14159265) * wThick;
  float weftH = sin(clamp(f.y, 0.0, 1.0) * 3.14159265) * fThick;
  gOver = mix(weftH, warpH, gParity);
  float under = mix(warpH, weftH, gParity) * 0.40;
  gTwist = sin(TAU * (mix(f.y, f.x, gParity) * 4.0 + hash32(mod(ci, N), 9.0).x)) * 0.5 + 0.5;
  gSlub = fbm(uv, vec2(24.0), 3, 0.5, 2.0) * 0.5 + 0.5;
  // Nap: the loose fibre standing off the surface of a coarse cloth, and the
  // reason wool does not shade like plastic sheeting. The old fuzz term was an
  // fBm at 288 cycles, under two texels on the shipped map and destroyed by the
  // first mip; 56 and 122 land in the band that survives to a frame.
  gNap = microGrain(uv, 56.0, 16.0);
  gFineC2 = microGrain(uv, 122.0, 17.0);
  // Abrasion: the crowns of the weave wear first, so a used cloth is pale along
  // the fold lines and at the hems.
  gAbrade = smoothstep(0.52, 0.92, fbm(warp(uv, vec2(6.0), 0.08, 18.0), vec2(9.0), 4, 0.5, 19.0) * 0.5 + 0.5);
  // Pulled threads and darned snags, sparse and clumped.
  gSnag = clasts(uv, vec2(17.0), 0.16, 0.10, 0.30, 20.0).x;
  gSoil = smoothstep(0.58, 0.96, fbm(uv, vec2(5.0, 11.0), 4, 0.5, 21.0) * 0.5 + 0.5);
  return clamp(0.26 + max(gOver, under) * 0.44 + gTwist * 0.08 + gSlub * 0.09
             + gNap * 0.10 + gFineC2 * 0.05 + gSnag * 0.07 - gAbrade * 0.05, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  // Vegetable dye on coarse yarn takes unevenly; that unevenness is the look.
  vec3 dye  = PAL(132.0,  60.0,  44.0);
  vec3 fade = PAL(172.0, 138.0, 110.0);
  vec3 deep = PAL( 50.0,  25.0,  23.0);
  vec3 bare = PAL(148.0, 132.0, 106.0);
  vec3 grime = PAL( 62.0,  56.0,  48.0);
  gDye = fbm(uv, vec2(6.0), 4, 0.5, 4.0) * 0.5 + 0.5;
  albedo = mix(deep, dye, smoothstep(0.12, 0.68, gDye));
  albedo = mix(albedo, fade, smoothstep(0.60, 0.98, gDye) * 0.8);
  // Where the crowns have worn through, the undyed fibre shows. That is the
  // strongest local contrast in the material and the thing that survives to a
  // frame at two metres.
  albedo = mix(albedo, bare, gAbrade * smoothstep(0.35, 0.95, gOver) * 0.55 + gSnag * 0.30);
  albedo = mix(albedo, grime, gSoil * 0.35);
  // Individual yarns took the dye differently, which breaks up the field —
  // but only just: push this and the cloth turns to static.
  albedo *= 0.90 + 0.18 * hash32(mod(floor(uv * 40.0), 40.0), 12.0).y;
  albedo *= 0.80 + 0.30 * gOver;
  albedo *= 0.74 + 0.36 * gNap + 0.18 * gFineC2;
  // A pressed, worn crown takes a soft sheen; raw nap scatters everything. That
  // spread is what separates cloth from every matte mineral in the library.
  rough = 0.94 - gTwist * 0.10 - gSlub * 0.04;
  rough = mix(rough, 0.62, gAbrade * smoothstep(0.30, 0.95, gOver) * 0.75);
  rough += 0.05 * gNap;
  metal = 0.0;
  armA = h;
}`;

const iron = /* glsl */ `
float gRust, gPit, gScale;
float mHeight(vec2 uv) {
  vec2 w = warp(uv, vec2(6.0), 0.05, 131.0);
  float hammer = smoothstep(0.55, 0.0, worleyUV(w, vec2(9.0), 1.0, 141.0).x);
  float pit = smoothstep(0.26, 0.0, worleyUV(uv, vec2(40.0), 1.0, 142.0).x);
  float pit2 = smoothstep(0.18, 0.0, worleyUV(uv, vec2(96.0), 1.0, 143.0).x);
  gPit = clamp(pit * 0.8 + pit2 * 0.5, 0.0, 1.0);
  gScale = fbm(uv, vec2(24.0), 4, 0.5, 2.0) * 0.5 + 0.5;
  gRust = smoothstep(0.44, 0.80, fbm(warp(uv, vec2(6.0), 0.10, 3.0), vec2(9.0), 5, 0.55, 4.0) * 0.5 + 0.5);
  float bloom = gRust * (fbm(uv, vec2(96.0), 3, 0.5, 5.0) * 0.5 + 0.5);
  return clamp(0.60 + hammer * 0.16 + gScale * 0.08 - gPit * 0.38 + bloom * 0.14, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  vec3 steel = PAL(142.0, 145.0, 150.0);
  vec3 dull  = PAL( 74.0,  77.0,  84.0);
  vec3 rust1 = PAL(124.0,  62.0,  28.0);
  vec3 rust2 = PAL( 62.0,  33.0,  21.0);
  vec3 met = mix(dull, steel, smoothstep(0.40, 0.92, h));
  vec3 ox = mix(rust2, rust1, fbm(uv, vec2(48.0), 3, 0.5, 6.0) * 0.5 + 0.5);
  albedo = mix(met, ox, gRust);
  rough = mix(mix(0.32, 0.62, gPit) + gScale * 0.06, 0.94, gRust);
  // Rust is an oxide, not a conductor: metalness has to fall away with it.
  metal = 1.0 - gRust * 0.95;
  armA = h;
}`;

/**
 * Dwemer bronze — the wreck on the horizon, the pipework, the great cogs.
 *
 * The old version chased a chevron band with
 *   `1 - smoothstep(0.03, 0.075, abs(fract(uv.x * 6.0 + tri(uv.y * 6.0)) - 0.5))`
 * and a rim line at `fract(uv.y * 3.0)`. Both are unwarped, hard-edged periodic
 * stencils, and a hard edge on a fixed period is not a band in the spectrum, it
 * is a comb: the FFT put an isolated peak 189x above the local radial median.
 * At the 0.6 m tiling architecture uses, that is a chevron every 10 cm and a
 * ruled line every 20 cm across every bronze surface in the world, which is
 * both an instant tiling fail under rule 4 and the source of the "rectangular
 * recessed panels" the review read off the wreck.
 *
 * Ornament is right for Dwemer work, so it stays — but as a *cast* ornament
 * whose lattice is warped, whose amplitude is masked, and whose ring pitch
 * varies per boss, rather than as a ruled screen. On top of it the material now
 * carries the response the review asked for by name: metal = 1 on bare bronze
 * at roughness ~0.35, broken by verdigris (#5f7a63, per the bible) that collects
 * in every crevice and takes both the metalness and the lobe away with it.
 */
const bronze = /* glsl */ `
float gPat, gCast, gEngrave, gBoss, gBossId, gWearB, gGritBz, gPitBz, gScale;
float mHeight(vec2 uv) {
  gCast = fbm(uv, vec2(96.0), 4, 0.5, 2.0) * 0.5 + 0.5;
  float blow = smoothstep(0.18, 0.0, worleyUV(uv, vec2(48.0), 1.0, 151.0).x);
  // Cast ornament: concentric rings raised around scattered bosses. The centres
  // come from clasts, so most cells are empty and the bosses vary in size;
  // the ring pitch is per-boss and the radius is domain-warped, so no two
  // patches of ornament share a period and the whole thing lands as a band
  // rather than as a line.
  vec2 wb = warp2(uv, vec2(6.0), 0.06, 152.0);
  vec4 bo = clasts(wb, vec2(9.0), 0.34, 0.22, 0.72, 153.0);
  gBoss = bo.x;
  gBossId = bo.y;
  float rings = pow(sin(TAU * (bo.x * (5.0 + 9.0 * bo.y) + bo.y * 3.0)) * 0.5 + 0.5, 1.6);
  gEngrave = rings * smoothstep(0.04, 0.34, bo.x) * smoothstep(0.98, 0.72, bo.x);
  // Hammered planishing over the whole plate — the mark of the hand that raised
  // it, and a mid-frequency field that keeps the flat areas from being flat.
  gScale = 1.0 - smoothstep(0.0, 0.55, worleyUV(warp(uv, vec2(6.0), 0.07, 154.0), vec2(21.0), 1.0, 155.0).x);
  // Corrosion pitting, size-graded rather than monodisperse.
  float pd = 0.24 + 0.42 * smoothstep(0.32, 0.88, fbm(uv, vec2(7.0), 3, 0.5, 156.0) * 0.5 + 0.5);
  gPitBz = clamp(max(clasts(uv, vec2(51.0), pd, 0.10, 0.36, 157.0).x,
                     clasts(uv, vec2(113.0), pd * 1.3, 0.10, 0.30, 158.0).x * 0.7), 0.0, 1.0);
  gGritBz = microGrain(uv, 62.0, 159.0);
  // Patina collects wherever the surface is recessed or porous, and is scoured
  // off wherever a hand or the wind has polished it.
  gPat = smoothstep(0.38, 0.84, fbm(warp(uv, vec2(6.0), 0.08, 3.0), vec2(12.0), 5, 0.55, 4.0) * 0.5 + 0.5);
  gWearB = smoothstep(0.62, 0.96, fbm(warp(uv, vec2(5.0), 0.09, 160.0), vec2(8.0), 4, 0.5, 161.0) * 0.5 + 0.5);
  gPat = clamp(gPat * (1.0 - gWearB * 0.85) + gPitBz * 0.45 + blow * 0.30
             + gScale * 0.10 - gEngrave * 0.20, 0.0, 1.0);
  return clamp(0.62 + gCast * 0.09 + gGritBz * 0.07 + gBoss * 0.10 + gEngrave * 0.14
             + gScale * 0.06 - gPitBz * 0.24 - blow * 0.20, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  vec3 bronzeC = PAL(188.0, 146.0,  86.0);
  vec3 brass   = PAL(212.0, 178.0, 112.0);
  vec3 tarnish = PAL( 92.0,  68.0,  40.0);
  // #5f7a63 exactly, per the bible's verdigris entry. The old #404e42 was two
  // stops under it and read as dirt rather than as oxide.
  vec3 patina  = PAL( 95.0, 122.0,  99.0);
  vec3 patinaD = PAL( 52.0,  70.0,  57.0);
  vec3 met = mix(tarnish, mix(bronzeC, brass, gCast), smoothstep(0.36, 0.94, h));
  // Polished proud edges: where the wind has scoured the plate back to metal it
  // is brighter than anywhere else on the object, which is what gives a backlit
  // silhouette something for the rim to catch.
  met = mix(met, brass, gWearB * 0.55);
  // Verdigris is a crust, not a stain: thin and blue-green on the high ground,
  // thick and dark down in the crevice it grew out of.
  albedo = mix(met, mix(patinaD, patina, smoothstep(0.30, 0.85, h)), gPat * 0.86);
  albedo *= 0.80 + 0.34 * gGritBz;
  // ~0.35 on bare bronze, as the review asked. Planishing scatters it a little,
  // pitting more, and the oxide crust kills the lobe outright.
  rough = mix(0.32, 0.48, gCast * 0.5 + gScale * 0.5);
  rough = mix(rough, 0.26, gWearB * 0.7);
  rough = mix(rough, 0.88, gPat);
  rough += gPitBz * 0.10;
  // An oxide is not a conductor. This is the term that separates bare plate from
  // crust on shading alone even when both are the same value.
  metal = 1.0 - gPat * 0.92;
  armA = h;
}`;

const glassVolcanic = /* glsl */ `
float gFacet, gEdge, gHackle;
float mHeight(vec2 uv) {
  // Conchoidal fracture: obsidian breaks in shallow spherical caps meeting at
  // sharp arrises, so the height is a cap profile over a cellular partition.
  vec2 w = warp(uv, vec2(3.0), 0.09, 161.0);
  vec3 c1 = worleyUV(w, vec2(4.0), 0.85, 171.0);
  vec3 c2 = worleyUV(w, vec2(11.0), 0.85, 172.0);
  gFacet = c1.z;
  float cap1 = sqrt(max(1.0 - c1.x * c1.x * 1.9, 0.0));
  float cap2 = sqrt(max(1.0 - c2.x * c2.x * 2.4, 0.0));
  gEdge = 1.0 - smoothstep(0.0, 0.030, min(c1.y - c1.x, c2.y - c2.x));
  // Hackle: the fine ripple that radiates from the point of impact.
  gHackle = ridged(uv, vec2(24.0), 3, 0.5, 2.0);
  return clamp(0.40 + cap1 * 0.32 + cap2 * 0.18 + gHackle * 0.06 - gEdge * 0.10, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  // Obsidian is one of the darkest natural dielectrics there is. Almost all of
  // its appearance is specular, so the albedo has to stay near black or the
  // material reads as painted slate.
  vec3 jet   = PAL(10.0, 10.0, 12.0);
  vec3 grey  = PAL(48.0, 47.0, 54.0);
  vec3 sheen = 0.5 + 0.5 * cos(TAU * (vec3(gFacet) * 1.1 + vec3(0.0, 0.32, 0.62)));
  albedo = mix(jet, grey, smoothstep(0.25, 0.95, h) * 0.8);
  // Rainbow obsidian: nanoscale magnetite layers. Against an albedo this dark
  // even a hundredth of a unit of colour swamps it, so the sheen is a whisper.
  albedo += sheen * 0.004 * smoothstep(0.4, 0.95, h);
  // Fresh arrises catch the light as a pale line of crushed glass.
  albedo += vec3(0.016) * gEdge * gHackle;
  rough = 0.06 + gEdge * 0.30 + gHackle * 0.10 + (1.0 - smoothstep(0.15, 0.75, h)) * 0.08;
  metal = 0.0;
  armA = h;
}`;

const bone = /* glsl */ `
float gTrab, gExpo, gPore, gStain;
float mHeight(vec2 uv) {
  // Cortical shell over cancellous bone. Where the shell is worn through, the
  // trabecular lattice shows: 3D cellular F2-F1 gives struts, not blobs.
  float shell = fbm(uv, vec2(6.0), 4, 0.5, 2.0) * 0.5 + 0.5;
  gExpo = smoothstep(0.36, 0.62, fbm(warp(uv, vec2(6.0), 0.10, 3.0), vec2(9.0), 4, 0.55, 4.0) * 0.5 + 0.5);
  vec2 f = worley3(vec3(uv * 18.0, 0.5), vec2(18.0), 1.0, 181.0);
  gTrab = 1.0 - smoothstep(0.03, 0.26, f.y - f.x);
  // Haversian canals: the pinprick porosity of the outer cortex.
  gPore = smoothstep(0.30, 0.0, worleyUV(uv, vec2(52.0), 1.0, 182.0).x);
  float h = 0.74 + shell * 0.14 - gPore * 0.22;
  h = mix(h, 0.16 + gTrab * 0.52, gExpo);
  float crack = 1.0 - smoothstep(0.0, 0.022, abs(fbm(uv, vec2(12.0), 4, 0.5, 6.0)));
  return clamp(h - crack * 0.16, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  gStain = smoothstep(0.44, 0.92, fbm(uv, vec2(6.0), 4, 0.5, 7.0) * 0.5 + 0.5);
  vec3 ivory = PAL(212.0, 202.0, 176.0);
  vec3 cream = PAL(168.0, 152.0, 120.0);
  vec3 inner = PAL(108.0,  94.0,  70.0);
  vec3 stain = PAL( 88.0,  70.0,  48.0);
  albedo = mix(cream, ivory, smoothstep(0.46, 0.98, h));
  albedo = mix(albedo, inner, gExpo * 0.8);
  albedo = mix(albedo, albedo * 0.42, gPore * 0.8);
  albedo = mix(albedo, stain, gStain * 0.5);
  rough = mix(0.50, 0.90, gExpo) + gPore * 0.06;
  metal = 0.0;
  armA = h;
}`;

/**
 * Pumice — the pale, light, frothy end of the volcanic rock family, and the
 * third distinct mineral set so a prop author has basalt (near-black, glassy),
 * volcanic_rock (mid, rusty, vesicular) and this one (pale, matte, porous) to
 * choose between rather than shading every rock in a frame identically.
 *
 * The previous version was four `worleyUV` fields thresholded at four fixed
 * radii. That is a monodisperse blob per cell at each of four scales, i.e. four
 * pure spatial tones and nothing between them, and it rendered as a printed
 * halftone screen on a near-white ground — the exact shape the file header
 * rules out, and half a palette step brighter than anything the bible allows
 * outside bone. Vesicles now come from `clasts`, whose radii are drawn from a
 * squared random against a per-cell existence test, so the size distribution is
 * power-law and most cells are empty; the glass web between them is a ridged
 * field rather than a constant; and the base value sits in the ash band.
 */
const pumice = /* glsl */ `
float gVes, gVesId, gVesRim, gFrame, gGritP, gFineP, gStainP;
float mHeight(vec2 uv) {
  vec2 w = warp2(uv, vec2(4.0), 0.09, 181.0);
  // Clumping: a froth degasses in pockets, so the vesicle density is itself a
  // field. Without this every part of the tile has the same bubble count and
  // the eye reads an even screen however varied the radii are.
  float dens = 0.38 + 0.44 * smoothstep(0.24, 0.86, fbm(w, vec2(5.0), 4, 0.5, 182.0) * 0.5 + 0.5);
  vec4 v1 = clasts(w,  vec2(15.0), dens * 0.8, 0.20, 0.78, 191.0);
  vec4 v2 = clasts(w,  vec2(33.0), dens,       0.16, 0.62, 192.0);
  vec4 v3 = clasts(uv, vec2(79.0), dens * 1.3, 0.12, 0.48, 193.0);
  gVes = clamp(max(v1.x, max(v2.x * 0.88, v3.x * 0.62)), 0.0, 1.0);
  gVesId = v1.x > v2.x * 0.88 ? v1.y : (v2.x * 0.88 > v3.x * 0.62 ? v2.y : v3.y);
  gVesRim = max(v1.w, max(v2.w, v3.w * 0.7));
  // The stretched glass web the bubbles were blown through: torn, unevenly
  // thick, and the thing that carries the surface where there are no vesicles.
  // Half ridged, half plain fBm. Pure ridged at this amplitude draws a network
  // of dark filaments that reads as scratches, and scratches are not a froth.
  gFrame = ridged(w, vec2(7.0), 5, 0.55, 2.0) * 0.5
         + (fbm(w, vec2(5.0), 4, 0.5, 9.0) * 0.5 + 0.5) * 0.5;
  gStainP = smoothstep(0.56, 0.96, fbm(warp(uv, vec2(6.0), 0.10, 184.0), vec2(9.0), 4, 0.5, 185.0) * 0.5 + 0.5);
  gGritP = microGrain(uv, 52.0, 3.0);
  gFineP = microGrain(uv, 118.0, 77.0);
  return clamp(0.58 + gFrame * 0.22 + gGritP * 0.11 + gFineP * 0.05 - gVes * 0.50, 0.0, 1.0);
}
void mShade(vec2 uv, float h, inout vec3 albedo, inout float rough, inout float metal, inout float armA) {
  // Ash band, not bone: #8a7f72 at the top end, #4a423b in the shade. The old
  // #c4bfb5 base was the brightest surface in the world outside the sky.
  vec3 pale  = PAL(148.0, 141.0, 130.0);
  vec3 tint  = PAL(104.0,  97.0,  88.0);
  vec3 deep  = PAL( 40.0,  37.0,  35.0);
  vec3 stain = PAL(110.0,  78.0,  56.0);
  albedo = mix(tint, pale, smoothstep(0.24, 0.86, gFrame * 0.45 + h * 0.55));
  albedo = mix(albedo, deep, smoothstep(0.04, 0.55, gVes) * (0.70 + 0.26 * (1.0 - gVesId)));
  // Every bubble has a lit lip and a dark throat, which is what makes it read
  // as a hole rather than as a printed spot.
  albedo = mix(albedo, pale, gVesRim * 0.34);
  albedo = mix(albedo, stain, gStainP * 0.22);
  albedo *= 0.54 + 0.60 * gGritP + 0.24 * gFineP;
  // Porous glass foam: matte on the open frame, and the vesicle throats are
  // powder. Nothing here takes a lobe — that is what separates it from basalt.
  rough = 0.95 - 0.12 * smoothstep(0.45, 0.95, gFrame) + 0.04 * gVes;
  metal = 0.0;
  armA = h;
}`;

export const MATERIAL_DEFS: readonly MatDef[] = [
  // Relief was 0.026, which on a field whose largest feature was a soft dune
  // gave a normal map with a standard deviation of 31 against volcanic rock's
  // 49 — a mathematically smoother surface than any rock in the library, on the
  // ground plane the near-field detail bar is judged on. The set now carries
  // hard-edged cracks and three decades of clast, so the slope per unit
  // wavelength stays sane at 0.040 and the relief actually bites under the
  // terrain's parallax march.
  { name: 'ash', glsl: ash, relief: 0.040, aoRadius: 22, aoStrength: 0.85 },
  { name: 'ash_coarse', glsl: ashCoarse, relief: 0.046, aoRadius: 24, aoStrength: 0.85 },
  { name: 'volcanic_rock', glsl: volcanicRock, relief: 0.050, aoRadius: 26, aoStrength: 0.9 },
  // Was 0.070 against a 1.6 m honeycomb. The columns are now 0.9 m and carry
  // grain and fracture on top, so the same relief would have turned the normal
  // map into static; the slope per unit wavelength is what has to stay put.
  { name: 'basalt', glsl: basalt, relief: 0.052, aoRadius: 28, aoStrength: 0.95 },
  { name: 'sand', glsl: sand, relief: 0.018, aoRadius: 18, aoStrength: 0.7 },
  { name: 'mud', glsl: mud, relief: 0.034, aoRadius: 24, aoStrength: 0.9 },
  { name: 'lichen_grass', glsl: lichenGrass, relief: 0.038, aoRadius: 20, aoStrength: 0.85 },
  { name: 'lava_crust', glsl: lavaCrust, relief: 0.048, aoRadius: 24, aoStrength: 0.9 },
  { name: 'snow', glsl: snow, relief: 0.020, aoRadius: 20, aoStrength: 0.65 },
  { name: 'cut_stone', glsl: cutStone, relief: 0.042, aoRadius: 28, aoStrength: 0.9 },
  // Was 0.014 against a field whose only relief was a soft trowel fBm, which
  // rendered a normal map with a standard deviation of 12.6 — the flattest
  // surface in the library bar obsidian, on the material every village hut is
  // made of. The set now carries three decades of aggregate, a spall network
  // with a raised arris and reed lath, so there is real slope to convert.
  { name: 'plaster', glsl: plaster, relief: 0.030, aoRadius: 20, aoStrength: 0.85 },
  { name: 'chitin', glsl: chitin, relief: 0.036, aoRadius: 22, aoStrength: 0.85 },
  { name: 'thatch', glsl: thatch, relief: 0.056, aoRadius: 26, aoStrength: 0.95 },
  { name: 'wood_weathered', glsl: woodWeathered, relief: 0.026, aoRadius: 20, aoStrength: 0.85 },
  { name: 'bark_fungal', glsl: barkFungal, relief: 0.070, aoRadius: 28, aoStrength: 0.95 },
  { name: 'cloth', glsl: cloth, relief: 0.024, aoRadius: 18, aoStrength: 0.85 },
  { name: 'iron', glsl: iron, relief: 0.018, aoRadius: 18, aoStrength: 0.8 },
  { name: 'bronze', glsl: bronze, relief: 0.026, aoRadius: 20, aoStrength: 0.85 },
  { name: 'glass_volcanic', glsl: glassVolcanic, relief: 0.026, aoRadius: 22, aoStrength: 0.7 },
  { name: 'bone', glsl: bone, relief: 0.036, aoRadius: 24, aoStrength: 0.9 },
  { name: 'pumice', glsl: pumice, relief: 0.052, aoRadius: 26, aoStrength: 0.95 },
];
