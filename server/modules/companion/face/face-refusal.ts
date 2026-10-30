/**
 * A bake that cannot make a face, said as a sentence for his screen: the message IS the sentence. Thrown by the bake, the
 * atlas and the lock; `face-bake.ts` re-exports it (the CLI prints it, `face.service.ts` shows it as the bake's failure).
 * It lives in its own file because `face-atlas.ts` throws it and `face-bake.ts` imports the atlas.
 */
export class FaceBakeRefusal extends Error {
  override name = 'FaceBakeRefusal';
}

/**
 * The photo itself is unusable (unreadable bytes, too small): the sentence names what is wrong with it. A subclass so the
 * upload route can answer 400 where every other refusal is a bake that stopped.
 */
export class FacePhotoInvalid extends FaceBakeRefusal {
  override name = 'FacePhotoInvalid';
}

/** The shortest side a photo may have: under it the face is too few pixels to make 256 px frames from. Consumed by `face-atlas.ts`. */
export const MIN_PHOTO_SIDE = 512;

/** Every sentence a refusal says, in one place so the screen's words are never scattered through the bake. Consumed by `face-bake.ts`, `face-atlas.ts`, `face-lock.ts` and `comfyui.ts`. */
export const sentences = {
  notInstalled: (dir: string) => `Her face cannot be made: ComfyUI is not installed at ${dir}; run scripts/install-comfyui.sh.`,
  noFace: () => 'No face was found in that photo. Choose one where her face is clear, facing forward and not cut off.',
  stopped: (done: number, total: number) =>
    `The face maker stopped after ${done} of ${total} frames; upload the photo again to finish it.`,
  photoMissing: () => 'That photo is not stored here. Upload it again.',
  busy: (pid: number | null) =>
    `Another face is being made right now${pid === null ? '' : ` (process ${pid})`}; wait for it to finish, then run this again.`,
  tooSmall: (shortSide: number) =>
    `That photo is too small: its shorter side is ${shortSide} px and a face needs at least ${MIN_PHOTO_SIDE}. Choose a larger photo.`,
  unreadable: () => 'That file is not a photo this can read. Choose a JPEG, PNG or WebP picture.',
};
