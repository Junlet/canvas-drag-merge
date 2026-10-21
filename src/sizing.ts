/**
 * Geometry for images staged into a newly created drawing.
 *
 * Kept separate from `excalidraw.ts` so the scaling maths -- the part that is
 * easy to get wrong and needs no Obsidian to check -- can be tested on its own.
 *
 * Only pictures are staged by this plugin, so there is no "may this be
 * enlarged?" question to answer: an image element keeps the original bytes and
 * Excalidraw re-renders them, so growing one costs no quality. (Rasterised
 * notes and other drawings go through the interactive-embed path instead, which
 * leaves their size alone.)
 */

/** Smallest accepted insertion size, in percent. */
export const IMAGE_SCALE_MIN = 25;

/** Largest accepted insertion size, in percent. */
export const IMAGE_SCALE_MAX = 400;

/** Slider step, in percent. */
export const IMAGE_SCALE_STEP = 5;

/** What a new installation gets: the Canvas node's own box, unchanged. */
export const DEFAULT_IMAGE_SCALE = 100;

/**
 * Coerces a stored value into a usable percentage.
 *
 * Missing, non-numeric and out-of-range values all fall back to the shipped
 * default rather than being trusted, so a hand-edited `data.json` cannot ask
 * for a 4000% image.
 *
 * @param value - Raw stored value.
 * @returns A whole percent between {@link IMAGE_SCALE_MIN} and
 *   {@link IMAGE_SCALE_MAX}.
 */
export function normalizeImageScale(value: unknown): number {
	const numeric =
		typeof value === "number" && Number.isFinite(value)
			? value
			: DEFAULT_IMAGE_SCALE;
	return Math.min(
		IMAGE_SCALE_MAX,
		Math.max(IMAGE_SCALE_MIN, Math.round(numeric))
	);
}

/**
 * Computes the size a staged image should take.
 *
 * `addImage(..., scale = false)` stages the image at its natural pixel size, so
 * the element's current `width`/`height` *are* the natural dimensions. The
 * image is fitted into the Canvas node's box while keeping its aspect ratio (a
 * node's box can be an arbitrary shape), then multiplied by the user's
 * insertion size.
 *
 * @param naturalWidth - The image's own width, in pixels.
 * @param naturalHeight - The image's own height, in pixels.
 * @param boxWidth - Target width, from the Canvas node.
 * @param boxHeight - Target height, from the Canvas node.
 * @param scale - Insertion-size multiplier; `1` leaves the node's box in charge.
 * @returns The size to apply, or `null` when the inputs are unusable.
 */
export function fitSize(
	naturalWidth: number,
	naturalHeight: number,
	boxWidth: number,
	boxHeight: number,
	scale: number
): { width: number; height: number } | null {
	if (!(naturalWidth > 0) || !(naturalHeight > 0)) return null;
	if (!(boxWidth > 0) || !(boxHeight > 0)) return null;

	let ratio = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
	ratio *= scale > 0 ? scale : 1;
	if (!Number.isFinite(ratio) || ratio <= 0) return null;

	return { width: naturalWidth * ratio, height: naturalHeight * ratio };
}
